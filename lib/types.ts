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
}

export const DEFAULT_SETTINGS: Settings = {
  siteTitle: "My Blog",
  tagline: "Notes, code and things I'm figuring out.",
  author: "",
  bio: "",
  voiceNotes: "",
  siteUrl: "",
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
