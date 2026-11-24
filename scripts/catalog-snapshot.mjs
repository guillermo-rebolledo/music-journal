import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { CatalogError, project, readMetadata, sourceFiles, stage } from "./catalog/load.mjs";

const lockNamespace = 21421;
const minimumProductionCount = 100_000;
const minimumRetainedFraction = 0.9;
const usage = "catalog:snapshot status | (validate|import) (--official YYYYMMDD-HHMMSS|--fixture DIR) | publish GENERATION | rollback";

function parse(args) {
  const [operation, option, input] = args;
  if ((operation === "import" || operation === "validate") && args.length === 3) {
    if ((option === "--official" && /^\d{8}-\d{6}$/.test(input)) || (option === "--fixture" && input)) {
      return { operation, source: { input, fixture: option === "--fixture" } };
    }
  }
  if (operation === "publish" && args.length === 2 && /^[1-9]\d{0,9}$/.test(option) && Number(option) <= 2147483647) {
    return { operation, generation: Number(option) };
  }
  if ((operation === "status" || operation === "rollback") && args.length === 1) return { operation };
  throw new CatalogError("usage", usage);
}

async function transaction(db, work) {
  await db.query("BEGIN");
  try {
    const result = await work();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function requireFixtureDatabase(db) {
  const { rows: [{ name }] } = await db.query("SELECT current_database() AS name");
  if (process.env.CATALOG_ALLOW_FIXTURES !== "1" || !/_(test|preview|fixture)$/.test(name)) {
    throw new CatalogError("fixture-guard", "Fixtures require CATALOG_ALLOW_FIXTURES=1 and an isolated database with a fixture, preview or test suffix.");
  }
}

async function checkFeed(db, candidate) {
  const { rows: [latest] } = await db.query(`
    SELECT v.*, v.source_timestamp >= $1::timestamptz AS same_or_newer
    FROM catalog.state s JOIN catalog.snapshot v ON v.generation = s.latest_generation
  `, [candidate.source_timestamp]);
  if (latest && latest.fixture !== candidate.fixture) {
    throw new CatalogError("feed-mismatch", "A Catalog database cannot mix official and fixture feeds.");
  }
  if (latest && (latest.replication_sequence > candidate.replication_sequence
    || (latest.generation !== candidate.generation && latest.same_or_newer))) {
    throw new CatalogError("out-of-order", "Routine promotion cannot move below the latest published snapshot.");
  }
  if (candidate.fixture || candidate.album_count === undefined) return null;

  const { version, album_count: albums, artist_count: artists } = candidate;
  if (albums < minimumProductionCount || artists < minimumProductionCount) {
    throw new CatalogError("count-floor", `The official snapshot ${version} is below the production floor (${albums} Albums, ${artists} Artists).`);
  }
  if (latest && (albums < latest.album_count * minimumRetainedFraction || artists < latest.artist_count * minimumRetainedFraction)) {
    const review = `${version}:${albums}:${artists}`;
    if (process.env.CATALOG_REVIEWED_COUNT_DROP !== review) {
      throw new CatalogError("count-drop", `The official snapshot ${version} has ${albums} Albums and ${artists} Artists. Review the drop against the published baseline.`);
    }
    return review;
  }
  return null;
}

async function validate(db, source, run, signal) {
  if (source.fixture) await requireFixtureDatabase(db);
  else {
    // A signed archive at this pinned path was already imported successfully.
    const { rows: [existing] } = await db.query("SELECT * FROM catalog.snapshot WHERE version = $1 AND NOT fixture", [source.input]);
    if (existing) return { ...existing, skipped: true };
  }

  const scratch = await mkdtemp(join(tmpdir(), "music-journal-catalog-"));
  try {
    const dir = await sourceFiles(source, scratch, signal);
    const meta = await readMetadata(dir, source);
    const { rows: [existing] } = await db.query(`
      SELECT *, source_timestamp = $2::timestamptz AS same_timestamp
      FROM catalog.snapshot WHERE version = $1
    `, [meta.version, meta.source_timestamp]);
    if (existing) {
      if (!existing.same_timestamp) throw new CatalogError("version-conflict", "The snapshot version has a different timestamp.");
      const { same_timestamp: _, ...snapshot } = existing;
      return { ...snapshot, skipped: true };
    }
    await checkFeed(db, meta);

    const snapshot = await transaction(db, async () => {
      await stage(db, dir, signal);
      signal.throwIfAborted();
      const { rows: [{ generation }] } = await db.query(`
        INSERT INTO catalog.snapshot (
          version, source_timestamp, schema_sequence, replication_sequence, fixture,
          album_count, artist_count, credit_count, redirect_count, term_count
        ) VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 0, 0) RETURNING generation
      `, [meta.version, meta.source_timestamp, meta.schema_sequence, meta.replication_sequence, meta.fixture]);
      const result = await project(db, generation);
      const countReview = await checkFeed(db, result);
      const { rows: [{ validated_at }] } = await db.query(
        "UPDATE catalog.snapshot SET validated_at = clock_timestamp() WHERE generation = $1 RETURNING validated_at",
        [generation],
      );
      await db.query("UPDATE catalog.import_run SET generation = $1, count_review = $2 WHERE id = $3", [generation, countReview, run]);
      signal.throwIfAborted();
      return { ...result, validated_at };
    });
    return { ...snapshot, skipped: false };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function activate(db, generation, rollback, run, signal) {
  const { rows: [state] } = await db.query("SELECT * FROM catalog.state");
  const target = rollback ? state.previous_generation : generation;
  if (!target) throw new CatalogError("no-previous", "There is no previous generation to roll back to.");
  const { rows: [snapshot] } = await db.query("SELECT * FROM catalog.snapshot WHERE generation = $1", [target]);
  if (!snapshot) throw new CatalogError("unknown-generation", "The requested generation has not been validated.");
  if (snapshot.fixture) await requireFixtureDatabase(db);
  if (target === state.active_generation) return false;
  const countReview = rollback ? null : await checkFeed(db, snapshot);
  if (!rollback && target === state.latest_generation) {
    throw new CatalogError("out-of-order", "Use explicit rollback to switch back to the previous publication.");
  }

  await transaction(db, async () => {
    // Membership transactions take the matching shared lock before reading state.
    await db.query("SET LOCAL lock_timeout = '15s'");
    await db.query("SELECT pg_advisory_xact_lock($1, 1)", [lockNamespace]);
    signal.throwIfAborted();
    await db.query(`
      UPDATE catalog.state
      SET active_generation = $1, previous_generation = $2, latest_generation = $3
    `, [target, state.active_generation, rollback ? state.latest_generation : target]);
    await db.query("UPDATE catalog.snapshot SET activated_at = clock_timestamp() WHERE generation = $1", [target]);
    await db.query(`
      UPDATE catalog.import_run SET generation = $1, count_review = coalesce($2, count_review)
      WHERE id = $3
    `, [target, countReview, run]);
  });
  return true;
}

async function status(db) {
  const { rows: [result] } = await db.query(`
    SELECT to_jsonb(a) AS active, s.previous_generation, s.latest_generation,
      extract(epoch FROM clock_timestamp() - a.source_timestamp)::bigint AS age_seconds,
      clock_timestamp() - a.source_timestamp > interval '7 days' AS stale,
      (SELECT to_jsonb(r) FROM catalog.import_run r WHERE r.error_category IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_failure,
      (SELECT to_jsonb(r) FROM catalog.import_run r ORDER BY id DESC LIMIT 1) AS last_attempt
    FROM catalog.state s LEFT JOIN catalog.snapshot a ON a.generation = s.active_generation
  `);
  return result;
}

function asCatalogError(error, signal) {
  if (signal.aborted) return new CatalogError("interrupted", "The import was interrupted.");
  if (error instanceof CatalogError) return error;
  if (error.code === "55P03") return new CatalogError("publication-timeout", "Timed out waiting for a membership transaction.");
  return new CatalogError("database", `The Catalog operation failed${error.code ? ` (${error.code})` : ""}.`);
}

async function operate(db, command, signal) {
  const { operation, source } = command;
  if (operation === "status") return status(db);

  const { rows: [{ acquired }] } = await db.query("SELECT pg_try_advisory_lock($1, 0) AS acquired", [lockNamespace]);
  if (!acquired) throw new CatalogError("busy", "Another Catalog operator command is running.");

  await db.query(`
    UPDATE catalog.import_run SET finished_at = clock_timestamp(), error_category = 'interrupted'
    WHERE finished_at IS NULL
  `);
  const { rows: [{ id }] } = await db.query(
    "INSERT INTO catalog.import_run (operation, source, generation) VALUES ($1, $2, NULL) RETURNING id",
    [operation, source?.fixture ? "fixture" : source?.input ?? null],
  );
  try {
    let result;
    let generation = command.generation;
    if (source) {
      result = await validate(db, source, id, signal);
      generation = result.generation;
    }
    signal.throwIfAborted();
    const changed = operation === "validate" ? false : await activate(db, generation, operation === "rollback", id, signal);
    const state = await status(db);
    await db.query(`
      UPDATE catalog.import_run SET generation = $1, finished_at = clock_timestamp() WHERE id = $2
    `, [generation ?? state.active?.generation ?? null, id]);
    return { ...result, generation: generation ?? state.active?.generation, changed, active: state.active };
  } catch (error) {
    const failure = asCatalogError(error, signal);
    await db.query(`
      UPDATE catalog.import_run SET finished_at = clock_timestamp(), error_category = $1 WHERE id = $2
    `, [failure.category, id]);
    throw failure;
  }
}

const controller = new AbortController();
for (const name of ["SIGINT", "SIGTERM"]) process.once(name, () => controller.abort());

try {
  const command = parse(process.argv.slice(2));
  const url = process.env.CATALOG_DATABASE_URL;
  if (!url) throw new CatalogError("configuration", "Set CATALOG_DATABASE_URL to the Catalog operator connection.");
  const db = new pg.Client({
    connectionString: url,
    application_name: "catalog-snapshot",
    connectionTimeoutMillis: 5000,
    types: { getTypeParser: (oid, format) => oid === 1184 ? (value) => value : pg.types.getTypeParser(oid, format) },
  });
  // Awaited queries report errors. An idle disconnect must also stop download or COPY.
  db.on("error", () => controller.abort());
  try {
    await db.connect();
    await db.query("SET search_path = pg_catalog, public; SET TIME ZONE 'UTC'");
    console.log(JSON.stringify(await operate(db, command, controller.signal)));
  } finally {
    await db.end();
  }
} catch (error) {
  const failure = asCatalogError(error, controller.signal);
  console.error(`${failure.category}: ${failure.message}`);
  process.exitCode = 1;
}
