// "What locals say": mentions of a restaurant on the city subreddit, local blogs and news, found through
// the optional self-hosted SearXNG (SEARXNG_URL). Review sites and delivery apps are left out (their
// ratings are already in Google's), as is the restaurant's own site.

import { baseName } from "./chains.js";
import type { ChatterItem } from "./types.js";

const SKIP_HOSTS = [
  "google.", "yelp.", "tripadvisor.", "doordash.", "ubereats.", "grubhub.", "postmates.", "seamless.", "opentable.",
  "resy.", "facebook.", "instagram.", "tiktok.", "x.com", "twitter.", "menupages.", "allmenus.", "zomato.", "foursquare.",
  "restaurantguru.", "sirved.", "menuwithprice.", "mapquest.", "yellowpages.", "wanderlog.", "chamberofcommerce.",
];

export interface ChatterSource {
  items: ChatterItem[];
  /** Extra text from up to 3 local pages, for the AI digest. */
  excerpts: string[];
}

function host(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

const stripHtml = (html: string) =>
  html
    .replace(/<(script|style|noscript|svg|nav|header|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ");

/** Sentences around mentions of the name, up to ~1200 characters. */
export function excerptAround(text: string, name: string): string {
  const key = baseName(name).split(" ").filter((w) => w.length > 2).slice(0, 2).join(" ");
  if (!key) return "";
  const lower = text.toLowerCase();
  const parts: string[] = [];
  let from = 0;
  while (parts.join(" ").length < 1200) {
    const i = lower.indexOf(key.split(" ")[0]!, from);
    if (i < 0) break;
    parts.push(text.slice(Math.max(0, i - 250), i + 450).trim());
    from = i + 450;
  }
  return parts.join(" … ").slice(0, 1200);
}

export class Chatter {
  constructor(
    private searxngUrl: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async search(q: string): Promise<{ url: string; title: string; content: string }[]> {
    const url = new URL("/search", this.searxngUrl);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("categories", "general");
    const res = await this.fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`SearXNG ${res.status}${res.status === 403 ? " (is the json format enabled in settings.yml?)" : ""}`);
    const data = (await res.json()) as { results?: { url?: string; title?: string; content?: string }[] };
    return (data.results ?? []).map((r) => ({ url: r.url ?? "", title: r.title ?? "", content: r.content ?? "" }));
  }

  async find(place: { name: string; city?: string; website?: string }): Promise<ChatterSource> {
    const where = place.city ? ` ${place.city}` : "";
    const own = place.website ? host(place.website) : undefined;
    const lists = await Promise.all(
      [`"${place.name}"${where} reddit`, `"${place.name}"${where} review`].map((q) => this.search(q).catch(() => [])),
    );
    // The first meaningful word of the name has to appear, so a search that drifted to other places is dropped.
    const words = baseName(place.name).split(" ").filter((w) => w.length > 2 && !["the", "and", "restaurant", "cafe"].includes(w));
    const key = words[0] ?? baseName(place.name);
    const seen = new Set<string>();
    const items: ChatterItem[] = [];
    for (let i = 0; i < 10; i++) {
      for (const list of lists) {
        const r = list[i];
        const h = r && host(r.url);
        if (!r || !h || seen.has(r.url) || h === own || SKIP_HOSTS.some((s) => h.includes(s))) continue;
        if (!`${r.title} ${r.content}`.toLowerCase().includes(key)) continue;
        seen.add(r.url);
        items.push({ title: r.title.trim(), url: r.url, snippet: r.content.trim().slice(0, 400), source: h });
      }
    }
    const top = items.slice(0, 8);
    // Read a few local pages (not Reddit, which refuses automated reads) for the AI digest.
    const pages = top.filter((i) => !i.source.endsWith("reddit.com")).slice(0, 3);
    const excerpts = (
      await Promise.all(
        pages.map(async (p) => {
          const res = await this.fetchImpl(p.url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(8_000) }).catch(() => undefined);
          if (!res?.ok || !(res.headers.get("content-type") ?? "").includes("html")) return "";
          const text = stripHtml((await res.text()).slice(0, 600_000));
          const ex = excerptAround(text, place.name);
          return ex ? `${p.source}: ${ex}` : "";
        }),
      )
    ).filter(Boolean);
    return { items: top, excerpts };
  }
}
