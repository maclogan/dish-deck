// Real recipes from trusted sites, with no AI and no paid search:
//   1. index each site's sitemap (the public list of its pages), refreshed weekly
//   2. match a dish name (and its aliases) against the page names in that index
//   3. read the recipe from the page's schema.org "Recipe" data (what Google and Mealie read too)
// Everything is cached in the Store, so a page is fetched and parsed once.

import { gunzipSync } from "node:zlib";
import { DIET_IDS, MEAL_IDS, fitsDiet, fitsMeal } from "../filters.js";
import type { Store, IndexedPage } from "../store.js";
import type { Card, DietId, MealFilter, MealType, Nutrition } from "../types.js";
import { mapLimit, normalize, parseMinutes, shuffle } from "../util.js";
import { siteName } from "./sites.js";

const USER_AGENT = "Mozilla/5.0 (compatible; DishDeck/1.0; +https://github.com/maclogan/dish-deck) personal meal planner";
const WEEK = 7 * 86400_000;
const RECIPE_TTL = 120 * 86400_000;
const NO_RECIPE_TTL = 30 * 86400_000;
const MAX_CHILD_SITEMAPS = 40;
const MAX_PAGES_PER_SITE = 20_000;

/** A recipe read from a web page. */
export interface WebRecipe {
  url: string;
  domain: string;
  title: string;
  description?: string;
  image?: string;
  ingredients: string[];
  instructions: string[];
  totalMinutes?: number;
  servings?: number;
  cuisine?: string;
  category?: string;
  keywords: string[];
  nutrition?: Nutrition;
}

export interface SearchFallback {
  /** Recipe page URLs on these domains for the query, best first. */
  search(query: string, domains: string[]): Promise<string[]>;
}

type Fetch = typeof fetch;

// ------------------------------------------------------------------ names and matching

/** Words that don't tell dishes apart. */
const FILLER = new Set(
  "recipe recipes easy best quick simple homemade authentic classic traditional how to make the a an and with of in on for style my our perfect ultimate video".split(" "),
);

/** Lowercase words with filler removed and simple plurals folded ("noodles" -> "noodle"). */
export function dishWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w))
    .map((w) => (w.length > 4 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** Dish name from a page address: ".../sichuan-dry-fried-green-beans-recipe/" -> "sichuan dry fried green beans". */
export function nameFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = decodeURIComponent(parts.at(-1) ?? "").replace(/\.(html?|php)$/i, "");
    return last.replace(/[-_]+/g, " ").replace(/\s+\d+$/, "").trim();
  } catch {
    return "";
  }
}

/**
 * The same page can show up under slightly different addresses (with or without "www." or a trailing
 * slash, with tracking tags or a #fragment). This is the form used to tell them apart.
 */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.protocol = "https:";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k);
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return url;
  }
}

/** Page addresses that are clearly not a single recipe. */
const NOT_RECIPE = /\/(category|categories|tag|tags|author|page|feed|about|contact|privacy|terms|shop|store|cart|account|search|wp-content|wp-json|sitemap|newsletter|disclosure|accessibility|collections?|lists?)(\/|$)|\.(jpe?g|png|webp|gif|pdf|xml)$/i;

/**
 * How well a page name matches a dish alias, 0..1. Every alias word should appear in the page name
 * (romanized names may be split or joined differently: "qiezi" vs "qie zi"); extra words in the
 * page name cost a little.
 */
export function matchScore(alias: string, pageName: string): number {
  const a = dishWords(alias);
  const p = dishWords(pageName);
  if (!a.length || !p.length) return 0;
  const pSet = new Set(p);
  const pJoined = p.join("");
  let hit = 0;
  for (const w of a) if (pSet.has(w) || (w.length >= 4 && pJoined.includes(w))) hit++;
  // Joined forms: "qie zi" in the alias vs "qiezi" on the page.
  if (hit < a.length && a.join("").length >= 6 && pJoined.includes(a.join(""))) hit = a.length;
  const coverage = hit / a.length;
  if (coverage < 1 && (a.length < 3 || coverage < 0.75)) return 0;
  const extra = Math.max(0, p.length - hit);
  return coverage * (1 / (1 + 0.15 * extra));
}

