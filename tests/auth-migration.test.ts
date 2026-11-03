/**
 * Sign-in data in SQLite (src/server/auth-store.ts): a new install, an older install's auth.json moving in (once, in one
 * transaction), the bridge that keeps auth.json in step for a server of an older build, putting it aside, crashes, a
 * second server starting at the same moment, a file that can't be read or can't go in, and 100,000 accounts.
 * Synthetic data only. Each "server" is the auth modules loaded afresh on a data folder (a restart).
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_PUBLIC_SIGNUP;
delete process.env.FUOBE_AUTH_BRIDGE_MS;

const DAY = 86_400_000;
const MIN = 60_000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const mac = (key: string, payload: string) => crypto.createHmac("sha256", key).update(payload).digest("base64url");
const hashPw = (pw: string) => {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
};

/** The auth modules loaded afresh on a data folder: a server (re)starting there. */
async function server(dir: string) {
  globalThis.__fuobeDb?.close();
  globalThis.__fuobeDb = undefined;
  globalThis.__fuobeAuthTablesError = undefined;
  globalThis.__fuobeSecretKey = undefined;
  process.env.FUOBE_DATA_DIR = dir;
  vi.resetModules();
  const auth = await import("@/server/auth");
  const store = await import("@/server/auth-store");
  const box = await import("@/server/secret-box");
  const keys = await import("@/server/account-keys");
  const db = () => globalThis.__fuobeDb!;
  const marker = () => db().prepare("SELECT * FROM auth_migration WHERE id = 1").get() as Record<string, unknown> | undefined;
  const count = (t: string) => (db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return { auth, store, box, keys, db, marker, count };
}

afterEach(() => {
  globalThis.__fuobeAuthClock = undefined;
  globalThis.__fuobeAuthImportFault = undefined;
  delete process.env.FUOBE_AUTH_BRIDGE_MS;
});
afterAll(() => {
  globalThis.__fuobeDb?.close();
  globalThis.__fuobeDb = undefined;
});

const authFile = (dir: string) => path.join(dir, "auth.json");

/** What a server of an older build reads: the file, or "no file" (an open studio), or a file it can't read (fails closed). */
function legacyRead(dir: string): Record<string, unknown> & { unreadable?: true } {
  try {
    const d = JSON.parse(fs.readFileSync(authFile(dir), "utf8"));
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("not an object");
    return d;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { secret: "", tokens: [] };
    return { unreadable: true };
  }
}

/** A server of an older build writing auth.json (a temporary file, then a rename). */
function legacyWrite(dir: string, data: unknown): void {
  const tmp = `${authFile(dir)}.old.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, authFile(dir));
}

/** An auth.json as an older install has it, every optional field used, and cookies and tokens made before the move. */
function fixture(seal: (plain: string, context: string) => string) {
  const now = Date.now();
  const secret = crypto.randomBytes(32).toString("hex");
  const owner = hashPw("owner password");
  const ctx = (id: string, p: string) => `fuobe:account-key:v1:${id}:${p}`;
  const accounts = [
    {
      id: "acct00000000000001",
      email: "first@example.com",
      hash: hashPw("first password"),
      createdAt: now - 9 * DAY,
      lastLoginAt: now - DAY,
      gpu: { mode: "link", url: "https://gpu-a.example.com", token: "gpu-link-token-a" },
      keys: {
        fal: { sealed: seal("fal-key-first:ab12", ctx("acct00000000000001", "fal")), last4: "ab12", addedAt: now - DAY },
        replicate: { sealed: seal("r8_replicate_first_cd34", ctx("acct00000000000001", "replicate")), last4: "cd34", addedAt: now - DAY, rejectedAt: now - 1000 },
      },
      futureField: { kept: true },
    },
    {
      id: "acct00000000000002",
      email: "second@example.com",
      hash: hashPw("second password"),
      createdAt: now - 5 * DAY,
      passwordChangedAt: now - 2 * DAY,
      disabled: false,
      sessionsAfter: now - 3 * DAY,
      gpu: { url: "https://gpu-b.example.com" },
    },
    { id: "acct00000000000003", email: "third@example.com", hash: hashPw("third password"), createdAt: now - DAY, disabled: true, gpu: { mode: "computer" } },
    { id: "acct00000000000004", email: "fourth@example.com", hash: hashPw("fourth password"), createdAt: now - 1000, keys: {} },
  ];
  const tokenValue = () => `fuobe_${crypto.randomBytes(24).toString("base64url")}`;
  const tokens = [tokenValue(), tokenValue(), tokenValue()];
  const exp = now + 29 * DAY;
  const ownerCookie = `${exp}.${mac(`${secret}.${sha(owner)}`, String(exp))}`;
  const signedOutCookie = `${exp - 1}.${mac(`${secret}.${sha(owner)}`, String(exp - 1))}`;
  const accountCookie = (a: (typeof accounts)[number]) => `${exp}.${a.id}.${mac(`${secret}.${sha(a.hash)}`, `${exp}.${a.id}`)}`;
  const legacyCookie = (a: (typeof accounts)[number]) => `${exp}.${a.id}.${mac(secret, `${exp}.${a.id}`)}`;
  const data = {
    password: owner,
    secret,
    tokens: [
      { id: "tok1", name: "CI", hash: sha(tokens[0]), prefix: tokens[0].slice(0, 12), createdAt: now - DAY, lastUsedAt: now - 2 * 3_600_000 },
      { id: "tok2", name: "Laptop", hash: sha(tokens[1]), prefix: tokens[1].slice(0, 12), createdAt: now - DAY },
      { id: "tok3", name: "MCP", hash: sha(tokens[2]), prefix: tokens[2].slice(0, 12), createdAt: now - 1000 },
    ],
    accounts,
    publicSignup: true,
    signedOut: [
      { hash: sha(signedOutCookie), exp: exp - 1 },
      { hash: sha("an expired cookie"), exp: now - 1000 },
    ],
    laterSetting: { kept: "as it was" },
  };
  return {
    data,
    tokens,
    cookies: {
      owner: ownerCookie,
      signedOut: signedOutCookie,
      first: accountCookie(accounts[0]),
      second: accountCookie(accounts[1]),
      third: accountCookie(accounts[2]),
      firstLegacy: legacyCookie(accounts[0]),
      secondLegacy: legacyCookie(accounts[1]),
    },
  };
}

/** A data folder with an older install's auth.json (and the server key its account keys were sealed with). */
async function olderInstall(prefix: string) {
  const dir = tempDir(prefix);
  const srv = await server(dir);
  const fx = fixture(srv.box.seal);
  fs.writeFileSync(authFile(dir), JSON.stringify(fx.data, null, 2), { mode: 0o600 });
  return { dir, srv, fx, original: fs.readFileSync(authFile(dir), "utf8") };
}

describe("a new install", () => {
  it("starts open with nothing stored; the first change sets the store up and leaves a note no older build can read", async () => {
    const dir = tempDir("fuobe-auth-new-");
    let srv = await server(dir);
    expect(srv.auth.authEnabled()).toBe(false);
    expect(srv.store.authStoreMode()).toBe("fresh");
    expect(srv.auth.listAccounts()).toEqual([]);
    expect(srv.marker()).toBeUndefined();
    expect(fs.existsSync(authFile(dir))).toBe(false);
    srv.auth.setPassword("owner password");
    expect(srv.marker()).toMatchObject({ source: "new", state: "done" });
    expect(() => JSON.parse(fs.readFileSync(authFile(dir), "utf8"))).toThrow();
    expect(fs.readFileSync(authFile(dir), "utf8")).toContain("fuobe.db");
    // An older build pointed at this folder fails closed instead of opening the studio.
    expect(legacyRead(dir).unreadable).toBe(true);
    srv = await server(dir);
    expect(srv.auth.authEnabled()).toBe(true);
    expect(srv.auth.checkPassword("owner password")).toBe(true);
    expect(srv.store.authStoreMode()).toBe("done");
  });

  it("moves in an auth.json put there before the first change, and ignores one put back after", async () => {
    const dir = tempDir("fuobe-auth-drop-");
    let srv = await server(dir);
    expect(srv.auth.authEnabled()).toBe(false);
    legacyWrite(dir, { password: hashPw("dropped password"), secret: "a".repeat(64), tokens: [] });
    expect(srv.auth.authEnabled()).toBe(true);
    expect(srv.auth.checkPassword("dropped password")).toBe(true);
    expect(srv.marker()).toMatchObject({ source: "auth.json", state: "bridge" });
    // Put aside, then an auth.json without a password put back: not read.
    globalThis.__fuobeAuthClock = () => Date.now() + 11 * MIN;
    expect(srv.store.authStoreMode()).toBe("done");
    legacyWrite(dir, { secret: "", tokens: [] });
    srv = await server(dir);
    expect(srv.auth.authEnabled()).toBe(true);
    expect(srv.auth.checkPassword("dropped password")).toBe(true);
  });
});

describe("an older install's auth.json moves in", () => {
  it("whole: every account, token and setting reads back the same; cookies, tokens, passwords and sealed keys made before still work", async () => {
    const { dir, srv, fx, original } = await olderInstall("fuobe-auth-import-");
    const { auth, store, keys } = srv;
    expect(store.authStoreMode()).toBe("bridge");
    expect(srv.marker()).toMatchObject({ source: "auth.json", state: "bridge" });
    expect(JSON.parse(srv.marker()!.counts_json as string)).toEqual({ accounts: 4, tokens: 3, keys: 2, gpus: 3, signedOut: 1 });
    expect([srv.count("auth_accounts"), srv.count("auth_tokens"), srv.count("auth_account_keys"), srv.count("auth_account_gpu"), srv.count("auth_signed_out")]).toEqual([4, 3, 2, 3, 1]);
    // Moving in doesn't touch the file.
    expect(fs.readFileSync(authFile(dir), "utf8")).toBe(original);

    // Every account as it was (the "disabled: false" and empty keys of the file mean the same as leaving them out).
    const [first, second, third, fourth] = fx.data.accounts;
    expect(auth.accountById(first.id)).toEqual(first);
    const without = (o: object, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
    expect(auth.accountById(second.id)).toEqual(without(second, "disabled"));
    expect(auth.accountById(third.id)).toEqual(third);
    expect(auth.accountById(fourth.id)).toEqual(without(fourth, "keys"));
    const out = store.exportJson();
    expect(out.laterSetting).toEqual({ kept: "as it was" });
    expect(out.tokens).toEqual(fx.data.tokens);
    expect(out.signedOut).toEqual([fx.data.signedOut[0]]);
    expect(out.publicSignup).toBe(true);
    expect(auth.listAccounts().map((a) => a.email)).toEqual(["fourth@example.com", "third@example.com", "second@example.com", "first@example.com"]);
    expect(auth.listAccounts()[3]).toMatchObject({ gpu: true, keys: ["fal", "replicate"], disabled: false });

    // Sign-in made before the move.
    expect(auth.authEnabled()).toBe(true);
    expect(auth.publicSignupSetting()).toBe(true);
    expect(auth.checkPassword("owner password")).toBe(true);
    expect(auth.validSession(fx.cookies.owner)).toBe(true);
    expect(auth.sessionViewer(fx.cookies.signedOut)).toBeNull();
    expect(auth.sessionViewer(fx.cookies.first)).toMatchObject({ kind: "account", account: { email: "first@example.com" } });
    expect(auth.sessionViewer(fx.cookies.second)).toMatchObject({ kind: "account", account: { email: "second@example.com" } });
    expect(auth.sessionViewer(fx.cookies.third)).toBeNull(); // switched off
    expect(auth.sessionViewer(fx.cookies.firstLegacy)).toMatchObject({ kind: "account" });
    expect(auth.sessionViewer(fx.cookies.secondLegacy)).toBeNull(); // changed its password since
    for (const t of fx.tokens) expect(auth.validToken(`Bearer ${t}`)).toBe(true);
    expect(auth.checkAccount("First@Example.com", "first password")?.id).toBe(first.id);
    await expect(auth.verifyAccount("second@example.com", "second password")).resolves.toMatchObject({ id: second.id });
    expect(auth.checkAccount("first@example.com", "second password")).toBeNull();
    // Sealed keys open with the same server key: nothing was sealed again.
    expect(keys.accountKey(first.id, "fal")).toBe("fal-key-first:ab12");
    expect(keys.accountKey(first.id, "replicate")).toBe("r8_replicate_first_cd34");
    expect(auth.accountKeyRecord(first.id, "fal")?.sealed).toBe(first.keys!.fal!.sealed);
    expect(auth.accountGpu(first.id)).toEqual(first.gpu);
    expect(auth.accountGpu(second.id)).toEqual({ url: "https://gpu-b.example.com" });
    expect(auth.accountGpu(third.id)).toBeNull(); // switched off

    // A restart moves nothing in again.
    const startedAt = srv.marker()!.started_at;
    const again = await server(dir);
    expect(again.auth.listAccounts()).toHaveLength(4);
    expect(again.marker()!.started_at).toBe(startedAt);
    expect(again.count("auth_accounts")).toBe(4);
    expect(again.auth.validSession(fx.cookies.owner)).toBe(true);
  });

  it("every sign-in path works on the moved data", async () => {
    const { srv, fx } = await olderInstall("fuobe-auth-paths-");
    const { auth } = srv;
    const [first, second] = fx.data.accounts;
    // A new password for an account ends its other sign-ins.
    const changed = await auth.setAccountPassword(first.id, "first password", "first new password");
    expect(auth.sessionViewer(fx.cookies.first)).toBeNull();
    expect(auth.sessionViewer(fx.cookies.firstLegacy)).toBeNull();
    expect(auth.sessionViewer(auth.createSession(first.id).value)).toMatchObject({ kind: "account" });
    expect(changed.passwordChangedAt).toBeGreaterThan(0);
    await expect(auth.setAccountPassword(first.id, "wrong", "whatever long")).rejects.toMatchObject({ status: 403 });
    await expect(auth.setAccountPassword("nobody", "x", "whatever long")).rejects.toMatchObject({ status: 404 });
    // Owner: switch off, sign out everywhere, delete.
    auth.setAccountDisabled(second.id, true);
    expect(auth.sessionViewer(fx.cookies.second)).toBeNull();
    auth.setAccountDisabled(second.id, false);
    expect(auth.sessionViewer(fx.cookies.second)).toMatchObject({ kind: "account" });
    auth.signOutAccount(second.id);
    expect(auth.sessionViewer(fx.cookies.second)).toBeNull();
    expect(() => auth.setAccountDisabled("nobody", true)).toThrow(/No such account/);
    expect(() => auth.signOutAccount("nobody")).toThrow(/No such account/);
    expect(() => auth.setAccountGpu("nobody", null)).toThrow(/No such account/);
    expect(() => auth.setAccountKey("nobody", "fal", null)).toThrow(/No such account/);
    auth.deleteAccount(first.id);
    expect(auth.accountById(first.id)).toBeUndefined();
    expect(auth.accountKeyRecord(first.id, "fal")).toBeNull();
    expect(srv.db().prepare("SELECT COUNT(*) AS n FROM auth_account_keys WHERE account_id = ?").get(first.id)).toEqual({ n: 0 });
    expect(srv.db().prepare("SELECT COUNT(*) AS n FROM auth_account_gpu WHERE account_id = ?").get(first.id)).toEqual({ n: 0 });
    expect(() => auth.deleteAccount(first.id)).toThrow(/No such account/);
    // Sign-up: one account per email, whatever its case.
    const made = auth.createAccount("New.Person@Example.com", "long enough");
    expect(() => auth.createAccount("new.person@example.COM", "long enough")).toThrow(expect.objectContaining({ status: 409 }));
    expect(auth.checkAccount("new.person@example.com", "long enough")?.id).toBe(made.id);
    // Sign out (this cookie only), then everyone (with tokens).
    const owner = auth.createSession().value;
    await new Promise((r) => setTimeout(r, 5)); // another expiry: another cookie
    const other = auth.createSession().value;
    auth.endSession(owner);
    expect(auth.validSession(owner)).toBe(false);
    expect(auth.validSession(other)).toBe(true);
    const v = auth.authVersion();
    auth.signOutEveryone({ tokens: true });
    expect(auth.authVersion()).not.toBe(v);
    expect(auth.validSession(other)).toBe(false);
    expect(auth.validSession(fx.cookies.owner)).toBe(false);
    for (const t of fx.tokens) expect(auth.validToken(`Bearer ${t}`)).toBe(false);
    expect(auth.authStatus().tokens).toEqual([]);
    // Tokens: made, used, revoked.
    const { token, info } = auth.createToken("Script");
    expect(auth.validToken(`Bearer ${token}`)).toBe(true);
    expect(auth.authStatus().tokens).toEqual([expect.objectContaining({ id: info.id, name: "Script", lastUsedAt: expect.any(Number) })]);
    auth.revokeToken(info.id);
    expect(auth.validToken(`Bearer ${token}`)).toBe(false);
    // The public sign-up switch, and the Settings password.
    auth.setPublicSignup(false);
    expect(auth.publicSignupSetting()).toBe(false);
    auth.setPassword(null);
    expect(auth.authEnabled()).toBe(false);
    auth.setPassword("owner password two");
    expect(auth.checkPassword("owner password two")).toBe(true);
    // The sweep's account list.
    expect(auth.readAccountIds()).toEqual(new Set(auth.listAccounts().map((a) => a.id)));
    expect(auth.accountsCsv().split("\r\n")[0]).toBe("email,created,last_login,gpu_connected,fal_key,replicate_key,disabled");
  });
});

describe("the bridge: auth.json kept in step for a server of an older build", () => {
  it("writes each change to auth.json in its usual format, and reads back what an older server writes there", async () => {
    const { dir, srv, fx } = await olderInstall("fuobe-auth-bridge-");
    const { auth } = srv;
    expect(srv.store.authStoreMode()).toBe("bridge");
    // A change here: the older server sees it.
    const made = auth.createAccount("bridge-new@example.com", "long enough");
    const text = fs.readFileSync(authFile(dir), "utf8");
    expect(text).toBe(JSON.stringify(srv.store.exportJson(), null, 2));
    const seen = legacyRead(dir) as { accounts: { id: string; email: string }[]; password: string; secret: string };
    expect(seen.accounts.map((a) => a.email)).toContain("bridge-new@example.com");
    expect(seen.password).toBe(fx.data.password);
    expect(seen.secret).toBe(fx.data.secret);
    if (process.platform !== "win32") expect(fs.statSync(authFile(dir)).mode & 0o777).toBe(0o600);

    // The older server signs someone up, revokes a token and signs a cookie out: seen here on the next call.
    const older = legacyRead(dir) as typeof fx.data & { accounts: Record<string, unknown>[] };
    older.accounts.push({ id: "acctolder000000001", email: "older-signup@example.com", hash: hashPw("older password"), createdAt: Date.now(), lastLoginAt: Date.now() });
    older.tokens = older.tokens.filter((t) => t.id !== "tok2");
    older.signedOut = [...(older.signedOut ?? []), { hash: sha(fx.cookies.first), exp: Date.now() + DAY }];
    legacyWrite(dir, older);
    expect(auth.checkAccount("older-signup@example.com", "older password")?.id).toBe("acctolder000000001");
    expect(auth.validToken(`Bearer ${fx.tokens[1]}`)).toBe(false);
    expect(auth.validToken(`Bearer ${fx.tokens[0]}`)).toBe(true);
    expect(auth.sessionViewer(fx.cookies.first)).toBeNull();
    expect(auth.accountById(made.id)?.email).toBe("bridge-new@example.com");
    // Then a change here keeps both.
    auth.setAccountDisabled(made.id, true);
    const after = legacyRead(dir) as { accounts: { id: string; disabled?: boolean }[] };
    expect(after.accounts.find((a) => a.id === made.id)?.disabled).toBe(true);
    expect(after.accounts.some((a) => a.id === "acctolder000000001")).toBe(true);

    // auth.json removed: written again (an older server would otherwise see no password).
    fs.rmSync(authFile(dir));
    expect(auth.authEnabled()).toBe(true);
    expect((legacyRead(dir) as { password?: string }).password).toBe(fx.data.password);

    // An older server's file that can't be read back in (a broken write) leaves the database as it was.
    fs.writeFileSync(authFile(dir), "{ broken");
    expect(auth.checkAccount("older-signup@example.com", "older password")?.id).toBe("acctolder000000001");
    auth.setPublicSignup(false);
    expect((legacyRead(dir) as { publicSignup?: boolean }).publicSignup).toBeUndefined();
    expect(legacyRead(dir).unreadable).toBeUndefined();
  });

  it("is put aside after 10 minutes once quiet for 3: kept as auth.json.migrated-<time>, with a note no older build can read", async () => {
    const { dir, srv, fx } = await olderInstall("fuobe-auth-retire-");
    const t0 = Date.now();
    expect(srv.store.authStoreMode()).toBe("bridge");
    // An older server still writing at minute 9: not put aside at minute 11, but at minute 12.5.
    globalThis.__fuobeAuthClock = () => t0 + 9 * MIN;
    legacyWrite(dir, { ...legacyRead(dir), publicSignup: false });
    expect(srv.store.authStoreMode()).toBe("bridge");
    globalThis.__fuobeAuthClock = () => t0 + 11 * MIN;
    expect(srv.store.authStoreMode()).toBe("bridge");
    expect(srv.auth.publicSignupSetting()).toBe(false);
    const last = fs.readFileSync(authFile(dir), "utf8");
    globalThis.__fuobeAuthClock = () => t0 + 12.5 * MIN;
    expect(srv.store.authStoreMode()).toBe("done");
    const m = srv.marker()!;
    expect(m).toMatchObject({ state: "done", backup_file: expect.stringMatching(/^auth\.json\.migrated-\d{8}T\d{6}Z$/) });
    const backup = path.join(dir, m.backup_file as string);
    expect(fs.readFileSync(backup, "utf8")).toBe(last);
    if (process.platform !== "win32") {
      expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
      expect(fs.statSync(authFile(dir)).mode & 0o777).toBe(0o600);
    }
    expect(() => JSON.parse(fs.readFileSync(authFile(dir), "utf8"))).toThrow();
    expect(legacyRead(dir).unreadable).toBe(true);
    // Changes no longer touch auth.json; a restart moves nothing in.
    srv.auth.createAccount("after-retire@example.com", "long enough");
    expect(legacyRead(dir).unreadable).toBe(true);
    const again = await server(dir);
    expect(again.store.authStoreMode()).toBe("done");
    expect(again.auth.validSession(fx.cookies.owner)).toBe(true);
    expect(again.auth.listAccounts()).toHaveLength(5);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("auth.json.migrated-"))).toHaveLength(1);
  });

  it("finishes putting auth.json aside after a crash between the database's change and the rename", async () => {
    const { dir, srv, original } = await olderInstall("fuobe-auth-retire-crash-");
    expect(srv.store.authStoreMode()).toBe("bridge");
    srv.db().prepare("UPDATE auth_migration SET state = 'done', backup_file = 'auth.json.migrated-20261104T000000Z', retired_at = ? WHERE id = 1").run(Date.now());
    const again = await server(dir);
    expect(again.store.authStoreMode()).toBe("done");
    expect(fs.readFileSync(path.join(dir, "auth.json.migrated-20261104T000000Z"), "utf8")).toBe(original);
    expect(legacyRead(dir).unreadable).toBe(true);
    // The note gone too: written again.
    fs.rmSync(authFile(dir));
    const third = await server(dir);
    expect(third.store.authStoreMode()).toBe("done");
    expect(legacyRead(dir).unreadable).toBe(true);
  });
});

describe("a crash, or another server, while moving in", () => {
  it("a crash in the middle leaves no rows and no marker, and the next start moves it all in", async () => {
    const { dir, srv, original, fx } = await olderInstall("fuobe-auth-crash-");
    globalThis.__fuobeAuthImportFault = () => {
      throw new Error("the power went out");
    };
    expect(srv.store.authStoreMode()).toBe("failed");
    expect(srv.auth.authEnabled()).toBe(true);
    expect(srv.auth.validSession(fx.cookies.owner)).toBe(false);
    expect(srv.marker()).toBeUndefined();
    expect(srv.count("auth_accounts") + srv.count("auth_tokens") + srv.count("auth_install")).toBe(0);
    expect(fs.readFileSync(authFile(dir), "utf8")).toBe(original);
    globalThis.__fuobeAuthImportFault = undefined;
    const again = await server(dir);
    expect(again.store.authStoreMode()).toBe("bridge");
    expect(again.count("auth_accounts")).toBe(4);
    expect(again.auth.validSession(fx.cookies.owner)).toBe(true);
  });

  const child = (dir: string, go: string, ...args: string[]) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const root = path.join(import.meta.dirname, "..");
      const p = spawn(process.execPath, ["--no-warnings", "--import", pathToFileURL(path.join(root, "tests/helpers/ts-register.mjs")).href, path.join(root, "tests/helpers/auth-child.ts"), ...args, go], {
        cwd: root,
        env: { ...process.env, FUOBE_DATA_DIR: dir },
      });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      p.on("close", (code) => resolve({ code, out }));
    });
  const result = (out: string) => JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "null") as Record<string, unknown> | null;

  it("servers starting at the same moment move it in once", async () => {
    const { dir } = await olderInstall("fuobe-auth-race-");
    // The older install's database is there already (its own tables made); its auth.json waits to move in.
    (await import("@/server/db")).db();
    globalThis.__fuobeDb?.close();
    globalThis.__fuobeDb = undefined;
    const go = path.join(dir, "go");
    const runs = [1, 2, 3, 4].map(() => child(dir, go, "start", "-"));
    await new Promise((r) => setTimeout(r, 2500));
    fs.writeFileSync(go, "");
    const done = await Promise.all(runs);
    for (const d of done) expect(d.code, d.out).toBe(0);
    expect(done.map((d) => result(d.out))).toEqual(Array(4).fill({ mode: "bridge", accounts: 4 }));
    expect(done.filter((d) => d.out.includes("Sign-in data moved")).length).toBe(1);
    const after = await server(dir);
    expect(after.auth.listAccounts()).toHaveLength(4);
    expect(after.count("auth_accounts")).toBe(4);
    expect(JSON.parse(after.marker()!.counts_json as string)).toMatchObject({ accounts: 4 });
  }, 60_000);

  it("sign-ups with one email at the same moment on several servers: one account", async () => {
    const dir = tempDir("fuobe-auth-signup-race-");
    // A new install that has started once (its database made), with nothing stored yet.
    await server(dir);
    (await import("@/server/db")).db();
    globalThis.__fuobeDb?.close();
    globalThis.__fuobeDb = undefined;
    const go = path.join(dir, "go");
    const runs = [1, 2, 3, 4].map(() => child(dir, go, "signup", "Same.Person@example.com"));
    await new Promise((r) => setTimeout(r, 2500));
    fs.writeFileSync(go, "");
    const done = await Promise.all(runs);
    for (const d of done) expect(d.code, d.out).toBe(0);
    const results = done.map((d) => result(d.out)?.result);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "409")).toHaveLength(3);
    const srv = await server(dir);
    expect(srv.auth.listAccounts().map((a) => a.email)).toEqual(["same.person@example.com"]);
  }, 60_000);
});

describe("an auth.json that can't be read, or can't go in", () => {
  it("can't be read: sign-in stays on, nobody is signed in, nothing is written; fixed, it moves in", async () => {
    const { dir, srv, fx, original } = await olderInstall("fuobe-auth-unreadable-");
    fs.writeFileSync(authFile(dir), "{ not json");
    expect(srv.store.authStoreMode()).toBe("unreadable");
    expect(srv.auth.authEnabled()).toBe(true);
    expect(srv.auth.authStatus().enabled).toBe(true);
    expect(srv.auth.validSession(fx.cookies.owner)).toBe(false);
    expect(srv.auth.validToken(`Bearer ${fx.tokens[0]}`)).toBe(false);
    expect(srv.auth.checkPassword("owner password")).toBe(false);
    expect(() => srv.auth.createAccount("late@example.com", "long enough")).toThrow(/can't be read/);
    expect(() => srv.auth.createSession()).toThrow(/can't be read/);
    expect(() => srv.auth.readAccountIds()).toThrow();
    expect(srv.auth.listAccounts()).toEqual([]);
    expect(fs.readFileSync(authFile(dir), "utf8")).toBe("{ not json");
    expect(srv.marker()).toBeUndefined();
    // Not a request-blocking failure: /login still answers (and asks for a password nobody can use).
    expect(srv.store.authStoreFailed()).toBe(false);
    fs.writeFileSync(authFile(dir), original);
    fs.utimesSync(authFile(dir), new Date(), new Date(Date.now() + 10_000));
    expect(srv.auth.validSession(fx.cookies.owner)).toBe(true);
    expect(srv.store.authStoreMode()).toBe("bridge");
  });

  it("the note an older build can't read, with no sign-in data in the database (fuobe.db lost): fails closed", async () => {
    const dir = tempDir("fuobe-auth-note-");
    let srv = await server(dir);
    srv.auth.setPassword("owner password");
    globalThis.__fuobeDb?.close();
    globalThis.__fuobeDb = undefined;
    for (const f of ["fuobe.db", "fuobe.db-wal", "fuobe.db-shm"]) fs.rmSync(path.join(dir, f), { force: true });
    srv = await server(dir);
    expect(srv.store.authStoreMode()).toBe("unreadable");
    expect(srv.auth.authEnabled()).toBe(true);
  });

  for (const [what, edit] of [
    ["two accounts with one email", (d: { accounts: { email: string; id: string }[] }) => (d.accounts[1].email = d.accounts[0].email)],
    ["an email that isn't lower-case", (d: { accounts: { email: string; id: string }[] }) => (d.accounts[1].email = "Second@example.com")],
    ["two accounts with one id", (d: { accounts: { email: string; id: string }[] }) => (d.accounts[1].id = d.accounts[0].id)],
  ] as const) {
    it(`can't go in (${what}): nothing changes, sign-in fails closed and every request gets 503, /login too`, async () => {
      const { dir, srv, fx } = await olderInstall("fuobe-auth-bad-");
      const bad = structuredClone(fx.data);
      edit(bad);
      fs.writeFileSync(authFile(dir), JSON.stringify(bad, null, 2));
      const before = fs.readFileSync(authFile(dir), "utf8");
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(srv.store.authStoreMode()).toBe("failed");
      expect(srv.store.authStoreFailed()).toBe(true);
      expect(srv.auth.authEnabled()).toBe(true);
      expect(srv.auth.validSession(fx.cookies.owner)).toBe(false);
      expect(() => srv.auth.setPassword("another password")).toThrow(/can't be read/);
      expect(srv.marker()).toBeUndefined();
      expect(srv.count("auth_accounts") + srv.count("auth_install")).toBe(0);
      expect(fs.readFileSync(authFile(dir), "utf8")).toBe(before);
      // The log says what kind of problem, never an email, a hash or the secret.
      const logged = errors.mock.calls.flat().join("\n");
      expect(logged).toMatch(/couldn't be moved into the database/);
      for (const a of fx.data.accounts) {
        expect(logged).not.toContain(a.email);
        expect(logged).not.toContain(a.hash);
      }
      expect(logged).not.toContain(fx.data.secret);
      errors.mockRestore();
      const { proxy } = await import("@/proxy");
      const { NextRequest } = await import("next/server");
      for (const p of ["/login", "/", "/api/auth/public"]) expect(proxy(new NextRequest(`http://localhost:3000${p}`)).status, p).toBe(503);
    });
  }
});

