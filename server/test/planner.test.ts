import { describe, expect, it } from "vitest";
import { classifyRecipe, planWeek, slotKey, type PlanInput } from "../src/planner.js";
import { addDays } from "../src/util.js";
import { mealieRecipe } from "./fixtures.js";

// Deterministic pseudo-random generator.
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const dinners = [
  mealieRecipe({ name: "Chicken Tikka Masala", ingredients: ["2 lb chicken thighs", "1 cup yogurt"], recipeServings: 6 }),
  mealieRecipe({ name: "Beef Tacos", ingredients: ["1 lb ground beef", "8 tortillas"], recipeServings: 4, totalTimeSeconds: 1500 }),
  mealieRecipe({ name: "Salmon Sheet Pan", ingredients: ["4 salmon fillets", "1 lb asparagus"], recipeServings: 2, totalTimeSeconds: 1500 }),
  mealieRecipe({ name: "Pork Carnitas", ingredients: ["3 lb pork shoulder"], recipeServings: 8, totalTimeSeconds: 14400 }),
  mealieRecipe({ name: "Lentil Curry", ingredients: ["1 cup red lentils", "1 can coconut milk"], recipeServings: 4 }),
  mealieRecipe({ name: "Chicken Stir Fry", ingredients: ["1 lb chicken breast", "2 cups broccoli"], recipeServings: 2, totalTimeSeconds: 1200 }),
  mealieRecipe({ name: "Shrimp Pasta", ingredients: ["1 lb shrimp", "12 oz linguine"], recipeServings: 3, totalTimeSeconds: 1500 }),
  mealieRecipe({ name: "Turkey Chili", ingredients: ["1 lb ground turkey", "2 cans beans"], recipeServings: 6 }),
  mealieRecipe({ name: "Mushroom Risotto", ingredients: ["1 cup arborio rice", "8 oz mushrooms"], recipeServings: 2 }),
  mealieRecipe({ name: "Never Again Casserole", ingredients: ["mystery"], tags: [{ name: "not again" }] }),
];
const lunches = [
  mealieRecipe({ name: "Turkey Club Sandwich", ingredients: ["4 slices turkey", "bread"], recipeCategory: [{ name: "Lunch" }], recipeServings: 1, totalTimeSeconds: 600 }),
  mealieRecipe({ name: "Greek Salad", ingredients: ["cucumber", "feta"], recipeCategory: [{ name: "Lunch" }], recipeServings: 2, totalTimeSeconds: 900 }),
  mealieRecipe({ name: "Tomato Soup", ingredients: ["2 cans tomatoes"], tags: [{ name: "soup" }], recipeServings: 2 }),
];
const dessert = mealieRecipe({ name: "Brownies", ingredients: ["chocolate"], recipeCategory: [{ name: "Dessert" }] });

const recipes = [...dinners, ...lunches, dessert].map(classifyRecipe);
const start = "2026-11-18";
const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  dates,
  recipes,
  existing: {},
  history: [],
  onHandProteins: new Set(),
  busyDays: [],
  leftovers: true,
  replaceExisting: false,
  random: seeded(42),
  ...over,
});

describe("classifyRecipe", () => {
  it("classifies meal types, speed and leftovers", () => {
    const tikka = recipes.find((r) => r.name === "Chicken Tikka Masala")!;
    expect(tikka.dinnerOk).toBe(true);
    expect(tikka.lunchOk).toBe(false);
    expect(tikka.leftoverFriendly).toBe(true);
    expect(tikka.protein).toBe("chicken");
    const salad = recipes.find((r) => r.name === "Greek Salad")!;
    expect(salad.lunchOk).toBe(true);
    expect(salad.dinnerOk).toBe(false);
    expect(salad.quick).toBe(true);
    const brownies = recipes.find((r) => r.name === "Brownies")!;
    expect(brownies.dinnerOk || brownies.lunchOk).toBe(false);
    expect(recipes.find((r) => r.name === "Never Again Casserole")!.excluded).toBe(true);
  });
});

