import { describe, expect, it } from "vitest";
import { buildApp, rankCuisines } from "../src/app.js";
import type { Config } from "../src/config.js";
import { MealieClient, type MealiePlanEntry, type MealieRecipe } from "../src/mealie.js";
import { Service, imageSig } from "../src/service.js";
import type { AiRecipes } from "../src/sources/ai.js";
import { MealDb } from "../src/sources/mealdb.js";
import type { PhotoFinder } from "../src/sources/photos.js";
import type { RecipeSites, WebRecipe } from "../src/sources/webrecipes.js";
import { Store } from "../src/store.js";
import { mealieRecipe, teriyakiMeal } from "./fixtures.js";

const config: Config = {
  port: 0,
  host: "127.0.0.1",
  mealieUrl: "http://mealie.test",
  mealiePublicUrl: "https://meals.example.com",
  mealieToken: "tok",
  anthropicModel: "claude-haiku-5-5",
  householdContext: "a busy family",
  wikipediaApiUrl: "https://en.wikipedia.test/w/api.php",
  prefetchSecondsPerSite: 0,
  mealdbKey: "1",
  mealdbBaseUrl: "https://www.themealdb.com",
  timezone: "America/Denver",
  busyDays: [2, 4],
  planStart: "today",
  leftovers: true,
  staples: ["salt", "water", "oil"],
  webDir: "/nonexistent",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** In-memory stand-in for the Mealie API. */
function fakeMealie() {
  const recipes: MealieRecipe[] = [
    mealieRecipe({ name: "Chicken Tikka Masala", ingredients: ["2 lb chicken thighs", "1 cup yogurt"], recipeServings: 6, tags: [{ name: "Indian" }] }),
    mealieRecipe({ name: "Beef Tacos", ingredients: ["1 lb ground beef", "8 tortillas"], totalTimeSeconds: 1500 }),
    mealieRecipe({ name: "Greek Salad", ingredients: ["cucumber", "feta"], recipeCategory: [{ name: "Lunch" }], recipeServings: 2, totalTimeSeconds: 600 }),
    mealieRecipe({ name: "Salmon Sheet Pan", ingredients: ["4 salmon fillets"], recipeServings: 2, totalTimeSeconds: 1500 }),
    mealieRecipe({ name: "Lentil Curry", ingredients: ["1 cup red lentils"], recipeServings: 4 }),
  ];
  const plans: MealiePlanEntry[] = [];
  const calls: { method: string; path: string; query: URLSearchParams; body?: any }[] = [];
  let nextId = 1;

  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    calls.push({ method, path, query: url.searchParams, body });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");

    if (path === "/api/users/self") return json({ id: "u1", groupSlug: "home", householdSlug: "family" });
    if (path === "/api/recipes" && method === "GET") return json({ items: recipes });
    if (path === "/api/recipes/suggestions") {
      return json({ items: recipes.slice(0, 2).map((r) => ({ recipe: r, missingFoods: [{ id: "f9", name: "yogurt" }] })) });
    }
    if (path === "/api/recipes/create/html-or-json") {
      const schema = JSON.parse(body.data);
      const r = mealieRecipe({ name: schema.name, ingredients: schema.recipeIngredient });
      recipes.push(r);
      return json(r.slug, 201);
    }
    const slugMatch = /^\/api\/recipes\/([^/]+)(\/image)?$/.exec(path);
    if (slugMatch) {
      if (slugMatch[2]) return json({ image: "x" });
      const r = recipes.find((x) => x.slug === slugMatch[1] || x.id === slugMatch[1]);
      return r ? json(r) : json({ detail: "not found" }, 404);
    }
    if (path === "/api/foods") {
      return json({
        items: [
          { id: "f1", name: "chicken thigh", aliases: [{ name: "chicken thighs" }], householdsWithIngredientFood: ["family"] },
          { id: "f2", name: "soy sauce", householdsWithIngredientFood: ["family"] },
          { id: "f3", name: "brown rice", householdsWithIngredientFood: ["family"] },
          { id: "f4", name: "lobster", householdsWithIngredientFood: [] },
        ],
      });
    }
    if (path === "/api/households/mealplans" && method === "GET") {
      const s = url.searchParams.get("start_date")!;
      const e = url.searchParams.get("end_date")!;
      return json({ items: plans.filter((p) => p.date >= s && p.date <= e) });
    }
    if (path === "/api/households/mealplans" && method === "POST") {
      const p = { id: nextId++, ...body };
      plans.push(p);
      return json(p, 201);
    }
    const del = /^\/api\/households\/mealplans\/(\d+)$/.exec(path);
    if (del && method === "DELETE") {
      const i = plans.findIndex((p) => p.id === Number(del[1]));
      const [removed] = plans.splice(i, 1);
      return json(removed);
    }
    return json({ detail: `unhandled ${method} ${path}` }, 500);
  }) as typeof fetch;

  return { recipes, plans, calls, fetchImpl };
}

