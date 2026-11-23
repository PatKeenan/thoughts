import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loginSlug } from "@/lib/auth";
import LoginForm from "./LoginForm";

/**
 * The sign-in page, served only at /<LOGIN_SLUG>. Every other single-segment path that no real
 * route claims falls through to here and gets the site's normal 404.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
  referrer: "same-origin", // the auth proxy checks that sign-in came from this page
};

export default async function GatePage({ params }: { params: Promise<{ gate: string }> }) {
  const { gate } = await params;
  const slug = loginSlug();
  if (!slug || gate !== slug) notFound();
  return <LoginForm />;
}
