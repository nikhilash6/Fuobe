import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

const dir = tempDir("fuobe-head-swap-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
globalThis.__fuobeTestDiskFree = 1e13;

// The install's own ComfyUI never gets an account's job: an account runs on the ComfyUI it connected.
const realFetch = globalThis.fetch;
const ownerAsked: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.host === "owner-comfy.test:8188") ownerAsked.push(url.pathname);
  return new Response("not stubbed", { status: 599 });
}) as typeof fetch;

const root = process.cwd();
const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const uploadsRoute = await import("@/app/api/uploads/route");
const gpuRoute = await import("@/app/api/account/gpu/route");
const { proxy } = await import("@/proxy");
const { getGeneration } = await import("@/server/generations");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { resetRates } = await import("@/server/rate");
const { getModel, getPreset, APPS } = await import("@/lib/catalog");
const { HEAD_SWAP_OPEN } = await import("@/lib/catalog/apps");
const { planGeneration } = await import("@/lib/catalog/plan");
const { workflowLicence, licenceTerms } = await import("@/lib/licences");
const { GUEST_RUN_MESSAGE } = await import("@/lib/guest-access");

const WF = "head-swap-qwen-image-21";
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(path.join(root, p), "utf8")) as T;
const manifest = readJson<{ workflows: { id: string; file: string; bindings: Record<string, { node: string; input: string }[]>; defaults: Record<string, unknown>; models: { file: string; folder: string; url: string; sizeGb: number }[]; customNodes: { name: string }[]; license?: string; validated: boolean }[] }>("workflows/comfyui/manifest.json");
const entry = manifest.workflows.find((w) => w.id === WF)!;
const graph = readJson<Graph>(`workflows/comfyui/${WF}.json`);
const BFS = "bfs_head_v1.1_qwen_2.1.safetensors";

