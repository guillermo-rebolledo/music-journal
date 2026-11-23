import Link from "next/link";
import type { Album } from "../../lib/catalog";
import { AlbumArtwork } from "../album-artwork";

/** One dated Journal row: a fixed date column, the 64px cover frame, then title and metadata. */
export function LedgerRow({ album, date, dateLabel }: { album: Album; date: string; dateLabel: string }) {
  return (
    <li className="ledger-row">
      <time dateTime={date} className="ledger-date">{date}</time>
      <AlbumArtwork id={album.id} />
      <div className="min-w-0">
        <Link prefetch={false} href={`/albums/${album.id}`}>{album.title}</Link>
        <p className="meta">
          {album.creditedArtist} · {album.originalYear ?? "Year unknown"}
          <span className="ledger-inline-date"> · {dateLabel} <time dateTime={date}>{date}</time></span>
        </p>
      </div>
    </li>
  );
}
