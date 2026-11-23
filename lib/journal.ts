import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { fetchRemoteAlbum, type Album, type Artist } from "./catalog";
import {
  catalogCanonicalIds, catalogSqlError, usesLocalCatalog, type CatalogAliasGroup, type CatalogGeneration, type CatalogTransaction,
} from "./catalog-identity";
import { catalogAlbum, catalogArtist } from "./catalog-schema";
import { db } from "./db";
import { CatalogError } from "./provider";
import { album, artist, listen, savedArtist, wantToListen } from "./schema";

export function albumMembership(listenerId: string, { ids }: CatalogAliasGroup) {
  return and(eq(wantToListen.listenerId, listenerId), inArray(wantToListen.albumId, ids));
}

export function artistMembership(listenerId: string, { ids }: CatalogAliasGroup) {
  return and(eq(savedArtist.listenerId, listenerId), inArray(savedArtist.artistId, ids));
}

export async function getSavedArtistIds(listenerId: string, generation: CatalogGeneration, candidates: string[]) {
  const rows = await db.select({ id: savedArtist.artistId }).from(savedArtist).where(eq(savedArtist.listenerId, listenerId));
  const ids = rows.map(({ id }) => id);
  const canonical = await catalogCanonicalIds("artist", generation, [...ids, ...candidates]);
  const saved = new Set(ids.map((id) => canonical.get(id) ?? id));
  return new Set(candidates.filter((id) => saved.has(canonical.get(id) ?? id)));
}

type JournalConnection = typeof db | CatalogTransaction;

async function resolveDetails<T extends { id: string }>(
  kind: "album" | "artist",
  generation: CatalogGeneration,
  group: CatalogAliasGroup,
  connection: JournalConnection,
  retained: T[],
  remote: (id: string) => T | Promise<T>,
  read: (connection: JournalConnection, generation: number) => PromiseLike<T[]>,
): Promise<T> {
  const canonical = retained.find(({ id }) => id === group.id);
  if (canonical) return canonical;
  const fallback = retained[0] && { ...retained[0], id: group.id };
  if (!usesLocalCatalog()) return fallback ?? remote(group.id);
  if (generation === null) throw new CatalogError("upstream");
  try {
    // If an alias supplies retained metadata, isolate a failing snapshot read before using it.
    const [fresh] = await (fallback ? connection.transaction(async (tx) => read(tx, generation)) : read(connection, generation));
    if (fresh) return fresh;
  } catch (error) {
    const unavailable = catalogSqlError(`find-${kind}`, error);
    if (!fallback) throw unavailable;
  }
  if (fallback) return fallback;
  throw new CatalogError("missing");
}

export async function resolveAlbum(
  generation: CatalogGeneration, group: CatalogAliasGroup, connection: JournalConnection = db,
  remote: (id: string) => Album | Promise<Album> = fetchRemoteAlbum,
): Promise<Album> {
  const retained = await connection.select().from(album).where(inArray(album.id, group.ids)).orderBy(album.id);
  return resolveDetails("album", generation, group, connection, retained, remote, (store, pinned) =>
    store.select({
      id: catalogAlbum.mbid, title: catalogAlbum.title,
      creditedArtist: catalogAlbum.creditedArtist, originalYear: catalogAlbum.releaseYear,
    }).from(catalogAlbum).where(and(eq(catalogAlbum.generation, pinned), eq(catalogAlbum.mbid, group.id)))
      .then((rows) => rows.map((details) => ({ ...details, coverReference: null }))));
}

export async function resolveArtist(
  generation: CatalogGeneration, group: CatalogAliasGroup, connection: CatalogTransaction,
  remote: (id: string) => Artist,
): Promise<Artist> {
  const retained = await connection.select().from(artist).where(inArray(artist.id, group.ids)).orderBy(artist.id);
  return resolveDetails("artist", generation, group, connection, retained, remote, (store, pinned) =>
    store.select({ id: catalogArtist.mbid, name: catalogArtist.name, disambiguation: catalogArtist.disambiguation })
      .from(catalogArtist).where(and(eq(catalogArtist.generation, pinned), eq(catalogArtist.mbid, group.id))));
}

export async function getAlbumJournal(listenerId: string, group: CatalogAliasGroup) {
  const [[saved], listens] = await Promise.all([
    db.select({ id: wantToListen.albumId }).from(wantToListen).where(albumMembership(listenerId, group)).limit(1),
    db.select().from(listen).where(and(eq(listen.listenerId, listenerId), inArray(listen.albumId, group.ids)))
      .orderBy(desc(listen.listenDate), desc(listen.createdAt), desc(listen.submissionKey)),
  ]);
  return { saved: !!saved, listens };
}

function membershipByIdentity<T extends { id: string }>(
  rows: { entity: T; addedAt: Date }[], canonical: ReadonlyMap<string, string>,
) {
  const earliest = new Map<string, (typeof rows)[number]>();
  for (const { entity, addedAt } of rows) {
    const id = canonical.get(entity.id) ?? entity.id;
    const existing = earliest.get(id);
    if (!existing || addedAt < existing.addedAt) earliest.set(id, { entity: { ...entity, id }, addedAt });
  }
  return [...earliest.values()].sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime() || a.entity.id.localeCompare(b.entity.id));
}

export async function getJournal(listenerId: string, generation: CatalogGeneration) {
  const [queue, listens, artists] = await Promise.all([
    db.select({ entity: album, addedAt: wantToListen.createdAt }).from(wantToListen)
      .innerJoin(album, eq(wantToListen.albumId, album.id)).where(eq(wantToListen.listenerId, listenerId)).orderBy(album.id),
    db.select({ album, listen }).from(listen).innerJoin(album, eq(listen.albumId, album.id))
      .where(eq(listen.listenerId, listenerId)).orderBy(desc(listen.listenDate), desc(listen.createdAt), desc(listen.submissionKey)).limit(50),
    db.select({ entity: artist, addedAt: savedArtist.createdAt }).from(savedArtist)
      .innerJoin(artist, eq(savedArtist.artistId, artist.id)).where(eq(savedArtist.listenerId, listenerId)).orderBy(artist.id),
  ]);
  const [albumIds, artistIds] = await Promise.all([
    catalogCanonicalIds("album", generation, [...queue.map(({ entity }) => entity.id), ...listens.map(({ album }) => album.id)]),
    catalogCanonicalIds("artist", generation, artists.map(({ entity }) => entity.id)),
  ]);
  return {
    queue: membershipByIdentity(queue, albumIds).map(({ entity, addedAt }) => ({ album: entity, addedAt })),
    listens: listens.map(({ album, listen }) => ({ album: { ...album, id: albumIds.get(album.id) ?? album.id }, listen })),
    artists: membershipByIdentity(artists, artistIds).map(({ entity }) => ({ artist: entity })),
  };
}
