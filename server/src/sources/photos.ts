// Finds a real photo for a dish that doesn't come with one (AI ideas, Mealie recipes without a picture).
// Wikipedia first (free, no key, good for named dishes), then Pexels when PEXELS_API_KEY is set.

import type { Store } from "../store.js";
import { normalize } from "../util.js";

export interface Photo {
  url: string;
  /** Who to credit, shown small on the recipe sheet. */
  credit: { text: string; url: string };
}

export interface PhotoQuery {
  /** The dish name as shown on the card. */
  title: string;
  /** Exact English Wikipedia article title, when the AI knows one. */
  wikipediaTitle?: string;
  /** A short English phrase for photo search, e.g. "mapo tofu". */
  search?: string;
}

const USER_AGENT = "DishDeck/1.0 (https://github.com/maclogan/dish-deck)";
/** A standard Wikimedia thumbnail width (non-standard sizes get throttled). */
const WIKI_WIDTH = 960;
const HIT_TTL = 7 * 24 * 3600_000;
const MISS_TTL = 6 * 3600_000;

type Fetch = typeof fetch;

interface WikiPage {
  title: string;
  missing?: boolean;
  index?: number;
  pageimage?: string;
  thumbnail?: { source: string; width: number; height: number };
}

/** Words that say nothing about which dish it is. */
const FILLER = new Set(["the", "and", "with", "style", "recipe", "dish", "easy", "quick", "homemade", "classic", "simple", "of", "a"]);
const words = (s: string) => normalize(s).split(" ").filter((w) => w.length > 2 && !FILLER.has(w));

export class PhotoFinder {
  private cache = new Map<string, { at: number; photo: Photo | null }>();
  private inflight = new Map<string, Promise<Photo | undefined>>();

  constructor(
    private opts: {
      wikipediaApi: string;
      pexelsKey?: string;
      pexelsApi?: string;
      fetch?: Fetch;
      warn?: (msg: string) => void;
      /** Keeps lookups between restarts (otherwise they're cached in memory only). */
      store?: Store;
    },
  ) {}

  private get fetch(): Fetch {
    return this.opts.fetch ?? fetch;
  }

  /** A photo for the dish, or undefined when nothing trustworthy turns up. Results are cached. */
  async find(q: PhotoQuery): Promise<Photo | undefined> {
    const key = normalize(q.wikipediaTitle || q.search || q.title);
    if (!key) return undefined;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < (hit.photo ? HIT_TTL : MISS_TTL)) return hit.photo ?? undefined;
    const saved = this.opts.store?.getPhoto<Photo>(key, HIT_TTL, MISS_TTL);
    if (saved) {
      this.cache.set(key, { at: Date.now(), photo: saved.value });
      return saved.value ?? undefined;
    }
    const running = this.inflight.get(key);
    if (running) return running;
    const job = this.lookup(q)
      .catch((err) => {
        this.opts.warn?.(`Photo lookup failed for "${q.title}": ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      })
      .then((photo) => {
        this.cache.set(key, { at: Date.now(), photo: photo ?? null });
        this.opts.store?.putPhoto(key, photo ?? null);
        this.inflight.delete(key);
        return photo;
      });
    this.inflight.set(key, job);
    return job;
  }

  private async lookup(q: PhotoQuery): Promise<Photo | undefined> {
    // 1. The article the AI named, or one titled like the dish.
    const titles = [...new Set([q.wikipediaTitle, q.title].filter((t): t is string => !!t?.trim()))];
    const direct = await this.wikiTitles(titles);
    if (direct) return direct;
    // 2. A Wikipedia search, accepted only if the article title clearly names the same dish.
    const searched = await this.wikiSearch(q.search || q.title);
    if (searched) return searched;
    // 3. Stock photos.
    return this.pexels(q.search || q.title);
  }

  private async wiki(params: Record<string, string>): Promise<WikiPage[]> {
    const url = new URL(this.opts.wikipediaApi);
    const all = {
      action: "query",
      format: "json",
      formatversion: "2",
      redirects: "1",
      prop: "pageimages",
      piprop: "thumbnail|name",
      pithumbsize: String(WIKI_WIDTH),
      ...params,
    };
    for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
    const res = await this.fetch(url, { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
    const data = (await res.json()) as { query?: { pages?: WikiPage[] } };
    return data.query?.pages ?? [];
  }

  private wikiPhoto(page: WikiPage): Photo | undefined {
    const src = page.thumbnail?.source;
    // Skip drawings, maps and logos; dish photos are JPEGs (or occasionally WebP/PNG photos, which we accept).
    if (!src || /\.svg/i.test(page.pageimage ?? src)) return undefined;
    const base = new URL(this.opts.wikipediaApi).origin;
    return {
      url: src,
      credit: {
        text: "Photo: Wikipedia",
        url: page.pageimage ? `${base}/wiki/File:${encodeURIComponent(page.pageimage)}` : `${base}/wiki/${encodeURIComponent(page.title)}`,
      },
    };
  }

  private async wikiTitles(titles: string[]): Promise<Photo | undefined> {
    if (!titles.length) return undefined;
    const pages = await this.wiki({ titles: titles.join("|") });
    // Keep the caller's order: the AI's article title is the better bet.
    const byTitle = (t: string) => pages.find((p) => !p.missing && normalize(p.title) === normalize(t));
    for (const t of titles) {
      const page = byTitle(t) ?? (titles.length === 1 ? pages.find((p) => !p.missing) : undefined);
      const photo = page && this.wikiPhoto(page);
      if (photo) return photo;
    }
    // Redirects rename the page (e.g. "Kung pao" -> "Kung Pao chicken"); take any page that came back with a photo.
    for (const p of pages) {
      const photo = !p.missing && this.wikiPhoto(p);
      if (photo) return photo;
    }
    return undefined;
  }

  private async wikiSearch(query: string): Promise<Photo | undefined> {
    const want = new Set(words(query));
    if (!want.size) return undefined;
    const pages = await this.wiki({ generator: "search", gsrsearch: query, gsrlimit: "5", gsrnamespace: "0" });
    // Search happily returns loosely related articles (a person, a city); the title has to share at
    // least two of the query's words (or its only word).
    const needed = Math.min(2, want.size);
    const ordered = [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const p of ordered) {
      if (words(p.title).filter((w) => want.has(w)).length < needed) continue;
      const photo = this.wikiPhoto(p);
      if (photo) return photo;
    }
    return undefined;
  }

  private async pexels(query: string): Promise<Photo | undefined> {
    if (!this.opts.pexelsKey) return undefined;
    const url = new URL("/v1/search", this.opts.pexelsApi ?? "https://api.pexels.com");
    url.searchParams.set("query", `${query} food`);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("orientation", "landscape");
    const res = await this.fetch(url, { headers: { Authorization: this.opts.pexelsKey }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Pexels ${res.status}`);
    const data = (await res.json()) as {
      photos?: { url: string; photographer: string; src: { large?: string; medium?: string } }[];
    };
    const p = data.photos?.[0];
    const src = p?.src.large ?? p?.src.medium;
    if (!p || !src) return undefined;
    return { url: src, credit: { text: `Photo: ${p.photographer} / Pexels`, url: p.url } };
  }
}
