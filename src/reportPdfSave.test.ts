import { beforeEach, expect, it, vi } from "vitest";
import { save } from "./nativeDialog";
import { createReportPdfSaver } from "./reportPdfSave";

vi.mock("./nativeDialog", () => ({ save: vi.fn() }));

const call = vi.fn();
const status = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(save).mockResolvedValue("C:\\Reports\\q3.pdf");
  call.mockResolvedValue(null);
});

it("asks where to save a .pdf with a dated default name, then has the app write the report there", async () => {
  await createReportPdfSaver({ call, onStatus: status, today: () => "2026-10-28" })();

  expect(save).toHaveBeenCalledWith({ defaultPath: "Vault Spend report 2026-10-28.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
  expect(call).toHaveBeenCalledWith("save_report_pdf", { path: "C:\\Reports\\q3.pdf" });
  expect(status).toHaveBeenCalledWith("Saved the report as a PDF to C:\\Reports\\q3.pdf.", "success");
});

it("does nothing when the save window is cancelled", async () => {
  vi.mocked(save).mockResolvedValue(null);

  await createReportPdfSaver({ call, onStatus: status, today: () => "2026-10-28" })();

  expect(call).not.toHaveBeenCalled();
  expect(status).not.toHaveBeenCalled();
});

it("says so, in plain words, when the PDF could not be saved", async () => {
  call.mockRejectedValue("The folder for that file does not exist.");

  await createReportPdfSaver({ call, onStatus: status, today: () => "2026-10-28" })();

  expect(status).toHaveBeenCalledWith("The folder for that file does not exist.");
});
