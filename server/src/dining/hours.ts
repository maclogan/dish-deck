// Opening hours at a chosen time, from Google's regularOpeningHours.periods.
// Days are 0 = Sunday ... 6 = Saturday; times are the place's local time. Periods can run past midnight
// (close on the next day) and a place open around the clock has one period with no close.

export interface HoursPoint {
  day: number;
  hour: number;
  minute?: number;
}
export interface HoursPeriod {
  open: HoursPoint;
  close?: HoursPoint;
}

const WEEK = 7 * 24 * 60;
const at = (p: HoursPoint) => p.day * 1440 + p.hour * 60 + (p.minute ?? 0);

/** The place's local day and minutes-after-midnight for a moment, given its UTC offset. */
export function localMoment(utcOffsetMinutes: number, now: Date = new Date()): { day: number; minutes: number } {
  const local = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  return { day: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** "19:30" -> 1170; undefined if malformed. */
export function parseClock(hhmm: string | undefined): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : undefined;
}

/**
 * Whether it's open at this day and time, and minutes until it closes (Infinity if always open).
 * undefined when there are no periods.
 */
export function openAt(periods: HoursPeriod[] | undefined, day: number, minutes: number): { open: boolean; closesIn?: number } | undefined {
  if (!periods?.length) return undefined;
  if (periods.length === 1 && !periods[0]!.close && at(periods[0]!.open) === 0) return { open: true, closesIn: Infinity };
  const t = day * 1440 + minutes;
  for (const p of periods) {
    if (!p.close) continue;
    const start = at(p.open);
    let end = at(p.close);
    if (end <= start) end += WEEK; // runs past Saturday night into Sunday
    // Check this week and the week before (a Saturday-night period covering early Sunday).
    for (const tt of [t, t + WEEK]) {
      if (tt >= start && tt < end) return { open: true, closesIn: end - tt };
    }
  }
  return { open: false };
}

/** Google's weekdayDescriptions are Monday first; returns the line for a 0 = Sunday day, without "Monday: ". */
export function hoursLine(weekdayDescriptions: string[] | undefined, day: number): string | undefined {
  const line = weekdayDescriptions?.[(day + 6) % 7];
  return line?.replace(/^[^:]+:\s*/, "").trim() || undefined;
}
