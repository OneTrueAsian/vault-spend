/** Simple compound-growth projection for the Investments tab's goal
 * calculator — monthly compounding, a fixed monthly contribution added
 * after each month's growth. Simulated month by month rather than a
 * closed-form annuity formula so a 0% assumed return (division by zero in
 * the closed form) needs no special case. */
export interface ProjectionPoint {
  year: number;
  balance: number;
}

export function projectGoal(
  startingBalance: number,
  monthlyContribution: number,
  annualReturnPct: number,
  years: number,
): ProjectionPoint[] {
  const monthlyRate = annualReturnPct / 100 / 12;
  const points: ProjectionPoint[] = [{ year: 0, balance: startingBalance }];
  let balance = startingBalance;
  for (let year = 1; year <= years; year++) {
    for (let month = 0; month < 12; month++) {
      balance = balance * (1 + monthlyRate) + monthlyContribution;
    }
    points.push({ year, balance });
  }
  return points;
}
