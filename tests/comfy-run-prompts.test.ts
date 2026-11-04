import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODELS } from "@/lib/catalog/models";
import { promptOptional } from "@/lib/catalog/plan";
import type { GenInput, Operation } from "@/lib/catalog/types";
import { MOTION_CHARACTER, MOTION_GRAPHS, MOTION_SETTING, motionTransferPrompt, neutralPrompt } from "@/lib/comfy-prompts";
import type { MediaInfo } from "@/lib/media-probe";
import { tempDir } from "./helpers/temp-dir";

// A ComfyUI run never keeps a graph's own prompt text (its template's sample, e.g. Wan Animate 2's "Cartoon character
// lost" in an empty white room), and motion transfer renders in the driving clip's shape.
const tmp = tempDir("fuobe-run-prompts-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");

type Graph = Record<string, { inputs: Record<string, unknown> }>;
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "workflows", "comfyui", "manifest.json"), "utf8")) as {
  workflows: { id: string; file: string; bindings: Record<string, { node: string; input: string }[]> }[];
};
const fileGraph = (id: string) => JSON.parse(fs.readFileSync(path.join(root, "workflows", "comfyui", manifest.workflows.find((w) => w.id === id)!.file), "utf8")) as Graph;

const landscape: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: true, duration: 5, videoDuration: 5, width: 1024, height: 768, fps: 24, frames: 124 };
const voice: MediaInfo = { container: "wav", hasVideo: false, hasAudio: true, duration: 4 };
const media = (n: string) => (n === "clip.mp4" ? landscape : n === "voice.wav" ? voice : undefined);
const prepare = (id: string, input: Partial<GenInput>, op: Operation, known = true) =>
  prepareWorkflow(id, { video: "clip.mp4", ...input } as GenInput, { generationId: "g1", op, upload: async (_d, _t, name) => `up_${name}`, media: known ? media : () => undefined }).then((r) => r.workflow as Graph);
const at = (wf: Graph, node: string, input: string) => wf[node]?.inputs[input];
const size = (wf: Graph) => [at(wf, "672:600", "resize_type.width"), at(wf, "672:600", "resize_type.height")] as number[];

describe("Wan Animate 2 (Motion transfer on your GPU)", () => {
  it("a run with no words describes the character from the photo in the photo's setting, never the template's sample", async () => {
    const wf = await prepare("wan-animate2", { images: ["model.png"], aspectRatio: "auto", resolution: "480p" }, "motion-transfer");
    const text = String(at(wf, "672:582", "text"));
    expect(text).toBe(`Character Description: ${MOTION_CHARACTER}.\nBackground description: ${MOTION_SETTING}.`);
    expect(text).not.toMatch(/cartoon|white room/i);
    // The pose prompt is Fuobe's own: the moves of the person in the driving clip.
    expect(at(wf, "672:585", "text")).toMatch(/^The character performs exactly the same movements/);
  });

  it("the user's words join the description; words already in the template's form go as typed", async () => {
    expect(motionTransferPrompt("wan-animate2", "  a dancer in a black satin gown.  ")).toBe(
      `Character Description: ${MOTION_CHARACTER}. A dancer in a black satin gown.\nBackground description: ${MOTION_SETTING}.`,
    );
    const own = "Character Description: a dancer in a gown\nBackground description: a marble ballroom";
    const wf = await prepare("wan-animate2", { images: ["model.png"], prompt: own }, "motion-transfer");
    expect(at(wf, "672:582", "text")).toBe(own);
  });

  it("renders in the clip's shape even when the run names no aspect ratio (the Motion control studio)", async () => {
    const [w, h] = size(await prepare("wan-animate2", { images: ["model.png"] }, "motion-transfer"));
    expect(w).toBeGreaterThan(h);
    expect(w / h).toBeCloseTo(4 / 3, 1);
    // A portrait pick is overruled too: the graph crops the driving clip to the canvas.
    const [w2, h2] = size(await prepare("wan-animate2", { images: ["model.png"], aspectRatio: "9:16", resolution: "720p" }, "motion-transfer"));
    expect([w2, h2]).toEqual([960, 720]);
  });

  it("an upload whose header wasn't remembered takes the size the server read from the file", async () => {
    const wf = await prepare("wan-animate2", { images: ["model.png"], resolution: "720p", sourceSize: { width: 1280, height: 720 } }, "motion-transfer", false);
    expect(size(wf)).toEqual([1280, 720]);
  });
});

