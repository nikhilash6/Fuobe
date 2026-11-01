import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getModel, MODELS } from "@/lib/catalog";
import { LORA_LIBRARY } from "@/lib/catalog/lora-library.generated";
import { loraRef, loraEntry } from "@/lib/catalog/loras";
import type { ModelDef } from "@/lib/catalog/types";
import type { Manifest } from "@/lib/comfy";
import { licenceInfo, loraLicenceInfo, mergeLicences, NODE_PACKS, paidApiLicence, UNKNOWN_LICENCE, workflowLicence } from "@/lib/licences";
import { accessSummary, ALL_ON, applyChange, firstOffered, gateModel, offered, offMessage, parseAccess, routeOff, type FactsOf } from "@/lib/model-access";

// The switches live in the settings table: a throwaway database.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-model-access-"));
process.env.FUOBE_DATA_DIR = dir;
const { changeAccess, factsOf, isOffered, offeredDefault, offeredLoras, offeredModels, offeredSummary, readAccess, routeLicence } = await import("@/server/model-access");
const { createGenerations, previewGeneration } = await import("@/server/generations");
const { setSetting } = await import("@/server/settings");
const { db } = await import("@/server/db");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/manifest.json"), "utf8")) as Manifest;
const model = (id: string) => getModel(id)!;
const reset = () => changeAccess([{ kind: "reset" }]);

describe("licences as information", () => {
  it("sorts a recorded licence into its class, with a name and a link", () => {
    expect(licenceInfo("Apache-2.0 (Wan 2.2, umT5, lightx2v)")).toMatchObject({ class: "commercial", name: "Apache-2.0", url: "https://spdx.org/licenses/Apache-2.0.html" });
    expect(licenceInfo(workflowLicence({ id: "flux1-dev-t2i" }))).toMatchObject({ class: "non-commercial", name: "FLUX.1 [dev] Non-Commercial License" });
    expect(licenceInfo("Tencent Hunyuan Community License (territory EXCLUDES the EU, UK and South Korea)")).toMatchObject({ class: "regions", excludes: "the EU, UK and South Korea" });
    expect(licenceInfo("LTX-2 Community License (LTX-2.3 22B: free under US$10M annual revenue)", ["https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/main/x.safetensors"])).toMatchObject({
      class: "conditions",
      name: "LTX-2 Community License",
      url: "https://huggingface.co/Lightricks/LTX-2.3-fp8",
    });
    expect(licenceInfo(workflowLicence({ id: "face-swap-reactor" })).class).toBe("research");
    expect(licenceInfo("n/a (no model; ComfyUI core)")).toMatchObject({ class: "commercial", name: "No model weights" });
    expect(licenceInfo(UNKNOWN_LICENCE).class).toBe("unknown");
    // A variant Fuobe doesn't use, named in lower case, isn't the model's licence.
    expect(licenceInfo("Apache-2.0 (Video-Depth-Anything-Small); Base/Large and metric variants are CC-BY-NC-4.0 (non-commercial) - keep the vits model").class).toBe("commercial");
    // The strictest part names a chain.
    expect(mergeLicences([licenceInfo("MIT (BiRefNet)"), licenceInfo("CC-BY-NC-4.0 (MMAudio weights: NON-COMMERCIAL)")]).class).toBe("non-commercial");
    expect(licenceInfo("MIT (TRELLIS.2); the dino_v3_L_naf image encoder is under the DINOv3 License (the app must show a \"Built with DINOv3\" notice)").notices).toEqual(["Built with DINOv3"]);
  });

  it("gives every model a licence: its weights' on ComfyUI, the provider's terms on a paid API", () => {
    for (const m of MODELS) for (const r of m.routes) expect(routeLicence(r, m).name, `${m.id} ${r.endpoint}`).toBeTruthy();
    expect(routeLicence(model("nano-banana-pro").routes[0], model("nano-banana-pro"))).toMatchObject({ class: "paid-api", url: "https://fal.ai/models/fal-ai/nano-banana-pro" });
    expect(paidApiLicence("Google", [{ provider: "replicate", endpoint: "google/nano-banana-pro:abc" }]).url).toBe("https://replicate.com/google/nano-banana-pro");
    expect(routeLicence(model("oss-flux1-dev").routes[0], model("oss-flux1-dev")).class).toBe("non-commercial");
    // A family endpoint (video-concat-{n}) takes its workflows' licence.
    const join = model("oss-join-clips");
    expect(routeLicence(join.routes[0], join)).toMatchObject({ class: "commercial", name: "No model weights" });
    // Every workflow's licence is recorded (none falls back to unknown).
    for (const w of MANIFEST.workflows) expect(workflowLicence(w), w.id).not.toBe(UNKNOWN_LICENCE);
  });

  it("knows the licence of every node pack a workflow loads", () => {
    const used = new Set(MANIFEST.workflows.flatMap((w) => w.customNodes.map((n) => n.name)));
    for (const name of used) expect(NODE_PACKS.find((p) => p.name === name), name).toBeDefined();
    expect(NODE_PACKS.find((p) => p.name === "ComfyUI-Whisper")!.licence.class).toBe("non-commercial");
    // A pack whose repository states no licence is unknown, honestly.
    expect(NODE_PACKS.find((p) => p.name === "ComfyUI_Fill-ChatterBox")!.licence.class).toBe("unknown");
    expect(factsOf(model("oss-captions-whisper").routes[0], model("oss-captions-whisper")).packs).toContain("ComfyUI-Whisper");
  });

  it("reads every LoRA's licence: commercial, your GPU only, non-commercial, or not recorded", () => {
    for (const e of LORA_LIBRARY) expect(loraLicenceInfo(e.licence, e.page).class, e.key).toMatch(/^(commercial|conditions|non-commercial|unknown)$/);
    expect(loraLicenceInfo(loraEntry("civitai-2490836-wiggle-redmond")!.licence).class).toBe("conditions");
    expect(loraLicenceInfo(loraEntry("btsmovieset-ltx25-v1")!.licence).class).toBe("non-commercial");
    expect(loraLicenceInfo({ commercial: false, hostedOk: true, name: "unspecified (check card)" }).class).toBe("unknown");
    expect(loraLicenceInfo(undefined)).toMatchObject({ name: "Your own", class: "commercial" });
  });
});

