import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  heuristicScenes,
  MAX_FRAMES,
  parseScenes,
  planOneSheet,
  planStoryboard,
  SPLIT_SYSTEM,
  STORYBOARD_NEXT_SCENE_IDS,
  STORYBOARD_PARTNER_IDS,
  type StoryboardLook,
  type StoryboardNextScene,
  type StoryboardPartner,
} from "@/lib/catalog/storyboard";
import { soulLook } from "@/lib/catalog/soul";
import type { Engine, Generation, GenerationRequest } from "@/lib/catalog/types";
import { storyboardName } from "@/lib/storyboard-board";
import { supportsOp } from "@/lib/catalog";
import { COPY_JOIN_VIDEOS } from "@/lib/catalog/clip-lengths";
import { filmModel, joinClips } from "./chains";
import { llmText } from "./enhance";
import { createGenerations, listGenerations, previewChained } from "./generations";

/** The body of POST /api/storyboards and /api/storyboards/estimate. */
export const StoryboardBodySchema = z.object({
  engine: z.enum(["cloud", "open"]),
  /** A partner model for every frame instead of Fuobe's open recipe (cloud only): "nano-banana-pro". */
  partner: z.enum(STORYBOARD_PARTNER_IDS).optional(),
  /** The next frames on your GPU: "qwen-21" (Qwen-Image 2.1 + its Next-Scene LoRA, the default) or "classic" (Qwen-Image-Edit 2509). */
  nextScene: z.enum(STORYBOARD_NEXT_SCENE_IDS).optional(),
  scenes: z.array(z.string().max(1000)).max(8).optional(),
  story: z.string().max(4000).optional(),
  frames: z.number().int().min(1).max(8).optional(),
  references: z.array(z.string().startsWith("/api/files/")).max(4).optional(),
  style: z.string().max(500).optional(),
  /** A Fuobe Soul look id ("v1-general"): frame 1 on Fuobe Soul, the look's grade on every frame. */
  look: z.string().max(80).optional(),
  lookStrength: z.number().min(0).max(1).optional(),
  aspectRatio: z.string().max(10).optional(),
  resolution: z.string().max(10).optional(),
  /** One sheet: every panel drawn on one MOSS-Image page (a layout box per panel), cropped into frames in the browser. */
  sheet: z.boolean().optional(),
});

export interface StoryboardRequest {
  engine: Engine;
  /** A partner model for the whole board (cloud only); unset: Fuobe's open recipe (Qwen-Image-Edit + next-scene). */
  partner?: StoryboardPartner;
  /** The next frames' model on your GPU (open only): Qwen-Image 2.1's Next-Scene LoRA unless "classic". */
  nextScene?: StoryboardNextScene;
  /** Manual: one prompt per frame. */
  scenes?: string[];
  /** Auto: one story, split into `frames`. */
  story?: string;
  frames?: number;
  references?: string[];
  style?: string;
  /** A Fuobe Soul look for the board (build plan O13): frame 1 on Fuobe Soul, the look's grade on every frame. */
  look?: string;
  lookStrength?: number;
  aspectRatio?: string;
  resolution?: string;
  /** One sheet: the whole board as one MOSS-Image page, one panel per scene, cropped into frames in the browser. */
  sheet?: boolean;
}

/** Split a story into scenes with the configured LLM, or a deterministic shot list offline. */
export async function splitStory(story: string, n: number): Promise<string[]> {
  // A local model that decodes to a schema gets exactly n strings (the prompt asks for the same array).
  const json = { name: "frames", schema: { type: "array", items: { type: "string" }, minItems: n, maxItems: n } };
  const text = await llmText(SPLIT_SYSTEM, `Story: ${story}\nFrames: ${n}`, { json });
  return (text && parseScenes(text, n)) || heuristicScenes(story, n);
}

/** The look as the planner takes it (its words), or an error for an unknown one. */
function boardLook(r: Pick<StoryboardRequest, "look" | "lookStrength">): StoryboardLook | undefined {
  if (!r.look) return undefined;
  const look = soulLook(r.look);
  if (!look) throw new Error("That look doesn't exist — pick another one");
  return { id: look.id, words: look.look, ...(r.lookStrength !== undefined && { strength: r.lookStrength }) };
}

/**
 * The board's requests: one sheet (one MOSS-Image page with every panel; no look, references or partner model), or a frame
 * each, every later one made from the one before.
 */
function boardFrames(r: StoryboardRequest, scenes: string[], batchTitle?: string) {
  if (r.sheet) {
    if (r.look) throw new Error("A one-sheet board has no look: make it frame by frame to use one");
    return [planOneSheet({ engine: r.engine, scenes, references: r.references, style: r.style, aspectRatio: r.aspectRatio, resolution: r.resolution, batchTitle })];
  }
  return planStoryboard({ engine: r.engine, partner: r.partner, nextScene: r.nextScene, scenes, references: r.references, style: r.style, look: boardLook(r), aspectRatio: r.aspectRatio, resolution: r.resolution, batchTitle });
}

