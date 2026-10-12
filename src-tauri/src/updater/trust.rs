use base64::Engine;
use budget_core::update_manifest::TrustedUpdateKey;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Registry {
    format: u32,
    keys: Vec<Key>,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Key {
    id: String,
    public_key: String,
}
pub struct PublisherKey {
    pub id: String,
    pub bytes: [u8; 32],
}

pub fn embedded_keys() -> Result<Vec<PublisherKey>, String> {
    parse(include_str!("../../update-keys.json"))
}
pub fn parse(raw: &str) -> Result<Vec<PublisherKey>, String> {
    let registry: Registry = serde_json::from_str(raw).map_err(|_| "The embedded update trust registry is invalid.")?;
    if registry.format != 1 || registry.keys.len() > 8 {
        return Err("The embedded update trust registry is invalid.".into());
    }
    let mut result: Vec<PublisherKey> = Vec::new();
    for key in registry.keys {
        if key.id.is_empty()
            || key.id.len() > 64
            || !key.id.as_bytes()[0].is_ascii_alphanumeric()
            || !key.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            || key.id.to_ascii_lowercase().starts_with("fixture")
            || key.id.to_ascii_lowercase().starts_with("test")
            || key.public_key == "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw="
        {
            return Err("A production publisher identity is required.".into());
        }
        let bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
            .decode(key.public_key)
            .map_err(|_| "The embedded update key is invalid.")?
            .try_into()
            .map_err(|_| "The embedded update key is invalid.")?;
        if bytes == [0; 32] || result.iter().any(|existing| existing.id == key.id || existing.bytes == bytes) {
            return Err("The embedded update key is ambiguous or invalid.".into());
        }
        result.push(PublisherKey { id: key.id, bytes });
    }
    Ok(result)
}
pub fn borrowed(keys: &[PublisherKey]) -> Vec<TrustedUpdateKey<'_>> {
    keys.iter()
        .map(|key| TrustedUpdateKey {
            id: &key.id,
            public_key: &key.bytes,
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_trust_disables_production_and_invalid_or_fixture_trust_is_refused() {
        assert!(parse(r#"{"format":1,"keys":[]}"#).unwrap().is_empty());
        for raw in [
            r#"{"format":2,"keys":[]}"#,
            r#"{"format":1,"keys":[{"id":"test","publicKey":"x"}]}"#,
            r#"{"format":1,"keys":[{"id":"production","publicKey":"6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw="}]}"#,
        ] {
            assert!(parse(raw).is_err());
        }
    }
}
