import { useEffect, useRef, type RefObject } from "react";

/** While `open`, reports a mousedown outside every ref'd element as "outside" and the Escape key as
 * "escape". Shared by the row-level popovers (RowFieldDropdown, RowMenu). */
export function useDismiss(
  open: boolean,
  refs: RefObject<HTMLElement | null>[],
  onDismiss: (reason: "outside" | "escape") => void,
): void {
  const latest = useRef({ refs, onDismiss });
  latest.current = { refs, onDismiss };
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (latest.current.refs.some((ref) => ref.current?.contains(target))) return;
      latest.current.onDismiss("outside");
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") latest.current.onDismiss("escape");
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);
}
