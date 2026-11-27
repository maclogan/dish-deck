// Types shared by the "Eat out" server routes and the web app.

export interface LatLng {
  lat: number;
  lng: number;
}

/** Google's price levels: 1 = $ ... 4 = $$$$. */
export type PriceLevel = 1 | 2 | 3 | 4;
export type ChainFilter = "any" | "independent" | "chain";
export type DiningSort = "best" | "distance" | "rating" | "gems";
export type ServiceOption = "dineIn" | "takeout" | "delivery";
export type DiningFeature = "outdoor" | "groups" | "kids" | "vegetarian" | "reservations";

export interface DiningFilters {
  minRating?: number;
  prices: PriceLevel[];
  /** Cuisine ids (Google place types, e.g. "thai_restaurant"). Any of these. */
  cuisines: string[];
  chain: ChainFilter;
  /** Only places open at the chosen time. */
  openAtTime: boolean;
  /** All of these. */
  service: ServiceOption[];
  /** All of these. */
  features: DiningFeature[];
}

export interface DiningSearchRequest {
  location: LatLng;
  radiusMiles: number;
  /** "HH:MM" today, in the place's local time. Leave out for "now". */
  when?: string;
  query?: string;
  filters: DiningFilters;
  sort: DiningSort;
  /** The app's AI switch. */
  ai: boolean;
}

export type ReservationLevel = "required" | "recommended" | "walk-in" | "not-taken" | "unknown";
export interface ReservationAdvice {
  level: ReservationLevel;
  label: string;
  reason?: string;
}

export type SizeLevel = "small" | "medium" | "large";
export interface SizeEstimate {
  level: SizeLevel;
  /** e.g. "Small · about 20 seats" */
  label: string;
}

export interface PlaceSummary {
  id: string;
  name: string;
  address?: string;
  location: LatLng;
  distanceMiles: number;
  rating?: number;
  ratingCount?: number;
  price?: PriceLevel;
  /** "Thai", "Pizza", ... */
  cuisine?: string;
  /** The place's Google Maps listing (reviews, photos, popular times). */
  mapsUrl: string;
  /** The restaurant's own site. */
  website?: string;
  /** Signed photo URL (served through this app, so the Google key stays on the server). */
  photo?: string;
  /** Open at the chosen time (undefined: hours unknown). */
  openAtTime?: boolean;
  /** Closes within an hour of the chosen time. */
  closesSoon?: boolean;
  /** "11 AM – 9 PM" for the chosen day. */
  hoursToday?: string;
  chain: boolean;
  /** Most important first. AI tags when AI is on and has read the place, else Google's attributes. */
  tags: string[];
  tagsSource: "ai" | "google";
  /** Why it fits the search (AI rerank). */
  why?: string;
  size?: SizeEstimate;
  reservation: ReservationAdvice;
}

export interface PlaceReview {
  author: string;
  authorUrl?: string;
  rating?: number;
  text: string;
  /** "2 weeks ago" */
  when: string;
}

export interface PlaceAttribute {
  label: string;
  value: boolean;
}

export interface PlaceDetails extends PlaceSummary {
  phone?: string;
  photos: string[];
  /** One line per weekday, Monday first ("Monday: 11 AM – 9 PM"). */
  hours: string[];
  reviews: PlaceReview[];
  /** Google's own summaries, when it has them. */
  googleSummary?: string;
  editorialSummary?: string;
  attributes: PlaceAttribute[];
  /** AI pros/cons from Google reviews plus local chatter. */
  aiSummary?: AiPlaceSummary;
}

export interface AiPlaceSummary {
  overview: string;
  pros: string[];
  cons: string[];
}

/** What AI adds to a place. Cached per place. */
export interface PlaceEnrichment {
  tags: string[];
  size?: SizeEstimate;
  reservation?: Exclude<ReservationLevel, "unknown">;
  reservationReason?: string;
  summary?: AiPlaceSummary;
}

export interface EnrichResponse {
  places: Record<string, Pick<PlaceSummary, "tags" | "tagsSource" | "size" | "reservation">>;
}

export interface ChatterItem {
  title: string;
  url: string;
  snippet: string;
  /** "reddit.com", "chicagotribune.com" */
  source: string;
}

export interface ChatterResponse {
  enabled: boolean;
  items: ChatterItem[];
  /** AI digest of what locals say (AI on). */
  summary?: string[];
}

export interface DiningSearchResponse {
  places: PlaceSummary[];
  /** e.g. "Searched for: cozy thai restaurant" */
  note?: string;
  aiUsed: boolean;
}

export interface NeverEntry {
  id: string;
  name: string;
  address?: string;
  at: number;
}

export interface LocationSuggestion {
  id: string;
  label: string;
  secondary?: string;
}

export interface DiningConfig {
  enabled: boolean;
  /** Browser key for Google Maps (Map mode). */
  mapsBrowserKey?: string;
  chatter: boolean;
  /** Default search radius; Filters can widen it up to maxRadiusMiles. */
  radiusMiles: number;
  maxRadiusMiles: number;
  /** Where to search when a phone won't share its location. */
  defaultLocation: { label: string } & LatLng;
  cuisines: { id: string; label: string }[];
}
