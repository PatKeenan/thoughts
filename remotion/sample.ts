// A small valid composition: default props for the Remotion entry and test fixture.
export const SAMPLE_MOTION = `import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const config = { durationInFrames: 90, fps: 30, width: 1280, height: 720 };

export default function Motion() {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 } });
  const x = interpolate(frame, [0, 90], [-0.3, 0.3]) * width;
  return (
    <AbsoluteFill style={{ background: "#f4efe6", alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif" }}>
      <div style={{ width: 220, height: 220, background: "#d6452b", transform: \`translateX(\${x}px) scale(\${s}) rotate(\${frame * 2}deg)\` }} />
      <div style={{ position: "absolute", bottom: 80, fontSize: 64, color: "#1b1a17", opacity: s }}>Hello, motion</div>
    </AbsoluteFill>
  );
}
`;
