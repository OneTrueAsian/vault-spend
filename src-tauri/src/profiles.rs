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

/// A refused profile action. `code` is the stable identity callers branch on; `message` is written
/// for people and may be reworded. Failures without a named domain meaning keep their text and
/// share one generic code instead of having a meaning guessed from their wording.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProfileRefusal {
    pub code: &'static str,
    pub message: String,
}

impl ProfileRefusal {
    fn duplicate_name(name: &str) -> Self {
        Self {
            code: "duplicate_profile_name",
            message: format!("A profile named '{name}' already exists."),
        }
    }

    fn already_registered(path: &Path, existing_name: &str) -> Self {
        Self {
            code: "profile_already_registered",
            message: format!("{} is already registered as the '{}' profile.", path.display(), existing_name),
        }
    }

    pub fn profile_not_found() -> Self {
        Self {
            code: "profile_not_found",
            message: "That profile no longer exists.".to_string(),
        }
    }

    pub fn data_file_missing(name: &str, path: &Path) -> Self {
        Self {
            code: "data_file_missing",
            message: format!(
                "{name}'s data file wasn't found at {} — was it moved, or is a removable drive disconnected?",
                path.display()
            ),
        }
    }

    pub fn profile_changed() -> Self {
        Self {
            code: "profile_changed",
            message: "The active profile changed before this profile could be added.".to_string(),
        }
    }

    pub fn wrong_password() -> Self {
        Self {
            code: "wrong_password",
            message: "That password didn't work for this profile.".to_string(),
        }
    }

    pub fn file_not_found(path: &Path) -> Self {
        Self {
            code: "file_not_found",
            message: format!("{} doesn't exist.", path.display()),
        }
    }
}

impl From<String> for ProfileRefusal {
    /// The runtime's `STALE_PROFILE:` prefix is its machine marker for a request from a closed
    /// profile session, not prose, so it keeps its own code. Nothing else is classified.
    fn from(message: String) -> Self {
        let code = if message.starts_with("STALE_PROFILE:") {
            "stale_profile"
        } else {
            "profile_operation_failed"
        };
        Self { code, message }
    }
}

impl From<ProfileRefusal> for String {
    fn from(refusal: ProfileRefusal) -> Self {
        refusal.message
    }
}

/// The on-disk shape of one registry entry. `icon_key` is a purely
/// cosmetic pick from the bundled `account-avatar-profile-*` set (see
/// `flatIcons.ts` on the frontend) — `#[serde(default)]` so a
/// `profiles.json` written before this field existed still deserializes
/// (missing means "no icon picked yet", same as a brand-new profile).
/// `protection` is `#[serde(default)]` for the same reason: every
/// `profiles.json` written before Phase C existed has no such field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct ProfileEntry {
    id: String,
    name: String,
    db_path: String,
    #[serde(default)]
    icon_key: Option<String>,
    #[serde(default)]
    protection: Option<Protection>,
    /// The plaintext path this entry's `db_path` replaced, the one time a conversion actually
    /// moved it (`commit_protection_conversion`) — `None` for every profile that has never been
    /// converted, including one that was protected from creation (nothing was ever plaintext) and
    /// every `profiles.json` written before this field existed. The only reader is `protection_
    /// leftovers::list_leftovers` (via `former_plaintext_path_for`), which needs the ORIGINAL file
    /// to look for leftovers next to — `db_path` itself is the new encrypted file by the time
    /// anyone asks, so passing that instead would misreport the live database as its own leftover.
    #[serde(default)]
    former_plaintext_path: Option<String>,
}

/// Whether a profile's database is encrypted. `None` (the common case) means unprotected. The key
/// file itself lives at `budget_core::protection::keyfile::key_file_path_for(&db_path)` — this
/// struct never stores a path, only the cached format number, so a stale copy of it can never
/// disagree with that naming rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AutoLockSettings {
    pub inactivity_minutes: u32,
    pub lock_when_hidden: bool,
    pub lock_on_focus_loss: bool,
    pub lock_on_system_event: bool,
}

impl Default for AutoLockSettings {
    fn default() -> Self {
        Self {
            inactivity_minutes: 15,
            lock_when_hidden: true,
            lock_on_focus_loss: false,
            lock_on_system_event: true,
        }
    }
}

