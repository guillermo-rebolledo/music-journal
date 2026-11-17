import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "../../lib/db";
import { album, wantToListen } from "../../lib/schema";
import { AlbumSummary } from "../album-summary";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { SignOut } from "./sign-out";

export const metadata = { title: "Journal | Music Journal" };

export default async function JournalPage() {
  const listener = await getListener();

  if (!listener) {
    redirect("/sign-in");
  }

  const queue = await db.select({ album }).from(wantToListen).innerJoin(album, eq(wantToListen.albumId, album.id)).where(eq(wantToListen.listenerId, listener.id)).orderBy(desc(wantToListen.createdAt));

  return (
    <>
      <header className="site-header">
        <span className="wordmark">Music Journal</span>
        <SignOut />
      </header>
      <main>
        <h1>Journal</h1>
        <p className="listener"><strong>{listener.name}</strong> · {listener.email}</p>
        <p><Link href="/search">Search albums</Link></p>
        <div className="journal-sections">
          <section aria-labelledby="recent-listens">
            <h2 id="recent-listens">Recent listens</h2>
            <p>Albums you log will appear here by listen date.</p>
          </section>
          <section aria-labelledby="want-to-listen">
            <h2 id="want-to-listen">Want to Listen</h2>
            {queue.length ? <ul className="album-list">{queue.map(({ album }) => <AlbumSummary key={album.id} album={album} />)}</ul> : <p>Keep track of albums you want to hear.</p>}
          </section>
          <section aria-labelledby="saved-artists">
            <h2 id="saved-artists">Saved Artists</h2>
            <p>Keep track of artists you want to explore.</p>
          </section>
        </div>
      </main>
    </>
  );
}
