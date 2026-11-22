// Renders motion code (PHASE2.md "Remotion pipeline") to MP4/GIF.
// Two backends:
//  - local: @remotion/bundler + @remotion/renderer with the system Chrome.
//    Imported with webpackIgnore/turbopackIgnore so they never enter the
//    serverless bundle (they are devDependencies).
//  - Vercel: @remotion/vercel in a Vercel Sandbox restored from the build-time
//    snapshot (scripts/create-snapshot.ts), uploading straight to Vercel Blob.
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { putMedia } from "@/lib/media";
import { DEFAULT_MOTION_THEME } from "@/lib/look";
import type { JobEvent, MotionConfig, MotionOutput, MotionTheme } from "@/lib/types";
import { checkMotion } from "@/remotion/check";
import { sanitizeTheme } from "@/remotion/theme";
import { COMPOSITION_ID, snapshotBlobKey, VERCEL_BUNDLE_DIR } from "@/remotion/constants";

export type Emit = (e: JobEvent) => void;
export interface RenderResult {
  url: string;
  width: number;
  height: number;
}

export const GIF_MAX_WIDTH = 720;
export const GIF_FPS = 15;

export interface RenderPlan {
  codec: "h264" | "gif";
  ext: "mp4" | "gif";
  contentType: "video/mp4" | "image/gif";
  scale: number;
  everyNthFrame: number;
  width: number;
  height: number;
  frames: number;
}

/** Output settings for a config. GIF: ≤ 720 px wide (integer dimensions), ~15 fps, loops forever. */
export function renderPlan(config: MotionConfig, output: MotionOutput): RenderPlan {
  if (output !== "gif") {
    return {
      codec: "h264",
      ext: "mp4",
      contentType: "video/mp4",
      scale: 1,
      everyNthFrame: 1,
      width: config.width,
      height: config.height,
      frames: config.durationInFrames,
    };
  }
  let width = config.width;
  let height = config.height;
  if (config.width > GIF_MAX_WIDTH) {
    // Largest width ≤ 720 for which the height stays an integer.
    width = GIF_MAX_WIDTH;
    while (width > 1 && (config.height * width) % config.width !== 0) width--;
    if (width < GIF_MAX_WIDTH / 2) width = GIF_MAX_WIDTH; // pathological ratio: accept rounding
    height = Math.round((config.height * width) / config.width);
  }
  const everyNthFrame = Math.max(1, Math.round(config.fps / GIF_FPS));
  return {
    codec: "gif",
    ext: "gif",
    contentType: "image/gif",
    scale: width / config.width,
    everyNthFrame,
    width,
    height,
    frames: Math.ceil(config.durationInFrames / everyNthFrame),
  };
}

/** Readable one-liner from a renderer/browser error. */
export function cleanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("at ")) ?? "Render failed";
  return line.replace(/^(Uncaught\s+)?Error:\s*/, "").slice(0, 400);
}

/**
 * Checks the code (no browser), renders it, stores the result and returns its URL.
 * Throws on any failure; progress is reported through `emit`.
 */
export async function renderMotion(
  code: string,
  output: MotionOutput,
  emit: Emit,
  theme: MotionTheme = DEFAULT_MOTION_THEME,
): Promise<RenderResult> {
  const config = checkMotion(code); // fails fast with a readable message
  const plan = renderPlan(config, output);
  const safe = sanitizeTheme(theme); // callers other than the route are validated too
  return process.env.VERCEL ? renderOnVercel(code, plan, emit, safe) : renderLocally(code, plan, emit, safe);
}

// ---- progress helper ---------------------------------------------------------

function progressReporter(emit: Emit, plan: RenderPlan, from: number, to: number, initial = "") {
  let last = initial;
  return (p: { renderedFrames: number; encodedFrames: number; progress: number; stitchStage?: string }) => {
    const rendering = p.renderedFrames < plan.frames;
    const pct = Math.min(100, Math.floor((p.renderedFrames / Math.max(1, plan.frames)) * 20) * 5);
    const label = rendering ? `Rendering ${pct}%` : "Encoding";
    if (label === last) return;
    last = label;
    const progress = from + (to - from) * Math.min(1, Math.max(0, p.progress));
    emit({ type: "progress", label, progress: Math.round(progress * 1000) / 1000 });
  };
}

// ---- local backend -------------------------------------------------------------

type RendererMod = typeof import("@remotion/renderer");
type BundlerMod = typeof import("@remotion/bundler");

const g = globalThis as unknown as {
  __motionBundles?: Map<string, Promise<string>>; // keyed by source hash, so editing remotion/** in a running dev server rebundles
  __motionQueue?: Promise<unknown>;
  __motionQueued?: number;
};

