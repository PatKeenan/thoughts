// Thin OpenRouter client: chat() for one-shot replies, chatStream() for plain-text deltas.
import { modelFor, type Job } from "@/lib/models";

export interface ORMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ORRequest {
  job: Job;
  messages: ORMessage[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object response (best effort; callers still parse defensively). */
  json?: boolean;
}

/** An error that already carries an HTTP status and a message fit for the client. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function headers(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new HttpError(500, "OPENROUTER_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.SITE_URL || "https://localhost",
    "X-OpenRouter-Title": "Write",
  };
}

function body(req: ORRequest, stream: boolean): string {
  return JSON.stringify({
    model: modelFor(req.job),
    messages: req.messages,
    stream,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    ...(req.json ? { response_format: { type: "json_object" } } : {}),
  });
}

async function upstreamError(res: Response): Promise<HttpError> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message || j?.message || "";
    } catch {
      detail = text.slice(0, 200);
    }
  } catch {
    /* ignore */
  }
  const base =
    res.status === 401
      ? "OpenRouter rejected the API key"
      : res.status === 402
        ? "OpenRouter account is out of credit"
        : res.status === 429
          ? "OpenRouter rate limit hit, try again shortly"
          : `OpenRouter error ${res.status}`;
  return new HttpError(res.status, detail ? `${base}: ${detail}` : base);
}

async function post(req: ORRequest, stream: boolean): Promise<Response> {
  const h = headers();
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: "POST", headers: h, body: body(req, stream), signal: req.signal });
  } catch (e) {
    if (req.signal?.aborted) throw e;
    throw new HttpError(502, "Could not reach OpenRouter");
  }
  if (!res.ok) throw await upstreamError(res);
  return res;
}

/** One-shot completion; resolves to the assistant text. */
export async function chat(req: ORRequest): Promise<string> {
  const res = await post(req, false);
  const j = await res.json().catch(() => null);
  const content = j?.choices?.[0]?.message?.content;
  if (j?.error) throw new HttpError(502, `OpenRouter error: ${j.error.message ?? "unknown"}`);
  if (typeof content !== "string") throw new HttpError(502, "OpenRouter returned no content");
  return content;
}

/**
 * Turns an OpenRouter SSE body into a stream of plain-text deltas (UTF-8).
 * Handles chunks split anywhere, comment lines (": ..."), and "data: [DONE]".
 */
export function sseToTextStream(
  upstream: ReadableStream<Uint8Array>,
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  let done = false;

  // Returns deltas found in complete lines; sets `done` on [DONE].
  function drain(flush: boolean): string[] {
    const out: string[] = [];
    const lines = buf.split(/\r?\n/);
    buf = flush ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue; // comments, blank lines, event:/id:
      const payload = line.slice(5).trim();
      if (!payload) continue;
      if (payload === "[DONE]") {
        done = true;
        break;
      }
      let j: { choices?: { delta?: { content?: unknown } }[]; error?: { message?: string } };
      try {
        j = JSON.parse(payload);
      } catch {
        continue;
      }
      if (j.error) throw new HttpError(502, `OpenRouter error: ${j.error.message ?? "unknown"}`);
      const c = j.choices?.[0]?.delta?.content;
      if (typeof c === "string" && c) out.push(c);
    }
    return out;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          if (done) {
            controller.close();
            reader.cancel().catch(() => {});
            return;
          }
          const { value, done: eof } = await reader.read();
          if (eof) {
            buf += dec.decode();
            const deltas = drain(true);
            for (const d of deltas) controller.enqueue(enc.encode(d));
            controller.close();
            return;
          }
          buf += dec.decode(value, { stream: true });
          const deltas = drain(false);
          if (deltas.length) {
            for (const d of deltas) controller.enqueue(enc.encode(d));
            return;
          }
        }
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      onCancel?.();
      return reader.cancel(reason);
    },
  });
}

/**
 * Starts a streaming completion. Resolves once upstream has accepted the request
 * (so auth/credit errors surface as HttpError before any bytes are sent), then
 * yields plain-text deltas. Aborting `signal` cancels the upstream request.
 */
