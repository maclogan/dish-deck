// AI recipe ideas via the Claude API (Messages API with a forced tool call for structured output).

import Anthropic from "@anthropic-ai/sdk";
import { dietLabel, goalPrompt, isMainMeal, mealLabel, stylePrompt } from "../filters.js";
import type { Card, DietId, GoalId, MealFilter, MealType, Nutrition, StyleId } from "../types.js";
import { slugify } from "../util.js";

export interface AiRequest {
  mood?: string;
  /** Any of these cuisines. */
  cuisines?: string[];
  /** Any of these dish types. */
  categories?: string[];
  /** Must satisfy all of these. */
  dietary?: DietId[];
  /** Any of these meals. */
  meals?: MealFilter[];
  /** Each recipe should meet at least one. */
  goals?: GoalId[];
  /** Home-style (default), weeknight shortcuts or takeout favorites. */
  style?: StyleId;
  count: number;
  /** On-hand food names to build around, when the user asked for that. */
  onHand?: string[];
  leniency: number;
  /** Recipe names already saved or already shown, to avoid repeats. */
  avoid: string[];
  /** A sample of saved recipe names, as a hint about the household's taste. */
  bookSample: string[];
  /** Write recipes for exactly these dishes (no suggesting). */
  only?: { name: string; nativeName?: string; region?: string }[];
  /** Regions to focus on (otherwise picked at random for the cuisines). */
  regions?: string[];
}

/** A dish suggestion without a recipe: the cheap first step before finding a real recipe page. */
export interface DishIdea {
  name: string;
  nativeName?: string;
  /** Other names sites use for it, incl. romanized forms ("yuxiang qiezi", "Sichuan eggplant"). */
  aliases: string[];
  region?: string;
  cuisine?: string;
  suits: MealType[];
  wikipediaTitle?: string;
}

interface AiRecipe {
  title: string;
  nativeName?: string;
  description: string;
  cuisine?: string;
  region?: string;
  wikipediaTitle?: string;
  photoSearch?: string;
  category?: string;
  suits: MealType[];
  servings: number;
  prepMinutes?: number;
  cookMinutes?: number;
  ingredients: string[];
  instructions: string[];
  tags?: string[];
  nutrition?: Nutrition;
}

const NUTRIENTS = ["calories", "protein", "carbs", "fat", "fiber"] as const;

