import { MusicSearch } from "@/components/music-search";
import { albumFilters, maxSearchLength, searchHref } from "@/lib/catalog-search";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { CatalogError, catalogMessages, searchAlbums } from "../../lib/catalog";
import { AlbumSummary } from "../album-summary";

export const metadata = { title: "Search albums | Music Journal" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; search?: string; artist?: string | string[]; year?: string | string[] }> }) {
  if (!await getListener()) redirect("/sign-in");
  const params = await searchParams;
  const q = params.search !== "1" && typeof params.q === "string" ? params.q.trim() : "";
  const filters = albumFilters(params);
  let albums: Awaited<ReturnType<typeof searchAlbums>> = [];
  let error = q.length > maxSearchLength ? `Use an album title of ${maxSearchLength} characters or fewer.` : "";
  if (q && !error) {
    try { albums = await searchAlbums(q, filters); }
    catch (cause) { if (!(cause instanceof CatalogError)) throw cause; error = catalogMessages[cause.kind]; }
  }
  return <main id="main-content" tabIndex={-1}>
    <Link href="/journal">Back to Journal</Link>
    <p><Link href="/search/artists">Search artists</Link></p>
    <h1>Search albums</h1>
    <MusicSearch kind="album">
      {error ? <div role="alert"><p>{error}</p><a href={searchHref("album", q, filters)}>Retry search</a></div> : q ? <>
        <h2 className="results-heading">Albums matching “{q}”</h2>
        {albums.length ? <ul className="album-list">{albums.map((album) => <AlbumSummary key={album.id} album={album} />)}</ul> : <p>{filters.artist || filters.year ? "No matches. Try a different filter." : "No albums found. Try another title."}</p>}
      </> : null}
    </MusicSearch>
  </main>;
}
