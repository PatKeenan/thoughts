"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import Sheet from "@/components/ui/Sheet";
import { safeMediaUrl } from "@/components/render/url";
import { api } from "@/lib/client/api";
import type { FactCheckResult, Verdict } from "@/lib/types";
import { captureClaim, rangeStillMatches, type Capture } from "./range";
import styles from "./FactCheckSheet.module.css";

type Status = "idle" | "loading" | "error" | "done";

const LABELS: Record<Verdict, string> = {
  supported: "Holds up",
  partly: "Partly right",
  disputed: "Disputed",
  unsupported: "No support found",
  unclear: "Couldn't verify",
};

function domainOf(url: string): string {
  try {
    return new URL(url, "https://x.invalid").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export default function FactCheckSheet({
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
  const [cap, setCap] = useState<Capture | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<FactCheckResult | null>(null);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<{ replace?: string; link?: string }>({});
  const [replaced, setReplaced] = useState(false);
  const runId = useRef(0);
  const capRef = useRef<Capture | null>(null);
  const statusRef = useRef<Status>("idle");

  function setStatusBoth(s: Status) {
    statusRef.current = s;
    setStatus(s);
  }

  // Capture the selection at the moment the sheet opens (the state keeps it even when blurred).
  useEffect(() => {
    if (!open) return;
    const { from, to } = editor.state.selection;
    const next = captureClaim(editor.state.doc, from, to);
    const prev = capRef.current;
    // Reopening on the same claim keeps an in-flight or finished result.
    if (prev && next && prev.claim === next.claim && statusRef.current !== "idle") {
      capRef.current = { ...next };
      setCap(capRef.current);
      return;
    }
    // Reopening with an in-flight check and no usable selection also keeps it.
    if (!next && prev && statusRef.current === "loading") return;
    runId.current++;
    capRef.current = next;
    setCap(next);
    setStatusBoth("idle");
    setResult(null);
    setMessage("");
    setNotes({});
    setReplaced(false);
    if (next?.fromCaret) {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, next.from, next.to)),
      );
    }
    // Opening the sheet is the request: check straight away.
    if (next && !next.tooLong) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editor]);

  async function run() {
    const c = capRef.current;
    if (!c || c.tooLong) return;
    const id = ++runId.current;
    setStatusBoth("loading");
    setMessage("");
    setNotes({});
    setReplaced(false);
    try {
      const res = await api.factcheck({ claim: c.claim, context: c.context, title });
      if (id !== runId.current) return;
      setResult(res);
      setStatusBoth("done");
    } catch (e) {
      if (id !== runId.current) return;
      setMessage(e instanceof Error ? e.message : "Something went wrong");
      setStatusBoth("error");
    }
  }

  function replace() {
    const c = capRef.current;
    const correction = result?.correction?.trim();
    if (!c || !correction) return;
    if (!rangeStillMatches(editor.state.doc, c.from, c.to, c.raw)) {
      setNotes((n) => ({ ...n, replace: "Text changed" }));
      return;
    }
    const tr = editor.state.tr.insertText(correction, c.from, c.to);
    editor.view.dispatch(tr);
    const to = c.from + correction.length;
    const raw = editor.state.doc.textBetween(c.from, to, " ");
    capRef.current = { ...c, to, raw, claim: correction };
    setCap(capRef.current);
    setReplaced(true);
    setNotes((n) => ({ ...n, replace: undefined }));
  }

  function linkIt(url: string) {
    const c = capRef.current;
    const href = safeMediaUrl(url);
    if (!c || !href || !/^https?:/i.test(href)) return;
    if (!rangeStillMatches(editor.state.doc, c.from, c.to, c.raw)) {
      setNotes((n) => ({ ...n, link: "Text changed" }));
      return;
    }
    const ok = editor
      .chain()
      .setTextSelection({ from: c.from, to: c.to })
      .setLink({ href })
      .run();
    setNotes((n) => ({ ...n, link: ok ? "Linked" : "Couldn't add the link" }));
  }

  const verdict = result?.verdict;
  const correction = result?.correction?.trim();
  const showCorrection = !!correction && correction !== cap?.claim && !replaced;

  return (
    <Sheet open={open} onClose={onClose} title="Fact check">
      {!cap ? (
        <p className={styles.quiet}>Select a sentence in your post, then tap Check.</p>
      ) : (
        <>
          <blockquote className={styles.quote}>{cap.claim}</blockquote>

          {cap.tooLong && (
            <p className={styles.quiet}>Select a shorter passage — one claim at a time.</p>
          )}

          {status === "idle" && !cap.tooLong && (
            <button type="button" className={styles.primary} onClick={run}>
              Check
            </button>
          )}

          {status === "loading" && (
            <div role="status">
              <p className={styles.quiet}>Checking sources…</p>
              <div className={styles.progress} aria-hidden="true" />
            </div>
          )}

          {status === "error" && (
            <div className={styles.error} role="alert">
              <p>{message}</p>
              <button type="button" className={styles.text} onClick={run}>
                Retry
              </button>
            </div>
          )}

          {status === "done" && result && verdict && (
            <div aria-live="polite">
              <section className={styles.section}>
                <span className={`${styles.verdict} ${styles[verdict] ?? ""}`}>
                  {LABELS[verdict] ?? LABELS.unclear}
                </span>
                <p className={styles.summary}>{result.summary}</p>
              </section>

              {showCorrection && (
                <section className={styles.section}>
                  <h3 className={styles.label}>Suggested wording</h3>
                  <del className={styles.old}>{cap.claim}</del>
                  <span className={styles.new}>{correction}</span>
                  {notes.replace && <p className={styles.note}>{notes.replace}</p>}
                  <div className={styles.row}>
                    <button type="button" className={`${styles.text} ${styles.strong}`} onClick={replace}>
                      Replace in post
                    </button>
                  </div>
                </section>
              )}
              {replaced && <p className={styles.note}>Replaced in your post.</p>}

              {result.sources.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.label}>Sources</h3>
                  <ul className={styles.list}>
                    {result.sources.map((s, k) => {
                      const href = safeMediaUrl(s.url);
                      if (!href) return null;
                      return (
                        <li key={k} className={styles.source}>
                          <a className={styles.sourceMain} href={href} target="_blank" rel="noopener noreferrer">
                            <span className={styles.sourceTitle}>{s.title || domainOf(href)}</span>
                            <span className={styles.domain}>{domainOf(href)}</span>
                          </a>
                          <button type="button" className={styles.text} onClick={() => linkIt(href)}>
                            Link it
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {notes.link && <p className={styles.note}>{notes.link}</p>}
                </section>
              )}

              <div className={styles.row}>
                <button type="button" className={styles.text} onClick={run}>
                  Check again
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
