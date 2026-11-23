import { sql } from "drizzle-orm";
import {
  boolean, check, foreignKey, index, integer, pgSchema, primaryKey, smallint, text,
  timestamp, unique, uuid,
} from "drizzle-orm/pg-core";

export const catalog = pgSchema("catalog");
const time = (name: string) => timestamp(name, { withTimezone: true });

export const snapshot = catalog.table("snapshot", {
  generation: integer().primaryKey().generatedAlwaysAsIdentity(),
  version: text().notNull().unique(),
  sourceTimestamp: time("source_timestamp").notNull(),
  schemaSequence: integer("schema_sequence").notNull(),
  replicationSequence: integer("replication_sequence").notNull(),
  fixture: boolean().notNull(),
  validatedAt: time("validated_at").defaultNow().notNull(),
  activatedAt: time("activated_at"),
  albumCount: integer("album_count").notNull(),
  artistCount: integer("artist_count").notNull(),
  creditCount: integer("credit_count").notNull(),
  redirectCount: integer("redirect_count").notNull(),
  termCount: integer("term_count").notNull(),
}, (table) => [unique("snapshot_source_order").on(table.fixture, table.sourceTimestamp)]);

export const catalogState = catalog.table("state", {
  singleton: boolean().primaryKey().default(true),
  activeGeneration: integer("active_generation").references(() => snapshot.generation),
  previousGeneration: integer("previous_generation").references(() => snapshot.generation),
  latestGeneration: integer("latest_generation").references(() => snapshot.generation),
}, (table) => [check("catalog_state_singleton", sql`${table.singleton}`)]);

export const catalogImportRun = catalog.table("import_run", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  operation: text().notNull(),
  source: text(),
  generation: integer().references(() => snapshot.generation, { onDelete: "set null" }),
  startedAt: time("started_at").defaultNow().notNull(),
  finishedAt: time("finished_at"),
  errorCategory: text("error_category"),
  countReview: text("count_review"),
}, (table) => [
  index("import_run_error_idx").on(table.id.desc()).where(sql`${table.errorCategory} IS NOT NULL`),
]);

const generation = () => integer().notNull().references(() => snapshot.generation, { onDelete: "cascade" });

export const catalogArtist = catalog.table("artist", {
  generation: generation(),
  mbid: uuid().notNull(),
  name: text().notNull(),
  disambiguation: text(),
  artistType: text("artist_type"),
}, (table) => [primaryKey({ columns: [table.generation, table.mbid] })]);

export const catalogAlbum = catalog.table("album", {
  generation: generation(),
  mbid: uuid().notNull(),
  title: text().notNull(),
  creditedArtist: text("credited_artist").notNull(),
  releaseYear: smallint("release_year"),
  releaseMonth: smallint("release_month"),
  releaseDay: smallint("release_day"),
  secondaryTypes: text("secondary_types").array().notNull(),
  websiteDefault: boolean("website_default").notNull(),
}, (table) => [
  primaryKey({ columns: [table.generation, table.mbid] }),
  check("album_release_date_bounds", sql`
    ${table.releaseYear} BETWEEN 1 AND 9999
    AND ${table.releaseMonth} BETWEEN 1 AND 12
    AND ${table.releaseDay} BETWEEN 1 AND 31`),
  index("catalog_album_release_idx").on(table.generation, table.releaseYear, table.releaseMonth, table.releaseDay, table.mbid),
]);

export const albumCredit = catalog.table("album_credit", {
  generation: integer().notNull(),
  albumMbid: uuid("album_mbid").notNull(),
  position: smallint().notNull(),
  artistMbid: uuid("artist_mbid").notNull(),
  name: text().notNull(),
  joinPhrase: text("join_phrase").notNull(),
}, (table) => [
  primaryKey({ columns: [table.generation, table.albumMbid, table.position] }),
  foreignKey({
    columns: [table.generation, table.albumMbid],
    foreignColumns: [catalogAlbum.generation, catalogAlbum.mbid],
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.generation, table.artistMbid],
    foreignColumns: [catalogArtist.generation, catalogArtist.mbid],
  }).onDelete("cascade"),
  index("catalog_credit_artist_idx").on(table.generation, table.artistMbid, table.albumMbid),
]);

function redirect(tableName: "album_redirect" | "artist_redirect", target: typeof catalogAlbum | typeof catalogArtist) {
  return catalog.table(tableName, {
    generation: integer().notNull(),
    oldMbid: uuid("old_mbid").notNull(),
    mbid: uuid().notNull(),
  }, (table) => [
    primaryKey({ columns: [table.generation, table.oldMbid] }),
    foreignKey({
      columns: [table.generation, table.mbid], foreignColumns: [target.generation, target.mbid],
    }).onDelete("cascade"),
    check(`catalog_${tableName}_distinct`, sql`${table.oldMbid} <> ${table.mbid}`),
    index(`catalog_${tableName}_target_idx`).on(table.generation, table.mbid),
  ]);
}

export const albumRedirect = redirect("album_redirect", catalogAlbum);
export const artistRedirect = redirect("artist_redirect", catalogArtist);

function searchTerms(tableName: "album_term" | "artist_term", target: typeof catalogAlbum | typeof catalogArtist) {
  return catalog.table(tableName, {
    generation: integer().notNull(),
    mbid: uuid().notNull(),
    source: text().notNull(),
    term: text().notNull(),
    matchKey: text("match_key").notNull(),
    compactKey: text("compact_key").notNull(),
  }, (table) => [
    foreignKey({
      columns: [table.generation, table.mbid], foreignColumns: [target.generation, target.mbid],
    }).onDelete("cascade"),
    index(`catalog_${tableName}_entity_idx`).on(table.generation, table.mbid, table.source),
    index(`catalog_${tableName}_prefix_idx`).on(table.generation, table.matchKey.op("text_pattern_ops")),
    index(`catalog_${tableName}_compact_idx`).on(table.generation, table.compactKey.op("text_pattern_ops")),
    index(`catalog_${tableName}_fuzzy_idx`).using("gist", table.generation.op("gist_int4_ops"), table.matchKey.op("gist_trgm_ops")),
  ]);
}

export const albumTerm = searchTerms("album_term", catalogAlbum);
export const artistTerm = searchTerms("artist_term", catalogArtist);
