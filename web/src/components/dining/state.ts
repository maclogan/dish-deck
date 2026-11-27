// Per-device state for the "Eat out" tab. The shortlist and "not today" list belong to today only and
// clear themselves tomorrow; they never reach the server or affect a search.

import type { DiningFilters, DiningSort, LatLng, PlaceSummary } from "../../api";
import { storageGet, storageSet } from "../../api";
import { todayIso } from "../../text";

export type Display = "list" | "deck" | "map";
export interface SavedLocation extends LatLng {
  label: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = storageGet(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
const write = (key: string, value: unknown) => storageSet(key, JSON.stringify(value));

const DAY_KEY = "dishdeck.dining.today";
export interface Today {
  date: string;
  shortlist: PlaceSummary[];
  hidden: string[];
}
export function loadToday(): Today {
  const t = read<Today | null>(DAY_KEY, null);
  return t && t.date === todayIso() ? t : { date: todayIso(), shortlist: [], hidden: [] };
}
export const saveToday = (t: Today) => write(DAY_KEY, t);

export const loadDisplay = (): Display => {
  const v = storageGet("dishdeck.dining.view");
  return v === "deck" || v === "map" ? v : "list";
};
export const saveDisplay = (d: Display) => storageSet("dishdeck.dining.view", d);

export const loadLocation = () => read<(SavedLocation & { gps?: boolean }) | null>("dishdeck.dining.location", null);
export const saveLocation = (l: SavedLocation & { gps?: boolean }) => write("dishdeck.dining.location", l);

export const loadRecents = () => read<SavedLocation[]>("dishdeck.dining.recents", []);
export function addRecent(l: SavedLocation) {
  const list = [l, ...loadRecents().filter((r) => r.label !== l.label)].slice(0, 5);
  write("dishdeck.dining.recents", list);
  return list;
}

export interface Spots {
  home?: SavedLocation;
  work?: SavedLocation;
}
export const loadSpots = () => read<Spots>("dishdeck.dining.spots", {});
export const saveSpots = (s: Spots) => write("dishdeck.dining.spots", s);

export const DEFAULT_FILTERS: DiningFilters = { prices: [], cuisines: [], chain: "any", openAtTime: true, service: [], features: [] };
export const loadFilters = () => ({ ...DEFAULT_FILTERS, ...read<Partial<DiningFilters>>("dishdeck.dining.filters", {}) });
export const saveFilters = (f: DiningFilters) => write("dishdeck.dining.filters", f);
export const loadSort = (): DiningSort => (storageGet("dishdeck.dining.sort") as DiningSort | null) ?? "best";
export const saveSort = (s: DiningSort) => storageSet("dishdeck.dining.sort", s);

export function countFilters(f: DiningFilters, defaultOpen = true): number {
  return (
    (f.minRating ? 1 : 0) +
    (f.prices.length ? 1 : 0) +
    (f.cuisines.length ? 1 : 0) +
    (f.chain !== "any" ? 1 : 0) +
    (f.openAtTime !== defaultOpen ? 1 : 0) +
    f.service.length +
    f.features.length
  );
}

export const distanceText = (miles: number) => `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;

export const priceText = (p?: number) => (p ? "$".repeat(p) : "");

/** "19:30" -> "7:30 PM" */
export function clockText(hhmm?: string): string {
  if (!hhmm) return "Now";
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}