function cleanNutrition(n: Nutrition | undefined): Nutrition | undefined {
  if (!n || typeof n !== "object") return undefined;
  const out: Nutrition = {};
  for (const k of NUTRIENTS) {
    const v = Number(n[k]);
    if (Number.isFinite(v) && v >= 0) out[k] = Math.round(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Regional traditions to rotate through, so each deal of a cuisine explores different cooking instead
 * of the same few famous dishes. Cuisines not listed just get "vary the regions".
 */
const REGIONS: Record<string, string[]> = {
  chinese: ["Sichuan", "Cantonese", "Hunan", "Shanghai and Jiangsu-Zhejiang", "Dongbei (northeastern)", "Fujian", "Yunnan", "Xinjiang", "Shaanxi and Xi'an", "Hakka", "Taiwanese", "Beijing and Shandong", "Chinese home cooking (jiachang cai)"],
  japanese: ["Japanese home cooking (katei ryori)", "Kansai", "Kanto", "Hokkaido", "Kyushu", "Okinawa", "Tohoku", "izakaya-style dishes", "washoku (rice, soup and sides)"],
  korean: ["Korean home cooking (banchan and jjigae)", "Jeolla", "Gyeongsang", "Seoul", "Jeju", "Korean temple food", "Korean street food"],
  thai: ["Central Thai", "Isan (northeastern)", "Northern Thai (Lanna)", "Southern Thai", "Bangkok street food", "Thai home cooking"],
  vietnamese: ["Northern Vietnamese (Hanoi)", "Central Vietnamese (Hue and Hoi An)", "Southern Vietnamese (Saigon and Mekong)", "Vietnamese home cooking (com nha)"],
  indian: ["Punjabi", "Kerala", "Tamil Nadu (Chettinad)", "Bengali", "Gujarati", "Maharashtrian", "Hyderabadi", "Goan", "Kashmiri", "Rajasthani", "Udupi and Karnataka", "Andhra", "Indian home cooking (dal, sabzi and roti)"],
  italian: ["Sicily", "Emilia-Romagna", "Rome and Lazio", "Naples and Campania", "Piedmont", "Liguria", "Tuscany", "Puglia", "Veneto", "Sardinia", "Calabria", "Lombardy"],
  mexican: ["Oaxaca", "Yucatán", "Puebla", "Jalisco", "Michoacán", "Veracruz", "Mexico City", "Northern Mexico (Sonora and Nuevo León)", "Guerrero", "Mexican home cooking (comida casera)"],
  french: ["Provence", "Alsace", "Burgundy", "Brittany", "Lyon", "Southwest France (Gascony and Basque)", "Normandy", "French home cooking (cuisine de grand-mère)"],
  spanish: ["Andalusia", "Catalonia", "Basque Country", "Galicia", "Valencia", "Castile", "Asturias", "Spanish home cooking"],
  greek: ["Crete", "Macedonia and Thessaloniki", "the Ionian islands", "the Cyclades", "Epirus", "Peloponnese", "Greek home cooking (ladera and magirefta)"],
  turkish: ["Southeastern Turkey (Gaziantep and Urfa)", "the Black Sea", "the Aegean", "Istanbul", "Central Anatolia", "Turkish home cooking (ev yemekleri)"],
  moroccan: ["Fez", "Marrakech", "the Atlas mountains", "the Atlantic coast", "Moroccan home cooking"],
  american: ["the American South", "New England", "Louisiana Creole and Cajun", "Tex-Mex and the Southwest", "the Midwest", "Pacific Northwest", "Appalachia", "Hawaiian"],
  british: ["England", "Scotland", "Wales", "Northern Ireland", "British home cooking"],
  jamaican: ["Jamaican home cooking", "Kingston street food", "Jamaican Sunday dinner"],
  filipino: ["Luzon (Tagalog and Ilocano)", "Pampanga", "the Visayas", "Mindanao", "Filipino home cooking (lutong bahay)"],
  malaysian: ["Penang", "Malay home cooking", "Nyonya (Peranakan)", "Malaysian Indian", "Sarawak and Sabah"],
  portuguese: ["Lisbon", "Porto and the North", "Alentejo", "the Algarve", "the Azores and Madeira"],
  egyptian: ["Cairo street food", "Alexandria", "Upper Egypt", "Egyptian home cooking"],
};

/**
 * Regions for the next batch of dish names, preferring ones not used yet for this list (so a growing
 * list keeps exploring); starts over once every region has had a turn.
 */
export function nextRegions(cuisines: string[], used: string[], random: () => number = Math.random): string[] {
  const usedSet = new Set(used);
  const fresh = (c: string) => (REGIONS[c.toLowerCase()] ?? []).filter((r) => !usedSet.has(cuisines.length > 1 ? `${r} (${c})` : r));
  const anyFresh = cuisines.some((c) => fresh(c).length > 0);
  if (!anyFresh) return pickRegions(cuisines, random);
  const out: string[] = [];
  const per = cuisines.length > 1 ? 1 : 2;
  for (const c of cuisines) {
    const pool = fresh(c);
    for (let i = 0; i < per && pool.length; i++) {
      const [pick] = pool.splice(Math.floor(random() * pool.length), 1);
      out.push(cuisines.length > 1 ? `${pick} (${c})` : pick!);
    }
  }
  return out;
}

/** Two regions per cuisine (one each when there are several), chosen at random for this deal. */
export function pickRegions(cuisines: string[], random: () => number = Math.random): string[] {
  const out: string[] = [];
  const per = cuisines.length > 1 ? 1 : 2;
  for (const c of cuisines) {
    const list = REGIONS[c.toLowerCase()];
    if (!list) continue;
    const pool = [...list];
    for (let i = 0; i < per && pool.length; i++) {
      const [pick] = pool.splice(Math.floor(random() * pool.length), 1);
      out.push(cuisines.length > 1 ? `${pick} (${c})` : pick!);
    }
  }
  return out;
}

const TOOL: Anthropic.Tool = {
  name: "suggest_recipes",
  description: "Return recipe ideas for a home cook.",
  input_schema: {
    type: "object",
    properties: {
      recipes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "The dish's usual English name, e.g. 'Fish-Fragrant Eggplant'." },
            nativeName: {
              type: "string",
              description: "The dish's name in its own language and script, e.g. '鱼香茄子' (omit for English-language dishes).",
            },
            region: { type: "string", description: "Regional tradition it comes from, e.g. 'Sichuan', 'Oaxaca', 'Kerala'." },
            wikipediaTitle: {
              type: "string",
              description: "Exact title of the English Wikipedia article about this dish, if one exists, e.g. 'Yuxiang eggplant'. Omit if unsure.",
            },
            photoSearch: { type: "string", description: "2-4 English words that would find a photo of this dish, e.g. 'yuxiang eggplant'." },
            description: { type: "string", description: "One appetizing sentence, under 25 words." },
            cuisine: { type: "string" },
            category: { type: "string", description: "e.g. Soup, Pasta, Stir-fry, Salad, Casserole" },
            suits: { type: "array", items: { type: "string", enum: ["lunch", "dinner"] } },
            servings: { type: "integer" },
            prepMinutes: { type: "integer" },
            cookMinutes: { type: "integer" },
            ingredients: {
              type: "array",
              items: { type: "string" },
              description: "Each line has quantity, unit and ingredient, e.g. '2 cups baby spinach'.",
            },
            instructions: { type: "array", items: { type: "string" }, description: "Clear steps, one per item." },
            tags: { type: "array", items: { type: "string" }, description: "2-4 short tags, e.g. 'weeknight', 'spicy'." },
            nutrition: {
              type: "object",
              description: "Your best estimate of nutrition per serving.",
              properties: {
                calories: { type: "number", description: "kcal" },
                protein: { type: "number", description: "grams" },
                carbs: { type: "number", description: "grams of net carbs" },
                fat: { type: "number", description: "grams" },
                fiber: { type: "number", description: "grams" },
              },
              required: ["calories", "protein", "carbs", "fat", "fiber"],
            },
          },
          required: ["title", "description", "suits", "servings", "ingredients", "instructions", "nutrition"],
        },
      },
    },
    required: ["recipes"],
  },
};

