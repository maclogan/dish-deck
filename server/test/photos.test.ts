import { describe, expect, it } from "vitest";
import { AiRecipes, pickRegions } from "../src/sources/ai.js";
import { PhotoFinder } from "../src/sources/photos.js";

const API = "https://en.wikipedia.test/w/api.php";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A tiny Wikipedia: article titles (lowercase) -> photo file, plus search results per query. */
function fakeWiki(articles: Record<string, string | null>, search: Record<string, string[]> = {}, pexels?: unknown) {
  const calls: URL[] = [];
  const page = (title: string, index?: number) => {
    const file = articles[title.toLowerCase()];
    if (file === undefined) return { title, missing: true };
    return file
      ? { title, index, pageimage: file, thumbnail: { source: `https://upload.test/960px-${file}`, width: 960, height: 640 } }
      : { title, index };
  };
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === "api.pexels.test") return json(pexels ?? { photos: [] });
    const q = url.searchParams;
    if (q.get("generator") === "search") {
      const hits = search[q.get("gsrsearch")!.toLowerCase()] ?? [];
      return json({ query: { pages: hits.map((t, i) => page(t, i + 1)) } });
    }
    return json({ query: { pages: q.get("titles")!.split("|").map((t) => page(t)) } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("photo finder", () => {
  it("uses the Wikipedia article the AI named, with a credit link to the file", async () => {
    const wiki = fakeWiki({ "yuxiang eggplant": "Yuxiang_qiezi.jpg" });
    const finder = new PhotoFinder({ wikipediaApi: API, fetch: wiki.fetchImpl });
    const photo = await finder.find({ title: "Fish-Fragrant Eggplant", wikipediaTitle: "Yuxiang eggplant" });
    expect(photo?.url).toBe("https://upload.test/960px-Yuxiang_qiezi.jpg");
    expect(photo?.credit.url).toBe("https://en.wikipedia.test/wiki/File:Yuxiang_qiezi.jpg");
    // Sends an identifying User-Agent-friendly standard thumbnail size.
    expect(wiki.calls[0]!.searchParams.get("pithumbsize")).toBe("960");
  });

  it("falls back to a search, but only trusts results that share a word with the dish", async () => {
    const wiki = fakeWiki(
      { "red braised pork belly": "Hongshao_rou.jpg", "pork": "Pig.jpg", "mao zedong": "Mao.jpg" },
      { "red braised pork": ["Mao Zedong", "Red braised pork belly"] },
    );
    const finder = new PhotoFinder({ wikipediaApi: API, fetch: wiki.fetchImpl });
    const photo = await finder.find({ title: "Mao's Red-Braised Pork", search: "red braised pork" });
    expect(photo?.url).toContain("Hongshao_rou.jpg");
  });

  it("skips drawings and diagrams", async () => {
    const wiki = fakeWiki({ "doubanjiang": "Doubanjiang_diagram.svg" });
    const finder = new PhotoFinder({ wikipediaApi: API, fetch: wiki.fetchImpl });
    expect(await finder.find({ title: "Doubanjiang" })).toBeUndefined();
  });

  it("uses Pexels when Wikipedia has nothing and a key is set", async () => {
    const wiki = fakeWiki({}, {}, { photos: [{ url: "https://pexels.test/p/1", photographer: "Ana", src: { large: "https://images.pexels.test/1.jpg" } }] });
    const finder = new PhotoFinder({ wikipediaApi: API, pexelsKey: "k", pexelsApi: "https://api.pexels.test", fetch: wiki.fetchImpl });
    const photo = await finder.find({ title: "Grandma's Cabbage Rolls" });
    expect(photo).toEqual({ url: "https://images.pexels.test/1.jpg", credit: { text: "Photo: Ana / Pexels", url: "https://pexels.test/p/1" } });
  });

  it("caches hits and misses", async () => {
    const wiki = fakeWiki({ "mapo tofu": "Mapo.jpg" });
    const finder = new PhotoFinder({ wikipediaApi: API, fetch: wiki.fetchImpl });
    await Promise.all([finder.find({ title: "Mapo Tofu" }), finder.find({ title: "Mapo Tofu" })]);
    await finder.find({ title: "Mapo Tofu" });
    await finder.find({ title: "Unknown Dish" });
    await finder.find({ title: "Unknown Dish" });
    const lookups = (t: string) => wiki.calls.filter((u) => (u.searchParams.get("titles") ?? u.searchParams.get("gsrsearch"))?.includes(t)).length;
    expect(lookups("Mapo Tofu")).toBe(1);
    expect(lookups("Unknown Dish")).toBe(2); // one title lookup + one search, then cached
  });
});

describe("AI prompt", () => {
  it("rotates through regional traditions for a cuisine", () => {
    const seq = [0, 0.99];
    let i = 0;
    const regions = pickRegions(["Chinese"], () => seq[i++ % seq.length]!);
    expect(regions).toEqual(["Sichuan", "Chinese home cooking (jiachang cai)"]);
    expect(pickRegions(["Chinese", "Martian"], () => 0)).toEqual(["Sichuan (Chinese)"]);
  });

  it("asks for home cooking without limiting ingredients, and returns photo hints", async () => {
    const ai = new AiRecipes("key", "claude-haiku-5-5", "a busy family");
    let prompt = "";
    (ai as unknown as { client: unknown }).client = {
      messages: {
        create: async (req: { messages: { content: string }[] }) => {
          prompt = req.messages[0]!.content;
          return {
            content: [
              {
                type: "tool_use",
                input: {
                  recipes: [
                    {
                      title: "Fish-Fragrant Eggplant", nativeName: "鱼香茄子", region: "Sichuan", wikipediaTitle: "Yuxiang eggplant",
                      photoSearch: "yuxiang eggplant", description: "Silky eggplant.", suits: ["dinner"], servings: 4,
                      ingredients: ["2 Chinese eggplants", "1 tbsp Pixian doubanjiang"], instructions: ["Fry.", "Braise."],
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    };
    const cards = await ai.generate({ cuisines: ["Chinese"], count: 6, leniency: 2, avoid: [], bookSample: ["Beef Tacos"] });
    expect(prompt).not.toMatch(/grocery/i);
    expect(prompt).toMatch(/actually cook at home/);
    expect(prompt).toMatch(/no General Tso's/);
    expect(prompt).toMatch(/For this batch, focus mostly on/);
    // A cuisine search doesn't get pulled toward what's already in the book.
    expect(prompt).not.toContain("Beef Tacos");
    expect(cards[0]).toMatchObject({ nativeName: "鱼香茄子", region: "Sichuan", photoHint: { wikipediaTitle: "Yuxiang eggplant", search: "yuxiang eggplant" } });

    await ai.generate({ cuisines: ["Chinese"], style: "takeout", count: 6, leniency: 2, avoid: [], bookSample: [] });
    expect(prompt).toMatch(/takeout favorites/);
    expect(prompt).not.toMatch(/focus mostly on/);
  });
});
