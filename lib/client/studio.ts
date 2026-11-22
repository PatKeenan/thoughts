// Studio client logic: streaming helper, GitHub fetchers, and the Studio reducer.
// Pure (no React) so the reducer can be tested in isolation.

import { extractArtifact } from "@/lib/studio/parse";
import { langFromPath } from "@/lib/lang";
import { api } from "@/lib/client/api";
import { isOffLook, motionThemeFromLook, stampOf, usesTheme } from "@/lib/look";
import type {
  Aspect,
  ChatMessage,
  CodeData,
  FileResult,
  GenBlockAttrs,
  GenKind,
  ImageData,
  JobEvent,
  Look,
  LookStamp,
  MotionConfig,
  MotionData,
  MotionOutput,
  MotionTheme,
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
  kind: "code" | "motion";
  messages: ChatMessage[];
  /** kind "code": the snippet; kind "motion": `{ code }` of the composition. */
  current?: CodeData | { code: string };
  context?: { files: ContextFile[] };
  post?: { title: string; text: string };
  /** kind "motion": the post look (pace/mood guidance). Ignored for code. */
  look?: Look | null;
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

async function postJSON<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) return redirectToLogin();
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export interface ImageRequest {
  messages: ChatMessage[];
  current?: ImageData;
  aspect: Aspect;
  post?: { title: string; text: string };
  look?: Look | null;
}

/** POST /api/ai/image (not streamed; can take 10-30 s). */
export async function generateImage(body: ImageRequest, signal?: AbortSignal): Promise<{ image: ImageData; note: string }> {
  const r = await postJSON<{ image?: ImageData; note?: string }>("/api/ai/image", body, signal);
  if (!r || !r.image || typeof r.image.url !== "string" || !r.image.url) throw new Error("No image came back. Try again.");
  return { image: r.image, note: typeof r.note === "string" ? r.note : "" };
}

// ---- NDJSON job streams ---------------------------------------------------------

export type JobDone = Extract<JobEvent, { type: "done" }>;

export const DROPPED = "The connection dropped. Try again.";

function abortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("Aborted", "AbortError");
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

function asJobEvent(v: unknown): JobEvent | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.type === "progress") {
    const p = typeof o.progress === "number" && isFinite(o.progress) ? Math.min(1, Math.max(0, o.progress)) : 0;
    return { type: "progress", label: typeof o.label === "string" ? o.label : "", progress: p };
  }
  if (o.type === "done" && typeof o.url === "string") {
    return {
      type: "done",
      url: o.url,
      width: typeof o.width === "number" ? o.width : 0,
      height: typeof o.height === "number" ? o.height : 0,
    };
  }
  if (o.type === "error") {
    return { type: "error", message: typeof o.message === "string" && o.message ? o.message : "Something went wrong." };
  }
  return null;
}

/**
 * Reads an NDJSON stream of JobEvents. Every event goes to `onEvent`.
 * Resolves with the `done` event; throws Error(message) on an `error` event,
 * Error(DROPPED) if the stream ends without either, and an AbortError when
 * `signal` aborts. Handles lines split across chunks and a missing final newline.
 */
export async function readJobStream(
  res: Response,
  onEvent: (e: JobEvent) => void,
  signal?: AbortSignal,
): Promise<JobDone> {
  if (signal?.aborted) throw abortError();
  let final: JobDone | null = null;
  const handle = (line: string) => {
    const t = line.trim();
    if (!t || final) return;
    let raw: unknown;
    try {
      raw = JSON.parse(t);
    } catch {
      return; // not a JSON line (keep-alive noise): skip
    }
    const ev = asJobEvent(raw);
    if (!ev) return;
    onEvent(ev);
    if (ev.type === "done") final = ev;
    else if (ev.type === "error") throw new Error(ev.message);
  };

  if (!res.body) {
    const text = await res.text();
    if (signal?.aborted) throw abortError();
    for (const line of text.split("\n")) {
      handle(line);
      if (final) return final;
    }
    throw new Error(DROPPED);
  }

  const reader = res.body.getReader();
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let buf = "";
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortError();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        handle(line);
        if (final) return final;
      }
    }
    finished = true;
    buf += decoder.decode();
    handle(buf);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!finished) reader.cancel().catch(() => {});
  }
  if (final) return final;
  throw new Error(DROPPED);
}

async function postJob(
  url: string,
  body: unknown,
  onEvent: (e: JobEvent) => void,
  signal?: AbortSignal,
): Promise<JobDone> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) return redirectToLogin();
  if (!res.ok) throw new Error(await readError(res));
  return readJobStream(res, onEvent, signal);
}

/** POST /api/render: render a composition to an asset. */
export function renderMotion(
  body: { code: string; output: MotionOutput; theme?: MotionTheme },
  onEvent: (e: JobEvent) => void,
  signal?: AbortSignal,
): Promise<JobDone> {
  return postJob("/api/render", body, onEvent, signal);
}

/** POST /api/ai/video: generate a clip with the video model. */
export function generateClip(
  body: { prompt: string; aspect: Aspect; seconds: number; look?: Look | null },
  onEvent: (e: JobEvent) => void,
  signal?: AbortSignal,
): Promise<JobDone> {
  return postJob("/api/ai/video", body, onEvent, signal);
}

