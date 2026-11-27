// Business logic: building decks, saving to Mealie, and planning the week.

import { createHmac } from "node:crypto";
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
import {
  DIET_IDS,
  GOAL_IDS,
  MEAL_IDS,
  dietLabel,
  fitsDiet,
  fitsGoals,
  fitsMeal,
  goalLabel,
  mealDbCategoriesForMeals,
  mealDbCategoryForDiet,
  mealLabel,
  parseNutrient,
  styleLabel,
} from "./filters.js";
import { classifyRecipe, planWeek, slotKey, type ExistingSlot } from "./planner.js";
import { nextRegions, type AiCard, type AiRecipes, type DishIdea } from "./sources/ai.js";
import { allSites, sitesFor } from "./sources/sites.js";
import { nameFromUrl, searchScore, webRecipeToCard, type RecipeSites, type WebRecipe } from "./sources/webrecipes.js";
import type { Store } from "./store.js";
import { mealDbToCard, type MealDb } from "./sources/mealdb.js";
import type {
  ApplyRequest,
  BookRecipe,
  BookResponse,
  Card,
  DeckRequest,
  DeckResponse,
  GenerateRequest,
  MealFilter,
  MealType,
  Nutrition,
  PlanDay,
  HistoryRequest,
  SaveRequest,
  SaveResponse,
  WeekResponse,
} from "./types.js";
import { addDays, mapLimit, normalize, parseMinutes, planDates, shuffle, slugify, toIsoDuration, withTimeout } from "./util.js";
import type { PhotoFinder, PhotoQuery } from "./sources/photos.js";

export interface Deps {
  config: Config;
  mealie: MealieClient;
  mealdb: MealDb;
  ai?: AiRecipes;
  /** Finds photos for AI ideas and for Mealie recipes that have none. */
  photos?: PhotoFinder;
  /** Persistent cache and household history. */
  store?: Store;
  /** Real recipes from trusted sites, and the sites per cuisine. */
  sites?: RecipeSites;
  siteMap?: Record<string, string[]>;
  /** Time limits (ms): matching dish names to pages, and a whole new-ideas deck. Tests shorten them. */
  limits?: { matchMs?: number; deckMs?: number };
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

  /** Proxied image URL. `v` changes when the photo does (busting the day-long cache); `sig` stands in for the passcode. */
  private imageUrl(id: string, version: string) {
    const params = new URLSearchParams({ v: version });
    if (this.config.appPasscode) params.set("sig", imageSig(this.config.appPasscode, id));
    return `/api/mealie-image/${id}?${params}`;
  }

  private async recipeLink(slug: string) {
    const user = await this.self().catch(() => undefined);
    return recipeUrl(this.config.mealiePublicUrl, user?.groupSlug, slug);
  }

  // ------------------------------------------------------------------ recipe book

  /** Every saved recipe as a card, with on-hand info and which filters it passes. */
  async book(): Promise<BookResponse> {
    const [details, onHand] = await Promise.all([this.recipeDetails(), this.onHandFoods().catch(() => undefined)]);
    const recipes = await mapLimit(details, 8, async (r): Promise<BookRecipe> => {
      const ingredients = (r.recipeIngredient ?? []).map(ingredientText).filter(Boolean);
      const card = await this.cardFromMealie(r, ingredients);
      if (onHand && ingredients.length) card.onHand = onHand.matcher.check(ingredients);
      return {
        ...card,
        fits: {
          diets: DIET_IDS.filter((d) => fitsDiet(ingredients, [d])),
          meals: MEAL_IDS.filter((m) => fitsMeal(card, [m])),
          goals: GOAL_IDS.filter((g) => fitsGoals(card, [g])),
        },
        rating: r.rating ?? undefined,
        // createdAt is a full timestamp; dateAdded is only the day, so it can't order same-day saves.
        addedAt: r.createdAt ?? r.dateAdded ?? undefined,
      };
    });
    return { recipes };
  }

  // ------------------------------------------------------------------ deck

