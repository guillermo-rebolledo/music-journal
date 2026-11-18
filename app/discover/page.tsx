import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import Link from "next/link";
import { and, eq, inArray, notExists } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { CatalogError, isAlbumId, type Artist } from "../../lib/catalog";
import { relatedArtists, suggestedAlbum } from "../../lib/discover";
import { db } from "../../lib/db";
import { album, artist, listen, savedArtist, wantToListen } from "../../lib/schema";
import { AlbumSummary } from "../album-summary";
import { ArtistArtwork } from "../artwork";
import { SavedArtistForm } from "../artists/saved-artist-form";
import { JournalHeader } from "../journal-header";

export const metadata = { title: "Discover | Music Journal" };

// The MusicBrainz release groups seeded by 0004_handpicked-shelf.
const starterIds = [
  "6e335887-60ba-38f0-95af-fae7774336bf",
  "b248d212-aace-3c3e-a23d-e13aaac1f87a",
  "48117b90-a16e-34ca-a514-19c702df1158",
];

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ seed?: string | string[] }> }) {
  const listener = await getListener();
  if (!listener) redirect("/sign-in");

  const { seed: requestedSeed } = await searchParams;
  const [saved, starters] = await Promise.all([
    db.select({ id: artist.id, name: artist.name, disambiguation: artist.disambiguation })
      .from(savedArtist).innerJoin(artist, eq(savedArtist.artistId, artist.id))
      .where(eq(savedArtist.listenerId, listener.id)).orderBy(artist.name, artist.disambiguation, artist.id),
    db.select().from(album).where(and(
      inArray(album.id, starterIds),
      notExists(db.select({ albumId: wantToListen.albumId }).from(wantToListen)
        .where(and(eq(wantToListen.albumId, album.id), eq(wantToListen.listenerId, listener.id)))),
      notExists(db.select({ albumId: listen.albumId }).from(listen)
        .where(and(eq(listen.albumId, album.id), eq(listen.listenerId, listener.id)))),
    )).orderBy(album.title),
  ]);
  const savedIds = new Set(saved.map(({ id }) => id));
  const seed = typeof requestedSeed === "string" && isAlbumId(requestedSeed)
    ? saved.find(({ id }) => id === requestedSeed.toLowerCase())
    : undefined;
  let related: Artist[] = [];
  let unavailable = false;
  if (seed) {
    try {
      related = await relatedArtists(seed.id);
    } catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      unavailable = true;
    }
  }
  const suggestions = await Promise.all(related.map(async (artist) => ({
    artist, album: await suggestedAlbum(artist.id, listener.id),
  })));

  return (
    <>
      <JournalHeader current="discover" />
      <main id="main-content" tabIndex={-1}>
        <h1>Discover</h1>
        <section className="results-heading" aria-labelledby="related-artists">
          <h2 id="related-artists">Related artists</h2>
          {requestedSeed !== undefined && !seed && <p>This seed artist is no longer in your Saved Artists.</p>}
          {saved.length ? (
            <form action="/discover" method="get" className="auth-form seed-form">
              <FieldGroup><Field><FieldLabel htmlFor="seed">Seed artist</FieldLabel>
                <NativeSelect id="seed" name="seed" required defaultValue={seed?.id ?? ""}>
                  <option value="" disabled>Choose a Saved Artist</option>
                  {saved.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}{item.disambiguation ? ` · ${item.disambiguation}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </Field></FieldGroup>
              <Button type="submit" size="lg">Find related artists</Button>
            </form>
          ) : (
            <><p>Save an artist to find related artists.</p><Link href="/search/artists">Search artists</Link></>
          )}
          {seed && <p className="listener">Based on {seed.name}{seed.disambiguation && ` · ${seed.disambiguation}`}</p>}
          {unavailable && <p role="status">Related artists are temporarily unavailable. Try again in a moment or explore the handpicked albums below.</p>}
          {seed && !unavailable && !suggestions.length && <p>No related artists found. Try another Saved Artist.</p>}
          {suggestions.length > 0 && (
            <ul className="album-list">
              {suggestions.map(({ artist, album }) => (
                <li className="artist-row" key={artist.id}>
                  <ArtistArtwork id={artist.id}><strong>{artist.name}</strong></ArtistArtwork>
                  {savedIds.has(artist.id) ? (
                    <p>Saved to Saved Artists</p>
                  ) : (
                    <SavedArtistForm artistId={artist.id} saved={false} />
                  )}
                  {album ? <ul className="album-list suggestion-album"><AlbumSummary album={album} /></ul> : <p>No album suggestion available.</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
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
