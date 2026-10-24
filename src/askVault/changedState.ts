/**
 * The one wording for every "your data changed" state, in every Ask the Vault family (M6 owner decision D-S3-04, UC-06).
 * The heading is true whatever caused the change (a new transaction, a renamed category, a new day, a locked or switched profile); the body
 * says what happened to what was on screen and what to do. A family may add its own instruction beneath, never a different cause.
 * Errors that are not about changed data keep their own words.
 */
export const CHANGED_HEADING = "Your details changed";
export const CHANGED_BODY = "This answer or preview is no longer shown. Ask again using your current details.";
