/** What to show a person for a failed action. The backend's own messages are written for people and
 * pass through; anything internal that slips out (a database constraint, a file system error, a
 * status code in front of the message) is put into plain words instead of shown as is. */
export function errorMessage(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";
  const text = raw.replace(/^Error:\s*/, "").replace(/^[A-Z]+_[A-Z_]+:\s+/, "").trim();
  if (!text) return "Something went wrong. Try again.";
  for (const [pattern, plain] of PLAIN) {
    if (pattern.test(text)) return plain;
  }
  return text;
}

const PLAIN: [RegExp, string][] = [
  [/UNIQUE constraint failed/i, "That name is already in use. Choose a different one."],
  [/FOREIGN KEY constraint failed/i, "Something else still uses this, so it can't be changed that way."],
  [/database is locked|database table is locked|SQLITE_BUSY/i, "Vault Spend is busy saving. Try again in a moment."],
  [/os error 2\b|cannot find the (file|path)/i, "That file couldn't be found. It may have been moved or deleted."],
  [/os error 5\b|access is denied|permission denied/i, "Vault Spend wasn't allowed to use that file. Check that it isn't open in another program."],
  [/os error 112\b|not enough space|no space left/i, "There isn't enough free disk space to save this."],
];
