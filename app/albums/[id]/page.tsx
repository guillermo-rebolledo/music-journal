import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getListener } from "../../../lib/auth";
import { CatalogError, catalogMessages, findAlbum } from "../../../lib/catalog";
import { db } from "../../../lib/db";
import { listen, wantToListen } from "../../../lib/schema";
import { todayUTC } from "../../../lib/listen-date";
import { ListenForm } from "./listen-form";
import { WantToListenForm } from "./want-to-listen-form";

export const metadata = { title: "Album | Music Journal" };

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const listener = await getListener();
  if (!listener) redirect("/sign-in");
  const { id } = await params;
  let album;
  try { album = await findAlbum(id); }
  catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    return <main><Link href="/journal">Back to Journal</Link><h1>Album unavailable</h1><p role="alert">{catalogMessages[error.kind]}</p><a href={`/albums/${encodeURIComponent(id)}`}>Retry album</a><p><Link href="/search">Search albums</Link></p></main>;
  }
  const [saved] = await db.select().from(wantToListen).where(and(eq(wantToListen.listenerId, listener.id), eq(wantToListen.albumId, album.id)));
  const listens = await db.select().from(listen).where(and(eq(listen.listenerId, listener.id), eq(listen.albumId, album.id))).orderBy(desc(listen.listenDate), desc(listen.createdAt), desc(listen.submissionKey));
  return <main>
    <Link href="/journal">Back to Journal</Link>
    <h1>{album.title}</h1>
    <p>{album.creditedArtist} · {album.originalYear ?? "Year unknown"}</p>
    <p className="cover-placeholder">No cover available</p>
    <WantToListenForm albumId={album.id} saved={!!saved} />
    <ListenForm albumId={album.id} today={todayUTC()} submissionKey={randomUUID()} />
    <section aria-labelledby="album-listens" className="results-heading">
      <h2 id="album-listens">Your listens</h2>
      <p>{listens.length ? "Listened" : "No listens yet."}</p>
      {listens.length > 0 && <ul>{listens.map((entry) => <li key={entry.submissionKey}><time dateTime={entry.listenDate}>{entry.listenDate}</time></li>)}</ul>}
    </section>
    <p><Link href="/search">Search albums</Link></p>
  </main>;
}
