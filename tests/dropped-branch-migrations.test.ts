import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-dropped-migrations-"));
process.env.FUOBE_DATA_DIR = dir;
const file = path.join(dir, "fuobe.db");

const { db, MIGRATIONS } = await import("@/server/db");

afterEach(() => {
  globalThis.__fuobeDb?.close();
  globalThis.__fuobeDb = undefined;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// The dropped branch's own places 23 and 24 (claude/fuobe-r5-batch-7 at c9cd489), cut to what they made that matters
// here: acc-1's people table linked to Better Auth and its append-only audit log, and acc-2's DELETE trigger.
const ACC1 = `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    auth_user_id TEXT UNIQUE,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    personal_workspace_id TEXT,
    source TEXT NOT NULL DEFAULT 'unknown',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS audit_log_append_only BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  INSERT OR IGNORE INTO users (id, role, status, personal_workspace_id, source, created_at, updated_at) VALUES
    ('u_owner', 'owner', 'active', 'w_owner', 'setup', 1, 1);
  create table "auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);`;
const ACC2 = `CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;`;

/** A data folder made by another build: its migrations run the way open() runs them, each known by its place. */
function ranBefore(list: string[], extra?: (d: Database.Database) => void) {
  const d = new Database(file);
  d.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)");
  list.forEach((sql, i) => {
    d.exec(sql);
    d.prepare("INSERT INTO _migrations (id) VALUES (?)").run(i);
  });
  extra?.(d);
  d.close();
}

const shared = () => MIGRATIONS.slice(0, 23);
const tables = (d: Database.Database) => new Set((d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
const columns = (d: Database.Database, t: string) => (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const marked = (d: Database.Database) => (d.prepare("SELECT id FROM _migrations ORDER BY id").all() as { id: number }[]).map((r) => r.id);

describe("a data folder that ran PR #15's branch before acc-1 and acc-2 were dropped", () => {
  it("has the places this test assumes: 23 the GPU pre-flight, 24 assets.account_id", () => {
    expect(MIGRATIONS[23]).toContain("CREATE TABLE IF NOT EXISTS gpu_snapshots");
    expect(MIGRATIONS[23]).toContain("ALTER TABLE generations ADD COLUMN fix_json");
    expect(MIGRATIONS[24]).toContain("ALTER TABLE assets ADD COLUMN account_id");
  });

  it("gets the GPU pre-flight's tables and assets.account_id after acc-1 and acc-2 took places 23 and 24", () => {
    ranBefore([...shared(), ACC1, ACC2], (d) => {
      d.prepare("INSERT INTO assets (id, kind, name, rel_path, content_type, size, source, created_at) VALUES ('a1', 'image', 'x.png', 'x.png', 'image/png', 1, 'upload', 1)").run();
    });
    const d = db();
    expect(tables(d)).toContain("gpu_snapshots");
    expect(tables(d)).toContain("gpu_audit");
    expect(columns(d, "generations")).toContain("fix_json");
    expect(columns(d, "assets")).toContain("account_id");
    expect(marked(d)).toEqual(MIGRATIONS.map((_, i) => i));
    // Nothing anyone made goes: the owner's file and the dropped tables stay.
    expect(d.prepare("SELECT id, account_id FROM assets").all()).toEqual([{ id: "a1", account_id: null }]);
    expect(tables(d)).toContain("users");
    expect(tables(d)).toContain("audit_log");
  });

  it("gets both after acc-1 alone took place 23", () => {
    ranBefore([...shared(), ACC1]);
    const d = db();
    expect(tables(d)).toContain("gpu_snapshots");
    expect(columns(d, "assets")).toContain("account_id");
    expect(marked(d)).toEqual(MIGRATIONS.map((_, i) => i));
  });

  it("leaves a folder that already ran this list alone, and opens it again", () => {
    ranBefore(MIGRATIONS);
    let d = db();
    expect(marked(d)).toEqual(MIGRATIONS.map((_, i) => i));
    d.close();
    globalThis.__fuobeDb = undefined;
    // Places 23 and 24 can't run twice (ALTER TABLE … ADD COLUMN): opening again must not try.
    d = db();
    expect(columns(d, "generations").filter((c) => c === "fix_json")).toHaveLength(1);
    expect(marked(d)).toEqual(MIGRATIONS.map((_, i) => i));
  });

  it("forgets only a place whose own work is missing", () => {
    // Place 23 already holds this list's GPU pre-flight; place 24 was acc-2's trigger.
    ranBefore([...MIGRATIONS.slice(0, 24), ACC2.replace("ON audit_log", "ON gpu_audit")], (d) => d.exec("CREATE TABLE users (id TEXT, auth_user_id TEXT)"));
    const d = db();
    expect(columns(d, "generations").filter((c) => c === "fix_json")).toHaveLength(1);
    expect(columns(d, "assets")).toContain("account_id");
    expect(marked(d)).toEqual(MIGRATIONS.map((_, i) => i));
  });
});
