import Link from "next/link";
import type { Album } from "../lib/catalog";

export function AlbumSummary({ album, listenDate }: { album: Album; listenDate?: string }) {
  return <li className="album-row">
    <span className="cover-placeholder" aria-hidden="true">No cover</span>
    <div><Link prefetch={false} href={`/albums/${album.id}`}>{album.title}</Link><p>{album.creditedArtist} · {album.originalYear ?? "Year unknown"}</p>{listenDate && <p><time dateTime={listenDate}>{listenDate}</time></p>}</div>
  </li>;
}
