import { createHighlighter, type Highlighter } from "shiki";
import { CODE_THEMES, DEFAULT_CODE_THEME } from "@/lib/look";

// The default theme is dark; a post's look may pick any theme in CODE_THEMES (light ones too).
// Themes are loaded lazily, one at a time, and cached on the shared highlighter.

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({ themes: [DEFAULT_CODE_THEME], langs: [] });
  return highlighterPromise;
}

/** Unknown or missing theme names fall back to the default. */
export function resolveTheme(theme?: string | null): string {
  return theme && (CODE_THEMES as readonly string[]).includes(theme) ? theme : DEFAULT_CODE_THEME;
}

async function loadedTheme(theme?: string | null): Promise<{ h: Highlighter; name: string }> {
  const name = resolveTheme(theme);
  const h = await getHighlighter();
  if (!h.getLoadedThemes().includes(name)) await h.loadTheme(name as never);
  return { h, name };
}

export interface ThemeColors {
  /** Theme background, e.g. "#121212". */
  bg: string;
  /** Theme foreground (plain text colour). */
  fg: string;
}

/** The theme's own background and foreground (the default theme's on unknown names or failure). */
export async function themeColors(theme?: string | null): Promise<ThemeColors> {
  try {
    const { h, name } = await loadedTheme(theme);
    const t = h.getTheme(name);
    return { bg: t.bg, fg: t.fg };
  } catch {
    return { bg: "#121212", fg: "#dbd7ca" };
  }
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
export async function highlight(code: string, lang: string, theme?: string | null): Promise<string> {
  return (await highlightThemed(code, lang, theme)).html;
}

/** Like `highlight`, plus the theme's background and foreground for the surrounding figure. */
export async function highlightThemed(
  code: string,
  lang: string,
  theme?: string | null,
): Promise<{ html: string } & ThemeColors> {
  const colors = await themeColors(theme);
  const id = (lang || "text").trim().toLowerCase();
  if (id === "text" || id === "plaintext" || id === "txt" || id === "") return { html: plain(code), ...colors };
  try {
    const { h, name } = await loadedTheme(theme);
    if (!h.getLoadedLanguages().includes(id)) await h.loadLanguage(id as never);
    const html = h.codeToHtml(code, {
      lang: id,
      theme: name,
      transformers: [
        {
          pre(node) {
            delete node.properties.style;
            delete node.properties.tabindex;
          },
        },
      ],
    });
    return { html, ...colors };
  } catch {
    return { html: plain(code), ...colors };
  }
}
