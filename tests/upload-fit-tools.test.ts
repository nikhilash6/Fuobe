import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";
import { cropFor } from "@/lib/av/crop-fit";
import { ACCOUNT_PHOTO_BYTES, ACCOUNT_PHOTO_PIXELS, ACCOUNT_SOUND_BYTES, fitAfterRefusal, fitBeforeSend, uploadType } from "@/lib/av/fit-file";
import { planAudioFit } from "@/lib/av/fit-upload";
import { sampleFitRule, voiceFitRule } from "@/lib/av/voice-fit";
import { soundAloneHelps } from "@/lib/av/clean-dialogue";
import { clipWindow, portraitRatio, voiceFile, voiceWindow } from "@/lib/catalog/clip-windows";
import { clipFitWindow } from "@/lib/composer";
import { getModel } from "@/lib/catalog";

const dir = tempDir("fuobe-upload-fit-tools-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
const { ACCOUNT_LIMITS } = await import("@/server/account-files");
const dub = await import("@/server/dub");
const { saveFile } = await import("@/server/storage");

describe("uploads: what a file needs before it goes", () => {
  it("sends what the route takes as it is, under the route's own name for its type", () => {
    expect(fitBeforeSend({ type: "image/png", name: "a.png" })).toEqual({ kind: "send" });
    expect(fitBeforeSend({ type: "video/quicktime", name: "a.mov" })).toEqual({ kind: "send" });
    expect(fitBeforeSend({ type: "audio/x-m4a", name: "a.m4a" })).toEqual({ kind: "send", type: "audio/mp4" });
    expect(fitBeforeSend({ type: "image/jpg", name: "a.jpg" })).toEqual({ kind: "send", type: "image/jpeg" });
    expect(fitBeforeSend({ type: "", name: "notes.glb" })).toEqual({ kind: "send" });
  });

  it("converts the photos and sounds the route can't take, by type or by name", () => {
    expect(fitBeforeSend({ type: "image/heic", name: "IMG_1.HEIC" })).toEqual({ kind: "photo" });
    expect(fitBeforeSend({ type: "", name: "IMG_1.HEIC" })).toEqual({ kind: "photo" });
    expect(fitBeforeSend({ type: "image/avif", name: "a.avif" })).toEqual({ kind: "photo" });
    expect(fitBeforeSend({ type: "audio/aac", name: "a.aac" })).toEqual({ kind: "sound" });
    expect(fitBeforeSend({ type: "", name: "voice.opus" })).toEqual({ kind: "sound" });
    expect(fitBeforeSend({ type: "audio/x-caf", name: "a.caf" })).toEqual({ kind: "sound" });
    expect(uploadType({ type: "audio/wave" })).toBe("audio/wav");
  });

  it("fits a refused photo or sound once (size or type), never a clip or another refusal", () => {
    expect(fitAfterRefusal({ type: "image/jpeg", name: "big.jpg", size: 30e6 }, 413)).toEqual({ kind: "photo" });
    expect(fitAfterRefusal({ type: "image/gif", name: "a.gif", size: 1e6 }, 415)).toEqual({ kind: "photo" });
    expect(fitAfterRefusal({ type: "audio/wav", name: "long.wav", size: 60e6 }, 413)).toEqual({ kind: "sound" });
    expect(fitAfterRefusal({ type: "video/mp4", name: "a.mp4", size: 99e6 }, 413)).toBeNull();
    expect(fitAfterRefusal({ type: "image/png", name: "a.png", size: 1e6 }, 403)).toBeNull();
  });

  it("keeps an account's caps the same as the server's", () => {
    expect(ACCOUNT_PHOTO_BYTES).toBe(ACCOUNT_LIMITS.imageBytes);
    expect(ACCOUNT_PHOTO_PIXELS).toBe(ACCOUNT_LIMITS.imagePixels);
    expect(ACCOUNT_SOUND_BYTES).toBe(ACCOUNT_LIMITS.audioBytes);
  });
});

describe("uploads: the windows a tool's file is fitted to", () => {
  it("reads a voice's window and files from the model's own rules", () => {
    expect(voiceWindow("minimax-h3-max-lipsync")).toEqual({ min: 5, max: 900 });
    expect(voiceWindow("omnihuman")?.max).toBe(60);
    expect(voiceFile("omnihuman-2")).toEqual({ formats: ["mp3", "wav"], bytes: 15 * 1024 * 1024 });
    expect(voiceFile("minimax-h3-max-lipsync")).toBeUndefined();
    expect(portraitRatio("minimax-h3-max-lipsync")).toEqual([0.4, 2.5]);
  });

  it("offers a part of a long voice, and converts one OmniHuman 2 can't take", () => {
    const h3 = voiceFitRule({ id: "minimax-h3-max-lipsync", name: "H3 Max lip sync" })!;
    expect(planAudioFit(h3, { format: "m4a", bytes: 9e6, seconds: 1000 })).toMatchObject({ kind: "refuse" });
    expect(planAudioFit(h3, { format: "m4a", bytes: 9e6, seconds: 600 })).toEqual({ kind: "keep" });
    const omni = voiceFitRule({ id: "omnihuman-2", name: "OmniHuman 2" })!;
    expect(planAudioFit(omni, { format: "m4a", bytes: 3e6, seconds: 60 })).toMatchObject({ kind: "convert" });
    expect(planAudioFit(omni, { format: "mp3", bytes: 3e6, seconds: 400 })).toMatchObject({ kind: "trim", max: 300 });
    expect(voiceFitRule({ id: "flux-2", name: "FLUX" })).toBeNull();
    expect(planAudioFit(sampleFitRule(), { format: "wav", bytes: 3e6, seconds: 45 })).toMatchObject({ kind: "trim", max: 20 });
  });

  it("finds a clip edit's window, or a tool's longest source", () => {
    const vsr = getModel("kandinsky-vsr");
    expect(vsr && clipFitWindow("upscale-video", vsr)).toEqual({ max: 5 });
    expect(clipWindow({ id: "heygen-translate" })).toEqual({ max: 480 });
    expect(clipFitWindow("v2v", { id: "heygen-translate", options: {} })).toEqual({ max: 480 });
    expect(clipFitWindow("t2v", { id: "heygen-translate", options: {} })).toBeUndefined();
  });

  it("crops a picture to the nearest shape the tool takes, centred", () => {
    expect(cropFor(1000, 3000, [0.4, 2.5])).toEqual({ x: 0, y: 250, width: 1000, height: 2500 });
    expect(cropFor(3000, 1000, [0.4, 2.5])).toEqual({ x: 250, y: 0, width: 2500, height: 1000 });
    expect(cropFor(1000, 1000, [0.4, 2.5])).toBeNull();
  });

  it("offers the sound alone for a video too big for the cloud, not for other refusals", () => {
    expect(soundAloneHelps("The cloud takes a video's soundtrack from files up to 100 MB — trim or compress it")).toBe(true);
    expect(soundAloneHelps("VEED cleans up to 30 minutes — trim it first, or pick another cleaner")).toBe(false);
    expect(soundAloneHelps(null)).toBe(false);
  });
});

describe("Dub: one shot's own length, before anything is sent", () => {
  // A clip whose header can't be read here: the browser's measure stands.
  const clip = () => saveFile({ data: Buffer.from("not a real clip"), contentType: "video/webm", source: "upload" }).url;

  it("refuses HeyGen Translate past 480 s in the price check and the plan, in Generate's words", () => {
    const body = { engine: "cloud" as const, mode: "oneshot" as const, model: "heygen-translate" as const, video: clip(), targets: ["es"], duration: 600 };
    expect(() => dub.previewDub(body)).toThrow(/takes up to 480 s clips, and this one is 600 s: trim it first/);
    expect(() => dub.planDub(body)).toThrow(/up to 480 s/);
    expect(dub.oneShotLengthProblem("heygen-translate-fast", 481)).toMatch(/480 s/);
    expect(dub.oneShotLengthProblem("heygen-translate", 479)).toBeNull();
    expect(dub.oneShotLengthProblem("heygen-translate", undefined)).toBeNull();
    // Within it, the plan goes on as before.
    expect(dub.planDub({ ...body, duration: 300 }).oneshot?.jobs.length).toBe(1);
  });
});
