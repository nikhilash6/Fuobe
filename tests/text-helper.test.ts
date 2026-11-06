/**
 * The free text helper (src/server/text-helper.ts): text jobs wait in their own line for the workers' text slots, people's
 * jobs first; only the slot that claimed a job (with its lease) answers it; a job nobody takes in time ends as busy; a
 * visitor's calls have their own limits. Then the AI helper's order (Claude → a local model → the free helper) and the
 * lyrics route for the owner, an account and a guest. A stand-in slot answers here: no model, no GPU.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-text-helper-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_MODERATION_URL;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const pool = await import("@/server/computer/pool");
const helper = await import("@/server/text-helper");
const { llmTextBackend, llmText } = await import("@/server/enhance");
const { runAsTenant } = await import("@/server/tenant");
const enhanceRoute = await import("@/app/api/enhance/route");
const claimRoute = await import("@/app/api/gpu/computer/text/claim/route");
const resultRoute = await import("@/app/api/gpu/computer/text/[id]/route");
const { proxy } = await import("@/proxy");

type WorkerRow = import("@/server/computer/workers").WorkerRow;
type W = { id: string; token: string };
const workerRow = (w: { id: string }) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow;
const jobs = () => db().prepare("SELECT id, state FROM helper_jobs").all() as { id: string; state: string }[];

/** A worker the owner added and resumed, all day, that beat just now. */
function addWorker(): W {
  const w = pool.addWorker(`pc-${Math.random().toString(36).slice(2, 8)}`);
  pool.patchWorker(w.id, { paused: false, hours: { always: true } });
  beat(w);
  return w;
}
const beat = (w: W) =>
  pool.workerBeat(workerRow(w), pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 3, version: "1", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [] }));

