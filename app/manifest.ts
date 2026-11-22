import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Write",
    short_name: "Write",
    description: "Write and publish posts.",
    start_url: "/write",
    scope: "/",
    display: "standalone",
    background_color: "#f5efe4",
    theme_color: "#f5efe4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
