import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runnerByHand, startAppProcess, tick, type AppProcess } from "./helpers/app-process";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

/**
 * An account's run on its own GPU across two app processes on one database, as a deploy runs them for a moment: this
 * test process is one, and a second one (tests/helpers/app-process.ts) shares its data folder. One turn decides who
 * sends a run (submit_turns): the process that holds it sends it, or waits on its GPU for it, and the other leaves it
 * alone (never fails it, never takes it, never sends it). A process that stops gives its turns back at once, so the
 * other goes on with the wait where it was (its tries and its time); one cut off in the middle of a send leaves a run
 * the other never sends again. Against a stand-in ComfyUI on this machine: no real GPU is called.
 */
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const dir = tempDir("fuobe-own-run-turns-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
for (const k of ["FUOBE_PASSWORD", "FUOBE_ALLOW_PRIVATE_URLS", "FUOBE_HOSTED_RUNS", "FUOBE_BILLING_URL", "FUOBE_MODERATION_URL"]) delete process.env[k];
globalThis.__fuobeTestDiskFree = 1e13;

// Plain fetch is the install's own ComfyUI: an account's runs never reach it.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("not stubbed", { status: 599 })) as typeof fetch;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const uploadsRoute = await import("@/app/api/uploads/route");
const { asAccount, createGenerations, ensureRunner, getGeneration, QUIET_MS, SELF_HEAL, STALE_SUBMIT } = await import("@/server/generations");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");

const SCALE = 0.02;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fake: FakeComfy;
let app2: AppProcess;
/** The name the second process's turns carry. */
let theirs = "";
let a = "";
let cookie = "";

const tokens = () => (db().prepare("SELECT token FROM app_processes").all() as { token: string }[]).map((r) => r.token);
/** This process's name, as its turns carry it. */
const mine = () => globalThis.__fuobeRunnerToken!;

beforeAll(async () => {
  fake = await startFakeComfy({ loras: [], delayMs: 0 });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  a = auth.createAccount("turns@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
  auth.setAccountGpu(a, { url: fake.url });
  ensureRunner();
  runnerByHand();
  const known = new Set(tokens());
  app2 = await startAppProcess({
    dataDir: dir,
    env: { FUOBE_PUBLIC_SIGNUP: "1", COMFYUI_URL: process.env.COMFYUI_URL, FUOBE_TEST_GPU_PORT: String(fake.port), FUOBE_TEST_SELF_HEAL_SCALE: String(SCALE), FUOBE_TEST_STALE_SUBMIT_MS: "0" },
  });
  for (let i = 0; i < 100 && !theirs; i++) {
    theirs = tokens().find((t) => !known.has(t) && t !== mine()) ?? "";
    if (!theirs) await sleep(100);
  }
  expect(theirs, "the second process says it runs").toBeTruthy();
});
afterAll(async () => {
  await app2?.kill();
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  SELF_HEAL.scale = 1;
  STALE_SUBMIT.ms = 2 * 60_000;
  await fake.close();
});
beforeEach(() => {
  resetRates();
  SELF_HEAL.scale = SCALE;
  STALE_SUBMIT.ms = 0;
  Object.assign(fake.opts, { loras: [], delayMs: 0, answer: undefined, hold: undefined, slow: undefined, output: undefined });
  fake.dropHeld();
  fake.log.length = 0;
  globalThis.__fuobeAccountGpus?.clear();
  shutdown().draining = false;
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

const shutdown = () => (globalThis.__fuobeShutdown ??= { stops: new Set(), draining: false, hooked: false });
const headers = (extra: Record<string, string> = {}) => ({ cookie, host: "localhost:3000", ...extra });
const json = (url: string, body: unknown) => {
  const text = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, { method: "POST", headers: headers({ "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }), body: text });
};
const html = (status: number) => ({ status, body: "<!DOCTYPE html><html><head><title>Bad gateway</title></head><body>…</body></html>", contentType: "text/html" });
/** The GPU is starting up: its address answers 502 (a run waits for it). */
const gpuStarting = () => (fake.opts.answer = (_m, p) => (p === "/upload/image" || p === "/system_stats" ? html(502) : undefined));
const gpuBack = () => (fake.opts.answer = undefined);

async function uploadPng(): Promise<string> {
  const r = await uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: headers({ "content-type": "image/png", "x-file-name": "me.png", "content-length": String(TINY_PNG.length) }), body: TINY_PNG }));
  expect(r.status).toBe(201);
  return ((await r.json()) as { url: string }).url;
}
async function startRun(): Promise<string> {
  const pic = await uploadPng();
  const r = await generationsRoute.POST(json("/api/generations", { feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "", inputs: { images: [pic] } }));
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { items: { id: string }[] }).items[0].id;
}

interface Heal {
  since: number;
  tries: number;
  sending?: number;
  trouble?: unknown;
}
const row = (id: string) => db().prepare("SELECT status, error, external_id, external_meta_json FROM generations WHERE id = ?").get(id) as { status: string; error: string | null; external_id: string | null; external_meta_json: string | null };
const healOf = (id: string) => (JSON.parse(row(id).external_meta_json || "{}") as { heal?: Heal }).heal;
/** The app process that holds the turn to send the run (null: none does). */
const turnOf = (id: string) => (db().prepare("SELECT held_by FROM submit_turns WHERE id = ?").get(id) as { held_by: string } | undefined)?.held_by ?? null;
const prompts = () => fake.log.filter((e) => e.path === "/prompt").length;

/** Turn a runner (this process's, or the other's) until `fn` says yes, or the time is up (its last answer). */
async function until<T>(fn: () => T, turn: () => Promise<void> = tick, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  let v = fn();
  while (!v && Date.now() < end) {
    await turn();
    await sleep(20);
    v = fn();
  }
  return v;
}
const ended = (id: string) => ["succeeded", "failed", "canceled"].includes(row(id).status);
const waiting = (id: string) => row(id).status === "queued" && !!healOf(id)?.trouble;

/** This process stops as a deploy's old instance does: its waits let go of their runs (and give their turns back). */
async function drainHere(id: string) {
  shutdown().draining = true;
  for (let i = 0; i < 500 && globalThis.__fuobeSubmitting?.has(id); i++) await sleep(10);
  expect(globalThis.__fuobeSubmitting?.has(id)).toBe(false);
}

describe("two app processes and a run waiting for its account's own GPU", () => {
  it("the other process's turns leave a run waiting here alone, and it is sent once when its GPU is back", async () => {
    gpuStarting();
    const id = await startRun();
    expect(await until(() => waiting(id))).toBe(true);
    expect(turnOf(id), "the turn is this process's while it waits").toBe(mine());
    // The other process turns (its sweep, its chain steps, its polls) while the run waits here.
    for (let i = 0; i < 3; i++) await app2.tick();
    expect(row(id)).toMatchObject({ status: "queued", external_id: null });
    expect(getGeneration(id)?.waiting, "still waiting, with what helps").toBeTruthy();
    expect(turnOf(id)).toBe(mine());
    expect(prompts()).toBe(0);
    gpuBack();
    expect(await until(() => ended(id))).toBe(true);
    expect(row(id).status, row(id).error ?? "").toBe("succeeded");
    expect(prompts(), "sent once").toBe(1);
    expect(turnOf(id), "the turn goes once it is sent").toBeNull();
  });

  it("a deploy mid-wait: this process stops, the other takes the wait over at once, goes on with its tries, and sends it once", async () => {
    gpuStarting();
    const id = await startRun();
    expect(await until(() => waiting(id))).toBe(true);
    const before = healOf(id)!;
    await drainHere(id);
    // It gave its turn back at once (the other needn't wait for it to go quiet), and kept the wait with the run.
    expect(turnOf(id)).toBeNull();
    expect(row(id)).toMatchObject({ status: "queued", external_id: null });
    expect(healOf(id)?.since).toBe(before.since);
    // A server that is stopping takes no wait over, its own included: the other process does.
    await tick();
    expect(turnOf(id)).toBeNull();
    // The other process takes the wait over: its turn, the wait's start kept, its tries going on from where they were.
    expect(await until(() => turnOf(id) === theirs && (healOf(id)?.tries ?? 0) > before.tries, () => app2.tick())).toBe(true);
    expect(healOf(id)?.since).toBe(before.since);
    expect(prompts()).toBe(0);
    gpuBack();
    expect(await until(() => ended(id), () => app2.tick())).toBe(true);
    expect(row(id).status, row(id).error ?? "").toBe("succeeded");
    expect(prompts(), "sent once, by the process that went on with it").toBe(1);
  });
});

describe("a step of a longer run that waits for its account's own GPU", () => {
  it("is left to the process waiting on it; once that process stops, the other resumes its wait where it was and sends it once", async () => {
    // The run's first step, done on the GPU, with a picture for the next step.
    fake.opts.output = "both";
    const first = await startRun();
    expect(await until(() => ended(first))).toBe(true);
    expect(row(first).status, row(first).error ?? "").toBe("succeeded");
    const pic = await uploadPng();
    gpuStarting();
    fake.log.length = 0;
    const [step] = asAccount(a, () =>
      createGenerations({ feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "", inputs: { images: [pic] } } as Parameters<typeof createGenerations>[0], { dependsOn: first }),
    );
    // This process launches it; its GPU is starting up, so it waits here.
    expect(await until(() => waiting(step.id))).toBe(true);
    expect(turnOf(step.id)).toBe(mine());
    const before = healOf(step.id)!;
    // The other process's chain steps leave it alone.
    for (let i = 0; i < 3; i++) await app2.tick();
    expect(turnOf(step.id)).toBe(mine());
    expect(row(step.id)).toMatchObject({ status: "queued", external_id: null });
    // This process stops: the other launches the step again with its wait kept (the same start, more tries), not a new one.
    await drainHere(step.id);
    expect(await until(() => turnOf(step.id) === theirs && (healOf(step.id)?.tries ?? 0) > before.tries, () => app2.tick())).toBe(true);
    expect(healOf(step.id)?.since).toBe(before.since);
    expect(getGeneration(step.id)?.waiting).toBeTruthy();
    gpuBack();
    expect(await until(() => ended(step.id), () => app2.tick())).toBe(true);
    expect(row(step.id).status, row(step.id).error ?? "").toBe("succeeded");
    expect(prompts(), "the step was sent once").toBe(1);
  });
});

/** The account's first run, done on the GPU with a picture, and the next step of its longer run (not launched yet). */
async function doneRunAndStep(): Promise<{ first: string; step: string }> {
  fake.opts.output = "both";
  const first = await startRun();
  expect(await until(() => ended(first))).toBe(true);
  expect(row(first).status, row(first).error ?? "").toBe("succeeded");
  const pic = await uploadPng();
  fake.log.length = 0;
  const [step] = asAccount(a, () =>
    createGenerations({ feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "", inputs: { images: [pic] } } as Parameters<typeof createGenerations>[0], { dependsOn: first }),
  );
  return { first, step: step.id };
}
const metaOf = (id: string) => JSON.parse(row(id).external_meta_json || "{}") as { sending?: number; lease?: { by: string; until: number }; heal?: Heal };
const both = () => Promise.all([tick(), app2.tick()]).then(() => {});

describe("a server that is stopping", () => {
  it("launches no new step of a longer run: the other process launches it, and it is sent once", async () => {
    const { step } = await doneRunAndStep();
    shutdown().draining = true;
    for (let i = 0; i < 3; i++) await tick();
    expect(turnOf(step), "not taken here").toBeNull();
    expect(row(step)).toMatchObject({ status: "queued", external_id: null });
    expect(prompts()).toBe(0);
    expect(await until(() => ended(step), () => app2.tick())).toBe(true);
    expect(row(step).status, row(step).error ?? "").toBe("succeeded");
    expect(prompts(), "sent once, by the process that goes on").toBe(1);
  });

  it("leaves a step whose first send it had begun unsent and unmarked: the other process launches it, and it is sent once", async () => {
    const { step } = await doneRunAndStep();
    // The server starts to stop while the step's picture goes to the GPU (after the step was taken here).
    fake.opts.answer = (m, p) => {
      if (m === "POST" && p === "/upload/image") shutdown().draining = true;
      return undefined;
    };
    await tick();
    expect(await until(() => shutdown().draining && !globalThis.__fuobeSubmitting?.has(step), async () => {})).toBe(true);
    fake.opts.answer = undefined;
    expect(turnOf(step), "its turn went back").toBeNull();
    expect(row(step)).toMatchObject({ status: "queued", external_id: null });
    expect(metaOf(step).sending, "never marked as being sent").toBeUndefined();
    expect(prompts()).toBe(0);
    expect(await until(() => ended(step), () => app2.tick())).toBe(true);
    expect(row(step).status, row(step).error ?? "").toBe("succeeded");
    expect(prompts(), "sent once").toBe(1);
  });
});

describe("a process that stalls while it sends a run", () => {
  it("once another process took the run's turn, it never marks or sends it: the run is sent once, by the one that took it", async () => {
    gpuStarting();
    const id = await startRun();
    expect(await until(() => waiting(id))).toBe(true);
    // Its GPU is back; the picture this process sends it is slow to land.
    let slowed = 0;
    fake.opts.slow = (m, p) => (m === "POST" && p === "/upload/image" && !slowed++ ? 8000 : 0);
    gpuBack();
    expect(await until(() => slowed > 0)).toBe(true);
    // Meanwhile this process stalls (no beat for 20 s), and the other takes the wait over.
    clearInterval(globalThis.__fuobeBeat);
    globalThis.__fuobeBeat = undefined;
    db().prepare("UPDATE app_processes SET seen_at = ? WHERE token = ?").run(Date.now() - QUIET_MS - 1000, mine());
    expect(await until(() => ended(id), () => app2.tick())).toBe(true);
    expect(row(id).status, row(id).error ?? "").toBe("succeeded");
    // This process's slow send lands after that: it sends nothing.
    for (let i = 0; i < 600 && globalThis.__fuobeSubmitting?.has(id); i++) await sleep(20);
    expect(globalThis.__fuobeSubmitting?.has(id)).toBe(false);
    const sends = fake.log.map((e) => `${e.method} ${e.path}`);
    expect(sends.lastIndexOf("POST /upload/image"), "its picture landed after the run was sent (by the other process)").toBeGreaterThan(sends.indexOf("POST /prompt"));
    expect(row(id).status).toBe("succeeded");
    expect(prompts(), "sent once, by the process that took it").toBe(1);
    // (This process says it runs again: its beat starts with the runner.)
    ensureRunner();
    expect(globalThis.__fuobeBeat).toBeDefined();
  });
});

/** The release before marked a run it held with a lease (OLD_LEASE), held by `by` until `until`. */
const leaseBy = (id: string, by: string, until: number) =>
  db().prepare("UPDATE generations SET external_meta_json = json_set(CASE WHEN json_valid(external_meta_json) THEN external_meta_json ELSE '{}' END, '$.lease', json_object('by', ?, 'until', ?)) WHERE id = ?").run(by, until, id);
/** That release's claim of a run (its code, as it is): true when it took the run. */
const oldClaim = (id: string, me: string) => {
  const now = Date.now();
  return (
    db()
      .prepare(
        `UPDATE generations SET external_meta_json = json_set(CASE WHEN json_valid(external_meta_json) THEN external_meta_json ELSE '{}' END, '$.lease', json(@lease))
         WHERE id = @id AND external_id IS NULL AND status IN ('queued', 'running')
           AND (NOT json_valid(external_meta_json) OR json_extract(external_meta_json, '$.lease.until') IS NULL
                OR json_extract(external_meta_json, '$.lease.until') < @now OR json_extract(external_meta_json, '$.lease.by') = @me)`,
      )
      .run({ id, now, me, lease: JSON.stringify({ by: me, until: now + 60_000 }) }).changes > 0
  );
};

describe("an instance of the release before on the same database (the first deploy of this release)", () => {
  it("a run it waits on (its live lease) is left to it by both processes; once its lease runs out, one of them goes on with the wait and sends it once", async () => {
    gpuStarting();
    const id = await startRun();
    expect(await until(() => waiting(id))).toBe(true);
    await drainHere(id);
    shutdown().draining = false;
    const before = healOf(id)!;
    leaseBy(id, "old-instance", Date.now() + 60_000);
    for (let i = 0; i < 3; i++) await both();
    expect(turnOf(id), "neither takes it").toBeNull();
    expect(row(id)).toMatchObject({ status: "queued", external_id: null });
    expect(healOf(id)?.tries).toBe(before.tries);
    expect(prompts()).toBe(0);
    gpuBack();
    leaseBy(id, "old-instance", Date.now() - 1);
    expect(await until(() => ended(id), both)).toBe(true);
    expect(row(id).status, row(id).error ?? "").toBe("succeeded");
    expect(prompts(), "sent once").toBe(1);
  });

  it("a step of a longer run it is launching (its live lease) is left to it; once its lease runs out, one of them launches it, sent once", async () => {
    const { step } = await doneRunAndStep();
    leaseBy(step, "old-instance", Date.now() + 60_000);
    for (let i = 0; i < 3; i++) await both();
    expect(turnOf(step)).toBeNull();
    expect(row(step)).toMatchObject({ status: "queued", external_id: null });
    expect(prompts()).toBe(0);
    leaseBy(step, "old-instance", Date.now() - 1);
    expect(await until(() => ended(step), both)).toBe(true);
    expect(row(step).status, row(step).error ?? "").toBe("succeeded");
    expect(prompts(), "sent once").toBe(1);
  });

  it("a run whose turn this process holds carries its lease, which that release reads as held; the beat renews it, and it goes with the turn", async () => {
    gpuStarting();
    const id = await startRun();
    expect(await until(() => waiting(id))).toBe(true);
    expect(turnOf(id)).toBe(mine());
    expect(metaOf(id).lease?.by).toBe(mine());
    expect(metaOf(id).lease!.until).toBeGreaterThan(Date.now() + 30_000);
    expect(oldClaim(id, "old-instance"), "that release can't take it").toBe(false);
    // About to run out: the beat (every 5 s) renews it.
    leaseBy(id, mine(), Date.now() + 2000);
    expect(await until(() => metaOf(id).lease!.until > Date.now() + 30_000, async () => {}, 8000)).toBe(true);
    expect(oldClaim(id, "old-instance")).toBe(false);
    // This process stops: the turn goes, and the lease with it, so that release may go on with the run at once.
    await drainHere(id);
    expect(turnOf(id)).toBeNull();
    expect(metaOf(id).lease).toBeUndefined();
    expect(oldClaim(id, "old-instance")).toBe(true);
    db().prepare("UPDATE generations SET status = 'canceled' WHERE id = ?").run(id);
  });
});

// Last: the other process is killed here.
describe("a process cut off in the middle of a send", () => {
  it("the run it was sending is never sent a second time: it ends in plain words once that process has gone quiet", async () => {
    gpuStarting();
    const id = await startRun();
    expect(await until(() => waiting(id))).toBe(true);
    await drainHere(id);
    // The other process takes the wait over; its GPU is back, and the job is sent, but the answer never comes back:
    // the other process is killed before it can note the job.
    fake.opts.hold = (m, p) => m === "POST" && p === "/prompt";
    gpuBack();
    expect(await until(() => prompts() > 0, () => app2.tick())).toBe(true);
    expect(typeof healOf(id)?.sending, "marked as being sent").toBe("number");
    expect(turnOf(id)).toBe(theirs);
    await app2.kill();
    shutdown().draining = false;
    // While its process may still be running (not yet quiet for 20 s), the run is left to it.
    await tick();
    expect(row(id)).toMatchObject({ status: "queued", external_id: null });
    // 20 s with no word from it: this process's next look ends the run, and sends nothing.
    db().prepare("UPDATE app_processes SET seen_at = ? WHERE token = ?").run(Date.now() - QUIET_MS - 1000, theirs);
    expect(await until(() => ended(id))).toBe(true);
    expect(row(id)).toMatchObject({ status: "failed", error: "This run was interrupted while it was being sent. Press Retry." });
    expect(getGeneration(id)?.notBilled, "its GPU may have it").toBeUndefined();
    fake.dropHeld();
    for (let i = 0; i < 5; i++) await tick();
    expect(prompts(), "one job across both processes").toBe(1);
    expect(row(id).status).toBe("failed");
  });
});
