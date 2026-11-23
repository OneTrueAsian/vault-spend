//! Picks a loader by file extension so the Tauri command layer doesn't
//! need to know that CSV, OFX/QFX, and QIF are three different parsers —
//! `preview_import`/`commit_import` call this instead of
//! `csv_loader::load_csv` directly.
use crate::csv_loader::{self, ColumnMap, CsvInspection, LoadResult};
use crate::ofx_loader;
use crate::qif_loader;
use crate::xlsx_loader;
use std::io::Read;
use std::path::Path;

/// What older or macro-enabled Excel files get instead of being misread as text.
pub const UNSUPPORTED_WORKBOOK: &str = "Vault Spend imports Excel Workbook (.xlsx) files, not older .xls or macro-enabled .xlsm/.xlsb files. In Excel, choose Save As and pick Excel Workbook (.xlsx) or CSV UTF-8, then import that file.";

fn extension_of(name: &str) -> String {
    Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// Whether a file of this name has columns to match (a CSV or a workbook), as opposed to OFX/QFX/QIF's fixed fields.
pub fn has_columns(name: &str) -> bool {
    !matches!(extension_of(name).as_str(), "ofx" | "qfx" | "qif")
}

fn unsupported() -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, UNSUPPORTED_WORKBOOK)
}

/// A workbook read whole, reading at most one byte past the size limit (the reader refuses it).
fn read_workbook(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?.take(crate::folder_import::MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// `map` only applies to CSV and workbook files; OFX/QFX/QIF have fixed fields and ignore it.
pub fn load_transactions(path: impl AsRef<Path>, invert_amounts: bool, map: Option<&ColumnMap>) -> std::io::Result<LoadResult> {
    let path = path.as_ref();
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "ofx" | "qfx" => ofx_loader::load_ofx(path, invert_amounts),
        "qif" => qif_loader::load_qif(path, invert_amounts),
        "xlsx" => xlsx_loader::load_xlsx_bytes(&read_workbook(path)?, invert_amounts, map),
        "xls" | "xlsm" | "xlsb" => Err(unsupported()),
        _ => csv_loader::load_csv_with(path, invert_amounts, map),
    }
}

/// `load_transactions` for a saved copy of a watched-folder export: CSV or workbook, chosen by
/// its original file name.
pub fn load_transactions_from_bytes(file_name: &str, bytes: &[u8], invert_amounts: bool, map: Option<&ColumnMap>) -> std::io::Result<LoadResult> {
    match extension_of(file_name).as_str() {
        "xlsx" => xlsx_loader::load_xlsx_bytes(bytes, invert_amounts, map),
        "csv" => csv_loader::load_csv_bytes(bytes, invert_amounts, map),
        _ => Err(unsupported()),
    }
}

/// A CSV's or workbook's header row and sample rows for the column-matching step; `None` for
/// file types with fixed fields.
pub fn inspect_columns(path: impl AsRef<Path>) -> std::io::Result<Option<CsvInspection>> {
    let path = path.as_ref();
    match extension_of(&path.to_string_lossy()).as_str() {
        "ofx" | "qfx" | "qif" => Ok(None),
        "xlsx" => xlsx_loader::inspect_xlsx_bytes(&read_workbook(path)?).map(Some),
        "xls" | "xlsm" | "xlsb" => Err(unsupported()),
        _ => csv_loader::inspect_csv(path).map(Some),
    }
}

/// `inspect_columns` for a saved copy.
pub fn inspect_columns_from_bytes(file_name: &str, bytes: &[u8]) -> std::io::Result<CsvInspection> {
    match extension_of(file_name).as_str() {
        "xlsx" => xlsx_loader::inspect_xlsx_bytes(bytes),
        "csv" => csv_loader::inspect_csv_bytes(bytes),
        _ => Err(unsupported()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(name: &str, content: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-importer-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::File::create(&path).unwrap().write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn import_extension_dispatch_routes_by_file_extension() {
        let csv_path = write_temp("routes_csv.csv", "Date,Description,Amount\n2026-08-05,Store,-10.00\n");
        let csv_result = load_transactions(&csv_path, false, None).unwrap();
        assert_eq!(csv_result.transactions.len(), 1);
        assert_eq!(csv_result.transactions[0].description, "Store");

        let ofx = "<STMTTRN>\n<DTPOSTED>20260805\n<TRNAMT>-10.00\n<NAME>Store\n</STMTTRN>\n";
        for name in ["routes_ofx.ofx", "routes_qfx.qfx"] {
            let path = write_temp(name, ofx);
            let result = load_transactions(&path, false, None).unwrap();
            assert_eq!(result.transactions.len(), 1, "extension {name} should route to the OFX loader");
        }

        let qif_path = write_temp("routes_qif.qif", "D08/05/2026\nT-10.00\nPStore\n^\n");
        let qif_result = load_transactions(&qif_path, false, None).unwrap();
        assert_eq!(qif_result.transactions.len(), 1);
        assert_eq!(qif_result.transactions[0].description, "Store");

        let unknown_path = write_temp("routes_unknown.txt", "Date,Description,Amount\n2026-08-05,Store,-10.00\n");
        let unknown_result = load_transactions(&unknown_path, false, None).unwrap();
        assert_eq!(unknown_result.transactions.len(), 1);
    }

    #[test]
    fn a_workbook_routes_to_the_workbook_reader_and_older_excel_files_are_refused_with_guidance() {
        use crate::xlsx_loader::tests::{C, workbook};
        let bytes = workbook(
            &[vec![C::T("Date"), C::T("Description"), C::T("Amount")], vec![C::T("2026-08-05"), C::T("Store"), C::N("-10")]],
            false,
            &[],
        );
        let dir = std::env::temp_dir().join(format!("vaultspend-importer-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("routes_book.XLSX");
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(load_transactions(&path, false, None).unwrap().transactions.len(), 1);
        assert_eq!(inspect_columns(&path).unwrap().unwrap().headers, vec!["Date", "Description", "Amount"]);
        assert_eq!(load_transactions_from_bytes("Bank_2026-08-05.xlsx", &bytes, false, None).unwrap().transactions.len(), 1);
        for name in ["old.xls", "macro.xlsm", "binary.xlsb"] {
            let path = write_temp(name, "not really");
            let message = load_transactions(&path, false, None).unwrap_err().to_string();
            assert!(message.contains("Excel Workbook (.xlsx)"), "{name}: {message}");
        }
        assert!(load_transactions_from_bytes("Bank_2026-08-05.ofx", b"", false, None).is_err());
        assert!(inspect_columns(write_temp("fixed.qif", "D08/05/2026\n")).unwrap().is_none());
        assert!(has_columns("a.XLSX") && has_columns("a.csv") && !has_columns("a.QFX"));
    }
}