async function loadLocal(): Promise<{ renderer: RendererMod; bundler: BundlerMod }> {
  // Kept out of the server bundle: resolved from node_modules at runtime (local dev / next start only).
  const r = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "@remotion/renderer")) as Partial<RendererMod> & { default?: RendererMod };
  const b = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "@remotion/bundler")) as Partial<BundlerMod> & { default?: BundlerMod };
  // CJS packages: named exports may only be on `default` depending on the loader.
  return {
    renderer: (r.renderMedia ? r : r.default) as RendererMod,
    bundler: (b.bundle ? b : b.default) as BundlerMod,
  };
}

function projectRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd());
}

/** Hash of the Remotion entry sources: the bundle never depends on user code (that arrives as inputProps). */
async function sourceHash(root: string): Promise<string> {
  const h = createHash("sha256");
  const dir = path.join(root, "remotion");
  for (const f of (await readdir(dir)).sort()) {
    if (/\.(ts|tsx)$/.test(f)) h.update(f).update(await readFile(path.join(dir, f)));
  }
  // remotion/ imports the default theme from here.
  h.update("lib/look.ts").update(await readFile(path.join(root, "lib", "look.ts")));
  try {
    h.update(JSON.parse(await readFile(path.join(root, "node_modules", "remotion", "package.json"), "utf8")).version);
  } catch {
    /* version unknown */
  }
  return h.digest("hex").slice(0, 12);
}

/** Bundles remotion/index.ts once per process (and reuses an on-disk bundle with the same source hash). */
async function getLocalBundle(bundler: BundlerMod, emit: Emit): Promise<string> {
  const root = projectRoot();
  const hash = await sourceHash(root);
  const bundles = (g.__motionBundles ??= new Map());
  if (!bundles.has(hash)) {
    bundles.set(hash, (async () => {
      const outDir = path.join(os.tmpdir(), `motion-remotion-bundle-${hash}`);
      if (existsSync(path.join(outDir, "index.html")) && existsSync(path.join(outDir, ".complete"))) return outDir;
      emit({ type: "progress", label: "Bundling", progress: 0.02 });
      let lastPct = -1;
      const serveUrl = await bundler.bundle({
        entryPoint: path.join(root, "remotion", "index.ts"),
        outDir,
        enableCaching: true,
        onProgress: (p) => {
          const pct = Math.floor(p / 10) * 10;
          if (pct !== lastPct) {
            lastPct = pct;
            emit({ type: "progress", label: "Bundling", progress: Math.round((0.02 + (p / 100) * 0.13) * 1000) / 1000 });
          }
        },
      });
      await writeFile(path.join(outDir, ".complete"), hash);
      return serveUrl;
    })().catch((e) => {
      bundles.delete(hash);
      throw e;
    }));
  }
  return bundles.get(hash)!;
}

/** One render at a time per process (each render already uses 2 browser tabs). */
function enqueue<T>(job: () => Promise<T>, emit: Emit): Promise<T> {
  const ahead = g.__motionQueued ?? 0;
  if (ahead > 0) emit({ type: "progress", label: "Waiting for another render", progress: 0 });
  g.__motionQueued = ahead + 1;
  const run = (g.__motionQueue ?? Promise.resolve()).then(job, job);
  g.__motionQueue = run.catch(() => {}).finally(() => {
    g.__motionQueued = Math.max(0, (g.__motionQueued ?? 1) - 1);
  });
  return run;
}

export async function renderLocally(
  code: string,
  plan: RenderPlan,
  emit: Emit,
  theme: MotionTheme = DEFAULT_MOTION_THEME,
): Promise<RenderResult> {
  return enqueue(async () => {
    const { renderer, bundler } = await loadLocal();
    const serveUrl = await getLocalBundle(bundler, emit);
    const browserExecutable = process.env.CHROME_PATH || "/usr/bin/google-chrome";
    // Full Chrome (not chrome-headless-shell) needs the new headless mode.
    const chromeMode = "chrome-for-testing" as const;
    const inputProps = { code, theme };

    emit({ type: "progress", label: "Starting browser", progress: 0.15 });
    const browser = await renderer.openBrowser("chrome", { browserExecutable, chromeMode, logLevel: "error" });
    const tmp = path.join(os.tmpdir(), `motion-${randomUUID()}.${plan.ext}`);
    try {
      const composition = await renderer.selectComposition({
        serveUrl,
        id: COMPOSITION_ID,
        inputProps,
        puppeteerInstance: browser,
        browserExecutable,
        chromeMode,
        logLevel: "error",
      });
      emit({ type: "progress", label: "Rendering 0%", progress: 0.18 });
      await renderer.renderMedia({
        serveUrl,
        composition,
        inputProps,
        codec: plan.codec,
        outputLocation: tmp,
        puppeteerInstance: browser,
        browserExecutable,
        chromeMode,
        concurrency: 2,
        scale: plan.scale,
        everyNthFrame: plan.everyNthFrame,
        jpegQuality: 90,
        muted: true,
        logLevel: "error",
        onProgress: progressReporter(emit, plan, 0.18, 0.92, "Rendering 0%"),
        ...(plan.codec === "gif"
          ? { numberOfGifLoops: null } // null = loop forever
          : { pixelFormat: "yuv420p" as const, colorSpace: "bt709" as const, crf: 20, x264Preset: "medium" as const }),
      });
      emit({ type: "progress", label: "Uploading", progress: 0.95 });
      const bytes = await readFile(tmp);
      const { url } = await putMedia(bytes, plan.contentType);
      return { url, width: plan.width, height: plan.height };
    } catch (e) {
      throw new Error(cleanError(e));
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
      await browser.close({ silent: true }).catch(() => {});
    }
  }, emit);
}