  async deck(input: DeckRequest): Promise<DeckResponse> {
    const req = toDeckQuery(input);
    if (req.source === "saved") return this.savedDeck(req);
    // Never leave the phone spinning: answer within the limit. Slow lookups carry on in the background
    // and land in the cache, so trying again right after is quick.
    return withTimeout(this.newDeck(req), this.deps.limits?.deckMs ?? 55_000, () => {
      this.deps.warn?.("A new-ideas deck took too long; answered early");
      return { cards: [], note: "That took too long. Try again: what was found so far is saved, so the next try is quicker." };
    });
  }

  private async savedDeck(req: DeckQuery): Promise<DeckResponse> {
    const seen = new Set(req.exclude);
    const dietary = req.dietary ?? [];
    const goals = req.goals ?? [];
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
    note += filterSuffix(req);

    // Each group is any-of: a mood word, any chosen cuisine, any chosen type. Groups combine with AND.
    const groups = [moodWords, req.cuisines.map(normalize), req.categories.map(normalize)].filter((g) => g.length);
    const matches = (r: MealieRecipeSummary) => {
      if (!groups.length) return true;
      const hay = normalize([r.name, r.description, ...(r.tags ?? []).map((t) => t.name), ...(r.recipeCategory ?? []).map((c) => c.name)].join(" "));
      return groups.every((g) => g.some((w) => hay.includes(w)));
    };

    const pool = summaries.filter((s) => !seen.has(`mealie:${s.recipe.id}`) && matches(s.recipe));
    const strict = dietary.length > 0 || goals.length > 0 || req.meals.length > 0;
    // Dietary, meal and nutrition checks need the full recipe, so fetch in small batches until the deck is full.
    const limit = Math.min(pool.length, strict ? 40 : req.count);
    const cards: Card[] = [];
    for (let i = 0; i < limit && cards.length < req.count; i += 4) {
      const batch = await mapLimit(pool.slice(i, Math.min(i + 4, limit)), 4, async ({ recipe, missing }) => {
        const full = await this.mealie.getRecipe(recipe.slug);
        const ingredients = (full.recipeIngredient ?? []).map(ingredientText).filter(Boolean);
        return this.cardFromMealie(full, ingredients, missing);
      });
      cards.push(...batch.filter((c) => fitsDiet(c.ingredients, dietary) && fitsMeal(c, req.meals) && fitsGoals(c, goals)));
    }
    const out = cards.slice(0, req.count);
    return { cards: out, note: out.length ? note : `${note}: nothing matched` };
  }

  /** A looked-up photo as card fields ({} when there's none or no finder). */
  private async foundPhoto(q: PhotoQuery): Promise<Pick<Card, "image" | "imageCredit">> {
    const photo = await this.deps.photos?.find(q);
    return photo ? { image: photo.url, imageCredit: photo.credit } : {};
  }

  /**
   * Give AI ideas real photos and drop the ones without (a card has to show the dish). Without a photo
   * finder (tests, or lookups turned off) the cards pass through as they are.
   */
  private async withPhotos(cards: AiCard[]): Promise<Card[]> {
    const done = await mapLimit(cards, 4, async ({ photoHint, ...card }) => {
      if (!this.deps.photos) return card as Card;
      const found = await this.foundPhoto({ title: card.title, wikipediaTitle: photoHint.wikipediaTitle, search: photoHint.search });
      return found.image ? { ...card, ...found } : undefined;
    });
    const kept = done.filter((c): c is Card => !!c);
    if (kept.length < cards.length) this.deps.warn?.(`Dropped ${cards.length - kept.length} AI idea(s) with no photo`);
    return kept;
  }

