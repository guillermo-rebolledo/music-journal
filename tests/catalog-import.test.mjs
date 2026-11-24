import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import pg from "pg";

const exec = promisify(execFile);
const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
const legacy = "11111111-1111-4111-8111-111111111111";
const current = "00000000-0000-0000-0000-0000000000c9";
const legacyArtist = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const currentArtist = "00000000-0000-0000-0000-000000000065";
const fixture = (version) => `tests/fixtures/catalog/v${version}`;
const operator = new URL(url);
operator.username = "catalog_operator_test";
operator.password = "test_only";
const cli = (...args) => exec(process.execPath, ["scripts/catalog-snapshot.mjs", ...args], {
  env: { ...process.env, CATALOG_DATABASE_URL: operator.href, CATALOG_ALLOW_FIXTURES: "1" },
}).then(({ stdout }) => JSON.parse(stdout));

test("operator validates and switches Catalog snapshots while preserving Journal references", async (t) => {
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/music_journal_snapshot_test");
  const pool = new pg.Pool({ connectionString: url.href });
  const dir = await mkdtemp(join(tmpdir(), "catalog-import-test-"));
  const blocker = await pool.connect();
  t.after(async () => {
    blocker.release();
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  });
  await pool.query(`
    CREATE ROLE catalog_operator_test LOGIN PASSWORD 'test_only';
    GRANT CONNECT, TEMPORARY ON DATABASE music_journal_snapshot_test TO catalog_operator_test;
    GRANT USAGE ON SCHEMA catalog TO catalog_operator_test;
    GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA catalog TO catalog_operator_test;
    GRANT UPDATE ON catalog.snapshot, catalog.state, catalog.import_run TO catalog_operator_test;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA catalog TO catalog_operator_test;
    GRANT MAINTAIN ON catalog.album, catalog.artist, catalog.album_credit, catalog.album_redirect,
      catalog.artist_redirect, catalog.album_term, catalog.artist_term TO catalog_operator_test;
  `);
  assert.equal((await pool.query(`
    SELECT has_table_privilege('catalog_operator_test', 'public.listen', 'INSERT') AS writable
  `)).rows[0].writable, false);
  const activeVersion = async () => (await cli("status")).active?.version ?? null;
  const lookup = async (id) => (await pool.query(`
    SELECT a.mbid, a.title, a.credited_artist, a.release_year, a.release_month, a.release_day
      FROM catalog.state s
      LEFT JOIN catalog.album_redirect r ON r.generation = s.active_generation AND r.old_mbid = $1
      JOIN catalog.album a ON a.generation = s.active_generation AND a.mbid = coalesce(r.mbid, $1)
  `, [id])).rows[0];

  assert.equal(await activeVersion(), null);
  await assert.rejects(cli("import", "--fixture", join(dir, "unavailable")), /missing-input/);
  assert.equal(await activeVersion(), null);
  const first = await cli("import", "--fixture", fixture(1));
  assert.equal(await activeVersion(), "fixture-1");
  assert.deepEqual(await lookup(legacy), {
    mbid: legacy, title: "Shared title", credited_artist: "First Artist & Guest",
    release_year: 1998, release_month: 5, release_day: 1,
  });
  const rerun = await cli("import", "--fixture", fixture(1));
  assert.equal(rerun.generation, first.generation);
  assert.equal(rerun.skipped, true);
  assert.deepEqual((await pool.query(`
    SELECT match_key, compact_key FROM catalog.album_term
    WHERE generation = $1 AND source = 'alias' AND term = 'Kind of Blué'
  `, [first.generation])).rows, [{ match_key: "kind of blue", compact_key: "kindofblue" }]);
  assert.equal((await pool.query("SELECT catalog.normalize_term($1) AS term", ["João ＡＣ／ＤＣ 宇多田ヒカル"])).rows[0].term,
    "joao ac dc 宇多田ヒカル");
  assert.deepEqual((await pool.query(`
    SELECT title, release_year, release_month, release_day, secondary_types, website_default
    FROM catalog.album WHERE generation = $1 AND title IN ('Cancelled date album', 'Compilation', 'Promotional album')
    ORDER BY title
  `, [first.generation])).rows, [
    { title: "Cancelled date album", release_year: null, release_month: null, release_day: null,
      secondary_types: [], website_default: false },
    { title: "Compilation", release_year: 2012, release_month: 3, release_day: null,
      secondary_types: ["Compilation"], website_default: true },
    { title: "Promotional album", release_year: 2020, release_month: 3, release_day: null,
      secondary_types: [], website_default: false },
  ]);

  await pool.query(`INSERT INTO "user" (id, name, email) VALUES ('fixture', 'Fixture', 'snapshot@example.test')`);
  await pool.query("INSERT INTO public.album (id, title, credited_artist) VALUES ($1, 'Shared title', 'First Artist & Guest')", [legacy]);
  await pool.query("INSERT INTO public.listen (listener_id, submission_key, album_id, listen_date) VALUES ('fixture', 'original', $1, '2025-01-02')", [legacy]);
  await pool.query("INSERT INTO public.want_to_listen (listener_id, album_id) VALUES ('fixture', $1)", [legacy]);

  const archive = join(dir, "v2.tar.bz2");
  await exec("tar", ["-cjf", archive, "-C", fixture(2), "TIMESTAMP", "SCHEMA_SEQUENCE", "REPLICATION_SEQUENCE", "mbdump"]);
  const second = await cli("validate", "--fixture", archive);
  assert.ok(second.generation > first.generation);
  assert.equal(await activeVersion(), "fixture-1");
  assert.equal(await lookup(current), undefined);

  await cp(fixture(2), dir, { recursive: true });
  await writeFile(join(dir, "REPLICATION_SEQUENCE"), "3\n");
  await writeFile(join(dir, "TIMESTAMP"), "2026-01-03 00:00:00+00\n");
  await writeFile(join(dir, "mbdump", "artist_gid_redirect"), `${legacyArtist}\t99999\t\\N\n`);
  await assert.rejects(cli("import", "--fixture", dir), /invalid-reference/);
  assert.equal((await cli("status")).last_failure.error_category, "invalid-reference");
  assert.equal((await lookup(legacy)).mbid, legacy);

  await blocker.query("BEGIN");
  await blocker.query("SELECT pg_advisory_xact_lock_shared(21421, 1)");
  const publish = cli("publish", String(second.generation));
  void publish.catch(() => {});
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      waiting = (await pool.query(`
        SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 21421 AND objid = 1 AND NOT granted
      `)).rowCount > 0;
      if (!waiting) await delay(50);
    }
    assert.equal(waiting, true);
    await assert.rejects(cli("import", "--fixture", fixture(2)), /busy/);
    assert.equal(await activeVersion(), "fixture-1");
    assert.equal((await lookup(legacy)).mbid, legacy);
  } finally {
    await blocker.query("COMMIT");
    await publish;
  }

  assert.equal(await activeVersion(), "fixture-2");
  assert.equal((await lookup(legacy)).mbid, current);
  assert.equal((await lookup(current)).mbid, current);
  assert.equal((await pool.query(`
    SELECT r.mbid FROM catalog.state s JOIN catalog.artist_redirect r ON r.generation = s.active_generation
    WHERE r.old_mbid = $1
  `, [legacyArtist])).rows[0].mbid, currentArtist);
  await assert.rejects(cli("publish", String(first.generation)), /out-of-order/);
  assert.deepEqual((await pool.query(`
    SELECT l.album_id, l.submission_key FROM public.listen l
    JOIN public.want_to_listen w USING (listener_id, album_id)
    WHERE l.listener_id = 'fixture'
  `)).rows, [{ album_id: legacy, submission_key: "original" }]);

  await cli("rollback");
  assert.equal(await activeVersion(), "fixture-1");
  assert.equal((await lookup(legacy)).mbid, legacy);
  assert.equal((await cli("import", "--fixture", fixture(1))).changed, false);
  await assert.rejects(cli("publish", String(second.generation)), /out-of-order/);
  await cli("rollback");
  assert.equal(await activeVersion(), "fixture-2");
});
