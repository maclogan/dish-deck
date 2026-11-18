import { ChipRow, toggleIn } from "./ChipRow";
import { useEffect, useRef, useState } from "preact/hooks";
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
  const [cuisine, setCuisine] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [meal, setMeal] = useState<MealFilter | undefined>();
  const [dietary, setDietary] = useState<DietId[]>(initial.dietary);
  const [goals, setGoals] = useState<GoalId[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  // TheMealDB has no nutrition data: on "New ideas", goals only work with AI.
  const goalsAvailable = source === "saved" || props.aiOn;
  const activeGoals = goalsAvailable ? goals : [];

  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
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

  const deal = async (append: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(undefined);
    if (!append) setExhausted(false);
    try {
      const current = append ? cards : [];
      const res = await api.deck({
        source,
        mood: mood.trim() || undefined,
        ai: props.aiOn,
        cuisine,
        category,
        meal,
        dietary,
        goals: activeGoals,
        onHand,
        leniency,
        count: 8,
        exclude: [...seen.current, ...current.map((c) => c.key)],
      });
      if (id !== requestId.current) return;
      const keys = new Set(current.map((c) => c.key));
      const fresh = res.cards.filter((c) => !keys.has(c.key));
      setCards([...current, ...fresh]);
      setNote(res.note);
      if (fresh.length === 0) setExhausted(true);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : "Couldn't load ideas");
      if (!append) setCards([]);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  // "Our recipes" is the recipe book grid; let the page widen to fit more cards.
  useEffect(() => {
    props.onWide?.(source === "saved");
  }, [source]);

  // First deal, and re-deal when the filters change. "Our recipes" shows the grid instead of a deck.
  useEffect(() => {
    if (source === "saved") return;
    deal(false);
  }, [source, cuisine, category, meal, dietary.join(), goals.join(), onHand, leniency]);

  // Flipping the AI toggle only changes "New ideas" results for a typed search or nutrition goals.
  const aiFirstRun = useRef(true);
  useEffect(() => {
    if (aiFirstRun.current) {
      aiFirstRun.current = false;
      return;
    }
    if (source === "new" && (mood.trim() || goals.length)) deal(false);
  }, [props.aiOn]);

  // Keep the deck topped up.
  useEffect(() => {
    if (source === "new" && cards.length <= 2 && cards.length > 0 && !loading && !exhausted) deal(true);
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
    deal(false);
  };

  const filterCount =
    (cuisine ? 1 : 0) + (category ? 1 : 0) + (onHand ? 1 : 0) + (meal ? 1 : 0) + dietary.length + activeGoals.length;
  const willUseAi = props.aiOn && source === "new" && (mood.trim().length > 0 || activeGoals.length > 0);
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
              <div class="filter-label">Meal</div>
              <ChipRow>
                <button class={`pill ${!meal ? "on" : ""}`} onClick={() => setMeal(undefined)}>Any</button>
                {config.meals.map((m) => (
                  <button key={m.id} class={`pill ${meal === m.id ? "on" : ""}`} onClick={() => setMeal(meal === m.id ? undefined : m.id)}>
                    {m.label}
                  </button>
                ))}
              </ChipRow>
              <div class="filter-label">
                Dietary &amp; allergies
                {dietary.length > 0 && (
                  <button type="button" class="filter-clear" onClick={() => setDietary([])}>Clear</button>
                )}
              </div>
              <ChipRow>
                {config.dietary.map((d) => (
                  <button
                    key={d.id}
                    class={`pill ${dietary.includes(d.id) ? "on" : ""}`}
                    aria-pressed={dietary.includes(d.id)}
                    onClick={() => setDietary((list) => toggleIn(list, d.id))}
                  >
                    {d.label}
                  </button>
                ))}
              </ChipRow>
              <div class="filter-label">
                Nutrition
                {!goalsAvailable && <span class="filter-hint">Needs AI ideas</span>}
                {goalsAvailable && goals.length > 0 && (
                  <button type="button" class="filter-clear" onClick={() => setGoals([])}>Clear</button>
                )}
              </div>
              <ChipRow>
                {config.goals.map((g) => (
                  <button
                    key={g.id}
                    class={`pill ${activeGoals.includes(g.id) ? "on" : ""}`}
                    aria-pressed={activeGoals.includes(g.id)}
                    disabled={!goalsAvailable}
                    onClick={() => setGoals((list) => toggleIn(list, g.id))}
                  >
                    {g.label}
                  </button>
                ))}
              </ChipRow>
              {config.cuisines.length > 0 && (
                <>
                  <div class="filter-label">Cuisine</div>
                  <ChipRow>
                    <button class={`pill ${!cuisine ? "on" : ""}`} onClick={() => setCuisine(undefined)}>Any</button>
                    {config.cuisines.map((c) => (
                      <button key={c} class={`pill ${cuisine === c ? "on" : ""}`} onClick={() => setCuisine(cuisine === c ? undefined : c)}>
                        {c}
                      </button>
                    ))}
                  </ChipRow>
                </>
              )}
              {types.length > 0 && (
                <>
                  <div class="filter-label">Type</div>
                  <ChipRow>
                    <button class={`pill ${!category ? "on" : ""}`} onClick={() => setCategory(undefined)}>Any</button>
                    {types.map((c) => (
                      <button key={c} class={`pill ${category === c ? "on" : ""}`} onClick={() => setCategory(category === c ? undefined : c)}>
                        {c}
                      </button>
                    ))}
                  </ChipRow>
                </>
              )}
            </div>
          )}

          {note && !error && <p class="note">{note}</p>}
          {error && (
            <div class="empty">
              <p>{error}</p>
              <button class="btn" onClick={() => deal(false)}>Try again</button>
            </div>
          )}

          {!error && cards.length > 0 && <Deck cards={cards} saved={false} onDecide={decide} onOpen={setDetailCard} />}

          {!error && cards.length === 0 && (
            <div class="empty">
              {loading ? (
                <>
                  <div class="spinner" />
                  <p>{willUseAi ? "Cooking up ideas…" : "Shuffling the deck…"}</p>
                </>
              ) : (
                <>
                  <p>{exhausted ? "That's every idea for these filters." : "No cards yet."}</p>
                  <button class="btn" onClick={() => deal(false)}>
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
