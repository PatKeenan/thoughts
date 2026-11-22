import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/openrouter";
import { checkRepo, listTree } from "@/lib/github";

export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const sp = new URL(request.url).searchParams;
    const repo = checkRepo(sp.get("repo"));
    return Response.json(await listTree(repo, sp.get("ref") ?? "", sp.get("path") ?? ""));
  } catch (e) {
    return errorResponse(e);
  }
}
