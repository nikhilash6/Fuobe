import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Manifest } from "@/lib/comfy";

// The Workflows page shows each graph's notes word for word to everyone, so they read as public notes: what the graph
// does, its settings, files and VRAM. No private workflow file names, no notes about who tested what on which machine,
// no guesses and no paths into Fuobe's own source.
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
  /Originals O\d|\bN7-\d|\br4\//,
  /\b(src|tests)\/|scripts\/(?!comfy\/README\.md)/,
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
    ];
    for (const id of ids) expect(manifest.workflows.find((w) => w.id === id)?.notes, id).toBe(spec.get(id));
  });

  it("the spec's notes are as clean as the manifest's", () => {
    for (const [id, notes] of spec) for (const re of INTERNAL) expect(notes, id).not.toMatch(re);
  });
});
