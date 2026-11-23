// Executes AI-written motion code (see CLAUDE.md "Animations").
// Shared by the preview frame (browser) and the Remotion bundle (headless
// Chrome); also runs in Node for tests. Only "react" and "remotion" can be
// required. The config comes from the static extractor so preview, server
// check and render always agree.
import type { ComponentType } from "react";
import React from "react";
import * as ReactNS from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as Remotion from "remotion";
import type { MotionConfig, MotionTheme } from "../lib/types";
import { compileMotion, extractConfig, MotionCodeError } from "./check";

export { MotionCodeError } from "./check";

export interface EvaluatedMotion {
  Component: ComponentType<{ theme: MotionTheme }>;
  config: MotionConfig;
}

const MODULES: Record<string, unknown> = {
  react: { ...ReactNS, default: React, __esModule: true },
  "react/jsx-runtime": JsxRuntime,
  remotion: { ...Remotion, __esModule: true },
};

const cache = new Map<string, EvaluatedMotion>();
const CACHE_MAX = 8;

export function evaluateMotion(code: string): EvaluatedMotion {
  const hit = cache.get(code);
  if (hit) return hit;

  const js = compileMotion(code);
  const config = extractConfig(code);

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const req = (spec: string) => {
    if (!(spec in MODULES)) throw new MotionCodeError(`Only "react" and "remotion" can be imported; found "${spec}".`);
    return MODULES[spec];
  };
  try {
    const fn = new Function("require", "module", "exports", `"use strict";\n${js}\n`);
    fn(req, mod, mod.exports);
  } catch (e) {
    if (e instanceof MotionCodeError) throw e;
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw new MotionCodeError(`Error while loading the module: ${msg}`);
  }

  const Component = mod.exports.default;
  if (typeof Component !== "function" && !(Component && typeof Component === "object" && "$$typeof" in Component)) {
    throw new MotionCodeError("The module must `export default` a React component.");
  }

  const result: EvaluatedMotion = { Component: Component as ComponentType<{ theme: MotionTheme }>, config };
  cache.set(code, result);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return result;
}