/** What a board costs before it runs: each frame's price (frame 1 alone, the rest as chained steps), and whether it would be a demo. */
export function estimateStoryboard(r: StoryboardRequest): { costUsd: number | null; demo: boolean; frames: number; models: string[] } {
  const n = Math.max(1, Math.min(MAX_FRAMES, r.scenes?.filter((s) => s.trim()).length || r.frames || 4));
  const scenes = Array.from({ length: n }, (_, i) => r.scenes?.[i]?.trim() || `scene ${i + 1}`);
  const frames = boardFrames(r, scenes);
  let cost: number | null = 0;
  let demo = false;
  const models: string[] = [];
  frames.forEach((f, i) => {
    const p = previewChained(f, i ? 1 : 0);
    demo ||= p.demo;
    cost = cost === null || p.costUsd === null ? null : cost + p.costUsd;
    if (!models.includes(p.model.name)) models.push(p.model.name);
  });
  return { costUsd: cost === null ? null : Math.round((cost as number) * 10000) / 10000, demo, frames: n, models };
}

export async function createStoryboard(r: StoryboardRequest): Promise<{ batchId: string; scenes: string[]; items: Generation[] }> {
  const n = Math.max(1, Math.min(MAX_FRAMES, r.scenes?.length || r.frames || 4));
  const scenes = r.scenes?.length ? r.scenes.slice(0, MAX_FRAMES).map((s) => s.trim()).filter(Boolean) : await splitStory(r.story ?? "", n);
  if (!scenes.length) throw new Error("Describe the story or write at least one scene");
  const batchId = nanoid(10);
  // The board is named after the user's idea on every device (the Library's stack title too).
  const batchTitle = storyboardName(r.scenes?.length ? undefined : r.story, scenes);
  const frames = boardFrames(r, scenes, batchTitle);
  const items: Generation[] = [];
  let previous: string | undefined;
  for (const request of frames) {
    const [g] = createGenerations(request, { batchId, dependsOn: previous });
    items.push(g);
    previous = g.id;
  }
  return { batchId, scenes, items };
}

/**
 * Turn a storyboard into a film: each frame is animated toward the next one (start + end frame
 * when the model can, else from its frame alone), then the clips are joined. Frames still
 * rendering are waited for.
 */
export function createStoryboardFilm(batchId: string, opts: { modelId?: string } = {}): { batchId: string; items: Generation[] } {
  const frames = listGenerations({ batchId, feature: "storyboard", limit: 50 }).sort((a, b) => (a.request.frame?.index ?? 0) - (b.request.frame?.index ?? 0));
  if (frames.length < 2) throw new Error("A film needs at least two frames");
  const broken = frames.find((f) => f.status === "failed" || f.status === "canceled");
  if (broken) throw new Error(`Frame ${(broken.request.frame?.index ?? 0) + 1} didn't render — retry it first`);
  const model = filmModel(frames[0].engine, opts.modelId);
  const flf = supportsOp(model, "flf2v");
  const filmBatch = `${batchId}-film`;
  // Boards made before the server stored a name fall back to the first scene.
  const batchTitle = (frames[0].request as { batchTitle?: string }).batchTitle?.trim() || frames[0].request.frame?.scene || "Storyboard film";
  // A 21:9 board in a look is made at 16:9 and cropped after (frame.crop): its film is 21:9, like its frames.
  const aspectRatio = frames[0].request.frame?.crop ?? frames[0].request.params?.aspectRatio;
  const n = frames.length;
  const clips = frames.map((f, i) => {
    const next = flf ? frames[i + 1] : undefined;
    const scene = f.request.frame?.scene ?? f.request.prompt ?? "";
    const request: GenerationRequest & { batchTitle?: string } = {
      feature: "storyboard-film",
      modelId: model.id,
      prompt: next ? `${scene}. The shot moves naturally toward the next moment: ${next.request.frame?.scene ?? ""}` : `${scene}. Natural, cinematic motion.`,
      params: { aspectRatio, duration: model.defaults?.duration },
      chain: next ? [{ slot: "images", position: "first" }, { slot: "endImage" }] : [{ slot: "images", position: "first" }],
      step: { label: `Shot ${i + 1} of ${n}`, index: i, of: n },
      batchTitle,
    };
    return createGenerations(request, { batchId: filmBatch, dependsOn: next ? [f.id, next.id] : f.id })[0];
  });
  const film = joinClips(
    clips.map((c) => c.id),
    {
      engine: model.engine,
      feature: "storyboard-film",
      batchId: filmBatch,
      title: batchTitle,
      aspectRatio,
      resolution: model.defaults?.resolution,
      copy: COPY_JOIN_VIDEOS.has(model.id),
      step: { label: `Film · ${n} shots`, index: n, of: n + 1 },
    },
  );
  return { batchId: filmBatch, items: [film, ...clips] };
}
