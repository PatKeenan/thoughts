"use client";

// Image and motion modes of the studio: preview stages, pickers, alt/caption fields.

import { useCallback, useMemo, useState } from "react";
import type { Aspect, MotionOutput } from "@/lib/types";
import {
  ASPECTS,
  CLIP_ASPECTS,
  CLIP_SECONDS,
  OUTPUTS,
  activeLook,
  currentVersion,
  isBusy,
  type MotionMode,
  type PreviewStatus,
} from "@/lib/client/studio";
import MotionPreview from "@/components/motion/MotionPreview";
import { CodeBody } from "@/components/editor/CodeView";
import { Swatches } from "@/components/editor/LookChip";
import { motionThemeFromLook } from "@/lib/look";
import { HandEditor, ProgressBar, Segmented, Stepper, type Part } from "./parts";
import styles from "./Studio.module.css";
import m from "./Media.module.css";

export const OUTPUT_LABEL: Record<MotionOutput, string> = { loop: "Loop", gif: "GIF", video: "Video" };

const OUTPUT_HINT: Record<MotionOutput, string> = {
  loop: "Loop: silent, autoplays on the site.",
  gif: "GIF: works in RSS and email; larger file, fewer colours.",
  video: "Video: with play controls.",
};

const ratio = (a: Aspect) => a.replace(":", " / ");

export function MediaBody({ s, dispatch, altRef, elapsed }: Part & { altRef: React.Ref<HTMLTextAreaElement>; elapsed: number }) {
  const cur = currentVersion(s);
  const clip = s.mode === "motion" && s.motionMode === "clip";
  const busy = isBusy(s);
  return (
    <>
      {s.mode === "motion" && (
        <div className={m.modeSwitch} role="tablist" aria-label="Kind">
          {(["code", "clip"] as MotionMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={s.motionMode === mode}
              className={`${m.modeTab} ${s.motionMode === mode ? m.modeOn : ""}`}
              disabled={busy && s.motionMode !== mode}
              onClick={() => dispatch({ type: "motionMode", mode })}
            >
              {mode === "code" ? "Animation" : "Video clip"}
            </button>
          ))}
        </div>
      )}

      {s.mode === "image" && <ImageStage s={s} dispatch={dispatch} elapsed={elapsed} />}
      {s.mode === "motion" && !clip && <AnimationStage s={s} dispatch={dispatch} />}
      {clip && <ClipStage s={s} dispatch={dispatch} />}

      <section className={m.controls}>
        <LookRow s={s} dispatch={dispatch} />
        {s.mode === "image" && (
          <Segmented<Aspect>
            label="Aspect"
            value={s.aspect}
            options={ASPECTS}
            onChange={(aspect) => dispatch({ type: "aspect", aspect })}
          />
        )}
        {clip && (
          <>
            <Segmented<Aspect>
              label="Aspect"
              value={s.aspect}
              options={CLIP_ASPECTS}
              disabled={!!s.request}
              onChange={(aspect) => dispatch({ type: "aspect", aspect })}
            />
            <Segmented<number>
              label="Length"
              value={s.seconds}
              options={CLIP_SECONDS}
              disabled={!!s.request}
              render={(n) => `${n} s`}
              onChange={(seconds) => dispatch({ type: "seconds", seconds })}
            />
          </>
        )}
        {s.mode === "motion" && (
          <>
            <Segmented<MotionOutput>
              label="Output"
              value={s.output}
              options={OUTPUTS}
              disabled={s.render?.phase === "running"}
              isDisabled={(o) => clip && o === "gif"}
              render={(o) => OUTPUT_LABEL[o]}
              onChange={(output) => dispatch({ type: "output", output })}
            />
            <p className={m.hint}>{OUTPUT_HINT[s.output]}</p>
            {clip && <p className={m.hint}>GIF is only for animations.</p>}
          </>
        )}
      </section>

      {cur && (
        <section className={m.fields}>
          <label className={m.field}>
            <span className={m.fieldLabel}>
              Alt text <span className={m.fieldNote}>required</span>
            </span>
            <textarea
              ref={altRef}
              className={`${m.fieldInput} ${m.fieldArea} ${s.altError ? m.fieldBad : ""}`}
              rows={2}
              value={s.alt}
              placeholder={s.mode === "image" ? "What the image shows" : "What the animation shows"}
              aria-invalid={!!s.altError || undefined}
              aria-describedby={s.altError ? "studio-alt-error" : undefined}
              onChange={(e) => dispatch({ type: "alt", text: e.target.value })}
            />
            {s.altError && (
              <span id="studio-alt-error" className={m.fieldError} role="alert">
                {s.altError}
              </span>
            )}
          </label>
          <label className={m.field}>
            <span className={m.fieldLabel}>
              Caption <span className={m.fieldNote}>optional</span>
            </span>
            <input
              className={m.fieldInput}
              value={s.caption}
              enterKeyHint="done"
              onChange={(e) => dispatch({ type: "caption", text: e.target.value })}
            />
          </label>
        </section>
      )}
    </>
  );
}

