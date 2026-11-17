"use client";

import { useActionState } from "react";
import { logListen } from "./actions";

export function ListenForm({ albumId, today, submissionKey }: { albumId: string; today: string; submissionKey: string }) {
  const [state, action, pending] = useActionState(logListen, { error: null, submissionKey, success: false });
  return <form action={action} className="auth-form">
    <input type="hidden" name="albumId" value={albumId} />
    <input type="hidden" name="submissionKey" value={state.submissionKey} />
    <label>Listen date (UTC)<input type="date" name="listenDate" required defaultValue={today} min="0001-01-01" max={today} /></label>
    <button disabled={pending}>{pending ? "Logging…" : "Log listen"}</button>
    {state.error && <p role="alert">{state.error}</p>}
    {state.success && <p role="status">Listen logged.</p>}
  </form>;
}
