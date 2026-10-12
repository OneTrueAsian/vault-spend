//! The only file that touches the PDF library: statement bytes in, text lines in content order out.
//! Swapping the library means changing this file alone.

use super::model::StatementLine;

pub const MAX_STATEMENT_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_STATEMENT_PAGES: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfTextError {
    TooLarge,
    TooManyPages,
    Encrypted,
    NoText,
    Unreadable,
}

impl std::fmt::Display for PdfTextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            PdfTextError::TooLarge | PdfTextError::TooManyPages => "This file is too large to be a monthly statement.",
            PdfTextError::Encrypted | PdfTextError::Unreadable => {
                "This PDF can't be opened. If it has a password, save an unlocked copy from your bank's website."
            }
            PdfTextError::NoText => {
                "This PDF is a picture of the statement, so the app can't read its text. You can use your bank's CSV or OFX download, or reconcile by hand."
            }
        })
    }
}

impl std::error::Error for PdfTextError {}

pub fn read_pdf_lines(bytes: Vec<u8>) -> Result<Vec<StatementLine>, PdfTextError> {
    if bytes.len() > MAX_STATEMENT_BYTES {
        return Err(PdfTextError::TooLarge);
    }
    let doc = pdf_oxide::PdfDocument::from_bytes(bytes).map_err(classify)?;
    if doc.is_encrypted() && !doc.authenticate(b"").unwrap_or(false) {
        return Err(PdfTextError::Encrypted);
    }
    let pages = doc.page_count().map_err(classify)?;
    if pages > MAX_STATEMENT_PAGES {
        return Err(PdfTextError::TooManyPages);
    }
    let mut lines = Vec::new();
    for page in 0..pages {
        let spans = doc.extract_spans(page).map_err(classify)?;
        lines.extend(group_into_lines(page, spans.into_iter().map(|s| (s.text, s.bbox.y, s.font_size))));
    }
    if lines.is_empty() {
        return Err(PdfTextError::NoText);
    }
    Ok(lines)
}

fn classify(error: pdf_oxide::error::Error) -> PdfTextError {
    let text = error.to_string().to_ascii_lowercase();
    if text.contains("encrypt") || text.contains("password") {
        PdfTextError::Encrypted
    } else {
        PdfTextError::Unreadable
    }
}

/// Spans arrive in the order the PDF draws them. A new line starts when the baseline moves by more
/// than half the font size; spans on one baseline are joined with a space.
pub(crate) fn group_into_lines(page: usize, spans: impl IntoIterator<Item = (String, f32, f32)>) -> Vec<StatementLine> {
    let mut lines: Vec<StatementLine> = Vec::new();
    let mut last: Option<(f32, f32)> = None;
    for (text, y, size) in spans {
        if text.trim().is_empty() {
            continue;
        }
        let same_line = last.is_some_and(|(ly, ls)| (y - ly).abs() <= ls.max(size).max(1.0) * 0.5);
        match lines.last_mut() {
            Some(line) if same_line => {
                if !line.text.ends_with(' ') && !text.starts_with(' ') {
                    line.text.push(' ');
                }
                line.text.push_str(&text);
            }
            _ => lines.push(StatementLine { page, text: text.clone() }),
        }
        last = Some((y, size));
    }
    for line in &mut lines {
        line.text = line.text.split_whitespace().collect::<Vec<_>>().join(" ");
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::{build_pdf, fixture};

    #[test]
    fn spans_on_one_baseline_join_and_a_new_baseline_starts_a_line() {
        let lines = group_into_lines(
            0,
            vec![
                ("08/05/26".to_string(), 700.0, 9.0),
                ("AUTOPAY".to_string(), 700.2, 9.0),
                ("-$43.08".to_string(), 688.0, 9.0),
            ],
        );
        assert_eq!(
            lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(),
            vec!["08/05/26 AUTOPAY", "-$43.08"]
        );
    }

    #[test]
    fn a_fixture_pdf_reads_back_in_content_order() {
        for name in ["card-a", "credit-union", "brokerage"] {
            let (pages, _) = fixture(name).unwrap();
            let lines = read_pdf_lines(build_pdf(&pages)).unwrap();
            let expected: Vec<(usize, String)> = pages
                .iter()
                .enumerate()
                .flat_map(|(p, ls)| ls.iter().map(move |l| (p, l.trim().to_string())))
                .collect();
            let got: Vec<(usize, String)> = lines.into_iter().map(|l| (l.page, l.text)).collect();
            assert_eq!(got, expected, "{name}");
        }
    }

    #[test]
    fn a_pdf_without_text_is_reported_as_a_picture() {
        assert_eq!(read_pdf_lines(build_pdf(&[vec![], vec![]])), Err(PdfTextError::NoText));
    }

    #[test]
    fn garbage_is_unreadable_and_huge_files_are_refused_first() {
        assert_eq!(read_pdf_lines(b"not a pdf at all".to_vec()), Err(PdfTextError::Unreadable));
        assert_eq!(read_pdf_lines(vec![0u8; MAX_STATEMENT_BYTES + 1]), Err(PdfTextError::TooLarge));
    }

    #[test]
    fn messages_are_plain() {
        assert!(PdfTextError::NoText.to_string().contains("picture of the statement"));
        assert!(PdfTextError::Encrypted.to_string().contains("save an unlocked copy"));
    }
}
