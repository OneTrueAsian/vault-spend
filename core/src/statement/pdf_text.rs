//! The only file that touches the PDF library: statement bytes in, text lines in content order out.
//! Swapping the library means changing this file alone.

use super::model::StatementLine;

pub const MAX_STATEMENT_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_STATEMENT_PAGES: usize = 200;
/// Longest the app waits for a statement's text. A damaged or hostile PDF must not hang the review.
pub const MAX_READ_TIME: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfTextError {
    TooLarge,
    TooManyPages,
    Encrypted,
    NoText,
    Unreadable,
    TooSlow,
}

impl std::fmt::Display for PdfTextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            PdfTextError::TooLarge | PdfTextError::TooManyPages => "This file is too large to be a monthly statement.",
            PdfTextError::Encrypted | PdfTextError::Unreadable => {
                "This PDF can't be opened. If it has a password, save an unlocked copy from your bank's website."
            }
            PdfTextError::TooSlow => {
                "This PDF took too long to read. You can use your bank's CSV or OFX download, or reconcile by hand."
            }
            PdfTextError::NoText => {
                "This PDF is a picture of the statement, so the app can't read its text. You can use your bank's CSV or OFX download, or reconcile by hand."
            }
        })
    }
}

impl std::error::Error for PdfTextError {}

/// The statement's text lines, giving up after `MAX_READ_TIME`.
pub fn read_pdf_lines(bytes: Vec<u8>) -> Result<Vec<StatementLine>, PdfTextError> {
    read_pdf_lines_within(bytes, MAX_READ_TIME)
}

/// Reads on a worker thread and waits at most `limit`. The page count is checked before any page is
/// read, and the worker stops at the next page once the time is up, so a slow file is abandoned
/// rather than left running. A panic inside the PDF library reads as an unreadable file.
pub fn read_pdf_lines_within(bytes: Vec<u8>, limit: std::time::Duration) -> Result<Vec<StatementLine>, PdfTextError> {
    if bytes.len() > MAX_STATEMENT_BYTES {
        return Err(PdfTextError::TooLarge);
    }
    let deadline = std::time::Instant::now() + limit;
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("statement-pdf".into())
        .spawn(move || {
            let _ = sender.send(extract_lines(bytes, deadline));
        })
        .map_err(|_| PdfTextError::Unreadable)?;
    match receiver.recv_timeout(limit) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(PdfTextError::TooSlow),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err(PdfTextError::Unreadable),
    }
}

