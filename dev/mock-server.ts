// Local stand-in for Mealie + TheMealDB, for developing the UI without touching real data.
// Run: npx tsx dev/mock-server.ts   (listens on :9100)
// Then: MEALIE_URL=http://localhost:9100 MEALIE_TOKEN=dev MEALDB_BASE_URL=http://localhost:9100 npm run dev:server

import Fastify from "fastify";

const ALL_AREAS = ["Algerian", "American", "Argentinian", "Australian", "British", "Canadian", "Chinese", "Croatian", "Dutch", "Egyptian", "Filipino", "French", "Greek", "Indian", "Irish", "Italian", "Jamaican", "Japanese", "Kenyan", "Malaysian", "Mexican", "Moroccan", "Norwegian", "Polish", "Portuguese", "Russian", "Saudi Arabian", "Slovakian", "Spanish", "Syrian", "Thai", "Tunisian", "Turkish", "Ukrainian", "Uruguayan", "Venezulan", "Vietnamese"];
const app = Fastify();
let nextRecipe = 1;
let nextPlan = 1;

const svg = (seed: number, label: string) => {
  const palettes = [
    ["#c2410c", "#fdba74", "#fef3c7"],
    ["#3f6212", "#a3e635", "#f7fee7"],
    ["#9f1239", "#fda4af", "#fff1f2"],
    ["#854d0e", "#facc15", "#fefce8"],
    ["#155e75", "#67e8f9", "#ecfeff"],
    ["#7c2d12", "#fb923c", "#fff7ed"],
  ];
  const [a, b, c] = palettes[seed % palettes.length]!;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></radialGradient></defs>
  <rect width="400" height="300" fill="url(#g)"/>
  <ellipse cx="200" cy="160" rx="120" ry="95" fill="${c}" opacity=".95"/>
  <ellipse cx="200" cy="160" rx="85" ry="66" fill="${b}"/>
  <circle cx="175" cy="145" r="18" fill="${a}" opacity=".7"/><circle cx="225" cy="170" r="14" fill="${a}" opacity=".6"/>
  <circle cx="205" cy="135" r="9" fill="${c}"/><circle cx="185" cy="180" r="11" fill="${c}" opacity=".8"/>
  <text x="16" y="286" font-family="sans-serif" font-size="14" fill="${c}" opacity=".8">${label}</text>
</svg>`;
};

// ---------------------------------------------------------------- Mealie data
type Recipe = {
  id: string; slug: string; name: string; description: string; image: string | null;
  recipeServings: number; totalTimeSeconds: number; rating: number | null;
  tags: { name: string }[]; recipeCategory: { name: string }[];
  recipeIngredient: { display: string }[]; recipeInstructions: { text: string }[];
  dateUpdated: string;
  /** Mealie: dateAdded is just the day; createdAt is the full timestamp. */
  dateAdded: string;
  createdAt: string;
};

const savedStamp = (n: number) => {
  const t = new Date(Date.UTC(2026, 10, 1 + Math.floor(n / 3), 18, n * 7 % 60, 0));
  return { dateAdded: t.toISOString().slice(0, 10), createdAt: t.toISOString().replace("Z", "") };
};

const mk = (name: string, opts: Partial<Recipe> & { ing: string[]; cat?: string; mins?: number; serves?: number; tags?: string[] }): Recipe => {
  const n = nextRecipe++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    description: opts.description ?? "",
    image: "img",
    recipeServings: opts.serves ?? 4,
    totalTimeSeconds: (opts.mins ?? 40) * 60,
    rating: opts.rating ?? null,
    tags: (opts.tags ?? []).map((t) => ({ name: t })),
    recipeCategory: [{ name: opts.cat ?? "Dinner" }],
    recipeIngredient: opts.ing.map((d) => ({ display: d })),
    recipeInstructions: [{ text: "Prep the ingredients." }, { text: "Cook until done." }, { text: "Serve warm." }],
    dateUpdated: "2026-11-01T00:00:00",
    // Several recipes saved on the same day, a few minutes apart (the newest-saved sort has to tell them apart).
    ...savedStamp(n),
  };
};

const recipes: Recipe[] = [
  mk("Chicken Tikka Masala", { ing: ["2 lb chicken thighs", "1 cup plain yogurt", "1 can crushed tomatoes", "1 cup heavy cream", "2 tbsp garam masala"], serves: 6, rating: 5, tags: ["Indian", "go-to"], description: "Creamy, mildly spiced, better the next day." }),
  mk("Beef Tacos", { ing: ["1 lb ground beef", "8 corn tortillas", "1 packet taco seasoning", "1 cup shredded cheese"], mins: 25, tags: ["weeknight"] }),
  mk("Sheet Pan Salmon", { ing: ["4 salmon fillets", "1 lb asparagus", "1 lemon"], mins: 25, serves: 2, rating: 4 }),
  mk("Pork Carnitas", { ing: ["3 lb pork shoulder", "1 orange", "1 onion"], mins: 240, serves: 8 }),
  mk("Red Lentil Curry", { ing: ["1 cup red lentils", "1 can coconut milk", "1 onion", "2 cups spinach"], serves: 4, tags: ["vegetarian"] }),
  mk("Chicken Stir Fry", { ing: ["1 lb chicken breast", "2 cups broccoli", "3 tbsp soy sauce", "2 cups rice"], mins: 20, serves: 2 }),
  mk("Shrimp Scampi", { ing: ["1 lb shrimp", "12 oz linguine", "4 cloves garlic", "1 lemon"], mins: 25, serves: 3 }),
  mk("Turkey Chili", { ing: ["1 lb ground turkey", "2 cans kidney beans", "1 can diced tomatoes", "1 onion"], serves: 6, tags: ["freezer friendly"] }),
  mk("Mushroom Risotto", { ing: ["1 cup arborio rice", "8 oz mushrooms", "4 cups broth", "1/2 cup parmesan"], serves: 2 }),
  mk("Turkey Club Sandwich", { ing: ["4 slices turkey", "2 slices bread", "2 strips bacon", "lettuce"], cat: "Lunch", mins: 10, serves: 1 }),
  mk("Greek Salad", { ing: ["1 cucumber", "1 cup cherry tomatoes", "4 oz feta", "1/4 cup olives"], cat: "Lunch", mins: 15, serves: 2 }),
  mk("Tomato Basil Soup", { ing: ["2 cans whole tomatoes", "1 onion", "1/2 cup cream", "basil"], cat: "Lunch", serves: 4 }),
  mk("Chocolate Chip Cookies", { ing: ["2 cups flour", "1 cup chocolate chips"], cat: "Dessert" }),
];

const foods = [
  { id: "f1", name: "chicken thigh", aliases: [{ name: "chicken thighs" }], householdsWithIngredientFood: ["family"] },
  { id: "f2", name: "soy sauce", householdsWithIngredientFood: ["family"] },
  { id: "f3", name: "rice", householdsWithIngredientFood: ["family"] },
  { id: "f4", name: "onion", householdsWithIngredientFood: ["family"] },
  { id: "f5", name: "garlic", householdsWithIngredientFood: ["family"] },
  { id: "f6", name: "lemon", householdsWithIngredientFood: ["family"] },
  { id: "f7", name: "brown sugar", householdsWithIngredientFood: ["family"] },
  { id: "f8", name: "lobster", householdsWithIngredientFood: [] },
];

type Plan = { id: number; date: string; entryType: string; title: string; text: string; recipeId: string | null };
const plans: Plan[] = [];

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (n: number) => iso(new Date(today.getTime() + n * 86400000));
plans.push({ id: nextPlan++, date: plus(1), entryType: "dinner", title: "", text: "", recipeId: recipes[1]!.id });
plans.push({ id: nextPlan++, date: plus(-1), entryType: "dinner", title: "", text: "", recipeId: recipes[0]!.id });

const withRecipe = (p: Plan) => ({ ...p, recipe: recipes.find((r) => r.id === p.recipeId) ?? null });

app.addHook("onRequest", async (req) => {
  if (req.url.startsWith("/api/") && !req.url.startsWith("/api/json") && !req.url.startsWith("/api/media")) {
    if (req.headers.authorization !== "Bearer dev") throw Object.assign(new Error("bad token"), { statusCode: 401 });
  }
});

app.get("/api/users/self", async () => ({ id: "u1", groupSlug: "home", householdSlug: "family" }));
app.get<{ Querystring: Record<string, string> }>("/api/recipes", async (req) => {
  const items = req.query.orderBy === "random" ? [...recipes].sort(() => Math.random() - 0.5) : recipes;
  return { items: req.query.search ? items.filter((r) => r.name.toLowerCase().includes(req.query.search!.toLowerCase())) : items };
});
app.get("/api/recipes/suggestions", async (req) => {
  const q = new URL(req.url, "http://x").searchParams;
  const have = new Set(foods.filter((f) => q.getAll("foods").includes(f.id)).flatMap((f) => [f.name, ...(f.aliases ?? []).map((a) => a.name)]));
  const max = Number(q.get("maxMissingFoods") ?? 5);
  const items = recipes
    .map((r) => {
      const missing = r.recipeIngredient.filter((i) => ![...have].some((h) => i.display.toLowerCase().includes(h)));
      return { recipe: r, missingFoods: missing.map((m, i) => ({ id: `m${i}`, name: m.display.replace(/^[\d/.\s]+(cups?|cans?|lb|oz|tbsp|tsp|cloves?|slices?|strips?|packet)?\s*/i, "") })) };
    })
    .filter((x) => x.missingFoods.length <= max)
    .sort((a, b) => a.missingFoods.length - b.missingFoods.length);
  return { items };
});
app.get<{ Params: { slug: string } }>("/api/recipes/:slug", async (req, reply) => {
  const r = recipes.find((x) => x.slug === req.params.slug || x.id === req.params.slug);
  return r ?? reply.code(404).send({ detail: "Not found" });
});
app.post<{ Body: { data: string } }>("/api/recipes/create/html-or-json", async (req, reply) => {
  const schema = JSON.parse(req.body.data);
  const r = mk(schema.name, { ing: schema.recipeIngredient ?? [], tags: String(schema.keywords ?? "").split(",").map((s: string) => s.trim()).filter(Boolean) });
  r.image = null;
  const now = new Date();
  r.createdAt = now.toISOString().replace("Z", "");
  r.dateAdded = now.toISOString().slice(0, 10);
  recipes.push(r);
  return reply.code(201).send(JSON.stringify(r.slug));
});
app.post<{ Params: { slug: string } }>("/api/recipes/:slug/image", async (req) => {
  const r = recipes.find((x) => x.slug === req.params.slug);
  if (r) r.image = "img";
  return { image: "img" };
});
app.get("/api/foods", async () => ({ items: foods }));
app.get<{ Querystring: { start_date: string; end_date: string } }>("/api/households/mealplans", async (req) => ({
  items: plans.filter((p) => p.date >= req.query.start_date && p.date <= req.query.end_date).map(withRecipe),
}));
app.post<{ Body: Omit<Plan, "id"> }>("/api/households/mealplans", async (req, reply) => {
  const p = { id: nextPlan++, ...req.body };
  plans.push(p);
  return reply.code(201).send(withRecipe(p));
});
app.delete<{ Params: { id: string } }>("/api/households/mealplans/:id", async (req) => {
  const i = plans.findIndex((p) => p.id === Number(req.params.id));
  return plans.splice(i, 1)[0];
});
app.get<{ Params: { id: string } }>("/api/media/recipes/:id/images/min-original.webp", async (req, reply) => {
  const n = Number(req.params.id.slice(-4));
  return reply.type("image/svg+xml").send(svg(n, ""));
});

// ---------------------------------------------------------------- TheMealDB data
const meal = (id: number, name: string, area: string, category: string, ings: [string, string][], tags = "") => {
  const m: Record<string, string> = {
    idMeal: String(id), strMeal: name, strArea: area, strCategory: category, strTags: tags,
    strMealThumb: `http://localhost:9100/img/${id}.svg`, strSource: "",
    strInstructions: "STEP 1\r\nPrep everything.\r\nSTEP 2\r\nCook it through.\r\nSTEP 3\r\nServe.",
  };
  ings.forEach(([measure, ing], i) => {
    m[`strIngredient${i + 1}`] = ing;
    m[`strMeasure${i + 1}`] = measure;
  });
  return m;
};
const meals = [
  meal(52772, "Teriyaki Chicken Casserole", "Japanese", "Chicken", [["3/4 cup", "soy sauce"], ["1/2 cup", "water"], ["1/4 cup", "brown sugar"], ["1/2 tsp", "garlic"], ["2", "chicken breasts"], ["3 cups", "rice"]], "Meat,Casserole"),
  meal(52874, "Beef and Mustard Pie", "British", "Beef", [["1kg", "beef"], ["2 tbs", "plain flour"], ["2", "onions"], ["1 sheet", "puff pastry"]], "Pie"),
  meal(52959, "Baked Salmon with Fennel", "British", "Seafood", [["2", "fennel bulbs"], ["2", "salmon fillets"], ["1", "lemon"], ["1 tbs", "olive oil"]]),
  meal(52977, "Corba", "Turkish", "Side", [["1 cup", "lentils"], ["1", "onion"], ["1", "carrot"], ["4 cups", "water"]], "Soup"),
  meal(53013, "Big Mac", "American", "Beef", [["400g", "minced beef"], ["2", "sesame seed burger buns"], ["2 slices", "cheese"], ["1", "onion"]]),
  meal(52844, "Lasagne", "Italian", "Pasta", [["1 tbs", "olive oil"], ["500g", "minced beef"], ["1", "onion"], ["2 cloves", "garlic"], ["9 sheets", "lasagne sheets"]]),
  meal(52806, "Tandoori Chicken", "Indian", "Chicken", [["8", "chicken thighs"], ["150g", "yogurt"], ["1", "lemon"], ["2 tsp", "garam masala"]]),
  meal(52807, "Pad See Ew", "Thai", "Chicken", [["2 cups", "rice noodles"], ["1", "chicken breast"], ["2 tbsp", "soy sauce"], ["2 cloves", "garlic"], ["1 bunch", "chinese broccoli"]]),
  meal(52908, "Ratatouille", "French", "Vegetarian", [["2", "aubergine"], ["2", "courgettes"], ["1", "onion"], ["2 cloves", "garlic"], ["400g", "tomatoes"]]),
  meal(52855, "Banana Pancakes", "American", "Dessert", [["1", "banana"], ["2", "eggs"], ["1 pinch", "baking powder"]]),
];
const find = (id: string) => meals.find((m) => m.idMeal === id);

