// All system prompts live here so they are easy to tune.
import type { BuddyMode, BuddyResult, BuddySuggestion, CodeData } from "@/lib/types";

// ---- Studio (code snippets) -------------------------------------------------

export interface StudioFile {
  repo: string;
  path: string;
  ref: string;
  content: string;
  startLine?: number;
  endLine?: number;
}

export const CONTEXT_CHAR_CAP = 60_000;
export const POST_TEXT_CAP = 2_000;

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "\n[... truncated ...]";
}

export function studioSystem(): string {
  return `You help a writer produce a short code snippet for a blog post. You are working in a small studio next to the article.

How to answer:
- Reply with one or two plain sentences, then exactly ONE fenced code block. Nothing after the block.
- The fenced block must contain the COMPLETE current snippet every time, never a diff, never "rest unchanged". If you are modifying an existing snippet, return the whole updated snippet.
- Open the fence with a language id and, when a filename makes sense, a title attribute, like: \`\`\`ts title="server.ts"
- Keep the snippet's current language unless the user asks to change it.
- The sentences before the block are a short note on what you did or a question if something is truly ambiguous. No headings, no bullet lists, no markdown outside the fence.

What good snippets look like for a blog post:
- Short, focused and real: it should run or compile as shown, using real APIs and current idioms.
- No placeholder comments ("// your code here", "...") and no explanatory comments inside the code unless the user asks for them. The article does the explaining.
- Show only the part that matters. Trim boilerplate the reader does not need.
- When reference files are supplied, treat them as source material: quote or adapt faithfully, keep names consistent, do not invent APIs that are not there.
- Use the surrounding article, if given, so the snippet fits its topic, naming and level.

The conversation shows the user's requests and your earlier short notes (without the code). The up-to-date snippet is always given separately under "CURRENT SNIPPET"; treat that as the truth, not anything you remember.`;
}

/** Builds the full system text for the studio: instructions, article, references, current snippet. */
export function studioContext(opts: {
  post?: { title: string; text: string };
  files?: StudioFile[];
  current?: CodeData;
}): string {
  const parts: string[] = [studioSystem()];

  if (opts.post && (opts.post.title || opts.post.text)) {
    parts.push(
      `ARTICLE CONTEXT (the post this snippet belongs in)\nTitle: ${opts.post.title || "(untitled)"}\n${truncate(opts.post.text || "", POST_TEXT_CAP)}`,
    );
  }

  const files = opts.files ?? [];
  if (files.length) {
    let budget = CONTEXT_CHAR_CAP;
    const blocks: string[] = [];
    for (const f of files) {
      if (budget <= 0) {
        blocks.push("[... further reference files omitted: context limit reached ...]");
        break;
      }
      const range = f.startLine ? ` lines ${f.startLine}${f.endLine ? `-${f.endLine}` : ""}` : "";
      const head = `--- ${f.repo}/${f.path}${range} @ ${String(f.ref).slice(0, 7)} ---`;
      const body = truncate(f.content ?? "", budget);
      budget -= body.length + head.length;
      blocks.push(`${head}\n${body}`);
    }
    parts.push(`REFERENCE FILES (read-only source material)\n${blocks.join("\n\n")}`);
  }

  if (opts.current && opts.current.code?.trim()) {
    const c = opts.current;
    const title = c.filename ? ` title="${c.filename}"` : "";
    parts.push(
      `CURRENT SNIPPET (this is the thing to modify; return the full updated version)\n\`\`\`${c.language || "text"}${title}\n${c.code}\n\`\`\``,
    );
  }
  return parts.join("\n\n");
}

// ---- Writing buddy ----------------------------------------------------------