function fakeMealDb() {
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    const file = url.pathname.split("/").pop();
    if (file === "random.php" || file === "lookup.php" || file === "search.php") return json({ meals: [teriyakiMeal] });
    if (file === "filter.php") return json({ meals: [{ idMeal: teriyakiMeal.idMeal, strMeal: teriyakiMeal.strMeal }] });
    if (file === "list.php") {
      return url.searchParams.has("a")
        ? json({ meals: [{ strArea: "Japanese" }, { strArea: "Italian" }] })
        : json({ meals: [{ strCategory: "Chicken" }, { strCategory: "Dessert" }] });
    }
    return json({ meals: null });
  }) as typeof fetch;
  return new MealDb("1", fetchImpl);
}

function setup() {
  const m = fakeMealie();
  const service = new Service({
    config,
    mealie: new MealieClient(config.mealieUrl, config.mealieToken, m.fetchImpl),
    mealdb: fakeMealDb(),
    now: () => new Date("2026-11-18T18:00:00Z"), // Wednesday in Denver
  });
  return { ...m, service };
}

describe("deck", () => {
  it("deals new ideas from TheMealDB with on-hand info", async () => {
    const { service } = setup();
    const res = await service.deck({ source: "new", onHand: true, leniency: 8, count: 4, exclude: [], cuisine: "Japanese" });
    expect(res.cards).toHaveLength(1);
    const card = res.cards[0]!;
    expect(card.title).toBe("Teriyaki Chicken Casserole");
    // water is a staple; soy sauce and brown rice are on hand; chicken breasts are not (only thighs).
    expect(card.onHand?.have).toBe(2);
    expect(card.onHand?.missing).toContain("chicken breasts");
    expect(card.onHand?.missing).not.toContain("water");
  });

  it("falls back to TheMealDB when the AI request fails", async () => {
    const m = fakeMealie();
    const warnings: string[] = [];
    const failingAi = { generate: async () => { throw new Error("529 overloaded"); } } as unknown as AiRecipes;
    const service = new Service({
      config,
      mealie: new MealieClient(config.mealieUrl, config.mealieToken, m.fetchImpl),
      mealdb: fakeMealDb(),
      ai: failingAi,
      warn: (msg) => warnings.push(msg),
      now: () => new Date("2026-11-18T18:00:00Z"),
    });
    const res = await service.deck({ source: "new", mood: "teriyaki", onHand: false, leniency: 2, count: 4, exclude: [] });
    expect(res.cards.map((c) => c.source)).toEqual(["mealdb"]);
    expect(res.note).toMatch(/Couldn't get AI ideas this time; showing TheMealDB results/);
    expect(warnings[0]).toMatch(/529 overloaded/);
  });

  describe("AI ideas", () => {
    const fakeAi = () => {
      const asked: { mood?: string; avoid: string[] }[] = [];
      const ai = {
        generate: async (req: { mood?: string; avoid: string[] }) => {
          asked.push(req);
          return [{ key: "ai:miso-glazed-cod", source: "ai", title: "Miso Glazed Cod", tags: [], ingredients: ["2 cod fillets"], instructions: ["Bake."], suits: ["dinner"] }];
        },
      } as unknown as AiRecipes;
      return { ai, asked };
    };
    const withAi = (ai: AiRecipes, mealdb = fakeMealDb()) => {
      const m = fakeMealie();
      return new Service({ config, mealie: new MealieClient(config.mealieUrl, config.mealieToken, m.fetchImpl), mealdb, ai });
    };

    it("browses TheMealDB without a search, even with AI on", async () => {
      const { ai, asked } = fakeAi();
      const res = await withAi(ai).deck({ source: "new", onHand: false, leniency: 2, count: 4, exclude: [] });
      expect(res.cards.map((c) => c.source)).toEqual(["mealdb"]);
      expect(asked).toHaveLength(0);
    });

    it("uses AI for a typed craving, without repeating ideas already dealt", async () => {
      const { ai, asked } = fakeAi();
      const res = await withAi(ai).deck({ source: "new", mood: "flaky fish", onHand: false, leniency: 2, count: 4, exclude: ["ai:sesame-noodles", "mealdb:1"] });
      expect(res.cards.map((c) => c.source)).toEqual(["ai"]);
      expect(asked[0]!.avoid[0]).toBe("sesame noodles");
      expect(asked[0]!.avoid).toContain("Beef Tacos");
    });

    it("fills the deck with AI when TheMealDB has nothing new", async () => {
      const { ai, asked } = fakeAi();
      // The fake TheMealDB only knows one dish; once it's been dealt there's nothing left.
      const res = await withAi(ai).deck({ source: "new", onHand: false, leniency: 2, count: 4, exclude: ["mealdb:52772"] });
      expect(res.cards.map((c) => c.title)).toEqual(["Miso Glazed Cod"]);
      expect(res.note).toMatch(/TheMealDB had nothing new for this, so here are AI ideas/);
      expect(asked[0]!.mood).toBeUndefined();
    });

    it("fills the deck with AI when TheMealDB is down", async () => {
      const { ai } = fakeAi();
      const down = { candidates: async () => { throw new Error("fetch failed"); } } as unknown as MealDb;
      const res = await withAi(ai, down).deck({ source: "new", onHand: false, leniency: 2, count: 4, exclude: [] });
      expect(res.cards.map((c) => c.source)).toEqual(["ai"]);
    });

    it("uses AI for a cuisine, passing the style along", async () => {
      const { ai, asked } = fakeAi();
      const res = await withAi(ai).deck({ source: "new", onHand: false, leniency: 2, count: 4, exclude: [], cuisines: ["Chinese"], style: "weeknight" });
      expect(res.cards.map((c) => c.source)).toEqual(["ai"]);
      expect((asked[0] as unknown as { style: string }).style).toBe("weeknight");
      expect(res.note).toBe("AI ideas · Chinese · Weeknight shortcuts");
    });

    it("gives AI ideas photos and drops the ones without", async () => {
      const ai = {
        generate: async () => [
          { key: "ai:mapo-tofu", source: "ai", title: "Mapo Tofu", tags: [], ingredients: ["1 block tofu"], instructions: ["Cook."], photoHint: { wikipediaTitle: "Mapo tofu" } },
          { key: "ai:obscure", source: "ai", title: "Very Obscure Dish", tags: [], ingredients: ["1 cup rice"], instructions: ["Cook."], photoHint: {} },
        ],
      } as unknown as AiRecipes;
      const photos = {
        find: async (q: { wikipediaTitle?: string }) =>
          q.wikipediaTitle === "Mapo tofu" ? { url: "https://upload.test/mapo.jpg", credit: { text: "Photo: Wikipedia", url: "https://w/File:Mapo.jpg" } } : undefined,
      } as unknown as PhotoFinder;
      const m = fakeMealie();
      const service = new Service({ config, mealie: new MealieClient(config.mealieUrl, config.mealieToken, m.fetchImpl), mealdb: fakeMealDb(), ai, photos });
      const res = await service.deck({ source: "new", mood: "tofu", onHand: false, leniency: 2, count: 4, exclude: [] });
      expect(res.cards).toHaveLength(1);
      expect(res.cards[0]).toMatchObject({ title: "Mapo Tofu", image: "https://upload.test/mapo.jpg", imageCredit: { text: "Photo: Wikipedia" } });
      expect(res.cards[0]).not.toHaveProperty("photoHint");
    });

    it("leaves the deck empty when TheMealDB has nothing and AI is off", async () => {
      const { ai, asked } = fakeAi();
      const res = await withAi(ai).deck({ source: "new", ai: false, onHand: false, leniency: 2, count: 4, exclude: ["mealdb:52772"] });
      expect(res.cards).toEqual([]);
      expect(asked).toHaveLength(0);
    });
  });

  it("takes several cuisines as any of them", async () => {
    const { service } = setup();
    // The fake returns the same casserole for every cuisine, so the union should hold it once.
    const res = await service.deck({ source: "new", onHand: false, leniency: 2, count: 4, exclude: [], cuisines: ["Japanese", "Italian"] });
    expect(res.cards.map((c) => c.key)).toEqual(["mealdb:52772"]);
    expect(res.note).toContain("Japanese or Italian");
  });

  it("drops TheMealDB dishes that don't fit any chosen meal", async () => {
    const { service } = setup();
    const res = await service.deck({ source: "new", onHand: false, leniency: 2, count: 4, exclude: [], meals: ["breakfast", "dessert"] });
    expect(res.cards).toHaveLength(0); // the casserole is a main course
    expect(res.note).toContain("Breakfast or Dessert");
  });

  it("drops TheMealDB dishes that break a dietary restriction", async () => {
    const { service } = setup();
    const res = await service.deck({ source: "new", onHand: false, leniency: 2, count: 4, exclude: [], dietary: ["vegetarian"] });
    expect(res.cards).toHaveLength(0); // the only fake meal is a chicken casserole
    expect(res.note).toContain("Vegetarian");
  });

  it("uses AI for nutrition goals and drops AI ideas that miss them", async () => {
    const m = fakeMealie();
    const base = { source: "ai" as const, tags: [], ingredients: ["2 chicken breasts", "1 cup broccoli"], instructions: ["Cook."] };
    const ai = {
      generate: async () => [
        { ...base, key: "ai:lean", title: "Lean Chicken Bowl", nutrition: { calories: 450, protein: 42, carbs: 20, fat: 10, fiber: 6 } },
        { ...base, key: "ai:light", title: "Light Salad", nutrition: { calories: 250, protein: 8, carbs: 15, fat: 9, fiber: 7 } },
      ],
    } as unknown as AiRecipes;
    const service = new Service({
      config,
      mealie: new MealieClient(config.mealieUrl, config.mealieToken, m.fetchImpl),
      mealdb: fakeMealDb(),
      ai,
      now: () => new Date("2026-11-18T18:00:00Z"),
    });
    const res = await service.deck({ source: "new", onHand: false, leniency: 2, count: 4, exclude: [], goals: ["high-protein"] });
    expect(res.cards.map((c) => c.title)).toEqual(["Lean Chicken Bowl"]);
    expect(res.note).toBe("AI ideas · High protein");
  });

  it("skips cards already shown or already in the recipe book", async () => {
    const { service } = setup();
    const res = await service.deck({ source: "new", onHand: false, leniency: 2, count: 4, exclude: ["mealdb:52772"] });
    expect(res.cards).toHaveLength(0);
  });

  it("uses Mealie's recipe finder with the on-hand food ids for saved recipes", async () => {
    const { service, calls } = setup();
    const res = await service.deck({ source: "saved", onHand: true, leniency: 2, count: 5, exclude: [] });
    const q = calls.find((c) => c.path === "/api/recipes/suggestions")!.query;
    expect(q.getAll("foods").sort()).toEqual(["f1", "f2", "f3"]);
    expect(q.get("maxMissingFoods")).toBe("2");
    expect(res.cards).toHaveLength(2);
    expect(res.cards[0]!.onHand?.missing).toEqual(["yogurt"]);
    expect(res.cards[0]!.mealie?.url).toMatch(/^https:\/\/meals\.example\.com\/g\/home\/r\//);
  });

  it("filters saved recipes by mood text", async () => {
    const { service } = setup();
    const res = await service.deck({ source: "saved", onHand: false, leniency: 2, count: 5, exclude: [], mood: "indian" });
    expect(res.cards.map((c) => c.title)).toEqual(["Chicken Tikka Masala"]);
  });
});

describe("recipe book", () => {
  it("lists every saved recipe with the filters it passes", async () => {
    const { service } = setup();
    const { recipes } = await service.book();
    expect(recipes.map((r) => r.title).sort()).toEqual([
      "Beef Tacos",
      "Chicken Tikka Masala",
      "Greek Salad",
      "Lentil Curry",
      "Salmon Sheet Pan",
    ]);
    const byTitle = (t: string) => recipes.find((r) => r.title === t)!;
    expect(byTitle("Lentil Curry").fits.diets).toEqual(expect.arrayContaining(["vegetarian", "vegan", "gluten-free"]));
    expect(byTitle("Chicken Tikka Masala").fits.diets).not.toContain("vegetarian");
    expect(byTitle("Greek Salad").fits.diets).toContain("vegetarian");
    expect(byTitle("Greek Salad").fits.diets).not.toContain("dairy-free");
    expect(byTitle("Salmon Sheet Pan").fits.diets).toContain("pescatarian");
    expect(byTitle("Beef Tacos").fits.diets).not.toContain("gluten-free");
    expect(byTitle("Greek Salad").fits.meals).toContain("lunch");
    expect(byTitle("Greek Salad").fits.meals).not.toContain("dessert");
  });

  it("dates recipes by when they were saved, to the second", async () => {
    const m = fakeMealie();
    m.recipes.push(
      mealieRecipe({ name: "Saved Earlier", dateAdded: "2026-11-18", createdAt: "2026-11-18T09:15:00" }),
      mealieRecipe({ name: "Saved Later", dateAdded: "2026-11-18", createdAt: "2026-11-18T21:40:00" }),
      mealieRecipe({ name: "Old Import", dateAdded: "2026-10-02" }),
    );
    const service = new Service({ config, mealie: new MealieClient(config.mealieUrl, config.mealieToken, m.fetchImpl), mealdb: fakeMealDb() });
    const { recipes } = await service.book();
    const at = (t: string) => recipes.find((r) => r.title === t)!.addedAt;
    expect(at("Saved Later")).toBe("2026-11-18T21:40:00");
    expect(at("Saved Earlier")).toBe("2026-11-18T09:15:00");
    expect(at("Old Import")).toBe("2026-10-02");
  });

  it("signs image URLs only when a passcode is set", async () => {
    const { service } = setup();
    const card = (await service.book()).recipes[0]!;
    // The fixtures have no photos; check the URL builder directly.
    const open = new Service({ config, mealie: {} as MealieClient, mealdb: fakeMealDb() });
    const locked = new Service({ config: { ...config, appPasscode: "secret" }, mealie: {} as MealieClient, mealdb: fakeMealDb() });
    const url = (s: Service) => (s as unknown as { imageUrl(id: string, v: string): string }).imageUrl(card.mealie!.id, "abc");
    expect(url(open)).toBe(`/api/mealie-image/${card.mealie!.id}?v=abc`);
    expect(url(locked)).toBe(`/api/mealie-image/${card.mealie!.id}?v=abc&sig=${imageSig("secret", card.mealie!.id)}`);
  });
});

describe("save", () => {
  it("creates the recipe in Mealie and adds it to the meal plan", async () => {
    const { service, calls, plans } = setup();
    const deck = await service.deck({ source: "new", onHand: false, leniency: 2, count: 1, exclude: [] });
    const res = await service.save({ card: deck.cards[0]!, target: "plan", plan: { date: "2026-11-20", entryType: "dinner" } });
    expect(res.alreadyInBook).toBe(false);
    const create = calls.find((c) => c.path === "/api/recipes/create/html-or-json")!;
    expect(create.body.includeTags).toBe(true);
    expect(JSON.parse(create.body.data).name).toBe("Teriyaki Chicken Casserole");
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ date: "2026-11-20", entryType: "dinner" });
    expect(res.recipeUrl).toContain("/g/home/r/");

    // Saving the same dish again reuses the existing recipe.
    const again = await service.save({ card: deck.cards[0]!, target: "book" });
    expect(again.alreadyInBook).toBe(true);
    expect(calls.filter((c) => c.path === "/api/recipes/create/html-or-json")).toHaveLength(1);
  });
});

