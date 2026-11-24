import "server-only";
import { maxSearchLength, minSuggestionLength, type AlbumFilters } from "./catalog-search";
import { usesLocalCatalog } from "./catalog-identity";
import { localReleasedAlbums, lookupLocal, searchLocal } from "./local-catalog";
import { isListenDate } from "./listen-date";
import { CatalogError, requestProvider, type Failure } from "./provider";
import { album, artist } from "./schema";

export { CatalogError } from "./provider";
export { usesLocalCatalog } from "./catalog-identity";
export type Album = typeof album.$inferSelect;
export type Artist = typeof artist.$inferSelect;

export const catalogMessages: Record<Failure, string> = {
  timeout: "The catalog took too long to respond. Please try again.",
  "rate-limit": "The catalog is busy. Please wait a moment and try again.",
  upstream: "The catalog is temporarily unavailable. Please try again.",
  missing: "This album could not be found in the catalog.",
};
export const isAlbumId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function parseAlbum(value: unknown): Album | null {
  if (!value || typeof value !== "object") return null;
  const group = value as Record<string, unknown>;
  if (group["primary-type"] !== "Album" || typeof group.id !== "string" || !isAlbumId(group.id) || typeof group.title !== "string" || !group.title.trim()) return null;
  const credit = group["artist-credit"];
  const creditedArtist = Array.isArray(credit) ? credit.map((part) => {
    if (!part || typeof part !== "object") return "";
    return (typeof part.name === "string" ? part.name : typeof part.artist?.name === "string" ? part.artist.name : "") + (typeof part.joinphrase === "string" ? part.joinphrase : "");
  }).join("").trim() : "";
  const date = group["first-release-date"];
  return { id: group.id.toLowerCase(), title: group.title, creditedArtist: creditedArtist || "Unknown artist", originalYear: typeof date === "string" && /^\d{4}(?:-|$)/.test(date) ? Number(date.slice(0, 4)) : null, coverReference: null };
}

function parseArtist(value: unknown): Artist | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !isAlbumId(item.id) || typeof item.name !== "string" || !item.name.trim()) return null;
  return { id: item.id.toLowerCase(), name: item.name, disambiguation: typeof item.disambiguation === "string" && item.disambiguation.trim() ? item.disambiguation : null };
}

async function request<T extends { id: string }>(operation: string, path: string, collection: "release-groups" | "artists" | null, parse: (value: unknown) => T | null): Promise<T[]> {
  const start = performance.now();
  let outcome = "ok";
  try {
    const rows = await requestProvider("musicbrainz", path, collection ? 900 : 86400, (data) => {
      const entries = collection && data && typeof data === "object" && collection in data
        ? (data as Record<string, unknown>)[collection]
        : collection ? null : [data];
      if (!Array.isArray(entries)) throw new CatalogError("upstream");
      const items = entries.map(parse).filter((item): item is T => item !== null);
      if (!collection && !items.length) throw new CatalogError("missing");
      return [...new Map(items.map((item) => [item.id, item])).values()].slice(0, 20);
    });
    if (!rows.length) outcome = "empty";
    return rows;
  } catch (error) {
    outcome = error instanceof CatalogError ? error.kind : "db-error";
    throw error;
  } finally {
    console.info("Catalog read", { source: "remote", operation, outcome, elapsedMs: Math.round(performance.now() - start) });
  }
}

function parseReleasedAlbum(value: unknown) {
  const album = parseAlbum(value);
  if (!album) return null;
  const group = value as Record<string, unknown>;
  const date = group["first-release-date"];
  const secondaryTypes = group["secondary-types"];
  if (Array.isArray(secondaryTypes) && secondaryTypes.includes("Compilation")) return null;
  if (typeof date !== "string" || !/^\d{4}(?:-\d{2}){0,2}$/.test(date)) return null;
  const releaseDate = `${date}-01-01`.slice(0, 10);
  if (!isListenDate(releaseDate, "9999-12-31")) return null;
  return { ...album, releaseDate };
}

