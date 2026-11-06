import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * fal's file-size limits on Clean dialogue's cloud path, said before anything is uploaded or paid for:
 * - VEED Clean Audio: "Up to 30 minutes and 512 MB" (fal's veed/clean-audio OpenAPI, audio_url). A video goes to VEED as
 *   the file itself, so a few minutes of phone 4K were uploaded whole, then refused (file_too_large, 422).
 * - DeepFilterNet 3 on a video: the soundtrack comes from fal's extract-audio first, whose video_url has
 *   max_file_size 100000000 (its OpenAPI). A video over 100 MB was uploaded, then refused.
 * fal documents file_too_large as a 422 with ctx.max_size (https://fal.ai/docs/documentation/model-apis/errors).
 * No file is written at that size: the stored file's size is read through fs.statSync, which the last test answers.
 */
const dir = tempDir("fuobe-clean-size-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;

const cd = await import("@/lib/av/clean-dialogue");
const { planCleanDialogue, cleanDialogueProblem } = cd;
const { saveFile, absolutePath } = await import("@/server/storage");
const { planAudioTool } = await import("@/server/audio-tools");

const VIDEO = "/api/files/uploads/2026-11-06/vlog.mp4";
const AUDIO = "/api/files/uploads/2026-11-06/take.wav";
const MB = 1024 * 1024;
const ask = cleanDialogueProblem;

describe("fal's file-size limits (Clean dialogue, cloud)", () => {
  it("are fal's documented limits", () => {
    expect(cd.VEED_MAX_BYTES).toBe(512 * MB);
    expect(cd.EXTRACT_MAX_BYTES).toBe(100_000_000);
  });

  it("VEED: a file over 512 MB, audio or video, is refused before anything is sent", () => {
    for (const kind of ["audio", "video"] as const) {
      expect(ask({ engine: "cloud", media: kind === "video" ? VIDEO : AUDIO, kind, cleaner: "veed", bytes: 512 * MB + 1 })).toContain("512 MB");
      expect(ask({ engine: "cloud", media: kind === "video" ? VIDEO : AUDIO, kind, cleaner: "veed", bytes: 512 * MB })).toBeNull();
    }
  });

  it("DeepFilterNet: a video over extract-audio's 100 MB is refused; an audio file of any size is not", () => {
    expect(ask({ engine: "cloud", media: VIDEO, kind: "video", cleaner: "deepfilternet", bytes: 100_000_001 })).toContain("100 MB");
    expect(ask({ engine: "cloud", media: VIDEO, kind: "video", cleaner: "deepfilternet", bytes: 100_000_000 })).toBeNull();
    expect(ask({ engine: "cloud", media: AUDIO, kind: "audio", cleaner: "deepfilternet", bytes: 900 * MB })).toBeNull();
  });

  it("the open engine has no fal limit", () => {
    expect(ask({ engine: "open", media: VIDEO, kind: "video", cleaner: "veed", bytes: 2000 * MB })).toBeNull();
  });

  it("under the limits the plan is unchanged", () => {
    const p = planCleanDialogue({ engine: "cloud", media: VIDEO, kind: "video", cleaner: "deepfilternet", bytes: 50 * MB });
    expect(p.steps.map((s) => s.request.modelId)).toEqual(["extract-soundtrack", "deepfilternet3", "merge-audio-video"]);
  });

  it("the server plans with the stored file's size", () => {
    const asset = saveFile({ data: Buffer.from("not a real mp4"), contentType: "video/mp4", name: "vlog.mp4", source: "upload" });
    const abs = absolutePath(asset.relPath);
    const real = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((p: fs.PathLike, o?: fs.StatSyncOptions) => {
      const st = real(p, o as never) as fs.Stats;
      return String(p) === abs ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: 600 * MB }) : st;
    }) as typeof fs.statSync);
    try {
      expect(() => planAudioTool({ tool: "clean-dialogue", engine: "cloud", cleaner: "veed", media: asset.url, kind: "video" } as never)).toThrow(/512 MB/);
    } finally {
      spy.mockRestore();
    }
  });
});
