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
import type { AppConfigResponse } from "./types.js";

const mealType = z.enum(["lunch", "dinner"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const cardSchema = z.object({
  key: z.string(),
  source: z.enum(["mealdb", "ai", "mealie"]),
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

export function buildApp(config: Config, overrides: Partial<{ service: Service; mealie: MealieClient }> = {}): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const mealie = overrides.mealie ?? new MealieClient(config.mealieUrl, config.mealieToken);
  const mealdb = new MealDb(config.mealdbKey, fetch, config.mealdbBaseUrl);
  const ai = config.anthropicApiKey
    ? new AiRecipes(config.anthropicApiKey, config.anthropicModel, config.householdContext)
    : undefined;
  const photos = new PhotoFinder({ wikipediaApi: config.wikipediaApiUrl, pexelsKey: config.pexelsApiKey, warn: (m) => app.log.warn(m) });
  const service = overrides.service ?? new Service({ config, mealie, mealdb, ai, photos, warn: (m) => app.log.warn(m) });

  // Optional shared passcode for the API (in addition to Cloudflare Access).
  app.addHook("onRequest", async (req, reply) => {
    if (!config.appPasscode) return;
    const url = req.url.split("?")[0]!;
    if (!url.startsWith("/api/") || url === "/api/health" || url === "/api/config") return;
    // <img> tags can't send the passcode header, so image URLs carry a signature instead.
    if (url.startsWith("/api/mealie-image/")) {
      const id = url.slice("/api/mealie-image/".length);
      const sig = String((req.query as { sig?: string } | undefined)?.sig ?? "");
      if (safeEqual(sig, imageSig(config.appPasscode, id))) return;
    }
    const given = String(req.headers["x-app-passcode"] ?? "");
    if (!safeEqual(given, config.appPasscode)) {
      return reply.code(401).send({ error: "Passcode required" });
    }
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

  app.get("/api/config", async (): Promise<AppConfigResponse> => {
    const [cuisines, categories] = await Promise.all([
      mealdb.areas().catch(() => [] as string[]),
      mealdb.categories().catch(() => [] as string[]),
    ]);
    return {
      aiEnabled: !!ai,
      passcodeRequired: !!config.appPasscode,
      busyDays: config.busyDays,
      mealieUrl: config.mealiePublicUrl,
      cuisines: rankCuisines(cuisines.filter((c) => c !== "Unknown")),
      categories,
      dietary: DIETS,
      meals: MEALS,
      goals: GOALS,
      styles: STYLES,
    };
  });

  app.post("/api/deck", async (req) => service.deck(deckSchema.parse(req.body)));
  app.post("/api/save", async (req) => service.save(saveSchema.parse(req.body)));
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
