//! A registry of independent local database "profiles" the user can create
//! and switch between — completely separate data per profile (unlike
//! family-member tagging, which attributes data *within* one shared file;
//! see `budget_core::store`'s `family_members` table for that). Lives at
//! `profiles.json` next to `config.json`, lazily: if it doesn't exist,
//! there's implicitly one "Default" profile (whatever the app is currently
//! pointed at) and nothing is written to disk until the user actually
//! creates a second profile — matching this codebase's existing "leave
//! things alone unless asked" philosophy (relocate/restore both leave the
//! old file in place, untouched, rather than mutating anything extra).
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const REGISTRY_FILENAME: &str = "profiles.json";
const DEFAULT_PROFILE_ID: &str = "default";
const DEFAULT_PROFILE_NAME: &str = "Default";

/// The on-disk shape of one registry entry. `icon_key` is a purely
/// cosmetic pick from the bundled `account-avatar-profile-*` set (see
/// `flatIcons.ts` on the frontend) — `#[serde(default)]` so a
/// `profiles.json` written before this field existed still deserializes
/// (missing means "no icon picked yet", same as a brand-new profile).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct ProfileEntry {
    id: String,
    name: String,
    db_path: String,
    #[serde(default)]
    icon_key: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Registry {
    profiles: Vec<ProfileEntry>,
}

/// A profile as read back — `is_active` is computed by comparing `db_path`
/// against whatever's actually live right now (`AppPaths.db_path`), never
/// stored, so there's exactly one source of truth for "what's live."
#[derive(Debug, Clone, PartialEq)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub db_path: PathBuf,
    pub is_active: bool,
    pub icon_key: Option<String>,
}

fn registry_path(config_path: &Path) -> PathBuf {
    config_path.parent().unwrap_or_else(|| Path::new(".")).join(REGISTRY_FILENAME)
}

/// Where a new profile's own directory (and thus its `vaultspend.db` and
/// its automatically-isolated `backups/` subfolder — see
/// `backups::backups_dir_for`) lives: a `profiles` folder next to
/// `config.json`. One directory per profile, not a flat sibling file,
/// because `backups_dir_for` anchors off the live db's *parent* directory —
/// flat siblings would merge two profiles' backup histories (and their
/// 15-file prune caps) into one.
fn profiles_dir(config_path: &Path) -> PathBuf {
    config_path.parent().unwrap_or_else(|| Path::new(".")).join("profiles")
}

