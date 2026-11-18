// Shared types used by the server and (type-only) by the web app.

export type CardSource = "mealdb" | "ai" | "mealie";
export type MealType = "lunch" | "dinner";

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
  cuisine?: string;
  category?: string;
  onHand: boolean;
  /** Max missing ingredients allowed when onHand is true. */
  leniency: number;
  count: number;
  /** Card keys the user has already seen this session. */
  exclude: string[];
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
}