describe("week planning", () => {
  it("generates a week, keeps existing entries, and applies only new ones", async () => {
    const { service, plans, recipes } = setup();
    plans.push({ id: 100, date: "2026-11-19", entryType: "dinner", recipeId: recipes[1]!.id, title: "" });

    const preview = await service.generate({ replaceExisting: false });
    expect(preview.days).toHaveLength(7);
    expect(preview.days[0]!.date).toBe("2026-11-18");
    expect(preview.days[1]!.dinner.kind).toBe("existing");
    expect(preview.days[1]!.busy).toBe(true); // Thursday

    const res = await service.apply({ days: preview.days, replaceExisting: false });
    expect(res.removed).toBe(0);
    const newSlots = preview.days.flatMap((d) => [d.lunch, d.dinner]).filter((p) => p.kind === "recipe" || p.kind === "leftovers");
    expect(res.created).toBe(newSlots.length);
    expect(plans.filter((p) => p.date === "2026-11-19" && p.entryType === "dinner")).toHaveLength(1);
    const leftovers = plans.filter((p) => p.title?.startsWith("Leftovers:"));
    expect(leftovers.every((p) => !p.recipeId)).toBe(true);

    const week = await service.week();
    expect(week.days.every((d) => d.dinner.kind === "existing")).toBe(true);
  });

  it("doesn't double-book a slot that was filled after the preview", async () => {
    const { service, plans, recipes } = setup();
    const preview = await service.generate({ replaceExisting: false });
    const target = preview.days.find((d) => d.dinner.kind === "recipe")!;
    plans.push({ id: 200, date: target.date, entryType: "dinner", recipeId: recipes[4]!.id, title: "" });
    const res = await service.apply({ days: preview.days, replaceExisting: false });
    expect(res.skipped).toBe(1);
    expect(plans.filter((p) => p.date === target.date && p.entryType === "dinner")).toHaveLength(1);
  });

  it("replaces existing entries when asked", async () => {
    const { service, plans, recipes } = setup();
    plans.push({ id: 100, date: "2026-11-19", entryType: "dinner", recipeId: recipes[1]!.id, title: "" });
    const preview = await service.generate({ replaceExisting: true });
    const res = await service.apply({ days: preview.days, replaceExisting: true });
    expect(res.removed).toBe(1);
    expect(plans.some((p) => p.id === 100)).toBe(false);
  });
});

