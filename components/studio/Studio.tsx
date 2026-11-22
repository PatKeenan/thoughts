"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { CodeData, GenBlockAttrs } from "@/lib/types";
import {
  commitResult,
  contextLabel,
  currentVersion,
  hasCompleteArtifact,
  initStudio,
  streamStudio,
  streamingArtifact,
  studioReducer,
  type StudioAction,
  type StudioState,
} from "@/lib/client/studio";
import { extractArtifact } from "@/lib/studio/parse";
import { CodeBody } from "@/components/editor/CodeView";
import RepoView from "@/components/editor/RepoView";
import { LANGUAGES, normalizeLang } from "@/components/editor/highlight";
import { useCoarsePointer, useViewport } from "@/components/editor/useViewport";
import GithubPicker from "./GithubPicker";
import styles from "./Studio.module.css";

export interface StudioOpen {
  key: number;
  mode: "code" | "github";
  target: { type: "new"; pos: number } | { type: "existing"; id: string; pos: number };
  existing?: GenBlockAttrs;
  /** Re-run the last user request immediately (block footer "Regenerate"). */
  regenerate: boolean;
}

export type StudioCommit = Pick<GenBlockAttrs, "kind" | "data" | "history">;

interface StudioProps {
  open: StudioOpen;
  onClose(): void;
  onCommit(result: StudioCommit): void;
  getPostContext(): { title: string; text: string };
}

function init(open: StudioOpen): StudioState {
  const s = initStudio({ mode: open.mode, existing: open.existing });
  return open.regenerate ? studioReducer(s, { type: "regenerate" }) : s;
}

const QUICK = ["Shorter", "Add comments", "Simplify"];

export default function Studio({ open, onClose, onCommit, getPostContext }: StudioProps) {
  const [s, dispatch] = useReducer(studioReducer, open, init);
  const vp = useViewport();
  const scrollRef = useRef<HTMLDivElement>(null);
  const editing = open.target.type === "existing";

  // Lock the page underneath.
  useEffect(() => {
    const html = document.documentElement;
    const prev = [document.body.style.overflow, html.style.overflow];
    document.body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev[0];
      html.style.overflow = prev[1];
    };
  }, []);

  // Run the in-flight request (one effect per request object).
  const req = s.request;
  useEffect(() => {
    if (!req) return;
    const ctrl = new AbortController();
    streamStudio(
      {
        kind: "code",
        messages: req.messages,
        current: req.current,
        context: req.context.length ? { files: req.context } : undefined,
        post: getPostContext(),
      },
      { signal: ctrl.signal, onText: (text) => dispatch({ type: "stream", id: req.id, text }) },
    )
      .then((text) => dispatch({ type: "done", id: req.id, text }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        const msg = e instanceof Error && e.message && e.name !== "TypeError" ? e.message : "Network error. Check your connection.";
        dispatch({ type: "fail", id: req.id, error: msg });
      });
    return () => ctrl.abort();
  }, [req, getPostContext]);

  // Keep the newest turn in view.
  const threadLen = s.thread.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && threadLen > 0) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [threadLen, s.error]);

  const cancel = () => {
    if ((s.dirty || s.request) && !window.confirm("Discard this snippet?")) return;
    onClose();
  };

  const commit = () => {
    const r = commitResult(s);
    if (r) onCommit(r);
  };

  const canCommit = !s.request && hasCompleteArtifact(s);
  const cur = currentVersion(s);
  const title = cur?.kind === "repo" || (s.mode === "github" && !cur) ? "GitHub" : "Code snippet";

  const rootStyle: React.CSSProperties = vp.height ? { top: vp.offsetTop, height: vp.height } : {};

  return (
    <div className={styles.root} style={rootStyle} role="dialog" aria-modal="true" aria-label={title}>
      <header className={styles.header}>
        <button type="button" className={styles.headerBtn} onClick={cancel}>
          Cancel
        </button>
        <h2 className={styles.title}>{title}</h2>
        <button type="button" className={styles.commit} onClick={commit} disabled={!canCommit}>
          {editing ? "Update" : "Add inline"}
        </button>
      </header>

      {s.view === "github" ? (
        <GithubPicker
          allowRepoCard={s.mode === "github"}
          onRepoCard={(data) => dispatch({ type: "repoCard", data })}
          onUseSnippet={(data) => dispatch({ type: "useSnippet", data })}
          onAttach={(file) => dispatch({ type: "attach", file })}
          onBack={s.versions.length || s.mode === "code" ? () => dispatch({ type: "view", view: "chat" }) : undefined}
        />
      ) : (
        <>
          <div className={styles.scroll} ref={scrollRef}>
            <Preview s={s} dispatch={dispatch} />
            <Thread s={s} dispatch={dispatch} />
            {cur?.kind !== "repo" && <ContextChips s={s} dispatch={dispatch} />}
          </div>
          {cur?.kind !== "repo" && <Composer s={s} dispatch={dispatch} />}
        </>
      )}
    </div>
  );
}