/** Readable message for a failed fetch (TypeError = network down). */
export function errorMessage(e: unknown): string {
  return e instanceof Error && e.message && e.name !== "TypeError" ? e.message : "Network error. Check your connection.";
}

export function isAbort(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: unknown }).name === "AbortError";
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

/** A Remotion composition (motion "Animation" mode). */
export interface AnimData {
  code: string;
}

/** A video-model clip (motion "Video clip" mode). */
export interface ClipData {
  prompt: string;
  aspect: Aspect;
  seconds: number;
  url: string;
  width: number;
  height: number;
  /** look the clip was generated with (see LookStamp; undefined = no post look at the time) */
  look?: LookStamp;
}

export type Version =
  | { kind: "code"; data: CodeData }
  | { kind: "repo"; data: RepoData }
  | { kind: "image"; data: ImageData }
  | { kind: "motion"; data: AnimData }
  | { kind: "clip"; data: ClipData };

export interface ThreadItem {
  role: "user" | "assistant";
  content: string;
  /** assistant: index of the version this turn produced */
  version?: number;
  /** assistant: index of the version that was current when the request was sent */
  base?: number;
}

/** What a request asks for: code/motion stream text, image is one JSON call, clip is an NDJSON job. */
export type RequestKind = "code" | "motion" | "image" | "clip";

export interface PendingRequest {
  id: number;
  kind: RequestKind;
  base: number; // version index sent as `current` (-1 = none)
  messages: ChatMessage[];
  /** kind "code" */
  current?: CodeData;
  /** kind "motion": code of the base version */
  code?: string;
  /** kind "image": the image on screen */
  image?: ImageData;
  context: ContextFile[];
  /** kind "image" | "clip" */
  aspect?: Aspect;
  /** kind "clip" */
  prompt?: string;
  seconds?: number;
  /** the look sent with the request (null = none) */
  look: Look | null;
  /** stamp given to what this request produces (undefined = the post had no look) */
  stamp: LookStamp | undefined;
}

export type StudioView = "chat" | "github";
export type StudioMode = "code" | "github" | "image" | "motion";
export type MotionMode = "code" | "clip";

export type PreviewStatus = { ok: true; config: MotionConfig } | { ok: false; message: string };

export interface RenderJob {
  id: number;
  code: string;
  output: MotionOutput;
  phase: "running" | "error" | "done";
  message?: string;
  result?: { url: string; width: number; height: number };
  /** the look whose theme the render uses (null = default theme) */
  look: Look | null;
  stamp: LookStamp | undefined;
}

/** The per-mode part of a motion session, parked while the other mode is shown. */
export interface Track {
  versions: Version[];
  index: number;
  thread: ThreadItem[];
  draft: string;
  error: string | null;
}

export interface StudioState {
  mode: StudioMode; // how the studio was opened
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

  // ---- image / motion ----
  motionMode: MotionMode;
  /** the inactive motion mode's track */
  parked: Track | null;
  aspect: Aspect;
  seconds: number;
  output: MotionOutput;
  alt: string;
  /** user typed in the alt field: new image results no longer overwrite it */
  altEdited: boolean;
  caption: string;
  /** shown under the alt field when "Add inline" was refused */
  altError: string | null;
  /** last report from the motion preview, keyed by the code it ran */
  preview: ({ code: string } & PreviewStatus) | null;
  /** progress of the running clip job or render */
  progress: { label: string; progress: number } | null;
  render: RenderJob | null;
  /** the motion block being edited, as it was opened (for the skip-render rule) */
  initial: MotionData | null;

  // ---- look ----
  /** the post's effective look (null = none) */
  look: Look | null;
  /** "Use post look" switch (only meaningful when `look` is set) */
  useLook: boolean;
}

export const ASPECTS: Aspect[] = ["16:9", "1:1", "4:5", "3:2"];
export const CLIP_ASPECTS: Aspect[] = ["16:9", "1:1", "4:5"];
export const CLIP_SECONDS = [4, 6, 8];
export const OUTPUTS: MotionOutput[] = ["loop", "gif", "video"];

export const ALT_REQUIRED = "Alt text is required. It describes the figure for screen readers and feeds.";

