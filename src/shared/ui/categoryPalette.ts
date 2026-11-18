// Category colors for charts and legends (Dashboard, Cash Flow, Reports). Each entry is a CSS variable
// defined in App.css, so a style can recolor them all at once; the variables keep the original colors
// for every style that does not.
export const CATEGORY_COLORS: readonly string[] = [1, 2, 3, 4, 5, 6].map((n) => `var(--cat-${n})`);

export function categoryColor(index: number): string {
  return CATEGORY_COLORS[Math.max(index, 0) % CATEGORY_COLORS.length];
}
