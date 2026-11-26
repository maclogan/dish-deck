// Small helpers: dates in a fixed timezone, text normalization, concurrency.

/** Today's date as YYYY-MM-DD in the given IANA timezone. */
export function localDate(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Add days to a YYYY-MM-DD date (calendar math, no timezone drift). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  const toMs = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toMs(b) - toMs(a)) / 86_400_000);
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The 7 dates of the plan window. */
export function planDates(
  timezone: string,
  planStart: "today" | "tomorrow" | "monday" | "sunday",
  now: Date = new Date(),
): string[] {
  const today = localDate(timezone, now);
  let start = today;
  if (planStart === "tomorrow") start = addDays(today, 1);
  if (planStart === "monday" || planStart === "sunday") {
    const target = planStart === "monday" ? 1 : 0;
    // Start of the current week (so the week in progress is shown).
    const back = (weekday(today) - target + 7) % 7;
    start = addDays(today, -back);
  }
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Very small English singularizer, good enough for food names. */
export function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/(oes|ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

/** Normalize and singularize every word. */
export function canonical(text: string): string {
  return normalize(text).split(" ").filter(Boolean).map(singular).join(" ");
}

/** True if `phrase` appears in `text` as whole words (both already canonical). */
export function containsPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

export function slugify(text: string): string {
  return normalize(text).replace(/ /g, "-").slice(0, 80);
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Run async work over items with limited concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Parse Mealie-style or ISO durations into minutes ("PT1H30M", "1 hour 30 minutes", "45 min"). */
export function parseMinutes(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const iso = /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/i.exec(value.trim());
  if (iso && (iso[1] || iso[2])) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0);
  const h = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(value);
  const m = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/i.exec(value);
  if (!h && !m) return undefined;
  return Math.round(Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0));
}

/** Minutes to an ISO-8601 duration ("PT1H5M"). */
export function toIsoDuration(minutes: number | undefined): string | undefined {
  if (!minutes || minutes <= 0) return undefined;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}`;
}

/**
 * Resolve with `work`, or with `fallback()` if it takes longer than `ms`. The work keeps running in the
 * background (its result still lands in caches); its errors are swallowed once the fallback won.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  work.catch(() => undefined);
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
