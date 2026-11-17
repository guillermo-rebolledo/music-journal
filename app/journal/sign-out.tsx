"use client";
import { Button } from "@/components/ui/button";

import { useActionState } from "react";
import { authClient } from "../../lib/auth-client";

export function SignOut() {
  const [error, signOut, pending] = useActionState(async () => {
    try {
      const result = await authClient.signOut();
      if (!result.error) {
        window.location.replace("/sign-in");
        return "";
      }
    } catch {
      return "Could not connect. Try again.";
    }

    return "Could not sign out. Try again.";
  }, "");

  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
