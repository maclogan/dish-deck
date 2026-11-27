import { createSign, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AccessVerifier } from "../src/access.js";
import { buildApp } from "../src/app.js";
import { type Config, loadConfig } from "../src/config.js";
import { GUEST_DAILY_SEARCHES } from "../src/dining/routes.js";
import { PlacesClient, type GPlace } from "../src/dining/places.js";
import { DiningService } from "../src/dining/service.js";
import { Store } from "../src/store.js";

// ------------------------------------------------------------------ a fake Cloudflare Access team

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-1234";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };

let certFetches = 0;
const certsFetch = (async (input: URL | RequestInfo) => {
  certFetches++;
  expect(String(input)).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function token(claims: Record<string, unknown>, opts: { kid?: string; key?: typeof privateKey } = {}) {
  const head = b64({ alg: "RS256", kid: opts.kid ?? "k1", typ: "JWT" });
  const body = b64({ aud: [AUD], iss: `https://${TEAM}`, exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(opts.key ?? privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

describe("AccessVerifier", () => {
  const v = new AccessVerifier(TEAM, AUD, certsFetch);
  it("accepts a genuine token and returns the lowercased email", async () => {
    expect(await v.email(token({ email: "Me@Example.com" }))).toBe("me@example.com");
  });
  it("rejects forged, foreign, expired and malformed tokens", async () => {
    expect(await v.email(token({ email: "me@example.com" }, { key: other.privateKey }))).toBeUndefined();
    expect(await v.email(token({ email: "me@example.com", aud: ["someone-else"] }))).toBeUndefined();
    expect(await v.email(token({ email: "me@example.com", iss: "https://evil.cloudflareaccess.com" }))).toBeUndefined();
    expect(await v.email(token({ email: "me@example.com", exp: Math.floor(Date.now() / 1000) - 600 }))).toBeUndefined();
    expect(await v.email(token({ email: "me@example.com" }, { kid: "unknown" }))).toBeUndefined();
    expect(await v.email("not.a.token")).toBeUndefined();
    expect(await v.email(undefined)).toBeUndefined();
  });
  it("caches the keys instead of fetching them for every request", async () => {
    const before = certFetches;
    for (let i = 0; i < 5; i++) await v.email(token({ email: "me@example.com" }));
    expect(certFetches - before).toBe(0);
  });
});

// ------------------------------------------------------------------ the app, behind Cloudflare Access

const HOUSEHOLD = "me@example.com";
const GUEST = "friend@example.com";
const GUEST2 = "other@example.com";

const config: Config = {
  port: 0,
  host: "127.0.0.1",
  mealieUrl: "http://mealie.test",
  mealiePublicUrl: "https://meals.example.com",
  mealieToken: "tok",
  anthropicModel: "claude-haiku-5-5",
  householdContext: "a busy family",
  wikipediaApiUrl: "https://en.wikipedia.test/w/api.php",
  prefetchSecondsPerSite: 0,
  mealdbKey: "1",
  mealdbBaseUrl: "https://www.themealdb.test",
  timezone: "UTC",
  busyDays: [],
  planStart: "today",
  leftovers: true,
  staples: [],
  webDir: "/nonexistent",
  googlePlacesBaseUrl: "https://places.test",
  appPasscode: "secret",
  cfAccessTeamDomain: TEAM,
  cfAccessAud: AUD,
  householdEmails: [HOUSEHOLD],
};

const HERE = { lat: 39.74, lng: -104.99 };
const place = (n: number): GPlace => ({
  id: `place${String(n).padStart(6, "0")}`,
  displayName: { text: `Place ${n}` },
  location: { latitude: HERE.lat, longitude: HERE.lng },
  primaryType: "restaurant",
  types: ["restaurant"],
  businessStatus: "OPERATIONAL",
  regularOpeningHours: { periods: [{ open: { day: 0, hour: 0 } }], weekdayDescriptions: [] },
});

function setup() {
  const google = (async () => new Response(JSON.stringify({ places: [place(1), place(2), place(3)] }), { headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const store = new Store(":memory:");
  const dining = new DiningService({
    places: new PlacesClient("key", "https://places.test", google),
    store,
    timezone: "UTC",
    photoUrl: (name, w) => `/photo/${name}/${w}`,
    warn: () => undefined,
  });
  const app = buildApp(config, { store, dining, access: new AccessVerifier(TEAM, AUD, certsFetch) });
  const as = (email: string) => ({ "cf-access-jwt-assertion": token({ email }) });
  const search = (headers: Record<string, string>) =>
    app.inject({ method: "POST", url: "/api/dining/search", headers, payload: { location: HERE, radiusMiles: 5, ai: false, filters: { openAtTime: false } } });
  return { app, store, as, search };
}

const HOUSEHOLD_ONLY: [string, string][] = [
  ["POST", "/api/deck"],
  ["POST", "/api/save"],
  ["POST", "/api/history"],
  ["GET", "/api/recipes"],
  ["GET", "/api/week"],
  ["POST", "/api/plan/generate"],
  ["POST", "/api/plan/apply"],
  ["GET", "/api/mealie-image/00000000-0000-4000-8000-000000000001"],
  ["GET", "/api/some-future-route"],
];

describe("guests through Cloudflare Access", () => {
  it("blocks guests from everything but Eat out, and lets the household use it all", async () => {
    const { app, as } = setup();
    for (const [method, url] of HOUSEHOLD_ONLY) {
      const res = await app.inject({ method: method as "GET", url, headers: as(GUEST), payload: method === "POST" ? {} : undefined });
      expect([url, res.statusCode]).toEqual([url, 403]);
      const mine = await app.inject({ method: method as "GET", url, headers: as(HOUSEHOLD), payload: method === "POST" ? {} : undefined });
      expect([url, [401, 403].includes(mine.statusCode)]).toEqual([url, false]);
    }
    expect((await app.inject({ method: "GET", url: "/api/dining/never", headers: as(GUEST) })).statusCode).toBe(200);
  });

  it("needs a genuine sign-in or the household passcode", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "GET", url: "/api/dining/never" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/week", headers: { "cf-access-jwt-assertion": token({ email: HOUSEHOLD }, { key: other.privateKey }) } })).statusCode).toBe(401);
    // The passcode still works as the household's fallback (e.g. on the home network).
    expect((await app.inject({ method: "GET", url: "/api/dining/never", headers: { "x-app-passcode": "secret" } })).statusCode).toBe(200);
  });

  it("tells the app who is signed in, and hides Mealie from guests", async () => {
    const { app, as } = setup();
    const h = (await app.inject({ method: "GET", url: "/api/config", headers: as(HOUSEHOLD) })).json();
    expect(h).toMatchObject({ role: "household", email: HOUSEHOLD, passcodeRequired: false, mealieUrl: "https://meals.example.com" });
    const g = (await app.inject({ method: "GET", url: "/api/config", headers: as(GUEST) })).json();
    expect(g).toMatchObject({ role: "guest", email: GUEST, passcodeRequired: false });
    expect(g.mealieUrl).toBeUndefined();
    const nobody = (await app.inject({ method: "GET", url: "/api/config" })).json();
    expect(nobody).toMatchObject({ role: "none", passcodeRequired: true });
  });

  it("keeps a separate never-again list for each person", async () => {
    const { app, as, search } = setup();
    await app.inject({ method: "POST", url: "/api/dining/never", headers: as(GUEST), payload: { id: "place000001", name: "Place 1" } });
    await app.inject({ method: "POST", url: "/api/dining/never", headers: as(HOUSEHOLD), payload: { id: "place000002", name: "Place 2" } });
    const names = async (email: string) => (await search(as(email))).json().places.map((p: { name: string }) => p.name);
    expect(await names(GUEST)).toEqual(["Place 2", "Place 3"]);
    expect(await names(HOUSEHOLD)).toEqual(["Place 1", "Place 3"]);
    expect(await names(GUEST2)).toEqual(["Place 1", "Place 2", "Place 3"]);
    const list = (await app.inject({ method: "GET", url: "/api/dining/never", headers: as(GUEST) })).json();
    expect(list.places.map((p: { name: string }) => p.name)).toEqual(["Place 1"]);
  });

  it("limits each guest's searches per day, but not the household's", async () => {
    const { as, search } = setup();
    for (let i = 0; i < GUEST_DAILY_SEARCHES; i++) expect((await search(as(GUEST))).statusCode).toBe(200);
    expect((await search(as(GUEST))).statusCode).toBe(429);
    expect((await search(as(GUEST2))).statusCode).toBe(200);
    for (let i = 0; i < GUEST_DAILY_SEARCHES + 5; i++) expect((await search(as(HOUSEHOLD))).statusCode).toBe(200);
  });
});

describe("Cloudflare Access settings", () => {
  const base = { MEALIE_URL: "http://mealie:9000", MEALIE_TOKEN: "t", TZ: "UTC" };
  it("reads them, and insists on all three together", () => {
    const c = loadConfig({ ...base, CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com/", CF_ACCESS_AUD: "a", HOUSEHOLD_EMAILS: "Me@x.com, wife@x.com" });
    expect(c).toMatchObject({ cfAccessTeamDomain: "team.cloudflareaccess.com", cfAccessAud: "a", householdEmails: ["me@x.com", "wife@x.com"] });
    expect(() => loadConfig({ ...base, CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com" })).toThrow(/go together/);
    expect(() => loadConfig({ ...base, CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", CF_ACCESS_AUD: "a", HOUSEHOLD_EMAILS: "nope" })).toThrow(/isn't an email/);
    expect(loadConfig(base).householdEmails).toEqual([]);
  });
});

describe("never-again migration", () => {
  it("moves the old household list into the per-person table", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dishdeck-"));
    const file = path.join(dir, "dishdeck.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE dining_never (place_id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, at INTEGER NOT NULL)");
    db.prepare("INSERT INTO dining_never VALUES (?, ?, ?, ?)").run("placeA", "Old Favorite Not", "1 Main St", 1);
    db.close();
    const store = new Store(file);
    expect(store.neverList("household")).toEqual([{ id: "placeA", name: "Old Favorite Not", address: "1 Main St", at: 1 }]);
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'dining_never'").get()).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
