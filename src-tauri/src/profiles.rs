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
pub fn plan_new_profile(config_path: &Path, live_db_path: &Path, name: &str, now: NaiveDateTime) -> Result<(String, PathBuf), String> {
    let entries = entries_or_synthesize(config_path, live_db_path);
    if entries.iter().any(|p| p.name.eq_ignore_ascii_case(name)) {
        return Err(format!("A profile named '{name}' already exists."));
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

pub fn create_profile(config_path: &Path, live_db_path: &Path, name: &str, now: NaiveDateTime) -> Result<Profile, String> {
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
/// `protection_transition::recover_interrupted_operation` would wrongly conclude the conversion
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
/// for why `protection_leftovers::list_leftovers` needs this rather than the profile's current
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
pub fn delete_profile(config_path: &Path, live_db_path: &Path, currently_open: bool, id: &str) -> Result<(), String> {
    let entries = entries_or_synthesize(config_path, live_db_path);
    let Some(target) = entries.iter().find(|p| p.id == id) else {
        return Ok(());
    };
    if currently_open && &target.db_path == live_db_path {
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
    fn plan_new_profile_computes_the_same_path_create_profile_would_without_writing_anything() {
        let dir = temp_dir("plan-only");
        let live = dir.join("v.db");

        let (id, db_path) = plan_new_profile(&dir.join("config.json"), &live, "Alex", dt("2026-09-21 09:00:00")).unwrap();

        assert!(!dir.join("profiles.json").exists(), "planning alone must not register anything");
        assert_eq!(db_path, profiles_dir(&dir.join("config.json")).join(&id).join("vaultspend.db"));
    }

    #[test]
    fn register_prepared_profile_adds_exactly_the_entry_given_including_protection() {
        let dir = temp_dir("register-prepared");
        let live = dir.join("v.db");
        let (id, db_path) = plan_new_profile(&dir.join("config.json"), &live, "Alex", dt("2026-09-21 09:00:00")).unwrap();

        register_prepared_profile(&dir.join("config.json"), &live, &id, "Alex", &db_path, Some(Protection::new(1))).unwrap();

        let profile = list_profiles(&dir.join("config.json"), &live).into_iter().find(|p| p.id == id).unwrap();
        assert_eq!(profile.db_path, db_path);
        assert_eq!(profile.protection, Some(Protection::new(1)));
    }

    #[test]
    fn registering_the_same_id_twice_is_refused() {
        let dir = temp_dir("register-twice");
        let live = dir.join("v.db");
        let (id, db_path) = plan_new_profile(&dir.join("config.json"), &live, "Alex", dt("2026-09-21 09:00:00")).unwrap();
        register_prepared_profile(&dir.join("config.json"), &live, &id, "Alex", &db_path, None).unwrap();

        assert!(register_prepared_profile(&dir.join("config.json"), &live, &id, "Alex", &db_path, None).is_err());
    }

    #[test]
    fn create_profile_still_behaves_exactly_as_before_the_split() {
        // The full pre-existing test suite for create_profile (name collisions, id disambiguation,
        // returned Profile shape) already covers this — this one just confirms the refactor didn't
        // change create_profile's own contract.
        let dir = temp_dir("create-profile-unchanged");
        let live = dir.join("v.db");

        let profile = create_profile(&dir.join("config.json"), &live, "Alex", dt("2026-09-21 09:00:00")).unwrap();

        assert_eq!(profile.protection, None);
        assert!(!profile.is_active);
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

        let profile = add_existing_profile(&config_path, &live_db_path, "Old Laptop", &brought_over, None, dt("2026-09-02 09:00:00")).unwrap();

        assert_eq!(profile.db_path, brought_over);
        assert!(profile.protection.is_none());
        assert!(
            !dir.join("profiles").exists(),
            "must never create a profiles_dir subdirectory for an existing file"
        );
    }

    #[test]
    fn add_existing_profile_registers_a_protected_profile_when_given_protection_metadata() {
        let dir = temp_dir("add-existing-protected");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let brought_over = dir.join("from-old-laptop").join("vaultspend.db");

        let profile = add_existing_profile(
            &config_path,
            &live_db_path,
            "Old Laptop",
            &brought_over,
            Some(Protection::new(7)),
            dt("2026-09-02 09:00:00"),
        )
        .unwrap();

        assert_eq!(profile.protection, Some(Protection::new(7)));
        let listed = list_profiles(&config_path, &live_db_path);
        let reloaded = listed.iter().find(|p| p.id == profile.id).expect("just-added profile should be listed");
        assert_eq!(
            reloaded.protection,
            Some(Protection::new(7)),
            "protection metadata must survive being re-read from disk"
        );
    }

    #[test]
    fn add_existing_profile_seeds_a_default_entry_the_first_time_the_registry_is_written() {
        let dir = temp_dir("add-existing-seeds-default");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let brought_over = dir.join("brought-over.db");

        add_existing_profile(&config_path, &live_db_path, "Old Laptop", &brought_over, None, dt("2026-09-02 09:00:00")).unwrap();

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
            None,
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

        let result = add_existing_profile(&config_path, &live_db_path, "Alex Again", &alex.db_path, None, dt("2026-09-02 09:00:01"));

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

        let result = add_existing_profile(
            &config_path,
            &live_db_path,
            "Alex Again",
            &differently_cased,
            None,
            dt("2026-09-02 09:00:01"),
        );

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

        delete_profile(&config_path, &live_db_path, true, &alex.id).unwrap();

        let profiles = list_profiles(&config_path, &live_db_path);
        assert!(!profiles.iter().any(|p| p.id == alex.id), "the registry entry must be gone");
        assert!(alex.db_path.exists(), "the underlying file must be left untouched");
    }

    #[test]
    fn delete_profile_refuses_to_delete_the_currently_open_profile() {
        let dir = temp_dir("delete-refuses-active");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        // "Switch" to Alex by treating her path as the live one, genuinely open.
        let result = delete_profile(&config_path, &alex.db_path, true, &alex.id);

        assert!(result.is_err());
        let profiles = list_profiles(&config_path, &alex.db_path);
        assert!(
            profiles.iter().any(|p| p.id == alex.id),
            "the active profile must survive the refused delete"
        );
    }

    #[test]
    fn delete_profile_allows_deleting_a_merely_locked_not_open_profile() {
        // AppPaths::db_path still names a locked (not open) profile too — locking closes the
        // connection but never repoints db_path — so `currently_open: false` must let the delete
        // through even though db_path still matches. This is exactly the "forgot password, remove
        // this profile" escape's own scenario (Phase D, Task 5): the profile it's removing is always
        // the one currently sitting locked, never one that's genuinely open.
        let dir = temp_dir("delete-allows-locked");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &live_db_path, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        delete_profile(&config_path, &alex.db_path, false, &alex.id).unwrap();

        let profiles = list_profiles(&config_path, &alex.db_path);
        assert!(!profiles.iter().any(|p| p.id == alex.id), "a locked (not open) profile must be deletable");
    }

    #[test]
    fn delete_profile_on_an_unknown_id_is_a_harmless_no_op() {
        let dir = temp_dir("delete-unknown-id");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("vaultspend.db");

        let result = delete_profile(&config_path, &live_db_path, true, "no-such-id");

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

    fn bak_path(config_path: &Path) -> PathBuf {
        registry_path(config_path).with_file_name("profiles.json.bak")
    }

    fn leftover_temp_files(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains(".tmp-"))
            .count()
    }

    fn registry_of(dir: &Path, db_file: &str) -> Registry {
        Registry {
            profiles: vec![default_entry(&dir.join(db_file))],
        }
    }

    #[test]
    fn writing_the_registry_keeps_the_previous_version_as_bak_and_leaves_no_temp_file() {
        let dir = temp_dir("registry-bak");
        let config_path = dir.join("config.json");

        write_registry(&config_path, &registry_of(&dir, "first.db")).unwrap();
        assert!(!bak_path(&config_path).exists(), "nothing to back up on the first write");
        write_registry(&config_path, &registry_of(&dir, "second.db")).unwrap();

        let previous: Registry = serde_json::from_str(&std::fs::read_to_string(bak_path(&config_path)).unwrap()).unwrap();
        assert!(previous.profiles[0].db_path.ends_with("first.db"));
        let current = read_registry_strict(&config_path).unwrap().unwrap();
        assert!(current.profiles[0].db_path.ends_with("second.db"));
        assert_eq!(leftover_temp_files(&dir), 0);
    }

    #[test]
    fn the_strict_reader_tells_a_missing_registry_from_a_damaged_one() {
        let dir = temp_dir("registry-strict");
        let config_path = dir.join("config.json");
        assert!(read_registry_strict(&config_path).unwrap().is_none(), "no registry is not an error");

        write_registry(&config_path, &registry_of(&dir, "a.db")).unwrap();
        assert_eq!(read_registry_strict(&config_path).unwrap().unwrap().profiles.len(), 1);

        std::fs::write(registry_path(&config_path), b"{ this is not json").unwrap();
        let damaged = read_registry_strict(&config_path).unwrap_err();
        assert!(!damaged.reason.is_empty());
        assert!(!damaged.backup_available, "there is no earlier version yet");
    }

    #[test]
    fn a_damaged_registry_reports_a_usable_backup_and_never_replaces_it() {
        let dir = temp_dir("registry-damaged-bak");
        let config_path = dir.join("config.json");
        write_registry(&config_path, &registry_of(&dir, "one.db")).unwrap();
        write_registry(&config_path, &registry_of(&dir, "two.db")).unwrap(); // .bak now holds one.db
        std::fs::write(registry_path(&config_path), b"garbage").unwrap();
        assert!(read_registry_strict(&config_path).unwrap_err().backup_available);

        write_registry(&config_path, &registry_of(&dir, "three.db")).unwrap();

        let backup: Registry = serde_json::from_str(&std::fs::read_to_string(bak_path(&config_path)).unwrap()).unwrap();
        assert!(
            backup.profiles[0].db_path.ends_with("one.db"),
            "the good backup must survive a write over a damaged file"
        );
    }

    #[test]
    fn a_damaged_registry_still_lists_only_the_default_because_startup_refuses_to_run_with_one() {
        // Characterization: list_profiles stays lenient; startup::open_from_disk is what refuses to run with a damaged registry.
        let dir = temp_dir("registry-lenient");
        let config_path = dir.join("config.json");
        std::fs::write(registry_path(&config_path), b"garbage").unwrap();

        let profiles = list_profiles(&config_path, &dir.join("vaultspend.db"));

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "default");
    }

    #[test]
    fn registered_profiles_strict_lists_the_registry_and_calls_no_registry_empty() {
        let dir = temp_dir("strict-list");
        let config_path = dir.join("config.json");
        assert!(
            registered_profiles_strict(&config_path).unwrap().is_empty(),
            "no registry is not an error and invents nothing"
        );

        create_profile(&config_path, &dir.join("vaultspend.db"), "Alex", dt("2026-08-30 12:00:00")).unwrap();
        let listed = registered_profiles_strict(&config_path).unwrap();

        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "default");
        assert_eq!(listed[0].db_path, dir.join("vaultspend.db"));
        assert!(listed.iter().any(|p| p.name == "Alex"));
    }

    #[test]
    fn registered_profiles_strict_carries_icon_key_through() {
        // The selector's card grid needs a real icon per profile, not the hardcoded `None` it was
        // stuck with before — `RegisteredProfile` itself never carried this field, so there was
        // nothing for the selector's own construction to read regardless of what the frontend asked
        // for. This is the layer that gap actually lived in.
        let dir = temp_dir("strict-icon");
        let config_path = dir.join("config.json");
        create_profile(&config_path, &dir.join("vaultspend.db"), "Alex", dt("2026-08-30 12:00:00")).unwrap();
        let alex = registered_profiles_strict(&config_path)
            .unwrap()
            .into_iter()
            .find(|p| p.name == "Alex")
            .unwrap();
        set_profile_icon(&config_path, &dir.join("vaultspend.db"), &alex.id, Some("cat")).unwrap();

        let listed = registered_profiles_strict(&config_path).unwrap();

        let updated = listed.iter().find(|p| p.name == "Alex").unwrap();
        assert_eq!(updated.icon_key.as_deref(), Some("cat"));
        let untouched = listed.iter().find(|p| p.id == "default").unwrap();
        assert_eq!(
            untouched.icon_key, None,
            "a profile that never had an icon set should report None, not a made-up default"
        );
    }

    #[test]
    fn registered_profiles_strict_reports_a_damaged_registry_instead_of_inventing_a_default() {
        let dir = temp_dir("strict-damaged");
        let config_path = dir.join("config.json");
        std::fs::write(registry_path(&config_path), b"{ not json").unwrap();

        let problem = registered_profiles_strict(&config_path).unwrap_err();

        assert!(!problem.reason.is_empty());
        assert!(!problem.backup_available);
    }

    #[test]
    fn profile_id_for_names_the_registered_profile_that_owns_the_file() {
        let dir = temp_dir("id-for");
        let config_path = dir.join("config.json");
        let default_db = dir.join("vaultspend.db");
        let alex = create_profile(&config_path, &default_db, "Alex", dt("2026-08-30 12:00:00")).unwrap();

        assert_eq!(profile_id_for(&config_path, &default_db), "default");
        assert_eq!(profile_id_for(&config_path, &alex.db_path), alex.id);
    }

    #[test]
    fn profile_id_for_is_default_without_a_registry_or_for_an_unregistered_file() {
        let dir = temp_dir("id-for-none");
        let config_path = dir.join("config.json");
        assert_eq!(profile_id_for(&config_path, &dir.join("vaultspend.db")), "default");

        create_profile(&config_path, &dir.join("vaultspend.db"), "Alex", dt("2026-08-30 12:00:00")).unwrap();

        assert_eq!(profile_id_for(&config_path, &dir.join("somewhere-else.db")), "default");
    }

    #[test]
    fn restoring_the_registry_backup_brings_back_the_earlier_list_and_keeps_the_damaged_file() {
        let dir = temp_dir("restore-registry");
        let config_path = dir.join("config.json");
        write_registry(&config_path, &registry_of(&dir, "one.db")).unwrap();
        write_registry(&config_path, &registry_of(&dir, "two.db")).unwrap(); // .bak now holds one.db
        std::fs::write(registry_path(&config_path), b"garbage").unwrap();

        restore_registry_backup(&config_path).unwrap();

        let restored = read_registry_strict(&config_path).unwrap().unwrap();
        assert!(restored.profiles[0].db_path.ends_with("one.db"));
        let damaged = registry_path(&config_path).with_file_name("profiles.json.damaged");
        assert_eq!(std::fs::read(damaged).unwrap(), b"garbage", "what was there is kept, not destroyed");
        assert!(bak_path(&config_path).exists(), "the backup stays in place");
    }

    #[test]
    fn restoring_the_registry_backup_refuses_when_there_is_no_usable_backup() {
        let dir = temp_dir("restore-registry-none");
        let config_path = dir.join("config.json");
        std::fs::write(registry_path(&config_path), b"garbage").unwrap();

        assert!(restore_registry_backup(&config_path).is_err(), "no backup at all");
        assert_eq!(
            std::fs::read(registry_path(&config_path)).unwrap(),
            b"garbage",
            "the file is left as it was"
        );

        std::fs::write(bak_path(&config_path), b"also garbage").unwrap();
        assert!(restore_registry_backup(&config_path).is_err(), "a damaged backup is no use either");
    }

    #[test]
    fn setting_the_registry_aside_keeps_its_content_and_the_backup() {
        let dir = temp_dir("set-aside");
        let config_path = dir.join("config.json");
        write_registry(&config_path, &registry_of(&dir, "one.db")).unwrap();
        write_registry(&config_path, &registry_of(&dir, "two.db")).unwrap(); // .bak now holds one.db
        std::fs::write(registry_path(&config_path), b"garbage").unwrap();

        set_aside_registry(&config_path).unwrap();

        assert!(!registry_path(&config_path).exists());
        let damaged = registry_path(&config_path).with_file_name("profiles.json.damaged");
        assert_eq!(std::fs::read(damaged).unwrap(), b"garbage");
        assert!(bak_path(&config_path).exists());
        assert!(read_registry_strict(&config_path).unwrap().is_none(), "no list is not an error");
    }

    #[test]
    fn setting_aside_a_registry_that_is_not_there_is_fine() {
        let dir = temp_dir("set-aside-none");

        assert!(set_aside_registry(&dir.join("config.json")).is_ok());
    }

    // ---- password protection metadata (Phase C, Task 1) ----

    #[test]
    fn a_profile_with_no_protection_field_reads_as_unprotected() {
        let dir = temp_dir("no-protection-field");
        std::fs::write(
            dir.join("profiles.json"),
            r#"{"profiles":[{"id":"default","name":"Default","db_path":"C:\\v.db"}]}"#,
        )
        .unwrap();

        let profiles = list_profiles(&dir.join("config.json"), Path::new("C:\\v.db"));

        assert_eq!(profiles[0].protection, None);
        assert!(!profiles[0].is_password_protected());
    }

    #[test]
    fn old_protection_metadata_gets_safe_auto_lock_defaults() {
        let dir = temp_dir("old-auto-lock-defaults");
        let registry = dir.join("profiles.json");
        let original = r#"{"profiles":[{"id":"default","name":"Default","db_path":"C:\\v.db","protection":{"format":1}}]}"#;
        std::fs::write(&registry, original).unwrap();

        let profiles = list_profiles(&dir.join("config.json"), Path::new("C:\\v.db"));
        let settings = profiles[0].protection.unwrap().auto_lock;

        assert_eq!(settings.inactivity_minutes, 15);
        assert!(settings.lock_when_hidden);
        assert!(!settings.lock_on_focus_loss);
        assert!(settings.lock_on_system_event);
        assert_eq!(
            std::fs::read_to_string(registry).unwrap(),
            original,
            "reading defaults must not rewrite the registry"
        );
    }

    #[test]
    fn auto_lock_settings_accept_only_the_documented_intervals() {
        for minutes in [0, 1, 5, 15, 30, 60] {
            assert!(AutoLockSettings {
                inactivity_minutes: minutes,
                ..AutoLockSettings::default()
            }
            .validate()
            .is_ok());
        }
        assert!(AutoLockSettings {
            inactivity_minutes: 2,
            ..AutoLockSettings::default()
        }
        .validate()
        .is_err());
    }

    #[test]
    fn updating_auto_lock_settings_changes_only_the_selected_protected_profile() {
        let dir = temp_dir("set-auto-lock");
        let config = dir.join("config.json");
        let live = dir.join("v.db");
        create_profile(&config, &live, "Alex", dt("2026-09-21 09:00:00")).unwrap();
        let profiles = list_profiles(&config, &live);
        let default_id = profiles[0].id.clone();
        let alex_id = profiles[1].id.clone();
        set_profile_protection(&config, &live, &default_id, Some(Protection::new(1))).unwrap();
        set_profile_protection(&config, &live, &alex_id, Some(Protection::new(1))).unwrap();
        let changed = AutoLockSettings {
            inactivity_minutes: 30,
            lock_when_hidden: false,
            lock_on_focus_loss: true,
            lock_on_system_event: false,
        };

        set_auto_lock_settings(&config, &live, &alex_id, changed).unwrap();

        let after = list_profiles(&config, &live);
        assert_eq!(after.iter().find(|p| p.id == alex_id).unwrap().protection.unwrap().auto_lock, changed);
        assert_eq!(
            after.iter().find(|p| p.id == default_id).unwrap().protection.unwrap().auto_lock,
            AutoLockSettings::default()
        );
    }

    #[test]
    fn an_unprotected_profile_cannot_save_auto_lock_settings() {
        let dir = temp_dir("set-auto-lock-unprotected");
        let config = dir.join("config.json");
        let live = dir.join("v.db");

        let error = set_auto_lock_settings(&config, &live, "default", AutoLockSettings::default()).unwrap_err();

        assert!(error.contains("password protection"), "{error}");
        assert!(!dir.join("profiles.json").exists());
    }

    #[test]
    fn set_profile_protection_records_and_clears_it() {
        let dir = temp_dir("set-protection");
        let live = dir.join("v.db");
        create_profile(&dir.join("config.json"), &live, "Alex", dt("2026-09-21 09:00:00")).unwrap();
        let id = list_profiles(&dir.join("config.json"), &live)[1].id.clone();

        set_profile_protection(&dir.join("config.json"), &live, &id, Some(Protection::new(1))).unwrap();
        let after_set = list_profiles(&dir.join("config.json"), &live);
        assert_eq!(after_set.iter().find(|p| p.id == id).unwrap().protection, Some(Protection::new(1)));

        set_profile_protection(&dir.join("config.json"), &live, &id, None).unwrap();
        let after_clear = list_profiles(&dir.join("config.json"), &live);
        assert_eq!(after_clear.iter().find(|p| p.id == id).unwrap().protection, None);
    }

    #[test]
    fn setting_protection_on_an_unknown_id_is_a_harmless_no_op() {
        let dir = temp_dir("set-protection-unknown");
        let live = dir.join("v.db");

        set_profile_protection(&dir.join("config.json"), &live, "nobody", Some(Protection::new(1))).unwrap();

        assert!(
            !dir.join("profiles.json").exists(),
            "a plain Default profile must not be materialized by this"
        );
    }

    #[test]
    fn commit_protection_conversion_moves_the_path_and_sets_protection_together() {
        let dir = temp_dir("commit-conversion");
        let live = dir.join("v.db");
        create_profile(&dir.join("config.json"), &live, "Alex", dt("2026-09-21 09:00:00")).unwrap();
        let id = list_profiles(&dir.join("config.json"), &live)[1].id.clone();
        let new_path = dir.join("v-protected.db");

        commit_protection_conversion(&dir.join("config.json"), &live, &id, &new_path, Protection::new(1)).unwrap();

        let after = list_profiles(&dir.join("config.json"), &new_path);
        let entry = after.iter().find(|p| p.id == id).unwrap();
        assert_eq!(entry.db_path, new_path);
        assert_eq!(entry.protection, Some(Protection::new(1)));
    }

    #[test]
    fn commit_protection_removal_clears_protection_and_repoints_the_path_together() {
        let dir = temp_dir("commit-removal");
        let config_path = dir.join("config.json");
        let live = dir.join("v.db");
        create_profile(&config_path, &live, "Sam", dt("2026-09-24 09:00:00")).unwrap();
        let id = list_profiles(&config_path, &live)[1].id.clone();
        set_profile_protection(&config_path, &live, &id, Some(Protection::new(1))).unwrap();
        let new_path = dir.join("vaultspend.db");

        commit_protection_removal(&config_path, &live, &id, &new_path).unwrap();

        let entry = list_profiles(&config_path, &new_path)
            .into_iter()
            .find(|profile| profile.id == id)
            .unwrap();
        assert_eq!(entry.protection, None);
        assert_eq!(entry.db_path, new_path);
    }

    #[test]
    fn commit_protection_conversion_remembers_the_plaintext_path_it_replaced() {
        // Mirrors the real call site (`protection_commands::enable_profile_protection`): the
        // profile being converted is always the one that's currently open, so its own current
        // `db_path` — not the `live_db_path` parameter, which only matters for the no-registry
        // synthesize fallback — is the plaintext path that must be remembered.
        let dir = temp_dir("commit-conversion-remembers-former-path");
        let live = dir.join("v.db");
        create_profile(&dir.join("config.json"), &live, "Alex", dt("2026-09-21 09:00:00")).unwrap();
        let alex = list_profiles(&dir.join("config.json"), &live)[1].clone();
        let new_path = dir.join("v-protected.db");

        commit_protection_conversion(&dir.join("config.json"), &alex.db_path, &alex.id, &new_path, Protection::new(1)).unwrap();

        assert_eq!(
            former_plaintext_path_for(&dir.join("config.json"), &new_path, &alex.id).unwrap(),
            Some(alex.db_path)
        );
    }

    #[test]
    fn a_profile_with_no_conversion_behind_it_has_no_former_plaintext_path() {
        let dir = temp_dir("no-former-path");
        let live = dir.join("v.db");
        let alex = create_profile(&dir.join("config.json"), &live, "Alex", dt("2026-09-21 09:00:00")).unwrap();
        assert_eq!(
            former_plaintext_path_for(&dir.join("config.json"), &alex.db_path, &alex.id).unwrap(),
            None
        );
    }

    #[test]
    fn plaintext_discovery_refuses_stale_identity_and_corrupt_registry() {
        let dir = temp_dir("strict-plaintext-discovery");
        let config = dir.join("config.json");
        let live = dir.join("vaultspend.db");
        let alex = create_profile(&config, &live, "Alex", dt("2026-08-30 12:00:00")).unwrap();
        assert!(former_plaintext_path_for(&config, &live, &alex.id).is_err());
        assert!(former_plaintext_path_for(&config, &live, "unknown-profile").is_err());
        std::fs::write(registry_path(&config), b"{invalid registry").unwrap();
        assert!(former_plaintext_path_for(&config, &live, DEFAULT_PROFILE_ID).is_err());
    }

    #[test]
    fn commit_protection_conversion_on_an_unknown_id_is_a_harmless_no_op() {
        let dir = temp_dir("commit-conversion-unknown");
        let live = dir.join("v.db");
        let new_path = dir.join("v-protected.db");

        commit_protection_conversion(&dir.join("config.json"), &live, "nobody", &new_path, Protection::new(1)).unwrap();

        assert!(
            !dir.join("profiles.json").exists(),
            "a plain Default profile must not be materialized by this"
        );
    }

    #[test]
    fn registered_profiles_strict_carries_protection_through_too() {
        let dir = temp_dir("registered-strict-protection");
        let live = dir.join("v.db");
        create_profile(&dir.join("config.json"), &live, "Sam", dt("2026-09-21 09:00:00")).unwrap();
        let id = list_profiles(&dir.join("config.json"), &live)[1].id.clone();
        set_profile_protection(&dir.join("config.json"), &live, &id, Some(Protection::new(1))).unwrap();

        let registered = registered_profiles_strict(&dir.join("config.json")).unwrap();

        assert_eq!(registered.iter().find(|p| p.id == id).unwrap().protection, Some(Protection::new(1)));
    }
}

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
