//! Plain-language wording for update failures. The updater's internal checks keep their
//! precise messages (and their tests); the four Tauri commands pass every error through
//! `plain_update_error` so only a few grouped messages reach a person.

const UNREACHABLE: &str = "Couldn't reach the update server. Check your internet connection and try again.";
const UNVERIFIED: &str = "This update couldn't be verified, so it wasn't installed. Download the latest version from the release page instead.";
const NOT_SAVED: &str = "Couldn't save the update on this computer. Make sure the drive has free space, then try again.";
const NOT_READY: &str = "This update is no longer ready. Check for updates again.";
const FALLBACK: &str = "Something went wrong with the update. Try again, or download the latest version from the release page.";

/// Already plain and with a next step: shown as written.
const UNCHANGED: &[&str] = &[
    "Couldn't start the verified installer.",
    "Production update signing is not configured.",
    "An update is already downloading",
    "This update is already staged.",
    "Finish or cancel the current update first.",
];
const UNREACHABLE_STARTS: &[&str] = &[
    "Couldn't check for updates.",
    "Couldn't download signed update metadata.",
    "Couldn't download the signed update installer.",
    "Couldn't initialize the update connection.",
    "Couldn't read the update response.",
    "The update response has an invalid status or size.",
    "API rate limit exceeded",
    "Couldn't read the latest release details",
];
/// Matched against the lowercased message.
const UNVERIFIED_WORDS: &[&str] = &[
    "signature",
    "metadata",
    "trust registry",
    "embedded update key",
    "installer selection",
    "installer source",
    "too large",
    "has changed",
    "couldn't verify the staged installer.",
    "release version is invalid",
    "release or installer size",
    "installer response has an invalid",
    "signed update installer is missing",
    "complete signed update",
    "publisher identity",
    "redirected directory",
];
const NOT_SAVED_STARTS: &[&str] = &[
    "Couldn't create private update staging",
    "Couldn't create the staged installer",
    "Couldn't save the installer download",
    "Couldn't finish saving the installer",
    "Couldn't read the installer download",
    "Couldn't restrict update staging access",
    "Couldn't inspect update staging",
    "Couldn't clean an abandoned update",
    "Couldn't remove the cancelled update",
    "Update staging",
];
const NOT_READY_STARTS: &[&str] = &[
    "The update handle",
    "The update token",
    "The staged installer is unavailable.",
    "Check for a signed update again.",
];

fn starts_with_any(detail: &str, starts: &[&str]) -> bool {
    starts.iter().any(|start| detail.starts_with(start))
}

