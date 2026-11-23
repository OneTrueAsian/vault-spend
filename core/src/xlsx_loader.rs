//! Reading a bank's `.xlsx` workbook export (VS-102) through the same row pipeline as a CSV: the
//! first worksheet's cells become text rows, and `csv_loader` finds the columns, applies a saved
//! column choice and the sign answer, and reports unreadable rows exactly as for a CSV.
//!
//! Safety policy: the workbook is read as data only. Nothing in it is executed. A workbook holding
//! any formula is refused (cached formula results are not trusted as bank amounts), as is one with
//! a macro project. The archive is checked against size limits before any part is parsed. Amounts
//! from number cells must have at most two decimal places; they are never rounded.

use crate::csv_loader::{self, ColumnMap, CsvInspection, LoadResult};
use crate::folder_import::MAX_FILE_BYTES;
use std::io::{Cursor, Read};

/// The most bytes all the workbook's parts may expand to.
const MAX_EXPANDED_BYTES: u64 = 64 * 1024 * 1024;
/// The most parts a workbook archive may have.
const MAX_ENTRIES: usize = 10_000;
/// The most cells read from the sheet.
const MAX_CELLS: usize = 2_000_000;

fn invalid(message: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message.to_string())
}

const NOT_A_WORKBOOK: &str = "This file can't be opened as an Excel workbook. If it has a password, remove it in Excel; otherwise save it again as an Excel Workbook (.xlsx) or CSV UTF-8 and import that.";
const HAS_FORMULAS: &str = "This workbook has formulas, and Vault Spend only imports plain values. In Excel, copy the sheet and paste it as values (or save it as CSV UTF-8), then import that file.";
const HAS_MACROS: &str = "This workbook contains macros, so it isn't imported. Save it as an Excel Workbook (.xlsx) without macros, or as CSV UTF-8, and import that.";
const TOO_BIG: &str = "This workbook is too big to import (over 10 MB, or it expands to more than 64 MB). Export a shorter date range from your bank and import that.";
const TOO_WIDE: &str = "This workbook has something in a cell far to the right of the transactions. Delete the extra columns in Excel (or save it as CSV UTF-8) and import that.";
const NO_SHEET: &str = "This workbook has no worksheet with rows to import.";

/// Checks the archive before parsing: its size, how much it expands to, no macro project and no
/// formulas in any worksheet. Reads at most the declared sizes, so a lying archive can't expand
/// past the limit.
fn check_archive(bytes: &[u8]) -> std::io::Result<()> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(invalid(TOO_BIG));
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid(NOT_A_WORKBOOK))?;
    if archive.len() > MAX_ENTRIES {
        return Err(invalid(TOO_BIG));
    }
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|_| invalid(NOT_A_WORKBOOK))?;
        if entry.encrypted() {
            return Err(invalid(NOT_A_WORKBOOK));
        }
        total = total.saturating_add(entry.size());
        if total > MAX_EXPANDED_BYTES {
            return Err(invalid(TOO_BIG));
        }
        let name = entry.name().unwrap_or_default().replace('\\', "/").to_ascii_lowercase();
        if name.ends_with("vbaproject.bin") {
            return Err(invalid(HAS_MACROS));
        }
        if name.starts_with("xl/worksheets/") && name.ends_with(".xml") {
            let mut xml = Vec::new();
            let limit = entry.size().min(MAX_EXPANDED_BYTES) + 1;
            (&mut entry).take(limit).read_to_end(&mut xml).map_err(|_| invalid(NOT_A_WORKBOOK))?;
            if xml.len() as u64 > entry.size() {
                return Err(invalid(TOO_BIG));
            }
            if has_formula_element(&xml) {
                return Err(invalid(HAS_FORMULAS));
            }
        }
    }
    Ok(())
}

