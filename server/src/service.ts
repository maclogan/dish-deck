// Business logic: building decks, saving to Mealie, and planning the week.

import type { Config } from "./config.js";
import { buildOnHandMatcher, onHandProteins, type OnHandMatcher } from "./ingredients.js";
import {
  ingredientText,
  recipeUrl,
  type MealieClient,
  type MealieRecipe,
  type MealieRecipeSummary,
  type MealieUser,
} from "./mealie.js";
import { classifyRecipe, planWeek, slotKey, type ExistingSlot } from "./planner.js";
import type { AiRecipes } from "./sources/ai.js";
import { mealDbToCard, type MealDb } from "./sources/mealdb.js";
import type {
  ApplyRequest,
  Card,
  DeckRequest,
  DeckResponse,
  GenerateRequest,
  MealType,
  PlanDay,
  SaveRequest,
  SaveResponse,
  WeekResponse,
} from "./types.js";
import { addDays, mapLimit, normalize, parseMinutes, planDates, toIsoDuration } from "./util.js";

export interface Deps {
  config: Config;
  mealie: MealieClient;
  mealdb: MealDb;
  ai?: AiRecipes;
  now?: () => Date;
  /** Reports recoverable problems (e.g. an AI failure we fell back from). */
  warn?: (message: string) => void;
}

export class Service {
  private user?: MealieUser;
  private summaries?: { at: number; items: MealieRecipeSummary[] };
  private details = new Map<string, { stamp: string; recipe: MealieRecipe }>();
  private onHand?: { at: number; matcher: OnHandMatcher; ids: string[] };

  constructor(private deps: Deps) {}

  private get config() {
    return this.deps.config;
  }
  private get mealie() {
    return this.deps.mealie;
  }
  private now() {
    return this.deps.now?.() ?? new Date();
  }

  // ------------------------------------------------------------------ caches

  async self(): Promise<MealieUser> {
    this.user ??= await this.mealie.self();
    return this.user;
  }

  async recipeSummaries(force = false): Promise<MealieRecipeSummary[]> {
    if (!force && this.summaries && Date.now() - this.summaries.at < 120_000) return this.summaries.items;
    const items = await this.mealie.listRecipes();
    this.summaries = { at: Date.now(), items };
    return items;
  }

  invalidateRecipes() {
    this.summaries = undefined;
  }

  /** Full recipe details for every saved recipe, refetching only ones that changed. */
  async recipeDetails(): Promise<MealieRecipe[]> {
    const summaries = await this.recipeSummaries();
    return mapLimit(summaries, 6, async (s) => {
      const stamp = s.dateUpdated ?? s.updatedAt ?? "";
      const hit = this.details.get(s.id);
      if (hit && hit.stamp === stamp) return hit.recipe;
      const recipe = await this.mealie.getRecipe(s.slug);
      this.details.set(s.id, { stamp, recipe });
      return recipe;
    });
  }

  async onHandFoods(): Promise<{ matcher: OnHandMatcher; ids: string[] }> {
    if (this.onHand && Date.now() - this.onHand.at < 120_000) return this.onHand;
    const [user, foods] = await Promise.all([this.self(), this.mealie.foods()]);
    const mine = foods.filter((f) => (f.householdsWithIngredientFood ?? []).includes(user.householdSlug));
    this.onHand = {
      at: Date.now(),
      matcher: buildOnHandMatcher(mine, this.config.staples),
      ids: mine.map((f) => f.id),
    };
    return this.onHand;
  }

  private async recipeLink(slug: string) {
    const user = await this.self().catch(() => undefined);
    return recipeUrl(this.config.mealiePublicUrl, user?.groupSlug, slug);
  }

  // ------------------------------------------------------------------ deck

  async deck(req: DeckRequest): Promise<DeckResponse> {
    return req.source === "saved" ? this.savedDeck(req) : this.newDeck(req);
  }

  private async savedDeck(req: DeckRequest): Promise<DeckResponse> {
    const seen = new Set(req.exclude);
    const moodWords = normalize(req.mood ?? "").split(" ").filter((w) => w.length > 2);
    let summaries: { recipe: MealieRecipeSummary; missing?: string[] }[];
    let note: string;

    if (req.onHand) {
      const { ids } = await this.onHandFoods();
      if (ids.length === 0) {
        return { cards: [], note: "No foods are marked on hand in Mealie yet." };
      }
      const items = await this.mealie.suggestions({ foods: ids, maxMissingFoods: req.leniency, limit: 60 });
      summaries = items.map((i) => ({ recipe: i.recipe, missing: i.missingFoods.map((f) => f.name) }));
      note = `Our recipes using what's on hand (up to ${req.leniency} missing)`;
    } else {
      const items = await this.mealie.randomRecipes(60);
      summaries = items.map((recipe) => ({ recipe }));
      note = "From our recipe book";
    }

    const matches = (r: MealieRecipeSummary) => {
      if (!moodWords.length && !req.cuisine && !req.category) return true;
      const hay = normalize([r.name, r.description, ...(r.tags ?? []).map((t) => t.name), ...(r.recipeCategory ?? []).map((c) => c.name)].join(" "));
      const wanted = [...moodWords, ...[req.cuisine, req.category].filter(Boolean).map((s) => normalize(s!))];
      return wanted.some((w) => hay.includes(w));
    };

    const picked = summaries.filter((s) => !seen.has(`mealie:${s.recipe.id}`) && matches(s.recipe)).slice(0, req.count);
    const cards = await mapLimit(picked, 4, async ({ recipe, missing }) => {
      const full = await this.mealie.getRecipe(recipe.slug);
      const ingredients = (full.recipeIngredient ?? []).map(ingredientText).filter(Boolean);
      return this.cardFromMealie(full, ingredients, missing);
    });
    return { cards, note: cards.length ? note : `${note}: nothing matched` };
  }