export function aspectRatio(a: Aspect): number {
  const [w, h] = a.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

/** The listed aspect closest to width/height. */
export function aspectFrom(width: number, height: number, list: Aspect[] = ASPECTS): Aspect {
  if (!(width > 0 && height > 0)) return list[0];
  const r = width / height;
  let best = list[0];
  for (const a of list) if (Math.abs(aspectRatio(a) - r) < Math.abs(aspectRatio(best) - r)) best = a;
  return best;
}

function isAspect(v: unknown): v is Aspect {
  return typeof v === "string" && (ASPECTS as string[]).includes(v);
}

function isOutput(v: unknown): v is MotionOutput {
  return typeof v === "string" && (OUTPUTS as string[]).includes(v);
}

function emptyTrack(): Track {
  return { versions: [], index: -1, thread: [], draft: "", error: null };
}

// ---- Look helpers ----------------------------------------------------------------

/** The stamp something made now would get: undefined without a post look, null when switched off. */
export function lookStampFor(look: Look | null | undefined, useLook: boolean): LookStamp | undefined {
  if (!look) return undefined;
  return useLook ? stampOf(look) : null;
}

/** Two stamps describe the same rendering. null and undefined both mean "default theme / no look". */
export function sameStamp(a: LookStamp | undefined, b: LookStamp | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.id === b.id && a.version === b.version;
}

/** The look generation in this session uses (null when there is none or the switch is off). */
export function activeLook(s: Pick<StudioState, "look" | "useLook">): Look | null {
  return s.look && s.useLook ? s.look : null;
}

export function currentStamp(s: Pick<StudioState, "look" | "useLook">): LookStamp | undefined {
  return lookStampFor(s.look, s.useLook);
}

export function initStudio(opts: { mode: StudioMode; existing?: GenBlockAttrs | null; look?: Look | null }): StudioState {
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
    motionMode: "code",
    parked: null,
    aspect: "16:9",
    seconds: 6,
    output: "loop",
    alt: "",
    altEdited: false,
    caption: "",
    altError: null,
    preview: null,
    progress: null,
    render: null,
    initial: null,
    look: opts.look ?? null,
    useLook: true,
  };
  const ex = opts.existing;
  if (!ex) return base;
  // Reopening restores the switch: a deliberate one-off (null) comes back off.
  const exStamp = (ex.data as { look?: LookStamp } | undefined)?.look;
  base.useLook = exStamp !== null;
  const versions: Version[] = [];
  let extra: Partial<StudioState> = {};
  if (ex.kind === "code" && typeof (ex.data as CodeData).code === "string") {
    versions.push({ kind: "code", data: { ...(ex.data as CodeData) } });
  } else if (ex.kind === "repo" && typeof (ex.data as RepoData).fullName === "string") {
    versions.push({ kind: "repo", data: { ...(ex.data as RepoData) } });
  } else if (ex.kind === "image") {
    const d = ex.data as Partial<ImageData>;
    const aspect = isAspect(d.aspect) ? d.aspect : "16:9";
    if (typeof d.url === "string" && d.url) {
      const data: ImageData = { url: d.url, alt: d.alt ?? "", prompt: typeof d.prompt === "string" ? d.prompt : "", aspect };
      if (d.look !== undefined) data.look = d.look;
      versions.push({ kind: "image", data });
    }
    extra = { mode: "image", aspect, alt: d.alt ?? "", altEdited: !!d.alt, caption: d.caption ?? "" };
  } else if (ex.kind === "motion") {
    const d = ex.data as Partial<MotionData>;
    const output = isOutput(d.output) ? d.output : "loop";
    const initial: MotionData = {
      mode: d.mode === "clip" ? "clip" : "code",
      code: d.code,
      config: d.config,
      prompt: d.prompt,
      output,
      url: typeof d.url === "string" ? d.url : "",
      width: d.width ?? 0,
      height: d.height ?? 0,
      alt: d.alt ?? "",
      caption: d.caption,
    };
    if (d.look !== undefined) initial.look = d.look;
    extra = { mode: "motion", motionMode: initial.mode, output, alt: initial.alt, altEdited: true, caption: d.caption ?? "", initial };
    if (initial.mode === "code" && typeof d.code === "string" && d.code.trim()) {
      versions.push({ kind: "motion", data: { code: d.code } });
      if (d.config) extra.preview = { code: d.code, ok: true, config: d.config };
    } else if (initial.mode === "clip") {
      const aspect = aspectFrom(initial.width, initial.height, CLIP_ASPECTS);
      extra.aspect = aspect;
      extra.output = output === "gif" ? "loop" : output;
      extra.draft = d.prompt ?? "";
      if (initial.url) {
        const clip: ClipData = { prompt: d.prompt ?? "", aspect, seconds: 6, url: initial.url, width: initial.width, height: initial.height };
        if (d.look !== undefined) clip.look = d.look;
        versions.push({ kind: "clip", data: clip });
      }
    }
  }
  const thread: ThreadItem[] = (ex.history ?? [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));
  // Restore version chips: the existing artifact is v1, attach it to the last assistant turn.
  if (versions.length && (ex.kind === "image" || ex.kind === "motion")) {
    for (let i = thread.length - 1; i >= 0; i--) {
      if (thread[i].role === "assistant") {
        thread[i] = { ...thread[i], version: 0 };
        break;
      }
    }
  }
  // Opening an existing block always lands in chat (the artifact is shown).
  return { ...base, ...extra, view: "chat", versions, index: versions.length ? 0 : -1, thread };
}

export function currentVersion(s: StudioState): Version | null {
  return s.index >= 0 ? s.versions[s.index] ?? null : null;
}

export function hasCompleteArtifact(s: StudioState): boolean {
  const v = currentVersion(s);
  if (!v) return false;
  switch (v.kind) {
    case "repo":
      return !!v.data.fullName;
    case "image":
    case "clip":
      return !!v.data.url;
    default:
      return v.data.code.trim().length > 0;
  }
}

export function historyOf(thread: ThreadItem[]): ChatMessage[] {
  return thread
    .filter((t) => t.content.trim() !== "")
    .map((t) => ({ role: t.role, content: t.content }));
}

/** The kind of request a send/regenerate makes in this session. */
export function requestKindOf(s: StudioState): RequestKind {
  if (s.mode === "image") return "image";
  if (s.mode === "motion") return s.motionMode === "clip" ? "clip" : "motion";
  return "code";
}

