import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { reservationAdvice } from "../src/dining/advice.js";
import type { AiDining, AiEnrichment, PlaceBrief, QueryPlan } from "../src/dining/ai.js";
import { baseName, detectChains, isKnownBrand, parseBrandLines } from "../src/dining/chains.js";
import { excerptAround } from "../src/dining/chatter.js";
import { hoursLine, localMoment, openAt, parseClock } from "../src/dining/hours.js";
import { type GPlace, PlacesClient, distanceMiles } from "../src/dining/places.js";
import { DiningService, gemScore, googleTags, mergePlan, tzOffsetMinutes } from "../src/dining/service.js";
import type { DiningFilters } from "../src/dining/types.js";
import { Store } from "../src/store.js";

const NOFILTER: DiningFilters = { prices: [], cuisines: [], chain: "any", openAtTime: false, service: [], features: [] };
const HERE = { lat: 41.88, lng: -87.63 };

describe("opening hours", () => {
  const weekdays = Array.from({ length: 7 }, (_, d) => ({ open: { day: d, hour: 11 }, close: { day: d, hour: 22 } }));
  it("knows open and closed times, and how long until closing", () => {
    expect(openAt(weekdays, 2, 12 * 60)).toEqual({ open: true, closesIn: 600 });
    expect(openAt(weekdays, 2, 10 * 60)?.open).toBe(false);
    expect(openAt(weekdays, 2, 22 * 60)?.open).toBe(false);
    expect(openAt(undefined, 2, 600)).toBeUndefined();
  });
  it("handles hours past midnight, including Saturday night into Sunday", () => {
    const late = [{ open: { day: 6, hour: 18 }, close: { day: 0, hour: 2 } }];
    expect(openAt(late, 6, 23 * 60)?.open).toBe(true);
    expect(openAt(late, 0, 60)).toEqual({ open: true, closesIn: 60 });
    expect(openAt(late, 0, 3 * 60)?.open).toBe(false);
  });
  it("treats a single open-at-midnight period with no close as always open", () => {
    expect(openAt([{ open: { day: 0, hour: 0 } }], 3, 400)).toEqual({ open: true, closesIn: Infinity });
  });
  it("parses times and finds the place's local moment", () => {
    expect(parseClock("19:30")).toBe(1170);
    expect(parseClock("25:00")).toBeUndefined();
    expect(localMoment(-360, new Date("2026-11-26T23:30:00Z"))).toEqual({ day: 4, minutes: 17 * 60 + 30 });
    expect(hoursLine(["Monday: 9 AM – 5 PM", "Tuesday: Closed", "", "", "", "", "Sunday: 10 AM – 2 PM"], 0)).toBe("10 AM – 2 PM");
    expect(tzOffsetMinutes("America/Chicago", new Date("2026-07-01T12:00:00Z"))).toBe(-300);
  });
});

describe("chains", () => {
  const brands = parseBrandLines("chipotle|001\npanera bread|ca,us\nsubway|001\nmcdonalds|us\njollibee|ph,us\nboo|us");
  it("matches brand names, with suffixes and branch names", () => {
    expect(isKnownBrand(brands, "Chipotle Mexican Grill")).toBe(true);
    expect(isKnownBrand(brands, "McDonald's")).toBe(true);
    expect(isKnownBrand(brands, "Panera Bread - Downtown")).toBe(true);
    expect(baseName("Subway (Main St)")).toBe("subway");
  });
  it("doesn't flag independents or brands from elsewhere", () => {
    expect(isKnownBrand(brands, "Pho Lan")).toBe(false);
    expect(isKnownBrand(brands, "Panera Bread", "jp")).toBe(false);
    // Short one-word brands only match the whole name.
    expect(isKnownBrand(brands, "Boo Thai Kitchen")).toBe(false);
  });
  it("also counts repeated names and fast food", async () => {
    const set = await detectChains(
      [
        { id: "a", name: "Joe's Tacos", types: [] },
        { id: "b", name: "Joe's Tacos - North", types: [] },
        { id: "c", name: "Burger Spot", types: ["fast_food_restaurant"] },
        { id: "d", name: "Pho Lan", types: [] },
      ],
      brands,
    );
    expect([...set].sort()).toEqual(["a", "b", "c"]);
  });
  it("ships a brand list", async () => {
    expect((await detectChains([{ id: "x", name: "Starbucks", types: ["cafe"], country: "US" }])).has("x")).toBe(true);
  });
});

