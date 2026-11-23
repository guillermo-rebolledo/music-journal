import "server-only";
import type { PoolClient } from "pg";
import type { Album, Artist } from "./catalog";
import type { AlbumFilters, SearchKind } from "./catalog-search";
import { pool } from "./db";
import { todayUTC } from "./listen-date";
import { CatalogError } from "./provider";

const minimumSimilarity = 0.42;

export const usesLocalCatalog = () => process.env.CATALOG_SOURCE === "local";

async function readSnapshot(client: PoolClient) {
  const { rows } = await client.query<{ generation: number; version: string; ageSeconds: number }>(`
    SELECT s.generation, s.version,
      extract(epoch FROM (now() - s.source_timestamp))::int AS "ageSeconds"
    FROM catalog.state c JOIN catalog.snapshot s ON s.generation = c.active_generation
    WHERE c.singleton
  `);
  return rows[0];
}

type ReadInfo = {
  generation?: number;
  version?: string;
  ageSeconds?: number;
  outcome: string;
};

async function read<T>(operation: string, run: (client: PoolClient, info: ReadInfo) => Promise<T>) {
  const start = performance.now();
  const info: ReadInfo = { outcome: "ok" };
  try {
    const client = await pool.connect();
    let destroy = false;
    try {
      await client.query(`
        BEGIN READ ONLY;
        SET LOCAL statement_timeout = '1500ms';
        SET LOCAL search_path = pg_catalog, public;
        SET LOCAL pg_trgm.similarity_threshold = '${minimumSimilarity}';
      `);
      const result = await run(client, info);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); }
      catch { destroy = true; }
      throw error;
    } finally {
      client.release(destroy);
    }
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    const timeout = (error as { code?: string }).code === "57014";
    info.outcome = timeout ? "db-timeout" : "db-error";
    throw new CatalogError(timeout ? "timeout" : "upstream");
  } finally {
    console.info("Catalog read", { source: "local", operation, ...info, elapsedMs: Math.round(performance.now() - start) });
  }
}

export function localCatalogGeneration() {
  return read("generation", async (client, info) => {
    const snapshot = await readSnapshot(client);
    if (!snapshot) info.outcome = "index-unavailable";
    Object.assign(info, snapshot);
    return snapshot?.generation ?? null;
  });
}

function inGeneration<T>(
  operation: string,
  generation: number | null | undefined,
  run: (client: PoolClient, generation: number) => Promise<T[]>,
  outcome: (rows: T[]) => string = (rows) => rows.length ? "ok" : "empty",
) {
  return read(operation, async (client, info) => {
    const snapshot = generation === undefined ? await readSnapshot(client) : undefined;
    const pinned = generation ?? snapshot?.generation;
    if (pinned == null) {
      info.outcome = "index-unavailable";
      throw new CatalogError("upstream");
    }
    Object.assign(info, snapshot, { generation: pinned });
    const rows = await run(client, pinned);
    info.outcome = outcome(rows);
    return rows;
  });
}

const albumFields = `a.mbid AS id, a.title, a.credited_artist AS "creditedArtist",
  a.release_year AS "originalYear", NULL::text AS "coverReference"`;
const artistFields = "a.mbid AS id, a.name, a.disambiguation";

function catalogFields(kind: SearchKind) {
  return kind === "album" ? albumFields : artistFields;
}

// All callers supply constant kinds and SQL expressions. IDs and generations are parameters.
function canonicalId(kind: SearchKind, id: string) {
  return `coalesce((SELECT mbid FROM catalog.${kind}_redirect
    WHERE generation = $1 AND old_mbid = ${id}), ${id})`;
}

export function lookupLocal(kind: "album", ids: string[], generation?: number | null): Promise<Album[]>;
export function lookupLocal(kind: "artist", ids: string[], generation?: number | null): Promise<Artist[]>;
export function lookupLocal(kind: SearchKind, ids: string[], generation?: number | null) {
  return inGeneration(`find-${kind}`, generation, async (client, pinned) =>
    (await client.query<Album | Artist>(`
      SELECT ${catalogFields(kind)}
      FROM unnest($2::uuid[]) WITH ORDINALITY input(id, position)
      JOIN catalog.${kind} a ON a.generation = $1 AND a.mbid = ${canonicalId(kind, "input.id")}
      ORDER BY input.position
    `, [pinned, ids])).rows, (rows) => rows.length ? "ok" : "missing");
}

type SearchRow<T> = { matches: T[]; artists: string[]; years: string[] };

