// Pure theme validation, shared by the render route, the Remotion root and the
// sandboxed preview frame. Theme strings end up in inline styles, so nothing
// the parent (or a request body) sends is trusted: every field falls back to
// the default on its own. Relative import on purpose: this file is bundled by
// webpack/esbuild outside Next, where the "@/" alias does not exist (lib/look.ts
// only has a type import, so it bundles cleanly).
import type { MotionTheme } from "../lib/types";
import { DEFAULT_MOTION_THEME } from "../lib/look";

const HEX = /^#[0-9a-f]{6}$/i;
const FONT_MAX = 200;
// No declaration/rule breakers, markup, url(), CSS escapes or control characters.
const FONT_BAD = /[;{}<>\\@]|url\s*\(|expression\s*\(|[\u0000-\u001f\u007f]/i;

const color = (v: unknown, fallback: string): string =>
  typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback;

const font = (v: unknown, fallback: string): string => {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  return s && s.length <= FONT_MAX && !FONT_BAD.test(s) ? s : fallback;
};

export function sanitizeTheme(input: unknown): MotionTheme {
  const d = DEFAULT_MOTION_THEME;
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ...d, extra: [...d.extra] };
  const o = input as Record<string, unknown>;
  const extra = Array.isArray(o.extra)
    ? o.extra
        .filter((c): c is string => typeof c === "string" && HEX.test(c.trim()))
        .slice(0, 3)
        .map((c) => c.trim().toLowerCase())
    : [];
  return {
    bg: color(o.bg, d.bg),
    ink: color(o.ink, d.ink),
    accent: color(o.accent, d.accent),
    muted: color(o.muted, d.muted),
    extra,
    titleFont: font(o.titleFont, d.titleFont),
    bodyFont: font(o.bodyFont, d.bodyFont),
    monoFont: font(o.monoFont, d.monoFont),
  };
}
