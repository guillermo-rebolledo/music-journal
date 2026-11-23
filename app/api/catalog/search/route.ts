import { albumCoverThumbnail } from "@/app/album-artwork";
import { getListener } from "@/lib/auth";
import { albumFiltersFromURL, maxSearchLength, minSuggestionLength, type SearchAnswer } from "@/lib/catalog-search";
import { CatalogError, catalogMessages, searchAlbumResults, searchArtists, usesLocalCatalog } from "@/lib/catalog";

export async function GET(request: Request) {
  function respond(answer: SearchAnswer, status = 200) {
    return Response.json(answer, { status, headers: { "Cache-Control": "private, no-store" } });
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
    if (kind === "album") {
      const filters = albumFiltersFromURL(params);
      const { matches, ...choices } = await searchAlbumResults(q, filters);
      return respond({
        matches: matches.map(({ id, title, creditedArtist, originalYear }) =>
          ({ id, title, detail: creditedArtist, year: originalYear, cover: albumCoverThumbnail(id) })),
        ...(usesLocalCatalog() || filters.artist || filters.year ? { choices } : {}),
      });
    }
    const matches = (await searchArtists(q)).map(({ id, name, disambiguation }) =>
      ({ id, title: name, detail: disambiguation }));
    return respond({ matches });
  } catch (cause) {
    if (!(cause instanceof CatalogError)) throw cause;
    const error = kind === "artist" && cause.kind === "missing"
      ? "This artist could not be found in the catalog."
      : catalogMessages[cause.kind];
    if (cause.kind === "rate-limit") return respond({ error, retryAfter: cause.retryAfter });
    return respond({ error }, 503);
  }
}
