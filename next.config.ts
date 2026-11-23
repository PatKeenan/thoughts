import type { NextConfig } from "next";

// cacheComponents is intentionally off: pages use route segment config
// (`dynamic`) — see docs/02-guides/caching-without-cache-components.md
const nextConfig: NextConfig = {
  // Let `next dev` serve its client assets/HMR to a phone on the LAN; without this the page
  // renders but never hydrates. Dev only. (Sign-in still needs HTTPS or localhost.)
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
  // The render route falls back to building a sandbox from the Remotion bundle
  // when no build-time snapshot exists, so the bundle must ship with the function.
  // The link-preview cards (lib/og.tsx) read their fonts from assets/fonts at runtime.
  outputFileTracingIncludes: {
    "/api/render": ["./.remotion/**/*"],
    "/og": ["./assets/fonts/**/*"],
    "/og/posts/[slug]": ["./assets/fonts/**/*"],
  },
  serverExternalPackages: ["@remotion/vercel", "@remotion/renderer", "@remotion/bundler"],
};

export default nextConfig;
