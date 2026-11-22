/** Composition id of the single dynamic composition (remotion/Root.tsx). */
export const COMPOSITION_ID = "Dynamic";
/** Bundle output dir used by the Vercel build (scripts/create-snapshot.ts) and the on-demand sandbox fallback. */
export const VERCEL_BUNDLE_DIR = ".remotion";
/** Blob key holding `{ snapshotId }` of the sandbox snapshot made at build time for this deployment. */
export const snapshotBlobKey = () => `snapshot-cache/${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}.json`;
