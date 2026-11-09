import { useEffect, useRef } from "react";

/** Auto-cancels a two-step delete confirmation a few seconds after it's
 * shown (used alongside a `confirmingDeleteId`/`confirmingBulkDelete`-style
 * state across every row-delete UI in the app), so a confirm left open from
 * an earlier click can't be completed by an unrelated later click landing
 * near the same spot. `confirming` is whatever falsy/truthy value already
 * represents "not confirming" for that state (`null`, `false`, ...). */
export function useAutoCancelDelete(confirming: unknown, cancel: () => void, ms = 4000) {
  // Callers pass a new `cancel` on every render; keep the latest in a ref so the timer restarts only
  // when the confirmation itself changes, not on every render.
  const cancelRef = useRef(cancel);
  useEffect(() => {
    cancelRef.current = cancel;
  });
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => cancelRef.current(), ms);
    return () => clearTimeout(timer);
  }, [confirming, ms]);
}