/** Local results are released, non-compilation Albums credited to the Artist, in input popularity order. */
export function rankedAlbums(artistId: string, ids: string[], generation?: number | null) {
  if (usesLocalCatalog()) {
    if (!isAlbumId(artistId)) throw new CatalogError("missing");
    return localReleasedAlbums(artistId, generation, ids.filter(isAlbumId));
  }
  const query = `arid:${artistId} AND rgid:(${ids.join(" OR ")}) AND primarytype:album`;
  const params = new URLSearchParams({ query, fmt: "json", limit: String(ids.length) });
  return request("ranked-albums", `release-group/?${params}`, "release-groups", parseReleasedAlbum);
}

/** Local results apply the same eligibility and website-default policy, newest first, before listener exclusions. */
export function artistDiscography(artistId: string, generation?: number | null) {
  if (usesLocalCatalog()) {
    if (!isAlbumId(artistId)) throw new CatalogError("missing");
    return localReleasedAlbums(artistId, generation);
  }
  const params = new URLSearchParams({
    artist: artistId, type: "album", "release-group-status": "website-default",
    inc: "artist-credits", fmt: "json", limit: "12",
  });
  // shortcut: browse one small page, paginate if listeners frequently run out of suggestions.
  return request("artist-discography", `release-group?${params}`, "release-groups", parseReleasedAlbum);
}

export async function searchAlbums(title: string, filters?: AlbumFilters) {
  return (await searchAlbumResults(title, filters)).matches;
}

export async function searchAlbumResults(title: string, filters: AlbumFilters = {}) {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maxSearchLength) return { matches: [], artists: [], years: [] };
  if (usesLocalCatalog()) {
    if (normalized.length < minSuggestionLength) return { matches: [], artists: [], years: [] };
    return searchLocal("album", normalized, filters);
  }
  const escaped = normalized.replace(/[+\-!(){}\[\]^"~*?:\\/&|]/g, "\\$&");
  const albums = await request("search-album", `release-group/?${new URLSearchParams({ query: `releasegroup:"${escaped}" AND primarytype:album`, fmt: "json", limit: "20" })}`, "release-groups", parseAlbum);
  return {
    matches: albums.filter((album) => (!filters.artist || album.creditedArtist === filters.artist)
      && (!filters.year || String(album.originalYear) === filters.year)),
    artists: [...new Set(albums.map((album) => album.creditedArtist))].sort(),
    years: [...new Set(albums.flatMap((album) => album.originalYear == null ? [] : [album.originalYear]))]
      .sort((a, b) => b - a).map(String),
  };
}

export async function fetchRemoteAlbum(id: string): Promise<Album> {
  const [found] = await request("find-album", `release-group/${id}?inc=artist-credits&fmt=json`, null, parseAlbum);
  if (!found || found.id !== id) throw new CatalogError("missing");
  return found;
}

export async function searchArtists(name: string, generation?: number | null) {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maxSearchLength) return [];
  if (usesLocalCatalog()) {
    if (normalized.length < minSuggestionLength) return [];
    return (await searchLocal("artist", normalized, { generation })).matches;
  }
  const escaped = normalized.replace(/[+\-!(){}\[\]^"~*?:\\/&|]/g, "\\$&");
  return request("search-artist", `artist/?${new URLSearchParams({ query: `artist:"${escaped}"`, fmt: "json", limit: "20" })}`, "artists", parseArtist);
}

export async function fetchRemoteArtist(id: string): Promise<Artist> {
  const [found] = await request("find-artist", `artist/${id}?fmt=json`, null, parseArtist);
  if (!found || found.id !== id) throw new CatalogError("missing");
  return found;
}

/** Resolve ordered Artist candidates using only the pinned local Catalog. */
export function findCatalogArtists(ids: string[], generation: number) {
  return lookupLocal("artist", ids.filter(isAlbumId), generation);
}
