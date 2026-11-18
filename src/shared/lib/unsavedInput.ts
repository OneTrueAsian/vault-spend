/**
 * Whether the page currently has something a manual lock would silently discard — an open dialog
 * (every modal in this app already renders `role="dialog"`) or a focused text input/textarea whose
 * value has diverged from its own default. This deliberately does not catch a custom widget that
 * tracks its own draft state outside a native input or dialog — a real per-form dirty flag would,
 * but does not exist anywhere in this codebase today (checked while writing this), and building one
 * is a bigger, separate piece of work, not something to add silently as a side effect of this one
 * decision.
 */
export function hasObservableUnsavedInput(): boolean {
  if (document.querySelector('[role="dialog"]')) return true;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return active.value !== active.defaultValue;
  }
  return false;
}