describe("reservation advice", () => {
  it("prefers what reviews say, then Google's flag and price", () => {
    expect(reservationAdvice({ reservable: true, ai: "required" }).label).toBe("Reservations required");
    expect(reservationAdvice({ reservable: false }).level).toBe("not-taken");
    expect(reservationAdvice({ reservable: true, price: 4 }).label).toBe("Book ahead");
    expect(reservationAdvice({ reservable: true, price: 2 }).level).toBe("walk-in");
    expect(reservationAdvice({}).level).toBe("unknown");
  });
});

describe("helpers", () => {
  it("measures distance", () => {
    expect(distanceMiles(HERE, { lat: 41.89, lng: -87.63 })).toBeCloseTo(0.69, 1);
  });
  it("turns Google's facts into tags", () => {
    expect(googleTags({ id: "x", paymentOptions: { acceptsCashOnly: true }, outdoorSeating: true, reservable: true } as GPlace)).toEqual([
      "cash only",
      "takes reservations",
      "outdoor seating",
    ]);
  });
  it("ranks hidden gems: loved, not yet crowded, independent", () => {
    const gem = gemScore({ rating: 4.8, ratingCount: 60, chain: false });
    expect(gem).toBeGreaterThan(gemScore({ rating: 4.6, ratingCount: 3000, chain: false }));
    expect(gem).toBeGreaterThan(gemScore({ rating: 4.8, ratingCount: 60, chain: true }));
    expect(gem).toBeGreaterThan(gemScore({ rating: 4.9, ratingCount: 3, chain: false }));
  });
  it("adds AI-read filters without overriding the person's own picks", () => {
    const plan: QueryPlan = { textQuery: "thai", vibe: [], cuisines: ["thai_restaurant"], prices: [1], features: ["outdoor"], chain: "independent" };
    expect(mergePlan({ ...NOFILTER, prices: [3] }, plan)).toMatchObject({ cuisines: ["thai_restaurant"], prices: [3], features: ["outdoor"], chain: "independent" });
  });
  it("excerpts text around a name", () => {
    expect(excerptAround("lots of words. We loved Pho Lan downtown. More words.", "Pho Lan")).toContain("loved Pho Lan");
  });
});

// ------------------------------------------------------------------ service, with a fake Google

function gplace(n: number, extra: Partial<GPlace> = {}): GPlace {
  return {
    id: `place${String(n).padStart(6, "0")}`,
    displayName: { text: `Place ${n}` },
    location: { latitude: HERE.lat + n * 0.002, longitude: HERE.lng },
    rating: 4 + n / 10,
    userRatingCount: 100 * n,
    priceLevel: "PRICE_LEVEL_MODERATE",
    primaryType: "thai_restaurant",
    types: ["thai_restaurant", "restaurant"],
    businessStatus: "OPERATIONAL",
    utcOffsetMinutes: 0,
    regularOpeningHours: { periods: [{ open: { day: 0, hour: 0 } }], weekdayDescriptions: [] },
    googleMapsUri: `https://maps.google.com/?cid=${n}`,
    reviews: [{ text: { text: `Review of place ${n}` }, rating: 5, authorAttribution: { displayName: "Ann" } }],
    photos: [{ name: `places/place${n}/photos/p1` }],
    ...extra,
  };
}

/** A fake Places API. Pass pages (arrays of places) to test paging; a flat list is one page. */
function fakeGoogle(places: GPlace[] | GPlace[][]) {
  const pages = (Array.isArray(places[0]) ? places : [places]) as GPlace[][];
  const all = pages.flat();
  const calls: { path: string; body?: any; mask?: string }[] = [];
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: url.pathname, body, mask: (init?.headers as Record<string, string> | undefined)?.["X-Goog-FieldMask"] });
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
    if (url.pathname.endsWith(":searchText")) {
      const n = body.pageToken ? Number(body.pageToken) : 0;
      return json({ places: pages[n] ?? [], ...(n + 1 < pages.length ? { nextPageToken: String(n + 1) } : {}) });
    }
    const id = url.pathname.split("/").pop();
    const p = all.find((x) => x.id === id);
    return p ? json(p) : new Response(JSON.stringify({ error: { message: "nope" } }), { status: 404 });
  }) as typeof fetch;
  return { client: new PlacesClient("key", "https://places.test", fetchImpl), calls };
}