  private async cardFromMealie(r: MealieRecipe, ingredients: string[], missing?: string[]): Promise<Card> {
    return {
      key: `mealie:${r.id}`,
      source: "mealie",
      title: r.name,
      description: r.description || undefined,
      image: r.image ? `/api/mealie-image/${r.id}` : undefined,
      tags: (r.tags ?? []).map((t) => t.name),
      category: r.recipeCategory?.[0]?.name,
      totalMinutes: r.totalTimeSeconds ? Math.round(r.totalTimeSeconds / 60) : parseMinutes(r.totalTime),
      servings: r.recipeServings || undefined,
      ingredients,
      instructions: (r.recipeInstructions ?? []).map((s) => s.text ?? "").filter(Boolean),
      onHand: missing ? { have: Math.max(ingredients.length - missing.length, 0), total: ingredients.length, missing } : undefined,
      mealie: { id: r.id, slug: r.slug, url: await this.recipeLink(r.slug) },
    };
  }

  private async newDeck(req: DeckRequest): Promise<DeckResponse> {
    const seen = new Set(req.exclude);
    const book = await this.recipeSummaries().catch(() => [] as MealieRecipeSummary[]);
    const bookNames = new Set(book.map((r) => normalize(r.name)));
    const onHand = req.onHand ? await this.onHandFoods() : undefined;
    const useAi = !!this.deps.ai && req.ai !== false && !!req.mood?.trim();

    let cards: Card[] | undefined;
    let note = "";
    let aiFailed = false;

    if (useAi) {
      try {
        const generated = await this.deps.ai!.generate({
          mood: req.mood?.trim(),
          cuisine: req.cuisine,
          category: req.category,
          count: Math.max(req.count, 6),
          onHand: onHand?.matcher.names,
          leniency: req.leniency,
          avoid: [...book.map((r) => r.name)],
          bookSample: book.map((r) => r.name),
        });
        if (!generated.length) throw new Error("AI returned no recipes");
        cards = generated;
        note = `AI ideas for "${req.mood!.trim()}"`;
      } catch (err) {
        // Any Anthropic/API/parse failure: fall back to TheMealDB rather than failing the deal.
        aiFailed = true;
        this.deps.warn?.(`AI ideas failed, falling back to TheMealDB: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!cards) {
      const want = req.onHand ? req.count * 3 : req.count * 2;
      const found = await this.deps.mealdb.candidates({
        cuisine: req.cuisine,
        category: req.category,
        mood: req.mood,
        want,
      });
      note = aiFailed ? `AI ideas aren't available right now; showing TheMealDB results. ${found.note}`.trim() : found.note;
      const refs = found.refs.filter((r) => !seen.has(`mealdb:${r.id}`)).slice(0, want);
      const meals = await mapLimit(refs, 4, async (r) => r.meal ?? (await this.deps.mealdb.lookup(r.id)));
      cards = meals.filter((m) => !!m).map((m) => mealDbToCard(m!));
    }

    cards = cards.filter((c) => !seen.has(c.key) && !bookNames.has(normalize(c.title)));

    if (onHand) {
      for (const c of cards) c.onHand = onHand.matcher.check(c.ingredients);
      const fits = cards.filter((c) => (c.onHand?.missing.length ?? 0) <= req.leniency);
      // If nothing fits the leniency, still show the closest matches rather than an empty deck.
      cards = (fits.length ? fits : cards).sort((a, b) => (a.onHand!.missing.length - b.onHand!.missing.length));
      if (!fits.length && cards.length) note += ` (nothing within ${req.leniency} missing; closest matches first)`;
    }

    return { cards: cards.slice(0, req.count), note };
  }

  // ------------------------------------------------------------------ save

  async save(req: SaveRequest): Promise<SaveResponse> {
    const { card } = req;
    let recipeId: string;
    let slug: string;
    let alreadyInBook = false;

    if (card.source === "mealie" && card.mealie) {
      recipeId = card.mealie.id;
      slug = card.mealie.slug;
      alreadyInBook = true;
    } else {
      const book = await this.recipeSummaries(true);
      const existing = book.find((r) => normalize(r.name) === normalize(card.title));
      if (existing) {
        recipeId = existing.id;
        slug = existing.slug;
        alreadyInBook = true;
      } else {
        slug = await this.mealie.createFromSchemaJson(JSON.stringify(toSchemaOrg(card)), card.sourceUrl);
        const created = await this.mealie.getRecipe(slug);
        recipeId = created.id;
        if (card.image && !created.image) {
          await this.mealie.setImageFromUrl(slug, card.image).catch(() => undefined);
        }
        this.invalidateRecipes();
      }
    }

    let planned: SaveResponse["planned"];
    if (req.target === "plan" && req.plan) {
      await this.mealie.createMealplan({ date: req.plan.date, entryType: req.plan.entryType, recipeId });
      planned = req.plan;
    }

    return { slug, recipeUrl: await this.recipeLink(slug), planned, alreadyInBook };
  }

  // ------------------------------------------------------------------ week planning

  private dates() {
    return planDates(this.config.timezone, this.config.planStart, this.now());
  }

  private async existingSlots(dates: string[]) {
    const entries = await this.mealie.mealplans(dates[0]!, dates[dates.length - 1]!);
    const existing: Record<string, ExistingSlot> = {};
    for (const e of entries) {
      if (e.entryType !== "lunch" && e.entryType !== "dinner") continue;
      const key = slotKey(e.date, e.entryType);
      if (existing[key]) continue; // first entry wins for display
      existing[key] = { entryId: e.id, recipeId: e.recipeId ?? e.recipe?.id, title: e.recipe?.name ?? e.title ?? "" };
    }
    return { existing, entries };
  }

  async week(): Promise<WeekResponse> {
    const dates = this.dates();
    const { existing } = await this.existingSlots(dates);
    const days: PlanDay[] = dates.map((date) => {
      const slot = (type: MealType) => {
        const e = existing[slotKey(date, type)];
        return e
          ? { kind: "existing" as const, name: e.title || "Planned", recipeId: e.recipeId ?? undefined, entryId: e.entryId, reasons: [] }
          : { kind: "empty" as const, name: "Nothing planned", reasons: [] };
      };
      const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
      return { date, weekday: wd, busy: this.config.busyDays.includes(wd), lunch: slot("lunch"), dinner: slot("dinner") };
    });
    return { days };
  }

  async generate(req: GenerateRequest): Promise<WeekResponse> {
    const dates = this.dates();
    const [details, { existing }, history, onHand] = await Promise.all([
      this.recipeDetails(),
      this.existingSlots(dates),
      this.mealie.mealplans(addDays(dates[0]!, -21), addDays(dates[0]!, -1)),
      this.onHandFoods().catch(() => undefined),
    ]);
    const days = planWeek({
      dates,
      recipes: details.map(classifyRecipe),
      existing,
      history: history.map((h) => ({ date: h.date, entryType: h.entryType, recipeId: h.recipeId ?? h.recipe?.id })),
      onHandProteins: onHandProteins(onHand?.matcher.names ?? []),
      busyDays: this.config.busyDays,
      leftovers: this.config.leftovers,
      replaceExisting: req.replaceExisting,
      locked: req.locked,
    });
    return { days };
  }

  async apply(req: ApplyRequest): Promise<{ created: number; removed: number; skipped: number }> {
    const dates = req.days.map((d) => d.date);
    const { entries } = await this.existingSlots(dates);
    let created = 0;
    let removed = 0;
    let skipped = 0;

    for (const day of req.days) {
      for (const type of ["lunch", "dinner"] as const) {
        const p = day[type];
        if (p.kind !== "recipe" && p.kind !== "leftovers") continue;
        const inSlot = entries.filter((e) => e.date === day.date && e.entryType === type);
        if (req.replaceExisting) {
          for (const e of inSlot) {
            await this.mealie.deleteMealplan(e.id);
            removed++;
          }
        } else if (inSlot.length) {
          // Someone planned this slot after the preview was made; don't double-book it.
          skipped++;
          continue;
        }
        if (p.kind === "recipe" && p.recipeId) {
          await this.mealie.createMealplan({ date: day.date, entryType: type, recipeId: p.recipeId });
        } else {
          await this.mealie.createMealplan({ date: day.date, entryType: type, title: p.name, text: "Leftovers" });
        }
        created++;
      }
    }
    return { created, removed, skipped };
  }
}

/** Build a schema.org Recipe object for Mealie's JSON importer. */
export function toSchemaOrg(card: Card): Record<string, unknown> {
  const keywords = [...card.tags, card.cuisine, "new to try"].filter(Boolean);
  // An explicit empty "suits" means not a lunch/dinner dish (e.g. dessert): keep its own category.
  const categories =
    card.suits && card.suits.length === 0
      ? [card.category ?? "Other"]
      : (card.suits?.length ? card.suits : ["dinner"]).map((s) => (s === "lunch" ? "Lunch" : "Dinner"));
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: card.title,
    description: card.description ?? "",
    image: card.image ? [card.image] : undefined,
    recipeYield: card.servings ? `${card.servings} servings` : undefined,
    totalTime: toIsoDuration(card.totalMinutes),
    recipeCuisine: card.cuisine,
    recipeCategory: categories,
    keywords: keywords.join(", "),
    recipeIngredient: card.ingredients,
    recipeInstructions: card.instructions.map((text) => ({ "@type": "HowToStep", text })),
    url: card.sourceUrl,
  };
}
