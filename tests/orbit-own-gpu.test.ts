import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { startFakeComfy, readyFor, type FakeComfy, type FakeScenario } from "./helpers/fake-comfy";
import { tempDir } from "./helpers/temp-dir";

/**
 * The orbit presets on an account's own GPU: they only ever run H3's Orbit graph (the Orbit LoRA), and a GPU without that
 * LoRA (or with another file under its name) gets the missing-file step that names it, its size, its folder and its
 * download, never a run on a graph that can't orbit.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 30_000 });

const dir = tempDir("fuobe-orbit-gpu-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
delete process.env.FUOBE_GPU_PREFLIGHT;

const auth = await import("@/server/auth");
const { loadIndex } = await import("@/server/gpu/index-file");
const { gpuTargetFor } = await import("@/server/gpu/target");
const { gateGeneration } = await import("@/server/gpu/gate");
const { presetTool } = await import("@/server/gpu/tools");
const check = await import("@/app/api/gpu/check/route");
const plan = await import("@/app/api/gpu/plan/route");
const badges = await import("@/app/api/gpu/badges/route");
const { getPreset } = await import("@/lib/catalog");
const { presetRoutes, ORBIT_WORDS } = await import("@/lib/catalog/preset-recipe-routes");
const { resolveWorkflowId } = await import("@/lib/comfy-variants");
const { fileSteps, readinessLine } = await import("@/lib/gpu/file-steps");
const { stepDownload } = await import("@/lib/gpu/plan");

const idx = loadIndex();
const ORBIT = "minimax-h3-orbit";
const LORA = "minimax_h3_flf2v_lora_v1.safetensors";
const LORA_KEY = `loras/${LORA}` as const;
/** Every preset whose recipe is H3's orbit (preset-recipe-book.json quality "orbit"). */
const ORBIT_PRESETS = ["app-bullet-time-splash", "app-bullet-time-scene", "app-bullet-time-white", "app-3d-rotation", "app-product-360", "motion-bullet-time", "motion-360-orbit", "motion-3d-rotation", "effect-frozen-in-motion"];
const CARD = { version: "0.42.1", devices: [{ name: "cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync", type: "cuda", vramGb: 32 }] };

const fakes: FakeComfy[] = [];
afterAll(async () => {
  globalThis.__fuobeGpuTestTransport = undefined;
  await Promise.all(fakes.map((f) => f.close()));
});
beforeAll(() => {
  auth.setPassword("install password");
  globalThis.__fuobeGpuTestTransport = { resolve: async (h) => (h.endsWith(".gpu.test") ? ["127.0.0.1"] : ["203.0.113.9"]), blocked: () => false };
});

let n = 0;
async function accountWith(s: FakeScenario) {
  const f = await startFakeComfy(s);
  fakes.push(f);
  const a = auth.createAccount(`orbit${++n}@example.com`, "long enough");
  auth.setAccountGpu(a.id, { url: `http://o${n}.gpu.test:${f.port}` });
  const cookie = auth.createSession(a.id).value;
  const res = await check.POST(req("/api/gpu/check", { method: "POST", cookie }));
  await res.text();
  return { cookie, f };
}

