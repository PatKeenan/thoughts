"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SlashController } from "./slash";
import { useViewport } from "./useViewport";
import styles from "./SlashMenu.module.css";

const GAP = 6;
const MARGIN = 8;
const PREFERRED = 260;

export default function SlashMenu({ controller }: { controller: SlashController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const vp = useViewport();
  const listRef = useRef<HTMLDivElement>(null);

  // Caret moved relative to the screen (keyboard opened, page scrolled): re-read it.
  useEffect(() => {
    controller.reposition();
  }, [controller, vp.height, vp.offsetTop]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${state.selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [state.selected]);

  useEffect(() => {
    if (!state.open) return;
    const onScroll = () => controller.reposition();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [controller, state.open]);

  if (!state.open || !state.rect || state.items.length === 0) return null;

  const rect = state.rect;
  const innerW = typeof window !== "undefined" ? window.innerWidth : 390;
  const innerH = typeof window !== "undefined" ? window.innerHeight : 844;
  const visTop = vp.offsetTop + MARGIN;
  const visBottom = vp.offsetTop + (vp.height || innerH) - MARGIN;
  const width = Math.min(320, innerW - MARGIN * 2);
  const left = Math.max(MARGIN, Math.min(rect.left - 12, innerW - width - MARGIN));
  const below = visBottom - (rect.bottom + GAP);
  const above = rect.top - GAP - visTop;
  const placeBelow = below >= Math.min(PREFERRED, state.items.length * 52) || below >= above;

  const style: React.CSSProperties = placeBelow
    ? { left, width, top: rect.bottom + GAP, maxHeight: Math.max(120, below) }
    : { left, width, bottom: innerH - (rect.top - GAP), maxHeight: Math.max(120, above) };

  return (
    <div
      ref={listRef}
      className={styles.menu}
      style={style}
      role="listbox"
      aria-label="Insert"
      onPointerDown={(e) => e.preventDefault()}
    >
      {state.items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="option"
          data-index={i}
          aria-selected={i === state.selected}
          aria-disabled={it.disabled || undefined}
          className={`${styles.item} ${i === state.selected ? styles.active : ""} ${it.disabled ? styles.disabled : ""}`}
          onPointerDown={(e) => e.preventDefault()}
          onMouseEnter={() => controller.hover(i)}
          onClick={() => controller.choose(i)}
        >
          <span className={styles.label}>{it.label}</span>
          <span className={styles.hint}>{it.hint}</span>
        </button>
      ))}
    </div>
  );
}
