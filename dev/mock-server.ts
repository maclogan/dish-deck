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
// One saved recipe without a photo, to show the looked-up photo in the recipe book.
recipes.find((r) => r.name === "Greek Salad")!.image = null;


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

// ---------------------------------------------------------------- fake Wikipedia (photo lookups)
// Every article exists and has a photo, except the "Mystery" dish (to exercise dropping photo-less ideas).
app.get<{ Querystring: Record<string, string> }>("/w/api.php", async (req) => {
  const q = req.query;
  const titles = q.generator === "search" ? [] : (q.titles ?? "").split("|");
  return {
    query: {
      pages: titles.map((title) =>
        /mystery|^$/i.test(title)
          ? { title, missing: true }
          : { title, pageimage: `${title.replace(/ /g, "_")}.jpg`, thumbnail: { source: `http://localhost:9100/img/${(hashText(title) % 40) + 1}.svg`, width: 960, height: 640 } },
      ),
    },
  };
});
const hashText = (t: string) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// ---------------------------------------------------------------- fake Claude (Messages API)
// Start the app with ANTHROPIC_API_KEY=dev ANTHROPIC_BASE_URL=http://localhost:9100 to try AI mode offline.
const AI_DISHES: [string, string, string][] = [
  ["Fish-Fragrant Eggplant", "鱼香茄子", "Sichuan"], ["Tomato and Egg Stir-fry", "番茄炒蛋", "Chinese home cooking"],
  ["Red-Braised Pork Belly", "红烧肉", "Hunan"], ["Steamed Fish with Ginger and Scallion", "清蒸鱼", "Cantonese"],
  ["Dry-Fried Green Beans", "干煸四季豆", "Sichuan"], ["Pork and Chive Dumplings", "韭菜猪肉饺子", "Dongbei"],
  ["Lion's Head Meatballs", "狮子头", "Shanghai and Jiangsu-Zhejiang"], ["Cumin Lamb", "孜然羊肉", "Xinjiang"],
  ["Three Cup Chicken", "三杯鸡", "Taiwanese"], ["Hot and Sour Shredded Potatoes", "酸辣土豆丝", "Chinese home cooking"],
  ["Mystery Grandma Stew", "", "Yunnan"], ["Scallion Pancakes", "葱油饼", "Shanghai and Jiangsu-Zhejiang"],
];
let aiCursor = 0;
let dishCalls = 0;
app.post<{ Body: { messages: { content: string }[]; tool_choice?: { name?: string } } }>("/v1/messages", async (req) => {
  await new Promise((r) => setTimeout(r, 1200));
  const prompt = req.body.messages[0]?.content ?? "";
  const reply = (name: string, input: unknown) => ({
    id: "msg_mock", type: "message", role: "assistant", model: "mock", stop_reason: "tool_use", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: "tool_use", id: "toolu_mock", name, input }],
  });
  // Names only (the cheap first step): the real dishes, then numbered extras on later calls.
  if (req.body.tool_choice?.name === "suggest_dishes") {
    dishCalls++;
    console.log(`[mock claude] dish names call #${dishCalls}`);
    const dishes = AI_DISHES.map(([name, nativeName, region]) => ({
      name: dishCalls > 1 ? `${name} (batch ${dishCalls})` : name,
      nativeName: nativeName || undefined, region, cuisine: "Chinese", suits: ["dinner", "lunch"],
      aliases: [name, name.replace(/-/g, " ")], wikipediaTitle: name.startsWith("Mystery") ? undefined : name,
    }));
    return reply("suggest_dishes", { dishes });
  }
  const only = /exactly as named: (.+?)\. Cooking for/.exec(prompt)?.[1]?.split("; ").map((d) => d.replace(/\s*\(.*\)$/, "").replace(/\s+\p{Script=Han}+.*$/u, ""));
  const want = only?.length ?? Number(/Suggest (\d+)/.exec(prompt)?.[1] ?? 6);
  const recipes = Array.from({ length: want }, (_, i) => {
    const pick = AI_DISHES[aiCursor % AI_DISHES.length]!;
    const [name, nativeName, region] = only ? [only[i]!, "", "Chinese home cooking"] : pick;
    const title = only ? name : `${name}${aiCursor >= AI_DISHES.length ? ` ${Math.floor(aiCursor / AI_DISHES.length) + 1}` : ""}`;
    aiCursor++;
    return {
      title, nativeName: nativeName || undefined, region,
      // "Mystery Grandma Stew" has no article, so its card is dropped (no photo).
      wikipediaTitle: name.startsWith("Mystery") ? undefined : name, photoSearch: name.startsWith("Mystery") ? "zzz" : name.toLowerCase(),
      description: "A well-loved everyday dish.", cuisine: "Chinese", category: "Dinner", suits: ["dinner", "lunch"], servings: 4,
      prepMinutes: 10, cookMinutes: 20, ingredients: ["1 lb chicken thighs", "2 cups rice", "1 onion"], instructions: ["Prep.", "Cook.", "Serve."],
      tags: ["weeknight"], nutrition: { calories: 520, protein: 34, carbs: 48, fat: 18, fiber: 5 },
    };
  });
  return reply("suggest_recipes", { recipes });
});