/** The next job this worker's text slot gets, waiting for one to come (at most `ms`). */
async function nextJob(w: W, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const job = helper.claimHelperJob(workerRow(w), { model: "test", device: "gpu" });
    if (job || Date.now() > end) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A stand-in text slot: it answers every job it gets with `answer(job)`, until stopped. */
function standIn(w: W, answer: (job: NonNullable<Awaited<ReturnType<typeof nextJob>>>) => string) {
  let on = true;
  const seen: string[] = [];
  const done = (async () => {
    while (on) {
      const job = helper.claimHelperJob(workerRow(w), { model: "test", device: "gpu" });
      if (job) {
        seen.push(job.task);
        helper.finishHelperJob(workerRow(w), job.id, { lease: job.lease, text: answer(job) });
      } else await new Promise((r) => setTimeout(r, 25));
    }
  })();
  return {
    seen,
    stop: async () => {
      on = false;
      await done;
    },
  };
}

const cookies: Record<string, string> = {};
let account = "";
beforeAll(() => {
  auth.setPassword("install password");
  account = auth.createAccount("helper@example.com", "long enough").id;
  cookies.account = `${auth.SESSION_COOKIE}=${auth.createSession(account).value}`;
  cookies.owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  // No local model answers here (Ollama's address goes nowhere), and Automatic has no Claude key.
  setSetting("ollamaUrl", "http://127.0.0.1:9");
});
beforeEach(() => {
  resetRates();
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("DELETE FROM helper_jobs").run();
  db().prepare("DELETE FROM helper_slots").run();
  setSetting("enhanceProvider", "auto");
});
afterEach(() => {
  delete process.env.FUOBE_HOSTED_RUNS;
});

const post = (url: string, body: unknown, who?: string, extra: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${url}`, { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", ...(who && { cookie: cookies[who] }), ...extra }, body: JSON.stringify(body) });
const viaProxy = (url: string, who?: string) =>
  proxy(new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", ...(who && { cookie: cookies[who] }) }, body: "{}" }));
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";

describe("the text slots' line", () => {
  it("a job waits for a text slot, which answers it with its lease; the words come back once and the row goes", async () => {
    const w = addWorker();
    expect(helper.helperLive()).toBe(false);
    expect(helper.claimHelperJob(workerRow(w))).toBeNull();
    expect(helper.helperLive()).toBe(true);
    const asked = helper.askHelper({ task: "lyrics", system: "Write lyrics.", user: "A song about rain" });
    const job = await nextJob(w);
    expect(job).toMatchObject({ task: "lyrics", system: "Write lyrics.", user: "A song about rain", maxTokens: 1200, json: false });
    expect(helper.finishHelperJob(workerRow(w), job!.id, { lease: "not its lease", text: "no" })).toBe(false);
    expect(helper.finishHelperJob(workerRow(w), job!.id, { lease: job!.lease, text: "<think>hmm</think>\n[Verse]\nRain on the glass" })).toBe(true);
    expect(await asked).toEqual({ text: "[Verse]\nRain on the glass" });
    expect(jobs()).toEqual([]);
    // Answered once: the same lease again finds nothing.
    expect(helper.finishHelperJob(workerRow(w), job!.id, { lease: job!.lease, text: "again" })).toBe(false);
  });

  it("people's jobs go before the owner's, and another worker can't answer a job it didn't take", async () => {
    const w = addWorker();
    const other = addWorker();
    helper.claimHelperJob(workerRow(w));
    const owner = helper.askHelper({ task: "enhance", system: "s", user: "owner's", waitMs: 5000 });
    await new Promise((r) => setTimeout(r, 10));
    const person = runAsTenant({ kind: "account", id: account }, () => helper.askHelper({ task: "enhance", system: "s", user: "account's", waitMs: 5000 }));
    await new Promise((r) => setTimeout(r, 10));
    const first = await nextJob(w);
    expect(first?.user).toBe("account's");
    expect(helper.finishHelperJob(workerRow(other), first!.id, { lease: first!.lease, text: "x" })).toBe(false);
    helper.finishHelperJob(workerRow(w), first!.id, { lease: first!.lease, text: "for the account" });
    const second = await nextJob(w);
    expect(second?.user).toBe("owner's");
    helper.finishHelperJob(workerRow(w), second!.id, { lease: second!.lease, error: "llama-server answered 500" });
    expect(await person).toEqual({ text: "for the account" });
    expect(await owner).toEqual({ error: "failed" });
  });

  it("a job nobody takes in time ends as busy, and a slot that comes late gets nothing", async () => {
    const w = addWorker();
    helper.claimHelperJob(workerRow(w));
    expect(await helper.askHelper({ task: "soul", system: "s", user: "u", waitMs: 300 })).toEqual({ error: "busy" });
    expect(helper.claimHelperJob(workerRow(w))).toBeNull();
    expect(jobs()).toEqual([]);
  });

  it("no live slot: busy at once; a worker paused on the website, draining or silent takes nothing", async () => {
    expect(await helper.askHelper({ task: "lyrics", system: "s", user: "u" })).toEqual({ error: "busy" });
    const w = addWorker();
    helper.claimHelperJob(workerRow(w));
    pool.patchWorker(w.id, { paused: true });
    expect(helper.helperLive()).toBe(false);
    pool.patchWorker(w.id, { paused: false });
    expect(helper.helperLive()).toBe(true);
    db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(Date.now() - 60_000, w.id);
    expect(helper.helperLive()).toBe(false);
    beat(w);
    pool.patchWorker(w.id, { drain: true });
    expect(helper.textEligible(workerRow(w))).toBe(false);
  });

  it("a visitor's calls have limits: a minute's and its waiting jobs; a run's own steps aren't counted", async () => {
    const w = addWorker();
    helper.claimHelperJob(workerRow(w));
    const who = "guest:203.0.113.9";
    for (let i = 0; i < helper.HELPER_LIMITS.guest.perMinute; i++) expect(await helper.askHelper({ task: "enhance", system: "s", user: "u", who, waitMs: 30 })).toEqual({ error: "busy" });
    expect(await helper.askHelper({ task: "enhance", system: "s", user: "u", who, waitMs: 30 })).toMatchObject({ error: "limit" });
    expect(await helper.askHelper({ task: "write", system: "s", user: "u", who, waitMs: 30, counted: false })).toEqual({ error: "busy" });
    // Two of its own jobs waiting at once, at most.
    resetRates();
    const a = helper.askHelper({ task: "enhance", system: "s", user: "1", who, waitMs: 400 });
    const b = helper.askHelper({ task: "enhance", system: "s", user: "2", who, waitMs: 400 });
    await new Promise((r) => setTimeout(r, 20));
    expect(await helper.askHelper({ task: "enhance", system: "s", user: "3", who, waitMs: 400 })).toEqual({ error: "busy" });
    await Promise.all([a, b]);
  });
});

describe("the text slot's routes", () => {
  const auth_ = (w: W) => ({ authorization: `Bearer ${w.token}` });

  it("a shared worker's slot claims (204 when nothing comes) and answers with its lease; a browser can't", async () => {
    const w = addWorker();
    const none = await claimRoute.POST(post("/api/gpu/computer/text/claim", { model: "nemotron", device: "gpu", wait: 0 }, undefined, auth_(w)));
    expect(none.status).toBe(204);
    const asked = helper.askHelper({ task: "lyrics", system: "s", user: "song" });
    const r = await claimRoute.POST(post("/api/gpu/computer/text/claim", { model: "nemotron", device: "gpu", wait: 5000 }, undefined, auth_(w)));
    expect(r.status).toBe(200);
    const { job } = (await r.json()) as { job: { id: string; lease: string; user: string } };
    expect(job.user).toBe("song");
    const ctx = { params: Promise.resolve({ id: job.id }) } as never;
    expect((await resultRoute.POST(post(`/api/gpu/computer/text/${job.id}`, { lease: "x", text: "no" }, undefined, auth_(w)), ctx)).status).toBe(409);
    expect((await resultRoute.POST(post(`/api/gpu/computer/text/${job.id}`, { lease: job.lease, text: "[Chorus]\nla" }, undefined, auth_(w)), ctx)).status).toBe(200);
    expect(await asked).toEqual({ text: "[Chorus]\nla" });
    const browser = await claimRoute.POST(post("/api/gpu/computer/text/claim", { wait: 0 }, "owner", { "sec-fetch-site": "same-origin", origin: "http://localhost:3000" }));
    expect(browser.status).not.toBe(200);
    expect(browser.status).not.toBe(204);
  });
});

describe("the AI helper's order and the lyrics route", () => {
  it("a visitor gets the free helper only for a task it takes, and only while hosted runs are on", () => {
    const w = addWorker();
    helper.claimHelperJob(workerRow(w));
    runAsTenant({ kind: "account", id: account }, () => {
      expect(llmTextBackend()).toBeNull();
      expect(llmTextBackend("lyrics")).toBeNull();
      process.env.FUOBE_HOSTED_RUNS = "1";
      expect(llmTextBackend("lyrics")).toBe("free");
      expect(llmTextBackend()).toBeNull();
    });
    // The owner: Automatic still says Claude or a local model first; "free" picks it.
    expect(llmTextBackend("lyrics")).toBe("ollama");
    setSetting("enhanceProvider", "free");
    expect(llmTextBackend("lyrics")).toBe("free");
    setSetting("enhanceProvider", "none");
    expect(llmTextBackend("lyrics")).toBeNull();
  });

  it("Automatic with no local model answering: the free helper writes; without a task, nothing does", async () => {
    const w = addWorker();
    const slot = standIn(w, () => "A rich rewrite");
    expect(await llmText("s", "u", { task: "enhance" })).toBe("A rich rewrite");
    expect(await llmText("s", "u")).toBeNull();
    await slot.stop();
  });

  it("lyrics: a guest and an account get them from the free helper while hosted runs are on", async () => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    const w = addWorker();
    const slot = standIn(w, (job) => (job.task === "lyrics" ? "[verse] Neon rain\n[chorus] Hold on" : "?"));
    expect(passed(await viaProxy("/api/enhance"))).toBe(true);
    expect(passed(await viaProxy("/api/enhance", "account"))).toBe(true);
    for (const who of [undefined, "account"]) {
      const r = await enhanceRoute.POST(post("/api/enhance", { prompt: "A synthwave song about rain", target: "lyrics", seconds: 30 }, who));
      expect(r.status).toBe(200);
      expect(((await r.json()) as { lyrics: string }).lyrics).toBe("[Verse]\nNeon rain\n\n[Chorus]\nHold on");
    }
    const rewrite = await enhanceRoute.POST(post("/api/enhance", { prompt: "a cat", kind: "image", op: "t2i" }));
    expect(((await rewrite.json()) as { prompt: string }).prompt).toBe("?");
    expect(slot.seen).toEqual(["lyrics", "lyrics", "enhance"]);
    await slot.stop();
  });

  it("never a dead end: busy words for a visitor, the way to set one up for the owner, and the proxy without hosted runs", async () => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    const busy = await enhanceRoute.POST(post("/api/enhance", { prompt: "a song", target: "lyrics" }));
    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({ error: "Writing lyrics is busy right now. Try again in a moment, or type your own.", code: "helper-busy" });
    // A rewrite always comes back: the offline one when the helper is busy.
    const rewrite = await enhanceRoute.POST(post("/api/enhance", { prompt: "a cat" }, "account"));
    expect(((await rewrite.json()) as { prompt: string }).prompt).toMatch(/^a cat\. /);
    const owner = await enhanceRoute.POST(post("/api/enhance", { prompt: "a song", target: "lyrics" }, "owner"));
    expect(owner.status).toBe(503);
    expect(await owner.json()).toMatchObject({ code: "no-llm", error: expect.stringContaining("Settings → AI helper") });
    delete process.env.FUOBE_HOSTED_RUNS;
    const off = await viaProxy("/api/enhance");
    expect(passed(off)).toBe(false);
    expect(off.status).toBe(403);
  });
});
