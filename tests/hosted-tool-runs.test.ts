import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { placeOf } from "@/lib/place-name";
import { NextRequest } from "next/server";
import { listenOnFreePort, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

/**
 * A tool's run (Storyboard here, and every tool that runs through account-tool-run.ts) for an account with no GPU of its
 * own: with hosted runs on it runs on this install's GPUs through the same gate as a studio run, held and counted once
 * however many steps it has; with them off, or for an account whose own GPU answers, nothing changes.
 */
const dir = tempDir("fuobe-hosted-tool-runs-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
delete process.env.ANTHROPIC_API_KEY;
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenOnFreePort(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0, loras: [] }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const boardsRoute = await import("@/app/api/storyboards/route");
const gpuRoute = await import("@/app/api/account/gpu/route");
const { proxy } = await import("@/proxy");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");
const hostedRun = await import("@/server/hosted-run");
const toolRun = await import("@/server/account-tool-run");
const { createGenerations } = await import("@/server/generations");
const { OWN_GPU_TOOL_MESSAGE } = await import("@/lib/guest-access");
const { drainOutbox, queueReports } = await import("@/server/billing-outbox");
const presses = await import("@/server/run-requests");
const pressRequestId = presses.reserveRequestId;

let fake: FakeBilling;
const ids: Record<string, string> = {};
const cookies: Record<string, string> = {};
beforeAll(async () => {
  fake = await startFakeBilling();
  auth.setPassword("install password");
  for (const who of ["none", "gpu"]) {
    ids[who] = auth.createAccount(`tools-${who}@example.com`, "long enough").id;
    cookies[who] = `${auth.SESSION_COOKIE}=${auth.createSession(ids[who]).value}`;
  }
  globalThis.__fuobeTestGpuPort = comfy.port;
  expect((await gpuRoute.PUT(json("/api/account/gpu", "PUT", { url: comfy.url }, "gpu"))).status).toBe(200);
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  globalThis.__fuobeTestGpuPort = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await fake.close();
  await comfy.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  delete process.env.FUOBE_HOSTED_RUNS;
  delete process.env.FUOBE_HOSTED_FREE;
  delete process.env.FUOBE_BILLING_URL;
  delete process.env.FUOBE_BILLING_TOKEN;
  fake.policy = { hosted: true, pool: {}, uploads: { image: true, video: false, audio: false }, limits: { activeRuns: 7, waiting: 7, runsPerHour: 70, outputsPerRun: 2, maxMegapixels: 7, maxSeconds: 7, keepDays: 7, spaceBytes: 7 }, ttlS: 0 };
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

function json(url: string, method: string, body: unknown, who?: string): Request {
  const text = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...(who && { cookie: cookies[who] }) },
    body: text,
  });
}
const viaProxy = (url: string, who: string) =>
  proxy(new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: { host: "localhost:3000", cookie: cookies[who], "content-type": "application/json" }, body: "{}" }));
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";

const SCENES = ["A model in an emerald gown on a palace stair at midnight", "She runs to a vintage car under the lamps", "The car on a coast road at dawn"];
const board = async (who: string, extra: Record<string, unknown> = {}) => {
  const r = await boardsRoute.POST(json("/api/storyboards", "POST", { engine: "open", scenes: SCENES, ...extra }, who));
  return { status: r.status, body: (await r.json()) as { items?: { id: string }[]; error?: string; code?: string } };
};
/** The stored requests of an account's runs (as the runner reads them). */
const stored = (who: string) =>
  (db().prepare("SELECT request_json FROM generations WHERE json_extract(request_json, '$.account') = ? AND status IN ('queued', 'running', 'succeeded') ORDER BY created_at").all(ids[who]) as { request_json: string }[]).map(
    (r) => JSON.parse(r.request_json) as { place?: string; hold?: string; light?: boolean },
  );
const reserves = () => fake.calls_of("/v1/reserve").length;
const useBilling = () => {
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
};

