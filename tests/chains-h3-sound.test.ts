import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { buildEpisodeGraph, defaultSettings, genreInfo, secondsFor, type EpisodeSettings, type ScriptBlock } from "@/lib/catalog/faceless";

// MiniMax H3 makes every clip with its own sound. Where a pipeline lays a voice or music on the film (Faceless, the
// Explainer, Content Factory, Assist's faceless episode, Click to Ad), that soundtrack takes the clips' place: the open
// mux replaces the film's sound, whichever join built it. H3's clips share one canvas and frame rate, so Faceless and
// the Explainer join them with the copy join (no decode, flat memory); the decode joins build a film from the pictures.

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const workflow = (id: string): Graph => JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/comfyui", `${id}.json`), "utf8"));
const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

/** Every node class upstream of a node's input (the input's own source included). */
function upstream(g: Graph, nodeId: string, input: string): Set<string> {
  const out = new Set<string>();
  const queue = [g[nodeId].inputs[input]].filter(isLink).map((l) => l[0]);
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.add(g[id].class_type);
    for (const v of Object.values(g[id].inputs)) if (isLink(v)) queue.push(v[0]);
  }
  return out;
}

const AUDIO_ONLY = new Set(["LoadAudio", "AudioAdjustVolume", "AudioMerge", "EmptyAudio", "AudioConcat"]);

describe("the open graphs a clip with sound goes through", () => {
  it("the join (video-concat-2/3/4) builds the film from the clips' pictures alone", () => {
    expect(getModel("oss-join-clips")!.routes[0].endpoint).toBe("video-concat-{n}");
    for (const n of [2, 3, 4]) {
      const g = workflow(`video-concat-${n}`);
      const create = Object.entries(g).filter(([, v]) => v.class_type === "CreateVideo");
      expect(create, `video-concat-${n}`).toHaveLength(1);
      expect(create[0][1].inputs.audio, `video-concat-${n}`).toBeUndefined();
      // Each clip is read for its frames (and the first for its frame rate), never for its sound (output 1).
      const links = Object.values(g).flatMap((v) => Object.values(v.inputs).filter(isLink));
      const components = new Set(Object.entries(g).filter(([, v]) => v.class_type === "GetVideoComponents").map(([k]) => k));
      expect(links.filter(([from, slot]) => components.has(from) && slot === 1), `video-concat-${n}`).toEqual([]);
    }
  });

  it("the mux puts the new soundtrack in place of the film's: the clip's sound never reaches it", () => {
    for (const id of ["video-mux-audio", "video-mux-audio-replace"]) {
      const g = workflow(id);
      const [concat] = Object.entries(g).filter(([, v]) => v.class_type === "ConcatenateVideo");
      // ComfyUI's ConcatenateVideo: complete_audio overrides the audio carried by the input videos.
      expect(isLink(concat[1].inputs.complete_audio), id).toBe(true);
      const sources = upstream(g, concat[0], "complete_audio");
      expect([...sources].every((c) => AUDIO_ONLY.has(c)), `${id}: ${[...sources].join(", ")}`).toBe(true);
      expect(sources.has("LoadAudio")).toBe(true);
    }
  });

  it("the UGC joins keep one chosen clip's sound: the presenter's voice, after a silent hook", () => {
    for (const n of [2, 3, 4]) {
      const first = workflow(`video-concat-sound1-${n}`);
      const [, create1] = Object.entries(first).find(([, v]) => v.class_type === "CreateVideo")!;
      // Clip 1's sound only (the presenter when there is no hook).
      expect(create1.inputs.audio).toEqual(["1", 2]);
      const second = workflow(`video-concat-sound2-${n}`);
      const [createId] = Object.entries(second).find(([, v]) => v.class_type === "CreateVideo")!;
      // Silence as long as clip 1 (the hook), then clip 2's sound (the presenter).
      const sources = upstream(second, createId, "audio");
      expect([...sources].sort()).toEqual(["AudioConcat", "EmptyAudio", "VHS_LoadVideoFFmpeg", "VHS_VideoInfoLoaded"]);
      const concat = Object.values(second).find((v) => v.class_type === "AudioConcat")!;
      expect(second[(concat.inputs.audio2 as [string, number])[0]]).toMatchObject({ class_type: "VHS_LoadVideoFFmpeg", inputs: { video: "clip_2.mp4" } });
    }
  });
});

