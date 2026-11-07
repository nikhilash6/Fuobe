/**
 * The free text helper (src/server/text-helper.ts): text jobs wait in their own line for the workers' text slots, people's
 * jobs first; only the slot that claimed a job (with its lease) answers it; a job nobody takes in time ends as busy; a
 * visitor's calls have their own limits. Then the AI helper's order (Claude → a local model → the free helper) and the
 * lyrics route for the owner, an account and a guest. A stand-in slot answers here: no model, no GPU.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { tempDir } from "./helpers/temp-dir";
import { startFakeModeration } from "./helpers/fake-billing";

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
const partialRoute = await import("@/app/api/gpu/computer/text/[id]/partial/route");
const awayRoute = await import("@/app/api/gpu/computer/text/away/route");
const { proxy } = await import("@/proxy");
const { writeRestorePrompt } = await import("@/server/restore");

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
async function nextJob(w: W, ms = 5000, vision = false) {
  const end = Date.now() + ms;
  for (;;) {
    const job = helper.claimHelperJob(workerRow(w), { model: "test", device: "gpu", vision });
    if (job || Date.now() > end) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A stand-in text slot: it answers every job it gets with `answer(job)`, until stopped. */
function standIn(w: W, answer: (job: NonNullable<Awaited<ReturnType<typeof nextJob>>>) => string, vision = false) {
  let on = true;
  const seen: string[] = [];
  const done = (async () => {
    while (on) {
      const job = helper.claimHelperJob(workerRow(w), { model: "test", device: "gpu", vision });
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

  it("a guest's call is refused for sign-in before any moderation call or job", async () => {
    const mod = await startFakeModeration();
    process.env.FUOBE_MODERATION_URL = mod.url;
    try {
      const w = addWorker();
      helper.claimHelperJob(workerRow(w));
      for (const who of ["guest:203.0.113.9", "guest:shared"]) {
        expect(await helper.askHelper({ task: "lyrics", system: "s", user: "u", who, waitMs: 30 })).toEqual({ error: "sign-in" });
      }
      expect(runAsTenant({ kind: "guest" }, () => helper.freeHelperOn())).toBe(false);
      expect(jobs()).toEqual([]);
      expect(mod.calls).toEqual([]);
      // An account's call does reach moderation.
      await helper.askHelper({ task: "lyrics", system: "s", user: "u", who: `acct:${account}`, waitMs: 30 });
      expect(mod.calls_of("/v1/check-run")).toHaveLength(1);
    } finally {
      delete process.env.FUOBE_MODERATION_URL;
      await mod.close();
    }
  });

  it("an account's calls have limits: a minute's and its waiting jobs; a run's own steps aren't counted", async () => {
    const w = addWorker();
    helper.claimHelperJob(workerRow(w));
    const who = `acct:${account}`;
    for (let i = 0; i < helper.HELPER_LIMITS.account.perMinute; i++) expect(await helper.askHelper({ task: "enhance", system: "s", user: "u", who, waitMs: 30 })).toEqual({ error: "busy" });
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

describe("pictures for a slot that sees them", () => {
  const big = () => sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#c33" } }).png().toBuffer();

  it("only a slot whose model sees pictures takes the job, which carries them as JPEGs of at most 1024 px", async () => {
    const text = addWorker();
    const sees = addWorker();
    helper.claimHelperJob(workerRow(text), { vision: false });
    expect(helper.helperLive(Date.now(), { vision: true })).toBe(false);
    expect(await helper.askHelper({ task: "describe", system: "s", user: "Describe her.", images: [{ data: await big(), contentType: "image/png" }] })).toEqual({ error: "busy" });
    helper.claimHelperJob(workerRow(sees), { vision: true });
    const asked = helper.askHelper({ task: "describe", system: "s", user: "Describe her.", images: [{ data: await big(), contentType: "image/png" }] });
    await new Promise((r) => setTimeout(r, 50));
    expect(helper.claimHelperJob(workerRow(text), { vision: false })).toBeNull();
    const job = await nextJob(sees, 5000, true);
    expect(job?.images).toHaveLength(1);
    const meta = await sharp(Buffer.from(job!.images![0], "base64")).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 1024, height: 683 });
    expect(meta.exif).toBeUndefined();
    helper.finishHelperJob(workerRow(sees), job!.id, { lease: job!.lease, text: "a woman in red" });
    expect(await asked).toEqual({ text: "a woman in red" });
  });

  it("refuses more than four pictures, or a file that isn't a picture", async () => {
    const w = addWorker();
    helper.claimHelperJob(workerRow(w), { vision: true });
    const png = await big();
    expect(await helper.helperPictures(Array(5).fill({ data: png, contentType: "image/png" }))).toBeNull();
    expect(await helper.helperPictures([{ data: Buffer.from("<svg/>"), contentType: "image/svg+xml" }])).toBeNull();
    expect(await helper.helperPictures([{ data: Buffer.from("not a png"), contentType: "image/png" }])).toBeNull();
  });

  it("a picture task: the free helper when its model sees them, the words alone where pictures are optional, else no answer", async () => {
    const pic = [{ data: await big(), contentType: "image/png" }];
    const w = addWorker();
    const words = standIn(w, (job) => `saw ${job.images?.length ?? 0}`);
    expect(await llmText("s", "u", pic, { task: "describe" })).toBeNull();
    expect(await llmText("s", "u", pic, { task: "recipe", imagesOptional: true })).toBe("saw 0");
    await words.stop();
    db().prepare("DELETE FROM helper_slots").run();
    const sees = standIn(w, (job) => (job.task === "restore" ? "PROMPT: a 1950s street in Mumbai, soft daylight\nNEGATIVE: cars, phones" : `saw ${job.images?.length ?? 0}`), true);
    let by = "";
    expect(await llmText("s", "u", pic, { task: "describe", onAnswer: (b) => (by = b) })).toBe("saw 1");
    expect(by).toBe("free");
    // Restore's prompt writer for the owner, with no Claude key and no local model: the free helper reads the frames.
    const frame = `data:image/jpeg;base64,${(await sharp(await big()).jpeg().resize(320).toBuffer()).toString("base64")}`;
    const r = await writeRestorePrompt({ engine: "cloud", frames: [frame], hint: "1950s Mumbai" });
    expect(r).toMatchObject({ by: "free", prompt: expect.stringContaining("1950s street") });
    await sees.stop();
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

  it("lyrics: an account gets them from the free helper while hosted runs are on; a guest is asked to sign up", async () => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    const mod = await startFakeModeration();
    process.env.FUOBE_MODERATION_URL = mod.url;
    const w = addWorker();
    const slot = standIn(w, (job) => (job.task === "lyrics" ? "[verse] Neon rain\n[chorus] Hold on" : "?"));
    try {
      expect(passed(await viaProxy("/api/enhance"))).toBe(true);
      expect(passed(await viaProxy("/api/enhance", "account"))).toBe(true);
      // A guest: 401 with the guest mark and the sign-in code (the page opens "Create a free account"), nothing checked or queued.
      const guest = await enhanceRoute.POST(post("/api/enhance", { prompt: "A synthwave song about rain", target: "lyrics", seconds: 30 }));
      expect(guest.status).toBe(401);
      expect(guest.headers.get("x-fuobe-guest")).toBe("1");
      expect(await guest.json()).toEqual({ error: "Create a free account to run this.", code: "sign-in" });
      expect(mod.calls).toEqual([]);
      // A guest's rewrite is the offline one: the helper isn't asked.
      const rewrite = await enhanceRoute.POST(post("/api/enhance", { prompt: "a cat", kind: "image", op: "t2i" }));
      expect(rewrite.status).toBe(200);
      expect(((await rewrite.json()) as { prompt: string }).prompt).toMatch(/^a cat\. /);
      expect(mod.calls).toEqual([]);
      expect(slot.seen).toEqual([]);
      const r = await enhanceRoute.POST(post("/api/enhance", { prompt: "A synthwave song about rain", target: "lyrics", seconds: 30 }, "account"));
      expect(r.status).toBe(200);
      expect(((await r.json()) as { lyrics: string }).lyrics).toBe("[Verse]\nNeon rain\n\n[Chorus]\nHold on");
      const accountRewrite = await enhanceRoute.POST(post("/api/enhance", { prompt: "a cat", kind: "image", op: "t2i" }, "account"));
      expect(((await accountRewrite.json()) as { prompt: string }).prompt).toBe("?");
      expect(slot.seen).toEqual(["lyrics", "enhance"]);
    } finally {
      await slot.stop();
      delete process.env.FUOBE_MODERATION_URL;
      await mod.close();
    }
  });

  it("lyrics for a Gujarati or Hindi description are asked for in its language and script", async () => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    const w = addWorker();
    const asked: { system: string; user: string }[] = [];
    const slot = standIn(w, (job) => {
      asked.push({ system: job.system, user: job.user });
      return "[Verse]\nગરબા રમીએ";
    });
    for (const prompt of ["નવરાત્રિ ગરબા પર એક ઉત્સાહી ગીત", "मानसून की पहली बारिश पर एक गीत", "A synth-pop song about rain"]) {
      expect((await enhanceRoute.POST(post("/api/enhance", { prompt, target: "lyrics", seconds: 30 }, "account"))).status).toBe(200);
    }
    await slot.stop();
    expect(asked[0].system).toContain("Write in the language and script of the description");
    expect(asked[0].user).toMatch(/નવરાત્રિ[\s\S]*Write the lyrics in Gujarati, in Gujarati script, not in English/);
    expect(asked[1].user).toContain("Write the lyrics in Hindi, in Devanagari script");
    expect(asked[2].user).not.toContain("Write the lyrics in");
  });

  it("never a dead end: busy words for an account, the way to set one up for the owner, and the proxy without hosted runs", async () => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    const busy = await enhanceRoute.POST(post("/api/enhance", { prompt: "a song", target: "lyrics" }, "account"));
    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({ error: "Try again in a moment, or type your own lyrics.", code: "helper-busy" });
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

describe("chat: turns, words as they come, ending early", () => {
  const turns = [
    { role: "user" as const, content: "Hi, I'm Ria." },
    { role: "assistant" as const, content: "Hello Ria!" },
    { role: "user" as const, content: "What's my name?" },
  ];
  const auth_ = (w: W) => ({ authorization: `Bearer ${w.token}` });
  /** A worker whose slot takes chats, noted live. */
  const chatWorker = () => {
    const w = addWorker();
    helper.claimHelperJob(workerRow(w), { chat: true, vision: true });
    return w;
  };
  const nextChat = async (w: W, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      const job = helper.claimHelperJob(workerRow(w), { chat: true, vision: true });
      if (job || Date.now() > end) return job;
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const row = (id: string) => db().prepare("SELECT state, partial FROM helper_jobs WHERE id = ?").get(id) as { state: string; partial: string | null } | undefined;

  it("checks the turns: user and assistant only, the newest the person's, at most 24,000 characters; nothing is queued for a bad one", async () => {
    expect(helper.helperMessagesProblem(turns)).toBeNull();
    expect(helper.helperMessagesProblem([])).toBe("no turns");
    expect(helper.helperMessagesProblem(turns.slice(0, 2))).toBe("the newest turn isn't the person's or a tool's");
    expect(helper.helperMessagesProblem([{ role: "system", content: "x" }, turns[2]])).toMatch(/user, assistant or tool/);
    expect(helper.helperMessagesProblem([{ role: "user", content: "x".repeat(helper.HELPER_LIMITS.chatChars + 1) }])).toBe("too long");
    expect(helper.helperMessagesProblem([{ role: "user", content: "x".repeat(helper.HELPER_LIMITS.chatChars) }])).toBeNull();
    expect(helper.helperMessagesProblem(Array(helper.HELPER_LIMITS.chatTurns + 1).fill(turns[2]))).toBe("too many turns");
    chatWorker();
    expect(await helper.askHelper({ task: "chat", system: "s", messages: [{ role: "user", content: "x".repeat(24_001) }] })).toMatchObject({ error: "failed", message: expect.stringContaining("too long") });
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
    const two = [{ data: png, contentType: "image/png" }, { data: png, contentType: "image/png" }];
    expect(await helper.askHelper({ task: "chat", system: "s", messages: turns, images: two })).toMatchObject({ error: "failed" });
    expect(jobs()).toEqual([]);
  });

  it("a chat goes only to a slot that takes chats, as real turns with its own sampling (in bounds), one picture with it", async () => {
    const old = addWorker();
    helper.claimHelperJob(workerRow(old));
    // Only an older slot is live: busy at once, nothing queued.
    expect(helper.helperLive(Date.now(), { chat: true })).toBe(false);
    expect(await helper.askHelper({ task: "chat", system: "s", messages: turns })).toEqual({ error: "busy" });
    const w = chatWorker();
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#c33" } }).png().toBuffer();
    const asked = helper.askHelper({ task: "chat", system: "Be kind.", messages: turns, sampling: { temperature: 5, top_p: 0.5 }, images: [{ data: png, contentType: "image/png" }] });
    await new Promise((r) => setTimeout(r, 50));
    // The older slot never gets it.
    expect(helper.claimHelperJob(workerRow(old), { vision: true })).toBeNull();
    const job = await nextChat(w);
    expect(job).toMatchObject({ task: "chat", system: "Be kind.", user: "What's my name?", messages: turns, sampling: { temperature: 2, top_p: 0.5 }, stream: true, maxTokens: 900 });
    expect(job!.images).toHaveLength(1);
    helper.finishHelperJob(workerRow(w), job!.id, { lease: job!.lease, text: "You're Ria." });
    expect(await asked).toEqual({ text: "You're Ria." });
  });

  it("the words so far reach the caller as they come, only with the job's lease; the whole answer still comes back", async () => {
    const w = chatWorker();
    const other = chatWorker();
    const seen: string[] = [];
    const asked = helper.askHelper({ task: "chat", system: "s", messages: turns, onText: (t) => seen.push(t) });
    const job = (await nextChat(w))!;
    expect(helper.partialHelperJob(workerRow(w), job.id, { lease: "not its lease", text: "x" })).toBe("stop");
    expect(helper.partialHelperJob(workerRow(other), job.id, { lease: job.lease, text: "x" })).toBe("stop");
    expect(helper.partialHelperJob(workerRow(w), job.id, { lease: job.lease })).toBe("bad");
    expect(helper.partialHelperJob(workerRow(w), job.id, { lease: job.lease, text: "x".repeat(helper.HELPER_LIMITS.textBytes + 1) })).toBe("bad");
    expect(helper.partialHelperJob(workerRow(w), job.id, { lease: job.lease, text: "" })).toBe("ok");
    expect(helper.partialHelperJob(workerRow(w), job.id, { lease: job.lease, text: "<think>hmm" })).toBe("ok");
    await new Promise((r) => setTimeout(r, 300));
    expect(helper.partialHelperJob(workerRow(w), job.id, { lease: job.lease, text: "You're" })).toBe("ok");
    await new Promise((r) => setTimeout(r, 300));
    expect(helper.partialHelperJob(workerRow(w), job.id, { lease: job.lease, text: "You're Ria" })).toBe("ok");
    await new Promise((r) => setTimeout(r, 300));
    helper.finishHelperJob(workerRow(w), job.id, { lease: job.lease, text: "You're Ria." });
    expect(await asked).toEqual({ text: "You're Ria." });
    // An unfinished reasoning block and empty words are never shown.
    expect(seen).toEqual(["You're", "You're Ria"]);
    expect(jobs()).toEqual([]);
  });

  it("the caller goes: a waiting job is gone, a running one is canceled and its slot is told to stop; its answer isn't taken", async () => {
    const w = chatWorker();
    const early = new AbortController();
    const waiting = helper.askHelper({ task: "chat", system: "s", messages: turns, signal: early.signal });
    await new Promise((r) => setTimeout(r, 50));
    early.abort();
    expect(await waiting).toEqual({ error: "failed" });
    expect(jobs()).toEqual([]);
    const late = new AbortController();
    const running = helper.askHelper({ task: "chat", system: "s", messages: turns, signal: late.signal });
    const job = (await nextChat(w))!;
    expect(helper.partialHelperJob(workerRow(w), job.id, { lease: job.lease, text: "Once upon" })).toBe("ok");
    late.abort();
    expect(await running).toEqual({ error: "failed" });
    expect(row(job.id)?.state).toBe("canceled");
    expect(helper.partialHelperJob(workerRow(w), job.id, { lease: job.lease, text: "Once upon a time" })).toBe("stop");
    expect(helper.finishHelperJob(workerRow(w), job.id, { lease: job.lease, text: "Once upon a time." })).toBe(false);
    // A canceled job doesn't count as waiting, and the sweep takes it later.
    helper.sweepHelper(Date.now() + helper.HELPER_TIMES.keepMs + 1000);
    expect(row(job.id)).toBeUndefined();
  });

  it("the partial route: the slot's lease or stop; a browser can't", async () => {
    const w = chatWorker();
    const asked = helper.askHelper({ task: "chat", system: "s", messages: turns, waitMs: 5000 });
    const job = (await nextChat(w))!;
    const ctx = { params: Promise.resolve({ id: job.id }) } as never;
    const send = (body: unknown, who?: string, extra = auth_(w)) => partialRoute.POST(post(`/api/gpu/computer/text/${job.id}/partial`, body, who, extra), ctx);
    const wrong = await send({ lease: "x", text: "no" });
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toMatchObject({ stop: true });
    expect((await send({ lease: job.lease, text: "You" })).status).toBe(200);
    expect(row(job.id)?.partial).toBe("You");
    expect((await send({ lease: job.lease, text: 5 })).status).toBe(400);
    const browser = await send({ lease: job.lease, text: "x" }, "owner", { "sec-fetch-site": "same-origin", origin: "http://localhost:3000" } as never);
    expect(browser.status).not.toBe(200);
    expect((await resultRoute.POST(post(`/api/gpu/computer/text/${job.id}`, { lease: job.lease, text: "You're Ria." }, undefined, auth_(w)), ctx)).status).toBe(200);
    expect(await asked).toEqual({ text: "You're Ria." });
    // Ended: the next words are told to stop.
    expect((await send({ lease: job.lease, text: "more" })).status).toBe(409);
    // A slot that says it takes chats gets one through the claim route too.
    const claimed = helper.askHelper({ task: "chat", system: "s", messages: turns, waitMs: 5000 });
    // An older worker (no chat flag) gets nothing; one that says it takes chats gets it.
    const older = addWorker();
    const none = await claimRoute.POST(post("/api/gpu/computer/text/claim", { model: "m", device: "cpu", wait: 300 }, undefined, auth_(older)));
    expect(none.status).toBe(204);
    const r = await claimRoute.POST(post("/api/gpu/computer/text/claim", { model: "m", device: "cpu", chat: true, wait: 3000 }, undefined, auth_(w)));
    const { job: j2 } = (await r.json()) as { job: { id: string; lease: string; messages: unknown } };
    expect(j2.messages).toEqual(turns);
    helper.finishHelperJob(workerRow(w), j2.id, { lease: j2.lease, text: "ok" });
    expect(await claimed).toEqual({ text: "ok" });
  });

  it("a slot that never sends words so far (an older worker) still answers a streamed job whole; its time runs from its claim", async () => {
    const w = chatWorker();
    const seen: string[] = [];
    const asked = helper.askHelper({ task: "enhance", system: "s", user: "a cat", onText: (t) => seen.push(t) });
    // An older slot claims as it always did (no chat flag): a plain job with a stream flag it ignores.
    const job = (await nextJob(w))!;
    expect(job).toMatchObject({ task: "enhance", user: "a cat", stream: true });
    expect(job.messages).toBeUndefined();
    helper.finishHelperJob(workerRow(w), job.id, { lease: job.lease, text: "a cat, golden light" });
    expect(await asked).toEqual({ text: "a cat, golden light" });
    expect(seen).toEqual([]);
    // The worker updates: its slot says it takes chats again.
    expect(helper.claimHelperJob(workerRow(w), { chat: true })).toBeNull();
    // Time: with no words sent, a running job fails runMs after its claim; each new word gives it that time again.
    // A clock that moves 20 s with each look once the job is claimed.
    let t = 1_000_000;
    let taken: Awaited<ReturnType<typeof nextChat>> = null;
    let sends = 0;
    let talk = false;
    const sleep = async () => {
      await new Promise((r) => setTimeout(r, 5));
      if (!taken) return;
      t += 20_000;
      // Words every 20 s, for 4 minutes; then none.
      if (talk && sends++ < 12) helper.partialHelperJob(workerRow(w), taken.id, { lease: taken.lease, text: `w${sends}` }, t);
    };
    const quiet = helper.askHelper({ task: "chat", system: "s", messages: turns, now: () => t, sleep });
    taken = await nextChat(w);
    db().prepare("UPDATE helper_jobs SET claimed_at = ? WHERE id = ?").run(t, taken!.id);
    expect(await quiet).toEqual({ error: "failed" });
    expect(t - 1_000_000).toBeGreaterThanOrEqual(helper.HELPER_TIMES.runMs);
    expect(t - 1_000_000).toBeLessThanOrEqual(helper.HELPER_TIMES.runMs + 20_000);
    t = 2_000_000;
    taken = null;
    talk = true;
    const talky = helper.askHelper({ task: "chat", system: "s", messages: turns, now: () => t, sleep });
    taken = await nextChat(w);
    db().prepare("UPDATE helper_jobs SET claimed_at = ? WHERE id = ?").run(t, taken!.id);
    expect(await talky).toEqual({ error: "failed" });
    // It went on well past runMs while words came, and ended once they stopped.
    expect(t - 2_000_000).toBeGreaterThan(240_000);
    expect(t - 2_000_000).toBeLessThanOrEqual(helper.HELPER_TIMES.streamMaxMs + 20_000);
  });

  it("chat has its own limits apart from the studio's: an account's 12 a minute; a guest is asked to sign in", async () => {
    chatWorker();
    const who = `acct:${account}`;
    for (let i = 0; i < helper.HELPER_LIMITS.account.perMinute; i++) expect(await helper.askHelper({ task: "enhance", system: "s", user: "u", who, waitMs: 30 })).not.toMatchObject({ error: "limit" });
    expect(await helper.askHelper({ task: "enhance", system: "s", user: "u", who, waitMs: 30 })).toMatchObject({ error: "limit" });
    // The studio's limit is used up; chat still answers.
    for (let i = 0; i < helper.HELPER_LIMITS.chat.perMinute; i++) expect(await helper.askHelper({ task: "chat", system: "s", messages: turns, who, waitMs: 30 })).toEqual({ error: "busy" });
    expect(await helper.askHelper({ task: "chat", system: "s", messages: turns, who, waitMs: 30 })).toMatchObject({ error: "limit", retryAfterS: expect.any(Number) });
    expect(helper.HELPER_LIMITS.chat).toEqual({ perMinute: 12, perHour: 300 });
    expect(await helper.askHelper({ task: "chat", system: "s", messages: turns, who: "guest:203.0.113.9" })).toEqual({ error: "sign-in" });
    expect(runAsTenant({ kind: "guest" }, () => helper.freeHelperOn(Date.now(), { chat: true }))).toBe(false);
  });

  it("while it waits, the caller hears its place in the line (1 is next), people's jobs before the owner's", async () => {
    const w = chatWorker();
    const places: Record<string, number[]> = { a: [], b: [], c: [] };
    const a = helper.askHelper({ task: "chat", system: "s", messages: turns, onQueue: (p) => places.a.push(p), waitMs: 10_000 });
    await new Promise((r) => setTimeout(r, 20));
    const b = helper.askHelper({ task: "chat", system: "s", messages: turns, onQueue: (p) => places.b.push(p), waitMs: 10_000 });
    await new Promise((r) => setTimeout(r, 20));
    const c = runAsTenant({ kind: "account", id: account }, () => helper.askHelper({ task: "chat", system: "s", messages: turns, onQueue: (p) => places.c.push(p), waitMs: 10_000 }));
    await new Promise((r) => setTimeout(r, 400));
    expect(places).toEqual({ a: [1, 2], b: [2, 3], c: [1] });
    for (let i = 0; i < 3; i++) {
      const job = (await nextChat(w))!;
      await new Promise((r) => setTimeout(r, 400));
      helper.finishHelperJob(workerRow(w), job.id, { lease: job.lease, text: `answer ${i}` });
    }
    expect(await Promise.all([a, b, c])).toEqual([{ text: "answer 1" }, { text: "answer 2" }, { text: "answer 0" }]);
    expect(places).toEqual({ a: [1, 2, 1], b: [2, 3, 2, 1], c: [1] });
  });
});

describe("what a chat waits for: a slot ready, busy, coming back or gone", () => {
  const turns = [{ role: "user" as const, content: "Hi" }];
  const auth_ = (w: W) => ({ authorization: `Bearer ${w.token}` });
  const chatWorker = () => {
    const w = addWorker();
    helper.claimHelperJob(workerRow(w), { chat: true });
    return w;
  };
  const slotSeen = (w: W, ago: number) => db().prepare("UPDATE helper_slots SET seen_at = ? WHERE worker_id = ?").run(Date.now() - ago, w.id);

  it("ready while a slot asks; busy while every slot has a job; starting while one restarts or just went quiet; absent after", async () => {
    expect(helper.helperState()).toBe("absent");
    const w = chatWorker();
    expect(helper.helperState(Date.now(), { chat: true })).toBe("ready");
    const asked = helper.askHelper({ task: "chat", system: "s", messages: turns });
    const job = (await helper.claimHelperJob(workerRow(w), { chat: true }))!;
    expect(helper.helperState(Date.now(), { chat: true })).toBe("busy");
    helper.finishHelperJob(workerRow(w), job.id, { lease: job.lease, text: "Hello" });
    expect(await asked).toEqual({ text: "Hello" });
    // Its worker restarts on new code: coming back, whatever its last claim's age.
    expect(helper.noteHelperAway(workerRow(w), "updating")).toBe(true);
    expect(helper.helperLive(Date.now(), { chat: true })).toBe(false);
    expect(helper.helperState(Date.now(), { chat: true })).toBe("starting");
    // Paused (by hand or for its hours) or stopped: gone.
    helper.noteHelperAway(workerRow(w), "paused");
    expect(helper.helperState(Date.now(), { chat: true })).toBe("absent");
    expect(helper.noteHelperAway(workerRow(w), "elsewhere")).toBe(false);
    // Its next claim says it is back.
    helper.claimHelperJob(workerRow(w), { chat: true });
    expect(helper.helperState(Date.now(), { chat: true })).toBe("ready");
    // Quiet for a minute: coming back. Quiet for four, or paused on the website: gone.
    slotSeen(w, 60_000);
    expect(helper.helperState(Date.now(), { chat: true })).toBe("starting");
    pool.patchWorker(w.id, { paused: true });
    expect(helper.helperState(Date.now(), { chat: true })).toBe("absent");
    pool.patchWorker(w.id, { paused: false });
    slotSeen(w, 240_000);
    expect(helper.helperState(Date.now(), { chat: true })).toBe("absent");
    // A guest, or an account while hosted runs are off, may not use it at all.
    helper.claimHelperJob(workerRow(w), { chat: true });
    expect(runAsTenant({ kind: "guest" }, () => helper.freeHelperState(Date.now(), { chat: true }))).toBe("absent");
    expect(runAsTenant({ kind: "account", id: account }, () => helper.freeHelperState(Date.now(), { chat: true }))).toBe("absent");
    process.env.FUOBE_HOSTED_RUNS = "1";
    expect(runAsTenant({ kind: "account", id: account }, () => helper.freeHelperState(Date.now(), { chat: true }))).toBe("ready");
  });

  it("a chat waits for a slot that is coming back, and hears so; its slot's next claim takes it", async () => {
    const w = chatWorker();
    helper.noteHelperAway(workerRow(w), "updating");
    const states: string[] = [];
    const asked = helper.askHelper({ task: "chat", system: "s", messages: turns, onState: (s) => states.push(s) });
    await new Promise((r) => setTimeout(r, 400));
    expect(states).toEqual(["starting"]);
    // Another task still needs a slot that asks now.
    expect(await helper.askHelper({ task: "enhance", system: "s", user: "u" })).toEqual({ error: "busy" });
    // The worker is back on new code.
    const job = (await helper.claimHelperJob(workerRow(w), { chat: true }))!;
    await new Promise((r) => setTimeout(r, 300));
    helper.finishHelperJob(workerRow(w), job.id, { lease: job.lease, text: "Back" });
    expect(await asked).toEqual({ text: "Back" });
    expect(states).toEqual(["starting", "running"]);
    // While a slot asks, the job is in line.
    const seen: string[] = [];
    const inLine = helper.askHelper({ task: "chat", system: "s", messages: turns, onState: (s) => seen.push(s) });
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual(["in-line"]);
    const j2 = (await helper.claimHelperJob(workerRow(w), { chat: true }))!;
    helper.finishHelperJob(workerRow(w), j2.id, { lease: j2.lease, text: "ok" });
    expect(await inLine).toEqual({ text: "ok" });
  });

  it("a chat waits up to 120 s, not 45; it ends at once when no slot is coming any more", async () => {
    expect(helper.HELPER_TIMES.chatWaitMs).toBe(120_000);
    const w = chatWorker();
    helper.noteHelperAway(workerRow(w), "updating");
    let t = Date.now();
    const start = t;
    const waited = helper.askHelper({ task: "chat", system: "s", messages: turns, now: () => t, sleep: async () => void (t += 10_000) });
    expect(await waited).toEqual({ error: "busy" });
    expect(t - start).toBeGreaterThanOrEqual(120_000);
    expect(t - start).toBeLessThan(140_000);
    // Coming back, then gone (its worker was paused): it doesn't wait out its time.
    helper.claimHelperJob(workerRow(w), { chat: true });
    helper.noteHelperAway(workerRow(w), "updating");
    const gone = helper.askHelper({ task: "chat", system: "s", messages: turns, waitMs: 60_000 });
    await new Promise((r) => setTimeout(r, 300));
    helper.noteHelperAway(workerRow(w), "stopped");
    const t0 = Date.now();
    expect(await gone).toEqual({ error: "busy" });
    expect(Date.now() - t0).toBeLessThan(2000);
    // Nothing coming at all: busy at once, nothing queued.
    expect(await helper.askHelper({ task: "chat", system: "s", messages: turns })).toEqual({ error: "busy" });
    expect(jobs()).toEqual([]);
  });

  it("the away route: a shared worker's slot only, a known reason only", async () => {
    const w = chatWorker();
    const send = (body: unknown, extra: Record<string, string> = auth_(w), who?: string) => awayRoute.POST(post("/api/gpu/computer/text/away", body, who, extra));
    expect((await send({ state: "updating" })).status).toBe(200);
    expect(helper.helperState(Date.now(), { chat: true })).toBe("starting");
    expect((await send({ state: "gone fishing" })).status).toBe(400);
    const browser = await send({ state: "stopped" }, { "sec-fetch-site": "same-origin", origin: "http://localhost:3000" }, "owner");
    expect(browser.status).not.toBe(200);
    expect(helper.helperState(Date.now(), { chat: true })).toBe("starting");
  });
});

describe("chat with tools", () => {
  const tools: import("@/server/text-helper").HelperTool[] = [
    { type: "function", function: { name: "make_picture", description: "Make a picture from words", parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] } } },
    { type: "function", function: { name: "remove_background", parameters: { type: "object", properties: {} } } },
  ];
  const asked = [{ role: "user" as const, content: "Make a picture of a cat" }];
  const called: import("@/server/text-helper").HelperMessage[] = [
    ...asked,
    { role: "assistant", tool_calls: [{ id: "call_a", type: "function", function: { name: "make_picture", arguments: '{"prompt":"a cat"}' } }] },
    { role: "tool", tool_call_id: "call_a", content: '{"made":"asset_1"}' },
  ];
  const toolWorker = (o: { tools?: boolean } = {}) => {
    const w = addWorker();
    helper.claimHelperJob(workerRow(w), { chat: true, tools: o.tools !== false });
    return w;
  };
  const claim = async (w: W, tools = true, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      const job = helper.claimHelperJob(workerRow(w), { chat: true, tools });
      if (job || Date.now() > end) return job;
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it("checks tools, the choice, tool calls and tools' results; the newest turn may be a tool's", () => {
    expect(helper.helperToolsProblem(tools)).toBeNull();
    expect(helper.helperToolsProblem(tools, "none")).toBeNull();
    expect(helper.helperToolsProblem(tools, { type: "function", function: { name: "make_picture" } })).toBeNull();
    expect(helper.helperToolsProblem(tools, { type: "function", function: { name: "nope" } })).toBe("the tool choice names no tool");
    expect(helper.helperToolsProblem([])).toBe("no tools");
    expect(helper.helperToolsProblem([tools[0], tools[0]])).toBe("two tools have the same name");
    expect(helper.helperToolsProblem([{ type: "function", function: { name: "has space", parameters: {} } }])).toBe("a tool has no name");
    expect(helper.helperToolsProblem([{ type: "function", function: { name: "x", parameters: [] } }])).toBe("a tool's parameters aren't a schema");
    const big = { type: "function", function: { name: "big", description: "x".repeat(helper.HELPER_LIMITS.toolsChars), parameters: {} } };
    expect(helper.helperToolsProblem([big])).toBe("the tools are too long");
    expect(helper.helperMessagesProblem(called)).toBeNull();
    expect(helper.helperMessagesProblem([...asked, { role: "tool", tool_call_id: "call_z", content: "x" }])).toBe("a tool's result answers no call before it");
    expect(helper.helperMessagesProblem([{ role: "assistant" }, ...asked])).toBe("an assistant turn has neither words nor tool calls");
    expect(helper.helperMessagesProblem([...asked, { role: "assistant", tool_calls: [{ id: "c", type: "function", function: { name: "x", arguments: "y".repeat(8001) } }] }, ...asked])).toMatch(/name with its arguments/);
    expect(helper.helperMessagesProblem([...asked, { role: "assistant", tool_calls: [] }, ...asked])).toMatch(/short list/);
  });

  it("goes only to a slot that takes tools, with its tools, choice and turns as they are; tools need a chat", async () => {
    expect(await helper.askHelper({ task: "enhance", system: "s", user: "u", tools })).toMatchObject({ error: "failed", message: expect.stringContaining("need a chat") });
    const plain = toolWorker({ tools: false });
    // Only a chat slot without tools is here: nothing is coming that takes tools.
    expect(await helper.askHelper({ task: "chat", system: "s", messages: asked, tools })).toEqual({ error: "busy" });
    const w = toolWorker();
    const answer = helper.askHelper({ task: "chat", system: "s", messages: called, tools, tool_choice: "auto" });
    await new Promise((r) => setTimeout(r, 50));
    expect(helper.claimHelperJob(workerRow(plain), { chat: true })).toBeNull();
    const job = (await claim(w))!;
    expect(job).toMatchObject({ tools, toolChoice: "auto", messages: called, user: "Make a picture of a cat" });
    helper.finishHelperJob(workerRow(w), job.id, { lease: job.lease, text: "Here is your cat.", finish: "stop" });
    expect(await answer).toEqual({ text: "Here is your cat.", finish: "stop" });
  });

  it("an answer of tool calls: only offered tools, no words needed; why it stopped comes with it", async () => {
    const w = toolWorker();
    const answer = helper.askHelper({ task: "chat", system: "s", messages: asked, tools });
    const job = (await claim(w))!;
    expect(
      helper.finishHelperJob(workerRow(w), job.id, {
        lease: job.lease,
        text: "",
        finish: "tool_calls",
        toolCalls: [
          { id: "call_1", name: "make_picture", arguments: '{"prompt":"a cat"}' },
          { id: "call_2", name: "delete_everything", arguments: "{}" },
          { name: "remove_background", arguments: "{}" },
        ],
      }),
    ).toBe(true);
    expect(await answer).toEqual({
      text: "",
      finish: "tool_calls",
      toolCalls: [
        { id: "call_1", name: "make_picture", arguments: '{"prompt":"a cat"}' },
        { id: "call_2", name: "remove_background", arguments: "{}" },
      ],
    });
    // Cut at its token limit; and calls only to tools it wasn't offered: no answer.
    const cut = helper.askHelper({ task: "chat", system: "s", messages: asked, tools });
    const j2 = (await claim(w))!;
    helper.finishHelperJob(workerRow(w), j2.id, { lease: j2.lease, text: "A very long", finish: "length" });
    expect(await cut).toEqual({ text: "A very long", finish: "length" });
    const none = helper.askHelper({ task: "chat", system: "s", messages: asked, tools });
    const j3 = (await claim(w))!;
    helper.finishHelperJob(workerRow(w), j3.id, { lease: j3.lease, text: "", toolCalls: [{ id: "c", name: "delete_everything", arguments: "{}" }] });
    expect(await none).toEqual({ error: "failed" });
  });

  it("an older slot's answer (no finish, no calls) stays just its words", async () => {
    const w = toolWorker();
    const answer = helper.askHelper({ task: "chat", system: "s", messages: asked });
    const job = (await claim(w))!;
    helper.finishHelperJob(workerRow(w), job.id, { lease: job.lease, text: "Hi" });
    expect(await answer).toEqual({ text: "Hi" });
  });
});
