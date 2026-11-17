import "server-only";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { album, artist } from "./schema";

export type Album = typeof album.$inferSelect;
export type Artist = typeof artist.$inferSelect;
type Failure = "timeout" | "rate-limit" | "upstream" | "missing";
type Result<T> = { items: T[]; error?: never } | { error: Failure; retryAfter?: number; items?: never };
export class CatalogError extends Error {
  constructor(public kind: Failure, public retryAfter = 5) { super(kind); }
}
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

async function request<T extends Album | Artist>(path: string, search: boolean, collection: string, parse: (value: unknown) => T | null): Promise<T[]> {
  // Version the cache shape so album entries from earlier deployments cannot be misread.
  const cacheKey = `v2:${path}`;
  if (pool.waitingCount >= 8) throw new CatalogError("rate-limit");
  const client = await pool.connect();
  let result: Result<T>;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    // One shared lock coalesces cache misses and limits provider concurrency across instances.
    await client.query("SELECT pg_advisory_xact_lock(731901)");
    const cached = await client.query("SELECT value FROM catalog_cache WHERE key = $1 AND expires_at > clock_timestamp()", [cacheKey]);
    if (cached.rowCount) {
      result = cached.rows[0].value as Result<T>;
    } else {
      const limit = await client.query("SELECT EXTRACT(EPOCH FROM (next_request_at - clock_timestamp())) * 1000 AS wait FROM provider_limit WHERE provider = 'musicbrainz'");
      const wait = Number(limit.rows[0]?.wait ?? 0);
      if (wait > 1100) {
        result = { error: "rate-limit", retryAfter: Math.ceil(wait / 1000) };
      } else {
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        let retryAfter = 1;
        try {
          const response = await fetch(`${process.env.MUSICBRAINZ_BASE_URL || "https://musicbrainz.org/ws/2"}/${path}`, {
            headers: { "User-Agent": "MusicJournal/0.1 (https://github.com/guillermo-rebolledo/music-journal)", Accept: "application/json" },
            signal: AbortSignal.timeout(4000), cache: "no-store", redirect: "error",
          });
          if (response.status === 429 || response.status === 503) {
            const retry = response.headers.get("retry-after");
            retryAfter = Math.max(5, retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) || 5 : 5);
            result = { error: "rate-limit", retryAfter };
            await response.body?.cancel();
          } else if (response.status === 404) {
            result = { error: "missing" };
            await response.body?.cancel();
          } else if (!response.ok) {
            result = { error: "upstream" };
            await response.body?.cancel();
          } else {
            const reader = response.body?.getReader();
            if (!reader) throw new Error("Missing response body");
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 1_000_000) { await reader.cancel(); throw new Error("Oversized catalog response"); }
              chunks.push(value);
            }
            const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (search && !Array.isArray(data[collection])) throw new Error("Invalid search response");
            const groups: unknown[] = search ? data[collection] : [data];
            const items = groups.map(parse).filter((item): item is T => item !== null);
            result = !search && !items.length ? { error: "missing" } : { items: [...new Map(items.map((item) => [item.id, item])).values()].slice(0, 20) };
          }
        } catch (error) {
          result = { error: error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "timeout" : "upstream" };
        }
        await client.query("INSERT INTO provider_limit VALUES ('musicbrainz', clock_timestamp() + $1 * interval '1 second') ON CONFLICT (provider) DO UPDATE SET next_request_at = EXCLUDED.next_request_at", [retryAfter]);
        await client.query("DELETE FROM catalog_cache WHERE expires_at < clock_timestamp()");
        await client.query("INSERT INTO catalog_cache VALUES ($1, $2, clock_timestamp() + $3 * interval '1 second') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at", [cacheKey, JSON.stringify(result), result.error ? 3 : search ? 900 : 86400]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "55P03") throw new CatalogError("rate-limit");
    throw error;
  } finally { client.release(); }
  if (result.error) throw new CatalogError(result.error, result.retryAfter);
  return result.items!;
}

export async function searchAlbums(title: string) {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 200) return [];
  const escaped = normalized.replace(/[+\-!(){}\[\]^"~*?:\\/&|]/g, "\\$&");
  return request(`release-group/?${new URLSearchParams({ query: `releasegroup:"${escaped}" AND primarytype:album`, fmt: "json", limit: "20" })}`, true, "release-groups", parseAlbum);
}

export async function findAlbum(id: string): Promise<Album> {
  if (!isAlbumId(id)) throw new CatalogError("missing");
  id = id.toLowerCase();
  const [local] = await db.select().from(album).where(eq(album.id, id));
  if (local) return local;
  const [found] = await request(`release-group/${id}?inc=artist-credits&fmt=json`, false, "release-groups", parseAlbum);
  if (!found || found.id !== id) throw new CatalogError("missing");
  return found;
}

export async function searchArtists(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 200) return [];
  const escaped = normalized.replace(/[+\-!(){}\[\]^"~*?:\\/&|]/g, "\\$&");
  return request(`artist/?${new URLSearchParams({ query: `artist:"${escaped}"`, fmt: "json", limit: "20" })}`, true, "artists", parseArtist);
}

export async function findArtist(id: string): Promise<Artist> {
  if (!isAlbumId(id)) throw new CatalogError("missing");
  id = id.toLowerCase();
  const [local] = await db.select().from(artist).where(eq(artist.id, id));
  if (local) return local;
  const [found] = await request(`artist/${id}?fmt=json`, false, "artists", parseArtist);
  if (!found || found.id !== id) throw new CatalogError("missing");
  return found;
}
