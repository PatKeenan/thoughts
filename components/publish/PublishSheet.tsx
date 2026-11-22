"use client";

import { useState } from "react";
import Sheet from "@/components/ui/Sheet";
import { api } from "@/lib/client/api";
import type { Post } from "@/lib/types";
import {
  defaultSchedule,
  formatWhen,
  localInputToISO,
  minSchedule,
  sanitizeSlug,
  toLocalInput,
} from "./datetime";
import styles from "./PublishSheet.module.css";

interface Props {
  open: boolean;
  onClose(): void;
  post: Post;
  onChange(post: Post): void;
  getText(): string;
  flush(): Promise<void>;
}

type Done = { kind: "published" | "scheduled" | "updated" | "unpublished"; post: Post };

export default function PublishSheet({ open, onClose, post, onChange, getText, flush }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title="Publish">
      <Form post={post} onChange={onChange} getText={getText} flush={flush} onClose={onClose} />
    </Sheet>
  );
}

function Form({
  post,
  onChange,
  getText,
  flush,
  onClose,
}: Omit<Props, "open">) {
  const live = post.status !== "draft";
  const [slug, setSlug] = useState(post.slug);
  const [slugTouched, setSlugTouched] = useState(false);
  const [excerpt, setExcerpt] = useState(post.excerpt);
  const [when, setWhen] = useState<"now" | "schedule">(post.status === "scheduled" ? "schedule" : "now");
  const initialLocal =
    post.status === "scheduled" && post.publishAt ? toLocalInput(new Date(post.publishAt)) : defaultSchedule();
  const [local, setLocal] = useState(initialLocal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [titles, setTitles] = useState<string[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const iso = localInputToISO(local);
  const resolved = iso ? formatWhen(iso) : "";
  const cleanSlug = slug.replace(/-+$/, "");
  const scheduleChanged = post.status !== "scheduled" || iso !== post.publishAt;

  async function suggest() {
    setSuggesting(true);
    setError("");
    try {
      const r = await api.meta({ title: post.title, text: getText().slice(0, 6000) });
      setExcerpt(r.excerpt);
      if (!slugTouched && post.slug === "") setSlug(sanitizeSlug(r.slug));
      setTitles(r.titles.slice(0, 3));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get suggestions");
    } finally {
      setSuggesting(false);
    }
  }

  async function copy(t: string, k: number) {
    try {
      await navigator.clipboard.writeText(t);
      setCopied(k);
      window.setTimeout(() => setCopied((c) => (c === k ? null : c)), 1500);
    } catch {
      setError("Could not copy to the clipboard");
    }
  }

  async function submit() {
    setError("");
    if (!post.title.trim()) {
      setError("Give the post a title first.");
      return;
    }
    const wantSchedule = when === "schedule" && post.status !== "published";
    if (wantSchedule && scheduleChanged) {
      if (!iso) {
        setError("Pick a valid date and time.");
        return;
      }
      if (new Date(iso).getTime() < Date.now() + 4 * 60_000) {
        setError("Pick a time at least 5 minutes from now.");
        return;
      }
    }
    setBusy(true);
    try {
      await flush();
      let updated: Post;
      let kind: Done["kind"];
      if (post.status === "published" || (post.status === "scheduled" && !(when === "now") && !scheduleChanged)) {
        updated = await api.patchPost(post.id, { slug: cleanSlug, excerpt });
        kind = "updated";
      } else if (wantSchedule) {
        updated = await api.patchPost(post.id, {
          slug: cleanSlug,
          excerpt,
          status: "scheduled",
          publishAt: iso,
        });
        kind = "scheduled";
      } else {
        updated = await api.patchPost(post.id, {
          slug: cleanSlug,
          excerpt,
          status: "published",
          publishAt: null,
        });
        kind = "published";
      }
      onChange(updated);
      setDone({ kind, post: updated });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);
    setError("");
    try {
      await flush();
      const updated = await api.patchPost(post.id, { status: "draft", publishAt: null });
      onChange(updated);
      setDone({ kind: "unpublished", post: updated });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setConfirmUnpublish(false);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const p = done.post;
    return (
      <div className={styles.done} role="status">
        {done.kind === "published" && (
          <>
            <p className={styles.doneTitle}>It&rsquo;s live.</p>
            <a className={styles.link} href={`/posts/${p.slug}`}>
              /posts/{p.slug}
            </a>
          </>
        )}
        {done.kind === "updated" && (
          <>
            <p className={styles.doneTitle}>Saved.</p>
            {p.status === "published" ? (
              <a className={styles.link} href={`/posts/${p.slug}`}>
                /posts/{p.slug}
              </a>
            ) : (
              p.publishAt && <p className={styles.muted}>Scheduled for {formatWhen(p.publishAt)}, your time.</p>
            )}
          </>
        )}
        {done.kind === "scheduled" && (
          <>
            <p className={styles.doneTitle}>
              Scheduled for {p.publishAt ? formatWhen(p.publishAt) : "later"}, your time.
            </p>
            <p className={styles.muted}>It will appear at /posts/{p.slug}</p>
          </>
        )}
        {done.kind === "unpublished" && <p className={styles.doneTitle}>Back to draft.</p>}
        <button type="button" className={styles.secondary} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  const primaryLabel =
    post.status === "published"
      ? "Update"
      : post.status === "scheduled"
        ? when === "now"
          ? "Publish now"
          : scheduleChanged
            ? "Reschedule"
            : "Update"
        : when === "now"
          ? "Publish now"
          : "Schedule";

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {live && (
        <p className={styles.state}>
          {post.status === "published"
            ? `Published${post.publishAt ? ` ${formatWhen(post.publishAt)}` : ""}.`
            : `Scheduled for ${post.publishAt ? formatWhen(post.publishAt) : "later"}, your time.`}
        </p>
      )}

      <label className={styles.field}>
        <span className={styles.label}>Slug</span>
        <input
          value={slug}
          onChange={(e) => {
            setSlug(sanitizeSlug(e.target.value));
            setSlugTouched(true);
          }}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="from the title"
        />
        <span className={styles.help}>/posts/{cleanSlug || "…"}</span>
        {post.status === "published" && post.slug && slug !== post.slug && (
          <span className={styles.help}>Changing the slug changes the link to this post.</span>
        )}
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Excerpt</span>
        <textarea rows={3} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
        <span className={styles.help}>{excerpt.length} characters, around 160 works well.</span>
      </label>

      <div>
        <button type="button" className={styles.secondary} onClick={suggest} disabled={suggesting}>
          {suggesting ? "Thinking…" : "Suggest"}
        </button>
        {titles.length > 0 && (
          <div className={styles.titles}>
            <span className={styles.label}>Title ideas (tap to copy)</span>
            <div className={styles.chips}>
              {titles.map((t, k) => (
                <button key={k} type="button" className={styles.chip} onClick={() => copy(t, k)}>
                  {t}
                  {copied === k && <span className={styles.copied}> Copied</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {post.status !== "published" && (
        <fieldset className={styles.when}>
          <legend className={styles.label}>When</legend>
          <div className={styles.seg} role="radiogroup" aria-label="When">
            <button
              type="button"
              role="radio"
              aria-checked={when === "now"}
              className={styles.segBtn}
              onClick={() => setWhen("now")}
            >
              Now
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={when === "schedule"}
              className={styles.segBtn}
              onClick={() => setWhen("schedule")}
            >
              Schedule
            </button>
          </div>
          {when === "schedule" && (
            <div className={styles.field}>
              <input
                type="datetime-local"
                value={local}
                min={minSchedule()}
                onChange={(e) => setLocal(e.target.value)}
                aria-label="Publish date and time"
              />
              {resolved && <span className={styles.help}>{resolved}, your time</span>}
            </div>
          )}
        </fieldset>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <button type="submit" className={styles.primary} disabled={busy}>
        {busy ? "Working…" : primaryLabel}
      </button>

      {live &&
        (confirmUnpublish ? (
          <div className={styles.confirm}>
            <span>Take it off the site and make it a draft?</span>
            <button type="button" className={styles.danger} onClick={unpublish} disabled={busy}>
              Unpublish
            </button>
            <button type="button" className={styles.link} onClick={() => setConfirmUnpublish(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className={styles.link} onClick={() => setConfirmUnpublish(true)}>
            Unpublish
          </button>
        ))}
    </form>
  );
}
