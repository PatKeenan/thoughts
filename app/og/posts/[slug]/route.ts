import { getStore } from "@/lib/store";
import { ogCard } from "@/lib/og";
import { formatDate } from "@/app/(site)/format-date";

/** GET /og/posts/<slug> — a post's link-preview card. Only live posts; anything else is a 404. */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await getStore();
  const [post, settings] = await Promise.all([store.getPublicBySlug(slug), store.getSettings()]);
  if (!post) return new Response("Not found", { status: 404 });
  return ogCard({
    title: post.title,
    kicker: formatDate(post.publishAt ?? post.createdAt),
    footer: settings.author ? `${settings.author} · ${settings.siteTitle}` : settings.siteTitle,
  });
}
