import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tempDir } from "./helpers/temp-dir";
import { checkUploadSwitches, readUploadSwitches, UPLOAD_SWITCH_DEFAULTS } from "@/lib/av/upload-switches";
import { planAudioFit, type AudioFitRule } from "@/lib/av/fit-upload";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-upload-switches-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_TRUST_PROXY;
const auth = await import("@/server/auth");
const admin = await import("@/server/admin-tokens");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { proxy } = await import("@/proxy");
const route = await import("@/app/api/admin/site/uploads/route");
const pub = await import("@/app/api/site/uploads/route");
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
const make = (scopes: (typeof admin.SCOPES)[number][]) => admin.createAdminToken({ name: `switches ${++n}`, scopes, expiresInDays: null });
const audits = () => db().prepare("SELECT * FROM admin_audit WHERE action = 'site.uploads' ORDER BY id").all() as { actor: string; detail_json: string | null; status: number }[];

let owner = "";
let account = "";
beforeAll(() => {
  auth.setPassword("install password");
  owner = auth.createSession().value;
  account = auth.createSession(auth.createAccount("switches@example.com", "long enough").id).value;
});
beforeEach(() => {
  resetRates();
  admin.revokeAllAdminTokens();
  db().prepare("DELETE FROM settings WHERE key = 'uploads.switches'").run();
  globalThis.__fuobeUploadSwitches = undefined;
});

describe("upload switches: the checks", () => {
  it("takes any of the five as true or false, and nothing else", () => {
    expect(checkUploadSwitches({ soundTrim: false })).toEqual({ switches: { ...UPLOAD_SWITCH_DEFAULTS, soundTrim: false } });
    expect(checkUploadSwitches({})).toEqual({ switches: UPLOAD_SWITCH_DEFAULTS });
    expect(checkUploadSwitches({ soundTrim: "no" })).toEqual({ error: "soundTrim is true or false" });
    expect(checkUploadSwitches({ everything: false })).toEqual({ error: "Unknown switch: everything" });
    expect(checkUploadSwitches([])).toHaveProperty("error");
    expect(checkUploadSwitches(null)).toHaveProperty("error");
  });

  it("reads a stored or fetched value leniently: what is missing or wrong is on", () => {
    expect(readUploadSwitches(undefined)).toEqual(UPLOAD_SWITCH_DEFAULTS);
    expect(readUploadSwitches({ photoCrop: false, videoTrim: "off" })).toEqual({ ...UPLOAD_SWITCH_DEFAULTS, photoCrop: false });
  });

  it("leaves a file as it is when its step is off, so the tool's own check says why", () => {
    const remix: AudioFitRule = { for: "Mureka", tool: "Remix", formats: ["mp3"], maxSeconds: 350, outMaxBytes: 10e6 };
    expect(planAudioFit(remix, { format: "wav", bytes: 5e6, seconds: 60 })).toMatchObject({ kind: "convert" });
    expect(planAudioFit({ ...remix, convert: false }, { format: "wav", bytes: 5e6, seconds: 60 })).toEqual({ kind: "keep" });
    expect(planAudioFit(remix, { format: "mp3", bytes: 5e6, seconds: 400 })).toMatchObject({ kind: "trim" });
    expect(planAudioFit({ ...remix, trim: false }, { format: "mp3", bytes: 5e6, seconds: 400 })).toEqual({ kind: "keep" });
    // Converting stays on while trimming is off, and the other way round.
    expect(planAudioFit({ ...remix, trim: false }, { format: "wav", bytes: 5e6, seconds: 60 })).toMatchObject({ kind: "convert" });
    expect(planAudioFit({ ...remix, convert: false }, { format: "mp3", bytes: 5e6, seconds: 400 })).toMatchObject({ kind: "trim" });
  });
});

