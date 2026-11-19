import { isValidDecimalString } from "./format";

/**
 * What to tell someone about an amount they typed, or null when there is nothing to say (an empty box is a missing value, which
 * each form names in its own words). Commas stay rejected (owner decision, 2026-11-19, VS-49); the message shows the fix.
 */
export function amountTextProblem(text: string): string | null {
  const typed = text.trim();
  if (!typed || isValidDecimalString(typed)) return null;
  const withoutCommas = typed.replace(/,/g, "");
  if (typed.includes(",") && isValidDecimalString(withoutCommas)) return `Leave out the comma: ${withoutCommas}`;
  return "Enter an amount like 1250.40.";
}
