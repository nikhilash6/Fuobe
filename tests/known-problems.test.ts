import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { startFakeComfy, readyFor, type FakeComfy, type FakeScenario } from "./helpers/fake-comfy";
import { tempDir } from "./helpers/temp-dir";

/**
 * Known problems of a ComfyUI version on a kind of system (src/lib/gpu/known-problems.ts), starting with ComfyUI 0.43's
 * os.memfd_create on a standalone Linux Python: before Run, the account's GPU check names it with its fixes (recommended
 * first) and Run anyway stays; a run that stopped with it gets its own words and no Retry.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 30_000 });

const dir = tempDir("fuobe-known-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
delete process.env.FUOBE_GPU_PREFLIGHT;

const auth = await import("@/server/auth");
const { loadIndex } = await import("@/server/gpu/index-file");
const { gpuTargetFor } = await import("@/server/gpu/target");
const { gateGeneration } = await import("@/server/gpu/gate");
const check = await import("@/app/api/gpu/check/route");
const plan = await import("@/app/api/gpu/plan/route");
const badges = await import("@/app/api/gpu/badges/route");
const { knownProblems, knownProblemOf, knownFixes } = await import("@/lib/gpu/known-problems");
const { parseArgv } = await import("@/lib/gpu/argv");
const { diagnoseGpuJob } = await import("@/lib/diagnose");
const { readinessLine } = await import("@/lib/gpu/file-steps");

const idx = loadIndex();
const QWEN = "qwen-image-21-edit";
const LINUX_UV = "3.12.11 (main, Jun  4 2025, 17:36:46) [Clang 20.1.4 ]";
const LINUX_DISTRO = "3.12.3 (main, Nov  6 2025, 13:44:16) [GCC 13.3.0]";
const MEMFD = "module 'os' has no attribute 'memfd_create'";
const CARD = { devices: [{ name: "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync", type: "cuda", vramGb: 24 }] };

const fakes: FakeComfy[] = [];
afterAll(async () => {
  globalThis.__fuobeGpuTestTransport = undefined;
  await Promise.all(fakes.map((f) => f.close()));
});
beforeAll(() => {
  auth.setPassword("install password");
  globalThis.__fuobeGpuTestTransport = { resolve: async (h) => (h.endsWith(".gpu.test") ? ["127.0.0.1"] : ["203.0.113.9"]), blocked: () => false };
});

function req(url: string, o: { method?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", "sec-fetch-site": "same-origin" };
  if (o.cookie) headers.cookie = `${auth.SESSION_COOKIE}=${o.cookie}`;
  return new NextRequest(`http://localhost:3000${url}`, { method: o.method ?? "GET", headers });
}

let n = 0;
async function accountWith(s: FakeScenario) {
  const f = await startFakeComfy(s);
  fakes.push(f);
  const a = auth.createAccount(`known${++n}@example.com`, "long enough");
  auth.setAccountGpu(a.id, { url: `http://k${n}.gpu.test:${f.port}` });
  const cookie = auth.createSession(a.id).value;
  await (await check.POST(req("/api/gpu/check", { method: "POST", cookie }))).text();
  return { cookie, t: gpuTargetFor(req("/", { cookie }), "read") };
}

const run = { request: { feature: "image", modelId: "oss-qwen-image-21", op: "edit" as const, prompt: "make it night", account: "x", engine: "open" as const }, route: { provider: "comfyui", endpoint: QWEN }, op: "edit", modelId: "oss-qwen-image-21", actor: "x" };

/** The facts a check reads, as known problems see them. */
const facts = (o: { os?: string; version?: string; build?: string; argv?: string[]; type?: string }) => ({
  reachable: true,
  comfy: { version: o.version ?? "0.43.1", os: o.os ?? "posix", pythonBuild: o.build ?? "Clang 20.1.4", embeddedPython: false, deployEnv: "local-git", flags: parseArgv(["main.py", ...(o.argv ?? [])]) },
  devices: [{ name: "x", type: o.type ?? "cuda", index: 0, vramTotal: 1, vramFree: 1 }],
});

