import { describe, expect, it, vi } from "vitest";
import { getMaker, planGenjutsu } from "@/lib/catalog/genjutsu";
import { danglingLinks, OPENJUTSU_WORKFLOWS as W } from "@/lib/openjutsu-graphs";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";
import { tempDir } from "./helpers/temp-dir";

// The comfyui provider driving Genjutsu's Openjutsu graphs: the media bound, the settings written by title, the pictures
// a request leaves out taken out with their branches, and a Context Loop job's run folder deleted once it ends.
const tmp = tempDir("fuobe-genjutsu-oj-comfy-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow, deleteRunFolder } = await import("@/server/providers/comfyui");

const clip: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: true, duration: 6, videoDuration: 6, width: 1308, height: 736, fps: 24, frames: 144 };
const prepare = (id: string, input: Partial<GenInput>, op: Operation) =>
  prepareWorkflow(id, { video: "part.mp4", ...input } as GenInput, { generationId: "gen42", op, upload: async (_d, _t, name) => `up_${name}`, media: (n) => (n === "part.mp4" ? clip : undefined) });
type Wf = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;
const titled = (wf: Wf, t: string) => Object.values(wf).find((n) => n._meta?.title === t);

describe("Genjutsu's Openjutsu graphs through the provider", () => {
  it("Group swap: two characters bound, the other pictures gone, the roles, quality and the job's own run name", async () => {
    const { manifest, workflow } = await prepare(
      W.group,
      { images: ["a.png", "b.png"], seed: 11, extra: { openjutsu: { pictures: 2, roles: ["the person on the left", "the person on the right"], quality: "720p", edge: "tight" } } },
      "group-swap",
    );
    const wf = workflow as Wf;
    expect(manifest.id).toBe(W.group);
    expect(titled(wf, "Picture 1")!.inputs.image).toBe("a.png");
    expect(titled(wf, "Picture 2")!.inputs.image).toBe("b.png");
    expect(titled(wf, "Picture 3")).toBeUndefined();
    expect(titled(wf, "Source video (people get replaced)")!.inputs.video).toBe("part.mp4");
    expect(titled(wf, "Swap Plan (roles, seed, size)")!.inputs).toMatchObject({ roles: "the person on the left\nthe person on the right", resolution: "736p", seed: 11 });
    expect(Object.values(wf).find((n) => n.class_type === "MiniMaxH3ChainPlanModern")!.inputs.run_name).toBe("fuobe_gen42");
    expect(danglingLinks(workflow)).toEqual([]);
  });

  it("one by one runs its own graph; a character missing is refused in words", async () => {
    const { manifest } = await prepare(W.group, { images: ["a.png", "b.png"], extra: { openjutsu: { pictures: 2, onePerPerson: true } } }, "group-swap");
    expect(manifest.id).toBe(W.groupOneByOne);
    await expect(prepare(W.group, { images: ["a.png"], extra: { openjutsu: { pictures: 2 } } }, "group-swap")).rejects.toThrow();
  });

  it("Scene edit: remove takes no picture; background flips the mask", async () => {
    const r = (await prepare(W.scene, { extra: { openjutsu: { action: "remove", target: "the handbag" } } }, "scene-edit")).workflow as Wf;
    expect(titled(r, "Picture 1")).toBeUndefined();
    expect(titled(r, "Object Swap Plan (what to change)")!.inputs).toMatchObject({ mode: "remove", target: "the handbag" });
    const b = (await prepare(W.scene, { images: ["place.png"], extra: { openjutsu: { action: "background", target: "the people", becomes: "an Amalfi terrace", picture: true } } }, "scene-edit")).workflow as Wf;
    expect(titled(b, "Picture 1")!.inputs.image).toBe("place.png");
    expect(titled(b, "Grow mask")!.inputs.flip_input).toBe(true);
  });

  it("From picture: the first frame at the part's start, the clip's own person without a picture; the video from the approved frame", async () => {
    const f = (await prepare(W.prepare, { images: ["me.png"], startTime: 2, extra: { openjutsu: { light: "" } } }, "picture-frame")).workflow as Wf;
    expect(f["1"].inputs).toMatchObject({ video: "part.mp4", skip_first_frames: 48 });
    expect(f["4"].inputs.image).toBe("me.png");
    const own = (await prepare(W.prepare, { startTime: 0, extra: { openjutsu: { light: "Light the new photo with a warm golden glow.", ownPerson: true } } }, "picture-frame")).workflow as Wf;
    expect(own["4"]).toBeUndefined();
    const v = await prepare(W.solar, { images: ["frame.png"], extra: { openjutsu: { seconds: 6, quality: "480p", scene: "She turns." } } }, "picture-video");
    expect((v.workflow as Wf)["20"].inputs.image).toBe("frame.png");
    expect((v.workflow as Wf)["56"].inputs).toMatchObject({ length: 141 });
    expect((await prepare(W.solar, { images: ["frame.png"], extra: { openjutsu: { seconds: 6, renderer: "h3" } } }, "picture-video")).manifest.id).toBe(W.h3);
    const d = (await prepare(W.describe, { images: ["frame.png"], startTime: 1, extra: { openjutsu: { seconds: 6 } } }, "describe-video")).workflow as Wf;
    expect(d["1"].inputs).toMatchObject({ skip_first_frames: 24, frame_load_cap: 141 });
  });

  it("Finish: faces with the photo, colours with its finish", async () => {
    const faces = (await prepare(W.faces, { images: ["face.png"], extra: { openjutsu: { faceStyle: "photo", chunkSeconds: 10 } } }, "face-fix-video")).workflow as Wf;
    expect(titled(faces, "Picture 1")!.inputs.image).toBe("face.png");
    expect(titled(faces, "Face Fix Chunks")!.inputs.chunk_seconds).toBe(10);
    const colours = (await prepare(W.colours, { extra: { openjutsu: { finish: "off", soften: 0 } } }, "tone-video")).workflow as Wf;
    expect(Object.values(colours).map((n) => n.class_type).sort()).toEqual(["VHS_BatchManager", "VHS_LoadVideoFFmpeg", "VHS_VideoCombine"]);
  });

  it("Fix colours goes through in passes; Fix faces refuses a clip bigger than the server can hold", async () => {
    // Fix colours: every pass holds about 1.5 GB of frames (three copies), whatever the clip's length.
    const p = await prepare(W.colours, { extra: { openjutsu: { finish: "soft" } } }, "tone-video");
    const wf = p.workflow as Wf;
    const [managerId, manager] = Object.entries(wf).find(([, n]) => n.class_type === "VHS_BatchManager")!;
    expect(manager.inputs.frames_per_batch).toBe(Math.floor((1.5 * 2 ** 30) / (12 * 1308 * 736 * 3)));
    expect(manager.inputs.job).toBe("gen42");
    for (const n of Object.values(wf)) if (n.class_type === "VHS_LoadVideo" || n.class_type === "VHS_VideoCombine") expect(n.inputs.meta_batch).toEqual([managerId, 0]);
    expect(p.meta).toMatchObject({ metaBatch: true });
    // Fix faces holds the whole clip twice: on a 16 GB server, 1080p for 30 s is refused in words.
    const big: MediaInfo = { ...clip, duration: 30, videoDuration: 30, width: 1920, height: 1080, frames: 720 };
    await expect(
      prepareWorkflow(W.faces, { video: "big.mp4", images: ["face.png"], extra: { openjutsu: {} } } as GenInput, {
        generationId: "gen43",
        op: "face-fix-video",
        upload: async (_d, _t, name) => `up_${name}`,
        media: (n) => (n === "big.mp4" ? big : undefined),
        serverRam: async () => 16 * 2 ** 30,
      }),
    ).rejects.toThrow(/Fix faces holds the whole clip in memory/);
  });

  it("a planned Group swap is what the graph is given (after its part is fitted)", async () => {
    const p = planGenjutsu({
      engine: "open",
      mode: "character",
      maker: getMaker("oss-h3-group-swap", "open")!,
      title: "Genjutsu",
      source: { url: "/api/files/c.mp4", duration: 10, fps: 30, width: 1920, height: 1080, hasAudio: true },
      range: { start: 0, end: 6 },
      quality: "480p",
      references: ["/api/files/a.png", "/api/files/b.png"],
      character: { people: [{ role: "the dancer" }, { role: "" }] },
    });
    const s = p.steps.find((x) => x.key === "swap")!.request;
    const { workflow } = await prepare(W.group, { images: ["a.png", "b.png"], extra: s.params!.extra as Record<string, unknown> }, s.op!);
    expect(titled(workflow as Wf, "Swap Plan (roles, seed, size)")!.inputs).toMatchObject({ roles: "the dancer\nthe person with the second most screen time", resolution: "480p" });
  });

  it("a Context Loop job's run folder is deleted through the pack's own routes (preview, then delete with its snapshot)", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/delete-preview")) return new Response(JSON.stringify({ ok: true, snapshot: "a".repeat(64) }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    try {
      expect(await deleteRunFolder("fuobe_gen42")).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
    expect(calls.map((c) => c.url.replace("http://comfy.test:8188", ""))).toEqual(["/minimax_h3_context_loop/run-folder/delete-preview", "/minimax_h3_context_loop/run-folder/delete"]);
    expect(calls[1].body).toEqual({ run_name: "fuobe_gen42", snapshot: "a".repeat(64), confirmation: "fuobe_gen42" });
  });
});
