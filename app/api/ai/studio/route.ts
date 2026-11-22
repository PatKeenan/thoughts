import { requireAuth } from "@/lib/auth";
import { validateLook } from "@/lib/look";
import { chatStream, errorResponse, jsonError, readJson, type ORMessage } from "@/lib/openrouter";
import { MOCK_MOTION, motionContext, studioContext, truncate, type StudioFile } from "@/lib/prompts";
import type { ChatMessage, CodeData } from "@/lib/types";

export const maxDuration = 60;

const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mockStream(lastUser: string, current: CodeData | undefined, signal: AbortSignal, motion = false) {
  const lang = current?.language || "ts";
  const file = current?.filename || "example.ts";
  const echo = lastUser.replace(/\s+/g, " ").slice(0, 120);
  const text = motion
    ? `Done: ${echo}\n\n\`\`\`tsx\n${MOCK_MOTION}\`\`\`\n`
    : `Done: ${echo}\n\n` +
      `\`\`\`${lang} title="${file}"\n` +
      `export function greet(name: string) {\n  return \`Hello, \${name}\`;\n}\n\n` +
      `console.log(greet("world"));\n` +
      `\`\`\`\n`;
  const chunks = text.match(/[\s\S]{1,12}/g) ?? [];
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) {
        if (signal.aborted) break;
        controller.enqueue(enc.encode(c));
        await sleep(40);
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const motion = body.kind === "motion";
    if (body.kind !== "code" && !motion) return jsonError(400, 'kind must be "code" or "motion"');

    const raw = Array.isArray(body.messages) ? body.messages : [];
    const messages: ChatMessage[] = raw
      .filter(
        (m): m is ChatMessage =>
          !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "",
      )
      .slice(-20)
      .map((m) => ({ role: m.role, content: truncate(m.content, 8000) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return jsonError(400, "messages must end with a user message");
    }

    const cur = body.current as Partial<CodeData> | undefined;
    const current: CodeData | undefined =
      cur && typeof cur.code === "string"
        ? {
            language: typeof cur.language === "string" ? cur.language : "text",
            code: cur.code,
            filename: typeof cur.filename === "string" ? cur.filename : undefined,
          }
        : undefined;

    const ctxFiles = (body.context as { files?: unknown } | undefined)?.files;
    const files: StudioFile[] = Array.isArray(ctxFiles)
      ? ctxFiles
          .filter((f) => f && typeof f.path === "string" && typeof f.content === "string")
          .slice(0, 20)
          .map((f) => ({
            repo: String(f.repo ?? ""),
            path: f.path,
            ref: String(f.ref ?? ""),
            content: f.content,
            startLine: typeof f.startLine === "number" ? f.startLine : undefined,
            endLine: typeof f.endLine === "number" ? f.endLine : undefined,
          }))
      : [];

    const p = body.post as { title?: unknown; text?: unknown } | undefined;
    const post = p ? { title: String(p.title ?? ""), text: String(p.text ?? "") } : undefined;

    // Only motion uses the look (pace/mood/feel); colours come from the theme prop. Invalid looks are ignored.
    const look = motion && body.look ? validateLook(body.look) : null;

    const headers = {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    };

    if (process.env.AI_MOCK === "1") {
      return new Response(mockStream(messages[messages.length - 1].content, current, request.signal, motion), { headers });
    }

    const system: ORMessage = {
      role: "system",
      content: motion
        ? motionContext({ post, look, current: current && current.code.trim() ? { code: current.code } : undefined })
        : studioContext({ post, files, current }),
    };
    const stream = await chatStream({
      job: motion ? "motion" : "code",
      messages: [system, ...messages],
      signal: request.signal,
    });
    return new Response(stream, { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