const block = (i: number): ScriptBlock => {
  const narration = Array.from({ length: 20 }, (_, w) => `w${i}x${w}`).join(" ");
  return { id: `b${i}`, narration, visual: `Scene ${i}`, motion: "slow push-in", seconds: secondsFor(narration) };
};

describe("Faceless and the Explainer on MiniMax H3: the narration and the music replace the clips' sound", () => {
  const blocks = Array.from({ length: 6 }, (_, i) => block(i));
  const graph = (feature: "faceless" | "explainer", s: Partial<EpisodeSettings>) =>
    buildEpisodeGraph(
      { feature, title: "How tides work", genre: genreInfo("education"), settings: { ...defaultSettings("open", genreInfo("education")), animation: "animated", voice: null, ...s }, blocks, fallbackVoice: "/api/files/uploads/v.wav" },
      getModel,
    );

  it.each(["faceless", "explainer"] as const)("%s: clips with sound, joined by copy, the voice and the bed mixed on in place of their sound", (feature) => {
    expect(getModel("oss-minimax-h3")!.options.audio).toBe("always");
    for (const music of [true, false]) {
      const g = graph(feature, { music });
      const clips = g.filter((s) => s.part === "clip");
      expect(clips.every((c) => c.request.modelId === "oss-minimax-h3")).toBe(true);
      const joins = g.filter((s) => s.part === "join");
      expect(joins.length).toBeGreaterThan(0);
      expect(joins.every((j) => j.request.modelId === "oss-join-encoded" && j.chain!.every((c) => c.slot === "videos"))).toBe(true);
      const mix = g.find((s) => s.key === "mix")!;
      expect(mix.request.modelId).toBe("oss-mux");
      expect(mix.after).toEqual(music ? ["join", "narration", "music"] : ["join", "narration"]);
      expect(mix.chain).toEqual(music ? [{ slot: "video" }, { slot: "audio" }, { slot: "audio2" }] : [{ slot: "video" }, { slot: "audio" }]);
      // No step takes a clip, or a join of clips, as its sound (an audio slot fed by a clip would take its soundtrack).
      const pictureSteps = new Set([...clips, ...joins].map((s) => s.key));
      for (const s of g) {
        (s.chain ?? []).forEach((c, i) => {
          if (["audio", "audio2", "voiceAudio"].includes(c.slot)) expect(pictureSteps.has(s.after![i]), `${s.key} ← ${s.after![i]}`).toBe(false);
        });
      }
    }
  });

  it("the mux route lays one track in place of the film's sound, or the voice over the bed", () => {
    const route = getModel("oss-mux")!.routes.find((r) => r.op === "mux")!;
    expect(route.endpoint).toBe("video-mux-audio");
    expect(route.note).toMatch(/one track: video-mux-audio-replace/);
  });

  it("each H3 block is one clip of 3 to 15 s, as long as the block", () => {
    const g = graph("faceless", { music: false });
    const clips = g.filter((s) => s.part === "clip");
    expect(clips).toHaveLength(blocks.length);
    clips.forEach((c, i) => expect(c.request.params?.duration).toBe(blocks[i].seconds));
    for (const c of clips) expect(Number(c.request.params?.duration)).toBeGreaterThanOrEqual(3);
  });

  it("source pictures (an edit keeps each source's shape) go through the decode join, which fits every clip to the film", () => {
    const g = graph("faceless", { music: false, sourceImages: ["/api/files/uploads/a.png", "/api/files/uploads/b.png"] });
    const joins = g.filter((s) => s.part === "join");
    expect(joins.length).toBeGreaterThan(0);
    expect(joins.every((j) => j.request.modelId === "oss-join-clips")).toBe(true);
  });

  it("the copy join is a graph that never decodes a frame", () => {
    const g = workflow("video-concat-encoded");
    const classes = Object.values(g).map((v) => v.class_type).sort();
    expect(classes).toEqual(["ConcatenateVideo", "LoadVideo", "LoadVideo", "SaveVideo"]);
  });
});