/// Maps an internal updater message to the plain wording shown to a person. Rules run in
/// order: the unchanged list, then the groups. Prefixes (not whole messages) are matched so
/// a message that carries operating-system text after its lead-in still lands in its group.
pub(crate) fn plain_update_error(detail: &str) -> String {
    if starts_with_any(detail, UNCHANGED) {
        return detail.to_string();
    }
    let lower = detail.to_lowercase();
    let plain = if starts_with_any(detail, UNREACHABLE_STARTS) {
        UNREACHABLE
    } else if UNVERIFIED_WORDS.iter().any(|word| lower.contains(word)) {
        UNVERIFIED
    } else if starts_with_any(detail, NOT_SAVED_STARTS) {
        NOT_SAVED
    } else if starts_with_any(detail, NOT_READY_STARTS) {
        NOT_READY
    } else {
        FALLBACK
    };
    plain.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(messages: &[&str], expected: &str) {
        for message in messages {
            assert_eq!(plain_update_error(message), expected, "{message}");
        }
    }

    #[test]
    fn network_failures_say_the_server_could_not_be_reached() {
        group(
            &[
                "Couldn't check for updates.",
                "Couldn't download signed update metadata.",
                "Couldn't download the signed update installer.",
                "Couldn't initialize the update connection.",
                "Couldn't read the update response.",
                "The update response has an invalid status or size.",
                "API rate limit exceeded",
                "Couldn't read the latest release details: expected value at line 1 column 1",
            ],
            UNREACHABLE,
        );
    }

    #[test]
    fn verification_failures_say_it_was_not_installed() {
        group(
            &[
                "The update signature is invalid.",
                "The signed update metadata size changed.",
                "The embedded update trust registry is invalid.",
                "The embedded update key is invalid.",
                "The update installer selection is ambiguous or has the wrong size.",
                "The update installer source is invalid.",
                "The installer download is too large.",
                "The staged installer has changed.",
                "Couldn't verify the staged installer.",
                "The release version is invalid.",
                "The update release or installer size is invalid.",
                "The installer response has an invalid status or size.",
            ],
            UNVERIFIED,
        );
        assert!(UNVERIFIED.contains("wasn't installed"));
    }

    #[test]
    fn storage_failures_ask_for_free_space() {
        group(
            &[
                "Couldn't create private update staging.",
                "Couldn't create the staged installer.",
                "Couldn't save the installer download.",
                "Couldn't finish saving the installer.",
                "Couldn't read the installer download.",
                "Couldn't restrict update staging access.",
                "Couldn't inspect update staging.",
                "Couldn't clean an abandoned update.",
                "Couldn't remove the cancelled update.",
            ],
            NOT_SAVED,
        );
    }

    #[test]
    fn a_disk_full_error_from_staging_is_still_the_could_not_save_group() {
        group(
            &[
                "Couldn't save the installer download. There is not enough space on the disk. (os error 112)",
                "Couldn't finish saving the installer: No space left on device (os error 28)",
            ],
            NOT_SAVED,
        );
    }

    #[test]
    fn stale_handles_say_to_check_again() {
        group(
            &[
                "The update handle is invalid or expired. Check again.",
                "The update handle belongs to another operation.",
                "The update handle is invalid or no longer available.",
                "The update token is invalid or no longer available.",
                "The staged installer is unavailable.",
                "Check for a signed update again.",
            ],
            NOT_READY,
        );
    }

    #[test]
    fn already_plain_messages_are_unchanged() {
        for message in [
            "Couldn't start the verified installer. Download it again or use the official release page.",
            "Production update signing is not configured. Use the official release page.",
            "An update is already downloading or ready to install.",
            "This update is already staged. Cancel it before downloading again.",
            "Finish or cancel the current update first.",
        ] {
            assert_eq!(plain_update_error(message), message);
        }
    }

    #[test]
    fn random_number_failures_and_redirected_staging_are_not_storage_problems() {
        group(&["Couldn't create a secure update token.", "Couldn't create a secure update handle."], FALLBACK);
        group(&["Update staging cannot use a redirected directory."], UNVERIFIED);
    }

    #[test]
    fn anything_else_gets_the_fallback() {
        assert_eq!(plain_update_error("kaboom"), FALLBACK);
        assert_eq!(plain_update_error(""), FALLBACK);
    }

    /// Messages that never reach a person as written, or that are meant to get the fallback.
    const INTENDED_FALLBACK: &[&str] = &[
        // Only after the person cancels, when the banner ignores the result.
        "Update download cancelled.",
        // Not reachable from the four commands (the e2e suite's update-check switch).
        "Update check is turned off for the test suite",
        // Poisoned lock or platform gaps: nothing the person can act on beyond trying again.
        "The updater is unavailable.",
        "Updates are unavailable for this platform.",
        "Windows installer is unavailable.",
        "Unsupported verified installer type.",
        // Failure to make random bytes: not a disk problem, nothing the person can fix.
        "Couldn't create a secure update token.",
        "Couldn't create a secure update handle.",
        // Blocked by the connection's address rules; the request then reads as unreachable.
        "Update DNS host is not permitted",
        "Update DNS destination is not public",
    ];

    /// Limits: only single-line call forms are seen, and each file is cut at its first
    /// `#[cfg(test)]`, so anything after that marker is not scanned.
    /// Error text in the updater's own source (before its test modules) that starts with a
    /// capital: the lines holding `Err(`, `map_err(|` or `ok_or(`, string literals only.
    fn source_messages() -> Vec<(String, String)> {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = vec![root.join("updater.rs")];
        for entry in std::fs::read_dir(root.join("updater")).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|ext| ext == "rs") && !path.ends_with("plain_error.rs") {
                files.push(path);
            }
        }
        let mut found = Vec::new();
        for file in files {
            let text = std::fs::read_to_string(&file).unwrap().replace("\r\n", "\n");
            let production = text.split("#[cfg(test)]").next().unwrap();
            for line in production.lines() {
                let Some(start) = ["Err(", "map_err(|", "ok_or("].iter().filter_map(|pattern| line.find(pattern)).min() else {
                    continue;
                };
                for literal in line[start..].split('"').skip(1).step_by(2) {
                    if literal.starts_with(|c: char| c.is_ascii_uppercase()) {
                        found.push((file.file_name().unwrap().to_string_lossy().into_owned(), literal.to_string()));
                    }
                }
            }
        }
        found
    }

    #[test]
    fn every_updater_message_has_a_group() {
        let messages = source_messages();
        assert!(messages.len() > 40, "the scan should find the updater's messages, found {}", messages.len());
        let ungrouped: Vec<_> = messages
            .iter()
            .filter(|(_, message)| plain_update_error(message) == FALLBACK && !INTENDED_FALLBACK.contains(&message.as_str()))
            .collect();
        assert!(ungrouped.is_empty(), "updater messages with no plain group (add a group): {ungrouped:?}");
    }
}
