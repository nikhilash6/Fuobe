import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startLocalComfy, type LocalComfy } from "./helpers/fake-local-comfy";
import { apiAs, loadRoutes, sha256, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";
import { composeOnWorker } from "./helpers/ticket-worker";

/**
 * A chain's later steps of a run on this install's GPUs go there too: an account with no GPU and no key of its own presses
 * a preset that makes its end frame first (MiniMax H3's start-and-end-frame clip), and both steps go in line for the
 * workers and are run by one. A chain whose later step the workers can't run is said before anything is queued, in
 * the label of that step, never as a dead "Connect your GPU" after the first step ran.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-pool-chain-steps-");
process.env.FUOBE_DATA_DIR = dir;
// Nothing answers here: no test may reach a real ComfyUI on this machine.
const DEAD = "http://127.0.0.1:7";
process.env.COMFYUI_URL = DEAD;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_HOSTED_FREE;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const realFetch = globalThis.fetch;
let allowed: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (allowed.some((a) => url.startsWith(a))) return realFetch(input, init);
  return new Response("not reachable in this test", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const uploadsRoute = await import("@/app/api/uploads/route");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const pool = await import("@/server/computer/pool");
const billing = await import("@/server/billing");
const { loadManifest } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { getModel } = await import("@/lib/catalog");
const { ComputerRunner } = await import("@/lib/computer-runner");
const { CONNECT_GPU_MESSAGE } = await import("@/lib/guest-access");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const { TINY_PNG } = await import("./helpers/fake-comfy-runner");
const hosted = await import("@/server/hosted");
const { captureRun, createGenerations, getGeneration } = await import("@/server/generations");
const { withRunStamp } = await import("@/server/run-stamp");
const { visitorStatus } = await import("@/server/account-gpu");
const { needsGpu } = await import("@/server/pool-own-setup");
const { getPreset, PRESETS } = await import("@/lib/catalog");
const { presetRoutes } = await import("@/lib/catalog/preset-recipe-routes");
const { ownSetupLabel } = await import("@/lib/own-setup");
const { pickerRules, presetOwnSetup, tryFreeFor } = await import("@/lib/pool-rules");
const { checkedPool, placeRows, runPlace } = await import("@/lib/run-place");

const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const PRESET = "effect-nature-bloom";
const CLIP_MODEL = "oss-minimax-h3";

let comfy: LocalComfy;
let routes: ComputerRoutes;
let accountId = "";
let cookie = "";

beforeAll(async () => {
  comfy = await startLocalComfy({ cors: "*", steps: 2, stepMs: 10, latencyMs: 10 });
  allowed = [comfy.url];
  routes = await loadRoutes();
  auth.setPassword("install password");
  // No GPU and no key of its own: its runs go to this install's GPUs.
  accountId = auth.createAccount("chain-steps@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(accountId).value}`;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE"]) delete process.env[k];
  await comfy.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_HOSTED_FREE = "1";
  process.env.COMFYUI_URL = DEAD;
  setSetting("comfyWhere", "workers");
  setSetting("comfyUrl", "");
  setSetting("engineMode", "open");
  setSetting("demoMode", "off");
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

/** A worker the owner added and resumed, allowed every lane, able to run the given workflows (all of them by default). */
function standInWorker(workflows = loadManifest().workflows.map((x) => x.id)) {
  const w = pool.addWorker("stand-in");
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ?, catalog_version = ?, protocol = 3, seen_at = ?, paused_local = 0 WHERE id = ?")
    .run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows }), JSON.stringify({ vramBytes: 96 * 2 ** 30 }), catalogVersion(), Date.now(), w.id);
  return w;
}