export function searchLocal(kind: "album", q: string, filters: AlbumFilters): Promise<SearchRow<Album>>;
export function searchLocal(kind: "artist", q: string, options: { generation?: number | null }): Promise<SearchRow<Artist>>;
export async function searchLocal(kind: SearchKind, q: string, { artist, year, generation }: AlbumFilters & { generation?: number | null }) {
  const album = kind === "album";
  const terms = `catalog.${kind}_term`;
  // shortcut: common terms contribute a bounded sample per index branch. Tune
  // budgets against the labeled corpus if common prefixes lose useful matches.
  // Canonical exact matches lead, followed by other exact, compact, prefix,
  // all-token, and trigram matches. Re-score every candidate with the same tiers.
  const text = `
    WITH input AS MATERIALIZED (
      SELECT key, replace(key, ' ', '') AS compact, string_to_array(key, ' ') AS words
      FROM (SELECT catalog.normalize_term($2) AS key) q WHERE key <> ''
    ), anchors AS (
      SELECT i.key FROM input i
      UNION
      SELECT word FROM input i CROSS JOIN LATERAL (
        SELECT word FROM (SELECT DISTINCT word FROM unnest(i.words) AS word WHERE length(word) >= 3) distinct_words
        ORDER BY length(word) DESC, word LIMIT 6
      ) words
    ), candidates AS MATERIALIZED (
      SELECT mbid FROM input i CROSS JOIN LATERAL (
        SELECT t.mbid FROM ${terms} t WHERE t.generation = $1
          AND t.match_key OPERATOR(pg_catalog.~>=~) i.key AND t.match_key OPERATOR(pg_catalog.~<=~) i.key
        LIMIT 512
      ) exact
      UNION
      SELECT mbid FROM input i CROSS JOIN LATERAL (
        SELECT t.mbid FROM ${terms} t WHERE t.generation = $1 AND t.compact_key = i.compact LIMIT 256
      ) exact_compact
      UNION
      SELECT mbid FROM anchors p CROSS JOIN LATERAL (
        SELECT t.mbid FROM ${terms} t WHERE t.generation = $1
          AND t.match_key OPERATOR(pg_catalog.~>=~) p.key
          AND t.match_key OPERATOR(pg_catalog.~<~) (p.key || chr(1114111))
        LIMIT 128
      ) prefix
      UNION
      SELECT mbid FROM input i CROSS JOIN LATERAL (
        SELECT t.mbid FROM ${terms} t WHERE t.generation = $1
          AND t.compact_key OPERATOR(pg_catalog.~>=~) i.compact
          AND t.compact_key OPERATOR(pg_catalog.~<~) (i.compact || chr(1114111))
        LIMIT 128
      ) compact_prefix
      UNION
      SELECT mbid FROM (SELECT key FROM input WHERE length(key) >= 5) i CROSS JOIN LATERAL (
        SELECT t.mbid FROM ${terms} t WHERE t.generation = $1
          AND t.match_key OPERATOR(public.%) i.key
        ORDER BY t.match_key OPERATOR(public.<->) i.key LIMIT 128
      ) fuzzy
    ), scored AS (
      SELECT a.mbid, ${catalogFields(kind)}, best.tier, best.display_exact, best.strength
      FROM candidates c JOIN catalog.${kind} a ON a.generation = $1 AND a.mbid = c.mbid
      CROSS JOIN input i
      CROSS JOIN LATERAL (
        SELECT quality.tier, t.term = $2 AS display_exact, similarity(t.match_key, i.key) AS strength
        FROM ${terms} t
        ${album ? albumEvidence() : tokenEvidence("t.match_key")}
        CROSS JOIN LATERAL (SELECT CASE
          WHEN t.source = 'canonical' AND t.match_key = i.key THEN 0
          WHEN t.match_key = i.key AND evidence.has_title THEN 1
          WHEN t.compact_key = i.compact AND evidence.has_title THEN 2
          WHEN (starts_with(t.match_key, i.key) OR starts_with(t.compact_key, i.compact)) AND evidence.has_title THEN 3
          WHEN cardinality(i.words) > 1 AND evidence.has_title AND evidence.all_words THEN 4
          WHEN length(i.key) >= 5 AND similarity(t.match_key, i.key) >= ${minimumSimilarity}
            AND evidence.fuzzy_title THEN 5
        END AS tier OFFSET 0) quality
        WHERE t.generation = $1 AND t.mbid = c.mbid
          ${album ? "AND t.source <> 'credit'" : ""}
          AND quality.tier IS NOT NULL
        ORDER BY quality.tier, display_exact DESC, strength DESC
        LIMIT 1
      ) best
    ), matches AS (
      SELECT ${album ? `id, title, "creditedArtist", "originalYear", "coverReference"` : "id, name, disambiguation"}
      FROM scored
      ${album ? `WHERE ($3::text IS NULL OR "creditedArtist" = $3)
        AND ($4::text IS NULL OR "originalYear"::text = $4)` : ""}
      ORDER BY tier, display_exact DESC, strength DESC, ${album ? `title COLLATE "C", "originalYear" NULLS LAST, "creditedArtist" COLLATE "C"` : `name COLLATE "C", disambiguation COLLATE "C" NULLS LAST`}, mbid
      LIMIT 20
    )
    SELECT coalesce((SELECT json_agg(matches) FROM matches), '[]') AS matches,
      ${album ? `ARRAY(SELECT DISTINCT "creditedArtist" FROM scored ORDER BY "creditedArtist")` : "'{}'::text[]"} AS artists,
      ${album ? `ARRAY(SELECT year::text FROM (SELECT DISTINCT "originalYear" AS year FROM scored
        WHERE "originalYear" IS NOT NULL) years ORDER BY year DESC)` : "'{}'::text[]"} AS years
  `;
  const [result] = await inGeneration(`search-${kind}`, generation, async (client, pinned) => {
    const { rows } = await client.query<SearchRow<Album | Artist>>(text, album
      ? [pinned, q, artist ?? null, year ?? null]
      : [pinned, q]);
    return rows;
  }, ([row]) => row.matches.length ? "ok" : "empty");
  return result;
}

