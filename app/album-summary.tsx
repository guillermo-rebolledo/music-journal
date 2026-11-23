import Link from "next/link";
import type { Album } from "../lib/catalog";
import { AlbumArtwork } from "./album-artwork";

export function AlbumSummary({ album }: { album: Album }) {
  return <li className="album-row">
    <AlbumArtwork id={album.id} />
    <div><Link prefetch={false} href={`/albums/${album.id}`}>{album.title}</Link><p>{album.creditedArtist} · {album.originalYear ?? "Year unknown"}</p></div>
  </li>;
}
