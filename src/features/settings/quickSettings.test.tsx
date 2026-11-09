// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const getProfileUiState = vi.hoisted(() => vi.fn());
const setProfileUiState = vi.hoisted(() => vi.fn());
const getCurrentGeneration = vi.hoisted(() => vi.fn());
vi.mock("../../shared/lib/profileUiState", () => ({ getProfileUiState, setProfileUiState, getCurrentGeneration }));

import { DEFAULT_QUICK_SETTINGS, parseQuickSettings, serializeQuickSettings, useQuickSettings } from "./quickSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const known = (id: string) => ["mobile-snapshots", "password-protection", "backups", "theme", "a", "b", "c"].includes(id);

describe("parseQuickSettings", () => {
  it("gives the three defaults, in order, when nothing was saved", () => {
    expect(parseQuickSettings(null, known)).toEqual(["mobile-snapshots", "password-protection", "backups"]);
    expect([...DEFAULT_QUICK_SETTINGS]).toEqual(["mobile-snapshots", "password-protection", "backups"]);
  });

  it.each([["not json"], ['{"a":1}'], ["42"], ['["a",3]'], [""]])("falls back to the defaults for %s", (raw) => {
    expect(parseQuickSettings(raw, known)).toEqual(["mobile-snapshots", "password-protection", "backups"]);
  });

  it("drops ids that no longer exist and duplicates, keeping order", () => {
    expect(parseQuickSettings('["backups","gone","theme","backups"]', known)).toEqual(["backups", "theme"]);
  });

  it("treats an empty saved list as a choice, not as missing", () => {
    expect(parseQuickSettings("[]", known)).toEqual([]);
  });

  it("serializes as a JSON array", () => {
    expect(serializeQuickSettings(["a", "b"])).toBe('["a","b"]');
  });
});

describe("useQuickSettings", () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof useQuickSettings>;

  function Probe() {
    api = useQuickSettings(known);
    return null;
  }

  async function mount() {
    await act(async () => {
      root.render(<Probe />);
    });
  }

  beforeEach(() => {
    getProfileUiState.mockReset().mockResolvedValue(null);
    setProfileUiState.mockReset().mockResolvedValue(undefined);
    getCurrentGeneration.mockReset().mockResolvedValue(7);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("is null until the list has loaded, then the saved list", async () => {
    let resolve!: (v: string | null) => void;
    getProfileUiState.mockReturnValue(new Promise((r) => (resolve = r)));
    await act(async () => {
      root.render(<Probe />);
    });
    expect(api.ids).toBeNull();
    expect(getProfileUiState).toHaveBeenCalledWith("quick_settings");

    await act(async () => resolve('["theme"]'));
    expect(api.ids).toEqual(["theme"]);
    expect(api.has("theme")).toBe(true);
    expect(api.has("backups")).toBe(false);
  });

  it("shows the three defaults for a profile that never chose", async () => {
    await mount();
    expect(api.ids).toEqual(["mobile-snapshots", "password-protection", "backups"]);
  });

  it("add writes the list with the generation, and adding an id already there does not write", async () => {
    getProfileUiState.mockResolvedValue('["a"]');
    await mount();

    await act(async () => api.add("b"));
    expect(setProfileUiState).toHaveBeenCalledWith("quick_settings", '["a","b"]', 7);
    expect(api.ids).toEqual(["a", "b"]);

    setProfileUiState.mockClear();
    await act(async () => api.add("b"));
    expect(setProfileUiState).not.toHaveBeenCalled();
  });

  it("keeps the order added: add three, remove the middle, add one", async () => {
    getProfileUiState.mockResolvedValue("[]");
    await mount();
    await act(async () => api.add("a"));
    await act(async () => api.add("b"));
    await act(async () => api.add("c"));
    await act(async () => api.remove("b"));
    await act(async () => api.add("theme"));
    expect(api.ids).toEqual(["a", "c", "theme"]);
    expect(setProfileUiState).toHaveBeenLastCalledWith("quick_settings", '["a","c","theme"]', 7);
  });

  it("an emptied list is saved and stays empty", async () => {
    getProfileUiState.mockResolvedValue('["a"]');
    await mount();
    await act(async () => api.remove("a"));
    expect(setProfileUiState).toHaveBeenLastCalledWith("quick_settings", "[]", 7);
    expect(api.ids).toEqual([]);
  });

  it("a failed write says so in plain words and leaves the list as it was", async () => {
    getProfileUiState.mockResolvedValue('["a"]');
    await mount();
    setProfileUiState.mockRejectedValue(new Error("disk full"));

    await act(async () => api.add("b"));

    expect(api.ids).toEqual(["a"]);
    expect(api.error).toBe("Couldn't save your Quick settings. Try again.");
  });

  describe("saves that overlap", () => {
    /** A save the test settles itself, recording what it would have stored when it succeeds. The outcome can be chosen
     * before the save starts; it then takes effect when the save does. */
    function pendingSave(stored: { value: string | null }) {
      let value: string | null = null;
      let outcome: boolean | null = null;
      let resolve!: () => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
      const apply = () => {
        if (value === null || outcome === null) return;
        if (outcome) {
          stored.value = value;
          resolve();
        } else {
          reject(new Error("disk full"));
        }
      };
      return {
        promise,
        settle: (ok: boolean) => ((outcome = ok), apply()),
        remember: (v: string) => ((value = v), apply()),
      };
    }

    async function startTwoSaves(first: ReturnType<typeof pendingSave>, second: ReturnType<typeof pendingSave>) {
      const saves = [first, second];
      setProfileUiState.mockImplementation((_key: string, value: string) => {
        const save = saves.shift()!;
        save.remember(value);
        return save.promise;
      });
      getProfileUiState.mockResolvedValue("[]");
      await mount();
      await act(async () => {
        api.add("a");
        api.add("b");
      });
    }

    it("an older save that fails after a newer one succeeded does not undo the newer change", async () => {
      const stored = { value: null as string | null };
      const first = pendingSave(stored);
      const second = pendingSave(stored);
      await startTwoSaves(first, second);

      await act(async () => second.settle(true));
      await act(async () => first.settle(false));

      expect(api.ids).toEqual(["a", "b"]);
      expect(api.error).toBeNull();
      expect(stored.value).toBe('["a","b"]');
    });

    it("when both fail, the list goes back to what is saved, not to an unsaved in-between list", async () => {
      const stored = { value: null as string | null };
      const first = pendingSave(stored);
      const second = pendingSave(stored);
      await startTwoSaves(first, second);

      await act(async () => first.settle(false));
      await act(async () => second.settle(false));

      expect(api.ids).toEqual([]);
      expect(api.error).toBe("Couldn't save your Quick settings. Try again.");
    });

    it("saves reach storage in the order they were made, so a slow earlier one cannot overwrite a later one", async () => {
      const stored = { value: null as string | null };
      const first = pendingSave(stored);
      const second = pendingSave(stored);
      await startTwoSaves(first, second);

      await act(async () => second.settle(true));
      await act(async () => first.settle(true));

      expect(stored.value).toBe('["a","b"]');
      expect(api.ids).toEqual(["a", "b"]);
    });
  });

  it("a failed read falls back to the defaults", async () => {
    getProfileUiState.mockRejectedValue(new Error("locked"));
    await mount();
    expect(api.ids).toEqual(["mobile-snapshots", "password-protection", "backups"]);
  });

  it("does not update state after unmount while the read is pending", async () => {
    let resolve!: (v: string | null) => void;
    getProfileUiState.mockReturnValue(new Promise((r) => (resolve = r)));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      root.render(<Probe />);
    });
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => resolve('["a"]'));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
