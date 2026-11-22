import { requireAuth } from "@/lib/auth";
import { docToText } from "@/lib/text";
import { getStore } from "@/lib/store";
import { chat, errorResponse, jsonError, parseJsonObject, readJson } from "@/lib/openrouter";
import { buddySystem, buddyUser, truncate, validateBuddy } from "@/lib/prompts";
import type { BuddyMode, BuddyResult } from "@/lib/types";

export const maxDuration = 60;

function mockResult(mode: BuddyMode, paragraphs: { i: number; text: string }[]): BuddyResult {
  const raw: unknown[] = [];
  for (const p of paragraphs) {
    if (raw.length >= 2) break;
    const m = p.text.match(/[A-Za-z]{3,}/);
    if (!m) continue;
    const quote = m[0];
    const upper = quote.toUpperCase();
    raw.push({
      i: p.i,
      quote,
      replacement: upper !== quote ? upper : quote + "!",
      reason: "Mock suggestion for testing.",
      category: raw.length ? "clarity" : "grammar",
    });
  }
  const res = validateBuddy({ suggestions: raw, notes: [] }, paragraphs);
  res.notes = [mode === "structure" ? "Mock note: consider the order of your first two paragraphs." : "Mock note: the draft reads cleanly."];
  return res;
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const mode: BuddyMode = body.mode === "structure" ? "structure" : "polish";
    const title = typeof body.title === "string" ? body.title : "";
    const paragraphs = (Array.isArray(body.paragraphs) ? body.paragraphs : [])
      .filter((p): p is { i: number; text: string } => !!p && typeof p.i === "number" && typeof p.text === "string")
      .slice(0, 400);
    if (!paragraphs.some((p) => p.text.trim())) return jsonError(400, "There is no text to look at yet");

    if (process.env.AI_MOCK === "1") return Response.json(mockResult(mode, paragraphs));

    // Voice: author's notes plus a few recent published posts. Never fatal.
    let voiceNotes = "";
    const samples: string[] = [];
    try {
      const store = await getStore();
      voiceNotes = (await store.getSettings()).voiceNotes ?? "";
      const recent = (await store.listPublic()).slice(0, 3);
      for (const s of recent) {
        const post = await store.getPublicBySlug(s.slug);
        if (post) samples.push(`${post.title}\n${truncate(docToText(post.content), 1500)}`);
      }
    } catch (e) {
      console.warn("buddy: could not load voice samples", e);
    }

    const out = await chat({
      job: "writing",
      json: true,
      temperature: 0.2,
      signal: request.signal,
      messages: [
        { role: "system", content: buddySystem({ mode, voiceNotes, samples }) },
        { role: "user", content: buddyUser(title, paragraphs) },
      ],
    });
    const parsed = parseJsonObject(out);
    if (!parsed) return jsonError(502, "The editor's reply could not be read, try again");
    return Response.json(validateBuddy(parsed, paragraphs));
  } catch (e) {
    return errorResponse(e);
  }
}
