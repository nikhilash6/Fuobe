import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tempDir } from "./helpers/temp-dir";

/**
 * What people read when a run fails (settings.ts runFailureDetail), as the owner changes it: GET and PATCH
 * /api/admin/site/runs (the owner, or a token with site:read or site:write), each change in the admin log, and the same
 * setting in Settings.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-failure-detail-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_TRUST_PROXY;
delete process.env.FUOBE_RUN_FAILURE_DETAIL;
const auth = await import("@/server/auth");
const admin = await import("@/server/admin-tokens");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { proxy } = await import("@/proxy");
const { runFailureDetail, setSetting } = await import("@/server/settings");
const route = await import("@/app/api/admin/site/runs/route");
afterAll(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
});

const req = (url: string, o: { method?: string; token?: string; cookie?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: o.method ?? "GET",
    headers: {
      ...(o.token && { authorization: `Bearer ${o.token}` }),
      ...(o.cookie && { cookie: `${auth.SESSION_COOKIE}=${o.cookie}` }),
      ...(o.body !== undefined && { "content-type": "application/json" }),
    },
    ...(o.body !== undefined && { body: JSON.stringify(o.body) }),
  });
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
let n = 0;
const make = (scopes: (typeof admin.SCOPES)[number][]) => admin.createAdminToken({ name: `failures ${++n}`, scopes, expiresInDays: null });
const audits = (action: string) => db().prepare("SELECT * FROM admin_audit WHERE action = ? ORDER BY id").all(action) as { actor: string; detail_json: string | null; status: number }[];
const URL_ = "/api/admin/site/runs";

let owner = "";
let account = "";
beforeAll(() => {
  auth.setPassword("install password");
  owner = auth.createSession().value;
  account = auth.createSession(auth.createAccount("failures@example.com", "long enough").id).value;
});
beforeEach(() => {
  resetRates();
  admin.revokeAllAdminTokens();
});

describe("what people read when a run fails: who may read and change it", () => {
  it("is the full details on a new install", async () => {
    expect(runFailureDetail()).toBe("full");
    expect(await (await route.GET(req(URL_, { cookie: owner }))).json()).toEqual({ failureDetail: "full" });
  });

  it("answers a guest 401 and an account 403 at the proxy, and lets the owner through", () => {
    for (const method of ["GET", "PATCH"]) {
      expect(proxy(req(URL_, { method })).status, method).toBe(401);
      expect(proxy(req(URL_, { method, cookie: account })).status, method).toBe(403);
      expect(passed(proxy(req(URL_, { method, cookie: owner }))), method).toBe(true);
    }
  });

  it("refuses anyone but the owner or a token with the scope", async () => {
    expect((await route.GET(req(URL_))).status).toBe(403);
    expect((await route.PATCH(req(URL_, { method: "PATCH", body: { failureDetail: "full" } }))).status).toBe(403);
    expect((await route.PATCH(req(URL_, { method: "PATCH", cookie: account, body: { failureDetail: "full" } }))).status).toBe(403);
    const other = make(admin.SCOPES.filter((s) => s !== "site:read" && s !== "site:write"));
    expect(await (await route.GET(req(URL_, { token: other.token }))).json()).toMatchObject({ code: "scope", scope: "site:read" });
    const reader = make(["site:read"]);
    expect((await route.GET(req(URL_, { token: reader.token }))).status).toBe(200);
    const no = await route.PATCH(req(URL_, { token: reader.token, method: "PATCH", body: { failureDetail: "friendly" } }));
    expect(no.status).toBe(403);
    expect(await no.json()).toMatchObject({ code: "scope", scope: "site:write" });
    expect(runFailureDetail()).toBe("full");
  });

  it("the owner and a site:write token change it, each change logged with before and after; anything else is a 400", async () => {
    const off = await route.PATCH(req(URL_, { cookie: owner, method: "PATCH", body: { failureDetail: "friendly" } }));
    expect(off.status).toBe(200);
    expect(off.headers.get("cache-control")).toBe("no-store");
    expect(await off.json()).toEqual({ failureDetail: "friendly" });
    expect(runFailureDetail()).toBe("friendly");
    expect(audits("site.runs").at(-1)).toMatchObject({ actor: "owner", status: 200 });
    expect(JSON.parse(audits("site.runs").at(-1)!.detail_json!)).toEqual({ before: "full", after: "friendly" });

    const writer = make(["site:write"]);
    const on = await route.PATCH(req(URL_, { token: writer.token, method: "PATCH", body: { failureDetail: "full" } }));
    expect(await on.json()).toEqual({ failureDetail: "full" });
    expect(audits("site.runs").at(-1)).toMatchObject({ actor: "token", status: 200 });

    for (const body of [{ failureDetail: "raw" }, { failureDetail: true }, {}, { failureDetail: "full", more: 1 }, null]) {
      const bad = await route.PATCH(req(URL_, { cookie: owner, method: "PATCH", body }));
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    expect(audits("site.runs").at(-1)).toMatchObject({ status: 400 });
    expect(runFailureDetail()).toBe("full");
    // The admin API's change isn't logged twice.
    expect(audits("settings.run_failure_detail")).toHaveLength(0);
  });

  it("a change in Settings (the owner's browser) is in the admin log too", () => {
    setSetting("runFailureDetail", "friendly");
    expect(JSON.parse(audits("settings.run_failure_detail").at(-1)!.detail_json!)).toEqual({ before: "full", after: "friendly" });
    setSetting("runFailureDetail", "full");
  });
});
