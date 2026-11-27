// "Eat out": search nearby restaurants, apply the filters, optionally let AI rerank and describe them, and
// keep the household's never-again list. Nothing about likes or past choices affects a search; the
// never-again list only removes places.
//
// Google's content (reviews, ratings, hours) is held in memory for an hour so opening a place right after a
// search doesn't cost another request; only place IDs and our own AI output are stored on disk.

import { reservationAdvice } from "./advice.js";
import type { AiDining, AiEnrichment, PlaceBrief, QueryPlan } from "./ai.js";
import { detectChains } from "./chains.js";
import type { Chatter, ChatterSource } from "./chatter.js";
import { CUISINES, cuisineLabel } from "./cuisines.js";
import { hoursLine, localMoment, openAt, parseClock } from "./hours.js";
import { type GPlace, PlacesClient, distanceMiles, priceLevel } from "./places.js";
import type {
  ChatterResponse,
  DiningConfig,
  DiningFilters,
  DiningSearchRequest,
  DiningSearchResponse,
  EnrichResponse,
  LatLng,
  LocationSuggestion,
  NeverEntry,
  PlaceAttribute,
  PlaceDetails,
  PlaceSummary,
} from "./types.js";
import type { Store } from "../store.js";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const MEMORY_TTL = HOUR;
const ENRICH_TTL = 7 * DAY;
const PLAN_TTL = 30 * DAY;
const CHATTER_TTL = 7 * DAY;
const MAX_RESULTS = 60;
/** A search keeps fetching pages until this many places are left after the filters... */
const TARGET = 20;
/** ...or it has made this many Google requests (more only when several cuisines are picked). */
const MAX_REQUESTS = 3;

/** Searches cover 25 miles to start; the Filters slider goes from 1 to 100. Distances are in miles. */
export const DEFAULT_RADIUS_MILES = 25;
export const MIN_RADIUS_MILES = 1;
export const MAX_RADIUS_MILES = 100;
/** Where to search when a phone won't share its location. */
export const DEFAULT_LOCATION = { label: "Denver, CO", lat: 39.7392, lng: -104.9903 };

export interface DiningDeps {
  places: PlacesClient;
  store: Store;
  ai?: AiDining;
  chatter?: Chatter;
  timezone: string;
  mapsBrowserKey?: string;
  /** Signs photo URLs (img tags can't send the passcode header). */
  photoUrl: (name: string, width: number) => string;
  warn: (msg: string) => void;
}

/** Where and when, for computing distance and opening hours. */
export interface Moment {
  location: LatLng;
  /** "HH:MM" today; undefined = now. */
  when?: string;
  ai: boolean;
}

/** The UTC offset (minutes) of an IANA timezone right now. */
export function tzOffsetMinutes(timezone: string, now: Date = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((asUtc - Math.floor(now.getTime() / 60_000) * 60_000) / 60_000);
}

const country = (p: GPlace) => p.addressComponents?.find((c) => c.types?.includes("country"))?.shortText;
const city = (p: GPlace) =>
  p.addressComponents?.find((c) => c.types?.includes("locality"))?.longText ??
  p.addressComponents?.find((c) => c.types?.includes("postal_town") || c.types?.includes("administrative_area_level_2"))?.longText;

/** Google's yes/no facts, as tags (used with AI off), most decision-changing first. */
export function googleTags(p: GPlace): string[] {
  const t: string[] = [];
  if (p.paymentOptions?.acceptsCashOnly) t.push("cash only");
  if (p.dineIn === false && p.takeout) t.push("takeout only");
  if (p.reservable) t.push("takes reservations");
  if (p.outdoorSeating) t.push("outdoor seating");
  if (p.liveMusic) t.push("live music");
  if (p.goodForChildren || p.menuForChildren) t.push("kid-friendly");
  if (p.goodForGroups) t.push("good for groups");
  if (p.servesVegetarianFood) t.push("vegetarian options");
  if (p.servesCocktails) t.push("cocktails");
  else if (p.servesBeer || p.servesWine) t.push("beer & wine");
  if (p.servesBrunch) t.push("brunch");
  if (p.goodForWatchingSports) t.push("sports on tv");
  if (p.allowsDogs) t.push("dog-friendly");
  if (p.delivery) t.push("delivery");
  return t.slice(0, 8);
}

