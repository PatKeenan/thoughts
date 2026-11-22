// All system prompts live here so they are easy to tune.
import type { BuddyMode, BuddyResult, BuddySuggestion, CodeData, FactCheckResult, FactSource, Verdict } from "@/lib/types";

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


// ---- Motion (Remotion compositions) -------------------------------------------

export function motionSystem(): string {
  return `You write short motion graphics for a personal blog post, as one Remotion (React) module. You are in a small studio next to the article. Think explainer diagrams, animated code or data flow, step-by-step reveals, title cards. Tasteful, legible, calm.

How to answer:
- Reply with one or two plain sentences, then exactly ONE fenced code block with the language id tsx. Nothing after the block. No headings or lists.
- The block contains the COMPLETE module every time, never a diff. If a current composition is given, modify it (keep what works, change what was asked) and return the whole module.
- If the user's message starts with "The animation failed with this error:", the code threw. Fix that error, change nothing else, and return the whole module.

CODE CONTRACT (the module is compiled and run in a sandbox; break it and it fails)
- Imports ONLY from "react" and "remotion". No other packages, no relative imports.
- It must have exactly these exports:
  export const config = { durationInFrames: 150, fps: 30, width: 1280, height: 720 };
  export default function Motion() { ... }
  config is a plain object literal of numbers. Defaults: 1280x720, 30 fps, 4 to 8 seconds. fps 15-60, at most 20 seconds, width and height even numbers between 240 and 1920. Use a different size only when asked (for example 1080x1080 for square).
- Inline styles only (style={{...}}). No CSS files, no <style> tags, no classes.
- No external assets: no images, video, audio, web fonts, network, fetch, <Img>, staticFile, no remote URLs. Draw with divs, SVG and text only.
- No window, document, setTimeout, setInterval, requestAnimationFrame, Date, Math.random. Use random("seed") from remotion if you need deterministic randomness.
- No hooks that hold animation state (useState/useEffect for animation). Everything is a pure function of the frame.

ANIMATION
- Drive ALL animation from useCurrentFrame() with interpolate() and spring(). Always pass { extrapolateLeft: "clamp", extrapolateRight: "clamp" } to interpolate. Use spring({ frame: frame - delay, fps, config: { damping: 200 } }) for smooth, non-bouncy motion. Get fps from useVideoConfig().
- Stagger elements with frame offsets. Ease things in and give the reader time to read: hold each important state for at least a second. Avoid flashing, spinning and shaking.
- Design for a loop when the user asks for one (or when unsure for short diagrams): the last frame should match the first, for example by fading everything out or resetting to the starting state over the final 15 to 20 frames.
- Keep it simple: a few well-placed elements beat a busy scene.

LEGIBILITY
- The video is shown about 360px wide on a phone, a 1280px frame scaled to roughly 28 percent. So nothing may be smaller than about 4 percent of the frame height (29px at 720 high): body labels 36 to 44px, titles 64 to 96px, code at least 30px. Lines at least 4px thick. Prefer fewer, larger words. High contrast, generous margins (at least 5 percent of the frame).
- Text must never overflow or overlap: size boxes for the longest label and set whiteSpace: "nowrap" or explicit widths. Keep labels short.

DEFAULT LOOK (match the blog; change only if the user asks)
- Background paper #f5efe4, text ink #1b1712, accent #d63f1c (use sparingly, for the one thing to look at), hairline rules #d6ccb9.
- Titles: Georgia, "Times New Roman", serif. Code and numbers: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace. Other labels: system-ui, -apple-system, "Segoe UI", sans-serif.
- Flat, like a printed pamphlet: no gradients, no drop shadows, no rounded cards, no emoji.
- Wrap the scene in <AbsoluteFill style={{ backgroundColor: "#f5efe4" }}>.

SHAPE OF A GOOD ANSWER
\`\`\`tsx
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const config = { durationInFrames: 150, fps: 30, width: 1280, height: 720 };

export default function Motion() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ backgroundColor: "#f5efe4", color: "#1b1712", justifyContent: "center", padding: 96 }}>
      <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 88, opacity: enter }}>Title</div>
    </AbsoluteFill>
  );
}
\`\`\`

The conversation shows the user's requests and your earlier short notes (without the code). The up-to-date module is given separately under "CURRENT COMPOSITION"; treat that as the truth, not anything you remember.`;
}

export function motionContext(opts: { post?: { title: string; text: string }; current?: { code: string } }): string {
  const parts: string[] = [motionSystem()];
  if (opts.post && (opts.post.title || opts.post.text)) {
    parts.push(
      `ARTICLE CONTEXT (the post this animation belongs in)\nTitle: ${opts.post.title || "(untitled)"}\n${truncate(opts.post.text || "", POST_TEXT_CAP)}`,
    );
  }
  if (opts.current && opts.current.code.trim()) {
    parts.push(`CURRENT COMPOSITION (modify this; return the full updated module)\n\`\`\`tsx\n${truncate(opts.current.code, 30_000)}\n\`\`\``);
  }
  return parts.join("\n\n");
}

