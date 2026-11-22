import type { MotionData } from "@/lib/types";
import LoopVideo from "./LoopVideo";
import { safeMediaUrl } from "./url";
import styles from "./render.module.css";

function dim(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

export function MotionFigure({ data }: { data: MotionData }) {
  const url = safeMediaUrl(data.url);
  if (!url) return null;
  const width = dim(data.width);
  const height = dim(data.height);
  const style = width && height ? { aspectRatio: `${width} / ${height}` } : undefined;
  const alt = data.alt ?? "";
  let media;
  if (data.output === "gif") {
    media = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={styles.motion}
        style={style}
        src={url}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
      />
    );
  } else if (data.output === "loop") {
    media = <LoopVideo src={url} alt={alt} width={width} height={height} className={styles.motion} />;
  } else {
    media = (
      <video
        className={styles.motion}
        style={style}
        src={url}
        controls
        playsInline
        preload="metadata"
        width={width}
        height={height}
        aria-label={alt || undefined}
      />
    );
  }
  return (
    <figure className={styles.figure}>
      {media}
      {data.caption ? <figcaption className={styles.caption}>{data.caption}</figcaption> : null}
    </figure>
  );
}
