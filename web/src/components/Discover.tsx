import { useEffect, useRef, useState } from "preact/hooks";
import { api, storageGet, storageSet, type AppConfigResponse, type Card, type MealType, type PlanDay } from "../api";
import { IconRefresh, IconSearch, IconSliders, IconSparkle } from "../icons";
import { Deck, type Action } from "./Deck";
import { DetailSheet } from "./DetailSheet";
import { PlanSheet, dayLabel } from "./PlanSheet";

type Source = "new" | "saved";

interface Prefs {
  source: Source;
  onHand: boolean;
  leniency: number;
}

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(storageGet("dishdeck.prefs") ?? "{}");
    return { source: p.source === "saved" ? "saved" : "new", onHand: !!p.onHand, leniency: Number.isFinite(p.leniency) ? p.leniency : 2 };
  } catch {
    return { source: "new", onHand: false, leniency: 2 };
  }
}

export function Discover(props: {
  config: AppConfigResponse;
  days: PlanDay[] | null;
  today: string;
  refreshWeek: () => void;
  notify: (message: string, link?: string, error?: boolean) => void;
}) {
  const { config } = props;
  const initial = loadPrefs();
  const [source, setSource] = useState<Source>(initial.source);
  const [onHand, setOnHand] = useState(initial.onHand);
  const [leniency, setLeniency] = useState(initial.leniency);
  const [mood, setMood] = useState("");
  const [cuisine, setCuisine] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [showFilters, setShowFilters] = useState(false);

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
    storageSet("dishdeck.prefs", JSON.stringify({ source, onHand, leniency }));
  }, [source, onHand, leniency]);

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
        cuisine,
        category,
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

  // First deal, and re-deal when the deck source or filters change.
  useEffect(() => {
    deal(false);
  }, [source, cuisine, category, onHand, leniency]);

  // Keep the deck topped up.
  useEffect(() => {
    if (cards.length <= 2 && cards.length > 0 && !loading && !exhausted) deal(true);
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

  const filterCount = (cuisine ? 1 : 0) + (category ? 1 : 0) + (onHand ? 1 : 0);
  const willUseAi = config.aiEnabled && source === "new" && mood.trim().length > 0;

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

      <form class="mood" onSubmit={submitMood}>
        <IconSearch size={18} />
        <input
          type="text"
          inputMode="search"
          enterKeyHint="go"
          placeholder={
            source === "new"
              ? config.aiEnabled
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
          {config.cuisines.length > 0 && (
            <>
              <div class="filter-label">Cuisine</div>
              <div class="chip-row">
                <button class={`pill ${!cuisine ? "on" : ""}`} onClick={() => setCuisine(undefined)}>Any</button>
                {config.cuisines.map((c) => (
                  <button key={c} class={`pill ${cuisine === c ? "on" : ""}`} onClick={() => setCuisine(cuisine === c ? undefined : c)}>
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}
          {config.categories.length > 0 && (
            <>
              <div class="filter-label">Type</div>
              <div class="chip-row">
                <button class={`pill ${!category ? "on" : ""}`} onClick={() => setCategory(undefined)}>Any</button>
                {config.categories.map((c) => (
                  <button key={c} class={`pill ${category === c ? "on" : ""}`} onClick={() => setCategory(category === c ? undefined : c)}>
                    {c}
                  </button>
                ))}
              </div>
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

      {!error && cards.length > 0 && (
        <Deck cards={cards} saved={source === "saved"} onDecide={decide} onOpen={setDetailCard} />
      )}

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

      <PlanSheet card={planCard} days={props.days} today={props.today} busy={saving} onPick={pickSlot} onClose={closePlan} />
      <DetailSheet card={detailCard} onClose={() => setDetailCard(null)} onAction={decide} />
    </div>
  );
}
