import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/store";
import { RSS_ALTERNATE, siteOgImage, siteOrigin } from "@/lib/site";
import styles from "./site.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const s = await (await getStore()).getSettings();
  const origin = siteOrigin(s);
  return {
    metadataBase: origin ? new URL(origin) : undefined,
    title: { default: s.siteTitle, template: `%s — ${s.siteTitle}` },
    description: s.tagline || undefined,
    authors: s.author ? [{ name: s.author, url: origin ?? undefined }] : undefined,
    alternates: { types: RSS_ALTERNATE },
    openGraph: { siteName: s.siteTitle, type: "website", locale: "en_US", images: [siteOgImage()] },
    twitter: { card: "summary_large_image", images: [siteOgImage()] },
  };
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const s = await (await getStore()).getSettings();
  return (
    <div className={styles.shell}>
      <header className={`${styles.masthead} ${styles.reveal}`}>
        <Link href="/" className={styles.title}>
          {s.siteTitle}
        </Link>
        {s.tagline ? <p className={styles.tagline}>{s.tagline}</p> : null}
      </header>
      <main className={`${styles.main} ${styles.reveal}`}>{children}</main>
      <footer className={styles.footer}>
        {s.author || s.bio ? (
          <p>
            {s.author ? <strong>{s.author}</strong> : null}
            {s.author && s.bio ? " — " : null}
            {s.bio}
          </p>
        ) : (
          <span />
        )}
        <a className={styles.label} href="/feed.xml">
          RSS feed
        </a>
      </footer>
    </div>
  );
}
