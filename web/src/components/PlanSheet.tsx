import type { Card, MealType, PlanDay } from "../api";
import { Sheet } from "./Sheet";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayLabel(date: string, weekday: number, today: string) {
  if (date === today) return "Today";
  const d = Number(date.slice(8, 10));
  return `${DAY[weekday]} ${d}`;
}

export function PlanSheet(props: {
  card: Card | null;
  days: PlanDay[] | null;
  today: string;
  busy: boolean;
  onPick: (date: string, entryType: MealType) => void;
  onClose: () => void;
}) {
  const { card, days } = props;
  const suits = card?.suits?.length ? card.suits : ["lunch", "dinner"];
  // Suggest the first open slot this dish suits, preferring dinner.
  let suggested: string | null = null;
  for (const type of ["dinner", "lunch"] as MealType[]) {
    if (suggested || !suits.includes(type)) continue;
    const d = days?.find((day) => day[type].kind === "empty");
    if (d) suggested = `${d.date}|${type}`;
  }

  return (
    <Sheet open={!!card} title={card ? `Add "${card.title}" to…` : ""} onClose={props.onClose}>
      {!days ? (
        <p class="muted">Loading this week…</p>
      ) : (
        <div class="plan-grid">
          {days.map((day) => (
            <div class="plan-row" key={day.date}>
              <div class="plan-day">
                <strong>{dayLabel(day.date, day.weekday, props.today)}</strong>
                {day.busy && <span class="tiny">busy</span>}
              </div>
              {(["lunch", "dinner"] as MealType[]).map((type) => {
                const slot = day[type];
                const key = `${day.date}|${type}`;
                const filled = slot.kind !== "empty";
                return (
                  <button
                    key={type}
                    class={`slot-btn ${filled ? "filled" : ""} ${key === suggested ? "suggested" : ""}`}
                    disabled={props.busy}
                    onClick={() => props.onPick(day.date, type)}
                  >
                    <span class="slot-type">{type === "lunch" ? "Lunch" : "Dinner"}</span>
                    <span class="slot-name">{filled ? `+ with ${slot.name}` : "Open"}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