app.get<{ Params: { file: string }; Querystring: Record<string, string> }>("/api/json/v1/:key/:file", async (req) => {
  const q = req.query;
  switch (req.params.file) {
    case "random.php":
      return { meals: [meals[Math.floor(Math.random() * meals.length)]] };
    case "lookup.php":
      return { meals: find(q.i!) ? [find(q.i!)] : null };
    case "search.php": {
      const hits = meals.filter((m) => m.strMeal!.toLowerCase().includes((q.s ?? "").toLowerCase()));
      return { meals: hits.length ? hits : null };
    }
    case "filter.php": {
      const hits = meals.filter((m) =>
        q.a ? m.strArea === q.a : q.c ? m.strCategory === q.c : Object.keys(m).some((k) => k.startsWith("strIngredient") && m[k]!.toLowerCase().includes((q.i ?? "").replace(/_/g, " ").toLowerCase())),
      );
      return { meals: hits.length ? hits.map((m) => ({ idMeal: m.idMeal, strMeal: m.strMeal, strMealThumb: m.strMealThumb })) : null };
    }
    case "list.php":
      // TheMealDB's real area list is long; mirror it so the cuisine picker looks like production.
      if (q.a) return { meals: [...new Set([...meals.map((m) => m.strArea!), ...ALL_AREAS])].sort().map((strArea) => ({ strArea })) };
      return { meals: [...new Set(meals.map((m) => m.strCategory))].sort().map((strCategory) => ({ strCategory })) };
    default:
      return { meals: null };
  }
});
app.get<{ Params: { id: string } }>("/img/:id", async (req, reply) => {
  const id = Number(req.params.id.replace(".svg", ""));
  return reply.type("image/svg+xml").send(svg(id, ""));
});

