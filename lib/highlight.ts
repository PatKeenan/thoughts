import { createHighlighter, type Highlighter } from "shiki";

// Dark theme: the code block is dark (var(--code-bg)) in both colour schemes.
const THEME = "vitesse-dark";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({ themes: [THEME], langs: [] });
  return highlighterPromise;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plain(code: string): string {
  return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
}

/**
 * Highlight `code` as `lang` and return an HTML string (a <pre class="shiki">).
 * Unknown languages, and any failure, fall back to plain escaped text.
 * Token styles are inline colours only; the pre has no background of its own.
 */
export async function highlight(code: string, lang: string): Promise<string> {
  const id = (lang || "text").trim().toLowerCase();
  if (id === "text" || id === "plaintext" || id === "txt" || id === "") return plain(code);
  try {
    const h = await getHighlighter();
    if (!h.getLoadedLanguages().includes(id)) await h.loadLanguage(id as never);
    return h.codeToHtml(code, {
      lang: id,
      theme: THEME,
      transformers: [
        {
          pre(node) {
            delete node.properties.style;
            delete node.properties.tabindex;
          },
        },
      ],
    });
  } catch {
    return plain(code);
  }
}
