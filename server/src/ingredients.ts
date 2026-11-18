// Ingredient helpers: on-hand matching for free-text ingredient lines, and protein detection.

import { canonical, containsPhrase, normalize, singular } from "./util.js";

const UNITS = new Set([
  "cup", "c", "tbsp", "tablespoon", "tbs", "tsp", "teaspoon", "oz", "ounce", "lb", "pound",
  "g", "gram", "kg", "ml", "l", "liter", "litre", "pinch", "dash", "clove", "can", "jar", "package",
  "pkg", "bag", "bunch", "handful", "slice", "piece", "stick", "sprig", "head", "sheet", "fillet", "large", "medium",
  "small", "whole", "fresh", "chopped", "minced", "diced", "sliced", "ground", "to", "taste", "of",
  "a", "an", "and", "or", "optional", "finely", "roughly", "about", "x", "freshly", "kosher",
  "coarse", "packed", "softened", "melted", "extra", "virgin", "unsalted",
]);

/** Strip quantities and units: "2 cups chopped onion" -> "onion". */
export function coreIngredient(line: string): string {
  const words = normalize(line.replace(/\(.*?\)/g, " ")).split(" ");
  const kept = words.filter((w) => w && !/^\d/.test(w) && !UNITS.has(w) && !UNITS.has(singular(w)));
  return kept.join(" ").trim() || normalize(line);
}

export interface OnHandFood {
  name: string;
  pluralName?: string | null;
  aliases?: { name: string }[];
}

export interface OnHandMatcher {
  /** Number of on-hand foods known. */
  size: number;
  /** Display names of on-hand foods. */
  names: string[];
  check(ingredients: string[]): { have: number; total: number; missing: string[] };
}

export function buildOnHandMatcher(foods: OnHandFood[], staples: string[]): OnHandMatcher {
  const phrases = new Set<string>();
  for (const f of foods) {
    for (const n of [f.name, f.pluralName, ...(f.aliases ?? []).map((a) => a.name)]) {
      if (n) phrases.add(canonical(n));
    }
  }
  const stapleSet = staples.map(canonical);
  // Longest phrases first so "chicken breast" wins over "chicken".
  const ordered = [...phrases].filter(Boolean).sort((a, b) => b.length - a.length);

  return {
    size: foods.length,
    names: foods.map((f) => f.name),
    check(ingredients) {
      let have = 0;
      let total = 0;
      const missing: string[] = [];
      for (const line of ingredients) {
        const text = canonical(line);
        if (!text) continue;
        if (stapleSet.includes(canonical(coreIngredient(line)))) continue;
        total++;
        if (ordered.some((p) => containsPhrase(text, p))) have++;
        else missing.push(coreIngredient(line));
      }
      return { have, total, missing };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Protein detection

const PROTEINS: [string, string[]][] = [
  ["seafood", ["shrimp", "prawn", "scallop", "crab", "lobster", "clam", "mussel", "squid", "calamari"]],
  ["fish", ["salmon", "tuna", "cod", "tilapia", "halibut", "trout", "fish", "mahi", "catfish", "sardine", "anchovy", "haddock", "snapper", "sea bass"]],
  ["chicken", ["chicken"]],
  ["turkey", ["turkey"]],
  ["beef", ["beef", "steak", "brisket", "sirloin", "chuck", "ribeye", "short rib", "veal"]],
  ["pork", ["pork", "bacon", "ham", "sausage", "chorizo", "prosciutto", "pancetta", "carnitas"]],
  ["lamb", ["lamb", "mutton"]],
  ["plant", ["tofu", "tempeh", "lentil", "chickpea", "black bean", "kidney bean", "pinto bean", "seitan", "edamame"]],
  ["egg", ["egg"]],
];

// Ingredient lines that mention a protein but aren't the protein itself.
const NOT_PROTEIN = ["broth", "stock", "bouillon", "fat", "grease", "drippings", "sauce", "gravy", "seasoning", "flavor", "paste"];

/** Main protein of a dish from its name and ingredient lines; null if none found. */
export function detectProtein(name: string, ingredients: string[]): string | null {
  const counts = new Map<string, number>();
  const lines = [name, ...ingredients].map(canonical);
  lines.forEach((line, i) => {
    if (i > 0 && NOT_PROTEIN.some((w) => containsPhrase(line, w))) return;
    for (const [protein, words] of PROTEINS) {
      if (words.some((w) => containsPhrase(line, canonical(w)))) {
        // The dish name counts extra: "Chicken Tikka" is a chicken dish even if eggs are in it.
        counts.set(protein, (counts.get(protein) ?? 0) + (i === 0 ? 3 : 1));
        break;
      }
    }
  });
  // Eggs only count as the protein when nothing else is there.
  if (counts.size > 1) counts.delete("egg");
  let best: string | null = null;
  let bestCount = 0;
  for (const [protein] of PROTEINS) {
    const c = counts.get(protein) ?? 0;
    if (c > bestCount) {
      best = protein;
      bestCount = c;
    }
  }
  return best;
}

/** Which proteins are on hand, from Mealie's on-hand food names. */
export function onHandProteins(foodNames: string[]): Set<string> {
  const set = new Set<string>();
  for (const n of foodNames) {
    const p = detectProtein(n, []);
    if (p) set.add(p);
  }
  return set;
}
