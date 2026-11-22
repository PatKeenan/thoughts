import type { CodeData } from "@/lib/types";
import { highlight } from "@/lib/highlight";
import styles from "./render.module.css";

function sourceLabel(s: NonNullable<CodeData["source"]>): string {
  let lines = "";
  if (s.startLine) lines = s.endLine && s.endLine !== s.startLine ? `#L${s.startLine}-L${s.endLine}` : `#L${s.startLine}`;
  return `${s.repo} · ${s.path}${lines}`;
}

function safeUrl(u: string): string | null {
  return /^https?:\/\//i.test(u) ? u : null;
}

export async function CodeFigure({ data }: { data: CodeData }) {
  const html = await highlight(data.code ?? "", data.language || "text");
  const url = data.source ? safeUrl(data.source.url) : null;
  return (
    <figure className={styles.figure}>
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
