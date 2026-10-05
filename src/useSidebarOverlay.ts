import { useCallback, useEffect, useState, type FocusEvent, type RefObject } from "react";
import { useDismiss } from "./useDismiss";

/** Where the sidebar turns into an icon-only rail (AppResponsive.css). */
export const ICON_SIDEBAR_QUERY = "(max-width: 1000px)";

/** The icon-only sidebar's "Show names" overlay. `expanded` lays the full sidebar over the page; it
 * closes on Escape, a mousedown outside the sidebar, keyboard focus moving out of it (but not the
 * window losing focus, when nothing in the page receives it) and the window widening past the
 * icon-only layout. `iconOnly` is true while the sidebar shows icons only. */
export function useSidebarOverlay(sidebarRef: RefObject<HTMLElement | null>) {
  const [expanded, setExpanded] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(ICON_SIDEBAR_QUERY).matches ?? false);
  useDismiss(expanded, [sidebarRef], () => setExpanded(false));
  useEffect(() => {
    const query = window.matchMedia?.(ICON_SIDEBAR_QUERY);
    if (!query) return;
    function onChange() {
      setNarrow(query!.matches);
      // Narrowing again starts from icons rather than an overlay nobody asked for this time.
      setExpanded(false);
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const handleBlur = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      const next = e.relatedTarget as Node | null;
      if (next && !sidebarRef.current?.contains(next)) setExpanded(false);
    },
    [sidebarRef],
  );
  return { expanded, setExpanded, iconOnly: narrow && !expanded, handleBlur };
}
