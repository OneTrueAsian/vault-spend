// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi, test, expect } from "vitest";
import { MobilePairingPrompt } from "./MobilePairingPrompt";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); invoke.mockReset(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
function button(name: string): HTMLButtonElement { return Array.from(document.querySelectorAll("button")).find(b => b.textContent === name)!; }
test("approval requires chosen profiles and explains offline revocation limits", async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === "mobile_pending_pairings" ? [{ id: "request", label: "My phone" }] : command === "mobile_pairing_profiles" ? [{ id: "a", name: "Personal" }, { id: "b", name: "Work" }] : undefined));
  await act(async () => root.render(<MobilePairingPrompt />));
  expect(document.body.textContent).toContain("My phone");
  expect(button("Approve phone").disabled).toBe(true);
  expect(document.body.textContent).toContain("cannot erase saved offline copies");
  await act(async () => (document.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1]).click());
  await act(async () => button("Approve phone").click());
  expect(invoke).toHaveBeenCalledWith("mobile_decide_pairing", { id: "request", profiles: ["b"] });
});
test("reject sends no profile grants", async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === "mobile_pending_pairings" ? [{ id: "request", label: "Phone" }] : command === "mobile_pairing_profiles" ? [] : undefined));
  await act(async () => root.render(<MobilePairingPrompt />));
  await act(async () => button("Reject").click());
  expect(invoke).toHaveBeenCalledWith("mobile_decide_pairing", { id: "request", profiles: null });
});