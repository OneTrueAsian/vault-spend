use office_oxide::core::opc::{OpcReader, PartName};
use office_oxide::xlsx::XlsxDocument;
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;

fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        zip.start_file(*name, SimpleFileOptions::default()).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

const TYPES: &[u8] = br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>"#;

#[test]
fn office_zip9_lists_and_reads_exact_case_variant_and_windows_part_names() {
    for stored in ["word/document.xml", "WORD/DOCUMENT.XML", "word\\document.xml"] {
        let bytes = archive(&[("[Content_Types].xml", TYPES), (stored, b"<document>retained</document>")]);
        let mut reader = OpcReader::new(Cursor::new(bytes)).unwrap();
        let part = PartName::new("/word/document.xml").unwrap();
        assert!(reader.has_part(&part), "{stored}");
        assert_eq!(reader.part_names().len(), 1);
        assert_eq!(reader.read_part(&part).unwrap(), b"<document>retained</document>");
        assert!(!reader.has_part(&PartName::new("/word/missing.xml").unwrap()));
    }
}

#[test]
fn office_zip9_retains_unicode_names_and_reports_missing_parts() {
    let bytes = archive(&[("[Content_Types].xml", TYPES), ("word/caf\u{e9}.xml", b"<document>unicode</document>")]);
    let mut reader = OpcReader::new(Cursor::new(bytes)).unwrap();
    let part = PartName::new("/word/caf\u{e9}.xml").unwrap();
    assert!(reader.has_part(&part));
    assert_eq!(reader.part_names()[0].as_str(), part.as_str());
    assert_eq!(reader.read_part(&part).unwrap(), b"<document>unicode</document>");
    assert!(reader.read_part(&PartName::new("/word/absent.xml").unwrap()).is_err());
    assert!(OpcReader::new(Cursor::new(b"not a zip")).is_err());
}

#[test]
fn office_zip9_scans_chart_and_font_entries_with_the_new_filename_api() {
    let bytes = archive(&[
        ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>"#),
        ("xl/charts/chart1.xml", br#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><a:t>Retained chart</a:t></c:title></c:chart></c:chartSpace>"#),
        ("xl/fonts/demo.ttf", b"retained-font-bytes"),
    ]);
    let doc = XlsxDocument::from_reader(Cursor::new(bytes)).unwrap();
    assert!(doc.chart_text.iter().any(|t| t.contains("Retained chart")));
    assert_eq!(doc.embedded_fonts.len(), 1);
    assert_eq!(doc.embedded_fonts[0].1, b"retained-font-bytes");
}

#[test]
fn office_zip9_legacy_filename_fallback_preserves_identity_without_panicking() {
    let mut bytes = archive(&[("[Content_Types].xml", TYPES), ("word/caf\u{e9}.xml", b"payload")]);
    let needle = "word/caf\u{e9}.xml".as_bytes();
    let positions: Vec<_> = bytes
        .windows(needle.len())
        .enumerate()
        .filter_map(|(i, b)| (b == needle).then_some(i))
        .collect();
    assert_eq!(positions.len(), 2, "local and central names are both changed");
    // ZIP writers may encode names as CP437 unless the header explicitly declares UTF-8.
    // Set bit 11 in both header kinds, so the corrupted name is actually invalid rather than a valid legacy name.
    for i in 0..bytes.len().saturating_sub(10) {
        let offset = if bytes[i..].starts_with(b"PK\x03\x04") {
            Some(6)
        } else if bytes[i..].starts_with(b"PK\x01\x02") {
            Some(8)
        } else {
            None
        };
        if let Some(offset) = offset {
            bytes[i + offset + 1] |= 0x08;
        }
    }
    for pos in positions {
        bytes[pos + 8] = 0xff;
    }
    let mut reader = OpcReader::new(Cursor::new(bytes)).unwrap();
    // ZIP9 types.rs:name deliberately falls back to CP437, even for a malformed UTF-8 flag.
    // 0xff and 0xa9 decode to NBSP and REVERSED NOT SIGN, not the original accented name.
    let decoded = PartName::new("/word/caf\u{00a0}\u{2310}.xml").unwrap();
    assert_eq!(reader.part_names()[0].as_str(), decoded.as_str());
    assert!(reader.has_part(&decoded));
    assert!(!reader.has_part(&PartName::new("/word/caf\u{e9}.xml").unwrap()));
    assert_eq!(reader.read_part(&decoded).unwrap(), b"payload");
    let missing = PartName::new("/word/absent.xml").unwrap();
    assert!(!reader.has_part(&missing));
    assert!(reader.read_part(&missing).is_err());
}
