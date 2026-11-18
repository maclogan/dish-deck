// Rules-based week planner. Pure functions so they can be unit-tested.

import { detectProtein } from "./ingredients.js";
import { ingredientText, type MealieRecipe } from "./mealie.js";
import type { MealType, PlanDay, Proposal } from "./types.js";
import { WEEKDAY_NAMES, addDays, daysBetween, normalize, parseMinutes, weekday } from "./util.js";

export interface PlannerRecipe {
  id: string;
  slug: string;
  name: string;
  tags: string[];
  categories: string[];
  rating: number | null;
  servings: number;
  totalMinutes?: number;
  protein: string | null;
  quick: boolean;
  leftoverFriendly: boolean;
  lunchOk: boolean;
  dinnerOk: boolean;
  excluded: boolean;
  favorite: boolean;
  newToTry: boolean;
}

const LUNCH_WORDS = ["lunch", "sandwich", "salad", "soup", "wrap", "packable", "bowl", "lunchbox"];
const DINNER_WORDS = ["dinner", "main", "main dish", "main course", "entree", "supper"];
const NOT_A_MEAL = ["breakfast", "dessert", "side", "side dish", "drink", "beverage", "snack", "sauce", "condiment", "appetizer", "starter", "baking", "bread"];
const QUICK_WORDS = ["quick", "30 min", "30 minute", "30 minutes", "weeknight", "easy", "fast", "15 min", "20 min"];
const LEFTOVER_WORDS = ["leftover", "leftovers", "makes leftovers", "freezer", "freezer friendly", "meal prep", "batch", "batch cooking"];
const NO_LEFTOVER_WORDS = ["no leftovers", "eat fresh", "best fresh"];
const EXCLUDE_WORDS = ["not again", "never again", "skip"];
const FAVORITE_WORDS = ["go to", "go-to", "favorite", "her favorite", "his favorite", "family favorite"];
const NEW_WORDS = ["new to try", "to try", "try"];

const has = (labels: string[], words: string[]) => {
  const norm = labels.map(normalize);
  return words.some((w) => norm.includes(normalize(w)));
};

export function classifyRecipe(r: MealieRecipe): PlannerRecipe {
  const tags = (r.tags ?? []).map((t) => t.name);
  const categories = (r.recipeCategory ?? []).map((c) => c.name);
  const labels = [...tags, ...categories];
  const ingredients = (r.recipeIngredient ?? []).map(ingredientText).filter(Boolean);
  const totalMinutes = r.totalTimeSeconds ? Math.round(r.totalTimeSeconds / 60) : parseMinutes(r.totalTime);
  const servings = r.recipeServings || r.recipeYieldQuantity || 0;

  const lunchWord = has(labels, LUNCH_WORDS);
  const dinnerWord = has(labels, DINNER_WORDS);
  const notMeal = has(labels, NOT_A_MEAL);

  const lunchOk = lunchWord;
  const dinnerOk = dinnerWord || (!lunchWord && !notMeal);

  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    tags,
    categories,
    rating: r.rating ?? null,
    servings,
    totalMinutes,
    protein: detectProtein(r.name, ingredients),
    quick: (totalMinutes !== undefined && totalMinutes <= 30) || has(labels, QUICK_WORDS),
    leftoverFriendly: !has(labels, NO_LEFTOVER_WORDS) && (servings >= 4 || has(labels, LEFTOVER_WORDS)),
    lunchOk,
    dinnerOk,
    excluded: has(labels, EXCLUDE_WORDS),
    favorite: has(labels, FAVORITE_WORDS),
    newToTry: has(labels, NEW_WORDS),
  };
}

export interface ExistingSlot {
  entryId: number;
  recipeId?: string | null;
  title: string;
}

export interface HistoryEntry {
  date: string;
  entryType: string;
  recipeId?: string | null;
}

export interface PlanInput {
  dates: string[];
  recipes: PlannerRecipe[];
  /** Existing Mealie entries in the window, keyed "date|lunch" / "date|dinner". */
  existing: Record<string, ExistingSlot>;
  /** Past meal plan entries (e.g. the last 3 weeks) for repeat avoidance and day-one leftovers. */
  history: HistoryEntry[];
  onHandProteins: Set<string>;
  busyDays: number[];
  leftovers: boolean;
  replaceExisting: boolean;
  locked?: Record<string, Proposal>;
  random?: () => number;
}

export const slotKey = (date: string, type: MealType) => `${date}|${type}`;

