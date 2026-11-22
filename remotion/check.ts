// Motion code checks that never execute the code: compile (sucrase), import
// allow-list, network-API guard and static config extraction + validation.
// Dependency-light on purpose: runs in the preview frame (esbuild), the
// Remotion bundle (webpack, headless Chrome) and plain Node (render route, tests).
import { transform } from "sucrase";
import type { MotionConfig } from "../lib/types";

export const ALLOWED_IMPORTS = ["react", "remotion"] as const;
/** Imports the compiled output itself needs (automatic JSX runtime). */
const INTERNAL_IMPORTS = ["react/jsx-runtime"];

export const LIMITS = {
  fpsMin: 15,
  fpsMax: 60,
  maxSeconds: 20,
  sizeMin: 240,
  sizeMax: 1920,
} as const;

export class MotionCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MotionCodeError";
  }
}

/** TSX module → CommonJS (string). Throws MotionCodeError with line/column on syntax errors. */
export function compileMotion(code: string): string {
  if (typeof code !== "string" || !code.trim()) throw new MotionCodeError("The motion code is empty.");
  let js: string;
  try {
    js = transform(code, {
      transforms: ["typescript", "jsx", "imports"],
      jsxRuntime: "automatic",
      production: true,
      filePath: "motion.tsx",
    }).code;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new MotionCodeError(`Syntax error: ${msg.replace(/^Error transforming motion\.tsx:\s*/, "")}`);
  }
  checkImports(js, code);
  checkNetwork(code);
  return js;
}

