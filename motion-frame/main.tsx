// Motion preview frame. Built by scripts/build-motion-frame.mjs into
// public/motion-frame.{html,js}; embedded by components/motion/MotionPreview
// in <iframe sandbox="allow-scripts"> (opaque origin, strict CSP, no network).
// Protocol: parent → {type:"code", code, theme?} (theme is re-validated here); frame → {type:"ready"} | {type:"ok", config} | {type:"error", message}.
import { Player, type PlayerRef } from "@remotion/player";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { evaluateMotion, type EvaluatedMotion } from "../remotion/evaluate";
import { sanitizeTheme } from "../remotion/theme";
import { DEFAULT_MOTION_THEME } from "../lib/look";
import type { MotionConfig, MotionTheme } from "../lib/types";

type Out = { type: "ready" } | { type: "ok"; config: MotionConfig } | { type: "error"; message: string };

// Opaque origin: the parent can't be named as a target origin; it validates event.source instead.
const post = (m: Out) => window.parent.postMessage(m, "*");
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message || e.name : typeof e === "string" ? e : "Unknown error";
const postError = (e: unknown) => post({ type: "error", message: errorMessage(e) });

window.addEventListener("error", (e) => postError(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => postError(e.reason));
document.addEventListener("securitypolicyviolation", (e) => {
  if (e.blockedURI === "data" || e.blockedURI === "blob") return; // player internals, not network
  const what = e.blockedURI && e.blockedURI !== "inline" ? ` (${e.blockedURI})` : "";
  postError(`Blocked: motion code may not load anything from the network${what}.`);
});

type Entry = EvaluatedMotion & { id: number };
let nextId = 0;

class Boundary extends Component<{ onError(e: unknown): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Report({ error, onError }: { error: Error; onError(e: unknown): void }) {
  useEffect(() => onError(error), [error, onError]);
  return null;
}

function Scrub({ player, entry }: { player: PlayerRef | null; entry: Entry }) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const barRef = useRef<HTMLDivElement>(null);
  const total = entry.config.durationInFrames;

  useEffect(() => {
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [player]);

  const seek = (clientX: number) => {
    const el = barRef.current;
    if (!el || !player) return;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    player.seekTo(Math.round(t * (total - 1)));
  };

  return (
    <>
      {!playing && (
        <svg width="28" height="28" viewBox="0 0 28 28" aria-label="Paused" style={{ position: "absolute", left: 8, top: 8, pointerEvents: "none", opacity: 0.85 }}>
          <circle cx="14" cy="14" r="13" fill="rgba(0,0,0,.45)" />
          <path d="M11 8.5v11l9-5.5z" fill="#fff" />
        </svg>
      )}
      <div
        ref={barRef}
        role="slider"
        aria-label="Scrub"
        aria-valuemin={0}
        aria-valuemax={total - 1}
        aria-valuenow={frame}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(e.clientX);
        }}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 14, cursor: "pointer", touchAction: "none" }}
      >
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "rgba(0,0,0,.18)" }}>
          <div style={{ height: "100%", width: `${(frame / Math.max(1, total - 1)) * 100}%`, background: "#d6452b" }} />
        </div>
      </div>
    </>
  );
}

function App() {
  const [shown, setShown] = useState<Entry | null>(null);
  const [theme, setTheme] = useState<MotionTheme>(DEFAULT_MOTION_THEME);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const good = useRef<Entry | null>(null); // last entry that played without error
  const shownRef = useRef<Entry | null>(null);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const d = e.data as { type?: unknown; code?: unknown; theme?: unknown } | null;
      if (!d || d.type !== "code" || typeof d.code !== "string") return;
      try {
        const ev = evaluateMotion(d.code);
        setTheme(sanitizeTheme(d.theme)); // theme-only change: same Component, so no remount
        if (shownRef.current?.Component === ev.Component) {
          post({ type: "ok", config: ev.config });
          return;
        }
        setShown({ ...ev, id: ++nextId });
        post({ type: "ok", config: ev.config });
      } catch (err) {
        postError(err); // keep whatever is on screen
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Promote to "good" once it has played a moment without throwing.
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => {
      good.current = shown;
    }, 700);
    return () => clearTimeout(t);
  }, [shown]);

  const onRuntimeError = useCallback((err: unknown) => {
    postError(err);
    const g = good.current;
    const cur = shownRef.current;
    if (g && cur && g.id !== cur.id) setShown(g); // fall back to the last good render
  }, []);

  if (!shown) return null;
  const { config } = shown;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Boundary key={shown.id} onError={onRuntimeError}>
        <Player
          key={shown.id}
          ref={setPlayer}
          component={shown.Component}
          inputProps={{ theme }}
          durationInFrames={config.durationInFrames}
          fps={config.fps}
          compositionWidth={config.width}
          compositionHeight={config.height}
          style={{ width: "100%", height: "100%" }}
          loop
          autoPlay
          initiallyMuted
          numberOfSharedAudioTags={0}
          controls={false}
          clickToPlay
          doubleClickToFullscreen={false}
          spaceKeyToPlayOrPause
          acknowledgeRemotionLicense
          errorFallback={({ error }) => <Report error={error} onError={onRuntimeError} />}
        />
        <Scrub player={player} entry={shown} />
      </Boundary>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
