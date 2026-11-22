"use client";

import { useEffect, useRef, useState } from "react";

/** Silent looping clip. Reduced motion: controls, no autoplay. Pauses while off-screen. */
export default function LoopVideo({
  src,
  alt,
  width,
  height,
  className,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (reduced) {
      video.pause();
      return;
    }
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) void video.play().catch(() => {});
          else video.pause();
        }
      },
      { threshold: 0.1 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <video
      ref={ref}
      className={className}
      style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}
      src={src}
      width={width}
      height={height}
      muted
      playsInline
      loop
      autoPlay={!reduced}
      controls={reduced}
      preload="metadata"
      aria-label={alt || undefined}
    />
  );
}
