"use client";

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
      {creatingAccount && (
        <label>
          Name
          <input name="name" autoComplete="name" required />
        </label>
      )}
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <div>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={creatingAccount ? "new-password" : "current-password"}
            minLength={creatingAccount ? 8 : undefined}
            maxLength={128}
            aria-describedby={creatingAccount ? "password-hint" : undefined}
            required
          />
        </label>
        {creatingAccount && (
          <p className="field-hint" id="password-hint">Use at least 8 characters.</p>
        )}
      </div>
      <button disabled={pending}>
        {pending ? (creatingAccount ? "Creating account…" : "Signing in…") : submitLabel}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
