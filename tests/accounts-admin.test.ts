import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-accounts-admin-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
const auth = await import("@/server/auth");
const { proxy } = await import("@/proxy");
afterAll(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const req = (url: string, method = "GET", cookie?: string) =>
  new NextRequest(`http://localhost:3000${url}`, { method, headers: cookie ? { cookie: `${auth.SESSION_COOKIE}=${cookie}` } : {}, ...(method !== "GET" && { body: "{}" }) });

describe("Settings → Accounts", () => {
  beforeAll(() => auth.setPassword("install password"));

  it("lists accounts without their hashes, newest first, with last login", () => {
    const a = auth.createAccount("first@example.com", "long enough");
    const b = auth.createAccount("second@example.com", "long enough");
    const list = auth.listAccounts();
    expect(list.map((x) => x.email).sort()).toEqual(["first@example.com", "second@example.com"]);
    expect(JSON.stringify(list)).not.toContain(a.hash);
    expect(list.find((x) => x.id === b.id)).toMatchObject({ disabled: false, gpu: false });
    expect(list[0].lastLoginAt).toBeGreaterThan(0);
    const before = auth.listAccounts().find((x) => x.id === a.id)!.lastLoginAt!;
    auth.recordLogin(a.id);
    expect(auth.listAccounts().find((x) => x.id === a.id)!.lastLoginAt).toBeGreaterThanOrEqual(before);
  });

  it("exports CSV that a spreadsheet can't read as a formula", () => {
    auth.createAccount("=cmd@example.com", "long enough");
    const csv = auth.accountsCsv();
    expect(csv.split("\r\n")[0]).toBe("email,created,last_login,gpu_connected,fal_key,replicate_key,disabled");
    expect(csv).toContain("'=cmd@example.com");
    expect(csv).not.toContain("hash");
  });

  it("switches an account off (signed out, can't log in) and deletes it", () => {
    const a = auth.createAccount("off@example.com", "long enough");
    const s = auth.createSession(a.id).value;
    expect(auth.sessionViewer(s)?.kind).toBe("account");
    auth.setAccountDisabled(a.id, true);
    expect(auth.sessionViewer(s)).toBeNull();
    expect(auth.checkAccount("off@example.com", "long enough")?.disabled).toBe(true);
    auth.setAccountDisabled(a.id, false);
    expect(auth.sessionViewer(s)?.kind).toBe("account");
    auth.deleteAccount(a.id);
    expect(auth.sessionViewer(s)).toBeNull();
    expect(auth.listAccounts().some((x) => x.id === a.id)).toBe(false);
    expect(() => auth.deleteAccount(a.id)).toThrow(/No such account/);
  });

  it("is the owner's only", () => {
    const a = auth.createAccount("nosy@example.com", "long enough");
    const account = auth.createSession(a.id).value;
    for (const [m, p] of [
      ["GET", "/api/admin/accounts"],
      ["GET", "/api/admin/accounts?format=csv"],
      ["PATCH", "/api/admin/accounts/x"],
      ["DELETE", "/api/admin/accounts/x"],
    ]) {
      expect(proxy(req(p, m, account)).status, `account ${m} ${p}`).toBe(403);
      expect(proxy(req(p, m)).status, `guest ${m} ${p}`).toBe(401);
    }
    const owner = auth.createSession().value;
    expect(proxy(req("/api/admin/accounts", "GET", owner)).headers.get("x-middleware-next")).toBe("1");
    const fake = new Request("http://localhost:3000/api/admin/accounts");
    expect(auth.isOwnerRequest(fake, owner)).toBe(true);
    expect(auth.isOwnerRequest(fake, account)).toBe(false);
    expect(auth.isOwnerRequest(fake, undefined)).toBe(false);
  });
});