// Source-level import/export-from declarations (TypeScript elides unused imports
// from the compiled output, so check the source too).
const IMPORT_DECL_RE = /(?:^|[;\n}])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"]*)\1|(?:^|[;\n}])\s*import\s*(['"])([^'"]*)\3/g;

function checkImports(js: string, source: string): void {
  const bad = new Set<string>();
  const allowed = (spec: string) =>
    (ALLOWED_IMPORTS as readonly string[]).includes(spec) || INTERNAL_IMPORTS.includes(spec);
  const re = /\brequire\s*\(\s*(['"])([^'"]*)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js))) if (!allowed(m[2])) bad.add(m[2]);
  IMPORT_DECL_RE.lastIndex = 0;
  while ((m = IMPORT_DECL_RE.exec(source))) {
    const spec = m[2] ?? m[4];
    if (spec !== undefined && !(ALLOWED_IMPORTS as readonly string[]).includes(spec)) bad.add(spec);
  }
  if (bad.size) {
    const list = [...bad].map((s) => `"${s}"`).join(", ");
    throw new MotionCodeError(`Only "react" and "remotion" can be imported; found ${list}.`);
  }
  if (/\brequire\s*\((?!\s*['"])/.test(js)) {
    throw new MotionCodeError('Dynamic require()/import() is not allowed; import only from "react" and "remotion".');
  }
}

const NETWORK_RE = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|Worker|SharedWorker)\s*\(|\bnew\s+(XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker)\b/;

function checkNetwork(code: string): void {
  const m = NETWORK_RE.exec(code);
  if (m) throw new MotionCodeError(`Network access is not allowed in motion code (found ${m[1] || m[2]}).`);
}

// ---- config -----------------------------------------------------------------

const CONFIG_RE = /export\s+const\s+config\s*(?::[^=]+)?=\s*\{/;
const KEYS = ["durationInFrames", "fps", "width", "height"] as const;

/**
 * Reads `export const config = { durationInFrames, fps, width, height }` without
 * running the module. Values may be numbers or simple arithmetic (`6 * 30`).
 */
export function extractConfig(code: string): MotionConfig {
  const m = CONFIG_RE.exec(code);
  if (!m) {
    throw new MotionCodeError(
      "Missing `export const config = { durationInFrames, fps, width, height }`.",
    );
  }
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  for (; i < code.length && depth > 0; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
  }
  if (depth !== 0) throw new MotionCodeError("`config` object is not closed.");
  const body = code.slice(start, i - 1).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const raw: Record<string, number> = {};
  for (const part of body.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const kv = /^["']?([A-Za-z_$][\w$]*)["']?\s*:\s*([\s\S]+)$/.exec(p);
    if (!kv) throw new MotionCodeError(`\`config\` must be a plain object of numbers; cannot read "${p.slice(0, 40)}".`);
    const [, key, expr] = kv;
    if (!(KEYS as readonly string[]).includes(key)) continue;
    raw[key] = arith(expr.trim(), key);
  }
  for (const k of KEYS) {
    if (raw[k] === undefined) throw new MotionCodeError(`\`config.${k}\` is missing.`);
  }
  return validateConfig(raw);
}

/** Tiny arithmetic evaluator: numbers, + - * /, parentheses. */
function arith(expr: string, key: string): number {
  const src = expr.replace(/\s+as\s+const\s*$/, "");
  const tokens = src.match(/\d+(?:\.\d+)?|\.\d+|[-+*/()]|\S/g) || [];
  let pos = 0;
  const fail = (): never => {
    throw new MotionCodeError(`\`config.${key}\` must be a number (got \`${expr.slice(0, 40)}\`).`);
  };
  const peek = () => tokens[pos];
  const primary = (): number => {
    const t = tokens[pos++];
    if (t === undefined) return fail();
    if (t === "(") {
      const v = sum();
      if (tokens[pos++] !== ")") fail();
      return v;
    }
    if (t === "-") return -primary();
    if (t === "+") return primary();
    if (/^(\d|\.)/.test(t)) return Number(t);
    return fail();
  };
  const product = (): number => {
    let v = primary();
    while (peek() === "*" || peek() === "/") v = tokens[pos++] === "*" ? v * primary() : v / primary();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") v = tokens[pos++] === "+" ? v + product() : v - product();
    return v;
  };
  const v = sum();
  if (pos !== tokens.length || !Number.isFinite(v)) fail();
  return v;
}

/**
 * Validates a config. Small slips are fixed (rounding, odd → even, a duration a
 * frame or a second over the limit); anything badly out of range throws.
 */
export function validateConfig(input: unknown): MotionConfig {
  if (!input || typeof input !== "object") throw new MotionCodeError("`config` must be an object.");
  const c = input as Record<string, unknown>;
  const num = (k: string): number => {
    const v = c[k];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new MotionCodeError(`\`config.${k}\` must be a number.`);
    return v;
  };
  const fps = Math.round(num("fps"));
  if (fps < LIMITS.fpsMin || fps > LIMITS.fpsMax) {
    throw new MotionCodeError(`\`config.fps\` is ${num("fps")}; it must be between ${LIMITS.fpsMin} and ${LIMITS.fpsMax}.`);
  }
  const size = (k: "width" | "height"): number => {
    const raw = num(k);
    let v = Math.round(raw);
    if (v % 2) v -= 1;
    if (v < LIMITS.sizeMin || v > LIMITS.sizeMax) {
      throw new MotionCodeError(`\`config.${k}\` is ${raw}; it must be between ${LIMITS.sizeMin} and ${LIMITS.sizeMax} pixels.`);
    }
    return v;
  };
  const width = size("width");
  const height = size("height");
  let durationInFrames = Math.round(num("durationInFrames"));
  if (durationInFrames < 1) throw new MotionCodeError("`config.durationInFrames` must be at least 1.");
  const max = LIMITS.maxSeconds * fps;
  if (durationInFrames > max) {
    if (durationInFrames > max + fps) {
      throw new MotionCodeError(
        `The animation is ${(durationInFrames / fps).toFixed(1)} s long; the limit is ${LIMITS.maxSeconds} s (${max} frames at ${fps} fps).`,
      );
    }
    durationInFrames = max;
  }
  return { durationInFrames, fps, width, height };
}

/** Everything the server can check without a browser. Returns the config. */
export function checkMotion(code: string): MotionConfig {
  compileMotion(code);
  return extractConfig(code);
}
