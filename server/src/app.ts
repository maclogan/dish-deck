// Fastify app: API routes, optional passcode, static PWA hosting.

import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import { DIETS, DIET_IDS, GOALS, GOAL_IDS, MEALS, MEAL_IDS, STYLES, STYLE_IDS } from "./filters.js";
import { MealieClient, MealieError } from "./mealie.js";
import { Service, imageSig } from "./service.js";
import { AiRecipes } from "./sources/ai.js";
import { MealDb } from "./sources/mealdb.js";
import { PhotoFinder } from "./sources/photos.js";
import { SearxngSearch } from "./sources/searxng.js";
import { allSites, siteList } from "./sources/sites.js";
import { RecipeSites, fromMealieScrape } from "./sources/webrecipes.js";
import { Store } from "./store.js";
import { AccessTrust } from "./access.js";
import { AiDining } from "./dining/ai.js";
import { Chatter } from "./dining/chatter.js";
import { PlacesClient } from "./dining/places.js";
import { registerDining } from "./dining/routes.js";
import { DEFAULT_LOCATION, DEFAULT_RADIUS_MILES, DiningService, MAX_RADIUS_MILES, MIN_RADIUS_MILES } from "./dining/service.js";
import type { AppConfigResponse } from "./types.js";

const mealType = z.enum(["lunch", "dinner"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const cardSchema = z.object({
  key: z.string(),
  source: z.enum(["mealdb", "web", "ai", "mealie"]),
  site: z.string().max(100).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  image: z.string().max(2000).optional(),
  imageCredit: z.object({ text: z.string().max(200), url: z.string().max(2000) }).optional(),
  cuisine: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  nativeName: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().max(60)).max(20).default([]),
  totalMinutes: z.number().optional(),
  servings: z.number().optional(),
  ingredients: z.array(z.string().max(300)).max(80),
  instructions: z.array(z.string().max(3000)).max(60),
  sourceUrl: z.string().max(2000).optional(),
  nutrition: z
    .object({
      calories: z.number().optional(),
      protein: z.number().optional(),
      carbs: z.number().optional(),
      fat: z.number().optional(),
      fiber: z.number().optional(),
    })
    .optional(),
  suits: z.array(mealType).optional(),
  onHand: z.object({ have: z.number(), total: z.number(), missing: z.array(z.string()) }).optional(),
  mealie: z.object({ id: z.string(), slug: z.string(), url: z.string().optional() }).optional(),
});

const deckSchema = z.object({
  source: z.enum(["new", "saved"]),
  mood: z.string().max(200).optional(),
  ai: z.boolean().default(true),
  cuisines: z.array(z.string().max(60)).max(40).default([]),
  categories: z.array(z.string().max(60)).max(40).default([]),
  meals: z.array(z.enum(MEAL_IDS)).max(MEAL_IDS.length).default([]),
  cuisine: z.string().max(60).optional(),
  category: z.string().max(60).optional(),
  dietary: z.array(z.enum(DIET_IDS)).max(DIET_IDS.length).default([]),
  meal: z.enum(MEAL_IDS).optional(),
  goals: z.array(z.enum(GOAL_IDS)).max(GOAL_IDS.length).default([]),
  style: z.enum(STYLE_IDS).default("home"),
  onHand: z.boolean().default(false),
  leniency: z.number().int().min(0).max(10).default(2),
  count: z.number().int().min(1).max(12).default(8),
  exclude: z.array(z.string()).max(500).default([]),
});

const historySchema = z.object({
  key: z.string().min(1).max(2100),
  action: z.literal("skip"),
  title: z.string().max(200).optional(),
});

const saveSchema = z.object({
  card: cardSchema,
  target: z.enum(["book", "plan"]),
  plan: z.object({ date: isoDate, entryType: mealType }).optional(),
});

const proposalSchema = z.object({
  kind: z.enum(["existing", "recipe", "leftovers", "empty"]),
  name: z.string(),
  recipeId: z.string().optional(),
  slug: z.string().optional(),
  protein: z.string().nullable().optional(),
  reasons: z.array(z.string()).default([]),
  entryId: z.number().optional(),
  leftoverFriendly: z.boolean().optional(),
});

const generateSchema = z.object({
  replaceExisting: z.boolean().default(false),
  locked: z.record(z.string(), proposalSchema).optional(),
});

const applySchema = z.object({
  replaceExisting: z.boolean().default(false),
  days: z
    .array(
      z.object({
        date: isoDate,
        weekday: z.number(),
        busy: z.boolean(),
        lunch: proposalSchema,
        dinner: proposalSchema,
      }),
    )
    .max(14),
});

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Most-cooked cuisines first (the app shows the top 15 until "More"), then the rest A–Z. */
const POPULAR_CUISINES = [
  "Italian", "Mexican", "Chinese", "American", "Indian", "Japanese", "Thai", "Greek", "French", "Spanish",
  "Korean", "Vietnamese", "Mediterranean", "Middle Eastern", "Turkish", "British", "Moroccan", "Jamaican",
];
export function rankCuisines(list: string[]): string[] {
  const rank = (c: string) => {
    const i = POPULAR_CUISINES.indexOf(c);
    return i === -1 ? POPULAR_CUISINES.length : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Who is making a request: the household (everything), a guest (Eat out only), or nobody yet. */
export type Caller = { role: "household"; email?: string } | { role: "guest"; email: string } | { role: "none" };

declare module "fastify" {
  interface FastifyRequest {
    caller?: Caller;
  }
}

/** Routes a guest may use. Everything else under /api/ is household-only, including routes added later. */
const GUEST_ROUTES = (url: string) => url === "/api/config" || url === "/api/health" || url.startsWith("/api/dining/");

/** Signed address of a Google place photo, served through this app. */
export function diningPhotoUrl(passcode: string | undefined, name: string, width: number): string {
  const params = new URLSearchParams({ name, w: String(width) });
  if (passcode) params.set("sig", imageSig(passcode, `dining:${name}:${width}`));
  return `/api/dining/photo?${params}`;
}

export function buildApp(
  config: Config,
  overrides: Partial<{ service: Service; mealie: MealieClient; store: Store; dining: DiningService | null; accessFetch: typeof fetch }> = {},
): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const mealie = overrides.mealie ?? new MealieClient(config.mealieUrl, config.mealieToken);
  const mealdb = new MealDb(config.mealdbKey, fetch, config.mealdbBaseUrl);
  const ai = config.anthropicApiKey
    ? new AiRecipes(config.anthropicApiKey, config.anthropicModel, config.householdContext)
    : undefined;
  const warn = (m: string) => app.log.warn(m);
  const store = overrides.store ?? Store.open(config.dataDir, warn);
  const photos = new PhotoFinder({ wikipediaApi: config.wikipediaApiUrl, pexelsKey: config.pexelsApiKey, warn, store });
  const siteMap = siteList(config.recipeSites);
  // Development only: send requests for the trusted sites to the mock server (see dev/mock-server.ts).
  const devProxy = process.env.DEV_SITE_PROXY?.replace(/\/+$/, "");
  const siteDomains = new Set(allSites(siteMap));
  const siteFetch: typeof fetch | undefined = devProxy
    ? (input, init) => {
        const u = new URL(String(input));
        const host = u.hostname.replace(/^www\./, "");
        return fetch(siteDomains.has(host) ? `${devProxy}/site/${host}${u.pathname}${u.search}` : input, init);
      }
    : undefined;
  const sites = new RecipeSites({
    store,
    warn,
    fetch: siteFetch,
    scrape: async (url) => fromMealieScrape(await mealie.testScrape(url), url),
    search: config.searxngUrl ? new SearxngSearch(config.searxngUrl) : undefined,
  });
  const service = overrides.service ?? new Service({ config, mealie, mealdb, ai, photos, store, sites, siteMap, warn });
  // "Eat out" tab: only with a Google Maps key. Shares the store, AI key and SearXNG with the recipe side.
  const dining =
    overrides.dining !== undefined
      ? overrides.dining ?? undefined
      : config.googleMapsApiKey
        ? new DiningService({
            places: new PlacesClient(config.googleMapsApiKey, config.googlePlacesBaseUrl),
            store,
            ai: config.anthropicApiKey ? new AiDining(config.anthropicApiKey, config.anthropicModel) : undefined,
            chatter: config.searxngUrl ? new Chatter(config.searxngUrl) : undefined,
            timezone: config.timezone,
            mapsBrowserKey: config.googleMapsBrowserKey,
            photoUrl: (name, width) => diningPhotoUrl(config.appPasscode, name, width),
            warn,
          })
        : undefined;

  // Index the trusted sites in the background (each refreshes weekly), so the first deal is quick.
  if (!overrides.service && !overrides.store) {
    const warm = () => void sites.ensureIndexed(allSites(siteMap)).catch(() => undefined);
    setTimeout(warm, 5_000).unref();
    setInterval(warm, 12 * 3600_000).unref();
    // Read recipe pages ahead of time, so filters (vegetarian, dessert, ...) can pick from recipes
    // already read. Each site gets one request every PREFETCH_SECONDS_PER_SITE seconds (or its robots.txt
    // Crawl-delay, if longer); sites are read in parallel, so the total speed scales with the site count.
    if (config.prefetchSecondsPerSite > 0) {
      let busy = false;
      let reads = 0;
      let lastReport = Date.now();
      setInterval(async () => {
        if (busy) return;
        busy = true;
        reads += await sites.prefetchRound(config.prefetchSecondsPerSite);
        busy = false;
        if (Date.now() - lastReport > 3600_000 && reads > 0) {
          lastReport = Date.now();
          const c = store.coverage();
          const total = c.reduce((n, s) => n + s.pages, 0);
          const read = c.reduce((n, s) => n + s.read, 0);
          app.log.info(`Recipe pages read ahead: ${read} of ${total} across ${c.length} sites (${reads} in the last hour)`);
          reads = 0;
        }
      }, 1_000).unref();
    }
  }

  // Who's calling, with nothing to configure:
  //  - the household passcode → the household (their devices already have it saved);
  //  - otherwise, a genuine Cloudflare Access sign-in → a guest (Eat out only), identified by its email.
  // Which Cloudflare team and Access application to trust is learned from the household's own requests
  // (passcode plus Cloudflare's token), so only the household decides whose sign-ins count.
  // Without APP_PASSCODE the app is open to everyone, as before, and there are no guests.
  const access = new AccessTrust(store, overrides.accessFetch ?? fetch, warn);
  const whoIs = async (req: { headers: Record<string, string | string[] | undefined> }): Promise<Caller> => {
    if (!config.appPasscode) return { role: "household" };
    const token = String(req.headers["cf-access-jwt-assertion"] ?? "") || undefined;
    if (safeEqual(String(req.headers["x-app-passcode"] ?? ""), config.appPasscode)) {
      await access.learn(token).catch(() => undefined);
      return { role: "household" };
    }
    const email = await access.email(token).catch(() => undefined);
    return email ? { role: "guest", email } : { role: "none" };
  };

  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0]!;
    if (!url.startsWith("/api/") || url === "/api/health") return;
    req.caller = await whoIs(req);
    if (url === "/api/config") return;
    if (req.caller.role === "guest") {
      if (!GUEST_ROUTES(url)) return reply.code(403).send({ error: "Not available to guests" });
      return;
    }
    if (req.caller.role === "household") return;
    if (!config.appPasscode) return;
    // <img> tags can't send the passcode header, so image URLs carry a signature instead.
    if (url.startsWith("/api/mealie-image/")) {
      const id = url.slice("/api/mealie-image/".length);
      const sig = String((req.query as { sig?: string } | undefined)?.sig ?? "");
      if (safeEqual(sig, imageSig(config.appPasscode, id))) return;
    }
    if (url === "/api/dining/photo") {
      const q = (req.query ?? {}) as { name?: string; w?: string; sig?: string };
      if (safeEqual(String(q.sig ?? ""), imageSig(config.appPasscode, `dining:${q.name ?? ""}:${q.w ?? ""}`))) return;
    }
    return reply.code(401).send({ error: "Passcode required" });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: "Invalid request", issues: err.issues });
    }
    if (err instanceof MealieError) {
      app.log.error(err.message);
      return reply.code(502).send({ error: err.message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: err instanceof Error ? err.message : "Unexpected error" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/config", async (req): Promise<AppConfigResponse> => {
    const caller = req.caller ?? { role: "none" as const };
    const [cuisines, categories] = await Promise.all([
      mealdb.areas().catch(() => [] as string[]),
      mealdb.categories().catch(() => [] as string[]),
    ]);
    return {
      aiEnabled: !!ai,
      passcodeRequired: caller.role === "none" && !!config.appPasscode,
      role: caller.role,
      email: caller.role === "none" ? undefined : caller.email,
      busyDays: config.busyDays,
      mealieUrl: caller.role === "household" ? config.mealiePublicUrl : undefined,
      cuisines: rankCuisines(cuisines.filter((c) => c !== "Unknown")),
      categories,
      dietary: DIETS,
      meals: MEALS,
      goals: GOALS,
      styles: STYLES,
      dining: dining?.config(true) ?? {
        enabled: false,
        chatter: false,
        radiusMiles: DEFAULT_RADIUS_MILES,
        minRadiusMiles: MIN_RADIUS_MILES,
        maxRadiusMiles: MAX_RADIUS_MILES,
        defaultLocation: DEFAULT_LOCATION,
        cuisines: [],
      },
    };
  });

  registerDining(app, dining);

  app.post("/api/deck", async (req) => service.deck(deckSchema.parse(req.body)));
  app.post("/api/save", async (req) => service.save(saveSchema.parse(req.body)));
  app.post("/api/history", async (req) => service.history(historySchema.parse(req.body)));
  app.get("/api/recipes", async () => service.book());
  app.get("/api/week", async () => service.week());
  app.post("/api/plan/generate", async (req) => service.generate(generateSchema.parse(req.body ?? {})));
  app.post("/api/plan/apply", async (req) => service.apply(applySchema.parse(req.body)));

  // Proxy Mealie recipe images so the browser doesn't need direct access to Mealie.
  app.get<{ Params: { id: string } }>("/api/mealie-image/:id", async (req, reply) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{32,36}$/i.test(id)) return reply.code(400).send();
    // Prefer the smaller image; older imports may only have the original.
    let res: Response | undefined;
    for (const file of ["min-original.webp", "original.webp"]) {
      res = await fetch(`${config.mealieUrl}/api/media/recipes/${id}/images/${file}`, {
        headers: { Authorization: `Bearer ${config.mealieToken}` },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => undefined);
      if (res?.ok) break;
    }
    if (!res?.ok) return reply.code(404).send();
    reply.header("Content-Type", res.headers.get("content-type") ?? "image/webp");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(Buffer.from(await res.arrayBuffer()));
  });

  // Static PWA
  if (fs.existsSync(config.webDir)) {
    app.register(fastifyStatic, {
      root: config.webDir,
      cacheControl: false,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        if (name === "sw.js" || name === "index.html" || name === "manifest.webmanifest") {
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.type("text/html").header("Cache-Control", "no-cache").sendFile("index.html");
    });
  }

  return app;
}