describe("Wan 2.2 Fun Control (motion transfer)", () => {
  it("describes the character from the photo moving like the person in the clip, in the clip's shape", async () => {
    const wf = await prepare("wan22-fun-control-14b", { images: ["model.png"], prompt: "slow, graceful turns" }, "motion-transfer");
    expect(at(wf, "99", "text")).toBe(`${MOTION_CHARACTER}, moves exactly like the person in the driving video, in the setting and light of the reference picture. Slow, graceful turns.`);
  });
});

describe("no template sample reaches a run", () => {
  // Fuobe's own lines that graphs keep as their text (a neutral line written for them, or the tool's own default).
  const OWN = new Set(["", "A person is talking to the camera.", "a person is talking", "person", "face"]);
  const isOwn = (id: string, text: string) =>
    OWN.has(text) ||
    text === neutralPrompt(id) ||
    (MOTION_GRAPHS.has(id) && text === motionTransferPrompt(id)) ||
    (id === "tryon-flux2-klein-4b" && text.startsWith("TRYON ")) ||
    // Fuobe Angles writes its camera's words in the plan (anglesPrompt) and refuses a camera that doesn't move.
    id === "qwen-image-edit-2509-angles";

  // Every ComfyUI graph a run can reach with no words: its op works from its inputs, or its model's prompt is optional.
  const reach = new Map<string, Set<Operation>>();
  for (const m of MODELS) {
    for (const r of m.routes ?? []) {
      if (r.provider !== "comfyui" || !r.op || !promptOptional(m, r.op)) continue;
      if (!manifest.workflows.some((w) => w.id === r.endpoint)) continue; // a template id ({n} clips) resolves to graphs without words
      (reach.get(r.endpoint) ?? reach.set(r.endpoint, new Set()).get(r.endpoint)!).add(r.op);
    }
  }

  it("covers the motion, avatar, reframe and sound graphs", () => {
    for (const id of ["wan-animate2", "wan22-fun-control-14b", "wan22-s2v-14b", "video-reframe-wan22-fun-vace", "v2a-hunyuan-foley"]) expect(reach.has(id)).toBe(true);
  });

  it("each prompt such a run sends is written for it or is Fuobe's own line", async () => {
    const bad: string[] = [];
    for (const [id, ops] of reach) {
      const w = manifest.workflows.find((x) => x.id === id)!;
      const keys = ["prompt", "description", "tags"].filter((k) => w.bindings[k]);
      if (!keys.length) continue;
      const file = fileGraph(id);
      for (const op of ops) {
        const input = { images: ["a.png", "b.png"], audio: "voice.wav", voiceAudio: "voice.wav", voiceAudio2: "voice.wav", mask: "m.png", startTime: 0, endTime: 4, dialogue: [{ voice: "A", text: "Hi." }] } as Partial<GenInput>;
        let wf: Graph;
        try {
          wf = await prepare(id, input, op);
        } catch {
          continue; // refused without more inputs (a reference picture, a second voice): it never runs on the sample either
        }
        for (const k of keys) {
          for (const t of w.bindings[k]) {
            const sent = String(at(wf, t.node, t.input) ?? "");
            if (sent === String(file[t.node]?.inputs[t.input] ?? "") && !isOwn(id, sent)) bad.push(`${id} (${op}) ${k}: ${sent.slice(0, 80)}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("the graph files hold Fuobe's lines, not the templates' samples", () => {
    const text = (id: string, node: string, input = "text") => String(fileGraph(id)[node].inputs[input]);
    expect(text("wan-animate2", "672:582")).toBe(`Character Description: ${MOTION_CHARACTER}.\nBackground description: ${MOTION_SETTING}.`);
    expect(text("wan22-fun-control-14b", "99")).toBe(motionTransferPrompt("wan22-fun-control-14b"));
    expect(text("wan22-s2v-14b", "6")).toBe("A person is talking to the camera.");
    expect(text("video-reframe-wan22-fun-vace", "9")).toMatch(/^The same scene continues/);
    expect(text("v2a-hunyuan-foley", "3", "prompt")).toMatch(/^The natural sounds of what happens in the video/);
  });

  it("restore without words gets the generic card, layers-by-name refuses without a name", async () => {
    const wf = await prepare("video-restore-ltx25-tiled", { startTime: 0, endTime: 3 }, "restore-video");
    const t = manifest.workflows.find((x) => x.id === "video-restore-ltx25-tiled")!.bindings.prompt[0];
    expect(String(at(wf, t.node, t.input))).toBe(neutralPrompt("video-restore-ltx25-tiled"));
    expect(String(at(wf, t.node, t.input))).not.toMatch(/locomotive/);
    await expect(prepare("layers-qwen-image-layered-control", { images: ["a.png"] }, "layers")).rejects.toThrow(/Name the part to separate/);
  });
});
