import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { validateLook } from "@/lib/look";
import type { Look, Settings } from "@/lib/types";

const KEYS: ("siteTitle" | "tagline" | "author" | "bio" | "voiceNotes" | "siteUrl")[] = ["siteTitle", "tagline", "author", "bio", "voiceNotes", "siteUrl"];

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
  if (body.defaultLook !== undefined) {
    if (body.defaultLook === null) patch.defaultLook = null;
    else {
      const l = validateLook(body.defaultLook);
      if (!l) return Response.json({ error: "defaultLook is not a valid look" }, { status: 400 });
      patch.defaultLook = l;
    }
  }
  if (body.savedLooks !== undefined) {
    if (!Array.isArray(body.savedLooks)) return Response.json({ error: "savedLooks must be an array" }, { status: 400 });
    const seen = new Set<string>();
    const looks: Look[] = [];
    for (const item of body.savedLooks) {
      const l = validateLook(item);
      if (!l || seen.has(l.id)) continue;
      seen.add(l.id);
      looks.push(l);
      if (looks.length >= 20) break;
    }
    patch.savedLooks = looks;
  }
  const settings = await (await getStore()).updateSettings(patch);
  revalidatePath("/");
  revalidatePath("/posts/[slug]", "page");
  revalidatePath("/feed.xml");
  return Response.json({ settings });
}
