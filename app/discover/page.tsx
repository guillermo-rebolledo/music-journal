import Link from "next/link";
import { and, eq, inArray, notExists } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { db } from "../../lib/db";
import { album, listen, wantToListen } from "../../lib/schema";
import { AlbumSummary } from "../album-summary";
import { JournalHeader } from "../journal-header";

export const metadata = { title: "Discover | Music Journal" };

// The MusicBrainz release groups seeded by 0004_handpicked-shelf.
const starterIds = [
  "6e335887-60ba-38f0-95af-fae7774336bf",
  "b248d212-aace-3c3e-a23d-e13aaac1f87a",
  "48117b90-a16e-34ca-a514-19c702df1158",
];

export default async function DiscoverPage() {
  const listener = await getListener();
  if (!listener) redirect("/sign-in");

  const starters = await db.select().from(album).where(and(
    inArray(album.id, starterIds),
    notExists(db.select({ albumId: wantToListen.albumId }).from(wantToListen)
      .where(and(eq(wantToListen.albumId, album.id), eq(wantToListen.listenerId, listener.id)))),
    notExists(db.select({ albumId: listen.albumId }).from(listen)
      .where(and(eq(listen.albumId, album.id), eq(listen.listenerId, listener.id)))),
  )).orderBy(album.title);

  return (
    <>
      <JournalHeader current="discover" />
      <main>
        <h1>Discover</h1>
        <section className="results-heading" aria-labelledby="starter-albums">
          <h2 id="starter-albums">Handpicked albums</h2>
          {starters.length ? (
            <ul className="album-list">
              {starters.map((item) => <AlbumSummary key={item.id} album={item} />)}
            </ul>
          ) : (
            <p>You’ve saved or logged every starter album. <Link href="/search">Search albums</Link> to find something else to listen to.</p>
          )}
        </section>
      </main>
    </>
  );
}
