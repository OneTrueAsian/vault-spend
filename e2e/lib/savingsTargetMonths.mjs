// Expected month counts and monthly equivalents for the Ask the Vault savings-target spec (feature348), worked from the calendar
// so the spec does not depend on the day it runs. Amounts are integer cents; halves round up.

/** Whole months after this one in the year, and this month's remaining days (today included). */
export function monthsLeftInYear(today) {
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return { whole: 11 - today.getMonth(), partDays: daysInMonth - today.getDate() + 1, daysInMonth };
}

const roundHalfUp = (num, den) => (2n * num + den) / (2n * den);

/** The approximate monthly cut and limit for a category that was allocated `allocatedCents` over `months` ({ num, den } months). */
export function monthlyEquivalent(allocatedCents, usualCents, months) {
  const cut = roundHalfUp(allocatedCents * months.den, months.num);
  const limit = roundHalfUp(usualCents * months.num - allocatedCents * months.den, months.num);
  return { cut, limit };
}
