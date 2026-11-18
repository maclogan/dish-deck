// AI recipe ideas via the Claude API (Messages API with a forced tool call for structured output).

import Anthropic from "@anthropic-ai/sdk";
import { dietLabel, goalPrompt, mealLabel } from "../filters.js";
import type { Card, DietId, GoalId, MealFilter, MealType, Nutrition } from "../types.js";
import { slugify } from "../util.js";

export interface AiRequest {
  mood?: string;
  cuisine?: string;
  category?: string;
  dietary?: DietId[];
  meal?: MealFilter;
  goals?: GoalId[];
  count: number;
  /** On-hand food names to build around, when the user asked for that. */
  onHand?: string[];
  leniency: number;
  /** Recipe names already saved or already shown, to avoid repeats. */
  avoid: string[];
  /** A sample of saved recipe names, as a hint about the household's taste. */
  bookSample: string[];
}

interface AiRecipe {
  title: string;
  description: string;
  cuisine?: string;
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
            title: { type: "string", description: "Dish name, e.g. 'Lemon Garlic Chicken Orzo'" },
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

export class AiRecipes {
  private client: Anthropic;

  constructor(apiKey: string, private model: string, private household: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(req: AiRequest): Promise<Card[]> {
    const mainMeal = !req.meal || req.meal === "lunch" || req.meal === "dinner";
    const forWhat = !req.meal ? "lunch or dinner" : req.meal === "snack" ? "a snack or appetizer" : mealLabel(req.meal).toLowerCase();
    const lines = [
      `Suggest ${req.count} distinct recipes ${this.household} would enjoy for ${forWhat}.`,
      req.mood ? `They're in the mood for: "${req.mood}".` : "",
      req.cuisine ? `Cuisine: ${req.cuisine}.` : "",
      req.category ? `Type of dish: ${req.category}.` : "",
      req.dietary?.length
        ? `Every recipe MUST be ${req.dietary.map(dietLabel).join(", ")}. Check every ingredient, including sauces, stocks and garnishes.`
        : "",
      req.goals?.length ? `Every recipe should be ${req.goals.map(goalPrompt).join(", and ")}. Keep the nutrition estimates honest.` : "",
      req.onHand?.length
        ? `Build around ingredients they already have on hand: ${req.onHand.slice(0, 80).join(", ")}. ` +
          `Each recipe should need at most ${req.leniency} ingredients they don't have (not counting salt, pepper, oil, water).`
        : "",
      req.bookSample.length ? `Dishes they already like (for taste, don't repeat these): ${req.bookSample.slice(0, 40).join("; ")}.` : "",
      req.avoid.length ? `Do not suggest any of these: ${req.avoid.slice(0, 80).join("; ")}.` : "",
      "Keep recipes realistic for a home kitchen: common grocery-store ingredients, mostly under an hour, and varied from each other.",
      "Use US measurements.",
    ].filter(Boolean);

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
        description: r.description,
        cuisine: r.cuisine,
        tags: r.tags ?? [],
        totalMinutes: total || undefined,
        servings: r.servings || undefined,
        ingredients: r.ingredients,
        instructions: r.instructions,
        nutrition: cleanNutrition(r.nutrition),
        // Breakfast, dessert and snacks aren't lunch/dinner plan dishes; keep their own category.
        suits: mainMeal ? (r.suits ?? []).filter((s): s is MealType => s === "lunch" || s === "dinner") : [],
        category: mainMeal ? r.category : mealLabel(req.meal!),
      };
    });
  }
}
