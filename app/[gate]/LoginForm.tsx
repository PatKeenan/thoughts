"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { authErrorMessage, getAuthClient, INSECURE_ORIGIN_MESSAGE } from "@/lib/client/auth";
import styles from "./login.module.css";

/** Same-origin destination from ?next=, resolved the way the browser would (so "/\evil.com" can't escape). */
function nextPath(): string {
  const raw = new URLSearchParams(location.search).get("next");
  if (!raw) return "/write";
  try {
    const u = new URL(raw, location.origin);
    return u.origin === location.origin ? u.pathname + u.search + u.hash : "/write";
  } catch {
    return "/write";
  }
}

const noSubscribe = () => () => {};

export default function LoginForm() {
  // False only in the browser on a plain-http, non-localhost origin (server render assumes secure).
  const secure = useSyncExternalStore(noSubscribe, () => window.isSecureContext, () => true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const authClient = await getAuthClient();
      const { error: err } = await authClient.signIn.email({ email, password });
      if (err) {
        setError(err.message || "Could not sign in");
        setBusy(false);
        return;
      }
      location.href = nextPath();
    } catch (e) {
      setError(authErrorMessage(e, "Network error. Try again."));
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <form className={styles.form} onSubmit={submit}>
        <h1 className={styles.title}>Sign in</h1>
        <label className={styles.label} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className={styles.input}
          type="email"
          name="email"
          autoComplete="username"
          autoCapitalize="none"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
        />
        <label className={`${styles.label} ${styles.gap}`} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className={styles.input}
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <p className={styles.error} role="alert" aria-live="polite">
          {secure ? error : INSECURE_ORIGIN_MESSAGE}
        </p>
        <button className={styles.button} type="submit" disabled={busy || !secure || !email || !password}>
          {busy ? "Signing in" : "Enter"}
        </button>
      </form>
    </main>
  );
}
