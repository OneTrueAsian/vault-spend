// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { FolderActivityDialog, exportDates } from "./FolderActivityDialog";
import { folderImportsClient, type FolderActivity, type FolderBatch } from "./folderImportsApi";
import type { FolderImportsState } from "./useFolderImports";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pendingBatch: FolderBatch = {
  id: 5,
  file_name: "Bank Max Checking_2026-11-18.csv",
  account_id: 2,
  account_name: "Max Checking",
  export_start: "2026-11-11",
  export_end: "2026-11-18",
  detected_at: "2026-11-22T10:00:00",
  status: "pending",
  row_version: 1,
  source_present: false,
  invert_amounts: false,
};

const reviewedAgain: FolderBatch = { ...pendingBatch, id: 9, file_name: "Bank Max Checking_2026-11-01.csv", export_start: "2026-11-01", export_end: "2026-11-01", row_version: 3 };

const activity: FolderActivity[] = [
  { id: 30, at: "2026-11-22T10:01:00", file_name: reviewedAgain.file_name, account_name: "Max Checking", outcome: "already_dismissed", reason: "Dismissed earlier — not queued again", batch_id: 9, can_review_again: true, copy_cleared: false },
  { id: 29, at: "2026-11-22T10:00:00", file_name: "Bank Max Checking_2026-10-01.csv", account_name: "Max Checking", outcome: "older", reason: "Older export — not queued (dated before Nov 1, 2026)", batch_id: null, can_review_again: true, copy_cleared: false },
  { id: 28, at: "2026-11-22T09:00:00", file_name: "Bank Max Checking_2026-13-01.csv", account_name: "Max Checking", outcome: "bad_name", reason: "The date at the end of the name isn't a real date", batch_id: null, can_review_again: false, copy_cleared: false },
];

function state(call: (command: string, args?: Record<string, unknown>) => Promise<unknown>): FolderImportsState {
  return {
    data: { enabled: false, folder: "D:\\Exports", folder_missing: false, mappings: [], pending: [pendingBatch], seen_activity_id: 0 },
    activity,
    error: null,
    refresh: vi.fn(async () => undefined),
    client: folderImportsClient(call as never),
    pendingCount: 1,
    configured: true,
    skippedSinceSeen: 0,
    markActivitySeen: async () => undefined,
  };
}

