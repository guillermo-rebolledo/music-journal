import type { Artist } from "../lib/catalog";
import { ArtistArtwork } from "./artwork";
import { SavedArtistForm } from "./artists/saved-artist-form";

export function ArtistSummary({ artist, saved }: { artist: Artist; saved: boolean }) {
  return <li id={`artist-${artist.id}`} tabIndex={-1} className="artist-row">
    <ArtistArtwork key={artist.id} id={artist.id}>
      <strong>{artist.name}</strong>
      {artist.disambiguation && <p>{artist.disambiguation}</p>}
    </ArtistArtwork>
    <SavedArtistForm artistId={artist.id} artistName={artist.name} saved={saved} />
  </li>;
}
