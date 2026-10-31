import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { candidateValues, connectionSummary, FIRST_RUN_KEY, FIRST_RUN_SCRIPT, isTestProvider, nothingConnected, PROVIDER_SETTINGS, settingProblem, showFirstRun, type ConnectionState } from "@/lib/connections";

/** Settings' "Save & test", the first-run guide's rule and the connection status strip (R4-02, R4-03, R4-33). */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-connections-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.FAL_KEY;
delete process.env.ANTHROPIC_API_KEY;
const { POST: testRoute } = await import("@/app/api/providers/test/route");
const { GET: statusRoute } = await import("@/app/api/status/route");
const { getSetting, setSetting, withCandidates } = await import("@/server/settings");
const { starterPriceLine } = await import("@/lib/starter-prices");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Answer fetches by URL prefix (status, JSON body); remembers each request's URL and headers. */
async function withFetch<T>(answers: Record<string, [number, unknown]>, fn: () => Promise<T>) {
  const real = globalThis.fetch;
  const seen: { url: string; auth?: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    seen.push({ url, auth: headers.get("authorization") ?? headers.get("x-api-key") ?? undefined });
    const hit = Object.keys(answers).find((k) => url.startsWith(k));
    if (!hit) throw new TypeError("fetch failed");
    const [status, body] = answers[hit];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return { result: await fn(), seen };
  } finally {
    globalThis.fetch = real;
  }
}

