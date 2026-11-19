// Thin client for the parts of Mealie's API this app uses (checked against Mealie v3.31.0).

export interface MealieTag { id?: string; name: string; slug?: string }

export interface MealieRecipeSummary {
  id: string;
  slug: string;
  name: string;
  image?: string | null;
  description?: string | null;
  recipeServings?: number;
  recipeYieldQuantity?: number;
  recipeYield?: string | null;
  totalTime?: string | null;
  totalTimeSeconds?: number | null;
  recipeCategory?: MealieTag[];
  tags?: MealieTag[];
  rating?: number | null;
  orgURL?: string | null;
  dateUpdated?: string | null;
  updatedAt?: string | null;
  dateAdded?: string | null;
  createdAt?: string | null;
}

export interface MealieIngredient {
  title?: string | null;
  note?: string | null;
  display?: string | null;
  originalText?: string | null;
  quantity?: number | null;
  unit?: { name: string } | null;
  food?: { id: string; name: string } | null;
}

export interface MealieRecipe extends MealieRecipeSummary {
  recipeIngredient?: MealieIngredient[];
  recipeInstructions?: { text?: string | null; title?: string | null }[];
  /** Per-serving nutrition as free text, e.g. { calories: "350", proteinContent: "25 g" }. */
  nutrition?: {
    calories?: string | null;
    proteinContent?: string | null;
    carbohydrateContent?: string | null;
    fatContent?: string | null;
    fiberContent?: string | null;
  } | null;
}

export interface MealieFood {
  id: string;
  name: string;
  pluralName?: string | null;
  aliases?: { name: string }[];
  householdsWithIngredientFood?: string[];
}

export interface MealieUser {
  id: string;
  groupSlug: string;
  householdSlug: string;
}

export interface MealiePlanEntry {
  id: number;
  date: string;
  entryType: string;
  title?: string;
  text?: string;
  recipeId?: string | null;
  recipe?: MealieRecipeSummary | null;
}

export interface MealieSuggestionItem {
  recipe: MealieRecipeSummary;
  missingFoods: { id: string; name: string }[];
}

export class MealieError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

export class MealieClient {
  constructor(private baseUrl: string, private token: string, private fetchImpl: typeof fetch = fetch) {}

  private async req<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(`/api${path}`, this.baseUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else url.searchParams.set(k, String(v));
    }
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.detail?.message ?? parsed?.detail ?? detail;
        if (typeof detail !== "string") detail = JSON.stringify(detail);
      } catch {
        /* keep raw text */
      }
      throw new MealieError(res.status, `Mealie ${method} ${path} failed (${res.status}): ${detail}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  self(): Promise<MealieUser> {
    return this.req<MealieUser>("GET", "/users/self");
  }

  async listRecipes(): Promise<MealieRecipeSummary[]> {
    const res = await this.req<{ items: MealieRecipeSummary[] }>("GET", "/recipes", {
      query: { page: 1, perPage: -1, orderBy: "name", orderDirection: "asc" },
    });
    return res.items;
  }

  async randomRecipes(count: number, search?: string): Promise<MealieRecipeSummary[]> {
    const res = await this.req<{ items: MealieRecipeSummary[] }>("GET", "/recipes", {
      query: {
        page: 1,
        perPage: count,
        orderBy: "random",
        paginationSeed: String(Date.now()),
        search: search || undefined,
      },
    });
    return res.items;
  }

  getRecipe(slugOrId: string): Promise<MealieRecipe> {
    return this.req<MealieRecipe>("GET", `/recipes/${encodeURIComponent(slugOrId)}`);
  }

  /** Mealie's recipe finder. It only filters by ingredients when `foods` is non-empty. */
  async suggestions(opts: { foods: string[]; maxMissingFoods: number; limit: number }): Promise<MealieSuggestionItem[]> {
    const res = await this.req<{ items: MealieSuggestionItem[] }>("GET", "/recipes/suggestions", {
      query: {
        foods: opts.foods,
        limit: opts.limit,
        maxMissingFoods: opts.maxMissingFoods,
        maxMissingTools: 20,
        includeFoodsOnHand: true,
        includeToolsOnHand: true,
        orderBy: "random",
        paginationSeed: String(Date.now()),
      },
    });
    return res.items;
  }

  async foods(): Promise<MealieFood[]> {
    const res = await this.req<{ items: MealieFood[] }>("GET", "/foods", { query: { page: 1, perPage: -1 } });
    return res.items;
  }

  /** Create a recipe from a schema.org Recipe JSON string. Returns the new slug. */
  createFromSchemaJson(json: string, url?: string): Promise<string> {
    return this.req<string>("POST", "/recipes/create/html-or-json", {
      body: { data: json, url: url ?? null, includeTags: true, includeCategories: true },
    });
  }

  /** Import a recipe from a web page with Mealie's own scraper; returns the new slug. */
  async createFromUrl(url: string): Promise<string> {
    const res = await this.req<string>("POST", "/recipes/create/url", { body: { url, includeTags: false } });
    return String(res).replace(/^"|"$/g, "");
  }

  /** Run Mealie's scraper on a page without saving anything (for pages without schema.org data). */
  async testScrape(url: string): Promise<unknown> {
    return this.req<unknown>("POST", "/recipes/test-scrape-url", { body: { url } });
  }

  async setImageFromUrl(slug: string, imageUrl: string): Promise<void> {
    await this.req("POST", `/recipes/${encodeURIComponent(slug)}/image`, { body: { url: imageUrl } });
  }

  async mealplans(startDate: string, endDate: string): Promise<MealiePlanEntry[]> {
    const res = await this.req<{ items: MealiePlanEntry[] }>("GET", "/households/mealplans", {
      query: { start_date: startDate, end_date: endDate, page: 1, perPage: -1 },
    });
    return res.items;
  }

  createMealplan(entry: { date: string; entryType: string; recipeId?: string; title?: string; text?: string }) {
    return this.req<MealiePlanEntry>("POST", "/households/mealplans", {
      body: {
        date: entry.date,
        entryType: entry.entryType,
        recipeId: entry.recipeId ?? null,
        title: entry.title ?? "",
        text: entry.text ?? "",
      },
    });
  }

  async deleteMealplan(id: number): Promise<void> {
    await this.req("DELETE", `/households/mealplans/${id}`);
  }
}

export function recipeUrl(publicUrl: string | undefined, groupSlug: string | undefined, slug: string) {
  if (!publicUrl || !groupSlug) return undefined;
  return `${publicUrl}/g/${groupSlug}/r/${slug}`;
}

export function ingredientText(ing: MealieIngredient): string {
  return (ing.display || ing.originalText || [ing.food?.name, ing.note].filter(Boolean).join(" ") || "").trim();
}
