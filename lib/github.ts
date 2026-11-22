// GitHub REST v3 helpers. GITHUB_TOKEN is optional (raises rate limits, unlocks private repos).
import { HttpError } from "@/lib/openrouter";
import { langFromPath } from "@/lib/lang";
import type { FileResult, RepoInfo, TreeEntry } from "@/lib/types";

const API = "https://api.github.com";
export const MAX_FILE_BYTES = 300 * 1024;

export function hasToken(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

async function gh(path: string, accept = "application/vnd.github+json"): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "blog-editor",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { headers, cache: "no-store" });
  } catch {
    throw new HttpError(502, "Could not reach GitHub");
  }
  if (res.ok) return res;
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset") || 0);
    const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : 0;
    throw new HttpError(
      429,
      `GitHub rate limit reached${mins ? `, resets in about ${mins} min` : ""}.${hasToken() ? "" : " Set GITHUB_TOKEN to raise the limit."}`,
    );
  }
  if (res.status === 404) {
    throw new HttpError(404, hasToken() ? "Not found on GitHub" : "Not found on GitHub (private repos need GITHUB_TOKEN)");
  }
  if (res.status === 401) throw new HttpError(502, "GITHUB_TOKEN was rejected by GitHub");
  if (res.status === 403) throw new HttpError(403, "GitHub refused access to that resource");
  throw new HttpError(502, `GitHub error ${res.status}`);
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function checkRepo(repo: string | null): string {
  if (!repo || !REPO_RE.test(repo)) throw new HttpError(400, "repo must look like owner/name");
  return repo;
}

export function checkPath(path: string | null): string {
  const p = (path ?? "").replace(/^\/+|\/+$/g, "");
  if (p.split("/").some((s) => s === ".." || s === ".")) throw new HttpError(400, "Invalid path");
  return p;
}

const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

interface RawRepo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  html_url: string;
  default_branch: string;
  private: boolean;
}

function toRepoInfo(r: RawRepo): RepoInfo {
  return {
    fullName: r.full_name,
    description: r.description ?? "",
    stars: r.stargazers_count ?? 0,
    language: r.language ?? null,
    url: r.html_url,
    defaultBranch: r.default_branch,
    private: !!r.private,
  };
}

export async function getRepo(repo: string): Promise<RepoInfo> {
  const res = await gh(`/repos/${checkRepo(repo)}`);
  return toRepoInfo(await res.json());
}

export async function myRepos(): Promise<RepoInfo[]> {
  if (!hasToken()) return [];
  const res = await gh("/user/repos?sort=pushed&direction=desc&per_page=30&affiliation=owner,collaborator,organization_member");
  return ((await res.json()) as RawRepo[]).map(toRepoInfo);
}

export async function searchRepos(q: string): Promise<RepoInfo[]> {
  const res = await gh(`/search/repositories?q=${encodeURIComponent(q)}&per_page=15`);
  const j = await res.json();
  return ((j.items ?? []) as RawRepo[]).map(toRepoInfo);
}

/** Resolves the repo's default branch when no ref was given. */
export async function resolveRef(repo: string, ref: string): Promise<string> {
  return ref || (await getRepo(repo)).defaultBranch;
}

export async function listTree(repo: string, ref: string, path: string): Promise<{ entries: TreeEntry[]; ref: string }> {
  checkRepo(repo);
  const p = checkPath(path);
  const r = await resolveRef(repo, ref);
  const res = await gh(`/repos/${repo}/contents/${encPath(p)}?ref=${encodeURIComponent(r)}`);
  const j = await res.json();
  if (!Array.isArray(j)) throw new HttpError(400, "That path is a file, not a directory");
  const entries: TreeEntry[] = (j as { name: string; path: string; type: string; size: number }[])
    .filter((e) => e.type === "dir" || e.type === "file" || e.type === "symlink")
    .map((e) => ({ name: e.name, path: e.path, type: e.type === "dir" ? "dir" : "file", size: e.size ?? 0 }));
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return { entries, ref: r };
}

export async function readFile(repo: string, path: string, ref: string): Promise<FileResult> {
  checkRepo(repo);
  const p = checkPath(path);
  if (!p) throw new HttpError(400, "path is required");
  const r = await resolveRef(repo, ref);
  // Pin to a commit sha so the link is a permalink.
  const shaRes = await gh(`/repos/${repo}/commits/${encPath(r)}`, "application/vnd.github.sha");
  const sha = (await shaRes.text()).trim();
  const res = await gh(`/repos/${repo}/contents/${encPath(p)}?ref=${sha}`);
  const j = await res.json();
  if (Array.isArray(j)) throw new HttpError(400, "That path is a directory, not a file");
  if (j.type !== "file") throw new HttpError(400, "That path is not a regular file");
  if ((j.size ?? 0) > MAX_FILE_BYTES) throw new HttpError(413, "File is larger than 300 KB");
  if (j.encoding !== "base64" || typeof j.content !== "string") throw new HttpError(413, "File is too large to read");
  const bytes = Buffer.from(j.content, "base64");
  if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, "File is larger than 300 KB");
  let content: string;
  try {
    if (bytes.includes(0)) throw new Error("binary");
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(413, "Binary files can't be used");
  }
  return {
    repo,
    path: p,
    ref: sha,
    content,
    language: langFromPath(p),
    htmlUrl: `https://github.com/${repo}/blob/${sha}/${encPath(p)}`,
  };
}
