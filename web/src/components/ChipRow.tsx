import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/**
 * Horizontally scrolling row of pills. Touch scrolls natively; a vertical mouse
 * wheel is turned into horizontal scrolling, and the row can be dragged with a mouse.
 */
export function ChipRow(props: { children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1);
      // At an edge, let the page scroll instead of trapping the wheel.
      if ((delta < 0 && el.scrollLeft <= 0) || (delta > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !ref.current) return;
    drag.current = { id: e.pointerId, x: e.clientX, left: ref.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 5) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    if (d.moved) el.scrollLeft = d.left - dx;
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  // Swallow the click that ends a drag so it doesn't toggle a pill.
  const onClickCapture = (e: MouseEvent) => {
    if (drag.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
    drag.current = null;
  };

  return (
    <div
      ref={ref}
      class={`chip-row ${dragging ? "dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => setDragging(false)}
      onClickCapture={onClickCapture}
    >
      {props.children}
    </div>
  );
}

/** Add the item if it's missing, remove it if it's there (for multi-select pills). */
export const toggleIn = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
