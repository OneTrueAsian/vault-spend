import { useLayoutEffect, type RefObject } from "react";

/** Positions a portaled, `position: fixed` panel beside its trigger: below it, or above it
 * when there's more room there, never past the window edges. It follows scrolling and
 * resizing. This lets a row-level menu escape the ledger's clipping scroll container and
 * the Transparent style's backdrop-filter containing block (see RowFieldDropdown). */
export function useFixedPanel(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  { minWidth = 220, align = "start" }: { minWidth?: number; align?: "start" | "end" } = {},
): void {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!open || !panel || !trigger) return;
    function place() {
      if (!panel || !trigger) return;
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const wanted = Math.min(panel.scrollHeight + 2, 340);
      const useAbove = below < wanted && above > below;
      panel.style.maxHeight = `${Math.max(0, Math.min(wanted, useAbove ? above : below))}px`;
      panel.style.top = useAbove ? "auto" : `${rect.bottom + 6}px`;
      panel.style.bottom = useAbove ? `${window.innerHeight - rect.top + 6}px` : "auto";
      panel.style.minWidth = `${Math.max(align === "start" ? rect.width : 0, minWidth)}px`;
      let left = align === "end" ? rect.right - panel.offsetWidth : rect.left;
      const maxLeft = window.innerWidth - 8 - panel.offsetWidth;
      if (left > maxLeft) left = maxLeft;
      if (left < 8) left = 8;
      panel.style.left = `${left}px`;
    }
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, triggerRef, panelRef, minWidth, align]);
}
