import type { Aspect, ImageData } from "@/lib/types";
import { safeMediaUrl } from "./url";
import styles from "./render.module.css";

const RATIOS: Record<Aspect, string> = {
  "16:9": "16 / 9",
  "1:1": "1 / 1",
  "4:5": "4 / 5",
  "3:2": "3 / 2",
};

export function ImageFigure({ data }: { data: ImageData }) {
  const url = safeMediaUrl(data.url);
  if (!url) return null;
  const ratio = RATIOS[data.aspect] ?? RATIOS["3:2"];
  return (
    <figure className={styles.figure}>
      <div className={styles.media} style={{ aspectRatio: ratio }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.mediaFill} src={url} alt={data.alt ?? ""} loading="lazy" decoding="async" />
      </div>
      {data.caption ? <figcaption className={styles.caption}>{data.caption}</figcaption> : null}
    </figure>
  );
}
