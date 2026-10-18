/** Number of slips, including adjacent swaps. With a bound, larger distances return maximum + 1. */
export function distance(a: string, b: string, maximum = Infinity): number {
  const cap = maximum + 1;
  if (Math.abs(a.length - b.length) > maximum) return cap;
  let older = Array<number>(b.length + 1).fill(cap);
  let previous = Array.from({ length: b.length + 1 }, (_, j) => Math.min(j, cap));
  for (let i = 1; i <= a.length; i++) {
    const current = Array<number>(b.length + 1).fill(cap);
    current[0] = Math.min(i, cap);
    // A path within the bound cannot leave this diagonal band. Keep two preceding rows for swaps.
    for (let j = Math.max(1, i - maximum); j <= Math.min(b.length, i + maximum); j++) {
      current[j] = Math.min(cap, previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) current[j] = Math.min(current[j], older[j - 2] + 1);
    }
    older = previous;
    previous = current;
  }
  return previous[b.length];
}
