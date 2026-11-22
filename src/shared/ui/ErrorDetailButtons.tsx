import { useEffect, useRef, useState } from "react";

/** VS-71: the Details and Copy details buttons beside a failure's plain words. The caller shows the cause itself
 * while `open`. Buttons only, so they fit inside a `<p>` like the status line. */
export function ErrorDetailButtons({ detail, open, onToggle, className }: {
  detail: string;
  open: boolean;
  onToggle: () => void;
  className: string;
}) {
  const [copied, setCopied] = useState<"" | "Copied" | "Couldn't copy">("");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied("Copied");
    } catch {
      setCopied("Couldn't copy");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(""), 4000);
  }
  return (
    <>
      <button type="button" className={className} aria-expanded={open} onClick={onToggle}>
        Details
      </button>
      {open && (
        <button type="button" className={className} onClick={() => void copy()}>
          {copied || "Copy details"}
        </button>
      )}
    </>
  );
}
