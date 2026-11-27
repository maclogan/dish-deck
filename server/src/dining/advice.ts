// Reservation advice. Plain rules, so it works with AI off; when AI has read the reviews ("book weeks
// ahead", "they don't take bookings") its reading takes priority. No busyness guesses: Google's own
// popular times are on each place's Google listing.

import type { PriceLevel, ReservationAdvice, ReservationLevel } from "./types.js";

export interface ReservationInput {
  /** Google: takes reservations. */
  reservable?: boolean;
  price?: PriceLevel;
  ai?: Exclude<ReservationLevel, "unknown">;
  aiReason?: string;
}

export function reservationAdvice(i: ReservationInput): ReservationAdvice {
  const reason = i.aiReason;
  if (i.ai === "required") return { level: "required", label: "Reservations required", reason };
  if (i.ai === "recommended") return { level: "recommended", label: "Book ahead", reason };
  if (i.reservable === false || i.ai === "not-taken") return { level: "not-taken", label: "Walk in · no reservations", reason };
  if (i.reservable === true) {
    if (i.price === 4) return { level: "recommended", label: "Book ahead", reason };
    return { level: "walk-in", label: "Walk in · reservations taken", reason };
  }
  if (i.ai === "walk-in") return { level: "walk-in", label: "Walk in", reason };
  return { level: "unknown", label: "", reason };
}
