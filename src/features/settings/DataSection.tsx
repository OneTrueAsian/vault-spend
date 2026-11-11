import { cardAttr, SettingStar } from "../../shared/ui/SettingStar";
import { MoreInfo } from "../../shared/ui/MoreInfo";
import { type Backup } from "../../shared/lib/types";
import { useCardFeedback, Feedback } from "../../shared/ui/CardFeedback";
import { CopyablePath } from "../../shared/ui/CopyablePath";
import { BackupsBlock } from "../backups/BackupsBlock";

/** Where the data lives — the first card of Settings' Data group. */
export function DataFileBlock({
  dataFileLocation,
  onRelocateDataFile,
  onExportDatabase,
  onUseExistingDataFile,
}: {
  dataFileLocation: string | null;
  onRelocateDataFile: () => void;
  onExportDatabase: () => void;
  onUseExistingDataFile: () => void;
}) {
  const feedback = useCardFeedback("data-file");
  return (
    <div className="card" data-data-file {...cardAttr("data-file")}>
      <div className="card-head">
        <h2 className="reports-section-title">Data file</h2>
        <SettingStar id="data-file" />
      </div>
      <p className="modal-message-secondary">Everything you enter is saved in this file.</p>
      <CopyablePath path={dataFileLocation} />
      <div className="settings-action">
        <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onRelocateDataFile(); }}>
          Move data file
        </button>
        <p className="modal-message-secondary">
          Switches to a copy of your data in a folder you choose. Your old file is left where it is, untouched.
        </p>
      </div>
      <div className="settings-action">
        <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onExportDatabase(); }}>
          Export a copy
        </button>
        <p className="modal-message-secondary">
          Saves a full copy of your data to a file you choose. Doesn't change what Vault Spend is using now.{" "}
          <MoreInfo>Good for a backup on another drive, or to bring your data to another computer.</MoreInfo>
        </p>
      </div>
      <div className="settings-action">
        <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onUseExistingDataFile(); }}>
          Use existing file
        </button>
        <p className="modal-message-secondary">
          Opens a data file you already have. Opens as a new profile next to your current one.{" "}
          <MoreInfo>
            Use it when moving to a new computer, upgrading from an older version that used a different file name, or
            switching back to a file you exported earlier. The file is checked for real account and transaction data
            before it is used. It does the same as Settings → Profiles &amp; security → Profiles → Use existing file.
          </MoreInfo>
        </p>
      </div>
      <Feedback text={feedback.text} kind={feedback.kind} />
    </div>
  );
}

/** Settings' Data group: one card per task, rather than one large card with sub-headings. */
export function DataSection({
  dataFileLocation,
  onRelocateDataFile,
  onExportDatabase,
  onUseExistingDataFile,
  backups,
  onCreateBackupNow,
  onRestoreBackup,
  copyDir,
  onSetCopyDir,
  onBrowseCopyDir,
  onDownloadSetupTemplate,
  onImportSetupData,
  isProtected,
}: {
  dataFileLocation: string | null;
  onRelocateDataFile: () => void;
  onExportDatabase: () => void;
  onUseExistingDataFile: () => void;
  backups: Backup[];
  onCreateBackupNow: () => void;
  onRestoreBackup: (filename: string, password?: string) => void | Promise<void>;
  copyDir: string | null;
  onSetCopyDir: (dir: string | null) => void;
  onBrowseCopyDir: () => void;
  onDownloadSetupTemplate: () => void;
  onImportSetupData: () => void;
  isProtected: boolean;
}) {
  return (
    <>
      <DataFileBlock
        dataFileLocation={dataFileLocation}
        onRelocateDataFile={onRelocateDataFile}
        onExportDatabase={onExportDatabase}
        onUseExistingDataFile={onUseExistingDataFile}
      />
      <BackupsBlock
        backups={backups}
        onCreateBackupNow={onCreateBackupNow}
        onRestoreBackup={onRestoreBackup}
        isProtected={isProtected}
        copyDir={copyDir}
        onSetCopyDir={onSetCopyDir}
        onBrowseCopyDir={onBrowseCopyDir}
      />
      <SetupDataBlock onDownloadSetupTemplate={onDownloadSetupTemplate} onImportSetupData={onImportSetupData} />
    </>
  );
}

/** Bulk setup: fill in a spreadsheet template with accounts, categories,
 * budgets, goals and holdings, then import it — moved here from Reports, which
 * is now only for reading your numbers. The third block of the "Data" section. */
function SetupDataBlock({
  onDownloadSetupTemplate,
  onImportSetupData,
}: {
  onDownloadSetupTemplate: () => void;
  onImportSetupData: () => void;
}) {
  const feedback = useCardFeedback("setup-data");
  return (
    <div className="card" data-setup-data {...cardAttr("setup-data")}>
      <div className="card-head">
        <h2 className="reports-section-title">Setup data</h2>
        <SettingStar id="setup-data" />
      </div>
      <p className="modal-message-secondary">
        Setting up from scratch? Download the template, fill in your accounts, categories, budgets, goals and holdings,
        then import it in one go.
      </p>
      <div className="settings-actions">
        <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onDownloadSetupTemplate(); }}>
          Download setup template
        </button>
        <button type="button" onClick={() => { feedback.begin(); onImportSetupData(); }}>
          Import setup data
        </button>
      </div>
      <Feedback text={feedback.text} kind={feedback.kind} />
    </div>
  );
}
