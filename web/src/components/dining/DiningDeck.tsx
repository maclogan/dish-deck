import { useEffect, useRef, useState } from "preact/hooks";
import type { PlaceSummary } from "../../api";
import { IconStar, IconX } from "../../icons";
import { MetaLine, PlaceLinks, PlacePhoto, StatusChips, type PlaceActions } from "./PlaceCard";

type Move = "hide" | "star";
const FLING = 110;

/** One place at a time: drag left for "not today", right to shortlist, tap for details. */
export function DiningDeck(props: { places: PlaceSummary[]; actions: PlaceActions }) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const queue = props.places.filter((p) => !skipped.includes(p.id));
  const top = queue[0];
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; dx: number; t0: number; moved: boolean } | null>(null);
  const [zone, setZone] = useState<Move | null>(null);
  const leaving = useRef(false);

  // A new search starts a fresh deck.
  useEffect(() => setSkipped([]), [props.places.map((p) => p.id).join()]);

  const fly = (move: Move) => {
    const el = ref.current;
    if (!el || !top || leaving.current) return;
    leaving.current = true;
    const w = document.documentElement.clientWidth || window.innerWidth;
    el.style.transition = "transform 240ms cubic-bezier(.2,.7,.3,1), opacity 240ms";
    el.style.transform = move === "hide" ? `translate(${-w * 1.2}px, 40px) rotate(-22deg)` : `translate(${w * 1.2}px, 40px) rotate(22deg)`;
    el.style.opacity = "0";
    window.setTimeout(() => {
      leaving.current = false;
      setZone(null);
      if (move === "hide") props.actions.onHide(top);
      else {
        if (!props.actions.isShortlisted(top.id)) props.actions.onShortlist(top);
        setSkipped((s) => [...s, top.id]);
      }
    }, 220);
  };

  const reset = () => {
    const el = ref.current;
    if (el) {
      el.style.transition = "transform 200ms cubic-bezier(.2,.8,.3,1.2)";
      el.style.transform = "";
    }
    drag.current = null;
    setZone(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || document.querySelector(".sheet")) return;
      if (e.key === "ArrowLeft") fly("hide");
      if (e.key === "ArrowRight") fly("star");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!top) {
    return (
      <div class="empty">
        <p>That's every place in this search.</p>
        {skipped.length > 0 && <button class="btn" onClick={() => setSkipped([])}>Go through them again</button>}
      </div>
    );
  }

  return (
    <div class="deck-wrap dining-deck">
      <div class="deck">
        {queue.slice(0, 3).reverse().map((p, i, arr) => {
          const depth = arr.length - 1 - i;
          const isTop = depth === 0;
          return (
            <div
              key={p.id}
              ref={isTop ? ref : undefined}
              class={`deck-card ${isTop ? "is-top" : ""} ${isTop && zone ? (zone === "hide" ? "zone-skip" : "zone-plan") : ""}`}
              style={isTop ? undefined : { transform: `translateY(${depth * 10}px) scale(${1 - depth * 0.04})` }}
              onPointerDown={isTop ? (e) => {
                if (leaving.current || (e.target as HTMLElement).closest("button, a")) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                (e.currentTarget as HTMLElement).style.transition = "none";
                drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, t0: Date.now(), moved: false };
              } : undefined}
              onPointerMove={isTop ? (e) => {
                const d = drag.current;
                if (!d || d.id !== e.pointerId || !ref.current) return;
                d.dx = e.clientX - d.x;
                const dy = e.clientY - d.y;
                if (Math.hypot(d.dx, dy) > 6) d.moved = true;
                ref.current.style.transform = `translate(${d.dx}px, ${dy}px) rotate(${d.dx / 18}deg)`;
                const z: Move | null = d.dx < -FLING / 2 ? "hide" : d.dx > FLING / 2 ? "star" : null;
                setZone((prev) => (prev === z ? prev : z));
              } : undefined}
              onPointerUp={isTop ? (e) => {
                const d = drag.current;
                if (!d || d.id !== e.pointerId) return;
                if (!d.moved && Date.now() - d.t0 < 450) {
                  reset();
                  props.actions.onOpen(top);
                } else if (d.dx < -FLING) fly("hide");
                else if (d.dx > FLING) fly("star");
                else reset();
                drag.current = null;
              } : undefined}
              onPointerCancel={isTop ? reset : undefined}
            >
              <div class="card-face">
                <div class="card-image">
                  <PlacePhoto place={p} lazy={!isTop} />
                </div>
                <div class="card-text">
                  <h3>{p.name}</h3>
                  <MetaLine p={p} />
                  <StatusChips p={p} />
                  {p.why && <p class="place-why">{p.why}</p>}
                  {p.tags.length > 0 && (
                    <p class="place-tags">{p.tags.slice(0, 5).map((t) => <span key={t}>#{t.replace(/\s+/g, "-")}</span>)}</p>
                  )}
                  <PlaceLinks p={p} />
                </div>
              </div>
              {isTop && zone && <div class={`stamp ${zone === "hide" ? "stamp-skip" : "stamp-plan"}`}>{zone === "hide" ? "Not today" : "Shortlist"}</div>}
            </div>
          );
        })}
      </div>
      <div class="deck-actions">
        <button class="round-btn skip" aria-label="Not today" onClick={() => fly("hide")}>
          <IconX size={26} />
        </button>
        <button class="round-btn plan" aria-label="Shortlist" onClick={() => fly("star")}>
          <IconStar size={26} />
        </button>
      </div>
      <p class="hint">Left: not today · Right: shortlist · Tap: details · {queue.length} left</p>
    </div>
  );
}
