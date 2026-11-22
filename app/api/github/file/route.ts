import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/openrouter";
import { checkRepo, readFile } from "@/lib/github";

export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const sp = new URL(request.url).searchParams;
    const repo = checkRepo(sp.get("repo"));
    return Response.json(await readFile(repo, sp.get("path") ?? "", sp.get("ref") ?? ""));
  } catch (e) {
    return errorResponse(e);
  }
}