const NAMES_TOOL: Anthropic.Tool = {
  name: "suggest_dishes",
  description: "Return dish names (no recipes) for a home cook.",
  input_schema: {
    type: "object",
    properties: {
      dishes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The dish's usual English name." },
            nativeName: { type: "string", description: "Name in its own language and script (omit for English dishes)." },
            aliases: {
              type: "array",
              items: { type: "string" },
              description: "2-5 other names recipe sites use: romanized native name (e.g. 'yuxiang qiezi'), common English names.",
            },
            region: { type: "string" },
            cuisine: { type: "string" },
            suits: { type: "array", items: { type: "string", enum: ["lunch", "dinner"] } },
            wikipediaTitle: { type: "string", description: "Exact English Wikipedia article title, if one exists." },
          },
          required: ["name", "aliases", "suits"],
        },
      },
    },
    required: ["dishes"],
  },
};

/** An AI idea plus hints for finding its photo (stripped before it goes to the browser). */
export type AiCard = Card & { photoHint: { wikipediaTitle?: string; search?: string } };

export class AiRecipes {
  private client: Anthropic;

  constructor(apiKey: string, private model: string, private household: string) {
    this.client = new Anthropic({ apiKey });
  }

  /** The shared part of both prompts: what to suggest, for whom, with which filters. */
  private brief(req: AiRequest, what: string) {
    const meals = req.meals ?? [];
    const cuisines = req.cuisines ?? [];
    const categories = req.categories ?? [];
    const goals = req.goals ?? [];
    const mealWord = (m: MealFilter) => (m === "snack" ? "a snack or appetizer" : mealLabel(m).toLowerCase());
    const forWhat = meals.length ? meals.map(mealWord).join(" or ") : "lunch or dinner";
    const anyOf = (xs: string[]) => (xs.length > 1 ? `any of ${xs.join(", ")} (mix them up)` : xs[0]);
    const style = req.style ?? "home";
    const regions = req.regions ?? (style === "takeout" ? [] : pickRegions(cuisines));
    return [
      req.only?.length
        ? `Write a recipe for each of these dishes, exactly as named: ${req.only.map((d) => [d.name, d.nativeName, d.region && `(${d.region})`].filter(Boolean).join(" ")).join("; ")}. Cooking for: ${this.household}.`
        : `Suggest ${req.count} distinct ${what} for ${forWhat}. Cooking for: ${this.household}.`,
      meals.length > 1 && !req.only?.length ? "Spread them across those meals." : "",
      req.mood && !req.only?.length ? `They're in the mood for: "${req.mood}".` : "",
      cuisines.length && !req.only?.length ? `Cuisine: ${anyOf(cuisines)}.` : "",
      req.only?.length
        ? ""
        : regions.length
          ? `For this batch, focus mostly on ${regions.join(" and ")}, with at most a couple of dishes from elsewhere in the cuisine.`
          : cuisines.length
            ? "Vary the regions the dishes come from."
            : "",
      stylePrompt(style),
      style === "home" && !req.only?.length
        ? "Skip the handful of dishes every Western menu already has; lean toward what a family there would cook on an ordinary day, plus a few beloved regional specialties."
        : "",
      categories.length && !req.only?.length ? `Type of dish: ${anyOf(categories)}.` : "",
      req.dietary?.length
        ? `Every dish MUST be ${req.dietary.map(dietLabel).join(", ")}. Check every ingredient, including sauces, stocks and garnishes.`
        : "",
      goals.length
        ? goals.length === 1
          ? `Every dish should be ${goalPrompt(goals[0]!)}. Keep the nutrition estimates honest.`
          : `Every dish should meet at least one of: ${goals.map(goalPrompt).join("; ")}. Keep the nutrition estimates honest.`
        : "",
      req.onHand?.length
        ? `Build around ingredients they already have on hand: ${req.onHand.slice(0, 80).join(", ")}. ` +
          `Each dish should need at most ${req.leniency} ingredients they don't have (not counting salt, pepper, oil, water).`
        : "",
      // Their saved recipes hint at taste, but they'd pull a cuisine search toward whatever is already in the book.
      req.bookSample.length && !cuisines.length && !req.only?.length
        ? `Dishes they already like (for taste, don't repeat these): ${req.bookSample.slice(0, 40).join("; ")}.`
        : "",
      req.avoid.length && !req.only?.length ? `Do not suggest any of these: ${req.avoid.slice(0, 120).join("; ")}.` : "",
    ].filter(Boolean);
  }

