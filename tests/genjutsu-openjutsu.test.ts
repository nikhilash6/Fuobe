import { describe, expect, it } from "vitest";
import {
  chooseMaker,
  decodeSetup,
  directRunFeatures,
  encodeSetup,
  fitSize,
  GENJUTSU_FEATURES,
  GENJUTSU_MODES,
  genjutsuProblem,
  getMaker,
  getMode,
  makersFor,
  modeHint,
  modeOpen,
  MOTION_H3,
  ORIGINALS,
  planGenjutsu,
  requestFeatures,
  type GenjutsuPlanInput,
  type Maker,
} from "@/lib/catalog/genjutsu";
import { roleFromPin } from "@/lib/catalog/character-swap";
import { getModel } from "@/lib/catalog";
import { promptOptional } from "@/lib/catalog/plan";

// Genjutsu's Openjutsu modes in the catalog: Group swap (2–4 characters), Scene edit (change / remove / new background),
// From picture (first frame, then the video) and Finish (Fix faces, Fix colours), each behind its own gate.
const ref = "/api/files/hero.png";
const none = () => false;
const open = (id: string) => getMaker(id, "open")!;
const source = { url: "/api/files/clip.mp4", duration: 20, fps: 30, width: 1920, height: 1080, hasAudio: true };
const oj = (o: Partial<GenjutsuPlanInput> & { maker: Maker }) =>
  planGenjutsu({ engine: "open", mode: "character", title: "Genjutsu", source, range: { start: 2, end: 8 }, quality: "720p", references: [ref, "/api/files/two.png"], ...o });
const step = (p: ReturnType<typeof planGenjutsu>, key: string) => {
  const s = p.steps.find((x) => x.key === key);
  if (!s) throw new Error(`no step ${key} in ${p.steps.map((x) => x.key).join(", ")}`);
  return s;
};

