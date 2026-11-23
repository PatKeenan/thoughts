// Vercel build step for motion rendering (see vercel.json buildCommand).
//   tsx scripts/create-snapshot.mts --bundle-only   → bundle remotion/index.ts into .remotion/
//   tsx scripts/create-snapshot.mts                 → bundle, then create a Vercel Sandbox with
//     Remotion + Chrome + the bundle, snapshot it (never expires) and store { snapshotId } in
//     Blob under snapshot-cache/<VERCEL_DEPLOYMENT_ID>.json, where /api/render restores it.
// Never fails the build: without BLOB_READ_WRITE_TOKEN (or on any sandbox error) it logs and
// exits 0; /api/render then builds a sandbox on demand from the .remotion bundle.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareSandboxBundleDir, snapshotBlobKey, VERCEL_BUNDLE_DIR } from "../remotion/constants";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = path.join(root, VERCEL_BUNDLE_DIR);
const args = new Set(process.argv.slice(2));
const log = (m: string) => console.log(`[create-snapshot] ${m}`);

async function bundle() {
  const { bundle } = await import("@remotion/bundler");
  const t0 = Date.now();
  await bundle({ entryPoint: path.join(root, "remotion", "index.ts"), outDir: bundleDir, enableCaching: false });
  log(`bundled remotion/index.ts → ${VERCEL_BUNDLE_DIR}/ in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

async function snapshot() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    log("BLOB_READ_WRITE_TOKEN is not set — skipping the sandbox snapshot. Motion renders are unavailable until a Blob store is connected and the project is redeployed.");
    return;
  }
  if (!process.env.VERCEL && !args.has("--force")) {
    log("not running on Vercel — skipping the snapshot (pass --force to create one anyway).");
    return;
  }
  const { createSandbox, addBundleToSandbox } = await import("@remotion/vercel");
  const { put } = await import("@vercel/blob");
  const t0 = Date.now();
  let lastPct = -1;
  const sandbox = await createSandbox({
    onProgress: ({ progress, message }) => {
      const pct = Math.round(progress * 100);
      if (pct - lastPct >= 10 || pct === 100) {
        lastPct = pct;
        log(`${message} (${pct}%)`);
      }
    },
  });
  try {
    await prepareSandboxBundleDir(sandbox);
    await addBundleToSandbox({ sandbox, bundleDir });
    log("taking snapshot…");
    const { snapshotId } = await sandbox.snapshot({ expiration: 0 });
    await put(snapshotBlobKey(), JSON.stringify({ snapshotId }), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    log(`snapshot ${snapshotId} saved as ${snapshotBlobKey()} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

try {
  if (!args.has("--skip-bundle") || !existsSync(path.join(bundleDir, "index.html"))) await bundle();
  if (!args.has("--bundle-only")) await snapshot();
} catch (e) {
  console.warn(`[create-snapshot] WARNING: ${e instanceof Error ? e.message : String(e)}`);
  console.warn("[create-snapshot] continuing without a snapshot; /api/render will prepare a sandbox on demand (slow first render).");
}
