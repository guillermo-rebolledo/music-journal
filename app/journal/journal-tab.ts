const journalTabs = ["recent-listens", "want-to-listen", "saved-artists"] as const;
export type JournalTab = (typeof journalTabs)[number];
export const defaultJournalTab: JournalTab = "recent-listens";

/** Resolves a `?tab=` value; anything unknown opens Recent listens. */
export function toJournalTab(value: unknown): JournalTab {
  return journalTabs.find((tab) => tab === value) ?? defaultJournalTab;
}
