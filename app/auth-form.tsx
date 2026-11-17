"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";

export function AuthForm({ creatingAccount = false }: { creatingAccount?: boolean }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitLabel = creatingAccount ? "Create account" : "Sign in";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    const name = String(form.get("name") ?? "").trim();

    if (creatingAccount && !name) {
      setError("Enter your name.");
      return;
    }

    setError("");
    setPending(true);

    try {
      const result = creatingAccount
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });

      if (!result.error) {
        window.location.replace("/journal");
        return;
      }

      if (result.error.status === 429) {
        setError("Too many attempts. Wait a moment and try again.");
      } else if (!creatingAccount && result.error.status === 401) {
        setError("Check your email and password, then try again.");
      } else if (creatingAccount) {
        setError("Could not create an account. Check your details or try signing in.");
      } else {
        setError("Could not sign in. Try again.");
      }
    } catch {
      setError("Could not connect. Try again.");
    }

    setPending(false);
  }

  return (
    <form className="auth-form" method="post" onSubmit={submit}>
      <FieldGroup>
        {creatingAccount && <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input id="name" name="name" autoComplete="name" required />
        </Field>}
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input id="password" name="password" type="password"
            autoComplete={creatingAccount ? "new-password" : "current-password"}
            minLength={creatingAccount ? 8 : undefined} maxLength={128}
            aria-describedby={creatingAccount ? "password-hint" : undefined} required />
          {creatingAccount && <p className="field-hint" id="password-hint">Use at least 8 characters.</p>}
        </Field>
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? (creatingAccount ? "Creating account…" : "Signing in…") : submitLabel}
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