function req(url: string, o: { method?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", "sec-fetch-site": "same-origin" };
  if (o.cookie) headers.cookie = `${auth.SESSION_COOKIE}=${o.cookie}`;
  return new NextRequest(`http://localhost:3000${url}`, { method: o.method ?? "GET", headers });
}

/** The Orbit graph's needs on this GPU, with the LoRA left out, or given at another size. */
function orbitGpu(lora: "there" | "missing" | number): FakeScenario {
  const s = readyFor(idx, [ORBIT], CARD);
  if (lora === "there") return s;
  s.files = { ...s.files, loras: (s.files?.loras ?? []).filter((x) => x.name !== LORA) };
  s.combos = { ...s.combos, LoraLoaderModelOnly: { lora_name: (s.combos?.LoraLoaderModelOnly?.lora_name ?? []).filter((x) => x !== LORA) } };
  if (typeof lora === "number") {
    s.files.loras!.push({ name: LORA, size: lora });
    s.combos.LoraLoaderModelOnly.lora_name.push(LORA);
  }
  return s;
}

/** A run of the app as the composer sends it on the open engine: H3's image-to-video with the orbit's setting. */
const run = (presetId: string) => ({
  request: { feature: "video", modelId: "oss-minimax-h3", op: "i2v" as const, presetId, prompt: "", params: { duration: 3, extra: { orbit: true } }, account: "x", engine: "open" as const },
  route: { provider: "comfyui", endpoint: "minimax-h3-i2v" },
  op: "i2v",
  modelId: "oss-minimax-h3",
  actor: "x",
});

describe("an orbit never runs a graph that can't orbit", () => {
  it("resolves an orbit to the Orbit graph even when a library lacks it (the run then fails by name)", () => {
    const base = { op: "i2v", clips: 0, images: 1, audio2: false, extra: { orbit: true } };
    expect(resolveWorkflowId("minimax-h3-i2v", { ...base, has: () => true })).toBe(ORBIT);
    expect(resolveWorkflowId("minimax-h3-i2v", { ...base, has: () => false })).toBe(ORBIT);
    // Whatever the Quality or the card's tier asks.
    expect(resolveWorkflowId("minimax-h3-i2v", { ...base, extra: { orbit: true, quality: "best" }, has: () => true })).toBe(ORBIT);
    expect(resolveWorkflowId("minimax-h3-i2v", { ...base, extra: { orbit: true, quality: "flex" }, has: () => true })).toBe(ORBIT);
    expect(resolveWorkflowId("minimax-h3-i2v", { ...base, extra: {}, has: () => true })).toBe("minimax-h3-i2v");
  });

  it("checks every orbit preset's GPU tool against the Orbit graph and its LoRA, never the plain image-to-video graph", () => {
    expect(idx.workflows[ORBIT].files).toContain(LORA_KEY);
    for (const id of ORBIT_PRESETS) {
      const tool = presetTool(id);
      expect(tool?.workflows, id).toContain(ORBIT);
      expect(tool?.workflows, id).not.toContain("minimax-h3-i2v");
    }
  });

  it("words: the orbit's own say the camera moves; no other route of an orbit preset says only to freeze", () => {
    expect(ORBIT_WORDS).toMatch(/Only the camera moves\. In a continuous 360 orbit\./);
    const moves = /camera|orbit|rotat|spin|sweep|360/i;
    for (const id of ORBIT_PRESETS) {
      const p = getPreset(id)!;
      for (const engine of ["open", "cloud"] as const)
        for (const r of presetRoutes(p, engine, () => true)) expect(r.promptTemplate ?? p.promptTemplate, `${id} ${engine} ${r.modelId}`).toMatch(moves);
    }
  });
});

describe("an account's GPU without the Orbit LoRA", () => {
  it("is stopped before the run with the step that names the Orbit LoRA, its size, its folder and its download", async () => {
    const { cookie, f } = await accountWith(orbitGpu("missing"));
    const t = gpuTargetFor(req("/", { cookie }), "read");
    for (const id of ["app-bullet-time-splash", "motion-bullet-time"]) {
      const g = await gateGeneration(t, run(id));
      expect(g.ok, id).toBe(false);
      if (g.ok) continue;
      const files = fileSteps(g.plan);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({ title: "Orbit LoRA", file: LORA, folder: "models/loras", again: false, size: "155 MB" });
      expect(files[0].url).toBe(idx.files[LORA_KEY].pinnedUrl);
      expect(files[0].url).toMatch(/^https:\/\/huggingface\.co\/pablodawson\/MiniMax-H3-360-Orbit-LoRA\/resolve\/[0-9a-f]{40}\//);
      expect(g.message).toMatch(/before it can run/);
    }
    // Nothing reached the GPU but reads.
    expect(f.requests.some((r) => r.method !== "GET" || r.path.includes("/prompt"))).toBe(false);
    // The badge (cached) and the plan the readiness line reads say the same.
    const map = await (await badges.GET(req("/api/gpu/badges", { cookie }))).json();
    const badge = map.presets["app-bullet-time-splash"];
    expect(badge.slice(0, 2)).toEqual(["a", 1]);
    const p = await (await plan.GET(req("/api/gpu/plan?ref=preset:app-bullet-time-splash", { cookie }))).json();
    expect(readinessLine(badge, p)).toMatchObject({ state: "files", words: "Needs 1 file on your GPU: Orbit LoRA" });
  });

  it("asks for the file again when the one under its name is another size (a pinned file's size is exact)", async () => {
    const { cookie } = await accountWith(orbitGpu(idx.files[LORA_KEY].sizeBytes * 2));
    const g = await gateGeneration(gpuTargetFor(req("/", { cookie }), "read"), run("app-bullet-time-splash"));
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.plan.steps.find((s) => s.download)?.kind).toBe("model-replace");
      expect(fileSteps(g.plan)[0]).toMatchObject({ title: "Orbit LoRA", again: true });
      expect(readinessLine(["a", 1, 2, 0], g.plan)?.words).toBe("Download 1 file again on your GPU: Orbit LoRA");
    }
  });
});

