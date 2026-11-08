import { describe, expect, it, vi } from "vitest";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { ComfyWorkflow } from "@/lib/comfy";
import { dropVhsAudio, silenceVhsAudio } from "@/lib/comfy";
import { composeWorkflow, type ComposeCatalog } from "@/lib/comfy-compose";
import type { MediaInfo } from "@/lib/media-probe";
import { OPENJUTSU_WORKFLOWS } from "@/lib/openjutsu-graphs";

/**
 * A clip without sound on the Openjutsu graphs (Group swap, one by one too, Scene edit, From picture, Motion transfer,
 * Fix faces, Fix colours): VHS_LoadVideo stops with "failed to extract audio" once its sound output is read, so the
 * composed graph never reads it. Nodes that need sound get silence and the result is silent; a clip with sound keeps it.
 */

vi.setConfig({ testTimeout: 60_000 });

const { loadManifest, getWorkflow } = await import("@/server/providers/comfyui");
const catalog: ComposeCatalog = { has: (id) => loadManifest().workflows.some((w) => w.id === id), get: getWorkflow };

const clipFacts = (hasAudio: boolean): MediaInfo => ({
  container: "mp4",
  duration: 7.5,
  videoDuration: 7.5,
  width: 1280,
  height: 720,
  fps: 24,
  frames: 180,
  hasVideo: true,
  hasAudio,
  ...(hasAudio && { channels: 2 }),
});
const PICTURE: MediaInfo = { container: "image", width: 1024, height: 1024, hasVideo: false, hasAudio: false };

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";
const vhsLoaders = (wf: ComfyWorkflow) => Object.keys(wf).filter((id) => wf[id].class_type === "VHS_LoadVideo" || wf[id].class_type === "VHS_LoadVideoFFmpeg");
/** Every input that reads a VHS loader's sound (output 2). */
const soundReads = (wf: ComfyWorkflow) => {
  const loaders = new Set(vhsLoaders(wf));
  return Object.entries(wf).flatMap(([id, n]) =>
    Object.entries(n.inputs)
      .filter(([, v]) => isLink(v) && loaders.has(v[0]) && v[1] === 2)
      .map(([input]) => `${n.class_type}.${input} (${id})`),
  );
};
const dangling = (wf: ComfyWorkflow) => Object.entries(wf).flatMap(([id, n]) => Object.entries(n.inputs).filter(([, v]) => isLink(v) && !wf[v[0]]).map(([k]) => `${id}.${k}`));

/** The run Genjutsu sends for each graph that loads the clip with VHS. */
const RUNS: { id: string; op: Operation; pictures: number; openjutsu: Record<string, unknown> }[] = [
  { id: OPENJUTSU_WORKFLOWS.group, op: "group-swap", pictures: 1, openjutsu: { pictures: 1 } },
  { id: OPENJUTSU_WORKFLOWS.groupOneByOne, op: "group-swap", pictures: 2, openjutsu: { pictures: 2, onePerPerson: true } },
  { id: OPENJUTSU_WORKFLOWS.scene, op: "scene-edit", pictures: 1, openjutsu: { action: "change", target: "jacket", becomes: "a cream silk blazer", picture: true } },
  { id: OPENJUTSU_WORKFLOWS.h3, op: "picture-video", pictures: 1, openjutsu: { renderer: "h3", seconds: 6 } },
  { id: OPENJUTSU_WORKFLOWS.motionH3, op: "motion-transfer", pictures: 1, openjutsu: { seconds: 6 } },
  { id: OPENJUTSU_WORKFLOWS.faces, op: "face-fix-video", pictures: 1, openjutsu: { faceStyle: "mouth" } },
  { id: OPENJUTSU_WORKFLOWS.colours, op: "tone-video", pictures: 0, openjutsu: {} },
];

async function compose(id: string, op: Operation, pictures: number, openjutsu: Record<string, unknown>, hasAudio: boolean) {
  const facts = new Map<string, MediaInfo>([["fuobe_clip.mp4", clipFacts(hasAudio)]]);
  const images = Array.from({ length: pictures }, (_, i) => {
    facts.set(`fuobe_pic${i}.png`, PICTURE);
    return `fuobe_pic${i}.png`;
  });
  const input: GenInput = { prompt: "Swap each person for the model in the pictures", seed: 7, numOutputs: 1, video: "fuobe_clip.mp4", ...(images.length && { images }), extra: { openjutsu } };
  const out = await composeWorkflow(id, input, {
    generationId: `silent-${id}`,
    op,
    catalog,
    sent: [],
    made: async (_d, _t, name) => name,
    media: (name) => facts.get(name),
  });
  return out.workflow;
}

