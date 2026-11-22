// Themed sample highlighting for the Look sheet. Lazy, client-only, one highlighter with the
// JavaScript regex engine. components/editor/highlight.ts has no theme parameter (it is fixed to
// vitesse-dark), so the sheet keeps its own small loader; swap this out if that one gains a theme.
import type { Highlighter } from "shiki";
import { CODE_THEMES, DEFAULT_CODE_THEME } from "@/lib/look";

export const SAMPLE_CODE = `const post = await getPost(slug);
if (!post) return notFound();
return render(post.title, 42);`;

export interface Sample {
  html: string;
  bg: string;
  fg: string;
}

let highlighter: Promise<Highlighter> | null = null;
const cache = new Map<string, Sample>();

function load(): Promise<Highlighter> {
  highlighter ??= import("shiki").then(({ createHighlighter, createJavaScriptRegexEngine }) =>
    createHighlighter({ themes: [DEFAULT_CODE_THEME], langs: ["ts"], engine: createJavaScriptRegexEngine() }),
  );
  return highlighter;
}

/** The sample highlighted in `theme` (null on failure, so callers show plain text). */
export async function sampleFor(theme: string): Promise<Sample | null> {
  const name = (CODE_THEMES as readonly string[]).includes(theme) ? theme : DEFAULT_CODE_THEME;
  const hit = cache.get(name);
  if (hit) return hit;
  try {
    const h = await load();
    if (!h.getLoadedThemes().includes(name)) await h.loadTheme(name as never);
    const html = h.codeToHtml(SAMPLE_CODE, {
      lang: "ts",
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
    const t = h.getTheme(name);
    const out = { html, bg: t.bg, fg: t.fg };
    cache.set(name, out);
    return out;
  } catch {
    return null;
  }
}