// ------------------------------------------------------------------ schema.org Recipe extraction

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#039);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ", "&#039;": "'" })[m] ?? m);

const clean = (s: unknown): string =>
  typeof s === "string" ? decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : "";

const isType = (node: unknown, type: string) => {
  const t = (node as { "@type"?: unknown })?.["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
};

function findRecipeNode(data: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object" || depth > 6) return undefined;
  if (Array.isArray(data)) {
    for (const d of data) {
      const r = findRecipeNode(d, depth + 1);
      if (r) return r;
    }
    return undefined;
  }
  if (isType(data, "Recipe")) return data as Record<string, unknown>;
  const obj = data as Record<string, unknown>;
  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    const r = findRecipeNode(obj[key], depth + 1);
    if (r) return r;
  }
  return undefined;
}

function imageOf(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    // Prefer a landscape-ish large image when sizes are listed; otherwise the first.
    const urls = v.map(imageOf).filter((u): u is string => !!u);
    return urls.find((u) => /1200|16x9|4x3/.test(u)) ?? urls[0];
  }
  const o = v as { url?: unknown; contentUrl?: unknown };
  return imageOf(o.url ?? o.contentUrl);
}

function instructionsOf(v: unknown, depth = 0): string[] {
  if (!v || depth > 4) return [];
  if (typeof v === "string") {
    // Some sites put all steps in one string, with line breaks or <li> items.
    const parts = v.split(/<\/li>|<br\s*\/?>|\n+/i).map(clean).filter(Boolean);
    return parts.length ? parts : [clean(v)].filter(Boolean);
  }
  if (Array.isArray(v)) return v.flatMap((x) => instructionsOf(x, depth + 1));
  const o = v as Record<string, unknown>;
  if (isType(o, "HowToSection") || o.itemListElement) return instructionsOf(o.itemListElement, depth + 1);
  const text = clean(o.text ?? o.name);
  return text ? [text] : [];
}

