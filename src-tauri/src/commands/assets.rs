//! Commands: property and valuables.

use super::*;

#[derive(Serialize)]
pub struct AssetDto {
    pub id: i64,
    pub name: String,
    pub asset_type: String,
    pub value: String,
    pub valued_on: String,
    pub notes: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

#[tauri::command]
pub fn create_asset(
    name: String,
    asset_type: String,
    value: String,
    valued_on: String,
    notes: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock()?;
    let value = parse_amount(&value)?;
    if value < Decimal::ZERO {
        return Err("Value can't be negative.".to_string());
    }
    let valued_on = parse_date(&valued_on)?;
    state
        .store
        .create_asset(&name, &asset_type, value, valued_on, notes.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_assets(state: tauri::State<AppStateHandle>) -> Result<Vec<AssetDto>, String> {
    let state = state.lock()?;
    let assets = state.store.list_assets().map_err(|e| e.to_string())?;
    Ok(assets
        .into_iter()
        .map(|a| AssetDto {
            id: a.id,
            name: a.name,
            asset_type: a.asset_type,
            value: a.value.to_string(),
            valued_on: a.valued_on.to_string(),
            notes: a.notes,
            member_id: a.member_id,
            member_name: a.member_name,
        })
        .collect())
}

#[tauri::command]
pub fn update_asset_value(id: i64, value: String, valued_on: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let value = parse_amount(&value)?;
    if value < Decimal::ZERO {
        return Err("Value can't be negative.".to_string());
    }
    let valued_on = parse_date(&valued_on)?;
    state.store.update_asset_value(id, value, valued_on).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_asset_member(id: i64, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_asset_member(id, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_asset(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.delete_asset(id).map_err(|e| e.to_string())
}
