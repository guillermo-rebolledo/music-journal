import { Artwork } from "./artwork";

const archive = process.env.COVER_ART_ARCHIVE_BASE_URL || "https://coverartarchive.org";

export function albumCoverThumbnail(id: string) {
  return `${archive}/release-group/${id}/front-250`;
}

export function AlbumArtwork({ id, detail = false }: { id: string; detail?: boolean }) {
  const src = albumCoverThumbnail(id);
  return <Artwork key={id} kind="album" detail={detail} image={{
    src,
    ...(detail && { srcSet: `${src} 250w, ${archive}/release-group/${id}/front-500 500w`, sizes: "(max-width: 288px) calc(100vw - 2rem), 16rem" }),
  }} />;
}