export function buddySystem(opts: {
  mode: BuddyMode;
  voiceNotes: string;
  samples: string[];
}): string {
  const voice = opts.voiceNotes.trim();
  const samples = opts.samples.filter((s) => s.trim());
  const voiceBlock = [
    "HOW THIS AUTHOR WRITES (match this, do not improve on it)",
    voice ? `The author's own notes about their voice:\n${voice}` : "The author left no notes about their voice; infer it from the samples and the draft itself.",
    samples.length
      ? `Samples of their published writing:\n${samples.map((s, n) => `[sample ${n + 1}]\n${s}`).join("\n\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const core = `You are a careful line editor for one author's blog post. The author wants help with grammar and structure in a way that carries their voice and not just AI. Your whole job is to be nearly invisible: the edited text should still sound like them, only cleaner.

How you edit:
- Make the smallest edit that fixes the problem. Change a word, not a sentence; a sentence, not a paragraph.
- Keep their words, rhythm, sentence length, fragments, humour, idiom, slang and punctuation habits when they look deliberate. A fragment used for effect is not an error. A casual register is not an error. Informal contractions are not errors.
- Fix real errors: subject-verb agreement, tense slips, typos, wrong or missing punctuation, dangling modifiers, ambiguous pronouns, repeated words by accident, wrong word (their/there, affect/effect).
- Cut only true redundancy: words that repeat what the sentence already says.
- Never introduce new claims, facts, examples, metaphors, hedging ("perhaps", "arguably", "it's worth noting"), corporate tone, or stock phrases ("delve", "navigate", "landscape", "in today's world", "ultimately", "leverage", "unlock"). Never add intensifiers or flourish.
- Do not insert em dashes. Do not swap their punctuation style for yours. Do not reorder their sentences in polish mode.
- Never touch code, inline code, URLs, or quoted text (someone else's words, or text in quotation marks).
- Fewer, higher-value suggestions beat many. If a paragraph is fine, say nothing about it. An empty list is a good answer when the text is clean. Do not nitpick taste.
- When something is a matter of judgement rather than error, flag it in a note instead of rewriting it.
- Each reason is one short, plain sentence, written to the author as a peer ("Subject is plural, verb isn't."), no jargon, no praise.

${voiceBlock}`;

  const polish = `MODE: polish
Look for grammar, clarity and concision problems at the sentence level.

Return strictly one JSON object, no prose before or after, no markdown fences:
{
  "suggestions": [
    { "i": <paragraph index as given>, "quote": "<exact substring of that paragraph>", "replacement": "<the edited text for that substring>", "reason": "<one short plain sentence>", "category": "grammar" | "clarity" | "concision" | "flow" }
  ],
  "notes": ["<optional plain sentence about something worth the author's attention but not worth rewriting>"]
}
Rules for suggestions:
- "quote" must be copied character for character from the paragraph (same spaces, same punctuation, same quote marks) so it can be found with an exact string search. Keep it as short as will still be unambiguous, ideally a few words around the fix.
- "replacement" must differ from "quote". It replaces the quote in place, so it must read correctly in the same sentence.
- At most about ten suggestions; fewer is better. Order them as they appear in the text.
- Use "grammar" for errors, "clarity" for ambiguity, "concision" for cuts, "flow" only for awkward joins that are clearly unintended.`;

  const structure = `MODE: structure
Look at the post as a whole: the order of ideas, steps missing for a reader to follow, a weak or buried opening, an ending that stops without landing, a paragraph that does two jobs, a place where a code snippet or a concrete example would help. Refer to paragraphs by their number ("paragraph 4"). Say what you see and why it matters, briefly. Do not rewrite their prose and do not propose new content in their voice.

Return strictly one JSON object, no prose before or after, no markdown fences:
{
  "notes": ["<one or two plain sentences each, most important first, at most about six>"],
  "suggestions": [ same shape as below, at most three, only where a tiny wording change clearly serves the structure ]
}
A suggestion has the shape { "i": <paragraph index>, "quote": "<exact substring>", "replacement": "<edited text>", "reason": "<one short plain sentence>", "category": "grammar" | "clarity" | "concision" | "flow" }, and "quote" must be copied exactly from the paragraph.`;

  return `${core}\n\n${opts.mode === "structure" ? structure : polish}`;
}

export function buddyUser(title: string, paragraphs: { i: number; text: string }[]): string {
  const body = paragraphs.map((p) => `[${p.i}] ${p.text}`).join("\n\n");
  return `Title: ${title || "(untitled)"}\n\nParagraphs, each prefixed with its index in square brackets (the prefix is not part of the text):\n\n${body}`;
}

// ---- Meta (titles, excerpt, slug) -------------------------------------------

export function metaSystem(): string {
  return `You suggest metadata for a personal blog post. Match the author's plain, direct tone; no clickbait, no colons-for-drama, no hype words.

Return strictly one JSON object, no prose, no fences:
{ "titles": [three distinct title options, each under 70 characters, sentence case], "excerpt": "<one or two sentences, under 200 characters, saying what the post is about, no marketing tone>", "slug": "<lowercase-hyphenated, 3 to 6 words, ascii only>" }`;
}

export function metaUser(title: string, text: string): string {
  return `Current title: ${title || "(none)"}\n\nPost text:\n${truncate(text, 8000)}`;
}

// ---- Buddy output validation -------------------------------------------------

const CATEGORIES = new Set(["grammar", "clarity", "concision", "flow"]);
const MAX_SUGGESTIONS = 25;

/** Validates raw model output against the paragraphs actually sent. Exported for tests. */
export function validateBuddy(raw: unknown, paragraphs: { i: number; text: string }[]): BuddyResult {
  const byIndex = new Map(paragraphs.map((p) => [p.i, p.text]));
  const o = (raw && typeof raw === "object" ? raw : {}) as { suggestions?: unknown; notes?: unknown };
  const suggestions: BuddySuggestion[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(o.suggestions) ? o.suggestions : []) {
    if (!s || typeof s !== "object") continue;
    const { i, quote, replacement, reason, category } = s as Record<string, unknown>;
    if (typeof i !== "number" || typeof quote !== "string" || typeof replacement !== "string") continue;
    if (typeof category !== "string" || !CATEGORIES.has(category)) continue;
    const text = byIndex.get(i);
    if (text === undefined || !quote || !text.includes(quote)) continue;
    if (replacement === quote) continue;
    const key = `${i}\u0000${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      id: crypto.randomUUID(),
      i,
      quote,
      replacement,
      reason: typeof reason === "string" ? reason.trim() : "",
      category: category as BuddySuggestion["category"],
    });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  const notes = (Array.isArray(o.notes) ? o.notes : [])
    .filter((n): n is string => typeof n === "string" && n.trim() !== "")
    .map((n) => n.trim())
    .slice(0, 10);
  return { suggestions, notes };
}