describe("Genjutsu: the Openjutsu modes", () => {
  it("two new tabs; each opens with its features (the owner sees all), and visitors see nothing new until then", () => {
    expect(GENJUTSU_MODES.map((m) => m.id)).toEqual(["motion", "character", "swap", "restyle", "insert", "picture", "finish"]);
    expect(GENJUTSU_MODES.filter((m) => modeOpen(m.id, none)).map((m) => m.id)).toEqual(["motion", "character", "swap", "restyle", "insert"]);
    expect(modeOpen("finish", (f) => f === "finish-colours")).toBe(true);
    expect(modeOpen("picture", (f) => f === "picture-light")).toBe(false);
    for (const mode of ["character", "swap", "picture", "finish"] as const) {
      for (const m of makersFor("open", mode, mode === "swap" || mode === "character" ? "type" : undefined, none)) expect(m.features, m.id).toBeUndefined();
    }
    expect(Object.keys(GENJUTSU_FEATURES)).toHaveLength(12);
  });

  it("Motion transfer's MiniMax H3: a model choice the owner sees after the Original, a visitor only once it opens", () => {
    const h3 = open(MOTION_H3);
    expect(h3).toMatchObject({ label: "MiniMax H3", modes: ["motion"], source: "open", refs: { min: 1, max: 1 }, keepsSound: true, qualities: ["480p", "720p"], features: ["motion-h3"], part: { min: 2, max: 15 } });
    expect(GENJUTSU_FEATURES["motion-h3"]).toEqual({ mode: "motion", workflows: ["video-motion-transfer-h3"], maker: MOTION_H3 });
    expect(makersFor("open", "motion").map((m) => m.id)).toEqual([ORIGINALS.motionLite, MOTION_H3]);
    expect(makersFor("open", "motion", undefined, none).map((m) => m.id)).toEqual([ORIGINALS.motionLite]);
    expect(makersFor("open", "motion", undefined, (f) => f === "motion-h3").map((m) => m.id)).toEqual([ORIGINALS.motionLite, MOTION_H3]);
    expect(makersFor("cloud", "motion").map((m) => m.id)).not.toContain(MOTION_H3);
    // The Original stays the default; H3 runs when picked (the owner, or anyone once it opens).
    expect(chooseMaker({ engine: "open", mode: "motion" })).toMatchObject({ maker: { id: ORIGINALS.motionLite } });
    expect(chooseMaker({ engine: "open", mode: "motion", modelId: MOTION_H3 })).toMatchObject({ maker: { id: MOTION_H3 } });
    expect(chooseMaker({ engine: "open", mode: "motion", modelId: MOTION_H3, open: none })).toMatchObject({ maker: { id: ORIGINALS.motionLite } });
    expect(requestFeatures({ mode: "motion", maker: h3 })).toEqual(["motion-h3"]);
    expect(directRunFeatures(MOTION_H3, { seconds: 5 })).toEqual(["motion-h3"]);
    const code = encodeSetup({ mode: "motion", engine: "open", model: MOTION_H3 });
    expect(decodeSetup(code)?.model).toBe(MOTION_H3);
    expect(decodeSetup(code, none)?.model).toBeUndefined();
  });

  it("Motion transfer's MiniMax H3: 2–15 s, one character photo, then the part at 24 fps and one job on the H3 graph", () => {
    const h3 = open(MOTION_H3);
    const c = (o: Partial<Parameters<typeof genjutsuProblem>[0]> = {}) => genjutsuProblem({ mode: "motion", maker: h3, source, range: { start: 0, end: 6 }, references: 1, ...o });
    expect(c()).toBeNull();
    expect(c({ references: 0 })).toBe("Add a picture of your character");
    expect(c({ range: { start: 0, end: 1.5 } })).toBe("Pick a part between 2 and 15 seconds");
    expect(c({ range: { start: 0, end: 16 } })).toBe("Pick a part between 2 and 15 seconds");
    expect(c({ range: { start: 2, end: 17 } })).toBeNull();

    const p = oj({ mode: "motion", maker: h3, references: [ref, "/api/files/two.png"], seed: 9, prompt: "She smiles at the end." });
    expect(p.steps.map((s) => s.key)).toEqual(["part", "motion"]);
    expect(step(p, "part").request).toMatchObject({ modelId: "oss-fit-clip", op: "trim", params: { startTime: 2, endTime: 8, fps: 24, extra: { width: 1308, height: 736 } } });
    const job = step(p, "motion");
    expect(job.request).toMatchObject({ modelId: MOTION_H3, op: "motion-transfer", feature: "genjutsu", inputs: { images: [ref] }, params: { seed: 9, resolution: "720p" } });
    expect(job.request.params?.extra?.openjutsu).toEqual({ seconds: 6, quality: "720p", motion: 0, scene: "She smiles at the end.", seed: 9 });
    expect(job.after).toEqual(["part"]);
    expect(job.chain).toEqual([{ slot: "video" }]);
    expect(p).toMatchObject({ final: "motion", pieces: 1, sound: false });
    // The graph keeps the part's sound itself: nothing is put back afterwards.
    expect(p.steps.map((s) => s.request.modelId)).not.toContain("oss-mux");

    const small = oj({ mode: "motion", maker: h3, references: [ref], quality: "480p" });
    expect(step(small, "part").request.params?.extra).toEqual({ width: 854, height: 480 });
    expect(step(small, "motion").request.params?.extra?.openjutsu).toMatchObject({ quality: "480p", scene: "" });
    expect(() => oj({ mode: "motion", maker: h3, references: [] })).toThrow(/picture of your character/);
  });

  it("two characters or more move the swap to Group swap on your GPU (Recast in the cloud); one stays Fuobe's", () => {
    expect(chooseMaker({ engine: "open", mode: "character", refs: 1 })).toMatchObject({ maker: { id: ORIGINALS.character } });
    expect(chooseMaker({ engine: "open", mode: "character", refs: 2 })).toMatchObject({ maker: { id: "oss-h3-group-swap" } });
    expect(chooseMaker({ engine: "open", mode: "character", refs: 4, target: "click" })).toMatchObject({ maker: { id: "oss-h3-group-swap" } });
    expect(chooseMaker({ engine: "cloud", mode: "character", refs: 3 })).toMatchObject({ maker: { id: "h3-max-recast" } });
    expect(chooseMaker({ engine: "open", mode: "character", refs: 1, modelId: "oss-h3-group-swap" })).toMatchObject({ maker: { id: "oss-h3-group-swap" } });
    // Before it opens, a visitor keeps the one-person swap.
    expect(chooseMaker({ engine: "open", mode: "character", refs: 2, open: none })).toMatchObject({ maker: { id: ORIGINALS.character } });
  });

  it("Remove it and New background are Scene edit's; Finish picks by tool", () => {
    expect(chooseMaker({ engine: "open", mode: "swap", target: "type" })).toMatchObject({ maker: { id: ORIGINALS.swapLite } });
    expect(chooseMaker({ engine: "open", mode: "swap", target: "type", action: "remove" })).toMatchObject({ maker: { id: "oss-h3-scene-edit" } });
    expect(chooseMaker({ engine: "open", mode: "swap", target: "type", action: "background" })).toMatchObject({ maker: { id: "oss-h3-scene-edit" } });
    expect(chooseMaker({ engine: "cloud", mode: "swap", target: "type", action: "remove" })).toEqual({ problem: "Remove it and New background run on your GPU" });
    expect(chooseMaker({ engine: "open", mode: "finish", tool: "faces" })).toMatchObject({ maker: { id: "oss-h3-fix-faces" } });
    expect(chooseMaker({ engine: "open", mode: "finish", tool: "colours" })).toMatchObject({ maker: { id: "oss-fix-colours" } });
    expect(chooseMaker({ engine: "open", mode: "picture" })).toMatchObject({ maker: { id: "oss-from-picture" } });
    expect(chooseMaker({ engine: "cloud", mode: "picture" })).toEqual({ problem: expect.stringMatching(/Nothing on this engine/) });
  });

  it("checks in words", () => {
    const c = (m: Maker, o: Partial<Parameters<typeof genjutsuProblem>[0]> = {}) => genjutsuProblem({ mode: m.modes[0], maker: m, source, range: { start: 0, end: 6 }, references: 1, ...o });
    expect(c(open("oss-h3-group-swap"), { references: 5 })).toBe("Up to four characters");
    expect(c(open("oss-h3-group-swap"), { references: 1, character: { onePerPerson: true } })).toBe("Add a second character");
    expect(c(open("oss-h3-group-swap"), { references: 3, character: { onePerPerson: true } })).toBe("One by one takes two characters");
    expect(c(open("oss-h3-group-swap"), { range: { start: 0, end: 1.5 } })).toBe("Pick a part between 2 and 15 seconds");
    expect(c(open("oss-h3-group-swap"), { range: { start: 0, end: 16 } })).toBe("Pick a part between 2 and 15 seconds");
    expect(c(open("oss-h3-scene-edit"), { references: 0, object: { action: "change" } })).toBe("Name what changes");
    expect(c(open("oss-h3-scene-edit"), { references: 0, object: { action: "remove" } })).toBe("Name what goes");
    expect(c(open("oss-h3-scene-edit"), { references: 0, object: { action: "background" } })).toBeNull();
    expect(c(open("oss-h3-scene-edit"), { references: 0, target: "paint", object: { action: "change" } })).toBe("Paint over what changes");
    expect(c(open("oss-from-picture"), { picture: { stage: "frame", ownPerson: true }, references: 0 })).toBe("Pick a light, or turn off Keep the clip's own person");
    expect(c(open("oss-from-picture"), { picture: { stage: "frame" }, references: 0 })).toBe("Add a picture of your character");
    expect(c(open("oss-from-picture"), { picture: { stage: "video" } })).toBe("Make and pick the first frame first");
    expect(c(open("oss-h3-fix-faces"), { references: 0 })).toBe("Add the character photo");
    expect(c(open("oss-fix-colours"), { references: 0, range: { start: 0, end: 19 } })).toBeNull();
    expect(c(open("oss-h3-fix-faces"), { range: { start: 0, end: 10 }, source: { ...source, duration: 40 } })).toBeNull();
    // Fix faces holds the whole part in memory: 10 s at most.
    expect(c(open("oss-h3-fix-faces"), { range: { start: 0, end: 20 }, source: { ...source, duration: 40 } })).toBe("Pick up to 10 seconds of the video");
  });

  it("which features a request needs", () => {
    expect(requestFeatures({ mode: "character", maker: open("oss-h3-group-swap"), character: { onePerPerson: true } })).toEqual(["group-swap", "group-swap-one-by-one"]);
    expect(requestFeatures({ mode: "swap", maker: open("oss-h3-scene-edit"), object: { action: "background" } })).toEqual(["object-background"]);
    expect(requestFeatures({ mode: "picture", maker: open("oss-from-picture"), picture: { stage: "frame", light: { look: "golden-halo" }, ownPerson: true } })).toEqual(["picture", "picture-light", "picture-own-person"]);
    expect(requestFeatures({ mode: "motion", maker: getMaker(ORIGINALS.motionLite, "cloud")! })).toEqual([]);
  });

  it("plans: the part fitted at 24 fps and the quality's short edge, then one job with its settings", () => {
    const g = oj({ maker: open("oss-h3-group-swap"), character: { people: [{ role: "the person on the left" }], onePerPerson: true, hats: true, mouthsFollowSound: false, edge: "loose" }, seed: 7 });
    expect(step(g, "part").request).toMatchObject({ modelId: "oss-fit-clip", op: "trim", params: { startTime: 2, endTime: 8, fps: 24, extra: { width: 1308, height: 736 } } });
    const swap = step(g, "swap");
    expect(swap.request).toMatchObject({ modelId: "oss-h3-group-swap", op: "group-swap", feature: "genjutsu", inputs: { images: [ref, "/api/files/two.png"] }, params: { seed: 7, resolution: "720p" } });
    expect(swap.request.params?.extra?.openjutsu).toMatchObject({ pictures: 2, roles: ["the person on the left", ""], hats: true, mouthsFollowSound: false, edge: "loose", onePerPerson: true, seed: 7 });
    expect(swap.chain).toEqual([{ slot: "video" }]);
    expect(g.final).toBe("swap");

    const e = oj({ mode: "swap", maker: open("oss-h3-scene-edit"), references: [ref], object: { action: "remove", target: "the handbag" }, quality: "480p" });
    expect(step(e, "part").request.params?.extra).toEqual({ width: 854, height: 480 });
    expect(step(e, "edit").request).toMatchObject({ op: "scene-edit", params: { extra: { openjutsu: { action: "remove", target: "the handbag", picture: false } } } });
    expect(step(e, "edit").request.inputs).toBeUndefined();
    const bg = oj({ mode: "swap", maker: open("oss-h3-scene-edit"), references: [ref], object: { action: "background", becomes: "an Amalfi terrace" } });
    expect(step(bg, "edit").request.params?.extra?.openjutsu).toMatchObject({ action: "background", target: "the people", becomes: "an Amalfi terrace", picture: true });

    const frame = oj({ mode: "picture", maker: open("oss-from-picture"), references: [ref], picture: { stage: "frame", light: { look: "golden-halo" } } });
    expect(frame.steps.map((s) => s.key)).toEqual(["frame"]);
    expect(step(frame, "frame").request).toMatchObject({ modelId: "oss-from-picture-frame", op: "picture-frame", feature: "genjutsu-step", inputs: { video: source.url, images: [ref] }, params: { startTime: 2 } });
    expect(String((step(frame, "frame").request.params?.extra?.openjutsu as { light: string }).light)).toMatch(/warm golden glow/);
    const video = oj({ mode: "picture", maker: open("oss-from-picture"), references: [ref], picture: { stage: "video", frame: "/api/files/frame.png", scene: "She turns." } });
    expect(step(video, "video").request).toMatchObject({ op: "picture-video", inputs: { images: ["/api/files/frame.png"] }, params: { extra: { openjutsu: { seconds: 6, scene: "She turns." } } } });
    expect(() => oj({ mode: "picture", maker: open("oss-from-picture"), picture: { stage: "video" } })).toThrow(/first frame/);

    const colours = oj({ mode: "finish", maker: open("oss-fix-colours"), references: [], range: { start: 0, end: 20 }, finish: { tool: "colours", finish: "rich" } });
    expect(colours.steps.map((s) => s.key)).toEqual(["fix"]);
    expect(step(colours, "fix").request).toMatchObject({ op: "tone-video", inputs: { video: source.url }, params: { extra: { openjutsu: { finish: "rich" } } } });
    const faces = oj({ mode: "finish", maker: open("oss-h3-fix-faces"), references: [ref], range: { start: 0, end: 10 }, finish: { tool: "faces", faceStyle: "photo" } });
    expect(faces.steps.map((s) => s.key)).toEqual(["part", "fix"]);
    expect(step(faces, "fix").request).toMatchObject({ op: "face-fix-video", inputs: { images: [ref] }, params: { extra: { openjutsu: { faceStyle: "photo", chunkSeconds: 6.5 } } } });
    expect(fitSize(640, 360, 736)).toEqual({ width: 640, height: 360 });
  });

  it("setup codes carry the new settings; a code naming what isn't open opens without it", () => {
    const code = encodeSetup({ mode: "character", engine: "open", model: "oss-h3-group-swap", character: { people: [{ role: "the dancer", pin: { x: 0.25, y: 0.5 } }, { role: "" }], onePerPerson: true, edge: "tight" } });
    expect(decodeSetup(code)).toMatchObject({ mode: "character", model: "oss-h3-group-swap", character: { people: [{ role: "the dancer", pin: { x: 0.25, y: 0.5 } }, { role: "" }], onePerPerson: true, edge: "tight" } });
    const visitor = decodeSetup(code, none)!;
    expect(visitor.model).toBeUndefined();
    expect(visitor.character?.onePerPerson).toBeUndefined();
    const pic = encodeSetup({ mode: "picture", picture: { light: { look: "venetian-blinds" }, ownPerson: true, keepCrop: true } });
    expect(decodeSetup(pic)).toMatchObject({ mode: "picture", picture: { light: { look: "venetian-blinds" }, ownPerson: true, keepCrop: true } });
    expect(decodeSetup(pic, none)!.mode).toBe("motion");
    const obj = encodeSetup({ mode: "swap", object: { action: "background", target: "the people", becomes: "a rooftop at dusk" } });
    expect(decodeSetup(obj)?.object).toEqual({ action: "background", target: "the people", becomes: "a rooftop at dusk" });
    expect(decodeSetup(obj, none)?.object).toBeUndefined();
    const fin = encodeSetup({ mode: "finish", finish: { tool: "colours", finish: "filmic", strength: 0.5 } });
    expect(decodeSetup(fin)).toMatchObject({ mode: "finish", finish: { tool: "colours", finish: "filmic", strength: 0.5 } });
    expect(decodeSetup(fin, (f) => f === "finish-faces")?.finish).toBeUndefined();
  });

  it("Who becomes who: a tap writes where the person stands", () => {
    expect(roleFromPin({ x: 0.1, y: 0.5 })).toBe("the person on the left");
    expect(roleFromPin({ x: 0.5, y: 0.8 })).toBe("the person in the centre in front");
    expect(roleFromPin({ x: 0.9, y: 0.1 })).toBe("the person on the right at the back");
  });

  it("Finish's hint names only the tools open to the viewer", () => {
    const only = (k: string) => (f: string) => f === k;
    expect(modeHint("finish", only("finish-colours") as never)).toBe("Give a finished video a soft film finish.");
    expect(modeHint("finish", only("finish-faces") as never)).toBe("Give a finished video sharper faces.");
    expect(modeHint("finish", () => true)).toBe("Give a finished video sharper faces or a soft film finish.");
    expect(modeHint("motion", () => false)).toBe(getMode("motion").hint);
  });

  it("every step of the new modes plans without a prompt: their words travel in the settings", () => {
    const ids = ["oss-h3-group-swap", "oss-h3-scene-edit", "oss-from-picture-frame", "oss-scene-describe", "oss-from-picture", "oss-h3-fix-faces", "oss-fix-colours"];
    for (const id of ids) {
      const model = getModel(id)!;
      for (const r of model.routes) expect(promptOptional(model, r.op), `${id} ${r.op}`).toBe(true);
    }
  });
});