describe("ComfyUI 0.43's memfd_create on a standalone Linux Python", () => {
  it("is read from the check's facts: Linux, ComfyUI 0.43.x, dynamic VRAM on, a Clang-built (standalone) Python", () => {
    expect(knownProblems(facts({})).map((p) => p.id)).toEqual(["comfy-043-memfd"]);
    for (const v of ["0.43.0", "0.43.2"]) expect(knownProblems(facts({ version: v })), v).toHaveLength(1);
    // ComfyUI 0.44.0 calls libc itself; 0.42 has no anonymous files.
    for (const v of ["0.44.0", "0.44.1", "0.42.5"]) expect(knownProblems(facts({ version: v })), v).toEqual([]);
    // Windows and macOS never reach the call.
    expect(knownProblems(facts({ os: "nt", build: "MSC v.1942 64 bit (AMD64)" }))).toEqual([]);
    expect(knownProblems(facts({ type: "mps" }))).toEqual([]);
    // A distro Python has the call; dynamic VRAM turned off never makes the file.
    expect(knownProblems(facts({ build: "GCC 13.3.0" }))).toEqual([]);
    for (const flag of ["--disable-dynamic-vram", "--highvram", "--gpu-only", "--novram", "--cpu"]) expect(knownProblems(facts({ argv: [flag] })), flag).toEqual([]);
  });

  it("names the fixes, recommended first, each with an example", () => {
    const fixes = knownFixes("comfy-043-memfd");
    expect(fixes[0].label).toMatch(/^Update ComfyUI to 0\.44\.0 or newer \(recommended\)/);
    expect(fixes[1].label).toMatch(/--disable-dynamic-vram/);
    expect(fixes.every((f) => f.example)).toBe(true);
  });

  it("a run that stopped with it: its own cause and words, How to update ComfyUI first, never Retry", () => {
    const d = diagnoseGpuJob({ kind: "error", nodeType: "KSampler", message: MEMFD }, { kind: "link", url: "https://abc-8188.proxy.runpod.net" });
    expect(d.cause).toBe("gpu-comfy-known");
    expect(d.words).toMatch(/Update ComfyUI to 0\.44\.0 or newer, or start it with --disable-dynamic-vram\./);
    expect(d.words).not.toMatch(/Retry/);
    expect(d.actions.map((a) => a.kind)).toEqual(["update-comfy", "check-gpu"]);
    expect(d.actions[0].target).toMatch(/^https:\/\/docs\.comfy\.org\//);
    expect(d.retryable).toBe(false);
    expect(d.details).toContain("KSampler");
    // On this computer or a paired ComfyUI: the update only.
    expect(diagnoseGpuJob({ kind: "error", nodeType: "KSampler", message: MEMFD }, { kind: "computer" }).actions.map((a) => a.kind)).toEqual(["update-comfy"]);
    // Any other error keeps its words.
    expect(diagnoseGpuJob({ kind: "error", nodeType: "KSampler", message: "boom" }, { kind: "computer" }).cause).toBe("gpu-job-error");
    expect(knownProblemOf("AttributeError: module 'os' has no attribute 'memfd_create'")?.id).toBe("comfy-043-memfd");
  });

  it("before Run on an account's GPU: the plan's step and the readiness line name the update; Run anyway (gpuCheck skip) still runs", async () => {
    const bad = await accountWith(readyFor(idx, [QWEN], { version: "0.43.1", python: LINUX_UV, ...CARD }));
    const g = await gateGeneration(bad.t, run);
    expect(g.ok).toBe(false);
    if (!g.ok) {
      const step = g.plan.steps.find((s) => s.problem === "comfy-043-memfd");
      expect(step).toMatchObject({ kind: "comfy-update", label: "Update ComfyUI to 0.44.0 or newer" });
      expect(step?.detail).toMatch(/^ComfyUI 0\.43\.1 stops at the first model on this Linux Python/);
      expect(step?.commands.bash).toMatch(/git -C .* pull/);
    }
    expect(await gateGeneration(bad.t, { ...run, skip: true })).toEqual({ ok: true });
    const map = await (await badges.GET(req("/api/gpu/badges", { cookie: bad.cookie }))).json();
    const badge = map.models["oss-qwen-image-21#edit"];
    expect(badge[0]).toBe("a");
    const p = await (await plan.GET(req("/api/gpu/plan?ref=model:oss-qwen-image-21%23edit", { cookie: bad.cookie }))).json();
    expect(readinessLine(badge, p)).toMatchObject({ state: "problem", words: "Your ComfyUI needs an update: 0.44.0 or newer" });

    // The same GPU on ComfyUI 0.44, or with a distro Python: ready, nothing said.
    for (const s of [readyFor(idx, [QWEN], { version: "0.44.0", python: LINUX_UV, ...CARD }), readyFor(idx, [QWEN], { version: "0.43.1", python: LINUX_DISTRO, ...CARD })]) {
      const ok = await accountWith(s);
      expect(await gateGeneration(ok.t, run)).toEqual({ ok: true });
    }
  });
});
