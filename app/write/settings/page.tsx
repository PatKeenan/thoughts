"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Settings } from "@/lib/types";
import styles from "./page.module.css";

type State = "idle" | "saving" | "saved" | "error";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [state, setState] = useState<State>("idle");
  const [err, setErr] = useState("");

  async function load() {
    setLoadErr("");
    try {
      setS(await api.getSettings());
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Could not load settings");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((cur) => (cur ? { ...cur, [k]: v } : cur));
    setState("idle");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setState("saving");
    setErr("");
    try {
      setS(await api.patchSettings(s));
      setState("saved");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not save");
      setState("error");
    }
  }

  const [armRemove, setArmRemove] = useState(false);
  const [lookErr, setLookErr] = useState("");
  useEffect(() => {
    if (!armRemove) return;
    const t = setTimeout(() => setArmRemove(false), 3000);
    return () => clearTimeout(t);
  }, [armRemove]);

  async function removeDefaultLook() {
    if (!armRemove) {
      setArmRemove(true);
      return;
    }
    setArmRemove(false);
    setLookErr("");
    try {
      const next = await api.patchSettings({ defaultLook: null });
      setS((cur) => (cur ? { ...cur, defaultLook: next.defaultLook ?? null } : cur));
    } catch (e2) {
      setLookErr(e2 instanceof Error ? e2.message : "Could not remove the default look");
    }
  }

  async function signOut() {
    try {
      await api.logout();
    } catch {
      /* leave regardless */
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.href = "/"; // full navigation clears client state
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/write" className={styles.link}>
          Back
        </Link>
        <h1 className={styles.h1}>Settings</h1>
      </header>

      {loadErr && (
        <div className={styles.error} role="alert">
          <p>{loadErr}</p>
          <button type="button" className={styles.link} onClick={load}>
            Retry
          </button>
        </div>
      )}
      {!s && !loadErr && <p className={styles.muted}>Loading…</p>}

      {s && (
        <form onSubmit={save} className={styles.form}>
          <label className={styles.field}>
            <span className={styles.label}>Site title</span>
            <input value={s.siteTitle} onChange={(e) => set("siteTitle", e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Tagline</span>
            <input value={s.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Author</span>
            <input value={s.author} onChange={(e) => set("author", e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Bio</span>
            <textarea rows={3} value={s.bio} onChange={(e) => set("bio", e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Site URL</span>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              placeholder="https://example.com"
              value={s.siteUrl}
              onChange={(e) => set("siteUrl", e.target.value)}
            />
            <span className={styles.help}>
              The address search engines, link previews, the sitemap and RSS use for every page. Set it to your real
              domain once it is live; until then the Vercel production address is used.
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Voice notes</span>
            <textarea
              className={styles.voice}
              rows={10}
              value={s.voiceNotes}
              onChange={(e) => set("voiceNotes", e.target.value)}
            />
            <span className={styles.help}>
              Describe how you write — phrases you use, things you never say, how formal you are. The writing buddy
              matches this and your published posts.
            </span>
          </label>

          <div className={styles.field}>
            <span className={styles.label}>Default look</span>
            {s.defaultLook ? (
              <div className={styles.lookRow}>
                <span className={styles.lookName}>{s.defaultLook.name}</span>
                <span className={styles.dots} aria-hidden="true">
                  {[
                    s.defaultLook.palette.bg,
                    s.defaultLook.palette.ink,
                    s.defaultLook.palette.accent,
                    s.defaultLook.palette.muted,
                    ...s.defaultLook.palette.extra,
                  ].map((c, i) => (
                    <span key={i} className={styles.dot} style={{ background: c }} />
                  ))}
                </span>
                <button type="button" className={styles.link} onClick={removeDefaultLook}>
                  {armRemove ? "Tap again to remove" : "Remove"}
                </button>
              </div>
            ) : (
              <span className={styles.muted}>None. Posts without their own look use the standard style.</span>
            )}
            {lookErr && (
              <span className={styles.bad} role="alert">
                {lookErr}
              </span>
            )}
            <span className={styles.help}>
              Used by posts that have no look of their own. Set it from a post&rsquo;s Look sheet.
            </span>
          </div>

          <div className={styles.saveRow}>
            <button type="submit" className={styles.primary} disabled={state === "saving"}>
              {state === "saving" ? "Saving…" : "Save"}
            </button>
            <span className={styles.status} role="status">
              {state === "saved" && "Saved"}
              {state === "error" && <span className={styles.bad}>{err}</span>}
            </span>
          </div>
        </form>
      )}

      <footer className={styles.footer}>
        <button type="button" className={styles.link} onClick={signOut}>
          Sign out
        </button>
      </footer>
    </main>
  );
}