// ---------------------------------------------------------------- fake recipe sites
// Start the app with DEV_SITE_PROXY=http://localhost:9100 and requests to the trusted sites come here.
// thewoksoflife.com has most of the dishes; "Cumin Lamb" is on the site but missing from its sitemap (the
// search fallback finds it); "Lion's Head Meatballs" and "Mystery Grandma Stew" aren't anywhere (AI writes them).
const SITE_DISHES: Record<string, string[]> = {
  "thewoksoflife.com": ["Fish-Fragrant Eggplant (Yu Xiang Qie Zi)", "Tomato Egg Stir-fry", "Hong Shao Rou (Red Braised Pork Belly)", "Steamed Fish with Ginger and Scallion", "Sichuan Dry Fried Green Beans", "Pork and Chinese Chive Dumplings", "Three Cup Chicken (San Bei Ji)", "Hot and Sour Shredded Potatoes", "Scallion Pancakes", "Cumin Lamb"],
  "redhousespice.com": ["Mapo Tofu", "Dan Dan Noodles", "Twice Cooked Pork", "Chinese Chicken and Mushroom Soup"],
};
const UNLISTED = new Set(["Cumin Lamb"]);
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const siteDish = (domain: string, s: string) => SITE_DISHES[domain]?.find((d) => slug(d) === s);
app.get<{ Params: { domain: string; "*": string } }>("/site/:domain/*", async (req, reply) => {
  const { domain } = req.params;
  const rest = req.params["*"].replace(/\/$/, "");
  const dishes = SITE_DISHES[domain];
  if (!dishes) return reply.code(404).send("not found");
  const base = `https://${domain}`;
  if (rest === "robots.txt") return reply.type("text/plain").send(`User-agent: *\nDisallow: /wp-admin/\nSitemap: ${base}/sitemap_index.xml\n`);
  if (rest === "sitemap_index.xml") {
    return reply.type("application/xml").send(`<?xml version="1.0"?><sitemapindex><sitemap><loc>${base}/post-sitemap.xml</loc></sitemap><sitemap><loc>${base}/page-sitemap.xml</loc></sitemap><sitemap><loc>${base}/category-sitemap.xml</loc></sitemap></sitemapindex>`);
  }
  if (rest === "post-sitemap.xml") {
    const urls = dishes.filter((d) => !UNLISTED.has(d)).map((d) => `<url><loc>${base}/${slug(d)}/</loc><lastmod>2026-10-01</lastmod></url>`);
    return reply.type("application/xml").send(`<?xml version="1.0"?><urlset>${urls.join("")}<url><loc>${base}/about/</loc></url><url><loc>${base}/our-favorite-woks-buying-guide/</loc></url></urlset>`);
  }
  if (rest === "page-sitemap.xml" || rest === "category-sitemap.xml") return reply.code(500).send("should not be read");
  if (rest === "our-favorite-woks-buying-guide") return reply.type("text/html").send("<html><body><h1>Woks we love</h1></body></html>");
  const name = siteDish(domain, rest);
  if (!name) return reply.code(404).send("not found");
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name },
      {
        "@type": ["Recipe"], name, description: `${name}, the way we make it at home.`,
        image: [`http://localhost:9100/img/${(hashText(name) % 40) + 1}.svg`],
        recipeYield: ["4", "4 servings"], prepTime: "PT15M", cookTime: "PT25M", recipeCuisine: ["Chinese"], recipeCategory: ["Main Course"],
        keywords: "home cooking, weeknight",
        recipeIngredient: ["1 lb pork belly &amp; skin", "2 tbsp Shaoxing wine", "1 tbsp Pixian doubanjiang", "3 scallions"],
        recipeInstructions: [{ "@type": "HowToSection", name: "Prep", itemListElement: [{ "@type": "HowToStep", text: "Cut everything into even pieces." }] }, { "@type": "HowToStep", text: "Stir-fry over high heat until fragrant, then braise." }],
      },
    ],
  };
  return reply.type("text/html").send(`<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>${name}</h1></body></html>`);
});

// ---------------------------------------------------------------- fake SearXNG (SEARXNG_URL=http://localhost:9100)
app.get<{ Querystring: { q?: string } }>("/search", async (req) => {
  const q = (req.query.q ?? "").toLowerCase();
  const domain = /site:(\S+)/.exec(q)?.[1] ?? "";
  const hits = (SITE_DISHES[domain] ?? []).filter((d) => q.includes(d.toLowerCase().split(" ")[0]!));
  return { results: hits.map((d) => ({ url: `https://${domain}/${slug(d)}/`, title: d })) };
});

app.listen({ port: 9100, host: "0.0.0.0" }).then(() => console.log("mock Mealie + TheMealDB on :9100"));
