import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";

export function Sheet(props: { open: boolean; title?: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open]);

  if (!props.open) return null;
  return (
    <div class="sheet-backdrop" onClick={props.onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        {props.title && <h2 class="sheet-title">{props.title}</h2>}
        <div class="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}
