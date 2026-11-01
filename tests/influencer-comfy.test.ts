import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { GenInput, Operation } from "@/lib/catalog/types";
import { compileCastPrompt, compileDressPrompt, planInfluencer, type InfluencerState } from "@/lib/influencer";

// The comfyui provider driving the AI Influencer builder's open engine on the library graphs: the Soul Cast
// sheet (Z-Image Turbo) with the compiled character, then Qwen-Image 2.1 with the sheet first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-influencer-comfy-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const prepare = (id: string, input: GenInput, op: Operation) => prepareWorkflow(id, input, { generationId: "g1", op, upload: async (_d, _t, name) => `up_${name}` });
const at = (wf: Record<string, { inputs: Record<string, unknown> }>, node: string, input: string) => wf[node]?.inputs[input];
const state: InfluencerState = { tier: "cats", picks: { gender: ["female"], hair: ["hs_beehive"], aesthetic: ["goth"] }, species: "maine_coon", bodyColor: "#f4c2d7", locked: [] };

describe("the builder's open engine through the provider", () => {
  it("Soul Cast sheet: the compiled character goes after the graph's own turnaround wording", async () => {
    const [sheet] = planInfluencer({ engine: "open", state, start: "scratch", direction: "Runs a night bakery" }, {}).steps;
    const { workflow: wf } = await prepare("soul-cast-sheet-zimage", { prompt: sheet.request.prompt, seed: 11 }, "t2i");
    expect(at(wf, "20", "string_b")).toBe(compileCastPrompt({ state, direction: "Runs a night bakery" }));
    expect(at(wf, "20", "string_b")).toMatch(/^A female anthropomorphic Maine Coon cat with pale pink fur, with a tall beehive updo, wearing an all-black goth outfit\. Anthropomorphic Maine Coon cat/);
    expect(String(at(wf, "20", "string_a"))).toMatch(/^Character turnaround reference sheet/);
    expect(at(wf, "24", "seed")).toBe(11);
  });

  it("Qwen-Image 2.1: the sheet is image 1, your face image 2, the clothing images 3 and 4", async () => {
    const plan = planInfluencer({ engine: "open", state, start: "face", photo: "face.png", clothing: ["coat.png", "boots.png", "hat.png"] }, {});
    const dress = plan.steps[1].request;
    expect(dress.modelId).toBe("oss-qwen-image-21");
    // What the chain hands the step when the sheet is done (position "first").
    const images = ["sheet.png", ...(dress.inputs?.images ?? [])];
    expect(images).toEqual(["sheet.png", "face.png", "coat.png", "boots.png"]);
    const { workflow: wf } = await prepare("qwen-image-21-edit", { prompt: dress.prompt, images, seed: 3 }, "edit");
    expect([at(wf, "10", "image"), at(wf, "11", "image"), at(wf, "12", "image"), at(wf, "13", "image")]).toEqual(["sheet.png", "face.png", "coat.png", "boots.png"]);
    expect(at(wf, "30", "prompt")).toBe(compileDressPrompt({ state, start: "face", clothing: 2 }));
  });

  it("with the face only, the sheet and the face reach the graph", async () => {
    const plan = planInfluencer({ engine: "open", state, start: "face", photo: "face.png" }, {});
    const dress = plan.steps[1].request;
    const { workflow: wf } = await prepare("qwen-image-21-edit", { prompt: dress.prompt, images: ["sheet.png", ...(dress.inputs?.images ?? [])] }, "edit");
    expect([at(wf, "10", "image"), at(wf, "11", "image")]).toEqual(["sheet.png", "face.png"]);
  });
});
