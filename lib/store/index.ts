import type { Post, PostSummary, Settings } from "@/lib/types";

/** Persistence contract. Implementations: ./postgres.ts (DATABASE_URL set) and ./file.ts (local dev). */
export interface Store {
  /** All posts, newest updated first. Editor only. */
  listPosts(): Promise<PostSummary[]>;
  getPost(id: string): Promise<Post | null>;
  /** Creates an empty draft. */
  createPost(): Promise<Post>;
  updatePost(
    id: string,
    patch: Partial<Pick<Post, "title" | "slug" | "excerpt" | "content" | "status" | "publishAt">>,
  ): Promise<Post | null>;
  deletePost(id: string): Promise<void>;
  /** True if another post (id !== exceptId) already uses this slug. */
  slugTaken(slug: string, exceptId: string): Promise<boolean>;

  /** Live posts: status is published or scheduled AND publishAt <= now. Newest publishAt first. */
  listPublic(now?: Date): Promise<PostSummary[]>;
  getPublicBySlug(slug: string, now?: Date): Promise<Post | null>;

  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
}

let cached: Store | null = null;

export async function getStore(): Promise<Store> {
  if (cached) return cached;
  if (process.env.DATABASE_URL) {
    const { createPostgresStore } = await import("./postgres");
    cached = createPostgresStore(process.env.DATABASE_URL);
  } else {
    if (process.env.VERCEL) {
      throw new Error("DATABASE_URL is not set. Add a Postgres database (Neon) in Vercel → Storage.");
    }
    const { createFileStore } = await import("./file");
    cached = createFileStore();
  }
  return cached;
}
