"use client";

// Editor views of image and motion genBlocks.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Aspect, ImageData, MotionConfig, MotionData } from "@/lib/types";
import { errorMessage, isAbort, renderMotion, sameStamp } from "@/lib/client/studio";
import { motionThemeFromLook, stampOf } from "@/lib/look";
import MotionPreview from "@/components/motion/MotionPreview";
import { ProgressBar } from "@/components/studio/parts";
import { patchGenBlockData } from "./insert";
import { useLook } from "./LookContext";
import styles from "./MediaView.module.css";

/** The inline progress row (render / restyle): bar + Cancel, or a message + actions. */
export function JobRow({
  progress,
  message,
  error,
  onCancel,
  actions,
}: {
  progress?: { label: string; progress: number };
  message?: string;
  error?: boolean;
  onCancel?(): void;
  actions?: React.ReactNode;
}) {
  return (
    <div className={styles.unrendered}>
      {progress ? (
        <>
          <ProgressBar label={progress.label} progress={progress.progress} />
          {onCancel && (
            <button type="button" className={styles.btn} onClick={onCancel}>
              Cancel
            </button>
          )}
        </>
      ) : (
        <>
          <span className={error ? styles.error : styles.note}>{message}</span>
          {actions}
        </>
      )}
    </div>
  );
}

const ASPECT_RE = /^\d+:\d+$/;

function ratioOf(aspect: Aspect | string | undefined, width?: number, height?: number): string | undefined {
  if (width && height) return `${width} / ${height}`;
  if (aspect && ASPECT_RE.test(aspect)) return aspect.replace(":", " / ");
  return undefined;
}

export function ImageView({ data }: { data: ImageData }) {
  return (
    <figure className={styles.figure}>
      <div className={styles.frame} style={{ aspectRatio: ratioOf(data.aspect) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.fill} src={data.url} alt={data.alt} draggable={false} />
      </div>
      {data.caption && <figcaption className={styles.caption}>{data.caption}</figcaption>}
    </figure>
  );
}

/** Muted looping video that plays only while on screen. */
function VisibleVideo({ src, width, height }: { src: string; width: number; height: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      el.pause();
    };
  }, [src]);
  return (
    <video
      ref={ref}
      className={styles.fill}
      src={src}
      width={width || undefined}
      height={height || undefined}
      muted
      loop
      playsInline
      preload="metadata"
    />
  );
}

type RenderState = { phase: "running"; label: string; progress: number } | { phase: "error"; message: string } | null;

export function MotionView({
  data,
  id,
  editor,
  hideJob = false,
}: {
  data: MotionData;
  id: string;
  editor: Editor;
  /** a restyle shows its own progress row for this block */
  hideJob?: boolean;
}) {
  const [job, setJob] = useState<RenderState>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const configRef = useRef<{ code: string; config: MotionConfig } | null>(null);
  // A deliberate one-off (stamp null) keeps the default theme; otherwise the post look's.
  const { look } = useLook();
  const blockLook = data.look === null ? null : look;
  const theme = useMemo(() => motionThemeFromLook(blockLook), [blockLook]);

  // Leaving (block removed, editor closed) cancels a render in flight.
  useEffect(() => () => ctrlRef.current?.abort(), []);

  const render = () => {
    const code = data.code ?? "";
    const output = data.output;
    if (!code.trim()) return;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setJob({ phase: "running", label: "Starting render", progress: 0 });
    const stamp = blockLook ? stampOf(blockLook) : data.look;
    const startStamp = data.look;
    renderMotion(
      { code, output, ...(blockLook ? { theme } : {}) },
      (ev) => {
        if (ev.type === "progress" && !ctrl.signal.aborted) setJob({ phase: "running", label: ev.label, progress: ev.progress });
      },
      ctrl.signal,
    )
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setJob(null);
        const patch: Record<string, unknown> = { url: d.url, width: d.width, height: d.height };
        if (stamp !== undefined) patch.look = stamp;
        const c = configRef.current;
        if (c && c.code === code) patch.config = c.config;
        // Target the block by id; skip if it was removed or edited meanwhile.
        patchGenBlockData(
          editor,
          id,
          patch,
          (cur) =>
            cur.code === code &&
            cur.output === output &&
            sameStamp(cur.look as MotionData["look"], startStamp) &&
            (cur.look === null) === (startStamp === null),
        );
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted || isAbort(e)) return;
        setJob({ phase: "error", message: errorMessage(e) });
      });
  };

  const cancel = () => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setJob(null);
  };

  const tag = data.output === "gif" ? "GIF" : data.output === "video" ? "Video" : "Loop";

  if (data.url) {
    return (
      <figure className={styles.figure}>
        <div className={styles.frame} style={{ aspectRatio: ratioOf(undefined, data.width, data.height) ?? "16 / 9" }}>
          {data.output === "gif" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.fill} src={data.url} alt={data.alt} draggable={false} />
          ) : (
            <VisibleVideo src={data.url} width={data.width} height={data.height} />
          )}
          <span className={styles.tag}>{tag}</span>
        </div>
        {data.caption && <figcaption className={styles.caption}>{data.caption}</figcaption>}
      </figure>
    );
  }

  if (data.mode === "code" && data.code) {
    const code = data.code;
    return (
      <figure className={styles.figure}>
        <MotionPreview
          code={code}
          theme={theme}
          onStatus={(st) => {
            if (st.ok) configRef.current = { code, config: st.config };
          }}
        />
        {!hideJob &&
          (job?.phase === "running" ? (
            <JobRow progress={job} onCancel={cancel} />
          ) : (
            <JobRow
              error={job?.phase === "error"}
              message={job?.phase === "error" ? job.message : "Not rendered yet — won’t appear on the site"}
              actions={
                <button type="button" className={styles.btn} onClick={render}>
                  {job?.phase === "error" ? "Retry" : "Render"}
                </button>
              }
            />
          ))}
        {data.caption && <figcaption className={styles.caption}>{data.caption}</figcaption>}
      </figure>
    );
  }

  return <div className={styles.missing}>Motion graphic without a video yet. Edit it to generate one.</div>;
}
