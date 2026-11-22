"use client";

// "LOOK · name" under the title, the swatch strip, and the notice line beneath it.

import type { Look } from "@/lib/types";
import type { LookNotice } from "./useLookState";
import styles from "./LookChip.module.css";

/** Four tiny swatches drawn from the look itself (the one place colours outside the house tokens are expected). */
export function Swatches({ look, className }: { look: Look; className?: string }) {
  const p = look.palette;
  return (
    <span className={`${styles.swatches} ${className ?? ""}`} aria-hidden="true">
      {[p.bg, p.ink, p.accent, p.muted].map((c, i) => (
        <span key={i} className={styles.swatch} style={{ background: c }} />
      ))}
    </span>
  );
}

export default function LookChip({
  look,
  inherited,
  offLook,
  restyling,
  notice,
  onOpen,
  onDismissNotice,
}: {
  look: Look | null;
  inherited: boolean;
  offLook: number;
  restyling: boolean;
  notice: LookNotice | null;
  onOpen(): void;
  onDismissNotice(): void;
}) {
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.chip}
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={look ? `Look: ${look.name}${offLook ? `, ${offLook} to restyle` : ""}. Change` : "Look: none yet. Set one"}
      >
        <span className={styles.label}>Look</span>
        <span className={styles.dot} aria-hidden="true">
          &middot;
        </span>
        {look ? (
          <>
            <Swatches look={look} />
            <span className={styles.name}>
              {look.name}
              {inherited && <span className={styles.muted}> (default)</span>}
            </span>
            {offLook > 0 && (
              <span className={styles.off}>
                &middot; {restyling ? "restyling" : `${offLook} to restyle`}
              </span>
            )}
          </>
        ) : (
          <span className={styles.none}>none yet</span>
        )}
      </button>
      {notice && (
        <p className={styles.notice} role="status" key={notice.key}>
          <span className={styles.noticeText}>{notice.text}</span>
          {notice.change ? (
            <button
              type="button"
              className={styles.noticeBtn}
              onClick={() => {
                onDismissNotice();
                onOpen();
              }}
            >
              Change
            </button>
          ) : (
            <button type="button" className={styles.noticeBtn} onClick={onDismissNotice} aria-label="Dismiss">
              OK
            </button>
          )}
        </p>
      )}
    </div>
  );
}
