import { signInLocation } from "@/lib/auth";

/**
 * GET /write/resume?next=/write/abc — where the editor sends the browser when an API call comes
 * back 401. Keeps the sign-in path out of client code: a known device is redirected to it with
 * `next` preserved, anything else gets a 404.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/write";
  const to = await signInLocation(next);
  if (!to) return new Response("Not found", { status: 404 });
  return Response.redirect(new URL(to, url.origin), 307);
}