/** True while something async (request or render) owns the session. */
export function isBusy(s: StudioState): boolean {
  return !!s.request || s.render?.phase === "running";
}

/** The preview error for the version on screen, if the preview reported one. */
export function previewError(s: StudioState): string | null {
  const v = currentVersion(s);
  if (!v || v.kind !== "motion" || !s.preview || s.preview.ok) return null;
  return s.preview.code === v.data.code ? s.preview.message : null;
}

export function fixItText(message: string): string {
  return `The animation failed with this error: ${message}`;
}

export type StudioAction =
  | { type: "draft"; text: string }
  | { type: "send"; text: string }
  | { type: "retry" }
  | { type: "regenerate" }
  | { type: "stream"; id: number; text: string }
  | { type: "done"; id: number; text: string }
  | { type: "imageDone"; id: number; image: ImageData; note: string }
  | { type: "progress"; id: number; label: string; progress: number }
  | { type: "clipDone"; id: number; url: string; width: number; height: number }
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
  | { type: "dismissError" }
  | { type: "aspect"; aspect: Aspect }
  | { type: "seconds"; seconds: number }
  | { type: "output"; output: MotionOutput }
  | { type: "alt"; text: string }
  | { type: "caption"; text: string }
  | { type: "requireAlt" }
  | { type: "motionMode"; mode: MotionMode }
  | { type: "previewStatus"; code: string; status: PreviewStatus }
  | { type: "fixIt" }
  | { type: "renderStart" }
  | { type: "renderProgress"; id: number; label: string; progress: number }
  | { type: "renderDone"; id: number; url: string; width: number; height: number }
  | { type: "renderFail"; id: number; message: string }
  | { type: "renderCancel" }
  | { type: "renderDismiss" }
  | { type: "useLook"; on: boolean }
  | { type: "look"; look: Look | null };

function lastUserText(thread: ThreadItem[]): string {
  for (let i = thread.length - 1; i >= 0; i--) if (thread[i].role === "user") return thread[i].content;
  return "";
}

