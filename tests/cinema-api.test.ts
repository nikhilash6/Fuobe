import { beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

const dir = tempDir("fuobe-cinema-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
// No LLM in tests: the AI Director answers offline.
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const cinema = await import("@/server/cinema");
const { cinemaContext, generateInProject, swatchUrl } = await import("@/server/cinema-generate");
const { askDirector, ideaOf, offlineDirector, parseDirectorAnswer } = await import("@/server/cinema-director");
const projectsRoute = await import("@/app/api/cinema/projects/route");
const projectRoute = await import("@/app/api/cinema/projects/[id]/route");
const foldersRoute = await import("@/app/api/cinema/projects/[id]/folders/route");
const folderRoute = await import("@/app/api/cinema/projects/[id]/folders/[folderId]/route");
const itemsRoute = await import("@/app/api/cinema/projects/[id]/items/route");
const generateRoute = await import("@/app/api/cinema/projects/[id]/generate/route");
const tilesRoute = await import("@/app/api/cinema/projects/[id]/items/[generationId]/tiles/route");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});

const json = (method: string, body?: unknown) =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function settle(id: string, ms = 40_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const VIDEO = {
  engine: "cloud" as const,
  mode: "video" as const,
  action: "generate" as const,
  prompt: "A detective lights a match in the rain",
  moves: ["dolly-in", "whip-pan"],
  duration: 5,
  aspectRatio: "16:9",
  batch: 1,
};

describe("Cinema API", () => {
  it("creates, lists and updates a project (Director settings and brief persist)", async () => {
    const res = await projectsRoute.POST(json("POST", { name: "Night Shift", description: "A neo-noir short" }));
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p).toMatchObject({ name: "Night Shift", description: "A neo-noir short", director: {}, brief: { title: "", body: "" } });
    expect((await projectsRoute.POST(json("POST", { name: "" }))).status).toBe(400);
    expect((await projectsRoute.POST(json("POST", { name: "x", description: "a".repeat(141) }))).status).toBe(400);

    const patch = await projectRoute.PATCH(
      json("PATCH", { director: { genre: "noir", palette: { kind: "preset", slug: "neon-rain-at-midnight" } }, brief: { body: "Rain, neon, regret." }, costCapUsd: 5 }),
      params({ id: p.id }),
    );
    expect(patch.status).toBe(200);
    const again = cinema.getProject(p.id)!;
    expect(again.director).toEqual({ genre: "noir", palette: { kind: "preset", slug: "neon-rain-at-midnight" } });
    expect(again.brief.body).toBe("Rain, neon, regret.");
    expect(again.costCapUsd).toBe(5);
    expect(cinema.listProjects().map((x) => x.name)).toContain("Night Shift");
    expect((await projectRoute.PATCH(json("PATCH", { director: { palette: { kind: "custom", name: "x", hex: ["red"] } } }), params({ id: p.id }))).status).toBe(400);
    expect((await projectRoute.PATCH(json("PATCH", { name: "y" }), params({ id: "nope" }))).status).toBe(404);
  });

  it("nests folders, refuses a move into its own subfolder and moves contents up on delete", async () => {
    const p = cinema.createProject({ name: "Folders" });
    const scene = await (await foldersRoute.POST(json("POST", { name: "Scene 1", color: "#c86058" }), params({ id: p.id }))).json();
    const take = await (await foldersRoute.POST(json("POST", { name: "Takes", parentId: scene.id }), params({ id: p.id }))).json();
    expect(take.parentId).toBe(scene.id);
    const bad = await folderRoute.PATCH(json("PATCH", { parentId: take.id }), params({ id: p.id, folderId: scene.id }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Cannot move into a subfolder");
    const pinned = await (await folderRoute.PATCH(json("PATCH", { pinned: true, name: "Opening" }), params({ id: p.id, folderId: scene.id }))).json();
    expect(pinned).toMatchObject({ pinned: true, name: "Opening", color: "#c86058" });

    const g = gens.createGenerations({ feature: "cinema", modelId: "nano-banana-pro", prompt: "a still" })[0];
    cinema.addItems(p.id, [g.id], take.id);
    expect(cinema.listItems(p.id, { folderId: scene.id }).length).toBe(0);
    expect(cinema.listItems(p.id, { folderId: scene.id, nested: true }).map((x) => x.id)).toEqual([g.id]);
    expect((await folderRoute.DELETE(json("DELETE"), params({ id: p.id, folderId: take.id }))).status).toBe(204);
    expect(cinema.listItems(p.id, { folderId: scene.id }).map((x) => x.folderId)).toEqual([scene.id]);

    // Bulk move to the root, like, then delete from the library.
    expect((await itemsRoute.PATCH(json("PATCH", { ids: [g.id], folderId: null, favorite: true }), params({ id: p.id }))).status).toBe(200);
    expect(cinema.listItems(p.id, { folderId: null })[0]).toMatchObject({ id: g.id, folderId: null, favorite: true });
    expect(cinema.listItems(p.id, { favorites: true })).toHaveLength(1);
    expect((await (await itemsRoute.DELETE(json("DELETE", { ids: [g.id], deleteGenerations: true }), params({ id: p.id }))).json()).removed).toBe(1);
    expect(gens.getGeneration(g.id)).toBeNull();
  });

  it("generates in demo mode and records the take in the folder it was made in", async () => {
    const p = cinema.createProject({ name: "Demo run" });
    cinema.updateProject(p.id, { brief: { body: "Rain, neon, regret." } });
    const folder = cinema.createFolder(p.id, { name: "Scene 2" });
    const res = await generateRoute.POST(json("POST", { input: { ...VIDEO, settings: { genre: "noir", focal: "50mm" } }, folderId: folder.id }), params({ id: p.id }));
    expect(res.status).toBe(201);
    const { items, plan } = await res.json();
    // Fuobe Cinema (LTX-2.3 in the cloud) with the Director compiled into the prompt; no Higgsfield anywhere.
    expect(plan.modelId).toBe("fuobe-cinema");
    expect(items).toHaveLength(1);
    const g = gens.getGeneration(items[0].id)!;
    expect(g.prompt).toMatch(/^Project brief: Rain, neon, regret\. A detective lights a match in the rain\. Noir film/);
    expect(g.prompt).toMatch(/50mm focal length/);
    expect(cinema.listItems(p.id, { folderId: folder.id }).map((x) => x.id)).toEqual([g.id]);
    expect((await settle(g.id)).status).toBe("succeeded");

    const bad = await generateRoute.POST(json("POST", { input: { ...VIDEO, prompt: "" } }), params({ id: p.id }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toBe("Describe your scene first");
    const still = await generateRoute.POST(json("POST", { input: { ...VIDEO, mode: "image", settings: {} } }), params({ id: p.id }));
    expect((await still.json()).error).toMatch(/Camera settings are required/);
  }, 60_000);

  it("open engine: a palette-lock step waits for each take and gets the palette swatch", async () => {
    const p = cinema.createProject({ name: "Open run" });
    const { items } = generateInProject(p.id, { ...VIDEO, engine: "open", batch: 2, settings: { palette: { kind: "preset", slug: "the-circus" } } });
    expect(items.map((g) => g.modelId)).toEqual(["fuobe-cinema", "fuobe-cinema", "oss-palette-video", "oss-palette-video"]);
    // The Original runs on the engine asked for: Wan 2.2 Lightning on the user's GPU (a demo here).
    expect(items[0].request.engine).toBe("open");
    const lock = items[2];
    expect(lock.request.inputs?.images?.[0]).toBe(swatchUrl(["#090a0b", "#900304", "#1d5768", "#58554a", "#8e5917", "#627163", "#979d7e", "#7daca6", "#7f907d", "#add3c0", "#ccebd8", "#b70204"]));
    const done = await settle(lock.id, 50_000);
    expect(done.status).toBe("succeeded");
    expect(done.request.inputs?.video).toBe(gens.getGeneration(items[0].id)!.outputs[0].url);
    expect(cinema.listItems(p.id)).toHaveLength(4);
  }, 70_000);

  it("a 30 s take on Fuobe Cinema is one take plus an extend that waits for it (demo mode, no keys)", async () => {
    const p = cinema.createProject({ name: "Long take" });
    const { items, plan } = generateInProject(p.id, { ...VIDEO, duration: 30 });
    expect(plan.modelId).toBe("fuobe-cinema");
    expect(items.map((g) => [g.modelId, g.op])).toEqual([
      ["fuobe-cinema", "t2v"],
      ["fuobe-cinema", "extend"],
    ]);
    expect(items[0].request.params).toMatchObject({ duration: 20, extra: { camera_lora: "dolly_in" } });
    expect(items[1].request.params).toMatchObject({ duration: 10, extra: { camera_lora: "dolly_in" } });
    const more = await settle(items[1].id, 50_000);
    expect(more.status).toBe("succeeded");
    expect(more.request.inputs?.video).toBe(gens.getGeneration(items[0].id)!.outputs[0].url);
    expect(cinema.listItems(p.id)).toHaveLength(2);
  }, 70_000);

  it("Soul Cast and Soul Location run on Fuobe Soul with a look; a location's other view on the Multiple-Angles model", async () => {
    const p = cinema.createProject({ name: "Builders" });
    const cast = generateInProject(p.id, { engine: "cloud", mode: "image", action: "cast", prompt: "", cast: { genre: "Western", gender: "Female", age: 35 }, batch: 1 });
    expect(cast.items[0]).toMatchObject({ modelId: "fuobe-soul", presetId: "v1-realistic" });
    const loc = generateInProject(p.id, { engine: "cloud", mode: "image", action: "location", prompt: "an abandoned diner on Route 66", batch: 1 });
    expect(loc.items[0]).toMatchObject({ modelId: "fuobe-soul", presetId: "v1-movie" });
    const still = await settle(loc.items[0].id);
    expect(still.status).toBe("succeeded");
    const view = generateInProject(p.id, { engine: "cloud", mode: "image", action: "location-view", view: "reverse", prompt: "", source: { url: still.outputs[0].url, kind: "image" } });
    expect(view.items[0]).toMatchObject({ modelId: "qwen-multiple-angles", op: "edit" });
    expect(view.items[0].request.params?.extra).toMatchObject({ horizontal_angle: 180 });
    expect((await settle(view.items[0].id)).status).toBe("succeeded");
  }, 70_000);

  it("refuses a run that would pass the project's cost cap", () => {
    const p = cinema.createProject({ name: "Capped", costCapUsd: 0.5 });
    // Demo mode runs are free, so the guard only bites on real (paid) routes; previewing with a fake key shows the message.
    setSetting("falKey", "test-key");
    try {
      // 20 s on Fuobe Cinema at 720p 16:9 is about $0.70 (1280 × 704 × 481 frames at $0.001605 per megapixel).
      expect(() => generateInProject(p.id, { ...VIDEO, duration: 20 })).toThrow(/past its \$0\.50 limit/);
    } finally {
      setSetting("falKey", "");
    }
  });

  it("an edit carries the take's facts through the API: its model picks the editor, its length prices it", async () => {
    const p = cinema.createProject({ name: "Edits" });
    const src = gens.createGenerations({ feature: "cinema", modelId: "seedance-2-5", prompt: "source take", params: { duration: 5 } })[0];
    const take = await settle(src.id);
    const source = { url: take.outputs[0].url, kind: "video", modelId: "seedance-2-5", prompt: "A detective lights a match in the rain", seconds: 5.04, resolution: "720p", aspectRatio: "16:9" };
    // A Seedance take is edited with Kling O3, whatever the menu says.
    const partner = await generateRoute.POST(json("POST", { input: { ...VIDEO, action: "edit", prompt: "make it snow", source } }), params({ id: p.id }));
    expect(partner.status).toBe(201);
    const pj = await partner.json();
    expect(pj.plan.modelId).toBe("kling-o3");
    // A Fuobe Cinema take: LTX-2.3 video-to-video with the take's scene, the take held and its sound kept.
    const own = await generateRoute.POST(json("POST", { input: { ...VIDEO, action: "edit", prompt: "make it snow", source: { ...source, modelId: "fuobe-cinema" } } }), params({ id: p.id }));
    expect(own.status).toBe(201);
    const oj = await own.json();
    expect(oj.plan.modelId).toBe("fuobe-cinema");
    const g = gens.getGeneration(oj.items[0].id)!;
    expect(g.op).toBe("v2v");
    expect(g.prompt).toMatch(/^A detective lights a match in the rain\. The same shot with one change: make it snow\./);
    expect(g.request.params?.extra).toMatchObject({ video_strength: 0.5, audio_strength: 1 });
    expect((await settle(g.id)).status).toBe("succeeded");
    // Facts out of range are refused rather than trusted.
    const bad = await generateRoute.POST(json("POST", { input: { ...VIDEO, action: "edit", prompt: "x", source: { ...source, seconds: -1 } } }), params({ id: p.id }));
    expect(bad.status).toBe(400);
    // The planner (and the project page's context) knows whether a civitai key is set: cloud moves whose LoRA downloads
    // from civitai need one.
    expect(cinemaContext()).toMatchObject({ cloudAllowed: true, civitai: false });
    setSetting("civitaiKey", "test-key");
    try {
      expect(cinemaContext().civitai).toBe(true);
    } finally {
      setSetting("civitaiKey", "");
    }
  }, 60_000);

  it("extend backward chains first frame → the moment before → a clip ending on it", async () => {
    const p = cinema.createProject({ name: "Prequel" });
    const src = gens.createGenerations({ feature: "cinema", modelId: "seedance-2-5", prompt: "source take", params: { duration: 5 } })[0];
    const take = await settle(src.id);
    // Fuobe Cinema extends the take backward in one LTX-2.3 call.
    const one = generateInProject(p.id, { ...VIDEO, action: "extend-backward", prompt: "he walks up to the door", source: { url: take.outputs[0].url, kind: "video" } });
    expect(one.items.map((g) => [g.modelId, g.op])).toEqual([["fuobe-cinema", "extend"]]);
    expect(one.items[0].request.params?.extra).toMatchObject({ extend_direction: "backward" });
    // A partner model's prequel is the three-step chain.
    const { items } = generateInProject(p.id, { ...VIDEO, modelId: "seedance-2-5", action: "extend-backward", prompt: "he walks up to the door", source: { url: take.outputs[0].url, kind: "video" } });
    expect(items.map((g) => g.op)).toEqual(["frame", "edit", "flf2v"]);
    const film = await settle(items[2].id, 60_000);
    expect(film.status).toBe("succeeded");
    expect(film.request.inputs?.endImage).toBe(gens.getGeneration(items[0].id)!.outputs[0].url);
    expect(film.request.inputs?.images?.[0]).toBe(gens.getGeneration(items[1].id)!.outputs[0].url);
  }, 90_000);

  it("retries a canceled take in the same folder, with the same request", async () => {
    const p = cinema.createProject({ name: "Retry" });
    const folder = cinema.createFolder(p.id, { name: "Scene 9" });
    const { items } = generateInProject(p.id, { ...VIDEO, engine: "open", moves: ["pan-left"], images: [] }, folder.id);
    await gens.cancelGeneration(items[0].id);
    const again = cinema.retryItem(p.id, items[0].id);
    expect(again).toHaveLength(1);
    expect(again[0].request.prompt).toBe(items[0].request.prompt);
    expect(cinema.listItems(p.id, { folderId: folder.id }).map((g) => g.id)).toContain(again[0].id);
    expect(cinema.listItems(p.id, { folderId: folder.id }).find((g) => g.id === again[0].id)?.take?.moves).toEqual(["pan-left"]);
    expect(() => cinema.retryItem(p.id, "missing")).toThrow(/isn't in this project/);
  });

  it("stores the tiles cut from a grid sheet", async () => {
    const p = cinema.createProject({ name: "Grid" });
    const { items } = generateInProject(p.id, { ...VIDEO, mode: "image", action: "grid", grid: { size: "2x2", type: "shots" } });
    expect(items[0].prompt).toMatch(/2×2 grid of 4/);
    const tiles = [0, 1, 2, 3].map((i) => ({ url: `/api/files/uploads/t${i}.png`, row: Math.floor(i / 2), col: i % 2 }));
    expect((await tilesRoute.PUT(json("PUT", { tiles }), params({ id: p.id, generationId: items[0].id }))).status).toBe(200);
    expect(cinema.listItems(p.id)[0].tiles).toEqual(tiles);
    expect((await tilesRoute.PUT(json("PUT", { tiles }), params({ id: p.id, generationId: "missing" }))).status).toBe(404);
  });
});

describe("AI Director", () => {
  it("breaks an idea into shots offline and keeps the conversation", async () => {
    const p = cinema.createProject({ name: "Director" });
    const messages = await askDirector(p.id, "Generate an 8-shot storyboard for a sci-fi chase scene through a neon city at night");
    expect(messages).toHaveLength(2);
    const reply = messages[1];
    expect(reply.source).toBe("offline");
    expect(reply.shots).toHaveLength(8);
    expect(reply.shots![0].settings).toMatchObject({ genre: "action", tempo: "chaotic", lighting: { kind: "preset", slug: "practicals" } });
    expect(reply.shots!.every((s) => s.moves.length > 0 && s.prompt.length > 10)).toBe(true);
    expect(cinema.getChat(p.id)).toHaveLength(2);

    const script = offlineDirector("She opens the letter.\nHer hands shake.\nShe looks out the window at the rain.", { brief: { title: "", body: "" }, director: { camera: "35mm-film" } });
    expect(script.shots.map((s) => s.prompt)).toEqual(["Wide establishing shot: She opens the letter", "Medium shot: Her hands shake", "Close-up: She looks out the window at the rain"]);
    expect(script.shots[0].settings.camera).toBe("35mm-film");
    expect(offlineDirector("Write a project brief for a perfume commercial", { brief: { title: "", body: "" }, director: {} }).brief).toMatch(/^Context: /);

    // A one-line idea gets a shot structure around it; a bare "write a script" asks what the film is about.
    expect(ideaOf("Generate an 8-shot storyboard for a sci-fi chase scene through a neon city at night")).toBe("a sci-fi chase scene through a neon city at night");
    const ad = offlineDirector("Create a 15-second cinematic perfume commercial", { brief: { title: "", body: "" }, director: {} });
    expect(ad.shots.map((s) => s.prompt)).toEqual([
      "Wide establishing shot: cinematic perfume commercial, the world of the product, setting the mood",
      "Medium shot: cinematic perfume commercial, the hero finds it",
      "Close-up: cinematic perfume commercial, the product up close, light catching every surface",
      "Wide closing shot: cinematic perfume commercial, the final hero shot, product centred, room for the logo",
    ]);
    expect(ad.shots.every((s) => s.duration === 4 && s.settings.tempo === "dynamic")).toBe(true);
    const ask = offlineDirector("Write a script", { brief: { title: "", body: "" }, director: {} });
    expect(ask.shots).toEqual([]);
    expect(ask.reply).toMatch(/What's the film about/);
  });

  it("parses an LLM answer and drops values the panel doesn't know", () => {
    const a = parseDirectorAnswer(
      'Sure!\n```json\n{"reply":"Two shots.","shots":[{"title":"Open","prompt":"Wide of the harbour","duration":45,"moves":["drone-orbit","spin"],"settings":{"genre":"noir","era":"1890s","lighting":"window","palette":"the-circus"}},{"title":"x"}]}\n```',
    )!;
    expect(a.reply).toBe("Two shots.");
    expect(a.shots).toHaveLength(1);
    expect(a.shots[0]).toEqual({ title: "Open", prompt: "Wide of the harbour", duration: 30, moves: ["drone-orbit"], settings: { genre: "noir", lighting: { kind: "preset", slug: "window" }, palette: { kind: "preset", slug: "the-circus" } } });
    expect(parseDirectorAnswer("no json here")).toBeNull();
  });
});
