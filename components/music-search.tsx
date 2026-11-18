"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CatalogSearch } from "@/components/catalog-search";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { maxSearchLength, minSuggestionLength, type SearchAnswer, type SearchKind } from "@/lib/catalog-search";

export function MusicSearch({ kind, children }: { kind: SearchKind; children?: ReactNode }) {
  const params = useSearchParams();
  const [query, setQuery] = useState(() => (params.get("q") ?? "").slice(0, maxSearchLength));
  const live = params.get("search") === "1";
  const year = params.get("year") ?? "";
  const artist = params.get("artist") ?? "";
  const filtersOpen = params.get("filters") === "1";
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(live);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ q: string; attempt: number; result: SearchAnswer }>();
  const q = query.trim();
  const canSearch = q.length >= minSuggestionLength;
  const current = canSearch && answer?.q === q && answer.attempt === attempt ? answer.result : undefined;
  const matches = current && "matches" in current ? current.matches : [];
  const error = current && "error" in current ? current.error : "";
  const pending = canSearch && !current;
  const years = [...new Set(matches.flatMap((match) => match.year == null ? [] : [match.year]))].sort((a, b) => b - a).map(String);
  const artists = kind === "album" ? [...new Set(matches.flatMap((match) => match.detail ? [match.detail] : []))].sort() : [];
  const filtered = matches.filter((match) => (!year || String(match.year) === year) && (!artist || match.detail === artist));

  function updateSearch(values: Record<string, string>) {
    const url = new URL(window.location.href);
    if ("q" in values) {
      setQuery(values.q);
      url.hash = "";
    }
    for (const [name, value] of Object.entries(values)) {
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    function restoreSearch() {
      const restored = new URLSearchParams(window.location.search);
      setQuery((restored.get("q") ?? "").slice(0, maxSearchLength));
      setOpen(restored.get("search") === "1");
    }

    function focusSearch(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey ||
          !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen(true);
      input.current?.focus();
    }

    window.addEventListener("popstate", restoreSearch);
    window.addEventListener("keydown", focusSearch);
    return () => {
      window.removeEventListener("popstate", restoreSearch);
      window.removeEventListener("keydown", focusSearch);
    };
  }, []);

  useEffect(() => {
    if ((!open && !filtersOpen) || !canSearch || current) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      let result: SearchAnswer;
      try {
        const response = await fetch(`/api/catalog/search?${new URLSearchParams({ kind, q })}`, { signal: controller.signal });
        result = await response.json();
      } catch {
        result = { error: "The catalog is temporarily unavailable. Please try again." };
      }
      if (!controller.signal.aborted) setAnswer({ q, attempt, result });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, canSearch, current, filtersOpen, kind, open, q]);

  return (
    <>
      <CatalogSearch
        kind={kind}
        query={query}
        year={year}
        artist={artist}
        years={years}
        artists={artists}
        filtersOpen={filtersOpen}
        matches={filtered}
        busy={pending}
        open={open}
        inputRef={input}
        onOpenChange={setOpen}
        onChange={updateSearch}
        updates={
          <>
            <output aria-label="Search updates" aria-live="polite" aria-atomic="true"
              className="flex items-center gap-2 text-sm text-muted-foreground [overflow-wrap:anywhere] empty:hidden">
              {!canSearch ? `Enter at least ${minSuggestionLength} characters to search the Catalog.`
                : pending ? <><Spinner aria-hidden="true" aria-label={undefined} role={undefined} /> Searching…</>
                : error ? null
                : !matches.length ? `No ${kind}s found for “${q}”.`
                : !filtered.length ? "No matches. Try a different filter."
                : filtered.length === matches.length ? `${matches.length} ${matches.length === 1 ? "match" : "matches"} for “${q}”`
                : `${filtered.length} of ${matches.length} matches`}
            </output>
            {error && (
              <div className="flex flex-wrap items-center gap-2">
                <span role="alert">{error}</span>
                <Button variant="outline" onClick={() => { setAttempt(attempt + 1); input.current?.focus(); }}>Try again</Button>
              </div>
            )}
          </>
        }
      />
      {!live && !open && children}
    </>
  );
}