export function attributes(p: GPlace): PlaceAttribute[] {
  const rows: [string, boolean | undefined][] = [
    ["Dine-in", p.dineIn],
    ["Takeout", p.takeout],
    ["Delivery", p.delivery],
    ["Takes reservations", p.reservable],
    ["Outdoor seating", p.outdoorSeating],
    ["Good for groups", p.goodForGroups],
    ["Good for kids", p.goodForChildren],
    ["Kids' menu", p.menuForChildren],
    ["Vegetarian options", p.servesVegetarianFood],
    ["Breakfast", p.servesBreakfast],
    ["Brunch", p.servesBrunch],
    ["Lunch", p.servesLunch],
    ["Dinner", p.servesDinner],
    ["Beer", p.servesBeer],
    ["Wine", p.servesWine],
    ["Cocktails", p.servesCocktails],
    ["Coffee", p.servesCoffee],
    ["Dessert", p.servesDessert],
    ["Live music", p.liveMusic],
    ["Sports on TV", p.goodForWatchingSports],
    ["Dogs allowed", p.allowsDogs],
    ["Cash only", p.paymentOptions?.acceptsCashOnly],
    ["Credit cards", p.paymentOptions?.acceptsCreditCards],
    ["Wheelchair-accessible entrance", p.accessibilityOptions?.wheelchairAccessibleEntrance],
  ];
  return rows.filter((r): r is [string, boolean] => typeof r[1] === "boolean").map(([label, value]) => ({ label, value }));
}

/** Higher for well-loved independents that not many people have found yet. */
export function gemScore(p: Pick<PlaceSummary, "rating" | "ratingCount" | "chain">): number {
  const r = p.rating ?? 0;
  const c = p.ratingCount ?? 0;
  return (r - 4) * 10 - Math.log10(c + 1) * 1.5 - (p.chain ? 10 : 0) - (c < 10 ? 5 : 0);
}

export function mergePlan(filters: DiningFilters, plan: QueryPlan | undefined): DiningFilters {
  if (!plan) return filters;
  return {
    ...filters,
    cuisines: filters.cuisines.length ? filters.cuisines : plan.cuisines,
    prices: filters.prices.length ? filters.prices : plan.prices,
    minRating: filters.minRating ?? plan.minRating,
    chain: filters.chain === "any" && plan.chain ? plan.chain : filters.chain,
    features: [...new Set([...filters.features, ...plan.features])],
  };
}

export class DiningService {
  private memory = new Map<string, { place: GPlace; at: number }>();
  private inflight = new Map<string, Promise<void>>();

  constructor(private d: DiningDeps) {}

  // ------------------------------------------------------------------ helpers

  private remember(places: GPlace[]) {
    const now = Date.now();
    for (const p of places) this.memory.set(p.id, { place: p, at: now });
    if (this.memory.size > 600) {
      for (const [id, v] of this.memory) if (now - v.at > MEMORY_TTL || this.memory.size > 500) this.memory.delete(id);
    }
  }

  private async place(id: string): Promise<GPlace> {
    const hit = this.memory.get(id);
    if (hit && Date.now() - hit.at < MEMORY_TTL) return hit.place;
    const p = await this.d.places.details(id);
    this.remember([p]);
    return p;
  }

  private enrichment(id: string): AiEnrichment | undefined {
    return this.d.store.diningGet<AiEnrichment>(`enrich:${id}`, ENRICH_TTL);
  }

  private brief(p: GPlace): PlaceBrief {
    return {
      id: p.id,
      name: p.displayName?.text ?? "",
      cuisine: cuisineLabel(p.primaryType, p.types ?? [], p.primaryTypeDisplayName?.text),
      price: priceLevel(p.priceLevel),
      rating: p.rating,
      ratingCount: p.userRatingCount,
      types: p.types ?? [],
      attributes: attributes(p).map((a) => `${a.label}: ${a.value ? "yes" : "no"}`),
      hours: p.regularOpeningHours?.weekdayDescriptions ?? [],
      googleSummary: p.reviewSummary?.text?.text ?? p.generativeSummary?.overview?.text ?? p.editorialSummary?.text,
      reviews: (p.reviews ?? []).map((r) => r.text?.text ?? r.originalText?.text ?? "").filter(Boolean),
    };
  }

