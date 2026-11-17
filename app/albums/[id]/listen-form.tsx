"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

import { useActionState } from "react";
import { logListen } from "./actions";

export function ListenForm({ albumId, today, submissionKey }: { albumId: string; today: string; submissionKey: string }) {
  const [state, action, pending] = useActionState(logListen, { error: null, submissionKey, success: false });
  return <form action={action} className="auth-form">
    <input type="hidden" name="albumId" value={albumId} />
    <input type="hidden" name="submissionKey" value={state.submissionKey} />
    <FieldGroup><Field><FieldLabel htmlFor="listen-date">Listen date (UTC)</FieldLabel><Input id="listen-date" type="date" name="listenDate" required defaultValue={today} min="0001-01-01" max={today} /></Field></FieldGroup>
    <Button type="submit" size="lg" disabled={pending}>{pending ? "Logging…" : "Log listen"}</Button>
    {state.error && <p role="alert">{state.error}</p>}
    {state.success && <p role="status">Listen logged.</p>}
  </form>;
}
