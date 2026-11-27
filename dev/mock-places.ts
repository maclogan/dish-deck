// Fake Google Places API (New) for the "Eat out" tab, used by dev/mock-server.ts.
// Start the app with GOOGLE_MAPS_API_KEY=dev GOOGLE_PLACES_BASE_URL=http://localhost:9100 (dev/mock.env does).
// Places are laid out around whatever location the app searches from, so any spot works.

import type { FastifyInstance } from "fastify";

type Hours = { open: { day: number; hour: number; minute?: number }; close?: { day: number; hour: number; minute?: number } }[];
const daily = (open: number, close: number): Hours =>
  Array.from({ length: 7 }, (_, d) => ({ open: { day: d, hour: open, minute: 0 }, close: close > 24 ? { day: (d + 1) % 7, hour: close - 24, minute: 0 } : { day: close === 24 ? (d + 1) % 7 : d, hour: close % 24, minute: 0 } }));
const fmt = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h % 24 < 12 ? "AM" : "PM"}`;
const describe = (open: number, close: number) =>
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => `${d}: ${fmt(open)} – ${fmt(close % 24)}`);

interface Seed {
  name: string;
  type: string;
  types?: string[];
  rating: number;
  count: number;
  price?: number;
  hours: [number, number];
  /** Offset from the search center, in degrees (~0.01 = 0.7 mi). */
  at: [number, number];
  extra?: Record<string, unknown>;
  reviews: string[];
}

const SEEDS: Seed[] = [
  { name: "Pho Lan", type: "vietnamese_restaurant", rating: 4.7, count: 184, price: 1, hours: [10, 21], at: [0.004, -0.003], extra: { paymentOptions: { acceptsCashOnly: true }, dineIn: true, takeout: true, reservable: false, servesVegetarianFood: true }, reviews: ["Tiny place with maybe 8 tables, cash only, but the pho is the best in the city.", "Family-run hole in the wall. Broth is incredible. Expect a short line at lunch.", "No frills, fast, cheap. The owner remembers regulars."] },
  { name: "Casa Rosa Taqueria", type: "mexican_restaurant", rating: 4.5, count: 912, price: 2, hours: [11, 23], at: [-0.006, 0.005], extra: { outdoorSeating: true, servesCocktails: true, goodForGroups: true, reservable: true, dineIn: true, takeout: true, delivery: true }, reviews: ["Huge patio and great margaritas. Loud on weekends.", "Book ahead on Friday nights, the wait was over an hour.", "Al pastor tacos are a must."] },
  { name: "Tiny Lantern Dumpling House", type: "chinese_restaurant", rating: 4.8, count: 61, price: 1, hours: [11, 21], at: [0.008, 0.007], extra: { dineIn: true, takeout: true, reservable: false }, reviews: ["Hidden gem! Six seats at a counter, dumplings made in front of you.", "Easy to miss, worth finding. Soup dumplings are perfect."] },
  { name: "Nonna's Kitchen", type: "italian_restaurant", rating: 4.6, count: 1430, price: 3, hours: [16, 22], at: [-0.003, -0.009], extra: { reservable: true, servesWine: true, goodForChildren: true, dineIn: true }, reviews: ["Romantic, candlelit, great for a date. Reservations essential on weekends.", "Handmade pasta, cozy room, attentive service."] },
  { name: "Smoke & Ember BBQ", type: "barbecue_restaurant", rating: 4.4, count: 2210, price: 2, hours: [11, 22], at: [0.012, -0.01], extra: { goodForGroups: true, servesBeer: true, outdoorSeating: true, liveMusic: true, dineIn: true, takeout: true }, reviews: ["Big beer hall with long tables. Live music Thursday to Saturday.", "Brisket sells out by 7 on weekends."] },
  { name: "Kyoto Ramen Bar", type: "ramen_restaurant", types: ["japanese_restaurant"], rating: 4.5, count: 640, price: 2, hours: [11, 26], at: [0.002, 0.011], extra: { reservable: false, dineIn: true }, reviews: ["Open late, perfect after a show. Always a line but it moves fast.", "Tonkotsu is rich. Small, loud, fun."] },
  { name: "Saffron Table", type: "indian_restaurant", rating: 4.6, count: 820, price: 2, hours: [11, 22], at: [-0.009, -0.002], extra: { servesVegetarianFood: true, reservable: true, delivery: true, dineIn: true, takeout: true, goodForGroups: true }, reviews: ["Lunch buffet is a great deal.", "Lots of vegetarian dishes, spicy if you ask."] },
  { name: "Green Fork Café", type: "vegan_restaurant", types: ["cafe", "vegetarian_restaurant"], rating: 4.3, count: 290, price: 2, hours: [8, 16], at: [0.005, -0.012], extra: { servesVegetarianFood: true, servesBrunch: true, servesCoffee: true, outdoorSeating: true, allowsDogs: true, dineIn: true }, reviews: ["Bright café with a dog-friendly patio. Brunch lines on Sundays.", "Great coffee and grain bowls."] },
  { name: "Le Petit Bistro", type: "french_restaurant", rating: 4.7, count: 355, price: 4, hours: [17, 23], at: [-0.011, 0.009], extra: { reservable: true, servesWine: true, dineIn: true }, reviews: ["Special occasion spot. You need a reservation weeks ahead.", "Only 30 seats, intimate and quiet."] },
  { name: "Golden Wok", type: "chinese_restaurant", rating: 3.9, count: 410, price: 1, hours: [11, 22], at: [0.014, 0.003], extra: { delivery: true, takeout: true, dineIn: true }, reviews: ["Reliable takeout, generous portions.", "Nothing fancy, fast delivery."] },
  { name: "Blue Door Oyster Bar", type: "seafood_restaurant", rating: 4.5, count: 760, price: 3, hours: [16, 24], at: [-0.004, 0.014], extra: { reservable: true, servesCocktails: true, dineIn: true }, reviews: ["Happy hour oysters 4-6pm.", "Bustling bar, great for groups of four or fewer."] },
  { name: "Seoul Garden", type: "korean_restaurant", rating: 4.4, count: 980, price: 2, hours: [11, 23], at: [0.009, -0.006], extra: { goodForGroups: true, reservable: true, dineIn: true }, reviews: ["Tabletop grills, fun with a group.", "Banchan keeps coming. Can get smoky."] },
  { name: "Chipotle Mexican Grill", type: "mexican_restaurant", types: ["fast_food_restaurant"], rating: 3.8, count: 1200, price: 1, hours: [10, 22], at: [0.001, -0.006], extra: { takeout: true, delivery: true, dineIn: true }, reviews: ["It's Chipotle. Consistent."] },
  { name: "Panera Bread", type: "sandwich_shop", types: ["bakery", "cafe"], rating: 4.0, count: 870, price: 2, hours: [7, 21], at: [-0.007, -0.006], extra: { takeout: true, delivery: true, dineIn: true, servesBreakfast: true }, reviews: ["Good for a quick lunch."] },
];

const id = (i: number) => `mockplace${String(i).padStart(4, "0")}xyz`;
let center = { latitude: 41.8837, longitude: -87.6278 };

function place(i: number) {
  const s = SEEDS[i]!;
  const lat = center.latitude + s.at[0];
  const lng = center.longitude + s.at[1];
  const pid = id(i);
  return {
    id: pid,
    displayName: { text: s.name },
    formattedAddress: `${100 + i * 17} Mock St, Chicago, IL 60601, USA`,
    shortFormattedAddress: `${100 + i * 17} Mock St`,
    addressComponents: [
      { longText: "Chicago", shortText: "Chicago", types: ["locality", "political"] },
      { longText: "United States", shortText: "US", types: ["country", "political"] },
    ],
    location: { latitude: lat, longitude: lng },
    rating: s.rating,
    userRatingCount: s.count,
    priceLevel: s.price ? ["", "PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"][s.price] : undefined,
    primaryType: s.type,
    primaryTypeDisplayName: { text: s.type.replace(/_/g, " ") },
    types: [s.type, ...(s.types ?? []), "restaurant", "food", "establishment"],
    businessStatus: "OPERATIONAL",
    regularOpeningHours: { periods: daily(s.hours[0], s.hours[1]), weekdayDescriptions: describe(s.hours[0], s.hours[1]) },
    utcOffsetMinutes: -360,
    photos: [1, 2, 3].map((n) => ({ name: `places/${pid}/photos/p${n}` })),
    websiteUri: i % 3 === 2 ? undefined : `https://example.com/${s.name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    nationalPhoneNumber: `(312) 555-01${String(i).padStart(2, "0")}`,
    googleMapsUri: `https://maps.google.com/?cid=${1000 + i}`,
    reviews: s.reviews.map((t, n) => ({
      rating: Math.min(5, Math.round(s.rating) - (n === 2 ? 1 : 0)),
      text: { text: t },
      relativePublishTimeDescription: `${n + 1} week${n ? "s" : ""} ago`,
      authorAttribution: { displayName: ["Sam R.", "Priya K.", "Diego M."][n] ?? "Local Guide", uri: "https://maps.google.com/" },
    })),
    editorialSummary: { text: `A ${s.type.replace(/_/g, " ")} near you.` },
    ...s.extra,
  };
}

