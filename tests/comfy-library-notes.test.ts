import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Manifest } from "@/lib/comfy";

// The Workflows page shows each graph's notes word for word to everyone, so they read as public notes: what the graph
// does, its settings, files and VRAM. No private workflow file names, no notes about who tested what on which machine,
// no guesses or hedges ("inferred", "unverified") and no paths or names from Fuobe's own source.
const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/manifest.json"), "utf8")) as Manifest;
const { SPEC } = (await import("../scripts/comfy/library.spec.mjs")) as { SPEC: { id: string; notes?: string }[] };
const spec = new Map(SPEC.map((s) => [s.id, s.notes ?? ""]));

const INTERNAL = [
  /\bowner/i,
  /FashDash/i,
  /krea2SFWNSFW|working-great-default|homecenter/i,
  /\ba guess\b/i,
  /restarted Windows|NVIDIA driver/i,
  /not rendered/i,
  /Proof \[/,
  /CPU library server|no GPU here|Ran here|on this server|validation server|shared CPU server/i,
  /\bthe (\d-core )?CPU server\b|\bresearch (graph|run|bound)/i,
  /\/prompt (validation|only)|Validated by \/prompt|\/object_info/i,
  /not GPU-tested|not measured yet|random-weight/i,
  /Originals O\d|\bN7-\d|\br4\/|build plan [A-Z]?\d|catalog-\d|feature package/i,
  /\b(src|tests)\/|scripts\/(?!comfy\/README\.md)/,
  /\b[\w-]+\.tsx?\b|persistOutput|collectOutputs|EXT_BY_TYPE|TYPE_BY_EXT|OutputFile\b/,
  /\b(untested|inferred|plausible|unverified)\b/i,
  /\bexpand\w*Workflow\b|\bdropBranch\b|\bmeta\.\w+|outputs\[/,
  /\bPROVIDER\b/,
];

describe("the workflow library's notes", () => {
  it.each(manifest.workflows.map((w) => [w.id, w.notes ?? ""]))("%s reads as a public note", (_id, notes) => {
    for (const re of INTERNAL) expect(notes).not.toMatch(re);
  });

  it("match the spec for the graphs whose notes were rewritten", () => {
    const ids = [
      "moss-image-t2i",
      "qwen-image-edit-2509-angles",
      "qwen-image-21-t2i",
      "qwen-image-21-edit",
      "krea2-turbo-i2i",
      "fibo2-dev-t2i",
      "wan21-i2v-uni3c-path",
      "image-to-3d-pixal3d",
      "video-concat-sound2-3",
      "interpolate-rife-fps",
      "ltx23-t2v-lora",
      "video-evolution-wan22-fun-vace",
      "captions-burnin",
      "ocr-lines-qwen35",
      "video-inpaint-wan-vace",
      "video-erase-void",
      "video-character-swap-h3",
      "video-mask-h3-relay",
      "video-export-pro",
      "video-export-exr",
      "image-to-splat-triposplat",
      "upscale-video-esrgan-chunked",
      "upscale-video-seedvr2-chunked",
      "infinitetalk-wanwrapper",
      "storyboard-qwen-edit-2509-next-scene",
      "video-bg-remove-birefnet",
      "captions-qwen3-asr",
      "image-to-3d-trellis2",
      "image-to-3d-trellis2-multiview",
      "video-concat-encoded",
      "audio-loop-crossfade",
      "scene-mesh-moge",
      "reference-brief-gemma4",
      "video-sdr-to-hdr-exr",
    ];
    for (const id of ids) expect(manifest.workflows.find((w) => w.id === id)?.notes, id).toBe(spec.get(id));
  });

  it("the spec's notes are as clean as the manifest's", () => {
    for (const [id, notes] of spec) for (const re of INTERNAL) expect(notes, id).not.toMatch(re);
  });
});