describe("FolderActivityDialog", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => cleanup?.());

  function render(s: FolderImportsState, onReview = vi.fn()) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<FolderActivityDialog state={s} busy={false} onReview={onReview} onManage={() => undefined} onClose={() => undefined} />));
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    return { onReview };
  }

  const q = (selector: string) => document.querySelector<HTMLButtonElement>(selector);

  it("lists what is waiting, says it is paused, and explains each skipped file", () => {
    render(state(vi.fn()));
    expect(document.querySelector("[data-folder-paused]")).not.toBeNull();
    const pending = document.querySelector("[data-folder-pending='5']")!.textContent!;
    expect(pending).toContain("Bank Max Checking_2026-11-18.csv");
    expect(pending).toContain("saved copy kept");
    const text = document.querySelector("[data-folder-activity-list]")!.textContent!;
    expect(text).toContain("Older export — not queued");
    expect(text).toContain("Name not recognised");
    expect(q("[data-folder-review-again='28']")).toBeNull();
  });

  it("says each outcome once, leaves out a still-waiting file's queued entry, and names the file on every button", () => {
    const s = state(vi.fn());
    s.activity = [
      { id: 31, at: "2026-11-22T10:00:00", file_name: pendingBatch.file_name, account_name: "Max Checking", outcome: "queued", reason: "Waiting for your review", batch_id: 5, can_review_again: false, copy_cleared: false },
      ...activity,
    ];
    render(s);
    const list = document.querySelector("[data-folder-activity-list]")!;
    expect(list.textContent).not.toContain("Older export — Older export");
    expect(list.textContent).toContain("Older export — not queued");
    expect(list.querySelector("[data-folder-activity-entry='queued']")).toBeNull();
    expect(document.querySelector("[data-folder-activity]")!.textContent).toContain("3 recent entries shown");
    expect(q("[data-folder-review='5']")!.getAttribute("aria-label")).toBe("Review Bank Max Checking_2026-11-18.csv");
    expect(q("[data-folder-dismiss='5']")!.getAttribute("aria-label")).toBe("Dismiss Bank Max Checking_2026-11-18.csv");
    expect(q("[data-folder-review-again='30']")!.getAttribute("aria-label")).toBe("Review again Bank Max Checking_2026-11-01.csv");
  });

  it("calls a past queued entry what happened then, without repeating itself", () => {
    const s = state(vi.fn());
    s.activity = [
      { id: 50, at: "2026-11-22T10:00:00", file_name: "Bank Max Checking_2026-11-05.csv", account_name: "Max Checking", outcome: "queued", reason: "Waiting for your review", batch_id: 77, can_review_again: true, copy_cleared: false },
    ];
    render(s);
    const text = document.querySelector("[data-folder-activity-entry='queued']")!.textContent!;
    expect(text).toContain("Queued for review");
    expect(text).not.toContain("Waiting");
  });

  it("names a folder that can be read again, and says why an old export can't be reviewed again", () => {
    const s = state(vi.fn());
    s.activity = [
      { id: 41, at: "2026-11-22T11:00:00", file_name: "Exports", account_name: null, outcome: "folder_ok", reason: "The folder can be read again.", batch_id: null, can_review_again: false, copy_cleared: false },
      { id: 40, at: "2026-11-22T10:00:00", file_name: "Bank Max Checking_2026-09-01.csv", account_name: "Max Checking", outcome: "imported", reason: "Imported 3 transactions", batch_id: 2, can_review_again: false, copy_cleared: true },
    ];
    render(s);
    const list = document.querySelector("[data-folder-activity-list]")!;
    expect(list.querySelector("[data-folder-activity-entry='folder_ok']")!.textContent).toContain("Folder found again");
    expect(list.querySelector("[data-folder-copy-cleared='40']")!.textContent).toContain("Import transactions");
  });

  it("labels a file already waiting under another name and a date in the future", () => {
    const s = state(vi.fn());
    s.activity = [
      { id: 61, at: "2026-11-22T11:00:00", file_name: "Bank Max Checking_2026-11-19.csv", account_name: "Max Checking", outcome: "already_pending", reason: 'Same file as "Bank Max Checking_2026-11-18.csv", which is already waiting for review — not queued twice', batch_id: null, can_review_again: false, copy_cleared: false },
      { id: 60, at: "2026-11-22T10:00:00", file_name: "Bank Max Checking_2099-01-01.csv", account_name: "Max Checking", outcome: "future_date", reason: "The date in the name is in the future", batch_id: null, can_review_again: false, copy_cleared: false },
    ];
    render(s);
    const list = document.querySelector("[data-folder-activity-list]")!;
    expect(list.querySelector("[data-folder-activity-entry='already_pending']")!.textContent).toContain("Already waiting");
    const future = list.querySelector("[data-folder-activity-entry='future_date']")!.textContent!;
    expect(future).toContain("Date in the future");
    expect(future).not.toContain("Noted");
    expect(future).not.toContain("Name not recognised");
  });

  it("explains which files are picked up when nothing has been looked at yet", () => {
    const s = state(vi.fn());
    s.activity = [];
    render(s);
    expect(document.querySelector("[data-folder-activity]")!.textContent).toContain(
      "No files have been looked at yet. Only files whose names start with one of your export names are picked up.",
    );
  });

  it("offers Review again only on the newest entry for each file, keeping the older rows", () => {
    const s = state(vi.fn());
    s.activity = [
      { id: 72, at: "2026-11-22T12:00:00", file_name: "A.csv", account_name: "Max Checking", outcome: "dismissed", reason: "Dismissed", batch_id: 1, can_review_again: true, copy_cleared: false },
      { id: 71, at: "2026-11-22T11:00:00", file_name: "A.csv", account_name: "Max Checking", outcome: "older", reason: "Older export", batch_id: null, can_review_again: true, copy_cleared: false },
      { id: 70, at: "2026-11-22T10:00:00", file_name: "B.csv", account_name: "Max Checking", outcome: "requeued", reason: "Opened again", batch_id: 2, can_review_again: false, copy_cleared: false },
      { id: 69, at: "2026-11-22T09:00:00", file_name: "B.csv", account_name: "Max Checking", outcome: "older", reason: "Older export", batch_id: null, can_review_again: true, copy_cleared: false },
    ];
    render(s);
    expect(document.querySelectorAll("[data-folder-activity-entry]").length).toBe(4);
    expect(q("[data-folder-review-again='72']")).not.toBeNull();
    expect(q("[data-folder-review-again='71']")).toBeNull();
    expect(q("[data-folder-review-again='69']")).toBeNull();
  });

  it("counts a hidden queued entry of a waiting file as that file's newest entry", () => {
    const s = state(vi.fn());
    s.activity = [
      { id: 81, at: "2026-11-22T11:00:00", file_name: pendingBatch.file_name, account_name: "Max Checking", outcome: "queued", reason: "Waiting for your review", batch_id: 5, can_review_again: false, copy_cleared: false },
      { id: 80, at: "2026-11-22T10:00:00", file_name: pendingBatch.file_name, account_name: "Max Checking", outcome: "dismissed", reason: "Dismissed", batch_id: 5, can_review_again: true, copy_cleared: false },
    ];
    render(s);
    expect(q("[data-folder-review-again='80']")).toBeNull();
  });

  it("offers to choose the folder again when it can't be found", () => {
    const s = state(vi.fn());
    s.data = { ...s.data!, folder_missing: true };
    const onManage = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<FolderActivityDialog state={s} busy={false} onReview={vi.fn()} onManage={onManage} onClose={() => undefined} />));
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    act(() => q("[data-folder-choose-again]")!.click());
    expect(onManage).toHaveBeenCalled();
  });

  it("Review again asks for that one file and opens its review in the same click, approving nothing", async () => {
    const call = vi.fn(async (command: string) => (command === "review_folder_import_again" ? reviewedAgain : undefined));
    const { onReview } = render(state(call));
    await act(async () => q("[data-folder-review-again='30']")!.click());
    expect(call).toHaveBeenCalledWith("review_folder_import_again", { activityId: 30 });
    expect(onReview).toHaveBeenCalledWith(reviewedAgain);
    expect(call.mock.calls.some(([c]) => String(c).startsWith("commit"))).toBe(false);
  });

  it("Review opens the waiting export directly and Dismiss dismisses only it", async () => {
    const call = vi.fn(async () => undefined);
    const s = state(call);
    const { onReview } = render(s);
    act(() => q("[data-folder-review='5']")!.click());
    expect(onReview).toHaveBeenCalledWith(pendingBatch);
    await act(async () => q("[data-folder-dismiss='5']")!.click());
    expect(call).toHaveBeenCalledWith("dismiss_folder_import", { batchId: 5 });
    expect(s.refresh).toHaveBeenCalled();
    expect(document.querySelector("[role='status']")!.textContent).toContain("Review again");
  });

  it("shows why Review again could not open a file", async () => {
    const call = vi.fn(async () => {
      throw new Error("The file is no longer in the watched folder.");
    });
    const { onReview } = render(state(call));
    await act(async () => q("[data-folder-review-again='29']")!.click());
    expect(onReview).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("no longer in the watched folder");
  });
});

describe("exportDates", () => {
  it("names both years when a range crosses New Year, and leaves the current year out otherwise", () => {
    const year = new Date().getFullYear();
    expect(exportDates({ export_start: `${year - 1}-12-28`, export_end: `${year}-01-04` })).toBe(`Dec 28, ${year - 1} to Jan 4, ${year}`);
    expect(exportDates({ export_start: `${year}-11-16`, export_end: `${year}-11-23` })).toBe("Nov 16 to Nov 23");
    expect(exportDates({ export_start: "2024-03-01", export_end: "2024-03-08" })).toBe("Mar 1, 2024 to Mar 8, 2024");
  });
});

describe("folder import replies", () => {
  it("refuses a malformed reply instead of showing it", async () => {
    const client = folderImportsClient((async () => ({ enabled: "yes" })) as never);
    await expect(client.get()).rejects.toThrow("unexpected reply");
    const batchClient = folderImportsClient((async () => ({ ...pendingBatch, export_end: "18/11/2026" })) as never);
    await expect(batchClient.reviewAgain(1)).rejects.toThrow("unexpected reply");
  });
});
