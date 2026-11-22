import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type Post, type PostSummary, type Settings } from "@/lib/types";
import type { Store } from "./index";

interface Db {
  posts: Post[];
  settings: Partial<Settings>;
}

const EMPTY_DOC = () => ({ type: "doc", content: [{ type: "paragraph" }] });

function summarize(p: Post): PostSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { content, ...rest } = p;
  return rest;
}

function isLive(p: Post, now: Date): boolean {
  return (
    (p.status === "published" || p.status === "scheduled") &&
    p.publishAt !== null &&
    new Date(p.publishAt).getTime() <= now.getTime()
  );
}

export function createFileStore(): Store {
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || ".data");
  const file = path.join(dir, "db.json");
  // Serialise all operations so read-modify-write cycles don't interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  async function read(): Promise<Db> {
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Db>;
      return { posts: raw.posts ?? [], settings: raw.settings ?? {} };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { posts: [], settings: {} };
      throw e;
    }
  }

  async function write(db: Db): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await fs.rename(tmp, file);
  }

  return {
    listPosts: () =>
      run(async () => {
        const db = await read();
        return db.posts
          .map(summarize)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }),

    getPost: (id) =>
      run(async () => (await read()).posts.find((p) => p.id === id) ?? null),

    createPost: () =>
      run(async () => {
        const db = await read();
        const now = new Date().toISOString();
        const post: Post = {
          id: randomUUID(),
          slug: "",
          title: "",
          excerpt: "",
          content: EMPTY_DOC(),
          status: "draft",
          publishAt: null,
          createdAt: now,
          updatedAt: now,
        };
        db.posts.push(post);
        await write(db);
        return post;
      }),

    updatePost: (id, patch) =>
      run(async () => {
        const db = await read();
        const post = db.posts.find((p) => p.id === id);
        if (!post) return null;
        for (const k of ["title", "slug", "excerpt", "content", "status", "publishAt"] as const) {
          if (patch[k] !== undefined) (post as unknown as Record<string, unknown>)[k] = patch[k];
        }
        post.updatedAt = new Date().toISOString();
        await write(db);
        return post;
      }),

    deletePost: (id) =>
      run(async () => {
        const db = await read();
        const posts = db.posts.filter((p) => p.id !== id);
        if (posts.length !== db.posts.length) await write({ ...db, posts });
      }),

    slugTaken: (slug, exceptId) =>
      run(async () => {
        if (!slug) return false;
        return (await read()).posts.some((p) => p.id !== exceptId && p.slug === slug);
      }),

    listPublic: (now = new Date()) =>
      run(async () =>
        (await read()).posts
          .filter((p) => isLive(p, now))
          .map(summarize)
          .sort((a, b) => (b.publishAt ?? "").localeCompare(a.publishAt ?? "")),
      ),

    getPublicBySlug: (slug, now = new Date()) =>
      run(async () => {
        if (!slug) return null;
        return (await read()).posts.find((p) => p.slug === slug && isLive(p, now)) ?? null;
      }),

    getSettings: () =>
      run(async () => ({ ...DEFAULT_SETTINGS, ...(await read()).settings })),

    updateSettings: (patch) =>
      run(async () => {
        const db = await read();
        db.settings = { ...db.settings, ...patch };
        await write(db);
        return { ...DEFAULT_SETTINGS, ...db.settings };
      }),
  };
}