function numberOf(v: unknown): number | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const n = typeof s === "number" ? s : parseFloat(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

const listOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map(clean).filter(Boolean);

/** Pull the schema.org Recipe out of a page's HTML, or undefined if it has none. */
export function extractRecipe(html: string, url: string): WebRecipe | undefined {
  const blocks = [...html.matchAll(/<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
  for (const raw of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(raw.trim().replace(/^<!\[CDATA\[|\]\]>$/g, ""));
    } catch {
      continue;
    }
    const r = findRecipeNode(data);
    if (!r) continue;
    const title = clean(r.name);
    const ingredients = listOf(r.recipeIngredient ?? r.ingredients);
    const instructions = instructionsOf(r.recipeInstructions);
    if (!title || !ingredients.length || !instructions.length) continue;
    const total = parseMinutes(String(r.totalTime ?? "")) ?? sum(parseMinutes(String(r.prepTime ?? "")), parseMinutes(String(r.cookTime ?? "")));
    const n = (r.nutrition ?? {}) as Record<string, unknown>;
    const nutrition: Nutrition = {
      calories: numberOf(n.calories),
      protein: numberOf(n.proteinContent),
      carbs: numberOf(n.carbohydrateContent),
      fat: numberOf(n.fatContent),
      fiber: numberOf(n.fiberContent),
    };
    const hasNutrition = Object.values(nutrition).some((x) => x !== undefined);
    return {
      url,
      domain: new URL(url).hostname.replace(/^www\./, ""),
      title,
      description: clean(r.description) || undefined,
      image: imageOf(r.image),
      ingredients,
      instructions,
      totalMinutes: total || undefined,
      servings: numberOf(r.recipeYield),
      cuisine: listOf(r.recipeCuisine)[0],
      category: listOf(r.recipeCategory)[0],
      keywords: listOf(r.keywords).slice(0, 12),
      nutrition: hasNutrition ? nutrition : undefined,
    };
  }
  return undefined;
}

const sum = (a?: number, b?: number) => (a || b ? (a ?? 0) + (b ?? 0) : undefined);

/** A web recipe as a deck card. */
export function webRecipeToCard(r: WebRecipe, extra: { region?: string; nativeName?: string; cuisine?: string; suits?: MealType[] } = {}): Card {
  return {
    key: `web:${r.url}`,
    source: "web",
    site: siteName(r.domain),
    title: r.title,
    nativeName: extra.nativeName,
    description: r.description,
    image: r.image,
    cuisine: extra.cuisine ?? r.cuisine,
    region: extra.region,
    category: r.category,
    tags: r.keywords,
    totalMinutes: r.totalMinutes,
    servings: r.servings,
    ingredients: r.ingredients,
    instructions: r.instructions,
    sourceUrl: r.url,
    nutrition: r.nutrition,
    suits: extra.suits,
  };
}

/** Which diets and meals a recipe fits, saved with it so filtered decks can pick from the cache. */
export function recipeFacts(r: WebRecipe): { diets: DietId[]; meals: MealFilter[] } {
  const card = webRecipeToCard(r);
  return {
    diets: DIET_IDS.filter((d) => fitsDiet(r.ingredients, [d])),
    meals: MEAL_IDS.filter((m) => fitsMeal(card, [m])),
  };
}

/** Filters a recipe has to pass to be dealt. */
export interface RecipeFilter {
  diets?: DietId[];
  meals?: MealFilter[];
}

const passes = (r: WebRecipe, f: RecipeFilter) => {
  if (!f.diets?.length && !f.meals?.length) return true;
  const facts = recipeFacts(r);
  return (f.diets ?? []).every((d) => facts.diets.includes(d)) && (!f.meals?.length || f.meals.some((m) => facts.meals.includes(m)));
};

/**
 * How well a page name answers a typed search, 0..1: all the search words should be in the name
 * (for 3+ words, at least two thirds); shorter names rank higher ("salmon" -> "Miso Salmon" before
 * "Salmon and Asparagus Sheet Pan Dinner with Herbs").
 */
export function searchScore(query: string, pageName: string): number {
  const q = dishWords(query);
  const p = dishWords(pageName);
  if (!q.length || !p.length) return 0;
  const pSet = new Set(p);
  const joined = p.join("");
  const hit = q.filter((w) => pSet.has(w) || (w.length >= 5 && joined.includes(w))).length;
  const needed = q.length >= 3 ? Math.ceil((q.length * 2) / 3) : q.length;
  if (hit < needed) return 0;
  return (hit / q.length) * (1 / (1 + 0.08 * Math.max(0, p.length - hit)));
}

// ------------------------------------------------------------------ robots.txt

export interface RobotsRules {
  /** Seconds to wait between requests, if the site asks for it. */
  crawlDelay?: number;
  rules: { allow: boolean; pattern: string }[];
}

/**
 * The parts of robots.txt that apply to us: the group for "dishdeck" if there is one, otherwise "*".
 * Supports Allow/Disallow with * and $ wildcards (longest match wins) and Crawl-delay.
 */
export function parseRobots(text: string): RobotsRules {
  type Group = { agents: string[]; rules: RobotsRules["rules"]; crawlDelay?: number };
  const groups: Group[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow" && value) current.rules.push({ allow: false, pattern: value });
    else if (key === "allow" && value) current.rules.push({ allow: true, pattern: value });
    else if (key === "crawl-delay" && Number.isFinite(Number(value))) current.crawlDelay = Number(value);
  }
  const mine = groups.find((g) => g.agents.some((a) => a.includes("dishdeck"))) ?? groups.find((g) => g.agents.includes("*"));
  return { crawlDelay: mine?.crawlDelay, rules: mine?.rules ?? [] };
}

export function robotsAllows(rules: RobotsRules, url: string): boolean {
  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    return false;
  }
  let best: { allow: boolean; len: number } | undefined;
  for (const r of rules.rules) {
    // Escape regex characters except * (any run) and a trailing $ (end of path).
    const body = r.pattern.endsWith("$") ? r.pattern.slice(0, -1) : r.pattern;
    const re = new RegExp("^" + body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + (r.pattern.endsWith("$") ? "$" : ""));
    if (re.test(path) && (!best || r.pattern.length > best.len || (r.pattern.length === best.len && r.allow))) {
      best = { allow: r.allow, len: r.pattern.length };
    }
  }
  return best?.allow ?? true;
}

// ------------------------------------------------------------------ sitemaps

const locs = (xml: string) =>
  [...xml.matchAll(/<(sitemap|url)>([\s\S]*?)<\/\1>/gi)].map((m) => ({
    kind: m[1]!.toLowerCase(),
    loc: decodeEntities(/<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(m[2]!)?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "") ?? ""),
    lastmod: /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(m[2]!)?.[1],
  }));

