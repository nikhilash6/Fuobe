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

  it("answers 404 for a run that doesn't exist and for the owner's own run", async () => {
    expect((await get("nope")).status).toBe(404);
    expect((await get(run(undefined))).status).toBe(404);
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
    expect(owner.run.account.email).toBe("ann@example.com");
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
    const d = (await (await get(run(A))).json()) as RunDetails;
    // The Image studio opens on Qwen-Image 2.1 on the open engine where the server writes no caption.
    expect(d.model).toMatchObject({ id: "oss-qwen-image-21", state: "default" });
    expect(d.studio?.title).toBe("Image");
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
