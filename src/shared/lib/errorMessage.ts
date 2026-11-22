/** What to show a person for a failed action. The backend's own messages are written for people and
 * pass through; anything internal that slips out (a database constraint, a file system error, a
 * status code in front of the message) is put into plain words instead of shown as is. */
export function errorMessage(error: unknown): string {
  return plainErrorMessage(splitErrorDetail(rawErrorText(error)).message);
}

/** Between the plain words and the technical cause of a backup, restore, key-file or update failure (VS-71).
 * Must match the backend's `error_detail::DETAIL_SEPARATOR`. */
export const ERROR_DETAIL_SEPARATOR = "\n\u001f";

/** The plain words and, when the backend sent one, the technical cause after them (VS-71). */
export function splitErrorDetail(text: string): { message: string; detail: string | null } {
  const at = text.indexOf(ERROR_DETAIL_SEPARATOR);
  return at < 0 ? { message: text, detail: null } : { message: text.slice(0, at), detail: text.slice(at + ERROR_DETAIL_SEPARATOR.length) };
}

/** `errorMessage`, with the technical cause kept after the separator, for the status line's Details (VS-71).
 * Only where Details is shown: the status line and the update banner. */
export function errorMessageWithDetail(error: unknown): string {
  const { detail } = splitErrorDetail(rawErrorText(error));
  return detail ? `${errorMessage(error)}${ERROR_DETAIL_SEPARATOR}${detail}` : errorMessage(error);
}

function rawErrorText(error: unknown): string {
  return (
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : ""
  );
}

function plainErrorMessage(raw: string): string {
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
