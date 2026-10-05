import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Shared open/close plumbing for a toggle-button + panel popover (the
 * account/member filter dropdowns, "More filters") — before this, all
 * three were the same `useState`/`useRef`/outside-click `useEffect`
 * copy-pasted three times, and none of them closed on Escape even though
 * every real dialog in the app does (`Modal.tsx`'s `ModalShell`) —  a
 * user has no way to tell these are a different component family from the
 * outside, so Escape silently doing nothing here reads as a bug, not a
 * deliberate difference. Closes on an outside click (as before) or
 * Escape (new), and on Escape specifically returns focus to the trigger
 * button — the same "give focus somewhere sane" contract `ModalShell`
 * already honors — since an outside click already moves focus somewhere
 * the user chose on purpose. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = rootRef.current?.querySelector<HTMLElement>(
      ".account-filter-panel, .profile-switcher-panel, .bucket-contribute-panel",
    );
    if (!panel) return;

    function placePanel() {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger || trigger.height === 0 || !panel) return;
      // Measure the normal CSS size first; all offsets remain relative to the
      // existing container, including Transparent's backdrop-filter containers.
      for (const property of ["left", "right", "top", "bottom", "max-height"]) panel.style.removeProperty(property);
      const topEdge = 8;
      // A `position: fixed` panel (the profile menu beside the icon-only sidebar) opens level with
      // its trigger, in window coordinates: its top at the trigger's top or, short of room below,
      // its bottom at the trigger's bottom.
      const fixed = getComputedStyle(panel).position === "fixed";
      const below = Math.max(0, window.innerHeight - (fixed ? trigger.top : trigger.bottom) - 12);
      const above = Math.max(0, (fixed ? trigger.bottom : trigger.top) - topEdge - 12);
      const wanted = Math.min(panel.scrollHeight + 2, parseFloat(getComputedStyle(panel).maxHeight) || 340);
      const useAbove = (below < wanted && above > below) ||
        (panel.classList.contains("bucket-contribute-panel") && above >= wanted);
      if (fixed) {
        panel.style.top = useAbove ? "auto" : `${trigger.top}px`;
        panel.style.bottom = useAbove ? `${window.innerHeight - trigger.bottom}px` : "auto";
      } else {
        panel.style.top = useAbove ? "auto" : "calc(100% + 6px)";
        panel.style.bottom = useAbove ? "calc(100% + 6px)" : "auto";
      }
      panel.style.maxHeight = `${Math.min(wanted, useAbove ? above : below)}px`;
      const rect = panel.getBoundingClientRect();
      const shift = rect.left < 8 ? 8 - rect.left : Math.min(0, window.innerWidth - 8 - rect.right);
      if (shift) {
        panel.style.left = `${panel.offsetLeft + shift}px`;
        panel.style.right = "auto";
      }
    }
    function onScroll(event: Event) {
      if (event.target instanceof Node && panel?.contains(event.target)) return;
      placePanel();
    }
    placePanel();
    window.addEventListener("resize", placePanel);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", placePanel);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return { open, setOpen, rootRef, triggerRef };
}
