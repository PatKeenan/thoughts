"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { CodeData, GenBlockAttrs } from "@/lib/types";
import {
  contextLabel,
  currentVersion,
  errorMessage,
  generateClip,
  generateImage,
  hasCompleteArtifact,
  initStudio,
  isAbort,
  isBusy,
  planCommit,
  previewError,
  renderMotion,
  requestKindOf,
  streamStudio,
  streamingArtifact,
  studioReducer,
  type RequestKind,
  type StudioAction,
  type StudioMode,
  type StudioState,
} from "@/lib/client/studio";
import { extractArtifact } from "@/lib/studio/parse";
import { CodeBody } from "@/components/editor/CodeView";
import RepoView from "@/components/editor/RepoView";
import { LANGUAGES, normalizeLang } from "@/components/editor/highlight";
import { useCoarsePointer, useViewport } from "@/components/editor/useViewport";
import GithubPicker from "./GithubPicker";
import { MediaBody, RenderBand } from "./Media";
import { HandEditor, Stepper, useElapsed, type Part } from "./parts";
import styles from "./Studio.module.css";

export interface StudioOpen {
  key: number;
  mode: StudioMode;
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

const QUICK: Record<RequestKind, string[]> = {
  code: ["Shorter", "Add comments", "Simplify"],
  image: ["Simpler", "More contrast", "Different composition"],
  motion: ["Slower", "Bolder", "Make it loop cleanly"],
  clip: [],
};

const TITLE: Record<StudioMode, string> = {
  code: "Code snippet",
  github: "GitHub",
  image: "Image",
  motion: "Motion graphic",
};

const DISCARD: Record<StudioMode, string> = {
  code: "Discard this snippet?",
  github: "Discard this snippet?",
  image: "Discard this image?",
  motion: "Discard this motion graphic?",
};

export default function Studio({ open, onClose, onCommit, getPostContext }: StudioProps) {
  const [s, dispatch] = useReducer(studioReducer, open, init);
  const vp = useViewport();
  const scrollRef = useRef<HTMLDivElement>(null);
  const altRef = useRef<HTMLTextAreaElement>(null);
  const committedRender = useRef<number | null>(null);
  const editing = open.target.type === "existing";
  const media = s.mode === "image" || s.mode === "motion";

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

  // Run the in-flight request (one effect per request object). Unmount aborts it.
  const req = s.request;
  useEffect(() => {
    if (!req) return;
    const ctrl = new AbortController();
    const fail = (e: unknown) => {
      if (ctrl.signal.aborted || isAbort(e)) return;
      dispatch({ type: "fail", id: req.id, error: errorMessage(e) });
    };
    if (req.kind === "image") {
      generateImage(
        { messages: req.messages, current: req.image, aspect: req.aspect ?? "16:9", post: getPostContext() },
        ctrl.signal,
      )
        .then((r) => dispatch({ type: "imageDone", id: req.id, image: r.image, note: r.note }))
        .catch(fail);
    } else if (req.kind === "clip") {
      generateClip(
        { prompt: req.prompt ?? "", aspect: req.aspect ?? "16:9", seconds: req.seconds ?? 6 },
        (ev) => {
          if (ev.type === "progress") dispatch({ type: "progress", id: req.id, label: ev.label, progress: ev.progress });
        },
        ctrl.signal,
      )
        .then((d) => dispatch({ type: "clipDone", id: req.id, url: d.url, width: d.width, height: d.height }))
        .catch(fail);
    } else {
      streamStudio(
        {
          kind: req.kind,
          messages: req.messages,
          current: req.kind === "code" ? req.current : req.code !== undefined ? { code: req.code } : undefined,
          context: req.kind === "code" && req.context.length ? { files: req.context } : undefined,
          post: getPostContext(),
        },
        { signal: ctrl.signal, onText: (text) => dispatch({ type: "stream", id: req.id, text }) },
      )
        .then((text) => dispatch({ type: "done", id: req.id, text }))
        .catch(fail);
    }
    return () => ctrl.abort();
  }, [req, getPostContext]);

  // Render an animation for "Add inline" (one effect per job; progress lives elsewhere in state).
  const job = s.render?.phase === "running" ? s.render : null;
  useEffect(() => {
    if (!job) return;
    const ctrl = new AbortController();
    renderMotion(
      { code: job.code, output: job.output },
      (ev) => {
        if (ev.type === "progress") dispatch({ type: "renderProgress", id: job.id, label: ev.label, progress: ev.progress });
      },
      ctrl.signal,
    )
      .then((d) => dispatch({ type: "renderDone", id: job.id, url: d.url, width: d.width, height: d.height }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted || isAbort(e)) return;
        dispatch({ type: "renderFail", id: job.id, message: errorMessage(e) });
      });
    return () => ctrl.abort();
  }, [job]);

  // A finished render commits straight away.
  useEffect(() => {
    const r = s.render;
    if (!r || r.phase !== "done" || committedRender.current === r.id) return;
    const plan = planCommit(s);
    if (plan.type === "commit") {
      committedRender.current = r.id;
      onCommit(plan.result);
    } else if (plan.type === "blocked" && plan.reason === "alt") {
      committedRender.current = r.id;
      dispatch({ type: "requireAlt" });
      altRef.current?.focus();
    }
  }, [s, onCommit]);

