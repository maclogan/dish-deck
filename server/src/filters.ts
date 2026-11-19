// Dietary, meal and nutrition filters shared by every recipe source.
//
// Dietary restrictions are enforced by scanning ingredient lines for keywords, so they apply
// the same way to TheMealDB, AI ideas and saved Mealie recipes. Nutrition goals need
// per-serving numbers, which only AI ideas (estimates) and some Mealie recipes have.

import type { Card, DietId, FilterOption, GoalId, MealFilter, Nutrition, StyleId } from "./types.js";
import { normalize } from "./util.js";

export const DIETS: FilterOption<DietId>[] = [
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "pescatarian", label: "Pescatarian" },
  { id: "gluten-free", label: "Gluten-free" },
  { id: "dairy-free", label: "Dairy-free" },
  { id: "egg-free", label: "Egg-free" },
  { id: "nut-free", label: "Nut-free" },
  { id: "shellfish-free", label: "Shellfish-free" },
  { id: "soy-free", label: "Soy-free" },
];

export const MEALS: FilterOption<MealFilter>[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "dessert", label: "Dessert" },
  { id: "snack", label: "Snack" },
];

interface GoalDef extends FilterOption<GoalId> {
  /** How to ask the AI for it. */
  prompt: string;
  /** Pass/fail on per-serving nutrition; undefined when the needed number is missing. */
  check: (n: Nutrition) => boolean | undefined;
}

const atMost = (v: number | undefined, max: number) => (v === undefined ? undefined : v <= max);
const atLeast = (v: number | undefined, min: number) => (v === undefined ? undefined : v >= min);

const GOAL_DEFS: GoalDef[] = [
  { id: "low-calorie", label: "Low calorie", prompt: "low calorie (500 kcal or less per serving)", check: (n) => atMost(n.calories, 500) },
  { id: "low-carb", label: "Low carb", prompt: "low carb (25 g net carbs or less per serving)", check: (n) => atMost(n.carbs, 25) },
  { id: "keto", label: "Keto", prompt: "keto (10 g net carbs or less per serving, higher fat)", check: (n) => atMost(n.carbs, 10) },
  { id: "high-protein", label: "High protein", prompt: "high protein (30 g or more per serving)", check: (n) => atLeast(n.protein, 30) },
  { id: "high-fiber", label: "High fiber", prompt: "high fiber (8 g or more per serving)", check: (n) => atLeast(n.fiber, 8) },
  { id: "low-fat", label: "Low fat", prompt: "low fat (15 g or less per serving)", check: (n) => atMost(n.fat, 15) },
];

export const GOALS: FilterOption<GoalId>[] = GOAL_DEFS.map(({ id, label }) => ({ id, label }));

interface StyleDef extends FilterOption<StyleId> {
  /** How to ask the AI for it. */
  prompt: string;
}

const STYLE_DEFS: StyleDef[] = [
  {
    id: "home",
    label: "Home-style",
    prompt:
      "Suggest dishes people actually cook at home in the places these cuisines come from: everyday family cooking and well-loved regional dishes, made the traditional way. " +
      "Do not suggest Western restaurant or takeout adaptations (for Chinese, no General Tso's, orange chicken, sweet and sour pork, crab rangoon, chop suey, egg foo young) " +
      "and do not simplify, Americanize or substitute away traditional ingredients. Specialty ingredients are welcome; use them whenever the dish calls for them.",
  },
  {
    id: "weeknight",
    label: "Weeknight shortcuts",
    prompt:
      "Suggest real dishes from these cuisines with smart shortcuts for a weeknight: about 40 minutes or less, fewer steps, but still recognisably the traditional dish and its key ingredients.",
  },
  {
    id: "takeout",
    label: "Takeout favorites",
    prompt: "Suggest restaurant and takeout favorites (including Western-adapted dishes) made at home, better than delivery.",
  },
];

