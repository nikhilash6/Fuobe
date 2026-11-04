import "server-only";
import { z } from "zod";
import type { PlannedJob } from "@/lib/assist";
import { LOWER_DEFAULT_DB, LOWER_MAX_DB, LOWER_MIN_DB, outcomeLabel, type DialogueOutcome } from "@/lib/av/remove-dialogue";
import { REMIX_MAX_DB, REMIX_MIN_DB, type RemixStem } from "@/lib/av/clean-dialogue";
import type { Engine } from "@/lib/catalog/types";
import { AudioToolError, planAudioTool, runAudioTool, type AudioToolRequest } from "../audio-tools";
import { ConnectComfyError } from "../generations";
import { engineMode } from "../settings";
import { storedMedia } from "../storage";
import { defineTool, type ToolContext, type ToolOutcome } from "./define";
import { planSteps } from "./studio-tools";

/**
 * Assist and MCP's sound tools (DBS D9): split a soundtrack into dialogue, music and effects (or one remix at set levels),
 * and take the dialogue out of a video, each in one call and priced first (the approval card, MCP's estimate_job). They
 * run the Audio hub's own planners (src/server/audio-tools.ts: Split soundtrack, Remove dialogue, and graph C for a remix),
 * so a run is the same batch the pages start and its results land in the Library.
 *
 * DBS is hosted nowhere: both tools run on the open engine (your GPU, or a CPU) and refuse on the cloud engine in words.
 */

const ref = z.string().describe("A file URL from the chat: an attachment, a project source or an earlier output (/api/files/…).");
const STEM_WORDS = { dialogue: "voice", music: "music", effects: "effects" } as const satisfies Record<string, RemixStem>;
const dB = z.number().min(REMIX_MIN_DB).max(REMIX_MAX_DB);

const SplitInput = z.object({
  media: ref.describe("The audio or video whose soundtrack to split."),
  keep: z
    .array(z.enum(["dialogue", "music", "effects"]))
    .min(1)
    .max(3)
    .optional()
    .describe("The parts to keep in one remixed file (e.g. ['music','effects'] for everything but the talking). Leave out (with no levels_db) for the four separate stems."),
  levels_db: z
    .object({ dialogue: dB.optional(), music: dB.optional(), effects: dB.optional() })
    .optional()
    .describe(`Each kept part's level in dB (${REMIX_MIN_DB} to +${REMIX_MAX_DB}, default 0), e.g. { music: -12 } to lower the music under the talking. Given, the result is one remixed file.`),
  quality: z.enum(["fast", "best"]).optional().describe("Fast (DBS-BSRNN) or Best (DBS-TIGER); default: the GPU's pick (Best on a GPU, Fast on a CPU)."),
  stereo: z.boolean().optional().describe("Stereo stems: every channel split on its own (about twice as long)."),
  engine: z.enum(["open", "cloud"]).optional().describe("Default: the chat's engine. DBS runs on the open engine only."),
});

const RemoveInput = z.object({
  video: ref.describe("The video to take the dialogue out of."),
  keep: z
    .enum(["bed", "dialogue"])
    .optional()
    .describe("'bed' (default): the music and sound effects stay and the talking goes. 'dialogue': only the talking stays (with music_db, the talking over the music and effects lowered by that much)."),
  music_db: z
    .number()
    .min(LOWER_MIN_DB)
    .max(LOWER_MAX_DB)
    .optional()
    .describe(`With keep 'dialogue': keep the music and effects under the talking at this level (${LOWER_MIN_DB} to ${LOWER_MAX_DB} dB, e.g. ${LOWER_DEFAULT_DB}).`),
  quality: z.enum(["fast", "best"]).optional().describe("Fast (DBS-BSRNN) or Best (DBS-TIGER); default: the GPU's pick."),
  engine: z.enum(["open", "cloud"]).optional().describe("Default: the chat's engine. DBS runs on the open engine only."),
});

export type SplitToolInput = z.infer<typeof SplitInput>;
export type RemoveToolInput = z.infer<typeof RemoveInput>;

const engineOf = (ctx: ToolContext, asked?: Engine): Engine => (engineMode() === "both" ? (asked ?? ctx.engine) : (engineMode() as Engine));

/** Audio or video, from the file's own header (a file it can't read counts as audio when it has no picture). */
function kindOf(url: string): "audio" | "video" {
  const info = storedMedia(url, { allContainers: true })?.info;
  if (info) return info.hasVideo ? "video" : "audio";
  return /\.(mp4|mov|m4v|webm|mkv|avi)(\?|$)/i.test(url) ? "video" : "audio";
}

/** The Audio hub's request for a split_soundtrack call: the four stems, or one remix when parts or levels are named. */
export function splitBody(i: SplitToolInput, ctx: ToolContext): AudioToolRequest {
  const engine = engineOf(ctx, i.engine);
  const kind = kindOf(i.media);
  const base = { engine, media: i.media, kind, ...(i.quality && { quality: i.quality }), ...(i.stereo && { stereo: true }) };
  const keep = i.keep ? [...new Set(i.keep)] : undefined;
  if (!i.levels_db && (!keep || keep.length === 3)) return { tool: "split", ...base };
  const levels = Object.fromEntries(Object.entries(i.levels_db ?? {}).filter(([, v]) => typeof v === "number").map(([k, v]) => [STEM_WORDS[k as keyof typeof STEM_WORDS], v])) as Partial<Record<RemixStem, number>>;
  return { tool: "remix", ...base, ...(keep && { keep: keep.map((k) => STEM_WORDS[k]) }), levels };
}

