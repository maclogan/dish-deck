import { describe, expect, it } from "vitest";
import { SearxngSearch } from "../src/sources/searxng.js";
import { cleanDomain, siteList, sitesFor } from "../src/sources/sites.js";
import { RecipeSites, extractRecipe, matchScore, nameFromUrl, searchScore } from "../src/sources/webrecipes.js";
import { Store } from "../src/store.js";

const ld = (obj: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;

const recipePage = (name: string, extra: Record<string, unknown> = {}) =>
  ld({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "Site" },
      {
        "@type": ["Recipe", "NewsArticle"],
        name,
        image: [{ "@type": "ImageObject", url: "https://img.test/a-1200x800.jpg" }, "https://img.test/a-500.jpg"],
        recipeYield: ["4", "4 servings"],
        prepTime: "PT10M",
        cookTime: "PT1H5M",
        recipeIngredient: ["1 lb pork belly &amp; skin", "2 tbsp <b>Shaoxing</b> wine"],
        recipeInstructions: [
          { "@type": "HowToSection", name: "Prep", itemListElement: [{ "@type": "HowToStep", text: "Blanch the pork." }] },
          { "@type": "HowToStep", text: "Braise &#8211; low and slow." },
        ],
        nutrition: { "@type": "NutritionInformation", calories: "420 kcal", proteinContent: "21 g" },
        ...extra,
      },
    ],
  });

describe("reading recipes from pages", () => {
  it("pulls the schema.org Recipe out of a @graph, with sections, entities and times", () => {
    const r = extractRecipe(recipePage("Hong Shao Rou (Red Braised Pork Belly)"), "https://www.thewoksoflife.com/hong-shao-rou/")!;
    expect(r).toMatchObject({
      domain: "thewoksoflife.com",
      title: "Hong Shao Rou (Red Braised Pork Belly)",
      image: "https://img.test/a-1200x800.jpg",
      ingredients: ["1 lb pork belly & skin", "2 tbsp Shaoxing wine"],
      instructions: ["Blanch the pork.", "Braise – low and slow."],
      totalMinutes: 75,
      servings: 4,
      nutrition: { calories: 420, protein: 21 },
    });
  });

  it("splits instructions given as one HTML string, and ignores pages without a recipe", () => {
    const r = extractRecipe(recipePage("Dan Dan Noodles", { recipeInstructions: "<ol><li>Boil.</li><li>Toss.</li></ol>" }), "https://a.test/x/")!;
    expect(r.instructions).toEqual(["Boil.", "Toss."]);
    expect(extractRecipe(ld({ "@type": "Article", name: "Woks we love" }), "https://a.test/y/")).toBeUndefined();
    expect(extractRecipe("<script type=application/ld+json>{not json</script>", "https://a.test/z/")).toBeUndefined();
  });
});

describe("matching dish names to pages", () => {
  it("reads dish names from addresses", () => {
    expect(nameFromUrl("https://site.test/sichuan-dry-fried-green-beans/")).toBe("sichuan dry fried green beans");
    expect(nameFromUrl("https://site.test/recipes/mapo-tofu.html")).toBe("mapo tofu");
  });

  it("matches every word of the dish, allowing split or joined romanization", () => {
    expect(matchScore("Fish-Fragrant Eggplant", "fish fragrant eggplant yu xiang qie zi")).toBeGreaterThan(0.5);
    expect(matchScore("yuxiang qiezi", "yu xiang qiezi eggplant")).toBeGreaterThan(0.5);
    expect(matchScore("Pork and Chive Dumplings", "pork and chinese chive dumplings recipe")).toBeGreaterThan(0.8);
    expect(matchScore("Mapo Tofu", "our favorite woks buying guide")).toBe(0);
    expect(matchScore("Cumin Lamb", "cumin roasted carrots")).toBe(0);
    // Extra words cost a little, so the closer page wins.
    expect(matchScore("Scallion Pancakes", "scallion pancakes")).toBeGreaterThan(matchScore("Scallion Pancakes", "flaky scallion pancakes with sesame and five spice"));
  });
});

