import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 60; // 60 days, seconds

function sign(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Constant-time check against ADMIN_PASSWORD. Always false if it is unset. */
export function checkPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(password, expected);
}

function verify(token: string | undefined): boolean {
  if (!token || !process.env.SESSION_SECRET) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (!safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}

export async function isAuthed(): Promise<boolean> {
  const jar = await cookies();
  return verify(jar.get(COOKIE)?.value);
}

export async function requireAuth(): Promise<Response | null> {
  if (await isAuthed()) return null;
  return Response.json({ error: "Not signed in" }, { status: 401 });
}

export async function createSession(): Promise<void> {
  const exp = String(Date.now() + MAX_AGE * 1000);
  const jar = await cookies();
  jar.set(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}