  private async cardFromMealie(r: MealieRecipe, ingredients: string[], missing?: string[]): Promise<Card> {
    return {
      key: `mealie:${r.id}`,
      source: "mealie",
      title: r.name,
      description: r.description || undefined,
      ...(r.image ? { image: this.imageUrl(r.id, r.image) } : await this.foundPhoto({ title: r.name })),
      tags: (r.tags ?? []).map((t) => t.name),
      category: r.recipeCategory?.[0]?.name,
      totalMinutes: r.totalTimeSeconds ? Math.round(r.totalTimeSeconds / 60) : parseMinutes(r.totalTime),
      servings: r.recipeServings || undefined,
      ingredients,
      instructions: (r.recipeInstructions ?? []).map((s) => s.text ?? "").filter(Boolean),
      nutrition: mealieNutrition(r),
      onHand: missing ? { have: Math.max(ingredients.length - missing.length, 0), total: ingredients.length, missing } : undefined,
      mealie: { id: r.id, slug: r.slug, url: await this.recipeLink(r.slug) },
    };
  }

  /** Web recipe cards with a photo (their own, or a looked-up one); cards with neither are dropped. */
  private async pictured(cards: Card[]): Promise<Card[]> {
    const done = await mapLimit(cards, 4, async (c) => {
      if (c.image) return c;
      const found = await this.foundPhoto({ title: c.title });
      return found.image ? { ...c, ...found } : undefined;
    });
    return done.filter((c): c is Card => !!c);
  }

  /** Cache key for a dish-name list: everything that changes which dishes Claude would suggest. */
  private poolKey(req: DeckQuery): string {
    const sorted = (xs: string[] | undefined) => [...(xs ?? [])].map((x) => x.toLowerCase()).sort();
    return JSON.stringify({
      c: sorted(req.cuisines),
      t: sorted(req.categories),
      m: sorted(req.meals),
      d: sorted(req.dietary),
      s: req.style ?? "home",
      q: normalize(req.mood ?? ""),
    });
  }

  /**
   * Dishes Claude suggested for these filters, saved and dealt from over many decks. Claude is asked
   * again (for a fresh pair of regions) only when fewer than `need` dishes are left unused.
   */
  private async dishPool(req: DeckQuery, unused: (d: DishIdea) => boolean, need: number, book: MealieRecipeSummary[]): Promise<DishIdea[]> {
    const store = this.deps.store;
    const key = this.poolKey(req);
    const pool = store?.getPool<{ dishes: DishIdea[]; regions: string[]; dryUntil?: number }>(key, 180 * 86400_000) ?? {
      dishes: [],
      regions: [],
    };
    if (pool.dishes.filter(unused).length >= need || pool.dishes.length >= 200) return pool.dishes;
    // Claude recently had nothing new to add for these filters: don't pay to ask again for a while.
    if (pool.dryUntil && Date.now() < pool.dryUntil && pool.dishes.length) return pool.dishes;
    const regions = (req.style ?? "home") === "takeout" ? [] : nextRegions(req.cuisines, pool.regions);
    const more = await this.deps.ai!.dishNames({
      mood: req.mood?.trim() || undefined,
      cuisines: req.cuisines,
      categories: req.categories,
      dietary: req.dietary,
      meals: req.meals,
      style: req.style,
      regions,
      count: 25,
      leniency: req.leniency,
      avoid: [...pool.dishes.map((d) => d.name), ...book.map((r) => r.name)],
      bookSample: book.map((r) => r.name),
    });
    const known = new Set(pool.dishes.map((d) => normalize(d.name)));
    const added = more.filter((d) => !known.has(normalize(d.name)));
    const next = {
      dishes: [...pool.dishes, ...added],
      regions: [...pool.regions, ...regions],
      dryUntil: added.length < 3 ? Date.now() + 7 * 86400_000 : undefined,
    };
    store?.putPool(key, next);
    return next.dishes;
  }

