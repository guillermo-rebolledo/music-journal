import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import copyStreams from "pg-copy-streams";

const exec = promisify(execFile);
const tables = [
  "artist", "artist_type", "artist_alias", "artist_credit", "artist_credit_name", "artist_gid_redirect",
  "release_group", "release_group_primary_type", "release_group_secondary_type",
  "release_group_secondary_type_join", "release_group_alias", "release_group_gid_redirect",
  "release", "release_status", "release_country", "release_unknown_country",
];
const metadata = ["TIMESTAMP", "SCHEMA_SEQUENCE", "REPLICATION_SEQUENCE"];
const files = [...metadata, ...tables.map((table) => `mbdump/${table}`)];
const fingerprint = "D5E63B4BDCCE195642948684B8FC2375C777580F";
const schemaSequence = 31;
const fixtureSizeLimit = 64 * 1024 * 1024;
const projectionTables = "catalog.album, catalog.artist, catalog.album_credit, catalog.album_redirect, catalog.artist_redirect, catalog.album_term, catalog.artist_term";
const sql = (name) => readFile(new URL(`${name}.sql`, import.meta.url), "utf8");

export class CatalogError extends Error {
  constructor(category, message) {
    super(message);
    this.category = category;
  }
}

export async function sourceFiles(source, scratch, signal) {
  if (source.fixture) {
    const input = await lstat(source.input).catch(() => null);
    if (input?.isDirectory()) {
      await checkFiles(source.input, fixtureSizeLimit);
      return source.input;
    }
    if (!input?.isFile()) throw new CatalogError("missing-input", "Fixture directory or archive is missing.");
    if (input.size > fixtureSizeLimit) throw new CatalogError("fixture-size", "Fixture archive exceeds 64 MiB.");
    await extract(source.input, scratch, signal, fixtureSizeLimit);
    return scratch;
  }

  const staged = process.env.CATALOG_SIGNED_ARCHIVE;
  const archive = staged ? resolve(staged) : join(scratch, "mbdump.tar.bz2");
  const signature = `${archive}.asc`;
  if (staged) {
    const inputs = await Promise.all([archive, signature].map((path) => lstat(path).catch(() => null)));
    if (inputs.some((file) => !file?.isFile() || !file.size) || inputs[1].size > 64 * 1024) {
      throw new CatalogError("missing-input", "The staged official archive and its detached .asc signature must be regular files.");
    }
  }

  const key = process.env.CATALOG_MUSICBRAINZ_KEY;
  if (!key) throw new CatalogError("signature", "Set CATALOG_MUSICBRAINZ_KEY to the MusicBrainz public key file.");

  const home = join(scratch, "gpg");
  await mkdir(home, { mode: 0o700 });
  const gpg = ["--batch", "--no-options", "--no-auto-key-retrieve", "--no-autostart", "--homedir", home];
  const keyring = join(home, "musicbrainz.gpg");
  const opts = commandOptions(signal);

  try {
    await exec("gpg", [...gpg, "--dearmor", "--output", keyring, resolve(key)], opts);
    const { stdout } = await exec("gpg", [...gpg, "--with-colons", "--show-keys", keyring], opts);
    if (!stdout.split("\n").some((line) => line.startsWith("fpr:") && line.split(":")[9] === fingerprint)) {
      throw new Error("Unexpected signing key");
    }
  } catch {
    throw new CatalogError("signature", "Could not load the documented MusicBrainz signing key.");
  }

  if (!staged) {
    const base = `https://data.metabrainz.org/pub/musicbrainz/data/fullexport/${source.input}/mbdump.tar.bz2`;
    const curl = ["--fail", "--silent", "--show-error", "--proto", "=https", "--retry", "3", "--connect-timeout", "30"];
    try {
      await exec("curl", [...curl, "--output", signature, `${base}.asc`], opts);
      await exec("curl", [...curl, "--continue-at", "-", "--output", archive, base], opts);
    } catch {
      throw new CatalogError("download", "Could not download the pinned core dump and signature.");
    }
  }
  try {
    const { stdout } = await exec("gpg", [
      ...gpg, "--no-default-keyring", "--keyring", keyring, "--status-fd", "1", "--verify", signature, archive,
    ], opts);
    const valid = stdout.split("\n").some((line) => {
      const fields = line.split(" ");
      return fields[1] === "VALIDSIG" && fields.at(-1) === fingerprint;
    });
    if (!valid) throw new Error("Unexpected signer");
  } catch {
    throw new CatalogError("signature", "The core dump failed MusicBrainz signature verification.");
  }

  await extract(archive, scratch, signal);
  return scratch;
}

function commandOptions(signal) {
  return { signal, env: { PATH: process.env.PATH } };
}

async function extract(archive, dir, signal, sizeLimit) {
  try {
    await exec("tar", ["-xjf", archive, "-C", dir, "--", ...files], commandOptions(signal));
  } catch {
    throw new CatalogError("archive", "Could not extract all required core files from the archive.");
  }
  await checkFiles(dir, sizeLimit);
}

