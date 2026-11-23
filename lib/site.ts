import type { DocNode, Post, Settings } from "@/lib/types";
import { docToParagraphs } from "@/lib/text";

/**
 * The site's canonical origin (no trailing slash), for canonical links, the sitemap, RSS and
 * link previews. Settings → Site URL wins; on Vercel the production domain is the fallback, so a
 * fresh deploy never advertises localhost or a preview URL. Null when neither is known.
 */
export function siteOrigin(settings: Pick<Settings, "siteUrl">): string | null {
  const candidates = [
    settings.siteUrl,
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const u = new URL(c);
      if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Meta description: the excerpt, or else the post's opening prose (no code) cut at a word near 160 chars. */
export function postDescription(post: Pick<Post, "excerpt"> & { content: DocNode }): string {
  if (post.excerpt.trim()) return post.excerpt.trim();
  const text = docToParagraphs(post.content).join(" ").replace(/\s+/g, " ").trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 100)).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** Link-preview card URLs (relative; metadataBase / siteOrigin make them absolute). */
export const OG_IMAGE = { width: 1200, height: 630, type: "image/png" } as const;
export const siteOgImage = () => ({ url: "/og", ...OG_IMAGE, alt: "The site's name beside a pink rule" });
export const postOgImage = (slug: string, title: string) => ({
  url: `/og/posts/${encodeURIComponent(slug)}`,
  ...OG_IMAGE,
  alt: `${title}, set beside a pink rule`,
});

/** RSS discovery link; repeated per page because a page's `alternates` replaces the layout's. */
export const RSS_ALTERNATE = { "application/rss+xml": "/feed.xml" };
