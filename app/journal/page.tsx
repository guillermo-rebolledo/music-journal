import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "../../lib/db";
import { album, artist, listen, savedArtist, wantToListen } from "../../lib/schema";
import { ArtistSummary } from "../artist-summary";
import { AlbumSummary } from "../album-summary";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { JournalHeader } from "../journal-header";

export const metadata = { title: "Journal | Music Journal" };

export default async function JournalPage() {
  const listener = await getListener();

  if (!listener) {
    redirect("/sign-in");
  }

  const queue = await db.select({ album }).from(wantToListen).innerJoin(album, eq(wantToListen.albumId, album.id)).where(eq(wantToListen.listenerId, listener.id)).orderBy(desc(wantToListen.createdAt));
  const listens = await db.select({ album, listen }).from(listen).innerJoin(album, eq(listen.albumId, album.id)).where(eq(listen.listenerId, listener.id)).orderBy(desc(listen.listenDate), desc(listen.createdAt), desc(listen.submissionKey)).limit(50);

  const artists = await db.select({ artist }).from(savedArtist).innerJoin(artist, eq(savedArtist.artistId, artist.id)).where(eq(savedArtist.listenerId, listener.id)).orderBy(desc(savedArtist.createdAt), artist.id);

  return (
    <>
      <JournalHeader current="journal" />
      <main id="main-content" tabIndex={-1}>
        <h1>Journal</h1>
        <p className="listener"><strong>{listener.name}</strong> · {listener.email}</p>
        <p><Link href="/search">Search albums</Link></p>
        <div className="journal-sections">
          <section aria-labelledby="recent-listens">
            <Card><CardHeader><CardTitle><h2 id="recent-listens">Recent listens</h2></CardTitle></CardHeader><CardContent>
            {listens.length ? <ul className="album-list">{listens.map(({ album, listen }) => <AlbumSummary key={listen.submissionKey} album={album} listenDate={listen.listenDate} />)}</ul> : <p>Albums you log will appear here by listen date.</p>}
          </CardContent></Card>
          </section>
          <section aria-labelledby="want-to-listen">
            <Card><CardHeader><CardTitle><h2 id="want-to-listen">Want to Listen</h2></CardTitle></CardHeader><CardContent>
            {queue.length ? <ul className="album-list">{queue.map(({ album }) => <AlbumSummary key={album.id} album={album} />)}</ul> : <p>Keep track of albums you want to hear.</p>}
          </CardContent></Card>
          </section>
          <section aria-labelledby="saved-artists">
            <Card><CardHeader><CardTitle><h2 id="saved-artists">Saved Artists</h2></CardTitle></CardHeader><CardContent>
            <p><Link href="/search/artists">Search artists</Link></p>
            {artists.length ? <ul className="album-list">{artists.map(({ artist }) => <ArtistSummary key={artist.id} artist={artist} saved />)}</ul> : <p>Keep track of artists you want to explore.</p>}
          </CardContent></Card>
          </section>
        </div>
      </main>
    </>
  );
}
