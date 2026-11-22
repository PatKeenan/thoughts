import Link from "next/link";
import { getStore } from "@/lib/store";
import { formatDate } from "./format-date";
import styles from "./site.module.css";

export const dynamic = "force-dynamic"; // read at request time so scheduled posts go live on the minute and builds need no database

export default async function IndexPage() {
  const posts = await (await getStore()).listPublic();
  if (posts.length === 0) return <p className={styles.empty}>Nothing published yet.</p>;
  return (
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
  );
}
