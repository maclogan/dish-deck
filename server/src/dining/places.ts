// Google Places API (New) client: nearby and text search, details, photos and address autocomplete.
// https://developers.google.com/maps/documentation/places/web-service/op-overview
//
// Cost note: Google bills each request by the most expensive field it asks for. Searches here ask for
// reviews and the dine-in/outdoor/reservable flags (the "Enterprise + Atmosphere" SKU), so one search
// page returns everything the list, the filters and the AI need, and opening a place costs nothing extra.

import type { LatLng, PriceLevel } from "./types.js";

export interface GText {
  text?: string;
}
export interface GReview {
  rating?: number;
  text?: GText;
  originalText?: GText;
  relativePublishTimeDescription?: string;
  authorAttribution?: { displayName?: string; uri?: string };
}
export interface GPlace {
  id: string;
  displayName?: GText;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  primaryType?: string;
  primaryTypeDisplayName?: GText;
  types?: string[];
  businessStatus?: string;
  regularOpeningHours?: {
    periods?: { open: { day: number; hour: number; minute?: number }; close?: { day: number; hour: number; minute?: number } }[];
    weekdayDescriptions?: string[];
  };
  utcOffsetMinutes?: number;
  photos?: { name: string; authorAttributions?: { displayName?: string; uri?: string }[] }[];
  reviews?: GReview[];
  reviewSummary?: { text?: GText };
  editorialSummary?: GText;
  generativeSummary?: { overview?: GText };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
  reservable?: boolean;
  servesBreakfast?: boolean;
  servesBrunch?: boolean;
  servesLunch?: boolean;
  servesDinner?: boolean;
  servesBeer?: boolean;
  servesWine?: boolean;
  servesCocktails?: boolean;
  servesCoffee?: boolean;
  servesDessert?: boolean;
  servesVegetarianFood?: boolean;
  outdoorSeating?: boolean;
  liveMusic?: boolean;
  goodForChildren?: boolean;
  goodForGroups?: boolean;
  goodForWatchingSports?: boolean;
  menuForChildren?: boolean;
  allowsDogs?: boolean;
  dineIn?: boolean;
  takeout?: boolean;
  delivery?: boolean;
  paymentOptions?: { acceptsCreditCards?: boolean; acceptsCashOnly?: boolean; acceptsNfc?: boolean };
  parkingOptions?: Record<string, boolean | undefined>;
  accessibilityOptions?: { wheelchairAccessibleEntrance?: boolean; wheelchairAccessibleSeating?: boolean };
}

const BASE_FIELDS = [
  "id", "displayName", "formattedAddress", "shortFormattedAddress", "addressComponents", "location", "rating",
  "userRatingCount", "priceLevel", "primaryType", "primaryTypeDisplayName", "types", "businessStatus",
  "regularOpeningHours", "utcOffsetMinutes", "photos", "websiteUri", "nationalPhoneNumber", "googleMapsUri",
  "reservable", "servesBreakfast", "servesBrunch", "servesLunch", "servesDinner", "servesBeer", "servesWine",
  "servesCocktails", "servesCoffee", "servesDessert", "servesVegetarianFood", "outdoorSeating", "liveMusic",
  "goodForChildren", "goodForGroups", "goodForWatchingSports", "menuForChildren", "allowsDogs", "dineIn", "takeout",
  "delivery", "paymentOptions", "parkingOptions", "accessibilityOptions", "reviews", "editorialSummary",
];
/** Newer AI summary fields; not offered in every region, so a search retries without them if refused. */
const SUMMARY_FIELDS = ["reviewSummary", "generativeSummary"];

const PRICE: Record<string, PriceLevel> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};
const PRICE_NAMES = Object.fromEntries(Object.entries(PRICE).map(([k, v]) => [v, k])) as Record<PriceLevel, string>;

export const priceLevel = (p: string | undefined): PriceLevel | undefined => (p ? PRICE[p] : undefined);

export class PlacesError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const METERS_PER_MILE = 1609.344;
export const milesToMeters = (mi: number) => Math.min(50_000, Math.max(100, mi * METERS_PER_MILE));

/** The box around a circle, as Google's {low, high} rectangle. */
export function boundingBox(center: LatLng, radiusMiles: number) {
  const dLat = radiusMiles / 69;
  const dLng = radiusMiles / (69 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180)));
  return {
    low: { latitude: Math.max(-90, center.lat - dLat), longitude: Math.max(-180, center.lng - dLng) },
    high: { latitude: Math.min(90, center.lat + dLat), longitude: Math.min(180, center.lng + dLng) },
  };
}

