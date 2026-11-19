import { MultiPills } from "./ChipRow";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  api,
  storageGet,
  storageSet,
  type AppConfigResponse,
  type Card,
  type DietId,
  type GoalId,
  type MealFilter,
  type MealType,
  type PlanDay,
} from "../api";
import { IconRefresh, IconSearch, IconSliders, IconSparkle } from "../icons";
import { Deck, type Action } from "./Deck";
import { DetailSheet } from "./DetailSheet";
import { PlanSheet, dayLabel } from "./PlanSheet";
import { Recipes } from "./Recipes";

type Source = "new" | "saved";

interface Prefs {
  source: Source;
  onHand: boolean;
  leniency: number;
  /** Dietary restrictions and allergies stick around between visits. */
  dietary: DietId[];
}

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(storageGet("dishdeck.prefs") ?? "{}");
    return {
      source: p.source === "saved" ? "saved" : "new",
      onHand: !!p.onHand,
      leniency: Number.isFinite(p.leniency) ? p.leniency : 2,
      dietary: Array.isArray(p.dietary) ? p.dietary.filter((d: unknown) => typeof d === "string") : [],
    };
  } catch {
    return { source: "new", onHand: false, leniency: 2, dietary: [] };
  }
}

const COVERED_CATEGORIES = new Set(["breakfast", "dessert", "starter", "side", "vegan", "vegetarian"]);

/** The filters a deal uses. Edits in the open filter panel only take effect once it's closed. */
interface Filters {
  cuisines: string[];
  categories: string[];
  meals: MealFilter[];
  dietary: DietId[];
  goals: GoalId[];
  onHand: boolean;
  leniency: number;
}

/**
 * replace: a fresh deck (filters changed, a new search). keepTop: keep the card on top and refill the
 * rest (the AI toggle flipped). append: top up the deck as it runs low.
 */
type DealMode = "replace" | "keepTop" | "append";