fn read_registry(config_path: &Path) -> Option<Registry> {
    let content = std::fs::read_to_string(registry_path(config_path)).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_registry(config_path: &Path, registry: &Registry) -> Result<(), String> {
    let json = serde_json::to_string_pretty(registry).expect("Registry always serializes");
    std::fs::write(registry_path(config_path), json).map_err(|e| e.to_string())
}

fn default_entry(live_db_path: &Path) -> ProfileEntry {
    ProfileEntry {
        id: DEFAULT_PROFILE_ID.to_string(),
        name: DEFAULT_PROFILE_NAME.to_string(),
        db_path: live_db_path.to_string_lossy().to_string(),
        icon_key: None,
    }
}

/// The registry's entries, or a single synthetic Default entry (never
/// written to disk) representing `live_db_path` if no registry file exists
/// yet — the shared starting point every mutating function in this module
/// reads from.
fn entries_or_synthesize(config_path: &Path, live_db_path: &Path) -> Vec<ProfileEntry> {
    match read_registry(config_path) {
        Some(r) => r.profiles,
        None => vec![default_entry(live_db_path)],
    }
}

fn sanitize_for_id(name: &str) -> String {
    let s: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    if s.is_empty() {
        "profile".to_string()
    } else {
        s
    }
}

/// A `<sanitized-name>-<timestamp>` id, disambiguated with a `-N` suffix on
/// collision — mirroring `backups.rs`'s `unique_backup_path` exactly (two
/// profiles created with the same name in the same wall-clock second must
/// never collide).
fn unique_profile_id(existing: &[ProfileEntry], name: &str, now: NaiveDateTime) -> String {
    let base = format!("{}-{}", sanitize_for_id(name), now.format("%Y%m%d%H%M%S"));
    if !existing.iter().any(|p| p.id == base) {
        return base;
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if !existing.iter().any(|p| p.id == candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Every profile, `is_active` computed fresh against `live_db_path`.
/// Synthesizes a single "Default" entry when no registry file exists yet
/// rather than creating one — see the module doc comment.
pub fn list_profiles(config_path: &Path, live_db_path: &Path) -> Vec<Profile> {
    entries_or_synthesize(config_path, live_db_path)
        .into_iter()
        .map(|p| {
            let db_path = PathBuf::from(&p.db_path);
            let is_active = db_path == live_db_path;
            Profile {
                id: p.id,
                name: p.name,
                db_path,
                is_active,
                icon_key: p.icon_key,
            }
        })
        .collect()
}

/// Registers a new profile — computes its id and its own directory under
/// `profiles_dir`, rejects a case-insensitive duplicate of an existing
/// name, and persists the registry (seeding it with the synthetic Default
/// entry first, if this is the very first profile ever created). Does
/// **not** create the profile's directory or database file itself — that's
/// the caller's job (`commands::create_profile`), so a registry entry is
/// only ever written for a profile whose storage the caller successfully
/// initialized.
pub fn create_profile(config_path: &Path, live_db_path: &Path, name: &str, now: NaiveDateTime) -> Result<Profile, String> {
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    if entries.iter().any(|p| p.name.eq_ignore_ascii_case(name)) {
        return Err(format!("A profile named '{name}' already exists."));
    }

    let id = unique_profile_id(&entries, name, now);
    let db_path = profiles_dir(config_path).join(&id).join("vaultspend.db");
    entries.push(ProfileEntry {
        id: id.clone(),
        name: name.to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        icon_key: None,
    });
    write_registry(config_path, &Registry { profiles: entries })?;

    Ok(Profile {
        id,
        name: name.to_string(),
        db_path,
        is_active: false,
        icon_key: None,
    })
}

/// Registers a profile pointing at an *existing* database file elsewhere on
/// disk — the counterpart to `create_profile`, which always makes a brand
/// new one under `profiles_dir`. This is how a database moved from another
/// machine (copied over, downloaded, an external drive) gets adopted: the
/// file is registered right where the user pointed at it, never copied or
/// moved (same "leave it where it is" philosophy as `relocate_data_file`
/// and `switch_profile`). Rejects a case-insensitive duplicate name, same
/// as `create_profile` — and, since the caller supplies the path directly
/// rather than one this module computed itself, also rejects a path that's
/// already registered under another profile, since two names pointing at
/// the same file would make switching between them a silent no-op.
pub fn add_existing_profile(
    config_path: &Path,
    live_db_path: &Path,
    name: &str,
    existing_db_path: &Path,
    now: NaiveDateTime,
) -> Result<Profile, String> {
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    if entries.iter().any(|p| p.name.eq_ignore_ascii_case(name)) {
        return Err(format!("A profile named '{name}' already exists."));
    }
    // Case-insensitive, matching Windows/macOS filesystem semantics (this
    // app's only two build targets — see the CI workflow) — an exact,
    // case-sensitive `PathBuf` comparison would miss a duplicate whenever
    // the file picker returns different letter-casing than what's already
    // stored, silently defeating the whole point of this check.
    let picked_lossy = existing_db_path.to_string_lossy();
    if let Some(existing) = entries.iter().find(|p| p.db_path.eq_ignore_ascii_case(&picked_lossy)) {
        return Err(format!(
            "{} is already registered as the '{}' profile.",
            existing_db_path.display(),
            existing.name
        ));
    }

    let id = unique_profile_id(&entries, name, now);
    entries.push(ProfileEntry {
        id: id.clone(),
        name: name.to_string(),
        db_path: existing_db_path.to_string_lossy().to_string(),
        icon_key: None,
    });
    write_registry(config_path, &Registry { profiles: entries })?;

    Ok(Profile {
        id,
        name: name.to_string(),
        db_path: existing_db_path.to_path_buf(),
        is_active: false,
        icon_key: None,
    })
}

/// Renames a profile. An unknown id is a harmless no-op (matching
/// `rename_family_member`'s convention) — and, unlike a successful rename,
/// never materializes the registry for a plain Default profile that's
/// never actually been renamed. Rejects a case-insensitive duplicate of
/// *another* profile's name; renaming a profile to its own current name is
/// always allowed.
pub fn rename_profile(config_path: &Path, live_db_path: &Path, id: &str, new_name: &str) -> Result<(), String> {
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    if !entries.iter().any(|p| p.id == id) {
        return Ok(());
    }
    if entries.iter().any(|p| p.id != id && p.name.eq_ignore_ascii_case(new_name)) {
        return Err(format!("A profile named '{new_name}' already exists."));
    }
    for p in entries.iter_mut() {
        if p.id == id {
            p.name = new_name.to_string();
        }
    }
    write_registry(config_path, &Registry { profiles: entries })
}

/// Sets (or clears, with `None`) a profile's icon — a purely cosmetic pick
/// from the bundled avatar set (`account-avatar-profile-*` in
/// `flatIcons.ts`), unrelated to which database is live. An unconditional
/// update, not merge-only, so explicitly clearing it back to `None` works
/// — same convention as `Store::set_category_icon`. Unknown id is a
/// harmless no-op, matching `rename_profile`.
pub fn set_profile_icon(config_path: &Path, live_db_path: &Path, id: &str, icon_key: Option<&str>) -> Result<(), String> {
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    if !entries.iter().any(|p| p.id == id) {
        return Ok(());
    }
    for p in entries.iter_mut() {
        if p.id == id {
            p.icon_key = icon_key.map(|s| s.to_string());
        }
    }
    write_registry(config_path, &Registry { profiles: entries })
}

/// Removes a profile from the registry — the file it points at is left on
/// disk untouched (matching `relocate_data_file`'s "old file left in
/// place" philosophy: deleting a profile removes it from the list, it
/// doesn't destroy data). Refuses to delete whichever profile is currently
/// active (`db_path == live_db_path`) — there's nothing to hot-swap to.
/// Unknown id is a harmless no-op.
pub fn delete_profile(config_path: &Path, live_db_path: &Path, id: &str) -> Result<(), String> {
    let entries = entries_or_synthesize(config_path, live_db_path);
    let Some(target) = entries.iter().find(|p| p.id == id) else {
        return Ok(());
    };
    if &target.db_path == live_db_path {
        return Err("Can't delete the profile you're currently using — switch to another one first.".to_string());
    }
    let remaining: Vec<ProfileEntry> = entries.into_iter().filter(|p| p.id != id).collect();
    write_registry(config_path, &Registry { profiles: remaining })
}

/// Called by `relocate_data_file`/`restore_backup` after they hot-swap the
/// live connection: if `old_live_path` matched a registered profile,
/// updates that profile's `db_path` to `new_live_path`, so switching away
/// and back later doesn't silently reopen the stale pre-move file. A
/// deliberate no-op that never materializes the registry when
/// `profiles.json` doesn't exist yet — a relocate/restore on the plain,
/// never-used-profiles Default must stay invisible to this feature.
pub fn update_active_db_path(config_path: &Path, old_live_path: &Path, new_live_path: &Path) -> Result<(), String> {
    let Some(mut registry) = read_registry(config_path) else {
        return Ok(());
    };
    let mut changed = false;
    for p in registry.profiles.iter_mut() {
        if &p.db_path == old_live_path {
            p.db_path = new_live_path.to_string_lossy().to_string();
            changed = true;
        }
    }
    if changed {
        write_registry(config_path, &registry)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-profiles-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    #[test]
    fn list_profiles_synthesizes_a_default_entry_when_no_registry_exists() {
        let dir = temp_dir("list-synthesize");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");

        let profiles = list_profiles(&config_path, &live_db_path);

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "default");
        assert_eq!(profiles[0].name, "Default");
        assert_eq!(profiles[0].db_path, live_db_path);
        assert!(profiles[0].is_active);
        assert!(!registry_path(&config_path).exists(), "synthesizing must not write anything to disk");
    }

    #[test]
    fn list_profiles_returns_the_full_registry_when_it_already_exists() {
        let dir = temp_dir("list-full-registry");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        let profiles = list_profiles(&config_path, &live_db_path);

        assert_eq!(profiles.len(), 2, "expected the seeded Default plus the new Alex profile");
        assert!(profiles.iter().any(|p| p.name == "Default"));
        assert!(profiles.iter().any(|p| p.name == "Alex"));
    }

    #[test]
    fn list_profiles_marks_whichever_entry_matches_the_live_db_path_as_active() {
        let dir = temp_dir("list-active");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        // Simulate having switched to Alex: `live_db_path` now points at
        // Alex's file, not the original Default one.
        let profiles = list_profiles(&config_path, &alex.db_path);

        let default = profiles.iter().find(|p| p.name == "Default").unwrap();
        let alex_entry = profiles.iter().find(|p| p.name == "Alex").unwrap();
        assert!(!default.is_active);
        assert!(alex_entry.is_active);
    }

    #[test]
    fn create_profile_seeds_a_default_entry_the_first_time_the_registry_is_written() {
        let dir = temp_dir("create-seeds-default");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");

        create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        let profiles = list_profiles(&config_path, &live_db_path);
        assert_eq!(profiles.len(), 2);
        let default = profiles.iter().find(|p| p.id == "default").unwrap();
        assert_eq!(default.name, "Default");
        assert_eq!(default.db_path, live_db_path);
    }

    #[test]
    fn create_profile_does_not_reseed_the_default_entry_on_a_later_call() {
        let dir = temp_dir("create-no-reseed");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        create_profile(&config_path, &live_db_path, "Sam", dt("2026-08-30 13:00:00")).unwrap();

        let profiles = list_profiles(&config_path, &live_db_path);
        assert_eq!(
            profiles.iter().filter(|p| p.id == "default").count(),
            1,
            "must still have exactly one Default"
        );
        assert_eq!(profiles.len(), 3, "Default, Alex, Sam");
    }

    #[test]
    fn create_profile_stores_the_new_profile_under_its_own_subdirectory() {
        let dir = temp_dir("create-own-subdir");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");

        let profile = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        assert_eq!(profile.db_path.file_name().unwrap(), "vaultspend.db");
        let profile_dir = profile.db_path.parent().unwrap();
        assert_eq!(profile_dir.parent().unwrap(), profiles_dir(&config_path));
        assert_eq!(profile_dir.file_name().unwrap(), profile.id.as_str());
    }

    #[test]
    fn create_profile_rejects_a_duplicate_name_case_insensitively() {
        let dir = temp_dir("create-rejects-duplicate");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        let result = create_profile(&config_path, &live_db_path, "ALEX", dt("2026-08-30 12:00:01"));

        assert!(result.is_err());
    }

    #[test]
    fn create_profile_disambiguates_two_profiles_created_with_the_same_name_in_the_same_second() {
        let dir = temp_dir("create-disambiguates");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let same_instant = dt("2026-08-30 19:41:25");

        let first = create_profile(&config_path, &live_db_path, "Alex", same_instant).unwrap();
        let second = create_profile(&config_path, &live_db_path, "Alex Vacation", same_instant).unwrap();

        assert_ne!(first.id, second.id, "two profiles created in the same second must not collide");
    }

    #[test]
    fn add_existing_profile_registers_the_given_path_verbatim_without_creating_a_directory() {
        let dir = temp_dir("add-existing-verbatim");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let brought_over = dir.join("from-old-laptop").join("vaultspend.db");

        let profile = add_existing_profile(&config_path, &live_db_path, "Old Laptop", &brought_over, dt("2026-09-02 09:00:00")).unwrap();

        assert_eq!(profile.db_path, brought_over);
        assert!(
            !dir.join("profiles").exists(),
            "must never create a profiles_dir subdirectory for an existing file"
        );
    }

    #[test]
    fn add_existing_profile_seeds_a_default_entry_the_first_time_the_registry_is_written() {
        let dir = temp_dir("add-existing-seeds-default");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let brought_over = dir.join("brought-over.db");

        add_existing_profile(&config_path, &live_db_path, "Old Laptop", &brought_over, dt("2026-09-02 09:00:00")).unwrap();

        let profiles = list_profiles(&config_path, &live_db_path);
        assert_eq!(profiles.len(), 2, "expected the seeded Default plus the new Old Laptop profile");
        assert!(profiles.iter().any(|p| p.name == "Default" && p.db_path == live_db_path));
    }

    #[test]
    fn add_existing_profile_rejects_a_duplicate_name_case_insensitively() {
        let dir = temp_dir("add-existing-rejects-duplicate-name");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        create_profile(&config_path, &live_db_path, "Alex", dt("2026-09-02 09:00:00")).unwrap();

        let result = add_existing_profile(
            &config_path,
            &live_db_path,
            "ALEX",
            &dir.join("brought-over.db"),
            dt("2026-09-02 09:00:01"),
        );

        assert!(result.is_err());
    }

    #[test]
    fn add_existing_profile_rejects_a_path_already_registered_to_another_profile() {
        let dir = temp_dir("add-existing-rejects-duplicate-path");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-09-02 09:00:00")).unwrap();

        let result = add_existing_profile(&config_path, &live_db_path, "Alex Again", &alex.db_path, dt("2026-09-02 09:00:01"));

        let err = result.unwrap_err();
        assert!(err.contains("Alex"), "error should name the profile already using that file: {err}");
    }

    #[test]
    fn add_existing_profile_rejects_a_duplicate_path_that_only_differs_by_case() {
        let dir = temp_dir("add-existing-rejects-duplicate-path-case-insensitive");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-09-02 09:00:00")).unwrap();

        // Same file, different letter-casing — as a file picker can return
        // on a case-insensitive filesystem (this app's only two build
        // targets, Windows and macOS both default to case-insensitive).
        let differently_cased = PathBuf::from(alex.db_path.to_string_lossy().to_uppercase());

        let result = add_existing_profile(&config_path, &live_db_path, "Alex Again", &differently_cased, dt("2026-09-02 09:00:01"));

        let err = result.unwrap_err();
        assert!(err.contains("Alex"), "error should name the profile already using that file: {err}");
    }

    #[test]
    fn rename_profile_updates_the_name_and_leaves_id_and_db_path_untouched() {
        let dir = temp_dir("rename-updates");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        rename_profile(&config_path, &live_db_path, &alex.id, "Alexandra").unwrap();

        let profiles = list_profiles(&config_path, &live_db_path);
        let renamed = profiles.iter().find(|p| p.id == alex.id).unwrap();
        assert_eq!(renamed.name, "Alexandra");
        assert_eq!(renamed.db_path, alex.db_path);
    }

    #[test]
    fn rename_profile_rejects_a_case_insensitive_duplicate_of_another_profiles_name() {
        let dir = temp_dir("rename-rejects-duplicate");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();
        create_profile(&config_path, &live_db_path, "Sam", dt("2026-08-30 12:00:01")).unwrap();

        let result = rename_profile(&config_path, &live_db_path, &alex.id, "SAM");

        assert!(result.is_err());
    }

    #[test]
    fn rename_profile_allows_a_no_op_rename_to_its_own_current_name() {
        let dir = temp_dir("rename-no-op-self");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        let result = rename_profile(&config_path, &live_db_path, &alex.id, "Alex");

        assert!(result.is_ok());
    }

    #[test]
    fn rename_profile_on_an_unknown_id_is_a_harmless_no_op() {
        let dir = temp_dir("rename-unknown-id");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");

        let result = rename_profile(&config_path, &live_db_path, "no-such-id", "Whoever");

        assert!(result.is_ok());
        assert!(!registry_path(&config_path).exists(), "a no-op rename must not materialize the registry");
    }

    #[test]
    fn set_profile_icon_sets_and_leaves_everything_else_untouched() {
        let dir = temp_dir("set-icon-sets");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        set_profile_icon(&config_path, &live_db_path, &alex.id, Some("account-avatar-profile-3")).unwrap();

        let profiles = list_profiles(&config_path, &live_db_path);
        let updated = profiles.iter().find(|p| p.id == alex.id).unwrap();
        assert_eq!(updated.icon_key.as_deref(), Some("account-avatar-profile-3"));
        assert_eq!(updated.name, "Alex");
        assert_eq!(updated.db_path, alex.db_path);
    }

    #[test]
    fn set_profile_icon_can_clear_a_previously_set_icon_back_to_none() {
        let dir = temp_dir("set-icon-clears");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();
        set_profile_icon(&config_path, &live_db_path, &alex.id, Some("account-avatar-profile-3")).unwrap();

        set_profile_icon(&config_path, &live_db_path, &alex.id, None).unwrap();

        let profiles = list_profiles(&config_path, &live_db_path);
        assert_eq!(profiles.iter().find(|p| p.id == alex.id).unwrap().icon_key, None);
    }

    #[test]
    fn set_profile_icon_on_an_unknown_id_is_a_harmless_no_op() {
        let dir = temp_dir("set-icon-unknown-id");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");

        let result = set_profile_icon(&config_path, &live_db_path, "no-such-id", Some("account-avatar-profile-1"));

        assert!(result.is_ok());
        assert!(
            !registry_path(&config_path).exists(),
            "a no-op icon set must not materialize the registry"
        );
    }

    #[test]
    fn a_profile_created_with_no_icon_key_defaults_to_none() {
        let dir = temp_dir("default-no-icon");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");

        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        assert_eq!(alex.icon_key, None);
        let profiles = list_profiles(&config_path, &live_db_path);
        assert_eq!(profiles.iter().find(|p| p.id == alex.id).unwrap().icon_key, None);
    }

    #[test]
    fn a_registry_file_written_before_icon_key_existed_still_deserializes() {
        let dir = temp_dir("legacy-registry-without-icon-key");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        std::fs::write(
            registry_path(&config_path),
            r#"{"profiles":[{"id":"default","name":"Default","db_path":"C:\\legacy\\vaultspend.db"}]}"#,
        )
        .unwrap();

        let profiles = list_profiles(&config_path, &live_db_path);

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].icon_key, None);
    }

    #[test]
    fn delete_profile_removes_the_registry_entry_without_touching_its_db_file_on_disk() {
        let dir = temp_dir("delete-removes-entry");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();
        std::fs::create_dir_all(alex.db_path.parent().unwrap()).unwrap();
        std::fs::write(&alex.db_path, b"fake db content").unwrap();

        delete_profile(&config_path, &live_db_path, &alex.id).unwrap();

        let profiles = list_profiles(&config_path, &live_db_path);
        assert!(!profiles.iter().any(|p| p.id == alex.id), "the registry entry must be gone");
        assert!(alex.db_path.exists(), "the underlying file must be left untouched");
    }

    #[test]
    fn delete_profile_refuses_to_delete_the_currently_active_profile() {
        let dir = temp_dir("delete-refuses-active");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        // "Switch" to Alex by treating her path as the live one.
        let result = delete_profile(&config_path, &alex.db_path, &alex.id);

        assert!(result.is_err());
        let profiles = list_profiles(&config_path, &alex.db_path);
        assert!(
            profiles.iter().any(|p| p.id == alex.id),
            "the active profile must survive the refused delete"
        );
    }

    #[test]
    fn delete_profile_on_an_unknown_id_is_a_harmless_no_op() {
        let dir = temp_dir("delete-unknown-id");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");

        let result = delete_profile(&config_path, &live_db_path, "no-such-id");

        assert!(result.is_ok());
        assert!(!registry_path(&config_path).exists(), "a no-op delete must not materialize the registry");
    }

    #[test]
    fn update_active_db_path_relocates_the_matching_profile_and_leaves_others_untouched() {
        let dir = temp_dir("update-active-relocates-and-isolates");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();
        let sam = create_profile(&config_path, &live_db_path, "Sam", dt("2026-08-30 12:00:01")).unwrap();
        let relocated_path = dir.join("relocated").join("vaultspend.db");

        // Alex is the active profile; her file just got relocated.
        update_active_db_path(&config_path, &alex.db_path, &relocated_path).unwrap();

        let profiles = list_profiles(&config_path, &relocated_path);
        let alex_after = profiles.iter().find(|p| p.id == alex.id).unwrap();
        assert_eq!(alex_after.db_path, relocated_path);
        assert!(alex_after.is_active);

        let sam_after = profiles.iter().find(|p| p.id == sam.id).unwrap();
        assert_eq!(sam_after.db_path, sam.db_path, "Sam's path must be untouched by Alex's relocation");
    }

    #[test]
    fn update_active_db_path_is_a_no_op_when_no_registry_file_exists_yet() {
        let dir = temp_dir("update-active-no-registry");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let relocated_path = dir.join("relocated").join("vaultspend.db");

        let result = update_active_db_path(&config_path, &live_db_path, &relocated_path);

        assert!(result.is_ok());
        assert!(
            !registry_path(&config_path).exists(),
            "must never materialize the registry for the plain Default profile"
        );
    }
}
