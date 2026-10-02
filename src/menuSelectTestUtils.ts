// Test helpers for components that use MenuSelect, in place of driving a native <select>'s
// `.value`, `.options` and change event. The trigger carries `data-value`; the open menu's items carry
// `data-value` and their label text.
import { act } from "react";

export const menuValue = (trigger: Element | null | undefined): string | undefined => (trigger as HTMLElement | null | undefined)?.dataset.value;

function items(trigger: Element): HTMLButtonElement[] {
  return [...(trigger.closest(".menu-select")?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? [])];
}

/** The options in the menu, in order, as `{ value, label }` (opens it, reads it, closes it). */
export function menuOptions(trigger: Element): { value: string; label: string }[] {
  act(() => (trigger as HTMLElement).click());
  const options = items(trigger).map((b) => ({ value: b.dataset.value ?? "", label: (b.textContent ?? "").replace(/✓$/, "").trim() }));
  act(() => (trigger as HTMLElement).click());
  return options;
}

/** Opens the menu and chooses the option with this value, as a person would. */
export function pickMenuOption(trigger: Element, value: string): void {
  act(() => (trigger as HTMLElement).click());
  const item = items(trigger).find((b) => b.dataset.value === value);
  if (!item) throw new Error(`no menu option with value "${value}"`);
  act(() => item.click());
}
