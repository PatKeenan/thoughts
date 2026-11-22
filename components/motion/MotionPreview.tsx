"use client";

// Live preview of AI-written motion code. The code runs only inside
// public/motion-frame.html, loaded in <iframe sandbox="allow-scripts">: an
// opaque origin with a no-network CSP, so it can never touch the session.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { MotionConfig } from "@/lib/types";
import styles from "./MotionPreview.module.css";

export type MotionStatus = { ok: true; config: MotionConfig } | { ok: false; message: string };

type FrameMessage =
  | { type: "ready" }
  | { type: "ok"; config: MotionConfig }
  | { type: "error"; message: string };

const FRAME_SRC = "/motion-frame.html";
const DEBOUNCE_MS = 300;

export default function MotionPreview({
  code,
  onStatus,
}: {
  code: string;
  onStatus?(s: MotionStatus): void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const latest = useRef(code); // newest code, queued while the frame loads
  const posted = useRef<string | null>(null);
  const onStatusRef = useRef(onStatus);
  const [status, setStatus] = useState<MotionStatus | null>(null);
  const [good, setGood] = useState<MotionConfig | null>(null);

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  const flush = useCallback(() => {
    const win = frameRef.current?.contentWindow;
    const next = latest.current;
    if (!ready.current || !win || !next.trim() || next === posted.current) return;
    posted.current = next;
    win.postMessage({ type: "code", code: next }, "*"); // opaque origin: "*" is the only target
  }, []);

  useEffect(() => {
    latest.current = code;
    const t = setTimeout(flush, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [code, flush]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const d = e.data as FrameMessage | null;
      if (!d || typeof d !== "object") return;
      if (d.type === "ready") {
        ready.current = true;
        posted.current = null; // fresh frame (first load or reload)
        flush();
      } else if (d.type === "ok" && d.config) {
        const s: MotionStatus = { ok: true, config: d.config };
        setStatus(s);
        setGood(d.config);
        onStatusRef.current?.(s);
      } else if (d.type === "error") {
        const s: MotionStatus = { ok: false, message: String(d.message || "Unknown error") };
        setStatus(s);
        onStatusRef.current?.(s);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [flush]);

  const ar = good ? good.width / good.height : 16 / 9;
  // Tall compositions are limited by height (60dvh), wide ones by the column width.
  const boxStyle = { aspectRatio: String(ar), "--ar": String(ar) } as CSSProperties;

  return (
    <div className={styles.root}>
      <div className={styles.box} style={boxStyle}>
        <iframe
          ref={frameRef}
          className={styles.frame}
          src={FRAME_SRC}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title="Motion preview"
        />
      </div>
      {status && !status.ok && (
        <p className={styles.error} role="status" aria-live="polite">
          {status.message}
        </p>
      )}
    </div>
  );
}
