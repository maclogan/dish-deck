import type { MealieRecipe } from "../src/mealie.js";
import type { MealDbMeal } from "../src/sources/mealdb.js";

export const teriyakiMeal: MealDbMeal = {
  idMeal: "52772",
  strMeal: "Teriyaki Chicken Casserole",
  strCategory: "Chicken",
  strArea: "Japanese",
  strInstructions:
    "STEP 1\r\nPreheat oven to 350° F. Spray a 9x13-inch baking pan with non-stick spray.\r\nSTEP 2\r\nCombine soy sauce, ½ cup water, brown sugar, ginger and garlic in a small saucepan.",
  strMealThumb: "https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg",
  strTags: "Meat,Casserole",
  strSource: "",
  strIngredient1: "soy sauce",
  strMeasure1: "3/4 cup",
  strIngredient2: "water",
  strMeasure2: "1/2 cup",
  strIngredient3: "brown sugar",
  strMeasure3: "1/4 cup",
  strIngredient4: "ground ginger",
  strMeasure4: "1/2 teaspoon",
  strIngredient5: "minced garlic",
  strMeasure5: "1/2 teaspoon",
  strIngredient6: "cornstarch",
  strMeasure6: "4 Tablespoons",
  strIngredient7: "chicken breasts",
  strMeasure7: "2",
  strIngredient8: "stir-fry vegetables",
  strMeasure8: "1 (12 oz.)",
  strIngredient9: "brown rice",
  strMeasure9: "3 cups",
  strIngredient10: "",
  strMeasure10: " ",
};

let n = 0;
export function mealieRecipe(partial: Partial<MealieRecipe> & { name: string; ingredients?: string[] }): MealieRecipe {
  n++;
  const id = partial.id ?? `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    slug: partial.slug ?? partial.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: partial.name,
    tags: partial.tags ?? [],
    recipeCategory: partial.recipeCategory ?? [{ name: "Dinner" }],
    recipeServings: partial.recipeServings ?? 4,
    totalTimeSeconds: partial.totalTimeSeconds ?? 2400,
    rating: partial.rating ?? null,
    dateUpdated: partial.dateUpdated ?? "2026-11-01T00:00:00",
    recipeIngredient: (partial.ingredients ?? []).map((t) => ({ display: t, originalText: t })),
    recipeInstructions: [{ text: "Cook it." }],
    image: partial.image ?? null,
    description: partial.description ?? "",
    ...(partial.dateAdded !== undefined ? { dateAdded: partial.dateAdded } : {}),
    ...(partial.createdAt !== undefined ? { createdAt: partial.createdAt } : {}),
  };
}
