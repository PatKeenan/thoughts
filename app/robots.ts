import type { MetadataRoute } from "next";
import { getStore } from "@/lib/store";
import { siteOrigin } from "@/lib/site";

// Reads Settings → Site URL at request time (builds have no database).
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = siteOrigin(await (await getStore()).getSettings());
  return {
    // The editor and API are private; everything else is the public blog. The sign-in path is
    // deliberately not listed here: robots.txt is public, and that page is noindex anyway.
    rules: { userAgent: "*", allow: "/", disallow: ["/write", "/api/"] },
    sitemap: origin ? `${origin}/sitemap.xml` : undefined,
    host: origin ?? undefined,
  };
}