/** The Audio hub's request for a remove_dialogue call. */
export function removeBody(i: RemoveToolInput, ctx: ToolContext): AudioToolRequest {
  const outcome: DialogueOutcome = i.keep === "dialogue" ? (i.music_db !== undefined ? "lower-music" : "dialogue-only") : "no-dialogue";
  return { tool: "remove-dialogue", engine: engineOf(ctx, i.engine), video: i.video, outcome, ...(outcome === "lower-music" && { musicDb: i.music_db }), ...(i.quality && { quality: i.quality }) };
}

/** A call priced step by step (never throws: what's in the way is the card's error). */
function priced(tool: string, label: string, body: AudioToolRequest): PlannedJob[] {
  try {
    const p = planAudioTool(body);
    return planSteps(
      tool,
      p.steps.map((s) => ({ key: s.key, request: s.request, ...(s.after && { after: s.after }), ...(s.chain && { chain: s.chain }) })),
    ).map((j, k) => (k === 0 ? { ...j, note: [j.note, p.summary].filter(Boolean).join(" · ") } : j));
  } catch (e) {
    return [{ tool, modelId: body.tool === "remix" ? "oss-dbs-remix" : "oss-dbs-separate", modelName: label, kind: "audio", op: "separate-audio", prompt: label, count: 0, costUsd: 0, demo: false, atomic: true, error: (e as Error).message }];
  }
}

async function started(label: string, body: AudioToolRequest): Promise<ToolOutcome> {
  try {
    const p = planAudioTool(body);
    const run = await runAudioTool(body);
    const result = run.result;
    return {
      content: JSON.stringify({
        result: result.id,
        steps: run.items.map((g) => ({ step: g.request.step?.label ?? g.request.title, id: g.id })),
        summary: p.summary,
        notes: p.notes,
        demo: result.provider === "mock" || undefined,
        note: "The result appears in the chat when it finishes; its files are in the Library.",
      }),
      items: [
        { id: "", role: "tool", text: `${label}: started ${run.items.length} step${run.items.length === 1 ? "" : "s"}`, href: "/library" },
        { id: "", role: "generations", ids: [result.id] },
      ],
    };
  } catch (e) {
    if (e instanceof AudioToolError || e instanceof ConnectComfyError) return { content: JSON.stringify({ error: e.message }), isError: true };
    throw e;
  }
}

const HONEST =
  "There is no hosted DBS: it runs on the open engine (your GPU, or a CPU at about a quarter of real time) and refuses on the cloud engine. Dialogue separates cleanly; music and effects can bleed into each other.";

const splitSoundtrack = defineTool({
  name: "split_soundtrack",
  description:
    "Split the soundtrack of an audio file or a video into its dialogue, music and effects with DBS — Fuobe's Split soundtrack (Audio → Split soundtrack). " +
    "Without keep or levels_db it returns four stems: voice (the dialogue), music, effects and background (music & effects together, everything but the talking). " +
    "With keep and/or levels_db it returns one remixed file instead, e.g. keep ['music','effects'] for no talking, or levels_db { music: -12 } for the music lowered under the talking. " +
    `${HONEST} Price it with estimate_job first. Gated by the same approval card as generate.`,
  schema: SplitInput,
  gated: true,
  title: (i) => (i.keep || i.levels_db ? "Remix the soundtrack" : "Split the soundtrack"),
  place: () => ({ studio: "Split soundtrack", href: "/audio/split" }),
  plan: (i, ctx) => priced("split_soundtrack", "Split soundtrack", splitBody(i, ctx)),
  async run(i, ctx) {
    const body = splitBody(i, ctx);
    return started(body.tool === "remix" ? "Remix soundtrack" : "Split soundtrack", body);
  },
});

const removeDialogue = defineTool({
  name: "remove_dialogue",
  description:
    "Take the dialogue out of a video and keep its music and sound effects, or keep only the dialogue (optionally over the music lowered by music_db) — Fuobe's Remove dialogue (Video tools → Remove dialogue). " +
    `The picture is copied as it is, not re-encoded; the part taken out comes back as a download too. Singing counts as music, so it stays with the music. ${HONEST} Price it with estimate_job first. Gated by the same approval card as generate.`,
  schema: RemoveInput,
  gated: true,
  title: (i) => outcomeLabel(i.keep === "dialogue" ? (i.music_db !== undefined ? "lower-music" : "dialogue-only") : "no-dialogue"),
  place: () => ({ studio: "Remove dialogue", href: "/video-tools/remove-dialogue" }),
  plan: (i, ctx) => priced("remove_dialogue", "Remove dialogue", removeBody(i, ctx)),
  async run(i, ctx) {
    return started("Remove dialogue", removeBody(i, ctx));
  },
});

export const SOUND_TOOLS = [splitSoundtrack, removeDialogue];