export const STYLES: FilterOption<StyleId>[] = STYLE_DEFS.map(({ id, label }) => ({ id, label }));
export const STYLE_IDS = STYLES.map((s) => s.id) as [StyleId, ...StyleId[]];
export const stylePrompt = (id: StyleId) => STYLE_DEFS.find((s) => s.id === id)?.prompt ?? STYLE_DEFS[0]!.prompt;
export const styleLabel = (id: StyleId) => STYLE_DEFS.find((s) => s.id === id)?.label ?? id;

export const DIET_IDS = DIETS.map((d) => d.id) as [DietId, ...DietId[]];
export const MEAL_IDS = MEALS.map((m) => m.id) as [MealFilter, ...MealFilter[]];
export const GOAL_IDS = GOALS.map((g) => g.id) as [GoalId, ...GoalId[]];

export const dietLabel = (id: DietId) => DIETS.find((d) => d.id === id)?.label ?? id;
export const mealLabel = (id: MealFilter) => MEALS.find((m) => m.id === id)?.label ?? id;
export const goalLabel = (id: GoalId) => GOAL_DEFS.find((g) => g.id === id)?.label ?? id;
export const goalPrompt = (id: GoalId) => GOAL_DEFS.find((g) => g.id === id)?.prompt ?? id;

// ------------------------------------------------------------------ dietary

const MEAT = [
  "beef", "steak", "brisket", "veal", "pork", "bacon", "ham", "gammon", "sausage", "sausages", "chorizo", "pancetta",
  "prosciutto", "salami", "pepperoni", "lamb", "mutton", "goat", "chicken", "turkey", "duck", "goose", "venison",
  "rabbit", "mince", "ground meat", "meatballs", "ribs", "oxtail", "liver", "kidney", "lard", "suet", "gelatin",
  "gelatine", "bone broth", "beef stock", "chicken stock", "beef broth", "chicken broth", "black pudding", "hot dog",
];
const MEAT_OK = ["vegetable stock", "vegetable broth", "kidney beans", "kidney bean", "vegetarian sausages", "veggie sausages", "meatless"];
const FISH = [
  "fish", "salmon", "tuna", "cod", "haddock", "anchovy", "anchovies", "sardine", "sardines", "mackerel", "trout",
  "tilapia", "halibut", "sea bass", "snapper", "monkfish", "herring", "kipper", "kippers", "pollock", "swordfish",
  "catfish", "fish sauce", "worcestershire", "bonito", "dashi", "caviar", "roe",
];
const SHELLFISH = [
  "shrimp", "shrimps", "prawn", "prawns", "crab", "lobster", "clam", "clams", "mussel", "mussels", "oyster", "oysters",
  "oyster sauce", "scallop", "scallops", "squid", "calamari", "octopus", "crayfish", "langoustine", "langoustines",
];
const DAIRY = [
  "milk", "butter", "cheese", "cream", "yogurt", "yoghurt", "ghee", "parmesan", "parmigiano", "pecorino", "mozzarella",
  "cheddar", "feta", "ricotta", "mascarpone", "buttermilk", "creme fraiche", "custard", "whey", "paneer", "brie",
  "gruyere", "halloumi", "gouda", "camembert", "provolone", "monterey jack", "goats cheese", "condensed milk",
  "evaporated milk", "ice cream", "sour cream",
];
const DAIRY_OK = [
  "coconut milk", "coconut cream", "almond milk", "oat milk", "soy milk", "soya milk", "rice milk", "cashew milk",
  "peanut butter", "almond butter", "cashew butter", "nut butter", "cocoa butter", "apple butter", "cream of tartar",
  "vegan butter", "vegan cheese", "butter lettuce", "dairy free", "non dairy", "butter beans", "butternut", "buttercup squash",
];
const EGG = ["egg", "eggs", "egg yolk", "egg yolks", "egg white", "egg whites", "mayonnaise", "mayo", "meringue", "aioli"];
const EGG_OK = ["vegan mayo", "vegan mayonnaise", "egg free", "eggless"];
const GLUTEN = [
  "flour", "wheat", "bread", "breadcrumbs", "panko", "pasta", "spaghetti", "noodles", "couscous", "barley", "rye",
  "bulgur", "semolina", "soy sauce", "beer", "ale", "tortilla", "tortillas", "pastry", "filo", "phyllo", "crackers",
  "biscuit", "biscuits", "seitan", "orzo", "lasagne", "lasagna", "macaroni", "penne", "fettuccine", "linguine",
  "tagliatelle", "ravioli", "tortellini", "gnocchi", "farro", "spelt", "wonton", "dumpling", "pita", "pitta", "naan",
  "bun", "buns", "baguette", "brioche", "croissant", "croutons", "malt", "cake", "cookies", "graham", "rigatoni",
  "fusilli", "farfalle", "vermicelli", "udon", "ramen", "teriyaki sauce", "hoisin", "self raising", "self rising",
];
const GLUTEN_OK = [
  "gluten free", "rice flour", "almond flour", "coconut flour", "corn flour", "cornflour", "chickpea flour",
  "gram flour", "tapioca flour", "potato flour", "buckwheat flour", "rice noodles", "glass noodles", "rice vermicelli",
  "corn tortilla", "corn tortillas", "tortilla chips", "tamari", "rice paper", "cornbread mix gluten free", "gluten free soy sauce",
];
const NUTS = [
  "nut", "nuts", "almond", "almonds", "cashew", "cashews", "walnut", "walnuts", "pecan", "pecans", "pistachio",
  "pistachios", "hazelnut", "hazelnuts", "macadamia", "brazil nut", "pine nut", "pine nuts", "peanut", "peanuts",
  "praline", "marzipan", "nutella", "satay", "frangipane", "amaretto", "almond extract", "groundnut",
];
const NUTS_OK = ["nut free", "coconut", "butternut", "nutmeg", "water chestnut", "water chestnuts", "doughnut", "donut"];
const SOY = ["soy", "soya", "tofu", "tempeh", "edamame", "miso", "tamari", "soy sauce", "soybean", "soybeans"];
const HONEY = ["honey"];

