import type { ChainSlot, Engine, GenerationRequest } from "@/lib/catalog/types";
import type { ToolPlan, ToolStep } from "./audio-tools";
import {
  DBS_MODELS,
  dbsChannelsFor,
  splitTime,
  SPLIT_MODEL,
  type DbsChannels,
  type SplitQuality,
  type StemId,
} from "./split";

/**
 * Video tools → Remove dialogue (DBS D2, docs/research/dbs-separation-7.md §4.4 and §9 D2): a video's dialogue taken
 * out, kept alone, or kept with the music lowered under it, with the picture copied untouched. Pure: the page and the
 * server (src/server/audio-tools.ts, tool "remove-dialogue") share it.
 *
 * - Open engine (ComfyUI + ComfyUI-DBS, CPU or GPU): two steps in one batch, no new graph. Graph A
 *   (separate-soundtrack-dbs on oss-dbs-separate) reads the video's soundtrack with LoadAudio and makes the stems; then
 *   the stream-copy mux (oss-mux): one stem for No dialogue (background) and Dialogue only (voice), which the provider
 *   runs as video-mux-audio-replace; the voice over the background at a lower level for Lower the music, which it runs
 *   as video-mux-audio. Concatenate Video with complete_audio copies the picture packet by packet.
 * - Cloud: none. DBS is hosted nowhere and no other model stands in for it: the cloud engine says the tool runs on
 *   your GPU.
 */

export const REMOVE_DIALOGUE_FEATURE = "remove-dialogue";
export const REMOVE_DIALOGUE_MODELS = {
  split: SPLIT_MODEL,
  mux: "oss-mux",
} as const;

export type DialogueOutcome = "no-dialogue" | "dialogue-only" | "lower-music";

export const OUTCOMES: { id: DialogueOutcome; label: string; hint: string }[] =
  [
    {
      id: "no-dialogue",
      label: "No dialogue",
      hint: "Music and sound effects, no talking",
    },
    { id: "dialogue-only", label: "Dialogue only", hint: "Just the talking" },
    {
      id: "lower-music",
      label: "Lower the music",
      hint: "The talking, with the music and effects quieter under it",
    },
  ];
export const outcomeLabel = (id: DialogueOutcome): string =>
  OUTCOMES.find((o) => o.id === id)!.label;

/** Lower the music: how far the music and effects go down (dB; the mux's backgroundVolumeDb is a whole number). */
export const LOWER_MIN_DB = -30;
export const LOWER_MAX_DB = 0;
export const LOWER_DEFAULT_DB = -12;
export const clampLowerDb = (db: number | undefined): number =>
  Number.isFinite(db)
    ? Math.min(LOWER_MAX_DB, Math.max(LOWER_MIN_DB, Math.round(db!)))
    : LOWER_DEFAULT_DB;

/** The longest video the tool takes (a CPU host takes about 4x its length to separate it; the stems are lossless FLAC). */
export const REMOVE_DIALOGUE_MAX_SECONDS = 30 * 60;

/** Why the cloud engine has no Remove dialogue (and what Engine mode "Paid APIs only" says). */
export const CLOUD_REMOVE_PROBLEM =
  "Remove dialogue runs on your GPU (open source): DBS isn't hosted on fal or Replicate, so the cloud engine can't take the dialogue out. Switch to the open engine.";
export const CLOUD_ONLY_REMOVE_PROBLEM =
  "Remove dialogue runs on your GPU (open source), but this install is set to paid cloud APIs only (Settings → Engine mode)";

export const NO_SOUND_PROBLEM = "This clip has no sound";

/** The stem the result keeps, and the one taken out (kept as a download beside the result). */
export const KEPT_STEM: Record<DialogueOutcome, StemId | null> = {
  "no-dialogue": "background",
  "dialogue-only": "voice",
  "lower-music": null,
};
export const REMOVED_STEM: Record<DialogueOutcome, StemId | null> = {
  "no-dialogue": "voice",
  "dialogue-only": "background",
  "lower-music": null,
};

/** What's in the way of a run (in words the page shows), or null. */
export function removeDialogueProblem(i: {
  engine: Engine;
  video?: string;
  hasAudio?: boolean;
  seconds?: number;
}): string | null {
  if (i.engine === "cloud") return CLOUD_REMOVE_PROBLEM;
  if (!i.video) return "Add the video to take the dialogue out of";
  if (i.hasAudio === false) return NO_SOUND_PROBLEM;
  if (i.seconds && i.seconds > REMOVE_DIALOGUE_MAX_SECONDS)
    return `Videos run up to ${REMOVE_DIALOGUE_MAX_SECONDS / 60} minutes here — trim it first (Video tools → Trim)`;
  return null;
}

export interface RemoveDialogueInput {
  engine: Engine;
  /** The video (/api/files/…). */
  video: string;
  name?: string;
  outcome?: DialogueOutcome;
  /** Lower the music: the music and effects' level (dB, LOWER_MIN_DB…LOWER_MAX_DB). */
  musicDb?: number;
  /** Fast (DBS-BSRNN) or Best (DBS-TIGER); unset = the host's pick. */
  quality?: SplitQuality;
  /** The soundtrack's channel count (its header, else what the browser decoded). */
  channels?: number;
  /** Seconds the video runs, when known. */
  seconds?: number;
  /** False when the video's header says it has no sound. */
  hasAudio?: boolean;
}

export interface RemoveDialoguePlan extends ToolPlan {
  outcome: DialogueOutcome;
  mode: DbsChannels;
  /** Lower the music: the level the music and effects go to. */
  musicDb: number | null;
}

