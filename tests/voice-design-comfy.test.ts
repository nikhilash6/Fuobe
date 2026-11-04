import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * Design a voice on your GPU: the Qwen3-TTS and VoxCPM2 graphs, their node packs pinned for the
 * GPU pre-flight, and what the ComfyUI provider binds (the voice in words, what a sample says, VoxCPM2's device).
 */

process.env.FUOBE_DATA_DIR = tempDir("fuobe-voice-design-comfy-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const root = path.resolve(__dirname, "..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const manifest = read("workflows/comfyui/manifest.json") as { workflows: { id: string; capability: string; customNodes?: { name: string }[]; validated: boolean; license?: string; autoDownloads?: string[]; bindings: Record<string, { node: string; input: string }[]> }[] };
const packs = read("workflows/comfyui/packs.json") as Record<string, { repo: string; commit: string }>;
const requirements = read("workflows/comfyui/requirements.json") as { workflows: Record<string, { packs: Record<string, string[]>; firstRun: string[] }> };
const subset = read("workflows/comfyui/object_info.subset.json") as Record<string, { python_module: string } | null>;

const GRAPHS = {
  "tts-qwen3-design": { capability: "voice-design", pack: "ComfyUI-QwenTTS", bindings: ["prompt", "voiceDescription", "seed", "filenamePrefix"] },
  "tts-qwen3-clone": { capability: "tts", pack: "ComfyUI-QwenTTS", bindings: ["prompt", "audio", "voiceTranscript", "seed", "filenamePrefix"] },
  "tts-voxcpm2": { capability: "voice-design", pack: "ComfyUI-VoxCPM2", bindings: ["prompt", "voiceDescription", "seed", "device", "filenamePrefix"] },
  "tts-voxcpm2-clone": { capability: "tts", pack: "ComfyUI-VoxCPM2", bindings: ["prompt", "audio", "voiceTranscript", "seed", "device", "filenamePrefix"] },
} as const;

describe("the voice graphs in the library", () => {
  it.each(Object.entries(GRAPHS))("%s: its pack pinned, its classes recorded, its licence and first-run download stated", (id, want) => {
    const w = manifest.workflows.find((x) => x.id === id)!;
    expect(w.capability).toBe(want.capability);
    expect(Object.keys(w.bindings).sort()).toEqual([...want.bindings].sort());
    expect(w.customNodes?.map((c) => c.name)).toContain(want.pack);
    // The packs aren't on the validation server: the graph waits for a GPU that has them.
    expect(w.validated).toBe(false);
    expect(w.license).toMatch(/Apache-2\.0/);
    expect(packs[want.pack].commit).toMatch(/^[0-9a-f]{40}$/);
    expect(requirements.workflows[id].packs[want.pack].length).toBe(1);
    expect(requirements.workflows[id].firstRun.join(" ")).toMatch(/downloads (Qwen\/Qwen3-TTS-12Hz-1\.7B|openbmb\/VoxCPM2)/);
    const graph = read(`workflows/comfyui/${id}.json`) as Record<string, { class_type: string }>;
    for (const n of Object.values(graph)) expect(subset[n.class_type], n.class_type).toBeTruthy();
  });
});

describe("what the ComfyUI provider binds", () => {
  it("puts the words into the voice design node, and the take's line and the GPU's device into the VoxCPM2 clone", async () => {
    const { prepareWorkflow } = await import("@/server/providers/comfyui");
    const ctx = (op: "voice-design" | "tts", device?: string) => ({ generationId: "g", op, upload: async () => "voice.wav", device: async () => device });
    const design = await prepareWorkflow("tts-qwen3-design", { prompt: "Hello there.", voiceDescription: "  A warm older narrator. " }, ctx("voice-design"));
    expect(design.workflow["1"].inputs).toMatchObject({ text: "Hello there.", instruct: "A warm older narrator.", do_sample: true, model_size: "1.7B" });
    const vox = await prepareWorkflow("tts-voxcpm2", { prompt: "Hi.", voiceDescription: "A calm voice." }, ctx("voice-design", "mps"));
    expect(vox.workflow["1"].inputs).toMatchObject({ text: "Hi.", voice_description: "A calm voice.", device: "mps" });
    const clone = await prepareWorkflow("tts-voxcpm2-clone", { prompt: "New line.", voiceAudio: "data:audio/wav;base64,UklGRg==", voiceTranscript: "Hello there." }, ctx("tts", "cuda"));
    expect(clone.workflow["2"].inputs).toMatchObject({ text: "New line.", prompt_text: "Hello there.", device: "cuda" });
    // No transcript: the controllable clone (empty prompt_text); a GPU that can't say keeps the graph's cuda.
    const plain = await prepareWorkflow("tts-voxcpm2-clone", { prompt: "New line.", voiceAudio: "data:audio/wav;base64,UklGRg==" }, ctx("tts"));
    expect(plain.workflow["2"].inputs).toMatchObject({ prompt_text: "", device: "cuda" });
    const qclone = await prepareWorkflow("tts-qwen3-clone", { prompt: "New line.", voiceAudio: "data:audio/wav;base64,UklGRg==", voiceTranscript: "Hello there." }, ctx("tts"));
    expect(qclone.workflow["2"].inputs).toMatchObject({ target_text: "New line.", reference_text: "Hello there.", x_vector_only: false });
    // A sample with no transcript (a recorded or uploaded voice): the pack refuses an empty reference_text unless
    // it clones from the voice's timbre alone, so x_vector_only goes on.
    for (const voiceTranscript of [undefined, "   "]) {
      const bare = await prepareWorkflow("tts-qwen3-clone", { prompt: "New line.", voiceAudio: "data:audio/wav;base64,UklGRg==", voiceTranscript }, ctx("tts"));
      expect(bare.workflow["2"].inputs).toMatchObject({ target_text: "New line.", reference_text: "", x_vector_only: true });
    }
  });
});
