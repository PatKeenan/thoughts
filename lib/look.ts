// The "look": a post's shared visual style. Pure helpers shared by server and client.
// This file is the contract between streams — do not change shapes.
import type { FontKind, Look, LookStamp, MotionTheme } from "@/lib/types";

/** Shiki themes a look may use for code. First dark, then light. */
export const CODE_THEMES = [
  "dracula",
  "night-owl",
  "tokyo-night",
  "vitesse-dark",
  "github-dark",
  "one-dark-pro",
  "nord",
  "vitesse-light",
  "github-light",
  "solarized-light",
] as const;
export type CodeTheme = (typeof CODE_THEMES)[number];
export const DEFAULT_CODE_THEME: CodeTheme = "dracula";

export function codeThemeOf(look: Look | null | undefined): CodeTheme {
  const t = look?.codeTheme;
  return (CODE_THEMES as readonly string[]).includes(t ?? "") ? (t as CodeTheme) : DEFAULT_CODE_THEME;
}

export const FONT_STACKS: Record<FontKind, string> = {
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

/** The blog's own palette: what animations use when a post has no look. */
export const DEFAULT_MOTION_THEME: MotionTheme = {
  bg: "#f5f8f7",
  ink: "#042f2e",
  accent: "#0f766e",
  muted: "#cddbd8",
  extra: ["#db2777"],
  titleFont: FONT_STACKS.serif,
  bodyFont: FONT_STACKS.serif,
  monoFont: FONT_STACKS.mono,
};

export function motionThemeFromLook(look: Look | null | undefined): MotionTheme {
  if (!look) return DEFAULT_MOTION_THEME;
  return {
    bg: look.palette.bg,
    ink: look.palette.ink,
    accent: look.palette.accent,
    muted: look.palette.muted,
    extra: look.palette.extra,
    titleFont: FONT_STACKS[look.typography.title],
    bodyFont: FONT_STACKS[look.typography.body],
    monoFont: FONT_STACKS.mono,
  };
}

/** The look a post actually uses: its own, else the site default. */
export function effectiveLook(postLook: Look | null | undefined, defaultLook: Look | null | undefined): Look | null {
  return postLook ?? defaultLook ?? null;
}

export function stampOf(look: Look | null | undefined): LookStamp {
  return look ? { id: look.id, version: look.version } : null;
}

/**
 * Is a block out of step with the post's look?
 * - no look on the post → never
 * - stamp === null → made as a deliberate one-off → never
 * - stamp undefined (made before looks) or a different id/version → yes
 */
export function isOffLook(stamp: LookStamp | undefined, look: Look | null | undefined): boolean {
  if (!look) return false;
  if (stamp === null) return false;
  if (stamp === undefined) return true;
  return stamp.id !== look.id || stamp.version !== look.version;
}

/** Does this composition take its colours from the theme prop (so a restyle is a re-render, no AI)? */
export function usesTheme(code: string): boolean {
  return /\btheme\s*\.\s*(bg|ink|accent|muted|extra|titleFont|bodyFont|monoFont)\b/.test(code);
}

const STYLE_KEYS = ["palette", "typography", "illustration", "motion", "mood", "referenceUrl"] as const;

/**
 * Apply an edit. Bumps `version` only when something that affects generated
 * images/animations changed — renaming or changing the code theme does not
 * (code is themed at render time), so those edits never mark blocks off-look.
 */
export function editLook(look: Look, patch: Partial<Omit<Look, "id" | "version">>): Look {
  const next: Look = { ...look, ...patch };
  const changed = STYLE_KEYS.some((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(look[k]));
  return changed ? { ...next, version: look.version + 1 } : next;
}

/** A copy for reuse in another post or as the site default (same id, so blocks stay in step). */
export function cloneLook(look: Look): Look {
  return JSON.parse(JSON.stringify(look)) as Look;
}

/** Plain-language description injected into image / clip / animation prompts. */
export function lookToPrompt(look: Look): string {
  const p = look.palette;
  const colours = [`background ${p.bg}`, `main/ink ${p.ink}`, `accent ${p.accent}`, `muted ${p.muted}`, ...p.extra.map((c) => `also ${c}`)];
  return [
    `Visual look "${look.name}" — everything in this post shares it.`,
    `Palette: ${colours.join(", ")}. Stay inside this palette.`,
    `Illustration style: ${look.illustration}`,
    `Type feel: ${look.typography.title} titles, ${look.typography.body} body.`,
    `Motion: ${look.motion.pace}${look.motion.notes ? ` — ${look.motion.notes}` : ""}.`,
    look.mood.length ? `Mood: ${look.mood.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const HEX = /^#[0-9a-f]{6}$/i;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const hex = (v: unknown, fallback: string): string => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback);
const font = (v: unknown, fallback: FontKind): FontKind => (v === "serif" || v === "sans" || v === "mono" ? v : fallback);

/** Media URLs we store: https, http, or root-relative (not protocol-relative). */
export function safeRefUrl(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 2000) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  return undefined;
}

/**
 * Sanitises untrusted input (request bodies, model output) into a Look, or null if it isn't one.
 * `fill` supplies id/version when the input (e.g. model output) has none.
 */
export function validateLook(input: unknown, fill?: { id: string; version: number }): Look | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const pal = (o.palette && typeof o.palette === "object" ? o.palette : {}) as Record<string, unknown>;
  const typo = (o.typography && typeof o.typography === "object" ? o.typography : {}) as Record<string, unknown>;
  const mot = (o.motion && typeof o.motion === "object" ? o.motion : {}) as Record<string, unknown>;
  const id = str(o.id, 64) || fill?.id || "";
  const version = Number.isInteger(o.version) && (o.version as number) > 0 ? (o.version as number) : (fill?.version ?? 0);
  const name = str(o.name, 60);
  const illustration = str(o.illustration, 400);
  if (!id || !version || !name || !illustration) return null;
  const d = DEFAULT_MOTION_THEME;
  const extra = Array.isArray(pal.extra) ? pal.extra.filter((c): c is string => typeof c === "string" && HEX.test(c.trim())).slice(0, 3).map((c) => c.trim().toLowerCase()) : [];
  const pace = mot.pace === "brisk" || mot.pace === "snappy" ? mot.pace : "calm";
  const mood = Array.isArray(o.mood) ? o.mood.map((m) => str(m, 24)).filter(Boolean).slice(0, 5) : [];
  const codeTheme = (CODE_THEMES as readonly string[]).includes(str(o.codeTheme, 40)) ? str(o.codeTheme, 40) : DEFAULT_CODE_THEME;
  const referenceUrl = safeRefUrl(o.referenceUrl);
  return {
    id,
    name,
    version,
    palette: { bg: hex(pal.bg, d.bg), ink: hex(pal.ink, d.ink), accent: hex(pal.accent, d.accent), muted: hex(pal.muted, d.muted), extra },
    typography: { title: font(typo.title, "serif"), body: font(typo.body, "serif") },
    illustration,
    motion: { pace, notes: str(mot.notes, 200) },
    codeTheme,
    mood,
    ...(referenceUrl ? { referenceUrl } : {}),
  };
}
