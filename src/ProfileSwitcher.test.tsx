// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProfileSwitcher } from "./ProfileSwitcher";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
afterEach(() => { act(() => root.unmount()); container.remove(); });

it("closes on Escape and returns focus to its trigger like other dropdowns", () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onSwitch = vi.fn();
  act(() => root.render(<ProfileSwitcher profiles={[
    { id: "a", name: "Alex", is_active: true, icon_key: null },
    { id: "b", name: "Blair", is_active: false, icon_key: null },
  ]} onSwitchProfile={onSwitch} onManageProfiles={vi.fn()} />));
  const trigger = container.querySelector<HTMLButtonElement>(".profile-switcher-toggle")!;
  act(() => trigger.click());
  const option = container.querySelector<HTMLButtonElement>(".profile-switcher-option")!;
  option.focus();
  act(() => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector(".profile-switcher-panel")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(onSwitch).not.toHaveBeenCalled();
});
