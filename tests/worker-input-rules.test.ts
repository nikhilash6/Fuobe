import path from "node:path";
import { describe, expect, it } from "vitest";
import { graphCheck, vetGraph } from "../bin/lib/worker/checks.mjs";
import { loaderInput, pathProblem } from "../bin/lib/worker/rules.mjs";
import { allowedNodeList, inputRules, missingRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";
import { tempDir } from "./helpers/temp-dir";

process.env.FUOBE_DATA_DIR = tempDir("fuobe-worker-rules-");

type Node = { class_type: string; inputs: Record<string, unknown> };
type Graph = Record<string, Node>;

const root = path.resolve(__dirname, "..");
/** The catalog as the build reads it (its JSON, typed for the test). */
const catalog = readCatalog(root) as unknown as {
  graphs: Record<string, Graph>;
  manifest: { workflows: { id: string; file: string }[] };
  requirements: { files: Record<string, { folder: string; file: string }> };
};
const rules = inputRules(catalog);
const allowed = new Set(allowedNodeList(root, catalog));
const verified = Object.values(catalog.requirements.files as Record<string, { folder: string; file: string }>).map((f) => ({ folder: f.folder, name: f.file }));
const SENT = ["fuobe_abcdefgh01.png", "fuobe_abcdefgh02.wav", "fuobe_abcdefgh03.mp4"];
const check = (g: Graph, staged: string[] = SENT) => vetGraph(g, allowed, verified, { rules, staged });

/** The catalog's workflows (the manifest's graphs). */
const workflows = (catalog.manifest.workflows as { id: string; file: string }[]).filter((w) => catalog.graphs[w.file]);

/** The file names a graph's loaders read (in a test, the files "sent" with it). */
function loaderNames(g: Graph): string[] {
  const out: string[] = [];
  for (const n of Object.values(g)) {
    for (const [k, v] of Object.entries(n?.inputs ?? {})) {
      if (!loaderInput(n.class_type, k)) continue;
      if (typeof v === "string") out.push(v);
      else if (v && typeof v === "object" && !Array.isArray(v)) for (const x of Object.values(v)) if (typeof x === "string") out.push(x);
    }
  }
  return out;
}

// Graphs a studio taken over could send. Every node in them is on the allowlist.
const speech = { class_type: "LoadAudio", inputs: { audio: "fuobe_abcdefgh02.wav" } };
const concat = (a: string, b: string) => ({ class_type: "StringConcatenate", inputs: { string_a: a, string_b: b, delimiter: "" } });
const asr = (over: Record<string, unknown>) => ({
  class_type: "AILab_Qwen3ASRSubtitle",
  inputs: { audio: ["1", 0], model: "Qwen/Qwen3-ASR-0.6B-hf", precision: "bf16", attention: "auto", forced_aligner: "Qwen/Qwen3-ForcedAligner-0.6B-hf", language: "auto", hints: "", output_format: "none", output_path: "fuobe/captions", split_mode: "split_by_punctuation_or_pause_or_length", max_gap_sec: 0.6, max_chars: 32, max_inference_batch_size: 32, max_new_tokens: 256, normalize_text: true, unload_models: true, ...over },
});
const timeline = (over: Record<string, unknown>) => ({ class_type: "MiniMaxH3SourceTimeline", inputs: { video_path: "", audio_path: "", embedded_audio: "auto", skip_first_frames: 0, source_audio: ["1", 0], ...over } });

describe("the worker's input rules", () => {
  it("are built for the inputs that name files, downloads or code", () => {
    expect(rules.inputs.AILab_Qwen3ASRSubtitle.output_format).toEqual({ kind: "literal", value: "none" });
    expect(rules.inputs.AILab_Qwen3ASRSubtitle.output_path).toEqual({ kind: "enum", values: ["", "fuobe/captions"] });
    expect(rules.inputs.MiniMaxH3SourceTimeline.video_path).toEqual({ kind: "literal", value: "" });
    expect(rules.inputs.MiniMaxH3SourceTimeline.audio_path).toEqual({ kind: "literal", value: "" });
    expect(rules.inputs.WanVideoImageToVideoMultiTalk.output_path).toEqual({ kind: "literal", value: "" });
    expect(rules.inputs.StringFormat.f_string.kind).toBe("enum");
    expect(rules.inputs.LoadImage.image).toEqual({ kind: "input-file" });
    expect(rules.inputs.SaveVideo.filename_prefix).toEqual({ kind: "output-name" });
    expect(rules.inputs.UNETLoader.unet_name.kind).toBe("model-file");
    expect(rules.inputs.AILab_Qwen3ASRSubtitle.max_new_tokens).toEqual({ kind: "range", min: 256, max: 256, integer: true });
    // Prompts take free text: no rule.
    expect(rules.inputs.CLIPTextEncode?.text).toBeUndefined();
    expect(rules.text.CLIPTextEncode).toContain("text");
    // Each input that writes or reads a file, or formats with code, has its rule; the build stops without one.
    expect(missingRules(rules, [...allowed])).toEqual([]);
    expect(missingRules({ inputs: {} }, ["StringFormat", "KSampler"])).toEqual(["StringFormat.f_string"]);
  });

  it("every catalog workflow passes as the catalog has it", () => {
    const refused: string[] = [];
    for (const w of workflows) {
      const g = catalog.graphs[w.file] as Graph;
      const p = graphCheck(g, allowed, verified, { rules, staged: loaderNames(g) });
      if (p) refused.push(`${w.id}: ${p.reason} ${p.cls}.${p.input}`);
    }
    // A few name a file their node downloads, or a LoRA the run picks: no verified file is known for them (as before).
    expect(refused.every((r) => / model-unverified /.test(r)), refused.join("\n")).toBe(true);
    expect(refused.length).toBeLessThanOrEqual(4);
  });

  it("an allowed subtitle node can't write a file anywhere", () => {
    // A path built from text pieces, linked into the output path.
    const built: Graph = { "1": speech, "2": concat("C", ":\\Users\\x\\Start Menu\\Programs\\Startup\\x.bat"), "3": asr({ output_format: "srt", output_path: ["2", 0] }) };
    expect(check(built)).toBe("unsafe-path");
    // Written straight in, in each form the old check missed.
    for (const p of ["C:Users\\x\\x.bat", "\\Users\\x\\x.bat", "/x.bat", "//host/share/x", "output/x.srt", "x.bat"]) {
      expect(check({ "1": speech, "3": asr({ output_format: "srt", output_path: p }) }), p).toBe("unsafe-path");
    }
    // A file format other than none.
    expect(check({ "1": speech, "3": asr({ output_format: "srt" }) })).toBe("unsafe-path");
    // An input the catalog never gives it.
    expect(check({ "1": speech, "3": asr({ save_path: "x" }) })).toBe("unsafe-path");
    // As the catalog has it: passes.
    expect(check({ "1": speech, "3": asr({}) })).toBeNull();
  });

  it("an allowed timeline node can't read a clip from anywhere", () => {
    for (const p of ["C:Users\\x\\Videos\\private.mp4", "\\Users\\x\\v.mp4", "output/render.mp4", "//host/share/v.mp4", "~/v.mp4", "v.mp4"]) {
      expect(check({ "1": speech, "2": timeline({ video_path: p }) }), p).toBe("unsafe-path");
      expect(check({ "1": speech, "2": timeline({ audio_path: p }) }), p).toBe("unsafe-path");
    }
    expect(check({ "1": speech, "3": concat("out", "put/v.mp4"), "2": timeline({ video_path: ["3", 0] }) })).toBe("unsafe-path");
    expect(check({ "1": speech, "2": timeline({}) })).toBeNull();
  });

  it("refuses every other form of a path, and links into inputs that have a rule", () => {
    const missed = ["C:Users\\x", "\\Users\\x", "/Program Files/x", "/x.bat", "//host/share/x", "file:///C:/x", "http://h/x", "%2e%2e/x", "a.png:ads", "CON", "NUL.txt", "x/aux.txt", "~user/x", "\\/host/share", "/\\host\\share", "..\\x"];
    for (const p of missed) expect(pathProblem(p), p).toBe("unsafe-path");
    // An input with no rule that takes no free text: the second layer.
    for (const p of missed) expect(check({ "1": { class_type: "ImageScale", inputs: { upscale_method: p } } }), p).toBe("unsafe-path");
    // A loader: only a file this job sent, never a link.
    for (const p of [...missed, "output/x.mp4", "input.mp4"]) expect(check({ "1": { class_type: "LoadVideo", inputs: { file: p } } }), p).toBe("unsafe-path");
    expect(check({ "1": concat("fuobe_abcdefgh03", ".mp4"), "2": { class_type: "LoadVideo", inputs: { file: ["1", 0] } } })).toBe("unsafe-path");
    expect(check({ "1": { class_type: "LoadVideo", inputs: { file: "fuobe_abcdefgh03.mp4" } } })).toBeNull();
    expect(check({ "1": { class_type: "LoadVideo", inputs: { file: "fuobe_abcdefgh03.mp4 [input]" } } })).toBeNull();
    // The multi-talk node's output path, and a save name.
    const talk = { class_type: "WanVideoImageToVideoMultiTalk", inputs: { width: 832, height: 480, frame_window_size: 81, motion_frame: 9, force_offload: false, colormatch: "disabled", tiled_vae: false, mode: "infinitetalk", output_path: "C:x" } };
    expect(check({ "1": talk })).toBe("unsafe-path");
    for (const p of ["../x", "/x", "C:/x", "x/../../y", "fuobe/%date%"]) expect(check({ "1": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: p } } }), p).toBe("unsafe-path");
    expect(check({ "1": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "fuobe/gen-1_a" } } })).toBeNull();
  });

  it("a format string stays the catalog's (no walk into the environment)", () => {
    const walk = { class_type: "StringFormat", inputs: { "values.a": ["9", 0], f_string: "{a.__init__.__globals__[os].environ}" } };
    expect(check({ "9": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } }, "1": walk })).toBe("unsafe-path");
    expect(check({ "1": { class_type: "StringFormat", inputs: { "values.a": "a fox: running", f_string: "{a} Keep everything else exactly the same." } } })).toBeNull();
  });

  it("a model by its exact name only, in its own folder; never a link", () => {
    expect(check({ "1": { class_type: "UNETLoader", inputs: { unet_name: "flux1-dev.safetensors", weight_dtype: "default" } } })).toBeNull();
    // The base name of a verified file under another folder no longer passes.
    expect(check({ "1": { class_type: "UNETLoader", inputs: { unet_name: "anyfolder/flux1-dev.safetensors", weight_dtype: "default" } } })).toBe("model-unverified");
    // A verified name, but in a folder that loader doesn't read.
    expect(check({ "1": { class_type: "UNETLoader", inputs: { unet_name: "ae.safetensors", weight_dtype: "default" } } })).toBe("model-unverified");
    expect(check({ "2": concat("flux1-dev", ".safetensors"), "1": { class_type: "UNETLoader", inputs: { unet_name: ["2", 0], weight_dtype: "default" } } })).toBe("unsafe-path");
    expect(check({ "1": { class_type: "UNETLoader", inputs: { unet_name: "C:x.safetensors", weight_dtype: "default" } } })).toBe("unsafe-path");
  });

  it("downloads stay the catalog's: no other repository id", () => {
    expect(check({ "1": speech, "3": asr({ model: "someone/other-model" }) })).toBe("unsafe-path");
    expect(check({ "1": speech, "3": asr({ model: "Qwen/Qwen3-ASR-1.7B-hf" }) })).toBeNull();
  });

  it("numbers stay in their range", () => {
    expect(check({ "1": speech, "3": asr({ max_new_tokens: 1e9 }) })).toBe("unsafe-path");
    expect(check({ "1": speech, "3": asr({ max_new_tokens: "256" }) })).toBe("unsafe-path");
  });

  it("prompts keep any text", () => {
    const text = "Scene 2: 50% off, wait.. C:/ isn't a path here ~ http://x";
    expect(check({ "1": { class_type: "CLIPTextEncode", inputs: { text, clip: ["2", 0] } } })).toBeNull();
    expect(check({ "1": { class_type: "StringConcatenate", inputs: { string_a: text, string_b: text, delimiter: "" } } })).toBeNull();
  });
});