/** Child sitemaps worth reading: posts and recipes, not pages, tags, authors, products or images. */
const USEFUL_CHILD = (url: string) => !/(page|category|categories|tag|author|attachment|product|web-?story|stories|video|image|locations?|glossary)[-_]?sitemap|sitemap[-_](page|category|tag|author|taxonomies|users|attachment|product)|wp-sitemap-(taxonomies|users)|-sitemap-(page|tags?|category)/i.test(url);

// ------------------------------------------------------------------ the service

interface Loaded {
  pages: (IndexedPage & { words: string[] })[];
}

export class RecipeSites {
  private loaded = new Map<string, Loaded>();
  private robotsCache = new Map<string, RobotsRules>();
  /** Sites that answered "too many requests" / "unavailable": left alone until this time. */
  private backoffUntil = new Map<string, number>();
  /** Background reader: when each site may be asked again, and which are mid-request. */
  private nextAt = new Map<string, number>();
  private busySites = new Set<string>();
  /** HTTP status of the last request per URL (for "couldn't index" messages). */
  private lastStatus = new Map<string, number>();
  private indexing = new Map<string, Promise<void>>();
  private reading = new Map<string, Promise<WebRecipe | null>>();

  constructor(
    private opts: {
      store: Store;
      fetch?: Fetch;
      warn?: (msg: string) => void;
      /** Mealie's own scraper, for pages without schema.org data. */
      scrape?: (url: string) => Promise<WebRecipe | undefined>;
      search?: SearchFallback;
    },
  ) {}

  private get fetch(): Fetch {
    return this.opts.fetch ?? fetch;
  }

  private async get(url: string, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"): Promise<string | undefined> {
    const res = await this.fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    this.lastStatus.set(url, res.status);
    if (res.status === 429 || res.status === 503) {
      // The site wants a break: respect Retry-After (seconds), or leave it alone for an hour.
      const retry = Number(res.headers.get("retry-after"));
      const host = new URL(url).hostname.replace(/^www\./, "");
      this.backoffUntil.set(host, Date.now() + (Number.isFinite(retry) && retry > 0 ? Math.min(retry, 86400) * 1000 : 3600_000));
      this.opts.warn?.(`${host} asked us to slow down (HTTP ${res.status}); pausing background reads there`);
    }
    if (!res.ok) return undefined;
    if (url.endsWith(".gz")) return gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
    return res.text();
  }

  // ---- indexing

  /**
   * Make sure these sites are indexed (and refreshed weekly). Never throws. With `waitMs`, stops waiting
   * after that long (indexing carries on in the background) so a first deal isn't held up for long.
   */
  async ensureIndexed(domains: string[], waitMs?: number): Promise<void> {
    const all = mapLimit(domains, 3, (d) => this.indexIfStale(d));
    if (waitMs === undefined) {
      await all;
      return;
    }
    await Promise.race([all, new Promise((r) => setTimeout(r, waitMs).unref?.())]);
  }

