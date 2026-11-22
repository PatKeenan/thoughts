import type { ComponentType } from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { evaluateMotion } from "./evaluate";
import { COMPOSITION_ID } from "./constants";
import { SAMPLE_MOTION } from "./sample";

type Props = { code: string };

const Dynamic: ComponentType<Props> = ({ code }) => {
  const { Component } = evaluateMotion(code);
  return <Component />;
};

const calculateMetadata: CalculateMetadataFunction<Props> = ({ props }) => {
  const { config } = evaluateMotion(props.code);
  return { ...config };
};

export const RemotionRoot = () => (
  <Composition
    id={COMPOSITION_ID}
    component={Dynamic}
    defaultProps={{ code: SAMPLE_MOTION }}
    calculateMetadata={calculateMetadata}
    durationInFrames={90}
    fps={30}
    width={1280}
    height={720}
  />
);
