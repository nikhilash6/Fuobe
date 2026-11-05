import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

/**
 * An account's own GPU at a web address that has a problem: Settings' Test and Check my GPU say what is wrong in plain
 * words with what helps; a run waits out a GPU that is off or starting up, asks it once more before it fails, and fails
 * in plain words with its buttons; a run its GPU lost is sent again once; a run whose account moved to another address
 * says so; the status strip (the composer's check before Run) knows why the GPU is offline. All against a stand-in
 * ComfyUI on this machine: no real ComfyUI, RunPod or fuobe.com is called.
 */
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-own-gpu-graceful-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
globalThis.__fuobeTestDiskFree = 1e13;

// Plain fetch is the install's own ComfyUI: an account's runs never reach it.
const realFetch = globalThis.fetch;
const fetched: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetched.push(String(input instanceof Request ? input.url : input));
  return new Response("not stubbed", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const uploadsRoute = await import("@/app/api/uploads/route");
const gpuRoute = await import("@/app/api/account/gpu/route");
const generationRoute = await import("@/app/api/generations/[id]/route");
const smallerRoute = await import("@/app/api/generations/[id]/smaller/route");
const { asAccount, CHAINED_RUN, cancelGeneration, createGenerations, getGeneration, OWN_QUEUE, QUIET_MS, SELF_HEAL, STALE_SUBMIT } = await import("@/server/generations");
const { ownRunNote } = await import("@/server/run-events");
const { removeAccountKey, saveAccountKey } = await import("@/server/account-keys");
const { cleanGpuAddress, checkGpuAddress, visitorStatus } = await import("@/server/account-gpu");
const { comfyProvider, onOwnGpu, queuePlace } = await import("@/server/providers/comfyui");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { runAsTenant } = await import("@/server/tenant");
const { ISOLATED_ON_GPU } = await import("@/lib/diagnose");

let fake: FakeComfy;
let a = "";
let cookie = "";
beforeAll(async () => {
  fake = await startFakeComfy({ loras: [], delayMs: 0 });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  a = auth.createAccount("graceful@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  SELF_HEAL.scale = 1;
  await fake.close();
});
beforeEach(() => {
  resetRates();
  SELF_HEAL.scale = 0.001;
  Object.assign(fake.opts, { loras: [], delayMs: 0, answer: undefined, hold: undefined });
  fake.log.length = 0;
  auth.setAccountGpu(a, { url: fake.url });
  globalThis.__fuobeTestGpuHosts = undefined;
  globalThis.__fuobeAccountGpus?.clear();
  globalThis.__fuobePollHeals?.clear();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

const headers = (extra: Record<string, string> = {}) => ({ cookie, host: "localhost:3000", ...extra });
const json = (url: string, method: string, body: unknown) => {
  const text = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, { method, headers: headers({ "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }), body: text });
};
const put = async (body: unknown, test = true) => {
  const r = await gpuRoute.PUT(json(`/api/account/gpu${test ? "?test=1" : ""}`, "PUT", body));
  return { status: r.status, body: (await r.json()) as { error?: string; trouble?: { cause: string; words: string; details?: string; actions: { kind: string }[]; retryable: boolean }; note?: string; url?: string; offline?: true; gpu?: { url: string } }, headers: r.headers };
};
const html = (status: number, title = "Bad gateway") => ({ status, body: `<!DOCTYPE html><html><head><title>${title}</title></head><body>…</body></html>`, contentType: "text/html" });

async function uploadPng(): Promise<string> {
  const r = await uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: headers({ "content-type": "image/png", "x-file-name": "me.png", "content-length": String(TINY_PNG.length) }), body: TINY_PNG }));
  expect(r.status).toBe(201);
  return ((await r.json()) as { url: string }).url;
}
async function startRun(): Promise<string> {
  const pic = await uploadPng();
  const r = await generationsRoute.POST(json("/api/generations", "POST", { feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "", inputs: { images: [pic] } }));
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { items: { id: string }[] }).items[0].id;
}
/** A later step of the run `first`: it waits for that run's result, as a relight's clip waits for its still. */
function laterStep(first: string, pic: string): string {
  const [g] = asAccount(a, () => createGenerations({ feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "", inputs: { images: [pic] } } as Parameters<typeof createGenerations>[0], { dependsOn: first }));
  return g.id;
}
/** A run's kept state before its job is sent (its wait, and whether its job was being sent). */
const setPending = (id: string, meta: object) => db().prepare("UPDATE generations SET external_meta_json = ? WHERE id = ?").run(JSON.stringify(meta), id);
/** The turn to send the run was held by an app process that has since stopped (no word from it for over 20 s). */
const heldByStopped = (id: string) => {
  db().prepare("INSERT INTO app_processes (token, started_at, seen_at) VALUES ('gone', ?, ?) ON CONFLICT(token) DO UPDATE SET seen_at = excluded.seen_at").run(Date.now() - 10 * 60_000, Date.now() - QUIET_MS - 1000);
  db().prepare("INSERT INTO submit_turns (id, held_by, held_at) VALUES (?, 'gone', ?) ON CONFLICT(id) DO UPDATE SET held_by = excluded.held_by").run(id, Date.now() - 60_000);
};
/** The app process that holds the turn to send the run (null: none does). */
const turnOf = (id: string) => (db().prepare("SELECT held_by FROM submit_turns WHERE id = ?").get(id) as { held_by: string } | undefined)?.held_by ?? null;
/** Tick the runner until the row is done (or the time is up), noting every message the tile showed on the way. */
async function settle(id: string, ms = 15_000, seen: string[] = []) {
  const end = Date.now() + ms;
  for (;;) {
    await globalThis.__fuobeRunner?.tick();
    const g = getGeneration(id, { includeDeleted: true });
    if (g?.message && seen.at(-1) !== g.message) seen.push(g.message);
    if (!g || (g.status !== "queued" && g.status !== "running") || Date.now() > end) return g;
    await new Promise((r) => setTimeout(r, 15));
  }
}
const kinds = (t: { actions: { kind: string }[] } | undefined) => (t?.actions ?? []).map((x) => x.kind);
/** No status code, program words, HTML or an address in what the person reads first. */
const plainWords = (s: string | null | undefined) => {
  expect(s).toBeTruthy();
  expect(s).not.toMatch(/HTTP|\b[1-5]\d\d\b|upload failed|\/prompt|<html|<!DOCTYPE|127\.0\.0\.1|ECONN|isn't JSON/);
};

describe("Settings → Your GPU: Test says what is wrong, in plain words, with what helps", () => {
  it("a GPU starting up (502), a password (401), a web page and another app's 404", async () => {
    fake.opts.answer = (_m, p) => (p === "/system_stats" ? html(502) : undefined);
    const starting = await put({ url: fake.url });
    expect(starting.status).toBe(422);
    expect(starting.body.trouble).toMatchObject({ cause: "gpu-starting", retryable: true });
    expect(starting.body.error).toBe(starting.body.trouble!.words);
    expect(starting.body.error).toMatch(/starting up/);
    // The kind of address, never the address itself.
    expect(starting.body.trouble!.details).toBe("your web address · HTTP 502 · Bad gateway");
    plainWords(starting.body.error);
    // Today's wrong advice is gone.
    expect(starting.body.error).not.toMatch(/isn't a ComfyUI/);

    fake.opts.answer = (_m, p) => (p === "/system_stats" ? { status: 401, body: "" } : undefined);
    expect((await put({ url: fake.url })).body.trouble).toMatchObject({ cause: "gpu-password", words: "Your GPU asks for a password. Paste it in Access token." });
    expect((await put({ url: fake.url, token: "wrong" })).body.trouble).toMatchObject({ cause: "gpu-password-wrong" });

    fake.opts.answer = (_m, p) => (p === "/system_stats" ? html(200, "Jupyter") : undefined);
    expect((await put({ url: fake.url })).body.trouble).toMatchObject({ cause: "gpu-not-comfy", retryable: false });
    fake.opts.answer = (_m, p) => (p === "/system_stats" ? { status: 404, body: "not found", contentType: "text/plain" } : undefined);
    expect((await put({ url: fake.url })).body.trouble).toMatchObject({ cause: "gpu-not-comfy" });
  });

  it("a GPU that doesn't answer at all", async () => {
    // A port with nothing behind it (the stand-in's port is the one an account may use on this machine).
    const idle = http.createServer();
    await new Promise<void>((r) => idle.listen(0, "127.0.0.1", () => r()));
    const port = (idle.address() as { port: number }).port;
    await new Promise<void>((r) => idle.close(() => r()));
    globalThis.__fuobeTestGpuPort = port;
    try {
      const r = await put({ url: `http://127.0.0.1:${port}` });
      expect(r.status).toBe(422);
      expect(r.body.trouble).toMatchObject({ cause: "gpu-offline", retryable: true });
      expect(r.body.error).toMatch(/^Your GPU didn't answer\./);
      expect(r.body.trouble!.details).toMatch(/ECONNREFUSED/);
      plainWords(r.body.error);
    } finally {
      globalThis.__fuobeTestGpuPort = fake.port;
    }
  });

  it("makes a pasted address whole: https:// added, a ? or # part left out, a password refused", async () => {
    const pod = cleanGpuAddress(" abc123xyz-8188.proxy.runpod.net ");
    expect(pod.url.href).toBe("https://abc123xyz-8188.proxy.runpod.net/");
    expect(pod.fixed).toEqual(["scheme"]);
    const fixed: ("scheme" | "query")[] = [];
    expect(await checkGpuAddress("abc123xyz-8188.proxy.runpod.net/?token=x#queue", { resolve: async () => ["93.184.216.34"], fixed })).toBe("https://abc123xyz-8188.proxy.runpod.net");
    expect(fixed).toEqual(["scheme", "query"]);
    // Through the route: the address back as it was checked, and the note under the field.
    const r = await put({ url: `${fake.url}/?view=queue#x` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ note: "We kept only the address part.", url: fake.url });
    const pw = await put({ url: "https://me:secret@gpu.example.com" });
    expect(pw.status).toBe(422);
    expect(pw.body.trouble).toMatchObject({ cause: "address-credentials", words: "A password goes in the Access token box, not in the address." });
  });

  it("an http address that sends to https is followed to the port it named (none: 443), never another", async () => {
    globalThis.__fuobeTestGpuHosts = { "gpu-redirect.example.com": fake.port };
    for (const [to, kept] of [
      ["https://gpu-redirect.example.com:8443/system_stats", "https://gpu-redirect.example.com:8443"],
      ["https://gpu-redirect.example.com/system_stats", "https://gpu-redirect.example.com"],
    ]) {
      let asked = 0;
      fake.opts.answer = (_m, p) => (p === "/system_stats" && asked++ === 0 ? { status: 301, body: "", contentType: "text/plain", headers: { location: to } } : undefined);
      const r = await put({ url: "http://gpu-redirect.example.com:8188" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.url).toBe(kept);
    }
  });

  it("a token the address echoes back is never in what the person reads", async () => {
    const token = "sekret-token-4815162342";
    fake.opts.answer = (_m, p) => (p === "/system_stats" ? { status: 200, body: `{"headers": {"Authorization": "Bearer ${token}"}}`, contentType: "application/json" } : undefined);
    const r = await put({ url: fake.url, token });
    expect(r.status).toBe(422);
    expect(r.body.trouble?.cause).toBe("gpu-not-comfy");
    expect(JSON.stringify(r.body)).not.toContain(token);
    expect(JSON.stringify(r.body)).not.toContain("4815162342");
  });

  it("too many checks: says when it checks again, by itself", async () => {
    let last: Awaited<ReturnType<typeof put>> | undefined;
    for (let i = 0; i < 12; i++) last = await put({ url: fake.url });
    expect(last!.status).toBe(429);
    expect(last!.body.trouble).toMatchObject({ cause: "checks-too-fast", words: "Checking again in a few seconds.", retryable: true });
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("Check my GPU asks the saved address again, and the status strip shows why it is offline without asking again", async () => {
    fake.opts.answer = (_m, p) => (p === "/system_stats" ? html(503, "Service unavailable") : undefined);
    const r = await put({ saved: true });
    expect(r.status).toBe(422);
    expect(r.body.trouble?.cause).toBe("gpu-starting");
    const asked = fake.log.filter((e) => e.path === "/system_stats").length;
    const s = await visitorStatus(auth.accountById(a)!);
    expect(s.viewer.gpu).toMatchObject({ connected: true, mode: "link", online: false, host: "web", trouble: { cause: "gpu-starting", retryable: true } });
    expect(s.viewer.gpu.trouble!.actions.map((x) => x.kind)).toContain("check-gpu");
    // The composer's check before Run reads this answer: nothing more was asked of the GPU.
    expect(fake.log.filter((e) => e.path === "/system_stats").length).toBe(asked);
    fake.opts.answer = undefined;
    expect((await put({ saved: true })).status).toBe(200);
    expect((await visitorStatus(auth.accountById(a)!)).viewer.gpu).toMatchObject({ online: true });
  });

  it("Save anyway keeps the address of a GPU that is off right now; an address that can't work can't be kept", async () => {
    auth.setAccountGpu(a, null);
    fake.opts.answer = (_m, p) => (p === "/system_stats" ? html(502) : undefined);
    const plainConnect = await put({ url: fake.url }, false);
    expect(plainConnect.status).toBe(422);
    expect(auth.accountGpu(a)).toBeNull();
    const kept = await put({ url: fake.url, anyway: true }, false);
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ offline: true, gpu: { url: fake.url }, trouble: { cause: "gpu-starting" } });
    expect(auth.accountGpu(a)).toEqual({ url: fake.url });
    fake.opts.answer = (_m, p) => (p === "/system_stats" ? { status: 401, body: "" } : undefined);
    auth.setAccountGpu(a, null);
    expect((await put({ url: fake.url, anyway: true }, false)).status).toBe(422);
    expect(auth.accountGpu(a)).toBeNull();
  });
});

describe("a run on an account's own GPU heals itself, or fails in plain words with what helps", () => {
  it("waits while its GPU starts up, saying so, then runs", async () => {
    SELF_HEAL.scale = 0.01;
    let refused = 0;
    fake.opts.answer = (m, p) => (p === "/upload/image" && m === "POST" && refused++ < 2 ? html(502) : undefined);
    const id = await startRun();
    const seen: string[] = [];
    const g = await settle(id, 20_000, seen);
    expect(g?.status, g?.error ?? "").toBe("succeeded");
    expect(seen).toContain("Waiting for your GPU to start up");
    expect(fake.log.filter((e) => e.path === "/upload/image").length).toBeGreaterThanOrEqual(3);
  });

  it("asks its GPU once more before it fails, then says why in plain words, with its buttons and the details", async () => {
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    const id = await startRun();
    const g = await settle(id);
    expect(g?.status).toBe("failed");
    expect(g?.error).toBe("Your GPU is starting up, so ComfyUI wasn't ready for this run. Press Retry in a minute.");
    plainWords(g?.error);
    expect(g?.trouble).toMatchObject({ cause: "gpu-starting", details: "your web address · HTTP 502 · Bad gateway" });
    expect(kinds(g?.trouble)).toEqual(expect.arrayContaining(["retry", "check-gpu", "gpu-settings"]));
    // The file went once: each try after it only looked at the GPU (/system_stats), and it was asked once more at the end.
    const paths = fake.log.map((e) => e.path);
    expect(paths.filter((p) => p === "/upload/image")).toHaveLength(1);
    expect(paths.filter((p) => p === "/system_stats").length).toBeGreaterThan(2);
    expect(paths.lastIndexOf("/system_stats")).toBeGreaterThan(paths.indexOf("/upload/image"));
    // What it learnt shows in the status strip too.
    expect((await visitorStatus(auth.accountById(a)!)).viewer.gpu).toMatchObject({ online: false, trouble: { cause: "gpu-starting" } });
  });

  it("while a run waits, the status strip says so in a check's words; a new address saved meanwhile is where the run goes", async () => {
    SELF_HEAL.scale = 0.01;
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    const id = await startRun();
    for (let i = 0; i < 500 && getGeneration(id)?.message !== "Waiting for your GPU to start up"; i++) await new Promise((r) => setTimeout(r, 10));
    expect(getGeneration(id)?.message).toBe("Waiting for your GPU to start up");
    // The tile shows what helps while it waits, and until when.
    expect(getGeneration(id)?.waiting).toMatchObject({ cause: "gpu-starting", until: expect.any(Number) });
    expect(kinds(getGeneration(id)?.waiting)).toContain("check-gpu");
    // The composer's check before Run reads this (Settings' words, not a run's "press Retry").
    const s = await visitorStatus(auth.accountById(a)!);
    expect(s.viewer.gpu).toMatchObject({ online: false, trouble: { cause: "gpu-starting", words: expect.stringMatching(/we connect as soon as ComfyUI is ready/) } });
    // The person pastes a new address (a tunnel that restarted): the run goes there, and runs.
    globalThis.__fuobeTestGpuHosts = { "new-river.trycloudflare.com": fake.port };
    fake.opts.answer = undefined;
    auth.setAccountGpu(a, { url: "https://new-river.trycloudflare.com" });
    const g = await settle(id, 20_000);
    expect(g?.status, g?.error ?? "").toBe("succeeded");
    // Sent to the new address (the run keeps which, by a name made from it, never the address).
    const sentTo = (JSON.parse(String(db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(id))) as { sentTo?: string }).sentTo;
    expect(sentTo).toBe(crypto.createHash("sha256").update("https://new-river.trycloudflare.com").digest("hex").slice(0, 16));
  });

  it("a GPU disconnected while a run waits stops the run, saying so, with Connect your GPU", async () => {
    SELF_HEAL.scale = 0.01;
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    const id = await startRun();
    for (let i = 0; i < 500 && getGeneration(id)?.message !== "Waiting for your GPU to start up"; i++) await new Promise((r) => setTimeout(r, 10));
    auth.setAccountGpu(a, null);
    const g = await settle(id);
    expect(g?.status).toBe("failed");
    expect(g?.error).toBe("You disconnected your GPU, so this run stopped. Connect it again, then press Retry.");
    expect(g?.trouble?.actions[0]).toMatchObject({ kind: "gpu-settings", label: "Connect your GPU" });
  });

  it("Cancel while a run waits stays a cancel, and nothing more is sent", async () => {
    SELF_HEAL.scale = 0.01;
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    const id = await startRun();
    for (let i = 0; i < 500 && getGeneration(id)?.message !== "Waiting for your GPU to start up"; i++) await new Promise((r) => setTimeout(r, 10));
    await cancelGeneration(id);
    const at = Date.now();
    fake.opts.answer = undefined;
    await new Promise((r) => setTimeout(r, 1500));
    await settle(id, 500);
    expect(getGeneration(id, { includeDeleted: true })?.status).toBe("canceled");
    expect(fake.log.filter((e) => e.at > at && (e.path === "/upload/image" || e.path === "/prompt"))).toEqual([]);
  });

  it("never waits out what waiting can't fix: a password, a web page instead of ComfyUI", async () => {
    fake.opts.answer = (_m, p) => (p === "/upload/image" ? { status: 401, body: "" } : undefined);
    const id = await startRun();
    const g = await settle(id);
    expect(g?.status).toBe("failed");
    expect(g?.trouble?.cause).toBe("gpu-password");
    expect(g?.error).toMatch(/asks for a password/);
    expect(fake.log.filter((e) => e.path === "/upload/image")).toHaveLength(1);

    fake.log.length = 0;
    fake.opts.answer = (_m, p) => (p === "/upload/image" ? html(200, "Sign in") : undefined);
    const page = await settle(await startRun());
    expect(page?.trouble?.cause).toBe("gpu-not-comfy");
    plainWords(page?.error);
    expect(fake.log.filter((e) => e.path === "/upload/image")).toHaveLength(1);
  });

  it("a GPU known to be off from its last status check waits at once, without sending files to it", async () => {
    SELF_HEAL.scale = 0.01;
    fake.opts.answer = (_m, p) => (p === "/system_stats" ? html(502) : undefined);
    expect((await put({ saved: true })).status).toBe(422);
    fake.log.length = 0;
    fake.opts.answer = undefined;
    const seen: string[] = [];
    const g = await settle(await startRun(), 20_000, seen);
    expect(g?.status).toBe("succeeded");
    expect(seen).toContain("Waiting for your GPU to start up");
  });

  it("its GPU going away mid-run: the tile says it waits, then the run stops in plain words", async () => {
    fake.opts.delayMs = 60_000;
    const id = await startRun();
    // Handed over: the job is on the GPU.
    for (let i = 0; i < 300 && !db().prepare("SELECT external_id FROM generations WHERE id = ?").pluck().get(id); i++) await new Promise((r) => setTimeout(r, 10));
    fake.opts.answer = () => html(502);
    const seen: string[] = [];
    const g = await settle(id, 20_000, seen);
    expect(seen).toContain("Your GPU stopped answering. Waiting for it to come back");
    expect(g?.status).toBe("failed");
    expect(g?.error).toBe("Your GPU stopped answering for 1 minute, so this run stopped. Start it again, then press Retry.");
    expect(kinds(g?.trouble)).toEqual(expect.arrayContaining(["retry", "check-gpu"]));
  });

  it("a GPU that asks to be asked again tomorrow (Retry-After) still stops within the run's own budget", async () => {
    fake.opts.delayMs = 60_000;
    const id = await startRun();
    for (let i = 0; i < 300 && !db().prepare("SELECT external_id FROM generations WHERE id = ?").pluck().get(id); i++) await new Promise((r) => setTimeout(r, 10));
    // Its address now answers every look with "too many requests, ask again in a day".
    fake.opts.answer = () => ({ status: 429, body: "slow down", contentType: "text/plain", headers: { "retry-after": "86400" } });
    const started = Date.now();
    const g = await settle(id, 10_000);
    expect(g?.status).toBe("failed");
    // 15 minutes at this test's clock (1.8 s here at most), never the day it asked for.
    expect(Date.now() - started).toBeLessThan(8_000);
    plainWords(g?.error);
  });

  it("a made result whose copy breaks off is copied again at a later look, the tile saying so, and never made twice", async () => {
    let refused = 0;
    fake.opts.answer = (_m, p) => (p === "/view" && refused++ < 4 ? html(502) : undefined);
    const seen: string[] = [];
    const g = await settle(await startRun(), 20_000, seen);
    expect(g?.status, g?.error ?? "").toBe("succeeded");
    expect(seen).toContain("Your result is made. Copying it from your GPU");
    expect(refused).toBeGreaterThan(4);
    expect(fake.log.filter((e) => e.path === "/prompt")).toHaveLength(1);
  });

  it("the time a file may take to reach the GPU grows with its size", async () => {
    const { ownGpuLimits, uploadDeadlineMs } = await import("@/server/providers/comfyui");
    // Sending a file may take as long as it needs at a slow 128 KB/s, plus a minute: 5 to 30 minutes.
    expect(uploadDeadlineMs(1024)).toBe(5 * 60_000);
    expect(uploadDeadlineMs(80 * 2 ** 20)).toBe(Math.ceil(((80 * 2 ** 20) / (128 * 1024)) * 1000) + 60_000);
    expect(uploadDeadlineMs(10 * 2 ** 30)).toBe(30 * 60_000);
    expect(ownGpuLimits("/upload/image", 80 * 2 ** 20).deadlineMs).toBeGreaterThan(10 * 60_000);
    expect(ownGpuLimits("/system_stats", 80 * 2 ** 20).deadlineMs).toBe(60_000);
  });

  it("a run its GPU lost twice is sent again only once, then says so with Retry", async () => {
    let prompts = 0;
    fake.opts.answer = (m, p) => {
      if (p === "/prompt" && m === "POST") {
        prompts++;
        return undefined;
      }
      // A ComfyUI that forgets every run.
      if (p === "/queue" && m === "GET") return { status: 200, body: JSON.stringify({ queue_running: [], queue_pending: [] }), contentType: "application/json" };
      if (p.startsWith("/history/")) return { status: 200, body: "{}", contentType: "application/json" };
      return undefined;
    };
    const g = await settle(await startRun(), 20_000);
    expect(g?.status).toBe("failed");
    expect(prompts).toBe(2);
    expect(g?.trouble?.cause).toBe("gpu-restarted");
    expect(kinds(g?.trouble)).toContain("retry");
  });

  it("each job of a batch keeps its place (its seed) when it is handed over", async () => {
    const pic = await uploadPng();
    const r = await generationsRoute.POST(json("/api/generations", "POST", { feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "", inputs: { images: [pic] }, params: { numOutputs: 2, seed: 1234 } }));
    expect(r.status).toBe(201);
    const ids = ((await r.json()) as { items: { id: string }[] }).items.map((x) => x.id);
    for (const id of ids) await settle(id);
    const index = (id: string) => (JSON.parse(String(db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(id) ?? "{}")) as { jobIndex?: number }).jobIndex;
    expect(ids.map(index)).toEqual(ids.length === 2 ? [0, 1] : [0]);
  });

  it("a run its GPU lost (ComfyUI restarted) is sent again once, and finishes", async () => {
    let prompts = 0;
    fake.opts.answer = (m, p) => {
      if (p === "/prompt" && m === "POST") {
        prompts++;
        return undefined;
      }
      // Until it is sent again: a ComfyUI that forgot everything.
      if (prompts < 2 && p === "/queue" && m === "GET") return { status: 200, body: JSON.stringify({ queue_running: [], queue_pending: [] }), contentType: "application/json" };
      if (prompts < 2 && p.startsWith("/history/")) return { status: 200, body: "{}", contentType: "application/json" };
      return undefined;
    };
    const seen: string[] = [];
    const g = await settle(await startRun(), 20_000, seen);
    expect(g?.status, g?.error ?? "").toBe("succeeded");
    expect(prompts).toBe(2);
    expect(seen).toContain("Your GPU restarted, so we sent this run again");
  });

  it("a run whose account moved to another address says so", async () => {
    fake.opts.delayMs = 60_000;
    const id = await startRun();
    for (let i = 0; i < 300 && !db().prepare("SELECT external_id FROM generations WHERE id = ?").pluck().get(id); i++) await new Promise((r) => setTimeout(r, 10));
    auth.setAccountGpu(a, { url: `${fake.url}/elsewhere` });
    const g = await settle(id);
    expect(g?.status).toBe("failed");
    expect(g?.error).toBe("This run stopped because your GPU moved to a new address. Press Retry.");
  });

  it("a graph that needs a second ComfyUI is refused before anything is sent", async () => {
    const r = await generationsRoute.POST(json("/api/generations", "POST", { feature: "audio", modelId: "oss-thinksound", prompt: "a door slams" }));
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toBe(ISOLATED_ON_GPU);
  });

  it("the owner's runs, and runs off an account's own GPU, keep their own detail", async () => {
    // The owner's ComfyUI (plain fetch): ComfyUI's own words as before.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return url.endsWith("/upload/image") ? new Response("nope", { status: 500 }) : new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      await expect(comfyProvider.prepareFile(Buffer.from("png"), "image/png", "a.png")).rejects.toThrow(/^ComfyUI upload failed: 500 nope$/);
      // An account's run on this install's GPUs (hosted runs: its tenant, not its own GPU) is the install's as well.
      await expect(runAsTenant({ kind: "account", id: a }, () => comfyProvider.prepareFile(Buffer.from("png"), "image/png", "a.png"))).rejects.toThrow(/^ComfyUI upload failed: 500 nope$/);
    } finally {
      globalThis.fetch = (async () => new Response("not stubbed", { status: 599 })) as typeof fetch;
    }
    // On the account's own GPU: the person's words, with what helps.
    fake.opts.answer = (_m, p) => (p === "/upload/image" ? { status: 404, body: "404 page not found", contentType: "text/plain" } : undefined);
    const e = (await onOwnGpu({ url: fake.url }, () => comfyProvider.prepareFile(Buffer.from("png"), "image/png", "a.png")).catch((x: unknown) => x)) as Error & { trouble?: { cause: string; details?: string } };
    expect(e.message).not.toMatch(/upload failed|404/);
    expect(e.trouble).toMatchObject({ cause: "gpu-not-comfy", details: "your web address · HTTP 404 · 404 page not found" });
    expect(fetched.filter((u) => u.includes("owner-comfy.test") && !u.endsWith("/system_stats"))).toEqual([]);
  });
});

describe("the reported case, end to end: a RunPod pod that is stopped (its address stands for the stand-in)", () => {
  const POD = "https://abc123xyz-8188.proxy.runpod.net";
  /** A stopped pod: RunPod's proxy answers 404 to everything. */
  const stopped = () => ({ status: 404, body: "404 page not found", contentType: "text/plain" });

  it("Save anyway, Generate: the run waits for the pod, says so with Start your pod, and runs once it is started", async () => {
    globalThis.__fuobeTestGpuHosts = { "abc123xyz-8188.proxy.runpod.net": fake.port };
    SELF_HEAL.scale = 0.01;
    auth.setAccountGpu(a, null);
    fake.opts.answer = stopped;
    const kept = await put({ url: "abc123xyz-8188.proxy.runpod.net", anyway: true }, false);
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ offline: true, gpu: { url: POD }, trouble: { cause: "gpu-stopped", details: "RunPod pod, port 8188 · HTTP 404 · 404 page not found" } });
    const id = await startRun();
    for (let i = 0; i < 500 && !getGeneration(id)?.waiting; i++) await new Promise((r) => setTimeout(r, 10));
    expect(getGeneration(id)?.message).toBe("Your RunPod pod is off. Start it, and this run goes on by itself");
    expect(getGeneration(id)?.waiting?.actions[0]).toMatchObject({ kind: "start-gpu" });
    // The pod is started.
    fake.opts.answer = undefined;
    const g = await settle(id, 20_000);
    expect(g?.status, g?.error ?? "").toBe("succeeded");
  });

  it("a pod that stays off: the run stops in plain words with Start your pod first, never the raw 404 or the address", async () => {
    globalThis.__fuobeTestGpuHosts = { "abc123xyz-8188.proxy.runpod.net": fake.port };
    auth.setAccountGpu(a, { url: POD });
    fake.opts.answer = stopped;
    const g = await settle(await startRun());
    expect(g?.status).toBe("failed");
    expect(g?.error).toBe("Your RunPod pod isn't running, or ComfyUI isn't on port 8188. Start your pod, then press Retry.");
    plainWords(g?.error);
    expect(g?.trouble?.details).toBe("RunPod pod, port 8188 · HTTP 404 · 404 page not found");
    expect(kinds(g?.trouble)[0]).toBe("start-gpu");
    expect(JSON.stringify(g)).not.toMatch(/abc123xyz|proxy\.runpod|ComfyUI upload failed/);
  });
});

describe("what the owner learns of an account's failed run on its own GPU", () => {
  it("a GPU disconnected while its job runs: the run stops in plain words, and the owner gets its line", async () => {
    const warn = vi.spyOn(console, "warn");
    fake.opts.delayMs = 60_000;
    try {
      const id = await startRun();
      for (let i = 0; i < 500 && getGeneration(id)?.status !== "running"; i++) {
        await globalThis.__fuobeRunner?.tick();
        await new Promise((r) => setTimeout(r, 10));
      }
      auth.setAccountGpu(a, null);
      const g = await settle(id);
      expect(g?.status).toBe("failed");
      plainWords(g?.error);
      expect(ownRunNote(id)).toMatchObject({ cause: "connect-gpu", stage: "poll" });
      const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"evt":"own-run"') && l.includes(id));
      expect(JSON.parse(line!)).toMatchObject({ run: id, account: a, place: "own-gpu", stage: "poll", cause: "connect-gpu", outcome: "failed" });
    } finally {
      warn.mockRestore();
    }
  });

  it("a longer run broken at its first step: the next step writes the owner's line, the steps after it none", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      fake.opts.answer = (_m, p) => (p === "/upload/image" ? { status: 401, body: "" } : undefined);
      const pic = await uploadPng();
      const first = await startRun();
      const second = laterStep(first, pic);
      const third = laterStep(second, pic);
      expect((await settle(first))?.status).toBe("failed");
      for (const id of [second, third]) expect((await settle(id))?.error).toBe("An earlier step didn't finish");
      const lines = (id: string) => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"evt":"own-run"') && l.includes(`"run":"${id}"`));
      expect(lines(first)).toHaveLength(1);
      expect(lines(second)).toHaveLength(1);
      expect(JSON.parse(lines(second)[0])).toMatchObject({ run: second, stage: "chain", cause: "earlier-step", outcome: "failed" });
      expect(lines(third)).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps at most 2 KB of what the GPU said, counted in bytes, never cutting a character in two", async () => {
    const { keptText } = await import("@/server/run-events");
    const wide = "é".repeat(3000);
    const kept = keptText(wide)!;
    expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(2048);
    expect(kept).toBe("é".repeat(1024));
    const emoji = "a" + "😀".repeat(1000);
    expect(Buffer.byteLength(keptText(emoji)!)).toBeLessThanOrEqual(2048);
    expect(keptText(emoji)).not.toMatch(/�/u);
    expect(keptText("short")).toBe("short");
  });

  it("one log line and a note kept with the run (no address, no token), never in the account's own answers", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      fake.opts.answer = (_m, p) => (p === "/upload/image" ? { status: 401, body: "Unauthorized: token abc123secret from 127.0.0.1", contentType: "text/plain" } : undefined);
      const id = await startRun();
      const g = await settle(id);
      expect(g?.status).toBe("failed");
      const note = ownRunNote(id)!;
      expect(note).toMatchObject({ cause: "gpu-password", stage: "upload", code: "401", hostKind: "web" });
      expect(note.said).toMatch(/^Unauthorized/);
      expect(note.said).not.toMatch(/127\.0\.0\.1|abc123secret/);
      const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"evt":"own-run"') && l.includes(id));
      expect(JSON.parse(line!)).toMatchObject({ evt: "own-run", run: id, account: a, place: "own-gpu", provider: "comfyui", stage: "upload", code: "401", hostKind: "web", cause: "gpu-password", outcome: "failed" });
      expect(line).not.toMatch(/127\.0\.0\.1|localhost|abc123secret|me\.png|Unauthorized/);
      // The account's own answers never carry it.
      const list = await generationsRoute.GET(new Request("http://localhost:3000/api/generations", { headers: headers() }));
      const one = await generationRoute.GET(new Request(`http://localhost:3000/api/generations/${id}`, { headers: headers() }), { params: Promise.resolve({ id }) });
      for (const r of [list, one]) {
        const text = await r.text();
        expect(text).toContain(id);
        expect(text).not.toMatch(/ownRun|Unauthorized|abc123secret|"lease"|"heal"/);
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe("a busy GPU: a queue that keeps moving is waited out", () => {
  const queue = (pos: number) => ({ status: 200, body: JSON.stringify({ queue_running: [[0, "someone-else"]], queue_pending: [...Array.from({ length: pos }, (_, i) => [i + 1, `other-${i}`]), [pos + 1, "job-moving"]] }), contentType: "application/json" });
  const empty = { status: 200, body: "{}", contentType: "application/json" };

  it("waits on while its place moves up, past the queue limit, and finishes", async () => {
    OWN_QUEUE.scale = 0.0003; // 30 minutes: about half a second
    fake.opts.promptId = "job-moving";
    const started = Date.now();
    // Five ahead, one fewer every 200 ms: about a second in the queue, twice the limit, while it moves.
    fake.opts.answer = (m, p) => {
      const ahead = 5 - Math.floor((Date.now() - started) / 200);
      if (ahead < 0) return undefined;
      if (p === "/queue" && m === "GET") return queue(ahead);
      if (p.startsWith("/history/")) return empty;
      return undefined;
    };
    try {
      const g = await settle(await startRun(), 20_000);
      expect(g?.status, g?.error ?? "").toBe("succeeded");
    } finally {
      OWN_QUEUE.scale = 1;
      fake.opts.promptId = undefined;
    }
  });

  it("stops when its place hasn't moved for the limit, saying the GPU was busy", async () => {
    OWN_QUEUE.scale = 0.0003;
    fake.opts.promptId = "job-moving";
    fake.opts.answer = (m, p) => (p === "/queue" && m === "GET" ? queue(3) : p.startsWith("/history/") ? empty : undefined);
    try {
      const g = await settle(await startRun(), 20_000);
      expect(g?.status).toBe("failed");
      expect(g?.error).toMatch(/^Your GPU was busy for 1 minute, so this run stopped\./);
      expect(kinds(g?.trouble)).toEqual(expect.arrayContaining(["retry", "check-gpu"]));
    } finally {
      OWN_QUEUE.scale = 1;
      fake.opts.promptId = undefined;
    }
  });

  it("counts its place by ComfyUI's queue numbers: the list ComfyUI answers isn't in order", async () => {
    expect(queuePlace([[1, "a"], [4, "mine"], [2, "b"], [5, "c"], [3, "d"]], "mine")).toBe(3);
    expect(queuePlace([[7, "mine"], [9, "a"]], "mine")).toBe(0);
    expect(queuePlace([[1, "a"]], "mine")).toBe(-1);
    fake.opts.promptId = "job-heap";
    const heap = { status: 200, body: JSON.stringify({ queue_running: [[0, "someone-else"]], queue_pending: [[1, "a"], [4, "job-heap"], [2, "b"], [5, "c"], [3, "d"]] }), contentType: "application/json" };
    fake.opts.answer = (m, p) => (p === "/queue" && m === "GET" ? heap : p.startsWith("/history/") ? empty : undefined);
    try {
      const id = await startRun();
      for (let i = 0; i < 500 && !/ahead/.test(getGeneration(id)?.message ?? ""); i++) {
        await globalThis.__fuobeRunner?.tick();
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(getGeneration(id)?.message).toBe("In ComfyUI's queue · 3 ahead");
      await cancelGeneration(id);
    } finally {
      fake.opts.promptId = undefined;
    }
  });

  it("next in line behind one long job: waits while that job runs (up to one job's own time), then runs", async () => {
    OWN_QUEUE.scale = 0.001; // the 30 minutes without moving: 1.8 s; one job's 45 minutes: 2.7 s
    fake.opts.promptId = "job-next";
    const started = Date.now();
    // One render runs ahead of it for about 2.3 s (past the 30 minutes), then it is this job's turn.
    fake.opts.answer = (m, p) => {
      if (Date.now() - started > 2300) return undefined;
      if (p === "/queue" && m === "GET") return { status: 200, body: JSON.stringify({ queue_running: [[0, "long-render"]], queue_pending: [[1, "job-next"]] }), contentType: "application/json" };
      if (p.startsWith("/history/")) return empty;
      return undefined;
    };
    try {
      const seen: string[] = [];
      const g = await settle(await startRun(), 20_000, seen);
      expect(g?.status, g?.error ?? "").toBe("succeeded");
      expect(seen).toContain("Next in ComfyUI's queue");
    } finally {
      OWN_QUEUE.scale = 1;
      fake.opts.promptId = undefined;
    }
  });
});

describe("runs that wait, and a file too big for the address", () => {
  it("runs waiting for the GPU don't fill the account's runs at once; a run that takes a waiting one's place stops it", async () => {
    SELF_HEAL.scale = 0.01;
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await startRun());
    for (let i = 0; i < 500 && ids.some((id) => !getGeneration(id)?.waiting); i++) await new Promise((r) => setTimeout(r, 10));
    const pic = await uploadPng();
    const body = { feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "", inputs: { images: [pic] } };
    // A fifth for the GPU: four already wait for it.
    const fifth = await generationsRoute.POST(json("/api/generations", "POST", body));
    expect(fifth.status).toBe(429);
    expect(((await fifth.json()) as { error: string }).error).toBe("You have 4 runs waiting for your GPU. Cancel one, or run one with your key, to start another.");
    // One that takes a waiting run's place (Run with your key on its tile): accepted, and that run stops.
    const instead = await generationsRoute.POST(json("/api/generations", "POST", { ...body, replaces: ids[0] }));
    expect(instead.status, await instead.clone().text()).toBe(201);
    expect(getGeneration(ids[0])?.status).toBe("canceled");
    for (const id of ids) await cancelGeneration(id);
    for (const g of ((await instead.json()) as { items: { id: string }[] }).items) await cancelGeneration(g.id);
  });

  it("a run that takes the place of one tile of a waiting batch takes the batch's place, once, for the jobs not handed over", async () => {
    SELF_HEAL.scale = 0.01;
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    const pic = await uploadPng();
    const body = { feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "", inputs: { images: [pic] }, params: { numOutputs: 3 } };
    const first = await generationsRoute.POST(json("/api/generations", "POST", body));
    expect(first.status, await first.clone().text()).toBe(201);
    const jobs = ((await first.json()) as { items: { id: string }[] }).items.map((g) => g.id);
    expect(jobs).toHaveLength(3);
    for (let i = 0; i < 500 && jobs.some((id) => !getGeneration(id)?.waiting); i++) await new Promise((r) => setTimeout(r, 10));
    // One of its jobs reached the GPU meanwhile: it goes on there, and isn't made a second time.
    db().prepare("UPDATE generations SET external_id = 'kept-job', status = 'running', external_meta_json = '{}' WHERE id = ?").run(jobs[2]);
    const instead = await generationsRoute.POST(json("/api/generations", "POST", { ...body, replaces: jobs[0] }));
    expect(instead.status, await instead.clone().text()).toBe(201);
    const made = ((await instead.json()) as { items: { id: string }[] }).items.map((g) => g.id);
    // The two jobs that hadn't started: two outputs, never the batch's three again.
    expect(made).toHaveLength(2);
    expect(getGeneration(jobs[0])?.status).toBe("canceled");
    expect(getGeneration(jobs[1])?.status).toBe("canceled");
    expect(getGeneration(jobs[2])?.status).toBe("running");
    // The same button on the batch's other waiting tile, pressed a moment later: nothing new runs.
    const again = await generationsRoute.POST(json("/api/generations", "POST", { ...body, replaces: jobs[1] }));
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("This run has already started or stopped, so nothing new was run.");
    for (const id of [...jobs, ...made]) await cancelGeneration(id);
  });

  it("Run with your key on a waiting step of a longer run: refused in plain words, and the whole run goes on as it was", async () => {
    SELF_HEAL.scale = 0.01;
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    const first = await startRun();
    for (let i = 0; i < 500 && !getGeneration(first)?.waiting; i++) await new Promise((r) => setTimeout(r, 10));
    const pic = await uploadPng();
    const second = laterStep(first, pic);
    const made = db().prepare("SELECT COUNT(*) FROM generations").pluck().get();
    const body = { feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", engine: "cloud", prompt: "", inputs: { images: [pic] } };
    // The step that waits, and the one that waits for it: neither moves alone.
    for (const id of [first, second]) {
      const r = await generationsRoute.POST(json("/api/generations", "POST", { ...body, replaces: id }));
      expect(r.status).toBe(409);
      const said = (await r.json()) as { error: string; code: string };
      expect(said).toEqual({ error: CHAINED_RUN, code: "chained-run" });
      plainWords(said.error);
    }
    expect(CHAINED_RUN).toBe("This step is part of a longer run, so it can't move to your key on its own. It goes on by itself, or cancel it and run the tool again with your key.");
    // Nothing stopped and nothing new was made: the first step still waits, the second still waits for it.
    expect(getGeneration(first)).toMatchObject({ status: "queued", waiting: expect.anything() });
    expect(getGeneration(second)?.status).toBe("queued");
    expect(db().prepare("SELECT COUNT(*) FROM generations").pluck().get()).toBe(made);
    for (const id of [first, second]) await cancelGeneration(id);
  });

  it("a file the address refuses as too big: Send a smaller copy makes one, and the run made again with it runs", async () => {
    // A big picture (noise: it doesn't shrink as a PNG).
    const sharp = (await import("sharp")).default;
    const noise = (await import("node:crypto")).randomBytes(2400 * 2400 * 3);
    const big = await sharp(noise, { raw: { width: 2400, height: 2400, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
    const up = await uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: headers({ "content-type": "image/png", "x-file-name": "big.png", "content-length": String(big.length) }), body: big }));
    expect(up.status, await up.clone().text()).toBe(201);
    const pic = ((await up.json()) as { url: string }).url;
    // The tunnel's own size limit: its web page, 413.
    fake.opts.answer = (_m, p) => (p === "/upload/image" ? { status: 413, body: "<html><title>413 Request Entity Too Large</title></html>", contentType: "text/html" } : undefined);
    const r = await generationsRoute.POST(json("/api/generations", "POST", { feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "", inputs: { images: [pic] } }));
    const id = ((await r.json()) as { items: { id: string }[] }).items[0].id;
    const g = await settle(id);
    expect(g?.trouble?.cause).toBe("gpu-too-big");
    expect(g?.trouble?.actions[0]).toMatchObject({ kind: "send-smaller", label: "Send a smaller copy" });
    // The proxy lets the account ask for its own run's copy, and nobody else's.
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    const via = (who: string) => proxy(new NextRequest(`http://localhost:3000/api/generations/${id}/smaller`, { method: "POST", headers: { cookie: who, host: "localhost:3000" } }));
    expect(via(cookie).headers.get("x-middleware-next")).toBe("1");
    const other = auth.createAccount("graceful-other@example.com", "long enough").id;
    expect(via(`${auth.SESSION_COOKIE}=${auth.createSession(other).value}`).status).toBe(403);
    const smaller = await smallerRoute.POST(new Request(`http://localhost:3000/api/generations/${id}/smaller`, { method: "POST", headers: headers() }), { params: Promise.resolve({ id }) });
    expect(smaller.status, await smaller.clone().text()).toBe(200);
    const made = (await smaller.json()) as { request: { inputs: { images: string[] } }; note: string };
    expect(made.note).toMatch(/^Sent a smaller copy \(\d+ MB\)\.$/);
    expect(made.request.inputs.images[0]).not.toBe(pic);
    fake.opts.answer = undefined;
    const again = await generationsRoute.POST(json("/api/generations", "POST", made.request));
    expect(again.status, await again.clone().text()).toBe(201);
    expect((await settle(((await again.json()) as { items: { id: string }[] }).items[0].id))?.status).toBe("succeeded");
    const sentBytes = fake.log.filter((e) => e.path === "/upload/image").at(-1)?.upload?.length ?? 0;
    expect(sentBytes).toBeGreaterThan(0);
    expect(sentBytes).toBeLessThan(big.length * 0.8);

    // A copy is real work: one at a time for an account, a few at once on the server, a few an hour for a run.
    const ask = async () => {
      const r = await smallerRoute.POST(new Request(`http://localhost:3000/api/generations/${id}/smaller`, { method: "POST", headers: headers() }), { params: Promise.resolve({ id }) });
      return { status: r.status, error: ((await r.json()) as { error?: string }).error };
    };
    globalThis.__fuobeSmallerCopies = { total: 1, accounts: new Set([a]) };
    expect(await ask()).toEqual({ status: 429, error: "Your last smaller copy is still being made. Try again once it's done." });
    globalThis.__fuobeSmallerCopies = { total: 2, accounts: new Set(["someone-else", "another"]) };
    expect(await ask()).toEqual({ status: 429, error: "Smaller copies are busy right now. Try again in a minute." });
    globalThis.__fuobeSmallerCopies = undefined;
    // Files that are full say so before any copy is made.
    const { ACCOUNT_LIMITS } = await import("@/server/account-files");
    const limits = ACCOUNT_LIMITS as { newAccountBytes: number };
    const was = limits.newAccountBytes;
    limits.newAccountBytes = 1;
    try {
      expect(await ask()).toEqual({ status: 422, error: "Your files are full, so a smaller copy can't be kept. Delete a few results, then try again." });
    } finally {
      limits.newAccountBytes = was;
    }
    // Three for this run this hour (the busy answers aren't counted, the full one is), then none.
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(429);
    expect((await ask()).error).toMatch(/^You've made a few smaller copies already\. Try again in \d+ minutes?\.$/);
  });
});

describe("a step of a longer run that waited, taken over after a restart", () => {
  /** The run's first step, done on the GPU, with a picture for the next step to start from. */
  async function firstStepDone(): Promise<{ first: string; pic: string }> {
    fake.opts.output = "both";
    const first = await startRun();
    expect((await settle(first))?.status).toBe("succeeded");
    return { first, pic: await uploadPng() };
  }

  it("goes on with what is left of its wait (its tries and its time), and runs once", async () => {
    const info = vi.spyOn(console, "info");
    try {
      const { first, pic } = await firstStepDone();
      fake.log.length = 0;
      const second = laterStep(first, pic);
      // It waited for the GPU in an app process that has stopped (its turn is free): seven tries, two minutes.
      const since = Date.now() - 2 * 60_000;
      setPending(second, {
        heal: { since, deadline: Date.now() + 60_000, firstSeen: { "gpu-starting": since }, tries: 7, next: 0, index: 0, words: "Waiting for your GPU to start up", trouble: { cause: "gpu-starting", actions: [] } },
      });
      heldByStopped(second);
      const g = await settle(second, 20_000);
      expect(g?.status, g?.error ?? "").toBe("succeeded");
      expect(fake.log.filter((e) => e.path === "/prompt")).toHaveLength(1);
      // Healed on its seventh try, its wait counted from when it began.
      const healed = info.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('"evt":"own-run"') && l.includes(`"run":"${second}"`) && l.includes('"outcome":"healed"'))
        .map((l) => JSON.parse(l) as { attempt: number; waitedMs: number });
      expect(healed).toHaveLength(1);
      expect(healed[0].attempt).toBe(7);
      expect(healed[0].waitedMs).toBeGreaterThanOrEqual(2 * 60_000);
    } finally {
      info.mockRestore();
      fake.opts.output = undefined;
    }
  });

  it("one cut off in the middle of its send is never sent again, and the owner gets its line", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      const { first, pic } = await firstStepDone();
      fake.log.length = 0;
      const second = laterStep(first, pic);
      setPending(second, { heal: { since: Date.now() - 60_000, deadline: Date.now() + 60_000, firstSeen: {}, tries: 2, next: 0, index: 0, sending: Date.now() - 1000 } });
      heldByStopped(second);
      const g = await settle(second);
      expect(g?.status).toBe("failed");
      expect(g?.error).toBe("This run was interrupted while it was being sent. Press Retry.");
      expect(fake.log.filter((e) => e.path === "/prompt" || e.path === "/upload/image")).toHaveLength(0);
      expect(ownRunNote(second)).toMatchObject({ cause: "interrupted-sending", stage: "chain", hostKind: "web" });
      const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"evt":"own-run"') && l.includes(second));
      expect(JSON.parse(line!)).toMatchObject({ run: second, account: a, place: "own-gpu", cause: "interrupted-sending", outcome: "failed" });
    } finally {
      warn.mockRestore();
      fake.opts.output = undefined;
    }
  });

  it("one cut off in the middle of its first send (it never waited) is never sent again either", async () => {
    try {
      const { first, pic } = await firstStepDone();
      // Its first try: marked as being sent just before its job goes, with no wait of its own.
      fake.log.length = 0;
      fake.opts.hold = (m, p) => m === "POST" && p === "/prompt";
      const sending = laterStep(first, pic);
      for (let i = 0; i < 1000 && !fake.log.some((e) => e.path === "/prompt"); i++) {
        await globalThis.__fuobeRunner?.tick();
        await new Promise((r) => setTimeout(r, 10));
      }
      const meta = JSON.parse(String(db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(sending))) as { sending?: unknown; heal?: unknown };
      expect(typeof meta.sending).toBe("number");
      expect(meta.heal).toBeUndefined();
      await cancelGeneration(sending);
      fake.opts.hold = undefined;
      fake.dropHeld();
      // The next app process finds such a step once the cut-off one has gone quiet: it fails, and nothing is sent.
      fake.log.length = 0;
      const second = laterStep(first, pic);
      setPending(second, { sending: Date.now() - 1000 });
      heldByStopped(second);
      const g = await settle(second);
      expect(g?.status).toBe("failed");
      expect(g?.error).toBe("This run was interrupted while it was being sent. Press Retry.");
      expect(fake.log.filter((e) => e.path === "/prompt" || e.path === "/upload/image")).toHaveLength(0);
      expect(ownRunNote(second)).toMatchObject({ cause: "interrupted-sending", stage: "chain" });
    } finally {
      fake.opts.hold = undefined;
      fake.dropHeld();
      fake.opts.output = undefined;
    }
  });
});

/**
 * The app process stops (its timers, its runs in hand, its beat, its name), and a new one starts on the same database:
 * the runner's module loaded again, with the faster clocks.
 */
async function newInstance() {
  const old = globalThis.__fuobeRunner;
  if (old) {
    clearInterval(old.timer);
    if (old.fastTimer) clearInterval(old.fastTimer);
  }
  globalThis.__fuobeRunner = undefined;
  if (globalThis.__fuobeBeat) clearInterval(globalThis.__fuobeBeat);
  globalThis.__fuobeBeat = undefined;
  globalThis.__fuobeSubmitting = new Set();
  globalThis.__fuobeRunnerToken = undefined;
  globalThis.__fuobeResent = undefined;
  vi.resetModules();
  const fresh = await import("@/server/generations");
  fresh.SELF_HEAL.scale = 0.01;
  fresh.STALE_SUBMIT.ms = 0;
  return fresh;
}

// Last: the server's own state is replaced here (a new instance of the runner's module on the same database).
describe("a wait survives a restart or a deploy", () => {
  it("another instance's look while this one holds a waiting run leaves it alone", async () => {
    SELF_HEAL.scale = 0.01;
    STALE_SUBMIT.ms = 0;
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    try {
      const id = await startRun();
      for (let i = 0; i < 500 && !getGeneration(id)?.waiting; i++) await new Promise((r) => setTimeout(r, 10));
      // This app process holds the turn to send it while it waits (tests/own-run-turns.test.ts has a second process look).
      expect(turnOf(id)).toBe(globalThis.__fuobeRunnerToken);
      // Another instance's sweep: its own (empty) list of runs in hand, the same database.
      const mine = globalThis.__fuobeSubmitting;
      globalThis.__fuobeSubmitting = new Set();
      await globalThis.__fuobeRunner?.tick();
      globalThis.__fuobeSubmitting = mine;
      expect(getGeneration(id)?.status).toBe("queued");
      expect(turnOf(id)).toBe(globalThis.__fuobeRunnerToken);
      fake.opts.answer = undefined;
      const g = await settle(id, 20_000);
      expect(g?.status, g?.error ?? "").toBe("succeeded");
    } finally {
      STALE_SUBMIT.ms = 2 * 60_000;
    }
  });

  it("a waiting run another instance takes over is never sent to a provider other than the one it was made for", async () => {
    SELF_HEAL.scale = 0.01;
    STALE_SUBMIT.ms = 0;
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    const shut = (globalThis.__fuobeShutdown ??= { stops: new Set(), draining: false, hooked: false });
    try {
      const id = await startRun();
      for (let i = 0; i < 500 && !getGeneration(id)?.waiting; i++) await new Promise((r) => setTimeout(r, 10));
      // This instance stops waiting on it (as when it stops), and the run's row says another provider made it.
      shut.draining = true;
      for (let i = 0; i < 500 && globalThis.__fuobeSubmitting?.has(id); i++) await new Promise((r) => setTimeout(r, 10));
      shut.draining = false;
      db().prepare("UPDATE generations SET provider = 'fal' WHERE id = ?").run(id);
      fake.opts.answer = undefined;
      fake.log.length = 0;
      const g = await settle(id, 5_000);
      expect(g?.status).toBe("failed");
      expect(g?.error).toBe("This run stopped because your keys changed while it waited. Press Retry.");
      expect(fake.log.filter((e) => e.path === "/prompt" || e.path === "/upload/image")).toHaveLength(0);
      expect(ownRunNote(id)).toMatchObject({ cause: "keys-changed", stage: "submit" });
    } finally {
      shut.draining = false;
      STALE_SUBMIT.ms = 2 * 60_000;
    }
  });

  it("so is a step of a longer run that waited: planned for another provider after a restart, it stops, and nothing is sent", async () => {
    fake.opts.output = "both";
    const gone = () => ({ by: "gone", until: Date.now() - 1 });
    const waited = (words: string) => ({ since: Date.now() - 60_000, deadline: Date.now() + 60_000, firstSeen: {}, tries: 3, next: 0, index: 0, words });
    /** A later step of the run `first` on the account's keys: a still from its frame. */
    const onKeys = (first: string) => asAccount(a, () => createGenerations({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "the same look at night" }, { dependsOn: first }))[0].id;
    try {
      const first = await startRun();
      expect((await settle(first))?.status).toBe("succeeded");
      // Made for its fal.ai key (it has a Replicate key too), which it waited for on an instance that is gone. Meanwhile
      // the account removed that key: the next instance would plan it on Replicate, which nobody pressed Run for.
      saveAccountKey(a, "fal", "acct-fal-graceful");
      saveAccountKey(a, "replicate", "acct-rep-graceful");
      const second = onKeys(first);
      expect(getGeneration(second)?.provider).toBe("fal");
      setPending(second, { heal: waited("Waiting for fal.ai"), lease: gone() });
      removeAccountKey(a, "fal");
      fake.log.length = 0;
      fetched.length = 0;
      const g = await settle(second);
      expect(g?.status).toBe("failed");
      expect(g?.error).toBe("This run stopped because your keys changed while it waited. Press Retry.");
      expect(fetched.filter((u) => /fal\.(ai|run|media)|replicate\.com/.test(u))).toEqual([]);
      expect(getGeneration(second)?.provider).toBe("fal");
      expect(ownRunNote(second)).toMatchObject({ cause: "keys-changed", stage: "chain" });
      // One made for its GPU (the row says so), planned on its key now that the account disconnected that GPU: it stops,
      // saying so, and its key is never used.
      saveAccountKey(a, "fal", "acct-fal-graceful");
      const third = onKeys(first);
      db().prepare("UPDATE generations SET provider = 'comfyui' WHERE id = ?").run(third);
      setPending(third, { heal: { ...waited("Waiting for your GPU"), firstSeen: { "gpu-off": Date.now() - 60_000 } }, lease: gone() });
      auth.setAccountGpu(a, null);
      fake.log.length = 0;
      fetched.length = 0;
      const h = await settle(third);
      expect(h?.status).toBe("failed");
      expect(h?.error).toBe("You disconnected your GPU, so this run stopped. Connect it again, then press Retry.");
      expect(h?.trouble?.actions[0]).toMatchObject({ kind: "gpu-settings", label: "Connect your GPU" });
      expect(fake.log.filter((e) => e.path === "/prompt" || e.path === "/upload/image")).toHaveLength(0);
      expect(fetched.filter((u) => /fal\.(ai|run|media)|replicate\.com/.test(u))).toEqual([]);
      expect(ownRunNote(third)).toMatchObject({ cause: "gpu-moved", stage: "chain" });
    } finally {
      removeAccountKey(a, "fal");
      removeAccountKey(a, "replicate");
      fake.opts.output = undefined;
    }
  });

  it("a deploy's old instance hands its waiting run to the new one, which goes on with it and runs it once", async () => {
    SELF_HEAL.scale = 0.01;
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    const id = await startRun();
    for (let i = 0; i < 500 && !getGeneration(id)?.waiting; i++) await new Promise((r) => setTimeout(r, 10));
    expect(getGeneration(id)?.message).toBe("Waiting for your GPU to start up");
    // The old instance starts stopping: its wait lets go of the run, without failing it.
    const shut = (globalThis.__fuobeShutdown ??= { stops: new Set(), draining: false, hooked: false });
    shut.draining = true;
    for (let i = 0; i < 500 && globalThis.__fuobeSubmitting?.has(id); i++) await new Promise((r) => setTimeout(r, 10));
    expect(globalThis.__fuobeSubmitting?.has(id)).toBe(false);
    expect(getGeneration(id)?.status).toBe("queued");
    // It gave its turn back at once (the new instance needn't wait for it to go quiet), and kept the wait.
    expect(turnOf(id)).toBeNull();
    const kept = JSON.parse(String(db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(id))) as { heal?: unknown };
    expect(kept.heal).toBeTruthy();
    // It is gone. A new instance starts on the same database; the GPU is back.
    shut.draining = false;
    const fresh = await newInstance();
    fake.opts.answer = undefined;
    fake.log.length = 0;
    fresh.ensureRunner();
    const g = await settle(id, 20_000);
    expect(g?.status, g?.error ?? "").toBe("succeeded");
    expect(g?.error ?? "").not.toMatch(/stopped before it started/);
    expect(fake.log.filter((e) => e.path === "/prompt")).toHaveLength(1);
  });

  it("an instance cut off while it sends a run that waited: the next one never sends it a second time", async () => {
    // The module the runner runs now (the test above started another instance of it): its knobs and the first one's.
    const now = await import("@/server/generations");
    for (const m of [{ SELF_HEAL, STALE_SUBMIT }, now]) {
      m.SELF_HEAL.scale = 0.01;
      m.STALE_SUBMIT.ms = 0;
    }
    fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined);
    const id = await startRun();
    for (let i = 0; i < 500 && !getGeneration(id)?.waiting; i++) await new Promise((r) => setTimeout(r, 10));
    expect(getGeneration(id)?.waiting).toBeTruthy();
    // The GPU is back: the run's next try sends its job, and the GPU takes it; the answer never comes back to this
    // instance, which is cut off (a restart, a deploy's old instance) before it can note the job.
    fake.log.length = 0;
    fake.opts.hold = (m, p) => m === "POST" && p === "/prompt";
    fake.opts.answer = undefined;
    for (let i = 0; i < 1000 && !fake.log.some((e) => e.path === "/prompt"); i++) await new Promise((r) => setTimeout(r, 10));
    expect(fake.log.filter((e) => e.path === "/prompt")).toHaveLength(1);
    const meta = JSON.parse(String(db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(id))) as { heal?: { sending?: number } };
    expect(typeof meta.heal?.sending).toBe("number");
    // The instance is cut off (killed: it says nothing more, and its turn stays where it was). A new one starts.
    const cut = globalThis.__fuobeRunnerToken;
    expect(turnOf(id)).toBe(cut);
    const next = await newInstance();
    try {
      next.ensureRunner();
      // While the cut-off one may still be running (not yet quiet for 20 s), the run is left to it.
      await globalThis.__fuobeRunner?.tick();
      expect(getGeneration(id)?.status).toBe("queued");
      // 20 s with no word from it: the next instance's look.
      db().prepare("UPDATE app_processes SET seen_at = ? WHERE token = ?").run(Date.now() - QUIET_MS - 1000, cut);
      const g = await settle(id, 10_000);
      expect(g?.status).toBe("failed");
      expect(g?.error).toBe("This run was interrupted while it was being sent. Press Retry.");
      // The owner's note says why: a server cut off in the middle of the send.
      expect(ownRunNote(id)).toMatchObject({ cause: "interrupted-sending", stage: "submit" });
      // Exactly one job across both instances, also once the first instance's send ends.
      expect(fake.log.filter((e) => e.path === "/prompt")).toHaveLength(1);
      fake.dropHeld();
      await new Promise((r) => setTimeout(r, 200));
      await settle(id, 1_000);
      expect(fake.log.filter((e) => e.path === "/prompt")).toHaveLength(1);
      expect(getGeneration(id)?.status).toBe("failed");
    } finally {
      fake.opts.hold = undefined;
      fake.dropHeld();
    }
  });
});
