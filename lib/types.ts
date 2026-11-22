// Shared types. This file is the contract between streams — do not change shapes.

export type PostStatus = "draft" | "scheduled" | "published";

/** Tiptap/ProseMirror JSON document. */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface Post {
  id: string;
  slug: string; // "" until first set
  title: string;
  excerpt: string;
  content: DocNode; // { type: "doc", content: [...] }
  status: PostStatus;
  /** ISO string. Set when status is "scheduled" (future) or "published" (time it went live). */
  publishAt: string | null;
  /** The post's visual look (see lib/look.ts). null → falls back to settings.defaultLook. */
  look: Look | null;
  createdAt: string;
  updatedAt: string;
}

export type PostSummary = Omit<Post, "content">;

export interface Settings {
  siteTitle: string;
  tagline: string;
  author: string;
  bio: string;
  /** Free-form notes describing the author's voice; fed to the writing buddy. */
  voiceNotes: string;
  /** Canonical site URL (no trailing slash), used for RSS/OG. May be "". */
  siteUrl: string;
  /** Look used by posts that have none of their own. */
  defaultLook: Look | null;
  /** Named looks saved for reuse across posts (max 20). */
  savedLooks: Look[];
}

export const DEFAULT_SETTINGS: Settings = {
  siteTitle: "My Blog",
  tagline: "Notes, code and things I'm figuring out.",
  author: "",
  bio: "",
  voiceNotes: "",
  siteUrl: "",
  defaultLook: {
    id: "house",
    name: "House: teal and pink",
    version: 1,
    palette: { bg: "#f5f8f7", ink: "#042f2e", accent: "#0f766e", muted: "#cddbd8", extra: ["#db2777"] },
    typography: { title: "serif", body: "serif" },
    illustration:
      "Clean editorial illustration: flat shapes with a few fine lines, generous empty space, soft even light, no gradients or 3D gloss, no stock-photo look.",
    motion: { pace: "calm", notes: "Unhurried, confident moves; one idea at a time." },
    codeTheme: "dracula",
    mood: ["clear", "confident", "warm"],
  },
  savedLooks: [],
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ---- Generated blocks (the things slash commands insert) -------------------

/** v1 ships "code" and "repo". "image" | "motion" are reserved for the next phase. */
export type GenKind = "code" | "repo" | "image" | "motion";

export interface CodeSource {
  repo: string; // "owner/name"
  path: string;
  ref: string; // commit sha (permalink)
  startLine?: number;
  endLine?: number;
  url: string; // github permalink
}

export interface CodeData {
  language: string; // shiki language id, e.g. "ts", "python", "bash", "text"
  code: string;
  filename?: string;
  caption?: string;
  source?: CodeSource; // present when the snippet came from GitHub
}

// ---- Look: a post's shared visual style -------------------------------------

export type FontKind = "serif" | "sans" | "mono";

export interface Look {
  id: string;
  /** Short human name, e.g. "Warm flat editorial". */
  name: string;
  /** Bumped whenever a style field changes (see editLook in lib/look.ts). */
  version: number;
  /** All colours are #rrggbb. */
  palette: { bg: string; ink: string; accent: string; muted: string; extra: string[] };
  typography: { title: FontKind; body: FontKind };
  /** One or two sentences: medium, line, texture, lighting, level of detail. */
  illustration: string;
  motion: { pace: "calm" | "brisk" | "snappy"; notes: string };
  /** One of CODE_THEMES in lib/look.ts. Applied at render time; never needs a restyle. */
  codeTheme: string;
  /** 2–5 mood words. */
  mood: string[];
  /** An image whose STYLE (not content) later images should match. */
  referenceUrl?: string;
}

/** Which look a generated block was made with. null = deliberately made without the post look. */
export type LookStamp = { id: string; version: number } | null;

/** What a Remotion composition receives as its `theme` prop. */
export interface MotionTheme {
  bg: string;
  ink: string;
  accent: string;
  muted: string;
  extra: string[];
  titleFont: string; // CSS font-family stack
  bodyFont: string;
  monoFont: string;
}

export interface RepoData {
  fullName: string; // "owner/name"
  description: string;
  stars: number;
  language: string | null;
  url: string;
}

/**
 * Attributes of the Tiptap node `genBlock` (block-level atom).
 * `history` is the studio chat that produced it, kept so the block can be
 * reopened and regenerated/edited later.
 */
export interface GenBlockAttrs {
  id: string;
  kind: GenKind;
  data: CodeData | RepoData | Record<string, unknown>;
  history: ChatMessage[];
}

// ---- GitHub API shapes ------------------------------------------------------

export interface RepoInfo extends RepoData {
  defaultBranch: string;
  private: boolean;
}

export interface TreeEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
}

export interface FileResult {
  repo: string;
  path: string;
  ref: string; // resolved commit sha
  content: string;
  language: string; // shiki language id guessed from extension
  htmlUrl: string; // permalink at commit sha
}

// ---- Writing buddy ----------------------------------------------------------

export type BuddyMode = "polish" | "structure";

export interface BuddySuggestion {
  id: string;
  /** Index into the `paragraphs` array that was sent. */
  i: number;
  /** Exact substring of that paragraph to replace. */
  quote: string;
  replacement: string;
  reason: string;
  category: "grammar" | "clarity" | "concision" | "flow";
}

export interface BuddyResult {
  suggestions: BuddySuggestion[];
  /** High-level observations (structure mode mostly). Plain sentences. */
  notes: string[];
}

// ---- Phase 2: image, motion, fact-check -------------------------------------

export type Aspect = "16:9" | "1:1" | "4:5" | "3:2";

export interface ImageData {
  url: string; // stored media URL
  alt: string;
  caption?: string;
  /** The full prompt that produced this version (so it can be refined/regenerated). */
  prompt: string;
  aspect: Aspect;
  /** undefined = made before looks existed. */
  look?: LookStamp;
}

export interface MotionConfig {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

/** How a motion block is shown in the post. */
export type MotionOutput = "loop" | "gif" | "video";

export interface MotionData {
  /** "code" = Remotion composition written by the AI; "clip" = AI video model. */
  mode: "code" | "clip";
  /** mode "code": the TSX module (see PHASE2.md "Motion code contract"). */
  code?: string;
  config?: MotionConfig;
  /** mode "clip": the prompt sent to the video model. */
  prompt?: string;
  output: MotionOutput; // "gif" is only valid with mode "code"
  /** Rendered asset (mp4 or gif). Empty string until rendered — unrendered blocks are not shown on the site. */
  url: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
  /** undefined = made before looks existed. For mode "code" the stamp describes the rendered asset at `url`. */
  look?: LookStamp;
}

export type Verdict = "supported" | "partly" | "disputed" | "unsupported" | "unclear";

export interface FactSource {
  title: string;
  url: string;
}

export interface FactCheckResult {
  verdict: Verdict;
  /** Two or three plain sentences: what the evidence says. */
  summary: string;
  /** A corrected version of the claim in the author's wording, only when the claim is wrong or imprecise. */
  correction?: string;
  sources: FactSource[];
}

/** Server-sent progress for renders and clip generation: one JSON object per line (NDJSON). */
export type JobEvent =
  | { type: "progress"; label: string; progress: number } // progress 0..1
  | { type: "done"; url: string; width: number; height: number }
  | { type: "error"; message: string };