  /**
   * Real recipes for Claude's dish names: each name is matched to a page on the cuisine's trusted
   * sites (cached), and the recipe is read from that page (cached). Dishes with no page get an
   * AI-written recipe (labelled as such) — this path only runs with AI on.
   */
  private async realRecipes(
    req: DeckQuery,
    ctx: { seen: Set<string>; book: MealieRecipeSummary[]; bookNames: Set<string> },
  ): Promise<{ cards: Card[] }> {
    const sites = this.deps.sites!;
    const store = this.deps.store;
    const siteMap = this.deps.siteMap ?? {};
    // A cuisine looks at that cuisine's sites (then the general ones for a typed search); a typed search
    // without a cuisine looks through every trusted site, general ones first.
    const domains = req.cuisines.length
      ? [...new Set([...sitesFor(siteMap, req.cuisines), ...(req.mood?.trim() ? sitesFor(siteMap, []) : [])])]
      : [...new Set([...sitesFor(siteMap, []), ...allSites(siteMap)])];
    const matchKey = (d: DishIdea) => `${normalize(d.name)}|${domains.join(",")}`;
    const used = (d: DishIdea) => {
      if (ctx.bookNames.has(normalize(d.name)) || ctx.seen.has(`ai:${slugify(d.name)}`)) return true;
      const url = store?.getMatch(matchKey(d), 90 * 86400_000, 30 * 86400_000);
      return !!url && ctx.seen.has(`web:${url}`);
    };
    const want = req.count;
    const started = Date.now();
    const matchMs = this.deps.limits?.matchMs ?? 15_000;
    // Ask Claude for more names only when the saved list can't fill this deck.
    const dishes = await this.dishPool(req, (d) => !used(d), want, ctx.book);
    const candidates = shuffle(dishes.filter((d) => !used(d))).slice(0, want * 3);

    const found: Card[] = [];
    const missing: DishIdea[] = [];
    // Two dish names can land on the same page ("Red-braised pork" and "Hong shao rou").
    const taken = new Set<string>();
    // Stop looking once the time budget is used up: show what's found, and the lookups already started
    // still finish and get cached for next time.
    for (let i = 0; i < candidates.length && found.length < want && Date.now() - started < matchMs; i += 4) {
      const batch = await mapLimit(candidates.slice(i, i + 4), 4, async (d) => {
        const key = matchKey(d);
        const cached = store?.getMatch(key, 90 * 86400_000, 30 * 86400_000);
        let recipe: WebRecipe | null | undefined;
        if (typeof cached === "string") recipe = await sites.read(cached);
        else if (cached === undefined) {
          recipe = (await sites.find(d.aliases, domains)) ?? null;
          store?.putMatch(key, recipe?.url ?? null);
        }
        return { d, recipe: recipe ?? undefined };
      });
      for (const { d, recipe } of batch) {
        if (!recipe) {
          missing.push(d);
          continue;
        }
        let card = webRecipeToCard(recipe, {
          region: d.region,
          nativeName: d.nativeName,
          cuisine: req.cuisines.length === 1 ? req.cuisines[0] : (d.cuisine ?? recipe.cuisine),
          suits: d.suits.length ? d.suits : undefined,
        });
        if (ctx.seen.has(card.key) || taken.has(card.key) || ctx.bookNames.has(normalize(card.title))) continue;
        if (!fitsDiet(card.ingredients, req.dietary ?? []) || !fitsMeal(card, req.meals)) continue;
        if (!card.image) {
          const photo = await this.foundPhoto({ title: card.title, wikipediaTitle: d.wikipediaTitle });
          if (!photo.image) continue;
          card = { ...card, ...photo };
        }
        taken.add(card.key);
        found.push(card);
      }
    }

    // No page for some dishes: have Claude write a few of those, clearly marked as AI recipes (only
    // while there's time left; writing recipes is the slowest step).
    if (found.length < want && missing.length && this.deps.ai && Date.now() - started < matchMs * 1.5) {
      const only = missing.slice(0, Math.min(4, want - found.length));
      try {
        const written = await withTimeout(this.deps.ai.generate({
          only,
          cuisines: req.cuisines,
          dietary: req.dietary,
          meals: req.meals,
          style: req.style,
          count: only.length,
          leniency: req.leniency,
          avoid: [],
          bookSample: [],
        }), 30_000, () => {
          this.deps.warn?.("AI recipes for unmatched dishes took too long; skipped this time");
          return [];
        });
        const ok = written.filter((c) => fitsDiet(c.ingredients, req.dietary ?? []) && !ctx.seen.has(c.key));
        found.push(...(await this.withPhotos(ok)));
      } catch (err) {
        this.deps.warn?.(`AI recipes for unmatched dishes failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { cards: found };
  }

  private async newDeck(req: DeckQuery): Promise<DeckResponse> {
    // This session's cards plus everything the household skipped or saved before (on any device).
    const seen = new Set([...req.exclude, ...(this.deps.store?.excludedKeys() ?? [])]);
    const book = await this.recipeSummaries().catch(() => [] as MealieRecipeSummary[]);
    const bookNames = new Set(book.map((r) => normalize(r.name)));
    const onHand = req.onHand ? await this.onHandFoods() : undefined;
    const dietary = req.dietary ?? [];
    const goals = req.goals ?? [];
    const mood = req.mood?.trim();
    const aiAllowed = !!this.deps.ai && req.ai !== false;
    // AI handles a typed craving, a cuisine (TheMealDB's cuisine lists are short and lean on Western
    // takeout dishes) and nutrition goals (only AI can estimate nutrition). Plain browsing uses TheMealDB,
    // which is free; AI also steps in when TheMealDB has nothing for these filters.
    const aiFirst = aiAllowed && (!!mood || goals.length > 0 || req.cuisines.length > 0);

    /** Ask Claude; undefined if it fails or nothing it returns passes the filters. */
    const aiIdeas = async (): Promise<Card[] | undefined> => {
      try {
        const generated = await this.deps.ai!.generate({
          mood,
          cuisines: req.cuisines,
          categories: req.categories,
          dietary,
          meals: req.meals,
          goals,
          style: req.style,
          // A few extra, since ideas without a findable photo are dropped.
          count: Math.min(Math.max(req.count, 6) + 2, 12),
          onHand: onHand?.matcher.names,
          leniency: req.leniency,
          // AI ideas already dealt this session (their keys are slugs of the title) first, then saved recipes.
          avoid: [...req.exclude.filter((k) => k.startsWith("ai:")).map((k) => k.slice(3).replace(/-/g, " ")).reverse(), ...book.map((r) => r.name)],
          bookSample: book.map((r) => r.name),
        });
        if (!generated.length) throw new Error("AI returned no recipes");
        // Double-check the model's work: drop anything that breaks a restriction or misses a goal.
        const fit = generated.filter((c) => fitsDiet(c.ingredients, dietary) && fitsGoals(c, goals));
        if (!fit.length) throw new Error("none of the AI recipes met the filters");
        const pictured = await this.withPhotos(fit.filter((c) => !seen.has(c.key) && !bookNames.has(normalize(c.title))));
        if (!pictured.length) throw new Error("no photos found for the AI recipes");
        return pictured;
      } catch (err) {
        // Any Anthropic/API/parse failure: carry on without AI rather than failing the deal.
        this.deps.warn?.(`AI ideas failed: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
    };

    /** Drop repeats and saved dishes, then apply the on-hand check. */
    const finish = (list: Card[]): { cards: Card[]; suffix: string } => {
      let cards = list.filter((c) => !seen.has(c.key) && !bookNames.has(normalize(c.title)));
      let suffix = "";
      if (onHand) {
        for (const c of cards) c.onHand = onHand.matcher.check(c.ingredients);
        const fits = cards.filter((c) => (c.onHand?.missing.length ?? 0) <= req.leniency);
        // If nothing fits the leniency, still show the closest matches rather than an empty deck.
        cards = (fits.length ? fits : cards).sort((a, b) => a.onHand!.missing.length - b.onHand!.missing.length);
        if (!fits.length && cards.length) suffix = ` (nothing within ${req.leniency} missing; closest matches first)`;
      }
      return { cards, suffix };
    };
    const style = req.style && req.style !== "home" ? ` · ${styleLabel(req.style)}` : "";
    const aiNote = () =>
      (mood ? `AI ideas for "${mood}"` : "AI ideas") + (req.cuisines.length ? ` · ${req.cuisines.join(" or ")}` : "") + style + filterSuffix(req);

    // Real recipes from trusted sites: Claude only names the dishes (cached), the recipes come from the
    // sites. Nutrition goals still need AI-written recipes, since sites rarely list nutrition.
    if (aiFirst && !goals.length && this.deps.sites) {
      const real = await this.realRecipes(req, { seen, book, bookNames }).catch((err) => {
        this.deps.warn?.(`Real recipe lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      });
      if (real?.cards.length) {
        const done = finish(real.cards);
        if (done.cards.length) {
          const where = req.cuisines.length ? ` · ${req.cuisines.join(" or ")}` : mood ? ` for "${mood}"` : "";
          const shown = done.cards.slice(0, req.count);
          const written = shown.filter((c) => c.source === "ai").length;
          const note =
            written === shown.length
              ? `AI recipes${where} (no trusted site had these dishes)${style}${filterSuffix(req)}`
              : `Recipes from trusted sites${where}${style}${filterSuffix(req)}${written ? ` (${written} written by AI)` : ""}`;
          return { cards: done.cards.slice(0, req.count), note: note + done.suffix };
        }
      }
    }

    if (aiFirst) {
      const ai = await aiIdeas();
      if (ai) {
        const done = finish(ai);
        if (done.cards.length) return { cards: done.cards.slice(0, req.count), note: aiNote() + done.suffix };
      }
    }

    // Without AI, the trusted sites come first (free): a typed search looks through their indexes, a
    // cuisine browses that cuisine's sites, and plain browsing draws from every site. TheMealDB is the
    // backup. (Dish types like "Beef" or "Pasta" are TheMealDB categories, so those stay with TheMealDB.)
    // A typed search's site matches are ranked together with TheMealDB's below, best match first.
    let siteMatches: Card[] | undefined;
    if (!aiFirst && this.deps.sites && this.deps.siteMap && !req.categories.length) {
      const siteMap = this.deps.siteMap;
      const domains = req.cuisines.length ? sitesFor(siteMap, req.cuisines) : allSites(siteMap);
      const filter = { diets: dietary, meals: req.meals };
      const found = await (mood
        ? this.deps.sites.search(mood, domains, req.count * 2, seen, { ...filter, wait: req.cuisines.length > 0 })
        : // Plain browsing uses whichever sites are indexed already rather than waiting for the rest.
          this.deps.sites.random(domains, req.count * 2, seen, { ...filter, wait: req.cuisines.length > 0 })
      ).catch((err) => {
        this.deps.warn?.(`Trusted-site lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        return [] as WebRecipe[];
      });
      const cuisine = req.cuisines.length === 1 ? req.cuisines[0] : undefined;
      const cards = (await this.pictured(found.map((r) => webRecipeToCard(r, { cuisine })))).filter(
        (c) => fitsDiet(c.ingredients, dietary) && fitsMeal(c, req.meals),
      );
      if (mood) siteMatches = cards;
      const done = mood ? { cards: [] as Card[], suffix: "" } : finish(cards);
      if (done.cards.length) {
        const what = "Recipes from trusted sites";
        const where = req.cuisines.length ? ` · ${req.cuisines.join(" or ")}` : "";
        const goalsNote = goals.length ? " (nutrition goals need AI ideas, so they weren't applied)" : "";
        return { cards: done.cards.slice(0, req.count), note: `${what}${where}${filterSuffix({ ...req, goals: [] })}${goalsNote}${done.suffix}` };
      }
    }

    // TheMealDB.
    const strict = dietary.length > 0 || req.meals.length > 0;
    const want = Math.min(req.count * (req.onHand ? 3 : 2) * (strict ? 2 : 1), 48);
    const mealCats = mealDbCategoriesForMeals(req.meals);
    const dietCat = mealDbCategoryForDiet(dietary);
    let note = "";
    let mealDbCards: Card[] = [];
    try {
      const found = await this.deps.mealdb.candidates({
        cuisines: req.cuisines,
        categories: req.categories,
        fallbackCategories: mealCats.length ? mealCats : dietCat ? [dietCat] : [],
        mood: req.mood,
        want,
      });
      // Without repeats: a diet filter can also be the TheMealDB category it searched ("Vegetarian").
      note = [...new Set([found.note, ...filterSuffix({ ...req, goals: [] }).split(" · ")].map((x) => x.trim()).filter(Boolean))].join(" · ");
      if (goals.length) note += ` (nutrition goals need AI ideas, so they weren't applied)`;
      if (aiFirst) note = `Couldn't get AI ideas this time; showing TheMealDB results. ${note}`.trim();
      const refs = found.refs.filter((r) => !seen.has(`mealdb:${r.id}`)).slice(0, want);
      const meals = await mapLimit(refs, 4, async (r) => r.meal ?? (await this.deps.mealdb.lookup(r.id)));
      mealDbCards = meals
        .filter((m) => !!m)
        .map((m) => mealDbToCard(m!))
        .filter((c) => fitsDiet(c.ingredients, dietary) && fitsMeal(c, req.meals));
    } catch (err) {
      // TheMealDB is unreachable: fall through to AI when it's available, otherwise report the error.
      if (!aiAllowed || aiFirst) throw err;
      this.deps.warn?.(`TheMealDB failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // A typed search without AI: one list from both sources, ranked by how well each dish name matches
    // the search. Dishes that don't contain the search words are left out ("beef roll" shouldn't bring
    // up every beef dish), unless nothing matches at all.
    if (mood && siteMatches) {
      const ranked = [
        ...siteMatches.map((c, i) => ({ c, i, src: 0, s: Math.max(searchScore(mood, c.title), c.sourceUrl ? searchScore(mood, nameFromUrl(c.sourceUrl)) : 0) })),
        ...mealDbCards.map((c, i) => ({ c, i, src: 1, s: searchScore(mood, c.title) })),
      ]
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.src - b.src || a.i - b.i)
        .map((x) => x.c);
      const best = finish(ranked);
      if (best.cards.length) {
        const where = req.cuisines.length ? ` · ${req.cuisines.join(" or ")}` : "";
        return { cards: best.cards.slice(0, req.count), note: `Best matches for "${mood}"${where}${filterSuffix({ ...req, goals: [] })}${best.suffix}` };
      }
      if (mealDbCards.length) note = `No close matches for "${mood}". ${note}`;
    }

    const done = finish(mealDbCards);
    if (done.cards.length || !aiAllowed || aiFirst) return { cards: done.cards.slice(0, req.count), note: note + done.suffix };

    // TheMealDB came up empty (a small catalog, or it's down): let Claude fill the deck instead.
    const ai = await aiIdeas();
    const fallback = ai ? finish(ai) : undefined;
    if (fallback?.cards.length) {
      return {
        cards: fallback.cards.slice(0, req.count),
        note: `TheMealDB had nothing new for this, so here are AI ideas${filterSuffix(req)}${fallback.suffix}`,
      };
    }
    return { cards: [], note: note + done.suffix };
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
      const existing = book.find(
        (r) => normalize(r.name) === normalize(card.title) || (!!card.sourceUrl && r.orgURL === card.sourceUrl),
      );
      if (existing) {
        recipeId = existing.id;
        slug = existing.slug;
        alreadyInBook = true;
      } else {
        // Our own copy of the recipe (with the original page as its source link), so categories, tags and
        // the native name come along. For a web recipe, Mealie's own importer is the backup.
        try {
          slug = await this.mealie.createFromSchemaJson(JSON.stringify(toSchemaOrg(card)), card.sourceUrl);
        } catch (err) {
          if (card.source !== "web" || !card.sourceUrl) throw err;
          slug = await this.mealie.createFromUrl(card.sourceUrl);
        }
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

    this.deps.store?.record(card.key, req.target, card.title);
    return { slug, recipeUrl: await this.recipeLink(slug), planned, alreadyInBook };
  }

  /** Remember a skipped card for the whole household, so it isn't dealt again on any device. */
  history(req: HistoryRequest) {
    this.deps.store?.record(req.key, req.action, req.title);
    return { ok: true };
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
/** Signature that lets an <img> load a proxied Mealie image without the passcode header. */
export function imageSig(secret: string, id: string): string {
  return createHmac("sha256", secret).update(`mealie-image:${id}`).digest("base64url").slice(0, 32);
}

/** " · Dinner · Vegan · High protein" for the deck note, or "" when no extra filters are on. */
export function filterSuffix(req: Pick<DeckQuery, "meals" | "dietary" | "goals">): string {
  const parts = [
    ...(req.meals.length ? [req.meals.map(mealLabel).join(" or ")] : []),
    ...(req.dietary ?? []).map(dietLabel),
    ...((req.goals ?? []).length ? [(req.goals ?? []).map(goalLabel).join(" or ")] : []),
  ];
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

/** A deck request with the list filters filled in (old single-value fields merged in). */
export type DeckQuery = DeckRequest & { cuisines: string[]; categories: string[]; meals: MealFilter[] };

export function toDeckQuery(req: DeckRequest): DeckQuery {
  const list = <T>(many: T[] | undefined, one: T | undefined) => [...new Set([...(many ?? []), ...(one ? [one] : [])])];
  return {
    ...req,
    cuisines: list(req.cuisines, req.cuisine),
    categories: list(req.categories, req.category),
    meals: list(req.meals, req.meal),
  };
}

/** Mealie stores nutrition as free text ("350 kcal", "25 g"); pull out the numbers we filter on. */
export function mealieNutrition(r: MealieRecipe): Nutrition | undefined {
  const n = r.nutrition;
  if (!n) return undefined;
  const out: Nutrition = {
    calories: parseNutrient(n.calories),
    protein: parseNutrient(n.proteinContent),
    carbs: parseNutrient(n.carbohydrateContent),
    fat: parseNutrient(n.fatContent),
    fiber: parseNutrient(n.fiberContent),
  };
  for (const k of Object.keys(out) as (keyof Nutrition)[]) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

export function toSchemaOrg(card: Card): Record<string, unknown> {
  const keywords = [...card.tags, card.cuisine, card.region, "new to try"].filter(Boolean);
  // An explicit empty "suits" means not a lunch/dinner dish (e.g. dessert): keep its own category.
  const categories =
    card.suits && card.suits.length === 0
      ? [card.category ?? "Other"]
      : (card.suits?.length ? card.suits : ["dinner"]).map((s) => (s === "lunch" ? "Lunch" : "Dinner"));
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: card.title,
    // Keep the native name with the recipe in Mealie, e.g. "鱼香茄子 · Sichuan. Silky eggplant in…".
    description: [[card.nativeName, card.region].filter(Boolean).join(" · "), card.description].filter(Boolean).join(". "),
    image: card.image ? [card.image] : undefined,
    recipeYield: card.servings ? `${card.servings} servings` : undefined,
    totalTime: toIsoDuration(card.totalMinutes),
    recipeCuisine: card.cuisine,
    recipeCategory: categories,
    keywords: keywords.join(", "),
    recipeIngredient: card.ingredients,
    recipeInstructions: card.instructions.map((text) => ({ "@type": "HowToStep", text })),
    nutrition: card.nutrition
      ? {
          "@type": "NutritionInformation",
          calories: card.nutrition.calories !== undefined ? `${card.nutrition.calories} kcal` : undefined,
          proteinContent: card.nutrition.protein !== undefined ? `${card.nutrition.protein} g` : undefined,
          carbohydrateContent: card.nutrition.carbs !== undefined ? `${card.nutrition.carbs} g` : undefined,
          fatContent: card.nutrition.fat !== undefined ? `${card.nutrition.fat} g` : undefined,
          fiberContent: card.nutrition.fiber !== undefined ? `${card.nutrition.fiber} g` : undefined,
        }
      : undefined,
    url: card.sourceUrl,
  };
}
