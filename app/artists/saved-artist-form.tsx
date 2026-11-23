"use client";
import { Button } from "@/components/ui/button";

import { useActionState } from "react";
import { setSavedArtist } from "./actions";

export function SavedArtistForm({ artistId, artistName, saved }: { artistId: string; artistName: string; saved: boolean }) {
  const [error, action, pending] = useActionState(setSavedArtist, null);
  return <form action={action} className="auth-form">
    <input type="hidden" name="artistId" value={artistId} />
    <input type="hidden" name="intent" value={saved ? "remove" : "save"} />
    <Button variant={saved ? "destructive" : "secondary"} type="submit" disabled={pending} aria-label={saved && !pending ? `Remove from Saved Artists: ${artistName}` : undefined}>{pending ? "Updating…" : saved ? "Remove from Saved Artists" : "Save artist"}</Button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