// Check every query token across a title spelling and its credit. The last
// token can be incomplete. Combined terms need evidence from the title itself.
function tokenEvidence(title: string) {
  return `CROSS JOIN LATERAL (
    SELECT
      EXISTS (SELECT FROM unnest(i.words) w JOIN unnest(string_to_array(${title}, ' ')) t
        ON w = t OR (length(w) >= 2 AND starts_with(t, w))) AS title_word,
      NOT EXISTS (SELECT FROM unnest(i.words) WITH ORDINALITY w(word, n)
        WHERE NOT EXISTS (SELECT FROM unnest(string_to_array(t.match_key, ' ')) t
          WHERE t = w.word OR (w.n = cardinality(i.words) AND length(w.word) >= 2 AND starts_with(t, w.word)))) AS all_words
  ) tokens
  CROSS JOIN LATERAL (SELECT
    (${title} = t.match_key OR tokens.title_word
      OR strpos(i.compact, replace(${title}, ' ', '')) > 0) AS has_title,
    (${title} = t.match_key OR tokens.title_word OR EXISTS (
      SELECT FROM unnest(i.words) w JOIN unnest(string_to_array(${title}, ' ')) t
        ON length(w) >= 4 AND similarity(w, t) >= 0.45)) AS fuzzy_title,
    tokens.all_words
    OFFSET 0
  ) evidence`;
}

function albumEvidence() {
  // Recover the title or title alias directly from the combined term's source
  // and its exact display credit. Normalize it using the same importer function.
  return `CROSS JOIN LATERAL (SELECT CASE t.source
    WHEN 'title_credit' THEN catalog.normalize_term(left(t.term, -(length(a.credited_artist) + 1)))
    WHEN 'alias_credit' THEN catalog.normalize_term(left(t.term, -(length(a.credited_artist) + 1)))
    WHEN 'credit_title' THEN catalog.normalize_term(substr(t.term, length(a.credited_artist) + 2))
    WHEN 'credit_alias' THEN catalog.normalize_term(substr(t.term, length(a.credited_artist) + 2))
    ELSE t.match_key
  END AS title_key) title
  ${tokenEvidence("title.title_key")}`;
}

export type ReleasedAlbum = Album & { releaseDate: string };

export function localReleasedAlbums(artistId: string, generation: number | null | undefined, ids?: string[]) {
  return inGeneration(ids ? "ranked-albums" : "artist-discography", generation, async (client, pinned) => {
    const { rows } = await client.query<ReleasedAlbum>(`
      ${ids ? `WITH ranked AS (
        SELECT ${canonicalId("album", "input.id")} AS mbid, min(position) AS position
        FROM unnest($4::uuid[]) WITH ORDINALITY input(id, position) GROUP BY 1
      )` : ""}
      SELECT ${albumFields}, to_char(released.date, 'YYYY-MM-DD') AS "releaseDate"
      FROM catalog.album a
      ${ids ? "JOIN ranked r ON r.mbid = a.mbid" : ""}
      CROSS JOIN LATERAL (SELECT make_date(a.release_year, coalesce(a.release_month, 1), 1)
        + (coalesce(a.release_day, 1) - 1) AS date) released
      WHERE a.generation = $1 AND a.release_year IS NOT NULL
        AND released.date <= $3::date AND NOT ('Compilation' = ANY(a.secondary_types))
        AND extract(month FROM released.date) = coalesce(a.release_month, 1)
        ${ids ? "" : "AND a.website_default"}
        AND EXISTS (SELECT FROM catalog.album_credit c WHERE c.generation = $1
          AND c.artist_mbid = ${canonicalId("artist", "$2::uuid")} AND c.album_mbid = a.mbid)
      ORDER BY ${ids ? "r.position" : "released.date DESC, a.mbid"}
    `, ids ? [pinned, artistId, todayUTC(), ids] : [pinned, artistId, todayUTC()]);
    return rows;
  });
}
