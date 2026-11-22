"use client";

import { useState, type FormEvent } from "react";
import styles from "./login.module.css";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not sign in");
        setBusy(false);
        return;
      }
      const next = new URLSearchParams(location.search).get("next");
      // Only allow same-site relative paths.
      location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/write";
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <form className={styles.form} onSubmit={submit}>
        <h1 className={styles.title}>Sign in</h1>
        <label className={styles.label} htmlFor="password">
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
          autoFocus
          required
        />
        <p className={styles.error} role="alert" aria-live="polite">
          {error}
        </p>
        <button className={styles.button} type="submit" disabled={busy || !password}>
          {busy ? "Signing in" : "Enter"}
        </button>
      </form>
    </main>
  );
}
