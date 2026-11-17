import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text().primaryKey(),
  token: text().notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text().primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text(),
  password: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("account_user_id_idx").on(table.userId)]);

export const verification = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const album = pgTable("album", {
  id: text().primaryKey(),
  title: text().notNull(),
  creditedArtist: text("credited_artist").notNull(),
  originalYear: integer("original_year"),
  coverReference: text("cover_reference"),
});

export const wantToListen = pgTable("want_to_listen", {
  listenerId: text("listener_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  albumId: text("album_id").notNull().references(() => album.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.listenerId, table.albumId] })]);

export const catalogCache = pgTable("catalog_cache", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const listen = pgTable("listen", {
  listenerId: text("listener_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  submissionKey: text("submission_key").notNull(),
  albumId: text("album_id").notNull().references(() => album.id),
  listenDate: date("listen_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.listenerId, table.submissionKey] }),
  index("listen_listener_date_idx").on(table.listenerId, table.listenDate),
]);

export const providerLimit = pgTable("provider_limit", {
  provider: text().primaryKey(),
  nextRequestAt: timestamp("next_request_at", { withTimezone: true }).notNull(),
});

export const artist = pgTable("artist", {
  id: text().primaryKey(),
  name: text().notNull(),
  disambiguation: text(),
});

export const savedArtist = pgTable("saved_artist", {
  listenerId: text("listener_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  artistId: text("artist_id").notNull().references(() => artist.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.listenerId, table.artistId] })]);
