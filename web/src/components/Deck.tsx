import { useEffect, useRef, useState } from "preact/hooks";
import type { Card } from "../api";
import { IconBook, IconCalendar, IconX } from "../icons";
import { CardFace } from "./CardFace";

export type Action = "skip" | "book" | "plan";

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  t0: number;
  moved: boolean;
  /** Viewport size captured at drag start (a card dragged off-screen can widen the layout). */
  vw: number;
  vh: number;
}

const FLING = 110;

export function Deck(props: {
  cards: Card[];
  /** Saved-recipe deck: there's no "save to book", so the whole right side means "plan". */
  saved: boolean;
  onDecide: (card: Card, action: Action) => void;
  onOpen: (card: Card) => void;
}) {
  const { cards, saved } = props;
  const top = cards[0];
  const topRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zone, setZone] = useState<Action | null>(null);
  const leaving = useRef(false);

  const zoneAt = (x: number, y: number): Action | null => {
    const w = drag.current?.vw ?? window.innerWidth;
    const h = drag.current?.vh ?? window.innerHeight;
    if (x < w * 0.2) return "skip";
    if (x > w * 0.8) return saved ? "plan" : y < h * 0.5 ? "book" : "plan";
    return null;
  };

  const reset = () => {
    drag.current = null;
    setDragging(false);
    setZone(null);
  };

  const fly = (action: Action) => {
    const el = topRef.current;
    if (!el || !top || leaving.current) return;
    leaving.current = true;
    const w = document.documentElement.clientWidth || window.innerWidth;
    const to =
      action === "skip"
        ? `translate(${-w * 1.2}px, 40px) rotate(-24deg)`
        : action === "book"
          ? `translate(${w * 1.2}px, -120px) rotate(20deg)`
          : `translate(${w * 1.2}px, 160px) rotate(28deg)`;
    el.style.transition = "transform 260ms cubic-bezier(.2,.7,.3,1), opacity 260ms";
    el.style.transform = to;
    el.style.opacity = "0";
    window.setTimeout(() => {
      leaving.current = false;
      reset();
      props.onDecide(top, action);
    }, 240);
  };

  const snapBack = () => {
    const el = topRef.current;
    if (el) {
      el.style.transition = "transform 220ms cubic-bezier(.2,.8,.3,1.2)";
      el.style.transform = "";
    }
    reset();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (leaving.current || (e.target as HTMLElement).closest("button")) return;
    const el = topRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    el.style.transition = "none";
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      t0: Date.now(),
      moved: false,
      vw: document.documentElement.clientWidth || window.innerWidth,
      vh: document.documentElement.clientHeight || window.innerHeight,
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = topRef.current;
    if (!d || !el || e.pointerId !== d.pointerId) return;
    d.dx = e.clientX - d.startX;
    d.dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(d.dx, d.dy) > 6) {
      d.moved = true;
      setDragging(true);
    }
    el.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${d.dx / 18}deg)`;
    const z = d.moved ? zoneAt(e.clientX, e.clientY) : null;
    setZone((prev) => (prev === z ? prev : z));
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved && Date.now() - d.t0 < 450) {
      snapBack();
      if (top) props.onOpen(top);
      return;
    }
    const z = zoneAt(e.clientX, e.clientY);
    const action: Action | null = z ?? (d.dx > FLING ? (saved ? "plan" : "book") : d.dx < -FLING ? "skip" : null);
    if (action) fly(action);
    else snapBack();
  };

  // Keyboard shortcuts for desktop testing: left = skip, right = save, down = plan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || document.querySelector(".sheet")) return;
      if (e.key === "ArrowLeft") fly("skip");
      if (e.key === "ArrowRight") fly(saved ? "plan" : "book");
      if (e.key === "ArrowDown") fly("plan");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!top) return null;

  return (
    <div class="deck-wrap">
      <div class="deck">
        {cards
          .slice(0, 3)
          .reverse()
          .map((card, i, arr) => {
            const depth = arr.length - 1 - i; // 0 = top
            const isTop = depth === 0;
            return (
              <div
                key={card.key}
                ref={isTop ? topRef : undefined}
                class={`deck-card ${isTop ? "is-top" : ""} ${isTop && zone ? `zone-${zone}` : ""}`}
                style={isTop ? undefined : { transform: `translateY(${depth * 10}px) scale(${1 - depth * 0.04})` }}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? onPointerUp : undefined}
                onPointerCancel={isTop ? snapBack : undefined}
              >
                <CardFace card={card} />
                {isTop && zone && (
                  <div class={`stamp stamp-${zone}`}>{zone === "skip" ? "Skip" : zone === "book" ? "Save" : "This week"}</div>
                )}
              </div>
            );
          })}
      </div>

      {dragging && (
        <div class="zones" aria-hidden="true">
          <div class={`zone zone-skip-area ${zone === "skip" ? "active" : ""}`}>
            <IconX size={28} />
            <span>Skip</span>
          </div>
          {saved ? (
            <div class={`zone zone-plan-full ${zone === "plan" ? "active" : ""}`}>
              <IconCalendar size={28} />
              <span>This week</span>
            </div>
          ) : (
            <>
              <div class={`zone zone-book-area ${zone === "book" ? "active" : ""}`}>
                <IconBook size={28} />
                <span>Save to recipes</span>
              </div>
              <div class={`zone zone-plan-area ${zone === "plan" ? "active" : ""}`}>
                <IconCalendar size={28} />
                <span>Add to this week</span>
              </div>
            </>
          )}
        </div>
      )}

      <div class="deck-actions">
        <button class="round-btn skip" aria-label="Skip" onClick={() => fly("skip")}>
          <IconX size={26} />
        </button>
        {!saved && (
          <button class="round-btn book" aria-label="Save to recipes" onClick={() => fly("book")}>
            <IconBook size={26} />
          </button>
        )}
        <button class="round-btn plan" aria-label="Add to this week" onClick={() => fly("plan")}>
          <IconCalendar size={26} />
        </button>
      </div>
      <p class="hint">
        {saved ? "Left: skip · Right: this week · Tap: details" : "Top-right: save · Bottom-right: this week · Left: skip"}
      </p>
    </div>
  );
}