function startRequest(s: StudioState, thread: ThreadItem[], base: number): StudioState {
  const v = base >= 0 ? s.versions[base] : undefined;
  const kind = requestKindOf(s);
  const request: PendingRequest = {
    id: s.nextId,
    kind,
    base,
    messages: historyOf(thread),
    context: s.context,
    look: kind === "code" ? null : activeLook(s),
    stamp: kind === "code" ? undefined : currentStamp(s),
  };
  if (kind === "code") request.current = v && v.kind === "code" ? v.data : undefined;
  if (kind === "motion" && v && v.kind === "motion") request.code = v.data.code;
  if (kind === "image") {
    request.aspect = s.aspect;
    if (v && v.kind === "image") request.image = v.data;
  }
  if (kind === "clip") {
    request.prompt = lastUserText(thread);
    request.aspect = s.aspect;
    request.seconds = s.seconds;
  }
  return {
    ...s,
    thread,
    index: base,
    request,
    streamText: "",
    progress: null,
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

function withCode(v: Version, code: string): Version {
  if (v.kind === "motion") return { kind: "motion", data: { code } };
  if (v.kind === "code") return { kind: "code", data: { ...v.data, code } };
  return v;
}

function finishTurn(s: StudioState, cleared: StudioState, v: Version, note: string, base: number): StudioState {
  const next = pushVersion(cleared, v);
  return {
    ...next,
    thread: [...s.thread, { role: "assistant", content: note, version: next.index, base }],
  };
}

export function studioReducer(s: StudioState, a: StudioAction): StudioState {
  switch (a.type) {
    case "draft":
      return { ...s, draft: a.text };

    case "send": {
      const text = a.text.trim();
      if (!text || isBusy(s)) return s;
      let thread = s.thread;
      // A failed user turn is replaced by the new one rather than stacked.
      if (s.error && thread.length && thread[thread.length - 1].role === "user") {
        thread = thread.slice(0, -1);
      }
      thread = [...thread, { role: "user", content: text }];
      return { ...startRequest(s, thread, s.index), draft: "" };
    }

    case "retry": {
      if (isBusy(s)) return s;
      const last = s.thread[s.thread.length - 1];
      if (!last || last.role !== "user") return s;
      return startRequest(s, s.thread, s.index);
    }

    case "regenerate": {
      if (isBusy(s)) return s;
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
      const kind = s.request.kind;
      const cleared: StudioState = { ...s, request: null, streamText: "" };
      const art = extractArtifact(a.text);
      if (art && art.complete && art.code.trim()) {
        if (kind === "motion") {
          return finishTurn(s, cleared, { kind: "motion", data: { code: art.code } }, art.note || "Updated the animation.", base);
        }
        const prev = base >= 0 ? s.versions[base] : undefined;
        const prevCode = prev && prev.kind === "code" ? prev.data : undefined;
        const data: CodeData = {
          language: art.language || prevCode?.language || "text",
          code: art.code,
          filename: art.filename ?? prevCode?.filename,
        };
        if (prevCode?.caption) data.caption = prevCode.caption;
        if (prevCode?.source) data.source = prevCode.source;
        return finishTurn(s, cleared, { kind: "code", data }, art.note || "Updated the snippet.", base);
      }
      const textOnly = a.text.trim();
      if (!textOnly) return { ...cleared, error: "The reply was empty." };
      return {
        ...cleared,
        thread: [...s.thread, { role: "assistant", content: textOnly, base }],
        dirty: true,
      };
    }

    case "imageDone": {
      if (!s.request || s.request.id !== a.id || s.request.kind !== "image") return s;
      const base = s.request.base;
      const image: ImageData = {
        url: a.image.url,
        alt: a.image.alt ?? "",
        prompt: a.image.prompt ?? "",
        aspect: isAspect(a.image.aspect) ? a.image.aspect : s.request.aspect ?? s.aspect,
      };
      if (s.request.stamp !== undefined) image.look = s.request.stamp;
      const cleared: StudioState = { ...s, request: null, streamText: "" };
      if (!s.altEdited && image.alt) {
        cleared.alt = image.alt;
        cleared.altError = null;
      }
      return finishTurn(s, cleared, { kind: "image", data: image }, a.note.trim() || "Here is the image.", base);
    }

    case "progress":
      if (!s.request || s.request.id !== a.id) return s;
      return { ...s, progress: { label: a.label, progress: a.progress } };

    case "clipDone": {
      if (!s.request || s.request.id !== a.id || s.request.kind !== "clip") return s;
      const r = s.request;
      const data: ClipData = {
        prompt: r.prompt ?? "",
        aspect: r.aspect ?? s.aspect,
        seconds: r.seconds ?? s.seconds,
        url: a.url,
        width: a.width,
        height: a.height,
      };
      if (r.stamp !== undefined) data.look = r.stamp;
      const cleared: StudioState = {
        ...s,
        request: null,
        progress: null,
        // Prefill the composer with the prompt so it can be edited and run again.
        draft: s.draft.trim() ? s.draft : data.prompt,
      };
      return finishTurn(s, cleared, { kind: "clip", data }, `Generated a ${data.seconds}-second ${data.aspect} clip.`, r.base);
    }

    case "fail":
      if (!s.request || s.request.id !== a.id) return s;
      return { ...s, request: null, streamText: "", progress: null, error: a.error || "Something went wrong." };

    case "stop": {
      if (!s.request) return s;
      const last = s.thread[s.thread.length - 1];
      // Give the user's words back to the composer.
      if (last && last.role === "user") {
        return {
          ...s,
          request: null,
          streamText: "",
          progress: null,
          thread: s.thread.slice(0, -1),
          draft: s.draft.trim() ? s.draft : last.content,
        };
      }
      return { ...s, request: null, streamText: "", progress: null };
    }

    case "go":
      if (isBusy(s) || a.index < 0 || a.index >= s.versions.length) return s;
      return { ...s, index: a.index, handEdit: false, handVersion: null };

    case "step":
      return studioReducer(s, { type: "go", index: s.index + a.delta });

    case "handEdit":
      if (isBusy(s)) return s;
      return { ...s, handEdit: a.on, handVersion: null };

    case "handText": {
      if (isBusy(s)) return s;
      if (s.handVersion !== null && s.handVersion === s.index) {
        const v = currentVersion(s);
        if (!v) return s;
        const versions = s.versions.slice();
        versions[s.index] = withCode(v, a.code);
        return { ...s, versions, dirty: true };
      }
      const v = currentVersion(s);
      if (v && (v.kind === "code" || v.kind === "motion") && v.data.code === a.code) return s;
      let next: Version;
      if (v && (v.kind === "code" || v.kind === "motion")) next = withCode(v, a.code);
      else if (s.mode === "motion") next = { kind: "motion", data: { code: a.code } };
      else next = { kind: "code", data: { language: "text", code: a.code } };
      const pushed = pushVersion(s, next);
      return { ...pushed, handVersion: pushed.index };
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

    // ---- image / motion ----

    case "aspect": {
      // Takes effect on the next send/regenerate, never by itself.
      const list = s.mode === "motion" ? CLIP_ASPECTS : ASPECTS;
      if (!list.includes(a.aspect) || a.aspect === s.aspect) return s;
      return { ...s, aspect: a.aspect };
    }

    case "seconds":
      if (!CLIP_SECONDS.includes(a.seconds)) return s;
      return { ...s, seconds: a.seconds };

    case "output": {
      if (!isOutput(a.output) || a.output === s.output || s.render?.phase === "running") return s;
      if (a.output === "gif" && s.motionMode === "clip") return s;
      return { ...s, output: a.output, dirty: true };
    }

    case "alt":
      return { ...s, alt: a.text, altEdited: true, altError: a.text.trim() ? null : s.altError, dirty: true };

    case "caption":
      return { ...s, caption: a.text, dirty: true };

    case "requireAlt":
      return { ...s, altError: ALT_REQUIRED };

    case "motionMode": {
      if (s.mode !== "motion" || a.mode === s.motionMode || isBusy(s)) return s;
      const active: Track = { versions: s.versions, index: s.index, thread: s.thread, draft: s.draft, error: s.error };
      const next = s.parked ?? emptyTrack();
      return {
        ...s,
        motionMode: a.mode,
        parked: active,
        versions: next.versions,
        index: next.index,
        thread: next.thread,
        draft: next.draft,
        error: next.error,
        render: null,
        progress: null,
        handEdit: false,
        handVersion: null,
        output: a.mode === "clip" && s.output === "gif" ? "loop" : s.output,
        aspect: CLIP_ASPECTS.includes(s.aspect) ? s.aspect : "16:9",
      };
    }

    case "previewStatus": {
      const p = s.preview;
      if (p && p.code === a.code && p.ok === a.status.ok) {
        if (p.ok && a.status.ok && sameConfig(p.config, a.status.config)) return s;
        if (!p.ok && !a.status.ok && p.message === a.status.message) return s;
      }
      return { ...s, preview: { code: a.code, ...a.status } };
    }

    case "fixIt": {
      const msg = previewError(s);
      if (!msg) return s;
      return studioReducer(s, { type: "send", text: fixItText(msg) });
    }

    case "renderStart": {
      const v = currentVersion(s);
      if (isBusy(s) || !v || v.kind !== "motion" || !v.data.code.trim()) return s;
      return {
        ...s,
        render: {
          id: s.nextId,
          code: v.data.code,
          output: s.output,
          phase: "running",
          look: activeLook(s),
          stamp: currentStamp(s),
        },
        progress: { label: "Starting render", progress: 0 },
        handEdit: false,
        handVersion: null,
        nextId: s.nextId + 1,
      };
    }

    case "renderProgress":
      if (!s.render || s.render.id !== a.id || s.render.phase !== "running") return s;
      return { ...s, progress: { label: a.label, progress: a.progress } };

    case "renderDone":
      if (!s.render || s.render.id !== a.id || s.render.phase !== "running") return s;
      return {
        ...s,
        render: { ...s.render, phase: "done", result: { url: a.url, width: a.width, height: a.height } },
        progress: null,
      };

    case "renderFail":
      if (!s.render || s.render.id !== a.id || s.render.phase !== "running") return s;
      return { ...s, render: { ...s.render, phase: "error", message: a.message || "The render failed." }, progress: null };

    case "renderCancel":
    case "renderDismiss":
      if (!s.render || s.render.phase === "done") return s;
      return { ...s, render: null, progress: null };

    case "useLook":
      // Applies to the next generation/render; never changes what is on screen.
      if (isBusy(s) || a.on === s.useLook) return s;
      return { ...s, useLook: a.on, dirty: true };

    case "look":
      if (a.look === s.look) return s;
      return { ...s, look: a.look };
  }
}

function sameConfig(a: MotionConfig, b: MotionConfig): boolean {
  return a.durationInFrames === b.durationInFrames && a.fps === b.fps && a.width === b.width && a.height === b.height;
}

export type StudioCommitResult = Pick<GenBlockAttrs, "kind" | "data" | "history">;

/** Image block data from the version on screen plus the alt/caption fields. */
export function buildImageData(v: ImageData, alt: string, caption: string): ImageData {
  const data: ImageData = { url: v.url, alt: alt.trim(), prompt: v.prompt, aspect: v.aspect };
  if (caption.trim()) data.caption = caption.trim();
  if (v.look !== undefined) data.look = v.look;
  return data;
}

/** Motion block data. `asset` is the rendered/generated file (url "" = not rendered). */
export function buildMotionData(opts: {
  mode: "code" | "clip";
  code?: string;
  config?: MotionConfig;
  prompt?: string;
  output: MotionOutput;
  asset: { url: string; width: number; height: number };
  alt: string;
  caption: string;
  /** undefined = leave unset (the post has no look) */
  look?: LookStamp;
}): MotionData {
  const data: MotionData = {
    mode: opts.mode,
    output: opts.mode === "clip" && opts.output === "gif" ? "loop" : opts.output,
    url: opts.asset.url,
    width: opts.asset.width,
    height: opts.asset.height,
    alt: opts.alt.trim(),
  };
  if (opts.mode === "code") {
    data.code = opts.code ?? "";
    if (opts.config) data.config = opts.config;
  } else {
    data.prompt = opts.prompt ?? "";
  }
  if (opts.caption.trim()) data.caption = opts.caption.trim();
  if (opts.look !== undefined) data.look = opts.look;
  return data;
}

/** Config of `code`: from the preview when it ran this code, else from the opened block. */
export function configFor(s: StudioState, code: string): MotionConfig | undefined {
  if (s.preview && s.preview.ok && s.preview.code === code) return s.preview.config;
  if (s.initial && s.initial.mode === "code" && s.initial.code === code && s.initial.config) return s.initial.config;
  return undefined;
}

export type CommitPlan =
  | { type: "blocked"; reason: "incomplete" | "alt" | "busy" }
  | { type: "render" }
  | { type: "commit"; result: StudioCommitResult };

/**
 * What "Add inline"/"Update" should do now. Animations render first unless a
 * render of exactly this code+output+look exists (just made, or the opened block's).
 * `skipRender` = "Add without rendering" (url "").
 */
export function planCommit(s: StudioState, opts: { skipRender?: boolean } = {}): CommitPlan {
  const v = currentVersion(s);
  if (!v || !hasCompleteArtifact(s)) return { type: "blocked", reason: "incomplete" };
  if (s.request || s.render?.phase === "running") return { type: "blocked", reason: "busy" };
  const history = historyOf(s.thread);
  if (v.kind === "code" || v.kind === "repo") return { type: "commit", result: { kind: v.kind, data: v.data, history } };
  if (!s.alt.trim()) return { type: "blocked", reason: "alt" };
  if (v.kind === "image") {
    return { type: "commit", result: { kind: "image", data: { ...buildImageData(v.data, s.alt, s.caption) }, history } };
  }
  if (v.kind === "clip") {
    const data = buildMotionData({
      mode: "clip",
      prompt: v.data.prompt,
      output: s.output,
      asset: { url: v.data.url, width: v.data.width, height: v.data.height },
      alt: s.alt,
      caption: s.caption,
      look: v.data.look,
    });
    return { type: "commit", result: { kind: "motion", data: { ...data }, history } };
  }
  // Animation.
  const code = v.data.code;
  const config = configFor(s, code);
  const stamp = currentStamp(s);
  let asset: { url: string; width: number; height: number } | null = null;
  const r = s.render;
  if (r && r.phase === "done" && r.result && r.code === code && r.output === s.output && sameStamp(r.stamp, stamp)) asset = r.result;
  else if (
    s.initial &&
    s.initial.mode === "code" &&
    s.initial.url &&
    s.initial.code === code &&
    s.initial.output === s.output &&
    sameStamp(s.initial.look, stamp)
  ) {
    asset = { url: s.initial.url, width: s.initial.width, height: s.initial.height };
  } else if (opts.skipRender) {
    asset = { url: "", width: config?.width ?? 0, height: config?.height ?? 0 };
  }
  if (!asset) return { type: "render" };
  const data = buildMotionData({ mode: "code", code, config, output: s.output, asset, alt: s.alt, caption: s.caption, look: stamp });
  return { type: "commit", result: { kind: "motion", data: { ...data }, history } };
}

/** What the "Add inline" button commits when no render/validation is involved (code, repo). */
export function commitResult(s: StudioState): StudioCommitResult | null {
  const p = planCommit(s);
  return p.type === "commit" ? p.result : null;
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

// ---- Look: off-look blocks, restyle, auto-capture ---------------------------------

/** How a block follows the look. Code and repo blocks don't (code is themed at render time). */
export type RestyleKind = "image" | "animation" | "clip";

export function restyleKindOf(kind: GenKind | string, data: unknown): RestyleKind | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (kind === "image") return typeof d.url === "string" && d.url ? "image" : null;
  if (kind === "motion") {
    if (d.mode === "clip") return typeof d.prompt === "string" && d.prompt.trim() ? "clip" : null;
    return typeof d.code === "string" && d.code.trim() ? "animation" : null;
  }
  return null;
}

export interface OffLookItem {
  id: string;
  kind: RestyleKind;
}

/** Structural slice of a ProseMirror node, so this stays testable without an editor. */
interface DocLike {
  descendants(f: (node: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void): void;
}

/** Off-look image/motion blocks in document order. */
export function offLookBlocks(doc: DocLike, look: Look | null | undefined): OffLookItem[] {
  if (!look) return [];
  const out: OffLookItem[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "genBlock") return true;
    const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
    const kind = restyleKindOf(node.attrs.kind as string, node.attrs.data);
    if (id && kind && isOffLook((node.attrs.data as { look?: LookStamp } | null)?.look, look)) out.push({ id, kind });
    return false;
  });
  return out;
}

export type ExtractSource = { kind: "image"; url: string; prompt?: string } | { kind: "motion"; code: string };

/** What "Use as the look" / auto-capture reads from a block; null when the block can't set a look. */
export function captureSource(kind: GenKind | string, data: unknown): ExtractSource | null {
  const k = restyleKindOf(kind, data);
  const d = (data ?? {}) as Record<string, unknown>;
  if (k === "image") {
    const src: ExtractSource = { kind: "image", url: d.url as string };
    if (typeof d.prompt === "string" && d.prompt) src.prompt = d.prompt;
    return src;
  }
  if (k === "animation") return { kind: "motion", code: d.code as string };
  return null;
}

/** Does the block's data still hold what the look was read from? */
export function sourceStillMatches(src: ExtractSource, data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  return src.kind === "image" ? d.url === src.url : d.code === src.code;
}

export const RESTYLE_IMAGE_TEXT = "Restyle this to match the post's look. Keep the same subject and composition.";

export interface RestyleInput {
  kind: GenKind | string;
  data: Record<string, unknown>;
  history: ChatMessage[];
  look: Look;
  signal?: AbortSignal;
  onProgress?(p: { label: string; progress: number }): void;
  post?: { title: string; text: string };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

/**
 * Bring one block in line with `look`. Returns the block's new data and history.
 * - animation: convert hard-coded colours once (AI), then re-render with the look's theme
 * - image: redraw via /api/ai/image with the look, keeping alt/caption; the turn joins the history
 * - clip: regenerate via /api/ai/video with the stored prompt (costly; per-block only)
 */
export async function restyleData(input: RestyleInput): Promise<{ data: Record<string, unknown>; history: ChatMessage[] }> {
  const { data, history, look, signal, onProgress } = input;
  const kind = restyleKindOf(input.kind, data);
  const stamp = stampOf(look);
  const progress = (label: string, p: number) => {
    if (!signal?.aborted) onProgress?.({ label, progress: p });
  };
  throwIfAborted(signal);

  if (kind === "animation") {
    const d = data as unknown as MotionData;
    let code = d.code ?? "";
    if (!usesTheme(code)) {
      progress("Converting colours", 0);
      code = await api.restyleMotion(code);
      throwIfAborted(signal);
    }
    progress("Starting render", 0);
    const done = await renderMotion(
      { code, output: d.output, theme: motionThemeFromLook(look) },
      (ev) => {
        if (ev.type === "progress") progress(ev.label, ev.progress);
      },
      signal,
    );
    throwIfAborted(signal);
    const next: MotionData = { ...d, code, url: done.url, width: done.width, height: done.height, look: stamp };
    if (code !== d.code) delete next.config; // the preview re-reads it
    return { data: next as unknown as Record<string, unknown>, history };
  }

  if (kind === "image") {
    const d = data as unknown as ImageData;
    progress("Redrawing", 0);
    const messages: ChatMessage[] = [...history, { role: "user", content: RESTYLE_IMAGE_TEXT }];
    const aspect = isAspect(d.aspect) ? d.aspect : "16:9";
    const r = await generateImage({ messages, current: d, aspect, post: input.post, look }, signal);
    throwIfAborted(signal);
    const next: ImageData = {
      url: r.image.url,
      alt: d.alt,
      prompt: r.image.prompt ?? d.prompt,
      aspect: isAspect(r.image.aspect) ? r.image.aspect : aspect,
      look: stamp,
    };
    if (d.caption) next.caption = d.caption;
    const turn: ChatMessage[] = [{ role: "user", content: RESTYLE_IMAGE_TEXT }];
    if (r.note.trim()) turn.push({ role: "assistant", content: r.note.trim() });
    return { data: next as unknown as Record<string, unknown>, history: [...history, ...turn] };
  }

  if (kind === "clip") {
    const d = data as unknown as MotionData;
    progress("Starting", 0);
    const done = await generateClip(
      { prompt: d.prompt ?? "", aspect: aspectFrom(d.width, d.height, CLIP_ASPECTS), seconds: 6, look },
      (ev) => {
        if (ev.type === "progress") progress(ev.label, ev.progress);
      },
      signal,
    );
    throwIfAborted(signal);
    const next: MotionData = { ...d, url: done.url, width: done.width, height: done.height, look: stamp };
    return { data: next as unknown as Record<string, unknown>, history };
  }

  throw new Error("This block can't be restyled.");
}

export interface RestyleQueueState {
  done: number;
  total: number;
  label: string;
  /** id of the block being restyled now */
  current: string | null;
}

export function restyleLabel(kind: RestyleKind, i: number, total: number): string {
  const n = total > 1 ? ` ${i + 1} of ${total}` : "";
  return kind === "image" ? `Redrawing image${n}` : kind === "animation" ? `Rendering animation${n}` : `Regenerating clip${n}`;
}

/**
 * Restyle blocks one at a time, in order. Clips are skipped (they are per-block only).
 * A failure doesn't stop the queue; aborting `signal` stops it (finished ones stay).
 * A single item aborted on its own (its block's Cancel) is skipped, not counted as failed.
 */
export async function runRestyleQueue(opts: {
  items: OffLookItem[];
  run(item: OffLookItem, signal: AbortSignal): Promise<void>;
  signal: AbortSignal;
  onUpdate(state: RestyleQueueState): void;
}): Promise<{ done: number; failed: number; cancelled: boolean }> {
  const items = opts.items.filter((it) => it.kind !== "clip");
  const total = items.length;
  let done = 0;
  let failed = 0;
  for (let i = 0; i < total; i++) {
    if (opts.signal.aborted) break;
    const item = items[i];
    opts.onUpdate({ done, total, label: restyleLabel(item.kind, i, total), current: item.id });
    try {
      await opts.run(item, opts.signal);
    } catch (e) {
      if (opts.signal.aborted) break;
      if (!isAbort(e)) failed++;
    }
    done++;
  }
  const cancelled = opts.signal.aborted;
  opts.onUpdate({ done, total, label: cancelled ? "Stopped" : "Done", current: null });
  return { done, failed, cancelled };
}

/**
 * Auto-capture: the first image/animation added to a post without a look sets it.
 * Never when a look exists, never twice at once; failures are silent.
 * `apply` receives the look, the block and the source it came from (the caller stamps the block).
 */
export function createAutoCapture(deps: {
  getLook(): Look | null;
  extract(source: ExtractSource): Promise<Look>;
  apply(look: Look, attrs: Pick<GenBlockAttrs, "id" | "kind" | "data">, source: ExtractSource): void;
}) {
  let inFlight = false;
  return async function capture(attrs: Pick<GenBlockAttrs, "id" | "kind" | "data">): Promise<"skipped" | "set" | "failed"> {
    if (inFlight || deps.getLook()) return "skipped";
    const src = captureSource(attrs.kind, attrs.data);
    if (!src) return "skipped";
    inFlight = true;
    try {
      const look = await deps.extract(src);
      if (deps.getLook()) return "skipped"; // a look arrived meanwhile: never overwrite it
      deps.apply(look, attrs, src);
      return "set";
    } catch {
      return "failed";
    } finally {
      inFlight = false;
    }
  };
}
