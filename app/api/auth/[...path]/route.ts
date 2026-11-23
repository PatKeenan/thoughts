import { deviceCookieHeader, getAuth, isAdminEmail, loginSlug } from "@/lib/auth";

/**
 * Proxies the browser auth client to Neon Auth, but only the few calls this one-author app uses.
 * - POST sign-in/email: only from the secret sign-in page (checked by its same-origin Referer),
 *   so bots posting straight at the usual Better Auth path get a 404 like any unknown URL.
 * - POST sign-out.
 * - GET get-session (the only read this app makes).
 * Everything else, including sign-up and password reset, is a 404. Sign-up is also disabled on
 * the Neon branch, which covers requests sent to Neon Auth directly.
 */

type Ctx = { params: Promise<{ path: string[] }> };

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

function handler() {
  try {
    return getAuth().handler();
  } catch (e) {
    console.error("[auth]", e);
    return null;
  }
}

function fromLoginPage(req: Request): boolean {
  const slug = loginSlug();
  const referer = req.headers.get("referer");
  if (!slug || !referer) return false;
  try {
    const ref = new URL(referer);
    return ref.origin === new URL(req.url).origin && ref.pathname === `/${slug}`;
  } catch {
    return false;
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const h = handler();
  if (!h) return notFound();
  const path = (await ctx.params).path.join("/");
  return path === "get-session" ? h.GET(req, ctx) : notFound();
}

export async function POST(req: Request, ctx: Ctx) {
  const h = handler();
  if (!h) return notFound();
  const path = (await ctx.params).path.join("/");

  if (path === "sign-out") return h.POST(req, ctx);

  if (path === "sign-in/email" && fromLoginPage(req)) {
    const res = await h.POST(req, ctx);
    const device = deviceCookieHeader();
    // Mark the device only for the author: a valid non-author account learns nothing extra.
    const email = res.ok ? ((await res.clone().json().catch(() => null)) as { user?: { email?: unknown } } | null)?.user?.email : null;
    if (res.ok && device && isAdminEmail(email)) {
      const out = new Response(res.body, res);
      out.headers.append("Set-Cookie", device);
      return out;
    }
    return res;
  }

  return notFound();
}
