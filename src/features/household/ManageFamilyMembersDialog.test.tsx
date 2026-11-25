// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ManageFamilyMembersDialog } from "./ManageFamilyMembersDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

// VS-103 F-13: the intro says what family members are used for, not just that they are a label.
describe("Manage family members intro", () => {
  it("says where each person's spending shows and when to use Profiles instead", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const noop = vi.fn();
    act(() => root!.render(<ManageFamilyMembersDialog members={[]} onCancel={noop} onCreate={noop} onRename={noop} onDelete={noop} />));
    const text = document.body.textContent ?? "";
    expect(text).toContain("see each person's spending on the Household page");
    expect(text).toContain("To keep someone's money completely separate, use Profiles in Settings instead.");
    expect(text).not.toContain("within this one file");
  });
});
