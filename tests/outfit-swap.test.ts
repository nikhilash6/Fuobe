import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { ComfyWorkflow, ManifestWorkflow } from "@/lib/comfy";
import type { GenInput } from "@/lib/catalog/types";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// Outfit Swap: AusBoss's Outfit Swap LoRA on Qwen-Image 2.1 changes only the clothes, from a photo of the outfit or from
// words. The catalog, the plan on both engines, the two graphs as Fuobe sends them, the library rows, and a run end to
// end on an account's own ComfyUI (the stand-in from tests/helpers).
const dir = tempDir("fuobe-outfit-swap-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
globalThis.__fuobeTestDiskFree = 1e13;

// Plain fetch would be the install's own ComfyUI: nothing of an account's run may reach it.
const realFetch = globalThis.fetch;
const fetched: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetched.push(String(input instanceof Request ? input.url : input));
  return new Response("not stubbed", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const uploadsRoute = await import("@/app/api/uploads/route");
const gpuRoute = await import("@/app/api/account/gpu/route");
const { proxy } = await import("@/proxy");
const { getGeneration } = await import("@/server/generations");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { OWN_ROUTE_APPS, presetRoutes } = await import("@/lib/catalog/preset-recipe-routes");
const { resolveWorkflowId } = await import("@/lib/comfy-variants");
const { licenceInfo, workflowLicence } = await import("@/lib/licences");
const { GUEST_RUN_MESSAGE } = await import("@/lib/guest-access");
const { KNOWN_MODELS } = await import("../scripts/comfy/library.spec.mjs");

const LIBRARY = path.join(process.cwd(), "workflows/comfyui");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(LIBRARY, f), "utf8"));
const PHOTO = "outfit-swap-qwen-image-21";
const WORDS = "outfit-swap-qwen-image-21-text";
const LORA = "qwen-image-2.1-outfit-swap.safetensors";
const REPLACE = "Replace everything they wear.";
const KEEP = "Keep their own shoes and legwear.";
const NEGATION = /\b(no|not|never|nothing|none|without|don't|do not|doesn't|avoid)\b/i;

const plan = (r: Record<string, unknown>) => planGeneration({ feature: "app", presetId: "app-outfit-swap", ...r } as Parameters<typeof planGeneration>[0], getModel, getPreset);
const ofClass = (wf: ComfyWorkflow, cls: string) => Object.entries(wf).filter(([, n]) => n.class_type === cls);
const at = (wf: ComfyWorkflow, m: ManifestWorkflow, key: string) => (m.bindings[key] ?? []).map((t) => wf[t.node].inputs[t.input]);

async function prepare(id: string, input: GenInput) {
  return prepareWorkflow(id, { seed: 7, ...input }, {
    generationId: "g",
    op: "edit",
    upload: async (_d, _t, name) => `up_${name}`,
    media: () => undefined,
    serverRam: async () => undefined,
  });
}