export function registerPlacesMock(app: FastifyInstance, svg: (seed: number, label: string) => string) {
  const all = () => SEEDS.map((_, i) => place(i));
  app.post<{ Body: { locationRestriction?: { circle?: { center?: typeof center } }; includedTypes?: string[] } }>("/v1/places::searchNearby", async (req) => {
    if (req.body.locationRestriction?.circle?.center) center = req.body.locationRestriction.circle.center;
    const types = req.body.includedTypes ?? ["restaurant"];
    await new Promise((r) => setTimeout(r, 300));
    return { places: all().filter((p) => p.types.some((t) => types.includes(t))).slice(0, 20) };
  });
  app.post<{ Body: { textQuery?: string; locationBias?: { circle?: { center?: typeof center } }; pageSize?: number } }>("/v1/places::searchText", async (req) => {
    if (req.body.locationBias?.circle?.center && (req.body.pageSize ?? 20) > 1) center = req.body.locationBias.circle.center;
    await new Promise((r) => setTimeout(r, 300));
    const words = (req.body.textQuery ?? "").toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !["restaurant", "food", "the", "and", "spot"].includes(w));
    const hits = all().filter((p) => words.some((w) => `${p.displayName.text} ${p.types.join(" ")} ${p.reviews.map((r) => r.text.text).join(" ")}`.toLowerCase().includes(w)));
    return { places: hits.length ? hits : all() };
  });
  app.post<{ Body: { input?: string } }>("/v1/places::autocomplete", async (req) => ({
    suggestions: ["Downtown", "Riverside", "Old Town"].map((n, i) => ({
      placePrediction: { placeId: `mockarea${i}abcdef`, structuredFormat: { mainText: { text: `${req.body.input} ${n}` }, secondaryText: { text: "Chicago, IL" } } },
    })),
  }));
  app.get<{ Params: { id: string } }>("/v1/places/:id", async (req, reply) => {
    if (req.params.id.startsWith("mockarea")) {
      const i = Number(req.params.id.slice(8, 9));
      return { id: req.params.id, displayName: { text: ["Downtown", "Riverside", "Old Town"][i] }, location: { latitude: center.latitude + 0.02 * (i + 1), longitude: center.longitude - 0.01 } };
    }
    const i = SEEDS.findIndex((_, n) => id(n) === req.params.id);
    if (i < 0) return reply.code(404).send({ error: { message: "Not found" } });
    return place(i);
  });
  app.get<{ Params: { id: string; photo: string } }>("/v1/places/:id/photos/:photo/media", async (req, reply) => {
    const i = Math.max(0, SEEDS.findIndex((_, n) => id(n) === req.params.id));
    const n = Number(req.params.photo.slice(1)) || 1;
    return reply.type("image/svg+xml").send(svg(i * 3 + n, SEEDS[i]!.name));
  });
}

