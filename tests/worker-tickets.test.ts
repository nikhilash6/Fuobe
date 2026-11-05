/**
 * Job tickets and the PC's ceiling on the workers' line (src/server/computer/pool.ts) and in the worker program
 * (bin/lib/worker/run.mjs), against the studio's real routes and the worker's own stand-in ComfyUI (a process of its
 * own, behind the worker's guard). Never a real ComfyUI, never a GPU.
 *
 * - An account's task hands out its ticket, never a graph; the owner's own job keeps its graph.
 * - A ticket outside the PC's ceiling, or made for another catalog, is never claimed; the studio's allowed lanes only
 *   narrow inside the ceiling; a worker built from another catalog says "update the worker" and still takes the
 *   owner's own jobs.
 * - A ticket a worker refuses before running it costs the run nothing, and goes to another worker.
 * - The worker composes an account's ticket itself and renders it; a studio that sends a raw graph for an account's
 *   task, or a job past the PC's ceiling, is refused and its ComfyUI never sees it.
 * - `fuobe worker setup` saves the ceiling, and a run of setup again changes it.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { worker as workerCommand } from "../bin/lib/worker/index.mjs";
import { runWorker } from "../bin/lib/worker/run.mjs";
import { inputRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";
import { FAKE_PNG } from "./helpers/fake-local-comfy";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

const dir = tempDir("fuobe-worker-tickets-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const { comfyProvider } = await import("@/server/providers/comfyui");
const hosted = await import("@/server/hosted");
const { getModel } = await import("@/lib/catalog");
const { encodePng } = await import("@/lib/png-encode");
const { withoutSaveMetadata } = await import("@/lib/comfy-compose");
const { allLanes } = await import("@/lib/lanes");
const { loadIndex } = await import("@/server/gpu/index-file");
const { ComputerRunner } = await import("@/lib/computer-runner");
const composer = await import("@/lib/ticket-compose");

const ROOT = path.resolve(__dirname, "..");
const FAKE = path.join(ROOT, "tests/helpers/fake-local-comfy.ts");
const SITE = "http://127.0.0.1:9";
const RULES = inputRules(readCatalog(ROOT));
const ALLOWED = new Set(["LoadImage", "ImageInvert", "SaveImage", "KSampler"]);
const VERSION = catalogVersion()!;
const OTHER = "e".repeat(64);
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

let routes: ComputerRoutes;
let accountId = "";
beforeAll(async () => {
  routes = await loadRoutes();
  setSetting("comfyWhere", "workers");
  auth.setPassword("install password");
  accountId = auth.createAccount("tickets@example.com", "long enough").id;
});
afterAll(() => {
  globalThis.__fuobeTestDiskFree = undefined;
  delete process.env.FUOBE_HOSTED_RUNS;
});
beforeEach(() => {
  resetRates();
  delete process.env.FUOBE_HOSTED_RUNS;
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

type W = { id: string; token: string };
type TaskRow = import("@/server/computer/tasks").TaskRow;
const row = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as TaskRow;
const workerRow = (w: { id: string }) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as import("@/server/computer/workers").WorkerRow;
const LANE = pool.poolLane("selftest-image");

/** A worker the owner added and resumed, all day, allowed every lane, able to run every workflow. */
function addWorker(): W {
  const w = pool.addWorker(`pc-${Math.random().toString(36).slice(2, 8)}`);
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  const workflows = (JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/manifest.json"), "utf8")) as { workflows: { id: string }[] }).workflows.map((x) => x.id);
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  return w;
}

/** A worker's beat as the program sends it: its catalog version and its PC's ceiling. */
const beat = (w: W, o: { catalogVersion?: string | null; ceiling?: unknown } = {}) =>
  pool.workerBeat(
    workerRow(w),
    pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 3, version: "1", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], catalogVersion: o.catalogVersion === undefined ? VERSION : o.catalogVersion, ...(o.ceiling !== undefined && { ceiling: o.ceiling }) }),
  );
const claim = (w: W) => pool.workerClaim(workerRow(w), []);

