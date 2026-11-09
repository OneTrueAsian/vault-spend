import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** Why a calendar closed, which decides where focus goes: Escape and choosing a value return it to the
 * field; clicking or tabbing elsewhere leaves it where the person put it. */
export type CloseReason = "escape" | "select" | "outside" | "leave" | "other" | "disabled";

/** Only one field's calendar can be open at a time. Ownership is explicit: opening a calendar closes the
 * previous owner through its own close function, never by looking for something that resembles a popup. */
let activeOwner: { id: string; close: (reason: CloseReason) => void } | null = null;

const MARGIN = 8;
const GAP = 6;
const PREFERRED_WIDTH = 320;

/** Open/close, top-layer lifetime, placement and focus ownership for one field's calendar. The panel stays a
 * DOM descendant of the field (so an outer popover or dialog contains it naturally); the browser's popover
 * layer lifts it above anything that would clip it. */
export function useCalendarPopover({ disabled, direction }: { disabled: boolean; direction: "ltr" | "rtl" }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openedFrom = useRef<"input" | "trigger">("trigger");
  const openRef = useRef(false);
  openRef.current = open;

  const close = useCallback(
    (reason: CloseReason = "other") => {
      if (!openRef.current) return;
      openRef.current = false;
      setOpen(false);
      if (activeOwner?.id === id) activeOwner = null;
      if (reason === "select") inputRef.current?.focus();
      else if (reason === "escape") (openedFrom.current === "input" ? inputRef : triggerRef).current?.focus();
    },
    [id],
  );

  const openPopup = useCallback(
    (from: "input" | "trigger" = "trigger") => {
      if (disabled || openRef.current) return;
      if (activeOwner && activeOwner.id !== id) activeOwner.close("other");
      activeOwner = { id, close };
      openedFrom.current = from;
      openRef.current = true;
      setOpen(true);
    },
    [disabled, id, close],
  );

  useEffect(() => {
    if (disabled) close("disabled");
  }, [disabled, close]);

  useEffect(
    () => () => {
      if (activeOwner?.id === id) activeOwner = null;
    },
    [id],
  );

  // Raise the panel and keep it beside its field. Placement runs again when the page scrolls, the window
  // resizes or zooms, or the calendar's contents change; it only writes style, so it never retriggers itself.
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const root = rootRef.current;
    if (!panel || !root) return;
    panel.showPopover?.();
    function place() {
      if (!panel || !root) return;
      if (!root.isConnected) {
        close("other");
        return;
      }
      const field = root.getBoundingClientRect();
      if (field.width === 0 && field.height === 0) {
        close("other");
        return;
      }
      panel.style.maxHeight = "";
      const width = Math.min(PREFERRED_WIDTH, window.innerWidth - MARGIN * 2);
      panel.style.width = `${width}px`;
      const natural = panel.offsetHeight;
      const below = window.innerHeight - field.bottom - MARGIN - GAP;
      const above = field.top - MARGIN - GAP;
      const placeAbove = natural > below && above > below;
      const room = Math.max(120, placeAbove ? above : below);
      const height = Math.min(natural, room);
      panel.style.maxHeight = `${room}px`;
      const left = direction === "rtl" ? field.right - width : field.left;
      panel.style.left = `${Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - width))}px`;
      panel.style.top = `${placeAbove ? field.top - GAP - height : field.bottom + GAP}px`;
    }
    place();
    function onScroll(event: Event) {
      if (event.target instanceof Node && panel?.contains(event.target)) return;
      place();
    }
    const contents = new MutationObserver(place);
    contents.observe(panel, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", place);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      contents.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", onScroll, true);
      try {
        panel.hidePopover?.();
      } catch {
        // already removed from the page
      }
    };
  }, [open, direction, close]);

  // A pointer press anywhere outside the field closes the calendar and leaves focus where it was pressed.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close("outside");
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close]);

  return { id, open, openPopup, close, rootRef, inputRef, triggerRef, panelRef };
}