/** Fake Claude answers for the dining tools. Returns undefined for anything else. */
export function diningClaude(tool: string | undefined, prompt: string): unknown | undefined {
  const ids = [...prompt.matchAll(/<place id="([^"]+)">\nName: ([^\n]+)/g)].map((m) => ({ id: m[1]!, name: m[2]! }));
  if (tool === "search_plan") {
    const q = /searched: "([^"]+)"/.exec(prompt)?.[1] ?? "";
    const vibe = ["hole-in-the-wall", "cozy", "date", "quiet", "hidden gem", "cheap"].filter((v) => q.toLowerCase().includes(v.split(" ")[0]!));
    return { textQuery: q.replace(/hole-in-the-wall|cozy|date night|quiet|hidden gem/gi, "").trim() || "restaurant", vibe };
  }
  if (tool === "rank_places") {
    return {
      places: ids.map(({ id: pid, name }) => ({
        id: pid,
        score: /Tiny|Pho|Dumpling/.test(name) ? 9 : /Chipotle|Panera|Golden/.test(name) ? 2 : 5,
        why: /Tiny|Pho|Dumpling/.test(name) ? "Tiny family-run spot regulars call a hidden gem" : "Solid pick, not much of a vibe match",
      })),
    };
  }
  if (tool === "describe_places") {
    return {
      places: ids.map(({ id: pid, name }) => {
        const small = /Tiny|Pho|Petit|Kyoto/.test(name);
        return {
          id: pid,
          tags: small ? ["tiny", "cash only", "locals' favorite", "fast service", "order the special"] : ["big patio", "good for groups", "loud on weekends", "cocktails", "kid-friendly"],
          size: small ? "small" : "large",
          seats: small ? 20 : 120,
          reservation: /Petit|Nonna/.test(name) ? "required" : /Casa|Smoke/.test(name) ? "recommended" : small ? "not-taken" : "walk-in",
          reservationReason: /Petit/.test(name) ? "Reviewers book weeks ahead" : "",
          overview: `${name} is a ${small ? "small, no-frills" : "lively"} spot reviewers keep coming back to.`,
          pros: ["Great food for the price", "Friendly staff"],
          cons: [small ? "Very few seats" : "Can get loud"],
        };
      }),
    };
  }
  if (tool === "local_take") {
    return { points: ["Redditors call it one of the best lunch spots nearby", "A local food blog praised the house special"] };
  }
  return undefined;
}

/** Fake SearXNG results for "what locals say" searches. */
export function chatterResults(q: string) {
  const name = /"([^"]+)"/.exec(q)?.[1];
  if (!name) return undefined;
  if (q.includes("reddit")) {
    return [
      { url: `https://www.reddit.com/r/chicago/comments/abc/${encodeURIComponent(name)}`, title: `Is ${name} worth it?`, content: `${name} is my go-to for lunch, the special is great.` },
      { url: "https://www.yelp.com/biz/whatever", title: `${name} - Yelp`, content: `${name} reviews` },
    ];
  }
  return [{ url: `https://localfoodblog.example/${encodeURIComponent(name)}`, title: `Review: ${name}`, content: `We stopped by ${name} and loved it.` }];
}
