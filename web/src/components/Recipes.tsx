import { useEffect, useMemo, useState } from "preact/hooks";
import {
  api,
  storageGet,
  storageSet,
  type AppConfigResponse,
  type BookRecipe,
  type Card,
  type DietId,
  type GoalId,
  type MealFilter,
  type MealType,
  type PlanDay,
} from "../api";
import { IconClock, IconRefresh, IconSearch, IconSliders } from "../icons";
import { OnHandBadge, RecipeImage } from "./CardFace";
import { ChipRow, toggleIn } from "./ChipRow";
import type { Action } from "./Deck";
import { DetailSheet } from "./DetailSheet";
import { PlanSheet, dayLabel } from "./PlanSheet";

type Sort = "name" | "newest" | "quickest" | "rating" | "onhand";

const SORTS: { id: Sort; label: string }[] = [
  { id: "name", label: "Name (A–Z)" },
  { id: "newest", label: "Newest" },
  { id: "quickest", label: "Quickest" },
  { id: "rating", label: "Top rated" },
  { id: "onhand", label: "Fewest missing" },
];

const SORT_KEY = "dishdeck.bookSort";

function loadSort(): Sort {
  const s = storageGet(SORT_KEY);
  return SORTS.some((o) => o.id === s) ? (s as Sort) : "name";
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const missingCount = (r: BookRecipe) => (r.onHand && r.onHand.total > 0 ? r.onHand.missing.length : Infinity);

function compare(sort: Sort): (a: BookRecipe, b: BookRecipe) => number {
  const byName = (a: BookRecipe, b: BookRecipe) => a.title.localeCompare(b.title);
  switch (sort) {
    case "newest":
      return (a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? "") || byName(a, b);
    case "quickest":
      return (a, b) => (a.totalMinutes ?? Infinity) - (b.totalMinutes ?? Infinity) || byName(a, b);
    case "rating":
      return (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byName(a, b);
    case "onhand":
      return (a, b) => missingCount(a) - missingCount(b) || byName(a, b);
    default:
      return byName;
  }
}

/** The recipe book: every saved Mealie recipe as a grid of cards, with search, filters and sorting. */
export function Recipes(props: {
  config: AppConfigResponse;
  days: PlanDay[] | null;
  today: string;
  refreshWeek: () => void;
  notify: (message: string, link?: string, error?: boolean) => void;
}) {
  const { config } = props;
  const [recipes, setRecipes] = useState<BookRecipe[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(loadSort);
  const [showFilters, setShowFilters] = useState(false);
  const [meal, setMeal] = useState<MealFilter | undefined>();
  const [dietary, setDietary] = useState<DietId[]>([]);
  const [goals, setGoals] = useState<GoalId[]>([]);
  const [tag, setTag] = useState<string | undefined>();
  const [readyOnly, setReadyOnly] = useState(false);

  const [detail, setDetail] = useState<Card | null>(null);
  const [planCard, setPlanCard] = useState<Card | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setRecipes((await api.recipes()).recipes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your recipes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    storageSet(SORT_KEY, sort);
  }, [sort]);

  // Categories and tags people actually use, most common first.
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of recipes ?? []) {
      for (const t of new Set([r.category, ...r.tags].filter((x): x is string => !!x))) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t).slice(0, 40);
  }, [recipes]);

  const hasOnHand = useMemo(() => (recipes ?? []).some((r) => r.onHand && r.onHand.total > 0), [recipes]);

  const shown = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    return (recipes ?? [])
      .filter((r) => {
        if (meal && !r.fits.meals.includes(meal)) return false;
        if (!dietary.every((d) => r.fits.diets.includes(d))) return false;
        if (!goals.every((g) => r.fits.goals.includes(g))) return false;
        if (tag && r.category !== tag && !r.tags.includes(tag)) return false;
        if (readyOnly && missingCount(r) !== 0) return false;
        if (words.length) {
          const hay = norm([r.title, r.description ?? "", r.category ?? "", ...r.tags, ...r.ingredients].join(" "));
          if (!words.every((w) => hay.includes(w))) return false;
        }
        return true;
      })
      .sort(compare(sort));
  }, [recipes, query, sort, meal, dietary, goals, tag, readyOnly]);

  const filterCount = (meal ? 1 : 0) + dietary.length + goals.length + (tag ? 1 : 0) + (readyOnly ? 1 : 0);
  const clearFilters = () => {
    setMeal(undefined);
    setDietary([]);
    setGoals([]);
    setTag(undefined);
    setReadyOnly(false);
    setQuery("");
  };

  const onAction = (card: Card, action: Action) => {
    setDetail(null);
    if (action === "plan") setPlanCard(card);
  };

  const pickSlot = async (date: string, entryType: MealType) => {
    if (!planCard) return;
    setSaving(true);
    try {
      const res = await api.save({ card: planCard, target: "plan", plan: { date, entryType } });
      const day = props.days?.find((d) => d.date === date);
      props.notify(`Added to ${day ? dayLabel(date, day.weekday, props.today) : date} ${entryType}`, res.recipeUrl);
      setPlanCard(null);
      props.refreshWeek();
    } catch (e) {
      props.notify(e instanceof Error ? e.message : "Couldn't add to the plan", undefined, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="book">
      <div class="book-toolbar">
        <label class="mood book-search">
          <IconSearch size={18} />
          <input
            type="text"
            inputMode="search"
            placeholder="Search recipes or ingredients"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            aria-label="Search recipes"
          />
          <button
            type="button"
            class={`filters-btn ${showFilters ? "on" : ""}`}
            aria-expanded={showFilters}
            aria-label="Filters"
            onClick={() => setShowFilters((v) => !v)}
          >
            <IconSliders size={18} />
            {filterCount > 0 && <span class="count">{filterCount}</span>}
          </button>
        </label>
      </div>

      {showFilters && (
        <div class="filters">
          {hasOnHand && (
            <label class="toggle">
              <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly((e.target as HTMLInputElement).checked)} />
              <span class="switch" />
              <span>Have everything on hand</span>
            </label>
          )}
          <div class="filter-label">Meal</div>
          <ChipRow>
            <button class={`pill ${!meal ? "on" : ""}`} onClick={() => setMeal(undefined)}>Any</button>
            {config.meals.map((m) => (
              <button key={m.id} class={`pill ${meal === m.id ? "on" : ""}`} onClick={() => setMeal(meal === m.id ? undefined : m.id)}>
                {m.label}
              </button>
            ))}
          </ChipRow>
          <div class="filter-label">Dietary &amp; allergies</div>
          <ChipRow>
            {config.dietary.map((d) => (
              <button
                key={d.id}
                class={`pill ${dietary.includes(d.id) ? "on" : ""}`}
                aria-pressed={dietary.includes(d.id)}
                onClick={() => setDietary((l) => toggleIn(l, d.id))}
              >
                {d.label}
              </button>
            ))}
          </ChipRow>
          <div class="filter-label">
            Nutrition <span class="filter-hint">from Mealie nutrition or tags</span>
          </div>
          <ChipRow>
            {config.goals.map((g) => (
              <button
                key={g.id}
                class={`pill ${goals.includes(g.id) ? "on" : ""}`}
                aria-pressed={goals.includes(g.id)}
                onClick={() => setGoals((l) => toggleIn(l, g.id))}
              >
                {g.label}
              </button>
            ))}
          </ChipRow>
          {tags.length > 0 && (
            <>
              <div class="filter-label">Category &amp; tags</div>
              <ChipRow>
                <button class={`pill ${!tag ? "on" : ""}`} onClick={() => setTag(undefined)}>Any</button>
                {tags.map((t) => (
                  <button key={t} class={`pill ${tag === t ? "on" : ""}`} onClick={() => setTag(tag === t ? undefined : t)}>
                    {t}
                  </button>
                ))}
              </ChipRow>
            </>
          )}
        </div>
      )}

      {recipes && (
        <div class="book-bar">
          <span class="book-count">
            {shown.length === recipes.length ? `${recipes.length} recipes` : `${shown.length} of ${recipes.length} recipes`}
          </span>
          {(filterCount > 0 || query) && (
            <button type="button" class="filter-clear" onClick={clearFilters}>Clear</button>
          )}
          <label class="book-sort">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)}>
              {SORTS.filter((s) => s.id !== "onhand" || hasOnHand).map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <button type="button" class="icon-btn" onClick={load} disabled={loading} aria-label="Reload recipes">
            <IconRefresh size={16} />
          </button>
        </div>
      )}

      {error && (
        <div class="empty">
          <p>{error}</p>
          <button class="btn" onClick={load}>Try again</button>
        </div>
      )}

      {!error && !recipes && (
        <div class="empty">
          <div class="spinner" />
          <p>Opening the recipe book…</p>
        </div>
      )}

      {recipes && shown.length === 0 && (
        <div class="empty">
          <p>{recipes.length ? "No recipes match these filters." : "No saved recipes yet. Save some from Discover."}</p>
          {recipes.length > 0 && <button class="btn" onClick={clearFilters}>Clear filters</button>}
        </div>
      )}

      {shown.length > 0 && (
        <div class="book-grid">
          {shown.map((r) => (
            <div key={r.key} class="book-item">
              <button type="button" class="book-card" onClick={() => setDetail(r)}>
                <div class="book-card-image">
                  <RecipeImage card={r} />
                  {r.rating ? <span class="book-rating" aria-label={`Rated ${r.rating} of 5`}>★ {r.rating}</span> : null}
                </div>
                <div class="book-card-text">
                  <h3>{r.title}</h3>
                  <div class="chips">
                    {r.totalMinutes ? (
                      <span class="chip">
                        <IconClock size={12} /> {r.totalMinutes} min
                      </span>
                    ) : null}
                    {r.category && <span class="chip">{r.category}</span>}
                    <OnHandBadge card={r} />
                  </div>
                </div>
              </button>
            </div>
          ))}
        </div>
      )}

      <DetailSheet card={detail} onClose={() => setDetail(null)} onAction={onAction} hideSkip />
      <PlanSheet card={planCard} days={props.days} today={props.today} busy={saving} onPick={pickSlot} onClose={() => setPlanCard(null)} />
    </div>
  );
}
