// "Eat out" API routes (all under /api/dining/, behind the app's passcode like every other route).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CUISINE_IDS } from "./cuisines.js";
import { PlacesError } from "./places.js";
import type { DiningService } from "./service.js";

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const clock = z.string().regex(/^\d{1,2}:\d{2}$/);

const filtersSchema = z.object({
  minRating: z.number().min(0).max(5).optional(),
  prices: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])).max(4).default([]),
  cuisines: z.array(z.enum(CUISINE_IDS as [string, ...string[]])).max(CUISINE_IDS.length).default([]),
  chain: z.enum(["any", "independent", "chain"]).default("any"),
  openAtTime: z.boolean().default(true),
  service: z.array(z.enum(["dineIn", "takeout", "delivery"])).max(3).default([]),
  features: z.array(z.enum(["outdoor", "groups", "kids", "vegetarian", "reservations"])).max(5).default([]),
});

const searchSchema = z.object({
  location: latLng,
  radiusMiles: z.number().min(0.25).max(30),
  when: clock.optional(),
  query: z.string().max(300).optional(),
  filters: filtersSchema.default({ prices: [], cuisines: [], chain: "any", openAtTime: true, service: [], features: [] }),
  sort: z.enum(["best", "distance", "rating", "gems"]).default("best"),
  ai: z.boolean().default(true),
});

const momentSchema = z.object({
  location: latLng,
  when: clock.optional(),
  ai: z.boolean().default(true),
});

const placeId = z.string().regex(/^[A-Za-z0-9_-]{10,300}$/);
export const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

export function registerDining(app: FastifyInstance, dining: DiningService | undefined) {
  app.register(async (r) => {
    r.addHook("onRequest", async (_req, reply) => {
      if (!dining) return reply.code(404).send({ error: "Eat out is off: set GOOGLE_MAPS_API_KEY to turn it on." });
    });
    r.setErrorHandler((err, _req, reply) => {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: "Invalid request", issues: err.issues });
      if (err instanceof PlacesError) {
        app.log.error(err.message);
        return reply.code(502).send({ error: err.message });
      }
      app.log.error(err);
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Unexpected error" });
    });

    r.post("/search", async (req) => dining!.search(searchSchema.parse(req.body)));

    r.post("/enrich", async (req) => {
      const body = momentSchema.extend({ ids: z.array(placeId).max(40) }).parse(req.body);
      return dining!.enrich(body.ids, body);
    });

    r.post<{ Params: { id: string } }>("/place/:id", async (req) => dining!.details(placeId.parse(req.params.id), momentSchema.parse(req.body)));

    r.get<{ Params: { id: string }; Querystring: { ai?: string } }>("/place/:id/chatter", async (req) =>
      dining!.chatter(placeId.parse(req.params.id), req.query.ai !== "false"),
    );

    r.get("/never", async () => ({ places: dining!.never() }));
    r.post("/never", async (req) => {
      const body = z.object({ id: placeId, name: z.string().min(1).max(200), address: z.string().max(300).optional() }).parse(req.body);
      dining!.addNever(body.id, body.name, body.address);
      return { ok: true };
    });
    r.delete<{ Params: { id: string } }>("/never/:id", async (req) => {
      dining!.removeNever(placeId.parse(req.params.id));
      return { ok: true };
    });

    r.get<{ Querystring: { q?: string; lat?: string; lng?: string } }>("/autocomplete", async (req) => {
      const q = z.string().min(2).max(200).parse(req.query.q);
      const near = req.query.lat && req.query.lng ? latLng.parse({ lat: Number(req.query.lat), lng: Number(req.query.lng) }) : undefined;
      return { suggestions: await dining!.autocomplete(q, near) };
    });
    r.get<{ Params: { id: string } }>("/locate/:id", async (req) => dining!.locate(placeId.parse(req.params.id)));
    r.get("/default-location", async () => ({ location: (await dining!.defaultLocation()) ?? null }));

    r.get<{ Querystring: { name?: string; w?: string } }>("/photo", async (req, reply) => {
      const name = String(req.query.name ?? "");
      const w = Math.min(1600, Math.max(100, Number(req.query.w) || 640));
      if (!PHOTO_NAME.test(name)) return reply.code(400).send();
      const img = await dining!.photo(name, w);
      if (!img) return reply.code(404).send();
      reply.header("Content-Type", img.type);
      // Kept by the browser only; the server doesn't store Google's photos.
      reply.header("Cache-Control", "private, max-age=86400");
      return reply.send(Buffer.from(img.body));
    });
  }, { prefix: "/api/dining" });
}
