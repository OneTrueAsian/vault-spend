//! Commands: categories and categorization rules.

use super::*;

#[derive(Serialize)]
pub struct CategoryDto {
    pub name: String,
    pub icon_key: Option<String>,
}

/// Re-reads persisted rules into `state.rules` — needed after any command
/// that edits the `rules` table directly in the store (rename/delete
/// category), so the in-memory rule set categorization actually uses stays
/// in sync without requiring an app restart.
fn reload_rules(state: &mut AppState) -> Result<(), String> {
    state.rules = state.store.load_rules().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct RuleDto {
    pub pattern: String,
    pub category: String,
    pub match_count: usize,
}

#[derive(Serialize)]
pub struct RulePreviewDto {
    pub matching: usize,
    pub would_change: usize,
}

/// Every categorization rule (built-in and learned alike) with how many
/// transactions its pattern touches — Settings' rules manager list.
#[tauri::command]
pub fn list_rules(state: tauri::State<AppStateHandle>) -> Result<Vec<RuleDto>, String> {
    let state = state.lock()?;
    let rules = state.store.list_rules().map_err(|e| e.to_string())?;
    Ok(rules
        .into_iter()
        .map(|r| RuleDto {
            pattern: r.pattern,
            category: r.category,
            match_count: r.match_count,
        })
        .collect())
}

/// What saving this rule would do to transactions already on the books,
/// without saving anything. `replacing` is the pattern of the rule being
/// edited, if any.
#[tauri::command]
pub fn preview_rule(
    pattern: String,
    category: String,
    replacing: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<RulePreviewDto, String> {
    let state = state.lock()?;
    let preview = state
        .store
        .preview_rule(&pattern, &category, replacing.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(RulePreviewDto {
        matching: preview.matching,
        would_change: preview.would_change,
    })
}

/// Creates a rule, or edits one (`replacing` = the old pattern). With
/// `apply_to_existing`, also re-categorizes the transactions
/// `preview_rule` counted. Returns how many were re-categorized.
#[tauri::command]
pub fn save_rule(
    pattern: String,
    category: String,
    replacing: Option<String>,
    apply_to_existing: bool,
    state: tauri::State<AppStateHandle>,
) -> Result<usize, String> {
    let mut state = state.lock()?;
    let pattern = pattern.trim().to_string();
    let category = category.trim().to_string();
    if pattern.is_empty() {
        return Err("A rule needs some text to look for in a transaction's description.".to_string());
    }
    if category.is_empty() {
        return Err("Pick the category this rule should assign.".to_string());
    }

    state.store.create_category(&category, None).map_err(|e| e.to_string())?;
    match replacing.as_deref() {
        Some(old) => state.store.rename_rule(old, &pattern, &category),
        None => state.store.upsert_rule(&pattern, &category),
    }
    .map_err(|e| e.to_string())?;
    reload_rules(&mut state)?;

    if apply_to_existing {
        state.store.apply_rule_to_existing(&pattern, &category).map_err(|e| e.to_string())
    } else {
        Ok(0)
    }
}

/// Removes a rule. Transactions it already categorized keep their category.
#[tauri::command]
pub fn delete_rule(pattern: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let mut state = state.lock()?;
    state.store.delete_rule(&pattern).map_err(|e| e.to_string())?;
    reload_rules(&mut state)
}

#[tauri::command]
pub fn list_categories(state: tauri::State<AppStateHandle>) -> Result<Vec<String>, String> {
    let state = state.lock()?;
    state.store.list_categories().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_categories_with_icons(state: tauri::State<AppStateHandle>) -> Result<Vec<CategoryDto>, String> {
    let state = state.lock()?;
    let categories = state.store.list_categories_with_icons().map_err(|e| e.to_string())?;
    Ok(categories
        .into_iter()
        .map(|c| CategoryDto {
            name: c.name,
            icon_key: c.icon_key,
        })
        .collect())
}

#[tauri::command]
pub fn create_category(name: String, icon_key: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.create_category(&name, icon_key.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_category_icon(name: String, icon_key: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_category_icon(&name, icon_key.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_category(old_name: String, new_name: String, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let mut state = state.lock()?;
    let affected = state.store.rename_category(&old_name, &new_name).map_err(|e| e.to_string())?;
    reload_rules(&mut state)?;
    Ok(affected)
}

#[tauri::command]
pub fn delete_category(name: String, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let mut state = state.lock()?;
    let affected = state.store.delete_category(&name).map_err(|e| e.to_string())?;
    reload_rules(&mut state)?;
    Ok(affected)
}
