import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Your keys: where an account's own fal.ai key or Replicate token is kept. Sealed on its record in auth.json, never in
 * plain text in any file of the data folder, shown only by its last 4 characters, gone with the account.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-account-keys-"));
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const { setSetting } = await import("@/server/settings");

const FAL = "acct-fal-key-id:acct-fal-secret-9f3a";
const REP = "r8_acctReplicateToken7c21";

/** Every file in the data folder, as raw bytes. */
function dataFiles(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out.push({ file: f, text: fs.readFileSync(f).toString("latin1") });
    }
  };
  walk(dir);
  return out;
}

let a = "";
let b = "";
beforeAll(() => {
  auth.setPassword("install password");
  a = auth.createAccount("keys-a@example.com", "long enough").id;
  b = auth.createAccount("keys-b@example.com", "long enough").id;
});
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

describe("an account's own keys, at rest", () => {
  it("are sealed on its record: auth.json holds the sealed value and the last 4 characters, never the key", () => {
    const info = keys.saveAccountKey(a, "fal", FAL);
    expect(info).toEqual({ last4: "9f3a", addedAt: expect.any(Number), readable: true });
    keys.saveAccountKey(a, "replicate", REP);
    const record = JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf8")).accounts.find((x: { id: string }) => x.id === a);
    expect(record.keys.fal).toEqual({ sealed: expect.stringMatching(/^v1\./), last4: "9f3a", addedAt: expect.any(Number) });
    expect(record.keys.replicate.last4).toBe("7c21");
    expect(keys.accountKey(a, "fal")).toBe(FAL);
    expect(keys.accountKey(a, "replicate")).toBe(REP);
    for (const f of dataFiles()) {
      expect(f.text.includes(FAL), f.file).toBe(false);
      expect(f.text.includes("acct-fal-secret"), f.file).toBe(false);
      expect(f.text.includes(REP), f.file).toBe(false);
    }
  });

  it("opens only for its own account: a sealed value copied to another account is no key", () => {
    const sealed = auth.accountKeyRecord(a, "fal")!;
    auth.setAccountKey(b, "fal", sealed);
    expect(keys.accountKey(b, "fal")).toBeNull();
    expect(keys.accountKeyInfo(b).fal).toEqual({ last4: "9f3a", addedAt: sealed.addedAt, readable: false });
    keys.removeAccountKey(b, "fal");
    expect(auth.accountById(b)).not.toHaveProperty("keys");
  });

  it("shows the owner and Settings which providers, never a key or its sealed value", () => {
    const listed = auth.listAccounts().find((x) => x.id === a)!;
    expect(listed.keys).toEqual(["fal", "replicate"]);
    expect(auth.listAccounts().find((x) => x.id === b)!.keys).toEqual([]);
    const csv = auth.accountsCsv();
    expect(csv.split("\r\n")[0]).toBe("email,created,last_login,gpu_connected,fal_key,replicate_key,disabled");
    expect(csv).toMatch(/keys-a@example\.com,[^,]+,[^,]+,false,true,true,false/);
    const sealed = auth.accountKeyRecord(a, "fal")!.sealed;
    for (const text of [JSON.stringify(auth.listAccounts()), csv, JSON.stringify(keys.accountKeyInfo(a))]) {
      expect(text).not.toContain(FAL);
      expect(text).not.toContain(REP);
      expect(text).not.toContain(sealed);
    }
    expect(keys.accountKeyInfo(a)).toEqual({
      fal: { last4: "9f3a", addedAt: expect.any(Number), readable: true },
      replicate: { last4: "7c21", addedAt: expect.any(Number), readable: true },
    });
  });

  it("says when the provider refused it, only for the key still saved", () => {
    keys.markKeyRejected(a, "fal", "an older key");
    expect(keys.accountKeyInfo(a).fal?.rejectedAt).toBeUndefined();
    keys.markKeyRejected(a, "fal", FAL);
    expect(keys.accountKeyInfo(a).fal?.rejectedAt).toEqual(expect.any(Number));
    // A key saved again starts afresh.
    keys.saveAccountKey(a, "fal", FAL);
    expect(keys.accountKeyInfo(a).fal?.rejectedAt).toBeUndefined();
  });

  it("takes a key as typed, trimmed, and refuses what can't be one", () => {
    expect(keys.cleanKey(`  ${FAL}\n`)).toBe(FAL);
    for (const bad of ["", "short", "has a space inside", "x".repeat(301), 42, null]) expect(keys.cleanKey(bad), String(bad)).toBeNull();
  });

  it("gives the account paid models only while the studio isn't open-source only", () => {
    expect(keys.accountEngineMode(a)).toBe("both");
    expect(keys.accountEngineMode(b)).toBe("open");
    setSetting("engineMode", "cloud");
    expect(keys.accountEngineMode(a)).toBe("both");
    setSetting("engineMode", "open");
    expect(keys.accountEngineMode(a)).toBe("open");
    expect(keys.paidAllowed()).toBe(false);
    setSetting("engineMode", "");
  });

  it("are gone with the account, and with the server key a saved key stops opening (never another key)", () => {
    const c = auth.createAccount("keys-c@example.com", "long enough").id;
    keys.saveAccountKey(c, "fal", "acct-fal-c-key:secret-c");
    auth.deleteAccount(c);
    expect(auth.accountKeyRecord(c, "fal")).toBeNull();
    expect(fs.readFileSync(path.join(dir, "auth.json"), "utf8")).not.toContain("keys-c@example.com");
    // secrets.key lost (a restore without it): the account's keys stop, the record stays to say "add it again".
    fs.rmSync(path.join(dir, "secrets.key"));
    expect(keys.accountKey(a, "fal")).toBeNull();
    expect(keys.accountKeyInfo(a).fal?.readable).toBe(false);
    expect(keys.accountEngineMode(a)).toBe("open");
  });
});
