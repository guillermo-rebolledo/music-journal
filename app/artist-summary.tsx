import type { Artist } from "../lib/catalog";
import { SavedArtistForm } from "./artists/saved-artist-form";

export function ArtistSummary({ artist, saved }: { artist: Artist; saved: boolean }) {
  return <li className="artist-row">
    <strong>{artist.name}</strong>
    {artist.disambiguation && <p>{artist.disambiguation}</p>}
    <SavedArtistForm artistId={artist.id} saved={saved} />
  </li>;
}