/// Whether worksheet XML has an `<f>` element (with or without a namespace prefix), including the
/// empty `<f t="shared" .../>` form that refers to another cell's formula.
fn has_formula_element(xml: &[u8]) -> bool {
    let is_end = |c: &u8| matches!(c, b'>' | b' ' | b'/' | b'\t' | b'\r' | b'\n');
    let mut from = 0;
    while let Some(offset) = xml[from..].iter().position(|&c| c == b'<') {
        let start = from + offset + 1;
        let end = xml[start..].iter().position(is_end).map_or(xml.len(), |e| start + e);
        let name = &xml[start..end];
        let local = name.rsplit(|&c| c == b':').next().unwrap_or(name);
        if local == b"f" && end < xml.len() {
            return true;
        }
        from = start;
    }
    false
}

/// The first worksheet as text rows, with each row's number in the sheet. Empty rows are skipped,
/// like blank lines in a CSV.
fn sheet_rows(bytes: &[u8]) -> std::io::Result<(Vec<csv::StringRecord>, Vec<usize>)> {
    use office_oxide::xlsx::{CellValue, DateTimeValue, XlsxDocument, date::is_date_cell};
    check_archive(bytes)?;
    let doc = XlsxDocument::from_reader(Cursor::new(bytes)).map_err(|_| invalid(NOT_A_WORKBOOK))?;
    let sheet = doc.worksheets.first().ok_or_else(|| invalid(NO_SHEET))?;
    let cells: usize = sheet.rows.iter().map(|r| r.cells.len()).sum();
    if cells > MAX_CELLS {
        return Err(invalid(TOO_BIG));
    }
    let date1904 = doc.workbook.date1904;
    let text = |value: &CellValue, style: Option<u32>| -> String {
        match value {
            CellValue::Empty => String::new(),
            CellValue::String(s) => s.clone(),
            CellValue::SharedString(i) => doc.shared_strings.get(*i).unwrap_or_default().to_string(),
            CellValue::Boolean(b) => b.to_string(),
            CellValue::Error(e) => e.clone(),
            CellValue::Date(d) => format!("{:04}-{:02}-{:02}", d.year, d.month, d.day),
            CellValue::Number(n) if is_date_cell(style, doc.styles.as_ref()) => match DateTimeValue::from_serial(*n, date1904) {
                Some(d) => format!("{:04}-{:02}-{:02}", d.year, d.month, d.day),
                None => n.to_string(),
            },
            // Rust prints the shortest text that reads back as the same number, never in exponent form.
            CellValue::Number(n) => n.to_string(),
        }
    };
    let width = sheet
        .rows
        .iter()
        .flat_map(|r| r.cells.iter().map(|c| c.reference.col as usize + 1))
        .max()
        .unwrap_or(0);
    // Every row is padded to the widest one, so one stray cell far to the right would otherwise
    // multiply the memory used by every row.
    if width.saturating_mul(sheet.rows.len()) > MAX_CELLS {
        return Err(invalid(TOO_WIDE));
    }
    let mut records = Vec::new();
    let mut numbers = Vec::new();
    for row in &sheet.rows {
        let mut cells = vec![String::new(); width];
        for cell in &row.cells {
            if let Some(slot) = cells.get_mut(cell.reference.col as usize) {
                *slot = text(&cell.value, cell.style_index);
            }
        }
        if cells.iter().all(|c| c.trim().is_empty()) {
            continue;
        }
        records.push(csv::StringRecord::from(cells));
        numbers.push(row.index as usize);
    }
    Ok((records, numbers))
}

/// Loads a workbook's transactions the way `csv_loader::load_csv_with` loads a CSV's.
pub fn load_xlsx_bytes(bytes: &[u8], invert_amounts: bool, map: Option<&ColumnMap>) -> std::io::Result<LoadResult> {
    let (records, numbers) = sheet_rows(bytes)?;
    csv_loader::load_records(records, Some(numbers), invert_amounts, map, true)
}