// ---- look ----------------------------------------------------------------------

/** "Use post look" switch with the look's name and swatches. Hidden when the post has no look. */
function LookRow({ s, dispatch }: Part) {
  if (!s.look) return null;
  const on = s.useLook;
  return (
    <div className={m.lookRow}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={m.switch}
        disabled={isBusy(s)}
        onClick={() => dispatch({ type: "useLook", on: !on })}
      >
        <span className={`${m.track} ${on ? m.trackOn : ""}`} aria-hidden="true">
          <span className={m.knob} />
        </span>
        <span className={m.switchLabel}>Use post look</span>
      </button>
      <span className={`${m.lookName} ${on ? "" : m.lookOff}`}>
        <Swatches look={s.look} />
        <span className={m.lookText}>{s.look.name}</span>
      </span>
    </div>
  );
}

// ---- image ---------------------------------------------------------------------

function ImageStage({ s, dispatch, elapsed }: Part & { elapsed: number }) {
  const cur = currentVersion(s);
  const img = cur?.kind === "image" ? cur.data : null;
  const busy = s.request?.kind === "image";
  if (!img && !busy) {
    return (
      <section className={styles.preview}>
        <div className={styles.empty}>
          <p>Describe an illustration for this post. It will match the article unless you say otherwise.</p>
        </div>
      </section>
    );
  }
  const aspect = img ? img.aspect : (s.request?.aspect ?? s.aspect);
  return (
    <section className={styles.preview}>
      <div className={`${m.frame} ${img ? "" : m.skeleton}`} style={{ aspectRatio: ratio(aspect) }}>
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={`${m.fill} ${busy ? m.dim : ""}`} src={img.url} alt={s.alt || img.alt} />
        )}
        {busy && (
          <div className={m.overlay} aria-live="polite">
            <span className={m.overlayText}>Drawing&hellip; {elapsed}s</span>
          </div>
        )}
      </div>
      <div className={styles.previewActions}>
        <span className={m.metaNote}>{img ? img.aspect : ""}</span>
        <Stepper s={s} dispatch={dispatch} />
      </div>
    </section>
  );
}

// ---- animation -------------------------------------------------------------------

