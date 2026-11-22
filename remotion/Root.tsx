import type { ComponentType } from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { evaluateMotion } from "./evaluate";
import { COMPOSITION_ID } from "./constants";
import { SAMPLE_MOTION } from "./sample";
import { sanitizeTheme } from "./theme";
import { DEFAULT_MOTION_THEME } from "../lib/look";
import type { MotionTheme } from "../lib/types";

type Props = { code: string; theme: MotionTheme };

const Dynamic: ComponentType<Props> = ({ code, theme }) => {
  const { Component } = evaluateMotion(code);
  return <Component theme={sanitizeTheme(theme)} />;
};

const calculateMetadata: CalculateMetadataFunction<Props> = ({ props }) => {
  const { config } = evaluateMotion(props.code);
  return { ...config };
};

export const RemotionRoot = () => (
  <Composition
    id={COMPOSITION_ID}
    component={Dynamic}
    defaultProps={{ code: SAMPLE_MOTION, theme: DEFAULT_MOTION_THEME }}
    calculateMetadata={calculateMetadata}
    durationInFrames={90}
    fps={30}
    width={1280}
    height={720}
  />
);