function workerRunner(token: string) {
  return new ComputerRunner(
    {
      api: apiAs(routes, null, { authorization: `Bearer ${token}` }),
      local: (url, init) => realFetch(url, init),
      socket: (url) => new WebSocket(url) as never,
      sha256,
      origin: "http://localhost:3000",
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
      compose: (t) => composeOnWorker(t),
      beatExtra: () => ({ protocol: 3, version: "test", local: { paused: false, why: null, until: null }, gpu: { otherApps: [], tempC: null }, inventoryHash: null, warmLane: null, catalogVersion: catalogVersion() }),
    },
    { device: "worker", port: comfy.port, clientId: "worker-test" },
  );
}

const request = (url: string, body: unknown) => {
  const text = JSON.stringify(body);
  return new Request(`http://${HOST}${url}`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text });
};
const run = async (body: Record<string, unknown>, url = "/api/generations") => {
  const r = await generationsRoute.POST(request(url, body));
  return { status: r.status, body: (await r.json()) as Record<string, unknown> & { items?: { id: string }[]; code?: string; error?: string } };
};
const tick = () => globalThis.__fuobeRunner?.tick();
const taskOf = (generationId: string) => db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ? ORDER BY created_at DESC").get(generationId) as import("@/server/computer/tasks").TaskRow | undefined;
const stored = (id: string) => JSON.parse((db().prepare("SELECT request_json FROM generations WHERE id = ?").get(id) as { request_json: string }).request_json) as Record<string, unknown>;
async function until<T>(fn: () => T | Promise<T>, tries = 300, everyMs = 25): Promise<T> {
  let v = await fn();
  for (let i = 0; i < tries && !v; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, everyMs));
    v = await fn();
  }
  return v;
}
async function photo(): Promise<string> {
  const up = await uploadsRoute.POST(
    new Request(`http://${HOST}/api/uploads`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "image/png", "x-file-name": "me.png", "content-length": String(TINY_PNG.length) }, body: new Uint8Array(TINY_PNG) }),
  );
  expect(up.status).toBe(201);
  return ((await up.json()) as { url: string }).url;
}
const press = async () => ({ feature: "video", presetId: PRESET, modelId: CLIP_MODEL, op: "i2v", prompt: "", inputs: { images: [await photo()] }, params: { aspectRatio: "auto", resolution: "768p", duration: 5 } });
const ended = async (id: string) =>
  (await until(() => {
    const g = getGeneration(id);
    return g && g.status !== "queued" && g.status !== "running" ? g : null;
  }, 600))!;

