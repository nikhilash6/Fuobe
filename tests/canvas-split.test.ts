import { describe, expect, it } from "vitest";
import {
  cleanGraph,
  connectionError,
  convertEngine,
  defaultModelForNode,
  describeNode,
  edgeStem,
  modelChoices,
  NODE_SPECS,
  OUT,
  outputPorts,
  paletteItems,
  planCanvas,
  SPLIT_HANDLES,
  splitHandle,
  stemOutput,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasNode,
} from "@/lib/catalog/canvas";
import { CLOUD_ONLY_PROBLEM, CLOUD_SPLIT_PROBLEM, SPLIT_MODEL } from "@/lib/av/split";
import { pickOutput } from "@/server/generations";
import { parseGraph } from "@/server/canvas";
import type { OutputFile } from "@/lib/catalog/types";

// Canvas Split soundtrack node (DBS D8, docs/research/dbs-separation-7.md §9): four stem handles, each carrying its stem
// into the next node's chain; open engine only (samAudioCloud is false), disabled on the cloud with a reason.

const node = (id: string, type: CanvasNode["type"], x: number, y: number, data: CanvasNode["data"] = {}): CanvasNode => ({ id, type, position: { x, y }, data });
const edge = (source: string, target: string, targetHandle: string, sourceHandle: string | null = OUT): CanvasEdge => ({ id: `${source}:${sourceHandle}>${target}:${targetHandle}`, source, sourceHandle, target, targetHandle });

/** A video → Split soundtrack; Dialogue → Transcribe (Qwen3-ASR); Music & effects + the video → Add soundtrack (mux). */
function board(): CanvasGraph {
  return {
    nodes: [
      node("clip", "video-input", 0, 0, { url: "/api/files/u/scene.mp4" }),
      node("split", "split-soundtrack", 400, 0, { modelId: SPLIT_MODEL }),
      node("asr", "model", 800, 0, { modelId: "oss-qwen3-asr", mediaKind: "text" }),
      node("mux", "model", 800, 400, { modelId: "oss-mux", mediaKind: "video", op: "mux" }),
      node("out", "output", 1200, 0),
    ],
    edges: [
      edge("clip", "split", "video"),
      edge("split", "asr", "audio", OUT),
      edge("split", "mux", "audio", "background"),
      edge("clip", "mux", "video"),
      edge("split", "out", "in", "music"),
    ],
  };
}

const at = (g: CanvasGraph, id: string) => g.nodes.find((n) => n.id === id)!;

