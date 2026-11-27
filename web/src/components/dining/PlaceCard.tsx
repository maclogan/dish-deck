import { useRef, useState } from "preact/hooks";
import type { PlaceSummary } from "../../api";
import { IconBan, IconExternal, IconGlobe, IconMore, IconStar, IconX } from "../../icons";
import { distanceText } from "./state";

export interface PlaceActions {
  onOpen: (p: PlaceSummary) => void;
  onShortlist: (p: PlaceSummary) => void;
  onHide: (p: PlaceSummary) => void;
  onNever: (p: PlaceSummary) => void;
  isShortlisted: (id: string) => boolean;
}

export function PlacePhoto({ place, lazy = true }: { place: Pick<PlaceSummary, "photo">; lazy?: boolean }) {
  // Remember which address failed, so a different photo still gets its chance to load.
  const [failed, setFailed] = useState<string | undefined>();
  if (!place.photo || failed === place.photo) {
    return (
      <div class="placeholder" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <path d="M7 2v8a2 2 0 0 0 4 0V2M9 10v12M17 2c-2 1.5-3 4-3 7h3v13" />
        </svg>
      </div>
    );
  }
  return <img src={place.photo} alt="" loading={lazy ? "lazy" : undefined} draggable={false} onError={() => setFailed(place.photo)} />;
}

const PRICE_WORDS = ["", "Inexpensive", "Moderate", "Expensive", "Very expensive"];

/** Budget at a glance: "$$" in full ink with the rest of "$$$$" dimmed, so the scale is obvious. */
export function PriceBadge({ price }: { price?: number }) {
  if (!price) {
    return (
      <span class="price-badge unknown" title="Google has no price level for this place" aria-label="Price unknown">
        $?
      </span>
    );
  }
  return (
    <span class="price-badge" title={PRICE_WORDS[price]} aria-label={`Price: ${PRICE_WORDS[price]}`}>
      <span aria-hidden="true">{"$".repeat(price)}</span>
      <span class="price-rest" aria-hidden="true">{"$".repeat(4 - price)}</span>
    </span>
  );
}

/** "[$$··] ★ 4.6 (812) · Thai · 0.4 mi" */
export function MetaLine({ p }: { p: PlaceSummary }) {
  return (
    <p class="place-meta">
      <PriceBadge price={p.price} />
      {p.rating ? (
        <span class="rating">
          ★ {p.rating.toFixed(1)}
          {p.ratingCount ? <span class="muted"> ({p.ratingCount.toLocaleString()})</span> : null}
        </span>
      ) : (
        <span class="muted">No rating</span>
      )}
      <span class="meta-rest">{[p.cuisine, distanceText(p.distanceMiles)].filter(Boolean).join(" · ")}</span>
    </p>
  );
}

/** Open/closed, reservation advice and size, as small status chips. */
export function StatusChips({ p }: { p: PlaceSummary }) {
  return (
    <div class="chips">
      {p.openAtTime === false && <span class="chip chip-bad">Closed then</span>}
      {p.closesSoon && <span class="chip chip-warn">Closes soon</span>}
      {p.reservation.label && (
        <span class={`chip ${p.reservation.level === "required" || p.reservation.level === "recommended" ? "chip-warn" : p.reservation.level === "walk-in" ? "chip-good" : ""}`}>
          {p.reservation.label}
        </span>
      )}
      {p.size && <span class="chip">{p.size.label}</span>}
      <span class="chip">{p.chain ? "Chain" : "Independent"}</span>
    </div>
  );
}

export function PlaceLinks({ p }: { p: PlaceSummary }) {
  const stop = (e: Event) => e.stopPropagation();
  return (
    <div class="place-links">
      <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer" onClick={stop}>
        Google listing <IconExternal size={12} />
      </a>
      {p.website && (
        <a href={p.website} target="_blank" rel="noopener noreferrer" onClick={stop}>
          <IconGlobe size={12} /> Website
        </a>
      )}
    </div>
  );
}

const SWIPE = 90;

export function PlaceCard({ p, index, actions }: { p: PlaceSummary; index?: number; actions: PlaceActions }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; dx: number; horizontal?: boolean } | null>(null);
  const [menu, setMenu] = useState(false);
  const starred = actions.isShortlisted(p.id);

  // Swipe left to hide for today. Vertical moves scroll the list as usual.
  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0 };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.horizontal === undefined && Math.hypot(dx, dy) > 8) {
      d.horizontal = Math.abs(dx) > Math.abs(dy) * 1.3;
      if (d.horizontal) el.setPointerCapture(e.pointerId);
    }
    if (!d.horizontal) return;
    d.dx = Math.min(0, dx);
    el.style.transition = "none";
    el.style.transform = `translateX(${d.dx}px)`;
    el.style.opacity = String(1 - Math.min(0.6, -d.dx / 300));
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el || e.pointerId !== d.id) return;
    if (!d.horizontal) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) actions.onOpen(p);
      return;
    }
    el.style.transition = "transform 200ms ease, opacity 200ms";
    if (d.dx < -SWIPE) {
      el.style.transform = "translateX(-110%)";
      el.style.opacity = "0";
      window.setTimeout(() => actions.onHide(p), 180);
    } else {
      el.style.transform = "";
      el.style.opacity = "";
    }
  };

  return (
    <div class="place-row">
      <div class="place-row-under" aria-hidden="true">
        <IconX size={18} /> Not today
      </div>
      <div
        ref={ref}
        class="place-card"
        role="button"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; if (ref.current) { ref.current.style.transform = ""; ref.current.style.opacity = ""; } }}
        onKeyDown={(e) => e.key === "Enter" && actions.onOpen(p)}
      >
        <div class="place-thumb">
          <PlacePhoto place={p} />
          {index !== undefined && <span class="place-num">{index + 1}</span>}
        </div>
        <div class="place-body">
          <div class="place-head">
            <h3>{p.name}</h3>
            <button
              type="button"
              class={`icon-btn star ${starred ? "on" : ""}`}
              aria-pressed={starred}
              aria-label={starred ? "Remove from shortlist" : "Add to shortlist"}
              onClick={() => actions.onShortlist(p)}
            >
              <IconStar size={18} filled={starred} />
            </button>
            <button type="button" class="icon-btn" aria-label="More" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <IconMore size={18} />
            </button>
          </div>
          <MetaLine p={p} />
          <StatusChips p={p} />
          {p.why && <p class="place-why">{p.why}</p>}
          {p.tags.length > 0 && (
            <p class="place-tags">
              {p.tags.slice(0, 4).map((t) => (
                <span key={t}>#{t.replace(/\s+/g, "-")}</span>
              ))}
            </p>
          )}
          <PlaceLinks p={p} />
          {menu && (
            <div class="place-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenu(false); actions.onHide(p); }}>
                <IconX size={16} /> Not today
              </button>
              <button type="button" role="menuitem" class="danger" onClick={() => { setMenu(false); actions.onNever(p); }}>
                <IconBan size={16} /> Never show again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
