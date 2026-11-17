import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { isListenDate } from "./listen-date";
import { CatalogError, requestProvider, type Failure } from "./provider";
import { album, artist } from "./schema";

export { CatalogError } from "./provider";
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

function request<T extends { id: string }>(path: string, collection: "release-groups" | "artists" | null, parse: (value: unknown) => T | null): Promise<T[]> {
  return requestProvider("musicbrainz", path, collection ? 900 : 86400, (data) => {
    const entries = collection && data && typeof data === "object" && collection in data
      ? (data as Record<string, unknown>)[collection]
      : collection ? null : [data];
    if (!Array.isArray(entries)) throw new CatalogError("upstream");
    const items = entries.map(parse).filter((item): item is T => item !== null);
    if (!collection && !items.length) throw new CatalogError("missing");
    return [...new Map(items.map((item) => [item.id, item])).values()].slice(0, 20);
  });
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

export function rankedAlbums(artistId: string, ids: string[]) {
  const query = `arid:${artistId} AND rgid:(${ids.join(" OR ")}) AND primarytype:album`;
  const params = new URLSearchParams({ query, fmt: "json", limit: String(ids.length) });
  return request(`release-group/?${params}`, "release-groups", parseReleasedAlbum);
}

export function artistDiscography(artistId: string) {
  const params = new URLSearchParams({
    artist: artistId, type: "album", "release-group-status": "website-default",
    inc: "artist-credits", fmt: "json", limit: "12",
  });
  // shortcut: browse one small page, paginate if listeners frequently run out of suggestions.
  return request(`release-group?${params}`, "release-groups", parseReleasedAlbum);
}

export async function searchAlbums(title: string) {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 200) return [];
  const escaped = normalized.replace(/[+\-!(){}\[\]^"~*?:\\/&|]/g, "\\$&");
  return request(`release-group/?${new URLSearchParams({ query: `releasegroup:"${escaped}" AND primarytype:album`, fmt: "json", limit: "20" })}`, "release-groups", parseAlbum);
}

export async function findAlbum(id: string): Promise<Album> {
  if (!isAlbumId(id)) throw new CatalogError("missing");
  id = id.toLowerCase();
  const [local] = await db.select().from(album).where(eq(album.id, id));
  if (local) return local;
  const [found] = await request(`release-group/${id}?inc=artist-credits&fmt=json`, null, parseAlbum);
  if (!found || found.id !== id) throw new CatalogError("missing");
  return found;
}

export async function searchArtists(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 200) return [];
  const escaped = normalized.replace(/[+\-!(){}\[\]^"~*?:\\/&|]/g, "\\$&");
  return request(`artist/?${new URLSearchParams({ query: `artist:"${escaped}"`, fmt: "json", limit: "20" })}`, "artists", parseArtist);
}

export async function findArtist(id: string): Promise<Artist> {
  if (!isAlbumId(id)) throw new CatalogError("missing");
  id = id.toLowerCase();
  const [local] = await db.select().from(artist).where(eq(artist.id, id));
  if (local) return local;
  const [found] = await request(`artist/${id}?fmt=json`, null, parseArtist);
  if (!found || found.id !== id) throw new CatalogError("missing");
  return found;
}
