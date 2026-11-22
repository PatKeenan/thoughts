/** Helpers for <input type="datetime-local"> values ("YYYY-MM-DDTHH:mm", local time, no zone). */

const pad = (n: number) => String(n).padStart(2, "0");

/** Format a Date as a datetime-local value in the user's local zone. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Interpret a datetime-local value as local time and return a UTC ISO string (null if invalid). */
export function localInputToISO(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0); // local-time constructor
  if (Number.isNaN(date.getTime())) return null;
  // Reject overflow like 2026-02-31 silently rolling over.
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.toISOString();
}

/** Earliest allowed schedule time: now + 5 minutes, rounded up to the minute. */
export function minSchedule(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 5 * 60_000);
  if (t.getSeconds() > 0 || t.getMilliseconds() > 0) {
    t.setMinutes(t.getMinutes() + 1, 0, 0);
  }
  return toLocalInput(t);
}

/** Tomorrow at 09:00 local. */
export function defaultSchedule(now: Date = new Date()): string {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  return toLocalInput(t);
}

/** "Tue 24 Nov, 9:00 AM" in the user's zone. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date.replace(/,/g, "")}, ${time}`;
}

export function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "");
}
