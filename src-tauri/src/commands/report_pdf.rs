//! Command: save the Reports page as a PDF file the person chose in the app's Save window.
//!
//! The system print window's "Save as PDF" fails when the person picks a file name that already exists and
//! answers "Replace" (the browser's download step reports a network issue). The app's own Save window asks
//! about replacing in Windows itself, and WebView2's print-to-PDF then writes the file directly.

use super::*;

/// The file name must end in .pdf and its folder must exist. A file that already exists is fine: the Save window
/// has already asked the person about replacing it.
fn checked_pdf_path(path: &str) -> Result<std::path::PathBuf, String> {
    let path = std::path::PathBuf::from(path.trim());
    if !path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("pdf")) {
        return Err("Choose a file name that ends in .pdf.".to_string());
    }
    if !path.parent().is_some_and(|folder| folder.is_dir()) {
        return Err("The folder for that file does not exist.".to_string());
    }
    if path.is_dir() {
        return Err("That name belongs to a folder, not a file.".to_string());
    }
    Ok(path)
}

#[tauri::command]
pub fn save_report_pdf(path: String, window: tauri::WebviewWindow, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let _origin = state.lock()?;
    let path = checked_pdf_path(&path)?;
    print_page_to_pdf(&window, &path)
}

/// WebView2 prints the page as the print window would (the print rules in the stylesheet apply) and writes the
/// file itself, replacing one that is already there. It answers on the window's own thread, so this waits here.
#[cfg(windows)]
fn print_page_to_pdf(window: &tauri::WebviewWindow, path: &std::path::Path) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_7;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let target = HSTRING::from(path.to_string_lossy().as_ref());
    let (report, outcome) = std::sync::mpsc::channel::<Result<(), String>>();
    let report_start_failure = report.clone();
    window
        .with_webview(move |webview| {
            let start = || -> windows::core::Result<()> {
                let core: ICoreWebView2_7 = unsafe { webview.controller().CoreWebView2()? }.cast()?;
                let handler = PrintToPdfCompletedHandler::create(Box::new(move |error, saved| {
                    let _ = report.send(match error {
                        Ok(()) if saved => Ok(()),
                        _ => Err("The report could not be saved as a PDF.".to_string()),
                    });
                    Ok(())
                }));
                unsafe { core.PrintToPdf(&target, None, &handler) }
            };
            if start().is_err() {
                let _ = report_start_failure.send(Err("The report could not be saved as a PDF.".to_string()));
            }
        })
        .map_err(|_| "The report could not be saved as a PDF.".to_string())?;
    outcome
        .recv_timeout(std::time::Duration::from_secs(120))
        .map_err(|_| "Saving the PDF took too long.".to_string())?
}

#[cfg(not(windows))]
fn print_page_to_pdf(_window: &tauri::WebviewWindow, _path: &std::path::Path) -> Result<(), String> {
    Err("Saving a PDF directly is only available on Windows. Use Print… and choose Save as PDF.".to_string())
}

#[cfg(test)]
mod tests {
    use super::checked_pdf_path;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-pdf-path-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_a_new_pdf_in_an_existing_folder() {
        let dir = scratch("new");
        let path = dir.join("report.pdf");
        assert_eq!(checked_pdf_path(path.to_str().unwrap()).unwrap(), path);
    }

    #[test]
    fn accepts_a_file_that_already_exists_because_the_save_window_already_asked_about_replacing_it() {
        let dir = scratch("existing");
        let path = dir.join("report.pdf");
        std::fs::write(&path, b"old").unwrap();
        assert_eq!(checked_pdf_path(path.to_str().unwrap()).unwrap(), path);
    }

    #[test]
    fn accepts_an_upper_case_extension() {
        let dir = scratch("upper");
        let path = dir.join("REPORT.PDF");
        assert!(checked_pdf_path(path.to_str().unwrap()).is_ok());
    }

    #[test]
    fn refuses_anything_that_is_not_a_pdf_name() {
        let dir = scratch("ext");
        for name in ["report.txt", "report", "report.pdf.exe"] {
            let error = checked_pdf_path(dir.join(name).to_str().unwrap()).unwrap_err();
            assert!(error.contains(".pdf"), "{name}: {error}");
        }
    }

    #[test]
    fn refuses_an_empty_path_and_a_missing_folder() {
        assert!(checked_pdf_path("").is_err());
        let missing = std::env::temp_dir().join("vaultspend-pdf-path-no-such-folder").join("report.pdf");
        assert!(checked_pdf_path(missing.to_str().unwrap()).unwrap_err().contains("folder"));
    }

    #[test]
    fn refuses_a_folder_named_like_a_pdf() {
        let dir = scratch("dir");
        let path = dir.join("looks-like.pdf");
        std::fs::create_dir_all(&path).unwrap();
        assert!(checked_pdf_path(path.to_str().unwrap()).is_err());
    }
}
