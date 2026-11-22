import type { RepoData } from "@/lib/types";
import styles from "./RepoView.module.css";

export function formatStars(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export default function RepoView({ data }: { data: RepoData }) {
  const [owner, name] = data.fullName.split("/");
  const meta = [data.language, `${formatStars(data.stars)} stars`].filter(Boolean).join(" · ");
  return (
    <div className={styles.card}>
      <div className={styles.kicker}>GitHub</div>
      <a className={styles.name} href={data.url} target="_blank" rel="noreferrer">
        <span className={styles.owner}>{owner}/</span>
        {name}
      </a>
      {data.description && <p className={styles.desc}>{data.description}</p>}
      <div className={styles.meta}>{meta}</div>
    </div>
  );
}
