import type { MetadataRoute } from "next";
import { getStore } from "@/lib/store";
import { siteOrigin } from "@/lib/site";

// Live posts change with the clock (scheduled posts), so build it per request.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const store = await getStore();
  const [settings, posts] = await Promise.all([store.getSettings(), store.listPublic()]);
  // A sitemap needs absolute URLs; without a known origin, an empty one beats wrong ones.
  const origin = siteOrigin(settings);
  if (!origin) return [];
  const newest = posts[0]?.updatedAt;
  return [
    { url: `${origin}/`, lastModified: newest, changeFrequency: "weekly", priority: 1 },
    ...posts.map((p) => ({
      url: `${origin}/posts/${encodeURIComponent(p.slug)}`,
      lastModified: p.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