let gens = 0;
function generation(account: string | null) {
  const gid = `tickets-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'oss-selftest-image', 'open', 'comfyui', 'edit', 'image', 'queued', ?, '[]', ?, ?)")
    .run(gid, JSON.stringify(account ? { account, place: "pool" } : {}), now, now);
  return gid;
}

/** A 1600 × 1200 picture (about 1.9 MP). */
const PICTURE = encodePng({ width: 1600, height: 1200, data: Buffer.alloc(1600 * 1200 * 4, 128) });

/**
 * An account's run of the self-test workflow (it inverts a picture), as the studio queues it for the workers: its
 * picture sent and its job submitted on this install's GPUs, which makes the task and its ticket.
 */
async function accountTask() {
  const gid = generation(accountId);
  const route = { provider: "comfyui", endpoint: "selftest-image", op: "edit" } as never;
  const { picture, sent } = await hosted.runOnPool(accountId, async () => {
    const name = (await comfyProvider.prepareFile!(PICTURE, "image/png", "me.png", route))!;
    return { picture: name, sent: await comfyProvider.submit({ route, input: { images: [name], seed: 5 }, generationId: gid, model: getModel("oss-selftest-image") } as never) };
  });
  const id = String((sent.meta as { relay: string }).relay);
  return { id, gid, graph: withoutSaveMetadata(sent.payload as never), picture };
}

/** The owner's own job on the workers: a whole graph, in the owner's class. */
function ownerTask() {
  const gid = generation(null);
  const picture = tasks.stageInput("owner", FAKE_PNG, "image/png", "in.png");
  const graph = { "1": { class_type: "LoadImage", inputs: { image: picture } }, "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } }, "9": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "fuobe/owner-test" } } };
  const t = tasks.createTask({ principal: "owner", generationId: gid, graph, workflowId: "selftest-image", pool: pool.poolFields("selftest-image", { class: "owner" }) });
  return { id: t.id, gid, graph };
}

describe("the line hands out tickets inside each PC's ceiling", () => {
  it("an account's task carries its ticket and its limits, never a graph; the owner's own job keeps its graph", async () => {
    const w = addWorker();
    beat(w);
    const mine = await accountTask();
    expect(row(mine.id).graph_json).toBeNull();
    const got = claim(w)!;
    expect(got.id).toBe(mine.id);
    expect(got.graph).toBeUndefined();
    expect(got.class).toBe("free");
    expect(got.ticket).toMatchObject({ workflowId: "selftest-image", catalogVersion: VERSION, op: "edit", settings: { seed: 5 }, outputs: { count: 1, kind: "image" } });
    expect(got.ticket!.inputs).toEqual([expect.objectContaining({ slot: "images.0", name: mine.picture, kind: "image" })]);
    expect(got.ticket!.runLimitMs).toBe(got.runLimitMs);
    expect(got.ticket!.stallMs).toBe(got.stallMs);
    // Through JSON, the claim's way, the ticket composes the graph the studio built.
    const composed = await composer.composeTicket(
      { ticket: JSON.parse(JSON.stringify(got.ticket)), generationId: got.generationId, inputs: got.inputs },
      { catalog: { has: (id) => id === "selftest-image", get: (await import("@/server/providers/comfyui")).getWorkflow }, catalogVersion: VERSION },
    );
    expect(composed.ok && composed.graph).toEqual(mine.graph);
    tasks.endTask(mine.id, "canceled");
    const own = ownerTask();
    const theirs = claim(w)!;
    expect(theirs.id).toBe(own.id);
    expect(theirs.ticket).toBeUndefined();
    expect(theirs.graph).toEqual(own.graph);
    expect(theirs.class).toBe("owner");
  });

  it("a ticket outside the PC's ceiling is never claimed, and the studio's lanes only narrow inside it", async () => {
    const w = addWorker();
    const mine = await accountTask();
    const size = JSON.parse(row(mine.id).needs_json!).size as { megapixels: number };
    expect(size.megapixels).toBeGreaterThan(0);
    for (const ceiling of [{ maxMegapixels: size.megapixels / 2 }, { workflows: ["video-trim"] }, { lanes: ["0123456789ab"] }]) {
      const a = beat(w, { ceiling });
      expect(a.claimableNow, JSON.stringify(ceiling)).toBe(0);
      expect(claim(w), JSON.stringify(ceiling)).toBeNull();
    }
    // The owner allowed every lane; the PC allows one: its beat hears that one only.
    const narrowed = beat(w, { ceiling: { lanes: [LANE] } });
    expect(narrowed.worker.lanes.length).toBeGreaterThan(1);
    expect(narrowed.worker.lanesInside).toEqual([LANE]);
    expect(pool.workerView(workerRow(w)).ceiling).toEqual({ lanes: [LANE] });
    // Inside it: claimed.
    expect(beat(w, { ceiling: { maxMegapixels: size.megapixels * 2, workflows: ["selftest-image"], maxOutputs: 4 } }).claimableNow).toBe(1);
    expect(claim(w)?.id).toBe(mine.id);
  });

  it("a worker built from another catalog takes no ticket, says to update, and still takes the owner's own jobs", async () => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    const w = addWorker();
    const mine = await accountTask();
    beat(w, { catalogVersion: OTHER });
    expect(pool.workerState(workerRow(w)).state).toBe("update-worker");
    expect(pool.workerView(workerRow(w))).toMatchObject({ catalogVersion: OTHER, catalogCurrent: false, state: "update-worker" });
    expect(claim(w)).toBeNull();
    // Too old to say: the same.
    beat(w, { catalogVersion: null });
    expect(claim(w)).toBeNull();
    const own = ownerTask();
    expect(claim(w)?.id).toBe(own.id);
    tasks.endTask(own.id, "canceled");
    // Updated: it takes the ticket, and reads as ready.
    beat(w);
    expect(pool.workerState(workerRow(w)).state).toBe("idle");
    expect(claim(w)?.id).toBe(mine.id);
    // With hosted runs off, a worker's catalog never changes its state.
    delete process.env.FUOBE_HOSTED_RUNS;
    beat(w, { catalogVersion: OTHER });
    expect(pool.workerState(workerRow(w)).state).not.toBe("update-worker");
  });

  it("a ticket a worker refuses before running it costs nothing, and goes to another worker", async () => {
    const a = addWorker();
    const b = addWorker();
    beat(a);
    const mine = await accountTask();
    for (const why of ["update-worker", "outside-ceiling"] as const) {
      const got = claim(a)!;
      expect(got.id).toBe(mine.id);
      tasks.report(row(mine.id), { event: "give-back", why }, () => ({ error: "unused" }));
      const back = row(mine.id);
      expect(back.state).toBe("waiting");
      expect(back.requeues).toBe(0);
      expect(back.claimed_at).toBeNull();
      // Never offered to that worker again.
      beat(a);
      expect(claim(a)).toBeNull();
      // Another worker takes it.
      beat(b);
      expect(claim(b)?.id).toBe(mine.id);
      tasks.report(row(mine.id), { event: "give-back", why }, () => ({ error: "unused" }));
      expect(row(mine.id).requeues).toBe(0);
      db().prepare("UPDATE relay_tasks SET extra_json = NULL WHERE id = ?").run(mine.id);
    }
    // A ticket it can't use fails the run.
    beat(a);
    claim(a);
    tasks.report(row(mine.id), { event: "failed", reason: "bad-ticket" }, () => ({ error: "unused" }));
    expect(row(mine.id).state).toBe("failed");
  });

  it("a worker that refused a ticket is offered it again once its ceiling or its build changes", async () => {
    const a = addWorker();
    beat(a, { ceiling: { maxOutputs: 4 } });
    const mine = await accountTask();
    expect(claim(a)?.id).toBe(mine.id);
    tasks.report(row(mine.id), { event: "give-back", why: "outside-ceiling" }, () => ({ error: "unused" }));
    // No worker ran it: it waits as a task no worker took, so its wait limit still holds.
    expect(row(mine.id).claimed_at).toBeNull();
    beat(a, { ceiling: { maxOutputs: 4 } });
    expect(claim(a)).toBeNull();
    beat(a, { ceiling: { maxOutputs: 8 } });
    expect(claim(a)?.id).toBe(mine.id);
    tasks.report(row(mine.id), { event: "give-back", why: "update-worker" }, () => ({ error: "unused" }));
    beat(a, { ceiling: { maxOutputs: 8 } });
    expect(claim(a)).toBeNull();
    // Its catalog and its ceiling as they were when it refused: still not offered, whatever it said in between.
    beat(a, { catalogVersion: OTHER, ceiling: { maxOutputs: 8 } });
    beat(a, { ceiling: { maxOutputs: 8 } });
    expect(claim(a)).toBeNull();
    beat(a, { ceiling: { maxOutputs: 9 } });
    expect(claim(a)?.id).toBe(mine.id);
  });

  it("a task that a worker took before keeps that claim's time when another worker refuses its ticket", async () => {
    const a = addWorker();
    const b = addWorker();
    beat(a);
    beat(b, { ceiling: { maxOutputs: 4 } });
    const mine = await accountTask();
    expect(claim(a)?.id).toBe(mine.id);
    const first = row(mine.id).claimed_at;
    expect(first).toBeTruthy();
    // Its worker let it go (a pause): back in line at no cost.
    expect(pool.backInLine(row(mine.id), { blame: false })).toBe(true);
    expect(claim(b)?.id).toBe(mine.id);
    tasks.report(row(mine.id), { event: "give-back", why: "outside-ceiling" }, () => ({ error: "unused" }));
    expect(row(mine.id)).toMatchObject({ state: "waiting", claimed_at: first, requeues: 0 });
  });

  it("a run that started keeps its claim's time when its worker, back after a restart, refuses its ticket, as an attempt", async () => {
    const w = addWorker();
    beat(w);
    const mine = await accountTask();
    const got = claim(w)!;
    expect(got.id).toBe(mine.id);
    const first = row(mine.id).claimed_at;
    tasks.report(row(mine.id), { event: "sent", promptId: got.promptId }, () => ({ error: "unused" }));
    tasks.report(row(mine.id), { event: "running", value: 1, max: 4 }, () => ({ error: "unused" }));
    // Its wait limit has passed since: it no longer applies to a run that started.
    db().prepare("UPDATE relay_tasks SET not_after = ? WHERE id = ?").run(Date.now() - 60_000, mine.id);
    // The worker starts again (an update), takes its own job back, and its new build refuses the ticket.
    expect(pool.workerClaim(workerRow(w), [])?.id).toBe(mine.id);
    tasks.report(row(mine.id), { event: "give-back", why: "update-worker" }, () => ({ error: "unused" }));
    // Not on the claim that took it from the line: an attempt, as any other give-back.
    expect(row(mine.id)).toMatchObject({ state: "waiting", claimed_at: first, requeues: 1 });
    pool.sweepPool();
    expect(row(mine.id)).toMatchObject({ state: "waiting", claimed_at: first });
    // A worker that refuses it on the claim that took it from the line, before anything ran, leaves that claim's time
    // as it was too, at no cost.
    const b = addWorker();
    beat(b);
    expect(claim(b)?.id).toBe(mine.id);
    tasks.report(row(mine.id), { event: "give-back", why: "outside-ceiling" }, () => ({ error: "unused" }));
    expect(row(mine.id)).toMatchObject({ state: "waiting", claimed_at: first, requeues: 1 });
  });

  it("refusals that come after anything ran count as attempts, so they can never keep a run in line for good", async () => {
    const w = addWorker();
    beat(w);
    const mine = await accountTask();
    for (let i = 0; i < pool.MAX_ATTEMPTS; i++) {
      // Each time a build of its own it says it has (its refusal is then never the same one twice).
      beat(w, { ceiling: { maxOutputs: 4 + i } });
      const got = claim(w)!;
      expect(got.id).toBe(mine.id);
      tasks.report(row(mine.id), { event: "sent", promptId: got.promptId }, () => ({ error: "unused" }));
      tasks.report(row(mine.id), { event: "give-back", why: "outside-ceiling" }, () => ({ error: "unused" }));
    }
    expect(row(mine.id)).toMatchObject({ state: "failed", error: pool.GAVE_BACK_WORDS });
  });

  it("a job larger than every PC may ever make is refused before it is queued, the owner's and an account's alike", async () => {
    const { NO_WORKER_FOR_SIZE, POOL_TOO_BIG } = await import("@/server/providers/comfyui");
    const w = addWorker();
    // The picture is about 1.9 MP; the only PC makes at most 1 MP.
    beat(w, { ceiling: { maxMegapixels: 1 } });
    expect(pool.workersCanRun("selftest-image")).toBe(true);
    expect(pool.workersCanRun("selftest-image", { size: { megapixels: 1.9, seconds: 0, outputs: 1 } })).toBe(false);
    const before = db().prepare("SELECT COUNT(*) FROM relay_tasks").pluck().get() as number;
    await expect(accountTask()).rejects.toThrow(POOL_TOO_BIG);
    const route = { provider: "comfyui", endpoint: "selftest-image", op: "edit" } as never;
    const ownerJob = async () => {
      const name = (await comfyProvider.prepareFile!(PICTURE, "image/png", "me.png", route))!;
      return comfyProvider.submit({ route, input: { images: [name], seed: 5 }, generationId: generation(null), model: getModel("oss-selftest-image") } as never);
    };
    await expect(ownerJob()).rejects.toThrow(NO_WORKER_FOR_SIZE);
    // Nothing waits in line for nothing.
    expect(db().prepare("SELECT COUNT(*) FROM relay_tasks").pluck().get()).toBe(before);
    // A PC that makes it: both go in line.
    beat(w, { ceiling: { maxMegapixels: 4 } });
    const mine = await accountTask();
    expect(row(mine.id).state).toBe("waiting");
    const own = await ownerJob();
    expect(row(String((own.meta as { relay: string }).relay)).state).toBe("waiting");
  });

  it("a waiting task whose ticket was made for the catalog before an update gets its ticket made again, with its place kept", async () => {
    const { refreshTickets } = await import("@/server/computer/ticket-refresh");
    const w = addWorker();
    beat(w);
    const mine = await accountTask();
    const gone = await accountTask();
    const rankAt = row(mine.id).rank_at;
    // Both made before the update; one names a workflow the catalog no longer has.
    for (const [id, workflowId] of [
      [mine.id, "selftest-image"],
      [gone.id, "a-retired-workflow"],
    ]) {
      const ticket = { ...JSON.parse(row(id).ticket_json!), catalogVersion: OTHER, workflowId };
      const needs = { ...JSON.parse(row(id).needs_json!), catalogVersion: OTHER };
      db().prepare("UPDATE relay_tasks SET ticket_json = ?, needs_json = ?, extra_json = ? WHERE id = ?").run(JSON.stringify(ticket), JSON.stringify(needs), JSON.stringify({ refusedBy: ["someone:0000"] }), id);
    }
    expect(claim(w)).toBeNull();
    expect(await refreshTickets()).toEqual({ refreshed: 1, ended: 1 });
    const fresh = row(mine.id);
    expect(JSON.parse(fresh.ticket_json!)).toMatchObject({ catalogVersion: VERSION, workflowId: "selftest-image" });
    expect(JSON.parse(fresh.needs_json!).catalogVersion).toBe(VERSION);
    expect(JSON.parse(fresh.extra_json ?? "{}").refusedBy).toBeUndefined();
    expect(fresh.rank_at).toBe(rankAt);
    expect(row(gone.id)).toMatchObject({ state: "failed", error: pool.GAVE_BACK_WORDS });
    // Nothing left to do the second time.
    expect(await refreshTickets()).toEqual({ refreshed: 0, ended: 0 });
    expect(claim(w)?.id).toBe(mine.id);
  });

  it("while a deploy's two app processes share the line, only the newest makes tickets again, and an older one never ends a run", async () => {
    const { refreshTickets } = await import("@/server/computer/ticket-refresh");
    db().prepare("DELETE FROM catalog_processes").run();
    try {
      const w = addWorker();
      beat(w);
      const mine = await accountTask();
      // A ticket the older process's catalog has no workflow for: only the newest catalog knows it.
      const newer = await accountTask();
      db().prepare("UPDATE relay_tasks SET ticket_json = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(row(newer.id).ticket_json!), workflowId: "a-workflow-only-the-new-catalog-has" }), newer.id);
      const was = { mine: row(mine.id), newer: row(newer.id) };
      const t0 = Date.now();
      // The new process (this studio's version) started a minute after the old one, and says so.
      expect(await refreshTickets({ version: VERSION, startedAt: t0, now: t0 })).toEqual({ refreshed: 0, ended: 0 });
      // The old one, still serving claims, leaves both tickets as they are: never made for its older catalog, never ended.
      expect(await refreshTickets({ version: OTHER, startedAt: t0 - 60_000, now: t0 + 1000 })).toEqual({ refreshed: 0, ended: 0 });
      for (const id of [mine.id, newer.id]) {
        const now = row(id);
        const before = id === mine.id ? was.mine : was.newer;
        expect(now).toMatchObject({ state: "waiting", ticket_json: before.ticket_json, needs_json: before.needs_json });
      }
      // A worker built for the new catalog still takes the run.
      expect(claim(w)?.id).toBe(mine.id);
      tasks.endTask(mine.id, "canceled");
      // A rollback: a process of the older version that started later is the newest now, and only it makes tickets again.
      const back = await accountTask();
      expect(await refreshTickets({ version: OTHER, startedAt: t0 + 60_000, now: t0 + 61_000 })).toMatchObject({ refreshed: 1 });
      expect(JSON.parse(row(back.id).ticket_json!).catalogVersion).toBe(OTHER);
      expect(await refreshTickets({ version: VERSION, startedAt: t0, now: t0 + 62_000 })).toEqual({ refreshed: 0, ended: 0 });
      expect(JSON.parse(row(back.id).ticket_json!).catalogVersion).toBe(OTHER);
      // A process that went quiet for minutes has stopped: the one left makes them again for its catalog.
      expect(await refreshTickets({ version: VERSION, startedAt: t0, now: t0 + 61_000 + 6 * 60_000 })).toMatchObject({ refreshed: 1 });
      expect(JSON.parse(row(back.id).ticket_json!).catalogVersion).toBe(VERSION);
    } finally {
      db().prepare("DELETE FROM catalog_processes").run();
    }
  });

  it("a ticket made again for a new catalog gets the files its graph makes made again, and its lane and needs from the new catalog", async () => {
    const { refreshTickets } = await import("@/server/computer/ticket-refresh");
    db().prepare("DELETE FROM catalog_processes").run();
    try {
      const w = addWorker();
      beat(w);
      // A palette transfer: the composer makes the palette's swatch picture itself, and the ticket names it.
      const gid = generation(accountId);
      const route = { provider: "comfyui", endpoint: "palette-transfer-image", op: "color-match" } as never;
      const sent = await hosted.runOnPool(accountId, async () => {
        const name = (await comfyProvider.prepareFile!(PICTURE, "image/png", "me.png", route))!;
        return comfyProvider.submit({ route, input: { images: [name], palette: ["#112233", "#ddeeff", "#884422"], seed: 7 }, generationId: gid, model: getModel("oss-palette-image") } as never);
      });
      const id = String((sent.meta as { relay: string }).relay);
      const fresh = row(id);
      const ticket = JSON.parse(fresh.ticket_json!) as import("@/lib/job-ticket").JobTicket;
      const made = ticket.inputs.find((i) => i.slot.startsWith("made."))!;
      expect(made).toBeTruthy();
      const want = { lane: fresh.lane, needs: JSON.parse(fresh.needs_json!) };
      // As it was before an update that changed how the swatch is drawn: other bytes, staged under its name, another
      // catalog, and a lane and needs from that catalog.
      const old = tasks.inputsOf(id).find((i) => i.name === made.name)!;
      const oldBytes = Buffer.from("a swatch drawn by an older composer");
      fs.writeFileSync(path.join(dir, "relay", "in", made.name), oldBytes);
      db().prepare("UPDATE relay_inputs SET sha256 = ? WHERE name = ?").run(sha(oldBytes.toString()), old.name);
      const before = { ...ticket, catalogVersion: OTHER, inputs: ticket.inputs.map((i) => (i.name === made.name ? { ...i, sha256: sha(oldBytes.toString()) } : i)) };
      db()
        .prepare("UPDATE relay_tasks SET ticket_json = ?, needs_json = ?, lane = ? WHERE id = ?")
        .run(JSON.stringify(before), JSON.stringify({ workflowId: "palette-transfer-image", files: [], packs: [], minVramBytes: 0, catalogVersion: OTHER }), "small", id);
      expect(claim(w)).toBeNull();
      expect(await refreshTickets()).toEqual({ refreshed: 1, ended: 0 });
      const after = row(id);
      const next = JSON.parse(after.ticket_json!) as import("@/lib/job-ticket").JobTicket;
      const swatch = next.inputs.find((i) => i.slot === made.slot)!;
      // The swatch as this catalog draws it, staged as the task's in place of the old one.
      expect(swatch.sha256).toBe(made.sha256);
      expect(tasks.inputsOf(id).map((i) => i.name)).toContain(swatch.name);
      if (swatch.name !== made.name) expect(fs.existsSync(path.join(dir, "relay", "in", made.name))).toBe(false);
      expect(crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "relay", "in", swatch.name))).digest("hex")).toBe(made.sha256);
      // Its lane and what it needs, from this catalog; its place as it was.
      expect(after.lane).toBe(want.lane);
      expect(JSON.parse(after.needs_json!)).toEqual(want.needs);
      expect(after.rank_at).toBe(fresh.rank_at);
      // A worker built for this catalog takes it, and composes the very same swatch.
      const got = claim(w)!;
      expect(got.id).toBe(id);
      const out = await composer.composeTicket({ ticket: got.ticket, generationId: gid, inputs: tasks.inputsOf(id).map((i) => ({ name: i.name, sha256: i.sha256 })) }, { catalog: { has: () => true, get: (await import("@/server/providers/comfyui")).getWorkflow } as never, catalogVersion: VERSION });
      expect(out.ok, out.ok ? "" : out.detail).toBe(true);
    } finally {
      db().prepare("DELETE FROM catalog_processes").run();
    }
  });
});

// ---------------------------------------------------------------------------
// The worker program

interface Studio {
  calls: string[];
  reports: Record<string, unknown>[];
  /** Change what the studio answers (a studio that does what it shouldn't). */
  rewrite: ((p: string, body: unknown) => unknown) | null;
  /** Change what the worker sends (before the studio reads it). */
  send: ((p: string, body: Record<string, unknown>) => Record<string, unknown>) | null;
}
const studio = (): Studio => ({ calls: [], reports: [], rewrite: null, send: null });

/** fetch for the worker: the studio's routes for SITE (through the test's rewrites), its own ComfyUI for the rest. */
function router(w: W, s: Studio) {
  const api = apiAs(routes, null);
  return async (url: string, init: RequestInit = {}) => {
    if (!String(url).startsWith(SITE)) return realFetch(url, init);
    const u = new URL(url);
    const p = u.pathname + u.search;
    s.calls.push(`${init.method ?? "GET"} ${u.pathname}`);
    if (p === "/api/gpu/computer/inventory") return Response.json({ ok: true, lanes: [LANE], workflows: ["selftest-image"], missing: [] });
    let req = init;
    if (typeof init.body === "string" && init.body.startsWith("{")) {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (p.endsWith("/report")) s.reports.push(body);
      if (s.send) req = { ...init, body: JSON.stringify(s.send(p, body)) };
    }
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${w.token}`);
    const res = await api(p, req);
    if (!s.rewrite || !res.ok || res.status === 204 || !(res.headers.get("content-type") ?? "").includes("json")) return res;
    return Response.json(s.rewrite(p, await res.json()), { status: res.status });
  };
}

