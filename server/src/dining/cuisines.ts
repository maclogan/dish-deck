// Cuisines the filter offers, as Google Places (New) place types. Most popular first: the app shows the
// first dozen until "More".

export const CUISINES: { id: string; label: string }[] = [
  { id: "mexican_restaurant", label: "Mexican" },
  { id: "italian_restaurant", label: "Italian" },
  { id: "chinese_restaurant", label: "Chinese" },
  { id: "american_restaurant", label: "American" },
  { id: "japanese_restaurant", label: "Japanese" },
  { id: "thai_restaurant", label: "Thai" },
  { id: "indian_restaurant", label: "Indian" },
  { id: "pizza_restaurant", label: "Pizza" },
  { id: "hamburger_restaurant", label: "Burgers" },
  { id: "sushi_restaurant", label: "Sushi" },
  { id: "vietnamese_restaurant", label: "Vietnamese" },
  { id: "korean_restaurant", label: "Korean" },
  { id: "mediterranean_restaurant", label: "Mediterranean" },
  { id: "barbecue_restaurant", label: "Barbecue" },
  { id: "seafood_restaurant", label: "Seafood" },
  { id: "breakfast_restaurant", label: "Breakfast" },
  { id: "brunch_restaurant", label: "Brunch" },
  { id: "steak_house", label: "Steakhouse" },
  { id: "ramen_restaurant", label: "Ramen" },
  { id: "greek_restaurant", label: "Greek" },
  { id: "middle_eastern_restaurant", label: "Middle Eastern" },
  { id: "french_restaurant", label: "French" },
  { id: "spanish_restaurant", label: "Spanish" },
  { id: "sandwich_shop", label: "Sandwiches" },
  { id: "vegetarian_restaurant", label: "Vegetarian" },
  { id: "vegan_restaurant", label: "Vegan" },
  { id: "cafe", label: "Café" },
  { id: "bakery", label: "Bakery" },
  { id: "dessert_shop", label: "Dessert" },
  { id: "lebanese_restaurant", label: "Lebanese" },
  { id: "turkish_restaurant", label: "Turkish" },
  { id: "brazilian_restaurant", label: "Brazilian" },
  { id: "indonesian_restaurant", label: "Indonesian" },
  { id: "african_restaurant", label: "African" },
  { id: "afghani_restaurant", label: "Afghan" },
  { id: "asian_restaurant", label: "Asian" },
  { id: "bar_and_grill", label: "Bar & grill" },
  { id: "pub", label: "Pub" },
  { id: "fast_food_restaurant", label: "Fast food" },
];

const LABELS = new Map(CUISINES.map((c) => [c.id, c.label]));
export const CUISINE_IDS = CUISINES.map((c) => c.id);

/** The cuisine to show for a place: its primary type if that's a cuisine, else its first cuisine type. */
export function cuisineLabel(primaryType: string | undefined, types: string[], primaryTypeDisplay?: string): string | undefined {
  if (primaryType && LABELS.has(primaryType)) return LABELS.get(primaryType);
  for (const t of types) if (LABELS.has(t) && t !== "fast_food_restaurant") return LABELS.get(t);
  if (primaryTypeDisplay && !/^(restaurant|food|point of interest|establishment)$/i.test(primaryTypeDisplay)) return primaryTypeDisplay;
  return undefined;
}