function fakeAi() {
  const calls: string[] = [];
  const ai = {
    plan: async (q: string): Promise<QueryPlan> => {
      calls.push(`plan:${q}`);
      return { textQuery: "thai restaurant", vibe: ["hole-in-the-wall"], cuisines: [], prices: [], features: [] };
    },
    rank: async (_q: string, _v: string[], places: PlaceBrief[]) => {
      calls.push(`rank:${places.length}`);
      // Reverse Google's order.
      return new Map(places.map((p, i) => [p.id, { score: i, why: `fits ${p.name}` }]));
    },
    enrich: async (places: PlaceBrief[]) => {
      calls.push(`enrich:${places.length}`);
      return new Map<string, AiEnrichment>(
        places.map((p) => [p.id, { tags: ["tiny", "cash only"], size: { level: "small", label: "Small" }, reservation: "walk-in", summary: { overview: "ok", pros: [], cons: [] } }]),
      );
    },
    localTake: async () => ["Locals love it"],
  } as unknown as AiDining;
  return { ai, calls };
}

function service(places: GPlace[] | GPlace[][], withAi = true) {
  const google = fakeGoogle(places);
  const ai = fakeAi();
  const store = new Store(":memory:");
  const svc = new DiningService({
    places: google.client,
    store,
    ai: withAi ? ai.ai : undefined,
    timezone: "UTC",
    photoUrl: (name, w) => `/photo/${name}/${w}`,
    warn: () => undefined,
  });
  return { svc, google, ai, store };
}