describe("the switches (pure)", () => {
  const facts: FactsOf = (r) => ({ class: r.provider === "comfyui" ? "non-commercial" : "paid-api", packs: r.endpoint === "w" ? ["ComfyUI-Whisper"] : [] });
  const m: ModelDef = {
    id: "m",
    name: "Model M",
    vendor: "V",
    family: "f",
    engine: "open",
    engines: ["open", "cloud"],
    kind: "image",
    tagline: "",
    options: {},
    routes: [
      { op: "t2i", provider: "comfyui", endpoint: "w" },
      { op: "t2i", provider: "fal", endpoint: "fal-ai/m" },
      { op: "t2i", provider: "replicate", endpoint: "v/m" },
    ],
  };

  it("parses what is stored, and anything unreadable is on", () => {
    expect(parseAccess(null)).toEqual(ALL_ON);
    expect(parseAccess("not json")).toEqual(ALL_ON);
    expect(parseAccess(JSON.stringify({ models: ["a", "a", 3], classes: ["research", "nope"], keepGpuOnlyLoras: true }))).toEqual({ ...ALL_ON, models: ["a"], classes: ["research"], keepGpuOnlyLoras: true });
  });

  it("flips one switch at a time, and resets", () => {
    let a = applyChange(ALL_ON, { kind: "model", id: "m", on: false });
    a = applyChange(a, { kind: "provider", id: "fal", on: false });
    expect(a).toMatchObject({ models: ["m"], providers: ["fal"] });
    a = applyChange(a, { kind: "model", id: "m", on: true });
    expect(a.models).toEqual([]);
    expect(() => applyChange(a, { kind: "class", id: "free", on: false })).toThrow(/Unknown licence class/);
    expect(applyChange(a, { kind: "reset" })).toEqual(ALL_ON);
  });

  it("turns routes off by model, provider, node pack and licence class, naming the most specific switch", () => {
    const a = { ...ALL_ON, packs: ["ComfyUI-Whisper"], providers: ["fal"] };
    expect(routeOff(m, m.routes[0], a, facts)).toEqual({ kind: "pack", id: "ComfyUI-Whisper" });
    expect(routeOff(m, m.routes[1], a, facts)).toEqual({ kind: "provider", id: "fal" });
    expect(routeOff(m, m.routes[2], a, facts)).toBeUndefined();
    expect(routeOff(m, m.routes[2], { ...a, models: ["m"] }, facts)).toEqual({ kind: "model", id: "m" });
    expect(routeOff(m, m.routes[2], { ...ALL_ON, classes: ["paid-api"] }, facts)).toEqual({ kind: "class", id: "paid-api" });
  });

  it("offers a model with the routes that are on: an Original loses an engine, a model loses a provider", () => {
    const a = { ...ALL_ON, classes: ["non-commercial" as const] };
    const view = gateModel(m, a, facts)!;
    expect(view.routes.map((r) => r.provider)).toEqual(["fal", "replicate"]);
    expect(view).toMatchObject({ engine: "cloud", engines: ["cloud"] });
    // The same object while the switches don't change.
    expect(gateModel(m, a, facts)).toBe(view);
    expect(gateModel(m, ALL_ON, facts)).toBe(m);
    expect(gateModel(m, { ...a, classes: ["non-commercial", "paid-api"] }, facts)).toBeUndefined();
    expect(accessSummary([m], a, facts)).toEqual({ off: [], engines: { m: ["cloud"] } });
    expect(accessSummary([m], ALL_ON, facts)).toBeUndefined();
  });

  it("tells the browser what is offered, and falls back to the next model that is on", () => {
    const summary = { off: ["a"], engines: { b: ["cloud" as const] } };
    expect(offered(undefined, "a")).toBe(true);
    expect(offered(summary, "a")).toBe(false);
    expect(offered(summary, "b")).toBe(true);
    expect(offered(summary, "b", "open")).toBe(false);
    expect(firstOffered(summary, ["a", undefined, "b", "c"], "open")).toBe("c");
  });

  it("says where to turn a model back on", () => {
    expect(offMessage("FLUX.1 [dev]", [{ kind: "class", id: "non-commercial" }])).toBe(
      "FLUX.1 [dev] is turned off in Settings → Models & licences (Non-commercial is switched off). Turn it back on there, or pick another model",
    );
    expect(offMessage("X", [{ kind: "provider", id: "fal" }, { kind: "pack", id: "ComfyUI-KJNodes" }])).toMatch(/\(fal\.ai is switched off and the ComfyUI-KJNodes node pack is switched off\)/);
  });
});

