import type { Metadata, Viewport } from "next";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/schibsted-grotesk/wght-italic.css";
import "@fontsource-variable/figtree";
import "@fontsource-variable/figtree/wght-italic.css";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blog",
  appleWebApp: { capable: true, title: "Write", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f8f7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