const post = async (body: unknown) => {
  const res = await testRoute(new Request("http://localhost/api/providers/test", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as { ok: boolean; detail: string } };
};

describe("key and address checks", () => {
  it("wants fal.ai keys as key_id:key_secret", () => {
    expect(settingProblem("falKey", "1a2b3c-uuid:9f8e7d6c")).toBeNull();
    expect(settingProblem("falKey", "fal_abcdef")).toMatch(/key_id:key_secret/);
    expect(settingProblem("falKey", "abc:")).toMatch(/Both halves/);
    expect(settingProblem("falKey", "abc: def")).toMatch(/Both halves/);
    // Empty clears the key: nothing to warn about.
    expect(settingProblem("falKey", "  ")).toBeNull();
  });

  it("knows the other keys' shapes and wants web addresses for servers", () => {
    expect(settingProblem("replicateToken", "abc")).toMatch(/r8_/);
    expect(settingProblem("replicateToken", "r8_abc")).toBeNull();
    expect(settingProblem("anthropicKey", "sk-ant-api03-x")).toBeNull();
    expect(settingProblem("anthropicKey", "sk-proj-x")).toMatch(/sk-ant-/);
    expect(settingProblem("comfyUrl", "http://127.0.0.1:8188")).toBeNull();
    expect(settingProblem("comfyUrl", "127.0.0.1:8188")).toBe("Add http:// in front: http://127.0.0.1:8188");
    expect(settingProblem("ollamaUrl", "ftp://box")).toMatch(/http:\/\//);
    expect(settingProblem("comfyUrl", "not a url")).toMatch(/isn't a web address/);
    expect(settingProblem("ollamaModel", "anything")).toBeNull();
    expect(settingProblem("aiToolkitUrl", "127.0.0.1:8675")).toBe("Add http:// in front: http://127.0.0.1:8675");
    expect(settingProblem("aiToolkitUrl", "http://gpu-box:8675")).toBeNull();
    expect(settingProblem("aiToolkitDatasetDir", "datasets")).toMatch(/full path/);
    expect(settingProblem("aiToolkitDatasetDir", "/mnt/shared/datasets")).toBeNull();
  });

  it("keeps a test's unsaved values to the settings that provider reads", () => {
    expect(isTestProvider("fal")).toBe(true);
    expect(isTestProvider("mock")).toBe(false);
    expect(isTestProvider("toString")).toBe(false);
    expect(candidateValues("fal", undefined, " a:b ")).toEqual({ falKey: "a:b" });
    expect(candidateValues("comfyui", { comfyUrl: "http://x:8188", falKey: "no", comfyToken: 5 })).toEqual({ comfyUrl: "http://x:8188" });
    expect(candidateValues("llm", { ollamaModel: "llama3" })).toEqual({ ollamaModel: "llama3" });
    expect(isTestProvider("ai-toolkit")).toBe(true);
    expect(candidateValues("ai-toolkit", undefined, " http://gpu:8675 ")).toEqual({ aiToolkitUrl: "http://gpu:8675" });
    expect(candidateValues("ai-toolkit", { aiToolkitToken: "t", comfyUrl: "x" })).toEqual({ aiToolkitToken: "t" });
  });
});

describe("first-run guide and status strip", () => {
  const state = (configured: string[], engineMode: ConnectionState["engineMode"] = "both", onboarded = false): ConnectionState => ({
    providers: Object.fromEntries(["fal", "replicate", "comfyui", "llm", "mock"].map((p) => [p, { configured: configured.includes(p) || p === "mock" }])),
    engineMode,
    onboarded,
  });

  it("shows the guide until something the engine mode uses is connected, or it was put away", () => {
    expect(showFirstRun(undefined)).toBe(false);
    expect(showFirstRun(state([]))).toBe(true);
    expect(showFirstRun(state(["fal"]))).toBe(false);
    expect(showFirstRun(state(["comfyui"]))).toBe(false);
    expect(showFirstRun(state([], "both", true))).toBe(false);
    // An LLM alone makes nothing.
    expect(showFirstRun(state(["llm"]))).toBe(true);
    // A key doesn't help an open-source-only install, nor ComfyUI a paid-only one.
    expect(nothingConnected(state(["fal"], "open"))).toBe(true);
    expect(nothingConnected(state(["comfyui"], "cloud"))).toBe(true);
    expect(nothingConnected(state(["replicate"], "cloud"))).toBe(false);
  });

  it("shows Home's shell guide before the first paint only where this browser showed it last time", () => {
    const run = (stored: string | null | Error) => {
      const attrs: Record<string, string> = {};
      const localStorage = {
        getItem: (k: string) => {
          if (stored instanceof Error) throw stored;
          return k === FIRST_RUN_KEY ? stored : null;
        },
      };
      const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
      new Function("localStorage", "document", FIRST_RUN_SCRIPT)(localStorage, document);
      return attrs["data-first-run"];
    };
    expect(run("0")).toBe("0");
    // A guide still wanted: the shell shows it, so it doesn't push the page down later.
    expect(run("1")).toBe("1");
    // A first visit (a public studio's visitor never gets the guide): the shell leaves it out.
    expect(run(null)).toBeUndefined();
    // Storage blocked (a private window): nothing breaks.
    expect(run(new Error("denied"))).toBeUndefined();
  });

  it("says what each connection is doing, and which ones the mode doesn't use", () => {
    const s = connectionSummary(state(["replicate", "comfyui"], "open"));
    expect(s.map((c) => [c.id, c.text, c.ok, c.unused])).toEqual([
      ["fal", "Not set", false, true],
      ["replicate", "Key set", true, true],
      ["comfyui", "Online", true, false],
      ["llm", "Off", false, false],
    ]);
    expect(s.map((c) => c.href)).toEqual(["#fal", "#replicate", "#comfyui", "#text-ai"]);
  });

  it("says the owner's computer as Your GPU, and Connect on a hosted studio with nothing connected", () => {
    const gpu = (g: ConnectionState["ownerGpu"], place?: "here" | "network" | "hosted") => connectionSummary({ ...state(["comfyui"], "open"), ownerGpu: g }, place).find((c) => c.id === "comfyui");
    expect(gpu({ mode: "computer", online: true, device: "cuda:0 NVIDIA GeForce RTX 5090" })).toMatchObject({ label: "Your GPU", text: "Your computer · Online", ok: true, href: "#comfyui" });
    expect(gpu({ mode: "computer", online: false, comfy: "down" })).toMatchObject({ label: "Your GPU", text: "Your computer · ComfyUI not running", ok: false });
    expect(gpu({ mode: "computer", online: false, comfy: "no-setting" })).toMatchObject({ text: "Your computer · Needs a setting", ok: false });
    expect(gpu({ mode: "computer", online: false }, "hosted")).toMatchObject({ text: "Your computer · Offline", ok: false });
    const hosted = connectionSummary(state([], "open"), "hosted").find((c) => c.id === "comfyui");
    expect(hosted).toMatchObject({ label: "Your GPU", text: "Connect", ok: false, href: "#comfyui" });
    // On the server's own machine, or once a server ComfyUI answers: as before.
    expect(connectionSummary(state([], "open"), "here").find((c) => c.id === "comfyui")).toMatchObject({ label: "ComfyUI", text: "Offline" });
    expect(connectionSummary(state(["comfyui"], "open"), "hosted").find((c) => c.id === "comfyui")).toMatchObject({ label: "ComfyUI", text: "Online" });
  });

  it("lets a ComfyUI test say where ComfyUI runs, so a server address is tested as a server", () => {
    expect(PROVIDER_SETTINGS.comfyui).toContain("comfyWhere");
    expect(candidateValues("comfyui", { comfyUrl: "https://gpu.example.com", comfyWhere: "server" })).toEqual({ comfyUrl: "https://gpu.example.com", comfyWhere: "server" });
  });

  it("quotes a first image and clip on the default paid models", () => {
    expect(starterPriceLine()).toMatch(/^Nano Banana Pro ≈ \$[\d.]+ an image · Seedance 2\.5 ≈ \$[\d.]+ a 5 s clip$/);
  });
});

describe("POST /api/providers/test with unsaved values", () => {
  it("tests a typed fal.ai key without saving it, and says what a key looks like when it's rejected", async () => {
    setSetting("falKey", "saved-id:saved-secret");
    const ok = await withFetch({ "https://queue.fal.run/": [404, { detail: "Request not found" }] }, () => post({ provider: "fal", value: "new-id:new-secret" }));
    expect(ok.result.body).toEqual({ ok: true, detail: "Key accepted" });
    expect(ok.seen[0].auth).toBe("Key new-id:new-secret");
    expect(getSetting("falKey")).toBe("saved-id:saved-secret");

    const bad = await withFetch({ "https://queue.fal.run/": [401, { detail: "Unauthorized" }] }, () => post({ provider: "fal", values: { falKey: "fal_only_half" } }));
    expect(bad.result.body.ok).toBe(false);
    expect(bad.result.body.detail).toMatch(/^Key rejected \(401\) — fal\.ai keys look like key_id:key_secret/);
    // A proxy or an outage isn't a verdict on the key.
    const blocked = await withFetch({ "https://queue.fal.run/": [405, {}] }, () => post({ provider: "fal", value: "new-id:new-secret" }));
    expect(blocked.result.body).toEqual({ ok: false, detail: "Couldn't check the key: fal.ai answered 405. Try again in a moment" });
    // Without values it tests the saved key.
    const saved = await withFetch({ "https://queue.fal.run/": [404, {}] }, () => post({ provider: "fal" }));
    expect(saved.seen[0].auth).toBe("Key saved-id:saved-secret");
    setSetting("falKey", "");
  });

  it("tests a ComfyUI address before it's saved, and says so when nothing answers", async () => {
    const stats = { system: { comfyui_version: "0.41.0" }, devices: [{ name: "cpu", vram_total: 0 }] };
    const ok = await withFetch({ "http://10.1.2.3:8188/system_stats": [200, stats] }, () => post({ provider: "comfyui", value: "http://10.1.2.3:8188/" }));
    expect(ok.result.body).toEqual({ ok: true, detail: "ComfyUI 0.41.0 · cpu" });
    expect(getSetting("comfyUrl")).toBe("http://127.0.0.1:9");
    const down = await withFetch({}, () => post({ provider: "comfyui", values: { comfyUrl: "http://10.9.9.9:8188" } }));
    expect(down.result.body).toMatchObject({ ok: false, detail: expect.stringMatching(/^Can't reach ComfyUI at http:\/\/10\.9\.9\.9:8188/) });
  });

  it("keeps the saved ComfyUI token with the server it was saved for", async () => {
    const stats = { system: { comfyui_version: "0.41.0" }, devices: [{ name: "cpu", vram_total: 0 }] };
    setSetting("comfyToken", "saved-secret-token");
    const answers = { "http://10.1.2.3:8188/system_stats": [200, stats], "http://127.0.0.1:9/system_stats": [200, stats], "http://10.1.2.4:8189/system_stats": [200, stats] } as Record<string, [number, unknown]>;
    // A new address gets no token unless one is typed with it.
    const other = await withFetch(answers, () => post({ provider: "comfyui", value: "http://10.1.2.3:8188" }));
    expect(other.result.body.ok).toBe(true);
    expect(other.seen.map((r) => r.auth)).toEqual([undefined]);
    const typed = await withFetch(answers, () => post({ provider: "comfyui", values: { comfyUrl: "http://10.1.2.3:8188", comfyToken: "typed-token" } }));
    expect(typed.seen.map((r) => r.auth)).toEqual(["Bearer typed-token"]);
    // The saved server, typed again or not, still gets it.
    const same = await withFetch(answers, () => post({ provider: "comfyui", value: "http://127.0.0.1:9/" }));
    expect(same.seen.map((r) => r.auth)).toEqual(["Bearer saved-secret-token"]);
    const saved = await withFetch(answers, () => post({ provider: "comfyui" }));
    expect(saved.seen.map((r) => r.auth)).toEqual(["Bearer saved-secret-token"]);
    // The isolated worker's address is tested on its own, and a new one gets no token either.
    const iso = await withFetch(answers, () => post({ provider: "comfyui", values: { comfyIsolatedUrl: "http://10.1.2.4:8189" } }));
    expect(iso.result.body).toEqual({ ok: true, detail: "isolated worker: ComfyUI 0.41.0 · cpu" });
    expect(iso.seen).toEqual([{ url: "http://10.1.2.4:8189/system_stats", auth: undefined }]);
    const isoDown = await withFetch(answers, () => post({ provider: "comfyui", values: { comfyIsolatedUrl: "http://10.1.2.5:8189" } }));
    expect(isoDown.result.body).toMatchObject({ ok: false, detail: expect.stringMatching(/isolated ComfyUI worker at http:\/\/10\.1\.2\.5:8189 doesn't answer/) });
    setSetting("comfyToken", "");
  });

  it("checks a typed Anthropic key with Anthropic, also when text steps run on Ollama", async () => {
    const tags = { models: [{ name: "qwen3:8b" }] };
    const rejectedKey = { "https://api.anthropic.com/v1/models": [401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }], "http://127.0.0.1:9/api/tags": [200, tags] } as Record<string, [number, unknown]>;
    const goodKey = { "https://api.anthropic.com/v1/models": [200, { data: [], has_more: false }], "http://127.0.0.1:9/api/tags": [200, tags] } as Record<string, [number, unknown]>;
    for (const [mode, enhancer, note] of [
      ["open", "auto", "Open source only mode keeps text steps on Ollama"],
      ["both", "ollama", "text steps use Ollama (AI helper)"],
    ] as const) {
      setSetting("engineMode", mode);
      setSetting("enhanceProvider", enhancer);
      const bogus = await withFetch(rejectedKey, () => post({ provider: "llm", values: { anthropicKey: "sk-ant-bogus-key-123" } }));
      expect(bogus.result.body, mode).toEqual({ ok: false, detail: "Anthropic rejected the key (401)" });
      const good = await withFetch(goodKey, () => post({ provider: "llm", values: { anthropicKey: "sk-ant-good" }, field: "anthropicKey" }));
      expect(good.result.body, mode).toEqual({ ok: true, detail: `Claude key accepted · ${note}` });
    }
    // The saved key, checked from its own field (nothing typed).
    setSetting("anthropicKey", "sk-ant-saved");
    const saved = await withFetch(rejectedKey, () => post({ provider: "llm", field: "anthropicKey" }));
    expect(saved.result.body).toEqual({ ok: false, detail: "Anthropic rejected the key (401)" });
    expect(saved.seen.some((r) => r.auth === "sk-ant-saved")).toBe(true);
    // A field another provider owns is ignored: the whole text-step check runs.
    const ollamaField = await withFetch(rejectedKey, () => post({ provider: "llm", field: "falKey" }));
    expect(ollamaField.result.body.detail).toMatch(/Ollama/);
    for (const n of ["engineMode", "enhanceProvider", "anthropicKey"] as const) setSetting(n, "");
  });

  it("tests Ollama's address and model, and an Anthropic key, for text steps", async () => {
    const tags = { models: [{ name: "qwen3:8b" }] };
    const ready = await withFetch({ "http://10.0.0.5:11434/api/tags": [200, tags] }, () => post({ provider: "llm", values: { ollamaUrl: "http://10.0.0.5:11434" } }));
    expect(ready.result.body).toEqual({ ok: true, detail: "Ollama · qwen3:8b ready" });
    const missing = await withFetch({ "http://10.0.0.5:11434/api/tags": [200, tags] }, () => post({ provider: "llm", values: { ollamaUrl: "http://10.0.0.5:11434", ollamaModel: "llama3.3" } }));
    expect(missing.result.body).toEqual({ ok: false, detail: "Ollama answers, but llama3.3 isn't pulled — run: ollama pull llama3.3" });
    const none = await withFetch({}, () => post({ provider: "llm" }));
    expect(none.result.body).toMatchObject({ ok: false, detail: expect.stringMatching(/Add an Anthropic key, or start Ollama/) });

    const rejected = await withFetch(
      { "https://api.anthropic.com/v1/models": [401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }] },
      () => post({ provider: "llm", values: { anthropicKey: "sk-ant-wrong" } }),
    );
    expect(rejected.result.body).toEqual({ ok: false, detail: "Anthropic rejected the key (401)" });
    expect(rejected.seen.some((r) => r.url.startsWith("https://api.anthropic.com/v1/models") && r.auth === "sk-ant-wrong")).toBe(true);
    const accepted = await withFetch({ "https://api.anthropic.com/v1/models": [200, { data: [{ id: "claude-opus-5-5", type: "model" }], has_more: false }] }, () =>
      post({ provider: "llm", values: { anthropicKey: "sk-ant-good" } }),
    );
    expect(accepted.result.body).toEqual({ ok: true, detail: "Claude key accepted" });
    expect(getSetting("anthropicKey")).toBe("");
  });

  it("tests an AI-Toolkit address (Soul ID's GPU trainer) before it's saved: its UI's job list, with the auth token it wants", async () => {
    const jobs = (n: number) => ({ jobs: Array.from({ length: n }, (_, i) => ({ id: `j${i}`, status: "running" })) });
    const ready = await withFetch({ "http://10.0.0.7:8675/api/jobs": [200, jobs(0)] }, () => post({ provider: "ai-toolkit", value: "http://10.0.0.7:8675/" }));
    expect(ready.result.body).toEqual({ ok: true, detail: "AI-Toolkit · ready, no training running" });
    expect(ready.seen).toEqual([{ url: "http://10.0.0.7:8675/api/jobs?only_active=true", auth: undefined }]);
    expect(getSetting("aiToolkitUrl")).toBe("");
    const busy = await withFetch({ "http://10.0.0.7:8675/api/jobs": [200, jobs(2)] }, () => post({ provider: "ai-toolkit", value: "http://10.0.0.7:8675" }));
    expect(busy.result.body).toEqual({ ok: true, detail: "AI-Toolkit · 2 trainings running" });
    // An older UI that lists every job: only the ones still going count.
    const all = await withFetch({ "http://10.0.0.7:8675/api/jobs": [200, { jobs: [{ status: "completed" }, { status: "queued" }, { status: "error" }] }] }, () =>
      post({ provider: "ai-toolkit", value: "http://10.0.0.7:8675" }),
    );
    expect(all.result.body).toEqual({ ok: true, detail: "AI-Toolkit · 1 training running" });
    // AI_TOOLKIT_AUTH set on the trainer: it wants the token.
    const locked = await withFetch({ "http://10.0.0.7:8675/api/jobs": [401, { error: "Unauthorized" }] }, () => post({ provider: "ai-toolkit", value: "http://10.0.0.7:8675" }));
    // Settings tests one field at a time, so the way there is the address saved anyway, then the token tested on it.
    expect(locked.result.body).toEqual({ ok: false, detail: "AI-Toolkit wants its auth token (AI_TOOLKIT_AUTH on the trainer): Save anyway, then add the token under Auth token and test it there" });
    const typed = await withFetch({ "http://10.0.0.7:8675/api/jobs": [401, { error: "Unauthorized" }] }, () =>
      post({ provider: "ai-toolkit", values: { aiToolkitUrl: "http://10.0.0.7:8675", aiToolkitToken: "wrong" } }),
    );
    expect(typed.result.body).toEqual({ ok: false, detail: "AI-Toolkit rejected the auth token (401)" });
    expect(typed.seen[0].auth).toBe("Bearer wrong");
    // Something else on that port, or nothing at all.
    const other = await withFetch({ "http://10.0.0.7:8675/api/jobs": [200, { hello: "world" }] }, () => post({ provider: "ai-toolkit", value: "http://10.0.0.7:8675" }));
    expect(other.result.body).toEqual({ ok: false, detail: "Something answers at http://10.0.0.7:8675, but it isn't AI-Toolkit's UI (port 8675 by default)" });
    const down = await withFetch({}, () => post({ provider: "ai-toolkit", value: "http://10.0.0.8:8675" }));
    expect(down.result.body).toMatchObject({ ok: false, detail: expect.stringMatching(/^Can't reach AI-Toolkit at http:\/\/10\.0\.0\.8:8675 .*Is its UI running\?/) });
    const none = await withFetch({}, () => post({ provider: "ai-toolkit" }));
    expect(none.result.body).toEqual({ ok: false, detail: "No AI-Toolkit URL set — its UI listens on http://127.0.0.1:8675" });
  });

  it("keeps the saved AI-Toolkit token with the trainer it was saved for", async () => {
    setSetting("aiToolkitUrl", "http://10.0.0.7:8675");
    setSetting("aiToolkitToken", "saved-aitk-token");
    const answers = { "http://10.0.0.7:8675/api/jobs": [200, { jobs: [] }], "http://10.0.0.9:8675/api/jobs": [401, { error: "Unauthorized" }] } as Record<string, [number, unknown]>;
    const saved = await withFetch(answers, () => post({ provider: "ai-toolkit" }));
    expect(saved.seen.map((r) => r.auth)).toEqual(["Bearer saved-aitk-token"]);
    // A new address gets no token unless one is typed with it, and says so when the trainer wants one.
    const other = await withFetch(answers, () => post({ provider: "ai-toolkit", value: "http://10.0.0.9:8675" }));
    expect(other.seen.map((r) => r.auth)).toEqual([undefined]);
    // Settings can't send a token with a new address (each field tests on its own): saved anyway, the token is tested there.
    expect(other.result.body.detail).toBe(
      "AI-Toolkit wants its auth token, and the saved one isn't sent to a new address (it stays with http://10.0.0.7:8675): Save anyway, then test the token under Auth token (type this trainer's there if it differs)",
    );
    setSetting("aiToolkitUrl", "http://10.0.0.9:8675");
    const after = await withFetch({ "http://10.0.0.9:8675/api/jobs": [200, { jobs: [] }] }, () => post({ provider: "ai-toolkit", field: "aiToolkitToken" }));
    expect(after.result.body).toEqual({ ok: true, detail: "AI-Toolkit · ready, no training running" });
    expect(after.seen.map((r) => r.auth)).toEqual(["Bearer saved-aitk-token"]);
    const retyped = await withFetch({ "http://10.0.0.9:8675/api/jobs": [200, { jobs: [] }] }, () => post({ provider: "ai-toolkit", values: { aiToolkitToken: "new-token" }, field: "aiToolkitToken" }));
    expect(retyped.seen.map((r) => r.auth)).toEqual(["Bearer new-token"]);
    setSetting("aiToolkitUrl", "http://10.0.0.7:8675");
    const same = await withFetch(answers, () => post({ provider: "ai-toolkit", value: "http://10.0.0.7:8675/" }));
    expect(same.seen.map((r) => r.auth)).toEqual(["Bearer saved-aitk-token"]);
    setSetting("aiToolkitUrl", "");
    setSetting("aiToolkitToken", "");
  });

  it("checks the training photos folder can be written, without making it", async () => {
    const fresh = path.join(dir, "shared", "datasets");
    const ok = await post({ provider: "ai-toolkit", values: { aiToolkitDatasetDir: fresh }, field: "aiToolkitDatasetDir" });
    expect(ok.body).toEqual({ ok: true, detail: `Fuobe writes the training photos to ${fresh}: AI-Toolkit has to read the same folder` });
    expect(fs.existsSync(fresh)).toBe(false);
    const file = path.join(dir, "a-file");
    fs.writeFileSync(file, "");
    const blocked = await post({ provider: "ai-toolkit", values: { aiToolkitDatasetDir: path.join(file, "datasets") }, field: "aiToolkitDatasetDir" });
    expect(blocked.body).toMatchObject({ ok: false, detail: expect.stringMatching(/^Fuobe can't write to .*a-file/) });
    const relative = await post({ provider: "ai-toolkit", values: { aiToolkitDatasetDir: "datasets" }, field: "aiToolkitDatasetDir" });
    expect(relative.body.ok).toBe(false);
    expect(relative.body.detail).toMatch(/full path/);
    // Nothing typed and nothing saved: Fuobe's own data folder, for an AI-Toolkit on this machine.
    const own = await post({ provider: "ai-toolkit", field: "aiToolkitDatasetDir" });
    expect(own.body).toEqual({ ok: true, detail: `Fuobe writes the training photos to ${path.join(dir, "datasets")} (its data folder), for an AI-Toolkit on this machine` });
  });

  it("refuses unknown providers and values a setting doesn't allow", async () => {
    expect((await post({ provider: "mock" })).status).toBe(400);
    expect((await post({ provider: "llm", values: { enhanceProvider: "gpt" } })).body).toMatchObject({ ok: false, detail: expect.stringMatching(/enhanceProvider must be one of/) });
  });

  it("reads candidates only inside the test", () => {
    setSetting("ollamaModel", "qwen3:8b");
    expect(withCandidates({ ollamaModel: "llama3" }, () => getSetting("ollamaModel"))).toBe("llama3");
    // An empty candidate reads as unset: the environment or the default.
    expect(withCandidates({ ollamaModel: "" }, () => getSetting("ollamaModel"))).toBe("qwen3:8b");
    expect(getSetting("ollamaModel")).toBe("qwen3:8b");
  });
});

describe("GET /api/status", () => {
  const onboarded = async () => ((await (await statusRoute()).json()) as { onboarded: boolean }).onboarded;

  it("says whether the first-run guide was put away", async () => {
    expect(await onboarded()).toBe(false);
    setSetting("onboarded", "1");
    expect(await onboarded()).toBe(true);
    setSetting("onboarded", "");
  });

  it("remembers the first connection the engine mode generates with, so an offline day doesn't bring the guide back", async () => {
    // Claude makes nothing by itself, and a fal.ai key doesn't serve an open-source-only install.
    setSetting("anthropicKey", "sk-ant-x");
    expect(await onboarded()).toBe(false);
    setSetting("engineMode", "open");
    setSetting("falKey", "id:secret");
    expect(await onboarded()).toBe(false);
    expect(getSetting("onboarded")).toBe("0");
    setSetting("engineMode", "");
    expect(await onboarded()).toBe(true);
    expect(getSetting("onboarded")).toBe("1");
    // The key goes (or ComfyUI is offline one morning): the guide stays put away.
    setSetting("falKey", "");
    expect(await onboarded()).toBe(true);
    for (const n of ["anthropicKey", "onboarded"] as const) setSetting(n, "");
  });
});