describe("100,000 accounts", () => {
  it("move in once, and every lookup stays quick", async () => {
    const dir = tempDir("fuobe-auth-100k-");
    const now = Date.now();
    const secret = crypto.randomBytes(32).toString("hex");
    const N = 100_000;
    const fakeHash = (i: number) => `${i.toString(16).padStart(32, "0")}:${sha(String(i))}`;
    const accounts = Array.from({ length: N }, (_, i) => ({
      id: `acct${i.toString(16).padStart(14, "0")}`,
      email: `member-${i}@example.com`,
      hash: fakeHash(i),
      createdAt: now - (N - i) * 1000,
      lastLoginAt: now - i,
      ...(i % 10 === 0 && { gpu: { url: `https://gpu-${i}.example.com` } }),
    }));
    let srv = await server(dir);
    fs.writeFileSync(authFile(dir), JSON.stringify({ password: hashPw("owner password"), secret, tokens: [], accounts }, null, 2));
    let t = performance.now();
    expect(srv.store.authStoreMode()).toBe("bridge");
    const importMs = performance.now() - t;
    expect(srv.count("auth_accounts")).toBe(N);
    expect(importMs).toBeLessThan(30_000);
    // Put aside (the bridge rewrites the whole file on each change, for 10 minutes only).
    globalThis.__fuobeAuthClock = () => now + 11 * MIN;
    expect(srv.store.authStoreMode()).toBe("done");
    globalThis.__fuobeAuthClock = undefined;
    srv = await server(dir);
    const pick = () => accounts[Math.floor(Math.random() * N)];
    const exp = Date.now() + DAY;
    const cookieOf = (a: (typeof accounts)[number]) => `${exp}.${a.id}.${mac(`${secret}.${sha(a.hash)}`, `${exp}.${a.id}`)}`;
    const avg = (n: number, fn: () => void) => {
      const start = performance.now();
      for (let i = 0; i < n; i++) fn();
      return (performance.now() - start) / n;
    };
    expect(avg(2000, () => expect(srv.auth.accountById(pick().id)).toBeDefined())).toBeLessThan(1);
    expect(avg(2000, () => expect(srv.auth.sessionViewer(cookieOf(pick()))?.kind).toBe("account"))).toBeLessThan(1);
    expect(avg(200, () => srv.auth.signOutAccount(pick().id))).toBeLessThan(5);
    t = performance.now();
    expect(srv.auth.listAccounts()).toHaveLength(N);
    expect(performance.now() - t).toBeLessThan(3000);
    t = performance.now();
    srv.auth.createAccount("one-more@example.com", "long enough");
    expect(performance.now() - t).toBeLessThan(500); // the scrypt hash, then one insert
    expect(() => srv.auth.createAccount(`member-${N - 1}@example.com`, "long enough")).toThrow(expect.objectContaining({ status: 409 }));
  }, 180_000);
});

describe("files", () => {
  it.skipIf(process.platform === "win32")("the database and its -wal and -shm files are readable by the server's user only", async () => {
    const dir = tempDir("fuobe-auth-modes-");
    const srv = await server(dir);
    srv.auth.setPassword("owner password");
    for (const f of ["fuobe.db", "fuobe.db-wal", "fuobe.db-shm"]) {
      const file = path.join(dir, f);
      if (fs.existsSync(file)) expect(fs.statSync(file).mode & 0o077, f).toBe(0);
    }
  });
});
