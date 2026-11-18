import "server-only";
import { pool } from "./db";

export type Failure = "timeout" | "rate-limit" | "upstream" | "missing";
type Result<T> = { items: T } | { error: Failure; retryAfter?: number };

export class CatalogError extends Error {
  constructor(public kind: Failure, public retryAfter = 5) { super(kind); }
}

const providers = {
  musicbrainz: { lock: 731901, baseUrl: process.env.MUSICBRAINZ_BASE_URL || "https://musicbrainz.org/ws/2" },
  listenbrainz: { lock: 731902, baseUrl: process.env.LISTENBRAINZ_BASE_URL || "https://api.listenbrainz.org" },
  wikidata: { lock: 731903, baseUrl: process.env.WIKIDATA_BASE_URL || "https://www.wikidata.org/w" },
  commons: { lock: 731904, baseUrl: process.env.COMMONS_BASE_URL || "https://commons.wikimedia.org/w" },
};

function retryDelay(headers: Headers) {
  const retry = headers.get("retry-after");
  if (!retry) return 0;
  return /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000) || 0;
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new CatalogError("upstream");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) {
      await reader.cancel();
      throw new CatalogError("upstream");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function requestProvider<T>(
  provider: keyof typeof providers,
  path: string,
  ttl: number,
  parse: (data: unknown) => T,
): Promise<T> {
  const cacheKey = `${provider === "musicbrainz" ? "v2" : provider}:${path}`;
  if (pool.waitingCount >= 8) throw new CatalogError("rate-limit");
  const client = await pool.connect().catch(() => {
    throw new CatalogError("upstream");
  });
  let result: Result<T>;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    // Recheck the shared cache inside the provider lock to coalesce misses across instances.
    await client.query("SELECT pg_advisory_xact_lock($1)", [providers[provider].lock]);
    const cached = await client.query("SELECT value FROM catalog_cache WHERE key = $1 AND expires_at > clock_timestamp()", [cacheKey]);
    if (cached.rowCount) {
      result = cached.rows[0].value as Result<T>;
    } else {
      const limit = await client.query("SELECT EXTRACT(EPOCH FROM (next_request_at - clock_timestamp())) * 1000 AS wait FROM provider_limit WHERE provider = $1", [provider]);
      const wait = Number(limit.rows[0]?.wait ?? 0);
      if (wait > 1100) {
        result = { error: "rate-limit", retryAfter: Math.ceil(wait / 1000) };
      } else {
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        let delay = 1;
        try {
          const response = await fetch(`${providers[provider].baseUrl}/${path}`, {
            headers: { "User-Agent": "MusicJournal/0.1 (https://github.com/guillermo-rebolledo/music-journal)", Accept: "application/json" },
            signal: AbortSignal.timeout(4000), cache: "no-store", redirect: "error",
          });
          const throttled = response.status === 429 || response.status === 503;
          if (provider === "listenbrainz" && (throttled || response.headers.get("x-ratelimit-remaining") === "0")) {
            const resetIn = response.headers.get("x-ratelimit-reset-in");
            const resetAt = Number(response.headers.get("x-ratelimit-reset"));
            const reset = resetIn && /^\d+$/.test(resetIn) ? Number(resetIn) : Math.ceil(resetAt - Date.now() / 1000);
            delay = Math.max(delay, reset || 0);
          }
          if (throttled) delay = Math.max(delay, 5, retryDelay(response.headers));
          if (!response.ok) {
            await response.body?.cancel();
            throw new CatalogError(throttled ? "rate-limit" : response.status === 404 ? "missing" : "upstream", delay);
          }
          result = { items: parse(await readJson(response)) };
        } catch (error) {
          const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
          result = error instanceof CatalogError
            ? { error: error.kind, retryAfter: error.retryAfter }
            : { error: timeout ? "timeout" : "upstream" };
        }
        await client.query("INSERT INTO provider_limit VALUES ($1, clock_timestamp() + $2 * interval '1 second') ON CONFLICT (provider) DO UPDATE SET next_request_at = EXCLUDED.next_request_at", [provider, delay]);
        await client.query("DELETE FROM catalog_cache WHERE expires_at < clock_timestamp()");
        await client.query("INSERT INTO catalog_cache VALUES ($1, $2, clock_timestamp() + $3 * interval '1 second') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at", [cacheKey, JSON.stringify(result), "error" in result ? 3 : ttl]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "55P03") throw new CatalogError("rate-limit");
    throw error;
  } finally {
    client.release();
  }
  if ("error" in result) throw new CatalogError(result.error, result.retryAfter);
  return result.items;
}
