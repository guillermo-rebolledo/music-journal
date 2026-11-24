import { MusicSearch } from "@/components/music-search";
import { maxSearchLength, searchHref } from "@/lib/catalog-search";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getListener } from "../../../lib/auth";
import { CatalogError, catalogMessages, searchArtists } from "../../../lib/catalog";
import { pinCatalogGeneration } from "../../../lib/catalog-identity";
import { getSavedArtistIds } from "../../../lib/journal";
import { ArtistSummary } from "../../artist-summary";

export const metadata = { title: "Search artists | Music Journal" };

export default async function ArtistSearchPage({ searchParams }: { searchParams: Promise<{ q?: string; search?: string }> }) {
  const listener = await getListener();
  if (!listener) redirect("/sign-in");
  const params = await searchParams;
  const q = params.search !== "1" && typeof params.q === "string" ? params.q.trim() : "";
  let artists: Awaited<ReturnType<typeof searchArtists>> = [];
  let error = q.length > maxSearchLength ? `Use an artist name of ${maxSearchLength} characters or fewer.` : "";
  let saved = new Set<string>();
  if (q && !error) {
    try {
      const generation = await pinCatalogGeneration();
      artists = await searchArtists(q, generation);
      if (artists.length) saved = await getSavedArtistIds(listener.id, generation, artists.map(({ id }) => id));
    } catch (cause) {
      if (!(cause instanceof CatalogError)) throw cause;
      error = cause.kind === "missing" ? "This artist could not be found in the catalog." : catalogMessages[cause.kind];
    }
  }
  return <main id="main-content" tabIndex={-1}>
    <Link href="/journal?tab=saved-artists">Back to Journal</Link>
    <p><Link href="/search">Search albums</Link></p>
    <h1>Search artists</h1>
    <MusicSearch kind="artist">
      {error ? <div role="alert"><p>{error}</p><a href={searchHref("artist", q)}>Retry search</a></div> : q ? <>
        <h2 className="results-heading">Artists matching “{q}”</h2>
        {artists.length ? <ul className="album-list">{artists.map((artist) => <ArtistSummary key={artist.id} artist={artist} saved={saved.has(artist.id)} />)}</ul> : <p>No artists found. Try another name.</p>}
      </> : null}
    </MusicSearch>
  </main>;
}
