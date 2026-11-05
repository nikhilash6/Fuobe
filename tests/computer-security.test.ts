import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_PNG } from "./helpers/fake-local-comfy";
import { loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-computer-security-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const { onComputer, outputFetch } = await import("@/server/providers/comfyui");
const guestAccess = await import("@/lib/guest-access");
const { accountMayChange, accountOwnRead, guestRead } = guestAccess;

type Principal = import("@/server/computer/tasks").Principal;

let routes: ComputerRoutes;
let a = "";
let b = "";
let link = "";
const cookies: Record<string, string> = {};
const HOST = "localhost:3000";
const SITE = `http://${HOST}`;

beforeAll(async () => {
  routes = await loadRoutes();
  auth.setPassword("install password");
  a = auth.createAccount("a@example.com", "long enough").id;
  b = auth.createAccount("b@example.com", "long enough").id;
  link = auth.createAccount("link@example.com", "long enough").id;
  auth.setAccountGpu(a, { mode: "computer" });
  auth.setAccountGpu(b, { mode: "computer" });
  auth.setAccountGpu(link, { url: "https://gpu.example.com" });
  cookies.a = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
  cookies.b = `${auth.SESSION_COOKIE}=${auth.createSession(b).value}`;
  cookies.link = `${auth.SESSION_COOKIE}=${auth.createSession(link).value}`;
  cookies.owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
});
afterAll(() => {
  globalThis.__fuobeTestDiskFree = undefined;
});
beforeEach(() => {
  resetRates();
  setSetting("comfyWhere", "server");
  db().prepare("DELETE FROM relay_runners").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

type Who = "a" | "b" | "link" | "owner" | "guest";

/** A request from Fuobe's own page as `who` (or as told by `headers`), straight to the route handler. */
function call(who: Who, method: string, url: string, o: { body?: unknown; raw?: Buffer; headers?: Record<string, string> } = {}): Promise<Response> {
  const headers = new Headers({ host: HOST, "sec-fetch-site": "same-origin", origin: SITE, ...(who !== "guest" && { cookie: cookies[who] }) });
  let body: BodyInit | undefined;
  if (o.raw) {
    body = new Uint8Array(o.raw);
    headers.set("content-type", "application/octet-stream");
    headers.set("content-length", String(o.raw.length));
  } else if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers.set("content-type", "application/json");
    headers.set("content-length", String(Buffer.byteLength(body)));
  }
  for (const [k, v] of Object.entries(o.headers ?? {})) {
    if (v === "") headers.delete(k);
    else headers.set(k, v);
  }
  const req = new Request(`${SITE}${url}`, { method, headers, body, duplex: "half" } as RequestInit);
  const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
  const u = new URL(req.url).pathname;
  let m: RegExpExecArray | null;
  if (u === "/api/gpu/computer/beat") return Promise.resolve(routes.beat.POST(req, params({})));
  if (u === "/api/gpu/computer/claim") return Promise.resolve(routes.claim.POST(req, params({})));
  if ((m = /^\/api\/gpu\/computer\/tasks\/([^/]+)\/inputs\/([^/]+)$/.exec(u))) return Promise.resolve(routes.inputs.GET(req, params({ id: m[1], n: m[2] })));
  if ((m = /^\/api\/gpu\/computer\/tasks\/([^/]+)\/report$/.exec(u))) return Promise.resolve(routes.report.POST(req, params({ id: m[1] })));
  if ((m = /^\/api\/gpu\/computer\/tasks\/([^/]+)\/outputs\/([^/]+)$/.exec(u))) return Promise.resolve((method === "PUT" ? routes.outputs.PUT : routes.outputs.GET)(req, params({ id: m[1], n: m[2] })));
  if ((m = /^\/api\/gpu\/computer\/tasks\/([^/]+)\/release$/.exec(u))) return Promise.resolve(routes.release.POST(req, params({ id: m[1] })));
  throw new Error(`no route ${u}`);
}

/** A report whose body arrives as a stream (to see when the route reads it), with the job's token in its header. */
function streamed(who: Who, id: string, lease: string, body: ReadableStream<Uint8Array>): Promise<Response> {
  const headers = new Headers({ host: HOST, "sec-fetch-site": "same-origin", origin: SITE, "content-type": "application/json", "x-fuobe-lease": lease, ...(who !== "guest" && { cookie: cookies[who] }) });
  const req = new Request(`${SITE}/api/gpu/computer/tasks/${id}/report`, { method: "POST", headers, body, duplex: "half" } as RequestInit);
  return Promise.resolve(routes.report.POST(req, { params: Promise.resolve({ id }) }));
}

const SAVE = { "9": { class_type: "SaveImage", inputs: { filename_prefix: "fuobe/x", images: ["3", 0] } }, "3": { class_type: "KSampler", inputs: {} } };

/** A run of `principal` on its computer with one job waiting (an input staged under the name its graph loads). */
function waitingTask(principal: Principal, graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = SAVE): { id: string; generationId: string; input: string } {
  const generationId = `gen-${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  db()
    .prepare(
      "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, external_id, external_meta_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'oss-x', 'open', 'comfyui', 't2i', 'image', 'queued', ?, NULL, '{}', '[]', ?, ?)",
    )
    .run(generationId, JSON.stringify(principal === "owner" ? {} : { account: principal.slice(5) }), now, now);
  const input = onComputer(principal, () => tasks.stageInput(principal, FAKE_PNG, "image/png", "me.png"));
  const t = tasks.createTask({ principal, generationId, graph: { ...graph, "1": { class_type: "LoadImage", inputs: { image: input } } } });
  return { id: t.id, generationId, input };
}

const DEVICE = "device-security-1";

/** The account's computer becomes the runner and claims its oldest job: the claim's lease. */
async function claimed(who: "a" | "b" | "owner", device = DEVICE): Promise<{ id: string; lease: string; promptId: string }> {
  expect((await call(who, "POST", "/api/gpu/computer/beat", { body: { device } })).status).toBe(200);
  const res = await call(who, "POST", "/api/gpu/computer/claim", { body: { device } });
  expect(res.status).toBe(200);
  const { task } = await res.json();
  return { id: task.id, lease: task.lease, promptId: task.promptId };
}

/** A claimed job of A's that ComfyUI finished with these outputs: what the server now wants uploaded. */
async function collecting(outputs: Record<string, unknown>, graph = SAVE) {
  const t = waitingTask(`acct:${a}`, graph);
  const c = await claimed("a");
  expect(c.id).toBe(t.id);
  expect((await call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body: { event: "sent", promptId: c.promptId } })).status).toBe(200);
  const fin = await call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, {
    headers: { "x-fuobe-lease": c.lease },
    body: { event: "finished", entry: { status: { status_str: "success", completed: true }, outputs } },
  });
  expect(fin.status).toBe(200);
  return { ...c, generationId: t.generationId, answer: (await fin.json()) as { wanted?: { n: number; kind: string; maxBytes: number }[]; state?: string } };
}

const ONE_PNG = { "9": { images: [{ filename: "x_00001_.png", subfolder: "fuobe", type: "output" }] } };
const put = (who: Who, id: string, n: number, lease: string, data: Buffer, offset = 0, total = data.length, headers: Record<string, string> = {}) =>
  call(who, "PUT", `/api/gpu/computer/tasks/${id}/outputs/${n}?offset=${offset}&total=${total}`, { raw: data, headers: { "x-fuobe-lease": lease, ...headers } });
const state = (id: string) => (db().prepare("SELECT state, error FROM relay_tasks WHERE id = ?").get(id) as { state: string; error: string | null }).state;

describe("who may use the routes a computer runs jobs through", () => {
  const ROUTES: [string, string, unknown?][] = [
    ["POST", "/api/gpu/computer/beat", { device: DEVICE }],
    ["POST", "/api/gpu/computer/claim", { device: DEVICE }],
    ["GET", "/api/gpu/computer/tasks/AAAAAAAAAAAAAAAA/inputs/0"],
    ["POST", "/api/gpu/computer/tasks/AAAAAAAAAAAAAAAA/report", { lease: "0".repeat(64), event: "gone" }],
    ["GET", "/api/gpu/computer/tasks/AAAAAAAAAAAAAAAA/outputs/0"],
    ["POST", "/api/gpu/computer/tasks/AAAAAAAAAAAAAAAA/release", { lease: "0".repeat(64) }],
  ];

  it("a guest gets 401 on every one", async () => {
    for (const [method, url, body] of ROUTES) expect((await call("guest", method, url, { body })).status, url).toBe(401);
    expect((await put("guest", "AAAAAAAAAAAAAAAA", 0, "0".repeat(64), FAKE_PNG)).status).toBe(401);
  });

  it("the proxy lets an account through to them and nothing new reaches a guest", () => {
    expect(accountMayChange("POST", "/api/gpu/computer/beat", "")).toBe(true);
    expect(accountMayChange("PUT", "/api/gpu/computer/tasks/x/outputs/0", "")).toBe(true);
    expect(accountMayChange("DELETE", "/api/gpu/computer/tasks/x/outputs/0", "")).toBe(false);
    expect(accountOwnRead("/api/gpu/computer/tasks/x/inputs/0")).toBe(true);
    expect(accountOwnRead("/api/gpu/computer/tasks/x/report")).toBe(false);
    for (const p of ["/api/gpu/computer/beat", "/api/gpu/computer/tasks/x/inputs/0", "/api/gpu/computer/tasks/x/outputs/0"]) expect(guestRead(p)).toEqual({ kind: "closed" });
  });

  it("an API token gets 403, even the owner's", async () => {
    setSetting("comfyWhere", "computer");
    const { token } = auth.createToken("script");
    for (const [method, url, body] of ROUTES) expect((await call("owner", method, url, { body, headers: { authorization: `Bearer ${token}` } })).status, url).toBe(403);
  });

  it("another website gets 403: a cross-site request, a foreign Origin, or neither header", async () => {
    expect((await call("a", "POST", "/api/gpu/computer/beat", { body: { device: DEVICE }, headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" } })).status).toBe(403);
    expect((await call("a", "POST", "/api/gpu/computer/beat", { body: { device: DEVICE }, headers: { "sec-fetch-site": "", origin: "https://evil.example" } })).status).toBe(403);
    expect((await call("a", "POST", "/api/gpu/computer/beat", { body: { device: DEVICE }, headers: { "sec-fetch-site": "same-site" } })).status).toBe(403);
    expect((await call("a", "POST", "/api/gpu/computer/beat", { body: { device: DEVICE }, headers: { "sec-fetch-site": "", origin: "" } })).status).toBe(403);
  });

  it("an account whose GPU is a link gets 409; the owner gets 409 until Settings says ComfyUI runs on the owner's computer", async () => {
    expect((await call("link", "POST", "/api/gpu/computer/beat", { body: { device: DEVICE } })).status).toBe(409);
    expect((await call("owner", "POST", "/api/gpu/computer/beat", { body: { device: DEVICE } })).status).toBe(409);
    setSetting("comfyWhere", "computer");
    expect((await call("owner", "POST", "/api/gpu/computer/beat", { body: { device: DEVICE } })).status).toBe(200);
  });

  it("a disabled account gets 401", async () => {
    const c = auth.createAccount("gone@example.com", "long enough").id;
    auth.setAccountGpu(c, { mode: "computer" });
    cookies.c = `${auth.SESSION_COOKIE}=${auth.createSession(c).value}`;
    auth.setAccountDisabled(c, true);
    const res = await call("guest", "POST", "/api/gpu/computer/beat", { body: { device: DEVICE }, headers: { cookie: cookies.c } });
    expect(res.status).toBe(401);
  });

  it("too many beats answer 429 with Retry-After", async () => {
    for (let i = 0; i < 30; i++) expect((await call("a", "POST", "/api/gpu/computer/beat", { body: { device: DEVICE } })).status).toBe(200);
    const res = await call("a", "POST", "/api/gpu/computer/beat", { body: { device: DEVICE } });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("one account can't touch another's jobs", () => {
  it("B's computer never claims A's waiting job", async () => {
    waitingTask(`acct:${a}`);
    expect((await call("b", "POST", "/api/gpu/computer/beat", { body: { device: "device-b-0001" } })).status).toBe(200);
    expect((await call("b", "POST", "/api/gpu/computer/claim", { body: { device: "device-b-0001" } })).status).toBe(204);
  });

  it("A's job, with A's own token, is 404 to B on every route: inputs, report, outputs, release", async () => {
    const t = waitingTask(`acct:${a}`);
    const c = await claimed("a");
    expect(c.id).toBe(t.id);
    expect((await call("b", "GET", `/api/gpu/computer/tasks/${c.id}/inputs/0`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(404);
    expect((await call("b", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body: { event: "sent", promptId: c.promptId } })).status).toBe(404);
    expect((await put("b", c.id, 0, c.lease, FAKE_PNG)).status).toBe(404);
    expect((await call("b", "GET", `/api/gpu/computer/tasks/${c.id}/outputs/0`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(404);
    expect((await call("b", "POST", `/api/gpu/computer/tasks/${c.id}/release`, { body: { lease: c.lease } })).status).toBe(404);
    // And the owner's session is no way in either.
    setSetting("comfyWhere", "computer");
    expect((await call("owner", "GET", `/api/gpu/computer/tasks/${c.id}/inputs/0`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(404);
    // A still has it, untouched.
    expect(state(c.id)).toBe("sending");
    expect((await call("a", "GET", `/api/gpu/computer/tasks/${c.id}/inputs/0`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(200);
  });

  it("a result A's computer sent in is read only as A: as anyone else it's not found", async () => {
    const c = await collecting(ONE_PNG);
    expect((await put("a", c.id, 0, c.lease, FAKE_PNG)).status).toBe(200);
    const url = `relay:${c.id}/view?filename=x_00001_.png&subfolder=fuobe&type=output&n=0`;
    expect((await onComputer(`acct:${b}`, () => outputFetch(url))).status).toBe(404);
    expect((await onComputer("owner", () => outputFetch(url))).status).toBe(404);
    const mine = await onComputer(`acct:${a}`, () => outputFetch(url));
    expect(mine.status).toBe(200);
    expect(Buffer.from(await mine.arrayBuffer()).equals(FAKE_PNG)).toBe(true);
  });
});

describe("the owner's computer and an account's never mix", () => {
  it("the owner's job is 404 to an account on every route, and an account's computer never claims it", async () => {
    setSetting("comfyWhere", "computer");
    const t = waitingTask("owner");
    expect((await call("a", "POST", "/api/gpu/computer/beat", { body: { device: "device-a-0002" } })).status).toBe(200);
    expect((await call("a", "POST", "/api/gpu/computer/claim", { body: { device: "device-a-0002" } })).status).toBe(204);
    const c = await claimed("owner", "device-owner-0001");
    expect(c.id).toBe(t.id);
    expect((await call("a", "GET", `/api/gpu/computer/tasks/${c.id}/inputs/0`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(404);
    expect((await call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body: { event: "sent", promptId: c.promptId } })).status).toBe(404);
    expect((await put("a", c.id, 0, c.lease, FAKE_PNG)).status).toBe(404);
    expect((await call("a", "GET", `/api/gpu/computer/tasks/${c.id}/outputs/0`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(404);
    expect((await call("a", "POST", `/api/gpu/computer/tasks/${c.id}/release`, { body: { lease: c.lease } })).status).toBe(404);
    expect(state(c.id)).toBe("sending");
    expect((await call("owner", "GET", `/api/gpu/computer/tasks/${c.id}/inputs/0`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(200);
  });

  it("the owner's computer never claims an account's job, even while it runs the owner's", async () => {
    setSetting("comfyWhere", "computer");
    waitingTask(`acct:${a}`);
    expect((await call("owner", "POST", "/api/gpu/computer/beat", { body: { device: "device-owner-0002" } })).status).toBe(200);
    expect((await call("owner", "POST", "/api/gpu/computer/claim", { body: { device: "device-owner-0002" } })).status).toBe(204);
  });

  it("an account's run goes to its own computer, or nowhere, never the owner's, whatever the owner's Settings say", async () => {
    const { asAccount } = await import("@/server/generations");
    const { computerScope } = await import("@/server/providers/comfyui");
    setSetting("comfyWhere", "computer");
    expect((await call("owner", "POST", "/api/gpu/computer/beat", { body: { device: "device-owner-0003" } })).status).toBe(200);
    expect(computerScope()).toBe("owner");
    expect(asAccount(a, () => computerScope())).toBe(`acct:${a}`);
    expect(asAccount(link, () => computerScope())).toBeUndefined();
    const none = auth.createAccount("no-gpu@example.com", "long enough").id;
    expect(asAccount(none, () => computerScope())).toBeUndefined();
  });

  it("the owner's results are read only as the owner", async () => {
    const { relayFile } = await import("@/server/providers/comfyui");
    const { asAccount } = await import("@/server/generations");
    setSetting("comfyWhere", "computer");
    // A finished job of the owner's, its result sent in: something real to find, so a refusal means the principal.
    const t = waitingTask("owner");
    const c = await claimed("owner", "device-owner-sec-1");
    expect(c.id).toBe(t.id);
    expect((await call("owner", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body: { event: "sent", promptId: c.promptId } })).status).toBe(200);
    const fin = await call("owner", "POST", `/api/gpu/computer/tasks/${c.id}/report`, {
      headers: { "x-fuobe-lease": c.lease },
      body: { event: "finished", entry: { status: { status_str: "success", completed: true }, outputs: ONE_PNG } },
    });
    expect(fin.status).toBe(200);
    expect((await put("owner", c.id, 0, c.lease, FAKE_PNG)).status).toBe(200);
    const url = `relay:${c.id}/view?filename=x_00001_.png&subfolder=fuobe&type=output&n=0`;
    expect(relayFile(url)).not.toBeNull();
    expect((await onComputer("owner", () => outputFetch(url))).status).toBe(200);
    expect(asAccount(a, () => relayFile(url))).toBeNull();
    expect(onComputer(`acct:${a}`, () => relayFile(url))).toBeNull();
    expect((await onComputer(`acct:${a}`, () => outputFetch(url))).status).toBe(404);
  });

  it("the owner's connection settings and tests stay the owner's", () => {
    const { ownerOnly } = guestAccess;
    expect(ownerOnly("POST", "/api/providers/test")).toBe(true);
    expect(ownerOnly("PUT", "/api/settings")).toBe(true);
    // Reading them: not an account's (its own read list) nor a guest's.
    expect(accountOwnRead("/api/settings")).toBe(false);
    expect(guestRead("/api/settings")).toEqual({ kind: "closed" });
  });
});

describe("a job's token", () => {
  it("a wrong token, or the one before the latest claim, gets 409", async () => {
    waitingTask(`acct:${a}`);
    const first = await claimed("a");
    const wrong = "f".repeat(64);
    expect((await call("a", "GET", `/api/gpu/computer/tasks/${first.id}/inputs/0`, { headers: { "x-fuobe-lease": wrong } })).status).toBe(409);
    expect((await call("a", "GET", `/api/gpu/computer/tasks/${first.id}/inputs/0`, { headers: { "x-fuobe-lease": "not-hex" } })).status).toBe(409);
    expect((await call("a", "POST", `/api/gpu/computer/tasks/${first.id}/report`, { body: { event: "gone" } })).status).toBe(409);
    // The page reloads: its computer claims the job again, and the old token stops working.
    const again = await call("a", "POST", "/api/gpu/computer/claim", { body: { device: DEVICE } });
    const second = (await again.json()).task;
    expect(second.id).toBe(first.id);
    expect(second.lease).not.toBe(first.lease);
    expect((await call("a", "GET", `/api/gpu/computer/tasks/${first.id}/inputs/0`, { headers: { "x-fuobe-lease": first.lease } })).status).toBe(409);
    expect((await call("a", "GET", `/api/gpu/computer/tasks/${first.id}/inputs/0`, { headers: { "x-fuobe-lease": second.lease } })).status).toBe(200);
  });

  it("another computer of the same account doesn't get a job this one took", async () => {
    waitingTask(`acct:${a}`);
    await claimed("a", "device-first-01");
    expect(await (await call("a", "POST", "/api/gpu/computer/beat", { body: { device: "device-second-1" } })).json()).toMatchObject({ runner: false, heldElsewhere: true });
    expect((await call("a", "POST", "/api/gpu/computer/claim", { body: { device: "device-second-1" } })).status).toBe(204);
    // Taking over makes it the runner for jobs still waiting, not for the one the first took.
    expect(await (await call("a", "POST", "/api/gpu/computer/beat", { body: { device: "device-second-1", takeover: true } })).json()).toMatchObject({ runner: true });
    expect((await call("a", "POST", "/api/gpu/computer/claim", { body: { device: "device-second-1" } })).status).toBe(204);
  });
});

describe("inputs", () => {
  it("are read only while the job sends them, a few times each, as bytes that are never a page", async () => {
    waitingTask(`acct:${a}`);
    const c = await claimed("a");
    const res = await call("a", "GET", `/api/gpu/computer/tasks/${c.id}/inputs/0`, { headers: { "x-fuobe-lease": c.lease } });
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(FAKE_PNG)).toBe(true);
    for (let i = 1; i < 6; i++) expect((await call("a", "GET", `/api/gpu/computer/tasks/${c.id}/inputs/0`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(200);
    expect((await call("a", "GET", `/api/gpu/computer/tasks/${c.id}/inputs/0`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(429);
    expect((await call("a", "GET", `/api/gpu/computer/tasks/${c.id}/inputs/1`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(404);
    expect((await call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body: { event: "sent", promptId: c.promptId } })).status).toBe(200);
    expect((await call("a", "GET", `/api/gpu/computer/tasks/${c.id}/inputs/0`, { headers: { "x-fuobe-lease": c.lease } })).status).toBe(409);
  });

  it("only a job's own staged files reach it, never another account's", async () => {
    const theirs = onComputer(`acct:${b}`, () => tasks.stageInput(`acct:${b}`, FAKE_PNG, "image/png", "b.png"));
    const t = waitingTask(`acct:${a}`, { ...SAVE, "2": { class_type: "LoadImage", inputs: { image: theirs } } });
    const c = await claimed("a");
    expect(c.id).toBe(t.id);
    const res = await call("a", "POST", "/api/gpu/computer/claim", { body: { device: DEVICE } });
    const task = (await res.json()).task as { inputs: { name: string }[] };
    expect(task.inputs.map((i) => i.name)).toEqual([t.input]);
  });
});

describe("reports", () => {
  it("each is taken only where the job is", async () => {
    waitingTask(`acct:${a}`);
    const c = await claimed("a");
    const report = (body: Record<string, unknown>) => call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body: { ...body } });
    expect((await report({ event: "finished", entry: { outputs: ONE_PNG } })).status).toBe(409);
    expect((await report({ event: "running", value: 1, max: 2 })).status).toBe(409);
    expect((await report({ event: "nonsense" })).status).toBe(400);
    expect((await report({ event: "sent", promptId: "../../etc" })).status).toBe(400);
    expect((await report({ event: "sent", promptId: c.promptId })).status).toBe(200);
    expect((await report({ event: "sent", promptId: c.promptId })).status).toBe(409);
  });

  it("a tab's progress report stays a few KB: a picture with it is refused and nothing is kept", async () => {
    waitingTask(`acct:${a}`);
    const c = await claimed("a");
    const report = (body: Record<string, unknown>) => call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body: { ...body } });
    expect((await report({ event: "sent", promptId: c.promptId })).status).toBe(200);
    const jpeg = Buffer.alloc(30 * 1024, 7);
    jpeg.set([0xff, 0xd8, 0xff]);
    expect((await report({ event: "running", value: 1, max: 4, preview: jpeg.toString("base64") })).status).toBe(413);
    expect(tasks.taskPreview(c.id)).toBeNull();
    expect((await report({ event: "running", value: 2, max: 4 })).status).toBe(200);
    expect(tasks.taskProgress(c.id)).toMatchObject({ value: 2, max: 4 });
  });

  it("a finished entry over 8 MB is refused", async () => {
    waitingTask(`acct:${a}`);
    const c = await claimed("a");
    await call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body: { event: "sent", promptId: c.promptId } });
    const big = { event: "finished", entry: { outputs: { "9": { text: ["x".repeat(9 * 2 ** 20)] } } } };
    expect((await call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body: big })).status).toBe(413);
    expect(state(c.id)).toBe("queued");
  });

  it("its token goes in a header and is checked before the report is read: a report about no job of yours costs nothing", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1024 * 1024));
        if (pulled >= 8) c.close();
      },
    });
    const res = await streamed("a", "AAAAAAAAAAAAAAAA", "0".repeat(64), body);
    expect(res.status).toBe(404);
    expect(pulled).toBeLessThanOrEqual(1);
    // The token in the body (as before) is no token.
    waitingTask(`acct:${a}`);
    const c = await claimed("a");
    expect((await call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { body: { lease: c.lease, event: "sent", promptId: c.promptId } })).status).toBe(409);
  });

  it("a report other than ComfyUI's own answer is a few KB; a refusal is read only while the job sends", async () => {
    waitingTask(`acct:${a}`);
    const c = await claimed("a");
    const report = (body: Record<string, unknown>) => call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body });
    // Sending: a refusal may be large-ish, nothing more.
    expect((await report({ event: "refused", status: 400, body: { pad: "x".repeat(300 * 1024) } })).status).toBe(413);
    expect((await report({ event: "comfy-down", pad: "x".repeat(20 * 1024) })).status).toBe(413);
    expect((await report({ event: "sent", promptId: c.promptId })).status).toBe(200);
    // ComfyUI has it: a finished entry may be large, a progress report may not.
    expect((await report({ event: "running", value: 1, max: 2, node: "x".repeat(20 * 1024) })).status).toBe(413);
    expect((await report({ event: "running", value: 1, max: 2 })).status).toBe(200);
  });

  it("reads two of one person's reports at once at most", async () => {
    waitingTask(`acct:${a}`);
    const c = await claimed("a");
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const held = () =>
      new ReadableStream<Uint8Array>({
        async pull(ctl) {
          await gate;
          ctl.enqueue(new TextEncoder().encode(JSON.stringify({ event: "comfy-down" })));
          ctl.close();
        },
      });
    const first = streamed("a", c.id, c.lease, held());
    const second = streamed("a", c.id, c.lease, held());
    await new Promise((r) => setTimeout(r, 20));
    const third = await streamed("a", c.id, c.lease, held());
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
    open();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, { headers: { "x-fuobe-lease": c.lease }, body: { event: "comfy-down" } })).status).toBe(200);
  });

  it("keeps at most 16 KB of a refusal, and still says what was missing", async () => {
    waitingTask(`acct:${a}`);
    const c = await claimed("a");
    const nodeErrors = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [String(i), { class_type: "UNETLoader", errors: [{ message: "Value not in list", details: "d".repeat(400), extra_info: { input_name: "unet_name", received_value: `model_${i}.safetensors` } }] }]),
    );
    const res = await call("a", "POST", `/api/gpu/computer/tasks/${c.id}/report`, {
      headers: { "x-fuobe-lease": c.lease },
      body: { event: "refused", status: 400, body: { error: { type: "prompt_outputs_failed_validation", message: "m".repeat(50_000) }, node_errors: nodeErrors } },
    });
    expect(res.status).toBe(200);
    const kept = (db().prepare("SELECT refusal_json FROM relay_tasks WHERE id = ?").get(c.id) as { refusal_json: string }).refusal_json;
    expect(kept.length).toBeLessThanOrEqual(16 * 1024 + 64);
    expect(JSON.parse(kept).body.error.message.length).toBeLessThanOrEqual(1024);
    expect(tasks.keptRefusal({ node_errors: { "4": { class_type: "UNETLoader", errors: [{ message: "Value not in list", extra_info: { received_value: "x.safetensors" } }] } } })).toMatchObject({
      node_errors: { "4": { errors: [{ extra_info: { received_value: "x.safetensors" } }] } },
    });
  });

  it("a forged entry with 500 pictures gets 16 wanted, the most an account's run keeps", async () => {
    const images = Array.from({ length: 500 }, (_, i) => ({ filename: `x_${String(i + 1).padStart(5, "0")}_.png`, subfolder: "fuobe", type: "output" }));
    const c = await collecting({ "9": { images } });
    expect(c.answer.wanted).toHaveLength(16);
  });
});

describe("results are checked like uploads", () => {
  it("only a wanted file, only at the right place, only once", async () => {
    const c = await collecting(ONE_PNG);
    expect(c.answer.wanted).toEqual([expect.objectContaining({ n: 0, kind: "image" })]);
    expect((await put("a", c.id, 1, c.lease, FAKE_PNG)).status).toBe(404);
    expect((await put("a", c.id, 0, c.lease, FAKE_PNG, 5)).status).toBe(409);
    expect((await put("a", c.id, 0, c.lease, FAKE_PNG, 0, FAKE_PNG.length, { "content-length": "" })).status).toBe(411);
    const ok = await put("a", c.id, 0, c.lease, FAKE_PNG);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ done: true });
    expect(state(c.id)).toBe("done");
    expect([409, 404]).toContain((await put("a", c.id, 0, c.lease, FAKE_PNG)).status);
  });

  it("goes on from where a cut-off upload got to", async () => {
    const c = await collecting(ONE_PNG);
    const half = FAKE_PNG.length >> 1;
    expect((await put("a", c.id, 0, c.lease, FAKE_PNG.subarray(0, half), 0, FAKE_PNG.length)).status).toBe(200);
    expect(await (await call("a", "GET", `/api/gpu/computer/tasks/${c.id}/outputs/0`, { headers: { "x-fuobe-lease": c.lease } })).json()).toEqual({ received: half, total: FAKE_PNG.length, done: false });
    expect((await put("a", c.id, 0, c.lease, FAKE_PNG.subarray(half), half, FAKE_PNG.length)).status).toBe(200);
    expect(state(c.id)).toBe("done");
    const file = tasks.receivedFile(`acct:${a}`, c.id, 0)!;
    expect(fs.readFileSync(file.path).equals(FAKE_PNG)).toBe(true);
  });

  it("a page dressed as a picture is refused, nothing is kept, and the run fails saying why", async () => {
    const c = await collecting(ONE_PNG);
    const page = Buffer.from("<!doctype html><script>alert(1)</script>".padEnd(120, " "));
    const res = await put("a", c.id, 0, c.lease, page);
    expect(res.status).toBe(415);
    expect(state(c.id)).toBe("failed");
    expect(fs.existsSync(path.join(tasks.relayDir(), "tasks", c.id, "out-0"))).toBe(false);
    expect(fs.existsSync(path.join(tasks.relayDir(), "tasks", c.id, "out-0.part"))).toBe(false);
    const svg = await collecting(ONE_PNG);
    expect((await put("a", svg.id, 0, svg.lease, Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`.padEnd(80, " ")))).status).toBe(415);
  });

  it("a stored file opened on its own can't run scripts as the site, whatever its type", async () => {
    // A script on the site's own address could drive the person's ComfyUI: stored files never get to run one.
    const { saveFile } = await import("@/server/storage");
    const { fileResponse } = await import("@/server/file-response");
    for (const [name, contentType, data] of [
      ["a.png", "image/png", FAKE_PNG],
      ["a.svg", "image/svg+xml", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"/>`)],
      ["a.txt", "text/plain", Buffer.from("hello")],
    ] as const) {
      const url = saveFile({ data, contentType, name, source: "upload" }).url;
      const res = fileResponse(new Request(`${SITE}${url}`), url.replace(/^\/api\/files\//, ""));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")?.split(/;\s*/)).toContain("sandbox");
      await res.body?.cancel();
    }
  });

  it("a real picture sent as a web page is kept as the picture its bytes say", async () => {
    const c = await collecting(ONE_PNG);
    expect((await put("a", c.id, 0, c.lease, FAKE_PNG, 0, FAKE_PNG.length, { "content-type": "text/html" })).status).toBe(200);
    expect(tasks.receivedFile(`acct:${a}`, c.id, 0)?.contentType).toBe("image/png");
  });

  it("a text result that isn't UTF-8 is refused", async () => {
    const c = await collecting({ "9": { text_files: [{ filename: "x_00001_.txt", subfolder: "fuobe", type: "output" }] } }, { "9": { class_type: "SaveText|pysssss", inputs: { filename_prefix: "fuobe/x" } } } as never);
    const want = c.answer.wanted ?? [];
    expect(want).toEqual([expect.objectContaining({ kind: "text" })]);
    const res = await put("a", c.id, want[0].n, c.lease, Buffer.from([0x68, 0x69, 0xff, 0xfe, 0x00, 0x41]));
    expect(res.status).toBe(415);
    expect(state(c.id)).toBe("failed");
  });

  it("past a file's limit, or past the room the account's files have, is refused and the run fails", async () => {
    const c = await collecting(ONE_PNG);
    const limit = c.answer.wanted![0].maxBytes;
    const res = await put("a", c.id, 0, c.lease, FAKE_PNG, 0, limit + 1);
    expect(res.status).toBe(413);
    expect(state(c.id)).toBe("failed");
  });
});

describe("a computer's own GPU check (the tab reads its ComfyUI and sends what it found)", () => {
  const inventoryRoute = import("@/app/api/gpu/inventory/route");
  const readinessRoute = import("@/app/api/gpu/readiness/route");
  const checkRoute = import("@/app/api/gpu/check/route");
  const sent = (who: Who, body: unknown, headers: Record<string, string> = {}) =>
    inventoryRoute.then((r) =>
      r.PUT(new Request(`${SITE}/api/gpu/inventory`, { method: "PUT", headers: { host: HOST, "sec-fetch-site": "same-origin", origin: SITE, "content-type": "application/json", ...(who !== "guest" && { cookie: cookies[who] }), ...headers }, body: JSON.stringify(body) })),
    );
  const board = (who: Who) => readinessRoute.then(async (r) => (await r.GET(new Request(`${SITE}/api/gpu/readiness`, { headers: { host: HOST, cookie: cookies[who] } }))).json());

  async function gathered() {
    const { gatherInventory } = await import("@/lib/gpu/gather");
    const { fetchTransport } = await import("@/lib/gpu/transport");
    const { loadIndex } = await import("@/server/gpu/index-file");
    const { startLocalComfy } = await import("./helpers/fake-local-comfy");
    const { browserLocal } = await import("./helpers/computer-tab");
    const fake = await startLocalComfy({ cors: SITE });
    try {
      const local = browserLocal(SITE);
      return await gatherInventory(fetchTransport("browser", fake.url, (url, init) => local(url, init), { decodes: true }), loadIndex(), { where: "computer", statsTimeoutMs: 1500 });
    } finally {
      await fake.close();
    }
  }

  it("is kept for that account's own board, in the server's time; the server never checks it itself", async () => {
    const inv = await gathered();
    expect(inv).toMatchObject({ via: "browser", reachable: true });
    const res = await sent("a", { ...inv, checkedAt: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, target: "computer" });
    const view = await board("a");
    expect(view).toMatchObject({ connected: true, target: "computer" });
    expect(view.checkedAt).toBeGreaterThan(Date.now() - 60_000);
    expect(view.report?.studios?.length).toBeGreaterThan(0);
    // B's board knows nothing of it.
    expect(await board("b")).toMatchObject({ connected: true, target: "computer", checkedAt: null });
    const check = await (await checkRoute).POST(new Request(`${SITE}/api/gpu/check`, { method: "POST", headers: { host: HOST, "sec-fetch-site": "same-origin", origin: SITE, cookie: cookies.a } }));
    expect(check.status).toBe(409);
    expect((await check.json()).code).toBe("browser");
  });

  it("refuses a check that isn't one, one too large, one from a link account, a guest, a token or another site", async () => {
    expect((await sent("a", { hello: "there" })).status).toBe(400);
    expect((await sent("a", { v: 1, via: "server" })).status).toBe(400);
    expect((await sent("a", "x".repeat(3 * 2 ** 20))).status).toBe(413);
    expect((await sent("link", {})).status).toBe(409);
    expect([401, 403, 409]).toContain((await sent("guest", {})).status);
    expect((await sent("a", {}, { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status).toBe(403);
    const { token } = auth.createToken("inv");
    expect((await sent("owner", {}, { authorization: `Bearer ${token}` })).status).toBe(403);
  });
});