describe("a preset's end-frame chain on this install's GPUs", () => {
  it("both steps keep the run's place: the end frame and the clip go in line for the workers and a worker runs them", async () => {
    const w = standInWorker();
    const r = await run(await press());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const items = r.body.items!;
    expect(items).toHaveLength(2);
    const clipId = items[0].id;
    const endId = items[1].id;
    // Every row of the run carries its place (and its stamp) on the server; the clip's asked request carries none.
    expect(stored(endId).place).toBe("pool");
    expect(stored(clipId)).toMatchObject({ place: "pool", op: "flf2v", chain: [{ slot: "endImage" }] });
    expect(stored(clipId).hold).toEqual(stored(endId).hold);
    expect(stored(clipId).standalone).toBe(true);
    expect((stored(clipId).asked as Record<string, unknown>).place).toBeUndefined();
    expect((stored(clipId).asked as Record<string, unknown>).hold).toBeUndefined();
    expect(getGeneration(clipId)?.place).toBe("pool");

    // The end frame: a task for the workers, run by the stand-in worker.
    const worker = workerRunner(w.token);
    const first = await until(() => taskOf(endId));
    expect(first?.account).toBe(accountId);
    await worker.beat();
    await worker.claimAndRun();
    expect((await ended(endId)).status).toBe("succeeded");

    // The clip: never "Connect your GPU", a task for the workers in its run's place, run by the same worker.
    const second = await until(() => taskOf(clipId) ?? (getGeneration(clipId)?.status === "failed" ? getGeneration(clipId) : undefined));
    expect(getGeneration(clipId)?.error ?? null).not.toBe(CONNECT_GPU_MESSAGE);
    expect(second && "pools" in second ? second.pools : null).toBe("pool");
    const clipTask = taskOf(clipId)!;
    expect(clipTask.account).toBe(accountId);
    expect(clipTask.workflow_id ?? JSON.parse(clipTask.needs_json ?? "{}").workflowId).toBe(getModel(CLIP_MODEL)!.routes.find((x) => x.provider === "comfyui" && x.op === "flf2v")!.endpoint);
    await worker.beat();
    await worker.claimAndRun();
    const clip = await ended(clipId);
    expect(clip.status, clip.error ?? "").toBe("succeeded");
    expect(stored(clipId).place).toBe("pool");
  });

  it("a clip step stored without its run's stamp (made before it was kept) still runs on the workers, with the stamp it was asked with", async () => {
    const w = standInWorker();
    const r = await run(await press());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [clipId, endId] = r.body.items!.map((x) => x.id);
    // As such a step was stored: no place or hold of its own, the run's stamp only in what was asked.
    const was = stored(clipId);
    const { place, hold, charge, waitMs, standalone, ...rest } = was;
    db()
      .prepare("UPDATE generations SET request_json = ? WHERE id = ?")
      .run(JSON.stringify({ ...rest, asked: { ...(was.asked as object), place, hold, charge, waitMs, standalone } }), clipId);
    expect(stored(clipId).place).toBeUndefined();
    const worker = workerRunner(w.token);
    await until(() => taskOf(endId));
    await worker.beat();
    await worker.claimAndRun();
    expect((await ended(endId)).status).toBe("succeeded");
    await until(() => taskOf(clipId) ?? (getGeneration(clipId)?.status === "failed" ? getGeneration(clipId) : undefined));
    expect(getGeneration(clipId)?.error ?? null).toBeNull();
    expect(taskOf(clipId)?.account).toBe(accountId);
    expect(stored(clipId)).toMatchObject({ place: "pool", standalone: true });
    expect(stored(clipId).hold).toEqual(hold);
    expect((stored(clipId).asked as Record<string, unknown>).place).toBeUndefined();
    await worker.beat();
    await worker.claimAndRun();
    expect((await ended(clipId)).status).toBe("succeeded");
  });

  /**
   * A press whose step `endpoint` no worker runs: the card, the price check (the place chip and the price) and the press
   * all say where it really runs, before anything is made. Never "Free" on this install's GPUs, never a Run on them.
   */
  async function saidBeforeThePress(endpoint: string) {
    standInWorker(loadManifest().workflows.map((x) => x.id).filter((x) => x !== endpoint));
    const setup = needsGpu(endpoint);
    // The card: kept off these GPUs, labelled with what that step needs, and no "Try free".
    const viewer = (await visitorStatus(auth.accountById(accountId)!)).viewer;
    const preset = getPreset(PRESET)!;
    expect(viewer.pool?.presets?.[PRESET]).toEqual(setup);
    expect(presetOwnSetup(pickerRules(viewer), preset, "open")).toEqual(setup);
    const tryFree = tryFreeFor({ ...viewer, cardText: "Try free" }, "open");
    expect(tryFree?.runs({ id: PRESET, open: true })).toBe(false);
    // A preset these GPUs run in whole still says "Try free".
    const plain = PRESETS.find((x) => {
      const r = presetRoutes(x, "open", (id) => !!getModel(id))[0];
      return r && !r.end && r.modelId === CLIP_MODEL && r.op === "i2v" && !r.params?.extra;
    })!;
    expect(plain).toBeDefined();
    expect(tryFree?.runs({ id: plain.id, open: true })).toBe(true);
    expect(viewer.pool?.presets?.[plain.id]).toBeUndefined();

    // The price check: refused here with that setup, so the chip says the visitor's own GPU, with no price and no Run on list.
    const body = await press();
    const check = (await run({ ...body, place: "pool" }, "/api/generations?preview=1")).body as { place?: "pool"; quote?: { allowed: boolean; text: string; ownSetup?: import("@/lib/own-setup").OwnSetup } };
    expect(check.quote?.allowed).toBe(false);
    expect(check.quote?.ownSetup).toEqual(setup);
    expect(check.quote?.text).toBe(ownSetupLabel(setup));
    const pool = checkedPool(check);
    const chip = runPlace({ audience: "account", engine: "open", models: ["MiniMax H3"], hosted: true, gpu: false, pool, format: String });
    expect(chip).toMatchObject({ where: "gpu", label: "Your GPU", price: "", needs: "gpu", setup });
    expect(`${chip.label} ${chip.price} ${chip.send}`).not.toMatch(/Free|Fuobe Cloud|Our GPUs/);
    expect(placeRows({ ...viewer, kind: "account" } as never, { siteRuns: !chip.setup })).toBeNull();

    // The press: refused with the same words and the setup that runs it, before any step is made.
    const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
    const r = await run(body);
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body).toMatchObject({ error: check.quote!.text, code: "connect-gpu", ownSetup: setup });
    expect((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n).toBe(before);
  }

  it("a clip step no worker can run: the card, the place chip and the press say the visitor's own GPU, and nothing is queued", async () => {
    await saidBeforeThePress(getModel(CLIP_MODEL)!.routes.find((x) => x.provider === "comfyui" && x.op === "flf2v")!.endpoint);
  });

  it("an end frame no worker can make is said before the press the same way", async () => {
    // The edit that makes the end frame, as the preset's recipe plans it.
    const end = presetRoutes(getPreset(PRESET)!, "open", (id) => !!getModel(id))[0]?.end;
    expect(end).toBeDefined();
    const edits = [...new Set(getModel(end!.modelId)!.routes.filter((x) => x.provider === "comfyui" && x.op === end!.op).map((x) => x.endpoint))];
    expect(edits).toHaveLength(1);
    await saidBeforeThePress(edits[0]);
  });
});

