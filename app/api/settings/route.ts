import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { getStore } from "@/lib/store";
import type { Settings } from "@/lib/types";

const KEYS: (keyof Settings)[] = ["siteTitle", "tagline", "author", "bio", "voiceNotes", "siteUrl"];

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return Response.json({ settings: await (await getStore()).getSettings() });
}

export async function PATCH(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Response.json({ error: "Body must be an object" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  const patch: Partial<Settings> = {};
  for (const k of KEYS) {
    if (body[k] === undefined) continue;
    if (typeof body[k] !== "string") return Response.json({ error: `${k} must be a string` }, { status: 400 });
    patch[k] = k === "siteUrl" ? (body[k] as string).trim().replace(/\/+$/, "") : (body[k] as string);
  }
  const settings = await (await getStore()).updateSettings(patch);
  revalidatePath("/");
  revalidatePath("/posts/[slug]", "page");
  revalidatePath("/feed.xml");
  return Response.json({ settings });
}