function AnimationStage({ s, dispatch }: Part) {
  const [showCode, setShowCode] = useState(false);
  const cur = currentVersion(s);
  const code = cur?.kind === "motion" ? cur.data.code : null;
  const writing = s.request?.kind === "motion";
  const look = activeLook(s);
  const theme = useMemo(() => motionThemeFromLook(look), [look]);
  const onStatus = useCallback(
    (st: PreviewStatus) => {
      if (code !== null) dispatch({ type: "previewStatus", code, status: st });
    },
    [code, dispatch],
  );

  if (code === null) {
    return (
      <section className={styles.preview}>
        {writing ? (
          <div className={`${m.frame} ${m.skeleton}`} style={{ aspectRatio: "16 / 9" }}>
            <div className={m.overlay}>
              <span className={m.overlayText}>Writing animation&hellip;</span>
            </div>
          </div>
        ) : (
          <div className={styles.empty}>
            <p>
              Describe what should move &mdash; e.g. &lsquo;requests flowing from client to server to database, 6 seconds,
              loops&rsquo;.
            </p>
          </div>
        )}
      </section>
    );
  }

  const codeOpen = showCode || s.handEdit;
  return (
    <section className={styles.preview}>
      {writing && (
        <div className={styles.meta}>
          <span className={styles.writing}>Writing animation&hellip;</span>
        </div>
      )}
      <div className={writing ? m.dim : undefined}>
        {/* Only complete versions reach the player; the streaming reply never does. */}
        <MotionPreview code={code} theme={theme} onStatus={onStatus} />
      </div>
      <div className={styles.previewActions}>
        <div className={m.actionGroup}>
          <button
            type="button"
            className={`${styles.textBtn} ${codeOpen ? styles.on : ""}`}
            aria-expanded={codeOpen}
            onClick={() => {
              if (s.handEdit) dispatch({ type: "handEdit", on: false });
              setShowCode(!codeOpen);
            }}
          >
            {codeOpen ? "Hide code" : "View code"}
          </button>
          {codeOpen && (
            <button
              type="button"
              className={`${styles.textBtn} ${s.handEdit ? styles.on : ""}`}
              aria-pressed={s.handEdit}
              disabled={isBusy(s)}
              onClick={() => dispatch({ type: "handEdit", on: !s.handEdit })}
            >
              {s.handEdit ? "Done editing" : "Edit by hand"}
            </button>
          )}
        </div>
        <Stepper s={s} dispatch={dispatch} />
      </div>
      {codeOpen &&
        (s.handEdit ? (
          <HandEditor code={code} dispatch={dispatch} placeholder="TSX module" />
        ) : (
          <div className={styles.codeFrame}>
            <CodeBody code={code} language="tsx" />
          </div>
        ))}
    </section>
  );
}

// ---- clip ------------------------------------------------------------------------

function ClipStage({ s, dispatch }: Part) {
  const cur = currentVersion(s);
  const clip = cur?.kind === "clip" ? cur.data : null;
  const busy = s.request?.kind === "clip";
  if (!clip && !busy) {
    return (
      <section className={styles.preview}>
        <div className={styles.empty}>
          <p>Describe a short clip for the video model. Generating takes a minute or two.</p>
        </div>
      </section>
    );
  }
  const aspect = busy ? (s.request?.aspect ?? s.aspect) : clip!.aspect;
  return (
    <section className={styles.preview}>
      <div className={`${m.frame} ${clip ? "" : m.skeleton}`} style={{ aspectRatio: ratio(clip ? clip.aspect : aspect) }}>
        {clip && (
          <video
            key={clip.url}
            className={`${m.fill} ${busy ? m.dim : ""}`}
            src={clip.url}
            controls={!busy}
            playsInline
            muted
            loop
            preload="metadata"
          />
        )}
        {busy && (
          <div className={m.overlay}>
            <div className={m.overlayBox}>
              <ProgressBar label={s.progress?.label || "Starting"} progress={s.progress?.progress ?? 0} />
            </div>
          </div>
        )}
      </div>
      <div className={styles.previewActions}>
        <span className={m.metaNote}>{clip ? `${clip.seconds} s · ${clip.aspect}` : ""}</span>
        <Stepper s={s} dispatch={dispatch} />
      </div>
    </section>
  );
}

/** Under the header while an animation renders for "Add inline", or after it failed. */
export function RenderBand({
  s,
  dispatch,
  onRetry,
  onSkip,
}: Part & { onRetry(): void; onSkip(): void }) {
  const r = s.render;
  if (!r || r.phase === "done") return null;
  if (r.phase === "running") {
    return (
      <div className={m.band}>
        <ProgressBar label={s.progress?.label || "Rendering"} progress={s.progress?.progress ?? 0} />
        <button type="button" className={styles.textBtn} onClick={() => dispatch({ type: "renderCancel" })}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className={`${m.band} ${m.bandError}`} role="alert">
      <p className={m.bandMsg}>{r.message}</p>
      <div className={m.bandActions}>
        <button type="button" className={styles.textBtn} onClick={onRetry}>
          Retry
        </button>
        <button type="button" className={styles.textBtn} onClick={onSkip}>
          Add without rendering
        </button>
        <button type="button" className={styles.textBtn} onClick={() => dispatch({ type: "renderDismiss" })}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
