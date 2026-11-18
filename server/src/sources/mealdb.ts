// TheMealDB (free recipe database). Test key "1" is allowed for personal/development use.

import type { Card, MealType } from "../types.js";
import { mapLimit, normalize, shuffle } from "../util.js";

export interface MealDbMeal {
  idMeal: string;
  strMeal: string;
  strCategory?: string | null;
  strArea?: string | null;
  strInstructions?: string | null;
  strMealThumb?: string | null;
  strTags?: string | null;
  strSource?: string | null;
  [key: string]: string | null | undefined;
}

interface MealRef {
  id: string;
  meal?: MealDbMeal;
}

const NON_MEAL_CATEGORIES = new Set(["dessert", "breakfast", "side", "starter"]);

export class MealDb {
  private base: string;
  private mealCache = new Map<string, MealDbMeal>();
  private listCache = new Map<string, { at: number; value: string[] }>();

  constructor(apiKey = "1", private fetchImpl: typeof fetch = fetch, baseUrl = "https://www.themealdb.com") {
    this.base = `${baseUrl.replace(/\/+$/, "")}/api/json/v1/${apiKey}`;
  }

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/${path}`, { signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).message;
      throw new Error(`Couldn't reach TheMealDB (${cause})`);
    }
    if (!res.ok) throw new Error(`TheMealDB ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }

  private async cachedList(key: string, path: string, field: string): Promise<string[]> {
    const hit = this.listCache.get(key);
    if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.value;
    const data = await this.get<{ meals: Record<string, string>[] | null }>(path);
    const value = (data.meals ?? []).map((m) => m[field]!).filter(Boolean);
    this.listCache.set(key, { at: Date.now(), value });
    return value;
  }

  areas(): Promise<string[]> {
    return this.cachedList("areas", "list.php?a=list", "strArea");
  }

  categories(): Promise<string[]> {
    return this.cachedList("categories", "list.php?c=list", "strCategory");
  }

  private async filter(param: "a" | "c" | "i", value: string): Promise<MealRef[]> {
    const data = await this.get<{ meals: MealDbMeal[] | null | string }>(
      `filter.php?${param}=${encodeURIComponent(value.replace(/ /g, "_"))}`,
    );
    return Array.isArray(data.meals) ? data.meals.map((m) => ({ id: m.idMeal })) : [];
  }

  private async search(text: string): Promise<MealRef[]> {
    const data = await this.get<{ meals: MealDbMeal[] | null }>(`search.php?s=${encodeURIComponent(text)}`);
    return (data.meals ?? []).map((m) => {
      this.mealCache.set(m.idMeal, m);
      return { id: m.idMeal, meal: m };
    });
  }

  private async random(): Promise<MealRef | null> {
    const data = await this.get<{ meals: MealDbMeal[] | null }>("random.php");
    const m = data.meals?.[0];
    if (!m) return null;
    this.mealCache.set(m.idMeal, m);
    return { id: m.idMeal, meal: m };
  }

  async lookup(id: string): Promise<MealDbMeal | null> {
    const cached = this.mealCache.get(id);
    if (cached) return cached;
    const data = await this.get<{ meals: MealDbMeal[] | null }>(`lookup.php?i=${encodeURIComponent(id)}`);
    const m = data.meals?.[0] ?? null;
    if (m) this.mealCache.set(id, m);
    return m;
  }

  /**
   * Find candidate meals. Filters by cuisine/category when given; otherwise tries to read the
   * mood text as a cuisine, category, main ingredient or dish name; otherwise random meals.
   */
  async candidates(opts: {
    cuisine?: string;
    category?: string;
    /** Extra categories (any of them) used when no explicit category is chosen, e.g. for a meal or diet filter. */
    categories?: string[];
    mood?: string;
    want: number;
  }): Promise<{
    refs: MealRef[];
    note: string;
  }> {
    const { cuisine, mood, want } = opts;
    const cats = opts.category ? [opts.category] : (opts.categories ?? []);
    const category = cats.join(" / ") || undefined;

    if (cuisine || cats.length) {
      const [a, ...byCat] = await Promise.all([
        cuisine ? this.filter("a", cuisine) : null,
        ...cats.map((c) => this.filter("c", c)),
      ]);
      const c = byCat.length ? byCat.flatMap((l) => l ?? []) : null;
      let refs = a ?? c ?? [];
      if (a && c) {
        const ids = new Set(c.map((r) => r.id));
        refs = a.filter((r) => ids.has(r.id));
      }
      return { refs: shuffle(refs), note: [cuisine, category].filter(Boolean).join(" · ") };
    }

    if (mood?.trim()) {
      const text = normalize(mood);
      const [areas, allCats] = await Promise.all([this.areas(), this.categories()]);
      const area = areas.find((a) => text.includes(normalize(a)));
      const cat = allCats.find((c) => text.includes(normalize(c)));
      if (area || cat) return this.candidates({ cuisine: area, category: cat, categories: opts.categories, want });

      const byName = await this.search(mood.trim());
      if (byName.length) return { refs: shuffle(byName), note: `Matches for "${mood.trim()}"` };

      const words = text.split(" ").filter((w) => w.length > 2);
      for (const phrase of [words.join(" "), ...words]) {
        const byIngredient = await this.filter("i", phrase);
        if (byIngredient.length) return { refs: shuffle(byIngredient), note: `Dishes with ${phrase}` };
      }
      for (const w of words) {
        const r = await this.search(w);
        if (r.length) return { refs: shuffle(r), note: `Matches for "${w}"` };
      }
      return { refs: [], note: `No database matches for "${mood.trim()}"` };
    }

    const randoms = await mapLimit(Array.from({ length: want }), 4, () => this.random());
    const seen = new Set<string>();
    const refs = randoms.filter((r): r is MealRef => !!r && !seen.has(r.id) && !!seen.add(r.id));
    return { refs, note: "Random picks" };
  }
}

export function mealDbToCard(m: MealDbMeal): Card {
  const ingredients: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const ing = m[`strIngredient${i}`]?.trim();
    const measure = m[`strMeasure${i}`]?.trim();
    if (ing) ingredients.push([measure, ing].filter(Boolean).join(" "));
  }
  const instructions = (m.strInstructions ?? "")
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^step\s*\d+\.?$/i.test(s) && !/^\d+\.?$/.test(s));
  const category = m.strCategory ?? undefined;
  const cat = normalize(category ?? "");
  const suits: MealType[] | undefined = NON_MEAL_CATEGORIES.has(cat) ? [] : ["dinner"];
  const tags = (m.strTags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    key: `mealdb:${m.idMeal}`,
    source: "mealdb",
    title: m.strMeal,
    image: m.strMealThumb ?? undefined,
    cuisine: m.strArea && m.strArea !== "Unknown" ? m.strArea : undefined,
    category,
    tags,
    ingredients,
    instructions,
    sourceUrl: m.strSource || undefined,
    suits,
  };
}