const PROTEIN_LABEL: Record<string, string> = {
  seafood: "seafood", fish: "fish", chicken: "chicken", turkey: "turkey", beef: "beef",
  pork: "pork", lamb: "lamb", plant: "beans/tofu", egg: "eggs",
};

export function planWeek(input: PlanInput): PlanDay[] {
  const random = input.random ?? Math.random;
  const byId = new Map(input.recipes.map((r) => [r.id, r]));
  /** Recipes used as a dinner this week (dinners never repeat while alternatives exist). */
  const usedDinner = new Set<string>();
  /** Dates each recipe was used as a lunch (lunch staples may repeat, with a penalty). */
  const lunchDates = new Map<string, string[]>();
  /** Dates each recipe was used as a dinner. */
  const dinnerDates = new Map<string, string[]>();
  /** Every date each recipe appears this week, for the "not two days in a row" rule. */
  const usedOn = new Map<string, string[]>();
  const proteinCount = new Map<string, number>();

  // Most recent date each recipe was planned before this window.
  const lastPlanned = new Map<string, string>();
  for (const h of input.history) {
    if (!h.recipeId) continue;
    const prev = lastPlanned.get(h.recipeId);
    if (!prev || h.date > prev) lastPlanned.set(h.recipeId, h.date);
  }

  const toProposal = (recipe: PlannerRecipe, kind: Proposal["kind"], reasons: string[], entryId?: number): Proposal => ({
    kind,
    name: recipe.name,
    recipeId: recipe.id,
    slug: recipe.slug,
    protein: recipe.protein,
    reasons,
    entryId,
    leftoverFriendly: recipe.leftoverFriendly && (recipe.dinnerOk || recipe.lunchOk),
  });

  const register = (p: Proposal, type: MealType, date: string) => {
    if (p.kind === "leftovers" || p.kind === "empty") return;
    if (p.recipeId) {
      if (type === "dinner") {
        usedDinner.add(p.recipeId);
        dinnerDates.set(p.recipeId, [...(dinnerDates.get(p.recipeId) ?? []), date]);
      } else lunchDates.set(p.recipeId, [...(lunchDates.get(p.recipeId) ?? []), date]);
      usedOn.set(p.recipeId, [...(usedOn.get(p.recipeId) ?? []), date]);
    }
    if (p.protein) proteinCount.set(p.protein, (proteinCount.get(p.protein) ?? 0) + 1);
  };

  const within = (dates: string[] | undefined, date: string, withinDays: number) =>
    (dates ?? []).some((d) => Math.abs(daysBetween(d, date)) < withinDays);
  const usedRecently = (id: string, date: string, withinDays: number) => within(usedOn.get(id), date, withinDays);

  // The dinner the night before the window starts, for day-one leftovers.
  const firstDate = input.dates[0]!;
  const dayBefore = addDays(firstDate, -1);
  const prevHistoryDinner = input.history.find((h) => h.date === dayBefore && h.entryType === "dinner" && h.recipeId);
  let prevDinner: Proposal | null = null;
  if (prevHistoryDinner?.recipeId) {
    const r = byId.get(prevHistoryDinner.recipeId);
    if (r) prevDinner = toProposal(r, "existing", []);
  }
  let prevDinnerDate = dayBefore;

  const pick = (type: MealType, date: string, busy: boolean, prevProtein: string | null | undefined): Proposal => {
    const ok = input.recipes.filter((r) => !r.excluded);
    let repeat = false;
    let pool: PlannerRecipe[];

    if (type === "dinner") {
      pool = ok.filter((r) => r.dinnerOk && !usedDinner.has(r.id) && !lunchDates.has(r.id));
      if (pool.length === 0) {
        // Small recipe book: allow a repeat, just not as dinner within two days or as today's lunch.
        pool = ok.filter((r) => r.dinnerOk && !within(dinnerDates.get(r.id), date, 3) && !usedRecently(r.id, date, 1));
        repeat = true;
      }
    } else {
      // Lunch staples can repeat during the week (penalized below), but not two days running.
      pool = ok.filter((r) => r.lunchOk && !usedDinner.has(r.id) && !usedRecently(r.id, date, 2));
      if (pool.length === 0) {
        pool = ok.filter((r) => r.dinnerOk && r.quick && !usedDinner.has(r.id) && !usedRecently(r.id, date, 2));
      }
      if (pool.length === 0) {
        pool = ok.filter((r) => (r.lunchOk || r.dinnerOk) && !usedRecently(r.id, date, 2));
        repeat = true;
      }
    }
    if (pool.length === 0) {
      return { kind: "empty", name: "Nothing left to pick", reasons: ["Add more recipes to Mealie"] };
    }

    const scored = pool.map((r) => {
      let score = 0;
      const reasons: string[] = [];

      const lunchUses = lunchDates.get(r.id)?.length ?? 0;
      if (type === "lunch" && lunchUses) score -= 1.2 * lunchUses;
      if (repeat && usedOn.has(r.id)) {
        score -= 2;
        reasons.push("Repeat: add more recipes for variety");
      }

      if (r.rating) {
        score += (r.rating - 3) * 0.6;
        if (r.rating >= 4.5) reasons.push("Highly rated");
      }

      const last = lastPlanned.get(r.id);
      if (last) {
        const since = daysBetween(last, date);
        if (since < 7) score -= 4;
        else if (since < 14) score -= 1.5;
        else if (since >= 21) {
          score += 0.5;
          reasons.push("Haven't had it in 3+ weeks");
        }
      }

      if (r.protein) {
        if (r.protein === prevProtein) score -= 1.5;
        score -= (proteinCount.get(r.protein) ?? 0) * 0.8;
        if (input.onHandProteins.has(r.protein)) {
          score += 1.5;
          reasons.unshift(`Uses ${PROTEIN_LABEL[r.protein] ?? r.protein} you have on hand`);
        }
      }

      if (type === "dinner" && busy) {
        if (r.quick) {
          score += 1.5;
          reasons.unshift("Quick for a busy day");
        } else score -= 3;
      }
      if (type === "lunch" && r.quick) score += 0.5;
      if (r.favorite) {
        score += 0.6;
        reasons.push("A go-to");
      }
      if (r.newToTry) {
        score += 0.3;
        reasons.push("New one to try");
      }
      if (type === "dinner" && r.leftoverFriendly && input.leftovers) score += 0.3;

      return { r, score, reasons };
    });

    // Weighted random choice: better scores are much more likely, but not guaranteed.
    const weights = scored.map((s) => Math.exp(s.score));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = random() * total;
    let chosen = scored[scored.length - 1]!;
    for (let i = 0; i < scored.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) {
        chosen = scored[i]!;
        break;
      }
    }
    if (type === "dinner" && chosen.r.leftoverFriendly && input.leftovers) {
      chosen.reasons.push("Makes leftovers for tomorrow's lunch");
    }
    return toProposal(chosen.r, "recipe", chosen.reasons.slice(0, 2));
  };

  const fill = (date: string, type: MealType, busy: boolean): Proposal => {
    const key = slotKey(date, type);
    const locked = input.locked?.[key];
    if (locked) {
      register(locked, type, date);
      return locked;
    }

    const existing = input.existing[key];
    if (existing && !input.replaceExisting) {
      const r = existing.recipeId ? byId.get(existing.recipeId) : undefined;
      const p: Proposal = r
        ? toProposal(r, "existing", ["Already planned"], existing.entryId)
        : { kind: "existing", name: existing.title || "Planned", reasons: ["Already planned"], entryId: existing.entryId };
      register(p, type, date);
      return p;
    }

    if (
      type === "lunch" &&
      input.leftovers &&
      prevDinner &&
      prevDinner.leftoverFriendly &&
      (prevDinner.kind === "recipe" || prevDinner.kind === "existing") &&
      daysBetween(prevDinnerDate, date) === 1
    ) {
      return {
        kind: "leftovers",
        name: `Leftovers: ${prevDinner.name}`,
        recipeId: prevDinner.recipeId,
        slug: prevDinner.slug,
        protein: prevDinner.protein,
        reasons: [`From ${WEEKDAY_NAMES[weekday(prevDinnerDate)]}'s dinner`],
      };
    }

    // Avoid repeating the protein from the most recent dinner.
    const p = pick(type, date, busy, prevDinner?.protein);
    register(p, type, date);
    return p;
  };

  const days: PlanDay[] = [];
  for (const date of input.dates) {
    const wd = weekday(date);
    const busy = input.busyDays.includes(wd);
    const lunch = fill(date, "lunch", busy);
    const dinner = fill(date, "dinner", busy);
    days.push({ date, weekday: wd, busy, lunch, dinner });
    prevDinner = dinner;
    prevDinnerDate = date;
  }
  return days;
}
