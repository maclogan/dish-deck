// Configuration comes entirely from environment variables.
// Locally they're read from a .env file (see example.env); in Docker/Kubernetes they're injected.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  host: string;
  /** URL the server uses to reach Mealie, e.g. http://mealie:9000 */
  mealieUrl: string;
  /** Public Mealie URL used for "Open in Mealie" links, e.g. https://mealie.example.com */
  mealiePublicUrl?: string;
  mealieToken: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  /** Short description of the household, used in AI prompts. */
  householdContext: string;
  /** MediaWiki API used to find photos for dishes that don't come with one. */
  wikipediaApiUrl: string;
  /** Optional Pexels key: stock food photos when Wikipedia has none. */
  pexelsApiKey?: string;
  /** Folder for the SQLite cache and household history (a persistent volume in production). */
  dataDir?: string;
  /** Extra trusted recipe sites, "Chinese: a.com, b.com; Korean: c.com". */
  recipeSites?: string;
  /** Optional self-hosted SearXNG, for dishes the trusted sites' indexes don't have. */
  searxngUrl?: string;
  /** Background reader: seconds between page reads on any one site (0 turns it off). Sites run in parallel. */
  prefetchSecondsPerSite: number;
  mealdbKey: string;
  /** Override for TheMealDB's base URL (testing or a mirror). */
  mealdbBaseUrl: string;
  timezone: string;
  /** Days that need quick dinners, 0 = Sunday ... 6 = Saturday. */
  busyDays: number[];
  /** Which day the 7-day plan starts on. */
  planStart: "today" | "tomorrow" | "monday" | "sunday";
  leftovers: boolean;
  /** Ingredients never counted as "missing" (assumed always on hand). */
  staples: string[];
  appPasscode?: string;
  webDir: string;
  /** "Eat out" tab: Google Places key (server only). The tab is hidden without it. */
  googleMapsApiKey?: string;
  /** Browser key for the map view (restrict it to your site's address in Google Cloud). */
  googleMapsBrowserKey?: string;
  /** Override for the Places API address (testing). */
  googlePlacesBaseUrl: string;
}

export class ConfigError extends Error {}

/**
 * Load a .env file into process.env if one exists. Variables already set in the environment win,
 * so Docker/Kubernetes-injected values override the file. Path: ENV_FILE or ./.env
 */
export function loadEnvFile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const file = path.resolve(env.ENV_FILE ?? ".env");
  if (!fs.existsSync(file)) return undefined;
  process.loadEnvFile(file);
  return file;
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function parseDays(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((d) => d.trim().toLowerCase().slice(0, 3))
    .map((d) => DAY_NAMES.indexOf(d))
    .filter((d) => d >= 0);
}

const DEFAULT_STAPLES = [
  "salt", "pepper", "black pepper", "water", "oil", "olive oil", "vegetable oil",
  "cooking spray", "sugar", "flour", "butter",
];

const PLAN_STARTS = ["today", "tomorrow", "monday", "sunday"] as const;

/**
 * Clean a raw value. Node's .env loader strips quotes and trailing comments, but other loaders
 * (notably `kubectl create secret --from-env-file`) keep them literally, so handle both here.
 */
