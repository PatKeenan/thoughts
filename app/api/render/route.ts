// POST /api/render { code, output } → NDJSON JobEvent stream (progress…, then done | error).
import { requireAuth } from "@/lib/auth";
import { ndjsonStream } from "@/lib/media";
import { renderMotion } from "@/lib/render";
import type { MotionOutput } from "@/lib/types";
import { checkMotion } from "@/remotion/check";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const OUTPUTS: MotionOutput[] = ["loop", "gif", "video"];
const MAX_CODE_BYTES = 100 * 1024;

const bad = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Body must be JSON: { code, output }");
  }
  const { code, output } = (body ?? {}) as { code?: unknown; output?: unknown };
  if (typeof code !== "string" || !code.trim()) return bad(400, "`code` must be a non-empty string");
  if (new TextEncoder().encode(code).length > MAX_CODE_BYTES) return bad(413, "`code` is larger than 100 KB");
  if (typeof output !== "string" || !OUTPUTS.includes(output as MotionOutput)) {
    return bad(400, "`output` must be one of: loop, gif, video");
  }

  // Compile + config check in Node before any browser/sandbox starts.
  try {
    checkMotion(code);
  } catch (e) {
    return bad(422, e instanceof Error ? e.message : "Invalid motion code");
  }

  return ndjsonStream(async (emit) => {
    const result = await renderMotion(code, output as MotionOutput, emit);
    emit({ type: "done", url: result.url, width: result.width, height: result.height });
  });
}
