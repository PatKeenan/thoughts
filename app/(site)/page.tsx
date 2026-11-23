import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/store";
import { formatDate } from "./format-date";
import { RSS_ALTERNATE } from "@/lib/site";
import styles from "./site.module.css";

export const dynamic = "force-dynamic"; // read at request time so scheduled posts go live on the minute and builds need no database

export const metadata: Metadata = { alternates: { canonical: "/", types: RSS_ALTERNATE } };

export default async function IndexPage() {
  const store = await getStore();
  const [posts, settings] = await Promise.all([store.listPublic(), store.getSettings()]);
  // The masthead title is a link shared by every page; the index still needs its own h1.
  const heading = <h1 className={styles.visuallyHidden}>{settings.siteTitle}</h1>;
  if (posts.length === 0) return <>{heading}<p className={styles.empty}>Nothing published yet.</p></>;
  return (
    <>
    {heading}
    <ol className={styles.list}>
      {posts.map((p) => (
        <li key={p.id} className={styles.entry}>
          <time className={styles.date} dateTime={p.publishAt ?? undefined}>
            {formatDate(p.publishAt ?? p.createdAt)}
          </time>
          <div>
            <h2 className={styles.entryTitle}>
              <Link href={`/posts/${p.slug}`}>{p.title}</Link>
            </h2>
            {p.excerpt ? <p className={styles.excerpt}>{p.excerpt}</p> : null}
          </div>
        </li>
      ))}
    </ol>
    </>
  );
}