describe("Split soundtrack node", () => {
  it("is a utility running separate-audio on DBS, the only model it offers", () => {
    expect(NODE_SPECS["split-soundtrack"]).toMatchObject({ label: "Split soundtrack", group: "Utilities", ops: ["separate-audio"] });
    expect(defaultModelForNode({ type: "split-soundtrack", data: {} }, "open")?.id).toBe(SPLIT_MODEL);
    // Nothing on the cloud: never Demucs or another separator in DBS's place.
    expect(defaultModelForNode({ type: "split-soundtrack", data: {} }, "cloud")).toBeUndefined();
    expect(modelChoices({ type: "split-soundtrack", data: {} }).map((m) => m.id)).toEqual([SPLIT_MODEL]);
  });

  it("has four labelled stem handles, Dialogue on OUT", () => {
    const g = board();
    const ports = outputPorts(g, at(g, "split"));
    expect(ports.map((p) => [p.id, p.label, p.stem, p.type])).toEqual([
      [OUT, "Dialogue", "voice", "audio"],
      ["music", "Music", "music", "audio"],
      ["effects", "Effects", "effects", "audio"],
      ["background", "Music & effects", "background", "audio"],
    ]);
    expect(ports.every((p) => !p.disabled)).toBe(true);
    expect(SPLIT_HANDLES).toHaveLength(4);
    // Every other node keeps one OUT.
    expect(outputPorts(g, at(g, "clip"))).toEqual([{ id: OUT, label: "Video", type: "video" }]);
    expect(outputPorts(g, at(g, "out"))).toEqual([]);
  });

  it("reads OUT, no handle and 'voice' as Dialogue", () => {
    expect([splitHandle(null), splitHandle(undefined), splitHandle(OUT), splitHandle("voice"), splitHandle("music"), splitHandle("drums")]).toEqual([OUT, OUT, OUT, OUT, "music", undefined]);
    const split = { type: "split-soundtrack" as const };
    expect([edgeStem(split, null), edgeStem(split, "voice"), edgeStem(split, "effects"), edgeStem(split, "background")]).toEqual(["voice", "voice", "effects", "background"]);
    expect(edgeStem({ type: "model" }, "music")).toBeUndefined();
  });

  it("checks edges by handle", () => {
    const g = board();
    expect(connectionError(g, { source: "split", sourceHandle: "effects", target: "out", targetHandle: "in" })).toBeNull();
    expect(connectionError(g, { source: "split", sourceHandle: "drums", target: "out", targetHandle: "in" })).toBe("Split soundtrack has no drums output");
    // A stem is audio: it can't be a video input.
    expect(connectionError(g, { source: "split", sourceHandle: "music", target: "mux", targetHandle: "video" })).toBe("Audio can't go into Video");
    // Other nodes have only OUT.
    expect(connectionError(g, { source: "clip", sourceHandle: "music", target: "out", targetHandle: "in" })).toBe("Video has no output");
  });

  it("carries each handle's stem into the next node's chain", () => {
    const g = board();
    const asr = describeNode(g, at(g, "asr"));
    expect(asr.error).toBeUndefined();
    expect(asr.plan?.op).toBe("transcribe");
    expect(asr.request).toMatchObject({ modelId: "oss-qwen3-asr", chain: [{ slot: "audio", stem: "voice" }] });
    expect(asr.deps).toEqual(["split"]);
    const mux = describeNode(g, at(g, "mux"));
    expect(mux.error).toBeUndefined();
    expect(mux.request).toMatchObject({ modelId: "oss-mux", op: "mux", inputs: { video: "/api/files/u/scene.mp4" }, chain: [{ slot: "audio", stem: "background" }] });
    const split = describeNode(g, at(g, "split"));
    expect(split.request).toMatchObject({ modelId: SPLIT_MODEL, op: "separate-audio", inputs: { video: "/api/files/u/scene.mp4" } });
    expect(split.request?.chain).toBeUndefined();
  });

  it("a stem takes that output of the split's result on the server, and on the board", () => {
    const outputs: OutputFile[] = (["voice", "music", "effects", "background"] as const).map((stem) => ({ kind: "audio", url: `/api/files/${stem}.flac`, meta: { stem } }));
    for (const h of SPLIT_HANDLES) {
      expect(pickOutput(outputs, { slot: "audio", stem: h.stem })?.url).toBe(`/api/files/${h.stem}.flac`);
      expect(stemOutput(outputs, h.stem)?.url).toBe(`/api/files/${h.stem}.flac`);
    }
    expect(stemOutput([{ kind: "audio", url: "/x", meta: { stem: "sfx" } }], "effects")?.url).toBe("/x");
  });

  it("a different handle into the same input changes the node's request (it runs again)", () => {
    const g = board();
    const before = describeNode(g, at(g, "asr")).request;
    const moved: CanvasGraph = { ...g, edges: g.edges.map((e) => (e.target === "asr" ? { ...e, sourceHandle: "music" } : e)) };
    expect(describeNode(moved, at(moved, "asr")).request?.chain).toEqual([{ slot: "audio", stem: "music" }]);
    expect(describeNode(moved, at(moved, "asr")).request).not.toEqual(before);
  });

  it("plans on the open engine: one DBS job, then the steps that take its stems", () => {
    const plan = planCanvas(board(), { engineMode: "open" });
    expect(plan.errors).toEqual([]);
    expect(plan.steps.map((s) => s.nodeId)).toEqual(["split", "asr", "mux"]);
    expect(plan.steps[0].request.modelId).toBe(SPLIT_MODEL);
    expect(plan.costUsd).toBe(0);
    expect(planCanvas(board()).errors).toEqual([]);
  });

  it("is refused on a cloud-only install, with its handles disabled", () => {
    const g = board();
    const plan = planCanvas(g, { engineMode: "cloud" });
    expect(plan.errors.find((e) => e.nodeId === "split")?.message).toBe(CLOUD_ONLY_PROBLEM);
    expect(outputPorts(g, at(g, "split"), "cloud").every((p) => p.disabled === CLOUD_ONLY_PROBLEM)).toBe(true);
    expect(connectionError(g, { source: "split", sourceHandle: "music", target: "out", targetHandle: "in" }, "cloud")).toBe(CLOUD_ONLY_PROBLEM);
  });

  it("with no open model for it, says it runs on open source", () => {
    const g = board();
    const bare = { ...at(g, "split"), data: {} };
    expect(describeNode(g, bare).error).toBe(CLOUD_SPLIT_PROBLEM);
    expect(outputPorts(g, bare).every((p) => p.disabled === CLOUD_SPLIT_PROBLEM)).toBe(true);
    // A board saved on another open separator (a vocals model with two stems) is told to pick DBS; a cloud one (Demucs)
    // is not run in its place either.
    expect(describeNode(g, { ...at(g, "split"), data: { modelId: "demucs" } }).error).toBe(CLOUD_SPLIT_PROBLEM);
    const other = { ...at(g, "split"), data: { modelId: "oss-voice-separate" } };
    expect(describeNode(g, other).error).toMatch(/can't split a soundtrack into its stems — pick DBS/);
  });

  it("stays on the open engine when the board switches to the cloud", () => {
    const { graph, missing } = convertEngine(board(), "cloud");
    expect(missing).toContain("split");
    expect(at(graph, "split").data.modelId).toBe(SPLIT_MODEL);
  });

  it("is in the palette, disabled with a reason on a cloud board or install", () => {
    const item = (mode: "both" | "open" | "cloud", engine?: "open" | "cloud") => paletteItems(mode, engine).find((p) => p.id === "split-soundtrack");
    expect(item("both", "open")?.disabled).toBeUndefined();
    expect(item("open")?.disabled).toBeUndefined();
    expect(item("both", "cloud")?.disabled).toBe(CLOUD_SPLIT_PROBLEM);
    expect(item("cloud")?.disabled).toBe(CLOUD_ONLY_PROBLEM);
  });
});

describe("Split soundtrack on a saved board", () => {
  it("keeps every stem edge through cleanGraph and the server's parse", () => {
    const g = board();
    const parsed = parseGraph(JSON.parse(JSON.stringify(g)))!;
    expect(parsed).not.toBeNull();
    expect(parsed.nodes.map((n) => n.type)).toContain("split-soundtrack");
    expect(parsed.edges.map((e) => e.sourceHandle).sort()).toEqual(["background", "music", OUT, OUT, OUT].sort());
    expect(cleanGraph(parsed)).toEqual(parsed);
  });

  it("reads an edge saved without a handle, or as 'voice', as Dialogue", () => {
    const g = board();
    const old: CanvasGraph = { ...g, edges: g.edges.map((e) => (e.target === "asr" ? { ...e, sourceHandle: null } : e)) };
    const kept = cleanGraph(old);
    expect(kept.edges.find((e) => e.target === "asr")?.sourceHandle).toBeNull();
    expect(describeNode(kept, at(kept, "asr")).request?.chain).toEqual([{ slot: "audio", stem: "voice" }]);
    const voice: CanvasGraph = { ...g, edges: [...g.edges.map((e) => (e.target === "asr" ? { ...e, sourceHandle: "voice" } : e)), edge("split", "asr", "audio", OUT)] };
    const clean = cleanGraph(voice);
    // "voice" becomes OUT, and the same edge twice is kept once.
    expect(clean.edges.filter((e) => e.target === "asr").map((e) => e.sourceHandle)).toEqual([OUT]);
  });

  it("drops an edge from a handle the node doesn't have", () => {
    const g = board();
    const bad: CanvasGraph = { ...g, edges: [...g.edges, edge("split", "out", "in", "drums")] };
    expect(cleanGraph(bad).edges).toHaveLength(g.edges.length);
  });

  it("old boards with one OUT per node load as before", () => {
    const old: CanvasGraph = {
      nodes: [node("a", "audio-input", 0, 0, { url: "/api/files/u/a.wav" }), node("v", "voice-change", 400, 0, { modelId: "elevenlabs-voice-changer" }), node("o", "output", 800, 0)],
      edges: [edge("a", "v", "audio"), { id: "x", source: "v", target: "o", sourceHandle: null, targetHandle: "in" }],
    };
    expect(parseGraph(old)!.edges).toHaveLength(2);
    expect(cleanGraph(old).edges).toEqual(old.edges);
  });

  it("every node type can be saved", () => {
    for (const type of Object.keys(NODE_SPECS) as CanvasNode["type"][]) {
      expect(parseGraph({ nodes: [node("n", type, 0, 0)], edges: [] }), type).not.toBeNull();
    }
  });
});
