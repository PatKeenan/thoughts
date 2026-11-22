import { checkPassword, createSession } from "@/lib/auth";

export async function POST(req: Request) {
  if (!process.env.ADMIN_PASSWORD) {
    return Response.json({ error: "ADMIN_PASSWORD is not set on the server, so sign-in is disabled." }, { status: 401 });
  }
  if (!process.env.SESSION_SECRET) {
    return Response.json({ error: "SESSION_SECRET is not set on the server." }, { status: 500 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const password = (body as { password?: unknown } | null)?.password;
  if (typeof password !== "string" || !checkPassword(password)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  await createSession();
  return Response.json({ ok: true });
}
