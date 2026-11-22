import type { CSSProperties } from "react";
import type { CodeData } from "@/lib/types";
import { highlightThemed } from "@/lib/highlight";
import styles from "./render.module.css";

function sourceLabel(s: NonNullable<CodeData["source"]>): string {
  let lines = "";
  if (s.startLine) lines = s.endLine && s.endLine !== s.startLine ? `#L${s.startLine}-L${s.endLine}` : `#L${s.startLine}`;
  return `${s.repo} · ${s.path}${lines}`;
}

function safeUrl(u: string): string | null {
  return /^https?:\/\//i.test(u) ? u : null;
}

export async function CodeFigure({ data, theme }: { data: CodeData; theme?: string | null }) {
  const { html, bg, fg } = await highlightThemed(data.code ?? "", data.language || "text", theme);
  // The figure's own colours come from the shiki theme; the CSS falls back to the tokens.
  const colors = { "--fig-bg": bg, "--fig-ink": fg } as CSSProperties;
  const url = data.source ? safeUrl(data.source.url) : null;
  return (
    <figure className={styles.figure} style={colors}>
      {data.filename ? <div className={styles.filename}>{data.filename}</div> : null}
      <div className={styles.code} dangerouslySetInnerHTML={{ __html: html }} />
      {data.source ? (
        <div className={styles.source}>
          <span>from </span>
          {url ? (
            <a href={url} rel="noopener noreferrer">
              {sourceLabel(data.source)}
            </a>
          ) : (
            <span>{sourceLabel(data.source)}</span>
          )}
        </div>
      ) : null}
      {data.caption ? <figcaption className={styles.caption}>{data.caption}</figcaption> : null}
    </figure>
  );
}
