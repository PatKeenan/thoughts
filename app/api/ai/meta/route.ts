import { requireAuth } from "@/lib/auth";
import { chat, errorResponse, jsonError, parseJsonObject, readJson } from "@/lib/openrouter";
import { metaSystem, metaUser } from "@/lib/prompts";

export const maxDuration = 60;

function cleanSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const title = typeof body.title === "string" ? body.title : "";
    const text = typeof body.text === "string" ? body.text : "";
    if (!title.trim() && !text.trim()) return jsonError(400, "Nothing to suggest from yet");

    if (process.env.AI_MOCK === "1") {
      return Response.json({
        titles: ["A mock title", "Another mock title", "A third mock title"],
        excerpt: "A short mock excerpt describing the post.",
        slug: "a-mock-title",
      });
    }

    const out = await chat({
      job: "fast",
      json: true,
      temperature: 0.7,
      maxTokens: 600,
      signal: request.signal,
      messages: [
        { role: "system", content: metaSystem() },
        { role: "user", content: metaUser(title, text) },
      ],
    });
    const j = parseJsonObject(out) as { titles?: unknown; excerpt?: unknown; slug?: unknown } | null;
    if (!j) return jsonError(502, "The model did not return usable suggestions, try again");
    const titles = (Array.isArray(j.titles) ? j.titles : [])
      .filter((t): t is string => typeof t === "string" && t.trim() !== "")
      .map((t) => t.trim())
      .slice(0, 3);
    const excerpt = typeof j.excerpt === "string" ? j.excerpt.trim() : "";
    const slug = cleanSlug(typeof j.slug === "string" && j.slug ? j.slug : titles[0] ?? title);
    return Response.json({ titles, excerpt, slug });
  } catch (e) {
    return errorResponse(e);
  }
}
