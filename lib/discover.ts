import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { artistDiscography, isAlbumId, rankedAlbums, type Artist } from "./catalog";
import { db } from "./db";
import { todayUTC } from "./listen-date";
import { CatalogError, requestProvider } from "./provider";
import { listen, wantToListen } from "./schema";

export async function relatedArtists(seedId: string): Promise<Artist[]> {
  const params = new URLSearchParams({
    mode: "easy", max_similar_artists: "3", max_recordings_per_artist: "1", pop_begin: "0", pop_end: "100",
  });
  return requestProvider("listenbrainz", `1/lb-radio/artist/${seedId}?${params}`, 86400, (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new CatalogError("upstream");
    const related = new Map<string, Artist>();
    for (const [key, recordings] of Object.entries(data)) {
      const id = key.toLowerCase();
      if (!isAlbumId(id) || !Array.isArray(recordings)) throw new CatalogError("upstream");
      if (id === seedId || related.has(id)) continue;
      const name = recordings[0]?.similar_artist_name;
      if (typeof name !== "string" || !name.trim()) continue;
      related.set(id, { id, name, disambiguation: null });
      if (related.size === 3) break;
    }
    return [...related.values()];
  });
}

async function topReleaseGroups(artistId: string) {
  return requestProvider("listenbrainz", `1/popularity/top-release-groups-for-artist/${artistId}`, 86400, (data) => {
    if (!Array.isArray(data)) throw new CatalogError("upstream");
    const ids = data.map((item) => item?.release_group_mbid)
      .filter((id): id is string => typeof id === "string" && isAlbumId(id))
      .map((id) => id.toLowerCase());
    // shortcut: validate the top eight groups in one query, expand if the fallback is too frequent.
    return [...new Set(ids)].slice(0, 8);
  });
}

async function firstUntried(candidates: Awaited<ReturnType<typeof artistDiscography>>, listenerId: string) {
  const today = todayUTC();
  const released = candidates.filter(({ releaseDate }) => releaseDate <= today);
  if (!released.length) return;
  const ids = released.map(({ id }) => id);
  const rows = await db.select({ id: wantToListen.albumId }).from(wantToListen)
    .where(and(eq(wantToListen.listenerId, listenerId), inArray(wantToListen.albumId, ids)))
    .union(db.select({ id: listen.albumId }).from(listen)
      .where(and(eq(listen.listenerId, listenerId), inArray(listen.albumId, ids))));
  const excluded = new Set(rows.map(({ id }) => id));
  return released.find(({ id }) => !excluded.has(id));
}

async function popularAlbums(artistId: string) {
  try {
    const rankedIds = await topReleaseGroups(artistId);
    if (!rankedIds.length) return [];
    const groups = await rankedAlbums(artistId, rankedIds);
    const byId = new Map(groups.map((album) => [album.id, album]));
    return rankedIds.flatMap((id) => byId.get(id) ?? []);
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    return [];
  }
}

export async function suggestedAlbum(artistId: string, listenerId: string) {
  const popular = await popularAlbums(artistId);
  // Resolve the public fallback before filtering against the listener's journal.
  let discography: Awaited<ReturnType<typeof artistDiscography>> = [];
  try {
    discography = await artistDiscography(artistId);
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
  }
  return firstUntried([...popular, ...discography], listenerId);
}
