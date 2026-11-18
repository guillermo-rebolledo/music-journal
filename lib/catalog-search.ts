export type SearchKind = "album" | "artist";

export const searchPaths = { album: "/search", artist: "/search/artists" } as const;
export const minSuggestionLength = 2;
export const maxSearchLength = 200;

export function searchHref(kind: SearchKind, q: string) {
  return `${searchPaths[kind]}?${new URLSearchParams({ q })}`;
}

export type SearchMatch = {
  id: string;
  title: string;
  detail: string | null;
  year?: number | null;
  cover?: string;
};

export type SearchAnswer = { matches: SearchMatch[] } | { error: string };
