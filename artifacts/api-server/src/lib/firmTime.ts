/**
 * Docketline is an Ontario practice: "today", "next 7 days" and a date typed in
 * a filter all mean the office's day in Toronto — not the day of whichever host
 * happens to run the query (a Vercel function is UTC, a laptop could be
 * anywhere). All-day rows are materialised at UTC midnight of that date, so a
 * day window needs both edges: the office day for timed rows, the UTC day for
 * whole-day ones.
 */
export const FIRM_TZ = process.env.CALENDAR_TIMEZONE || "America/Toronto";

const pad = (n: number) => String(n).padStart(2, "0");

/** The office wall clock for an instant. */
export function firmClock(d: Date) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: FIRM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const at = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: at("year"), m: at("month"), d: at("day"), h: at("hour") % 24, mi: at("minute") };
}

/** The office's date for an instant, as YYYY-MM-DD. */
export function firmDay(d: Date): string {
  const c = firmClock(d);
  return `${c.y}-${pad(c.m)}-${pad(c.d)}`;
}

/** The instant the office clock reads 00:00 on that date. */
export function firmDayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0);
  // Offset trick: re-read the guess on the office clock and add the difference,
  // which also lands correctly on the daylight-saving changeover.
  const seen = firmClock(new Date(guess));
  return new Date(guess + (guess - Date.UTC(seen.y, seen.m - 1, seen.d, seen.h, seen.mi)));
}

/** UTC midnight of that date — where an all-day row lives. */
export const utcDayStart = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** YYYY-MM-DD shifted by whole days. */
export function addDays(day: string, n: number): string {
  const d = utcDayStart(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