export function Discover(props: {
  config: AppConfigResponse;
  /** AI is configured on the server and the header toggle is on. */
  aiOn: boolean;
  days: PlanDay[] | null;
  today: string;
  refreshWeek: () => void;
  notify: (message: string, link?: string, error?: boolean) => void;
  /** Told when the recipe book grid is showing, so the page can use a wider layout. */
  onWide?: (wide: boolean) => void;
}) {
  const { config } = props;
  const initial = loadPrefs();
  const [source, setSource] = useState<Source>(initial.source);
  const [onHand, setOnHand] = useState(initial.onHand);
  const [leniency, setLeniency] = useState(initial.leniency);
  const [mood, setMood] = useState("");
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [meals, setMeals] = useState<MealFilter[]>([]);
  const [dietary, setDietary] = useState<DietId[]>(initial.dietary);
  const [goals, setGoals] = useState<GoalId[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  // TheMealDB has no nutrition data: on "New ideas", goals only work with AI.
  const goalsAvailable = source === "saved" || props.aiOn;
  const activeGoals = goalsAvailable ? goals : [];

  const [cards, setCards] = useState<Card[]>([]);
  /** What's loading right now, if anything. */
  const [busy, setBusy] = useState<DealMode | null>(null);
  const loading = busy !== null;
  const [note, setNote] = useState<string | undefined>();
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const seen = useRef(new Set<string>());

  const [planCard, setPlanCard] = useState<Card | null>(null);
  const [detailCard, setDetailCard] = useState<Card | null>(null);
  const [saving, setSaving] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    storageSet("dishdeck.prefs", JSON.stringify({ source, onHand, leniency, dietary }));
  }, [source, onHand, leniency, dietary.join()]);

  // The panel edits these (the "draft"); deals use `applied`, which catches up when the panel closes.
  const draft: Filters = useMemo(
    () => ({ cuisines, categories, meals, dietary, goals, onHand, leniency }),
    [cuisines.join(), categories.join(), meals.join(), dietary.join(), goals.join(), onHand, leniency],
  );
  const draftKey = JSON.stringify(draft);
  const [applied, setApplied] = useState<Filters>(draft);
  const appliedKey = JSON.stringify(applied);
  const pendingChanges = draftKey !== appliedKey;
  useEffect(() => {
    if (!showFilters && pendingChanges) setApplied(draft);
  }, [showFilters, draftKey]);

  // Read the latest state inside async deals.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const deal = async (mode: DealMode) => {
    const id = ++requestId.current;
    const f = applied;
    // keepTop: the top card stays, and the rest (from the old source) go straight away.
    const keep = mode === "append" ? cardsRef.current : mode === "keepTop" ? cardsRef.current.slice(0, 1) : [];
    if (mode === "keepTop") setCards(keep);
    setBusy(mode);
    setError(undefined);
    if (mode !== "append") setExhausted(false);
    try {
      const res = await api.deck({
        source,
        mood: mood.trim() || undefined,
        ai: props.aiOn,
        cuisines: f.cuisines,
        categories: f.categories,
        meals: f.meals,
        dietary: f.dietary,
        // Goals stay picked while AI is off; they just can't be checked without it.
        goals: goalsAvailable ? f.goals : [],
        onHand: f.onHand,
        leniency: f.leniency,
        count: 8,
        exclude: [...seen.current, ...keep.map((c) => c.key)],
      });
      if (id !== requestId.current) return;
      // Whatever is in the deck now (cards swiped while this loaded are already gone).
      const current = mode === "replace" ? [] : cardsRef.current;
      const keys = new Set(current.map((c) => c.key));
      const fresh = res.cards.filter((c) => !keys.has(c.key) && !seen.current.has(c.key));
      setCards([...current, ...fresh]);
      setNote(res.note);
      if (fresh.length === 0) setExhausted(true);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : "Couldn't load ideas");
      if (mode === "replace") setCards([]);
    } finally {
      if (id === requestId.current) setBusy(null);
    }
  };

  // "Our recipes" is the recipe book grid; let the page widen to fit more cards.
  useEffect(() => {
    props.onWide?.(source === "saved");
  }, [source]);

  // First deal; a fresh deck when the applied filters change; and when the AI toggle flips, keep the
  // current card and refill the rest from the other source. "Our recipes" shows the grid instead.
  const lastDeal = useRef<{ source: Source; aiOn: boolean } | null>(null);
  useEffect(() => {
    const prev = lastDeal.current;
    lastDeal.current = { source, aiOn: props.aiOn };
    if (source === "saved") return;
    const aiFlipped = !!prev && prev.source === source && prev.aiOn !== props.aiOn;
    deal(aiFlipped && cardsRef.current.length > 0 ? "keepTop" : "replace");
  }, [source, appliedKey, props.aiOn]);

  // Keep the deck topped up.
  useEffect(() => {
    if (source === "new" && cards.length <= 2 && cards.length > 0 && !loading && !exhausted && !error) deal("append");
  }, [cards.length, loading, exhausted]);

  const removeCard = (card: Card) => {
    seen.current.add(card.key);
    setCards((cs) => cs.filter((c) => c.key !== card.key));
  };
  const putBack = (card: Card) => {
    seen.current.delete(card.key);
    setCards((cs) => (cs.some((c) => c.key === card.key) ? cs : [card, ...cs]));
  };

  const decide = async (card: Card, action: Action) => {
    setDetailCard(null);
    removeCard(card);
    if (action === "skip") return;
    if (action === "plan") {
      setPlanCard(card);
      return;
    }
    try {
      const res = await api.save({ card, target: "book" });
      props.notify(res.alreadyInBook ? `"${card.title}" is already in your recipes` : `Saved "${card.title}" to recipes`, res.recipeUrl);
    } catch (e) {
      putBack(card);
      props.notify(e instanceof Error ? e.message : "Couldn't save", undefined, true);
    }
  };

  const pickSlot = async (date: string, entryType: MealType) => {
    if (!planCard) return;
    const card = planCard;
    setSaving(true);
    try {
      const res = await api.save({ card, target: "plan", plan: { date, entryType } });
      const day = props.days?.find((d) => d.date === date);
      const when = day ? dayLabel(date, day.weekday, props.today) : date;
      props.notify(`Added to ${when} ${entryType}${res.alreadyInBook ? "" : " and saved to recipes"}`, res.recipeUrl);
      setPlanCard(null);
      props.refreshWeek();
    } catch (e) {
      props.notify(e instanceof Error ? e.message : "Couldn't add to the plan", undefined, true);
    } finally {
      setSaving(false);
    }
  };

  const closePlan = () => {
    if (planCard) putBack(planCard);
    setPlanCard(null);
  };

  const submitMood = (e: Event) => {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur();
    setShowFilters(false);
    // Closing the panel with unapplied changes deals on its own (with this search).
    if (!(showFilters && pendingChanges)) deal("replace");
  };

  const filterCount =
    cuisines.length + categories.length + (onHand ? 1 : 0) + meals.length + dietary.length + activeGoals.length;
  const willUseAi = props.aiOn && source === "new";
  const loadingText = willUseAi ? "Cooking up AI ideas…" : "Shuffling the deck…";
  // These TheMealDB categories are covered by the Meal and Dietary filters.
  const types = config.categories.filter((c) => !COVERED_CATEGORIES.has(c.toLowerCase()));

  return (
    <div class="discover">
      <div class="segmented" role="tablist">
        <button role="tab" aria-selected={source === "new"} class={source === "new" ? "on" : ""} onClick={() => setSource("new")}>
          New ideas
        </button>
        <button role="tab" aria-selected={source === "saved"} class={source === "saved" ? "on" : ""} onClick={() => setSource("saved")}>
          Our recipes
        </button>
      </div>

      {source === "saved" ? (
        <Recipes config={config} days={props.days} today={props.today} refreshWeek={props.refreshWeek} notify={props.notify} />
      ) : (
        <>
          <form class="mood" onSubmit={submitMood}>
            <IconSearch size={18} />
            <input
              type="text"
              inputMode="search"
              enterKeyHint="go"
              placeholder={
                source === "new"
                  ? props.aiOn
                    ? "What sounds good? e.g. cozy soup, spicy"
                    : "What sounds good? e.g. salmon, curry"
                  : "Search our recipes"
              }
              value={mood}
              onInput={(e) => setMood((e.target as HTMLInputElement).value)}
              aria-label="What sounds good?"
            />
            <button type="submit" class={`go ${willUseAi ? "ai" : ""}`} aria-label="Find ideas">
              {willUseAi ? <IconSparkle size={18} /> : <IconRefresh size={18} />}
            </button>
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
          </form>

          {showFilters && (
            <div class="filters">
              <label class="toggle">
                <input type="checkbox" checked={onHand} onChange={(e) => setOnHand((e.target as HTMLInputElement).checked)} />
                <span class="switch" />
                <span>Use what's on hand</span>
              </label>
              {onHand && (
                <div class="stepper" aria-label="Missing ingredients allowed">
                  <span>Up to</span>
                  <button type="button" onClick={() => setLeniency((n) => Math.max(0, n - 1))} aria-label="Fewer">−</button>
                  <strong>{leniency}</strong>
                  <button type="button" onClick={() => setLeniency((n) => Math.min(10, n + 1))} aria-label="More">+</button>
                  <span>missing</span>
                </div>
              )}
              <div class="filter-label">
                Meal <span class="filter-hint">pick any</span>
              </div>
              <MultiPills options={config.meals} selected={meals} onChange={setMeals} />
              <div class="filter-label">
                Dietary &amp; allergies <span class="filter-hint">must meet all</span>
              </div>
              <MultiPills options={config.dietary} selected={dietary} onChange={setDietary} anyLabel="None" />
              <div class="filter-label">
                Nutrition <span class="filter-hint">{goalsAvailable ? "pick any" : "Needs AI ideas"}</span>
              </div>
              <MultiPills options={config.goals} selected={goals} onChange={setGoals} disabled={!goalsAvailable} />
              {config.cuisines.length > 0 && (
                <>
                  <div class="filter-label">
                    Cuisine <span class="filter-hint">pick any</span>
                  </div>
                  <MultiPills options={config.cuisines} selected={cuisines} onChange={setCuisines} limit={15} />
                </>
              )}
              {types.length > 0 && (
                <>
                  <div class="filter-label">
                    Type <span class="filter-hint">pick any</span>
                  </div>
                  <MultiPills options={types} selected={categories} onChange={setCategories} limit={15} />
                </>
              )}
              <button type="button" class="btn primary wide filters-done" onClick={() => setShowFilters(false)}>
                {pendingChanges ? "Apply filters" : "Done"}
              </button>
            </div>
          )}

          {busy === "keepTop" ? (
            <p class="note loading-note" role="status">
              <span class="spinner small" /> {willUseAi ? "Switching to AI ideas…" : "Switching to TheMealDB ideas…"}
            </p>
          ) : (
            note && !error && busy !== "replace" && <p class="note">{note}</p>
          )}
          {error && (
            <div class="empty">
              <p>{error}</p>
              <button class="btn" onClick={() => deal("replace")}>Try again</button>
            </div>
          )}

          {!error && cards.length > 0 && (
            // A fresh deck is on its way: dim the old one so it's clear it's about to change.
            <div class={`deck-holder ${busy === "replace" ? "refreshing" : ""}`} aria-busy={busy === "replace"}>
              <Deck cards={cards} saved={false} onDecide={decide} onOpen={setDetailCard} />
              {busy === "replace" && (
                <div class="deck-loading">
                  <div class="deck-loading-pill">
                    <div class="spinner" />
                    <span>{loadingText}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!error && cards.length === 0 && (
            <div class="empty">
              {loading ? (
                <>
                  <div class="spinner" />
                  <p>{loadingText}</p>
                </>
              ) : (
                <>
                  <p>{exhausted ? "That's every idea for these filters." : "No cards yet."}</p>
                  <button class="btn" onClick={() => deal("replace")}>
                    <IconRefresh size={18} /> Deal again
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      <PlanSheet card={planCard} days={props.days} today={props.today} busy={saving} onPick={pickSlot} onClose={closePlan} />
      <DetailSheet card={detailCard} onClose={() => setDetailCard(null)} onAction={decide} />
    </div>
  );
}
