"use client";

import { FONT_STACKS } from "@/lib/look";
import type { Look } from "@/lib/types";
import CodeSample from "./CodeSample";
import styles from "./LookSheet.module.css";

export function paletteOf(look: Look): string[] {
  const p = look.palette;
  return [p.bg, p.ink, p.accent, p.muted, ...p.extra];
}

/** Small colour dots for lists. */
export function Dots({ look }: { look: Look }) {
  return (
    <span className={styles.dots} aria-hidden="true">
      {paletteOf(look).map((c, i) => (
        <span key={i} className={styles.dot} style={{ background: c }} />
      ))}
    </span>
  );
}

/**
 * The look at a glance. This card is the one place in the app where colours outside the house
 * tokens are expected, so everything here is drawn with inline styles from the look itself.
 */
export default function Specimen({ look }: { look: Look }) {
  const p = look.palette;
  return (
    <div
      className={styles.specimen}
      style={{ background: p.bg, color: p.ink, border: `1px solid ${p.muted}`, borderTop: `4px solid ${p.accent}` }}
      aria-label={`Specimen of the look ${look.name}`}
      role="img"
    >
      <div className={styles.specTitle} style={{ fontFamily: FONT_STACKS[look.typography.title] }}>
        {look.name}
      </div>
      <div style={{ height: 1, background: p.muted, margin: "0.6rem 0" }} />
      <div className={styles.specBody} style={{ fontFamily: FONT_STACKS[look.typography.body] }}>
        A line of body text, as it would read beside the pictures.
      </div>
      <div style={{ display: "flex", gap: 6, margin: "0.7rem 0" }}>
        {p.extra.map((c, i) => (
          <span key={i} style={{ width: 14, height: 14, background: c, border: `1px solid ${p.muted}` }} />
        ))}
        <span style={{ flex: 1, alignSelf: "center", height: 2, background: p.accent }} />
      </div>
      <CodeSample theme={look.codeTheme} />
    </div>
  );
}
