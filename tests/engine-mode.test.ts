import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

// Isolated database for this file (must be set before the server modules load).
const dir = tempDir("fuobe-test-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here → open models fall back to demo

const { setSetting, getSetting, validateSetting } = await import("@/server/settings");
const { chooseRoute, createGenerations, previewGeneration } = await import("@/server/generations");
const { getModel, getPreset } = await import("@/lib/catalog");
const pref = await import("@/lib/engine-pref");
const api = await import("@/lib/api");
const { gpuBeforeRun, onCloudKey } = await import("@/lib/before-run");
const { withKeyAction } = await import("@/lib/diagnose");
const { keySavedText } = await import("@/lib/your-keys");

beforeAll(() => setSetting("demoMode", "auto"));

describe("engine mode", () => {
  it("defaults to both and rejects invalid values", () => {
    expect(getSetting("engineMode")).toBe("both");
    expect(() => validateSetting("engineMode", "gpu")).toThrow(/both, open, cloud/);
    expect(() => setSetting("cloudProvider", "openai")).toThrow();
  });

  it("open-source-only blocks paid models on the server", () => {
    setSetting("engineMode", "open");
    expect(() => createGenerations({ feature: "image", modelId: "nano-banana-pro", prompt: "x" })).toThrow(/isn't available here/);
    const [g] = createGenerations({ feature: "image", modelId: "oss-z-image-turbo", prompt: "x" });
    expect(g.engine).toBe("open");
  });

  it("paid-only blocks open models", () => {
    setSetting("engineMode", "cloud");
    expect(() => createGenerations({ feature: "image", modelId: "oss-z-image-turbo", prompt: "x" })).toThrow(/isn't available here/);
    setSetting("engineMode", "both");
  });
});

describe("preferred cloud provider", () => {
  it("orders routes by the preferred aggregator when both are configured", () => {
    setSetting("falKey", "fal_test_key_123456");
    setSetting("replicateToken", "r8_test_token_123456");
    const routes = getModel("nano-banana-pro")!.routes.filter((r) => r.op === "t2i");
    expect(chooseRoute(routes).route.provider).toBe("fal");
    setSetting("cloudProvider", "replicate");
    expect(chooseRoute(routes).route.provider).toBe("replicate");
    setSetting("cloudProvider", "auto");
    setSetting("falKey", "");
    expect(chooseRoute(routes).route.provider).toBe("replicate");
    setSetting("replicateToken", "");
    expect(chooseRoute(routes)).toMatchObject({ demo: true });
  });
});

describe("routes that take fewer images or can't batch", () => {
  const edit = () => getModel("grok-imagine-image-2")!.routes.filter((r) => r.op === "edit");

  it("says when a run sends more images than the model's only route takes", () => {
    setSetting("falKey", "fal_test_key_123456");
    expect(chooseRoute(edit(), 3).route.provider).toBe("fal");
    expect(() => chooseRoute(edit(), 8)).toThrow("This model takes up to 5 images on fal.ai — remove some");
    setSetting("falKey", "");
  });

  it("runs one job per take on a route without a batch count", () => {
    setSetting("replicateToken", "r8_test_token_123456");
    const req = { feature: "image", modelId: "nano-banana-pro", prompt: "a fox", params: { numOutputs: 4 } };
    expect(previewGeneration(req)).toMatchObject({ providerId: "replicate", jobs: 4, outputs: 4 });
    setSetting("falKey", "fal_test_key_123456");
    expect(previewGeneration(req)).toMatchObject({ providerId: "fal", jobs: 1, outputs: 4 });
    setSetting("falKey", "");
    setSetting("replicateToken", "");
  });
});

/** A browser's storage, for the engine switch's slots. */
function memoryStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    map: m,
  };
}

describe("the engine switch a studio starts on", () => {
  const known = (viewer: { kind: "guest" | "account"; hosted?: boolean; runOn?: string } | undefined, email?: string | null) => ({ known: true, viewer, email });
  afterEach(() => vi.unstubAllGlobals());

  it("hosted runs off: the browser's one switch, starting on Cloud, as always (the owner too)", () => {
    for (const facts of [known(undefined), known({ kind: "account" }, "ana@example.com"), known({ kind: "guest" }), { known: false }]) {
      expect(pref.engineSlot(facts)).toEqual({ key: "fuobe.engine", start: "cloud" });
      expect(pref.slotToCache(facts, pref.engineSlot(facts))).toBe(facts.known ? null : undefined);
    }
    vi.stubGlobal("localStorage", memoryStorage());
    expect(api.readEngine()).toBe("cloud");
    localStorage.setItem("fuobe.engine", "open");
    expect(api.readEngine()).toBe("open");
    localStorage.setItem("fuobe.engine", "something else");
    expect(api.readEngine()).toBe("cloud");
  });

  it("hosted: an account starts on Open source, kept for that account; a second account on the browser keeps its own", () => {
    const ana = pref.engineSlot(known({ kind: "account", hosted: true }, "ana@example.com"));
    const bo = pref.engineSlot(known({ kind: "account", hosted: true }, "bo@example.com"));
    expect(ana.start).toBe("open");
    expect(ana.key).toMatch(/^fuobe\.engine\.a\.[0-9a-z]+$/);
    expect(ana.key).not.toContain("ana");
    expect(bo.key).not.toBe(ana.key);
    // Same account, whatever the case or spaces of its email.
    expect(pref.engineSlot(known({ kind: "account", hosted: true }, " Ana@Example.com ")).key).toBe(ana.key);
    const storage = memoryStorage({ "fuobe.engine": "cloud" });
    vi.stubGlobal("localStorage", storage);
    // The browser's old switch on Cloud doesn't carry over: open models run free on the install's GPUs.
    expect(api.readEngine(ana)).toBe("open");
    storage.setItem(ana.key!, "cloud");
    expect(api.readEngine(ana)).toBe("cloud");
    expect(api.readEngine(bo)).toBe("open");
    expect(api.readEngine()).toBe("cloud");
  });

  it("hosted: an account whose remembered place is its key starts on Cloud", () => {
    expect(pref.engineSlot(known({ kind: "account", hosted: true, runOn: "key" }, "ana@example.com")).start).toBe("cloud");
    for (const runOn of ["site", "gpu", undefined]) expect(pref.engineSlot(known({ kind: "account", hosted: true, runOn }, "ana@example.com")).start).toBe("open");
  });

  it("hosted: a guest starts on Open source; a page opens on the last slot before the status answers", () => {
    const guest = pref.engineSlot(known({ kind: "guest", hosted: true }));
    expect(guest).toEqual({ key: "fuobe.engine.guest", start: "open" });
    const ana = pref.engineSlot(known({ kind: "account", hosted: true }, "ana@example.com"));
    expect(pref.slotToCache(known({ kind: "account", hosted: true }, "ana@example.com"), ana)).toBe(ana.key);
    expect(pref.engineSlot({ known: false, cached: ana.key })).toEqual({ key: ana.key, start: "open" });
    expect(pref.engineSlot({ known: false, cached: "fuobe.engine.guest" })).toEqual(guest);
    // Anything else stored there is not a slot.
    expect(pref.engineSlot({ known: false, cached: "fuobe.engine" })).toEqual(pref.SHARED_SLOT);
    expect(pref.engineSlot({ known: false, cached: "fuobe.engine.a." })).toEqual(pref.SHARED_SLOT);
    // The account's email not answered yet: the last account slot, or none.
    expect(pref.engineSlot({ known: true, viewer: { kind: "account", hosted: true }, cached: ana.key })).toEqual({ key: ana.key, start: "open" });
    expect(pref.engineSlot({ known: true, viewer: { kind: "account", hosted: true }, cached: "fuobe.engine.guest" })).toEqual({ key: null, start: "open" });
    // Hosted runs switched off again: forgotten.
    expect(pref.slotToCache(known({ kind: "account" }, "ana@example.com"), pref.SHARED_SLOT)).toBeNull();
  });

  it("saving a key moves the switch to Cloud only while hosted runs are off", () => {
    expect(pref.engineAfterKeySave(false)).toBe("cloud");
    expect(pref.engineAfterKeySave(true)).toBeNull();
    expect(keySavedText("fal.ai", "", false)).toBe("Your fal.ai key works. Paid models on fal.ai are ready.");
    expect(keySavedText("Replicate", " (signed in as ana)", false)).toBe("Your Replicate key works (signed in as ana). Paid models on Replicate are ready.");
    expect(keySavedText("fal.ai", "", true)).toBe("Your fal.ai key works. Paid models on fal.ai are ready: pick Cloud in the model list to use them.");
    // Settings → Your keys asks this, and writes the browser's one switch only with its answer.
    const keys = readFileSync("src/components/keys/your-keys.tsx", "utf8");
    expect(keys).toMatch(/const engine = engineAfterKeySave\(hosted\);\s+if \(engine\) preferEngine\(engine\);/);
    expect(keys.match(/preferEngine\(/g)).toHaveLength(1);
  });

  it("hosted: the key rescue runs once on the cloud version and leaves the switch where it was", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const ana = pref.engineSlot(known({ kind: "account", hosted: true }, "ana@example.com"));
    const gpu = { connected: true, mode: "link" as const, online: false };
    const viewer = { kind: "account" as const, gpu, keys: ["fal" as const], paidAllowed: true, hosted: true };
    const h3 = getModel("oss-minimax-h3")!;
    const fpv = getPreset("motion-fpv-drone")!;
    const down = gpuBeforeRun({ viewer, model: h3, engine: "open", preset: fpv, has: (id) => !!getModel(id), getModel })!;
    const rescue = down.actions.find((a) => a.kind === "run-with-key")!;
    expect(rescue).toEqual(withKeyAction("fal", "minimax-h3", "i2v"));
    const request = { feature: "video", modelId: h3.id, engine: "open" as const, prompt: "a fast pass over the cliffs", params: { extra: { graph: 1 } } };
    expect(onCloudKey(request as never, rescue)).toEqual({ feature: "video", modelId: "minimax-h3", engine: "cloud", op: "i2v", prompt: "a fast pass over the cliffs", params: {}, prefer: "fal" });
    // Nothing was written: the next run starts on the switch as it was.
    expect(storage.map.size).toBe(0);
    expect(api.readEngine(ana)).toBe("open");
    // The composer: while hosted, the press sends this run on the key through Run (at the price it showed); with hosted
    // runs off it runs once on the key too (runOnceWithKey), and the switch stays where it was.
    const composer = readFileSync("src/components/studio/composer.tsx", "utf8");
    expect(composer).toMatch(/const onRunWithKey = viewerInfo\?\.hosted \? \(a: TroubleAction\) => submitRef\.current\(undefined, a\) : runOnceWithKey;/);
    expect(composer).toMatch(/const onKey = withKey \? onCloudKey\(withVoiceFirst, withKey\) : withVoiceFirst;/);
    expect(composer).toMatch(/onClick=\{\(\) => \(viewerInfo\?\.hosted \? engineForNextPage\("cloud"\) : setEngine\("cloud"\)\)\}/);
  });

  it("hosted: a link's page opens on Cloud for that page only", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const here = { pathname: "/export" };
    vi.stubGlobal("location", here);
    const ana = pref.engineSlot(known({ kind: "account", hosted: true }, "ana@example.com"));
    // Nothing asked: a hand-off's model moves the person's own switch, as always.
    expect(api.takeNextPageEngine("cloud")).toBe(false);
    api.engineForNextPage("cloud");
    expect(api.takeNextPageEngine("open")).toBe(false);
    here.pathname = "/upscale/hdr";
    expect(api.takeNextPageEngine("cloud")).toBe(true);
    expect(api.takeNextPageEngine("cloud")).toBe(false);
    api.setPageEngine("cloud");
    expect(api.readEngine(ana)).toBe("cloud");
    // The page that closed is the one left behind: nothing ends while this one is open.
    api.leavePageEngine();
    expect(api.readEngine(ana)).toBe("cloud");
    here.pathname = "/video";
    expect(api.readEngine(ana)).toBe("open");
    api.leavePageEngine();
    here.pathname = "/upscale/hdr";
    expect(api.readEngine(ana)).toBe("open");
    expect(storage.map.size).toBe(0);
    // An ask nobody took runs out.
    vi.useFakeTimers({ toFake: ["Date"] });
    api.engineForNextPage("cloud");
    vi.setSystemTime(Date.now() + 16_000);
    expect(api.takeNextPageEngine("cloud")).toBe(false);
    vi.useRealTimers();
  });
});
