import type { ReactNode } from "react";
import type { CodeData, DocNode, GenBlockAttrs, ImageData, MotionData, RepoData } from "@/lib/types";
import { CodeFigure } from "./CodeFigure";
import { ImageFigure } from "./ImageFigure";
import { MotionFigure } from "./MotionFigure";
import { RepoCard } from "./RepoCard";
import styles from "./render.module.css";

/** Only http(s), mailto and relative hrefs survive; anything else is dropped. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const h = href.trim();
  if (!h) return null;
  if (/^(https?:|mailto:)/i.test(h)) return h;
  // Relative: no scheme, not protocol-relative.
  if (h.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  // Strip control chars/whitespace tricks like "java\nscript:" which fail the scheme test above.
  if (/[\u0000-\u001f]/.test(h)) return null;
  return h;
}

function renderText(node: DocNode, key: number): ReactNode {
  let out: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        out = <strong>{out}</strong>;
        break;
      case "italic":
        out = <em>{out}</em>;
        break;
      case "strike":
        out = <s>{out}</s>;
        break;
      case "code":
        out = <code className={styles.inlineCode}>{out}</code>;
        break;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        if (href) {
          out = (
            <a href={href} rel="noopener noreferrer">
              {out}
            </a>
          );
        }
        break;
      }
    }
  }
  return <FragmentKeyed key={key}>{out}</FragmentKeyed>;
}

function renderChildren(node: DocNode): ReactNode[] {
  return (node.content ?? []).map((child, i) => renderNode(child, i));
}

function renderNode(node: DocNode, key: number): ReactNode {
  switch (node.type) {
    case "text":
      return renderText(node, key);
    case "hardBreak":
      return <br key={key} />;
    case "paragraph":
      return <p key={key}>{renderChildren(node)}</p>;
    case "heading": {
      const level = node.attrs?.level === 3 ? 3 : 2;
      const kids = renderChildren(node);
      return level === 3 ? <h3 key={key}>{kids}</h3> : <h2 key={key}>{kids}</h2>;
    }
    case "bulletList":
      return <ul key={key}>{renderChildren(node)}</ul>;
    case "orderedList":
      return <ol key={key}>{renderChildren(node)}</ol>;
    case "listItem":
      return <li key={key}>{renderChildren(node)}</li>;
    case "blockquote":
      return <blockquote key={key}>{renderChildren(node)}</blockquote>;
    case "horizontalRule":
      return <hr key={key} className={styles.hr} />;
    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "text";
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      return <CodeFigure key={key} data={{ language: lang || "text", code }} />;
    }
    case "genBlock": {
      // `history` is editor-only: pick out only what we need, never forward attrs wholesale.
      const attrs = (node.attrs ?? {}) as Partial<GenBlockAttrs>;
      if (attrs.kind === "code" && attrs.data) {
        const data = attrs.data as CodeData;
        if (typeof data.code !== "string") return null;
        return (
          <CodeFigure
            key={key}
            data={{
              language: data.language,
              code: data.code,
              filename: data.filename,
              caption: data.caption,
              source: data.source,
            }}
          />
        );
      }
      if (attrs.kind === "repo" && attrs.data) {
        const d = attrs.data as RepoData;
        if (typeof d.fullName !== "string") return null;
        return (
          <RepoCard
            key={key}
            data={{
              fullName: d.fullName,
              description: d.description,
              stars: d.stars,
              language: d.language,
              url: d.url,
            }}
          />
        );
      }
      if (attrs.kind === "image" && attrs.data) {
        const d = attrs.data as unknown as ImageData;
        if (typeof d.url !== "string" || !d.url) return null;
        return (
          <ImageFigure
            key={key}
            data={{ url: d.url, alt: d.alt, caption: d.caption, prompt: "", aspect: d.aspect }}
          />
        );
      }
      if (attrs.kind === "motion" && attrs.data) {
        const d = attrs.data as unknown as MotionData;
        if (typeof d.url !== "string" || !d.url) return null;
        return (
          <MotionFigure
            key={key}
            data={{
              mode: d.mode,
              output: d.output,
              url: d.url,
              width: d.width,
              height: d.height,
              alt: d.alt,
              caption: d.caption,
            }}
          />
        );
      }
      return null;
    }
    default:
      return null;
  }
}

function FragmentKeyed({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

/**
 * Renders Tiptap JSON as React nodes (text goes through React, so it is escaped
 * by construction). Unknown nodes render nothing.
 */
export async function Doc({ doc }: { doc: DocNode }) {
  return <div className={styles.doc}>{renderChildren(doc)}</div>;
}
