import { useEffect, useState } from "react";

/** Keeps a conditionally-rendered element mounted for `durationMs` after
 * `isOpen` flips false, so a CSS exit transition (toggle a `-closing`
 * class, then actually unmount) has time to play instead of React
 * removing the element the instant its parent stops asking for it.
 * `closing` is true only during that trailing window — style the element
 * with a different animation/class while it's true.
 *
 * `shouldRender` is `isOpen || closing`, not a separately-tracked state
 * variable updated from a `useEffect` — that was tried first and had a
 * real bug: on *open*, an effect-driven `shouldRender` lags the `isOpen`
 * prop by one extra render (the effect only runs after the render where
 * `isOpen` first became true has already committed), so on that first
 * render `shouldRender` was still stale-false and the element rendered
 * nothing — a one-frame window where `waitForExist`-style checks could
 * find the element already gone-then-back, or its content briefly empty,
 * a real flake this caused in `feature2_budget_alerts.mjs`. Deriving
 * `shouldRender` directly from `isOpen` fixes the open path for free
 * (no lag possible — it's the same prop). `closing` still needs
 * *some* one-tick detection to catch the open->closed transition, so it
 * uses React's documented "adjust state during render" pattern (a
 * setState call directly in the render body, gated on a change since the
 * last render) instead of an effect — React reruns the render
 * immediately with the new state before committing anything, so there's
 * no visible extra frame there either. */
export function useDelayedVisibility(isOpen: boolean, durationMs = 160): { shouldRender: boolean; closing: boolean } {
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [closing, setClosing] = useState(false);

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) setClosing(true); // just went from open -> closed
  }

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), durationMs);
    return () => clearTimeout(timer);
  }, [closing, durationMs]);

  return { shouldRender: isOpen || closing, closing };
}
