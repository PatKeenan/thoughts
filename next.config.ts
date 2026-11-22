import type { NextConfig } from "next";

// cacheComponents is intentionally off: pages use route segment config
// (`dynamic`) — see docs/02-guides/caching-without-cache-components.md
const nextConfig: NextConfig = {
  // The render route falls back to building a sandbox from the Remotion bundle
  // when no build-time snapshot exists, so the bundle must ship with the function.
  outputFileTracingIncludes: { "/api/render": ["./.remotion/**/*"] },
  serverExternalPackages: ["@remotion/vercel", "@remotion/renderer", "@remotion/bundler"],
};

export default nextConfig;
