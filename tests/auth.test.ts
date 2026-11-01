import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-auth-"));
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
const auth = await import("@/server/auth");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("auth", () => {
  it("is off until a password is set", () => {
    expect(auth.authEnabled()).toBe(false);
    expect(auth.checkPassword("anything")).toBe(false);
  });

  it("hashes the password, checks it and rejects short ones", () => {
    expect(() => auth.setPassword("short")).toThrow(/8 characters/);
    auth.setPassword("correct horse");
    expect(auth.authEnabled()).toBe(true);
    expect(auth.checkPassword("correct horse")).toBe(true);
    expect(auth.checkPassword("wrong horse")).toBe(false);
    expect(fs.readFileSync(path.join(dir, "auth.json"), "utf8")).not.toContain("correct horse");
  });

  it("signs sessions and signs everyone out when the password changes", () => {
    const s = auth.createSession();
    expect(auth.validSession(s.value)).toBe(true);
    expect(auth.validSession(s.value.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBe(false);
    expect(auth.validSession(`${Date.now() - 1}.${s.value.split(".")[1]}`)).toBe(false);
    expect(auth.validSession(undefined)).toBe(false);
    auth.setPassword("another secret");
    expect(auth.validSession(s.value)).toBe(false);
  });

  it("issues bearer tokens that can be revoked and stores only their hash", () => {
    const { token, info } = auth.createToken("CI");
    expect(token).toMatch(/^fuobe_/);
    expect(auth.validToken(`Bearer ${token}`)).toBe(true);
    expect(auth.validToken(`Bearer ${token}x`)).toBe(false);
    expect(auth.validToken(token)).toBe(false);
    expect(fs.readFileSync(path.join(dir, "auth.json"), "utf8")).not.toContain(token);
    expect(auth.authStatus().tokens[0]).toMatchObject({ name: "CI", prefix: token.slice(0, 12) });
    expect(auth.authStatus().tokens[0]).not.toHaveProperty("hash");
    auth.revokeToken(info.id);
    expect(auth.validToken(`Bearer ${token}`)).toBe(false);
  });

  it("uses FUOBE_PASSWORD when set and refuses UI changes", () => {
    process.env.FUOBE_PASSWORD = "from the env";
    expect(auth.checkPassword("from the env")).toBe(true);
    expect(auth.checkPassword("another secret")).toBe(false);
    expect(() => auth.setPassword(null)).toThrow(/FUOBE_PASSWORD/);
    delete process.env.FUOBE_PASSWORD;
    auth.setPassword(null);
    expect(auth.authEnabled()).toBe(false);
  });
});
