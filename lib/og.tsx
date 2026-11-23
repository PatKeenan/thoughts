import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The link-preview card (1200×630) for the home page and every post: the site's margin-note mark
 * at large scale, the title set in Schibsted Grotesk beside the pink pull rule, the site name
 * below. Colours mirror app/globals.css (an image can't read CSS variables).
 */

const OG_SIZE = { width: 1200, height: 630 };

const PAPER = "#f5f8f7";
const INK = "#042f2e";
const INK_2 = "#3b5b59";
const RULE = "#cddbd8";
const PINK = "#db2777";

const fonts = Promise.all([
  readFile(join(process.cwd(), "assets/fonts/schibsted-grotesk-latin-700-normal.woff")),
  readFile(join(process.cwd(), "assets/fonts/schibsted-grotesk-latin-500-normal.woff")),
]);

/** The icon's mark (pink rule + three shortening lines), drawn at `h` px tall. */
function Mark({ h }: { h: number }) {
  const u = h / 256;
  const bar = (w: number, top: number, color: string, left: number, height = 44) => (
    <div style={{ position: "absolute", left: left * u, top: top * u, width: w * u, height: height * u, background: color }} />
  );
  return (
    <div style={{ position: "relative", width: 258 * u, height: h, display: "flex" }}>
      {bar(44, 0, PINK, 0, 256)}
      {bar(168, 18, INK, 90)}
      {bar(140, 106, INK, 90)}
      {bar(96, 194, INK, 90)}
    </div>
  );
}

export async function ogCard({ title, kicker, footer }: { title: string; kicker?: string; footer: string }) {
  const [bold, medium] = await fonts;
  // Long titles step down so they stay within three lines.
  const size = title.length > 90 ? 58 : title.length > 55 ? 68 : 80;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          padding: "72px 80px 64px",
          fontFamily: "Schibsted Grotesk",
          color: INK,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {kicker ? (
            <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: INK_2 }}>
              {kicker}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 36 }}>
            <div style={{ width: 12, background: PINK, flexShrink: 0 }} />
            <div
              style={{
                fontSize: size,
                fontWeight: 700,
                letterSpacing: "-0.035em",
                lineHeight: 1.04,
                maxHeight: size * 1.04 * 3,
                overflow: "hidden",
                display: "flex",
              }}
            >
              {title}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `2px solid ${RULE}`,
            paddingTop: 28,
          }}
        >
          <div style={{ fontSize: 30, fontWeight: 500, color: INK_2 }}>{footer}</div>
          <Mark h={44} />
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Schibsted Grotesk", data: bold, weight: 700, style: "normal" },
        { name: "Schibsted Grotesk", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
}
