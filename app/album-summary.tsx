import Link from "next/link";
import type { Album } from "../lib/catalog";

export function AlbumSummary({ album }: { album: Album }) {
  return <li className="album-row">
    <span className="cover-placeholder" aria-hidden="true">No cover</span>
    <div><Link prefetch={false} href={`/albums/${album.id}`}>{album.title}</Link><p>{album.creditedArtist} · {album.originalYear ?? "Year unknown"}</p></div>
  </li>;
}
