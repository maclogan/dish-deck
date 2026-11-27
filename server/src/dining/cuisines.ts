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

/**
 * Google's main types for places that are mainly somewhere to eat. Google also gives the "restaurant"
 * type to places that only serve food on the side (Topgolf, cinemas, bowling alleys, hotels), so a
 * place counts only if its main type is one of these or any "..._restaurant".
 */
const EATING_TYPES = new Set([
  "restaurant", "cafe", "coffee_shop", "bakery", "bar_and_grill", "pub", "gastropub", "brewpub", "diner", "deli",
  "sandwich_shop", "steak_house", "food_court", "cafeteria", "bistro", "ice_cream_shop", "dessert_shop",
  "bagel_shop", "donut_shop", "juice_shop", "tea_house", "meal_takeaway", "meal_delivery", "food",
  "acai_shop", "confectionery", "chocolate_shop", "noodle_shop", "dumpling_shop", "tapas_bar", "wine_bar",
]);

/** True for places that are mainly somewhere to eat (see EATING_TYPES). */
export function isEatery(primaryType: string | undefined, types: string[]): boolean {
  if (primaryType) return primaryType.endsWith("_restaurant") || EATING_TYPES.has(primaryType);
  // No main type: trust a restaurant type only if nothing marks it as some other kind of venue.
  return types.some((t) => t === "restaurant" || t.endsWith("_restaurant")) && !types.some((t) => NOT_EATING.has(t));
}
const NOT_EATING = new Set([
  "movie_theater", "bowling_alley", "golf_course", "amusement_center", "amusement_park", "sports_complex", "sports_activity_location",
  "stadium", "event_venue", "lodging", "hotel", "casino", "gas_station", "grocery_store", "supermarket", "night_club", "gym",
]);
export const CUISINE_IDS = CUISINES.map((c) => c.id);

/** The cuisine to show for a place: its primary type if that's a cuisine, else its first cuisine type. */
export function cuisineLabel(primaryType: string | undefined, types: string[], primaryTypeDisplay?: string): string | undefined {
  if (primaryType && LABELS.has(primaryType)) return LABELS.get(primaryType);
  for (const t of types) if (LABELS.has(t) && t !== "fast_food_restaurant") return LABELS.get(t);
  if (primaryTypeDisplay && !/^(restaurant|food|point of interest|establishment)$/i.test(primaryTypeDisplay)) return primaryTypeDisplay;
  return undefined;
}