type Part = { s: StudioState; dispatch: React.Dispatch<StudioAction> };

// ---- preview -------------------------------------------------------------------

function Preview({ s, dispatch }: Part) {
  const cur = currentVersion(s);
  const live = streamingArtifact(s);

  if (cur?.kind === "repo") {
    return (
      <section className={styles.preview}>
        <RepoView data={cur.data} />
        <div className={styles.previewActions}>
          <button type="button" className={styles.textBtn} onClick={() => dispatch({ type: "view", view: "github" })}>
            Pick another repo
          </button>
        </div>
      </section>
    );
  }

  if (live) {
    return (
      <section className={styles.preview}>
        <div className={styles.meta}>
          <span className={styles.filename}>{live.filename || (cur?.kind === "code" && cur.data.filename) || "snippet"}</span>
          <span className={styles.writing}>Writing&hellip;</span>
        </div>
        <div className={styles.codeFrame}>
          <CodeBody code={live.code} language={live.language} plain />
        </div>
      </section>
    );
  }

  const data: CodeData | null = cur ? cur.data : s.handEdit ? { language: "text", code: "" } : null;
  if (!data) {
    return (
      <section className={styles.preview}>
        <div className={styles.empty}>
          <p>
            {s.request
              ? "Working on it\u2026"
              : "Describe the snippet below. You can also paste code by hand, or start from a file on GitHub."}
          </p>
          {!s.request && (
            <div className={styles.emptyActions}>
              <button type="button" className={styles.textBtn} onClick={() => dispatch({ type: "handEdit", on: true })}>
                Paste code by hand
              </button>
              <button type="button" className={styles.textBtn} onClick={() => dispatch({ type: "view", view: "github" })}>
                Start from GitHub
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.preview}>
      <div className={`${styles.meta} ${cur ? "" : styles.hidden}`}>
        <FilenameField data={data} dispatch={dispatch} />
        <select
          className={styles.langSelect}
          value={normalizeLang(data.language)}
          onChange={(e) => dispatch({ type: "language", language: e.target.value })}
          aria-label="Language"
        >
          {!LANGUAGES.some((l) => l.id === normalizeLang(data.language)) && (
            <option value={normalizeLang(data.language)}>{data.language}</option>
          )}
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      {s.handEdit ? (
        <HandEditor code={data.code} dispatch={dispatch} />
      ) : (
        <div className={styles.codeFrame}>
          <CodeBody code={data.code} language={data.language} />
        </div>
      )}
      {data.source && (
        <a className={styles.source} href={data.source.url} target="_blank" rel="noreferrer">
          from {data.source.repo} &middot; {data.source.path}
          {data.source.startLine != null ? ` L${data.source.startLine}–${data.source.endLine ?? data.source.startLine}` : ""}
        </a>
      )}
      <div className={styles.previewActions}>
        <button
          type="button"
          className={`${styles.textBtn} ${s.handEdit ? styles.on : ""}`}
          aria-pressed={s.handEdit}
          disabled={!!s.request}
          onClick={() => dispatch({ type: "handEdit", on: !s.handEdit })}
        >
          {s.handEdit ? "Done editing" : "Edit by hand"}
        </button>
        {s.versions.length > 1 && (
          <div className={styles.stepper}>
            <button
              type="button"
              className={styles.stepBtn}
              aria-label="Previous version"
              disabled={s.index <= 0 || !!s.request}
              onClick={() => dispatch({ type: "step", delta: -1 })}
            >
              &lsaquo;
            </button>
            <span className={styles.stepLabel}>
              v{s.index + 1} of {s.versions.length}
            </span>
            <button
              type="button"
              className={styles.stepBtn}
              aria-label="Next version"
              disabled={s.index >= s.versions.length - 1 || !!s.request}
              onClick={() => dispatch({ type: "step", delta: 1 })}
            >
              &rsaquo;
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function FilenameField({ data, dispatch }: { data: CodeData; dispatch: React.Dispatch<StudioAction> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  if (!editing) {
    return (
      <button
        type="button"
        className={styles.filenameBtn}
        onClick={() => {
          setValue(data.filename ?? "");
          setEditing(true);
        }}
        aria-label="Rename file"
      >
        {data.filename || "Add filename"}
      </button>
    );
  }
  const done = () => {
    dispatch({ type: "rename", filename: value });
    setEditing(false);
  };
  return (
    <input
      className={styles.filenameInput}
      value={value}
      autoFocus
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      placeholder="filename.ts"
      onChange={(e) => setValue(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          done();
        } else if (e.key === "Escape") {
          setEditing(false);
        }
      }}
    />
  );
}

function HandEditor({ code, dispatch }: { code: string; dispatch: React.Dispatch<StudioAction> }) {
  return (
    <textarea
      className={styles.hand}
      value={code}
      autoFocus
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      wrap="off"
      placeholder="Paste or type code"
      aria-label="Code"
      onChange={(e) => dispatch({ type: "handText", code: e.target.value })}
      onKeyDown={(e) => {
        // Tab inserts two spaces on desktop instead of leaving the field.
        if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: a, selectionEnd: b, value } = el;
          const next = value.slice(0, a) + "  " + value.slice(b);
          dispatch({ type: "handText", code: next });
          requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
        }
      }}
    />
  );
}

// ---- thread --------------------------------------------------------------------

function Thread({ s, dispatch }: Part) {
  const streamingNote = s.request && s.streamText ? (extractArtifact(s.streamText)?.note ?? s.streamText) : "";
  if (!s.thread.length && !s.request && !s.error) return null;
  return (
    <section className={styles.thread} aria-label="Conversation" aria-live="polite">
      {s.thread.map((t, i) => (
        <div key={i} className={t.role === "user" ? styles.user : styles.assistant}>
          <div className={styles.who}>
            {t.role === "user" ? "You" : "Studio"}
            {t.role === "assistant" && t.version !== undefined && (
              <button
                type="button"
                className={`${styles.chip} ${s.index === t.version ? styles.chipOn : ""}`}
                onClick={() => dispatch({ type: "go", index: t.version! })}
                disabled={!!s.request}
                aria-label={`Show version ${t.version + 1}`}
              >
                v{t.version + 1}
              </button>
            )}
          </div>
          <p className={styles.msg}>{t.content}</p>
        </div>
      ))}
      {s.request && (
        <div className={styles.assistant}>
          <div className={styles.who}>Studio</div>
          <p className={`${styles.msg} ${styles.pending}`}>{streamingNote.trim() || "Thinking…"}</p>
        </div>
      )}
      {s.error && (
        <div className={styles.errorRow} role="alert">
          <p className={styles.msg}>{s.error}</p>
          <div className={styles.errorActions}>
            {s.thread.at(-1)?.role === "user" && (
              <button type="button" className={styles.textBtn} onClick={() => dispatch({ type: "retry" })}>
                Retry
              </button>
            )}
            <button type="button" className={styles.textBtn} onClick={() => dispatch({ type: "dismissError" })}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- context chips -----------------------------------------------------------------

function ContextChips({ s, dispatch }: Part) {
  return (
    <section className={styles.context}>
      {s.context.map((f, i) => (
        <span key={`${f.repo}:${f.path}:${f.startLine ?? ""}:${f.endLine ?? ""}`} className={styles.ctxChip}>
          <span className={styles.ctxLabel}>{contextLabel(f)}</span>
          <button
            type="button"
            className={styles.ctxRemove}
            aria-label={`Remove ${contextLabel(f)}`}
            onClick={() => dispatch({ type: "detach", index: i })}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </span>
      ))}
      <button type="button" className={styles.attach} onClick={() => dispatch({ type: "view", view: "github" })}>
        Attach from GitHub
      </button>
    </section>
  );
}

// ---- composer ------------------------------------------------------------------

function Composer({ s, dispatch }: Part) {
  const coarse = useCoarsePointer();
  const ref = useRef<HTMLTextAreaElement>(null);
  const hasArtifact = hasCompleteArtifact(s);
  const canRegenerate = s.thread.some((t) => t.role === "user");
  const streaming = !!s.request;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [s.draft]);

  const send = (text: string) => {
    if (!text.trim() || streaming) return;
    dispatch({ type: "send", text });
  };

  return (
    <div className={styles.composer}>
      {hasArtifact && !streaming && (
        <div className={styles.quick}>
          {QUICK.map((q) => (
            <button key={q} type="button" className={styles.quickChip} onPointerDown={(e) => e.preventDefault()} onClick={() => send(q)}>
              {q}
            </button>
          ))}
          {canRegenerate && (
            <button
              type="button"
              className={styles.quickChip}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => dispatch({ type: "regenerate" })}
            >
              Regenerate
            </button>
          )}
        </div>
      )}
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (streaming) dispatch({ type: "stop" });
          else send(s.draft);
        }}
      >
        <textarea
          ref={ref}
          className={styles.input}
          rows={1}
          value={s.draft}
          placeholder={hasArtifact ? "What should change?" : "Describe the snippet…"}
          aria-label="Message"
          enterKeyHint={coarse ? "enter" : "send"}
          onChange={(e) => dispatch({ type: "draft", text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(s.draft);
            }
          }}
        />
        <button
          type="submit"
          className={streaming ? styles.stop : styles.send}
          disabled={!streaming && !s.draft.trim()}
          onPointerDown={(e) => e.preventDefault()}
        >
          {streaming ? "Stop" : "Send"}
        </button>
      </form>
    </div>
  );
}