/** The mux step's chain: which stem goes where (both come from the one split step). */
export function muxChain(outcome: DialogueOutcome): ChainSlot[] {
  if (outcome === "lower-music")
    return [
      { slot: "audio", stem: "voice" },
      { slot: "audio2", stem: "background" },
    ];
  return [{ slot: "audio", stem: KEPT_STEM[outcome]! }];
}

const MUX_LABEL: Record<DialogueOutcome, string> = {
  "no-dialogue": "Music and effects back on the video · picture copied",
  "dialogue-only": "Dialogue back on the video · picture copied",
  "lower-music": "Dialogue over the lowered music · picture copied",
};

/**
 * What an earlier run was asked for, read back from its mux step's request (its chain says which stems, its extra the
 * level): Compare puts these back in the controls, so the button runs that again, not what was on screen before.
 */
export function requestedOutcome(r: Pick<GenerationRequest, "chain" | "params">): { outcome: DialogueOutcome; musicDb: number } {
  const chain = r.chain ?? [];
  if (chain.some((c) => c.slot === "audio2")) {
    const db = r.params?.extra?.backgroundVolumeDb;
    return { outcome: "lower-music", musicDb: clampLowerDb(typeof db === "number" ? db : undefined) };
  }
  return { outcome: chain[0]?.stem === KEPT_STEM["dialogue-only"] ? "dialogue-only" : "no-dialogue", musicDb: LOWER_DEFAULT_DB };
}

/** Two steps on the open engine (split, then the stream-copy mux); throws what's in the way (in words the page shows). */
export function planRemoveDialogue(i: RemoveDialogueInput): RemoveDialoguePlan {
  const problem = removeDialogueProblem(i);
  if (problem) throw new Error(problem);
  const outcome = i.outcome ?? "no-dialogue";
  const lower = outcome === "lower-music";
  const musicDb = lower ? clampLowerDb(i.musicDb) : null;
  // Mono: the background is the original minus the speech, so it keeps the original's stereo image at one pass's cost
  // (§2.1's "fast stereo" bed). A file with more channels than ComfyUI can save is split in mono too, its bed made from
  // the music and effects stems (dbsSurroundBed), so that rule needs nothing here.
  const mode = dbsChannelsFor("mono", i.channels);
  const name = i.name?.trim() || "video";
  const title = `${outcomeLabel(outcome)}${musicDb !== null ? ` (${musicDb} dB)` : ""} · ${name}`;
  const base = {
    feature: REMOVE_DIALOGUE_FEATURE,
    batchTitle: title,
  } satisfies Partial<GenerationRequest>;
  const extra: Record<string, unknown> = { channels: mode };
  if (i.quality) extra.separationModel = DBS_MODELS[i.quality];
  if (i.channels && i.channels > 0)
    extra.sourceChannels = Math.round(i.channels);
  const seconds =
    i.seconds && i.seconds > 0
      ? Math.round(i.seconds * 1000) / 1000
      : undefined;
  const steps: ToolStep[] = [
    {
      key: "split",
      request: {
        ...base,
        modelId: REMOVE_DIALOGUE_MODELS.split,
        op: "separate-audio",
        title: `Stems · ${name}`,
        inputs: { video: i.video },
        params: { extra, ...(seconds && { sourceDuration: seconds }) },
        step: { label: "Dialogue, music, effects", index: 0, of: 2 },
      },
    },
    {
      key: "video",
      // Both stems of Lower the music come from the one split (createPipeline takes a step twice for two stems).
      after: lower ? ["split", "split"] : ["split"],
      chain: muxChain(outcome),
      request: {
        ...base,
        modelId: REMOVE_DIALOGUE_MODELS.mux,
        op: "mux",
        title,
        inputs: { video: i.video },
        ...(lower && { params: { extra: { backgroundVolumeDb: musicDb } } }),
        step: { label: MUX_LABEL[outcome], index: 1, of: 2 },
      },
    },
  ];
  return {
    steps,
    length: seconds ?? null,
    outcome,
    mode,
    musicDb,
    summary:
      outcome === "no-dialogue"
        ? "Takes the talking out and keeps the music and sound effects. The picture is not re-encoded."
        : outcome === "dialogue-only"
          ? "Keeps only the talking: the music and sound effects go. The picture is not re-encoded."
          : `Keeps the talking and lowers the music and sound effects by ${Math.abs(musicDb!)} dB under it. The picture is not re-encoded.`,
    notes: [
      outcome === "dialogue-only"
        ? "Music or effects the model takes for speech (singing, a shout in a crowd) stay with the dialogue."
        : "Speech the model misses (singing, a voice deep in the mix) stays in the music and effects: nothing is invented, sound is only moved between stems.",
      lower
        ? "The dialogue and the music & effects come back as downloads too."
        : `The ${outcome === "no-dialogue" ? "dialogue" : "music & effects"} it takes out is kept as a download beside the result.`,
      ...(i.channels && i.channels > 2
        ? [
            `This file has ${i.channels} channels: its new soundtrack comes out in mono, as ComfyUI saves mono or stereo only.`,
          ]
        : []),
    ],
  };
}

/** Writing the new soundtrack (AAC) and copying the picture's packets: seconds, beside the split (measured on the CPU host). */
const MUX_OVERHEAD_SECONDS = 2;
const MUX_SPEED = 40;

/** About how long a run takes on the open engine: the split, then the mux (a range in seconds). */
export function removeDialogueTime(o: {
  seconds: number;
  quality: SplitQuality;
  mode: DbsChannels;
  channels?: number | null;
  device?: string | null;
}): { low: number; high: number } {
  const split = splitTime(o);
  const mux = MUX_OVERHEAD_SECONDS + Math.max(0, o.seconds) / MUX_SPEED;
  return {
    low: Math.round(split.low + mux),
    high: Math.round(split.high + mux * 2),
  };
}
