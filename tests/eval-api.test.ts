import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { planGeneration, routeLoras } from "@/lib/catalog/plan";

/** The REST seams the evaluation harness (scripts/eval) needs: a recipe's LoRAs on POST /api/generations, and a preview that says which ones run. */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-eval-api-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
const { POST } = await import("@/app/api/generations/route");
// Placeholders where nothing is connected, as these runs were written for ("auto": code in this process only).
beforeAll(async () => (await import("@/server/settings")).setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const post = async (body: unknown, preview = true) => {
  const res = await POST(new Request(`http://localhost/api/generations${preview ? "?preview=1" : ""}`, { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { error?: string; items?: { request: { loras?: unknown[] } }[] } };
};

const soul = { feature: "eval", modelId: "oss-z-image-turbo", prompt: "a portrait in soft daylight", params: { seed: 1001 } };

describe("POST /api/generations with a recipe's LoRAs", () => {
  it("takes LoRAs by ComfyUI file name with an optional https URL, strength, trigger and Wan expert", async () => {
    const loras = [
      { file: "AWPortrait-Z.safetensors", url: "https://huggingface.co/Shakker-Labs/AWPortrait-Z/resolve/main/AWPortrait-Z.safetensors", strength: 0.6 },
      { file: "civitai-2463391-hardflash.safetensors", strength: 0.7, trigger: "hardflashy" },
      { file: "wan/camera-overhead-high.safetensors", strength: 1, target: "high" },
      // Every file name the research uses (brackets, spaces, parentheses).
      { file: "[ZImage.Turbo]FilmStill_Redmond.safetensors", strength: 0.8 },
      { file: "zimageturbo_Sunbleach_Photograph_Style_Lora_TAV2_000002500_(recommended).safetensors", strength: 0.7 },
    ];
    expect((await post({ ...soul, loras })).status).toBe(200);
    const made = await post({ ...soul, loras }, false);
    expect(made.status).toBe(201);
    // The stored request keeps them, so Reuse and the harness's records show the recipe that ran.
    expect(made.body.items?.[0].request.loras).toEqual(loras);
  });

  it("refuses names that leave models/loras, links that aren't https and strengths out of range", async () => {
    for (const bad of [
      { file: "../../etc/passwd" },
      { file: "loras/../../x.safetensors" },
      { file: "/abs.safetensors" },
      { file: "ok.safetensors", url: "http://insecure.example/x.safetensors" },
      { file: "ok.safetensors", url: "file:///etc/passwd" },
      // Only the model hubs and the providers' file stores: the server may fetch an unknown file's link.
      { file: "ok.safetensors", url: "https://internal.host/x.safetensors" },
      { file: "ok.safetensors", url: "https://10.0.0.5/x.safetensors" },
      { file: "ok.safetensors", url: "https://huggingface.co@evil.example/x.safetensors" },
      { file: "ok.safetensors", url: "https://huggingface.co.evil.example/x.safetensors" },
      { file: "ok.safetensors", strength: 9 },
      { file: "ok.safetensors", target: "middle" },
    ]) {
      const r = await post({ ...soul, loras: [bad] });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error).toMatch(/^loras\./);
    }
    expect((await post({ ...soul, loras: Array.from({ length: 9 }, (_, i) => ({ file: `l${i}.safetensors` })) })).status).toBe(400);
  });

  it("takes LoRA links on Hugging Face, civitai, fal and Replicate", async () => {
    for (const url of ["https://huggingface.co/a/b/resolve/main/x.safetensors", "https://civitai.com/api/download/models/2463391", "https://v3.fal.media/files/x/lora.safetensors", "https://replicate.delivery/pbxt/x/lora.safetensors"]) {
      expect((await post({ ...soul, loras: [{ file: "ok.safetensors", url }] })).status, url).toBe(200);
    }
  });

  it("takes every LoRA file name in the research (the harness sends them as they are)", async () => {
    const research = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs/research/fuobe-originals-recipes-5.json"), "utf8"));
    type L = { file?: string };
    const files = [...new Set<string>([...research.presets, ...research.motionsEffects].flatMap((e: { loras?: L[] }) => (e.loras ?? []).map((l) => l.file ?? "")).filter(Boolean))];
    // And every link: they're all on hosts the API takes.
    const urls = [...new Set<string>([...research.presets, ...research.motionsEffects].flatMap((e: { loras?: (L & { url?: string })[] }) => (e.loras ?? []).map((l) => l.url ?? "")).filter(Boolean))];
    for (let i = 0; i < urls.length; i += 8) {
      const r = await post({ ...soul, loras: urls.slice(i, i + 8).map((url, j) => ({ file: `l${j}.safetensors`, url })) });
      expect(r.status, r.body.error).toBe(200);
    }
    expect(files.length).toBeGreaterThan(50);
    for (let i = 0; i < files.length; i += 8) {
      const r = await post({ ...soul, loras: files.slice(i, i + 8).map((file) => ({ file })) });
      expect(r.status, `${r.body.error} (${files.slice(i, i + 8).join(", ")})`).toBe(200);
    }
  });
});

describe("planGeneration with request LoRAs", () => {
  it("adds them after the preset's own and drops any at strength 0", () => {
    const plan = planGeneration(
      { ...soul, loras: [{ file: "a.safetensors", strength: 0.5 }, { file: "off.safetensors", strength: 0 }] },
      getModel,
      getPreset,
    );
    expect(plan.loras.map((l) => l.file)).toEqual(["a.safetensors"]);
  });

  it("preset strength 0 is the motion's prompt without its LoRAs or their trigger words (the harness's prompt-only baseline)", () => {
    for (const id of ["motion-dolly-in", "effect-thunder-god"]) {
      const motion = getPreset(id);
      const trigger = motion?.open?.loras?.find((l) => l.trigger)?.trigger;
      expect(trigger, `${id}: a preset with an open LoRA and a trigger`).toBeTruthy();
      const req = { feature: "eval", presetId: motion!.id, modelId: motion!.open!.modelId, prompt: "a cyclist on a coastal road", inputs: { images: ["start.png"] } };
      const full = planGeneration(req, getModel, getPreset);
      const none = planGeneration({ ...req, presetStrength: 0 }, getModel, getPreset);
      expect(full.loras.length).toBeGreaterThan(0);
      expect(full.prompt.startsWith(`${trigger}. `)).toBe(true);
      expect(none.loras).toEqual([]);
      // The trigger means nothing without its LoRA: the rest of the preset's words stay.
      expect(none.prompt).toBe(full.prompt.slice(trigger!.length + 2));
      // Half strength keeps the LoRA, so its trigger stays too.
      expect(planGeneration({ ...req, presetStrength: 0.5 }, getModel, getPreset).prompt).toBe(full.prompt);
    }
  });
});

describe("the preview says what the route runs", () => {
  const hf = { file: "AWPortrait-Z.safetensors", url: "https://huggingface.co/Shakker-Labs/AWPortrait-Z/resolve/main/AWPortrait-Z.safetensors", strength: 0.6 };
  const local = { file: "civitai-2463391-hardflash.safetensors", strength: 0.7, trigger: "hardflashy" };

  it("routeLoras: ComfyUI loads every file, a cloud route with a LoRA field the ones with a URL, other routes none", () => {
    expect(routeLoras({ provider: "comfyui" }, [hf, local])).toEqual({ applied: [hf, local], dropped: [] });
    expect(routeLoras({ provider: "fal", loraEndpoint: "fal-ai/z-image/turbo/lora" }, [hf, local])).toEqual({
      applied: [hf],
      dropped: [{ file: local.file, reason: "no URL to send to the LoRA endpoint" }],
    });
    expect(routeLoras({ provider: "fal" }, [hf]).dropped).toEqual([{ file: hf.file, reason: "this route takes no LoRAs" }]);
    expect(routeLoras({ provider: "replicate" }, [hf]).applied).toEqual([]);
  });

  it("returns the endpoint, the final prompt and the LoRAs on the open engine (demo mode, no ComfyUI here)", async () => {
    const r = await post({ ...soul, loras: [hf, local] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ demo: true, route: { provider: "comfyui", endpoint: "z-image-turbo-t2i" }, loras: { applied: [hf, local], dropped: [] } });
    expect(r.body.prompt).toContain("a portrait in soft daylight");
  });

  it("on the cloud: the LoRA endpoint when a LoRA has a URL, and what was left out", async () => {
    const r = await post({ ...soul, modelId: "z-image-turbo-cloud", loras: [hf, local] });
    expect(r.body).toMatchObject({ route: { provider: "fal", endpoint: "fal-ai/z-image/turbo/lora" }, loras: { applied: [hf], dropped: [{ file: local.file }] } });
    const none = await post({ ...soul, modelId: "z-image-turbo-cloud" });
    expect(none.body.route).toMatchObject({ endpoint: expect.not.stringMatching(/lora/) });
  });
});