describe("HTTP API", () => {
  it("validates requests and enforces the passcode", async () => {
    const { service } = setup();
    const app = buildApp({ ...config, appPasscode: "secret" }, { service });
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    const noPass = await app.inject({ method: "GET", url: "/api/week" });
    expect(noPass.statusCode).toBe(401);
    const ok = await app.inject({ method: "GET", url: "/api/week", headers: { "x-app-passcode": "secret" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().days).toHaveLength(7);
    const bad = await app.inject({ method: "POST", url: "/api/deck", headers: { "x-app-passcode": "secret" }, payload: { source: "nope" } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("lets signed image URLs through the passcode check", async () => {
    const { service } = setup();
    const app = buildApp({ ...config, appPasscode: "secret" }, { service });
    // An invalid id stops at the route's own 400, so no request leaves the test.
    const id = "not-a-uuid";
    const unsigned = await app.inject({ method: "GET", url: `/api/mealie-image/${id}` });
    expect(unsigned.statusCode).toBe(401);
    const forged = await app.inject({ method: "GET", url: `/api/mealie-image/${id}?sig=${imageSig("wrong", id)}` });
    expect(forged.statusCode).toBe(401);
    const signed = await app.inject({ method: "GET", url: `/api/mealie-image/${id}?v=abc&sig=${imageSig("secret", id)}` });
    expect(signed.statusCode).toBe(400);
    await app.close();
  });
});

describe("cuisine list", () => {
  it("puts the most-cooked cuisines first, then the rest A–Z", () => {
    expect(rankCuisines(["Uruguayan", "Thai", "Italian", "Croatian", "Mexican", "Algerian"])).toEqual([
      "Italian", "Mexican", "Thai", "Algerian", "Croatian", "Uruguayan",
    ]);
  });
});

describe("real recipes from trusted sites", () => {
  const web = (title: string, path: string): WebRecipe => ({
    url: `https://thewoksoflife.com/${path}/`,
    domain: "thewoksoflife.com",
    title,
    image: `https://img.test/${path}.jpg`,
    ingredients: ["1 lb pork belly", "2 tbsp Shaoxing wine"],
    instructions: ["Braise."],
    keywords: [],
  });
  const pages: Record<string, WebRecipe> = {
    "hong shao rou": web("Hong Shao Rou (Red Braised Pork Belly)", "hong-shao-rou"),
    "fish fragrant eggplant": web("Fish-Fragrant Eggplant", "yu-xiang-qie-zi"),
    "scallion pancake": web("Scallion Pancakes", "scallion-pancakes"),
  };
  const DISHES = [
    { name: "Red-Braised Pork Belly", nativeName: "红烧肉", aliases: ["Red-Braised Pork Belly", "hong shao rou"], region: "Hunan", suits: ["dinner"] },
    { name: "Fish-Fragrant Eggplant", nativeName: "鱼香茄子", aliases: ["Fish-Fragrant Eggplant"], region: "Sichuan", suits: ["dinner"] },
    { name: "Scallion Pancakes", aliases: ["Scallion Pancake"], region: "Shanghai", suits: ["lunch"] },
    { name: "Lion's Head Meatballs", nativeName: "狮子头", aliases: ["Lion's Head Meatballs"], region: "Jiangsu", suits: ["dinner"] },
  ];

  function setupReal(store = new Store(":memory:")) {
    const calls = {
      names: 0,
      generate: [] as unknown[],
      find: 0,
      random: 0,
      randomArgs: [] as { domains: string[]; wait?: boolean }[],
      search: [] as { query: string; domains: string[] }[],
    };
    const ai = {
      dishNames: async () => (calls.names++, DISHES),
      generate: async (req: { only?: { name: string }[] }) => {
        calls.generate.push(req);
        return (req.only ?? [{ name: "Grandma's Stew" }]).map((d) => ({
          key: `ai:${d.name.toLowerCase().replace(/[^a-z]+/g, "-")}`, source: "ai", title: d.name, tags: [], ingredients: ["1 lb pork"], instructions: ["Cook."], photoHint: {},
          nutrition: { calories: 300, protein: 30, carbs: 10, fat: 10, fiber: 2 },
        }));
      },
    } as unknown as AiRecipes;
    const sites = {
      find: async (aliases: string[]) => {
        calls.find++;
        for (const a of aliases) {
          const hit = Object.entries(pages).find(([k]) => a.toLowerCase().replace(/-/g, " ").includes(k));
          if (hit) return hit[1];
        }
        return undefined;
      },
      read: async (url: string) => Object.values(pages).find((p) => p.url === url) ?? null,
      random: async (domains: string[], _n: number, _skip: Set<string>, opts: { wait?: boolean }) => {
        calls.random++;
        calls.randomArgs.push({ domains, wait: opts?.wait });
        return Object.values(pages);
      },
      search: async (query: string, domains: string[]) => {
        calls.search.push({ query, domains });
        return Object.values(pages).filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));
      },
    } as unknown as RecipeSites;
    const m = fakeMealie();
    const service = new Service({
      config,
      mealie: new MealieClient(config.mealieUrl, config.mealieToken, m.fetchImpl),
      mealdb: fakeMealDb(),
      ai,
      sites,
      store,
      siteMap: { Chinese: ["thewoksoflife.com"], General: ["seriouseats.com"] },
    });
    return { service, calls, store, m };
  }
  const chinese = { source: "new" as const, onHand: false, leniency: 2, count: 3, exclude: [] as string[], cuisines: ["Chinese"] };

  it("deals real recipes for Claude's dish names, with an AI-written recipe only for the dish no site has", async () => {
    const { service, calls } = setupReal();
    const res = await service.deck({ ...chinese, count: 4 });
    const bySource = (s: string) => res.cards.filter((c) => c.source === s).map((c) => c.title).sort();
    expect(bySource("web")).toEqual(["Fish-Fragrant Eggplant", "Hong Shao Rou (Red Braised Pork Belly)", "Scallion Pancakes"]);
    expect(bySource("ai")).toEqual(["Lion's Head Meatballs"]);
    expect(res.cards.find((c) => c.source === "web" && c.title.startsWith("Hong"))).toMatchObject({ site: "The Woks of Life", nativeName: "红烧肉", region: "Hunan", cuisine: "Chinese", sourceUrl: "https://thewoksoflife.com/hong-shao-rou/" });
    expect(res.note).toBe("Recipes from trusted sites · Chinese (1 written by AI)");
    // Only the unmatched dish was written, by name.
    expect((calls.generate[0] as { only: { name: string }[] }).only.map((d) => d.name)).toEqual(["Lion's Head Meatballs"]);
  });

  it("reuses the saved dish list and the dish -> page matches on the next deck", async () => {
    const { service, calls } = setupReal();
    const first = await service.deck({ ...chinese, count: 2 });
    const findsAfterFirst = calls.find;
    const second = await service.deck({ ...chinese, count: 2, exclude: first.cards.map((c) => c.key) });
    expect(calls.names).toBe(1);
    expect(second.cards.map((c) => c.key)).not.toEqual(expect.arrayContaining(first.cards.map((c) => c.key)));
    // Dishes already matched aren't looked up again.
    expect(calls.find - findsAfterFirst).toBeLessThanOrEqual(DISHES.length - first.cards.filter((c) => c.source === "web").length);
  });

  it("stops asking Claude for more names when it has nothing new to add", async () => {
    const { service, calls } = setupReal();
    let exclude: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await service.deck({ ...chinese, exclude });
      exclude = [...exclude, ...res.cards.map((c) => c.key)];
    }
    // First fill, one refill that only returned dishes it already had, then no more calls.
    expect(calls.names).toBe(2);
  });

  it("keeps a skipped recipe out of later decks, on any device and after a restart", async () => {
    const store = new Store(":memory:");
    const a = setupReal(store);
    const res = await a.service.deck(chinese);
    const skipped = res.cards.find((c) => c.source === "web")!;
    a.service.history({ key: skipped.key, action: "skip", title: skipped.title });
    const b = setupReal(store); // a fresh app with the same data volume
    for (let i = 0; i < 3; i++) {
      const again = await b.service.deck(chinese);
      expect(again.cards.map((c) => c.key)).not.toContain(skipped.key);
    }
  });

  it("browses a cuisine's sites directly when AI is off (no Claude at all)", async () => {
    const { service, calls } = setupReal();
    const res = await service.deck({ ...chinese, ai: false });
    expect(calls.random).toBe(1);
    expect(calls.names).toBe(0);
    expect(res.cards.every((c) => c.source === "web")).toBe(true);
    expect(res.note).toMatch(/^Recipes from trusted sites · Chinese/);
  });

  it("searches the trusted sites' indexes for a typed search when AI is off", async () => {
    const { service, calls } = setupReal();
    const res = await service.deck({ source: "new", ai: false, onHand: false, leniency: 2, count: 3, exclude: [], mood: "pancakes" });
    expect(calls.search).toEqual([{ query: "pancakes", domains: ["thewoksoflife.com", "seriouseats.com"] }]);
    expect(res.cards.map((c) => c.title)).toEqual(["Scallion Pancakes"]);
    expect(res.note).toBe('Best matches for "pancakes"');
    expect(calls.names).toBe(0);
  });

  it("ranks a typed search by how well dish names match, across sites and TheMealDB", async () => {
    const pagesFor = (titles: string[]) => titles.map((t, i) => web(t, `p${i}-${t.toLowerCase().replace(/[^a-z]+/g, "-")}`));
    const siteHits = pagesFor(["Massaman Beef Curry", "Enoki Beef Rolls", "Beef Negimaki Rolls (Scallion Beef Rolls)"]);
    const sites = { search: async () => siteHits, random: async () => [] } as unknown as RecipeSites;
    const m = fakeMealie();
    const mealdb = {
      candidates: async () => ({ refs: [{ id: "1", meal: { idMeal: "1", strMeal: "Beef Wellington", strMealThumb: "https://img.test/w.jpg", strInstructions: "Bake.", strIngredient1: "Beef", strMeasure1: "1 lb" } }], note: "Beef" }),
      lookup: async () => null,
    } as unknown as MealDb;
    const service = new Service({ config, mealie: new MealieClient(config.mealieUrl, config.mealieToken, m.fetchImpl), mealdb, sites, store: new Store(":memory:"), siteMap: { General: ["a.test"] } });
    const res = await service.deck({ source: "new", ai: false, onHand: false, leniency: 2, count: 5, exclude: [], mood: "beef roll" });
    // Both words in the name, shortest name first; curry and Wellington don't match "roll" at all.
    expect(res.cards.map((c) => c.title)).toEqual(["Enoki Beef Rolls", "Beef Negimaki Rolls (Scallion Beef Rolls)"]);
    expect(res.note).toBe('Best matches for "beef roll"');
  });

  it("answers within the deck time limit even when recipe sites are slow", async () => {
    const slowSites = {
      find: () => new Promise((r) => setTimeout(() => r(undefined), 2_000)),
      read: async () => null,
    } as unknown as RecipeSites;
    const ai = { dishNames: async () => [{ name: "Mapo Tofu", aliases: ["Mapo Tofu"], suits: ["dinner"] }], generate: async () => [] } as unknown as AiRecipes;
    const m = fakeMealie();
    const service = new Service({
      config, mealie: new MealieClient(config.mealieUrl, config.mealieToken, m.fetchImpl), mealdb: fakeMealDb(), ai, sites: slowSites,
      store: new Store(":memory:"), siteMap: { Chinese: ["slow.test"] }, limits: { matchMs: 50, deckMs: 300 },
    });
    const t0 = Date.now();
    const res = await service.deck({ source: "new", onHand: false, leniency: 2, count: 4, exclude: [], cuisines: ["Chinese"] });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(res.cards).toEqual([]);
    expect(res.note).toMatch(/took too long/);
  });

  it("looks through every trusted site for a typed search with AI on and no cuisine", async () => {
    const { service, calls } = setupReal();
    const seen: string[][] = [];
    // Record which sites each dish was looked up on.
    const sites = (service as unknown as { deps: { sites: { find: (a: string[], d: string[]) => Promise<unknown> } } }).deps.sites;
    const find = sites.find;
    sites.find = async (a, d) => (seen.push(d), find(a, d));
    const res = await service.deck({ source: "new", onHand: false, leniency: 2, count: 3, exclude: [], mood: "pork belly" });
    expect(seen[0]).toEqual(["seriouseats.com", "thewoksoflife.com"]);
    expect(res.cards.some((c) => c.source === "web")).toBe(true);
    expect(calls.names).toBe(1);
  });

  it("browses every trusted site for plain browsing, without waiting on sites still being indexed", async () => {
    const { service, calls } = setupReal();
    const res = await service.deck({ source: "new", onHand: false, leniency: 2, count: 3, exclude: [] });
    expect(calls.randomArgs[0]).toEqual({ domains: ["thewoksoflife.com", "seriouseats.com"], wait: false });
    expect(res.cards.every((c) => c.source === "web")).toBe(true);
    expect(calls.names).toBe(0);
  });

  it("leaves dish types (TheMealDB categories) to TheMealDB", async () => {
    const { service, calls } = setupReal();
    const res = await service.deck({ source: "new", onHand: false, leniency: 2, count: 3, exclude: [], categories: ["Chicken"] });
    expect(calls.random).toBe(0);
    expect(res.cards.every((c) => c.source === "mealdb")).toBe(true);
  });

  it("still writes recipes with AI for nutrition goals (sites rarely list nutrition)", async () => {
    const { service, calls } = setupReal();
    const res = await service.deck({ ...chinese, goals: ["high-protein"] });
    expect(calls.names).toBe(0);
    expect(res.cards.map((c) => c.source)).toEqual(["ai"]);
  });

  it("saves a real recipe with its source link and remembers it", async () => {
    const { service, store, m } = setupReal();
    const card = (await service.deck(chinese)).cards.find((c) => c.source === "web")!;
    await service.save({ card, target: "book" });
    const create = m.calls.find((c) => c.path === "/api/recipes/create/html-or-json")!;
    expect(create.body.url).toBe(card.sourceUrl);
    expect(store.excludedKeys().has(card.key)).toBe(true);
  });
});
