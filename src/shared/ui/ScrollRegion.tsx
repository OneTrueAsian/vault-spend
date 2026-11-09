import type { ReactNode } from "react";

/** A frame that scrolls sideways when its content is wider than the card (a wide report table, a
 * chart). It is a labelled region and a Tab stop so a keyboard user can focus it and scroll it with
 * the arrow keys; an unlabelled `overflow: auto` div is not reachable at all without a mouse. */
export function ScrollRegion({
  label,
  className,
  innerRef,
  children,
}: {
  /** What the scrolling content is, e.g. "Spending by category and month". */
  label: string;
  className?: string;
  innerRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div className={className} ref={innerRef} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