  private indexIfStale(domain: string): Promise<void> {
    const at = this.opts.store.siteIndexedAt(domain);
    if (at && Date.now() - at < WEEK) return Promise.resolve();
    const running = this.indexing.get(domain);
    if (running) return running;
    const job = this.index(domain)
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.opts.warn?.(`Couldn't index ${domain}: ${msg}`);
        // Keep any pages from the last good run; try again in a week.
        this.opts.store.replacePages(domain, [], msg);
      })
      .finally(() => {
        this.indexing.delete(domain);
        this.loaded.delete(domain);
      });
    this.indexing.set(domain, job);
    return job;
  }

  private async index(domain: string): Promise<void> {
    const base = `https://${domain}`;
    const robots = await this.get(`${base}/robots.txt`, "text/plain").catch(() => undefined);
    const fromRobots = [...(robots ?? "").matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!);
    const candidates = [...new Set([...fromRobots, `${base}/sitemap_index.xml`, `${base}/wp-sitemap.xml`, `${base}/sitemap.xml`, `${base}/post-sitemap.xml`])];

    const pages = new Map<string, IndexedPage>();
    const seenMaps = new Set<string>();
    const queue = [...candidates];
    let children = 0;
    while (queue.length && pages.size < MAX_PAGES_PER_SITE) {
      const map = queue.shift()!;
      if (seenMaps.has(map)) continue;
      seenMaps.add(map);
      const xml = await this.get(map, "application/xml,text/xml;q=0.9,*/*;q=0.5").catch(() => undefined);
      if (!xml || !/<(urlset|sitemapindex)/i.test(xml)) continue;
      for (const e of locs(xml)) {
        if (!e.loc) continue;
        if (e.kind === "sitemap") {
          if (USEFUL_CHILD(e.loc) && children < MAX_CHILD_SITEMAPS) {
            children++;
            queue.push(e.loc);
          }
          continue;
        }
        let host: string;
        try {
          host = new URL(e.loc).hostname.replace(/^www\./, "");
        } catch {
          continue;
        }
        if (host !== domain || NOT_RECIPE.test(e.loc) || new URL(e.loc).pathname === "/") continue;
        const name = nameFromUrl(e.loc);
        // Keyed by canonical form, so a page listed twice (e.g. with and without a slash) is read once.
        if (dishWords(name).length && !pages.has(canonicalUrl(e.loc))) pages.set(canonicalUrl(e.loc), { url: e.loc, domain, name, lastmod: e.lastmod });
      }
      // A site with a sitemap index lists everything there; the other candidates are duplicates.
      if (pages.size && !queue.some((q) => !candidates.includes(q))) break;
    }
    if (!pages.size) {
      // Say what happened to each address tried, e.g. "sitemap_index.xml 403", to tell blocking from no sitemap.
      const tried = [`${base}/robots.txt`, ...seenMaps].map((u) => `${u.replace(base, "").replace(/^https?:\/\/[^/]+/, "") || u} ${this.lastStatus.get(u) ?? "failed"}`);
      const blocked = [...seenMaps, `${base}/robots.txt`].some((u) => [401, 403, 429, 503].includes(this.lastStatus.get(u) ?? 0));
      throw new Error(`${blocked ? "the site blocked the request" : "no sitemap with recipe pages found"} (${tried.join(", ")})`);
    }
    // Leave out anything robots.txt asks crawlers not to fetch.
    const rules = parseRobots(robots ?? "");
    const allowed = [...pages.values()].filter((p) => robotsAllows(rules, p.url));
    this.opts.store.replacePages(domain, allowed);
    this.opts.store.setRobots(domain, robots ?? "");
    this.robotsCache.set(domain, rules);
  }

  private robotsFor(domain: string): RobotsRules {
    let r = this.robotsCache.get(domain);
    if (!r) {
      r = parseRobots(this.opts.store.robots(domain) ?? "");
      this.robotsCache.set(domain, r);
    }
    return r;
  }

  private pagesOf(domain: string): Loaded["pages"] {
    let l = this.loaded.get(domain);
    if (!l) {
      l = { pages: this.opts.store.pagesFor(domain).map((p) => ({ ...p, words: dishWords(p.name) })) };
      this.loaded.set(domain, l);
    }
    return l.pages;
  }

  // ---- matching

  /**
   * The best recipe page for a dish on these sites (in priority order), or undefined. Candidates are
   * checked by reading the page: the recipe's real title has to match too.
   */
  async find(aliases: string[], domains: string[]): Promise<WebRecipe | undefined> {
    await this.ensureIndexed(domains, 20_000);
    const scored: { url: string; score: number }[] = [];
    domains.forEach((d, rank) => {
      for (const p of this.pagesOf(d)) {
        const s = Math.max(...aliases.map((a) => matchScore(a, p.name)));
        // Earlier sites in the list win close calls.
        if (s >= 0.5) scored.push({ url: p.url, score: s - rank * 0.01 });
      }
    });
    scored.sort((a, b) => b.score - a.score);
    for (const { url } of scored.slice(0, 4)) {
      const recipe = await this.read(url);
      if (recipe && Math.max(...aliases.map((a) => matchScore(a, recipe.title)), 0) >= 0.4) return recipe;
    }
    // Not in the indexes: ask the search fallback (if any) for pages on the same sites.
    if (this.opts.search) {
      const urls = await this.opts.search.search(aliases[0]!, domains).catch((err) => {
        this.opts.warn?.(`Search fallback failed: ${err instanceof Error ? err.message : err}`);
        return [] as string[];
      });
      for (const url of urls.slice(0, 3)) {
        const recipe = await this.read(url);
        if (recipe && Math.max(...aliases.map((a) => matchScore(a, recipe.title)), 0) >= 0.4) return recipe;
      }
    }
    return undefined;
  }

  /**
   * Random recipes from these sites (browsing without AI). Recipes already read that fit the filters
   * come first, straight from the cache; then unread pages are read until there are enough. With
   * `wait: false`, sites still being indexed are skipped this time instead of waited for.
   */
  async random(domains: string[], count: number, skip: Set<string>, opts: RecipeFilter & { wait?: boolean } = {}): Promise<WebRecipe[]> {
    if (opts.wait === false) void this.ensureIndexed(domains);
    else await this.ensureIndexed(domains, 20_000);
    const out: WebRecipe[] = [];
    const taken = new Set<string>();
    const keep = (r: WebRecipe | null) => {
      if (!r || taken.has(r.url) || skip.has(`web:${r.url}`) || !passes(r, opts)) return;
      taken.add(r.url);
      out.push(r);
    };
    for (const url of this.opts.store.readRecipeUrls(domains, { diets: opts.diets, meals: opts.meals, limit: count * 3 })) {
      if (out.length >= count) break;
      keep(await this.read(url));
    }
    const pool = shuffle(domains.flatMap((d) => this.pagesOf(d)).filter((p) => !skip.has(`web:${p.url}`) && !taken.has(p.url)));
    // Some pages are articles, and filters reject some recipes; read a bounded number of extra pages.
    const budget = count * (opts.diets?.length || opts.meals?.length ? 6 : 3);
    for (let i = 0; i < pool.length && out.length < count && i < budget; i += 4) {
      const batch = await mapLimit(pool.slice(i, i + 4), 4, (p) => this.read(p.url));
      batch.forEach(keep);
    }
    return out.slice(0, count);
  }

  /**
   * Word search over the indexed page names (and read recipe titles) of these sites: free, no AI.
   * Matches are read best-first until `count` recipes pass the filters.
   */
  async search(query: string, domains: string[], count: number, skip: Set<string>, opts: RecipeFilter & { wait?: boolean } = {}): Promise<WebRecipe[]> {
    if (opts.wait === false) void this.ensureIndexed(domains);
    else await this.ensureIndexed(domains, 20_000);
    const scored: { url: string; score: number }[] = [];
    domains.forEach((d, rank) => {
      for (const p of this.pagesOf(d)) {
        if (skip.has(`web:${p.url}`)) continue;
        const score = searchScore(query, p.name);
        if (score > 0) scored.push({ url: p.url, score: score - rank * 0.001 + Math.random() * 0.05 });
      }
    });
    scored.sort((a, b) => b.score - a.score);
    const out: WebRecipe[] = [];
    for (let i = 0; i < scored.length && out.length < count && i < count * 3; i += 4) {
      const batch = await mapLimit(scored.slice(i, i + 4), 4, (s) => this.read(s.url));
      for (const r of batch) if (r && passes(r, opts) && out.length < count) out.push(r);
    }
    return out;
  }

  /**
   * One round of background reading: every site that's due gets one unread page read, all sites in
   * parallel (up to `parallel` requests at once, to go easy on a home connection). Each site is then left alone for `secondsPerSite` (or longer if
   * its robots.txt asks for a Crawl-delay), and for an hour (or its Retry-After) after a 429/503. So
   * the total speed grows with the number of sites while each site sees a slow, steady trickle.
   * Also fills in diet/meal facts for recipes saved before facts existed. Never throws.
   */
  async prefetchRound(secondsPerSite: number, parallel = 4): Promise<number> {
    try {
      for (const row of this.opts.store.recipesWithoutFacts(200)) {
        try {
          this.opts.store.setFacts(row.url, recipeFacts(JSON.parse(row.json) as WebRecipe));
        } catch {
          /* unreadable row: leave it */
        }
      }
      const now = Date.now();
      const due = this.opts.store
        .sitesWithUnread()
        .filter((d) => !this.busySites.has(d) && (this.nextAt.get(d) ?? 0) <= now && (this.backoffUntil.get(d) ?? 0) <= now);
      const results = await mapLimit(shuffle(due), parallel, async (domain): Promise<number> => {
        const url = this.opts.store.unreadPagesFor(domain, 1)[0];
        if (!url) return 0;
        this.busySites.add(domain);
        try {
          await this.read(url);
          return 1;
        } finally {
          this.busySites.delete(domain);
          const gap = Math.max(secondsPerSite, this.robotsFor(domain).crawlDelay ?? 0);
          this.nextAt.set(domain, Date.now() + gap * 1000);
        }
      });
      return results.reduce((a, b) => a + b, 0);
    } catch (err) {
      this.opts.warn?.(`Background recipe reading failed: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
  }

  // ---- reading

  /** The indexed address for this page, if the index has it under a slightly different form. */
  private knownUrl(url: string): string {
    const canon = canonicalUrl(url);
    const domain = new URL(canon).hostname;
    return this.pagesOf(domain).find((p) => canonicalUrl(p.url) === canon)?.url ?? url;
  }

  /** The recipe on this page (cached), or null when it has none. Each page is fetched at most once. */
  read(rawUrl: string): Promise<WebRecipe | null> {
    const url = this.knownUrl(rawUrl);
    const cached = this.opts.store.getRecipe<WebRecipe>(url, RECIPE_TTL, NO_RECIPE_TTL);
    if (cached) return Promise.resolve(cached.value);
    const running = this.reading.get(url);
    if (running) return running;
    const job = (async () => {
      let recipe: WebRecipe | undefined;
      const domain = (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })();
      if (!robotsAllows(this.robotsFor(domain), url)) {
        this.opts.store.putRecipe(url, null);
        return null;
      }
      try {
        const html = await this.get(url);
        recipe = html ? extractRecipe(html, url) : undefined;
      } catch (err) {
        this.opts.warn?.(`Couldn't read ${url}: ${err instanceof Error ? err.message : err}`);
      }
      if (!recipe && this.opts.scrape) recipe = await this.opts.scrape(url).catch(() => undefined);
      this.opts.store.putRecipe(url, recipe ?? null, recipe ? recipeFacts(recipe) : undefined);
      if (recipe) this.opts.store.renamePage(url, recipe.title);
      return recipe ?? null;
    })().finally(() => this.reading.delete(url));
    this.reading.set(url, job);
    return job;
  }
}

