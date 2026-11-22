import { requireAuth } from "@/lib/auth";
import { stampOf, validateLook } from "@/lib/look";
import { MAX_IMAGE_BYTES, decodeBase64, putMedia, readCapped, referenceUrl } from "@/lib/media";
import {
  HttpError,
  chat,
  errorResponse,
  generateImage,
  jsonError,
  parseJsonObject,
  readJson,
  type ORMessage,
} from "@/lib/openrouter";
import { imagePromptSystem, imagePromptUser, truncate } from "@/lib/prompts";
import type { Aspect, ChatMessage, ImageData, Look } from "@/lib/types";

export const maxDuration = 120;

const ASPECTS: Aspect[] = ["16:9", "1:1", "4:5", "3:2"];

function mockSvg(prompt: string, aspect: Aspect, look: Look | null): string {
  // With a look, draw with its palette so the look is visible in a browser test.
  const bg = look?.palette.bg ?? "#f5efe4";
  const ink = look?.palette.ink ?? "#1b1712";
  const accent = look?.palette.accent ?? "#d63f1c";
  const muted = look?.palette.muted ?? "#d6ccb9";
  const [aw, ah] = aspect.split(":").map(Number);
  const w = 1200;
  const h = Math.round((w * ah) / aw);
  const label = prompt.trim().split(/\s+/).slice(0, 6).join(" ").replace(/[&<>"]/g, "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>` +
    `<rect x="40" y="40" width="${w - 80}" height="${h - 80}" fill="none" stroke="${muted}" stroke-width="2"/>` +
    `<circle cx="${w / 2}" cy="${h / 2 - 20}" r="${Math.round(Math.min(w, h) / 7)}" fill="${accent}"/>` +
    `<text x="${w / 2}" y="${h - 90}" text-anchor="middle" font-family="Georgia, serif" font-size="44" fill="${ink}">${label}</text>` +
    `</svg>`
  );
}

async function fetchImageUrl(url: string, signal: AbortSignal): Promise<{ bytes: Buffer; type: string }> {
  if (!/^https?:\/\//.test(url)) throw new HttpError(502, "The image model returned an unusable image");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new HttpError(502, "Could not download the generated image");
  const type = (res.headers.get("content-type") || "image/png").split(";")[0].trim();
  return { bytes: await readCapped(res, MAX_IMAGE_BYTES), type };
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const aspect = body.aspect as Aspect;
    if (!ASPECTS.includes(aspect)) return jsonError(400, "aspect must be one of 16:9, 1:1, 4:5, 3:2");

    const messages: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
      .filter(
        (m): m is ChatMessage =>
          !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "",
      )
      .slice(-20)
      .map((m) => ({ role: m.role, content: truncate(m.content, 4000) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return jsonError(400, "messages must end with a user message");
    }

    const cur = body.current as Partial<ImageData> | undefined;
    const current = cur && typeof cur.prompt === "string" && cur.prompt.trim() ? { prompt: cur.prompt, url: typeof cur.url === "string" ? cur.url : "" } : undefined;
    // An invalid look is ignored (treated as none).
    const look = body.look ? validateLook(body.look) : null;
    const p = body.post as { title?: unknown; text?: unknown } | undefined;
    const post = p ? { title: String(p.title ?? ""), text: String(p.text ?? "") } : undefined;

    if (process.env.AI_MOCK === "1") {
      const last = messages[messages.length - 1].content.replace(/\s+/g, " ").slice(0, 200);
      const { url } = await putMedia(Buffer.from(mockSvg(last, aspect, look)), "image/svg+xml");
      const image: ImageData = { url, alt: `Mock illustration: ${last.slice(0, 80)}`, prompt: last, aspect, look: stampOf(look) };
      return Response.json({ image, note: `Mock image for: ${last.slice(0, 80)}` });
    }

    // References: the image being refined (if any) and the look's style reference (if any), never the same URL twice.
    const curRef = current?.url ? await referenceUrl(current.url) : null;
    let lookRef = look?.referenceUrl ? await referenceUrl(look.referenceUrl) : null;
    if (lookRef && (lookRef === curRef || look?.referenceUrl === current?.url)) lookRef = null;

    // Step 1: conversation -> one complete prompt + alt + note.
    const system: ORMessage = { role: "system", content: imagePromptSystem() };
    const user = { role: "user" as const, content: imagePromptUser({ aspect, current, post, look, refs: { current: !!curRef, look: !!lookRef } }) };
    const out = await chat({
      job: "fast",
      json: true,
      temperature: 0.4,
      signal: request.signal,
      messages: [system, ...messages.slice(0, -1), { role: "user", content: `${user.content}\n\nRequest:\n${messages[messages.length - 1].content}` }],
    });
    const parsed = parseJsonObject(out) as { prompt?: unknown; alt?: unknown; note?: unknown } | null;
    const prompt = typeof parsed?.prompt === "string" ? parsed.prompt.trim() : "";
    if (!prompt) return jsonError(502, "The prompt writer's reply could not be read, try again");
    const alt = typeof parsed?.alt === "string" ? parsed.alt.trim() : "";
    const note = typeof parsed?.note === "string" ? parsed.note.trim() : "Made a new image.";

    // Step 2: generate. When refining, pass the current image as a reference (input_references).
    const references = [curRef, lookRef].filter((r): r is string => !!r);
    const gen = await generateImage({
      prompt: lookRef
        ? `${prompt}\n\n${curRef ? "Image 1 is the current image being refined; image 2" : "The reference image"} is the style reference: match its style (palette, medium, line, texture, lighting), not its content.`
        : prompt,
      aspect,
      references: references.length ? references : undefined,
      signal: request.signal,
    });
    let bytes: Buffer;
    let type = gen.mediaType;
    if (/^https?:\/\//.test(gen.b64)) {
      const dl = await fetchImageUrl(gen.b64, request.signal);
      bytes = dl.bytes;
      type = dl.type;
    } else {
      bytes = decodeBase64(gen.b64);
      const m = /^data:([^;,]+)/.exec(gen.b64);
      if (m) type = m[1];
    }
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new HttpError(502, "The image model returned an unusable image");
    const { url } = await putMedia(bytes, type);
    const image: ImageData = { url, alt: alt || prompt.slice(0, 140), prompt, aspect, look: stampOf(look) };
    return Response.json({ image, note });
  } catch (e) {
    return errorResponse(e);
  }
}
