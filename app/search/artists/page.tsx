import { CatalogSearch } from "@/components/catalog-search";
import { maxSearchLength, searchHref } from "@/lib/catalog-search";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getListener } from "../../../lib/auth";
import { CatalogError, catalogMessages, searchArtists } from "../../../lib/catalog";
import { db } from "../../../lib/db";
import { savedArtist } from "../../../lib/schema";
import { ArtistSummary } from "../../artist-summary";

export const metadata = { title: "Search artists | Music Journal" };

export default async function ArtistSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const listener = await getListener();
  if (!listener) redirect("/sign-in");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  let artists: Awaited<ReturnType<typeof searchArtists>> = [];
  let error = q.length > maxSearchLength ? `Use an artist name of ${maxSearchLength} characters or fewer.` : "";
  if (q && !error) {
    try { artists = await searchArtists(q); }
    catch (cause) { if (!(cause instanceof CatalogError)) throw cause; error = cause.kind === "missing" ? "This artist could not be found in the catalog." : catalogMessages[cause.kind]; }
  }
  const saved = new Set((await db.select({ id: savedArtist.artistId }).from(savedArtist).where(eq(savedArtist.listenerId, listener.id))).map((row) => row.id));
  return <main id="main-content" tabIndex={-1}>
    <Link href="/journal">Back to Journal</Link>
    <p><Link href="/search">Search albums</Link></p>
    <h1>Search artists</h1>
    <CatalogSearch key={q} kind="artist" initialQuery={q} />
    {error ? <div role="alert"><p>{error}</p><a href={searchHref("artist", q)}>Retry search</a></div> : q ? <>
      <h2 className="results-heading">Artists matching “{q}”</h2>
      {artists.length ? <ul className="album-list">{artists.map((artist) => <ArtistSummary key={artist.id} artist={artist} saved={saved.has(artist.id)} />)}</ul> : <p>No artists found. Try another name.</p>}
    </> : <p>Find an artist by name, then check any distinguishing details before saving.</p>}
  </main>;
}
