"use client";

import { useActionState } from "react";
import { setWantToListen } from "./actions";

export function WantToListenForm({ albumId, saved }: { albumId: string; saved: boolean }) {
  const [error, action, pending] = useActionState(setWantToListen, null);
  return <form action={action} className="auth-form">
    <input type="hidden" name="albumId" value={albumId} />
    <input type="hidden" name="intent" value={saved ? "remove" : "save"} />
    <button disabled={pending}>{pending ? "Updating…" : saved ? "Remove from Want to Listen" : "Save to Want to Listen"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
