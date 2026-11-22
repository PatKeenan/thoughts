/** Only http(s) or root-relative ("/x", never "//x") URLs are allowed for media. Returns null otherwise. */
export function safeMediaUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const s = u.trim();
  if (!s || /[\u0000-\u001f\s]/.test(s)) return null;
  if (/^https?:\/\/[^/\s]/i.test(s)) return s;
  if (s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\")) return s;
  return null;
}
