import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ComfyWorkflow } from "@/lib/comfy";
import {
  canvasSize,
  clampCanvas,
  danglingLinks,
  describeScene,
  detailFor,
  faceChunkCount,
  FRAME_RELIGHT_PROMPT,
  LIGHT_LOOKS,
  lightWords,
  nodeByTitle,
  openjutsuGraph,
  openjutsuLeftOut,
  OPENJUTSU_WORKFLOWS as W,
  paintKeyframe,
  pictureFrames,
  pictureVideo,
  preparePicture,
  pruneColor,
  pruneFace,
  pruneGroupSwap,
  pruneSceneEdit,
  RELIGHT_PROMPT,
  rolesText,
  runName,
  toneFor,
} from "@/lib/openjutsu-graphs";

// The Openjutsu graphs Genjutsu sends (Fuobe's copies of D3voz's graphs, as built into workflows/comfyui), with each
// request's settings written by node title.
const graph = (id: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui", `${id}.json`), "utf8")) as ComfyWorkflow;
const byTitle = (g: ComfyWorkflow, t: string) => g[nodeByTitle(g, t)];
const titles = (g: ComfyWorkflow) => Object.values(g).map((n) => n._meta?.title ?? "");
const group = { pictures: 2, roles: ["the person on the left", ""], resolution: "736p", motion: 512 as const, hatFix: false, noLipSync: false, edge: "normal" as const, seed: 9, run: "fuobe_g1" };

describe("Group swap's graphs", () => {
  it("drop the pictures not sent (their shrink and describer too) and leave no dangling link", () => {
    for (const n of [1, 2, 3, 4]) {
      const g = pruneGroupSwap(graph(W.group), { ...group, pictures: n, roles: [] });
      expect(Object.values(g).filter((x) => x.class_type === "LoadImage").length).toBe(n);
      expect(danglingLinks(g)).toEqual([]);
      for (let k = n + 1; k <= 4; k++) expect(titles(g)).not.toContain(`Describe picture ${k}`);
    }
    expect(() => pruneGroupSwap(graph(W.group), { ...group, pictures: 5 })).toThrow(/1–4/);
    // One by one takes exactly two.
    expect(danglingLinks(pruneGroupSwap(graph(W.groupOneByOne), group))).toEqual([]);
  });

  it("roles: one line per character, the empty ones named by screen time; none at all lets the describer name them", () => {
    expect(rolesText(["the person on the left", ""], 2)).toBe("the person on the left\nthe person with the second most screen time");
    expect(rolesText(["", ""], 2)).toBe("");
    expect(rolesText(["the dancer"], 1)).toBe("the dancer");
    const plan = byTitle(pruneGroupSwap(graph(W.group), group), "Swap Plan (roles, seed, size)").inputs;
    expect(plan).toMatchObject({ roles: "the person on the left\nthe person with the second most screen time", seed: 9, resolution: "736p", clip_seconds: 6 });
  });

  it("hats off and mouths following the sound take their nodes out; each job has its own run name", () => {
    const g = pruneGroupSwap(graph(W.group), group);
    expect(titles(g).some((t) => /\bhats?\b/i.test(t))).toBe(false);
    expect(titles(g)).not.toContain("No lip-sync in the prompt");
    expect(titles(g)).not.toContain("Mute the clip audio H3 hears");
    const withAll = pruneGroupSwap(graph(W.group), { ...group, hatFix: true, noLipSync: true });
    expect(titles(withAll)).toContain("SAM 3.1 track hats");
    expect(titles(withAll)).toContain("No lip-sync in the prompt");
    const plan = Object.values(g).find((n) => n.class_type === "MiniMaxH3ChainPlanModern")!;
    expect(plan.inputs.run_name).toBe("fuobe_g1");
    expect(runName("abc-12_x/..")).toBe("fuobe_abc-12_x");
    expect(runName("a")).not.toBe(runName("b"));
  });

  it("edge and motion detail", () => {
    const g = pruneGroupSwap(graph(W.group), { ...group, edge: "loose", motion: 768 });
    expect(Object.values(g).filter((n) => n.class_type === "GrowMaskWithBlur" && / grow mask /.test(n._meta?.title ?? "")).every((n) => n.inputs.expand === 60)).toBe(true);
    expect(Object.values(g).filter((n) => /motion reference/i.test(n._meta?.title ?? "") && n.class_type === "ImageScaleToMaxDimension").every((n) => n.inputs.largest_size === 768)).toBe(true);
  });
});

describe("Scene edit's graph", () => {
  const base = { target: "her coat", becomes: "a crimson velvet tailored blazer", picture: true, biggestOnly: false, keepShape: false, edge: "normal" as const, motion: 512 as const, resolution: "736p", seed: 3, run: "fuobe_g2" };
  it("change with a picture keeps the picture; without the outline the grey reference video goes", () => {
    const g = pruneSceneEdit(graph(W.scene), { ...base, action: "change" });
    expect(titles(g)).toContain("Picture 1");
    const ref = byTitle(g, "Reference Conditioning").inputs;
    expect(ref["ref_images.ref_image_0"]).toBeDefined();
    expect(ref["ref_videos.ref_video_0"]).toBeUndefined();
    expect(byTitle(g, "Object Swap Plan (what to change)").inputs).toMatchObject({ mode: "change", target: "her coat", change_to: "a crimson velvet tailored blazer", seed: 3 });
    expect(byTitle(g, "SAM: what to change").inputs.text).toBe("her coat");
    expect(danglingLinks(g)).toEqual([]);
    expect(byTitle(pruneSceneEdit(graph(W.scene), { ...base, action: "change", keepShape: true }), "Reference Conditioning").inputs["ref_videos.ref_video_0"]).toBeDefined();
  });

  it("remove drops the picture; background flips the grown mask; the margins are the object ones", () => {
    const r = pruneSceneEdit(graph(W.scene), { ...base, action: "remove" });
    expect(titles(r)).not.toContain("Picture 1");
    expect(danglingLinks(r)).toEqual([]);
    const b = pruneSceneEdit(graph(W.scene), { ...base, action: "background", target: "the people", edge: "loose" });
    expect(byTitle(b, "Grow mask").inputs).toMatchObject({ flip_input: true, expand: 40 });
    expect(danglingLinks(b)).toEqual([]);
  });

  it("a painted keyframe is run-length encoded at <= 256 px and follows the tracked area", () => {
    const w = 512;
    const h = 288;
    const data = new Uint8Array(w * h * 4);
    for (let y = 100; y < 150; y++) for (let x = 200; x < 300; x++) data[(y * w + x) * 4] = 255;
    const k = paintKeyframe({ width: w, height: h, data });
    expect([k.width, k.height]).toEqual([256, 144]);
    expect(k.runs.length % 2).toBe(0);
    expect(k.runs.length).toBeGreaterThan(0);
    const g = pruneSceneEdit(graph(W.scene), { ...base, action: "change", paint: [k] });
    expect(g.object_paint.class_type).toBe("H3PaintedEditArea");
    expect(byTitle(g, "Grow mask").inputs.mask).toEqual(["object_paint_clip", 0]);
    expect(danglingLinks(g)).toEqual([]);
  });
});

describe("From picture's graphs", () => {
  it("the first frame: the clip's shape at 768 px, the seed, the positive request", () => {
    const g = preparePicture(graph(W.prepare), { width: 1920, height: 1080, seed: 5, light: "", ownPerson: false, keepCrop: false });
    expect([g["3"].inputs.width, g["3"].inputs.height]).toEqual(canvasSize(1920, 1080, "768p"));
    expect(g["19"].inputs.seed).toBe(5);
    expect(String(g["6"].inputs.value)).toMatch(/^Show the character from <image 1> in exactly the pose/);
    expect(danglingLinks(g)).toEqual([]);
  });

  it("a light makes it one pass (the character only, at 3 MP); the clip's own person is relit, keeping the crop at denoise 0.9", () => {
    const light = lightWords({ look: "golden-halo" });
    const lit = preparePicture(graph(W.prepare), { width: 1280, height: 720, seed: 1, light, ownPerson: false, keepCrop: false, adjust: "arms crossed" });
    expect(String(lit["6"].inputs.value)).toContain("Arms crossed.");
    expect(String(lit["6"].inputs.value)).toContain(light);
    expect(lit["15"].inputs["images.image1"]).toBeUndefined();
    expect(lit.relight_latent.class_type).toBe("EmptyFlux2LatentImage");
    expect(danglingLinks(lit)).toEqual([]);
    const own = preparePicture(graph(W.prepare), { width: 1280, height: 720, seed: 1, light, ownPerson: true, keepCrop: true });
    expect(own["4"]).toBeUndefined();
    expect(own["19"].inputs.denoise).toBe(0.9);
    expect(own.relight_start.class_type).toBe("VAEEncode");
    expect(String(own["6"].inputs.value)).toContain(FRAME_RELIGHT_PROMPT.replace(" {look}", ""));
    expect(danglingLinks(own)).toEqual([]);
    expect(preparePicture(graph(W.prepare), { width: 1280, height: 720, seed: 1, light, ownPerson: true, keepCrop: false })["19"].inputs.denoise).toBe(1);
    expect(() => preparePicture(graph(W.prepare), { width: 1280, height: 720, seed: 1, light: "", ownPerson: true, keepCrop: false })).toThrow(/light/);
  });

  it("17 looks with plain names; own words travel as a sentence", () => {
    expect(LIGHT_LOOKS).toHaveLength(17);
    expect(new Set(LIGHT_LOOKS.map((l) => l.id)).size).toBe(17);
    expect(LIGHT_LOOKS.map((l) => l.name)).not.toContain("Magenta club · mostly the background");
    expect(lightWords({ words: "soft pearl light from a high window." })).toBe("Light the new photo this way: soft pearl light from a high window.");
    expect(lightWords(undefined)).toBe("");
  });

  it("what happens: the part's frames, and pass 1 alone for the clip's own person", () => {
    const g = describeScene(graph(W.describe), { frames: pictureFrames(6), ownPerson: false });
    expect(g["1"].inputs.frame_load_cap).toBe(141);
    const own = describeScene(graph(W.describe), { frames: 141, ownPerson: true });
    expect(own["74"]).toBeUndefined();
    expect(own["79"].inputs.source).toEqual(["73", 0]);
    expect(danglingLinks(own)).toEqual([]);
  });

  it("the video: frames on H3's grid, the canvas clamped at 2048, the description opening the shot", () => {
    expect([pictureFrames(6), pictureFrames(5.9), pictureFrames(15)]).toEqual([141, 141, 345]);
    expect(clampCanvas([2624, 1088])).toEqual([2048, 832]);
    const g = pictureVideo(graph(W.solar), { renderer: "solar", seconds: 6, width: 1920, height: 1080, quality: "720p", motion: 0, seed: 4, description: "The character turns to camera." });
    expect(g["56"].inputs).toMatchObject({ length: 141 });
    expect(Math.max(Number(g["56"].inputs.width), Number(g["56"].inputs.height))).toBeLessThanOrEqual(2048);
    expect(String(g["56"].inputs.prompt)).toContain("[Shot 1] The shot begins from <Video 2>. The character turns to camera. ");
    expect(g["60"].inputs.steps).toBe(4);
    expect(g["65"].inputs.seed).toBe(4);
    expect(pictureVideo(graph(W.h3), { renderer: "h3", seconds: 6, width: 1280, height: 720, quality: "480p", motion: 512, seed: 4 })["60"].inputs.steps).toBe(6);
    expect(() => pictureVideo(graph(W.solar), { renderer: "solar", seconds: 0.5, width: 1280, height: 720, quality: "480p", motion: 0, seed: 1 })).toThrow();
  });
});

describe("Finish's graphs", () => {
  it("Fix faces: match the photo drops the blurred face; largest_face; sections", () => {
    const photo = pruneFace(graph(W.faces), { style: "photo", seed: 2, chunkSeconds: 4 });
    expect(titles(photo)).not.toContain("Blurred face (follow the mouth)");
    expect(byTitle(photo, "Reference Conditioning").inputs["ref_videos.ref_video_0"]).toBeUndefined();
    expect(byTitle(photo, "Face Fix Chunks").inputs.chunk_seconds).toBe(4);
    expect(Object.values(photo).filter((n) => n.class_type === "H3FaceTrackCrop").every((n) => n.inputs.select === "largest_face")).toBe(true);
    expect(danglingLinks(photo)).toEqual([]);
    const mouth = pruneFace(graph(W.faces), { style: "mouth", seed: 2, chunkSeconds: 6.5 });
    expect(titles(mouth)).toContain("Blurred face (follow the mouth)");
    expect([faceChunkCount(5.8, 6.5), faceChunkCount(6, 6.5), faceChunkCount(17, 6.5)]).toEqual([1, 2, 4]);
  });

  it("Fix colours: a step turned off goes; the tone travels in raw_settings", () => {
    const off = pruneColor(graph(W.colours), { detail: null, tone: null });
    expect(Object.values(off).map((n) => n.class_type).sort()).toEqual(["VHS_BatchManager", "VHS_LoadVideo", "VHS_VideoCombine"]);
    expect(danglingLinks(off)).toEqual([]);
    const soft = pruneColor(graph(W.colours), { detail: detailFor(0.33), tone: toneFor("soft", 0.4) });
    expect(byTitle(soft, "Detail contrast").inputs.detail_contrast).toBeCloseTo(-0.198, 3);
    expect(JSON.parse(String(byTitle(soft, "Tone mapper").inputs.raw_settings)).settings).toMatchObject({ mode: "Reinhard", strength: 0.2 });
    expect(toneFor("rich", 0.1)).toMatchObject({ mode: "Filmic Strong", strength: 0.35 });
    expect(detailFor(0)).toBeNull();
  });
});

describe("the provider's branch", () => {
  it("one settings object per workflow; the pictures left out", () => {
    const g = openjutsuGraph(W.group, graph(W.group), { pictures: 2, roles: ["a", "b"], quality: "720p", seed: 1 }, { generationId: "gen1" });
    expect(byTitle(g, "Swap Plan (roles, seed, size)").inputs.resolution).toBe("736p");
    expect(openjutsuLeftOut(W.group, { pictures: 2 })).toEqual(["image3", "image4"]);
    expect(openjutsuLeftOut(W.scene, { action: "remove", picture: true })).toEqual(["image"]);
    expect(openjutsuLeftOut(W.prepare, { ownPerson: true })).toEqual(["image"]);
    expect(() => openjutsuGraph(W.prepare, graph(W.prepare), {}, { generationId: "g" })).toThrow(/size/);
  });

  it("no image or video prompt names what isn't wanted (Fuobe's rule)", () => {
    const NEG = /\b(do not|don't|never|no other|without|not replaced)\b/i;
    const prompts: string[] = [RELIGHT_PROMPT, ...LIGHT_LOOKS.map((l) => l.light), String(graph(W.prepare)["6"].inputs.value), String(graph(W.solar)["56"].inputs.prompt), String(graph(W.h3)["56"].inputs.prompt)];
    for (const p of prompts) expect(p, p.slice(0, 60)).not.toMatch(NEG);
  });
});