const DIET_RULES: Record<DietId, { banned: string[]; allowed: string[] }> = {
  vegetarian: { banned: [...MEAT, ...FISH, ...SHELLFISH], allowed: [...MEAT_OK, "goat cheese", "goats cheese", "vegetarian"] },
  vegan: {
    banned: [...MEAT, ...FISH, ...SHELLFISH, ...DAIRY, ...EGG, ...HONEY],
    allowed: [...MEAT_OK, ...DAIRY_OK, ...EGG_OK, "vegan"],
  },
  pescatarian: { banned: MEAT, allowed: [...MEAT_OK, "goat cheese", "goats cheese"] },
  "gluten-free": { banned: GLUTEN, allowed: GLUTEN_OK },
  "dairy-free": { banned: DAIRY, allowed: DAIRY_OK },
  "egg-free": { banned: EGG, allowed: EGG_OK },
  "nut-free": { banned: NUTS, allowed: NUTS_OK },
  "shellfish-free": { banned: SHELLFISH, allowed: [] },
  "soy-free": { banned: SOY, allowed: [] },
};

const phrase = (words: string[]) =>
  new RegExp(`(?:^| )(?:${words.map(normalize).sort((a, b) => b.length - a.length).join("|")})(?= |$)`);

const COMPILED = Object.fromEntries(
  Object.entries(DIET_RULES).map(([id, r]) => [id, { banned: phrase(r.banned), allowed: r.allowed.length ? phrase(r.allowed) : null }]),
) as Record<DietId, { banned: RegExp; allowed: RegExp | null }>;

