"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Artwork } from "@/app/artwork";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { maxSearchLength, searchHref, type SearchKind, type SearchMatch } from "@/lib/catalog-search";

export function CatalogSearch({
  kind, query, year, artist, years, artists, filtersOpen, matches,
  busy, open, inputRef, onOpenChange, onChange, updates,
}: {
  kind: SearchKind;
  query: string;
  year: string;
  artist: string;
  years: string[];
  artists: string[];
  filtersOpen: boolean;
  matches: SearchMatch[];
  busy: boolean;
  open: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpenChange: (open: boolean) => void;
  onChange: (values: Record<string, string>) => void;
  updates: ReactNode;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusFirst = useRef(false);
  const restoreFocus = useRef(true);
  const activeFilters = Number(!!year) + Number(!!artist);

  function moveInResults(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    const links = list.current?.querySelectorAll("a");
    if (!links?.length) return;
    let next: number;
    if (event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
      return;
    }
    if (event.key === "ArrowDown") next = (index + 1) % links.length;
    else if (event.key === "ArrowUp") next = (index + links.length - 1) % links.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = links.length - 1;
    else return;
    event.preventDefault();
    links[next]?.focus();
  }

  function changeQuery(value: string, clear = false) {
    onChange({ q: value, year: "", artist: "", search: "1", filters: !clear && filtersOpen ? "1" : "" });
    onOpenChange(true);
  }

  function changeFilters(values: Record<string, string>) {
    onChange({ ...values, search: "1" });
    onOpenChange(true);
  }

  return (
    <section role="search" aria-label={`Find ${kind}s`} className="mt-6 rounded-xl border border-border bg-muted p-4 sm:p-6">
      <p id={`${id}-help`} className="sr-only">
        {kind === "album" ? "Search the Catalog by album title." : "Search the Catalog by artist name."} Use Down Arrow to browse the results.
      </p>
      <div ref={anchor}>
        <div className="flex flex-wrap items-center gap-2">
          <Popover.Root open={open} modal={false} onOpenChange={(next, details) => {
            if (details.reason === "outside-press" && details.event.target instanceof Node &&
                anchor.current?.contains(details.event.target)) return;
            restoreFocus.current = details.reason !== "outside-press" && details.reason !== "focus-out";
            onOpenChange(next);
          }}>
            <div className="catalog-search-input flex min-h-11 min-w-0 basis-full items-center gap-2 rounded-md border border-input bg-background ps-3 pe-1 sm:flex-[1_1_9rem]">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Input ref={inputRef} type="search" role="combobox" aria-label={kind === "album" ? "Album title" : "Artist name"}
                aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? `${id}-results` : undefined}
                aria-describedby={`${id}-help`} aria-keyshortcuts="Control+K Meta+K"
                autoComplete="off" placeholder={`Search ${kind}s…`} maxLength={maxSearchLength} value={query}
                className="min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent [&::-webkit-search-cancel-button]:hidden"
                onClick={() => onOpenChange(true)}
                onChange={(event) => changeQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    if (open) list.current?.querySelector("a")?.focus();
                    else {
                      focusFirst.current = true;
                      onOpenChange(true);
                    }
                  } else if (event.key === "Enter" && open) {
                    event.preventDefault();
                    list.current?.querySelector("a")?.click();
                  } else if (event.key === "Escape" && open) {
                    event.preventDefault();
                    onOpenChange(false);
                  }
                }}
              />
              {query && (
                <Button variant="ghost" size="icon" aria-label="Clear search"
                  onClick={() => { changeQuery("", true); inputRef.current?.focus(); }}>
                  <X aria-hidden="true" />
                </Button>
              )}
              <Popover.Trigger aria-label={`Show ${kind}s`} render={<Button variant="ghost" size="icon" />}>
                <ChevronDown aria-hidden="true" />
              </Popover.Trigger>
            </div>
            <Popover.Portal>
              <Popover.Positioner anchor={anchor} positionMethod="fixed" sideOffset={8}
                className="z-20 w-(--anchor-width) max-w-(--available-width)">
                <Popover.Popup id={`${id}-results`} aria-label="Search results"
                  initialFocus={() => {
                    if (!focusFirst.current) return false;
                    focusFirst.current = false;
                    return list.current?.querySelector("a") ?? false;
                  }}
                  finalFocus={() => restoreFocus.current ? inputRef.current : false}
                  className="max-h-(--available-height) overflow-y-auto overscroll-contain rounded-md border border-transparent bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
                  <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1">
                    <p className="meta mt-0 min-w-0">Explore the Catalog</p>
                    <Popover.Close render={<Button variant="ghost" size="icon" aria-label="Close search" />}>
                      <X aria-hidden="true" />
                    </Popover.Close>
                  </div>
                  <div className="px-3 py-2">{updates}</div>
                  <ul ref={list} aria-busy={busy} className="catalog-search-results overflow-y-auto overscroll-contain p-1 empty:hidden">
                    {matches.map((match, index) => (
                      <li key={match.id}>
                        <Link prefetch={false}
                          href={kind === "album" ? `/albums/${match.id}` : `${searchHref(kind, query.trim())}#artist-${match.id}`}
                          onNavigate={() => onOpenChange(false)} onKeyDown={(event) => moveInResults(event, index)}
                          className="flex min-h-24 items-center gap-4 rounded-md p-3 no-underline hover:bg-accent focus-visible:bg-accent focus-visible:outline-offset-[-3px]">
                          <span aria-hidden="true">
                            {match.cover ? <Artwork kind="album" image={{ src: match.cover }} /> : <span className="artwork"><UserRound className="size-5 text-muted-foreground" /></span>}
                          </span>
                          <span className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
                            <span className="font-medium"><bdi>{match.title}</bdi></span>
                            {(match.detail || kind === "album") && (
                              <span className="meta">{match.detail}{kind === "album" && ` · ${match.year ?? "Year unknown"}`}</span>
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {kind === "album" && (
                    <p className="mt-0 border-t border-border px-3 py-2 text-sm text-muted-foreground">
                      Filters narrow up to 20 returned matches.
                    </p>
                  )}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
          {kind === "album" && (
            <Button variant="outline" className="min-h-11" aria-expanded={filtersOpen}
              aria-controls={`${id}-filters`} onClick={() => onChange({ filters: filtersOpen ? "" : "1" })}>
              Filters{activeFilters > 0 ? ` (${activeFilters} active)` : ""}
              <ChevronDown aria-hidden="true" />
            </Button>
          )}
        </div>
        {kind === "album" && (
          <div id={`${id}-filters`} hidden={!filtersOpen} className="mt-2 flex-wrap items-center gap-2 not-hidden:flex">
            <CatalogFilter label="Credited artist" value={artist} emptyLabel="All artists" options={artists}
              onChange={(value) => changeFilters({ artist: value })} />
            <CatalogFilter label="Release year" value={year} emptyLabel="All years" options={years}
              onChange={(value) => changeFilters({ year: value })} />
            {activeFilters > 0 && (
              <Button variant="ghost" onClick={() => changeFilters({ year: "", artist: "" })}>
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function CatalogFilter({ label, value, emptyLabel, options, onChange }: {
  label: string;
  value: string;
  emptyLabel: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const items = [
    { value: "", label: emptyLabel },
    ...(value && !options.includes(value) ? [{ value, label: `${value} (not in these results)` }] : []),
    ...options.map((option) => ({ value: option, label: option })),
  ];

  return (
    <Select items={items} value={value} onValueChange={(next) => onChange(next ?? "")}>
      <SelectTrigger aria-label={label} className="catalog-search-filter min-w-0 max-w-full flex-1 sm:flex-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-w-(--available-width)">
        {items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
