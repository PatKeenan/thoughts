import { createNeonAuth } from "@neon/auth/next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";

/**
 * Sign-in is Neon Auth (Managed Better Auth): users and sessions live in the `neon_auth`
 * schema of the Neon branch, the browser talks to it through `/api/auth/[...path]`.
 *
 * This is a one-author app, so a session alone is not enough: the signed-in email must be
 * listed in ADMIN_EMAIL (comma-separated). With ADMIN_EMAIL unset nobody gets in.
 */

type NeonAuth = ReturnType<typeof createNeonAuth>;
let instance: NeonAuth | null = null;

/** Created lazily so builds and pages that never touch auth don't need the env vars. */
export function getAuth(): NeonAuth {
  if (instance) return instance;
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl) throw new Error("NEON_AUTH_BASE_URL is not set");
  if (!secret) throw new Error("NEON_AUTH_COOKIE_SECRET is not set (openssl rand -base64 32)");
  instance = createNeonAuth({ baseUrl, cookies: { secret } });
  return instance;
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: unknown): boolean {
  return typeof email === "string" && adminEmails().includes(email.trim().toLowerCase());
}

/**
 * The sign-in page lives at /<LOGIN_SLUG>, not /login, so scanners probing common login paths get
 * the normal 404. Unset means there is no sign-in page at all.
 */
export function loginSlug(): string | null {
  const slug = process.env.LOGIN_SLUG?.trim().replace(/^\/+|\/+$/g, "");
  return slug && /^[A-Za-z0-9_-]{8,}$/.test(slug) ? slug : null;
}

/**
 * A device the author has signed in on gets a long-lived signed cookie. Signed-out requests to
 * /write from such a device are sent to the sign-in page; everyone else gets a 404, so the
 * editor never reveals where sign-in lives.
 */
export const DEVICE_COOKIE = "author_device";

function deviceToken(): string | null {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  return secret ? createHmac("sha256", secret).update("author-device:v1").digest("base64url") : null;
}

export function deviceCookieHeader(): string | null {
  const token = deviceToken();
  if (!token) return null;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${DEVICE_COOKIE}=${token}; Path=/; Max-Age=${60 * 60 * 24 * 400}; HttpOnly; SameSite=Lax${secure}`;
}

export async function isKnownDevice(): Promise<boolean> {
  const token = deviceToken();
  const got = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!token || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where a signed-out request for `next` should go: the sign-in page on a known device, else null (404). */
export async function signInLocation(next: string): Promise<string | null> {
  const slug = loginSlug();
  if (!slug || !(await isKnownDevice())) return null;
  // A plain path only: no "//" or "/\" (browsers read "\" as "/"), no whitespace or control chars.
  const safe = /^\/(?![/\\])[^\s\\]*$/.test(next) ? next : "/write";
  return `/${slug}?next=${encodeURIComponent(safe)}`;
}

export type AuthState = "admin" | "signed-out" | "not-allowed";

export async function authState(): Promise<AuthState> {
  await cookies(); // opt the caller into dynamic rendering before the SDK runs
  let session;
  try {
    ({ data: session } = await getAuth().getSession());
  } catch (e) {
    unstable_rethrow(e); // let Next's own control-flow errors (dynamic usage, redirects) through
    console.error("[auth] getSession failed", e);
    return "signed-out";
  }
  if (!session?.user) return "signed-out";
  return isAdminEmail(session.user.email) ? "admin" : "not-allowed";
}

export async function isAuthed(): Promise<boolean> {
  return (await authState()) === "admin";
}

export async function requireAuth(): Promise<Response | null> {
  const state = await authState();
  if (state === "admin") return null;
  if (state === "not-allowed") return Response.json({ error: "This account cannot use the editor" }, { status: 403 });
  return Response.json({ error: "Not signed in" }, { status: 401 });
}
