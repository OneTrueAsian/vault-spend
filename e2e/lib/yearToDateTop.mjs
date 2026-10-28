// Year-to-date top categories for the ordinary-answers spec (feature350), added up from the fixture rows themselves.
// Each row is [account, months back, day, description, amount, category]; a row counts when its month is in `now`'s calendar year.
export function yearToDateTop3(rows, now) {
  const cents = {};
  for (const [, back, , , amount, category] of rows) {
    if (new Date(now.getFullYear(), now.getMonth() - back, 1).getFullYear() === now.getFullYear()) cents[category] = (cents[category] ?? 0) - Math.round(Number(amount) * 100);
  }
  return Object.entries(cents).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name, c]) => [name, (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })]);
}
