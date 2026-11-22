import type { Store } from "@/lib/store";

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Returns base (or base-2, base-3, ...) such that no other post uses it. */
export async function uniqueSlug(store: Store, base: string, exceptId: string): Promise<string> {
  const root = slugify(base) || "post";
  let candidate = root;
  for (let n = 2; await store.slugTaken(candidate, exceptId); n++) {
    candidate = `${root.slice(0, 80 - String(n).length - 1)}-${n}`;
  }
  return candidate;
}