// ---- Vercel backend ------------------------------------------------------------

type VercelMod = typeof import("@remotion/vercel");
type Sandbox = Awaited<ReturnType<VercelMod["createSandbox"]>>;

async function restoreSnapshot(): Promise<Sandbox | null> {
  const { get } = await import("@vercel/blob");
  const blob = await get(snapshotBlobKey(), { access: "public", token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return null;
  const { snapshotId } = (await new Response(blob.stream).json()) as { snapshotId?: string };
  if (!snapshotId) return null;
  const { Sandbox } = await import("@vercel/sandbox");
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId },
    timeout: 5 * 60 * 1000,
    // @vercel/sandbox ≥ 2 keeps sandboxes by default; a render sandbox is throwaway.
    ...({ persistent: false } as Record<string, unknown>),
  });
  return sandbox as Sandbox;
}

async function renderOnVercel(code: string, plan: RenderPlan, emit: Emit, theme: MotionTheme): Promise<RenderResult> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set: connect a Vercel Blob store to this project to render motion.");
  }
  const v: VercelMod = await import("@remotion/vercel");

  emit({ type: "progress", label: "Starting renderer", progress: 0.02 });
  let sandbox = await restoreSnapshot();
  if (!sandbox) {
    // No build-time snapshot (first deploy without a Blob token, or the snapshot step failed): build one now.
    const bundleDir = path.join(projectRoot(), VERCEL_BUNDLE_DIR);
    if (!existsSync(path.join(bundleDir, "index.html"))) {
      throw new Error(
        "No renderer snapshot for this deployment. Redeploy with BLOB_READ_WRITE_TOKEN set so the build can create it.",
      );
    }
    sandbox = await v.createSandbox({
      onProgress: ({ progress }) =>
        emit({ type: "progress", label: "Preparing renderer (first run)", progress: 0.02 + progress * 0.25 }),
    });
    await v.addBundleToSandbox({ sandbox, bundleDir });
  }

  try {
    let last = "";
    const report = progressReporter(emit, plan, 0.3, 0.92);
    const { sandboxFilePath, contentType } = await v.renderMediaOnVercel({
      sandbox,
      compositionId: COMPOSITION_ID,
      inputProps: { code, theme },
      codec: plan.codec,
      outputFile: `/tmp/motion.${plan.ext}`,
      scale: plan.scale,
      everyNthFrame: plan.everyNthFrame,
      jpegQuality: 90,
      muted: true,
      logLevel: "error",
      ...(plan.codec === "gif"
        ? { numberOfGifLoops: null }
        : { pixelFormat: "yuv420p" as const, colorSpace: "bt709" as const, crf: 20, x264Preset: "medium" as const }),
      onProgress: (u) => {
        if (u.stage === "render-progress") return report(u.progress);
        const label = u.stage === "opening-browser" ? "Starting browser" : "Loading composition";
        if (label !== last) {
          last = label;
          emit({ type: "progress", label, progress: 0.3 });
        }
      },
    });
    emit({ type: "progress", label: "Uploading", progress: 0.95 });
    const { url } = await v.uploadToVercelBlob({
      sandbox,
      sandboxFilePath,
      contentType,
      blobToken,
      access: "public",
      blobPath: `media/${randomUUID()}.${plan.ext}`,
    });
    // uploadToVercelBlob returns the download URL (?download=1 forces Content-Disposition: attachment).
    const clean = new URL(url);
    clean.searchParams.delete("download");
    return { url: clean.toString(), width: plan.width, height: plan.height };
  } catch (e) {
    throw new Error(cleanError(e));
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