describe("hosted runs off (the default): tool runs are as before", () => {
  it("an account with no GPU or key is asked to connect one, at the proxy and at the route", async () => {
    const at = await viaProxy("/api/storyboards", "none");
    expect(at.status).toBe(403);
    expect(((await at.json()) as { code: string }).code).toBe("connect-gpu");
    const r = await board("none");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("connect-gpu");
    expect(stored("none")).toEqual([]);
  });

  it("a press is made once per server process, as before, and nothing of it is kept in the database", async () => {
    const account = auth.accountById(ids.none)!;
    let called = 0;
    const press = () =>
      toolRun.onceForAccount(
        account,
        "test-off",
        "press-off-00001",
        async () => ({ ok: true as const, value: ++called }),
        ({ value }) => Response.json({ value }, { status: 201 }),
      );
    expect(await (await press()).json()).toEqual({ value: 1 });
    expect(await (await press()).json()).toEqual({ value: 1 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM run_requests WHERE account = ?").get(account.id)).toEqual({ n: 0 });
  });

  it("a press id kept for this install's GPUs only makes a run for every send, as before the page sent one", async () => {
    const account = auth.accountById(ids.none)!;
    let called = 0;
    const press = () =>
      toolRun.onceForAccount(
        account,
        "test-off-pool-only",
        toolRun.poolPress("press-off-pool-01"),
        async () => ({ ok: true as const, value: ++called }),
        ({ value }) => Response.json({ value }, { status: 201 }),
      );
    expect(await (await press()).json()).toEqual({ value: 1 });
    expect(await (await press()).json()).toEqual({ value: 2 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM run_requests WHERE account = ?").get(account.id)).toEqual({ n: 0 });
  });

  it("the seam answers its own GPU or key, whatever the steps", async () => {
    const place = await toolRun.placeOf(auth.accountById(ids.none)!, [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }]);
    expect(place).toEqual({ kind: "own" });
  });
});

describe("hosted runs on", () => {
  beforeEach(() => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    process.env.FUOBE_HOSTED_FREE = "1";
  });

  it("a tool's run reaches its route for an account with no GPU of its own; other tools still say so", async () => {
    expect(passed(await viaProxy("/api/storyboards", "none"))).toBe(true);
    const other = await viaProxy("/api/restore/prompt", "none");
    expect(other.status).toBe(403);
    expect(((await other.json()) as { code: string }).code).toBe("own-gpu-tool");
  });

  it("a board runs on this install's GPUs: every step stamped for there", async () => {
    const r = await board("none");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const rows = stored("none");
    expect(rows.length).toBe(SCENES.length);
    expect(rows.every((q) => q.place === "pool")).toBe(true);
  });

  it("with a billing service: one hold for the whole run, priced from every step, on every row", async () => {
    useBilling();
    const before = reserves();
    // The price the client showed before Run comes back with the run (a run priced higher is asked about again).
    const r = await board("none", { shown: { amount: fake.price.amount, priceVersion: fake.price.version } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(reserves() - before).toBe(1);
    const reserve = fake.calls_of("/v1/reserve").at(-1)!.body as { run: { steps?: { model: string; jobs: number }[] } };
    expect(reserve.run.steps?.reduce((n, s) => n + s.jobs, 0)).toBe(SCENES.length);
    const holds = new Set(stored("none").map((q) => q.hold));
    expect(holds.size).toBe(1);
    expect([...holds][0]).toBeTruthy();
  });

  it("a model the policy keeps off this install's GPUs refuses the run before anything is held or made", async () => {
    useBilling();
    fake.policy = { ...fake.policy, pool: { deny: ["oss-z-image-turbo"] } };
    const steps = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    const place = await toolRun.placeOf(auth.accountById(ids.none)!, steps);
    expect(place.kind).toBe("refuse");
    if (place.kind === "refuse") expect(place.refusal.body).toMatchObject({ code: "connect-gpu", error: "Runs on your own GPU", ownSetup: { need: "gpu" } });
    const before = reserves();
    const rows = stored("none").length;
    const r = await toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), auth.accountById(ids.none)!, { tool: "test", files: [], plan: () => steps, start: () => createGenerations(steps[0].request) });
    expect(r.ok).toBe(false);
    // Its label, and the answer opens Connect your GPU.
    if (!r.ok) {
      expect(r.response.headers.get("x-fuobe-connect-gpu")).toBe("1");
      expect((await r.response.json()) as { code: string; error: string }).toMatchObject({ code: "connect-gpu", error: "Runs on your own GPU" });
    }
    expect(reserves()).toBe(before);
    expect(stored("none").length).toBe(rows);
  });

  it("a row the start makes that the policy doesn't allow stops the whole run, and its hold goes back", async () => {
    useBilling();
    fake.policy = { ...fake.policy, pool: { deny: ["oss-flux1-schnell"] } };
    const plan = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    const rows = stored("none").length;
    const r = await toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), auth.accountById(ids.none)!, {
      tool: "test",
      files: [],
      shown: { amount: fake.price.amount, priceVersion: fake.price.version },
      plan: () => plan,
      // A start that makes more than it planned: a step the policy leaves out.
      start: () => [...createGenerations(plan[0].request), ...createGenerations({ feature: "image", modelId: "oss-flux1-schnell", prompt: "a fox in red" })],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
    expect(stored("none").length).toBe(rows);
    await drainOutbox();
    const hold = [...fake.holds.values()].at(-1);
    expect(hold?.released).toBe(true);
  });

  it("a start that makes more jobs than its plan was priced and held for is stopped, and its hold goes back", async () => {
    useBilling();
    const plan = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    const rows = stored("none").length;
    const before = reserves();
    const r = await toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), auth.accountById(ids.none)!, {
      tool: "test",
      files: [],
      shown: { amount: fake.price.amount, priceVersion: fake.price.version },
      plan: () => plan,
      // Priced as one picture; the start makes two of the same model.
      start: () => [...createGenerations(plan[0].request), ...createGenerations({ ...plan[0].request, prompt: "a fox at dusk" })],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(403);
      // Said as its label, which opens Connect your GPU (lateRefusal), as the gate says it before Run.
      expect(((await r.response.json()) as { code: string }).code).toBe("connect-gpu");
      expect(r.response.headers.get("x-fuobe-connect-gpu")).toBe("1");
    }
    expect(reserves() - before).toBe(1);
    expect((fake.calls_of("/v1/reserve").at(-1)!.body as { run: { steps: { jobs: number }[] } }).run.steps).toEqual([expect.objectContaining({ jobs: 1 })]);
    expect(stored("none").length).toBe(rows);
    await drainOutbox();
    expect([...fake.holds.values()].at(-1)?.released).toBe(true);
  });

  it("a start whose row asks for more outputs at once than a run here makes is stopped, its hold given back", async () => {
    useBilling();
    fake.policy = { ...fake.policy, limits: { ...(fake.policy.limits as object), outputsPerRun: 1 } };
    const plan = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    const rows = stored("none").length;
    const r = await toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), auth.accountById(ids.none)!, {
      tool: "test",
      files: [],
      shown: { amount: fake.price.amount, priceVersion: fake.price.version },
      plan: () => plan,
      start: () => createGenerations({ ...plan[0].request, params: { numOutputs: 2 } }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(((await r.response.json()) as { error: string }).error).toBe(hostedRun.gateText({ ok: false, reason: "outputs", cap: 1 }, false, placeOf(null)));
    expect(stored("none").length).toBe(rows);
    await drainOutbox();
    expect([...fake.holds.values()].at(-1)?.released).toBe(true);
  });

  it("a run planned as light work (free, never counted) whose start makes GPU work is stopped before anything is sent", async () => {
    const light = [{ request: { feature: "video", modelId: "oss-ken-burns", op: "still-motion" as const, inputs: { images: ["/api/files/x.png"] }, params: { duration: 4 } } }];
    const place = await toolRun.placeOf(auth.accountById(ids.none)!, light);
    expect(place.kind).toBe("pool");
    if (place.kind === "pool") expect(place.light).toBe(true);
    const rows = stored("none").length;
    const before = reserves();
    const r = await toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), auth.accountById(ids.none)!, {
      tool: "test",
      files: [],
      plan: () => light,
      start: () => createGenerations({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
    expect(reserves()).toBe(before);
    expect(stored("none").length).toBe(rows);
  });

  it("a tool's step that asks for more outputs than a run here makes is refused before Run, never priced smaller", async () => {
    useBilling();
    fake.policy = { ...fake.policy, limits: { ...(fake.policy.limits as object), outputsPerRun: 1 } };
    const steps = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", params: { numOutputs: 4 } } }];
    const words = hostedRun.gateText({ ok: false, reason: "outputs", cap: 1 }, false, placeOf(null));
    const quotes = fake.calls_of("/v1/quote").length;
    const check = await toolRun.toolPriceCheck(json("/api/x?preview=1", "POST", {}, "none"), () => steps);
    expect(check?.quote).toMatchObject({ allowed: false, code: "not-offered", text: words });
    expect(fake.calls_of("/v1/quote").length).toBe(quotes);
    const place = await toolRun.placeOf(auth.accountById(ids.none)!, steps);
    expect(place.kind).toBe("refuse");
    if (place.kind === "refuse") expect(place.refusal.body).toMatchObject({ error: words, code: "not-offered" });
    // A guest's words name nothing it can't do yet; an account whose own GPU answers runs it there.
    expect(hostedRun.gateText({ ok: false, reason: "outputs", cap: 1 }, true, placeOf(null))).not.toMatch(/Settings/);
    expect(await toolRun.placeOf(auth.accountById(ids.gpu)!, steps)).toEqual({ kind: "own" });
  });

  it("a press refused after its hold was made asks for a new hold on its next try; the first goes back", async () => {
    useBilling();
    const account = auth.accountById(ids.none)!;
    const plan = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    const shown = { amount: fake.price.amount, priceVersion: fake.price.version };
    const press = (start: () => unknown) =>
      toolRun.onceForAccount(
        account,
        "test-press",
        "press-tries-0001",
        () => toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), account, { tool: "test", files: [], shown, plan: () => plan, start }),
        () => Response.json({ ok: true }, { status: 201 }),
      );
    const before = reserves();
    // Its start makes more than was priced: refused after the hold was made.
    const bad = await press(() => [...createGenerations(plan[0].request), ...createGenerations({ ...plan[0].request, prompt: "a fox at dusk" })]);
    expect(bad.status).toBe(403);
    const good = await press(() => createGenerations(plan[0].request));
    expect(good.status, await good.clone().text()).toBe(201);
    const sent = fake.calls_of("/v1/reserve").slice(before).map((c) => (c.body as { requestId: string }).requestId);
    expect(sent).toEqual([pressRequestId(account.id, "test-press\npress-tries-0001"), pressRequestId(account.id, "test-press\npress-tries-0001", 1)]);
    await drainOutbox();
    const holds = [...fake.holds.values()].filter((h) => sent.includes(h.requestId));
    expect(holds.map((h) => h.released)).toEqual([true, false]);
    // The press answered: sent again, it is the same run, with no new hold.
    expect((await press(() => createGenerations(plan[0].request))).status).toBe(201);
    expect(reserves() - before).toBe(2);
  });

  it("a press whose run goes to the account's own GPU keeps nothing in the database, as with hosted runs off", async () => {
    useBilling();
    const account = auth.accountById(ids.gpu)!;
    const plan = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    expect(await toolRun.placeOf(account, plan)).toEqual({ kind: "own" });
    let called = 0;
    const press = () =>
      toolRun.onceForAccount(
        account,
        "test-own",
        "press-own-00001",
        async () => {
          // Placed on its own GPU: never startOnPool, so the press is never claimed.
          expect(await toolRun.placeOf(account, plan)).toEqual({ kind: "own" });
          return { ok: true as const, value: ++called };
        },
        ({ value }) => Response.json({ value }, { status: 201 }),
      );
    const before = reserves();
    expect(await (await press()).json()).toEqual({ value: 1 });
    // Sent again in this server process: the first run, as before (shorts-schemas.ts once).
    expect(await (await press()).json()).toEqual({ value: 1 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM run_requests WHERE account = ?").get(account.id)).toEqual({ n: 0 });
    expect(reserves()).toBe(before);
  });

  it("a press id kept for this install's GPUs only: one run and one hold there; on the account's own GPU a run per send", async () => {
    useBilling();
    const plan = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    const shown = { amount: fake.price.amount, priceVersion: fake.price.version };
    const pressAs = (who: string, id: string) => {
      const account = auth.accountById(ids[who])!;
      return toolRun.onceForAccount(
        account,
        "test-pool-only",
        toolRun.poolPress(id),
        () => toolRun.runAccountTool(json("/api/x", "POST", {}, who), account, { tool: "test", files: [], shown, plan: () => plan, start: () => createGenerations(plan[0].request) }),
        ({ value }) => Response.json({ ids: (value as { id: string }[]).map((g) => g.id) }, { status: 201 }),
      );
    };
    const before = reserves();
    // On this install's GPUs: sent twice in this server process, one run and one hold.
    const first = await pressAs("none", "press-pool-only-1");
    expect(first.status, await first.clone().text()).toBe(201);
    const again = await pressAs("none", "press-pool-only-1");
    expect(await again.json()).toEqual(await first.json());
    expect(reserves() - before).toBe(1);
    expect(fake.calls_of("/v1/reserve").at(-1)!.body).toMatchObject({ requestId: pressRequestId(ids.none, "test-pool-only\npress-pool-only-1") });
    // On the account's own GPU: each send makes its run, nothing kept, nothing held.
    const own = auth.accountById(ids.gpu)!;
    expect(await toolRun.placeOf(own, plan)).toEqual({ kind: "own" });
    const made: string[][] = [];
    for (let i = 0; i < 2; i++) {
      db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
      const r = await pressAs("gpu", "press-pool-only-2");
      expect(r.status, await r.clone().text()).toBe(201);
      made.push(((await r.json()) as { ids: string[] }).ids);
    }
    expect(made[1]).not.toEqual(made[0]);
    expect(db().prepare("SELECT COUNT(*) AS n FROM run_requests WHERE account = ?").get(own.id)).toEqual({ n: 0 });
    expect(reserves() - before).toBe(1);
  });

  it("a resend while another server process starts the press waits for that answer and makes nothing", async () => {
    const account = auth.accountById(ids.none)!;
    expect(presses.claimPress(account.id, presses.toolPressKey("test-wait", "press-wait-0001")).kind).toBe("claimed");
    let called = 0;
    const resend = toolRun.onceForAccount(
      account,
      "test-wait",
      "press-wait-0001",
      async () => {
        called++;
        return { ok: true as const, value: 1 };
      },
      () => Response.json({ here: true }, { status: 201 }),
    );
    setTimeout(() => presses.answerPress(account.id, presses.toolPressKey("test-wait", "press-wait-0001"), { status: 201, headers: [["content-type", "application/json"]], text: JSON.stringify({ elsewhere: true }) }), 300);
    const r = await resend;
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ elsewhere: true });
    expect(called).toBe(0);
  });

  it("runs sent together whose start awaits before it makes its rows meet the limits one at a time", async () => {
    useBilling();
    fake.policy = { ...fake.policy, limits: { ...(fake.policy.limits as object), activeRuns: 1 } };
    const account = auth.accountById(ids.none)!;
    const plan = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    const shown = { amount: fake.price.amount, priceVersion: fake.price.version };
    const rows = stored("none").length;
    // A start that waits (a channel made first, say) before it makes its rows.
    const start = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return createGenerations(plan[0].request);
    };
    const go = () => toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), account, { tool: "test", files: [], shown, plan: () => plan, start });
    const [a, b] = await Promise.all([go(), go()]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const no = (a.ok ? b : a) as Extract<typeof a, { ok: false }>;
    expect(no.response.status).toBe(429);
    expect(stored("none").length - rows).toBe(1);
    // Its rows made, the run counts for itself: nothing is left open, and the next press meets the same limit.
    expect(db().prepare("SELECT COUNT(*) AS n FROM open_admissions WHERE account = ?").get(account.id)).toEqual({ n: 0 });
    const third = await go();
    expect(third.ok).toBe(false);
    // The studio's own limit of runs at once (4) counts runs on the account's own GPU or key only while hosted runs are
    // on: runs here meet the policy's limits, so with none set every one sent together is taken.
    db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
    fake.policy = { ...fake.policy, limits: { ...(fake.policy.limits as object), activeRuns: 0, waiting: 0 } };
    const many = await Promise.all(Array.from({ length: 6 }, go));
    expect(many.filter((r) => r.ok)).toHaveLength(6);
  });

  it("a start that makes no rows gives its hold back, answers as the tool does, and isn't one of the hour's runs", async () => {
    useBilling();
    fake.policy = { ...fake.policy, limits: { ...(fake.policy.limits as object), runsPerHour: 1 } };
    const account = auth.accountById(ids.none)!;
    const plan = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    const shown = { amount: fake.price.amount, priceVersion: fake.price.version };
    const hours = () => (db().prepare("SELECT COUNT(*) AS n FROM pool_admissions WHERE account = ?").get(account.id) as { n: number }).n;
    db().prepare("DELETE FROM pool_admissions WHERE account = ?").run(account.id);
    for (const start of [() => [], async () => []]) {
      const before = reserves();
      const r = await toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), account, { tool: "test", files: [], shown, plan: () => plan, start });
      expect(r.ok).toBe(true);
      expect(reserves() - before).toBe(1);
      await drainOutbox();
      const hold = [...fake.holds.values()].at(-1)!;
      expect(hold.released).toBe(true);
      expect(hold.reports.size).toBe(0);
      expect(hours()).toBe(0);
    }
    // The hour still has room for a run that makes something.
    const real = await toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), account, { tool: "test", files: [], shown, plan: () => plan, start: () => createGenerations(plan[0].request) });
    expect(real.ok).toBe(true);
    expect(hours()).toBe(1);
  });

  it("a start that made a row and then failed: the row's report closes the hold, which is never released as well", async () => {
    useBilling();
    const account = auth.accountById(ids.none)!;
    const plan = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    const shown = { amount: fake.price.amount, priceVersion: fake.price.version };
    const releases = fake.calls_of("/v1/release").length;
    const r = await toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), account, {
      tool: "test",
      files: [],
      shown,
      plan: () => plan,
      start: async () => {
        createGenerations(plan[0].request);
        await new Promise((r) => setTimeout(r, 5));
        throw new Error("The plan changed. Please try again.");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(422);
    const hold = [...fake.holds.entries()].at(-1)!;
    // The stopped row reports once it is canceled.
    await expect.poll(() => (db().prepare("SELECT COUNT(*) AS n FROM generations WHERE json_extract(request_json, '$.hold') = ? AND status = 'canceled'").get(hold[0]) as { n: number }).n).toBe(1);
    queueReports();
    await drainOutbox();
    expect(fake.calls_of("/v1/release").length).toBe(releases);
    expect(hold[1].released).toBe(false);
    expect([...hold[1].reports.values()]).toEqual(["canceled"]);
    expect(fake.calls_of("/v1/refund").filter((c) => (c.body as { holdId: string }).holdId === hold[0])).toHaveLength(1);
  });

  it("a 3D model stays on an account's own GPU: its label, and the answer opens Connect your GPU", async () => {
    const steps = [{ request: { feature: "3d", modelId: "oss-pixal3d", op: "image-to-3d" as const, prompt: "", inputs: { images: ["/api/files/x.png"] } } }];
    const place = await toolRun.placeOf(auth.accountById(ids.none)!, steps);
    expect(place.kind).toBe("refuse");
    if (place.kind === "refuse") {
      expect(place.refusal.body.code).toBe("connect-gpu");
      expect(place.refusal.body.error).toMatch(/^Runs on your own GPU · \d+ GB$/);
      expect(place.refusal.body.ownSetup).toMatchObject({ need: "gpu" });
      expect(place.refusal.body.error).not.toBe(OWN_GPU_TOOL_MESSAGE);
    }
  });

  it("an account whose own GPU answers keeps it, and asking for its own GPU always keeps it", async () => {
    const steps = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } }];
    expect(await toolRun.placeOf(auth.accountById(ids.gpu)!, steps)).toEqual({ kind: "own" });
    expect(await toolRun.placeOf(auth.accountById(ids.none)!, steps, "own")).toEqual({ kind: "own" });
    expect((await toolRun.placeOf(auth.accountById(ids.gpu)!, steps, "pool")).kind).toBe("pool");
  });

  it("the price check before Run answers for the whole run: place, quote and line", async () => {
    useBilling();
    const plan = () => [
      { request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" } },
      { request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox at night" }, deps: 1 },
    ];
    const asNone = new Request("http://localhost:3000/api/x?preview=1", { method: "POST", headers: { host: "localhost:3000", cookie: cookies.none } });
    const check = await toolRun.toolPriceCheck(asNone, plan);
    expect(check?.place).toBe("pool");
    expect(check?.quote.allowed).toBe(true);
    expect(check?.line.place).toBeGreaterThanOrEqual(1);
    const quote = fake.calls_of("/v1/quote").at(-1)!.body as { run: { steps?: { jobs: number }[] } };
    expect(quote.run.steps?.reduce((n, s) => n + s.jobs, 0)).toBe(2);
    // A guest's is priced too (as nobody's run); the owner's never comes here.
    const guest = await toolRun.toolPriceCheck(new Request("http://localhost:3000/api/x?preview=1", { method: "POST", headers: { host: "localhost:3000" } }), plan);
    expect(guest?.place).toBe("pool");
    // A run asked for on its own GPU isn't priced here.
    expect(await toolRun.toolPriceCheck(asNone, plan, "own")).toBeNull();
  });
});

describe("text steps inside a run on this install's GPUs", () => {
  const step = (modelId: string, provider: string, i: number) => ({ id: `s${i}`, modelId, op: "t2i", provider, kind: "image", presetId: null, waits: i > 0 });
  it("run on the install's AI helper: allowed, never priced, never counted", () => {
    const steps = [step("oss-text-llm", "llm", 0), step("oss-z-image-turbo", "comfyui", 1)];
    expect(hostedRun.stepsProblem(billing.OPEN_POLICY, steps)).toBeNull();
    expect(hostedRun.pricedSteps(steps).map((s) => s.model)).toEqual(["oss-z-image-turbo"]);
    expect(hostedRun.lightRun(steps)).toBe(false);
    // A cloud step still can't run there.
    expect(hostedRun.stepsProblem(billing.OPEN_POLICY, [...steps, step("fal-flux", "fal", 2)])).not.toBeNull();
  });
});

void TINY_PNG;
