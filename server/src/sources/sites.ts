// Trusted recipe sites, by cuisine. Dish Deck indexes their sitemaps and reads recipes straight from
// their pages. Add your own with RECIPE_SITES (see example.env); they're tried before these defaults.

export const DEFAULT_SITES: Record<string, string[]> = {
  Chinese: ["thewoksoflife.com", "redhousespice.com", "omnivorescookbook.com", "chinasichuanfood.com", "madewithlau.com"],
  Japanese: ["justonecookbook.com", "chopstickchronicles.com", "japan.recipetineats.com"],
  Korean: ["maangchi.com", "koreanbapsang.com", "mykoreankitchen.com"],
  Thai: ["hot-thai-kitchen.com", "shesimmers.com"],
  Vietnamese: ["hungryhuy.com", "runawayrice.com", "vickypham.com"],
  Indian: ["indianhealthyrecipes.com", "vegrecipesofindia.com", "ministryofcurry.com"],
  Mexican: ["mexicoinmykitchen.com", "patijinich.com", "isabeleats.com"],
  Italian: ["recipesfromitaly.com", "insidetherustickitchen.com", "memoriediangelina.com"],
  Greek: ["mygreekdish.com", "dimitrasdishes.com"],
  Spanish: ["spainonafork.com"],
  Turkish: ["ozlemsturkishtable.com", "give-recipe.com"],
  Moroccan: ["tasteofmaroc.com"],
  Filipino: ["kawalingpinoy.com", "panlasangpinoy.com"],
  Malaysian: ["rasamalaysia.com"],
  "Middle Eastern": ["maureenabood.com", "themediterraneandish.com"],
  // Used for typed searches and for cuisines without their own list.
  General: ["seriouseats.com", "simplyrecipes.com"],
};

/**
 * Merge RECIPE_SITES ("Chinese: a.com, b.com; Korean: c.com") into the defaults. Listed sites come
 * first (they win ties when matching). A cuisine name that isn't in the defaults is added.
 */
export function siteList(extra: string | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = Object.fromEntries(Object.entries(DEFAULT_SITES).map(([k, v]) => [k, [...v]]));
  for (const part of (extra ?? "").split(";")) {
    // Split at the first colon only: the sites may be full addresses ("https://...").
    const m = /^\s*([^:]+?)\s*:\s*(.+)$/.exec(part);
    const rawCuisine = m?.[1];
    const rawSites = m?.[2];
    if (!rawCuisine?.trim() || !rawSites) continue;
    const cuisine = Object.keys(out).find((c) => c.toLowerCase() === rawCuisine.trim().toLowerCase()) ?? rawCuisine.trim();
    const sites = rawSites.split(",").map(cleanDomain).filter((s): s is string => !!s);
    out[cuisine] = [...new Set([...sites, ...(out[cuisine] ?? [])])];
  }
  return out;
}

/** "https://www.Example.com/recipes" -> "example.com". */
export function cleanDomain(s: string): string | undefined {
  const t = s.trim().toLowerCase();
  if (!t) return undefined;
  try {
    return new URL(t.includes("://") ? t : `https://${t}`).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Sites for these cuisines (in order), or the general list when none are given or none have sites. */
export function sitesFor(all: Record<string, string[]>, cuisines: string[]): string[] {
  const picked = cuisines.flatMap((c) => all[Object.keys(all).find((k) => k.toLowerCase() === c.toLowerCase()) ?? ""] ?? []);
  return [...new Set(picked.length ? picked : (all.General ?? []))];
}

/** Every site, once. */
export const allSites = (all: Record<string, string[]>) => [...new Set(Object.values(all).flat())];

/** Display name for a domain, e.g. "thewoksoflife.com" -> "The Woks of Life". */
const NAMES: Record<string, string> = {
  "thewoksoflife.com": "The Woks of Life",
  "redhousespice.com": "Red House Spice",
  "omnivorescookbook.com": "Omnivore's Cookbook",
  "chinasichuanfood.com": "China Sichuan Food",
  "madewithlau.com": "Made With Lau",
  "justonecookbook.com": "Just One Cookbook",
  "chopstickchronicles.com": "Chopstick Chronicles",
  "japan.recipetineats.com": "RecipeTin Japan",
  "maangchi.com": "Maangchi",
  "koreanbapsang.com": "Korean Bapsang",
  "mykoreankitchen.com": "My Korean Kitchen",
  "hot-thai-kitchen.com": "Hot Thai Kitchen",
  "shesimmers.com": "SheSimmers",
  "hungryhuy.com": "Hungry Huy",
  "runawayrice.com": "Runaway Rice",
  "vickypham.com": "Vicky Pham",
  "indianhealthyrecipes.com": "Swasthi's Recipes",
  "vegrecipesofindia.com": "Dassana's Veg Recipes",
  "ministryofcurry.com": "Ministry of Curry",
  "mexicoinmykitchen.com": "Mexico in My Kitchen",
  "patijinich.com": "Pati Jinich",
  "isabeleats.com": "Isabel Eats",
  "recipesfromitaly.com": "Recipes from Italy",
  "insidetherustickitchen.com": "Inside the Rustic Kitchen",
  "memoriediangelina.com": "Memorie di Angelina",
  "mygreekdish.com": "My Greek Dish",
  "dimitrasdishes.com": "Dimitra's Dishes",
  "spainonafork.com": "Spain on a Fork",
  "ozlemsturkishtable.com": "Ozlem's Turkish Table",
  "give-recipe.com": "Give Recipe",
  "tasteofmaroc.com": "Taste of Maroc",
  "kawalingpinoy.com": "Kawaling Pinoy",
  "panlasangpinoy.com": "Panlasang Pinoy",
  "rasamalaysia.com": "Rasa Malaysia",
  "maureenabood.com": "Maureen Abood",
  "themediterraneandish.com": "The Mediterranean Dish",
  "seriouseats.com": "Serious Eats",
  "simplyrecipes.com": "Simply Recipes",
};

export function siteName(domain: string): string {
  const d = domain.replace(/^www\./, "");
  if (NAMES[d]) return NAMES[d];
  // "mysite.co.uk" -> "Mysite"
  const base = d.split(".")[0] ?? d;
  return base.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