describe("DiningService", () => {
  it("searches restaurants in the circle's box, removes never-again places, and never uses likes", async () => {
    const { svc, store, google } = service([gplace(1), gplace(2), gplace(3)]);
    store.addNever("household", "place000002", "Place 2");
    const r = await svc.search({ location: HERE, radiusMiles: 3, filters: NOFILTER, sort: "best", ai: false });
    expect(r.places.map((p) => p.name)).toEqual(["Place 1", "Place 3"]);
    expect(google.calls[0]!.path).toBe("/v1/places:searchText");
    expect(google.calls[0]!.body).toMatchObject({ textQuery: "restaurants", includedType: "restaurant", pageSize: 20 });
    const box = google.calls[0]!.body.locationRestriction.rectangle;
    expect(box.low.latitude).toBeCloseTo(HERE.lat - 3 / 69, 3);
    expect(box.high.longitude).toBeGreaterThan(HERE.lng);
    // One request returns everything the list needs (reviews included), so the place sheet needs no extra call.
    expect(google.calls[0]!.mask).toContain("places.reviews");
    const d = await svc.details("place000001", { location: HERE, ai: false });
    expect(google.calls).toHaveLength(1);
    expect(d.reviews[0]!.author).toBe("Ann");
    expect(d.mapsUrl).toBe("https://maps.google.com/?cid=1");
  });

  it("applies filters: price, rating, chains, open at the chosen time, features", async () => {
    const lunchOnly = { periods: Array.from({ length: 7 }, (_, d) => ({ open: { day: d, hour: 11 }, close: { day: d, hour: 14 } })), weekdayDescriptions: [] };
    const { svc } = service([
      gplace(1, { priceLevel: "PRICE_LEVEL_EXPENSIVE" }),
      gplace(2, { regularOpeningHours: lunchOnly }),
      gplace(3, { displayName: { text: "Starbucks" } }),
      gplace(4, { outdoorSeating: true, rating: 3.9 }),
      gplace(5, { outdoorSeating: true }),
    ]);
    const search = (f: Partial<DiningFilters>, when?: string) =>
      svc.search({ location: HERE, radiusMiles: 3, when, filters: { ...NOFILTER, ...f }, sort: "best", ai: false }).then((r) => r.places.map((p) => p.name));
    expect(await search({ prices: [3] })).toEqual(["Place 1"]);
    expect(await search({ chain: "independent" })).not.toContain("Starbucks");
    expect(await search({ chain: "chain" })).toEqual(["Starbucks"]);
    expect(await search({ openAtTime: true }, "20:00")).not.toContain("Place 2");
    expect(await search({ openAtTime: true }, "12:00")).toContain("Place 2");
    expect(await search({ features: ["outdoor"], minRating: 4 })).toEqual(["Place 5"]);
  });

  it("sorts by distance, rating and hidden gems", async () => {
    const { svc } = service([gplace(3), gplace(1, { rating: 4.9, userRatingCount: 40 }), gplace(2)]);
    const names = (sort: "distance" | "rating" | "gems") =>
      svc.search({ location: HERE, radiusMiles: 3, filters: NOFILTER, sort, ai: false }).then((r) => r.places.map((p) => p.name));
    expect(await names("distance")).toEqual(["Place 1", "Place 2", "Place 3"]);
    expect((await names("rating"))[0]).toBe("Place 1");
    expect((await names("gems"))[0]).toBe("Place 1");
  });

  it("with AI on, plans the search, reranks by reviews and adds tags; with AI off, uses none of it", async () => {
    const { svc, ai, google } = service([gplace(1), gplace(2), gplace(3)]);
    const on = await svc.search({ location: HERE, radiusMiles: 3, query: "cozy hole-in-the-wall thai", filters: NOFILTER, sort: "best", ai: true });
    expect(google.calls[0]!.body.textQuery).toBe("thai restaurant");
    expect(on.places.map((p) => p.name)).toEqual(["Place 3", "Place 2", "Place 1"]);
    expect(on.places[0]!.why).toBe("fits Place 3");
    expect(on.note).toContain("hole-in-the-wall");
    expect(on.places[0]!.tagsSource).toBe("google");

    const enriched = await svc.enrich(["place000001"], { location: HERE, ai: true });
    expect(enriched.places.place000001).toMatchObject({ tags: ["tiny", "cash only"], tagsSource: "ai", size: { level: "small" } });
    // Cached: a second look doesn't ask the AI again.
    await svc.enrich(["place000001"], { location: HERE, ai: true });
    expect(ai.calls.filter((c) => c.startsWith("enrich"))).toEqual(["enrich:1"]);

    const before = ai.calls.length;
    const off = await svc.search({ location: HERE, radiusMiles: 3, query: "cozy hole-in-the-wall thai", filters: NOFILTER, sort: "best", ai: false });
    expect(ai.calls.length).toBe(before);
    expect(off.aiUsed).toBe(false);
    expect(off.places.every((p) => p.tagsSource === "google" && !p.why && !p.size)).toBe(true);
    expect(google.calls.at(-1)!.body.textQuery).toBe("cozy hole-in-the-wall thai");
  });

  it("lets Google apply rating, price and open-now, and searches each picked cuisine", async () => {
    const { svc, google } = service([gplace(1)]);
    await svc.search({ location: HERE, radiusMiles: 3, filters: { ...NOFILTER, minRating: 4, prices: [1, 2], openAtTime: true }, sort: "distance", ai: false });
    expect(google.calls[0]!.body).toMatchObject({ minRating: 4, priceLevels: ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"], openNow: true, rankPreference: "DISTANCE" });
    google.calls.length = 0;
    await svc.search({ location: HERE, radiusMiles: 3, when: "19:00", filters: { ...NOFILTER, cuisines: ["thai_restaurant", "pizza_restaurant"], openAtTime: true }, sort: "best", ai: false });
    expect(google.calls.map((c) => [c.body.textQuery, c.body.includedType, c.body.openNow])).toEqual([
      ["Thai restaurant", "thai_restaurant", undefined],
      ["Pizza restaurant", "pizza_restaurant", undefined],
    ]);
  });

  it("fetches more pages while too few places pass the filters, up to 3 requests", async () => {
    const closedAt7 = { periods: Array.from({ length: 7 }, (_, d) => ({ open: { day: d, hour: 8 }, close: { day: d, hour: 15 } })), weekdayDescriptions: [] };
    const page = (from: number, openCount: number) =>
      Array.from({ length: 20 }, (_, i) => gplace(from + i, i < openCount ? { location: { latitude: HERE.lat, longitude: HERE.lng } } : { regularOpeningHours: closedAt7, location: { latitude: HERE.lat, longitude: HERE.lng } }));
    const { svc, google } = service([page(100, 5), page(200, 5), page(300, 5), page(400, 5)]);
    const r = await svc.search({ location: HERE, radiusMiles: 3, when: "19:00", filters: { ...NOFILTER, openAtTime: true }, sort: "best", ai: false });
    expect(google.calls).toHaveLength(3);
    expect(r.places).toHaveLength(15);
    // Enough left after the first page: no more requests.
    const many = service([page(500, 20), page(600, 20)]);
    await many.svc.search({ location: HERE, radiusMiles: 3, when: "19:00", filters: { ...NOFILTER, openAtTime: true }, sort: "best", ai: false });
    expect(many.google.calls).toHaveLength(1);
  });

  it("leaves out places that only serve food on the side", async () => {
    const { svc } = service([
      gplace(1, { displayName: { text: "Topgolf" }, primaryType: "sports_activity_location", types: ["sports_activity_location", "restaurant", "bar"] }),
      gplace(2, { displayName: { text: "Cinema 8" }, primaryType: "movie_theater", types: ["movie_theater", "restaurant"] }),
      gplace(3, { displayName: { text: "Corner Bakery" }, primaryType: "bakery", types: ["bakery", "cafe"] }),
      gplace(4, { displayName: { text: "No Main Type Diner" }, primaryType: undefined, types: ["restaurant", "food"] }),
      gplace(5, { displayName: { text: "Lanes & Grill" }, primaryType: undefined, types: ["bowling_alley", "restaurant"] }),
      gplace(6),
    ]);
    const r = await svc.search({ location: HERE, radiusMiles: 3, filters: NOFILTER, sort: "best", ai: false });
    expect(r.places.map((p) => p.name)).toEqual(["Corner Bakery", "No Main Type Diner", "Place 6"]);
  });

  it("drops closed businesses and places far outside the circle", async () => {
    const { svc } = service([gplace(1, { businessStatus: "CLOSED_PERMANENTLY" }), gplace(2, { location: { latitude: 42.5, longitude: -87.63 } }), gplace(3)]);
    const r = await svc.search({ location: HERE, radiusMiles: 3, query: "thai", filters: NOFILTER, sort: "best", ai: false });
    expect(r.places.map((p) => p.name)).toEqual(["Place 3"]);
  });
});

// ------------------------------------------------------------------ routes

const config: Config = {
  port: 0,
  host: "127.0.0.1",
  mealieUrl: "http://mealie.test",
  mealieToken: "tok",
  anthropicModel: "claude-haiku-5-5",
  householdContext: "a busy family",
  wikipediaApiUrl: "https://en.wikipedia.test/w/api.php",
  prefetchSecondsPerSite: 0,
  mealdbKey: "1",
  mealdbBaseUrl: "https://www.themealdb.com",
  timezone: "UTC",
  busyDays: [],
  planStart: "today",
  leftovers: true,
  staples: [],
  webDir: "/nonexistent",
  googlePlacesBaseUrl: "https://places.test",
  appPasscode: "secret",
};

describe("dining routes", () => {
  it("are off without a Google key", async () => {
    const app = buildApp(config, { store: new Store(":memory:"), dining: null });
    const res = await app.inject({ method: "GET", url: "/api/dining/never", headers: { "x-app-passcode": "secret" } });
    expect(res.statusCode).toBe(404);
  });

  it("need the passcode, validate input, and keep the never-again list", async () => {
    const { svc } = service([gplace(1), gplace(2)], false);
    const app = buildApp(config, { store: new Store(":memory:"), dining: svc });
    const h = { "x-app-passcode": "secret" };
    expect((await app.inject({ method: "GET", url: "/api/dining/never" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/dining/search", headers: h, payload: { location: { lat: 999, lng: 0 }, radiusMiles: 3 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/dining/search", headers: h, payload: { location: HERE, radiusMiles: 101 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/dining/search", headers: h, payload: { location: HERE, radiusMiles: 0.5 } })).statusCode).toBe(400);

    await app.inject({ method: "POST", url: "/api/dining/never", headers: h, payload: { id: "place000001", name: "Place 1" } });
    const list = (await app.inject({ method: "GET", url: "/api/dining/never", headers: h })).json();
    expect(list.places.map((p: { name: string }) => p.name)).toEqual(["Place 1"]);
    const r = (await app.inject({ method: "POST", url: "/api/dining/search", headers: h, payload: { location: HERE, radiusMiles: 3, ai: false } })).json();
    expect(r.places.map((p: { name: string }) => p.name)).toEqual(["Place 2"]);
    await app.inject({ method: "DELETE", url: "/api/dining/never/place000001", headers: h });
    expect((await app.inject({ method: "GET", url: "/api/dining/never", headers: h })).json().places).toEqual([]);
  });

  it("serves signed photo URLs without the passcode header, and nothing unsigned", async () => {
    const app = buildApp(config, { store: new Store(":memory:"), dining: null });
    const bad = await app.inject({ method: "GET", url: "/api/dining/photo?name=places/x/photos/y&w=640&sig=wrong" });
    expect(bad.statusCode).toBe(401);
    const { diningPhotoUrl } = await import("../src/app.js");
    const ok = await app.inject({ method: "GET", url: diningPhotoUrl("secret", "places/x/photos/y", 640) });
    // Past the passcode check; the tab is off in this app, so it's a 404 rather than a 401.
    expect(ok.statusCode).toBe(404);
  });

  it("reports the tab in /api/config", async () => {
    const { svc } = service([], false);
    const app = buildApp(config, { store: new Store(":memory:"), dining: svc });
    const c = (await app.inject({ method: "GET", url: "/api/config" })).json();
    expect(c.dining).toMatchObject({ enabled: true, radiusMiles: 25, minRadiusMiles: 1, maxRadiusMiles: 100, defaultLocation: { label: "Denver, CO" } });
    expect(c.dining.cuisines.length).toBeGreaterThan(20);
  });
});
