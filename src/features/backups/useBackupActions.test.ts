import { describe, expect, it, vi } from "vitest";
import { useBackupActions } from "./useBackupActions";

vi.mock("../../shared/native/nativeDialog", () => ({ open: vi.fn() }));

const SECOND_COPY_FAILED =
  "The backup was saved, but its copy in your second backup folder couldn't be made. Check that the folder is still there and can be written to (Settings \u2192 Data \u2192 Automatic backups).";

describe("useBackupActions: Back up now", () => {
  const run = async (result: { filename: string; copied_to: string | null; copy_error: string | null }) => {
    const setStatus = vi.fn();
    const invoke = vi.fn(async () => result) as never;
    const actions = useBackupActions({ invoke, refreshBackups: async () => {}, setStatus, onDataFileChanged: vi.fn() });
    await actions.handleCreateBackupNow();
    return setStatus;
  };

  it("shows the second-copy problem exactly once, as the backend worded it", async () => {
    const setStatus = await run({ filename: "a.db", copied_to: null, copy_error: SECOND_COPY_FAILED });
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(SECOND_COPY_FAILED, "error");
  });

  it("says where the second copy went when it worked", async () => {
    const setStatus = await run({ filename: "a.db", copied_to: "D:\\Backups", copy_error: null });
    expect(setStatus).toHaveBeenCalledWith("Backup created and copied to D:\\Backups.", "success");
  });
});
