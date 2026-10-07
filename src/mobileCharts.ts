import { CATEGORY_COLORS } from "./categoryPalette";
import { addMoney, units } from "./mobileViewModel";

export type DonutSlice = { label: string; amount: string; share: number; color: string };

/** The phone's "Where it went" donut and its key: one slice per category with spending, biggest
 * first. There are six category colours, so past six categories the five biggest keep their own
 * slice and the rest share one "Other" slice, and no two slices can look alike. */
export function donutSlices(categories: [string, string][], maxSlices = CATEGORY_COLORS.length): DonutSlice[] {
  const spent = categories
    .filter(([, amount]) => units(amount) > 0n)
    .sort((a, b) => (units(a[1]) > units(b[1]) ? -1 : units(a[1]) < units(b[1]) ? 1 : a[0].localeCompare(b[0])));
  const rows: [string, string][] =
    spent.length <= maxSlices ? spent : [...spent.slice(0, maxSlices - 1), ["Other", addMoney(spent.slice(maxSlices - 1).map(([, a]) => a))]];
  const total = rows.reduce((sum, [, amount]) => sum + Number(amount), 0);
  if (total <= 0) return [];
  return rows.map(([label, amount], i) => ({ label, amount, share: (Number(amount) / total) * 100, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }));
}
