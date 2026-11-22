import { requireAuth } from "@/lib/auth";
import { safeRefUrl, validateLook } from "@/lib/look";
import { referenceUrl } from "@/lib/media";
import { HttpError, chat, errorResponse, jsonError, readJson, type ORContentPart } from "@/lib/openrouter";
import { MOCK_LOOK_FIELDS, lookFromModel, lookSystem, lookUserText } from "@/lib/prompts";

export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const s = body.source as Record<string, unknown> | undefined;
    if (!s || typeof s !== "object") return jsonError(400, "source is required");
    const p = body.post as { title?: unknown; text?: unknown } | undefined;
    const post = p ? { title: String(p.title ?? ""), text: String(p.text ?? "") } : undefined;

    let source: { kind: "image"; url: string; prompt?: string } | { kind: "motion"; code: string } | { kind: "text"; description: string };
    if (s.kind === "image") {
      const url = safeRefUrl(s.url);
      if (!url) return jsonError(400, "source.url must be an http(s) or /media/ URL");
      source = { kind: "image", url, prompt: typeof s.prompt === "string" ? s.prompt : undefined };
    } else if (s.kind === "motion") {
      if (typeof s.code !== "string" || !s.code.trim()) return jsonError(400, "source.code is required");
      source = { kind: "motion", code: s.code };
    } else if (s.kind === "text") {
      if (typeof s.description !== "string" || !s.description.trim()) return jsonError(400, "source.description is required");
      source = { kind: "text", description: s.description };
    } else {
      return jsonError(400, 'source.kind must be "image", "motion" or "text"');
    }
    const refUrl = source.kind === "image" ? source.url : undefined;

    if (process.env.AI_MOCK === "1") {
      const look = validateLook({ ...MOCK_LOOK_FIELDS, referenceUrl: refUrl }, { id: crypto.randomUUID(), version: 1 });
      if (!look) return jsonError(502, "Mock look failed validation");
      return Response.json({ look });
    }

    let content: string | ORContentPart[] = lookUserText(source, post);
    if (source.kind === "image") {
      const ref = await referenceUrl(source.url);
      if (!ref) throw new HttpError(400, "That image can't be read for style extraction (SVG, missing or too large)");
      // Text first, then the image (OpenRouter's recommended order).
      content = [
        { type: "text", text: content },
        { type: "image_url", image_url: { url: ref } },
      ];
    }
    const out = await chat({
      job: "look",
      json: true,
      temperature: 0.3,
      maxTokens: 1200,
      signal: request.signal,
      messages: [
        { role: "system", content: lookSystem() },
        { role: "user", content },
      ],
    });
    const look = lookFromModel(out, refUrl);
    if (!look) return jsonError(502, "The model's reply could not be read as a look, try again");
    return Response.json({ look });
  } catch (e) {
    return errorResponse(e);
  }
}
