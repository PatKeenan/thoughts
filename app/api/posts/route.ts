import { requireAuth } from "@/lib/auth";
import { getStore } from "@/lib/store";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const store = await getStore();
  return Response.json({ posts: await store.listPosts() });
}

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;
  const store = await getStore();
  return Response.json({ post: await store.createPost() });
}