/** Great-circle distance in miles. */
export function distanceMiles(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class PlacesClient {
  private summaries = true;

  constructor(
    private apiKey: string,
    private baseUrl = "https://places.googleapis.com",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private fields(prefix = "") {
    return [...BASE_FIELDS, ...(this.summaries ? SUMMARY_FIELDS : [])].map((f) => prefix + f).join(",");
  }

  private async request<T>(method: "GET" | "POST", path: string, fieldMask: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": fieldMask,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new PlacesError(`Google Places: ${data.error?.message ?? `HTTP ${res.status}`}`, res.status);
    return data;
  }

  /** Search requests, retried once without the summary fields if Google rejects them. */
  private async withFields<T>(run: (mask: (prefix?: string) => string) => Promise<T>): Promise<T> {
    try {
      return await run((p) => this.fields(p));
    } catch (err) {
      if (this.summaries && err instanceof PlacesError && err.status === 400 && /field|mask/i.test(err.message)) {
        this.summaries = false;
        return run((p) => this.fields(p));
      }
      throw err;
    }
  }

  /**
   * One page (up to 20) of a text search, limited to the box around the search circle. Google applies
   * the rating, price, type and open-now filters itself, so every result already fits them. Pass the
   * returned `next` token (with the same options) for the next page; Google gives up to 3 pages.
   */
  async textPage(opts: {
    query: string;
    center: LatLng;
    radiusMiles: number;
    /** Only places of this Google type (e.g. "restaurant", "thai_restaurant"). */
    type?: string;
    minRating?: number;
    prices?: PriceLevel[];
    openNow?: boolean;
    rank?: "RELEVANCE" | "DISTANCE";
    pageToken?: string;
  }): Promise<{ places: GPlace[]; next?: string }> {
    const data = await this.withFields((mask) =>
      this.request<{ places?: GPlace[]; nextPageToken?: string }>("POST", "/v1/places:searchText", `${mask("places.")},nextPageToken`, {
        textQuery: opts.query,
        pageSize: 20,
        locationRestriction: { rectangle: boundingBox(opts.center, opts.radiusMiles) },
        ...(opts.type ? { includedType: opts.type, strictTypeFiltering: true } : {}),
        ...(opts.minRating ? { minRating: opts.minRating } : {}),
        ...(opts.prices?.length ? { priceLevels: opts.prices.map((p) => PRICE_NAMES[p]) } : {}),
        ...(opts.openNow ? { openNow: true } : {}),
        ...(opts.rank ? { rankPreference: opts.rank } : {}),
        ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
      }),
    );
    return { places: data.places ?? [], next: data.nextPageToken || undefined };
  }

  async details(id: string): Promise<GPlace> {
    return this.withFields((mask) => this.request<GPlace>("GET", `/v1/places/${encodeURIComponent(id)}`, mask()));
  }

  /** Address/place suggestions for the "set location" box. */
  async autocomplete(input: string, near?: LatLng): Promise<{ id: string; label: string; secondary?: string }[]> {
    const data = await this.request<{
      suggestions?: { placePrediction?: { placeId: string; structuredFormat?: { mainText?: GText; secondaryText?: GText }; text?: GText } }[];
    }>("POST", "/v1/places:autocomplete", "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text", {
      input,
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50_000 } } } : {}),
    });
    return (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
      .map((p) => ({
        id: p.placeId,
        label: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text,
      }));
  }

  /** Where a suggested place is (a cheap request: location fields only). */
  async locate(id: string): Promise<{ label: string } & LatLng> {
    const p = await this.request<GPlace>("GET", `/v1/places/${encodeURIComponent(id)}`, "id,displayName,formattedAddress,location");
    if (!p.location) throw new PlacesError("Google Places: that place has no location", 404);
    return { label: p.displayName?.text ?? p.formattedAddress ?? "Chosen spot", lat: p.location.latitude, lng: p.location.longitude };
  }

  /** A place photo's bytes (Google redirects to the image). */
  async photo(name: string, maxWidth: number): Promise<{ body: ArrayBuffer; type: string } | undefined> {
    const url = new URL(`${this.baseUrl}/v1/${name}/media`);
    url.searchParams.set("maxWidthPx", String(maxWidth));
    url.searchParams.set("key", this.apiKey);
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
    if (!res?.ok) return undefined;
    return { body: await res.arrayBuffer(), type: res.headers.get("content-type") ?? "image/jpeg" };
  }
}