export function cleanValue(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let v = raw.trim();
  const quoted = /^(['"])(.*)\1$/.exec(v);
  if (quoted) v = quoted[2]!;
  else v = v.replace(/\s+#.*$/, ""); // unquoted value followed by "  # comment"
  v = v.trim();
  return v ? v : undefined;
}

function urlProblem(name: string, value: string): string | undefined {
  if (!/^https?:\/\//i.test(value)) return `${name} must start with http:// or https:// (got ${JSON.stringify(value)})`;
  try {
    new URL("/api", value);
    return undefined;
  } catch {
    return `${name} isn't a valid URL (got ${JSON.stringify(value)}); check for typos, spaces or an extra port`;
  }
}

function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Read and validate configuration. Reports every problem at once. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const problems: string[] = [];
  const get = (name: string) => cleanValue(env[name]);

  const mealieUrl = get("MEALIE_URL")?.replace(/\/+$/, "");
  const mealieToken = get("MEALIE_TOKEN");
  if (!mealieUrl) problems.push("MEALIE_URL is required (e.g. http://mealie:9000)");
  else {
    const p = urlProblem("MEALIE_URL", mealieUrl);
    if (p) problems.push(p);
  }
  if (!mealieToken) problems.push("MEALIE_TOKEN is required (Mealie > your profile > API Tokens)");
  else if (/\s/.test(mealieToken)) problems.push("MEALIE_TOKEN contains spaces or line breaks; paste it again as one line");
  for (const name of ["MEALIE_PUBLIC_URL", "MEALDB_BASE_URL", "WIKIPEDIA_API_URL", "SEARXNG_URL", "GOOGLE_PLACES_BASE_URL"]) {
    const v = get(name);
    const p = v ? urlProblem(name, v) : undefined;
    if (p) problems.push(p);
  }

  const planStart = (get("PLAN_START") ?? "today").toLowerCase();
  if (!PLAN_STARTS.includes(planStart as (typeof PLAN_STARTS)[number])) {
    problems.push(`PLAN_START must be one of: ${PLAN_STARTS.join(", ")}`);
  }

  const timezone = get("TZ") ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  if (!isValidTimezone(timezone)) problems.push(`TZ "${timezone}" isn't a valid IANA timezone (e.g. America/Chicago)`);

  const port = Number(get("PORT") ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) problems.push("PORT must be a number between 1 and 65535");

  const busyRaw = get("BUSY_DAYS");
  const busyDays = parseDays(busyRaw);
  if (busyRaw && busyDays.length !== busyRaw.split(",").filter((s) => s.trim()).length) {
    problems.push("BUSY_DAYS must be a comma-separated list of days like mon,wed,fri");
  }

  const prefetch = Number(get("PREFETCH_SECONDS_PER_SITE") ?? 5);
  if (!Number.isFinite(prefetch) || (prefetch !== 0 && (prefetch < 1 || prefetch > 3600))) {
    problems.push("PREFETCH_SECONDS_PER_SITE must be 0 (off) or between 1 and 3600");
  }

  for (const name of ["GOOGLE_MAPS_API_KEY", "GOOGLE_MAPS_BROWSER_KEY"]) {
    if (/\s/.test(get(name) ?? "")) problems.push(`${name} contains spaces or line breaks; paste it again as one line`);
  }

  if (problems.length) {
    throw new ConfigError(`Configuration problems:\n  - ${problems.join("\n  - ")}\nSee example.env for every setting.`);
  }

  return {
    port,
    host: get("HOST") ?? "0.0.0.0",
    mealieUrl: mealieUrl!,
    mealiePublicUrl: get("MEALIE_PUBLIC_URL")?.replace(/\/+$/, ""),
    mealieToken: mealieToken!,
    anthropicApiKey: get("ANTHROPIC_API_KEY"),
    anthropicModel: get("ANTHROPIC_MODEL") ?? "claude-haiku-5-5",
    householdContext: get("HOUSEHOLD_CONTEXT") ?? "a busy family",
    wikipediaApiUrl: get("WIKIPEDIA_API_URL") ?? "https://en.wikipedia.org/w/api.php",
    pexelsApiKey: get("PEXELS_API_KEY"),
    dataDir: get("DATA_DIR"),
    recipeSites: get("RECIPE_SITES"),
    searxngUrl: get("SEARXNG_URL")?.replace(/\/+$/, ""),
    prefetchSecondsPerSite: prefetch,
    mealdbKey: get("MEALDB_API_KEY") ?? "1",
    mealdbBaseUrl: get("MEALDB_BASE_URL") ?? "https://www.themealdb.com",
    timezone,
    busyDays,
    planStart: planStart as Config["planStart"],
    leftovers: (get("LEFTOVERS") ?? "true").toLowerCase() !== "false",
    staples: get("STAPLES")
      ? get("STAPLES")!.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : DEFAULT_STAPLES,
    appPasscode: get("APP_PASSCODE"),
    webDir: get("WEB_DIR") ?? path.resolve(here, "../../web/dist"),
    googleMapsApiKey: get("GOOGLE_MAPS_API_KEY"),
    googleMapsBrowserKey: get("GOOGLE_MAPS_BROWSER_KEY"),
    googlePlacesBaseUrl: get("GOOGLE_PLACES_BASE_URL")?.replace(/\/+$/, "") ?? "https://places.googleapis.com",
  };
}
