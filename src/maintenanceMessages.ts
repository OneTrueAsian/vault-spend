/** Copy for completed maintenance operations; names are the actual changed records. */
export function rolloverMessage(names: readonly string[]): string {
  return `Rolled forward this month's starting balance for ${names.length} account${names.length === 1 ? "" : "s"}: ${names.join(", ")}.`;
}

export function contributionMessage(names: readonly string[]): string {
  return `Added this month's automatic contribution for ${names.length} bucket${names.length === 1 ? "" : "s"}: ${names.join(", ")}.`;
}
