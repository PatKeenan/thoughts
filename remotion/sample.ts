// A small valid v2 composition (reads colours/fonts from the theme prop): default props for the Remotion entry and test fixture.
export const SAMPLE_MOTION = `import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const config = { durationInFrames: 90, fps: 30, width: 1280, height: 720 };

type Theme = { bg: string; ink: string; accent: string; muted: string; extra: string[]; titleFont: string; bodyFont: string; monoFont: string };

export default function Motion({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 } });
  const x = interpolate(frame, [0, 90], [-0.3, 0.3]) * width;
  return (
    <AbsoluteFill style={{ background: theme.bg, alignItems: "center", justifyContent: "center", fontFamily: theme.titleFont }}>
      <div style={{ width: 220, height: 220, background: theme.accent, transform: \`translateX(\${x}px) scale(\${s}) rotate(\${frame * 2}deg)\` }} />
      <div style={{ position: "absolute", bottom: 80, fontSize: 64, color: theme.ink, opacity: s }}>Hello, motion</div>
    </AbsoluteFill>
  );
}
`;
