"use client";

import { useEffect, useState } from "react";
import type { StudioAction, StudioState } from "@/lib/client/studio";
import { isBusy } from "@/lib/client/studio";
import styles from "./Studio.module.css";
import m from "./Media.module.css";

export type Part = { s: StudioState; dispatch: React.Dispatch<StudioAction> };

/** "v2 of 3" with previous/next, shown when there is more than one version. */
export function Stepper({ s, dispatch }: Part) {
  if (s.versions.length < 2) return null;
  const busy = isBusy(s);
  return (
    <div className={styles.stepper}>
      <button
        type="button"
        className={styles.stepBtn}
        aria-label="Previous version"
        disabled={s.index <= 0 || busy}
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
        disabled={s.index >= s.versions.length - 1 || busy}
        onClick={() => dispatch({ type: "step", delta: 1 })}
      >
        &rsaquo;
      </button>
    </div>
  );
}

export function HandEditor({
  code,
  dispatch,
  placeholder = "Paste or type code",
}: {
  code: string;
  dispatch: React.Dispatch<StudioAction>;
  placeholder?: string;
}) {
  return (
    <textarea
      className={styles.hand}
      value={code}
      autoFocus
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      wrap="off"
      placeholder={placeholder}
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

/** Label + percentage bar for render/clip jobs. */
export function ProgressBar({ label, progress }: { label: string; progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className={m.progress}>
      <div className={m.progressText}>
        <span className={m.progressLabel}>{label || "Working"}</span>
        <span className={m.progressPct}>{pct}%</span>
      </div>
      <div
        className={m.progressTrack}
        role="progressbar"
        aria-label={label || "Progress"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={m.progressFill} style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
    </div>
  );
}

/** Whole seconds since `key` became non-null (resets when the key changes). */
export function useElapsed(key: number | null): number {
  const [t, setT] = useState<{ key: number; s: number } | null>(null);
  useEffect(() => {
    if (key === null) return;
    const t0 = Date.now();
    const h = setInterval(() => setT({ key, s: Math.floor((Date.now() - t0) / 1000) }), 1000);
    return () => clearInterval(h);
  }, [key]);
  return key !== null && t?.key === key ? t.s : 0;
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  render = (o) => String(o),
  isDisabled,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange(v: T): void;
  render?: (o: T) => React.ReactNode;
  isDisabled?: (o: T) => boolean;
  disabled?: boolean;
}) {
  return (
    <div className={m.segRow}>
      <span className={m.segLabel}>{label}</span>
      <div className={m.seg} role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const off = disabled || !!isDisabled?.(o);
          return (
            <button
              key={String(o)}
              type="button"
              role="radio"
              aria-checked={o === value}
              disabled={off}
              className={`${m.segBtn} ${o === value ? m.segOn : ""}`}
              onClick={() => onChange(o)}
            >
              {render(o)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
