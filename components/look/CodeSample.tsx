"use client";

import { useEffect, useState } from "react";
import { SAMPLE_CODE, sampleFor, type Sample } from "./sample";
import styles from "./LookSheet.module.css";

/** Three lines of code drawn in a code theme: its own background and text colour, like the site. */
export default function CodeSample({ theme }: { theme: string }) {
  const [res, setRes] = useState<{ theme: string; sample: Sample | null } | null>(null);

  useEffect(() => {
    let alive = true;
    void sampleFor(theme).then((sample) => {
      if (alive) setRes({ theme, sample });
    });
    return () => {
      alive = false;
    };
  }, [theme]);

  const sample = res && res.theme === theme ? res.sample : null;
  if (!sample) {
    return (
      <pre className={styles.samplePlain} aria-label="Code sample">
        <code>{SAMPLE_CODE}</code>
      </pre>
    );
  }
  return (
    <div
      className={styles.sample}
      style={{ background: sample.bg, color: sample.fg }}
      aria-label="Code sample"
      dangerouslySetInnerHTML={{ __html: sample.html }}
    />
  );
}
