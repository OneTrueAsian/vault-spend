export const CADENCE_OPTIONS = ["weekly", "biweekly", "monthly", "annual"];

/** How often a recurring item repeats, written the way people say it. The stored value stays the
 * code (`annual`, `biweekly`); an unknown code is shown capitalised rather than hidden. */
export function cadenceLabel(c: string): string {
  switch (c) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Every 2 weeks";
    case "monthly":
      return "Monthly";
    case "annual":
      return "Yearly";
    default:
      return c ? c[0].toUpperCase() + c.slice(1) : c;
  }
}
