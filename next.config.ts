import type { NextConfig } from "next";

// cacheComponents is intentionally off: pages use route segment config
// (`revalidate`, `dynamic`) — see docs/02-guides/caching-without-cache-components.md
const nextConfig: NextConfig = {};

export default nextConfig;