  /**
   * Dish names only, with aliases for finding real recipe pages. A short reply (a few hundred tokens
   * for 25 dishes), cached by the caller and dealt from over many decks.
   */
  async dishNames(req: AiRequest): Promise<DishIdea[]> {
    const lines = [
      ...this.brief(req, "dishes"),
      "Only names: no recipes. Pick dishes that good recipe websites are likely to have, and give the names those sites would use.",
    ];
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4000,
      tools: [NAMES_TOOL],
      tool_choice: { type: "tool", name: NAMES_TOOL.name },
      messages: [{ role: "user", content: lines.join("\n") }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("AI did not return dishes");
    const raw = (block.input as { dishes?: Partial<DishIdea>[] }).dishes ?? [];
    return raw
      .filter((d): d is Partial<DishIdea> & { name: string } => typeof d?.name === "string" && !!d.name.trim())
      .map((d) => ({
        name: d.name.trim(),
        nativeName: d.nativeName?.trim() || undefined,
        aliases: [...new Set([d.name.trim(), ...(Array.isArray(d.aliases) ? d.aliases : [])].map((a) => String(a).trim()).filter(Boolean))],
        region: d.region?.trim() || undefined,
        cuisine: d.cuisine?.trim() || undefined,
        suits: (Array.isArray(d.suits) ? d.suits : []).filter((x): x is MealType => x === "lunch" || x === "dinner"),
        wikipediaTitle: d.wikipediaTitle?.trim() || undefined,
      }));
  }

  async generate(req: AiRequest): Promise<AiCard[]> {
    const meals = req.meals ?? [];
    // Lunch/dinner dishes go on the meal plan; breakfast, dessert and snacks keep their own category.
    const mainMeal = !meals.length || meals.some(isMainMeal);
    const lines = [
      ...this.brief(req, "recipes"),
      "Make the recipes varied from each other. Write ingredient lines with US measurements, naming specialty ingredients precisely (e.g. 'Pixian doubanjiang', 'Shaoxing wine').",
    ];

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: lines.join("\n") }],
    });

    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("AI did not return recipes");
    const recipes = ((block.input as { recipes?: AiRecipe[] }).recipes ?? []).filter(
      (r) => r?.title && Array.isArray(r.ingredients) && Array.isArray(r.instructions),
    );

    return recipes.map((r) => {
      const total = (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
      return {
        key: `ai:${slugify(r.title)}`,
        source: "ai" as const,
        title: r.title,
        nativeName: r.nativeName?.trim() || undefined,
        photoHint: { wikipediaTitle: r.wikipediaTitle?.trim() || undefined, search: r.photoSearch?.trim() || undefined },
        description: r.description,
        cuisine: r.cuisine,
        region: r.region?.trim() || undefined,
        tags: r.tags ?? [],
        totalMinutes: total || undefined,
        servings: r.servings || undefined,
        ingredients: r.ingredients,
        instructions: r.instructions,
        nutrition: cleanNutrition(r.nutrition),
        // Breakfast, dessert and snacks aren't lunch/dinner plan dishes; keep their own category.
        suits: mainMeal ? (r.suits ?? []).filter((s): s is MealType => s === "lunch" || s === "dinner") : [],
        category: mainMeal || meals.length > 1 ? r.category : mealLabel(meals[0]!),
      };
    });
  }
}