export async function chatStream(req: ORRequest): Promise<ReadableStream<Uint8Array>> {
  const res = await post(req, true);
  if (!res.body) throw new HttpError(502, "OpenRouter returned an empty stream");
  return sseToTextStream(res.body);
}

// ---- shared route helpers ---------------------------------------------------

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return jsonError(e.status, e.message);
  console.error(e);
  return jsonError(500, e instanceof Error ? e.message : "Unexpected error");
}

export const MAX_BODY = 400_000;

/** Reads a JSON object body, rejecting anything over `max` bytes with 413. */
export async function readJson(request: Request, max = MAX_BODY): Promise<Record<string, unknown>> {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > max) throw new HttpError(413, "Request body too large");
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "Request body too large");
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "Invalid JSON body");
}

/** Pulls the outermost {...} object out of model text (strips fences and prose). */
export function parseJsonObject(text: string): unknown | null {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/i);
  const candidates = [fence?.[1], t];
  for (const c of candidates) {
    if (!c) continue;
    const a = c.indexOf("{");
    const b = c.lastIndexOf("}");
    if (a === -1 || b <= a) continue;
    try {
      return JSON.parse(c.slice(a, b + 1));
    } catch {
      /* try next */
    }
  }
  return null;
}

// ---- phase 2: citations, images, video --------------------------------------

const API = "https://openrouter.ai/api/v1";

export interface Citation {
  url: string;
  title: string;
}

/** One-shot completion that also returns `message.annotations[]` url citations (web search). */
export async function chatWithCitations(req: ORRequest): Promise<{ content: string; citations: Citation[] }> {
  const res = await post(req, false);
  const j = await res.json().catch(() => null);
  if (j?.error) throw new HttpError(502, `OpenRouter error: ${j.error.message ?? "unknown"}`);
  const msg = j?.choices?.[0]?.message;
  if (typeof msg?.content !== "string") throw new HttpError(502, "OpenRouter returned no content");
  return { content: msg.content, citations: extractCitations(msg.annotations) };
}

/** Annotations to deduped http(s) sources, max `max`. Never invents anything. */
export function extractCitations(annotations: unknown, max = 6): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const a of Array.isArray(annotations) ? annotations : []) {
    if (!a || a.type !== "url_citation") continue;
    const c = a.url_citation;
    if (!c || typeof c.url !== "string") continue;
    let u: URL;
    try {
      u = new URL(c.url);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    u.hash = "";
    const key = u.href.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const title = typeof c.title === "string" && c.title.trim() ? c.title.trim() : u.hostname.replace(/^www\./, "");
    out.push({ url: u.href, title });
    if (out.length >= max) break;
  }
  return out;
}

export interface GeneratedImage {
  /** Base64 bytes (or, defensively, an http(s) URL / data URL). */
  b64: string;
  mediaType: string;
}

/**
 * POST /api/v1/images. `references` (data URLs or http(s) URLs) go in `input_references`
 * (this is how OpenRouter takes image-to-image edits). Response is data[].b64_json.
 */
