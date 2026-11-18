"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Artwork } from "@/app/artwork";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { maxSearchLength, minSuggestionLength, searchHref, searchPaths, type SearchAnswer, type SearchKind } from "@/lib/catalog-search";

export function CatalogSearch({ kind, initialQuery }: { kind: SearchKind; initialQuery: string }) {
  const id = useId();
  const anchor = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusFirst = useRef(false);
  const returnFocus = useRef(true);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ q: string; attempt: number; result: SearchAnswer }>();
  const [year, setYear] = useState("");
  const [creditedArtist, setCreditedArtist] = useState("");
  const q = query.trim();
  const canSearch = q.length >= minSuggestionLength && q.length <= maxSearchLength;
  const current = canSearch && answer?.q === q && answer.attempt === attempt ? answer.result : undefined;
  const matches = current && "matches" in current ? current.matches : [];
  const error = current && "error" in current ? current.error : "";
  const pending = canSearch && !current;
  const years = [...new Set(matches.flatMap((match) => match.year == null ? [] : [match.year]))].sort((a, b) => b - a);
  const creditedArtists = kind === "album" ? [...new Set(matches.map((match) => match.detail ?? ""))].sort() : [];
  const filtered = matches.filter((match) =>
    (!year || String(match.year) === year) && (!creditedArtist || match.detail === creditedArtist));
  const label = kind === "album" ? "Album title" : "Artist name";

  useEffect(() => {
    if (!open || !canSearch || current) return;
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
  }, [attempt, canSearch, current, kind, open, q]);

  useEffect(() => {
    function focusSearch(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey ||
          !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen(true);
      input.current?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function changeQuery(value: string) {
    setQuery(value);
    setYear("");
    setCreditedArtist("");
    setOpen(true);
  }

  function moveInResults(event: KeyboardEvent, index: number) {
    const links = list.current?.querySelectorAll("a");
    if (!links?.length) return;
    let next;
    if (event.key === "ArrowDown") next = (index + 1) % links.length;
    else if (event.key === "ArrowUp") next = (index + links.length - 1) % links.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = links.length - 1;
    else return;
    event.preventDefault();
    links[next]?.focus();
  }

  return (
    <Popover.Root open={open} onOpenChange={(next, details) => {
      if (details.reason === "outside-press" && details.event.target instanceof Node &&
          anchor.current?.contains(details.event.target)) return;
      returnFocus.current = details.reason !== "outside-press" && details.reason !== "focus-out";
      setOpen(next);
    }}>
      <form ref={anchor} action={searchPaths[kind]} role="search" aria-label={`Search ${kind}s`}
        className="mt-6 max-w-xl" onSubmit={() => setOpen(false)}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-query`}>{label}</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-[1_1_10rem]">
                <Search aria-hidden="true" className="pointer-events-none absolute inset-s-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input ref={input} id={`${id}-query`} name="q" type="search" role="combobox"
                  aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-results` : undefined}
                  aria-keyshortcuts="Control+K Meta+K" autoComplete="off" placeholder={`Search ${kind}s…`}
                  maxLength={maxSearchLength} required value={query}
                  className="ps-9 pe-12 [&::-webkit-search-cancel-button]:hidden"
                  onClick={() => setOpen(true)} onChange={(event) => changeQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      if (open) moveInResults(event, -1);
                      else {
                        focusFirst.current = true;
                        setOpen(true);
                      }
                    } else if (event.key === "Escape" && open) {
                      event.preventDefault();
                      setOpen(false);
                    }
                  }}
                />
                {query && (
                  <div className="absolute inset-y-0 inset-e-0 flex items-center">
                    <Button type="button" variant="ghost" size="icon" aria-label="Clear search"
                      className="min-w-11"
                      onClick={() => { changeQuery(""); input.current?.focus(); }}>
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>
              <Popover.Trigger aria-label="Toggle search results" render={<Button type="button" variant="outline" size="icon" />}>
                <ChevronDown aria-hidden="true" />
              </Popover.Trigger>
              <Button type="submit" size="lg">Search</Button>
            </div>
          </Field>
        </FieldGroup>
      </form>
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} sideOffset={8} positionMethod="fixed" className="z-20 w-(--anchor-width)">
          <Popover.Popup id={`${id}-results`} aria-label="Search results"
            initialFocus={() => {
              if (!focusFirst.current) return false;
              focusFirst.current = false;
              return list.current?.querySelector("a") ?? false;
            }}
            finalFocus={() => returnFocus.current ? input.current : false}
            className="max-h-(--available-height) overflow-y-auto overscroll-contain rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3">
              <output aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {q.length > maxSearchLength ? `Use ${maxSearchLength} characters or fewer.`
                  : !canSearch ? `Enter at least ${minSuggestionLength} characters for suggestions.`
                  : pending ? "Searching…"
                  : error ? ""
                  : !matches.length ? `No ${kind}s found for “${q}”.`
                  : !filtered.length ? "No matches. Try a different filter."
                  : filtered.length === matches.length ? `${matches.length} ${matches.length === 1 ? "match" : "matches"} for “${q}”`
                  : `${filtered.length} of ${matches.length} matches`}
              </output>
              <Popover.Close render={<Button variant="ghost" size="icon" aria-label="Close search results" />}><X aria-hidden="true" /></Popover.Close>
            </div>
            {error && (
              <div className="flex flex-wrap items-center gap-2 p-3">
                <span role="alert">{error}</span>
                <Button variant="outline" onClick={() => { setAttempt(attempt + 1); input.current?.focus(); }}>Try again</Button>
              </div>
            )}
            {kind === "album" && matches.length > 1 && (years.length > 0 || creditedArtists.length > 1) && (
              <details className="border-b border-border px-3 py-2">
                <summary className="cursor-pointer rounded-sm text-sm outline-ring focus-visible:outline-2">Filters</summary>
                <FieldGroup className="mt-2 gap-2 sm:grid sm:grid-cols-2">
                  {years.length > 0 && (
                    <Field>
                      <FieldLabel htmlFor={`${id}-year`}>Release year</FieldLabel>
                      <NativeSelect id={`${id}-year`} value={year} onChange={(event) => setYear(event.target.value)}>
                        <NativeSelectOption value="">All years</NativeSelectOption>
                        {years.map((value) => <NativeSelectOption key={value}>{value}</NativeSelectOption>)}
                      </NativeSelect>
                    </Field>
                  )}
                  {creditedArtists.length > 1 && (
                    <Field>
                      <FieldLabel htmlFor={`${id}-artist`}>Credited artist</FieldLabel>
                      <NativeSelect id={`${id}-artist`} value={creditedArtist} onChange={(event) => setCreditedArtist(event.target.value)}>
                        <NativeSelectOption value="">All artists</NativeSelectOption>
                        {creditedArtists.map((value) => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}
                      </NativeSelect>
                    </Field>
                  )}
                </FieldGroup>
              </details>
            )}
            <ul ref={list} aria-busy={pending} className="max-h-72 overflow-y-auto overscroll-contain empty:hidden p-1">
              {filtered.map((match, index) => (
                <li key={match.id}>
                  <Link prefetch={false} href={kind === "album" ? `/albums/${match.id}` : `${searchHref(kind, q)}#artist-${match.id}`}
                    onNavigate={() => setOpen(false)} onKeyDown={(event) => moveInResults(event, index)}
                    className="flex min-h-11 items-center gap-3 rounded-md p-2 no-underline hover:bg-muted focus-visible:bg-muted focus-visible:outline-offset-[-3px]">
                    <span aria-hidden="true">
                      {match.cover ? <Artwork kind="album" image={{ src: match.cover }} /> : <span className="artwork"><UserRound className="size-5 text-muted-foreground" /></span>}
                    </span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <strong><bdi>{match.title}</bdi></strong>
                      {(match.detail || kind === "album") && (
                        <span className="meta block">{match.detail}{kind === "album" && ` · ${match.year ?? "Year unknown"}`}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