/** Mealie's test-scrape result (a Mealie-style recipe) as a WebRecipe. */
export function fromMealieScrape(data: unknown, url: string): WebRecipe | undefined {
  const d = (data && typeof data === "object" && "recipe" in data ? (data as { recipe: unknown }).recipe : data) as Record<string, unknown> | undefined;
  if (!d || typeof d !== "object") return undefined;
  const text = (x: unknown) =>
    typeof x === "string" ? clean(x) : x && typeof x === "object" ? clean((x as Record<string, unknown>).display ?? (x as Record<string, unknown>).note ?? (x as Record<string, unknown>).originalText ?? (x as Record<string, unknown>).text) : "";
  const ingredients = (Array.isArray(d.recipeIngredient) ? d.recipeIngredient : []).map(text).filter(Boolean);
  const instructions = (Array.isArray(d.recipeInstructions) ? d.recipeInstructions : []).map(text).filter(Boolean);
  const title = clean(d.name);
  if (!title || !ingredients.length || !instructions.length) return undefined;
  const image = typeof d.image === "string" && /^https?:/.test(d.image) ? d.image : undefined;
  return {
    url,
    domain: new URL(url).hostname.replace(/^www\./, ""),
    title,
    description: clean(d.description) || undefined,
    image,
    ingredients,
    instructions,
    totalMinutes: parseMinutes(String(d.totalTime ?? "")),
    servings: numberOf(d.recipeYield ?? d.recipeServings),
    keywords: [],
  };
}
