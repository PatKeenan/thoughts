import type { RepoData } from "@/lib/types";
import styles from "./render.module.css";

export async function RepoCard({ data }: { data: RepoData }) {
  const href = /^https?:\/\//i.test(data.url) ? data.url : `https://github.com/${data.fullName}`;
  const meta = [data.language, `${data.stars.toLocaleString("en-US")} stars`].filter(Boolean).join(" · ");
  return (
    <a className={styles.repo} href={href} rel="noopener noreferrer">
      <span className={styles.repoName}>{data.fullName}</span>
      {data.description ? <span className={styles.repoDesc}>{data.description}</span> : null}
      <span className={styles.repoMeta}>{meta}</span>
    </a>
  );
}