/** The first ingredient line that breaks a restriction, or undefined when the dish fits all of them. */
export function dietViolation(ingredients: string[], diets: DietId[]): { diet: DietId; ingredient: string } | undefined {
  for (const diet of diets) {
    const rule = COMPILED[diet];
    for (const line of ingredients) {
      let text = normalize(line);
      // Strip safe phrases ("coconut milk", "rice flour") before looking for banned words.
      if (rule.allowed) text = text.replace(new RegExp(rule.allowed.source, "g"), " ");
      if (rule.banned.test(text)) return { diet, ingredient: line };
    }
  }
  return undefined;
}

export const fitsDiet = (ingredients: string[], diets: DietId[]) => !diets.length || !dietViolation(ingredients, diets);

/** TheMealDB category that best matches a diet, used to fetch candidates that are likely to pass. */
export function mealDbCategoryForDiet(diets: DietId[]): string | undefined {
  if (diets.includes("vegan")) return "Vegan";
  if (diets.includes("vegetarian")) return "Vegetarian";
  return undefined;
}

// ------------------------------------------------------------------ meals

const MEAL_WORDS: Record<MealFilter, string[]> = {
  breakfast: ["breakfast", "brunch"],
  lunch: ["lunch"],
  dinner: ["dinner", "supper", "main", "main course", "entree"],
  dessert: ["dessert", "desserts", "sweet", "sweets", "baking", "cake", "cookies"],
  snack: ["snack", "snacks", "appetizer", "appetizers", "starter", "starters", "side", "side dish", "sides"],
};
const NOT_A_MAIN: MealFilter[] = ["breakfast", "dessert", "snack"];

export const isMainMeal = (meal: MealFilter) => !NOT_A_MAIN.includes(meal);

/**
 * TheMealDB categories that cover the chosen meals. Empty means no category restriction: lunch and
 * dinner can be any main-course category, so picking either of them leaves the categories open.
 */
export function mealDbCategoriesForMeals(meals: MealFilter[]): string[] {
  if (!meals.length || meals.some(isMainMeal)) return [];
  const cats: string[] = [];
  if (meals.includes("breakfast")) cats.push("Breakfast");
  if (meals.includes("dessert")) cats.push("Dessert");
  if (meals.includes("snack")) cats.push("Starter", "Side");
  return cats;
}

/** Does a dish fit one meal? Uses its category and tags. */
function fitsOneMeal(labels: string[], suits: Card["suits"], meal: MealFilter): boolean {
  const has = (m: MealFilter) => labels.some((l) => MEAL_WORDS[m].includes(l));
  if (!isMainMeal(meal)) return has(meal);
  // Lunch/dinner accept any dish not marked as breakfast, dessert or a snack,
  // since most recipes aren't tagged with a meal at all.
  if (NOT_A_MAIN.some(has)) return false;
  if (suits && suits.length === 0) return false;
  return true;
}

/** Does a dish fit any of the chosen meals? No meals chosen means anything goes. */
export function fitsMeal(card: Pick<Card, "category" | "tags" | "suits">, meals: MealFilter[]): boolean {
  if (!meals.length) return true;
  const labels = [card.category ?? "", ...card.tags].map(normalize).filter(Boolean);
  return meals.some((m) => fitsOneMeal(labels, card.suits, m));
}

// ------------------------------------------------------------------ goals

/**
 * Does a dish meet any of the goals? Checks per-serving nutrition, then falls back to tags (a saved
 * recipe tagged "High Protein" counts). Missing numbers with no matching tag fail, since we can't tell.
 */
export function fitsGoals(card: Pick<Card, "nutrition" | "tags">, goals: GoalId[]): boolean {
  if (!goals.length) return true;
  const tags = new Set(card.tags.map(normalize));
  return goals.some((id) => {
    const def = GOAL_DEFS.find((g) => g.id === id)!;
    const byNumbers = card.nutrition ? def.check(card.nutrition) : undefined;
    if (byNumbers !== undefined) return byNumbers;
    return tags.has(normalize(def.label)) || tags.has(normalize(def.id));
  });
}

/** Read a number out of Mealie's free-text nutrition values ("350 kcal", "25g", "12.5"). */
export function parseNutrient(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const m = value?.match(/\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : undefined;
}
