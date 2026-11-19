// Free search fallback: a self-hosted SearXNG (https://docs.searxng.org) with its JSON API enabled.
// Used only for dishes that the trusted sites' sitemap indexes don't have.

import type { SearchFallback } from "./webrecipes.js";

export class SearxngSearch implements SearchFallback {
  constructor(private baseUrl: string, private fetchImpl: typeof fetch = fetch) {}

  async search(query: string, domains: string[]): Promise<string[]> {
    // One query per site for the first few sites ("site:" support varies between engines, OR doesn't).
    const sites = domains.slice(0, 3);
    const lists = await Promise.all(
      sites.map(async (d) => {
        const url = new URL("/search", this.baseUrl);
        url.searchParams.set("q", `${query} recipe site:${d}`);
        url.searchParams.set("format", "json");
        url.searchParams.set("categories", "general");
        const res = await this.fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`SearXNG ${res.status}${res.status === 403 ? " (is the json format enabled in settings.yml?)" : ""}`);
        const data = (await res.json()) as { results?: { url?: string }[] };
        return (data.results ?? []).map((r) => r.url ?? "");
      }),
    );
    const allowed = new Set(domains);
    const out: string[] = [];
    // Interleave so each site's best hit comes first.
    for (let i = 0; i < 5; i++) {
      for (const list of lists) {
        const u = list[i];
        if (!u) continue;
        try {
          const host = new URL(u).hostname.replace(/^www\./, "");
          if (allowed.has(host) && !out.includes(u)) out.push(u);
        } catch {
          /* not a URL */
        }
      }
    }
    return out;
  }
}