let fake: FakeComfy;
let cookie = "";
beforeAll(async () => {
  fake = await startFakeComfy({ loras: [], delayMs: 0, output: "image" });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  const a = auth.createAccount("heads@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fake.close();
});
beforeEach(() => resetRates());

const headers = (extra: Record<string, string> = {}) => ({ cookie, host: "localhost:3000", ...extra });
const json = (url: string, body: unknown, method = "POST") => {
  const text = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, { method, headers: headers({ "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }), body: text });
};

describe("the Head Swap app", () => {
  const app = getPreset("app-head-swap")!;

  it("is an Identity app next to Face Swap: the shot first, then the head, nothing to type", () => {
    expect(app).toMatchObject({ type: "app", name: "Head Swap", category: "Identity", userPrompt: "none" });
    expect(APPS.findIndex((a) => a.id === "app-head-swap")).toBe(APPS.findIndex((a) => a.id === "app-face-swap") + 1);
    expect(app.inputs.map((s) => [s.key, s.accept, s.required])).toEqual([
      ["image", "image", true],
      ["image2", "image", true],
    ]);
    expect(app.inputs[1].hint).toMatch(/your own photo, or one you have permission to use/);
  });

  it("speaks plainly to visitors: no model, file or technical names", () => {
    const visible = [app.name, app.description, app.parity, ...app.inputs.flatMap((s) => [s.label, s.hint])].join(" ");
    expect(visible).not.toMatch(/Qwen|BFS|LoRA|SAM|ComfyUI|safetensors|workflow|mask|GPU/i);
  });

  it("runs the head LoRA's own training words on the open engine, and a plain instruction in the cloud", () => {
    expect(app.open).toMatchObject({ modelId: "oss-qwen-head-swap", op: "edit", promptTemplate: HEAD_SWAP_OPEN });
    expect(HEAD_SWAP_OPEN).toMatch(/^head_swap: start with <image1> as the base image/);
    expect(app.cloud).toMatchObject({ modelId: "nano-banana-pro", op: "edit" });
    expect(app.promptTemplate).toMatch(/hair included/);
    const plan = planGeneration({ feature: "app", presetId: app.id, modelId: "oss-qwen-head-swap", inputs: { images: ["/shot.png", "/me.png"] } }, getModel, getPreset);
    expect(plan.model.id).toBe("oss-qwen-head-swap");
    expect(plan.op).toBe("edit");
    expect(plan.prompt).toBe(HEAD_SWAP_OPEN);
    expect(() => planGeneration({ feature: "app", presetId: app.id, modelId: "oss-qwen-head-swap", inputs: { images: ["/shot.png"] } }, getModel, getPreset)).toThrow(
      "Add the photo to keep, then a photo of the head",
    );
  });

  it("has a hidden open model with one edit route to its graph", () => {
    const m = getModel("oss-qwen-head-swap")!;
    expect(m).toMatchObject({ engine: "open", kind: "image", hidden: true });
    expect(m.routes).toEqual([expect.objectContaining({ op: "edit", provider: "comfyui", endpoint: WF })]);
  });
});

describe("its graph", () => {
  it("is the hand-built file, listed in the manifest with its models, pack and licence", () => {
    expect(fs.readFileSync(path.join(root, "scripts/comfy/hand-built", `${WF}.json`), "utf8").replace(/\r\n/g, "\n")).toBe(
      fs.readFileSync(path.join(root, "workflows/comfyui", `${WF}.json`), "utf8").replace(/\r\n/g, "\n"),
    );
    expect(entry).toMatchObject({ file: `${WF}.json`, validated: true, customNodes: [{ name: "ComfyUI-KJNodes" }] });
    expect(entry.models.map((m) => `${m.folder}/${m.file}`).sort()).toEqual(
      [
        "checkpoints/sam3.1_multiplex_fp16.safetensors",
        "diffusion_models/qwen_image_2.1_int8_convrot.safetensors",
        `loras/${BFS}`,
        "text_encoders/qwen3vl_8b_int8_convrot.safetensors",
        "vae/qwen_image_2.1_vae_bf16.safetensors",
      ].sort(),
    );
    const lora = entry.models.find((m) => m.file === BFS)!;
    expect(lora.url).toBe(`https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/resolve/0ca3913ade4b4ada458d60c232354e8586c4c181/${BFS}`);
    const terms = licenceTerms(workflowLicence(entry));
    expect(workflowLicence(entry)).toMatch(/BFS head-swap LoRA by Alissonerdx MIT/);
    expect(terms.flags).toContain("non-commercial");
  });

  it("is in the GPU pre-flight index with the LoRA pinned to its revision, size and checksum", () => {
    const req = readJson<{ workflows: Record<string, { files: string[]; packs: Record<string, string[]>; vramGb: number }>; files: Record<string, { pinnedUrl: string; sizeBytes: number }> }>("workflows/comfyui/requirements.json");
    expect(req.workflows[WF]).toMatchObject({ packs: { "ComfyUI-KJNodes": ["GrowMaskWithBlur"] }, vramGb: 20 });
    expect(req.workflows[WF].files).toContain(`loras/${BFS}`);
    expect(req.files[`loras/${BFS}`]).toMatchObject({ sizeBytes: 260096144 });
    const pins = readJson<Record<string, { sha256: string }>>("workflows/comfyui/model-pins.json");
    expect(pins[lora()].sha256).toBe("d1d748d5601077f3b6d05766f6823510e901970d916afa404a97e85dc92fa88e");
  });

  it("wires every link to a node that exists, body first and head second", () => {
    for (const [id, n] of Object.entries(graph))
      for (const v of Object.values(n.inputs)) if (Array.isArray(v) && typeof v[0] === "string") expect(graph[v[0]], `${id} -> ${v[0]}`).toBeDefined();
    expect(graph["30"].inputs["images.image_1"]).toEqual(["20", 0]);
    expect(graph["20"].inputs.image).toEqual(["10", 0]);
    expect(graph["30"].inputs["images.image_2"]).toEqual(["21", 0]);
    expect(graph["21"].inputs.image).toEqual(["11", 0]);
    expect(graph["4"].inputs).toMatchObject({ lora_name: BFS, strength_model: 1, model: ["1", 0] });
    // Paste-back: the swap goes only where either head is; the rest is the shot at the swap's size.
    expect(graph["51"].inputs).toMatchObject({ destination: ["41", 0], source: ["34", 0], mask: ["50", 0] });
    expect(graph["52"].inputs).toMatchObject({ switch: true, on_true: ["51", 0], on_false: ["34", 0] });
    expect(graph["90"].inputs.images).toEqual(["52", 0]);
  });

  async function prepare(over: Record<string, unknown> = {}) {
    return prepareWorkflow(WF, { prompt: HEAD_SWAP_OPEN, images: ["shot.png", "me.png"], seed: 7, ...over } as never, {
      generationId: "gen1",
      op: "edit",
      upload: async (_d: unknown, _t: unknown, name: string) => `up_${name}`,
      media: () => undefined,
      serverRam: async () => undefined,
    } as never);
  }

  it("fills the shot, the head, the words and the seed, and switches the paste-back off on request", async () => {
    const { workflow } = (await prepare()) as { workflow: Graph };
    expect(workflow["10"].inputs.image).toBe("shot.png");
    expect(workflow["11"].inputs.image).toBe("me.png");
    expect(workflow["30"].inputs.prompt).toBe(HEAD_SWAP_OPEN);
    expect(workflow["32"].inputs.seed).toBe(7);
    expect(workflow["43"].inputs.text).toBe("head");
    expect(workflow["52"].inputs.switch).toBe(true);
    const whole = (await prepare({ extra: { pasteBack: false, maskGrow: 48 } })) as { workflow: Graph };
    expect(whole.workflow["52"].inputs.switch).toBe(false);
    expect(whole.workflow["50"].inputs.expand).toBe(48);
  });

  it("asks for the head instead of running a plain edit without it", async () => {
    await expect(prepare({ images: ["shot.png"] })).rejects.toThrow("Add a photo of the head to put in");
  });
});

describe("who may run it", () => {
  it("shows guests the page and asks them to sign up to run it", async () => {
    const page = await proxy(new NextRequest("http://localhost:3000/apps/app-head-swap", { headers: { host: "localhost:3000" } }));
    expect(page.headers.get("x-middleware-next")).toBe("1");
    const run = await proxy(
      new NextRequest("http://localhost:3000/api/generations", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: "{}" }),
    );
    expect(run.status).toBe(401);
    expect((await run.json()).error).toBe(GUEST_RUN_MESSAGE);
  });

  it("runs end to end on an account's own ComfyUI, never on the install's", async () => {
    expect((await gpuRoute.PUT(json("/api/account/gpu", { url: fake.url }, "PUT"))).status).toBe(200);
    const up = async (name: string) => {
      const r = await uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: headers({ "content-type": "image/png", "x-file-name": name, "content-length": String(TINY_PNG.length) }), body: TINY_PNG }));
      expect(r.status).toBe(201);
      return ((await r.json()) as { url: string }).url;
    };
    const [shot, head] = [await up("shot.png"), await up("head.png")];
    fake.log.length = 0;
    const r = await generationsRoute.POST(json("/api/generations", { feature: "app", modelId: "oss-qwen-head-swap", presetId: "app-head-swap", prompt: "", inputs: { images: [shot, head] } }));
    expect(r.status).toBe(201);
    const id = ((await r.json()) as { items: { id: string }[] }).items[0].id;
    const end = Date.now() + 15_000;
    let g = getGeneration(id, { includeDeleted: true });
    while (g && (g.status === "queued" || g.status === "running") && Date.now() < end) {
      await globalThis.__fuobeRunner?.tick();
      await new Promise((res) => setTimeout(res, 150));
      g = getGeneration(id, { includeDeleted: true });
    }
    expect(g?.status, g?.error ?? "").toBe("succeeded");
    expect(g!.outputs[0]).toMatchObject({ kind: "image", contentType: "image/png" });
    const sent = fake.log.find((e) => e.path === "/prompt")?.prompt as Graph;
    expect(sent["30"].inputs.prompt).toBe(HEAD_SWAP_OPEN);
    expect(sent["4"].inputs.lora_name).toBe(BFS);
    // Two uploads, the shot then the head, each into its own loader.
    expect(fake.log.filter((e) => e.path === "/upload/image")).toHaveLength(2);
    expect(String(sent["10"].inputs.image)).not.toBe(String(sent["11"].inputs.image));
    expect(ownerAsked.filter((p) => p === "/prompt" || p.startsWith("/upload"))).toEqual([]);
  });
});

function lora() {
  return `https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/resolve/0ca3913ade4b4ada458d60c232354e8586c4c181/${BFS}`;
}
