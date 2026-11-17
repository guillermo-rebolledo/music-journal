import Link from "next/link";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { CatalogError, catalogMessages, searchAlbums } from "../../lib/catalog";
import { AlbumSummary } from "../album-summary";

export const metadata = { title: "Search albums | Music Journal" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  if (!await getListener()) redirect("/sign-in");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  let albums: Awaited<ReturnType<typeof searchAlbums>> = [];
  let error = q.length > 200 ? "Use an album title of 200 characters or fewer." : "";
  if (q && !error) {
    try { albums = await searchAlbums(q); }
    catch (cause) { if (!(cause instanceof CatalogError)) throw cause; error = catalogMessages[cause.kind]; }
  }
  return <main>
    <Link href="/journal">Back to Journal</Link>
    <p><Link href="/search/artists">Search artists</Link></p>
    <h1>Search albums</h1>
    <form action="/search" className="auth-form" role="search">
      <label htmlFor="album-title">Album title</label>
      <input id="album-title" name="q" defaultValue={q} maxLength={200} required />
      <button type="submit">Search</button>
    </form>
    {error ? <div role="alert"><p>{error}</p><a href={`/search?${new URLSearchParams({ q })}`}>Retry search</a></div> : q ? <>
      <h2 className="results-heading">Albums matching “{q}”</h2>
      {albums.length ? <ul className="album-list">{albums.map((album) => <AlbumSummary key={album.id} album={album} />)}</ul> : <p>No albums found. Try another title.</p>}
    </> : <p>Find an album by title, then choose its credited artist and original release year.</p>}
  </main>;
}
