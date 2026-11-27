import type { PlaceSummary } from "../../api";
import { IconExternal, IconGlobe, IconX } from "../../icons";
import { Sheet } from "../Sheet";
import { PlacePhoto } from "./PlaceCard";
import { distanceText, priceText } from "./state";

/** The day's shortlist side by side. */
export function Compare(props: {
  open: boolean;
  places: PlaceSummary[];
  onOpen: (p: PlaceSummary) => void;
  onRemove: (p: PlaceSummary) => void;
  onClose: () => void;
}) {
  const rows: { label: string; value: (p: PlaceSummary) => string }[] = [
    { label: "Rating", value: (p) => (p.rating ? `★ ${p.rating.toFixed(1)} (${p.ratingCount ?? 0})` : "—") },
    { label: "Price", value: (p) => priceText(p.price) || "—" },
    { label: "Cuisine", value: (p) => p.cuisine ?? "—" },
    { label: "Distance", value: (p) => distanceText(p.distanceMiles) },
    { label: "Open", value: (p) => (p.openAtTime === false ? "Closed then" : p.closesSoon ? "Closes soon" : p.hoursToday ?? "—") },
    { label: "Booking", value: (p) => p.reservation.label || "—" },
    { label: "Size", value: (p) => p.size?.label ?? "—" },
    { label: "Type", value: (p) => (p.chain ? "Chain" : "Independent") },
    { label: "Tags", value: (p) => p.tags.slice(0, 5).join(", ") || "—" },
  ];
  return (
    <Sheet open={props.open} title="Today's shortlist" onClose={props.onClose}>
      {props.places.length === 0 ? (
        <p class="muted">Star places to compare them here. The shortlist clears tomorrow.</p>
      ) : (
        <div class="compare" style={{ "--cols": props.places.length }}>
          <div class="compare-grid">
            <div class="compare-corner" />
            {props.places.map((p) => (
              <div key={p.id} class="compare-head">
                <button type="button" class="compare-photo" onClick={() => props.onOpen(p)} aria-label={`Open ${p.name}`}>
                  <PlacePhoto place={p} />
                </button>
                <button type="button" class="compare-name" onClick={() => props.onOpen(p)}>{p.name}</button>
                <div class="compare-links">
                  <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer">Google <IconExternal size={11} /></a>
                  {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer"><IconGlobe size={11} /> Site</a>}
                </div>
                <button type="button" class="compare-remove" aria-label={`Remove ${p.name}`} onClick={() => props.onRemove(p)}>
                  <IconX size={14} />
                </button>
              </div>
            ))}
            {rows.map((r) => (
              <>
                <div key={r.label} class="compare-label">{r.label}</div>
                {props.places.map((p) => (
                  <div key={`${r.label}-${p.id}`} class="compare-cell">{r.value(p)}</div>
                ))}
              </>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
