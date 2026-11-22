import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/openrouter";
import { getRepo, hasToken, myRepos, searchRepos } from "@/lib/github";
import type { RepoInfo } from "@/lib/types";

export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    const authed = hasToken();
    let repos: RepoInfo[] = [];
    if (!q) {
      repos = await myRepos();
    } else {
      if (q.includes("/") && /^[\w.-]+\/[\w.-]+$/.test(q)) {
        try {
          repos = [await getRepo(q)];
        } catch {
          repos = [];
        }
      }
      if (!repos.length) repos = await searchRepos(q);
    }
    return Response.json({ repos, authed });
  } catch (e) {
    return errorResponse(e);
  }
}
