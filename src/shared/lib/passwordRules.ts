/** Mirrors `MIN_PASSWORD_CHARS` in src-tauri/src/protection/password_rules.rs. The backend still
 * enforces it, and the common-password list, so this only gates the Continue button. */
export const MIN_PASSWORD_CHARS = 12;
