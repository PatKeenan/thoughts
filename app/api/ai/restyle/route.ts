import { requireAuth } from "@/lib/auth";
import { chat, errorResponse, jsonError, readJson } from "@/lib/openrouter";
import { MOCK_RESTYLE, restyleSystem, truncate, validateRestyle } from "@/lib/prompts";

export const maxDuration = 120;

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await readJson(request);
    if (typeof body.code !== "string" || !body.code.trim()) return jsonError(400, "code is required");
    if (process.env.AI_MOCK === "1") return Response.json({ code: MOCK_RESTYLE });

    const out = await chat({
      job: "motion",
      temperature: 0.1,
      maxTokens: 16_000,
      signal: request.signal,
      messages: [
        { role: "system", content: restyleSystem() },
        { role: "user", content: `COMPOSITION TO CONVERT\n\`\`\`tsx\n${truncate(body.code, 30_000)}\n\`\`\`` },
      ],
    });
    const r = validateRestyle(out);
    if ("error" in r) return jsonError(502, `${r.error}. Try again.`);
    return Response.json({ code: r.code });
  } catch (e) {
    return errorResponse(e);
  }
}
