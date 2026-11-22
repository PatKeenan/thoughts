import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { Doc } from "@/components/render/Doc";
import { effectiveLook } from "@/lib/look";
import { readingMinutes } from "@/lib/text";
import { formatDate } from "../../format-date";
import styles from "../../site.module.css";

export const dynamic = "force-dynamic"; // read at request time so scheduled posts go live on the minute and builds need no database

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await (await getStore()).getPublicBySlug(slug);
  if (!post) return { title: "Not found" };
  const description = post.excerpt || undefined;
  return {
    title: post.title,
    description,
    alternates: { canonical: `/posts/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description,
      url: `/posts/${post.slug}`,
      publishedTime: post.publishAt ?? undefined,
    },
    twitter: { card: "summary", title: post.title, description },
  };
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const store = await getStore();
  const [post, settings] = await Promise.all([store.getPublicBySlug(slug), store.getSettings()]);
  if (!post) notFound();
  const when = post.publishAt ?? post.createdAt;
  return (
    <article className={styles.article}>
      <Link href="/" className={`${styles.back} ${styles.label}`}>
        All posts
      </Link>
      <h1 className={styles.postTitle}>{post.title}</h1>
      <p className={`${styles.meta} ${styles.label}`}>
        <time dateTime={when}>{formatDate(when)}</time> · {readingMinutes(post.content)} min read
      </p>
      <Doc doc={post.content} look={effectiveLook(post.look, settings.defaultLook)} />
    </article>
  );
}
