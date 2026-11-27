import { MealDb } from "../src/sources/mealdb.js";
import { describe, expect, it } from "vitest";
import { buildOnHandMatcher, coreIngredient, detectProtein, onHandProteins } from "../src/ingredients.js";
import { toSchemaOrg } from "../src/service.js";
import { mealDbToCard } from "../src/sources/mealdb.js";
import { addDays, parseMinutes, planDates, toIsoDuration, weekday } from "../src/util.js";
import { teriyakiMeal } from "./fixtures.js";

describe("dates", () => {
  it("adds days across month boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("computes weekdays", () => {
    expect(weekday("2026-11-18")).toBe(3); // Wednesday
  });
  it("builds a plan window in the configured timezone", () => {
    // 2026-11-19 03:00 UTC is still Nov 18 in Denver.
    const now = new Date("2026-11-19T03:00:00Z");
    expect(planDates("America/Denver", "today", now)[0]).toBe("2026-11-18");
    expect(planDates("America/Denver", "monday", now)[0]).toBe("2026-11-16");
    expect(planDates("America/Denver", "today", now)).toHaveLength(7);
  });
  it("parses and formats durations", () => {
    expect(parseMinutes("PT1H30M")).toBe(90);
    expect(parseMinutes("1 hour 15 minutes")).toBe(75);
    expect(parseMinutes("45 min")).toBe(45);
    expect(parseMinutes("")).toBeUndefined();
    expect(toIsoDuration(65)).toBe("PT1H5M");
  });
});

describe("ingredients", () => {
  it("strips quantities and units", () => {
    expect(coreIngredient("2 cups chopped onion")).toBe("onion");
    expect(coreIngredient("1 (12 oz.) bag stir-fry vegetables")).toBe("stir fry vegetables");
  });

  it("matches on-hand foods, skips staples, lists missing", () => {
    const m = buildOnHandMatcher(
      [{ name: "chicken breast", aliases: [{ name: "chicken breasts" }] }, { name: "rice" }, { name: "soy sauce" }],
      ["salt", "water", "olive oil"],
    );
    const r = m.check(["2 chicken breasts", "1 cup brown rice", "1 tsp salt", "1/2 cup water", "3 tbsp soy sauce", "1 lemon", "2 tbsp extra virgin olive oil"]);
    expect(r.total).toBe(4);
    expect(r.have).toBe(3);
    expect(r.missing).toEqual(["lemon"]);
  });

  it("detects the main protein", () => {
    expect(detectProtein("Teriyaki Chicken Casserole", ["2 chicken breasts", "1 egg"])).toBe("chicken");
    expect(detectProtein("Veggie Soup", ["4 cups chicken broth", "2 carrots"])).toBeNull();
    expect(detectProtein("Shakshuka", ["6 eggs", "1 can tomatoes"])).toBe("egg");
    expect(detectProtein("Tacos", ["1 lb ground beef", "tortillas"])).toBe("beef");
    expect(detectProtein("Fried Rice", ["2 eggs", "1/2 lb shrimp"])).toBe("seafood");
  });

  it("finds on-hand proteins from food names", () => {
    expect([...onHandProteins(["chicken thighs", "salmon fillet", "onion"])].sort()).toEqual(["chicken", "fish"]);
  });
});

describe("TheMealDB mapping", () => {
  it("maps a meal to a card", () => {
    const c = mealDbToCard(teriyakiMeal);
    expect(c.key).toBe("mealdb:52772");
    expect(c.cuisine).toBe("Japanese");
    expect(c.ingredients[0]).toBe("3/4 cup soy sauce");
    expect(c.ingredients).toHaveLength(9);
    expect(c.instructions).toHaveLength(2);
    expect(c.instructions[0]).toMatch(/^Preheat oven/);
    expect(c.tags).toEqual(["Meat", "Casserole"]);
    expect(c.sourceUrl).toBeUndefined();
  });

  it("builds schema.org JSON for Mealie", () => {
    const json = toSchemaOrg({ ...mealDbToCard(teriyakiMeal), totalMinutes: 50, servings: 6 });
    expect(json["@type"]).toBe("Recipe");
    expect(json.recipeIngredient).toHaveLength(9);
    expect(json.totalTime).toBe("PT50M");
    expect(json.recipeCategory).toEqual(["Dinner"]);
    expect(String(json.keywords)).toContain("new to try");
    expect((json.recipeInstructions as unknown[])[0]).toEqual({ "@type": "HowToStep", text: expect.stringMatching(/^Preheat/) });
  });

  it("keeps desserts out of the Dinner category", () => {
    const json = toSchemaOrg(mealDbToCard({ ...teriyakiMeal, strCategory: "Dessert" }));
    expect(json.recipeCategory).toEqual(["Dessert"]);
  });
});

describe("TheMealDB typed searches", () => {
  const fakeFetch = (routes: Record<string, unknown>) =>
    (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const key = `${url.pathname.split("/").pop()}?${url.searchParams.toString()}`;
      return new Response(JSON.stringify(routes[key] ?? { meals: null }));
    }) as typeof fetch;
  const lists = {
    "list.php?a=list": { meals: [{ strArea: "Italian" }, { strArea: "Japanese" }] },
    "list.php?c=list": { meals: [{ strCategory: "Beef" }, { strCategory: "Dessert" }] },
  };

  it("looks a dish up by name before falling back to a whole category", async () => {
    const db = new MealDb("1", fakeFetch({
      ...lists,
      "search.php?s=beef+roll": { meals: [{ idMeal: "9", strMeal: "Beef Rolls" }] },
      "filter.php?c=Beef": { meals: [{ idMeal: "1", strMeal: "Massaman Beef curry" }] },
    }));
    const r = await db.candidates({ mood: "beef roll", want: 8 });
    expect(r.refs.map((x) => x.id)).toEqual(["9"]);
    expect(r.note).toBe('Matches for "beef roll"');
  });

  it("treats a search that is just a type or cuisine as the whole type or cuisine", async () => {
    const db = new MealDb("1", fakeFetch({ ...lists, "filter.php?c=Beef": { meals: [{ idMeal: "1", strMeal: "Massaman Beef curry" }] } }));
    const r = await db.candidates({ mood: "Beef", want: 8 });
    expect(r.refs.map((x) => x.id)).toEqual(["1"]);
  });

  it("falls back to the category when no dish name matches", async () => {
    const db = new MealDb("1", fakeFetch({ ...lists, "filter.php?c=Beef": { meals: [{ idMeal: "1", strMeal: "Massaman Beef curry" }] } }));
    const r = await db.candidates({ mood: "beef surprise", want: 8 });
    expect(r.refs.map((x) => x.id)).toEqual(["1"]);
  });
});
