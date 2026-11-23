import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { Doc } from "@/components/render/Doc";
import { effectiveLook } from "@/lib/look";
import type { Look, Post, Settings } from "@/lib/types";
import { docToText, readingMinutes } from "@/lib/text";
import { postDescription, postOgImage, RSS_ALTERNATE, siteOrigin } from "@/lib/site";
import { formatDate } from "../../format-date";
import styles from "../../site.module.css";

export const dynamic = "force-dynamic"; // read at request time so scheduled posts go live on the minute and builds need no database

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const store = await getStore();
  const [post, settings] = await Promise.all([store.getPublicBySlug(slug), store.getSettings()]);
  if (!post) return { title: "Not found" };
  const description = postDescription(post) || undefined;
  const url = `/posts/${post.slug}`;
  const image = postOgImage(post.slug, post.title);
  return {
    title: post.title,
    description,
    alternates: { canonical: url, types: RSS_ALTERNATE },
    openGraph: {
      type: "article",
      siteName: settings.siteTitle,
      locale: "en_US",
      title: post.title,
      description,
      url,
      publishedTime: post.publishAt ?? undefined,
      modifiedTime: post.updatedAt,
      authors: settings.author ? [settings.author] : undefined,
      images: [image],
    },
    twitter: { card: "summary_large_image", title: post.title, description, images: [image] },
  };
}

/** schema.org BlogPosting, so search engines get the headline, dates and author unambiguously. */
function articleJsonLd(post: Post, settings: Settings): string {
  const origin = siteOrigin(settings);
  const abs = (path: string) => (origin ? `${origin}${path}` : undefined);
  const data = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: postDescription(post) || undefined,
    datePublished: post.publishAt ?? post.createdAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: abs(`/posts/${post.slug}`),
    url: abs(`/posts/${post.slug}`),
    image: abs(postOgImage(post.slug, post.title).url),
    author: settings.author ? { "@type": "Person", name: settings.author, url: origin ?? undefined } : undefined,
    publisher: { "@type": "Organization", name: settings.siteTitle, url: origin ?? undefined },
    wordCount: docToText(post.content).split(/\s+/).filter(Boolean).length,
    inLanguage: "en",
  };
  // Escape "<" so a title like "</script>" can't break out of the script tag.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * Each post wears its own look's accents: the first colour drives links, the
 * second (if the look has one) the marks and pull rules. Page and text colours
 * stay the site's, so every post reads the same.
 */
function accentVars(look: Look | null): React.CSSProperties {
  if (!look) return {};
  return { "--accent": look.palette.accent, "--accent-2": look.palette.extra[0] ?? look.palette.accent } as React.CSSProperties;
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const store = await getStore();
  const [post, settings] = await Promise.all([store.getPublicBySlug(slug), store.getSettings()]);
  if (!post) notFound();
  const when = post.publishAt ?? post.createdAt;
  const look = effectiveLook(post.look, settings.defaultLook);
  return (
    <article className={styles.article} style={accentVars(look)}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: articleJsonLd(post, settings) }} />
      <Link href="/" className={`${styles.back} ${styles.label}`}>
        All posts
      </Link>
      <h1 className={styles.postTitle}>{post.title}</h1>
      <p className={`${styles.meta} ${styles.label}`}>
        <time dateTime={when}>{formatDate(when)}</time> · {readingMinutes(post.content)} min read
      </p>
      <Doc doc={post.content} look={look} />
    </article>
  );
}