describe("upload switches: who may read and change them", () => {
  it("answers a guest 401 and an account 403 at the proxy, and lets the owner through", () => {
    for (const method of ["GET", "PATCH"]) {
      expect(proxy(req("/api/admin/site/uploads", { method })).status, method).toBe(401);
      expect(proxy(req("/api/admin/site/uploads", { method, cookie: account })).status, method).toBe(403);
      expect(passed(proxy(req("/api/admin/site/uploads", { method, cookie: owner }))), method).toBe(true);
    }
  });

  it("gives every visitor the switches to read, and nothing to change", () => {
    for (const cookie of [undefined, account, owner]) expect(passed(proxy(req("/api/site/uploads", { cookie }))), String(cookie)).toBe(true);
    expect(passed(proxy(req("/api/site/uploads", { method: "PATCH" })))).toBe(false);
    expect(pub).not.toHaveProperty("PATCH");
  });

  it("refuses the route itself to anyone but the owner or a token with the scope", async () => {
    expect((await route.GET(req("/api/admin/site/uploads"))).status).toBe(403);
    expect((await route.PATCH(req("/api/admin/site/uploads", { method: "PATCH", body: { soundTrim: false } }))).status).toBe(403);
    expect((await route.GET(req("/api/admin/site/uploads", { token: `fuobe_adm_${"q".repeat(43)}` }))).status).toBe(401);
    // A token with every other scope.
    const other = make(admin.SCOPES.filter((s) => s !== "site:read" && s !== "site:write"));
    const r = await route.GET(req("/api/admin/site/uploads", { token: other.token }));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "scope", scope: "site:read" });
    expect((await route.PATCH(req("/api/admin/site/uploads", { token: other.token, method: "PATCH", body: { soundTrim: false } }))).status).toBe(403);
    // Reading doesn't let it change them.
    const reader = make(["site:read"]);
    expect((await route.GET(req("/api/admin/site/uploads", { token: reader.token }))).status).toBe(200);
    const no = await route.PATCH(req("/api/admin/site/uploads", { token: reader.token, method: "PATCH", body: { soundTrim: false } }));
    expect(no.status).toBe(403);
    expect(await no.json()).toMatchObject({ code: "scope", scope: "site:write" });
  });

  it("lets the owner and a site:write token change them, logs before and after, and every browser reads them", async () => {
    const first = await route.GET(req("/api/admin/site/uploads", { cookie: owner }));
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ switches: UPLOAD_SWITCH_DEFAULTS });
    const off = await route.PATCH(req("/api/admin/site/uploads", { cookie: owner, method: "PATCH", body: { soundTrim: false, photoCrop: false } }));
    expect(off.status).toBe(200);
    expect(off.headers.get("cache-control")).toBe("no-store");
    const after = { ...UPLOAD_SWITCH_DEFAULTS, soundTrim: false, photoCrop: false };
    expect(await off.json()).toEqual({ switches: after });
    expect(await (await pub.GET()).json()).toEqual({ switches: after });
    const log = audits().at(-1)!;
    expect(log).toMatchObject({ actor: "owner", status: 200 });
    expect(JSON.parse(log.detail_json!)).toEqual({ before: UPLOAD_SWITCH_DEFAULTS, after });

    const writer = make(["site:write"]);
    const on = await route.PATCH(req("/api/admin/site/uploads", { token: writer.token, method: "PATCH", body: { soundTrim: true } }));
    expect(await on.json()).toEqual({ switches: { ...after, soundTrim: true } });
    expect(audits().at(-1)).toMatchObject({ actor: "token", status: 200 });

    const bad = await route.PATCH(req("/api/admin/site/uploads", { cookie: owner, method: "PATCH", body: { soundTrim: 1 } }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "soundTrim is true or false" });
    expect(audits().at(-1)).toMatchObject({ status: 400 });
    expect(await (await pub.GET()).json()).toEqual({ switches: { ...after, soundTrim: true } });
  });

  it("doesn't give the new scopes to a token made before them", () => {
    const old = make(["queue:read", "queue:write", "audit:read"]);
    expect(old.info.scopes).not.toContain("site:write");
    expect(admin.listAdminTokens().find((t) => t.id === old.info.id)?.scopes).toEqual(["audit:read", "queue:read", "queue:write"]);
  });
});