describe("the switches on the server", () => {
  beforeEach(() => {
    reset();
    setSetting("demoMode", "on");
    setSetting("engineMode", "both");
  });

  it("stores the switches as one settings row and reads them back", () => {
    expect(readAccess()).toEqual(ALL_ON);
    changeAccess([
      { kind: "class", id: "research", on: false },
      { kind: "pack", id: "ComfyUI-Whisper", on: false },
    ]);
    const a = readAccess();
    expect(a).toMatchObject({ classes: ["research"], packs: ["ComfyUI-Whisper"] });
    expect(readAccess()).toBe(a);
    changeAccess([{ kind: "class", id: "research", on: true }]);
    expect(readAccess()).toMatchObject({ classes: [], packs: ["ComfyUI-Whisper"] });
    reset();
    expect(readAccess()).toEqual(ALL_ON);
  });

  it("refuses a model that is off, naming the switch, in every run and preview", () => {
    changeAccess([{ kind: "model", id: "nano-banana-pro", on: false }]);
    expect(() => previewGeneration({ feature: "image", modelId: "nano-banana-pro", prompt: "a cat" })).toThrow(
      "Nano Banana Pro is turned off in Settings → Models & licences (the model is switched off). Turn it back on there, or pick another model",
    );
    changeAccess([{ kind: "class", id: "non-commercial", on: false }]);
    expect(() => previewGeneration({ feature: "image", modelId: "oss-flux1-dev", prompt: "a cat" })).toThrow(/\(Non-commercial is switched off\)/);
    changeAccess([{ kind: "pack", id: "ComfyUI-Whisper", on: false }]);
    expect(() => previewGeneration({ feature: "captions", modelId: "oss-captions-whisper", op: "captions", inputs: { video: "/api/files/a.mp4" } })).toThrow(/the ComfyUI-Whisper node pack is switched off/);
  });

  it("runs a model on a provider that is still on, and refuses when none is", () => {
    setSetting("demoMode", "auto");
    setSetting("falKey", "id:secret");
    setSetting("replicateToken", "r8_test");
    try {
      expect(previewGeneration({ feature: "image", modelId: "nano-banana-pro", prompt: "a cat" }).route.provider).toBe("fal");
      changeAccess([{ kind: "provider", id: "fal", on: false }]);
      expect(previewGeneration({ feature: "image", modelId: "nano-banana-pro", prompt: "a cat" }).route.provider).toBe("replicate");
      changeAccess([{ kind: "provider", id: "replicate", on: false }]);
      expect(() => previewGeneration({ feature: "image", modelId: "nano-banana-pro", prompt: "a cat" })).toThrow(/fal\.ai is switched off and Replicate is switched off/);
    } finally {
      setSetting("falKey", "");
      setSetting("replicateToken", "");
    }
  });

  it("runs an Original on the engine still on, and refuses the engine that is off when asked for", () => {
    changeAccess([{ kind: "class", id: "paid-api", on: false }]);
    expect(previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a cat" }).engine).toBe("open");
    expect(() => previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a cat", engine: "cloud" })).toThrow(/^Fuobe Soul in the cloud is turned off in Settings → Models & licences \(Proprietary paid API is switched off\)/);
    expect(isOffered("fuobe-soul")).toBe(true);
    expect(isOffered("fuobe-soul", "cloud")).toBe(false);
    expect(offeredSummary()?.engines?.["fuobe-soul"]).toEqual(["open"]);
    expect(offeredSummary()?.off).toContain("nano-banana-pro");
  });

  it("leaves listings without what is off, and keeps engine mode working", () => {
    changeAccess([{ kind: "provider", id: "comfyui", on: false }]);
    const listed = offeredModels(MODELS);
    expect(listed.some((m) => m.id === "oss-flux1-dev")).toBe(false);
    expect(listed.find((m) => m.id === "fuobe-soul")?.engines).toEqual(["cloud"]);
    // Engine mode still decides first: open source only with ComfyUI switched off refuses an open model by its own message.
    setSetting("engineMode", "open");
    expect(() => previewGeneration({ feature: "image", modelId: "nano-banana-pro", prompt: "a cat" })).toThrow(/open source only/);
  });

  it("picks the next model that is on, or keeps the default so its run says what to turn on", () => {
    changeAccess([{ kind: "model", id: "nano-banana-pro", on: false }]);
    const next = offeredDefault("nano-banana-pro", "cloud")!;
    expect(next).not.toBe("nano-banana-pro");
    expect(isOffered(next, "cloud")).toBe(true);
    expect(model(next).kind).toBe("image");
    expect(offeredDefault("seedream-5-pro", "cloud")).toBe("seedream-5-pro");
    changeAccess([{ kind: "class", id: "paid-api", on: false }]);
    // No cloud image model is on: the default stays, and its run refuses naming the switch.
    expect(offeredDefault("nano-banana-pro", "cloud")).toBe("nano-banana-pro");
    expect(() => previewGeneration({ feature: "image", modelId: "nano-banana-pro", prompt: "a cat" })).toThrow(/^Nano Banana Pro is turned off in Settings → Models & licences/);
  });

  it("leaves out LoRAs switched off by file or licence class, and marks GPU-only ones when the admin keeps them home", () => {
    const bts = loraRef(loraEntry("btsmovieset-ltx25-v1")!);
    const aw = loraRef(loraEntry("awportrait")!);
    const own = { file: "my-character.safetensors" };
    expect(offeredLoras([bts, aw, own])).toEqual({ loras: [bts, aw, own], notes: [], dropped: [] });
    changeAccess([{ kind: "class", id: "non-commercial", on: false }, { kind: "lora", id: aw.file, on: false }, { kind: "class", id: "commercial", on: false }]);
    const out = offeredLoras([bts, aw, own]);
    // The user's own LoRA isn't a licensed work: only its own switch counts.
    expect(out.loras).toEqual([own]);
    expect(out.dropped.map((d) => d.file)).toEqual([bts.file, aw.file]);
    expect(out.notes[0]).toMatch(/left out: turned off in Settings → Models & licences/);
    reset();
    changeAccess([{ kind: "keepGpuOnlyLoras", on: true }]);
    expect(offeredLoras([aw]).loras[0]).toMatchObject({ file: aw.file, keepOnGpu: true });
  });
});

describe("chains and Originals refuse a switched-off step before anything is queued", () => {
  const rows = () => (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
  const relight = { feature: "motion", modelId: "fuobe-dop", presetId: "effect-window", prompt: "a woman reading", inputs: { images: ["/api/files/uploads/a.png"] } };
  beforeEach(() => {
    reset();
    setSetting("demoMode", "on");
    setSetting("engineMode", "both");
  });

  it("refuses the model itself before a chain queues its first step", () => {
    changeAccess([{ kind: "model", id: "fuobe-dop", on: false }]);
    const before = rows();
    expect(() => createGenerations({ ...relight, engine: "cloud" })).toThrow(/^Fuobe DoP is turned off in Settings → Models & licences \(the model is switched off\)/);
    expect(rows()).toBe(before);
  });

  it("refuses a chain whose helper step is off, before any step is queued", () => {
    changeAccess([{ kind: "model", id: "join-clips", on: false }]);
    let before = rows();
    expect(() => createGenerations({ feature: "extend", modelId: "kling-3", op: "extend", prompt: "she keeps running", inputs: { video: "/api/files/placeholder.mp4" } })).toThrow(
      /^Join clips is turned off in Settings → Models & licences/,
    );
    expect(rows()).toBe(before);
    reset();
    changeAccess([{ kind: "model", id: "oss-join-clips", on: false }]);
    before = rows();
    const shots = [
      { prompt: "wide shot", duration: 3 },
      { prompt: "close-up", duration: 5 },
    ];
    expect(() => createGenerations({ feature: "video", modelId: "oss-wan22-14b-fast", prompt: "A fox", params: { aspectRatio: "16:9", shots } })).toThrow(/turned off in Settings → Models & licences/);
    expect(rows()).toBe(before);
    reset();
    changeAccess([{ kind: "model", id: "qwen-image-edit-2509-cloud", on: false }]);
    before = rows();
    expect(() => createGenerations({ ...relight, engine: "cloud" })).toThrow(/turned off in Settings → Models & licences/);
    expect(rows()).toBe(before);
  });

  it("refuses a relight effect on the engine asked for when that engine is off, in the preview as when it's created", () => {
    changeAccess([{ kind: "class", id: "paid-api", on: false }]);
    const before = rows();
    const refusal = /^Fuobe DoP in the cloud is turned off in Settings → Models & licences \(Proprietary paid API is switched off\)/;
    expect(() => previewGeneration({ ...relight, engine: "cloud" })).toThrow(refusal);
    expect(() => createGenerations({ ...relight, engine: "cloud" })).toThrow(refusal);
    expect(rows()).toBe(before);
    // Without an engine asked for, it runs on the one still on, the relight step with it.
    const [clip, relit] = createGenerations(relight);
    expect(clip).toMatchObject({ modelId: "fuobe-dop", engine: "open" });
    expect(relit.modelId).toBe("oss-qwen-image-21-turbo");
  });

  it("names the switch, not Engine mode, when cloud only meets an Original whose cloud half is off", () => {
    setSetting("engineMode", "cloud");
    changeAccess([{ kind: "class", id: "paid-api", on: false }]);
    expect(() => previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a cat" })).toThrow(
      /^Fuobe Soul in the cloud is turned off in Settings → Models & licences \(Proprietary paid API is switched off\)/,
    );
    // Engine mode still refuses the engine it rules out first.
    expect(() => previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a cat", engine: "open" })).toThrow(/paid cloud APIs only/);
  });
});