  /** Read and describe places that AI hasn't yet (batches of 10, one request each). */
  private async ensureEnriched(places: GPlace[]): Promise<void> {
    const ai = this.d.ai;
    if (!ai) return;
    const waits: Promise<void>[] = [];
    const todo: GPlace[] = [];
    for (const p of places) {
      const running = this.inflight.get(p.id);
      if (running) waits.push(running);
      else if (!this.enrichment(p.id)) todo.push(p);
    }
    for (let i = 0; i < todo.length; i += 10) {
      const batch = todo.slice(i, i + 10);
      const job = ai
        .enrich(batch.map((p) => this.brief(p)))
        .then((res) => {
          for (const [id, e] of res) this.d.store.diningPut(`enrich:${id}`, e);
        })
        .catch((err) => this.d.warn(`AI couldn't describe places: ${err instanceof Error ? err.message : err}`))
        .finally(() => batch.forEach((p) => this.inflight.delete(p.id)));
      batch.forEach((p) => this.inflight.set(p.id, job));
      waits.push(job);
    }
    await Promise.all(waits);
  }

  /** Everything the list shows about one place, at this moment (hours are worked out in the place's own time). */
  summarize(p: GPlace, m: Moment, chain: boolean): PlaceSummary {
    const offset = p.utcOffsetMinutes ?? tzOffsetMinutes(this.d.timezone);
    const local = localMoment(offset);
    const chosen = parseClock(m.when);
    const minutes = chosen ?? local.minutes;
    const day = local.day;
    const open = openAt(p.regularOpeningHours?.periods, day, minutes);
    const e = m.ai && this.d.ai ? this.enrichment(p.id) : undefined;
    const price = priceLevel(p.priceLevel);
    const loc = { lat: p.location?.latitude ?? 0, lng: p.location?.longitude ?? 0 };
    const photo = p.photos?.[0]?.name;
    return {
      id: p.id,
      name: p.displayName?.text ?? "Unnamed",
      address: p.shortFormattedAddress ?? p.formattedAddress,
      location: loc,
      distanceMiles: Math.round(distanceMiles(m.location, loc) * 10) / 10,
      rating: p.rating,
      ratingCount: p.userRatingCount,
      price,
      cuisine: cuisineLabel(p.primaryType, p.types ?? [], p.primaryTypeDisplayName?.text),
      mapsUrl: p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.id)}`,
      website: p.websiteUri,
      photo: photo ? this.d.photoUrl(photo, 640) : undefined,
      openAtTime: open?.open,
      closesSoon: open?.open && (open.closesIn ?? Infinity) <= 60 ? true : undefined,
      hoursToday: hoursLine(p.regularOpeningHours?.weekdayDescriptions, day),
      chain,
      tags: e?.tags.length ? e.tags : googleTags(p),
      tagsSource: e?.tags.length ? "ai" : "google",
      size: e?.size,
      reservation: reservationAdvice({ reservable: p.reservable, price, ai: e?.reservation, aiReason: e?.reservationReason }),
    };
  }

  private passes(s: PlaceSummary, p: GPlace, f: DiningFilters): boolean {
    if (f.prices.length && (!s.price || !f.prices.includes(s.price))) return false;
    if (f.minRating && (s.rating ?? 0) < f.minRating) return false;
    if (f.chain === "independent" && s.chain) return false;
    if (f.chain === "chain" && !s.chain) return false;
    if (f.openAtTime && s.openAtTime === false) return false;
    if (f.cuisines.length && !f.cuisines.some((c) => p.primaryType === c || p.types?.includes(c))) return false;
    for (const sv of f.service) if (p[sv] !== true) return false;
    for (const ft of f.features) {
      if (ft === "outdoor" && !p.outdoorSeating) return false;
      if (ft === "groups" && !p.goodForGroups) return false;
      if (ft === "kids" && !(p.goodForChildren || p.menuForChildren)) return false;
      if (ft === "vegetarian" && !p.servesVegetarianFood) return false;
      if (ft === "reservations" && !p.reservable) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ routes

  config(enabled: boolean): DiningConfig {
    return {
      enabled,
      mapsBrowserKey: this.d.mapsBrowserKey,
      chatter: !!this.d.chatter,
      radiusMiles: DEFAULT_RADIUS_MILES,
      minRadiusMiles: MIN_RADIUS_MILES,
      maxRadiusMiles: MAX_RADIUS_MILES,
      defaultLocation: DEFAULT_LOCATION,
      cuisines: CUISINES,
    };
  }

  /** Places from these results that are open for business, in the circle, not never-again, and pass the filters. */
  private async candidates(raw: GPlace[], req: DiningSearchRequest, never: Set<string>, moment: Moment, filters: DiningFilters) {
    const seen = new Set<string>();
    const places = raw.filter((p) => {
      if (seen.has(p.id) || never.has(p.id) || !p.location) return false;
      seen.add(p.id);
      if (p.businessStatus && p.businessStatus !== "OPERATIONAL") return false;
      // The search box's corners reach a little past the circle.
      return distanceMiles(req.location, { lat: p.location.latitude, lng: p.location.longitude }) <= req.radiusMiles * 1.05;
    });
    const chains = await detectChains(places.map((p) => ({ id: p.id, name: p.displayName?.text ?? "", types: p.types ?? [], country: country(p) })));
    return places.map((p) => ({ p, s: this.summarize(p, moment, chains.has(p.id)) })).filter(({ p, s }) => this.passes(s, p, filters));
  }

  async search(req: DiningSearchRequest): Promise<DiningSearchResponse> {
    const useAi = req.ai && !!this.d.ai;
    const query = req.query?.trim();
    let plan: QueryPlan | undefined;
    if (query && useAi) {
      const key = `plan:${query.toLowerCase().replace(/\s+/g, " ")}`;
      plan = this.d.store.diningGet<QueryPlan>(key, PLAN_TTL);
      if (!plan) {
        plan = await this.d.ai!.plan(query).catch((err) => {
          this.d.warn(`AI couldn't read the search: ${err instanceof Error ? err.message : err}`);
          return undefined;
        });
        if (plan) this.d.store.diningPut(key, plan);
      }
    }
    const filters = mergePlan(req.filters, plan);

    // What to ask Google: the typed search, one search per picked cuisine (up to 4), or "restaurants".
    // Google applies rating, price, type and open-now itself, so pages aren't wasted on places the
    // filters would drop; more pages are fetched while fewer than TARGET places are left.
    const labels = new Map(CUISINES.map((c) => [c.id, c.label]));
    const queries: { q: string; type?: string }[] = query
      ? [{ q: plan?.textQuery ?? query }]
      : filters.cuisines.length
        ? filters.cuisines.slice(0, 4).map((id) => ({ q: `${labels.get(id) ?? "food"} restaurant`, type: id }))
        : [{ q: "restaurants", type: "restaurant" }];
    const cursors = queries.map((q) => ({ ...q, next: undefined as string | undefined, done: false, started: false }));
    const never = this.d.store.neverIds();
    const moment: Moment = { location: req.location, when: req.when, ai: useAi };
    const raw: GPlace[] = [];
    let list: { p: GPlace; s: PlaceSummary }[] = [];
    let requests = 0;
    const maxRequests = Math.max(MAX_REQUESTS, queries.length);
    while (requests < maxRequests) {
      const active = cursors.filter((c) => !c.done);
      if (!active.length) break;
      if (requests >= queries.length && list.length >= TARGET) break;
      for (const c of active) {
        if (requests >= maxRequests) break;
        const page = await this.d.places.textPage({
          query: c.q,
          type: c.type,
          center: req.location,
          radiusMiles: req.radiusMiles,
          minRating: filters.minRating,
          prices: filters.prices,
          openNow: filters.openAtTime && !req.when,
          rank: req.sort === "distance" ? "DISTANCE" : "RELEVANCE",
          pageToken: c.next,
        });
        requests++;
        raw.push(...page.places);
        c.next = page.next;
        c.done = !page.next;
      }
      list = await this.candidates(raw, req, never, moment, filters);
    }
    this.remember(raw);

    // AI reranks a typed search by reading the reviews.
    let scores: Map<string, { score: number; why: string }> | undefined;
    if (useAi && query && list.length > 1) {
      const top = list.slice(0, 20);
      scores = await this.d.ai!.rank(query, plan?.vibe ?? [], top.map(({ p }) => this.brief(p))).catch((err) => {
        this.d.warn(`AI couldn't rank places: ${err instanceof Error ? err.message : err}`);
        return undefined;
      });
      if (scores) for (const { s } of list) s.why = scores.get(s.id)?.why || undefined;
    }

    const order = new Map(list.map(({ s }, i) => [s.id, i]));
    const pos = (s: PlaceSummary) => order.get(s.id) ?? 0;
    const sorted = list.map(({ s }) => s);
    if (req.sort === "distance") sorted.sort((a, b) => a.distanceMiles - b.distanceMiles);
    else if (req.sort === "rating") sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0));
    else if (req.sort === "gems") sorted.sort((a, b) => gemScore(b) - gemScore(a));
    else if (scores) sorted.sort((a, b) => (scores!.get(b.id)?.score ?? -1) - (scores!.get(a.id)?.score ?? -1) || pos(a) - pos(b));

    const note = plan
      ? `Searched for “${plan.textQuery}”${plan.vibe.length ? ` · checked reviews for: ${plan.vibe.join(", ")}` : ""}`
      : undefined;
    return { places: sorted.slice(0, MAX_RESULTS), note, aiUsed: useAi };
  }

  /** AI tags, size and reservation advice for places on screen (AI on). */
  async enrich(ids: string[], m: Moment): Promise<EnrichResponse> {
    const out: EnrichResponse = { places: {} };
    if (!m.ai || !this.d.ai) return out;
    const places = (await Promise.all(ids.map((id) => this.place(id).catch(() => undefined)))).filter((p): p is GPlace => !!p);
    await this.ensureEnriched(places);
    for (const p of places) {
      // Chain status doesn't change here and isn't returned.
      const s = this.summarize(p, m, false);
      out.places[p.id] = { tags: s.tags, tagsSource: s.tagsSource, size: s.size, reservation: s.reservation };
    }
    return out;
  }

  async details(id: string, m: Moment): Promise<PlaceDetails> {
    const p = await this.place(id);
    if (m.ai && this.d.ai) await this.ensureEnriched([p]);
    const chain = (await detectChains([{ id: p.id, name: p.displayName?.text ?? "", types: p.types ?? [], country: country(p) }])).has(p.id);
    const s = this.summarize(p, m, chain);
    const e = m.ai && this.d.ai ? this.enrichment(p.id) : undefined;
    return {
      ...s,
      phone: p.nationalPhoneNumber,
      photos: (p.photos ?? []).slice(0, 6).map((ph) => this.d.photoUrl(ph.name, 900)),
      hours: p.regularOpeningHours?.weekdayDescriptions ?? [],
      reviews: (p.reviews ?? [])
        .map((r) => ({
          author: r.authorAttribution?.displayName ?? "Google user",
          authorUrl: r.authorAttribution?.uri,
          rating: r.rating,
          text: r.text?.text ?? r.originalText?.text ?? "",
          when: r.relativePublishTimeDescription ?? "",
        }))
        .filter((r) => r.text),
      googleSummary: p.reviewSummary?.text?.text ?? p.generativeSummary?.overview?.text,
      editorialSummary: p.editorialSummary?.text,
      attributes: attributes(p),
      aiSummary: e?.summary,
    };
  }

  async chatter(id: string, ai: boolean): Promise<ChatterResponse> {
    if (!this.d.chatter) return { enabled: false, items: [] };
    const p = await this.place(id);
    const key = `chatter:${id}`;
    let src = this.d.store.diningGet<ChatterSource>(key, CHATTER_TTL);
    if (!src) {
      src = await this.d.chatter.find({ name: p.displayName?.text ?? "", city: city(p), website: p.websiteUri }).catch((err) => {
        this.d.warn(`Local chatter search failed: ${err instanceof Error ? err.message : err}`);
        return undefined;
      });
      if (!src) return { enabled: true, items: [] };
      this.d.store.diningPut(key, src);
    }
    let summary: string[] | undefined;
    if (ai && this.d.ai && (src.items.length || src.excerpts.length)) {
      const takeKey = `take:${id}`;
      summary = this.d.store.diningGet<string[]>(takeKey, CHATTER_TTL);
      if (!summary) {
        summary = await this.d.ai.localTake(p.displayName?.text ?? "", src.items, src.excerpts).catch((err) => {
          this.d.warn(`AI couldn't summarize local chatter: ${err instanceof Error ? err.message : err}`);
          return undefined;
        });
        if (summary) this.d.store.diningPut(takeKey, summary);
      }
    }
    return { enabled: true, items: src.items, summary: summary?.length ? summary : undefined };
  }

  never(): NeverEntry[] {
    return this.d.store.neverList();
  }

  addNever(id: string, name: string, address?: string) {
    this.d.store.addNever(id, name, address);
  }

  removeNever(id: string) {
    this.d.store.removeNever(id);
  }

  autocomplete(input: string, near?: LatLng): Promise<LocationSuggestion[]> {
    return this.d.places.autocomplete(input, near);
  }

  locate(id: string) {
    return this.d.places.locate(id);
  }

  photo(name: string, width: number) {
    return this.d.places.photo(name, width);
  }
}
