// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const protection = vi.hoisted(() => ({ selectProfile: vi.fn(), getCurrentGeneration: vi.fn() }));
vi.mock("./protection", () => protection);
vi.mock("./profileUiState", () => ({ getCurrentGeneration: protection.getCurrentGeneration }));
vi.mock("./ProtectionSetupDialog", () => ({
  ProtectionSetupDialog: ({ newProfileName, onDone, onCancel }: { newProfileName: string | null; onDone: (next: { status: string }) => void; onCancel: () => void }) => (
    <div data-protection-setup-dialog>
      {newProfileName}
      <button type="button" data-finish-protection onClick={() => onDone({ status: "selector" })} />
      <button type="button" data-cancel-protection onClick={onCancel} />
    </div>
  ),
}));
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { ProfileSelector } from "./ProfileSelector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const THREE = [
  { id: "a", name: "Alex", icon_key: null, is_password_protected: false },
  { id: "b", name: "Blair", icon_key: "account-avatar-profile-3", is_password_protected: true },
  { id: "c", name: "Casey", icon_key: null, is_password_protected: false },
];

describe("ProfileSelector", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onResolved = vi.fn();

  beforeEach(() => {
    protection.selectProfile.mockReset();
    protection.getCurrentGeneration.mockReset().mockResolvedValue(7);
    invokeMock.mockReset();
    onResolved.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(profiles: typeof THREE, lastUsedId: string | null = null) {
    act(() => {
      root.render(<ProfileSelector profiles={profiles} lastUsedId={lastUsedId} onResolved={onResolved} />);
    });
  }

  function cards() {
    return [...container.querySelectorAll<HTMLButtonElement>("[data-profile-option]")];
  }

  it("shows a card per profile, with a lock indicator only on protected ones", () => {
    show(THREE);

    expect(cards()).toHaveLength(3);
    const blair = cards().find((b) => b.textContent?.includes("Blair"))!;
    expect(blair.querySelector('[aria-label="Password protected"]')).not.toBeNull();
    const alex = cards().find((b) => b.textContent?.includes("Alex"))!;
    expect(alex.querySelector('[aria-label="Password protected"]')).toBeNull();
  });

  it("renders as cards for any number of profiles — no drop-down mode", () => {
    const six = [...THREE, { id: "d", name: "Dana", icon_key: null, is_password_protected: false },
      { id: "e", name: "Erin", icon_key: null, is_password_protected: false },
      { id: "f", name: "Finn", icon_key: null, is_password_protected: false }];

    show(six);

    expect(container.querySelector("select")).toBeNull();
    expect(cards()).toHaveLength(6);
  });

  it("refreshes the cards when a completed profile operation supplies a new selector state", () => {
    show(THREE);

    act(() => {
      root.render(
        <ProfileSelector
          profiles={[...THREE, { id: "d", name: "Jamie", icon_key: null, is_password_protected: true }]}
          lastUsedId={null}
          onResolved={onResolved}
        />,
      );
    });

    expect(cards().some((button) => button.textContent?.includes("Jamie"))).toBe(true);
  });

  it("selecting an unprotected profile calls selectProfile and reports the result", async () => {
    protection.selectProfile.mockResolvedValue({ status: "open" });
    show(THREE);

    await act(async () => {
      cards().find((b) => b.textContent?.includes("Alex"))!.click();
    });

    expect(protection.selectProfile).toHaveBeenCalledWith("a");
    expect(onResolved).toHaveBeenCalledWith({ status: "open" });
  });

  it("selecting a protected profile still just calls selectProfile — the backend decides Locked, not the UI", async () => {
    protection.selectProfile.mockResolvedValue({ status: "locked", profile_id: "b", profile_name: "Blair" });
    show(THREE);

    await act(async () => {
      cards().find((b) => b.textContent?.includes("Blair"))!.click();
    });

    expect(onResolved).toHaveBeenCalledWith({ status: "locked", profile_id: "b", profile_name: "Blair" });
  });

  it("shows the error inline and stays on the selector when selection fails", async () => {
    protection.selectProfile.mockRejectedValue("That profile no longer exists.");
    show(THREE);

    await act(async () => {
      cards().find((b) => b.textContent?.includes("Alex"))!.click();
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("That profile no longer exists.");
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("renaming a profile calls rename_profile and updates the card without leaving the screen", async () => {
    invokeMock.mockResolvedValue(undefined);
    show(THREE);

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Rename" && b.closest("[data-profile-card]")?.textContent?.includes("Alex"))!.click();
    });
    typeInto(container.querySelector<HTMLInputElement>(".profile-card-editing input")!, "Alexandra");
    await act(async () => {
      container.querySelector<HTMLInputElement>(".profile-card-editing input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(invokeMock).toHaveBeenCalledWith("rename_profile", { id: "a", newName: "Alexandra" });
    expect(cards().some((b) => b.textContent?.includes("Alexandra"))).toBe(true);
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("deleting a profile needs a second click to confirm, then calls delete_profile and removes the card", async () => {
    invokeMock.mockResolvedValue(undefined);
    show(THREE);
    const deleteButtonFor = (name: string) =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Delete" && b.closest("[data-profile-card]")?.textContent?.includes(name));

    await act(async () => {
      deleteButtonFor("Casey")!.click();
    });
    expect(invokeMock).not.toHaveBeenCalled();

    await act(async () => {
      deleteButtonFor("Casey")!.click();
    });

    expect(invokeMock).toHaveBeenCalledWith("delete_profile", { id: "c" });
    expect(cards().some((b) => b.textContent?.includes("Casey"))).toBe(false);
    expect(cards()).toHaveLength(2);
  });

  it("an Add profile tile creates a new profile through the existing create_profile command and opens it", async () => {
    invokeMock.mockResolvedValue("Dana");
    show(THREE);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-add-profile]")!.click();
    });
    typeInto(container.querySelector<HTMLInputElement>(".profile-card-new-form input")!, "Dana");
    await act(async () => {
      container.querySelector<HTMLInputElement>(".profile-card-new-form input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(invokeMock).toHaveBeenCalledWith("create_profile", { name: "Dana" });
    expect(onResolved).toHaveBeenCalledWith({ status: "open" });
  });

  it('checking "Protect this profile with a password" opens the protection setup instead of creating a plain profile', async () => {
    show(THREE);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-add-profile]")!.click();
    });
    typeInto(container.querySelector<HTMLInputElement>(".profile-card-new-form input")!, "Jamie");
    act(() => {
      container.querySelector<HTMLInputElement>("[data-protect-new-profile]")!.click();
    });
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".profile-card-new-form button")].find((button) => button.textContent === "Add")!.click();
    });

    expect(document.body.querySelector("[data-protection-setup-dialog]")?.textContent).toBe("Jamie");
    expect(invokeMock).not.toHaveBeenCalledWith("create_profile", expect.anything());
  });

  async function startProtectedAdd(name: string) {
    show(THREE);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-add-profile]")!.click();
    });
    typeInto(container.querySelector<HTMLInputElement>(".profile-card-new-form input")!, name);
    act(() => {
      container.querySelector<HTMLInputElement>("[data-protect-new-profile]")!.click();
    });
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".profile-card-new-form button")].find((button) => button.textContent === "Add")!.click();
    });
  }

  it("closes and clears the Add profile form once the protected profile has been created", async () => {
    await startProtectedAdd("Jamie");

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-finish-protection]")!.click();
    });

    // The wizard's success returns to the selector; a form still showing "Jamie" with the box ticked
    // would invite a second Add for a profile that now exists.
    expect(container.querySelector(".profile-card-new-form")).toBeNull();
    expect(container.querySelector("[data-add-profile]")).not.toBeNull();
    expect(onResolved).toHaveBeenCalledWith({ status: "selector" });
  });

  it("keeps the typed name and the ticked box when the protection wizard is cancelled, so the user can retry", async () => {
    await startProtectedAdd("Jamie");

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-cancel-protection]")!.click();
    });

    expect(document.body.querySelector("[data-protection-setup-dialog]")).toBeNull();
    expect(container.querySelector<HTMLInputElement>(".profile-card-new-form input:not([type='checkbox'])")!.value).toBe("Jamie");
    expect(container.querySelector<HTMLInputElement>("[data-protect-new-profile]")!.checked).toBe(true);
    expect(onResolved).not.toHaveBeenCalled();
  });
});
