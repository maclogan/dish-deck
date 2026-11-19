// Small persistent store (one SQLite file in DATA_DIR) for things worth keeping between restarts:
// recipe-site indexes, parsed recipes, AI dish-name lists, dish -> recipe page matches, the
// household's seen/skipped history, and photo lookups. Uses Node's built-in SQLite (no extra service).

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type HistoryAction = "skip" | "book" | "plan";

export interface IndexedPage {
  url: string;
  domain: string;
  /** Dish name worked out from the page address (or the recipe title once read). */
  name: string;
  lastmod?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sites (
  domain TEXT PRIMARY KEY,
  indexed_at INTEGER NOT NULL,
  pages INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE TABLE IF NOT EXISTS pages (
  url TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  lastmod TEXT
);
CREATE INDEX IF NOT EXISTS pages_domain ON pages(domain);
CREATE TABLE IF NOT EXISTS recipes (
  url TEXT PRIMARY KEY,
  json TEXT,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pools (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  dish TEXT PRIMARY KEY,
  url TEXT,
  checked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
  key TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  title TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  key TEXT PRIMARY KEY,
  json TEXT,
  at INTEGER NOT NULL
);
`;

/** How long each kind of history entry keeps a recipe out of the deck. */
const HISTORY_TTL: Record<HistoryAction, number> = {
  skip: 365 * 86400_000,
  // Saved recipes are excluded through the recipe book anyway; this covers renamed ones.
  book: 365 * 86400_000,
  plan: 365 * 86400_000,
};

export class Store {
  readonly db: DatabaseSync;

  /** `file` is a path, or ":memory:" (tests, or when no DATA_DIR is writable). */
  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  /** Open DATA_DIR/dishdeck.db, falling back to memory (with a warning) if the folder isn't writable. */
  static open(dataDir: string | undefined, warn: (msg: string) => void): Store {
    if (!dataDir) {
      warn("DATA_DIR isn't set: caches and history last only until the app restarts");
      return new Store(":memory:");
    }
    try {
      return new Store(path.join(dataDir, "dishdeck.db"));
    } catch (err) {
      warn(`Couldn't open ${dataDir}/dishdeck.db (${err instanceof Error ? err.message : err}); using memory instead`);
      return new Store(":memory:");
    }
  }

  // ------------------------------------------------------------------ generic JSON cache helpers

  private getJson<T>(table: "recipes" | "pools" | "photos", keyCol: string, key: string, maxAge: number): { value: T | null } | undefined {
    const timeCol = table === "recipes" ? "fetched_at" : table === "pools" ? "created_at" : "at";
    const row = this.db.prepare(`SELECT json, ${timeCol} AS t FROM ${table} WHERE ${keyCol} = ?`).get(key) as
      | { json: string | null; t: number }
      | undefined;
    if (!row || Date.now() - row.t > maxAge) return undefined;
    return { value: row.json === null ? null : (JSON.parse(row.json) as T) };
  }

  // ------------------------------------------------------------------ photos

  getPhoto<T>(key: string, hitTtl: number, missTtl: number): { value: T | null } | undefined {
    const hit = this.getJson<T>("photos", "key", key, hitTtl);
    if (hit && hit.value === null) return this.getJson<T>("photos", "key", key, missTtl);
    return hit;
  }

  putPhoto(key: string, value: unknown | null) {
    this.db.prepare("INSERT OR REPLACE INTO photos (key, json, at) VALUES (?, ?, ?)").run(key, value === null ? null : JSON.stringify(value), Date.now());
  }

  // ------------------------------------------------------------------ recipes (parsed pages)

  /** A parsed recipe for this page; `value: null` means the page had none (remembered for a while). */
  getRecipe<T>(url: string, maxAge: number, missAge: number): { value: T | null } | undefined {
    const hit = this.getJson<T>("recipes", "url", url, maxAge);
    if (hit && hit.value === null) return this.getJson<T>("recipes", "url", url, missAge);
    return hit;
  }

