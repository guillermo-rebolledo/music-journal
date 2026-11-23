export type SearchKind = "album" | "artist";

export const searchPaths = { album: "/search", artist: "/search/artists" } as const;
export const minSuggestionLength = 2;
export const maxSearchLength = 200;

export type AlbumFilters = { artist?: string; year?: string };
export type AlbumFilterChoices = { artists: string[]; years: string[] };

export function albumFilters(params: { artist?: string | string[]; year?: string | string[] }): AlbumFilters {
  const single = (value?: string | string[]) =>
    (Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value) || undefined;
  return { artist: single(params.artist), year: single(params.year) };
}

export function albumFiltersFromURL(params: Pick<URLSearchParams, "getAll">): AlbumFilters {
  return albumFilters({ artist: params.getAll("artist"), year: params.getAll("year") });
}

export function searchHref(kind: SearchKind, q: string, filters: AlbumFilters = {}) {
  const params = new URLSearchParams({ q });
  if (filters.artist) params.set("artist", filters.artist);
  if (filters.year) params.set("year", filters.year);
  return `${searchPaths[kind]}?${params}`;
}

export type SearchMatch = {
  id: string;
  title: string;
  detail: string | null;
  year?: number | null;
  cover?: string;
};

export type SearchAnswer = { matches: SearchMatch[]; choices?: AlbumFilterChoices } | { error: string; retryAfter?: number };