  const elapsed = useElapsed(req && req.kind === "image" ? req.id : null);

  // Keep the newest turn in view. Media modes keep the preview (top) in view instead,
  // except for errors and the preview's "Fix it", which sit at the end of the thread.
  const threadLen = s.thread.length;
  const perr = s.request ? null : previewError(s);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || (threadLen === 0 && !perr)) return;
    if (media && !s.error && !perr) el.scrollTo({ top: 0, behavior: "smooth" });
    else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [threadLen, s.error, perr, media]);

  const cancel = () => {
    if ((s.dirty || isBusy(s)) && !window.confirm(DISCARD[s.mode])) return;
    onClose();
  };

  const commit = (skipRender = false) => {
    const plan = planCommit(s, { skipRender });
    if (plan.type === "commit") onCommit(plan.result);
    else if (plan.type === "render") dispatch({ type: "renderStart" });
    else if (plan.reason === "alt") {
      dispatch({ type: "requireAlt" });
      const el = altRef.current;
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  };

  const canCommit = !isBusy(s) && hasCompleteArtifact(s);
  const cur = currentVersion(s);
  const title = media ? TITLE[s.mode] : cur?.kind === "repo" || (s.mode === "github" && !cur) ? "GitHub" : "Code snippet";

  const rootStyle: React.CSSProperties = vp.height ? { top: vp.offsetTop, height: vp.height } : {};

  return (
    <div className={styles.root} style={rootStyle} role="dialog" aria-modal="true" aria-label={title}>
      <header className={styles.header}>
        <button type="button" className={styles.headerBtn} onClick={cancel}>
          Cancel
        </button>
        <h2 className={styles.title}>{title}</h2>
        <button type="button" className={styles.commit} onClick={() => commit()} disabled={!canCommit}>
          {s.render?.phase === "running" ? "Rendering" : editing ? "Update" : "Add inline"}
        </button>
      </header>
      {media && <RenderBand s={s} dispatch={dispatch} onRetry={() => commit()} onSkip={() => commit(true)} />}

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
            {media ? (
              <MediaBody s={s} dispatch={dispatch} altRef={altRef} elapsed={elapsed} />
            ) : (
              <Preview s={s} dispatch={dispatch} />
            )}
            <Thread s={s} dispatch={dispatch} elapsed={elapsed} />
            {!media && cur?.kind !== "repo" && <ContextChips s={s} dispatch={dispatch} />}
          </div>
          {cur?.kind !== "repo" && <Composer s={s} dispatch={dispatch} />}
        </>
      )}
    </div>
  );
}


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

  const data: CodeData | null = cur?.kind === "code" ? cur.data : s.handEdit ? { language: "text", code: "" } : null;
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
        <Stepper s={s} dispatch={dispatch} />
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

// ---- thread --------------------------------------------------------------------

function pendingText(s: StudioState, elapsed: number): string {
  const r = s.request;
  if (!r) return "";
  if (r.kind === "image") return `Drawing\u2026 ${elapsed}s`;
  if (r.kind === "clip") return s.progress?.label ? `${s.progress.label}\u2026` : "Starting\u2026";
  const note = s.streamText ? (extractArtifact(s.streamText)?.note ?? s.streamText) : "";
  return note.trim() || "Thinking\u2026";
}

function Thread({ s, dispatch, elapsed }: Part & { elapsed: number }) {
  const perr = s.request ? null : previewError(s);
  if (!s.thread.length && !s.request && !s.error && !perr) return null;
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
                disabled={isBusy(s)}
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
          <p className={`${styles.msg} ${styles.pending}`}>{pendingText(s, elapsed)}</p>
        </div>
      )}
      {perr && !s.error && (
        <div className={styles.errorRow} role="alert">
          <div className={styles.who}>Preview</div>
          <p className={styles.msg}>{perr}</p>
          <div className={styles.errorActions}>
            <button type="button" className={styles.textBtn} onClick={() => dispatch({ type: "fixIt" })}>
              Fix it
            </button>
          </div>
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
  const rendering = s.render?.phase === "running";
  const kind = requestKindOf(s);
  const placeholder =
    kind === "clip"
      ? "Describe the clip\u2026"
      : hasArtifact
        ? "What should change?"
        : kind === "image"
          ? "Describe the image\u2026"
          : kind === "motion"
            ? "Describe the animation\u2026"
            : "Describe the snippet\u2026";

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [s.draft]);

  const send = (text: string) => {
    if (!text.trim() || streaming || rendering) return;
    dispatch({ type: "send", text });
  };

  return (
    <div className={styles.composer}>
      {hasArtifact && !streaming && !rendering && (
        <div className={styles.quick}>
          {QUICK[kind].map((q) => (
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
          placeholder={placeholder}
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
          disabled={!streaming && (!s.draft.trim() || rendering)}
          onPointerDown={(e) => e.preventDefault()}
        >
          {streaming ? "Stop" : kind === "clip" ? "Generate" : "Send"}
        </button>
      </form>
    </div>
  );
}