// ---------------------------------------------------------------- fake Claude (Messages API)
// Start the app with ANTHROPIC_API_KEY=dev ANTHROPIC_BASE_URL=http://localhost:9100 to try AI mode offline.
const AI_DISHES = ["Miso Butter Salmon", "Lemongrass Chicken Bowls", "Smoky Black Bean Chili", "Gochujang Pork Tacos", "Coconut Lentil Soup", "Herby Orzo Skillet", "Crispy Gnocchi Bake", "Ginger Scallion Noodles", "Chipotle Turkey Burgers", "Saag Paneer Wraps", "Harissa Chickpea Stew", "Peanut Tofu Stir-fry"];
let aiCursor = 0;
app.post<{ Body: { messages: { content: string }[] } }>("/v1/messages", async (req) => {
  await new Promise((r) => setTimeout(r, 1500));
  const prompt = req.body.messages[0]?.content ?? "";
  const want = Number(/Suggest (\d+)/.exec(prompt)?.[1] ?? 6);
  const recipes = Array.from({ length: want }, () => {
    const title = `${AI_DISHES[aiCursor % AI_DISHES.length]}${aiCursor >= AI_DISHES.length ? ` ${Math.floor(aiCursor / AI_DISHES.length) + 1}` : ""}`;
    aiCursor++;
    return {
      title, description: "A quick, cozy weeknight idea.", cuisine: "Fusion", category: "Dinner", suits: ["dinner", "lunch"], servings: 4,
      prepMinutes: 10, cookMinutes: 20, ingredients: ["1 lb chicken thighs", "2 cups rice", "1 onion"], instructions: ["Prep.", "Cook.", "Serve."],
      tags: ["weeknight"], nutrition: { calories: 520, protein: 34, carbs: 48, fat: 18, fiber: 5 },
    };
  });
  return {
    id: "msg_mock", type: "message", role: "assistant", model: "mock", stop_reason: "tool_use", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: "tool_use", id: "toolu_mock", name: "suggest_recipes", input: { recipes } }],
  };
});

app.listen({ port: 9100, host: "0.0.0.0" }).then(() => console.log("mock Mealie + TheMealDB on :9100"));
