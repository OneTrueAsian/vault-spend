//! Family members: the people a household's accounts, transactions, buckets and assets can belong to.

use super::{FamilyMember, Store};
use rusqlite::params;

impl Store {
    /// Creates a new family member — a household member other data
    /// (accounts, transactions, recurring items, buckets, assets) can be
    /// attributed to. Errors (a `UNIQUE` constraint violation) if a member
    /// with that name already exists, same "a duplicate name is a mistake
    /// to surface" convention as `create_bucket`.
    pub fn create_family_member(&self, name: &str) -> rusqlite::Result<i64> {
        self.conn.execute("INSERT INTO family_members (name) VALUES (?1)", params![name])?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Every family member, alphabetical by name.
    pub fn list_family_members(&self) -> rusqlite::Result<Vec<FamilyMember>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM family_members ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(FamilyMember {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Renames a family member. An unknown id is a harmless no-op, same
    /// convention as `update_account_type` and friends.
    pub fn rename_family_member(&self, id: i64, new_name: &str) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE family_members SET name = ?1 WHERE id = ?2", params![new_name, id])?;
        Ok(())
    }

    /// Removes a family member. A member is an attribution label, not a
    /// data container — unlike `delete_account`, this never touches the
    /// financial rows it was attached to, only clears the label on every
    /// table that can carry one, so nothing is left pointing at a
    /// now-deleted member. An unknown id is a harmless no-op.
    pub fn delete_family_member(&self, id: i64) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE transactions SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE recurring SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE buckets SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE assets SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM family_members WHERE id = ?1", params![id])?;
        Ok(())
    }
}
