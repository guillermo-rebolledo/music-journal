import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { artistDiscography, findCatalogArtists, isAlbumId, rankedAlbums, usesLocalCatalog, type Album, type Artist } from "./catalog";
import { catalogAliasGroups, catalogCanonicalIds, type CatalogGeneration } from "./catalog-identity";
import { db } from "./db";
import { todayUTC } from "./listen-date";
import { CatalogError, requestProvider } from "./provider";
import { listen, wantToListen } from "./schema";

const relatedLimit = 3;

export async function relatedArtists(seedId: string, generation: CatalogGeneration): Promise<Artist[]> {
  const local = usesLocalCatalog();
  if (local && generation === null) throw new CatalogError("upstream");
  const hasSnapshot = generation !== null;
  // Allow spare Radio candidates for aliases, duplicates and Artists missing from the snapshot.
  const params = new URLSearchParams({
    mode: "easy", max_similar_artists: String(hasSnapshot ? relatedLimit * 2 : relatedLimit), max_recordings_per_artist: "1", pop_begin: "0", pop_end: "100",
  });
  const candidates = await requestProvider("listenbrainz", `1/lb-radio/artist/${seedId}?${params}`, 86400, (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new CatalogError("upstream");
    const related = new Map<string, Artist>();
    for (const [key, recordings] of Object.entries(data)) {
      const id = key.toLowerCase();
      if (!isAlbumId(id) || !Array.isArray(recordings)) throw new CatalogError("upstream");
      if (id === seedId || related.has(id)) continue;
      const name = recordings[0]?.similar_artist_name;
      if (!local && (typeof name !== "string" || !name.trim())) continue;
      related.set(id, { id, name: typeof name === "string" ? name : "", disambiguation: null });
      if (!hasSnapshot && related.size === relatedLimit) break;
    }
    return [...related.values()];
  });
  if (generation === null || !candidates.length) return candidates;

  const ids = candidates.map(({ id }) => id);
  const canonical = local ? undefined : await catalogCanonicalIds("artist", generation, ids);
  const artists = canonical
    ? candidates.map((artist) => ({ ...artist, id: canonical.get(artist.id) ?? artist.id }))
    : await findCatalogArtists(ids, generation);
  const related = new Map<string, Artist>();
  for (const artist of artists) {
    if (artist.id !== seedId && !related.has(artist.id)) related.set(artist.id, artist);
    if (related.size === relatedLimit) break;
  }
  return [...related.values()];
}

async function topReleaseGroups(artistId: string) {
  return requestProvider("listenbrainz", `1/popularity/top-release-groups-for-artist/${artistId}`, 86400, (data) => {
    if (!Array.isArray(data)) throw new CatalogError("upstream");
    const ids = data.map((item) => item?.release_group_mbid)
      .filter((id): id is string => typeof id === "string" && isAlbumId(id))
      .map((id) => id.toLowerCase());
    return [...new Set(ids)];
  });
}

export async function untriedAlbums<T extends Album>(candidates: T[], listenerId: string, generation: CatalogGeneration) {
  if (!candidates.length) return [];
  const groups = await catalogAliasGroups("album", generation, candidates.map(({ id }) => id));
  const canonical = new Map([...groups.values()].flatMap(({ id, ids }) => ids.map((alias) => [alias, id] as const)));
  const ids = sql.param([...canonical.keys()]);
  const rows = await db.select({ id: wantToListen.albumId }).from(wantToListen)
    .where(and(eq(wantToListen.listenerId, listenerId), sql`${wantToListen.albumId} = ANY(${ids}::text[])`))
    .union(db.select({ id: listen.albumId }).from(listen)
      .where(and(eq(listen.listenerId, listenerId), sql`${listen.albumId} = ANY(${ids}::text[])`)));
  const excluded = new Set(rows.map(({ id }) => canonical.get(id)));
  const untried = new Map<string, T>();
  for (const candidate of candidates) {
    const id = canonical.get(candidate.id) ?? candidate.id;
    // Handpicked links keep their stored IDs so they can open during a Catalog outage.
    if (!excluded.has(id) && !untried.has(id)) untried.set(id, candidate);
  }
  return [...untried.values()];
}

async function popularAlbums(artistId: string, generation: CatalogGeneration) {
  try {
    const ids = await topReleaseGroups(artistId);
    if (!ids.length) return [];
    if (usesLocalCatalog()) return await rankedAlbums(artistId, ids, generation);

    // shortcut: remote mode checks eight groups to keep the upstream query short.
    const remoteIds = ids.slice(0, 8);
    const groups = await rankedAlbums(artistId, remoteIds, generation);
    const canonical = await catalogCanonicalIds("album", generation, [...remoteIds, ...groups.map(({ id }) => id)]);
    const byId = new Map(groups.map((album) => [canonical.get(album.id) ?? album.id, album]));
    return remoteIds.flatMap((id) => byId.get(canonical.get(id) ?? id) ?? []);
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    return [];
  }
}

export async function suggestedAlbum(artistId: string, listenerId: string, generation: CatalogGeneration) {
  const popular = await popularAlbums(artistId, generation);
  const discography = async () => {
    try {
      return await artistDiscography(artistId, generation);
    } catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      return [];
    }
  };
  if (!usesLocalCatalog()) {
    // Keep remote requests independent of the listener's Journal.
    const candidates = [...popular, ...await discography()];
    const today = todayUTC();
    return (await untriedAlbums(candidates.filter(({ releaseDate }) => releaseDate <= today), listenerId, generation))[0];
  }
  const [suggestion] = await untriedAlbums(popular, listenerId, generation);
  return suggestion ?? (await untriedAlbums(await discography(), listenerId, generation))[0];
}
