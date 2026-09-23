// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const getCurrentGeneration = vi.hoisted(() => vi.fn());
vi.mock("./profileUiState", () => ({ getCurrentGeneration }));
vi.mock("./ProtectionSetupDialog", () => ({
  ProtectionSetupDialog: ({ newProfileName }: { newProfileName: string | null }) => (
    <div data-protection-setup-dialog>{newProfileName}</div>
  ),
}));

import { ProfilesSection } from "./SettingsView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Settings ProfilesSection", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCreateProfile = vi.fn();

  beforeEach(() => {
    getCurrentGeneration.mockReset().mockResolvedValue(11);
    onCreateProfile.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show() {
    act(() => {
      root.render(
        <ProfilesSection
          profiles={[]}
          onCreateProfile={onCreateProfile}
          onUseExistingDataFile={vi.fn()}
          onSwitchProfile={vi.fn()}
          onRenameProfile={vi.fn()}
          onSetProfileIcon={vi.fn()}
          onDeleteProfile={vi.fn()}
          onProtected={vi.fn()}
        />,
      );
    });
  }

  it("opens protected-profile setup instead of creating a plain profile when protection is checked", async () => {
    show();
    typeInto(container.querySelector<HTMLInputElement>('input[placeholder^="New profile"]')!, "Jamie");
    act(() => container.querySelector<HTMLInputElement>("[data-protect-new-profile]")!.click());

    await act(async () => {
      container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(document.body.querySelector("[data-protection-setup-dialog]")?.textContent).toBe("Jamie");
    expect(onCreateProfile).not.toHaveBeenCalled();
  });
});
