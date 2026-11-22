// Studio client logic: streaming helper, GitHub fetchers, and the Studio reducer.
// Pure (no React) so the reducer can be tested in isolation.

import { extractArtifact } from "@/lib/studio/parse";
import { langFromPath } from "@/lib/lang";
import type {
  ChatMessage,
  CodeData,
  FileResult,
  GenBlockAttrs,
  RepoData,
  RepoInfo,
  TreeEntry,
} from "@/lib/types";

// ---- Network ----------------------------------------------------------------

export interface ContextFile {
  repo: string;
  path: string;
  ref: string;
  content: string;
  startLine?: number;
  endLine?: number;
}

export interface StudioRequest {
  kind: "code";
  messages: ChatMessage[];
  current?: CodeData;
  context?: { files: ContextFile[] };
  post?: { title: string; text: string };
}

function redirectToLogin(): Promise<never> {
  // Full navigation on purpose (same as lib/client/api.ts): the session is gone.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  location.href = "/login?next=" + encodeURIComponent(location.pathname);
  return new Promise<never>(() => {});
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (data && typeof data.error === "string" && data.error) return data.error;
  } catch {
    /* not json */
  }
  return `Request failed (${res.status})`;
}

/**
 * POSTs to /api/ai/studio and reads the plain-text stream incrementally.
 * `onText` receives the full accumulated text after every chunk.
 * Resolves with the final text; throws Error(readable message) on failure.
 */