describe("an account's GPU with the Orbit LoRA", () => {
  it("runs the Orbit graph: the gate lets it through and the badge reads Ready", async () => {
    const { cookie } = await accountWith(orbitGpu("there"));
    const t = gpuTargetFor(req("/", { cookie }), "read");
    for (const id of ORBIT_PRESETS.filter((x) => presetTool(x)?.workflows.length === 1)) expect(await gateGeneration(t, run(id)), id).toEqual({ ok: true });
    const map = await (await badges.GET(req("/api/gpu/badges", { cookie }))).json();
    expect(map.presets["app-bullet-time-splash"][0]).toBe("r");
    expect(readinessLine(map.presets["app-bullet-time-splash"], null)).toMatchObject({ state: "ready", words: "Ready on your GPU" });
  });
});

describe("where a file downloads from", () => {
  const lora = (o: Partial<{ url: string; page: string; download: "direct" | "civitai-token" | "hf-gated" }>) => ({ file: "x.safetensors", download: "direct" as const, ...o });
  const need = { key: "lora:x.safetensors", kind: "lora" as const, label: "Style file (LoRA)", detail: "", lora: "x.safetensors" };
  it("is the file itself when anyone can download it, else its page (https only)", () => {
    expect(stepDownload(need, null, idx, lora({ url: "https://huggingface.co/a/b/resolve/main/x.safetensors" }))).toMatchObject({ file: "x.safetensors", folder: "models/loras", url: "https://huggingface.co/a/b/resolve/main/x.safetensors" });
    expect(stepDownload(need, null, idx, lora({ url: "https://civitai.com/api/download/models/1", download: "civitai-token", page: "https://civitai.com/models/1" }))).toMatchObject({ url: "https://civitai.com/models/1", page: true });
    expect(stepDownload(need, null, idx, lora({ url: "https://huggingface.co/a/b/resolve/main/x.safetensors", download: "hf-gated" }))).toMatchObject({ url: "https://huggingface.co/a/b", page: true });
    expect(stepDownload(need, null, idx, lora({ url: "http://example.com/x.safetensors" }))?.url).toBeUndefined();
    expect(stepDownload({ ...need, kind: "restart" }, null, idx)).toBeUndefined();
  });

  it("names the folder on the person's ComfyUI when its check read a plain path", () => {
    const inv = { comfy: { modelRoots: { loras: ["C:\\ComfyUI\\models\\loras"] } } } as never;
    expect(stepDownload({ ...need, kind: "model", file: LORA_KEY, lora: undefined }, inv, idx)).toMatchObject({ file: LORA, folder: "models/loras", path: "C:\\ComfyUI\\models\\loras" });
    // A folder the check didn't list: under the ComfyUI folder another one names.
    const other = { comfy: { modelRoots: { vae: ["/home/me/ComfyUI/models/vae"] } } } as never;
    expect(stepDownload({ ...need, kind: "model", file: LORA_KEY, lora: undefined }, other, idx)?.path).toBe("/home/me/ComfyUI/models/loras");
    // A path the commands wouldn't take isn't shown either.
    const odd = { comfy: { modelRoots: { loras: ["/home/me/$(x)/models/loras"] } } } as never;
    expect(stepDownload({ ...need, kind: "model", file: LORA_KEY, lora: undefined }, odd, idx)?.path).toBeUndefined();
  });
});
