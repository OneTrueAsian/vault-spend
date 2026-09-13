//! Picks a loader by file extension so the Tauri command layer doesn't
//! need to know that CSV, OFX/QFX, and QIF are three different parsers —
//! `preview_import`/`commit_import` call this instead of
//! `csv_loader::load_csv` directly.
use crate::csv_loader::{self, LoadResult};
use crate::ofx_loader;
use crate::qif_loader;
use std::path::Path;

pub fn load_transactions(path: impl AsRef<Path>, invert_amounts: bool) -> std::io::Result<LoadResult> {
    let path = path.as_ref();
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "ofx" | "qfx" => ofx_loader::load_ofx(path, invert_amounts),
        "qif" => qif_loader::load_qif(path, invert_amounts),
        _ => csv_loader::load_csv(path, invert_amounts),
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
        let csv_result = load_transactions(&csv_path, false).unwrap();
        assert_eq!(csv_result.transactions.len(), 1);
        assert_eq!(csv_result.transactions[0].description, "Store");

        let ofx = "<STMTTRN>\n<DTPOSTED>20260805\n<TRNAMT>-10.00\n<NAME>Store\n</STMTTRN>\n";
        for name in ["routes_ofx.ofx", "routes_qfx.qfx"] {
            let path = write_temp(name, ofx);
            let result = load_transactions(&path, false).unwrap();
            assert_eq!(result.transactions.len(), 1, "extension {name} should route to the OFX loader");
        }

        let qif_path = write_temp("routes_qif.qif", "D08/05/2026\nT-10.00\nPStore\n^\n");
        let qif_result = load_transactions(&qif_path, false).unwrap();
        assert_eq!(qif_result.transactions.len(), 1);
        assert_eq!(qif_result.transactions[0].description, "Store");

        let unknown_path = write_temp("routes_unknown.txt", "Date,Description,Amount\n2026-08-05,Store,-10.00\n");
        let unknown_result = load_transactions(&unknown_path, false).unwrap();
        assert_eq!(unknown_result.transactions.len(), 1);
    }
}
