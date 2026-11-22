"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import type { PostSummary } from "@/lib/types";
import styles from "./page.module.css";

const HINT_KEY = "write:a2hs-dismissed";

function relative(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function when(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function WritePage() {
  const router = useRouter();
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [hint, setHint] = useState(false);

  const load = useCallback(async () => {
    setError("");
    setPosts(null);
    try {
      setPosts(await api.listPosts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load posts");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    try {
      const nav = navigator as Navigator & { standalone?: boolean };
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const dismissed = localStorage.getItem(HINT_KEY) === "1";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (ios && nav.standalone !== true && !dismissed) setHint(true);
    } catch {
      /* storage unavailable */
    }
  }, []);

  function dismissHint() {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function create() {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const p = await api.createPost();
      router.push(`/write/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create post");
      setCreating(false);
    }
  }

  async function remove(id: string) {
    setConfirmId(null);
    const before = posts;
    setPosts((p) => (p ? p.filter((x) => x.id !== id) : p));
    try {
      await api.deletePost(id);
    } catch (e) {
      setPosts(before);
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  }

  const groups: { label: string; items: PostSummary[]; kind: "draft" | "scheduled" | "published" }[] = posts
    ? [
        {
          label: "Drafts",
          kind: "draft",
          items: posts.filter((p) => p.status === "draft").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        },
        {
          label: "Scheduled",
          kind: "scheduled",
          items: posts
            .filter((p) => p.status === "scheduled")
            .sort((a, b) => (a.publishAt ?? "").localeCompare(b.publishAt ?? "")),
        },
        {
          label: "Published",
          kind: "published",
          items: posts
            .filter((p) => p.status === "published")
            .sort((a, b) => (b.publishAt ?? "").localeCompare(a.publishAt ?? "")),
        },
      ]
    : [];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.wordmark}>Write</h1>
        <nav className={styles.nav}>
          <Link href="/write/settings" className={styles.textLink}>
            Settings
          </Link>
          <button type="button" className={styles.primary + " " + styles.topNew} onClick={create} disabled={creating}>
            {creating ? "Creating…" : "New post"}
          </button>
        </nav>
      </header>

      {hint && (
        <div className={styles.hint} role="note">
          <p>Add to Home Screen: tap Share, then Add to Home Screen.</p>
          <button type="button" className={styles.textBtn} onClick={dismissHint}>
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button type="button" className={styles.textBtn} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {posts === null && !error && (
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading posts">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.skelRow}>
              <span className={styles.skelLine} style={{ width: `${70 - i * 10}%` }} />
              <span className={styles.skelLine + " " + styles.skelShort} />
            </div>
          ))}
        </div>
      )}

      {posts && posts.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing here yet.</p>
          <p>Start a draft and it will show up here. You can write on your phone and publish from the same screen.</p>
        </div>
      )}

      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.label} className={styles.group}>
              <h2 className={styles.label}>{g.label}</h2>
              <ul className={styles.list}>
                {g.items.map((p) => (
                  <li key={p.id} className={styles.row}>
                    <Link href={`/write/${p.id}`} className={styles.rowMain}>
                      <span className={p.title ? styles.title : styles.title + " " + styles.untitled}>
                        {p.title || "Untitled"}
                      </span>
                      <span className={styles.meta}>
                        {g.kind === "draft" && `edited ${relative(p.updatedAt)}`}
                        {g.kind === "scheduled" && (p.publishAt ? `goes live ${when(p.publishAt)}` : "scheduled")}
                        {g.kind === "published" && (p.publishAt ? day(p.publishAt) : "published")}
                      </span>
                    </Link>
                    <div className={styles.actions}>
                      {g.kind === "published" && p.slug && (
                        <a href={`/posts/${p.slug}`} className={styles.textLink}>
                          View
                        </a>
                      )}
                      {confirmId === p.id ? (
                        <span className={styles.confirm}>
                          <button type="button" className={styles.danger} onClick={() => remove(p.id)}>
                            Delete for good
                          </button>
                          <button type="button" className={styles.textBtn} onClick={() => setConfirmId(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button type="button" className={styles.quiet} onClick={() => setConfirmId(p.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}

      <div className={styles.bar}>
        <button type="button" className={styles.primary + " " + styles.barBtn} onClick={create} disabled={creating}>
          {creating ? "Creating…" : "New post"}
        </button>
      </div>
    </main>
  );
}