export async function streamStudio(
  body: StudioRequest,
  { onText, signal }: { onText(text: string): void; signal?: AbortSignal },
): Promise<string> {
  const res = await fetch("/api/ai/studio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) return redirectToLogin();
  if (!res.ok) throw new Error(await readError(res));
  if (!res.body) {
    const t = await res.text();
    onText(t);
    return t;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  const tail = decoder.decode();
  if (tail) {
    text += tail;
    onText(text);
  }
  return text;
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", signal });
  if (res.status === 401) return redirectToLogin();
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export function searchRepos(q: string, signal?: AbortSignal) {
  return getJSON<{ repos: RepoInfo[]; authed: boolean }>(
    `/api/github/repos?q=${encodeURIComponent(q.trim())}`,
    signal,
  );
}

export function getTree(repo: string, ref: string, path: string, signal?: AbortSignal) {
  const p = new URLSearchParams({ repo, ref, path });
  return getJSON<{ entries: TreeEntry[]; ref: string }>(`/api/github/tree?${p}`, signal);
}

export function getFile(repo: string, path: string, ref: string, signal?: AbortSignal) {
  const p = new URLSearchParams({ repo, path, ref });
  return getJSON<FileResult>(`/api/github/file?${p}`, signal);
}

// ---- Line ranges --------------------------------------------------------------

/** start only (end null) while picking; both set once complete. 1-based, inclusive. */
export type LineRange = { start: number; end: number | null } | null;

/** Tap a line: start a range, tap another to end it, tap again to start over. */
export function nextRange(range: LineRange, line: number): LineRange {
  if (!range || range.end !== null) return { start: line, end: null };
  const a = Math.min(range.start, line);
  const b = Math.max(range.start, line);
  return { start: a, end: b };
}

/** Resolved inclusive bounds of a range (a lone start counts as one line). */
export function rangeBounds(range: LineRange): { start: number; end: number } | null {
  if (!range) return null;
  return { start: range.start, end: range.end ?? range.start };
}

export function inRange(range: LineRange, line: number): boolean {
  const b = rangeBounds(range);
  return !!b && line >= b.start && line <= b.end;
}

export function splitLines(content: string): string[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

/** Build a code artifact from a GitHub file (whole file when range is null). */
export function snippetFromFile(file: FileResult, range: LineRange): CodeData {
  const lines = splitLines(file.content);
  const b = rangeBounds(range);
  const language = file.language || langFromPath(file.path);
  if (!b) {
    return {
      language,
      code: lines.join("\n"),
      filename: basename(file.path),
      source: { repo: file.repo, path: file.path, ref: file.ref, url: file.htmlUrl },
    };
  }
  const start = Math.max(1, b.start);
  const end = Math.min(lines.length, b.end);
  const hash = start === end ? `#L${start}` : `#L${start}-L${end}`;
  return {
    language,
    code: lines.slice(start - 1, end).join("\n"),
    filename: basename(file.path),
    source: {
      repo: file.repo,
      path: file.path,
      ref: file.ref,
      startLine: start,
      endLine: end,
      url: file.htmlUrl.replace(/#.*$/, "") + hash,
    },
  };
}

export function contextFromFile(file: FileResult, range: LineRange): ContextFile {
  const b = rangeBounds(range);
  if (!b) return { repo: file.repo, path: file.path, ref: file.ref, content: file.content };
  const lines = splitLines(file.content);
  const start = Math.max(1, b.start);
  const end = Math.min(lines.length, b.end);
  return {
    repo: file.repo,
    path: file.path,
    ref: file.ref,
    content: lines.slice(start - 1, end).join("\n"),
    startLine: start,
    endLine: end,
  };
}

export function contextLabel(f: ContextFile): string {
  const lines =
    f.startLine != null
      ? f.endLine != null && f.endLine !== f.startLine
        ? ` L${f.startLine}–${f.endLine}`
        : ` L${f.startLine}`
      : "";
  return `${f.repo} · ${f.path}${lines}`;
}

export function repoDataFrom(r: RepoInfo): RepoData {
  return {
    fullName: r.fullName,
    description: r.description,
    stars: r.stars,
    language: r.language,
    url: r.url,
  };
}

// ---- Studio state -------------------------------------------------------------

export type Version = { kind: "code"; data: CodeData } | { kind: "repo"; data: RepoData };

export interface ThreadItem {
  role: "user" | "assistant";
  content: string;
  /** assistant: index of the version this turn produced */
  version?: number;
  /** assistant: index of the version that was current when the request was sent */
  base?: number;
}

export interface PendingRequest {
  id: number;
  base: number; // version index sent as `current` (-1 = none)
  messages: ChatMessage[];
  current?: CodeData;
  context: ContextFile[];
}

export type StudioView = "chat" | "github";

export interface StudioState {
  mode: "code" | "github"; // how the studio was opened
  view: StudioView;
  versions: Version[];
  index: number; // current version, -1 when empty
  thread: ThreadItem[];
  draft: string;
  context: ContextFile[];
  request: PendingRequest | null; // in flight
  streamText: string;
  error: string | null;
  handEdit: boolean;
  /** version index created by the current hand-edit session (mutated in place) */
  handVersion: number | null;
  dirty: boolean;
  nextId: number;
}

export function initStudio(opts: { mode: "code" | "github"; existing?: GenBlockAttrs | null }): StudioState {
  const base: StudioState = {
    mode: opts.mode,
    view: opts.mode === "github" ? "github" : "chat",
    versions: [],
    index: -1,
    thread: [],
    draft: "",
    context: [],
    request: null,
    streamText: "",
    error: null,
    handEdit: false,
    handVersion: null,
    dirty: false,
    nextId: 1,
  };
  const ex = opts.existing;
  if (!ex) return base;
  const versions: Version[] = [];
  if (ex.kind === "code" && typeof (ex.data as CodeData).code === "string") {
    versions.push({ kind: "code", data: { ...(ex.data as CodeData) } });
  } else if (ex.kind === "repo" && typeof (ex.data as RepoData).fullName === "string") {
    versions.push({ kind: "repo", data: { ...(ex.data as RepoData) } });
  }
  const thread: ThreadItem[] = (ex.history ?? [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));
  // Opening an existing block always lands in chat (the artifact is shown).
  return { ...base, view: "chat", versions, index: versions.length ? 0 : -1, thread };
}

export function currentVersion(s: StudioState): Version | null {
  return s.index >= 0 ? s.versions[s.index] ?? null : null;
}

export function hasCompleteArtifact(s: StudioState): boolean {
  const v = currentVersion(s);
  if (!v) return false;
  if (v.kind === "repo") return !!v.data.fullName;
  return v.data.code.trim().length > 0;
}

export function historyOf(thread: ThreadItem[]): ChatMessage[] {
  return thread
    .filter((t) => t.content.trim() !== "")
    .map((t) => ({ role: t.role, content: t.content }));
}

export type StudioAction =
  | { type: "draft"; text: string }
  | { type: "send"; text: string }
  | { type: "retry" }
  | { type: "regenerate" }
  | { type: "stream"; id: number; text: string }
  | { type: "done"; id: number; text: string }
  | { type: "fail"; id: number; error: string }
  | { type: "stop" }
  | { type: "go"; index: number }
  | { type: "step"; delta: number }
  | { type: "handEdit"; on: boolean }
  | { type: "handText"; code: string }
  | { type: "rename"; filename: string }
  | { type: "language"; language: string }
  | { type: "view"; view: StudioView }
  | { type: "useSnippet"; data: CodeData }
  | { type: "repoCard"; data: RepoData }
  | { type: "attach"; file: ContextFile }
  | { type: "detach"; index: number }
  | { type: "dismissError" };

function startRequest(s: StudioState, thread: ThreadItem[], base: number): StudioState {
  const v = base >= 0 ? s.versions[base] : undefined;
  const current = v && v.kind === "code" ? v.data : undefined;
  const request: PendingRequest = {
    id: s.nextId,
    base,
    messages: historyOf(thread),
    current,
    context: s.context,
  };
  return {
    ...s,
    thread,
    index: base,
    request,
    streamText: "",
    error: null,
    handEdit: false,
    handVersion: null,
    nextId: s.nextId + 1,
  };
}

function pushVersion(s: StudioState, v: Version): StudioState {
  const versions = [...s.versions, v];
  return { ...s, versions, index: versions.length - 1, dirty: true };
}

function patchCurrent(s: StudioState, patch: Partial<CodeData>): StudioState {
  const v = currentVersion(s);
  if (!v || v.kind !== "code") return s;
  const versions = s.versions.slice();
  versions[s.index] = { kind: "code", data: { ...v.data, ...patch } };
  return { ...s, versions, dirty: true };
}

export function studioReducer(s: StudioState, a: StudioAction): StudioState {
  switch (a.type) {
    case "draft":
      return { ...s, draft: a.text };

    case "send": {
      const text = a.text.trim();
      if (!text || s.request) return s;
      let thread = s.thread;
      // A failed user turn is replaced by the new one rather than stacked.
      if (s.error && thread.length && thread[thread.length - 1].role === "user") {
        thread = thread.slice(0, -1);
      }
      thread = [...thread, { role: "user", content: text }];
      return { ...startRequest(s, thread, s.index), draft: "" };
    }

    case "retry": {
      if (s.request) return s;
      const last = s.thread[s.thread.length - 1];
      if (!last || last.role !== "user") return s;
      return startRequest(s, s.thread, s.index);
    }

    case "regenerate": {
      if (s.request) return s;
      let lastUser = -1;
      for (let i = s.thread.length - 1; i >= 0; i--) {
        if (s.thread[i].role === "user") {
          lastUser = i;
          break;
        }
      }
      if (lastUser === -1) return s;
      const dropped = s.thread.slice(lastUser + 1);
      const assistant = dropped.find((t) => t.role === "assistant");
      let base = s.index;
      if (assistant) {
        if (assistant.base !== undefined) base = assistant.base;
        else if (assistant.version !== undefined) base = assistant.version - 1;
      }
      if (base >= s.versions.length) base = s.versions.length - 1;
      return startRequest(s, s.thread.slice(0, lastUser + 1), base);
    }

    case "stream":
      if (!s.request || s.request.id !== a.id) return s;
      return { ...s, streamText: a.text };

    case "done": {
      if (!s.request || s.request.id !== a.id) return s;
      const base = s.request.base;
      const cleared: StudioState = { ...s, request: null, streamText: "" };
      const art = extractArtifact(a.text);
      if (art && art.complete && art.code.trim()) {
        const prev = base >= 0 ? s.versions[base] : undefined;
        const prevCode = prev && prev.kind === "code" ? prev.data : undefined;
        const data: CodeData = {
          language: art.language || prevCode?.language || "text",
          code: art.code,
          filename: art.filename ?? prevCode?.filename,
        };
        if (prevCode?.caption) data.caption = prevCode.caption;
        if (prevCode?.source) data.source = prevCode.source;
        const next = pushVersion(cleared, { kind: "code", data });
        return {
          ...next,
          thread: [
            ...s.thread,
            {
              role: "assistant",
              content: art.note || "Updated the snippet.",
              version: next.index,
              base,
            },
          ],
        };
      }
      const textOnly = a.text.trim();
      if (!textOnly) return { ...cleared, error: "The reply was empty." };
      return {
        ...cleared,
        thread: [...s.thread, { role: "assistant", content: textOnly, base }],
        dirty: true,
      };
    }

    case "fail":
      if (!s.request || s.request.id !== a.id) return s;
      return { ...s, request: null, streamText: "", error: a.error || "Something went wrong." };

    case "stop": {
      if (!s.request) return s;
      const last = s.thread[s.thread.length - 1];
      // Give the user's words back to the composer.
      if (last && last.role === "user") {
        return {
          ...s,
          request: null,
          streamText: "",
          thread: s.thread.slice(0, -1),
          draft: s.draft.trim() ? s.draft : last.content,
        };
      }
      return { ...s, request: null, streamText: "" };
    }

    case "go":
      if (s.request || a.index < 0 || a.index >= s.versions.length) return s;
      return { ...s, index: a.index, handEdit: false, handVersion: null };

    case "step":
      return studioReducer(s, { type: "go", index: s.index + a.delta });

    case "handEdit":
      if (s.request) return s;
      return { ...s, handEdit: a.on, handVersion: null };

    case "handText": {
      if (s.request) return s;
      if (s.handVersion !== null && s.handVersion === s.index) {
        return patchCurrent(s, { code: a.code });
      }
      const v = currentVersion(s);
      const prev = v && v.kind === "code" ? v.data : undefined;
      if (prev && prev.code === a.code) return s;
      const data: CodeData = prev ? { ...prev, code: a.code } : { language: "text", code: a.code };
      const next = pushVersion(s, { kind: "code", data });
      return { ...next, handVersion: next.index };
    }

    case "rename": {
      const name = a.filename.trim();
      const v = currentVersion(s);
      if (!v || v.kind !== "code") return s;
      const patch: Partial<CodeData> = { filename: name || undefined };
      // A new extension implies a language when the current one is plain text.
      if (name && (v.data.language === "text" || !v.data.language)) {
        const guess = langFromPath(name);
        if (guess !== "text") patch.language = guess;
      }
      return patchCurrent(s, patch);
    }

    case "language":
      return patchCurrent(s, { language: a.language || "text" });

    case "view":
      return { ...s, view: a.view };

    case "useSnippet":
      return { ...pushVersion(s, { kind: "code", data: a.data }), view: "chat", handEdit: false, handVersion: null };

    case "repoCard":
      return { ...pushVersion(s, { kind: "repo", data: a.data }), view: "chat", handEdit: false, handVersion: null };

    case "attach": {
      const exists = s.context.some(
        (c) =>
          c.repo === a.file.repo &&
          c.path === a.file.path &&
          c.startLine === a.file.startLine &&
          c.endLine === a.file.endLine,
      );
      return { ...s, context: exists ? s.context : [...s.context, a.file], view: "chat" };
    }

    case "detach":
      return { ...s, context: s.context.filter((_, i) => i !== a.index) };

    case "dismissError":
      return { ...s, error: null };
  }
}

/** What the "Add inline" button commits. */
export function commitResult(s: StudioState): Pick<GenBlockAttrs, "kind" | "data" | "history"> | null {
  const v = currentVersion(s);
  if (!v || !hasCompleteArtifact(s)) return null;
  return { kind: v.kind, data: v.data, history: historyOf(s.thread) };
}

/** Preview of the artifact while a reply streams in (null when nothing to show yet). */
export function streamingArtifact(s: StudioState): CodeData | null {
  if (!s.request || !s.streamText) return null;
  const art = extractArtifact(s.streamText);
  if (!art) return null;
  return { language: art.language, code: art.code, filename: art.filename };
}

export function newBlockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "g" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
