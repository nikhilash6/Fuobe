import { exrWorkflow } from "@/lib/av/video-finish";
import { qwen21Graph } from "@/lib/qwen21-speed";
import { H3_TIER_PARAM, tierGraphFor } from "@/lib/gpu/h3-tier";

/**
 * Which workflow a ComfyUI route runs for a request: the route's endpoint, or a variant picked by an option.
 * prepareWorkflow (src/server/providers/comfyui.ts) and the GPU pre-flight's gate (src/server/gpu/gate.ts)
 * both call this, so the graph that runs is the graph that was checked. Pure.
 */

/**
 * Image-to-video graphs whose camera moves Wan 2.2 Fun Camera makes natively: a request with a pose (params.extra.cameraMotion)
 * runs there (Fuobe DoP on Wan 2.2 14B, Fuobe Cinema on its Lightning graph).
 */
export const CAMERA_POSE_GRAPH: Record<string, string> = { "wan22-i2v-14b": "wan22-fun-camera-14b", "wan22-i2v-14b-lightx2v": "wan22-fun-camera-14b" };

/**
 * Fuobe Marketing Image's Standalone product shot (params.extra.productShot with one product photo) runs the product-shot
 * graph: the product cut out with BiRefNet, put on white and relit into the scene (Qwen-Image-Edit 2509 + White_to_Scene).
 * The key is Marketing Image's open edit graph.
 */
export const PRODUCT_SHOT_GRAPH: Record<string, string> = { "qwen-image-21-edit": "product-shot-qwen-edit-2509" };

/** MiniMax H3's Quality control: "best" (params.extra.quality) runs the 20-step graph without the turbo LoRA. */
export const H3_BEST_GRAPH: Record<string, string> = {
  "minimax-h3-t2v": "minimax-h3-t2v-hq",
  "minimax-h3-i2v": "minimax-h3-i2v-hq",
  "minimax-h3-flf2v": "minimax-h3-flf2v-hq",
};

/** MiniMax H3's 360-degree orbit of a still (params.extra.orbit): the Orbit LoRA graph, with the still as first and last frame. */
export const H3_ORBIT_GRAPH: Record<string, string> = { "minimax-h3-i2v": "minimax-h3-orbit" };

/**
 * Clean up voice with "Keep music & effects" (params.extra.background "keep"): DBS splits the soundtrack, RE-USE cleans the
 * dialogue and the music and effects go back under it.
 */
export const REUSE_BED_GRAPH: Record<string, string> = { "voice-clean-reuse": "voice-clean-bed-reuse" };

/**
 * Genjutsu's Openjutsu graphs (params.extra.openjutsu): Group swap one by one (exactly 2 characters, a pass each) and From
 * picture on native H3 (the owner's renderer) run graphs of their own.
 */
export const OPENJUTSU_VARIANTS: Record<string, { key: string; value: unknown; graph: string }> = {
  "video-group-swap-h3": { key: "onePerPerson", value: true, graph: "video-group-swap-h3-one-by-one" },
  "video-from-picture-solar": { key: "renderer", value: "h3", graph: "video-from-picture-h3" },
};
/** YuE2 with a song attached (Audio → Music's "Song to cover"): the cover graph sings its melody with the new style and lyrics. */
export const YUE2_COVER_GRAPH: Record<string, string> = { "music-yue2-song": "music-yue2-cover" };

export interface VariantRequest {
  op: string;
  /** Clips a join takes ("video-concat-{n}"). */
  clips: number;
  images: number;
  /** The output format asked for ("exr"). */
  format?: string;
  /** A second audio track is given (a mux with a background stem). */
  audio2: boolean;
  /** An audio input is given (a song to cover). */
  audio?: boolean;
  extra: Record<string, unknown>;
  /** Is this workflow in the library. */
  has: (id: string) => boolean;
}

/** The workflow id a route's endpoint runs as, for this request. */
export function resolveWorkflowId(endpointTemplate: string, r: VariantRequest): string {
  // "video-concat-{n}": one workflow per clip count.
  let endpoint = endpointTemplate.replace("{n}", String(Math.max(2, Math.min(4, r.clips))));
  // Soundtrack without a background stem: the single-track graph.
  if (r.op === "mux" && !r.audio2 && r.has(`${endpoint}-replace`)) endpoint = `${endpoint}-replace`;
  // EXR frames have graphs of their own (export, SDR to HDR).
  if (r.format === "exr" && (r.op === "export-video" || r.op === "sdr-to-hdr")) {
    const exr = exrWorkflow(r.op);
    if (r.has(exr)) endpoint = exr;
  }
  // Fuobe DoP: a camera move Wan 2.2 Fun Camera makes natively runs on its graph.
  const posed = CAMERA_POSE_GRAPH[endpoint];
  if (posed && typeof r.extra.cameraMotion === "string" && r.extra.cameraMotion) endpoint = posed;
  const shot = PRODUCT_SHOT_GRAPH[endpoint];
  if (shot && r.extra.productShot === true && r.images === 1 && r.has(shot)) endpoint = shot;
  // Qwen-Image 2.1: Options → Speed's graph, or the small encoder's when Options → GPU says Small (src/lib/qwen21-speed.ts).
  endpoint = qwen21Graph(endpoint, r.extra, r.has);
  // MiniMax H3: an orbit runs the Orbit LoRA graph (whatever the quality or tier); else a smaller card's tier (FastH3 V2 or Trim,
  // as the plan decided it: src/server/h3-gpu.ts), which wins over Best; else Best runs the 20-step graph.
  const orbit = H3_ORBIT_GRAPH[endpoint];
  const best = H3_BEST_GRAPH[endpoint];
  const tier = r.extra[H3_TIER_PARAM];
  const small = tier === "fast" || tier === "trim" ? tierGraphFor(endpoint, tier, r.has) : undefined;
  if (orbit && r.extra.orbit === true && r.has(orbit)) endpoint = orbit;
  else if (small) endpoint = small;
  else if (best && r.extra.quality === "best" && r.has(best)) endpoint = best;
  const oj = OPENJUTSU_VARIANTS[endpoint];
  const ojSettings = r.extra.openjutsu as Record<string, unknown> | undefined;
  if (oj && ojSettings?.[oj.key] === oj.value && r.has(oj.graph)) endpoint = oj.graph;
  const cover = YUE2_COVER_GRAPH[endpoint];
  if (cover && r.audio && r.has(cover)) endpoint = cover;
  const bed = REUSE_BED_GRAPH[endpoint];
  if (bed && r.extra.background === "keep" && r.has(bed)) endpoint = bed;
  return endpoint;
}
