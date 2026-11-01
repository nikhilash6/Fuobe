import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Your keys: the box that seals an account's fal.ai key or Replicate token at rest (src/server/secret-box.ts). AES-256-GCM
 * under a server key in data/secrets.key, made once, never derived from the sign-in secret, bound to the account and the
 * provider. A broken key file fails closed: nothing is sealed, nothing opens, and the file is never written over.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-secret-box-"));
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;

const box = await import("@/server/secret-box");
const auth = await import("@/server/auth");
const keyFile = path.join(dir, "secrets.key");

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

/** Replace the key file's content, with a new modification time so the server reads it again. */
function rewrite(content: string) {
  fs.writeFileSync(keyFile, content);
  const later = new Date(Date.now() + 5_000);
  fs.utimesSync(keyFile, later, later);
}

describe("the secret box", () => {
  it("makes no key file until something is sealed, and opens nothing without one", () => {
    expect(fs.existsSync(keyFile)).toBe(false);
    expect(box.open("v1.a.b.c", "ctx")).toBeNull();
    expect(fs.existsSync(keyFile)).toBe(false);
  });

  it("opens what it sealed, for the same context only", () => {
    const ctx = box.accountKeyContext("acct-1", "fal");
    const sealed = box.seal("fal-key-id:fal-key-secret", ctx);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain("fal-key");
    expect(box.open(sealed, ctx)).toBe("fal-key-id:fal-key-secret");
    // Another account, another provider: never opens.
    expect(box.open(sealed, box.accountKeyContext("acct-2", "fal"))).toBeNull();
    expect(box.open(sealed, box.accountKeyContext("acct-1", "replicate"))).toBeNull();
    // Two seals of one value differ (a fresh IV each time).
    expect(box.seal("same", ctx)).not.toBe(box.seal("same", ctx));
  });

  it("refuses a changed IV, tag or text, and an unknown version", () => {
    const ctx = box.accountKeyContext("acct-1", "replicate");
    const sealed = box.seal("r8_secret_token_value", ctx);
    const [v, iv, tag, ct] = sealed.split(".");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    for (const bad of [`${v}.${flip(iv)}.${tag}.${ct}`, `${v}.${iv}.${flip(tag)}.${ct}`, `${v}.${iv}.${tag}.${flip(ct)}`, `v2.${iv}.${tag}.${ct}`, "v1.x", "", "plain text"]) {
      expect(box.open(bad, ctx), bad).toBeNull();
    }
  });

  it("keeps one server key in data/secrets.key: 32 random bytes, private to the server", () => {
    const hex = fs.readFileSync(keyFile, "utf8").trim();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    // Sealing again uses the same file.
    box.seal("again", "ctx");
    expect(fs.readFileSync(keyFile, "utf8").trim()).toBe(hex);
  });

  it("is never derived from the sign-in secret: a new password or signing everyone out changes nothing", () => {
    const ctx = box.accountKeyContext("acct-1", "fal");
    const sealed = box.seal("stays readable", ctx);
    auth.setPassword("a first password");
    auth.signOutEveryone({ tokens: true });
    auth.setPassword("a second password");
    expect(box.open(sealed, ctx)).toBe("stays readable");
  });

  it("fails closed on a broken key file: seal throws, open gives null, the file stays and the warning never shows it", () => {
    const ctx = box.accountKeyContext("acct-1", "fal");
    const sealed = box.seal("before", ctx);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      rewrite("not-a-key-but-secret-looking-content");
      expect(() => box.seal("x", ctx)).toThrow(box.SecretBoxError);
      expect(box.open(sealed, ctx)).toBeNull();
      expect(fs.readFileSync(keyFile, "utf8")).toBe("not-a-key-but-secret-looking-content");
      const said = warn.mock.calls.flat().join(" ");
      expect(said).toContain("secrets.key");
      expect(said).not.toContain("secret-looking");
    } finally {
      warn.mockRestore();
    }
  });

  it("opens nothing sealed under another server key (secrets.key replaced)", () => {
    rewrite("ab".repeat(32));
    const ctx = box.accountKeyContext("acct-1", "fal");
    const sealed = box.seal("under the new key", ctx);
    expect(box.open(sealed, ctx)).toBe("under the new key");
    rewrite("cd".repeat(32));
    expect(box.open(sealed, ctx)).toBeNull();
  });

  it("makes the key file once, even when two seals race for it", async () => {
    fs.rmSync(keyFile);
    const { spawnSync } = await import("node:child_process");
    // Two fresh processes write the file with the same "only if it isn't there" flag the box uses: one wins, both read it.
    const script = `const fs=require("fs");const f=${JSON.stringify(keyFile)};try{fs.writeFileSync(f,require("crypto").randomBytes(32).toString("hex"),{flag:"wx",mode:0o600})}catch(e){if(e.code!=="EEXIST")throw e}process.stdout.write(fs.readFileSync(f,"utf8"))`;
    const runs = [spawnSync(process.execPath, ["-e", script], { encoding: "utf8" }), spawnSync(process.execPath, ["-e", script], { encoding: "utf8" })];
    expect(runs[0].stdout).toMatch(/^[0-9a-f]{64}$/);
    expect(runs[1].stdout).toBe(runs[0].stdout);
    // The box reads the file that is there, never a key of its own.
    const later = new Date(Date.now() + 10_000);
    fs.utimesSync(keyFile, later, later);
    const ctx = box.accountKeyContext("acct-1", "fal");
    const sealed = box.seal("after the race", ctx);
    expect(fs.readFileSync(keyFile, "utf8")).toBe(runs[0].stdout);
    expect(box.open(sealed, ctx)).toBe("after the race");
  });
});
