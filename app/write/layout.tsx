import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { authState, signInLocation } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Write",
  robots: { index: false, follow: false },
};

export default async function WriteLayout({ children }: { children: React.ReactNode }) {
  if ((await authState()) !== "admin") {
    // Only a device the author has signed in on before learns where sign-in is; others get a 404.
    const to = await signInLocation("/write");
    if (to) redirect(to);
    notFound();
  }
  return <div style={{ minHeight: "100dvh" }}>{children}</div>;
}
