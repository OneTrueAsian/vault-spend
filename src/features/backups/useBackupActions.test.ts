import { describe, expect, it, vi } from "vitest";
import { useBackupActions } from "./useBackupActions";
import { ERROR_DETAIL_SEPARATOR } from "../../shared/lib/errorMessage";

vi.mock("../../shared/native/nativeDialog", () => ({ open: vi.fn() }));
vi.mock("../../shared/lib/profileUiState", () => ({ getCurrentGeneration: async () => 1 }));

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

// VS-71: a backup, restore or second-folder failure keeps its technical cause for the status line's Details.
describe("useBackupActions: failures keep their cause", () => {
  const failed = `The backup wasn't saved.${ERROR_DETAIL_SEPARATOR}couldn't write the backup: Access is denied. (os error 5)`;
  const actions = (invoke: () => Promise<unknown>) => {
    const setStatus = vi.fn();
    return { setStatus, actions: useBackupActions({ invoke: invoke as never, refreshBackups: async () => {}, setStatus, onDataFileChanged: vi.fn() }) };
  };

  it("passes the cause on when Back up now, the second folder or a restore fails", async () => {
    for (const run of [
      (a: ReturnType<typeof useBackupActions>) => a.handleCreateBackupNow(),
      (a: ReturnType<typeof useBackupActions>) => a.handleSetBackupCopyDir("E:/Backups"),
      (a: ReturnType<typeof useBackupActions>) => a.handleRestoreBackup("vaultspend-20260101-000000.db"),
    ]) {
      const { setStatus, actions: a } = actions(async () => { throw failed; });
      await run(a);
      expect(setStatus).toHaveBeenCalledWith(failed);
    }
  });

  it("keeps the second-copy problem's cause too", async () => {
    const copyFailed = `${SECOND_COPY_FAILED}${ERROR_DETAIL_SEPARATOR}second backup copy failed: (os error 3)`;
    const { setStatus, actions: a } = actions(async () => ({ filename: "a.db", copied_to: null, copy_error: copyFailed }));
    await a.handleCreateBackupNow();
    expect(setStatus).toHaveBeenCalledWith(copyFailed, "error");
  });
});