  putRecipe(url: string, value: unknown | null) {
    this.db
      .prepare("INSERT OR REPLACE INTO recipes (url, json, fetched_at) VALUES (?, ?, ?)")
      .run(url, value === null ? null : JSON.stringify(value), Date.now());
  }

  // ------------------------------------------------------------------ dish-name pools

  getPool<T>(key: string, maxAge: number): T | undefined {
    return this.getJson<T>("pools", "key", key, maxAge)?.value ?? undefined;
  }

  putPool(key: string, value: unknown) {
    this.db.prepare("INSERT OR REPLACE INTO pools (key, json, created_at) VALUES (?, ?, ?)").run(key, JSON.stringify(value), Date.now());
  }

  // ------------------------------------------------------------------ dish -> recipe page

  /** undefined: never checked (or too long ago). null: checked, no page found. */
  getMatch(dish: string, hitTtl: number, missTtl: number): string | null | undefined {
    const row = this.db.prepare("SELECT url, checked_at FROM matches WHERE dish = ?").get(dish) as
      | { url: string | null; checked_at: number }
      | undefined;
    if (!row) return undefined;
    const age = Date.now() - row.checked_at;
    if (row.url ? age > hitTtl : age > missTtl) return undefined;
    return row.url;
  }

  putMatch(dish: string, url: string | null) {
    this.db.prepare("INSERT OR REPLACE INTO matches (dish, url, checked_at) VALUES (?, ?, ?)").run(dish, url, Date.now());
  }

  // ------------------------------------------------------------------ site indexes

  siteIndexedAt(domain: string): number | undefined {
    const row = this.db.prepare("SELECT indexed_at FROM sites WHERE domain = ?").get(domain) as { indexed_at: number } | undefined;
    return row?.indexed_at;
  }

  /** Replace a site's page list in one transaction. */
  replacePages(domain: string, pages: IndexedPage[], error?: string) {
    this.db.exec("BEGIN");
    try {
      if (pages.length || !error) {
        this.db.prepare("DELETE FROM pages WHERE domain = ?").run(domain);
        const ins = this.db.prepare("INSERT OR REPLACE INTO pages (url, domain, name, lastmod) VALUES (?, ?, ?, ?)");
        for (const p of pages) ins.run(p.url, domain, p.name, p.lastmod ?? null);
      }
      this.db
        .prepare("INSERT OR REPLACE INTO sites (domain, indexed_at, pages, error) VALUES (?, ?, ?, ?)")
        .run(domain, Date.now(), pages.length, error ?? null);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  pagesFor(domain: string): IndexedPage[] {
    return (this.db.prepare("SELECT url, domain, name, lastmod FROM pages WHERE domain = ?").all(domain) as unknown as {
      url: string;
      domain: string;
      name: string;
      lastmod: string | null;
    }[]).map((r) => ({ url: r.url, domain: r.domain, name: r.name, lastmod: r.lastmod ?? undefined }));
  }

  /** Once a page has been read, its real recipe title is a better name than the address slug. */
  renamePage(url: string, name: string) {
    this.db.prepare("UPDATE pages SET name = ? WHERE url = ?").run(name, url);
  }

  // ------------------------------------------------------------------ household history

  record(key: string, action: HistoryAction, title?: string) {
    this.db.prepare("INSERT OR REPLACE INTO history (key, action, title, at) VALUES (?, ?, ?, ?)").run(key, action, title ?? null, Date.now());
  }

  forget(key: string) {
    this.db.prepare("DELETE FROM history WHERE key = ?").run(key);
  }

  /** Card keys that should stay out of the deck right now. */
  excludedKeys(): Set<string> {
    const rows = this.db.prepare("SELECT key, action, at FROM history").all() as unknown as { key: string; action: HistoryAction; at: number }[];
    const now = Date.now();
    return new Set(rows.filter((r) => now - r.at < (HISTORY_TTL[r.action] ?? 0)).map((r) => r.key));
  }
}
