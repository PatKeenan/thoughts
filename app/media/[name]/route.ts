import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { MEDIA_NAME_RE, TYPE_BY_EXT, mediaDir, parseRange } from "@/lib/media";

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!MEDIA_NAME_RE.test(name)) return new Response("Not found", { status: 404 });
  const file = path.join(mediaDir(), name);
  let size: number;
  try {
    const s = await stat(file);
    if (!s.isFile()) return new Response("Not found", { status: 404 });
    size = s.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const ext = name.slice(name.lastIndexOf(".") + 1);
  const headers: Record<string, string> = {
    "Content-Type": TYPE_BY_EXT[ext],
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  if (ext === "svg") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";

  const range = parseRange(request.headers.get("range"), size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  const [start, end, status] = range ? [range.start, range.end, 206] : [0, size - 1, 200];
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  headers["Content-Length"] = String(size === 0 ? 0 : end - start + 1);
  if (size === 0) return new Response(null, { status: 200, headers });
  const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}
