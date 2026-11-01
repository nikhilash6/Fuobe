import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CinemaGenerateInput } from "@/lib/catalog/cinema";

/** Blockout to film (package blockout-film): the scene maths, beats, prompts, shots, windows, plans, payloads and the API. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-blockout-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const cinema = await import("@/server/cinema");
const generateRoute = await import("@/app/api/cinema/projects/[id]/generate/route");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { getModel } = await import("@/lib/catalog");
const { buildPayload } = await import("@/lib/catalog/payload");
const { estimateCost } = await import("@/lib/catalog/plan");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { BLOCKOUT_FIRST, BLOCKOUT_MODELS, blockoutFramePrompt, blockoutPrompt, planCinema } = await import("@/lib/catalog/cinema");
const B = await import("@/lib/blockout");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const VIDEO = "/api/files/uploads/blockout.webm";
const DEPTH = "/api/files/uploads/blockout-depth.webm";
const FRAME = "/api/files/uploads/blockout-first.png";
const REFS: import("@/lib/blockout").BlockoutRef[] = [
  { url: "/api/files/uploads/interior.png", role: "interior" },
  { url: "/api/files/uploads/mara.png", role: "character", name: "Mara" },
  { url: "/api/files/uploads/exterior.png", role: "exterior" },
];
const exampleBeats = () => B.beatsFrom(B.EXAMPLE_SCENE.markers, B.EXAMPLE_SCENE.duration, B.EXAMPLE_WORDS);
const ctx = { cloudAllowed: true };
const film = (engine: "cloud" | "open", over: Partial<NonNullable<CinemaGenerateInput["blockout"]>> = {}, more: Partial<CinemaGenerateInput> = {}): CinemaGenerateInput => ({
  engine,
  mode: "video",
  action: "blockout",
  prompt: "",
  settings: {},
  blockout: { video: VIDEO, seconds: 8, beats: exampleBeats(), refs: REFS, style: "Low-key horror, cold torchlight, 35 mm film grain", sounds: ["Footsteps on concrete", "A long door creak"], avoid: ["jump cuts", "text on screen"], ...over },
  ...more,
});

describe("the scene", () => {
  it("moves a primitive in a line between its keys and holds before and after them", () => {
    const walker = B.EXAMPLE_SCENE.prims.find((p) => p.id === "walker")!;
    expect(B.primAt(walker, -1).position).toEqual([0, 0, -1]);
    expect(B.primAt(walker, 2.2).position[2]).toBeCloseTo(-5.3, 5);
    expect(B.primAt(walker, 99).position).toEqual([0, 0, -13.2]);
    expect(B.primSpeed(walker, 2)).toBeCloseTo(8.6 / 4.4, 2);
    expect(B.primSpeed(walker, 5)).toBeLessThan(0.2);
    const box = B.newPrim("box");
    expect(B.primAt(box, 3)).toEqual({ position: [0, 0, 0], rotation: 0 });
  });

  it("eases the camera between keys, zooms evenly in ratio and shakes the same way every render", () => {
    const keys: import("@/lib/blockout").BlockoutCameraKey[] = [
      { t: 0, position: [0, 1.6, 0], target: [0, 1.6, -5], lens: 24, shake: 0 },
      { t: 4, position: [0, 1.6, -4], target: [0, 1.6, -9], lens: 96, shake: 0 },
    ];
    const mid = B.cameraAt(keys, 2);
    expect(mid.position[2]).toBeCloseTo(-2, 6);
    expect(mid.lens).toBeCloseTo(48, 6);
    // Eased: a quarter of the time covers less than a quarter of the way.
    expect(-B.cameraAt(keys, 1).position[2]).toBeLessThan(1);
    const shaky = keys.map((k) => ({ ...k, shake: 1 }));
    const a = B.cameraAt(shaky, 1.3);
    expect(a).toEqual(B.cameraAt(shaky, 1.3));
    expect(Math.hypot(a.position[0], a.position[1] - 1.6)).toBeGreaterThan(0.001);
    expect(Math.abs(a.position[0])).toBeLessThan(0.05);
    expect(B.shakeAt(2, 0)).toEqual({ offset: [0, 0, 0], aim: [0, 0, 0] });
  });

  it("frames the lens like a full-frame camera and renders in even multiples of 16", () => {
    expect(B.lensVFov(24, 1.5)).toBeCloseTo(53.13, 1);
    expect(B.lensVFov(24, 16 / 9)).toBeLessThan(B.lensVFov(24, 1.5));
    expect(B.blockoutSize("16:9")).toEqual({ width: 1280, height: 720 });
    expect(B.blockoutSize("9:16", 832)).toEqual({ width: 464, height: 832 });
    expect(B.aspectOf("2.39:1")).toBeCloseTo(2.39);
    expect(B.aspectOf("nonsense")).toBeCloseTo(16 / 9);
  });

  it("makes a caller's scene safe: numbers in range, lists capped, a camera always there", () => {
    const s = B.normalizeScene({ duration: 999, prims: [{ kind: "box", position: [1e9, NaN, 2], size: [-2, 1, 1] }, { kind: "rocket" }], markers: [{ t: 80, label: "" }], camera: [] });
    expect(s.duration).toBe(B.BLOCKOUT.maxSeconds);
    expect(s.prims).toHaveLength(1);
    expect(s.prims[0].position).toEqual([500, 0, 2]);
    expect(s.prims[0].size).toEqual([2, 1, 1]);
    expect(s.camera).toEqual([B.DEFAULT_CAMERA]);
    expect(s.markers[0]).toMatchObject({ t: 60, label: "Beat 1" });
    expect(B.normalizeScene(B.EXAMPLE_SCENE)).toEqual(B.EXAMPLE_SCENE);
  });
});

describe("beats and the prompt", () => {
  it("turns markers into beats that run to the next marker, with an opening when the first is late", () => {
    expect(exampleBeats().map((b) => [b.label, b.start, b.end])).toEqual([
      ["Arrival", 0, 4.5],
      ["The door opens", 4.5, 6],
      ["Into the dark", 6, 8],
    ]);
    const late = B.beatsFrom([{ id: "x", t: 3, label: "Lights out" }], 10);
    expect(late.map((b) => [b.id, b.label, b.start, b.end])).toEqual([
      ["start", "Opening", 0, 3],
      ["x", "Lights out", 3, 10],
    ]);
    // A caller's beats: sorted, inside the blockout, each running to the next.
    expect(B.normalizeBeats([{ start: 5, label: "B" }, { start: 0, label: "A", words: "Hi" }], 8).map((b) => [b.label, b.start, b.end, b.words])).toEqual([
      ["A", 0, 5, "Hi"],
      ["B", 5, 8, ""],
    ]);
  });

  it("compiles Seedance's prompt in the workflow's structure, with @ tags matching the attached references", () => {
    const p = B.compileBlockoutPrompt({ beats: exampleBeats(), refs: REFS, target: "seedance", style: "Low-key horror", sound: true, audio: ["Footsteps"], avoid: ["text on screen"] });
    expect(p.split("\n\n").map((s) => s.split(":")[0])).toEqual(["Subject", "Action", "Camera", "Style", "Constraints", "Audio", "No"]);
    expect(p).toContain("@Video1 is a grey-box 3D blockout");
    expect(p).toContain("@Image1 is the interior");
    expect(p).toContain("@Image2 is Mara, the main character");
    expect(p).toContain("@Image3 is the exterior");
    expect(p).not.toContain("@Image4");
    expect(p).toContain("0.0–4.5s — Arrival: A woman walks slowly down the narrow corridor");
    expect(p).toContain("4.5–6.0s — The door opens: She stops.");
    expect(p).toContain("Follow @Video1 exactly");
    expect(p).toContain("Events happen in this order: Arrival, then The door opens, then Into the dark.");
    expect(p).toMatch(/Audio: Footsteps\./);
    expect(p).toMatch(/No: text on screen\./);
    // Sound off: no audio list.
    expect(B.compileBlockoutPrompt({ beats: exampleBeats(), refs: REFS, target: "seedance", audio: ["Footsteps"] })).not.toContain("Audio:");
    // A later shot names the hand-over frame.
    expect(B.compileBlockoutPrompt({ beats: exampleBeats(), refs: REFS, target: "seedance", previousFrame: 4 })).toContain("@Image4 is the last frame of the shot before");
  });

  it("writes H3 Max's scene intent without tags inside its 2000 characters, and a short prompt for Wan", () => {
    const long = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, start: i, end: i + 1, label: `Beat ${i}`, words: "x".repeat(300) }));
    const h3 = B.compileBlockoutPrompt({ beats: long, refs: REFS, target: "h3" });
    expect(h3.length).toBeLessThanOrEqual(B.H3_INTENT_MAX);
    expect(h3).not.toContain("@");
    expect(h3).toContain("Reference 2 is Mara");
    const open = B.compileBlockoutPrompt({ beats: exampleBeats(), refs: REFS, target: "open", style: "Low-key horror" });
    expect(open.length).toBeLessThanOrEqual(B.OPEN_PROMPT_MAX);
    expect(open).toMatch(/^Low-key horror\. Mara in the scene\. A woman walks/);
  });

  it("writes each reference's role for you, from where it came", () => {
    expect(B.roleFor({ category: "character" })).toBe("character");
    expect(B.roleFor({ category: "location" })).toBe("location");
    expect(B.roleFor({ category: "prop" })).toBe("prop");
    expect(B.roleFor(undefined)).toBe("location");
    for (const r of B.REF_ROLES) expect(B.roleSentence({ role: r.id }, "@Image1")).toMatch(/^@Image1 is /);
    expect(blockoutFramePrompt(REFS.slice(0, 2), "Cold light")).toContain("Picture 2 is the interior; picture 3 is the person the mannequin becomes (Mara). Cold light.");
  });

  it("clips beats to a shot and times them from its start", () => {
    expect(B.beatsIn(exampleBeats(), 4, 8).map((b) => [b.label, b.start, b.end])).toEqual([
      ["Arrival", 0, 0.5],
      ["The door opens", 0.5, 2],
      ["Into the dark", 2, 4],
    ]);
  });
});

describe("shots and windows", () => {
  it("cuts a long blockout at its markers, each shot within the model's limit", () => {
    expect(B.splitShots(28, [0, 7.8, 15, 22], 30)).toEqual([{ index: 0, start: 0, end: 28 }]);
    expect(B.splitShots(42, [0, 10, 24, 33], 30, 4)).toEqual([
      { index: 0, start: 0, end: 24 },
      { index: 1, start: 24, end: 42 },
    ]);
    // No marker in reach: cut at the limit, never leaving a sliver behind.
    expect(B.splitShots(31, [], 15, 4)).toEqual([
      { index: 0, start: 0, end: 15 },
      { index: 1, start: 15, end: 27 },
      { index: 2, start: 27, end: 31 },
    ]);
    expect(B.splitShots(16, [], 15, 4).map((s) => [s.start, s.end])).toEqual([
      [0, 12],
      [12, 16],
    ]);
  });

  it("lays 81-frame windows at 16 fps that hand over on a shared frame, each 4n+1 frames", () => {
    const w = B.depthWindows(8);
    expect(w.map((x) => [x.startFrame, x.frames])).toEqual([
      [0, 81],
      [80, 45],
    ]);
    expect(w[1].start).toBe(5);
    for (const x of B.depthWindows(37)) expect((x.frames - 1) % 4).toBe(0);
    expect(B.depthWindows(5).map((x) => x.frames)).toEqual([77]);
    expect(B.depthWindows(5.1).map((x) => x.frames)).toEqual([81]);
    expect(B.depthWindows(999)).toHaveLength(B.OPEN_MAX_WINDOWS);
    expect(B.windowsSeconds(B.depthWindows(8))).toBeCloseTo(125 / 16, 2);
  });
});

describe("planning a blockout", () => {
  it("cloud, Seedance 2.5: one reference-to-video call with the blockout as @Video1, the stills, sound on and the length", () => {
    const plan = planCinema(film("cloud"), ctx);
    expect(plan.blocker).toBeUndefined();
    expect(plan.model.id).toBe("seedance-2-5");
    expect(plan.steps).toHaveLength(1);
    const r = plan.steps[0].request;
    expect(r).toMatchObject({ feature: "cinema-blockout", modelId: "seedance-2-5", op: "ref2v", inputs: { videos: [VIDEO], images: REFS.map((x) => x.url) } });
    expect(r.params).toMatchObject({ duration: 8, resolution: "720p", aspectRatio: "auto", generateAudio: true });
    expect(r.prompt).toContain("@Image2 is Mara");
    expect(r.prompt).toMatch(/Audio: Footsteps on concrete; A long door creak\./);
    // Seedance 2.5 at 720p: 8 s × $0.473.
    expect(plan.costUsd).toBeCloseTo(8 * 0.473, 3);
    expect(plan.notes.join(" ")).toMatch(/reference video \(@Video1\).*sound on/);
  });

  it("cloud: an edited prompt is sent as written, and the prompt the composer shows is the one it would send", () => {
    expect(planCinema(film("cloud", {}, { prompt: "My own words" }), ctx).steps[0].request.prompt).toBe("My own words");
    expect(blockoutPrompt(film("cloud"))).toBe(planCinema(film("cloud"), ctx).steps[0].request.prompt);
    expect(blockoutPrompt(film("cloud", {}, { modelId: "minimax-h3-max-3d" }))).toBe(planCinema(film("cloud", {}, { modelId: "minimax-h3-max-3d" }), ctx).steps[0].request.prompt);
  });

  it("cloud: longer than 30 s it is cut at the markers into shots that hand over a frame, then joined", () => {
    const beats = [
      { start: 0, label: "Arrival", words: "She arrives." },
      { start: 14, label: "Lights out", words: "The lights die." },
      { start: 26, label: "Door kicked", words: "The door bursts open." },
    ];
    const plan = planCinema(film("cloud", { seconds: 40, beats }, { prompt: "edited" }), ctx);
    expect(plan.blocker).toBeUndefined();
    expect(plan.steps.map((s) => s.key)).toEqual(["cut0", "shot0", "last0", "cut1", "shot1", "join"]);
    const [cut0, shot0, , cut1, shot1, join] = plan.steps;
    expect(cut0.request).toMatchObject({ modelId: "trim-video", op: "trim", inputs: { video: VIDEO }, params: { startTime: 0, endTime: 26 } });
    expect(cut1.request.params).toMatchObject({ startTime: 26, endTime: 40 });
    expect(shot0.after).toEqual(["cut0"]);
    expect(shot0.request.chain).toEqual([{ slot: "videos", position: "first" }]);
    expect(shot0.request.params?.duration).toBe(26);
    expect(shot1.after).toEqual(["cut1", "last0"]);
    expect(shot1.request.chain).toEqual([
      { slot: "videos", position: "first" },
      { slot: "images", position: "last" },
    ]);
    // Three stills plus the hand-over frame: Seedance takes four.
    expect(shot1.request.inputs?.images).toEqual(REFS.map((x) => x.url));
    expect(shot1.request.prompt).toContain("@Image4 is the last frame of the shot before");
    expect(shot1.request.prompt).toContain("0.0–14.0s — Door kicked: The door bursts open.");
    expect(shot0.request.prompt).not.toBe("edited");
    expect(join.request).toMatchObject({ modelId: "join-clips", op: "concat" });
    expect(join.after).toEqual(["shot0", "shot1"]);
    expect(plan.notes.join(" ")).toMatch(/filmed as 2 shots cut at your markers \(0–26 s, 26–40 s\)/);
    expect(plan.costUsd).toBeGreaterThan(40 * 0.473 - 0.01);
  });

  it("cloud, H3 Max 3D to video: its own model, 15 s shots, up to 8 stills, no sound, and its processing fee in the price", () => {
    const plan = planCinema(film("cloud", { seconds: 12 }, { modelId: "minimax-h3-max-3d" }), ctx);
    expect(plan.model.id).toBe("minimax-h3-max-3d");
    const r = plan.steps[0].request;
    expect(r).toMatchObject({ op: "v2v", inputs: { video: VIDEO, images: REFS.map((x) => x.url) }, params: { resolution: "768P", duration: 12 } });
    expect(r.params?.generateAudio).toBeUndefined();
    expect(r.prompt).not.toContain("@");
    expect(plan.costUsd).toBeCloseTo(12 * 0.08 + 0.5, 3);
    expect(plan.notes.join(" ")).toMatch(/makes no sound/);
    // A 3 s shot bills 5 s.
    expect(planCinema(film("cloud", { seconds: 3 }, { modelId: "minimax-h3-max-3d" }), ctx).costUsd).toBeCloseTo(5 * 0.08 + 0.5, 3);
    const long = planCinema(film("cloud", { seconds: 20 }, { modelId: "minimax-h3-max-3d" }), ctx);
    expect(long.steps.filter((s) => s.key.startsWith("shot")).map((s) => s.request.params?.duration)).toEqual([6, 14]);
    expect(long.steps.find((s) => s.key === "shot1")!.request.chain).toEqual([
      { slot: "video", position: "first" },
      { slot: "images", position: "last" },
    ]);
  });

  it("open: the first frame from the references, then depth windows chained by their last frame and joined, free", () => {
    const plan = planCinema(film("open", { depth: DEPTH, firstFrame: FRAME }), ctx);
    expect(plan.blocker).toBeUndefined();
    expect(plan.model.id).toBe(BLOCKOUT_MODELS.open);
    expect(plan.costUsd).toBe(0);
    expect(plan.steps.map((s) => s.key)).toEqual(["look", "seg0", "win0", "last0", "seg1", "win1", "join"]);
    const step = (k: string) => plan.steps.find((s) => s.key === k)!;
    expect(step("look").request).toMatchObject({ modelId: "oss-qwen-edit", op: "edit", inputs: { images: [FRAME, REFS[0].url, REFS[1].url] } });
    expect(step("seg1").request).toMatchObject({ modelId: "oss-segment", op: "trim", inputs: { video: DEPTH }, params: { startTime: 5, endTime: 7.8125, fps: 16, resolution: "480p", aspectRatio: "16:9" } });
    expect(step("win0").after).toEqual(["seg0", "look"]);
    expect(step("win1").after).toEqual(["seg1", "last0"]);
    expect(step("win1").request).toMatchObject({ modelId: "oss-wan22-vace-blockout", op: "v2v", params: { duration: 45 / 16 }, chain: [{ slot: "video" }, { slot: "images", position: "first" }] });
    expect(step("win1").request.prompt).toContain("She stops.");
    expect(step("win1").request.prompt).not.toContain("walks slowly");
    expect(step("last0").request).toMatchObject({ modelId: "oss-extract-frame", op: "frame", chain: [{ slot: "video" }] });
    expect(step("join").request).toMatchObject({ modelId: "oss-join-encoded", op: "concat" });
    expect(plan.notes.join(" ")).toMatch(/not the dialogue or sound: add sound afterwards with Sound for video/);
  });

  it("open: an upload without depth reads it with Depth Anything 3 and cuts its own first frame", () => {
    const plan = planCinema(film("open", { seconds: 4 }), ctx);
    expect(plan.model.id).toBe(BLOCKOUT_MODELS.openNoDepth);
    expect(plan.steps.map((s) => s.key)).toEqual(["grab", "look", "seg0", "win0"]);
    expect(plan.steps[0].request).toMatchObject({ modelId: "oss-extract-frame", inputs: { video: VIDEO }, params: { startTime: 0, endTime: 0.5, extra: { frameIndex: 0 } } });
    expect(plan.steps[1]).toMatchObject({ after: ["grab"], request: { chain: [{ slot: "images", position: "first" }] } });
    expect(plan.steps[2].request.inputs).toEqual({ video: VIDEO });
    expect(plan.notes.join(" ")).toMatch(/Depth Anything 3/);
  });

  it("waits for a blockout, and prices the run before one is added", () => {
    const none = planCinema({ ...film("cloud"), blockout: undefined }, ctx);
    expect(none.blocker).toBe(BLOCKOUT_FIRST);
    const blank = planCinema(film("cloud", { video: "" }), ctx);
    expect(blank.blocker).toBe(BLOCKOUT_FIRST);
    expect(blank.costUsd).toBeGreaterThan(0);
    expect(planCinema(film("cloud", { seconds: 1 }), ctx).blocker).toMatch(/at least 2 s/);
  });
});

describe("the hosted models and the graph", () => {
  it("H3 Max 3D to video sends the blockout, the stills, the words and the quality, and nothing it doesn't take", () => {
    const m = getModel("minimax-h3-max-3d")!;
    expect(m.hidden).toBe(true);
    const route = m.routes[0];
    expect(route).toMatchObject({ op: "v2v", provider: "fal", endpoint: "minimax/h3-max/3d-to-video" });
    const body = buildPayload(route.map!, { prompt: "Scene", video: "https://fal.test/b.webm", images: ["https://fal.test/a.png"], resolution: "1080P", duration: 12 });
    expect(body).toEqual({ prompt: "Scene", video_url: "https://fal.test/b.webm", reference_image_urls: ["https://fal.test/a.png"], resolution: "1080P" });
    expect(estimateCost(m, { resolution: "1080P", duration: 10 }, 1, "v2v")).toBeCloseTo(2.1, 3);
  });

  it("Seedance 2.5's reference route takes the blockout as video_urls and the stills as image_urls", () => {
    const route = getModel("seedance-2-5")!.routes.find((r) => r.op === "ref2v")!;
    const body = buildPayload(route.map!, { prompt: "p", videos: ["https://fal.test/b.webm"], images: ["https://fal.test/a.png"], duration: 8, generateAudio: true, resolution: "720p", aspectRatio: "auto" });
    expect(body).toMatchObject({ video_urls: ["https://fal.test/b.webm"], image_urls: ["https://fal.test/a.png"], duration: "8", generate_audio: true });
  });

  it("the open graph is validated and binds the depth, the first frame, the words, the window's size and length", async () => {
    const manifest = JSON.parse(fs.readFileSync("workflows/comfyui/manifest.json", "utf8")) as { workflows: { id: string; validated?: boolean; customNodes: unknown[]; license: string }[] };
    const w = manifest.workflows.find((x) => x.id === "video-blockout-wan22-fun-vace")!;
    expect(w.validated).toBe(true);
    expect(w.customNodes).toEqual([]);
    expect(w.license).toMatch(/Apache-2.0/);
    const { workflow } = await prepareWorkflow(
      "video-blockout-wan22-fun-vace",
      { prompt: "She walks", images: ["first.png"], video: "depth.webm", aspectRatio: "16:9", resolution: "480p", duration: 81 / 16, seed: 3 },
      { generationId: "gen-b", op: "v2v", upload: async (_d, _t, name) => name },
    );
    expect(workflow["1"].inputs.file).toBe("depth.webm");
    expect(workflow["4"].inputs.image).toBe("first.png");
    expect(workflow["12"].inputs.text).toBe("She walks");
    expect([workflow["15"].inputs.width, workflow["15"].inputs.height]).toEqual([848, 480]);
    expect(workflow["30"].inputs.value).toBe(81);
    expect(workflow["32"].inputs.image).toEqual(["3", 0]);
    expect(workflow["26"].inputs.audio).toBeUndefined();
    expect(Object.values(workflow).some((n) => /^DA3/.test(n.class_type))).toBe(false);
  });
});

const json = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const upload = (name: string, type = "image/png") => saveFile({ data: encodePng({ width: 32, height: 18, data: Buffer.alloc(32 * 18 * 4, 128) }), contentType: type, name, source: "upload" }).url;

describe("Cinema API: a blockout in demo mode", () => {
  it("files the film as a take that remembers the blockout's length, parts and beats", async () => {
    const p = cinema.createProject({ name: "Blockouts" });
    const video = upload("blockout.png");
    const still = upload("interior.png");
    const input = film("cloud", { video, refs: [{ url: still, role: "interior" }] });
    const res = await generateRoute.POST(json({ input }), params(p.id));
    expect(res.status).toBe(201);
    const out = (await res.json()) as { items: { id: string; feature: string }[]; plan: { modelId: string } };
    expect(out.plan.modelId).toBe("seedance-2-5");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].feature).toBe("cinema-blockout");
    const items = cinema.listItems(p.id);
    expect(items[0].take).toMatchObject({ action: "blockout", blockout: { seconds: 8, parts: 1, beats: ["Arrival", "The door opens", "Into the dark"] } });
    expect(gens.getGeneration(out.items[0].id)!.provider).toBe("mock");
  });

  it("refuses a blockout from outside Fuobe's files, and one past 60 s", async () => {
    const p = cinema.createProject({ name: "Bad" });
    for (const bad of [{ video: "https://evil.test/x.mp4" }, { seconds: 61 }, { refs: [{ url: "/api/files/x.png", role: "villain" }] }]) {
      const res = await generateRoute.POST(json({ input: film("cloud", bad as never) }), params(p.id));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });
});
