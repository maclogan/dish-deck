// Chain or independent? Three cheap signals, no AI needed:
//  1. the name is a known restaurant/fast-food/café brand (OpenStreetMap's name-suggestion-index, see chains-data.ts),
//  2. the same name shows up more than once in one search (two branches nearby),
//  3. Google files it as a fast-food restaurant.

let brands: Map<string, string[]> | undefined;

/** Lowercase, no accents or apostrophes, "&" as "and", single spaces. */
export function normalizeBrand(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Panera Bread - Downtown (Main St)" -> "panera bread" */
export function baseName(name: string): string {
  return normalizeBrand(name.replace(/\([^)]*\)/g, " ").replace(/\s[-–—|@:]\s.*$/, ""));
}

async function loadBrands(): Promise<Map<string, string[]>> {
  if (brands) return brands;
  const { CHAIN_LINES } = await import("./chains-data.js");
  brands = parseBrandLines(CHAIN_LINES);
  return brands;
}

export function parseBrandLines(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const [name, countries] = line.split("|");
    if (name) map.set(name, (countries ?? "001").split(","));
  }
  return map;
}

/** True if the name is a known brand where this place is (country: ISO 3166 alpha-2, any case). */
export function isKnownBrand(map: Map<string, string[]>, name: string, country?: string): boolean {
  const base = baseName(name);
  if (!base) return false;
  const cc = country?.toLowerCase();
  const here = (countries: string[]) => !cc || countries.includes("001") || countries.includes(cc);
  const exact = map.get(base) ?? map.get(base.replace(/^the /, ""));
  if (exact) return here(exact);
  // "Chipotle Mexican Grill", "Subway Sandwiches": a brand followed by more words. Short one-word
  // brands are skipped here, since they also start plenty of independent places' names.
  const words = base.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    const prefix = words.slice(0, n).join(" ");
    const hit = map.get(prefix);
    if (hit && (n >= 2 || prefix.length >= 6)) return here(hit);
  }
  return false;
}

export interface ChainInput {
  id: string;
  name: string;
  types: string[];
  country?: string;
}

/** Which of these places are chains. */
export async function detectChains(places: ChainInput[], map?: Map<string, string[]>): Promise<Set<string>> {
  const known = map ?? (await loadBrands());
  const counts = new Map<string, number>();
  for (const p of places) {
    const b = baseName(p.name);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const p of places) {
    if (p.types.includes("fast_food_restaurant") || (counts.get(baseName(p.name)) ?? 0) > 1 || isKnownBrand(known, p.name, p.country)) {
      out.add(p.id);
    }
  }
  return out;
}