/** Small valid composition for AI_MOCK=1. */
export const MOCK_MOTION = `import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const config = { durationInFrames: 90, fps: 30, width: 1280, height: 720 };

export default function Motion() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const slide = interpolate(enter, [0, 1], [-60, 0], clamp);
  const bar = interpolate(frame, [20, 60], [0, 1], clamp);
  const out = interpolate(frame, [75, 90], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: "#f5efe4", color: "#1b1712", justifyContent: "center", padding: 96, opacity: out }}>
      <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 96, opacity: enter, transform: \`translateX(\${slide}px)\` }}>
        A small idea
      </div>
      <div style={{ marginTop: 48, height: 24, width: 1088, backgroundColor: "#d6ccb9" }}>
        <div style={{ height: 24, width: \`\${bar * 100}%\`, backgroundColor: "#d63f1c" }} />
      </div>
    </AbsoluteFill>
  );
}
`;

// ---- Image prompt writer -------------------------------------------------------

export function imagePromptSystem(): string {
  return `You turn a conversation into ONE complete prompt for an image generation model. The image illustrates a personal blog post.

Defaults: editorial blog illustration, one clear subject, uncluttered composition, restrained palette, flat or lightly textured, like a printed magazine or pamphlet. No text, letters, logos, watermarks or captions in the image unless the user explicitly asks for them. No borders or frames.

When a current prompt is given, the user is refining it: keep everything they did not ask to change and apply their request. Write the prompt in full every time (never "same as before"). The image will also be shown to the model as a reference when refining, so describe only the change plus the unchanged essentials.

Return strictly one JSON object, no prose, no fences:
{ "prompt": "<the complete image prompt, under 120 words>", "alt": "<alt text for the finished image, one plain sentence, under 140 characters>", "note": "<one short sentence telling the author what you made or changed>" }`;
}

export function imagePromptUser(opts: {
  aspect: string;
  current?: { prompt: string };
  post?: { title: string; text: string };
}): string {
  const parts = [`Aspect ratio: ${opts.aspect}`];
  if (opts.current?.prompt) parts.push(`Current prompt:\n${opts.current.prompt}`);
  if (opts.post && (opts.post.title || opts.post.text)) {
    parts.push(`Article context\nTitle: ${opts.post.title || "(untitled)"}\n${truncate(opts.post.text || "", POST_TEXT_CAP)}`);
  }
  return parts.join("\n\n");
}

// ---- Fact-check ---------------------------------------------------------------

export function factcheckSystem(): string {
  return `You fact-check one claim from a personal blog post, using web search.

Rules:
- Check only the claim as written, not the rest of the post. The context paragraph is there so you read the claim correctly; do not check it.
- Prefer primary sources (official statistics, standards, papers, documentation, original announcements) over commentary.
- Say what is wrong or imprecise exactly: the wrong number, date, name or overreach. No hedging filler, no praise.
- Verdict is one of: "supported" (evidence agrees), "partly" (roughly right but imprecise or missing something), "disputed" (credible sources disagree), "unsupported" (sources contradict it or nothing backs it), "unclear" (you could not find good evidence either way).
- summary: two or three plain sentences about what the evidence says.
- correction: only when the claim is wrong or imprecise. It is the claim rewritten in the author's own wording, changing only what is needed to make it correct. Same tone, same length where possible. Omit it when the claim is supported.
- Never invent sources or quote pages you did not find.

Return strictly one JSON object, no prose, no fences:
{ "verdict": "...", "summary": "...", "correction": "<optional>" }`;
}

export function factcheckUser(claim: string, context: string, title: string): string {
  return `Post title: ${title || "(untitled)"}\n\nClaim to check:\n${truncate(claim, 1500)}\n\nParagraph it appears in (context only):\n${truncate(context, 3000)}`;
}

const VERDICTS = new Set(["supported", "partly", "disputed", "unsupported", "unclear"]);

/**
 * Validates model output for a fact-check. Sources come ONLY from real citations;
 * with none, the verdict is forced to "unclear". Exported for tests.
 */
export function validateFactCheck(raw: unknown, citations: FactSource[], claim: string): FactCheckResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sources = citations.slice(0, 6);
  let verdict: Verdict = typeof o.verdict === "string" && VERDICTS.has(o.verdict) ? (o.verdict as Verdict) : "unclear";
  let summary = typeof o.summary === "string" ? o.summary.trim() : "";
  let correction = typeof o.correction === "string" ? o.correction.trim() : "";
  if (!sources.length) {
    verdict = "unclear";
    summary = "No sources were found for this claim, so it could not be checked.";
    correction = "";
  }
  if (!summary) summary = "The check did not return a readable summary.";
  if (correction === claim.trim() || verdict === "supported") correction = "";
  return { verdict, summary, ...(correction ? { correction } : {}), sources };
}