describe("a clip without sound on the Openjutsu graphs", () => {
  it("every graph that loads the clip with VHS reads its sound somewhere (so a silent clip would stop it)", async () => {
    for (const r of RUNS.filter((r) => r.id !== OPENJUTSU_WORKFLOWS.colours)) {
      const wf = await compose(r.id, r.op, r.pictures, r.openjutsu, true);
      expect(vhsLoaders(wf).length, r.id).toBeGreaterThan(0);
      expect(soundReads(wf).length, r.id).toBeGreaterThan(0);
    }
  });

  it("never reads a silent clip's sound: needed sound becomes silence, optional sound goes, no link is left hanging", async () => {
    for (const r of RUNS) {
      const wf = await compose(r.id, r.op, r.pictures, r.openjutsu, false);
      expect(soundReads(wf), r.id).toEqual([]);
      expect(dangling(wf), r.id).toEqual([]);
      // No VHS_VideoCombine is left with the clip's sound, and the graph keeps its output.
      for (const n of Object.values(wf)) if (n.class_type === "EmptyAudio") expect(n.inputs.channels, r.id).toBe(2);
    }
  });

  it("Group swap one by one: the soundtrack AudioConcat gets silence as long as the clip", async () => {
    const wf = await compose(OPENJUTSU_WORKFLOWS.groupOneByOne, "group-swap", 2, { pictures: 2, onePerPerson: true }, false);
    const concat = Object.values(wf).find((n) => n.class_type === "AudioConcat" && isLink(n.inputs.audio2) && wf[(n.inputs.audio2 as [string, number])[0]]?.class_type === "EmptyAudio")!;
    expect(concat).toBeDefined();
    const first = wf[(concat.inputs.audio1 as [string, number])[0]];
    expect(first.class_type).toBe("EmptyAudio");
    expect(first.inputs.duration).toBe(7.5);
  });

  it("From picture and Motion transfer on H3: Soundtrack or Silence gets an empty track it pads to the loaded frames", async () => {
    for (const id of [OPENJUTSU_WORKFLOWS.h3, OPENJUTSU_WORKFLOWS.motionH3]) {
      const wf = await compose(id, id === OPENJUTSU_WORKFLOWS.h3 ? "picture-video" : "motion-transfer", 1, { seconds: 6 }, false);
      const node = Object.values(wf).find((n) => n.class_type === "H3SoundtrackOrSilence")!;
      const src = wf[(node.inputs.audio as [string, number])[0]];
      expect(src.class_type, id).toBe("EmptyAudio");
      expect(src.inputs.duration, id).toBe(0);
    }
  });

  it("a clip with sound keeps it: every graph reads the clip's own sound as before", async () => {
    for (const r of RUNS.filter((r) => r.id !== OPENJUTSU_WORKFLOWS.colours)) {
      const wf = await compose(r.id, r.op, r.pictures, r.openjutsu, true);
      expect(Object.values(wf).some((n) => n.class_type === "EmptyAudio" && n._meta?.title === "Silence as long as the clip"), r.id).toBe(false);
    }
  });
});

describe("dropVhsAudio", () => {
  const wf: ComfyWorkflow = {
    "1": { class_type: "VHS_LoadVideo", inputs: { video: "a.mp4" } },
    "2": { class_type: "VHS_VideoCombine", inputs: { images: ["1", 0], audio: ["1", 2] } },
    "3": { class_type: "AudioConcat", inputs: { audio1: ["1", 2], audio2: ["9", 0] } },
    "4": { class_type: "H3SoundtrackOrSilence", inputs: { audio: ["1", 2], video_info: ["1", 3] } },
    "5": { class_type: "H3FaceChunks", inputs: { audio: ["1", 2] } },
    "9": { class_type: "EmptyAudio", inputs: { duration: 1, sample_rate: 8000, channels: 2 } },
  };

  it("drops optional sound, gives needed sound one silence of the clip's length and the padding node an empty track", () => {
    const out = dropVhsAudio(wf, 4.2004);
    expect(out["2"].inputs.audio).toBeUndefined();
    expect(out["3"].inputs.audio1).toEqual(out["5"].inputs.audio);
    const long = out[(out["3"].inputs.audio1 as [string, number])[0]];
    expect(long).toMatchObject({ class_type: "EmptyAudio", inputs: { duration: 4.201, sample_rate: 44100, channels: 2 } });
    const empty = out[(out["4"].inputs.audio as [string, number])[0]];
    expect(empty).toMatchObject({ class_type: "EmptyAudio", inputs: { duration: 0 } });
    expect(out["4"].inputs.video_info).toEqual(["1", 3]);
    // The source graph is left as it was.
    expect(wf["2"].inputs.audio).toEqual(["1", 2]);
  });

  it("treats the ffmpeg loader the same way (its sound is output 2 too)", () => {
    const ff: ComfyWorkflow = { ...wf, "1": { class_type: "VHS_LoadVideoFFmpeg", inputs: { video: "a.mp4" } } };
    const out = dropVhsAudio(ff, 2);
    expect(out["2"].inputs.audio).toBeUndefined();
    expect(out[(out["5"].inputs.audio as [string, number])[0]]).toMatchObject({ class_type: "EmptyAudio", inputs: { duration: 2 } });
    const quiet = silenceVhsAudio(ff, 3);
    expect(quiet[(quiet["2"].inputs.audio as [string, number])[0]]).toMatchObject({ class_type: "EmptyAudio", inputs: { duration: 3 } });
  });

  it("uses 1 s when the clip's length is unknown, and leaves a graph without VHS loaders alone", () => {
    const out = dropVhsAudio(wf);
    expect(out[(out["3"].inputs.audio1 as [string, number])[0]].inputs.duration).toBe(1);
    const none: ComfyWorkflow = { "1": { class_type: "LoadVideo", inputs: { file: "a.mp4" } } };
    expect(dropVhsAudio(none)).toBe(none);
  });
});
