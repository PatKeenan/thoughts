// Media storage: Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else local files under $DATA_DIR/media.
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "@/lib/openrouter";
import type { JobEvent } from "@/lib/types";

export const MEDIA_NAME_RE = /^[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif|svg|mp4|webm)$/;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function mediaDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || ".data", "media");
}

function extFor(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[base];
  if (!ext) throw new HttpError(400, `Unsupported media type: ${base || "unknown"}`);
  return ext;
}

function blobEnabled(): boolean {
  if (process.env.BLOB_READ_WRITE_TOKEN) return true;
  if (process.env.VERCEL) {
    throw new HttpError(500, "BLOB_READ_WRITE_TOKEN is not set: add a Vercel Blob store to this project to store images and video");
  }
  return false;
}

export async function putMedia(
  bytes: Uint8Array | ArrayBuffer | Buffer,
  contentType: string,
): Promise<{ url: string }> {
  const ext = extFor(contentType);
  const buf = Buffer.isBuffer(bytes) ? bytes : bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = `${randomUUID()}.${ext}`;
  if (blobEnabled()) {
    const { put } = await import("@vercel/blob");
    const r = await put(`media/${base}`, buf, { access: "public", contentType: TYPE_BY_EXT[ext], addRandomSuffix: false });
    return { url: r.url };
  }
  const dir = mediaDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, base), buf);
  return { url: `/media/${base}` };
}

function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let n = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        n += chunk.length;
        if (n > max) throw new HttpError(413, `Download is larger than ${Math.round(max / 1048576)} MB`);
        controller.enqueue(chunk);
      },
    }),
  );
}

/** Stores a (possibly large) byte stream without buffering it all in memory. */
export async function putMediaStream(
  body: ReadableStream<Uint8Array>,
  contentType: string,
  maxBytes: number,
): Promise<{ url: string }> {
  const ext = extFor(contentType);
  const base = `${randomUUID()}.${ext}`;
  const source = capped(body, maxBytes);
  if (blobEnabled()) {
    const { put } = await import("@vercel/blob");
    const r = await put(`media/${base}`, source, { access: "public", contentType: TYPE_BY_EXT[ext], addRandomSuffix: false });
    return { url: r.url };
  }
  const dir = mediaDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(/*turbopackIgnore: true*/ dir, base);
  try {
    await pipeline(Readable.fromWeb(source as import("node:stream/web").ReadableStream<Uint8Array>), createWriteStream(file));
  } catch (e) {
    const { rm } = await import("node:fs/promises");
    await rm(file, { force: true });
    throw e;
  }
  return { url: `/media/${base}` };
}

/** Parses a single-range `Range: bytes=…` header. null = no/ignored range, "invalid" = 416. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header || !header.startsWith("bytes=") || header.includes(",")) return null; // multi-range: serve whole file
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null; // malformed: ignore
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

/** Base64 string or data URL to bytes. */
export function decodeBase64(s: string): Buffer {
  const i = s.startsWith("data:") ? s.indexOf(",") : -1;
  return Buffer.from(i === -1 ? s : s.slice(i + 1), "base64");
}

/** Reads a response body up to `max` bytes. */
export async function readCapped(res: Response, max: number): Promise<Buffer> {
  const len = Number(res.headers.get("content-length") || 0);
  if (len > max) throw new HttpError(413, "Downloaded file is too large");
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let n = 0;
  const reader = res.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      reader.cancel().catch(() => {});
      throw new HttpError(413, "Downloaded file is too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Streams NDJSON JobEvents. `run` calls `emit`; any throw becomes a final error event.
 * Emits nothing after the stream is closed (client gone).
 */
export function ndjsonStream(run: (emit: (e: JobEvent) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: JobEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await run(emit);
      } catch (e) {
        console.error(e);
        emit({ type: "error", message: e instanceof Error ? e.message : "Unexpected error" });
      }
      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** A URL a model API can fetch, or a data URL for local files. null when it cannot be used (SVG, missing, other). */
export async function referenceUrl(url: string): Promise<string | null> {
  if (/^https:\/\//.test(url)) return /\.svg(\?|$)/i.test(url) ? null : url;
  const m = /^\/media\/([^/?#]+)$/.exec(url);
  if (!m || !MEDIA_NAME_RE.test(m[1]) || m[1].endsWith(".svg")) return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(path.join(/*turbopackIgnore: true*/ mediaDir(), m[1]));
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return `data:${TYPE_BY_EXT[m[1].split(".").pop()!]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
