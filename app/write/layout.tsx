import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Write",
  robots: { index: false, follow: false },
};

export default async function WriteLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthed())) redirect("/login?next=/write");
  return <div style={{ minHeight: "100dvh" }}>{children}</div>;
}
