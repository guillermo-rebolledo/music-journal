import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { pinCatalogGeneration } from "../../lib/catalog-identity";
import { displayDate, timeZoneCookie } from "../../lib/display-date";
import { getJournal } from "../../lib/journal";
import { ArtistSummary } from "../artist-summary";
import { JournalTabs } from "./journal-tabs";
import { toJournalTab } from "./journal-tab";
import { LedgerRow } from "./ledger-row";

export const metadata = { title: "Journal | Music Journal" };

function Empty({ children }: { children: string }) {
  return <p className="py-6 text-muted-foreground">{children}</p>;
}

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const listener = await getListener();

  if (!listener) {
    redirect("/sign-in");
  }

  const initialTab = toJournalTab((await searchParams).tab);
  const timeZone = (await cookies()).get(timeZoneCookie)?.value;
  const { queue, listens, artists } = await getJournal(listener.id, await pinCatalogGeneration());

  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Journal</h1>
      <p className="listener"><strong>{listener.name}</strong> · {listener.email}</p>
      <JournalTabs initialTab={initialTab} key={initialTab} sections={[
        {
          value: "recent-listens", label: "Recent listens", count: listens.length,
          summary: "Newest first, by listen date", link: { href: "/search", label: "Search albums" },
          children: listens.length
            ? <ol className="album-list">{listens.map(({ album, listen }) => <LedgerRow key={listen.submissionKey} album={album} date={listen.listenDate} dateLabel="Listened" />)}</ol>
            : <Empty>Albums you log will appear here by listen date.</Empty>,
        },
        {
          value: "want-to-listen", label: "Want to Listen", count: queue.length,
          summary: "Newest first, by date added", link: { href: "/search", label: "Search albums" },
          children: queue.length
            ? <ol className="album-list">{queue.map(({ album, addedAt }) => <LedgerRow key={album.id} album={album} date={displayDate(addedAt, timeZone)} dateLabel="Added" />)}</ol>
            : <Empty>Keep track of albums you want to hear.</Empty>,
        },
        {
          value: "saved-artists", label: "Saved Artists", count: artists.length,
          summary: "Artists you want to explore", link: { href: "/search/artists", label: "Search artists" },
          children: artists.length
            ? <ul className="album-list">{artists.map(({ artist }) => <ArtistSummary key={artist.id} artist={artist} saved />)}</ul>
            : <Empty>Keep track of artists you want to explore.</Empty>,
        },
      ]} />
    </main>
  );
}
