import { execFileSync } from "node:child_process";
import path from "node:path";
import { freshTestDbDir } from "./seed.mjs";
import { seedDemoDatabase } from "./demo-seed.mjs";

export async function uiEnhancementFixture() {
  const dbDir = freshTestDbDir();
  await seedDemoDatabase(dbDir);
  execFileSync("python", ["-c", `import sqlite3
c=sqlite3.connect(r"${path.join(dbDir, "vaultspend.db")}")
c.execute("INSERT OR IGNORE INTO family_members(name) VALUES ('Jordan')")
a=c.execute("SELECT id FROM family_members WHERE name = 'Jordan'").fetchone()[0]
c.execute("INSERT OR IGNORE INTO family_members(name) VALUES ('Riley M.')")
b=c.execute("SELECT id FROM family_members WHERE name = 'Riley M.'").fetchone()[0]
c.execute("UPDATE transactions SET member_id=? WHERE id%3=1",(a,))
c.execute("UPDATE transactions SET member_id=? WHERE id%3=2",(b,))
c.commit()
c.close()`]);
  return dbDir;
}
