import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AccountListing, AccountRun, AccountTotals } from "@/server/account-admin";
import type { ListOptions } from "@/server/generations";
import { TINY_PNG } from "./helpers/fake-comfy-runner";

// Route handlers are called directly, outside a Next request: connection() has nothing to wait for.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-account-runs-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const gens = await import("@/server/generations");
const { libraryFacets, listOptionsFrom } = await import("@/server/library");
const live = await import("@/server/live");
const admin = await import("@/server/account-admin");
const { accountUsage } = await import("@/server/account-files");
const { absolutePath, saveFile } = await import("@/server/storage");
const { storageSize } = await import("@/lib/format");
const { proxy } = await import("@/proxy");
const accountsRoute = await import("@/app/api/admin/accounts/route");
const runsRoute = await import("@/app/api/admin/generations/route");
const runRoute = await import("@/app/api/admin/generations/[id]/route");
const filesRoute = await import("@/app/api/files/[...path]/route");
const generationsRoute = await import("@/app/api/generations/route");
afterAll(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const A = auth.createAccount("ann@example.com", "long enough").id;
const B = auth.createAccount("bea@example.com", "long enough").id;
const C = auth.createAccount("cal@example.com", "long enough").id;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let seq = 0;
/** A run as the runner stores it: `account`'s (or the owner's), made `ago` ms before now (or `at`), in `batch` when given. */
function run(account?: string, o: { status?: string; kind?: string; feature?: string; ago?: number; at?: number; error?: string; batch?: string } = {}): string {
  const id = `run-${String(++seq).padStart(4, "0")}`;
  const at = o.at ?? Date.now() - (o.ago ?? 0);
  const feature = o.feature ?? "image";
  db()
    .prepare(
      "INSERT INTO generations (id, batch_id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, error, created_at, updated_at) VALUES (?, ?, ?, 'm', 'open', 'comfyui', ?, ?, ?, ?, '[]', ?, ?, ?)",
    )
    .run(
      id,
      o.batch ?? null,
      feature,
      o.kind === "video" ? "t2v" : "t2i",
      o.kind ?? "image",
      o.status ?? "succeeded",
      JSON.stringify({ feature, modelId: "m", prompt: "a fox", ...(account && { account }) }),
      o.error ?? null,
      at,
      at,
    );
  return id;
}

/** A stored result of run `id` (an account's file when the run is an account's), `bytes` over a tiny PNG. */
function output(id: string, bytes = 0) {
  const asset = saveFile({ data: Buffer.concat([TINY_PNG, Buffer.alloc(bytes)]), contentType: "image/png", source: "generation", generationId: id });
  db().prepare("UPDATE generations SET outputs_json = ? WHERE id = ?").run(JSON.stringify([{ url: asset.url, kind: "image", assetId: asset.id }]), id);
  return asset;
}

/** Session cookies: the owner's, account A's and C's, an owner-shaped one signed with auth.json's secret alone, and two at once. */
const cookies = {} as Record<"owner" | "a" | "c" | "forged" | "doubled", string>;
beforeAll(() => {
  auth.setPassword("install password");
  const owner = auth.createSession().value;
  const a = auth.createSession(A).value;
  const secret = (JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf8")) as { secret: string }).secret;
  const exp = Date.now() + 60_000;
  cookies.owner = `${auth.SESSION_COOKIE}=${owner}`;
  cookies.a = `${auth.SESSION_COOKIE}=${a}`;
  cookies.c = `${auth.SESSION_COOKIE}=${auth.createSession(C).value}`;
  cookies.forged = `${auth.SESSION_COOKIE}=${exp}.${createHmac("sha256", secret).update(String(exp)).digest("base64url")}`;
  cookies.doubled = `${auth.SESSION_COOKIE}=${owner}; ${auth.SESSION_COOKIE}=${a}`;
});

const viaProxy = (url: string, method = "GET", cookie?: string) =>
  proxy(new NextRequest(`http://localhost:3000${url}`, { method, headers: cookie ? { cookie } : {}, ...(method !== "GET" && { body: "{}" }) }));
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
const direct = (url: string, method = "GET", headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { method, headers });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

type Listed = { items: AccountRun[]; next: string | null };
async function listed(qs = "", cookie = cookies.owner): Promise<Listed> {
  const res = await runsRoute.GET(direct(`/api/admin/generations${qs ? `?${qs}` : ""}`, "GET", { cookie }));
  expect(res.status).toBe(200);
  return (await res.json()) as Listed;
}
const ids = (l: Listed) => l.items.map((g) => g.id);
const remove = (id: string, headers: Record<string, string> = { cookie: cookies.owner }) => runRoute.DELETE(direct(`/api/admin/generations/${id}`, "DELETE", headers), ctx(id));

/** The plan SQLite picks for the list query listGenerations builds inside `fn` (the real SQL, any values bound). */
function listPlan(fn: () => unknown): string {
  const d = db();
  const spy = vi.spyOn(d, "prepare");
  let calls: string[];
  try {
    fn();
  } finally {
    calls = spy.mock.calls.map((c) => c[0]);
    spy.mockRestore();
  }
  const sql = calls.find((s) => s.startsWith("SELECT g.*") && s.includes("ORDER BY"));
  expect(sql).toBeTruthy();
  return plan(sql!, Array((sql!.match(/\?/g) ?? []).length).fill("x"));
}
const plan = (sql: string, args: unknown[] | Record<string, unknown> = []) =>
  (db().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(Array.isArray(args) ? args : [args])) as { detail: string }[]).map((r) => r.detail).join("\n");

describe("Settings → Accounts: what accounts make", () => {
  it("is the owner's only on every new route, and the stats route", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/admin/generations"],
      ["GET", `/api/admin/generations?account=${A}`],
      ["DELETE", "/api/admin/generations/x"],
      ["GET", "/api/admin/accounts"],
    ];
    for (const [m, p] of routes) {
      expect(viaProxy(p, m, cookies.a).status, `account ${m} ${p}`).toBe(403);
      expect(viaProxy(p, m).status, `guest ${m} ${p}`).toBe(401);
      expect(viaProxy(p, m, cookies.forged).status, `forged ${m} ${p}`).toBe(401);
      expect(viaProxy(p, m, cookies.doubled).status, `doubled ${m} ${p}`).toBe(401);
      expect(passed(viaProxy(p, m, cookies.owner)), `owner ${m} ${p}`).toBe(true);
    }
    // The routes check again themselves.
    for (const cookie of [cookies.a, cookies.forged, cookies.doubled, undefined]) {
      const headers: Record<string, string> = cookie ? { cookie } : {};
      expect((await runsRoute.GET(direct("/api/admin/generations", "GET", headers))).status).toBe(403);
      expect((await runsRoute.GET(direct(`/api/admin/generations?account=${A}`, "GET", headers))).status).toBe(403);
      expect((await accountsRoute.GET(direct("/api/admin/accounts", "GET", headers))).status).toBe(403);
      const del = await remove("x", headers);
      expect(del.status).toBe(403);
      expect(del.headers.get("Cache-Control")).toBe("no-store");
    }
    const ok = await runsRoute.GET(direct("/api/admin/generations", "GET", { cookie: cookies.owner }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    const missing = await remove("x");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    // An API token is the owner's.
    const { token } = auth.createToken("t");
    expect((await runsRoute.GET(direct("/api/admin/generations", "GET", { authorization: `Bearer ${token}` }))).status).toBe(200);
    expect((await accountsRoute.GET(direct("/api/admin/accounts", "GET", { authorization: `Bearer ${token}` }))).status).toBe(200);
  });

  it("counts each account's runs, space and GPU", async () => {
    const shown = run(A);
    const kept = output(shown, 2000);
    run(A, { status: "running" });
    run(A, { status: "failed", ago: 2 * DAY, error: "Out of memory" });
    run(A, { status: "failed", ago: 10 * DAY });
    run(A, { status: "canceled", ago: HOUR });
    run(A, { feature: "x-step" });
    const upload = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", accountId: A });
    run(B, { ago: 30 * HOUR });
    auth.setAccountGpu(B, { url: "https://gpu.example.com" });
    auth.setAccountDisabled(B, true);
    for (let i = 0; i < 3; i++) output(run(), 1000);

    const { items, totals } = admin.accountsWithStats();
    const of = (id: string) => items.find((a) => a.id === id)!;
    const newest = (db().prepare("SELECT MAX(created_at) AS t FROM generations WHERE json_extract(request_json, '$.account') = ? AND feature = 'image'").get(A) as { t: number }).t;
    expect(accountUsage(A).total).toBe(kept.size + upload.size);
    expect(of(A)).toMatchObject({ runs: 5, runsDay: 3, runsWeek: 4, running: 1, failedWeek: 1, bytes: accountUsage(A).total, capBytes: 2 ** 30 });
    expect(of(A).lastRunAt).toBe(newest);
    expect(of(B)).toMatchObject({ runs: 1, runsDay: 0, runsWeek: 1, running: 0, failedWeek: 0, bytes: 0, gpu: true, disabled: true });
    expect(of(C)).toMatchObject({ runs: 0, runsDay: 0, runsWeek: 0, running: 0, failedWeek: 0, lastRunAt: null, bytes: 0 });
    // The owner's runs and files are in none of it.
    expect(totals).toMatchObject({ accounts: 3, runsDay: 3, runsWeek: 5, running: 1, bytes: accountUsage(A).total });

    const res = await accountsRoute.GET(direct("/api/admin/accounts", "GET", { cookie: cookies.owner }));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { total: number; items: AccountListing[]; totals: AccountTotals };
    expect(body.total).toBe(3);
    expect(body.items.find((a) => a.id === A)).toMatchObject({ email: "ann@example.com", runs: 5, failedWeek: 1, bytes: accountUsage(A).total });
    expect(body.totals).toMatchObject({ accounts: 3, runsDay: 3, runsWeek: 5, running: 1 });
    const csv = await (await accountsRoute.GET(direct("/api/admin/accounts?format=csv", "GET", { cookie: cookies.owner }))).text();
    expect(csv.split("\r\n")[0]).toBe("email,created,last_login,gpu_connected,fal_key,replicate_key,disabled");
  });

  it("reads its numbers and lists through the indexes", () => {
    expect(plan(admin.STATS_SQL, { day: 0, week: 0 })).toMatch(/SEARCH g USING INDEX generations_account/);
    expect(plan(admin.SPACE_SQL)).toMatch(/USING INDEX assets_account/);
    // One account's: a search of its entries. Every account's: a search of the accounts' entries too, whatever the
    // filters. Along generations_created or generations_status it would read the owner's runs as well, until the page
    // is full: all of them when accounts' runs are few, or none match (3D: accounts can't make it).
    expect(listPlan(() => admin.listAccountRuns({ account: A, before: Date.now(), beforeId: "x" }))).toMatch(/SEARCH g USING INDEX generations_account/);
    const filters: ListOptions[] = [{}, { statuses: ["succeeded"] }, { statuses: ["queued", "running"] }, { kind: "model3d" }, { statuses: ["failed"], kind: "audio" }, { before: Date.now(), beforeId: "x" }];
    for (const o of filters) expect(listPlan(() => admin.listAccountRuns({ accounts: true, ...o })), JSON.stringify(o)).toMatch(/^SEARCH g USING INDEX generations_account\b/);
    // db.ts goes on without the index when it can't make it: the list still answers, the slow way.
    const every = admin.listAccountRuns({ accounts: true, limit: 100 }).items.map((g) => g.id);
    db().exec("DROP INDEX generations_account");
    try {
      expect(admin.listAccountRuns({ accounts: true, limit: 100 }).items.map((g) => g.id)).toEqual(every);
    } finally {
      db().exec("CREATE INDEX IF NOT EXISTS generations_account ON generations(json_extract(request_json, '$.account'), created_at DESC)");
    }
    expect(every.length).toBeGreaterThan(0);
  });

  it("pages newest first, and no run is skipped or repeated", async () => {
    const pager = auth.createAccount("pager@example.com", "long enough").id;
    const at = Date.now() - HOUR;
    const made = [run(pager, { at: at - 3 }), run(pager, { at }), run(pager, { at }), run(pager, { at }), run(pager, { at: at - 1 }), run(pager, { at: at + 1 }), run(pager, { at: at - 2 })];
    const want = db()
      .prepare(`SELECT id FROM generations WHERE id IN (${made.map(() => "?").join(", ")}) ORDER BY created_at DESC, id DESC`)
      .all(...made)
      .map((r) => (r as { id: string }).id);
    const seen: string[] = [];
    const sizes: number[] = [];
    let before = "";
    for (;;) {
      const page = await listed(`account=${pager}&limit=3${before ? `&before=${before}` : ""}`);
      seen.push(...ids(page));
      sizes.push(page.items.length);
      if (!page.next) break;
      before = page.next;
    }
    expect(sizes).toEqual([3, 3, 1]);
    expect(seen).toEqual(want);
    expect(new Set(seen).size).toBe(7);
    expect((admin.accountRunOptions(new URLSearchParams("limit=500")) as { limit: number }).limit).toBe(100);
    expect((admin.accountRunOptions(new URLSearchParams("limit=0")) as { limit: number }).limit).toBe(1);
    expect((admin.accountRunOptions(new URLSearchParams()) as { limit: number }).limit).toBe(30);
  });

  it("filters by account, status and kind", async () => {
    const clip = run(B, { kind: "video" });
    const waiting = run(B, { status: "queued" });
    const ofA = await listed(`account=${A}`);
    expect(ofA.items.length).toBe(5);
    expect(ofA.items.every((g) => g.account.id === A && g.account.email === "ann@example.com")).toBe(true);
    const ofB = await listed(`account=${B}`);
    expect(ofB.items.every((g) => g.account.id === B)).toBe(true);
    expect(ids(ofB)).toEqual(expect.arrayContaining([clip, waiting]));

    const statuses = async (qs: string) => new Set((await listed(qs)).items.map((g) => g.status));
    expect(await statuses("status=failed")).toEqual(new Set(["failed"]));
    expect(await statuses("status=running")).toEqual(new Set(["queued", "running"]));
    expect(await statuses("status=finished")).toEqual(new Set(["succeeded"]));
    const videos = await listed("kind=video");
    expect(ids(videos)).toEqual([clip]);

    const all = ids(await listed("limit=100"));
    expect(all).toEqual(expect.arrayContaining([clip, waiting, ...ids(ofA)]));
    expect(ids(await listed("limit=100&status=sideways&kind=hologram"))).toEqual(all);
    const bad = await runsRoute.GET(direct("/api/admin/generations?account=../x", "GET", { cookie: cookies.owner }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("Pick an account");
  });

  it("never lists the owner's runs, and never deletes them", async () => {
    const mine = run(undefined, { status: "failed" });
    const owners = new Set((db().prepare("SELECT id FROM generations WHERE json_extract(request_json, '$.account') IS NULL").all() as { id: string }[]).map((r) => r.id));
    expect(owners.size).toBeGreaterThan(1);
    for (const qs of ["limit=100", "account=&limit=100", "status=finished&limit=100", "status=running&limit=100", "status=failed&limit=100"]) {
      const page = await listed(qs);
      expect(page.items.length, qs).toBeGreaterThan(0);
      expect(page.items.some((g) => owners.has(g.id)), qs).toBe(false);
      expect(page.items.every((g) => g.account.id && g.request.account === g.account.id), qs).toBe(true);
    }
    const res = await remove(mine);
    expect(res.status).toBe(404);
    expect(gens.getGeneration(mine)).not.toBeNull();
  });

  it("L-13 still holds: the owner's Library, counts and live feed leave accounts' runs out", async () => {
    const accounts = new Set((db().prepare("SELECT id FROM generations WHERE json_extract(request_json, '$.account') IS NOT NULL").all() as { id: string }[]).map((r) => r.id));
    expect(accounts.size).toBeGreaterThan(10);
    expect(gens.listGenerations({ limit: 200 }).some((g) => accounts.has(g.id))).toBe(false);
    expect(gens.listGenerations({ steps: true, limit: 200 }).some((g) => accounts.has(g.id))).toBe(false);
    const before = libraryFacets().total;
    run(A);
    expect(libraryFacets().total).toBe(before);

    for (const qs of ["accounts=1", `account=${A}`]) {
      const res = await generationsRoute.GET(direct(`/api/generations?${qs}&limit=200`, "GET", { cookie: cookies.owner }));
      const items = ((await res.json()) as { items: { id: string; request: { account?: string } }[] }).items;
      expect(items.length, qs).toBeGreaterThan(0);
      expect(items.every((g) => !g.request.account && !accounts.has(g.id)), qs).toBe(true);
    }
    expect("accounts" in listOptionsFrom(new URLSearchParams("accounts=1"))).toBe(false);

    gens.ensureRunner();
    const mine = run();
    const theirs = run(A);
    const seen: string[] = [];
    const off = live.subscribe((e) => seen.push(e.id));
    try {
      db().prepare("UPDATE generations SET message = 'tick' WHERE id IN (?, ?)").run(mine, theirs);
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      off();
    }
    expect(seen).toContain(mine);
    expect(seen).not.toContain(theirs);

    // Only the owner's view of accounts' runs asks for every account's.
    const src = path.join(__dirname, "..", "src");
    const users = (fs.readdirSync(src, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && fs.readFileSync(path.join(src, f), "utf8").includes("accounts: true"))
      .map((f) => f.split(path.sep).join("/"));
    expect(users).toEqual(["server/account-admin.ts"]);
  });

  it("the owner opens an account's files, and accounts open only their own", async () => {
    const id = run(A);
    output(id, 10);
    const item = (await listed(`account=${A}`)).items.find((g) => g.id === id)!;
    const url = item.outputs[0].url;
    expect(url).toMatch(/^\/api\/files\/outputs\//);
    expect(passed(viaProxy(url, "GET", cookies.owner))).toBe(true);
    expect(passed(viaProxy(url, "GET", cookies.a))).toBe(true);
    expect(viaProxy(url, "GET", cookies.c).status).toBe(403);
    expect(viaProxy(url, "GET").status).toBe(401);
    const rel = url.slice("/api/files/".length);
    const res = await filesRoute.GET(direct(url, "GET", { cookie: cookies.owner }), { params: Promise.resolve({ path: rel.split("/") }) } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("deletes an account's run with its files, and gives the account its space back", async () => {
    const id = run(A);
    const asset = output(id, 5000);
    const file = absolutePath(asset.relPath);
    expect(fs.existsSync(file)).toBe(true);
    const usage = accountUsage(A).total;
    const bytes = admin.accountsWithStats().items.find((a) => a.id === A)!.bytes;
    expect(bytes).toBe(usage);

    const res = await remove(id);
    expect(res.status).toBe(204);
    expect(db().prepare("SELECT id FROM generations WHERE id = ?").get(id)).toBeUndefined();
    expect(db().prepare("SELECT id FROM assets WHERE id = ?").get(asset.id)).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
    expect(accountUsage(A).total).toBe(usage - asset.size);
    expect(admin.accountsWithStats().items.find((a) => a.id === A)!.bytes).toBe(bytes - asset.size);
    expect(ids(await listed(`account=${A}&limit=100`))).not.toContain(id);
    expect((await remove(id)).status).toBe(404);

    // A run still going is stopped first, then deleted.
    const going = run(A, { status: "running" });
    expect((await remove(going)).status).toBe(204);
    expect(db().prepare("SELECT id FROM generations WHERE id = ?").get(going)).toBeUndefined();
  });

  it("writes space as the account limits do", () => {
    expect(storageSize(0)).toBe("0 MB");
    expect(storageSize(512 * 1024)).toBe("512 KB");
    expect(storageSize(340 * 2 ** 20)).toBe("340 MB");
    expect(storageSize(2 ** 30)).toBe("1 GB");
    expect(storageSize(1.25 * 2 ** 30)).toBe("1.3 GB");
    expect(storageSize(3 * 2 ** 30)).toBe("3 GB");
  });

  // Synchronous: the runner (started above) can't fail these queued runs before they are counted.
  it("counts a batch or a chain going as one run, as the account's run limit does", () => {
    const D = auth.createAccount("dee@example.com", "long enough").id;
    const E = auth.createAccount("eve@example.com", "long enough").id;
    // Four pictures in one batch; a film whose four shots (chain steps) and join share a batch; a chain whose only job
    // going is a step; and a run of its own.
    for (let i = 0; i < 4; i++) run(D, { status: i ? "queued" : "running", batch: "pictures", ago: 10 * 60_000 });
    for (let i = 0; i < 4; i++) run(D, { feature: "video-step", kind: "video", status: i ? "queued" : "running", batch: "film", ago: 5 * 60_000 });
    const join = run(D, { feature: "video", kind: "video", status: "queued", batch: "film", ago: 5 * 60_000 });
    run(D, { feature: "upscale-step", status: "running", batch: "chain" });
    run(D, { status: "failed", error: "Out of memory", ago: HOUR });
    // Only a helper step: no run to show, and no last run.
    run(E, { feature: "upscale-step", ago: HOUR });

    const going = (db().prepare("SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS n FROM generations WHERE status IN ('queued', 'running') AND json_extract(request_json, '$.account') = ?").get(D) as { n: number }).n;
    const { items } = admin.accountsWithStats();
    const of = (id: string) => items.find((a) => a.id === id)!;
    expect(going).toBe(3);
    expect(of(D)).toMatchObject({ runs: 6, runsDay: 6, runsWeek: 6, running: going, failedWeek: 1 });
    expect(of(D).lastRunAt).toBe(gens.getGeneration(join)!.createdAt);
    expect(of(E)).toMatchObject({ runs: 0, running: 0, lastRunAt: null });
  });
});
