import { getStore } from "@/lib/store";

export const revalidate = 60;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // strip characters illegal in XML 1.0
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

export async function GET(request: Request) {
  const store = await getStore();
  const [settings, all] = await Promise.all([store.getSettings(), store.listPublic()]);
  const origin = (settings.siteUrl || new URL(request.url).origin).replace(/\/+$/, "");
  const posts = all.slice(0, 30);
  const items = posts
    .map((p) => {
      const url = `${origin}/posts/${encodeURIComponent(p.slug)}`;
      const date = new Date(p.publishAt ?? p.createdAt).toUTCString();
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="true">${esc(url)}</guid>
      <pubDate>${date}</pubDate>
      <description>${esc(p.excerpt)}</description>
    </item>`;
    })
    .join("\n");
  const last = posts[0] ? `\n    <lastBuildDate>${new Date(posts[0].publishAt ?? posts[0].createdAt).toUTCString()}</lastBuildDate>` : "";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(settings.siteTitle)}</title>
    <link>${esc(origin)}/</link>
    <description>${esc(settings.tagline || settings.siteTitle)}</description>
    <language>en</language>${last}
    <atom:link href="${esc(origin)}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
