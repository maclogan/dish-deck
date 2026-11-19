import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/** How far (px) or how fast (px/ms) a downward drag has to go to dismiss the sheet. */
const DISMISS_DISTANCE = 110;
const DISMISS_SPEED = 0.6;
const CLOSE_MS = 200;

interface Drag {
  startY: number;
  lastY: number;
  lastT: number;
  speed: number;
  /** Following the finger (vs. letting the sheet body scroll). */
  active: boolean;
  /** Started inside the scrolling body, which only drags the sheet when it's scrolled to the top. */
  inBody: boolean;
  pointerId?: number;
}

/**
 * Bottom sheet. Drag it down (from the handle, the title, or the content when it's scrolled to the
 * top) to dismiss it; tap the backdrop or press Escape to close it too.
 */
export function Sheet(props: { open: boolean; title?: string; onClose: () => void; children: ComponentChildren }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  // Reset whenever the sheet opens with new content.
  useEffect(() => {
    if (props.open) setClosing(false);
  }, [props.open]);

  const setOffset = (y: number, animate: boolean) => {
    const sheet = sheetRef.current;
    const backdrop = backdropRef.current;
    if (!sheet) return;
    sheet.style.transition = animate ? `transform ${CLOSE_MS}ms cubic-bezier(.2,.8,.3,1)` : "none";
    sheet.style.transform = y ? `translateY(${y}px)` : "";
    if (backdrop) {
      const h = sheet.offsetHeight || 1;
      backdrop.style.transition = animate ? `background-color ${CLOSE_MS}ms` : "none";
      backdrop.style.backgroundColor = y ? `rgba(20, 14, 10, ${0.45 * Math.max(0, 1 - y / h)})` : "";
    }
  };

  /** Slide the sheet away, then tell the parent. */
  const close = () => {
    if (closing) return;
    setClosing(true);
    const h = sheetRef.current?.offsetHeight ?? 600;
    setOffset(h + 40, true);
    window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
  };

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, closing]);

  // ---- drag handling, shared by touch and mouse
  const start = (y: number, target: EventTarget | null, pointerId?: number) => {
    if (closing) return;
    const inBody = !!(target instanceof Node && bodyRef.current?.contains(target));
    drag.current = { startY: y, lastY: y, lastT: performance.now(), speed: 0, active: false, inBody, pointerId };
  };

  /** Returns true while the sheet is following the finger (so the caller blocks scrolling). */
  const move = (y: number): boolean => {
    const d = drag.current;
    if (!d) return false;
    const dy = y - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < 6) return false;
      // Pulling down from the top of the content (or from the header) drags the sheet; anything else scrolls.
      const atTop = (bodyRef.current?.scrollTop ?? 0) <= 0;
      if (dy > 0 && (!d.inBody || atTop)) {
        d.active = true;
        d.startY = y;
      } else {
        drag.current = null;
        return false;
      }
    }
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.speed = 0.7 * ((y - d.lastY) / dt) + 0.3 * d.speed;
    d.lastY = y;
    d.lastT = now;
    setOffset(Math.max(0, y - d.startY), false);
    return true;
  };

  const justDragged = useRef(false);
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    // The click that ends a mouse drag shouldn't also count as tapping the handle.
    justDragged.current = true;
    window.setTimeout(() => (justDragged.current = false), 0);
    const offset = d.lastY - d.startY;
    if (offset > DISMISS_DISTANCE || (offset > 20 && d.speed > DISMISS_SPEED)) close();
    else setOffset(0, true);
  };

  // Touch: native listeners so touchmove can be non-passive. preventDefault() stops the page behind the
  // sheet from scrolling and the browser's pull-to-refresh from reloading the app.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!props.open || !sheet) return;
    const onStart = (e: TouchEvent) => e.touches.length === 1 && start(e.touches[0]!.clientY, e.target);
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (move(e.touches[0]!.clientY) && e.cancelable) e.preventDefault();
    };
    // Swipes on the dimmed backdrop shouldn't scroll (or refresh) the page underneath.
    const backdrop = backdropRef.current;
    const onBackdropMove = (e: TouchEvent) => e.target === backdrop && e.cancelable && e.preventDefault();
    backdrop?.addEventListener("touchmove", onBackdropMove, { passive: false });
    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
    return () => {
      backdrop?.removeEventListener("touchmove", onBackdropMove);
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", end);
      sheet.removeEventListener("touchcancel", end);
    };
  }, [props.open, closing]);

  // Mouse: drag by the handle or title (the content scrolls with the wheel instead).
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    start(e.clientY, null, e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || drag.current?.pointerId !== e.pointerId) return;
    const el = e.currentTarget as HTMLElement;
    // Capture only once it's really a drag, so a plain click on the handle still reaches it.
    if (move(e.clientY) && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && drag.current?.pointerId === e.pointerId) end();
  };

  if (!props.open) return null;
  return (
    <div ref={backdropRef} class="sheet-backdrop" onClick={close}>
      <div ref={sheetRef} class="sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div class="sheet-grab" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <button type="button" class="sheet-handle" aria-label="Close" onClick={() => !justDragged.current && close()} />
          {props.title && <h2 class="sheet-title">{props.title}</h2>}
        </div>
        <div ref={bodyRef} class="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}
