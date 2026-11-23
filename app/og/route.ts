import { getStore } from "@/lib/store";
import { ogCard } from "@/lib/og";

/** GET /og — the site's link-preview card (home page and fallback). */
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await (await getStore()).getSettings();
  return ogCard({ title: s.siteTitle, footer: s.tagline || s.author || s.siteTitle });
}
