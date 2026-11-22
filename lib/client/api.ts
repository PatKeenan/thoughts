import type {
  BuddyMode,
  BuddyResult,
  FactCheckResult,
  Look,
  Post,
  PostSummary,
  Settings,
} from "@/lib/types";

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.href = "/login?next=" + encodeURIComponent(location.pathname);
    return new Promise<T>(() => {});
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : "";
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data as T;
}

export type PostPatch = Partial<
  Pick<Post, "title" | "slug" | "excerpt" | "content" | "status" | "publishAt" | "look">
>;

export const api = {
  async listPosts(): Promise<PostSummary[]> {
    return (await request<{ posts: PostSummary[] }>("/api/posts")).posts;
  },
  async createPost(): Promise<Post> {
    return (await request<{ post: Post }>("/api/posts", { method: "POST", body: {} })).post;
  },
  async getPost(id: string): Promise<Post> {
    return (await request<{ post: Post }>(`/api/posts/${encodeURIComponent(id)}`)).post;
  },
  async patchPost(id: string, patch: PostPatch): Promise<Post> {
    return (
      await request<{ post: Post }>(`/api/posts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: patch,
      })
    ).post;
  },
  async deletePost(id: string): Promise<void> {
    await request<unknown>(`/api/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async getSettings(): Promise<Settings> {
    return (await request<{ settings: Settings }>("/api/settings")).settings;
  },
  async patchSettings(patch: Partial<Settings>): Promise<Settings> {
    return (
      await request<{ settings: Settings }>("/api/settings", { method: "PATCH", body: patch })
    ).settings;
  },
  buddy(body: {
    mode: BuddyMode;
    title: string;
    paragraphs: { i: number; text: string }[];
  }): Promise<BuddyResult> {
    return request<BuddyResult>("/api/ai/buddy", { method: "POST", body });
  },
  factcheck(body: { claim: string; context: string; title: string }): Promise<FactCheckResult> {
    return request<FactCheckResult>("/api/ai/factcheck", { method: "POST", body });
  },
  async extractLook(body: {
    source:
      | { kind: "image"; url: string; prompt?: string }
      | { kind: "motion"; code: string }
      | { kind: "text"; description: string };
    post?: { title: string; text: string };
  }): Promise<Look> {
    return (await request<{ look: Look }>("/api/ai/look", { method: "POST", body })).look;
  },
  async restyleMotion(code: string): Promise<string> {
    return (await request<{ code: string }>("/api/ai/restyle", { method: "POST", body: { code } })).code;
  },
  meta(body: { title: string; text: string }): Promise<{ titles: string[]; excerpt: string; slug: string }> {
    return request("/api/ai/meta", { method: "POST", body });
  },
  async logout(): Promise<void> {
    await request<unknown>("/api/auth/logout", { method: "POST", body: {} });
  },
};
