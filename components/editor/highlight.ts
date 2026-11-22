// Client-side syntax highlighting. shiki is loaded lazily (dynamic import) with the
// JavaScript regex engine (no wasm), and grammars are loaded one by one on demand.
import type { Highlighter } from "shiki";

const THEME = "vitesse-dark"; // matches lib/highlight.ts (server render)

let highlighter: Promise<Highlighter> | null = null;
const failedLangs = new Set<string>();
const cache = new Map<string, string>();

const ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  rs: "rust",
  yml: "yaml",
  md: "markdown",
};

function load(): Promise<Highlighter> {
  highlighter ??= import("shiki").then(({ createHighlighter, createJavaScriptRegexEngine }) =>
    createHighlighter({ themes: [THEME], langs: [], engine: createJavaScriptRegexEngine() }),
  );
  return highlighter;
}

export function normalizeLang(lang: string | undefined): string {
  const id = (lang || "text").trim().toLowerCase();
  return ALIASES[id] ?? id;
}

/** Returns highlighted HTML (a <pre class="shiki">), or null for plain text / unknown / failure. */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  const id = normalizeLang(lang);
  if (!id || id === "text" || id === "plaintext" || id === "txt" || failedLangs.has(id)) return null;
  const key = id + "\u0000" + code;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const shiki = await import("shiki");
    if (!(id in shiki.bundledLanguages) && !(id in shiki.bundledLanguagesAlias)) {
      failedLangs.add(id);
      return null;
    }
    const h = await load();
    if (!h.getLoadedLanguages().includes(id)) await h.loadLanguage(id as never);
    const html = h.codeToHtml(code, {
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
    if (cache.size > 200) cache.clear();
    cache.set(key, html);
    return html;
  } catch {
    failedLangs.add(id);
    return null;
  }
}

/** Short list for the language picker. */
export const LANGUAGES: { id: string; label: string }[] = [
  { id: "ts", label: "TypeScript" },
  { id: "tsx", label: "TSX" },
  { id: "js", label: "JavaScript" },
  { id: "jsx", label: "JSX" },
  { id: "json", label: "JSON" },
  { id: "bash", label: "Shell" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "swift", label: "Swift" },
  { id: "ruby", label: "Ruby" },
  { id: "css", label: "CSS" },
  { id: "html", label: "HTML" },
  { id: "sql", label: "SQL" },
  { id: "yaml", label: "YAML" },
  { id: "markdown", label: "Markdown" },
  { id: "diff", label: "Diff" },
  { id: "text", label: "Plain text" },
];

export function languageLabel(id: string): string {
  const n = normalizeLang(id);
  return LANGUAGES.find((l) => l.id === n)?.label ?? id;
}
