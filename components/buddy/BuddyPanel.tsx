"use client";

import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import Sheet from "@/components/ui/Sheet";
import { api } from "@/lib/client/api";
import type { BuddyMode, BuddyResult, BuddySuggestion } from "@/lib/types";
import { collectParagraphs, locateQuote } from "./positions";
import styles from "./BuddyPanel.module.css";

type ItemState = "pending" | "stale";
type Status = "idle" | "loading" | "error" | "done";

export default function BuddyPanel({
  open,
  onClose,
  editor,
  title,
}: {
  open: boolean;
  onClose(): void;
  editor: Editor;
  title: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<BuddyMode>("polish");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [items, setItems] = useState<{ s: BuddySuggestion; state: ItemState }[]>([]);
  const positions = useRef<Map<number, number>>(new Map());
  const runId = useRef(0);

  const run = useCallback(
    async (m: BuddyMode) => {
      const id = ++runId.current;
      setMode(m);
      setNotes([]);
      setItems([]);
      setMessage("");
      const { paragraphs, positions: map } = collectParagraphs(editor.state.doc);
      positions.current = map;
      const total = paragraphs.reduce((n, p) => n + p.text.length, 0);
      if (total < 40) {
        setStatus("error");
        setMessage("Write a little more first.");
        return;
      }
      setStatus("loading");
      try {
        const res: BuddyResult = await api.buddy({ mode: m, title, paragraphs });
        if (id !== runId.current) return;
        setNotes(res.notes ?? []);
        setItems((res.suggestions ?? []).map((s) => ({ s, state: "pending" as ItemState })));
        setStatus("done");
      } catch (e) {
        if (id !== runId.current) return;
        setMessage(e instanceof Error ? e.message : "Something went wrong");
        setStatus("error");
      }
    },
    [editor, title],
  );

  function remove(id: string) {
    setItems((cur) => cur.filter((x) => x.s.id !== id));
  }

  function markStale(id: string) {
    setItems((cur) => cur.map((x) => (x.s.id === id ? { ...x, state: "stale" } : x)));
  }

  function accept(s: BuddySuggestion) {
    const hit = locateQuote(editor.state.doc, s.quote, s.i, positions.current.get(s.i));
    if (!hit) {
      markStale(s.id);
      return;
    }
    const tr = editor.state.tr.insertText(s.replacement, hit.from, hit.to);
    editor.view.dispatch(tr);
    remove(s.id);
  }

  function acceptAll() {
    const doc = editor.state.doc;
    const found: { id: string; from: number; to: number; r: string }[] = [];
    const missed: string[] = [];
    for (const x of items) {
      if (x.state !== "pending") continue;
      const hit = locateQuote(doc, x.s.quote, x.s.i, positions.current.get(x.s.i));
      if (hit) found.push({ id: x.s.id, from: hit.from, to: hit.to, r: x.s.replacement });
      else missed.push(x.s.id);
    }
    // Apply back to front so earlier positions stay valid; skip overlaps.
    found.sort((a, b) => b.from - a.from);
    const tr = editor.state.tr;
    const applied = new Set<string>();
    let limit = Infinity;
    for (const f of found) {
      if (f.to > limit) {
        missed.push(f.id);
        continue;
      }
      tr.insertText(f.r, f.from, f.to);
      limit = f.from;
      applied.add(f.id);
    }
    if (applied.size > 0) editor.view.dispatch(tr);
    const missedSet = new Set(missed);
    setItems((cur) =>
      cur
        .filter((x) => !applied.has(x.s.id))
        .map((x) => (missedSet.has(x.s.id) ? { ...x, state: "stale" as ItemState } : x)),
    );
  }

  function show(s: BuddySuggestion) {
    const hit = locateQuote(editor.state.doc, s.quote, s.i, positions.current.get(s.i));
    if (!hit) {
      markStale(s.id);
      return;
    }
    onClose();
    window.setTimeout(() => {
      editor.chain().focus().setTextSelection({ from: hit.from, to: hit.to }).scrollIntoView().run();
    }, 60);
  }

  const pending = items.filter((x) => x.state === "pending").length;

  return (
    <Sheet open={open} onClose={onClose} title="Writing buddy">
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          aria-pressed={status !== "idle" && mode === "polish"}
          onClick={() => run("polish")}
          disabled={status === "loading"}
        >
          <span className={styles.actionName}>Polish</span>
          <span className={styles.actionHint}>Grammar and clarity</span>
        </button>
        <button
          type="button"
          className={styles.action}
          aria-pressed={status !== "idle" && mode === "structure"}
          onClick={() => run("structure")}
          disabled={status === "loading"}
        >
          <span className={styles.actionName}>Structure</span>
          <span className={styles.actionHint}>Flow and gaps</span>
        </button>
      </div>

      {status === "idle" && (
        <p className={styles.quiet}>
          The buddy points out small things. You decide on each one, and your words stay yours.
        </p>
      )}

      {status === "loading" && (
        <p className={styles.quiet} role="status">
          Reading your draft…
        </p>
      )}

      {status === "error" && (
        <div className={styles.error} role="alert">
          <p>{message}</p>
          {message !== "Write a little more first." && (
            <button type="button" className={styles.text} onClick={() => run(mode)}>
              Retry
            </button>
          )}
        </div>
      )}

      {status === "done" && (
        <div aria-live="polite">
          {notes.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.label}>Notes</h3>
              {notes.map((n, k) => (
                <p key={k} className={styles.note}>
                  {n}
                </p>
              ))}
            </section>
          )}

          {items.length > 0 && (
            <section className={styles.section}>
              <div className={styles.listHead}>
                <h3 className={styles.label}>Suggestions</h3>
                {mode === "polish" && pending >= 3 && (
                  <button type="button" className={styles.text} onClick={acceptAll}>
                    Accept all
                  </button>
                )}
              </div>
              <ul className={styles.list}>
                {items.map(({ s, state }) => (
                  <li key={s.id} className={styles.item}>
                    <span className={styles.tag}>{s.category}</span>
                    {state === "stale" ? (
                      <>
                        <p className={styles.old}>{s.quote}</p>
                        <p className={styles.stale}>Text changed — skipped</p>
                        <button type="button" className={styles.text} onClick={() => remove(s.id)}>
                          Dismiss
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className={styles.diff} onClick={() => show(s)}>
                          <del className={styles.old}>{s.quote}</del>
                          <span className={styles.new}>{s.replacement || "(remove)"}</span>
                        </button>
                        {s.reason && <p className={styles.reason}>{s.reason}</p>}
                        <div className={styles.row}>
                          <button type="button" className={styles.accept} onClick={() => accept(s)}>
                            Accept
                          </button>
                          <button type="button" className={styles.text} onClick={() => remove(s.id)}>
                            Skip
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pending === 0 && <p className={styles.done}>That&rsquo;s everything.</p>}
        </div>
      )}
    </Sheet>
  );
}
