import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import "./InfoTip.css";

/**
 * A small "i" button that explains a field. The explanation shows while the button is hovered or has
 * keyboard focus, and stays open after a click (a tap on a touch screen) until it is clicked again, Escape
 * is pressed, or something else is clicked. The text is always in the document, linked with
 * aria-describedby, so a screen reader reads it whether or not it is showing; pass `id` to point the field
 * itself at the same text. Drawn in the top layer (a popover) so a scrolling dialog cannot clip it, placed
 * under the button the way MenuSelect places its menu.
 */
export function InfoTip({ label, text, id }: { label: string; text: string; id?: string }) {
  const ownId = useId();
  const tipId = id ?? ownId;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || focused || pinned;
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    const button = buttonRef.current;
    if (!open || !tip || !button) return;
    tip.showPopover?.();
    function place() {
      if (!tip || !button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      tip.style.width = `${width}px`;
      tip.style.left = `${Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12))}px`;
      const below = rect.bottom + 6;
      const fitsBelow = below + tip.offsetHeight <= window.innerHeight - 12;
      tip.style.top = `${fitsBelow ? below : Math.max(12, rect.top - tip.offsetHeight - 6)}px`;
    }
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      tip.hidePopover?.();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!pinned) return;
    function onPointer(event: PointerEvent | MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setPinned(false);
    }
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [pinned]);

  return (
    <span className="info-tip" ref={rootRef} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        ref={buttonRef}
        type="button"
        className="info-tip-button"
        aria-label={`About ${label}`}
        aria-describedby={tipId}
        aria-expanded={open}
        data-info-tip={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => {
          if (!pinned) {
            setPinned(true);
            return;
          }
          // Closing: the pointer is still over the button and it still has focus, which would hold the tip
          // open, so clear those too; it opens again when the pointer comes back or focus returns.
          setPinned(false);
          setHovered(false);
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setPinned(false);
            setHovered(false);
            setFocused(false);
          }
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      <span ref={tipRef} id={tipId} role="tooltip" popover="manual" className="info-tip-text" data-open={open}>
        {text}
      </span>
    </span>
  );
}
