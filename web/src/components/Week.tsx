import { useState } from "preact/hooks";
import { api, type MealType, type PlanDay, type Proposal } from "../api";
import { IconCheck, IconRefresh, IconShuffle } from "../icons";
import { dayLabel } from "./PlanSheet";

const BADGE: Record<Proposal["kind"], string> = {
  existing: "Planned",
  recipe: "New",
  leftovers: "Leftovers",
  empty: "Open",
};

function SlotRow(props: { type: MealType; slot: Proposal; preview: boolean; busy: boolean; onReroll?: () => void }) {
  const { slot } = props;
  const canReroll = props.preview && (slot.kind === "recipe" || slot.kind === "leftovers");
  return (
    <div class={`week-slot kind-${slot.kind}`}>
      <div class="slot-type">{props.type === "lunch" ? "Lunch" : "Dinner"}</div>
      <div class="slot-main">
        <div class="slot-name">{slot.kind === "empty" ? "Nothing planned" : slot.name}</div>
        {props.preview && slot.reasons.length > 0 && <div class="slot-reasons">{slot.reasons.join(" · ")}</div>}
      </div>
      {props.preview && <span class={`badge badge-${slot.kind}`}>{BADGE[slot.kind]}</span>}
      {canReroll && (
        <button class="icon-btn" aria-label="Pick something else" disabled={props.busy} onClick={props.onReroll}>
          <IconRefresh size={18} />
        </button>
      )}
    </div>
  );
}

export function Week(props: {
  days: PlanDay[] | null;
  today: string;
  refreshWeek: () => void;
  notify: (message: string, link?: string, error?: boolean) => void;
}) {
  const [preview, setPreview] = useState<PlanDay[] | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [busy, setBusy] = useState(false);

  const shown = preview ?? props.days;

  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      props.notify(e instanceof Error ? e.message : "Something went wrong", undefined, true);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const randomize = () =>
    run(async () => {
      const res = await api.generate({ replaceExisting });
      setPreview(res.days);
    });

  const reroll = (date: string, type: MealType) =>
    run(async () => {
      if (!preview) return;
      const locked: Record<string, Proposal> = {};
      preview.forEach((day, i) => {
        for (const t of ["lunch", "dinner"] as MealType[]) {
          if (day.date === date && t === type) continue;
          // Rerolling a dinner changes what the next day's leftovers are, so free that lunch too.
          const prevDay = preview[i - 1];
          if (t === "lunch" && day[t].kind === "leftovers" && type === "dinner" && prevDay?.date === date) continue;
          if (day[t].kind !== "empty") locked[`${day.date}|${t}`] = day[t];
        }
      });
      const res = await api.generate({ replaceExisting, locked });
      setPreview(res.days);
    });

  const save = () =>
    run(async () => {
      if (!preview) return;
      const res = await api.apply({ days: preview, replaceExisting });
      const extra = [
        res.removed ? `replaced ${res.removed}` : "",
        res.skipped ? `skipped ${res.skipped} already planned` : "",
      ].filter(Boolean);
      props.notify(
        res.created === 0
          ? "Nothing new to add"
          : `Added ${res.created} meal${res.created === 1 ? "" : "s"} to Mealie${extra.length ? ` (${extra.join(", ")})` : ""}`,
      );
      setPreview(null);
      props.refreshWeek();
    });

  const newCount = preview?.reduce((n, d) => n + [d.lunch, d.dinner].filter((p) => p.kind === "recipe" || p.kind === "leftovers").length, 0) ?? 0;

  return (
    <div class="week">
      <div class="week-head">
        <h2>{preview ? "Proposed week" : "This week"}</h2>
        {!preview && (
          <label class="toggle small">
            <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting((e.target as HTMLInputElement).checked)} />
            <span class="switch" />
            <span>Replace planned meals</span>
          </label>
        )}
      </div>

      {!shown && <div class="empty"><div class="spinner" /></div>}

      {shown?.map((day) => (
        <section class={`week-day ${day.date === props.today ? "today" : ""}`} key={day.date}>
          <header>
            <strong>{dayLabel(day.date, day.weekday, props.today)}</strong>
            {day.busy && <span class="tiny">busy day</span>}
          </header>
          <SlotRow type="lunch" slot={day.lunch} preview={!!preview} busy={busy} onReroll={() => reroll(day.date, "lunch")} />
          <SlotRow type="dinner" slot={day.dinner} preview={!!preview} busy={busy} onReroll={() => reroll(day.date, "dinner")} />
        </section>
      ))}

      <div class="week-actions">
        {preview ? (
          <>
            <button class="btn ghost" disabled={busy} onClick={() => setPreview(null)}>Discard</button>
            <button class="btn ghost" disabled={busy} onClick={randomize}>
              <IconShuffle size={18} /> Reshuffle
            </button>
            <button class="btn primary" disabled={busy || newCount === 0} onClick={save}>
              <IconCheck size={18} /> Save {newCount || ""}
            </button>
          </>
        ) : (
          <button class="btn primary wide" disabled={busy || !props.days} onClick={randomize}>
            <IconShuffle size={18} /> {busy ? "Planning…" : "Randomize lunches & dinners"}
          </button>
        )}
      </div>
      {preview && <p class="hint">Fills open slots from your saved recipes: leftovers become next-day lunches, proteins rotate, recent meals are avoided.</p>}
    </div>
  );
}
