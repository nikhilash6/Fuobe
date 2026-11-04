#!/usr/bin/env node
// Writes data/auth.json again from the sign-in data in the database, for going back to a Fuobe version from before
// sign-in data moved into fuobe.db (docs/SELF-HOSTING.md, "Sign-in data").
//
//   node scripts/auth-export.mjs            # the data folder is FUOBE_DATA_DIR, or ./data
//
// Stop the server first. The file is written in the format the older version reads (the same as src/server/auth-store.ts
// exportJson), readable by this user only, and only when there is no auth.json or only the note left in its place.
// The store is marked "exported": the next start of this version moves the file back in, with what the older version
// changed in it, as long as nothing changed in the database since. Prints counts only, never an email or a secret.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dir = path.resolve(process.env.FUOBE_DATA_DIR ?? path.join(process.cwd(), "data"));
const dbFile = path.join(dir, "fuobe.db");
const authFile = path.join(dir, "auth.json");

function fail(message) {
  console.error(`auth-export: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(dbFile)) fail(`no database at ${dbFile}: set FUOBE_DATA_DIR to the data folder`);

/** What is in auth.json now: nothing, the note this version leaves there, or something else (never written over). */
function current() {
  let raw;
  try {
    raw = fs.readFileSync(authFile, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return "none";
    fail(`${authFile} can't be read (${e.code ?? "error"}): move it away first`);
  }
  if (raw.startsWith("This is not Fuobe's sign-in file any more.")) return "note";
  try {
    const d = JSON.parse(raw);
    const some = (v) => Array.isArray(v) && v.length > 0;
    if (d && typeof d === "object" && d.fuobeSignInMovedTo !== undefined && !some(d.accounts) && !some(d.tokens) && !d.publicSignup) return "note";
  } catch {}
  return "other";
}

const db = new Database(dbFile);
db.pragma("busy_timeout = 5000");
const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_migration'").get();
const marker = has ? db.prepare("SELECT * FROM auth_migration WHERE id = 1").get() : undefined;
if (!marker) fail("this data folder has no sign-in data in the database: nothing to export");
if (marker.state === "bridge") fail("auth.json is still kept up to date by the server (the first minutes after the upgrade): use it as it is");
const state = current();
if (state === "other") fail(`${authFile} is already there and is not the note: move it away first (it is never written over)`);

const extra = (json) => (json ? JSON.parse(json) : {});

const out = db
  .transaction(() => {
    const inst = db.prepare("SELECT secret, password_hash, public_signup, extra_json, version FROM auth_install WHERE id = 1").get();
    const gpus = new Map(db.prepare("SELECT * FROM auth_account_gpu").all().map((g) => [g.account_id, g]));
    const keys = new Map();
    for (const k of db.prepare("SELECT * FROM auth_account_keys ORDER BY rowid").all()) keys.set(k.account_id, [...(keys.get(k.account_id) ?? []), k]);
    const gpuFrom = (g) =>
      g.mode === "computer" ? { mode: "computer" } : { ...(g.mode === "link" && { mode: "link" }), url: g.url ?? "", ...(g.token !== null && { token: g.token }) };
    const keyFrom = (k) => ({ sealed: k.sealed, last4: k.last4, addedAt: k.added_at, ...(k.rejected_at !== null && { rejectedAt: k.rejected_at }) });
    const accounts = db
      .prepare("SELECT * FROM auth_accounts ORDER BY rowid")
      .all()
      .map((r) => {
        const a = { ...extra(r.extra_json), id: r.id, email: r.email, hash: r.password_hash, createdAt: r.created_at };
        if (r.password_changed_at !== null) a.passwordChangedAt = r.password_changed_at;
        if (r.last_login_at !== null) a.lastLoginAt = r.last_login_at;
        if (r.disabled) a.disabled = true;
        if (r.sessions_after !== null) a.sessionsAfter = r.sessions_after;
        const g = gpus.get(r.id);
        if (g) a.gpu = gpuFrom(g);
        const ks = keys.get(r.id);
        if (ks?.length) a.keys = Object.fromEntries(ks.map((k) => [k.provider, keyFrom(k)]));
        return a;
      });
    const tokens = db
      .prepare("SELECT * FROM auth_tokens ORDER BY rowid")
      .all()
      .map((t) => ({
        ...extra(t.extra_json),
        id: t.id,
        name: t.name,
        hash: t.hash,
        prefix: t.prefix,
        createdAt: t.created_at,
        ...(t.last_used_at !== null && { lastUsedAt: t.last_used_at }),
      }));
    const signedOut = db.prepare("SELECT hash, exp FROM auth_signed_out ORDER BY rowid").all();
    const data = {
      ...extra(inst?.extra_json ?? null),
      ...(inst?.password_hash != null && { password: inst.password_hash }),
      secret: inst?.secret ?? "",
      tokens,
      ...(accounts.length && { accounts }),
      ...(inst?.public_signup && { publicSignup: true }),
      ...(signedOut.length && { signedOut }),
    };
    const text = JSON.stringify(data, null, 2);
    const tmp = `${authFile}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    // The file goes in place only if the database's change below commits.
    db.prepare("UPDATE auth_migration SET state = 'exported', exported_version = ? WHERE id = 1").run(inst?.version ?? 0);
    return { tmp, accounts: accounts.length, tokens: tokens.length };
  })
  .immediate();
if (current() === "other") {
  fs.rmSync(out.tmp, { force: true });
  db.prepare("UPDATE auth_migration SET state = 'done', exported_version = NULL WHERE id = 1 AND state = 'exported'").run();
  fail(`${authFile} appeared while exporting: nothing written. Is the server still running?`);
}
fs.renameSync(out.tmp, authFile);
db.close();
console.log(
  `auth-export: wrote ${authFile} with ${out.accounts} accounts and ${out.tokens} API tokens. Start the older version now. When this version starts again, it moves the file back in.`,
);
