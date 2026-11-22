import type {
  BuddyMode,
  BuddyResult,
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
  Pick<Post, "title" | "slug" | "excerpt" | "content" | "status" | "publishAt">
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
  meta(body: { title: string; text: string }): Promise<{ titles: string[]; excerpt: string; slug: string }> {
    return request("/api/ai/meta", { method: "POST", body });
  },
  async logout(): Promise<void> {
    await request<unknown>("/api/auth/logout", { method: "POST", body: {} });
  },
};
