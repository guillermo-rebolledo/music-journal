import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getListener } from "../../../lib/auth";
import { CatalogError, catalogMessages, findAlbum, isAlbumId } from "../../../lib/catalog";
import { catalogAliasGroup, pinCatalogGeneration, usesLocalCatalog } from "../../../lib/catalog-identity";
import { findPinnedAlbum, getAlbumJournal } from "../../../lib/journal";
import { todayUTC } from "../../../lib/listen-date";
import { AlbumArtwork } from "../../album-artwork";
import { ListenForm } from "./listen-form";
import { WantToListenForm } from "./want-to-listen-form";

export const metadata = { title: "Album | Music Journal" };

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const listener = await getListener();
  if (!listener) redirect("/sign-in");
  const { id } = await params;
  const albumId = id.toLowerCase();
  const local = usesLocalCatalog();
  let group;
  let album;
  try {
    if (!isAlbumId(albumId)) throw new CatalogError("missing");
    const generation = await pinCatalogGeneration();
    group = await catalogAliasGroup("album", generation, albumId);
    album = local ? await findPinnedAlbum(generation, group) : await findAlbum(albumId);
  }
  catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    return <main id="main-content" tabIndex={-1}><Link href="/journal">Back to Journal</Link><h1>Album unavailable</h1><p role="alert">{catalogMessages[error.kind]}</p><a href={`/albums/${encodeURIComponent(id)}`}>Retry album</a><p><Link href="/search">Search albums</Link></p></main>;
  }
  const { saved, listens } = await getAlbumJournal(listener.id, group);
  return <main id="main-content" tabIndex={-1}>
    <Link href="/journal">Back to Journal</Link>
    <h1>{album.title}</h1>
    <p>{album.creditedArtist} · {album.originalYear ?? "Year unknown"}</p>
    <AlbumArtwork id={album.id} detail />
    <WantToListenForm albumId={albumId} saved={saved} />
    <ListenForm albumId={albumId} today={todayUTC()} submissionKey={randomUUID()} />
    <section aria-labelledby="album-listens" className="results-heading">
      <h2 id="album-listens">Your listens</h2>
      <p>{listens.length ? "Listened" : "No listens yet."}</p>
      {listens.length > 0 && <ul>{listens.map((entry) => <li key={entry.submissionKey}><time dateTime={entry.listenDate}>{entry.listenDate}</time></li>)}</ul>}
    </section>
    <p><Link href="/search">Search albums</Link></p>
  </main>;
}