describe("graphs as the studio builds them", () => {
  // The clips' headers, as the studio reads them from an upload.
  const media = (name: string) =>
    /\.mp4$/.test(name)
      ? { container: "mp4", hasVideo: true, hasAudio: true, duration: 6, videoDuration: 6, width: 640, height: 360, fps: 30, frames: 180 }
      : /\.wav$/.test(name)
        ? { container: "wav", hasVideo: false, hasAudio: true, duration: 10 }
        : undefined;

  it("every catalog workflow, prepared for a run, passes the worker's rules", async () => {
    const { prepareWorkflow } = await import("@/server/providers/comfyui");
    const { MODELS } = await import("@/lib/catalog");
    const opFor = (id: string) => MODELS.flatMap((m) => m.routes).find((r) => r.provider === "comfyui" && r.endpoint === id)?.op ?? "t2i";
    const given = ["fuobe_given00001.png", "fuobe_given00002.png", "fuobe_given00003.mp4", "fuobe_given00004.wav", "fuobe_given00005.wav", "fuobe_given00006.png", "fuobe_given00007.mp4"];
    let prepared = 0;
    const refused: string[] = [];
    for (const w of workflows) {
      const uploads: string[] = [];
      const input = {
        prompt: "Scene 2: a fox at 50% speed, wait.. then ~ calm",
        negativePrompt: "blurry",
        images: [given[0], given[1]],
        endImage: given[1],
        mask: given[5],
        video: given[2],
        videos: [given[2], given[6]],
        audio: given[3],
        audios: [given[3], given[4]],
        palette: ["#112233", "#445566"],
        targetLanguage: "German (de)",
        sourceLanguage: "de",
        startTime: 1,
        endTime: 3,
        numLayers: 3,
        aspectRatio: "16:9",
        seed: 7,
        extra: { audio2: given[4] },
      };
      let graph: Graph;
      try {
        const res = await prepareWorkflow(w.id, input as never, {
          generationId: "gen1",
          op: opFor(w.id) as never,
          upload: async (_d, _t, name) => {
            const n = `fuobe_up${String(uploads.length).padStart(6, "0")}.${name.split(".").pop() ?? "bin"}`;
            uploads.push(n);
            return n;
          },
          media: media as never,
        });
        graph = res.workflow as Graph;
      } catch {
        continue; // a workflow this input doesn't fit (another op, a missing setting): the server refuses it before any worker
      }
      prepared++;
      const p = graphCheck(graph, allowed, verified, { rules, staged: [...given, ...uploads, ...loaderNames(catalog.graphs[w.file] as Graph)] });
      if (p && p.reason !== "model-unverified") refused.push(`${w.id}: ${p.reason} ${p.cls}.${p.input} = ${JSON.stringify(graph[p.node]?.inputs?.[p.input ?? ""])?.slice(0, 80)}`);
    }
    expect(refused, refused.join("\n")).toEqual([]);
    expect(prepared).toBeGreaterThan(workflows.length * 0.9);
  }, 120_000);

  it("the graph builders' own nodes pass too (swaps, scene edits, joins, keyframes, finishes)", async () => {
    const { prepareWorkflow } = await import("@/server/providers/comfyui");
    const { OPENJUTSU_WORKFLOWS: W } = await import("@/lib/openjutsu-graphs");
    const a = "fuobe_given00001.png";
    const b = "fuobe_given00002.png";
    const clip = "fuobe_given00003.mp4";
    const runs: [string, Record<string, unknown>, string][] = [
      [W.group, { video: clip, images: [a, b], seed: 11, extra: { openjutsu: { pictures: 2, roles: ["the person on the left", "the person on the right"], quality: "720p", edge: "tight" } } }, "group-swap"],
      [W.group, { video: clip, images: [a, b], extra: { openjutsu: { pictures: 2, onePerPerson: true } } }, "group-swap"],
      [W.scene, { video: clip, extra: { openjutsu: { action: "remove", target: "the handbag" } } }, "scene-edit"],
      [W.scene, { video: clip, images: [a], extra: { openjutsu: { action: "background", target: "the people", becomes: "an Amalfi terrace", picture: true } } }, "scene-edit"],
      [W.prepare, { video: clip, images: [a], startTime: 2, extra: { openjutsu: { light: "Light it: warm, 50% softer." } } }, "picture-frame"],
      [W.h3, { video: clip, images: [a], extra: { openjutsu: {} } }, "from-picture"],
      [W.motionH3, { video: clip, images: [a], extra: { openjutsu: {} } }, "motion-transfer"],
      [W.faces, { video: clip, images: [a], extra: { openjutsu: {} } }, "fix-faces"],
      [W.colours, { video: clip, extra: { openjutsu: { finish: "filmic", strength: 0.4, soften: 0.3 } } }, "fix-colours"],
      ["audio-join-crossfade", { audios: ["fuobe_given00004.wav", "fuobe_given00005.wav", "fuobe_given00006.wav"], crossfade: 1 }, "audio-join"],
      ["video-concat-encoded", { videos: ["fuobe_given00007.mp4", "fuobe_given00008.mp4", "fuobe_given00009.mp4"] }, "concat"],
      ["wan22-flf2v-14b", { images: [a], endImage: b, duration: 3 }, "flf2v"],
      ["kenburns-still", { images: [a], aspectRatio: "9:16", resolution: "480p", duration: 7, easing: "linear" }, "still-motion"],
    ];
    let prepared = 0;
    const refused: string[] = [];
    const failed: string[] = [];
    for (const [id, input, op] of runs) {
      const uploads: string[] = [];
      let graph: Graph;
      try {
        const res = await prepareWorkflow(id, input as never, {
          generationId: "gen1",
          op: op as never,
          upload: async (_d, _t, name) => {
            const n = `fuobe_up${String(uploads.length).padStart(6, "0")}.${name.split(".").pop() ?? "bin"}`;
            uploads.push(n);
            return n;
          },
          media: media as never,
        });
        graph = res.workflow as Graph;
      } catch (e) {
        failed.push(`${id}: ${(e as Error).message}`);
        continue;
      }
      prepared++;
      const sent = [...JSON.stringify(input).matchAll(/fuobe_given\d+\.\w+/g)].map((m) => m[0]);
      const p = graphCheck(graph, allowed, verified, { rules, staged: [...sent, ...uploads] });
      if (p && p.reason !== "model-unverified") refused.push(`${id}: ${p.reason} ${p.cls}.${p.input} = ${JSON.stringify(graph[p.node]?.inputs?.[p.input ?? ""])?.slice(0, 80)}`);
    }
    expect(refused, refused.join("\n")).toEqual([]);
    expect(failed, failed.join("\n")).toEqual([]);
    expect(prepared).toBe(runs.length);
  }, 120_000);
});
