// Shared types used by the server and (type-only) by the web app.

export type CardSource = "mealdb" | "ai" | "mealie";
export type MealType = "lunch" | "dinner";

/** Dietary restrictions and allergies, enforced by checking ingredients. */
export type DietId =
  | "vegetarian"
  | "vegan"
  | "pescatarian"
  | "gluten-free"
  | "dairy-free"
  | "egg-free"
  | "nut-free"
  | "shellfish-free"
  | "soy-free";
/** Which meal of the day (or course) a dish is for. Broader than MealType, which is a Mealie plan slot. */
export type MealFilter = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";
/** Nutrition goals, checked against per-serving nutrition. */
export type GoalId = "low-calorie" | "low-carb" | "keto" | "high-protein" | "high-fiber" | "low-fat";

/** Per-serving nutrition, when known (AI estimates or Mealie's nutrition fields). */
export interface Nutrition {
  calories?: number;
  /** Grams. */
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
}

export interface FilterOption<T extends string> {
  id: T;
  label: string;
}

/** One swipeable recipe card. */
export interface Card {
  /** Stable key used to avoid showing the same card twice, e.g. "mealdb:52772". */
  key: string;
  source: CardSource;
  title: string;
  description?: string;
  image?: string;
  cuisine?: string;
  category?: string;
  tags: string[];
  totalMinutes?: number;
  servings?: number;
  ingredients: string[];
  instructions: string[];
  sourceUrl?: string;
  /** Per-serving nutrition, when known. AI values are estimates. */
  nutrition?: Nutrition;
  /** Which meals this suits, when known. */
  suits?: MealType[];
  /** On-hand info (present when the server could check Mealie's on-hand foods). */
  onHand?: { have: number; total: number; missing: string[] };
  /** Present when the card is already a saved Mealie recipe. */
  mealie?: { id: string; slug: string; url?: string };
}

export interface DeckRequest {
  source: "new" | "saved";
  mood?: string;
  /** Allow AI ideas for a mood search (when AI is configured). Defaults to true; false forces TheMealDB. */
  ai?: boolean;
  /** Any of these cuisines. */
  cuisines?: string[];
  /** Any of these dish types (TheMealDB categories). */
  categories?: string[];
  /** Any of these meals. */
  meals?: MealFilter[];
  /** @deprecated Single-value forms, still accepted and merged into the lists above. */
  cuisine?: string;
  /** @deprecated See `categories`. */
  category?: string;
  /** @deprecated See `meals`. */
  meal?: MealFilter;
  /** Restrictions every card must satisfy, all of them (checked against ingredients). */
  dietary?: DietId[];
  /** Nutrition goals; a card needs to meet any one. New ideas need AI for these; saved recipes use Mealie nutrition or tags. */
  goals?: GoalId[];
  onHand: boolean;
  /** Max missing ingredients allowed when onHand is true. */
  leniency: number;
  count: number;
  /** Card keys the user has already seen this session. */
  exclude: string[];
}

/** A saved recipe in the recipe book grid, with filter matches worked out on the server. */
export interface BookRecipe extends Card {
  /** Which dietary, meal and nutrition filters this recipe passes. */
  fits: { diets: DietId[]; meals: MealFilter[]; goals: GoalId[] };
  rating?: number;
  /** ISO date the recipe was added to Mealie, when known. */
  addedAt?: string;
}

export interface BookResponse {
  recipes: BookRecipe[];
}

export interface DeckResponse {
  cards: Card[];
  /** Short note about how the cards were produced, e.g. "AI ideas for 'cozy soup'". */
  note?: string;
}

export interface SaveRequest {
  card: Card;
  target: "book" | "plan";
  plan?: { date: string; entryType: MealType };
}

export interface SaveResponse {
  slug: string;
  recipeUrl?: string;
  planned?: { date: string; entryType: MealType };
  alreadyInBook: boolean;
}

export type ProposalKind = "existing" | "recipe" | "leftovers" | "empty";

export interface Proposal {
  kind: ProposalKind;
  name: string;
  recipeId?: string;
  slug?: string;
  protein?: string | null;
  reasons: string[];
  /** Mealie meal plan entry id, for existing entries. */
  entryId?: number;
  /** True when this dish makes enough for next-day leftovers. */
  leftoverFriendly?: boolean;
}

export interface PlanDay {
  date: string;
  weekday: number;
  busy: boolean;
  lunch: Proposal;
  dinner: Proposal;
}

export interface WeekResponse {
  days: PlanDay[];
}

export interface GenerateRequest {
  replaceExisting: boolean;
  /** Slots to keep as-is, keyed "YYYY-MM-DD|lunch" or "YYYY-MM-DD|dinner". */
  locked?: Record<string, Proposal>;
}

export interface ApplyRequest {
  days: PlanDay[];
  replaceExisting: boolean;
}

export interface AppConfigResponse {
  aiEnabled: boolean;
  passcodeRequired: boolean;
  busyDays: number[];
  mealieUrl?: string;
  cuisines: string[];
  categories: string[];
  dietary: FilterOption<DietId>[];
  meals: FilterOption<MealFilter>[];
  goals: FilterOption<GoalId>[];
}
