import { useEffect, useState } from "react";
import { localToday, type DateRecord } from "./calendarDate";

/** Today on the local calendar, refreshed after midnight and when the window comes back to the front. */
export function useToday(): DateRecord {
  const [today, setToday] = useState(() => localToday());
  useEffect(() => {
    const refresh = () => setToday((current) => {
      const next = localToday();
      return next.year === current.year && next.month === current.month && next.day === current.day ? current : next;
    });
    const now = new Date();
    const untilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 1000;
    const timer = window.setTimeout(refresh, untilMidnight);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [today]);
  return today;
}