describe("planWeek", () => {
  it("fills every slot; dinners never repeat; lunches never repeat on back-to-back days", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const days = planWeek(base({ random: seeded(seed) }));
      expect(days).toHaveLength(7);
      const dinnerIds = days.map((d) => d.dinner).filter((p) => p.kind === "recipe").map((p) => p.recipeId);
      expect(new Set(dinnerIds).size).toBe(dinnerIds.length);
      for (let i = 1; i < days.length; i++) {
        const a = days[i - 1]!.lunch;
        const b = days[i]!.lunch;
        if (a.kind === "recipe" && b.kind === "recipe") expect(a.recipeId).not.toBe(b.recipeId);
      }
      // A dish used for dinner is never also served as a (non-leftover) lunch.
      for (const d of days) {
        if (d.lunch.kind === "recipe") expect(dinnerIds).not.toContain(d.lunch.recipeId);
      }
      for (const d of days) {
        expect(d.dinner.kind).not.toBe("empty");
        expect(d.lunch.kind).not.toBe("empty");
        expect(d.dinner.name).not.toBe("Never Again Casserole");
        expect(d.dinner.name).not.toBe("Brownies");
      }
    }
  });

  it("turns leftover-friendly dinners into next-day lunch leftovers", () => {
    const days = planWeek(base());
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1]!.dinner;
      const lunch = days[i]!.lunch;
      if (prev.leftoverFriendly) {
        expect(lunch.kind).toBe("leftovers");
        expect(lunch.name).toBe(`Leftovers: ${prev.name}`);
      } else {
        expect(lunch.kind).not.toBe("leftovers");
      }
    }
  });

  it("uses yesterday's dinner from history for day-one leftovers", () => {
    const tikka = recipes.find((r) => r.name === "Chicken Tikka Masala")!;
    const days = planWeek(base({ history: [{ date: addDays(start, -1), entryType: "dinner", recipeId: tikka.id }] }));
    expect(days[0]!.lunch.kind).toBe("leftovers");
    expect(days[0]!.lunch.name).toContain("Chicken Tikka Masala");
  });

  it("can skip leftovers entirely", () => {
    const days = planWeek(base({ leftovers: false }));
    expect(days.some((d) => d.lunch.kind === "leftovers")).toBe(false);
  });

  it("keeps existing entries unless replacing", () => {
    const tacos = recipes.find((r) => r.name === "Beef Tacos")!;
    const existing = { [slotKey(dates[2]!, "dinner")]: { entryId: 7, recipeId: tacos.id, title: "Beef Tacos" } };
    const kept = planWeek(base({ existing }));
    expect(kept[2]!.dinner.kind).toBe("existing");
    expect(kept[2]!.dinner.entryId).toBe(7);
    expect(kept.filter((d) => d.dinner.recipeId === tacos.id)).toHaveLength(1);
    const replaced = planWeek(base({ existing, replaceExisting: true }));
    expect(replaced[2]!.dinner.kind).not.toBe("existing");
  });

  it("respects locked slots", () => {
    const locked = { [slotKey(dates[0]!, "dinner")]: { kind: "recipe" as const, name: "Lentil Curry", recipeId: recipes.find((r) => r.name === "Lentil Curry")!.id, reasons: [] } };
    for (let seed = 1; seed <= 10; seed++) {
      const days = planWeek(base({ locked, random: seeded(seed) }));
      expect(days[0]!.dinner.name).toBe("Lentil Curry");
      expect(days.filter((d) => d.dinner.name === "Lentil Curry")).toHaveLength(1);
    }
  });

  it("avoids recipes planned in the last week", () => {
    const recent = recipes.filter((r) => r.dinnerOk).slice(0, 3);
    const history = recent.map((r, i) => ({ date: addDays(start, -(i + 1)), entryType: "dinner", recipeId: r.id }));
    let hits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const days = planWeek(base({ history, random: seeded(seed) }));
      hits += days.filter((d) => recent.some((r) => r.id === d.dinner.recipeId) && d.dinner.kind === "recipe").length;
    }
    // 9 dinner recipes for 7 slots means at least one recent dish is forced each week.
    // Picking evenly would average 7 * 3/9 = 2.33 recent dishes a week; the planner should stay near the forced minimum.
    expect(hits / 40).toBeLessThan(1.5);
  });

  it("favors quick dinners on busy days and on-hand proteins", () => {
    let quickOnBusy = 0;
    let chickenDinners = 0;
    const runs = 60;
    for (let seed = 1; seed <= runs; seed++) {
      const days = planWeek(base({ busyDays: [2, 4], onHandProteins: new Set(["chicken"]), random: seeded(seed) }));
      for (const d of days) {
        if (d.busy && d.dinner.kind === "recipe" && recipes.find((r) => r.id === d.dinner.recipeId)!.quick) quickOnBusy++;
        if (d.dinner.protein === "chicken") chickenDinners++;
      }
    }
    // Two busy days per week: most busy-day dinners should be quick.
    expect(quickOnBusy / (runs * 2)).toBeGreaterThan(0.7);
    // Both chicken dinners should show up most weeks.
    expect(chickenDinners / runs).toBeGreaterThan(1.3);
  });

  it("still fills the week from a tiny recipe book, marking repeats", () => {
    const tiny = recipes.filter((r) => ["Beef Tacos", "Salmon Sheet Pan", "Lentil Curry"].includes(r.name));
    const days = planWeek(base({ recipes: tiny, leftovers: false }));
    expect(days.every((d) => d.dinner.kind === "recipe")).toBe(true);
    expect(days.some((d) => d.dinner.reasons.some((r) => r.startsWith("Repeat")))).toBe(true);
    for (let i = 1; i < days.length; i++) expect(days[i]!.dinner.recipeId).not.toBe(days[i - 1]!.dinner.recipeId);
  });

  it("varies proteins on consecutive days", () => {
    let repeats = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const days = planWeek(base({ random: seeded(seed) }));
      for (let i = 1; i < days.length; i++) {
        const a = days[i - 1]!.dinner.protein;
        if (a && a === days[i]!.dinner.protein) repeats++;
      }
    }
    expect(repeats / (40 * 6)).toBeLessThan(0.1);
  });
});