describe("site lists", () => {
  it("adds RECIPE_SITES in front of the defaults and falls back to the general list", () => {
    const all = siteList("chinese: https://www.myfavorite.com/recipes, thewoksoflife.com; Ethiopian: ethiofood.test");
    expect(all.Chinese!.slice(0, 2)).toEqual(["myfavorite.com", "thewoksoflife.com"]);
    expect(all.Chinese!.filter((d) => d === "thewoksoflife.com")).toHaveLength(1);
    expect(sitesFor(all, ["Ethiopian"])).toEqual(["ethiofood.test"]);
    expect(sitesFor(all, ["Martian"])).toEqual(all.General);
    expect(cleanDomain("HTTPS://WWW.Example.com/x")).toBe("example.com");
  });
});

/** A small fake web: robots.txt, a sitemap index with posts/pages children, and recipe pages. */
function fakeWeb() {
  const calls: string[] = [];
  const pages: Record<string, string> = {
    "https://woks.test/robots.txt": "User-agent: *\nSitemap: https://woks.test/sitemap_index.xml\n",
    "https://woks.test/sitemap_index.xml":
      "<sitemapindex><sitemap><loc>https://woks.test/post-sitemap.xml</loc></sitemap><sitemap><loc>https://woks.test/page-sitemap.xml</loc></sitemap></sitemapindex>",
    "https://woks.test/post-sitemap.xml":
      "<urlset><url><loc>https://woks.test/hong-shao-rou-red-braised-pork-belly/</loc><lastmod>2026-01-01</lastmod></url>" +
      "<url><loc>https://woks.test/red-braised-pork-belly-shopping-guide/</loc></url>" +
      "<url><loc>https://woks.test/category/pork/</loc></url><url><loc>https://other.test/stolen/</loc></url></urlset>",
    "https://woks.test/hong-shao-rou-red-braised-pork-belly/": recipePage("Hong Shao Rou (Red Braised Pork Belly)"),
    "https://woks.test/red-braised-pork-belly-shopping-guide/": ld({ "@type": "Article", name: "Shopping guide" }),
    "https://woks.test/cumin-lamb/": recipePage("Cumin Lamb"),
  };
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const url = String(input);
    calls.push(url);
    const body = pages[url];
    return new Response(body ?? "nope", { status: body ? 200 : 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("trusted recipe sites", () => {
  it("indexes a site from its sitemap, skipping page/category sitemaps, other hosts and category pages", async () => {
    const web = fakeWeb();
    const store = new Store(":memory:");
    const sites = new RecipeSites({ store, fetch: web.fetchImpl });
    await sites.ensureIndexed(["woks.test"]);
    expect(store.pagesFor("woks.test").map((p) => p.name).sort()).toEqual(["hong shao rou red braised pork belly", "red braised pork belly shopping guide"]);
    expect(web.calls).not.toContain("https://woks.test/page-sitemap.xml");
    // Indexed this week: not fetched again.
    await sites.ensureIndexed(["woks.test"]);
    expect(web.calls.filter((c) => c.endsWith("robots.txt"))).toHaveLength(1);
  });

  it("finds a dish by name, checking the page's real recipe title, and reads each page only once", async () => {
    const web = fakeWeb();
    const store = new Store(":memory:");
    const sites = new RecipeSites({ store, fetch: web.fetchImpl });
    const r = await sites.find(["Red-Braised Pork Belly", "hong shao rou"], ["woks.test"]);
    expect(r?.title).toBe("Hong Shao Rou (Red Braised Pork Belly)");
    await sites.read("https://woks.test/hong-shao-rou-red-braised-pork-belly/");
    expect(web.calls.filter((c) => c.endsWith("/hong-shao-rou-red-braised-pork-belly/"))).toHaveLength(1);
    // A page that matches by name but isn't a recipe doesn't count, and that's remembered.
    expect(await sites.find(["Red Braised Pork Belly Shopping Guide"], ["woks.test"])).toBeUndefined();
    expect(store.getRecipe("https://woks.test/red-braised-pork-belly-shopping-guide/", 1e12, 1e12)).toEqual({ value: null });
  });

  it("asks the search fallback for dishes the sitemap doesn't list", async () => {
    const web = fakeWeb();
    const asked: string[] = [];
    const sites = new RecipeSites({
      store: new Store(":memory:"),
      fetch: web.fetchImpl,
      search: { search: async (q) => (asked.push(q), ["https://woks.test/cumin-lamb/"]) },
    });
    expect((await sites.find(["Cumin Lamb"], ["woks.test"]))?.title).toBe("Cumin Lamb");
    expect(asked).toEqual(["Cumin Lamb"]);
    expect(await sites.find(["Lion's Head Meatballs"], ["woks.test"])).toBeUndefined();
  });

  it("deals random real recipes from a cuisine's sites, skipping articles and skipped pages", async () => {
    const web = fakeWeb();
    const sites = new RecipeSites({ store: new Store(":memory:"), fetch: web.fetchImpl });
    const got = await sites.random(["woks.test"], 5, new Set());
    expect(got.map((r) => r.title)).toEqual(["Hong Shao Rou (Red Braised Pork Belly)"]);
    expect(await sites.random(["woks.test"], 5, new Set(["web:https://woks.test/hong-shao-rou-red-braised-pork-belly/"]))).toEqual([]);
  });

  it("uses Mealie's scraper for pages without schema.org data", async () => {
    const fetchImpl = (async () => new Response("<html><body>no data</body></html>")) as unknown as typeof fetch;
    const sites = new RecipeSites({
      store: new Store(":memory:"),
      fetch: fetchImpl,
      scrape: async (url) => ({ url, domain: "x.test", title: "Scraped", ingredients: ["a"], instructions: ["b"], keywords: [] }),
    });
    expect((await sites.read("https://x.test/r/"))?.title).toBe("Scraped");
  });
});

describe("without AI: searching and browsing the indexes", () => {
  it("scores typed searches by words in the page name, shorter names first", () => {
    expect(searchScore("salmon", "miso glazed salmon")).toBeGreaterThan(searchScore("salmon", "salmon and asparagus sheet pan dinner with herbs"));
    expect(searchScore("noodle soup", "beef noodle soup")).toBeGreaterThan(0);
    expect(searchScore("noodle soup", "beef noodles")).toBe(0);
    // Three or more words: two thirds is enough.
    expect(searchScore("spicy pork noodles", "spicy pork mince")).toBeGreaterThan(0);
  });

  it("searches the index and reads the best matches, skipping what the household skipped", async () => {
    const web = fakeWeb();
    const sites = new RecipeSites({ store: new Store(":memory:"), fetch: web.fetchImpl });
    const hits = await sites.search("pork belly", ["woks.test"], 4, new Set());
    // The shopping guide matches the words too, but isn't a recipe.
    expect(hits.map((r) => r.title)).toEqual(["Hong Shao Rou (Red Braised Pork Belly)"]);
    expect(await sites.search("pork belly", ["woks.test"], 4, new Set(["web:https://woks.test/hong-shao-rou-red-braised-pork-belly/"]))).toEqual([]);
  });

  it("reads pages in the background and saves diet/meal facts, so filtered browsing comes from the cache", async () => {
    const web = fakeWeb();
    const store = new Store(":memory:");
    const sites = new RecipeSites({ store, fetch: web.fetchImpl });
    await sites.ensureIndexed(["woks.test"]);
    expect(store.unreadPages(10)).toHaveLength(2);
    expect(await sites.prefetch(10)).toBe(2);
    expect(store.unreadPages(10)).toHaveLength(0);
    expect(store.readRecipeUrls(["woks.test"], { limit: 10 })).toEqual(["https://woks.test/hong-shao-rou-red-braised-pork-belly/"]);
    // Pork belly isn't vegetarian; it is gluten-free and dinner-friendly.
    expect(store.readRecipeUrls(["woks.test"], { diets: ["vegetarian"], limit: 10 })).toEqual([]);
    expect(store.readRecipeUrls(["woks.test"], { diets: ["gluten-free"], meals: ["dinner", "lunch"], limit: 10 })).toHaveLength(1);
    const fetchesBefore = web.calls.length;
    expect((await sites.random(["woks.test"], 3, new Set(), { diets: ["vegetarian"] })).length).toBe(0);
    expect((await sites.random(["woks.test"], 3, new Set(), { diets: ["gluten-free"] })).map((r) => r.title)).toEqual(["Hong Shao Rou (Red Braised Pork Belly)"]);
    // Everything came from the cache.
    expect(web.calls.length).toBe(fetchesBefore);
  });

  it("fills in facts for recipes saved before facts existed", async () => {
    const store = new Store(":memory:");
    store.db.prepare("INSERT INTO recipes (url, json, fetched_at) VALUES (?, ?, ?)").run(
      "https://old.test/r/",
      JSON.stringify({ url: "https://old.test/r/", domain: "old.test", title: "Tofu Bowl", ingredients: ["1 block tofu", "1 cup rice"], instructions: ["Cook."], keywords: [] }),
      Date.now(),
    );
    store.replacePages("old.test", [{ url: "https://old.test/r/", domain: "old.test", name: "tofu bowl" }]);
    await new RecipeSites({ store, fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch }).prefetch(0);
    expect(store.readRecipeUrls(["old.test"], { diets: ["vegan"], limit: 5 })).toEqual(["https://old.test/r/"]);
  });
});

describe("SearXNG fallback", () => {
  it("searches each site and keeps only results on those sites, best of each first", async () => {
    const queries: string[] = [];
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      queries.push(url.searchParams.get("q")!);
      expect(url.searchParams.get("format")).toBe("json");
      const site = /site:(\S+)/.exec(url.searchParams.get("q")!)![1];
      return new Response(JSON.stringify({ results: [{ url: `https://www.${site}/cumin-lamb/` }, { url: "https://spam.test/cumin" }, { url: `https://${site}/cumin-2/` }] }));
    }) as typeof fetch;
    const s = new SearxngSearch("http://searx:8080", fetchImpl);
    const urls = await s.search("cumin lamb", ["a.test", "b.test"]);
    expect(queries).toEqual(["cumin lamb recipe site:a.test", "cumin lamb recipe site:b.test"]);
    expect(urls).toEqual(["https://www.a.test/cumin-lamb/", "https://www.b.test/cumin-lamb/", "https://a.test/cumin-2/", "https://b.test/cumin-2/"]);
  });
});

describe("store", () => {
  it("keeps skipped cards out for the whole household and survives reopening", async () => {
    const file = `/tmp/dishdeck-test-${process.pid}-${Date.now()}.db`;
    const a = new Store(file);
    a.record("web:https://woks.test/x/", "skip", "X");
    a.db.close();
    const b = new Store(file);
    expect(b.excludedKeys().has("web:https://woks.test/x/")).toBe(true);
    b.forget("web:https://woks.test/x/");
    expect(b.excludedKeys().size).toBe(0);
  });

  it("keeps a site's last good page list when re-indexing fails", () => {
    const s = new Store(":memory:");
    s.replacePages("woks.test", [{ url: "https://woks.test/a/", domain: "woks.test", name: "a" }]);
    s.replacePages("woks.test", [], "503");
    expect(s.pagesFor("woks.test")).toHaveLength(1);
  });
});
