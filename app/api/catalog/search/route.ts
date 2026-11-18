import { albumCoverThumbnail } from "@/app/album-artwork";
import { getListener } from "@/lib/auth";
import { maxSearchLength, minSuggestionLength, type SearchAnswer } from "@/lib/catalog-search";
import { CatalogError, catalogMessages, searchAlbums, searchArtists } from "@/lib/catalog";

export async function GET(request: Request) {
  function respond(answer: SearchAnswer, status = 200, retryAfter?: number) {
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    if (retryAfter !== undefined) headers.set("Retry-After", String(retryAfter));
    return Response.json(answer, { status, headers });
  }

  if (!await getListener()) return respond({ error: "Sign in to search the catalog." }, 401);
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const q = params.get("q")?.trim() ?? "";
  if ((kind !== "album" && kind !== "artist") || q.length > maxSearchLength) {
    return respond({ error: "Enter a valid catalog search." }, 400);
  }
  if (q.length < minSuggestionLength) return respond({ matches: [] });

  try {
    const matches = kind === "album"
      ? (await searchAlbums(q)).map(({ id, title, creditedArtist, originalYear }) =>
          ({ id, title, detail: creditedArtist, year: originalYear, cover: albumCoverThumbnail(id) }))
      : (await searchArtists(q)).map(({ id, name, disambiguation }) =>
          ({ id, title: name, detail: disambiguation }));
    return respond({ matches });
  } catch (cause) {
    if (!(cause instanceof CatalogError)) throw cause;
    const error = kind === "artist" && cause.kind === "missing"
      ? "This artist could not be found in the catalog."
      : catalogMessages[cause.kind];
    return cause.kind === "rate-limit" ? respond({ error }, 429, cause.retryAfter) : respond({ error }, 503);
  }
}
