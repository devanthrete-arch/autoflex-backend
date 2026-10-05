/** India Standard Time helpers. Calendar dates are `YYYY-MM-DD` strings. */
export const IST_OFFSET_MS = 330 * 60 * 1000;

export function istToday(now = Date.now()): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Weekday (0 = Sunday) of a calendar date. */
export function istDayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00+05:30`).getUTCDay();
}

/** Calendar date and minutes since midnight of an instant. */
export function toIstParts(instant: Date): { date: string; minutes: number } {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** The instant at `minutes` past midnight of a calendar date. */
export function istInstant(date: string, minutes: number): Date {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return new Date(`${date}T${h}:${m}:00+05:30`);
}

/** `[start, end)` instants covering one calendar date. */
export function istDayRange(date: string): { start: Date; end: Date } {
  const start = istInstant(date, 0);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Adds calendar months, clamping to the last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000),
  );
}

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}
