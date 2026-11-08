import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { GenerationRequest } from "@/lib/catalog/types";
import type { RunDetails } from "@/server/run-details";
import { TINY_PNG } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// Route handlers are called directly, outside a Next request: connection() has nothing to wait for.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-run-details-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const admin = await import("@/server/admin-tokens");
const { saveFile, absolutePath, filesRel } = await import("@/server/storage");
const { runAsTenant } = await import("@/server/tenant");
const { proxy } = await import("@/proxy");
const runRoute = await import("@/app/api/admin/generations/[id]/route");
const { compareSettings, redactText, redactValue, runMatch, linkKind } = await import("@/lib/run-settings");
const fs = await import("node:fs");
afterAll(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
});

const A = auth.createAccount("ann@example.com", "long enough").id;
const POD = "https://abc123xyz-8188.proxy.runpod.net";
const GPU_TOKEN = "gpu-secret-token-123456";

let seq = 0;
/** A run as the runner stores it: `account`'s (or the owner's), with the stored columns given. */
function run(
  account: string | undefined,
  o: {
    status?: string;
    batch?: string;
    at?: number;
    request?: Partial<GenerationRequest>;
    error?: string;
    message?: string;
    externalId?: string;
    meta?: unknown;
    payload?: unknown;
    fix?: unknown;
  } = {},
): string {
  const id = `rd-${String(++seq).padStart(4, "0")}`;
  const at = o.at ?? Date.now();
  const request = { feature: "image", modelId: "oss-qwen-image-21", op: "t2i", prompt: "a fox", engine: "open", ...o.request, ...(account && { account }) };
  db()
    .prepare(
      `INSERT INTO generations (id, batch_id, feature, model_id, engine, provider, op, kind, status, message, request_json, provider_input_json, external_id, external_meta_json, outputs_json, error, fix_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', 'comfyui', ?, 'image', ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
    )
    .run(
      id,
      o.batch ?? null,
      request.feature,
      request.modelId,
      request.op,
      o.status ?? "failed",
      o.message ?? null,
      JSON.stringify(request),
      o.payload === undefined ? null : JSON.stringify(o.payload),
      o.externalId ?? null,
      o.meta === undefined ? null : JSON.stringify(o.meta),
      o.error ?? null,
      o.fix === undefined ? null : JSON.stringify(o.fix),
      at,
      at,
    );
  return id;
}

const cookies = {} as Record<"owner" | "a", string>;
beforeAll(() => {
  auth.setPassword("install password");
  cookies.owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  cookies.a = `${auth.SESSION_COOKIE}=${auth.createSession(A).value}`;
  auth.setAccountGpu(A, { url: POD, token: GPU_TOKEN });
});

const viaProxy = (url: string, cookie?: string) => proxy(new NextRequest(`http://localhost:3000${url}`, { headers: cookie ? { cookie } : {} }));
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
const direct = (url: string, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { headers });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const get = (id: string, headers: Record<string, string> = { cookie: cookies.owner }) => runRoute.GET(direct(`/api/admin/generations/${id}`, headers), ctx(id));

describe("Run details: the owner's view of one account's run", () => {
  it("is the owner's only: guests 401, accounts 403, the owner 200", async () => {
    const id = run(A);
    expect(viaProxy(`/api/admin/generations/${id}`).status).toBe(401);
    expect(viaProxy(`/api/admin/generations/${id}`, cookies.a).status).toBe(403);
    expect(passed(viaProxy(`/api/admin/generations/${id}`, cookies.owner))).toBe(true);
    // The route checks again itself.
    expect((await get(id, { cookie: cookies.a })).status).toBe(403);
    expect((await get(id, {})).status).toBe(403);
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 404 for a run that doesn't exist, and gives the owner's own run with no account", async () => {
    expect((await get("nope")).status).toBe(404);
    const res = await get(run(undefined, { request: { source: "drill" } }));
    expect(res.status).toBe(200);
    const d = (await res.json()) as RunDetails;
    expect(d.run.account).toBeNull();
    expect(d.run.whose).toBe("owner");
    expect(d.run.source).toBe("drill");
    // The owner's run on the install's ComfyUI ran on this site's GPUs.
    expect(d.where.kind).toBe("site-gpus");
  });

  it("names its chain: the earlier steps it waits for and the later steps that wait for it", async () => {
    const first = run(A, { status: "succeeded", at: 1_000_000 });
    const second = run(A, { status: "succeeded", at: 1_000_100 });
    const last = run(A, { status: "queued", at: 1_000_200 });
    db().prepare("UPDATE generations SET depends_on = ? WHERE id = ?").run(first, second);
    db().prepare("UPDATE generations SET depends_on = ? WHERE id = ?").run(JSON.stringify([first, second]), last);
    const d = (await (await get(second)).json()) as RunDetails;
    expect(d.chain.before.map((r) => r.id)).toEqual([first]);
    expect(d.chain.after.map((r) => r.id)).toEqual([last]);
    const end = (await (await get(last)).json()) as RunDetails;
    expect(end.chain.before.map((r) => r.id)).toEqual([first, second]);
    expect(end.chain.after).toEqual([]);
    const start = (await (await get(first)).json()) as RunDetails;
    expect(start.chain.after.map((r) => r.id)).toEqual([second, last]);
  });

  it("needs outputs:view as well as runs:read for an admin token, and accounts:read for the email", async () => {
    const id = run(A);
    const factsOnly = admin.createAdminToken({ name: "facts", scopes: ["runs:read"], expiresInDays: null }).token;
    expect((await get(id, { authorization: `Bearer ${factsOnly}` })).status).toBe(403);
    const content = admin.createAdminToken({ name: "content", scopes: ["runs:read", "outputs:view"], expiresInDays: null }).token;
    const res = await get(id, { authorization: `Bearer ${content}` });
    expect(res.status).toBe(200);
    const d = (await res.json()) as RunDetails;
    expect(d.run.account).toEqual({ id: A, emailHidden: true });
    const owner = (await (await get(id)).json()) as RunDetails;
    expect(owner.run.account?.email).toBe("ann@example.com");
  });

  it("never carries a key, a token or a GPU's address", async () => {
    const id = run(A, {
      error: `ComfyUI at ${POD}/prompt answered 500 (Authorization: Bearer ${GPU_TOKEN})`,
      externalId: "job-1",
      request: { loras: [{ file: "x.safetensors", url: `https://civitai.com/api/download/1?token=${GPU_TOKEN}` }], params: { extra: { api_key: "sk-live-abcdef123456" } } },
      payload: { "3": { class_type: "LoadImage", inputs: { image: `${POD}/view?file=a.png` } }, api_key: "sk-live-abcdef123456", headers: { cookie: "fuobe_session=abc.def" } },
      meta: { workflowId: "qwen-image", jobIndex: 0, sentTo: "0123456789abcdef", lease: { by: "runner-xyz" }, ownRun: { at: Date.now(), stage: "submit", code: "500", hostKind: "runpod", said: `upstream ${POD} failed` } },
      fix: { trouble: { cause: "gpu-error", details: `500 from ${POD}`, actions: [{ kind: "start-gpu", label: "Start your pod", target: "https://console.runpod.io/pods?id=abc123xyz" }] } },
    });
    const res = await get(id);
    const text = await res.text();
    for (const secret of ["abc123xyz", "proxy.runpod.net", GPU_TOKEN, "sk-live-abcdef123456", "fuobe_session=abc", "runner-xyz", "install password"]) expect(text, secret).not.toContain(secret);
    const d = JSON.parse(text) as RunDetails;
    expect(d.where).toMatchObject({ kind: "own-gpu", hostKind: "runpod", hostKindNow: "runpod", workflowId: "qwen-image", handedOver: true, jobIndex: 0 });
    expect(d.where.note).toMatchObject({ stage: "submit", code: "500" });
    expect(d.trouble?.actions[0]).toMatchObject({ kind: "start-gpu", label: "Start your pod", target: "https://console.runpod.io/pods" });
    expect(d.stored.error).toContain("[a RunPod address]");
    expect(JSON.stringify(d.sent)).toContain("LoadImage");
  });

  it("shows its input files to the owner, and a removed upload as removed", async () => {
    const kept = runAsTenant({ kind: "account", id: A }, () => saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", name: "kept.png" }).url);
    const gone = runAsTenant({ kind: "account", id: A }, () => saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", name: "gone.png" }).url);
    fs.rmSync(absolutePath(filesRel(gone)!));
    const id = run(A, { request: { op: "edit", inputs: { images: [kept, gone] } } });
    const d = (await (await get(id)).json()) as RunDetails;
    expect(d.inputs).toEqual([
      { slot: "Image 1", kind: "image", state: "kept", url: kept },
      { slot: "Image 2", kind: "image", state: "removed" },
    ]);
  });

  it("lists its batch and the account's runs around it, marking the same request sent again (Retry)", async () => {
    const t = Date.now() - 60_000;
    const first = run(A, { batch: "b-1", at: t, request: { prompt: "a red fox" } });
    const second = run(A, { batch: "b-1", at: t + 1, request: { prompt: "a red fox" } });
    const retried = run(A, { at: t + 30_000, request: { prompt: "a red fox" } });
    const otherModel = run(A, { at: t + 40_000, request: { prompt: "a red fox", modelId: "oss-ideogram-4" } });
    const d = (await (await get(first)).json()) as RunDetails;
    expect(d.batch.map((b) => b.id)).toEqual([first, second]);
    const near = new Map(d.near.map((r) => [r.id, r.match]));
    expect(near.get(retried)).toBe("same");
    expect(near.get(otherModel)).toBe("other-model");
    expect(near.has(second)).toBe(false);
  });

  it("says whether the model is the studio's default", async () => {
    // The Image studio opens on Auto on the open engine: a model named by hand is a change.
    const d = (await (await get(run(A))).json()) as RunDetails;
    expect(d.model).toMatchObject({ id: "oss-qwen-image-21", state: "changed", default: "oss-auto-image" });
    expect(d.model.ranOn).toBeUndefined();
    expect(d.studio?.title).toBe("Image");
  });

  it("names Auto's pick and why, and the model that made it", async () => {
    const id = run(A, { status: "succeeded", request: { modelId: "oss-krea2-realism" } });
    db()
      .prepare("UPDATE generations SET request_json = json_set(request_json, '$.modelId', 'oss-auto-image', '$.auto', json(?)) WHERE id = ?")
      .run(JSON.stringify({ model: "oss-krea2-realism", why: "trigger" }), id);
    const d = (await (await get(id)).json()) as RunDetails;
    expect(d.model).toMatchObject({ id: "oss-auto-image", name: "Auto", state: "default", ranOn: { id: "oss-krea2-realism" } });
    expect(d.madeBy.auto).toMatchObject({ model: "oss-krea2-realism", why: "trigger" });
    expect(d.madeBy.auto?.words).toContain("Auto image model");
  });

  it("shows what Ideogram 4 declined and the model that made it in its place", async () => {
    const card = { url: "/api/files/held/card.png", spread: 3, grey: 0.97 };
    const id = run(A, {
      status: "succeeded",
      request: { modelId: "oss-krea2-realism", notice: "Made with Krea 2 Realism · Ideogram 4 declined this one" },
      meta: { jobIndex: 0, declined: { stage: "fallback", model: "oss-krea2-realism", cards: [card], was: { model_id: "oss-ideogram-4", request_json: "{}" } } },
    });
    const d = (await (await get(id)).json()) as RunDetails;
    expect(d.run.declinedCards).toEqual([card]);
    expect(d.madeBy.declined).toMatchObject({ stage: "fallback", words: "Ideogram 4 declined it, so another model made it", askedModel: "oss-ideogram-4", model: "oss-krea2-realism", modelName: "Krea 2 Realism" });
    expect(d.madeBy.notices).toEqual(["Made with Krea 2 Realism · Ideogram 4 declined this one"]);
    expect(d.model).toMatchObject({ id: "oss-ideogram-4", ranOn: { id: "oss-krea2-realism" } });
  });

  it("gives the timeline, its jobs and workers, and what it cost, without its hold or lease", async () => {
    const t0 = Date.now() - 120_000;
    const id = run(A, { status: "succeeded", at: t0, externalId: "task-1", request: { feature: "canvas" } });
    db()
      .prepare(
        "UPDATE generations SET completed_at = ?, cost_usd = 0.04, request_json = json_set(request_json, '$.place', 'pool', '$.class', 'paid', '$.hold', 'hold-secret-77', '$.charged', json('true'), '$.charge', '7 units') WHERE id = ?",
      )
      .run(t0 + 90_000, id);
    db().prepare("INSERT INTO generation_runs (id, submitted_at, started_at) VALUES (?, ?, ?)").run(id, t0 + 1_000, t0 + 30_000);
    db()
      .prepare(
        `INSERT INTO relay_tasks (id, principal, generation_id, state, prompt_id, lease_hash, lane, class, requeues, est_ms, created_at, updated_at, claimed_at, sent_at, started_at, finished_at)
         VALUES ('task-1', 'pool:pool', ?, 'done', 'p-1', 'lease-secret-99', 'image', 'paid', 1, 50000, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, t0 + 1_000, t0 + 90_000, t0 + 20_000, t0 + 25_000, t0 + 30_000, t0 + 88_000);
    const log = db().prepare(
      "INSERT INTO worker_jobs (at, event, worker_id, worker_name, task_id, generation_id, principal, lane, exec_ms, device) VALUES (?, ?, ?, ?, 'task-1', ?, 'pool:pool', 'image', ?, ?)",
    );
    log.run(t0 + 5_000, "claimed", "w1", "box-a", id, null, null);
    log.run(t0 + 10_000, "requeued", "w1", "box-a", id, null, null);
    log.run(t0 + 20_000, "claimed", "w2", "box-b", id, null, null);
    log.run(t0 + 88_000, "finished", "w2", "box-b", id, 55_000, "NVIDIA GeForce RTX 5090");
    db()
      .prepare("INSERT INTO billing_outbox (key, kind, hold_id, payload_json, tries, next_at, created_at, done_at) VALUES (?, 'settle', 'hold-secret-77', '{}', 1, 0, 0, 1)")
      .run(id);
    const text = await (await get(id)).text();
    for (const secret of ["hold-secret-77", "lease-secret-99"]) expect(text, secret).not.toContain(secret);
    const d = JSON.parse(text) as RunDetails;
    expect(d.timing).toMatchObject({ pressedAt: t0, sentAt: t0 + 1_000, startedAt: t0 + 30_000, endedAt: t0 + 90_000, waitedMs: 30_000, ranMs: 60_000, gpuMs: 55_000, totalMs: 90_000 });
    expect(d.jobs).toEqual([
      expect.objectContaining({ state: "done", slot: "gpu", lane: "image", lineClass: "paid", worker: "box-b", device: "NVIDIA GeForce RTX 5090", requeues: 1, estMs: 50_000, execMs: 55_000 }),
    ]);
    expect(d.workerLog.map((e) => [e.event, e.worker])).toEqual([
      ["claimed", "box-a"],
      ["requeued", "box-a"],
      ["claimed", "box-b"],
      ["finished", "box-b"],
    ]);
    expect(d.money).toMatchObject({ costUsd: 0.04, lineClass: "paid", charge: "7 units", setAside: true, notCharged: false, report: { kind: "settle", state: "sent", tries: 1 } });
    expect(d.surface).toMatchObject({ label: "Canvas", standalone: false });
    expect(d.providerId).toBe("task-1");
    expect(d.progress).toBeNull();
  });

  it("shows a value the model makes differently beside what was asked", async () => {
    const id = run(A, { status: "succeeded", request: { feature: "video", modelId: "minimax-h3-max-turbo", op: "t2v", params: { resolution: "2K" } } });
    db().prepare("UPDATE generations SET provider = 'fal', engine = 'cloud', kind = 'video' WHERE id = ?").run(id);
    const d = (await (await get(id)).json()) as RunDetails;
    expect(d.madeBy.changes).toEqual([expect.objectContaining({ setting: "resolution", asked: "2K", made: "1080p" })]);
    expect(d.settings.find((r) => r.key === "params.resolution")?.made).toMatchObject({ value: "1080p", asked: "2K" });
  });

  it("tells a run made on its own in a studio from one a tool made", async () => {
    const id = run(A, { request: { feature: "cinema-scene" } });
    expect(((await (await get(id)).json()) as RunDetails).surface).toMatchObject({ label: "Cinema Studio", standalone: false });
    const own = run(A);
    db().prepare("UPDATE generations SET request_json = json_set(request_json, '$.standalone', json('true')) WHERE id = ?").run(own);
    expect(((await (await get(own)).json()) as RunDetails).surface).toMatchObject({ label: "Image", standalone: true });
  });
});

describe("withMade: what a setting is made at, beside what was asked", () => {
  it("adds the made value to its row, and a row for a setting the request left out", async () => {
    const { withMade } = await import("@/server/run-details");
    const rows = withMade(
      [{ key: "params.resolution", label: "Resolution", value: "2K", hasDefault: true, default: "1080P", state: "changed", sent: true }],
      [
        { setting: "resolution", label: "Quality", asked: "2K", made: "1080p", reason: "the most this model makes", note: "" },
        { setting: "duration", label: "Duration", asked: "Its own", made: "6", reason: "its only length", note: "" },
      ],
    );
    expect(rows[0].made).toEqual({ value: "1080p", asked: "2K", reason: "the most this model makes" });
    expect(rows[1]).toMatchObject({ key: "params.duration", sent: false, made: { value: "6" } });
  });
});

describe("compareSettings: each setting beside the composer's default", () => {
  const model = {
    defaults: { aspectRatio: "1:1", resolution: "1K" },
    options: { controls: [{ param: "quality", label: "Quality", values: ["fast", "best"], default: "fast" }], sliders: [{ param: "cfg", label: "CFG", min: 1, max: 10, step: 0.5, default: 4 }] },
  } as never;
  const req = (params: Record<string, unknown>, more: Partial<GenerationRequest> = {}): GenerationRequest => ({ feature: "image", modelId: "m", params, ...more }) as GenerationRequest;
  const byKey = (rows: ReturnType<typeof compareSettings>) => Object.fromEntries(rows.map((r) => [r.key, r]));

  it("marks defaults (sent or not), changes and unknown defaults", () => {
    const rows = byKey(compareSettings(req({ aspectRatio: "16:9", numOutputs: 1, guidance: 7, extra: { quality: "best", cfg: 4 } }), { model }));
    expect(rows["params.aspectRatio"]).toMatchObject({ state: "changed", value: "16:9", default: "1:1", from: "model" });
    expect(rows["params.resolution"]).toMatchObject({ state: "default", sent: false, default: "1K" });
    expect(rows["params.numOutputs"]).toMatchObject({ state: "default", sent: true, from: "composer" });
    expect(rows["params.enhancePrompt"]).toMatchObject({ state: "default", sent: false, default: false });
    expect(rows["params.guidance"]).toMatchObject({ state: "unknown", hasDefault: false });
    expect(rows["params.extra.quality"]).toMatchObject({ state: "changed", label: "Quality", default: "fast", from: "control" });
    expect(rows["params.extra.cfg"]).toMatchObject({ state: "default", sent: true });
  });

  it("counts a set seed as a change and the account's shots as its input", () => {
    const rows = byKey(compareSettings(req({ seed: 42, shots: [{ prompt: "a", duration: 3 }] }), { model }));
    expect(rows["params.seed"].state).toBe("changed");
    expect(rows["params.shots"].state).toBe("input");
  });

  it("takes an app's route and options as the defaults, and an unknown model's settings as unknown", () => {
    const preset = { type: "app", options: [{ key: "angle", label: "Angle", choices: [{ value: "front", label: "Front", prompt: "" }, { value: "side", label: "Side", prompt: "" }] }] } as never;
    const route = { params: { duration: 5, extra: { strength: 0.8 } } } as never;
    const rows = byKey(compareSettings(req({ duration: 5, extra: { strength: 0.6 } }, { presetOptions: { angle: "side" } }), { model, preset, route }));
    expect(rows["params.duration"]).toMatchObject({ state: "default", from: "app" });
    expect(rows["params.extra.strength"]).toMatchObject({ state: "changed", default: 0.8, from: "app" });
    expect(rows["presetOptions.angle"]).toMatchObject({ state: "changed", valueLabel: "Side", defaultLabel: "Front" });
    const bare = byKey(compareSettings(req({ aspectRatio: "16:9" })));
    expect(bare["params.aspectRatio"].state).toBe("unknown");
  });

  it("compares a request that became steps as it was asked", () => {
    const asked = req({ aspectRatio: "1:1" });
    const rows = byKey(compareSettings({ ...req({ aspectRatio: "9:16" }), asked }, { model }));
    expect(rows["params.aspectRatio"].state).toBe("default");
  });
});

describe("keeping secrets out", () => {
  it("says links by their kind and masks credentials", () => {
    expect(linkKind("https://abc-8188.proxy.runpod.net/x")).toBe("runpod");
    expect(linkKind("https://foo.trycloudflare.com")).toBe("tunnel");
    expect(linkKind("http://192.168.1.20:8188")).toBe("lan");
    expect(linkKind("https://gpu.example.com")).toBe("web");
    expect(redactText("failed at http://10.0.0.5:8188/prompt with Bearer abcdefghijk")).toBe("failed at [a LAN address] with Bearer ••••");
    expect(redactValue({ apiKey: "k-123456", hf_token: "hf_abc", max_tokens: 50, image: "data:image/png;base64,AAAA", nested: { password: "pw" } })).toEqual({
      apiKey: "••••",
      hf_token: "••••",
      max_tokens: 50,
      image: "[inline image/png, 0 KB]",
      nested: { password: "••••" },
    });
  });

  it("tells the same request from another model's", () => {
    const a = { feature: "image", modelId: "m", prompt: "x", params: { seed: 1 } } as GenerationRequest;
    expect(runMatch(a, { ...a })).toBe("same");
    expect(runMatch(a, { ...a, modelId: "n" })).toBe("other-model");
    expect(runMatch(a, { ...a, prompt: "y" })).toBe("other");
  });
});
