import { describe, expect, it } from "vitest";
import { dietViolation, fitsDiet, fitsGoals, fitsMeal, parseNutrient } from "../src/filters.js";

describe("dietary filters", () => {
  it("catches meat, fish and stock for vegetarians", () => {
    expect(fitsDiet(["2 chicken breasts", "1 onion"], ["vegetarian"])).toBe(false);
    expect(fitsDiet(["1 tbsp fish sauce"], ["vegetarian"])).toBe(false);
    expect(fitsDiet(["2 cups chicken stock"], ["vegetarian"])).toBe(false);
    expect(fitsDiet(["2 cups vegetable stock", "1 can kidney beans", "100g goat cheese"], ["vegetarian"])).toBe(true);
  });

  it("treats plant milks and nut butters as dairy-free", () => {
    expect(fitsDiet(["1 can coconut milk", "2 tbsp peanut butter", "1 butternut squash"], ["dairy-free"])).toBe(true);
    expect(fitsDiet(["50g butter"], ["dairy-free"])).toBe(false);
    expect(fitsDiet(["1 cup grated Parmesan"], ["dairy-free"])).toBe(false);
  });

  it("vegan excludes eggs, dairy and honey", () => {
    expect(fitsDiet(["2 eggs"], ["vegan"])).toBe(false);
    expect(fitsDiet(["1 tbsp honey"], ["vegan"])).toBe(false);
    expect(fitsDiet(["1 eggplant", "1 cup oat milk", "200g tofu"], ["vegan"])).toBe(true);
  });

  it("handles gluten-free swaps", () => {
    expect(fitsDiet(["2 cups plain flour"], ["gluten-free"])).toBe(false);
    expect(fitsDiet(["3 tbsp soy sauce"], ["gluten-free"])).toBe(false);
    expect(fitsDiet(["1 cup rice flour", "2 tbsp tamari", "8 corn tortillas", "200g rice noodles"], ["gluten-free"])).toBe(true);
    expect(fitsDiet(["3 tbsp gluten-free soy sauce"], ["gluten-free"])).toBe(true);
  });

  it("doesn't confuse nutmeg or coconut with nuts", () => {
    expect(fitsDiet(["1/4 tsp nutmeg", "1 cup shredded coconut", "1 can water chestnuts"], ["nut-free"])).toBe(true);
    expect(fitsDiet(["1/2 cup chopped walnuts"], ["nut-free"])).toBe(false);
    expect(fitsDiet(["2 tbsp peanut butter"], ["nut-free"])).toBe(false);
  });

  it("reports which ingredient broke which restriction", () => {
    expect(dietViolation(["1 onion", "12 prawns"], ["vegetarian", "shellfish-free"])).toEqual({
      diet: "vegetarian",
      ingredient: "12 prawns",
    });
  });
});

describe("meal filter", () => {
  it("uses category and tags", () => {
    expect(fitsMeal({ category: "Dessert", tags: [] }, "dessert")).toBe(true);
    expect(fitsMeal({ category: "Dessert", tags: [] }, "dinner")).toBe(false);
    expect(fitsMeal({ category: "Chicken", tags: [] }, "dinner")).toBe(true);
    expect(fitsMeal({ category: "Chicken", tags: [] }, "breakfast")).toBe(false);
    expect(fitsMeal({ category: undefined, tags: ["Brunch"] }, "breakfast")).toBe(true);
    expect(fitsMeal({ category: "Starter", tags: [] }, "snack")).toBe(true);
  });
});

describe("nutrition goals", () => {
  it("checks per-serving numbers", () => {
    const card = { tags: [], nutrition: { calories: 420, protein: 35, carbs: 18, fat: 14, fiber: 4 } };
    expect(fitsGoals(card, ["low-calorie", "high-protein", "low-carb", "low-fat"])).toBe(true);
    expect(fitsGoals(card, ["high-fiber"])).toBe(false);
    expect(fitsGoals(card, ["keto"])).toBe(false);
  });

  it("falls back to tags, and fails when nothing is known", () => {
    expect(fitsGoals({ tags: ["High Protein"] }, ["high-protein"])).toBe(true);
    expect(fitsGoals({ tags: ["keto"] }, ["keto"])).toBe(true);
    expect(fitsGoals({ tags: [] }, ["high-protein"])).toBe(false);
  });

  it("parses Mealie's free-text values", () => {
    expect(parseNutrient("350 kcal")).toBe(350);
    expect(parseNutrient("12,5 g")).toBe(12.5);
    expect(parseNutrient("")).toBeUndefined();
    expect(parseNutrient(null)).toBeUndefined();
  });
});
