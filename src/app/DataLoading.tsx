import { useEffect, useState } from "react";

/** Shown in place of a view until the profile's data has arrived, so no view shows its empty state
 * ("No transactions yet") for data that is still loading. Blank for the first 300 ms, which covers
 * a typical profile, so a quick load doesn't flash a message; a large profile then says what it is
 * doing. */
export function DataLoading() {
  const [showText, setShowText] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowText(true), 300);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="data-loading" role="status" aria-busy="true" data-data-loading>
      {showText && (
        <>
          <span className="data-loading-spinner" aria-hidden="true" />
          <span>Loading your accounts and transactions…</span>
        </>
      )}
    </div>
  );
}
