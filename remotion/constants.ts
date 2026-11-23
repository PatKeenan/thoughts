/** Composition id of the single dynamic composition (remotion/Root.tsx). */
export const COMPOSITION_ID = "Dynamic";
/** Bundle output dir used by the Vercel build (scripts/create-snapshot.ts) and the on-demand sandbox fallback. */
export const VERCEL_BUNDLE_DIR = ".remotion";
/** Blob key holding `{ snapshotId }` of the sandbox snapshot made at build time for this deployment. */
export const snapshotBlobKey = () => `snapshot-cache/${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}.json`;

/**
 * @remotion/vercel's addBundleToSandbox (4.0.545 and 4.0.546) creates every directory *inside*
 * its "remotion-bundle" folder (public/, …) but never the folder itself, and the sandbox's mkDir
 * isn't recursive, so the first call fails with "cannot create directory …/remotion-bundle/public:
 * no such file or directory". Create the root first. Call before addBundleToSandbox.
 */
export async function prepareSandboxBundleDir(sandbox: { mkDir(path: string): Promise<void> }): Promise<void> {
  try {
    await sandbox.mkDir("remotion-bundle");
  } catch {
    // Already there (or a real failure, which addBundleToSandbox will then report clearly).
  }
}
