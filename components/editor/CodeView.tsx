"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { codeThemeOf } from "@/lib/look";
import type { CodeData } from "@/lib/types";
import { highlightCode, languageLabel, themeColors, themeColorsSync, type ThemeColors } from "./highlight";
import { useLook } from "./LookContext";
import styles from "./CodeView.module.css";

function useHighlighted(code: string, lang: string, skip: boolean, theme?: string): string | null {
  const key = lang + "\u0000" + (theme ?? "") + "\u0000" + code;
  const [result, setResult] = useState<{ key: string; html: string | null } | null>(null);
  useEffect(() => {
    if (skip) return;
    let live = true;
    highlightCode(code, lang, theme).then((html) => {
      if (live) setResult({ key: lang + "\u0000" + (theme ?? "") + "\u0000" + code, html });
    });
    return () => {
      live = false;
    };
  }, [code, lang, skip, theme]);
  if (skip || !result) return null;
  // While a new theme loads, keep showing the old colours rather than flashing plain text.
  if (result.key !== key && !result.key.endsWith("\u0000" + code)) return null;
  return result.html;
}

/**
 * CSS variables that colour a code surface in a shiki theme's own bg/fg
 * (undefined theme → the house --code-bg/--code-ink, unchanged).
 */
export function useCodeThemeVars(theme: string | undefined): React.CSSProperties | undefined {
  const [loaded, setLoaded] = useState<{ theme: string; c: ThemeColors } | null>(null);
  useEffect(() => {
    if (!theme || themeColorsSync(theme)) return;
    let live = true;
    themeColors(theme).then((c) => {
      if (live && c) setLoaded({ theme, c });
    });
    return () => {
      live = false;
    };
  }, [theme]);
  if (!theme) return undefined;
  const c = themeColorsSync(theme) ?? (loaded?.theme === theme ? loaded.c : null);
  return c ? ({ "--code-bg": c.bg, "--code-ink": c.fg } as React.CSSProperties) : undefined;
}

/** Highlighted code (plain mono until shiki is ready, or for unknown languages). */
export function CodeBody({
  code,
  language,
  plain = false,
  theme,
}: {
  code: string;
  language: string;
  plain?: boolean;
  /** shiki theme id; default vitesse-dark */
  theme?: string;
}) {
  const html = useHighlighted(code, language, plain, theme);
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
  // Code follows the post look's code theme; with no look it keeps the house colours.
  const { look } = useLook();
  const theme = look ? codeThemeOf(look) : undefined;
  const themeVars = useCodeThemeVars(theme);
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
    <figure className={styles.figure} style={themeVars}>
      <div className={styles.bar}>
        <span className={styles.filename}>{data.filename || "snippet"}</span>
        <span className={styles.lang}>{languageLabel(data.language)}</span>
      </div>
      <div ref={boxRef} className={`${styles.box} ${collapsed ? styles.collapsed : ""}`}>
        <CodeBody code={data.code} language={data.language} theme={theme} />
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