let fake: FakeComfy;
let cookie = "";
beforeAll(async () => {
  fake = await startFakeComfy({ loras: [LORA], delayMs: 0, output: "image" });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  const a = auth.createAccount("outfit@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fake.close();
});
beforeEach(() => {
  resetRates();
  Object.assign(fake.opts, { loras: [LORA], delayMs: 0, output: "image", missing: undefined });
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

describe("Outfit Swap in the catalog", () => {
  it("asks for your photo and the outfit's, or words, with Shoes as two taps", () => {
    const p = getPreset("app-outfit-swap")!;
    expect(p.inputs.map((s) => [s.key, s.label, !!s.required])).toEqual([
      ["image", "Your photo", true],
      ["image2", "Outfit", false],
    ]);
    expect(p.userPrompt).toBe("optional");
    expect(p.options?.map((o) => [o.key, o.choices.map((c) => [c.label, c.openExtra?.request])])).toEqual([
      ["shoes", [["New shoes too", REPLACE], ["Keep mine", KEEP]]],
    ]);
    expect(p.open).toMatchObject({ modelId: "oss-outfit-swap", op: "edit", promptTemplate: "{prompt}" });
    expect(p.cloud?.modelId).toBe("nano-banana-pro");
    // It keeps its own route: a plain edit (its old preview's recipe) moves the picture.
    expect(OWN_ROUTE_APPS.has("app-outfit-swap")).toBe(true);
    expect(presetRoutes(p, "open", (id) => !!getModel(id))[0].modelId).toBe("oss-outfit-swap");
  });

  it("runs on a hidden open model whose one route is the photo graph", () => {
    const m = getModel("oss-outfit-swap")!;
    expect(m).toMatchObject({ engine: "open", kind: "image", hidden: true });
    expect(m.routes.map((r) => [r.op, r.provider, r.endpoint])).toEqual([["edit", "comfyui", PHOTO]]);
    expect(m.tagline).toMatch(/20 GB GPU · non-commercial weights$/);
  });

  it("words name only what is wanted, in every choice and both graphs' requests", () => {
    const p = getPreset("app-outfit-swap")!;
    for (const c of p.options![0].choices) expect(p.promptTemplate.replace(/\{prompt\|[^}]*\}/, "a red dress").replace("{option:shoes}", c.prompt)).not.toMatch(NEGATION);
    for (const id of [PHOTO, WORDS]) expect((read(`${id}.json`) as ComfyWorkflow)["53"].inputs.f_string).not.toMatch(NEGATION);
  });
});

describe("Outfit Swap plans", () => {
  it("on your GPU: the photo alone, or words alone; the Shoes choice is the graph's request", () => {
    const photo = plan({ modelId: "oss-outfit-swap", prompt: "", inputs: { images: ["/me.png", "/outfit.png"] } });
    expect([photo.op, photo.prompt]).toEqual(["edit", ""]);
    expect(photo.params.extra).toMatchObject({ request: REPLACE });
    const keep = plan({ modelId: "oss-outfit-swap", prompt: "", presetOptions: { shoes: "keep-mine" }, inputs: { images: ["/me.png", "/outfit.png"] } });
    expect(keep.params.extra).toMatchObject({ request: KEEP });
    const words = plan({ modelId: "oss-outfit-swap", prompt: "a black velvet tuxedo", inputs: { images: ["/me.png"] } });
    expect(words.prompt).toBe("a black velvet tuxedo");
    expect(() => plan({ modelId: "oss-outfit-swap", prompt: "", inputs: { images: ["/me.png"] } })).toThrow("Add your photo and the outfit's, or describe the outfit");
  });

  it("in the cloud: the outfit from the second image, or the words in its place", () => {
    const photo = plan({ modelId: "nano-banana-pro", prompt: "", inputs: { images: ["/me.png", "/outfit.png"] } });
    expect(photo.prompt).toBe(
      "Dress the person in the first image in the complete outfit from the second image, with its exact colours, fabrics, prints and fit. Keep their face, hair, hands, body, pose, lighting and background exactly the same. Replace everything they wear.",
    );
    const words = plan({ modelId: "nano-banana-pro", prompt: "an ivory silk slip dress", presetOptions: { shoes: "keep-mine" }, inputs: { images: ["/me.png"] } });
    expect(words.prompt).toBe(
      "Dress the person in the first image in an ivory silk slip dress. Keep their face, hair, hands, body, pose, lighting and background exactly the same. Keep their own shoes and legwear.",
    );
    expect(() => plan({ modelId: "nano-banana-pro", prompt: "", inputs: { images: ["/me.png"] } })).toThrow("Add the outfit, or describe it");
    // The Shoes choice is a setting of the open graph only: the cloud API gets its words, never an unknown field.
    expect([photo.params.extra?.request, words.params.extra?.request]).toEqual([undefined, undefined]);
  });

  it("picks the words graph when there is no outfit photo", () => {
    const has = () => true;
    expect(resolveWorkflowId(PHOTO, { op: "edit", clips: 0, images: 2, audio2: false, extra: {}, has })).toBe(PHOTO);
    expect(resolveWorkflowId(PHOTO, { op: "edit", clips: 0, images: 1, audio2: false, extra: {}, has })).toBe(WORDS);
    expect(resolveWorkflowId(PHOTO, { op: "edit", clips: 0, images: 1, audio2: false, extra: {}, has: (id) => id !== WORDS })).toBe(PHOTO);
  });
});

describe("Outfit Swap graphs as Fuobe sends them", () => {
  it("photo: the person as image 1 and the outfit as image 2 at the card's sizes, on the LoRA at 1, 25 steps at cfg 1", async () => {
    const { workflow: wf, manifest } = await prepare(PHOTO, { prompt: "", images: ["me.png", "outfit.png"], extra: { request: KEEP } });
    expect([at(wf, manifest, "image"), at(wf, manifest, "image2")]).toEqual([["me.png"], ["outfit.png"]]);
    expect(ofClass(wf, "LoraLoaderModelOnly").map(([, n]) => n.inputs)).toEqual([{ model: ["1", 0], lora_name: LORA, strength_model: 1 }]);
    expect(ofClass(wf, "QwenImage21Cache")[0][1].inputs.model).toEqual(["4", 0]);
    const enc = ofClass(wf, "TextEncodeQwenImage21")[0][1].inputs;
    expect(enc).toMatchObject({ prompt: ["53", 0], negative_prompt: "", resolution: 0, "images.image_1": ["20", 0], "images.image_2": ["21", 0] });
    expect([wf["20"].inputs, wf["21"].inputs]).toMatchObject([
      { image: ["10", 0], megapixels: 1.91, resolution_steps: 32, upscale_method: "lanczos" },
      { image: ["11", 0], megapixels: 0.95, resolution_steps: 32, upscale_method: "lanczos" },
    ]);
    expect(ofClass(wf, "KSampler")[0][1].inputs).toMatchObject({ seed: 7, steps: 25, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1, latent_image: ["30", 2] });
    const saved = wf[manifest.outputs[0].node].inputs.images as [string, number];
    expect(wf[saved[0]].class_type).toBe("SplitImageWithAlpha");
  });

  it("photo: Qwen3-VL checks for feet and legs, describes the outfit, and the request is put together around it", async () => {
    const { workflow: wf } = await prepare(PHOTO, { prompt: "Leave the jacket open.", images: ["me.png", "outfit.png"], extra: { request: KEEP } });
    const gen = ofClass(wf, "TextGenerate");
    expect(gen.map(([, n]) => [n.inputs.clip, n.inputs.max_length, n.inputs.sampling_mode, n.inputs.thinking])).toEqual([
      [["2", 0], 16, "off", true],
      [["2", 0], 16, "off", true],
      [["2", 0], 200, "off", true],
    ]);
    // The checks look at the person, the describer at the outfit; the instructions follow the two answers.
    expect(wf[(wf["40"].inputs.image as [string, number])[0]].inputs.image).toEqual(["10", 0]);
    expect(wf[(wf["49"].inputs.image as [string, number])[0]].inputs.image).toEqual(["11", 0]);
    expect(wf["49"].inputs.prompt).toEqual(["48", 0]);
    expect(wf["48"].inputs).toEqual({ switch: ["43", 0], on_true: ["47", 0], on_false: ["46", 0] });
    expect(wf["47"].inputs).toEqual({ switch: ["41", 0], on_true: ["44", 0], on_false: ["45", 0] });
    expect(String(wf["46"].inputs.value)).toMatch(/only what is worn on the upper body/);
    expect(String(wf["45"].inputs.value)).toMatch(/Leave out shoes, boots and socks/);
    expect(wf["53"].inputs).toEqual({
      "values.a": "the person",
      "values.b": ["50", 0],
      "values.c": KEEP,
      "values.d": "Leave the jacket open.",
      f_string: "Dress {a} in image 1 in {b}. Keep their face, hair, hands, pose and the background exactly the same. {c} {d}",
    });
  });

  it("photo: one picture runs the words graph; with no words either, the plan has already said what to add", async () => {
    const { manifest } = await prepare(PHOTO, { prompt: "a camel trench coat", images: ["me.png"] });
    expect(manifest.id).toBe(WORDS);
  });

  it("words: the person alone, the words as the outfit, no describer", async () => {
    const { workflow: wf, manifest } = await prepare(WORDS, { prompt: "a black velvet tuxedo with satin lapels", images: ["me.png"] });
    expect(at(wf, manifest, "image")).toEqual(["me.png"]);
    expect(manifest.bindings.image2).toBeUndefined();
    expect(ofClass(wf, "TextGenerate")).toEqual([]);
    expect(ofClass(wf, "LoadImage")).toHaveLength(1);
    expect(wf["53"].inputs).toMatchObject({ "values.b": "a black velvet tuxedo with satin lapels", "values.c": REPLACE });
    const enc = ofClass(wf, "TextEncodeQwenImage21")[0][1].inputs;
    expect(Object.keys(enc).filter((k) => k.startsWith("images."))).toEqual(["images.image_1"]);
    expect(ofClass(wf, "LoraLoaderModelOnly")[0][1].inputs.lora_name).toBe(LORA);
  });
});

describe("Outfit Swap in the library", () => {
  const manifest = read("manifest.json") as { workflows: ManifestWorkflow[] };
  const subset = read("object_info.subset.json") as Record<string, { input: { required?: Record<string, unknown>; optional?: Record<string, unknown> }; output: string[] }>;

  it.each([PHOTO, WORDS])("%s: core nodes only, every input known to its node, every link to an output that exists", (id) => {
    const wf = read(`${id}.json`) as ComfyWorkflow;
    expect(wf).toEqual(JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/comfy/hand-built", `${id}.json`), "utf8")));
    for (const [nid, n] of Object.entries(wf)) {
      const def = subset[n.class_type];
      expect(def, `${nid} ${n.class_type}`).toBeDefined();
      const known = new Set([...Object.keys(def.input.required ?? {}), ...Object.keys(def.input.optional ?? {})]);
      for (const [k, v] of Object.entries(n.inputs)) {
        // Autogrow inputs (images.image_1, values.a) and dynamic-combo children (sampling_mode.*) belong to their parent.
        expect(known.has(k.split(".")[0]), `${nid} ${n.class_type}.${k}`).toBe(true);
        if (Array.isArray(v)) expect(wf[v[0]] && (v[1] as number) < subset[wf[v[0]].class_type].output.length, `${nid}.${k} -> ${v}`).toBe(true);
      }
    }
    const m = manifest.workflows.find((w) => w.id === id)!;
    expect(m).toMatchObject({ capability: "edit", customNodes: [], validated: true, vramGb: 20, defaults: { steps: 25, loraStrength: 1 } });
    for (const targets of Object.values(m.bindings)) for (const t of targets!) expect(wf[t.node]?.inputs, `${id} ${t.node}.${t.input}`).toHaveProperty([t.input]);
    expect(licenceInfo(workflowLicence(m))).toMatchObject({ name: "Qwen Research License", class: "non-commercial" });
  });

  it("pins the LoRA to its revision, size and SHA-256, and lists it for the GPU pre-flight", () => {
    const url = (KNOWN_MODELS as Record<string, { url: string; folder: string }>)[LORA];
    expect(url).toEqual({ folder: "loras", url: `https://huggingface.co/ausboss/Qwen-Image-2.1-Outfit-Swap-Consistency-LoRA/resolve/main/${LORA}` });
    expect(read("model-pins.json")[url.url]).toEqual({ revision: "f0e0fc4e4c65527963d875536aa4e77fe1e9b165", sizeBytes: 159436488, sha256: "4ddfeac5695adaed1f0f78b23fda40919fd2ed6a4af790ced6c1e043dc4ae1f0" });
    const req = read("requirements.json") as { workflows: Record<string, { files: string[]; packs: Record<string, string[]> }>; files: Record<string, { pinnedUrl: string }> };
    for (const id of [PHOTO, WORDS]) {
      expect(req.workflows[id].files).toContain(`loras/${LORA}`);
      expect(req.workflows[id].packs).toEqual({});
    }
    expect(req.files[`loras/${LORA}`].pinnedUrl).toContain("/resolve/f0e0fc4e4c65527963d875536aa4e77fe1e9b165/");
  });
});

describe("Outfit Swap runs end to end on an account's own ComfyUI", () => {
  const headers = (extra: Record<string, string> = {}) => ({ cookie, host: "localhost:3000", ...extra });
  const json = (url: string, method: string, body: unknown) => {
    const text = JSON.stringify(body);
    return new Request(`http://localhost:3000${url}`, { method, headers: headers({ "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }), body: text });
  };
  async function upload(): Promise<string> {
    const r = await uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: headers({ "content-type": "image/png", "x-file-name": "me.png", "content-length": String(TINY_PNG.length) }), body: TINY_PNG }));
    expect(r.status).toBe(201);
    return (await r.json()).url;
  }
  async function settle(id: string, ms = 15_000) {
    const end = Date.now() + ms;
    for (;;) {
      await globalThis.__fuobeRunner?.tick();
      const g = getGeneration(id, { includeDeleted: true });
      if (!g || (g.status !== "queued" && g.status !== "running") || Date.now() > end) return g;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  const sent = () => fake.log.filter((e) => e.path === "/prompt").map((e) => e.prompt as unknown as ComfyWorkflow);

  it("a guest is asked to create an account before a run", async () => {
    const r = proxy(new NextRequest("http://localhost:3000/api/generations", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ error: GUEST_RUN_MESSAGE });
  });

  it("with the outfit photo, then with words: the right graph each time, and the result comes back", async () => {
    expect((await gpuRoute.PUT(json("/api/account/gpu", "PUT", { url: fake.url }))).status).toBe(200);
    const [me, outfit] = [await upload(), await upload()];
    fake.log.length = 0;
    const photo = await generationsRoute.POST(json("/api/generations", "POST", { feature: "app", modelId: "oss-outfit-swap", presetId: "app-outfit-swap", prompt: "", presetOptions: { shoes: "keep-mine" }, inputs: { images: [me, outfit] } }));
    expect(photo.status).toBe(201);
    const g = await settle((await photo.json()).items[0].id);
    expect(g?.status, g?.error ?? "").toBe("succeeded");
    expect(g!.outputs[0]).toMatchObject({ kind: "image", contentType: "image/png" });
    const [wf] = sent();
    expect(ofClass(wf, "LoadImage")).toHaveLength(2);
    expect(wf["53"].inputs["values.c"]).toBe(KEEP);
    expect(ofClass(wf, "LoraLoaderModelOnly")[0][1].inputs.lora_name).toBe(LORA);

    fake.log.length = 0;
    const words = await generationsRoute.POST(json("/api/generations", "POST", { feature: "app", modelId: "oss-outfit-swap", presetId: "app-outfit-swap", prompt: "an ivory silk slip dress", inputs: { images: [me] } }));
    expect(words.status).toBe(201);
    const w = await settle((await words.json()).items[0].id);
    expect(w?.status, w?.error ?? "").toBe("succeeded");
    const [wf2] = sent();
    expect(ofClass(wf2, "LoadImage")).toHaveLength(1);
    expect(ofClass(wf2, "TextGenerate")).toEqual([]);
    expect(wf2["53"].inputs).toMatchObject({ "values.b": "an ivory silk slip dress", "values.c": REPLACE });
    // Nothing reached the install's own ComfyUI.
    expect(fetched.filter((u) => u.includes("owner-comfy.test") && !u.endsWith("/system_stats"))).toEqual([]);
  });
});