/// A workbook's header row and first rows, as `csv_loader::inspect_csv` reports a CSV's.
pub fn inspect_xlsx_bytes(bytes: &[u8]) -> std::io::Result<CsvInspection> {
    let (records, _) = sheet_rows(bytes)?;
    csv_loader::inspect_records(records)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use rust_decimal::Decimal;
    use std::io::Write;
    use std::str::FromStr;
    use zip::write::SimpleFileOptions;

    /// A cell in a test sheet: text, a number, or a date-styled number.
    pub enum C<'a> {
        T(&'a str),
        N(&'a str),
        D(u32),
        F(&'a str, &'a str),
        /// Text in the sheet's last column (XFD).
        Far(&'a str),
    }

    /// A minimal workbook with one sheet of `rows`. Style 1 is the built-in short date format.
    pub fn workbook(rows: &[Vec<C>], date1904: bool, extra: &[(&str, &[u8])]) -> Vec<u8> {
        let mut sheet = String::from(r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#);
        for (r, row) in rows.iter().enumerate() {
            sheet.push_str(&format!(r#"<row r="{}">"#, r + 1));
            for (c, cell) in row.iter().enumerate() {
                let reference = format!("{}{}", (b'A' + c as u8) as char, r + 1);
                match cell {
                    C::T(t) => sheet.push_str(&format!(r#"<c r="{reference}" t="inlineStr"><is><t>{t}</t></is></c>"#)),
                    C::N(n) => sheet.push_str(&format!(r#"<c r="{reference}"><v>{n}</v></c>"#)),
                    C::D(serial) => sheet.push_str(&format!(r#"<c r="{reference}" s="1"><v>{serial}</v></c>"#)),
                    C::F(f, v) => sheet.push_str(&format!(r#"<c r="{reference}"><f>{f}</f><v>{v}</v></c>"#)),
                    C::Far(t) => sheet.push_str(&format!(r#"<c r="XFD{}" t="inlineStr"><is><t>{t}</t></is></c>"#, r + 1)),
                }
            }
            sheet.push_str("</row>");
        }
        sheet.push_str("</sheetData></worksheet>");
        let workbook = format!(
            r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">{}<sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
            if date1904 { r#"<workbookPr date1904="1"/>"# } else { "" }
        );
        let rels = r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#;
        let styles = r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>"#;
        let types = r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>"#;
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let mut entries: Vec<(&str, &[u8])> = vec![
            ("[Content_Types].xml", types.as_bytes()),
            ("xl/workbook.xml", workbook.as_bytes()),
            ("xl/_rels/workbook.xml.rels", rels.as_bytes()),
            ("xl/styles.xml", styles.as_bytes()),
            ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
        ];
        entries.extend_from_slice(extra);
        for (name, data) in entries {
            zip.start_file(name, SimpleFileOptions::default()).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn dec(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    #[test]
    fn a_workbook_with_lowercase_reordered_headers_and_date_cells_loads_through_the_csv_rules() {
        // 46343 = 2026-11-17 in the 1900 system.
        let bytes = workbook(
            &[
                vec![C::T("bank"), C::T("amount"), C::T("description"), C::T("date"), C::T("pending")],
                vec![C::T("Practice"), C::N("12.5"), C::T("Corner Cafe"), C::D(46343), C::T("false")],
                vec![],
                vec![C::T("Practice"), C::N("-1500"), C::T("Payroll"), C::T("2026-11-18"), C::T("TRUE")],
            ],
            false,
            &[],
        );
        let result = load_xlsx_bytes(&bytes, true, None).unwrap();
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        assert_eq!(result.transactions.len(), 2);
        assert_eq!(result.transactions[0].date.to_string(), "2026-11-17");
        assert_eq!(result.transactions[0].amount, dec("-12.5"));
        assert_eq!(result.transactions[1].amount, dec("1500"));
        assert_eq!(result.source_pending, vec![false, true]);
        assert_eq!(result.headers, vec!["bank", "amount", "description", "date", "pending"]);
    }

    #[test]
    fn the_1904_date_system_is_honoured() {
        // 44881 in the 1904 system is 2026-11-17 (1462 days fewer than the 1900 serial).
        let bytes = workbook(
            &[vec![C::T("Date"), C::T("Description"), C::T("Amount")], vec![C::D(44881), C::T("Cafe"), C::N("-4")]],
            true,
            &[],
        );
        let result = load_xlsx_bytes(&bytes, false, None).unwrap();
        assert_eq!(result.transactions[0].date.to_string(), "2026-11-17");
    }

    #[test]
    fn an_amount_finer_than_a_cent_is_a_row_problem_not_rounded() {
        let bytes = workbook(
            &[
                vec![C::T("Date"), C::T("Description"), C::T("Amount")],
                vec![C::T("2026-11-17"), C::T("Cafe"), C::N("-4.125")],
                vec![C::T("2026-11-17"), C::T("Float noise"), C::N("12.499999999999998")],
                vec![C::T("2026-11-17"), C::T("Fine"), C::N("-3.1")],
            ],
            false,
            &[],
        );
        let result = load_xlsx_bytes(&bytes, false, None).unwrap();
        assert_eq!(result.transactions.len(), 1);
        assert_eq!(result.transactions[0].amount, dec("-3.1"));
        assert_eq!(result.errors.iter().map(|e| e.row_number).collect::<Vec<_>>(), vec![2, 3]);
        assert_eq!(
            crate::row_problem::plain_row_reason(&result.errors[0].message),
            "The amount -4.125 has more decimal places than money uses."
        );
    }

    #[test]
    fn formulas_macros_and_non_workbooks_are_refused_with_guidance() {
        let formula = workbook(
            &[vec![C::T("Date"), C::T("Description"), C::T("Amount")], vec![C::T("2026-11-17"), C::T("Cafe"), C::F("1+1", "2")]],
            false,
            &[],
        );
        assert!(load_xlsx_bytes(&formula, false, None).unwrap_err().to_string().contains("formulas"));
        let macros = workbook(&[vec![C::T("Date")]], false, &[("xl/vbaProject.bin", b"macro")]);
        assert!(load_xlsx_bytes(&macros, false, None).unwrap_err().to_string().contains("macros"));
        for junk in [&b"Date,Description,Amount\n"[..], b"\xD0\xCF\x11\xE0 an old or password-protected workbook"] {
            assert!(load_xlsx_bytes(junk, false, None).unwrap_err().to_string().contains("can't be opened as an Excel workbook"));
        }
    }

    #[test]
    fn a_shared_formula_reference_counts_as_a_formula() {
        assert!(has_formula_element(br#"<c r="B2"><f t="shared" si="0"/><v>2</v></c>"#));
        assert!(has_formula_element(br#"<x:c r="B2"><x:f>A1</x:f></x:c>"#));
        assert!(!has_formula_element(br#"<c r="B2"><v>2</v></c><font/>"#));
    }

    #[test]
    fn a_stray_cell_far_to_the_right_is_refused_instead_of_padding_every_row() {
        let mut rows: Vec<Vec<C>> = vec![vec![C::T("Date"), C::T("Description"), C::T("Amount")]];
        for _ in 0..200 {
            rows.push(vec![C::T("2026-11-17"), C::T("Cafe"), C::N("-4")]);
        }
        rows.push(vec![C::Far("stray")]);
        let bytes = workbook(&rows, false, &[]);
        let err = load_xlsx_bytes(&bytes, false, None).unwrap_err().to_string();
        assert!(err.contains("far to the right"), "{err}");
        assert!(inspect_xlsx_bytes(&bytes).is_err());
    }

    #[test]
    fn an_archive_that_expands_too_far_is_refused_before_parsing() {
        let huge = vec![b' '; (MAX_EXPANDED_BYTES + 1) as usize];
        let bytes = workbook(&[vec![C::T("Date")]], false, &[("xl/media/padding.bin", &huge)]);
        assert!(bytes.len() as u64 <= MAX_FILE_BYTES, "compressed it is small");
        assert!(load_xlsx_bytes(&bytes, false, None).unwrap_err().to_string().contains("too big"));
    }

    #[test]
    fn inspection_offers_the_headers_for_column_matching() {
        let bytes = workbook(
            &[vec![C::T("Posted"), C::T("Memo"), C::T("Amt")], vec![C::T("2026-11-17"), C::T("Cafe"), C::N("-4")]],
            false,
            &[],
        );
        let inspection = inspect_xlsx_bytes(&bytes).unwrap();
        assert_eq!(inspection.headers, vec!["Posted", "Memo", "Amt"]);
        assert_eq!(inspection.sample_rows, vec![vec!["2026-11-17", "Cafe", "-4"]]);
        assert_eq!(inspection.missing, vec!["date", "description", "amount"]);
    }
}
