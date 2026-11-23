# Catalog snapshot import

The operator command loads the dated MusicBrainz CC0 core Postgres dump into the Journal database's separate `catalog` schema. Each import validates and materializes an immutable generation. Publication changes one database row, and rollback reselects a previously validated generation. The app's durable Album and Artist metadata and private Journal records live in `public`. [MusicBrainz core data and signatures](https://musicbrainz.org/doc/MusicBrainz_Database/Download) · [Schema](https://musicbrainz.org/doc/MusicBrainz_Database/Schema) · [Export schedule](https://metabrainz.org/datasets/postgres-dumps)

## Prerequisites and roles

- Use Node 22.9 or newer, PostgreSQL 17 or newer with UTF-8 and ICU (`und-x-icu`), and a direct or session-pooled database connection. The importer uses temporary tables and holds a session advisory lock, so transaction pooling is incompatible. Official runs also use `curl`, GnuPG and `tar` with bzip2 support.
- Install dependencies with `npm ci`. Apply `npm run db:migrate` as the migration owner before using the CLI. Migration `0005_catalog-snapshot` creates the Catalog and installs the `pg_trgm`, `btree_gist` and `unaccent` extensions in `public`. On managed Postgres, provision those extensions in `public` with the migration owner's permissions.
- Supply a dedicated operator login in `CATALOG_DATABASE_URL`. Keep this credential on the import runner. Grant the operator `CONNECT` and `TEMPORARY` on the target database, use the grants below, and keep its role membership and table ownership independent of the app's `public` tables. The app login needs `USAGE` on `catalog` and `SELECT` on `catalog.state`, `catalog.snapshot` and the seven Catalog projection tables for local reads. Its existing Journal grants still apply.
- Provide `TMPDIR` on a disk with space for the compressed archive and the selected unpacked tables. On the database host, reserve space for the temporary tables and sort spills, projection and indexes for the active and previous generations plus one build, and WAL. The operator command streams native COPY inputs into temporary tables and releases scratch space and the DB session when it exits. After a forced kill, remove that run's abandoned `music-journal-catalog-*` directory once the process is gone.

```sql
-- Substitute the names of existing logins and the target database.
GRANT CONNECT, TEMPORARY ON DATABASE music_journal TO catalog_operator;
GRANT USAGE ON SCHEMA catalog TO catalog_operator;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA catalog TO catalog_operator;
GRANT UPDATE ON catalog.snapshot, catalog.state, catalog.import_run TO catalog_operator;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA catalog TO catalog_operator;
GRANT MAINTAIN ON catalog.album, catalog.artist, catalog.album_credit, catalog.album_redirect,
  catalog.artist_redirect, catalog.album_term, catalog.artist_term TO catalog_operator;
```

## Validate and publish

Choose a date from the [official export directory](https://data.metabrainz.org/pub/musicbrainz/data/fullexport/). Supply a public key file obtained by full fingerprint and then pin the export directory name. The CLI fetches the official `mbdump.tar.bz2` and detached signature, verifies the signing fingerprint with a private temporary GnuPG home, and checks the signed archive's UTC timestamp against the chosen export directory. It accepts MusicBrainz schema sequence **31**. After a source schema change, review the COPY column order, core table list, types and release semantics before updating the supported sequence. [MusicBrainz signing instructions](https://musicbrainz.org/doc/MusicBrainz_Database/Download)

```sh
# Populate CATALOG_DATABASE_URL from the operator runner's secret store first.
curl -fsS 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0xD5E63B4BDCCE195642948684B8FC2375C777580F' \
  -o "$PWD/musicbrainz-signing-key.asc"
export CATALOG_MUSICBRAINZ_KEY="$PWD/musicbrainz-signing-key.asc"
export TMPDIR=/path/to/catalog-scratch

npm run catalog:snapshot -- status
npm run catalog:snapshot -- validate --official YYYYMMDD-HHMMSS
# Inspect the JSON counts and validation timestamp, then use its generation.
npm run catalog:snapshot -- publish GENERATION
npm run catalog:snapshot -- status
```

After establishing the feed and reviewing the first full staging import, a scheduled runner can check daily for the current export and run `npm run catalog:snapshot -- import --official YYYYMMDD-HHMMSS` with its pinned date. This validates and activates under a single operator lock. An already-validated date can reuse the generation, and importing the currently active date reports `changed: false`. Downloads and index maintenance run as an operator job, outside builds and app requests. The import verifies native metadata and COPY shape, owned references, unique identities, release-date bounds, redirects and Catalog smoke queries. Projection indexes are maintained during insertion and analyzed before publication.

The first official import requires at least 100,000 Albums and Artists each. Once a feed is established, the latest published generation is the baseline, even after rollback. A candidate must have a newer source timestamp, a nondecreasing replication sequence and at least 90% of each baseline entity count. If there is a count drop, compare the pinned verified candidate and baseline independently in an isolated production-shaped database. Check upstream release notes and compare the affected entity types, source files and sample lookups. After review, repeat validation and then explicitly publish with the exact count review value on both commands. Use the candidate counts reported by the CLI.

```sh
CATALOG_REVIEWED_COUNT_DROP='YYYYMMDD-HHMMSS:ALBUM_COUNT:ARTIST_COUNT' \
  npm run catalog:snapshot -- validate --official YYYYMMDD-HHMMSS
CATALOG_REVIEWED_COUNT_DROP='YYYYMMDD-HHMMSS:ALBUM_COUNT:ARTIST_COUNT' \
  npm run catalog:snapshot -- publish GENERATION
```

The audit records the exact reviewed version and counts. The production floor, source ordering, integrity and signature checks still apply.

## Status and recovery

`status` reports the active generation, version, source timestamp, counts, activation time, age in seconds and whether it exceeds seven days. It also reports the latest attempt and latest recorded failure. An attempt with no finish time may still be running or may have been killed. The next operator command marks an abandoned run `interrupted`. Busy attempts fail immediately and are visible in runner logs. Monitor command exits and collect `status` on a separate cadence.

```sh
npm run catalog:snapshot -- rollback
npm run catalog:snapshot -- status
```

Rollback switches active and previous atomically and leaves the latest-publication baseline in place. A second explicit rollback switches back. After either operation, check active version and age, smoke search both kinds when the local read path is available, and verify a retained Journal entry. Keep prior generations through rollout. For storage reclamation, use a maintenance window with operators and app readers drained. The migration owner can delete unused rows from `catalog.snapshot`, which cascades to that generation's projection. Keep every generation referenced by `catalog.state`, including `latest_generation`. The CLI does no automatic deletion.

Before setting a production schedule, record a full import in an isolated production-shaped environment. Measure wall-clock duration, peak runner scratch and Postgres temporary space, the Catalog relations and indexes before and after the build, peak WAL, and app query latency during refresh. Record source version, Postgres configuration and hardware with the results. Use the [search benchmark and rollout runbook](catalog-benchmark.md) for the release gates.

## SQL contract for local Catalog consumers

- Read `catalog.state.active_generation` once per Catalog request or use a single statement joining it. Carry that generation through every lookup or search, even on different SQL statements. A null active generation means the index is unavailable.
- For membership writes, use a **READ COMMITTED** transaction. Acquire `SELECT pg_advisory_xact_lock_shared(21421, 1)` before the first Catalog state read, then read the generation on a new statement and hold the lock through commit. Publication and rollback take the matching exclusive transaction lock as the first operation of the cutover. If another request owns the lock, a publisher waits up to 15 seconds. Ordinary reads can pin the last published generation without this lock. The operator holds separate session lock `(21421, 0)` for download, COPY, validation and publication.
- `catalog.album (generation, mbid)` stores only primary Album release groups, with `title`, exact display `credited_artist`, nullable `release_year/month/day`, `secondary_types` and `website_default`. The latter follows MusicBrainz's materialized discography policy, which includes official, withdrawn or status-less releases. Earliest dates use both release event tables, exclude cancelled releases and order year/month/day nulls last. Compare UTC cutoff and filter out compilations separately for Discover.
- `catalog.artist (generation, mbid)` has `name`, nullable `disambiguation` and `artist_type`. `catalog.album_credit (generation, album_mbid, position)` has `artist_mbid`, credited `name` and `join_phrase`. The reverse index starts with `(generation, artist_mbid, album_mbid)`.
- `catalog.album_redirect` and `catalog.artist_redirect` map `(generation, old_mbid)` directly to a canonical `mbid` and index the target for equivalent-ID membership checks. The native MusicBrainz merge process retargets prior redirects to the final integer entity ID. Imports verify destination and origin in each entity type, and omit Album redirects whose destination is no longer primary Album. [Native redirect handling](https://github.com/metabrainz/musicbrainz-server/blob/master/lib/MusicBrainz/Server/Data/Role/GIDRedirect.pm)
- `catalog.album_term` and `catalog.artist_term` expose `generation, mbid, source, term, match_key, compact_key`. Use `catalog.normalize_term($1)` on query input to share the same Unicode compatibility normalization, case/diacritic folding and punctuation/word-boundary treatment. Compact keys remove spaces for punctuation-insensitive candidates. Display strings live in the entity rows and unmodified terms are available for ranking. Artist sources are `canonical`, `alias`, and `credit`. Album sources are `canonical`, `alias`, `credit`, `title_credit`, `credit_title`, `alias_credit`, and `credit_alias`. Entity/term indexes support lookup by MBID, generation-scoped exact and escaped prefix queries on either key, and GiST nearest-neighbor candidates using `ORDER BY match_key <-> $normalized LIMIT $candidate_cap`. Use bounded candidates and a request timeout. Credit membership and type, year, exact credit and listener filters can be checked against pinned entity rows. Require title evidence for title-plus-credit queries and rank before applying the final result cap.

## Fixtures and importer test

`npm run test:catalog-import` runs the single CLI integration scenario against a disposable local Postgres 17 database. The two [native dump fixtures](../tests/fixtures/catalog) are unpacked core COPY files with the same metadata and schema sequence as an official dump. The CLI also accepts these files packed as `tar.bz2`. Fixture imports use an explicit `CATALOG_ALLOW_FIXTURES=1` guard and a database name ending in `_test`, `_preview` or `_fixture`. The fixture limit is 64 MiB, and a database whose feed has been published cannot switch between fixture and official data.

For browser tests, run the CLI against the isolated browser database created by `scripts/test-browser.sh` using that run's `DATABASE_URL`. Call it at the relevant test seam after migrations and keep the database on a single fixture feed for the scenario.

```sh
export CATALOG_DATABASE_URL="$DATABASE_URL"
export CATALOG_ALLOW_FIXTURES=1
npm run catalog:snapshot -- import --fixture tests/fixtures/catalog/v1
npm run catalog:snapshot -- import --fixture tests/fixtures/catalog/v2
```

- V1 contains the provider stub's namesakes, related Artists and Discover groups, plus Miles Davis's `Kind of Blue`, an alternate same-title Album, Japanese text and aliases, partial and unknown dates, a compilation and a promotional Album.
- V2 keeps the original rows except for the MBIDs of the first `Shared title` Album and the first `Shared artist`. The old Album MBID `11111111-1111-4111-8111-111111111111` resolves to `00000000-0000-0000-0000-0000000000c9`. The old Artist MBID `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` resolves to `00000000-0000-0000-0000-000000000065`. The second Album and Artist with those display names remain distinct. Republish the newer fixture by explicit rollback after reverting to V1, or start a fresh isolated database for another release sequence.
