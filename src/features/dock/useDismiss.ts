import { useEffect, type RefObject } from "react";

/** Close a popover on outside pointerdown or Escape while `open`. */
/** Close on outside pointerdown / Esc. `ref` may be several elements (e.g. an anchor + a portaled menu). */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[], onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const refs = Array.isArray(ref) ? ref : [ref];
    const down = (e: PointerEvent) => {
      const inside = refs.some((r) => r.current?.contains(e.target as Node));
      if (!inside && refs.some((r) => r.current)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [open, ref, onClose]);
}
