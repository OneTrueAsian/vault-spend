/** Number of slips between two words: a wrong, missing or extra letter, or two neighbouring letters swapped. */
export function distance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push(Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let j = 1; j <= b.length && i > 0; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}