describe("every chain keeps its run's stamp on every step", () => {
  const STAMP = { place: "pool" as const, hold: "h-chain-test", charge: "Free", checkOutputs: true, standalone: true };
  /** The rows a run makes on this install's GPUs, made and not sent. */
  const made = (req: Record<string, unknown>) => {
    const run = hosted.runOnPool(accountId, () => withRunStamp(STAMP, () => captureRun(() => createGenerations(req as never))));
    db()
      .prepare(`UPDATE generations SET status = 'canceled' WHERE id IN (${run.ids.map(() => "?").join(", ")})`)
      .run(...run.ids);
    return run;
  };
  // Pictures are taken for runs on this install's GPUs while a worker is there to run them.
  beforeEach(() => void standInWorker());

  it.each([
    ["a preset's end frame, then its clip", async () => press()],
    ["a film shot by shot, then joined", async () => ({ feature: "video", modelId: "oss-wan22-14b-fast", prompt: "A fox in the snow", inputs: { images: [await photo()] }, params: { aspectRatio: "16:9", shots: [{ prompt: "wide shot", duration: 3 }, { prompt: "close-up", duration: 5 }] } })],
    ["a film made from its frames, then joined", async () => ({ feature: "video", modelId: "oss-wan22-14b-fast", op: "keyframes", prompt: "A paper boat drifts", inputs: { images: [await photo(), await photo(), await photo()] }, params: { aspectRatio: "16:9", resolution: "480p", duration: 6, keyframeTimes: [0, 2.5, 4] } })],
  ])("%s", async (_, body) => {
    const run = made(await body());
    expect(run.ids.length).toBeGreaterThan(1);
    for (const id of run.ids) expect(stored(id), id).toMatchObject(STAMP);
    // What was asked (a retry sends it again) carries no stamp: it is the server's.
    const head = run.value[0];
    expect(stored(head.id).asked).toBeDefined();
    for (const k of Object.keys(STAMP)) expect((stored(head.id).asked as Record<string, unknown>)[k], k).toBeUndefined();
  });
});