async function checkFiles(dir, sizeLimit = Infinity) {
  const directory = await lstat(join(dir, "mbdump")).catch(() => null);
  if (!directory?.isDirectory()) throw new CatalogError("missing-input", "Missing native mbdump directory.");
  let bytes = 0;
  for (const name of files) {
    const file = await lstat(join(dir, name)).catch(() => null);
    if (!file?.isFile() || (metadata.includes(name) && file.size > 128)) {
      throw new CatalogError("missing-input", `Missing or invalid native dump file ${name}.`);
    }
    bytes += file.size;
    if (bytes > sizeLimit) throw new CatalogError("fixture-size", "Unpacked Catalog fixture exceeds 64 MiB.");
  }
}

export async function readMetadata(dir, source) {
  const [timestamp, schema, replication] = await Promise.all(metadata.map(async (name) =>
    (await readFile(join(dir, name), "utf8")).trim()));
  if (schema !== String(schemaSequence)) {
    throw new CatalogError("schema-version", `Expected MusicBrainz schema sequence ${schemaSequence}.`);
  }
  const time = Date.parse(timestamp);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00(?::00)?$/.test(timestamp) || !Number.isFinite(time)
    || !/^\d{1,10}$/.test(replication) || Number(replication) < 1 || Number(replication) > 2147483647) {
    throw new CatalogError("metadata", "Invalid native TIMESTAMP or REPLICATION_SEQUENCE.");
  }
  if (!source.fixture) {
    const pinned = Date.parse(source.input.replace(
      /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3T$4:$5:$6Z"));
    if (!Number.isFinite(pinned) || Math.abs(time - pinned) > 5 * 60 * 1000 || time > Date.now() + 5 * 60 * 1000) {
      throw new CatalogError("metadata", "The signed archive timestamp does not match the pinned export date.");
    }
  }
  return {
    version: source.fixture ? `fixture-${Number(replication)}` : source.input,
    source_timestamp: timestamp,
    schema_sequence: schemaSequence,
    replication_sequence: Number(replication),
    fixture: source.fixture,
  };
}

export async function stage(db, dir, signal) {
  await db.query(await sql("stage"));
  for (const table of tables) {
    try {
      const copy = db.query(copyStreams.from(`COPY pg_temp.${table} FROM STDIN WITH (FORMAT text)`));
      await pipeline(createReadStream(join(dir, "mbdump", table)), copy, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new CatalogError("copy", `COPY rejected ${table}${error.code ? ` (${error.code})` : ""}.`);
    }
  }
  await db.query(`ANALYZE ${tables.map((table) => `pg_temp.${table}`).join(", ")}`);
  const { rows: [problem] } = await db.query(await sql("validate"));
  if (problem) throw new CatalogError(problem.category, "Core data failed validation.");
}

export async function project(db, generation) {
  await db.query("SELECT set_config('catalog_import.generation', $1, true)", [String(generation)]);
  await db.query(await sql("project"));
  const { rows: [counts] } = await db.query(`
    UPDATE catalog.snapshot s SET
      album_count = (SELECT count(*) FROM catalog.album WHERE generation = $1),
      artist_count = (SELECT count(*) FROM catalog.artist WHERE generation = $1),
      credit_count = (SELECT count(*) FROM catalog.album_credit WHERE generation = $1),
      redirect_count = (SELECT count(*) FROM catalog.album_redirect WHERE generation = $1)
        + (SELECT count(*) FROM catalog.artist_redirect WHERE generation = $1),
      term_count = (SELECT count(*) FROM catalog.album_term WHERE generation = $1)
        + (SELECT count(*) FROM catalog.artist_term WHERE generation = $1)
    WHERE generation = $1 RETURNING s.*
  `, [generation]);
  const { rows: [smoke] } = await db.query(`
    SELECT
      EXISTS (SELECT 1 FROM catalog.album_term t JOIN catalog.album a USING (generation, mbid)
        WHERE t.generation = $1 AND t.source = 'canonical' AND t.match_key = catalog.normalize_term(a.title)) AS album,
      EXISTS (SELECT 1 FROM catalog.artist_term t JOIN catalog.artist a USING (generation, mbid)
        WHERE t.generation = $1 AND t.source = 'canonical' AND t.match_key = catalog.normalize_term(a.name)) AS artist,
      EXISTS (SELECT 1 FROM catalog.album_credit c JOIN catalog.artist a
        ON a.generation = c.generation AND a.mbid = c.artist_mbid WHERE c.generation = $1) AS credit
  `, [generation]);
  if (!smoke.album || !smoke.artist || !smoke.credit) {
    throw new CatalogError("smoke-query", "The generation did not return Album, Artist and credit smoke results.");
  }
  // PG17's MAINTAIN permission is required for ANALYZE. Without it Postgres only emits a warning.
  const { rows: [permissions] } = await db.query(
    "SELECT bool_and(has_table_privilege(regclass, 'MAINTAIN')) AS allowed FROM unnest($1::regclass[]) AS regclass",
    [projectionTables.split(", ")],
  );
  if (!permissions.allowed) throw new CatalogError("permissions", "The importer needs MAINTAIN on the Catalog projection tables.");
  await db.query(`ANALYZE ${projectionTables}`);
  return counts;
}
