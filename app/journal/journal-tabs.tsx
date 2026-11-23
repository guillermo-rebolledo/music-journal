"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { defaultJournalTab, toJournalTab, type JournalTab } from "./journal-tab";

export type JournalSection = {
  value: JournalTab;
  label: string;
  count: number;
  summary: string;
  link: { href: string; label: string };
  children: ReactNode;
};

export function JournalTabs({ initialTab, sections }: { initialTab: JournalTab; sections: JournalSection[] }) {
  // The server renders the tab named in the URL; switches update the URL with replaceState so they add no history.
  const [tab, setTab] = useState(initialTab);
  const select = (value: JournalTab) => {
    setTab(value);
    const url = new URL(window.location.href);
    if (value === defaultJournalTab) url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  };

  return (
    <Tabs value={tab} onValueChange={(value) => select(toJournalTab(value))} className="mt-8 gap-0">
      <TabsList variant="ledger" activateOnFocus aria-label="Journal sections">
        {sections.map(({ value, label, count }) => (
          // Name reads "Recent listens, 7"; the padded visual count stays out of the name.
          <TabsTrigger key={value} value={value} id={`journal-tab-${value}`} aria-controls={`journal-panel-${value}`} aria-label={`${label}, ${count}`}>
            <span>{label}</span>
            <span className="tabs-count" aria-hidden="true">{String(count).padStart(2, "0")}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {sections.map(({ value, label, summary, link, children }) => (
        // Panels stay mounted so switching is instant and form state survives; the min height keeps the tab row still.
        // Explicit ids keep the panel labelled in server HTML, before Base UI hydrates.
        <TabsContent key={value} value={value} keepMounted id={`journal-panel-${value}`} aria-labelledby={`journal-tab-${value}`} className="min-h-svh text-base">
          <h2 className="sr-only">{label}</h2>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b py-3">
            <p className="meta m-0">{summary}</p>
            <Link href={link.href} className="tabs-label">{link.label}</Link>
          </div>
          {children}
        </TabsContent>
      ))}
    </Tabs>
  );
}