interface Pc {
  home: string;
  workDir: string;
  comfyDir: string;
  countFile: string;
  graphFile: string;
  logs: string[];
}
function pc(): Pc {
  const base = tempDir("fuobe-ticket-pc-");
  const p = { home: path.join(base, "home"), workDir: path.join(base, "work"), comfyDir: path.join(base, "comfy"), countFile: path.join(base, "prompts.txt"), graphFile: path.join(base, "graphs.jsonl"), logs: [] as string[] };
  for (const d of [p.home, p.workDir, p.comfyDir]) fs.mkdirSync(d, { recursive: true });
  return p;
}

const running: { ctrl: AbortController; done: Promise<unknown> }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    r.ctrl.abort();
    await r.done.catch(() => {});
  }
});

/** Start `fuobe worker run` in this process (its ComfyUI a stand-in process of its own). */
function start(w: W, s: Studio, p: Pc, o: { ceiling?: unknown; acceptGraphs?: boolean; pictures?: boolean } = {}) {
  const ctrl = new AbortController();
  const cfg = {
    site: SITE,
    token: w.token,
    comfyDir: p.comfyDir,
    workDir: p.workDir,
    modelDirs: [],
    comfyCommand: [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off", "--steps", "3", "--step-ms", "30", "--worker-guard", "1", "--count-file", p.countFile, "--graph-file", p.graphFile],
    comfyGuard: true,
    stallMin: 10,
    ffmpeg: null,
    ...(o.ceiling !== undefined && { ceiling: o.ceiling }),
    ...(o.acceptGraphs !== undefined && { acceptGraphs: o.acceptGraphs }),
  };
  const done = runWorker(cfg, {
    fetch: router(w, s),
    home: p.home,
    signal: ctrl.signal,
    requirements: { folders: [], files: {}, packs: {}, workflows: {} },
    ComputerRunner,
    rules: RULES,
    pins: {},
    allowed: ALLOWED,
    readGpu: async () => null,
    readGpuGen: async () => "8.9",
    ffmpegVersion: async () => null,
    awake: { set: () => {} },
    sleep: (ms: number) => sleep(Math.min(ms, 50)),
    log: (line: string) => void p.logs.push(line),
    composer,
    catalogVersion: VERSION,
    allLanes,
    ...(o.pictures === false && { canCleanPictures: false }),
  });
  const r = { ctrl, done };
  running.push(r);
  return r;
}

async function until<T>(fn: () => T | Promise<T>, ms = 60_000, every = 100): Promise<Exclude<T, false | null | undefined | 0 | "">> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as Exclude<T, false | null | undefined | 0 | "">;
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms`);
    await sleep(every);
  }
}
const ended = (id: string) => until(() => ["done", "failed", "canceled"].includes(row(id).state) && row(id), 90_000);
const prompts = (p: Pc) => (fs.existsSync(p.countFile) ? fs.readFileSync(p.countFile, "utf8").trim().split("\n").filter(Boolean).length : 0);
const graphsSent = (p: Pc) => (fs.existsSync(p.graphFile) ? fs.readFileSync(p.graphFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []);

describe("the worker program composes tickets and keeps to its PC's ceiling", () => {
  it("composes an account's ticket itself, renders it, and says its catalog and ceiling in its beat", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const mine = await accountTask();
    start(w, s, p, { ceiling: { workflows: ["selftest-image"], maxMegapixels: 50 } });
    const t = await ended(mine.id);
    expect(t.state, t.error ?? "").toBe("done");
    expect(fs.readFileSync(tasks.outputFile(mine.id, 0)).length).toBeGreaterThan(0);
    // Its ComfyUI got the graph the studio would have built, composed on the worker.
    expect(prompts(p)).toBe(1);
    expect(graphsSent(p)[0]).toEqual(mine.graph);
    // The studio heard its catalog, its ceiling and its GPU's generation.
    await until(() => JSON.parse(workerRow(w).facts_json ?? "{}").gpuGen === "8.9", 30_000);
    expect(workerRow(w).catalog_version).toBe(VERSION);
    expect(JSON.parse(workerRow(w).ceiling_json!)).toEqual({ workflows: ["selftest-image"], maxMegapixels: 50 });
  });

  it("a studio that sends a raw graph for an account's task is refused, and its ComfyUI never sees it", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const mine = await accountTask();
    // The hacked studio: the account's task comes with a graph of its own making in place of the ticket.
    const evil = { "1": { class_type: "LoadImage", inputs: { image: mine.picture } }, "9": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "fuobe/evil" } } };
    s.rewrite = (q, body) => {
      if (q !== "/api/gpu/computer/claim") return body;
      const { task } = body as { task: Record<string, unknown> };
      const { ticket: _t, ...rest } = task;
      void _t;
      return { task: { ...rest, graph: evil } };
    };
    start(w, s, p);
    const t = await ended(mine.id);
    expect(t.state).toBe("failed");
    expect(s.reports).toContainEqual({ event: "failed", reason: "bad-ticket" });
    expect(prompts(p)).toBe(0);
    expect(p.logs.some((l) => /Starting its own ComfyUI/.test(l))).toBe(true);
  });

  it("a raw graph that names no class is refused too", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const mine = await accountTask();
    s.rewrite = (q, body) => {
      if (q !== "/api/gpu/computer/claim") return body;
      const { task } = body as { task: Record<string, unknown> };
      const { ticket: _t, class: _c, ...rest } = task;
      void _t;
      void _c;
      return { task: { ...rest, graph: mine.graph } };
    };
    start(w, s, p);
    expect((await ended(mine.id)).state).toBe("failed");
    expect(s.reports).toContainEqual({ event: "failed", reason: "bad-ticket" });
    expect(prompts(p)).toBe(0);
  });

  it("a studio older than job tickets, whose graphs name no class, still gets the owner's own jobs run", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const own = ownerTask();
    // As such a studio answers: no catalog version in its beat answer, and no class on its jobs.
    s.rewrite = (q, body) => {
      if (q === "/api/gpu/computer/beat") {
        const b = body as { worker?: Record<string, unknown> };
        if (b.worker) delete b.worker.catalogVersion;
        return b;
      }
      if (q !== "/api/gpu/computer/claim") return body;
      const { task } = body as { task: Record<string, unknown> };
      const { class: _c, ...rest } = task;
      void _c;
      return { task: rest };
    };
    start(w, s, p);
    const t = await ended(own.id);
    expect(t.state, t.error ?? "").toBe("done");
    expect(prompts(p)).toBe(1);
  });

  it("with no picture tool in its checkout, it says an older protocol, so it takes the owner's own jobs and no account's ticket", async () => {
    const { MIN_PROTOCOL, TICKET_PROTOCOL } = pool;
    const { protocolOf, PROTOCOL } = await import("../bin/lib/worker/config.mjs");
    expect(protocolOf(true)).toBe(PROTOCOL);
    expect(protocolOf(false)).toBeLessThan(TICKET_PROTOCOL);
    expect(protocolOf(false)).toBeGreaterThanOrEqual(MIN_PROTOCOL);
    const w = addWorker();
    const s = studio();
    const p = pc();
    const mine = await accountTask();
    const own = ownerTask();
    start(w, s, p, { pictures: false });
    const t = await ended(own.id);
    expect(t.state, t.error ?? "").toBe("done");
    expect(workerRow(w).protocol).toBe(protocolOf(false));
    // The account's run was never offered to it: it waits in line, with no attempt counted.
    expect(row(mine.id)).toMatchObject({ state: "waiting", requeues: 0, claimed_at: null });
    expect(s.reports).not.toContainEqual(expect.objectContaining({ event: "give-back" }));
    expect(p.logs.some((l) => /pnpm install/.test(l))).toBe(true);
  });

  it("with acceptGraphs off, the owner's own whole graph is refused too", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const own = ownerTask();
    start(w, s, p, { acceptGraphs: false });
    const t = await ended(own.id);
    expect(t.state).toBe("failed");
    expect(s.reports).toContainEqual({ event: "failed", reason: "bad-ticket" });
    expect(prompts(p)).toBe(0);
  });

  it("a job past the PC's ceiling is given back at no cost, even when the studio sends it anyway", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const mine = await accountTask();
    // The studio never hears the ceiling (a studio that ignores it would send the job all the same).
    s.send = (q, body) => {
      if (q !== "/api/gpu/computer/beat") return body;
      const { ceiling: _c, ...rest } = body;
      void _c;
      return rest;
    };
    start(w, s, p, { ceiling: { maxMegapixels: 0.0001 } });
    await until(() => s.reports.some((r) => r.event === "give-back"));
    expect(s.reports).toContainEqual({ event: "give-back", why: "outside-ceiling" });
    expect(prompts(p)).toBe(0);
    const back = row(mine.id);
    expect(back.state).toBe("waiting");
    expect(back.requeues).toBe(0);
    expect(p.logs.some((l) => /more than this PC runs/.test(l))).toBe(true);
  });

  it("a ticket for another catalog is given back, and the worker says to update", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const mine = await accountTask();
    // The studio hears its own version from the worker, but the worker's build composes for another one.
    s.send = (q, body) => (q === "/api/gpu/computer/beat" ? { ...body, catalogVersion: VERSION } : body);
    const ctrl = new AbortController();
    const done = runWorker(
      { site: SITE, token: w.token, comfyDir: p.comfyDir, workDir: p.workDir, modelDirs: [], comfyCommand: [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off", "--steps", "3", "--step-ms", "30", "--worker-guard", "1", "--count-file", p.countFile], comfyGuard: true, ffmpeg: null },
      { fetch: router(w, s), home: p.home, signal: ctrl.signal, requirements: { folders: [], files: {}, packs: {}, workflows: {} }, ComputerRunner, rules: RULES, pins: {}, allowed: ALLOWED, readGpu: async () => null, ffmpegVersion: async () => null, awake: { set: () => {} }, sleep: (ms: number) => sleep(Math.min(ms, 50)), log: (line: string) => void p.logs.push(line), composer, catalogVersion: OTHER, allLanes },
    );
    running.push({ ctrl, done });
    await until(() => s.reports.some((r) => r.event === "give-back"));
    expect(s.reports).toContainEqual({ event: "give-back", why: "update-worker" });
    expect(prompts(p)).toBe(0);
    expect(row(mine.id).requeues).toBe(0);
    expect(p.logs.some((l) => /update the worker/.test(l))).toBe(true);
    expect(p.logs.some((l) => /The studio's catalog is another than this worker's/.test(l))).toBe(true);
  });
});

describe("setup saves the PC's ceiling", () => {
  it("asks for the lanes or workflows and the sizes, and a run of setup again changes them", async () => {
    const home = tempDir("fuobe-ticket-setup-home-");
    const comfyDir = tempDir("fuobe-ticket-setup-comfy-");
    fs.writeFileSync(path.join(comfyDir, "main.py"), "");
    const out: string[] = [];
    const setup = async (ceiling: string[], graphs = "") => {
      const answers = ["https://studio.example", `fuobe_wkr_${"a".repeat(43)}`, comfyDir, path.join(comfyDir, "models"), path.join(tempDir("fuobe-ticket-setup-work-"), "w"), "-", "n", ...ceiling, graphs];
      const io = { env: { FUOBE_WORKER_HOME: home }, home, stdout: { write: (x: string) => void out.push(x) }, stderr: { write: (x: string) => void out.push(x) }, ask: async () => answers.shift() ?? "" };
      const code = await workerCommand(["setup"], io);
      return { code, saved: JSON.parse(fs.readFileSync(path.join(home, "worker.json"), "utf8")) as Record<string, unknown> };
    };
    const first = await setup(["selftest-image, video-trim", "4", "12", "2"]);
    expect(first.code).toBe(0);
    expect(first.saved.ceiling).toEqual({ workflows: ["selftest-image", "video-trim"], maxMegapixels: 4, maxSeconds: 12, maxOutputs: 2 });
    expect(first.saved.acceptGraphs).toBe(true);
    expect(out.join("")).toMatch(/This PC runs selftest-image, video-trim, pictures up to 4 MP, clips up to 12 s, 2 results a run/);
    // Again: the old answers are the defaults; "all" and 0 take the ceiling off, and "n" takes tickets only.
    const again = await setup(["all", "0", "0", "0"], "n");
    expect(again.saved.ceiling).toBeUndefined();
    expect(again.saved.acceptGraphs).toBe(false);
    // A name that isn't in the catalog: nothing changes.
    const bad = await setup(["no-such-workflow"]);
    expect(bad.code).toBe(2);
    expect(bad.saved.acceptGraphs).toBe(false);
  });

  it("reads its GPU's generation from nvidia-smi once, and an older nvidia-smi that can't say leaves it unknown", async () => {
    const { parseGpuGen, readGpuGen } = await import("../bin/lib/worker/gpu.mjs");
    const state = path.join(tempDir("fuobe-ticket-smi-"), "smi.json");
    const smi = [process.execPath, path.join(ROOT, "tests/helpers/fake-nvidia-smi.mjs"), state];
    fs.writeFileSync(state, JSON.stringify({ usedMb: 300, tempC: 40, computeCap: "12.0", apps: [] }));
    expect(await readGpuGen(smi)).toBe("12.0");
    fs.writeFileSync(state, JSON.stringify({ usedMb: 300, tempC: 40, apps: [] }));
    expect(await readGpuGen(smi)).toBeNull();
    expect(parseGpuGen("8.9\n")).toBe("8.9");
    expect(parseGpuGen("300, 45")).toBeNull();
  });
});
