import { useEffect, useState } from "preact/hooks";
import type { DiningFeature, DiningFilters, DiningSort, PriceLevel, ServiceOption } from "../../api";
import { ChipRow, MultiPills } from "../ChipRow";
import { Sheet } from "../Sheet";
import { DEFAULT_FILTERS } from "./state";

const RATINGS = [0, 3.5, 4, 4.5];
const PRICES: { id: string; label: string }[] = [1, 2, 3, 4].map((p) => ({ id: String(p), label: "$".repeat(p) }));
const SERVICE: { id: ServiceOption; label: string }[] = [
  { id: "dineIn", label: "Dine-in" },
  { id: "takeout", label: "Takeout" },
  { id: "delivery", label: "Delivery" },
];
const FEATURES: { id: DiningFeature; label: string }[] = [
  { id: "outdoor", label: "Outdoor seating" },
  { id: "groups", label: "Good for groups" },
  { id: "kids", label: "Kid-friendly" },
  { id: "vegetarian", label: "Vegetarian options" },
  { id: "reservations", label: "Takes reservations" },
];
export const SORTS: { id: DiningSort; label: string }[] = [
  { id: "best", label: "Best match" },
  { id: "distance", label: "Nearest" },
  { id: "rating", label: "Top rated" },
  { id: "gems", label: "Hidden gems" },
];

export function FilterSheet(props: {
  open: boolean;
  filters: DiningFilters;
  sort: DiningSort;
  radius: number;
  maxRadius: number;
  cuisines: { id: string; label: string }[];
  aiOn: boolean;
  onApply: (f: DiningFilters, sort: DiningSort, radius: number) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState(props.filters);
  const [sort, setSort] = useState(props.sort);
  const [radius, setRadius] = useState(props.radius);
  useEffect(() => {
    if (props.open) {
      setF(props.filters);
      setSort(props.sort);
      setRadius(props.radius);
    }
  }, [props.open]);
  const set = <K extends keyof DiningFilters>(k: K, v: DiningFilters[K]) => setF((x) => ({ ...x, [k]: v }));
  const radii = [0.5, 1, 3, 5, 10, props.maxRadius];

  return (
    <Sheet open={props.open} title="Filters" onClose={props.onClose}>
      <div class="filters flat">
        <div class="filter-label">Sort</div>
        <ChipRow>
          {SORTS.map((s) => (
            <button key={s.id} type="button" class={`pill ${sort === s.id ? "on" : ""}`} aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
              {s.label}
            </button>
          ))}
        </ChipRow>
        {sort === "best" && !props.aiOn && <p class="filter-note">With AI off, “Best match” is Google’s own order.</p>}

        <div class="filter-label">Distance</div>
        <ChipRow>
          {radii.map((r) => (
            <button key={r} type="button" class={`pill ${Math.abs(radius - r) < 0.01 ? "on" : ""}`} onClick={() => setRadius(r)}>
              {r} mi
            </button>
          ))}
        </ChipRow>

        <label class="toggle">
          <input type="checkbox" checked={f.openAtTime} onChange={(e) => set("openAtTime", (e.target as HTMLInputElement).checked)} />
          <span class="switch" />
          <span>Open at the time I picked</span>
        </label>

        <div class="filter-label">Rating</div>
        <ChipRow>
          {RATINGS.map((r) => (
            <button key={r} type="button" class={`pill ${(f.minRating ?? 0) === r ? "on" : ""}`} onClick={() => set("minRating", r || undefined)}>
              {r ? `${r}+ ★` : "Any"}
            </button>
          ))}
        </ChipRow>

        <div class="filter-label">
          Price <span class="filter-hint">pick any</span>
        </div>
        <MultiPills
          options={PRICES}
          selected={f.prices.map(String)}
          onChange={(v) => set("prices", v.map(Number) as PriceLevel[])}
        />

        <div class="filter-label">Chains</div>
        <ChipRow>
          {(["any", "independent", "chain"] as const).map((c) => (
            <button key={c} type="button" class={`pill ${f.chain === c ? "on" : ""}`} onClick={() => set("chain", c)}>
              {c === "any" ? "Any" : c === "independent" ? "Independent only" : "Chains only"}
            </button>
          ))}
        </ChipRow>

        <div class="filter-label">
          Cuisine <span class="filter-hint">pick any</span>
        </div>
        <MultiPills options={props.cuisines} selected={f.cuisines} onChange={(v) => set("cuisines", v)} limit={12} />

        <div class="filter-label">
          Service <span class="filter-hint">must have all</span>
        </div>
        <MultiPills options={SERVICE} selected={f.service} onChange={(v) => set("service", v)} anyLabel={false} />

        <div class="filter-label">
          Features <span class="filter-hint">must have all</span>
        </div>
        <MultiPills options={FEATURES} selected={f.features} onChange={(v) => set("features", v)} anyLabel={false} />

        <div class="filter-actions">
          <button type="button" class="btn ghost" onClick={() => { setF(DEFAULT_FILTERS); setSort("best"); }}>Reset</button>
          <button type="button" class="btn primary" onClick={() => props.onApply(f, sort, radius)}>Show places</button>
        </div>
      </div>
    </Sheet>
  );
}