impl AutoLockSettings {
    pub fn validate(self) -> Result<Self, String> {
        if ![0, 1, 5, 15, 30, 60].contains(&self.inactivity_minutes) {
            return Err("Choose Off, 1, 5, 15, 30, or 60 minutes for automatic locking.".to_string());
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Protection {
    pub format: u32,
    #[serde(default)]
    pub auto_lock: AutoLockSettings,
}

impl Protection {
    pub fn new(format: u32) -> Self {
        Self {
            format,
            auto_lock: AutoLockSettings::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
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
    pub protection: Option<Protection>,
}

impl Profile {
    pub fn is_password_protected(&self) -> bool {
        self.protection.is_some()
    }
}

fn registry_path(config_path: &Path) -> PathBuf {
    config_path.parent().unwrap_or_else(|| Path::new(".")).join(REGISTRY_FILENAME)
}

/// Whether `profiles.json` exists at all — distinct from whether it lists any profiles. An absent
/// file means nobody has ever touched profiles (open the default profile directly, unchanged); a
/// present-but-empty file is a real, if unusual, state (`StartupState::EmptyRegistry`) that must
/// not be treated the same way.
pub fn registry_file_exists(config_path: &Path) -> bool {
    registry_path(config_path).exists()
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

/// Why `profiles.json` could not be read, and whether an earlier good version (`.bak`) exists.
#[derive(Debug)]
pub struct RegistryProblem {
    pub reason: String,
    pub backup_available: bool,
}

fn registry_backup_is_usable(registry_file: &Path) -> bool {
    let backup = registry_file.with_file_name(format!("{REGISTRY_FILENAME}.bak"));
    std::fs::read_to_string(backup)
        .ok()
        .and_then(|text| serde_json::from_str::<Registry>(&text).ok())
        .is_some()
}

/// `Ok(None)`: there is no registry (a normal state before a second profile exists).
/// `Err`: there is one and it cannot be read. `read_registry` cannot tell these apart.
fn read_registry_strict(config_path: &Path) -> Result<Option<Registry>, RegistryProblem> {
    let path = registry_path(config_path);
    let problem = |reason: String| RegistryProblem {
        reason,
        backup_available: registry_backup_is_usable(&path),
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(problem(e.to_string())),
    };
    serde_json::from_str(&text).map(Some).map_err(|e| problem(e.to_string()))
}

fn read_registry(config_path: &Path) -> Option<Registry> {
    read_registry_strict(config_path).ok().flatten()
}

/// One entry of `profiles.json`, as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct RegisteredProfile {
    pub id: String,
    pub name: String,
    pub db_path: PathBuf,
    pub protection: Option<Protection>,
    pub icon_key: Option<String>,
}

/// The registered profiles, or none when there is no registry yet. Unlike `list_profiles` this never
/// invents a Default entry and never hides a registry it could not read; the launch check relies on that.
pub fn registered_profiles_strict(config_path: &Path) -> Result<Vec<RegisteredProfile>, RegistryProblem> {
    Ok(read_registry_strict(config_path)?
        .map(|registry| {
            registry
                .profiles
                .into_iter()
                .map(|p| RegisteredProfile {
                    id: p.id,
                    name: p.name,
                    db_path: PathBuf::from(p.db_path),
                    protection: p.protection,
                    icon_key: p.icon_key,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default())
}

/// The registry id of the profile whose data file is `db_path`: the Default profile's `"default"`
/// when there is no registry, or when no entry names that file.
pub fn profile_id_for(config_path: &Path, db_path: &Path) -> String {
    entries_or_synthesize(config_path, db_path)
        .into_iter()
        .find(|p| Path::new(&p.db_path) == db_path)
        .map(|p| p.id)
        .unwrap_or_else(|| DEFAULT_PROFILE_ID.to_string())
}

/// Puts the previous profile list (`profiles.json.bak`) back in place of a damaged one. The damaged
/// file is kept as `profiles.json.damaged`. Refuses when the backup is missing or unreadable.
pub fn restore_registry_backup(config_path: &Path) -> Result<(), String> {
    let registry_file = registry_path(config_path);
    let backup_file = registry_file.with_file_name(format!("{REGISTRY_FILENAME}.bak"));
    let text = std::fs::read_to_string(&backup_file).map_err(|_| "There is no earlier copy of the profile list to go back to.".to_string())?;
    if serde_json::from_str::<Registry>(&text).is_err() {
        return Err("The earlier copy of the profile list is damaged too, so it can't be used.".to_string());
    }
    if registry_file.exists() {
        let _ = std::fs::rename(&registry_file, registry_file.with_file_name(format!("{REGISTRY_FILENAME}.damaged")));
    }
    budget_core::fsutil::write_atomic(&registry_file, text.as_bytes()).map_err(|e| e.to_string())
}

/// Moves the current profile list aside as `profiles.json.damaged` (replacing an earlier one), so
/// starting over does not destroy it. The `.bak` stays where it is. A no-op when there is no list.
pub fn set_aside_registry(config_path: &Path) -> Result<(), String> {
    let registry_file = registry_path(config_path);
    if !registry_file.exists() {
        return Ok(());
    }
    std::fs::rename(&registry_file, registry_file.with_file_name(format!("{REGISTRY_FILENAME}.damaged")))
        .map_err(|e| format!("couldn't set the profile list aside: {e}"))
}

fn write_registry(config_path: &Path, registry: &Registry) -> Result<(), String> {
    let json = serde_json::to_string_pretty(registry).expect("Registry always serializes");
    let path = registry_path(config_path);
    // Keep the previous version as `.bak`, but never copy a damaged file over a good backup.
    let result = if read_registry_strict(config_path).is_ok() {
        budget_core::fsutil::write_atomic_with_backup(&path, json.as_bytes())
    } else {
        budget_core::fsutil::write_atomic(&path, json.as_bytes())
    };
    result.map_err(|e| e.to_string())
}

fn default_entry(live_db_path: &Path) -> ProfileEntry {
    ProfileEntry {
        id: DEFAULT_PROFILE_ID.to_string(),
        name: DEFAULT_PROFILE_NAME.to_string(),
        db_path: live_db_path.to_string_lossy().to_string(),
        icon_key: None,
        protection: None,
        former_plaintext_path: None,
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
                protection: p.protection,
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
/// The id and directory a new profile named `name` would get, without writing anything — the first
/// half of `create_profile`, split out so protected creation (Phase C, Task 6) can write the
/// database file in between choosing the path and registering it: verify before registering, never
/// the reverse.
pub fn plan_new_profile(config_path: &Path, live_db_path: &Path, name: &str, now: NaiveDateTime) -> Result<(String, PathBuf), ProfileRefusal> {
    let entries = entries_or_synthesize(config_path, live_db_path);
    if entries.iter().any(|p| p.name.eq_ignore_ascii_case(name)) {
        return Err(ProfileRefusal::duplicate_name(name));
    }
    let id = unique_profile_id(&entries, name, now);
    let db_path = profiles_dir(config_path).join(&id).join("vaultspend.db");
    Ok((id, db_path))
}

/// Registers a profile at a path and protection state the caller already prepared and verified.
/// Refuses a duplicate id (should not happen in practice — `plan_new_profile` computed a fresh one
/// — but a caller that raced with another creation must not silently overwrite an entry).
pub fn register_prepared_profile(
    config_path: &Path,
    live_db_path: &Path,
    id: &str,
    name: &str,
    db_path: &Path,
    protection: Option<Protection>,
) -> Result<(), String> {
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    if entries.iter().any(|p| p.id == id) {
        return Err(format!("{id} is already registered."));
    }
    entries.push(ProfileEntry {
        id: id.to_string(),
        name: name.to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        icon_key: None,
        protection,
        former_plaintext_path: None,
    });
    write_registry(config_path, &Registry { profiles: entries })
}

pub fn create_profile(config_path: &Path, live_db_path: &Path, name: &str, now: NaiveDateTime) -> Result<Profile, ProfileRefusal> {
    let (id, db_path) = plan_new_profile(config_path, live_db_path, name, now)?;
    register_prepared_profile(config_path, live_db_path, &id, name, &db_path, None)?;
    Ok(Profile {
        id,
        name: name.to_string(),
        db_path,
        is_active: false,
        icon_key: None,
        protection: None,
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
    protection: Option<Protection>,
    now: NaiveDateTime,
) -> Result<Profile, ProfileRefusal> {
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    if entries.iter().any(|p| p.name.eq_ignore_ascii_case(name)) {
        return Err(ProfileRefusal::duplicate_name(name));
    }
    // Case-insensitive, matching Windows/macOS filesystem semantics (this
    // app's only two build targets — see the CI workflow) — an exact,
    // case-sensitive `PathBuf` comparison would miss a duplicate whenever
    // the file picker returns different letter-casing than what's already
    // stored, silently defeating the whole point of this check.
    let picked_lossy = existing_db_path.to_string_lossy();
    if let Some(existing) = entries.iter().find(|p| p.db_path.eq_ignore_ascii_case(&picked_lossy)) {
        return Err(ProfileRefusal::already_registered(existing_db_path, &existing.name));
    }

    let id = unique_profile_id(&entries, name, now);
    entries.push(ProfileEntry {
        id: id.clone(),
        name: name.to_string(),
        db_path: existing_db_path.to_string_lossy().to_string(),
        icon_key: None,
        protection,
        former_plaintext_path: None,
    });
    write_registry(config_path, &Registry { profiles: entries })?;

    Ok(Profile {
        id,
        name: name.to_string(),
        db_path: existing_db_path.to_path_buf(),
        is_active: false,
        icon_key: None,
        protection,
    })
}

/// Renames a profile. An unknown id is a harmless no-op (matching
/// `rename_family_member`'s convention) — and, unlike a successful rename,
/// never materializes the registry for a plain Default profile that's
/// never actually been renamed. Rejects a case-insensitive duplicate of
/// *another* profile's name; renaming a profile to its own current name is
/// always allowed.
pub fn rename_profile(config_path: &Path, live_db_path: &Path, id: &str, new_name: &str) -> Result<(), ProfileRefusal> {
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    if !entries.iter().any(|p| p.id == id) {
        return Ok(());
    }
    if entries.iter().any(|p| p.id != id && p.name.eq_ignore_ascii_case(new_name)) {
        return Err(ProfileRefusal::duplicate_name(new_name));
    }
    for p in entries.iter_mut() {
        if p.id == id {
            p.name = new_name.to_string();
        }
    }
    Ok(write_registry(config_path, &Registry { profiles: entries })?)
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

/// Records (or clears, with `None`) a profile's protection summary, without touching its db_path —
/// correct only when the path isn't moving (a brand-new protected profile, Task 6; conversion of an
/// existing one moves the path too, via `commit_protection_conversion`). An unconditional update,
/// not merge-only — same convention as `set_profile_icon`. Unknown id is a harmless no-op.
#[allow(dead_code)] // not called until Task 6 (creating a brand-new protected profile)
pub fn set_profile_protection(config_path: &Path, live_db_path: &Path, id: &str, protection: Option<Protection>) -> Result<(), String> {
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    if !entries.iter().any(|p| p.id == id) {
        return Ok(());
    }
    for p in entries.iter_mut() {
        if p.id == id {
            p.protection = protection;
        }
    }
    write_registry(config_path, &Registry { profiles: entries })
}

pub fn auto_lock_settings_for(config_path: &Path, live_db_path: &Path, id: &str) -> Result<AutoLockSettings, String> {
    let profile = entries_or_synthesize(config_path, live_db_path)
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| "That profile no longer exists.".to_string())?;
    profile
        .protection
        .map(|protection| protection.auto_lock)
        .ok_or_else(|| "Turn on password protection before configuring automatic locking.".to_string())
}

pub fn set_auto_lock_settings(config_path: &Path, live_db_path: &Path, id: &str, settings: AutoLockSettings) -> Result<(), String> {
    let settings = settings.validate()?;
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    let profile = entries
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or_else(|| "That profile no longer exists.".to_string())?;
    let protection = profile
        .protection
        .as_mut()
        .ok_or_else(|| "Turn on password protection before configuring automatic locking.".to_string())?;
    protection.auto_lock = settings;
    write_registry(config_path, &Registry { profiles: entries })
}

/// Marks a profile protected AND repoints its registry entry at the newly encrypted database, in
/// one atomic write. The two must land together, never as two separate commits: a kill between
/// them would otherwise leave the registry pointing at a file with no protection recorded (so
/// `protection::transition::recover_interrupted_operation` would wrongly conclude the conversion
/// never committed and delete the very file the registry now names), or leave it pointing at the
/// stale plaintext original with no way back to the encrypted file that replaced it. Unknown id is
/// a harmless no-op, same convention as `set_profile_protection`.
pub fn commit_protection_conversion(
    config_path: &Path,
    live_db_path: &Path,
    id: &str,
    new_db_path: &Path,
    protection: Protection,
) -> Result<(), String> {
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    if !entries.iter().any(|p| p.id == id) {
        return Ok(());
    }
    for p in entries.iter_mut() {
        if p.id == id {
            p.former_plaintext_path = Some(std::mem::replace(&mut p.db_path, new_db_path.to_string_lossy().to_string()));
            p.protection = Some(protection);
        }
    }
    write_registry(config_path, &Registry { profiles: entries })
}

/// The plaintext path `id`'s database used to live at, before a conversion moved it to an encrypted
/// file — `None` if it was never converted (including a profile that was protected from creation,
/// where nothing was ever plaintext). See `ProfileEntry::former_plaintext_path`'s own doc comment
/// for why `protection::leftovers::list_leftovers` needs this rather than the profile's current
/// (already-encrypted) `db_path`.
pub fn former_plaintext_path_for(config_path: &Path, live_db_path: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    let entries = read_registry_strict(config_path)
        .map_err(|problem| format!("Couldn't check the profile registry: {}", problem.reason))?
        .map(|registry| registry.profiles)
        .unwrap_or_else(|| vec![default_entry(live_db_path)]);
    let entry = entries
        .into_iter()
        .find(|p| p.id == id && Path::new(&p.db_path) == live_db_path)
        .ok_or_else(|| "The active profile changed before plaintext cleanup could be checked.".to_string())?;
    Ok(entry.former_plaintext_path.map(PathBuf::from))
}

/// Removes a profile from the registry — the file it points at is left on
/// disk untouched (matching `relocate_data_file`'s "old file left in
/// place" philosophy: deleting a profile removes it from the list, it
/// doesn't destroy data). Refuses to delete whichever profile is currently
/// OPEN (`db_path == live_db_path` AND `currently_open`) — there's an active
/// connection to hot-swap away from and nothing to hot-swap to. `AppPaths`'
/// own `db_path` still names a merely LOCKED profile too (locking closes the
/// connection but never repoints `db_path` — nothing else to point it at),
/// so the caller must pass `currently_open: false` for that case: deleting a
/// locked profile's registry entry is safe (no open connection holds it) and
/// is exactly what the "forgot password, remove this profile" escape needs.
/// Unknown id is a harmless no-op.
pub fn delete_profile(config_path: &Path, live_db_path: &Path, currently_open: bool, id: &str) -> Result<(), ProfileRefusal> {
    let entries = entries_or_synthesize(config_path, live_db_path);
    let Some(target) = entries.iter().find(|p| p.id == id) else {
        return Ok(());
    };
    if currently_open && &target.db_path == live_db_path {
        return Err(ProfileRefusal {
            code: "profile_in_use",
            message: "Can't delete the profile you're currently using — switch to another one first.".to_string(),
        });
    }
    let remaining: Vec<ProfileEntry> = entries.into_iter().filter(|p| p.id != id).collect();
    Ok(write_registry(config_path, &Registry { profiles: remaining })?)
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
mod tests;

/// Clears protection and repoints the profile at its plaintext replacement in one atomic registry
/// write. A crash must never expose only half of this state transition.
#[allow(clippy::items_after_test_module)]
pub fn commit_protection_removal(config_path: &Path, live_db_path: &Path, id: &str, new_db_path: &Path) -> Result<(), String> {
    let mut entries = entries_or_synthesize(config_path, live_db_path);
    if !entries.iter().any(|profile| profile.id == id) {
        return Ok(());
    }
    for profile in &mut entries {
        if profile.id == id {
            profile.db_path = new_db_path.to_string_lossy().to_string();
            profile.protection = None;
            profile.former_plaintext_path = None;
        }
    }
    write_registry(config_path, &Registry { profiles: entries })
}
