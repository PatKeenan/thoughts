import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { slugify, uniqueSlug } from "@/lib/slug";
import { validateLook } from "@/lib/look";
import type { DocNode, Look, Post, PostStatus } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const bad = (error: string) => Response.json({ error }, { status: 400 });
const STATUSES: PostStatus[] = ["draft", "scheduled", "published"];

function revalidatePublic() {
  revalidatePath("/");
  revalidatePath("/posts/[slug]", "page");
  revalidatePath("/feed.xml");
}

const isLive = (p: Post) => p.status !== "draft";

export async function GET(_req: Request, { params }: Ctx) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const post = await (await getStore()).getPost(id);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ post });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const store = await getStore();
  const existing = await store.getPost(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("Body must be an object");
  const body = raw as Record<string, unknown>;

  for (const k of ["title", "slug", "excerpt"] as const) {
    if (body[k] !== undefined && typeof body[k] !== "string") return bad(`${k} must be a string`);
  }
  if (body.content !== undefined) {
    const c = body.content as DocNode | null;
    if (!c || typeof c !== "object" || c.type !== "doc" || (c.content !== undefined && !Array.isArray(c.content))) {
      return bad("content must be a doc node");
    }
  }
  let look: Look | null | undefined;
  if (body.look !== undefined) {
    if (body.look === null) look = null;
    else {
      look = validateLook(body.look);
      if (!look) return bad("look is not a valid look");
    }
  }
  let status: PostStatus | undefined;
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !STATUSES.includes(body.status as PostStatus)) {
      return bad("status must be draft, scheduled or published");
    }
    status = body.status as PostStatus;
  }
  let publishAtIn: string | null | undefined;
  if (body.publishAt !== undefined) {
    if (body.publishAt === null) publishAtIn = null;
    else if (typeof body.publishAt === "string" && !Number.isNaN(Date.parse(body.publishAt))) {
      publishAtIn = new Date(body.publishAt).toISOString();
    } else return bad("publishAt must be an ISO date string or null");
  }

  const title = body.title !== undefined ? (body.title as string) : existing.title;
  const patch: Parameters<typeof store.updatePost>[1] = {};
  if (body.title !== undefined) patch.title = body.title as string;
  if (body.excerpt !== undefined) patch.excerpt = body.excerpt as string;
  if (body.content !== undefined) patch.content = body.content as DocNode;
  if (look !== undefined) patch.look = look;
  let slug = body.slug !== undefined ? slugify(body.slug as string) : existing.slug;

  const nextStatus = status ?? existing.status;
  if (status === "published") {
    if (!title.trim()) return bad("A title is required to publish");
    patch.status = "published";
    patch.publishAt = existing.status === "published" && existing.publishAt ? existing.publishAt : new Date().toISOString();
  } else if (status === "scheduled") {
    if (!title.trim()) return bad("A title is required to schedule");
    const when = publishAtIn ?? existing.publishAt;
    if (!when || new Date(when).getTime() <= Date.now()) return bad("publishAt must be in the future to schedule");
    patch.status = "scheduled";
    patch.publishAt = when;
  } else if (status === "draft") {
    patch.status = "draft";
    patch.publishAt = null;
  } else if (publishAtIn !== undefined) {
    // publishAt alone: only meaningful for scheduled posts.
    if (existing.status === "scheduled") {
      if (publishAtIn === null || new Date(publishAtIn).getTime() <= Date.now()) {
        return bad("publishAt must be in the future for a scheduled post");
      }
      patch.publishAt = publishAtIn;
    } else if (existing.status === "draft") {
      if (publishAtIn !== null) return bad("Set status to scheduled to use publishAt");
    }
  }

  if (nextStatus !== "draft" && !slug) slug = slugify(title);
  if (slug || body.slug !== undefined) {
    if (slug) slug = await uniqueSlug(store, slug, id);
    if (slug !== existing.slug) patch.slug = slug;
  }

  const post = await store.updatePost(id, patch);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  // A look change on a live post is covered here too: its code theme changes how the post renders.
  if (isLive(existing) || isLive(post)) revalidatePublic();
  return Response.json({ post });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const store = await getStore();
  const existing = await store.getPost(id);
  await store.deletePost(id);
  if (existing && isLive(existing)) revalidatePublic();
  return Response.json({ ok: true });
}