fn extract_lines(bytes: Vec<u8>, deadline: std::time::Instant) -> Result<Vec<StatementLine>, PdfTextError> {
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
        if std::time::Instant::now() >= deadline {
            return Err(PdfTextError::TooSlow);
        }
        // Characters, not spans: the library's span extraction re-sorts text geometrically, which pulls a
        // table apart into a column of dates, a column of descriptions and a column of amounts. The
        // character list stays in the order the PDF draws it (date, description, amount for each row).
        let chars = doc.extract_chars(page).map_err(classify)?;
        let glyphs = chars.into_iter().map(|c| GlyphBox {
            ch: c.char,
            x: c.bbox.x,
            width: c.bbox.width,
            y: c.origin_y,
            size: c.font_size,
        });
        lines.extend(group_chars_into_lines(page, glyphs));
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

/// One drawn character: where it starts, how wide it is, its baseline and its type size.
#[derive(Debug, Clone, Copy)]
pub(crate) struct GlyphBox {
    pub ch: char,
    pub x: f32,
    pub width: f32,
    pub y: f32,
    pub size: f32,
}

/// Characters arrive in the order the PDF draws them. A new line starts when the baseline moves by more
/// than half the type size, or when drawing jumps back to the left on the same baseline (the next table
/// row starting again at its first column). Within a line a gap wider than a fifth of the type size is a
/// space. Blank lines are dropped and runs of spaces collapse.
pub(crate) fn group_chars_into_lines(page: usize, glyphs: impl IntoIterator<Item = GlyphBox>) -> Vec<StatementLine> {
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut last: Option<GlyphBox> = None;
    for g in glyphs {
        let size = g.size.max(1.0);
        if let Some(prev) = last {
            let same_baseline = (g.y - prev.y).abs() <= prev.size.max(size) * 0.5;
            let jumped_back = g.x < prev.x + prev.width - size * 0.5;
            if !same_baseline || jumped_back {
                lines.push(std::mem::take(&mut current));
            } else if g.x - (prev.x + prev.width) > size * 0.2 {
                current.push(' ');
            }
        }
        current.push(if g.ch.is_whitespace() { ' ' } else { g.ch });
        last = Some(g);
    }
    lines.push(current);
    lines
        .into_iter()
        .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|text| !text.is_empty())
        .map(|text| StatementLine { page, text })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::{build_pdf, fixture};

    /// Glyphs of `text` laid out from `x` at baseline `y`, 5 wide each, 10 point type.
    fn glyphs(text: &str, x: f32, y: f32) -> Vec<GlyphBox> {
        text.chars()
            .enumerate()
            .map(|(i, ch)| GlyphBox {
                ch,
                x: x + i as f32 * 5.0,
                width: 5.0,
                y,
                size: 10.0,
            })
            .collect()
    }
    fn texts(lines: &[StatementLine]) -> Vec<&str> {
        lines.iter().map(|l| l.text.as_str()).collect()
    }

    #[test]
    fn glyphs_on_one_baseline_make_words_and_a_gap_makes_a_space() {
        let mut g = glyphs("08/05/26", 50.0, 700.0);
        g.extend(glyphs("AUTOPAY", 120.0, 700.2)); // a gap wider than a letter, baseline off by a hair
        assert_eq!(texts(&group_chars_into_lines(0, g)), vec!["08/05/26 AUTOPAY"]);
    }

    #[test]
    fn a_new_baseline_starts_a_new_line() {
        let mut g = glyphs("AUTOPAY", 50.0, 700.0);
        g.extend(glyphs("-$43.08", 50.0, 688.0));
        assert_eq!(texts(&group_chars_into_lines(0, g)), vec!["AUTOPAY", "-$43.08"]);
    }

    #[test]
    fn drawing_order_is_kept_even_when_it_returns_to_an_earlier_column() {
        // A date, then (same baseline) the amount at the right, then back at the left for the next row.
        let mut g = glyphs("08/05/26", 50.0, 700.0);
        g.extend(glyphs("-$43.08", 300.0, 700.0));
        g.extend(glyphs("08/06/26", 50.0, 700.0)); // same baseline but jumps back to the left: a new line
        g.extend(glyphs("$9.99", 300.0, 700.0));
        assert_eq!(texts(&group_chars_into_lines(0, g)), vec!["08/05/26 -$43.08", "08/06/26 $9.99"]);
    }

    #[test]
    fn space_glyphs_are_not_doubled_and_blank_lines_are_dropped() {
        let mut g = glyphs("A B", 50.0, 700.0);
        g.extend(glyphs("   ", 50.0, 650.0));
        assert_eq!(texts(&group_chars_into_lines(3, g)), vec!["A B"]);
        assert_eq!(group_chars_into_lines(3, glyphs("x", 1.0, 1.0))[0].page, 3);
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
    fn too_many_pages_are_refused_before_any_page_is_read() {
        let pages = vec![vec!["Page".to_string()]; MAX_STATEMENT_PAGES + 1];
        assert_eq!(read_pdf_lines(build_pdf(&pages)), Err(PdfTextError::TooManyPages));
        let pages = vec![vec!["Page".to_string()]; MAX_STATEMENT_PAGES];
        assert_eq!(read_pdf_lines(build_pdf(&pages)).unwrap().len(), MAX_STATEMENT_PAGES);
    }

    #[test]
    fn reading_that_takes_too_long_stops_with_a_plain_message() {
        let (pages, _) = fixture("card-a").unwrap();
        assert_eq!(
            read_pdf_lines_within(build_pdf(&pages), std::time::Duration::ZERO),
            Err(PdfTextError::TooSlow)
        );
        assert!(PdfTextError::TooSlow.to_string().contains("took too long"));
    }

    #[test]
    fn messages_are_plain() {
        assert!(PdfTextError::NoText.to_string().contains("picture of the statement"));
        assert!(PdfTextError::Encrypted.to_string().contains("save an unlocked copy"));
    }
}