export async function generateImage(opts: {
  prompt: string;
  aspect: string;
  references?: string[];
  signal?: AbortSignal;
}): Promise<GeneratedImage> {
  const h = headers();
  let res: Response;
  try {
    res = await fetch(`${API}/images`, {
      method: "POST",
      headers: h,
      signal: opts.signal,
      body: JSON.stringify({
        model: modelFor("image"),
        prompt: opts.prompt,
        aspect_ratio: opts.aspect,
        ...(opts.references?.length
          ? { input_references: opts.references.slice(0, 16).map((url) => ({ type: "image_url", image_url: { url } })) }
          : {}),
      }),
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new HttpError(502, "Could not reach OpenRouter");
  }
  if (!res.ok) throw await upstreamError(res);
  const j = await res.json().catch(() => null);
  if (j?.error) throw new HttpError(502, `OpenRouter error: ${j.error.message ?? "unknown"}`);
  const item = j?.data?.[0];
  // Documented shape is b64_json; tolerate a url field too (caller downloads http(s) values).
  const data = typeof item?.b64_json === "string" && item.b64_json ? item.b64_json : typeof item?.url === "string" ? item.url : "";
  if (!data) throw new HttpError(502, "The image model returned no image");
  return { b64: data, mediaType: typeof item.media_type === "string" ? item.media_type : "image/png" };
}

export interface VideoModelInfo {
  durations: number[];
  aspects: string[];
  resolutions: string[];
}

/** GET /api/v1/videos/models → capabilities for one model slug (null if unknown/unavailable). */
export async function videoModelInfo(model: string, signal?: AbortSignal): Promise<VideoModelInfo | null> {
  try {
    const res = await fetch(`${API}/videos/models`, { headers: headers(), signal });
    if (!res.ok) return null;
    const j = await res.json();
    const m = (Array.isArray(j?.data) ? j.data : []).find((x: { id?: string }) => x?.id === model);
    if (!m) return null;
    const arr = (v: unknown) => (Array.isArray(v) ? v : []);
    return {
      durations: arr(m.supported_durations).filter((d): d is number => typeof d === "number"),
      aspects: arr(m.supported_aspect_ratios).filter((d): d is string => typeof d === "string"),
      resolutions: arr(m.supported_resolutions).filter((d): d is string => typeof d === "string"),
    };
  } catch {
    return null;
  }
}

export interface VideoJob {
  id: string;
  status: string;
  pollingUrl: string;
  error?: string;
  unsignedUrls: string[];
}

function toJob(j: Record<string, unknown> | null, prev?: VideoJob): VideoJob {
  if (!j || typeof j !== "object") throw new HttpError(502, "OpenRouter returned an unreadable video job");
  const id = typeof j.id === "string" ? j.id : prev?.id;
  if (!id) throw new HttpError(502, "OpenRouter returned a video job without an id");
  return {
    id,
    status: typeof j.status === "string" ? j.status : "pending",
    pollingUrl: typeof j.polling_url === "string" ? j.polling_url : (prev?.pollingUrl ?? `${API}/videos/${id}`),
    error: typeof j.error === "string" ? j.error : typeof (j.error as { message?: unknown })?.message === "string" ? String((j.error as { message: string }).message) : undefined,
    unsignedUrls: Array.isArray(j.unsigned_urls) ? j.unsigned_urls.filter((u): u is string => typeof u === "string") : (prev?.unsignedUrls ?? []),
  };
}

/** POST /api/v1/videos → job { id, status, polling_url }. */
export async function submitVideo(
  body: { prompt: string; aspect_ratio: string; duration: number; resolution?: string; generate_audio?: boolean },
  signal?: AbortSignal,
): Promise<VideoJob> {
  let res: Response;
  try {
    res = await fetch(`${API}/videos`, { method: "POST", headers: headers(), signal, body: JSON.stringify({ model: modelFor("video"), ...body }) });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new HttpError(502, "Could not reach OpenRouter");
  }
  if (!res.ok) throw await upstreamError(res);
  return toJob(await res.json().catch(() => null));
}

/** Polls the job's polling_url (may be relative). */
export async function pollVideo(job: VideoJob, signal?: AbortSignal): Promise<VideoJob> {
  const url = new URL(job.pollingUrl, "https://openrouter.ai");
  if (url.origin !== "https://openrouter.ai") throw new HttpError(502, "Unexpected polling URL");
  const res = await fetch(url, { headers: { Authorization: headers().Authorization }, signal });
  if (!res.ok) throw await upstreamError(res);
  return toJob(await res.json().catch(() => null), job);
}

/** GET /api/v1/videos/{id}/content?index=0 (authenticated). Returns the response for streaming. */
export async function videoContent(job: VideoJob, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${API}/videos/${encodeURIComponent(job.id)}/content?index=0`, {
    headers: { Authorization: headers().Authorization },
    signal,
  });
  if (!res.ok) throw await upstreamError(res);
  return res;
}
