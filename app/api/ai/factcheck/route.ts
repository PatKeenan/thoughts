import { requireAuth } from "@/lib/auth";
import { chatWithCitations, errorResponse, jsonError, parseJsonObject, readJson } from "@/lib/openrouter";
import { factcheckSystem, factcheckUser, validateFactCheck } from "@/lib/prompts";
import type { FactCheckResult } from "@/lib/types";

export const maxDuration = 90;

function mockResult(claim: string): FactCheckResult {
  const words = claim.trim().split(/\s+/);
  const found = words.findIndex((w) => /^[A-Za-z]{4,}$/.test(w));
  const i = found === -1 ? words.length - 1 : found;
  words[i] = words[i].toLowerCase() === "roughly" ? "about" : "roughly";
  const short = claim.replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    verdict: "partly",
    summary: `Mock check of "${short}". The claim is roughly right but imprecise.`,
    correction: words.join(" "),
    sources: [
      { title: "Example source one", url: "https://example.com/one" },
      { title: "Example source two", url: "https://example.com/two" },
    ],
  };
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const claim = typeof body.claim === "string" ? body.claim.trim() : "";
    const context = typeof body.context === "string" ? body.context : "";
    const title = typeof body.title === "string" ? body.title : "";
    if (!claim) return jsonError(400, "There is no claim to check");
    if (claim.length > 1500) return jsonError(400, "Select a shorter passage (a sentence or two)");

    if (process.env.AI_MOCK === "1") return Response.json(mockResult(claim));

    const { content, citations } = await chatWithCitations({
      job: "factcheck", // model carries ":online" (web search)
      json: true,
      temperature: 0.1,
      signal: request.signal,
      messages: [
        { role: "system", content: factcheckSystem() },
        { role: "user", content: factcheckUser(claim, context, title) },
      ],
    });
    const parsed = parseJsonObject(content);
    if (!parsed && !citations.length) return jsonError(502, "The fact-check reply could not be read, try again");
    return Response.json(validateFactCheck(parsed, citations, claim));
  } catch (e) {
    return errorResponse(e);
  }
}
