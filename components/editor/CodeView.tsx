"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CodeData } from "@/lib/types";
import { highlightCode, languageLabel } from "./highlight";
import styles from "./CodeView.module.css";

function useHighlighted(code: string, lang: string, skip: boolean): string | null {
  const key = lang + "\u0000" + code;
  const [result, setResult] = useState<{ key: string; html: string | null } | null>(null);
  useEffect(() => {
    if (skip) return;
    let live = true;
    highlightCode(code, lang).then((html) => {
      if (live) setResult({ key: lang + "\u0000" + code, html });
    });
    return () => {
      live = false;
    };
  }, [code, lang, skip]);
  if (skip || !result || result.key !== key) return null;
  return result.html;
}

/** Highlighted code (plain mono until shiki is ready, or for unknown languages). */
export function CodeBody({ code, language, plain = false }: { code: string; language: string; plain?: boolean }) {
  const html = useHighlighted(code, language, plain);
  if (html) return <div className={styles.code} dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <div className={styles.code}>
      <pre className="shiki">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Code figure used inside the editor: filename bar, code, optional collapse, source line. */
export default function CodeView({ data, collapsible = true }: { data: CodeData; collapsible?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !collapsible) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsible, data.code]);

  const collapsed = collapsible && !expanded;
  const src = data.source;
  const srcLines =
    src?.startLine != null
      ? src.endLine != null && src.endLine !== src.startLine
        ? `#L${src.startLine}-L${src.endLine}`
        : `#L${src.startLine}`
      : "";

  return (
    <figure className={styles.figure}>
      <div className={styles.bar}>
        <span className={styles.filename}>{data.filename || "snippet"}</span>
        <span className={styles.lang}>{languageLabel(data.language)}</span>
      </div>
      <div ref={boxRef} className={`${styles.box} ${collapsed ? styles.collapsed : ""}`}>
        <CodeBody code={data.code} language={data.language} />
        {collapsed && overflows && <div className={styles.fade} aria-hidden="true" />}
      </div>
      {collapsible && (overflows || expanded) && (
        <button
          type="button"
          className={styles.more}
          contentEditable={false}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show all"}
        </button>
      )}
      {data.caption && <figcaption className={styles.caption}>{data.caption}</figcaption>}
      {src && (
        <a className={styles.source} href={src.url} target="_blank" rel="noreferrer">
          from {src.repo} &middot; {src.path}
          {srcLines}
        </a>
      )}
    </figure>
  );
}
