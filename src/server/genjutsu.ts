import "server-only";
import { z } from "zod";
import { getModel } from "@/lib/catalog";
import { onEngine } from "@/lib/catalog/engines";
import {
  ANCHOR_MODELS,
  anchorModel,
  CHARACTER_GPU,
  CHARACTER_LIMITS,
  CHARACTER_SWAP,
  characterFinish,
  characterLicenceLine,
  cutWarning,
  h3Windows,
  swapLoraRef,
  SWAP_LORAS,
  TURBO_LORA,
  windowPlan,
  type CharacterOptions,
} from "@/lib/catalog/character-swap";
import { ACCESS_PLACE } from "@/lib/model-access";
import { filmSize, sharpenTierFor } from "@/lib/catalog/sharpen";
import {
  chooseMaker,
  cutsInPart,
  GENJUTSU,
  genjutsuProblem,
  genjutsuTitle,
  makersFor,
  MODE_TARGETS,
  planGenjutsu,
  planMakerPieces,
  qualityFor,
  makerStepUsd,
  resolutionWords,
  SOURCE_LABELS,
  type GenjutsuLook,
  type GenjutsuMode,
  type GenjutsuPlanInput,
  type GenjutsuTarget,
  type GenjutsuTier,
  type Maker,
  type MakerSource,
} from "@/lib/catalog/genjutsu";
import { MASK_TRACKER, REMOVE_TOOLS, scalePoints, wholeClip, type RemoveRange, type RemoveSource } from "@/lib/catalog/remove-object";
import { planSegments, type PlanStep } from "@/lib/catalog/shorts";
import type { Engine, Generation, PixelPoint, ProviderId } from "@/lib/catalog/types";
import { silenceWriter } from "./canvas";
import { createPipeline } from "./chains";
import { llmText, llmTextBackend } from "./enhance";
import { ConnectComfyError, createGenerations, previewChained } from "./generations";
import { localLabel } from "./llm";
import { isOffered, offeredLoras, offeredModel } from "./model-access";
import { provider } from "./providers";
import { probeOllama } from "./providers/llm";
import { pointsFromPaint } from "./remove-object";
import { engineMode, getSetting } from "./settings";
import { probeSource, ShortsError } from "./shorts";
import { readRef } from "./storage";

/**
 * Fuobe Genjutsu (/genjutsu): plans, prices and starts a Motion transfer, Character swap, Object swap, Restyle or Insert
 * (src/lib/catalog/genjutsu.ts) as one pipeline of ordinary generations: feature "genjutsu" for the finished video,
 * "genjutsu-step" for the cuts, tracks, anchor frames, pieces and joins. No table of its own: the page's history is a
 * feed, and a setup travels as a code (encodeSetup), not a row. No Higgsfield model runs here.
 */

export { ShortsError as GenjutsuError };

export interface GenjutsuBody {
  engine: Engine;
  mode: GenjutsuMode;
  /** The model picked (defaults per engine and mode: the Fuobe Original). */
  modelId?: string;
  /** Lite ("standard") or the full Original ("high"). */
  tier?: GenjutsuTier;
  quality?: string;
  target?: GenjutsuTarget;
  /** Object swap: what goes. */
  subject?: string;
  /** Guidance (Character swap: your direction). */
  prompt?: string;
  points?: PixelPoint[];
  /** The picture the points or the paint were made on (the first frame the browser showed). */
  frame?: { width: number; height: number };
  mask?: string;
  references?: string[];
  look?: GenjutsuLook;
  source: { url: string; name?: string; duration?: number; fps?: number; width?: number; height?: number; hasAudio?: boolean };
  range?: RemoveRange;
  seed?: number;
  /** Character swap's settings. */
  character?: CharacterOptions;
  /** Hard cuts the browser found in the clip (seconds), for the "one continuous shot" warning. */
  cuts?: number[];
}

const fileUrl = z.string().startsWith("/api/files/").max(500);
const seconds = z.number().finite().min(0).max(3600);
const point = z.object({ x: z.number().finite().min(0).max(20000), y: z.number().finite().min(0).max(20000), label: z.enum(["positive", "negative"]).optional() });
const look = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preset"), id: z.string().max(80) }),
  z.object({ kind: z.literal("soul"), id: z.string().max(80) }),
  z.object({ kind: z.literal("custom"), images: z.array(fileUrl).max(GENJUTSU.maxLookImages), words: z.string().max(300).optional() }),
]);
const character = z.object({
  who: z.enum(["largest", "leftmost", "rightmost", "index"]).optional(),
  index: z.number().int().min(0).max(CHARACTER_SWAP.maxPeople - 1).optional(),
  subject: z.string().max(120).optional(),
  maskGrow: z.number().int().min(0).max(256).optional(),
  anchor: z.boolean().optional(),
  anchorModel: z.enum(["gpt-image-2-5-sunburst", "nano-banana-pro", "oss-qwen-image-21", "oss-krea2-identity-edit", "oss-qwen-edit"]).optional(),
  description: z.string().max(CHARACTER_SWAP.maxDescriptionChars).optional(),
  speech: z.enum(["character", "other", "offscreen", "none"]).optional(),
  dialogue: z.string().max(2000).optional(),
  lora: z.enum(["v1.5", "v1", "none"]).optional(),
  audioGuide: z.boolean().optional(),
  useMask: z.boolean().optional(),
  windowFrames: z.number().int().min(22).max(362).optional(),
  historyFrames: z.number().int().min(0).max(341).optional(),
});

/** The body of /api/genjutsu (and /estimate). */
export const GenjutsuBodySchema = z.object({
  engine: z.enum(["cloud", "open"]),
  mode: z.enum(["motion", "character", "swap", "restyle", "insert"]),
  modelId: z.string().max(80).optional(),
  tier: z.enum(["standard", "high"]).optional(),
  quality: z.enum(["480p", "720p", "768p", "1080p", "2K", "4K"]).optional(),
  target: z.enum(["type", "click", "paint"]).optional(),
  subject: z.string().max(300).optional(),
  prompt: z.string().max(GENJUTSU.maxPromptChars).optional(),
  points: z.array(point).max(GENJUTSU.maxPoints).optional(),
  frame: z.object({ width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000) }).optional(),
  mask: fileUrl.optional(),
  references: z.array(fileUrl).max(GENJUTSU.maxReferences).optional(),
  look: look.optional(),
  source: z.object({
    url: fileUrl,
    name: z.string().max(200).optional(),
    duration: z.number().finite().positive().max(3600).optional(),
    fps: z.number().finite().positive().max(240).optional(),
    width: z.number().int().positive().max(20000).optional(),
    height: z.number().int().positive().max(20000).optional(),
    hasAudio: z.boolean().optional(),
  }),
  range: z.object({ start: seconds, end: seconds }).optional(),
  seed: z.number().int().min(0).max(2 ** 48).optional(),
  character: character.optional(),
  cuts: z.array(seconds).max(200).optional(),
  /** A client nonce for one submit: a repeat gets the first answer (see once()). */
  requestId: z.string().trim().min(8).max(64).optional(),
});

/** The estimate is asked for before uploads finish: any URL stands in. */
export const GenjutsuEstimateSchema = GenjutsuBodySchema.extend({
  source: GenjutsuBodySchema.shape.source.extend({ url: z.string().max(500).default("/api/files/placeholder.mp4") }),
  mask: z.string().max(500).optional(),
  references: z.array(z.string().max(500)).max(GENJUTSU.maxReferences).optional(),
});

const mustMatchMode = (engine: Engine) => {
  const mode = engineMode();
  if (mode !== "both" && mode !== engine) {
    throw new ShortsError(mode === "open" ? "This install runs open-source models only (Settings → Engine mode)" : "This install runs cloud models only (Settings → Engine mode)", 422);
  }
};

interface Planned {
  input: GenjutsuPlanInput;
  maker: Maker;
  notes: string[];
}

async function planInput(body: GenjutsuBody, opts: { probe: boolean }): Promise<Planned> {
  mustMatchMode(body.engine);
  const picked = chooseMaker({
    engine: body.engine,
    mode: body.mode,
    target: body.target,
    tier: body.tier,
    look: body.look,
    modelId: body.modelId,
    offered: (id) => isOffered(id, body.engine),
  });
  if ("problem" in picked) throw new ShortsError(picked.problem, 422);
  const maker = picked.maker;
  // The header's facts win over what the browser read (the estimate runs before the upload is read).
  const info = opts.probe ? await probeSource(body.source.url) : {};
  const source: RemoveSource = {
    url: body.source.url,
    duration: info.duration ?? body.source.duration,
    fps: info.fps ?? body.source.fps,
    width: info.width ?? body.source.width,
    height: info.height ?? body.source.height,
    // Sound we couldn't read counts as none (putting it back would fail after the work was paid for).
    hasAudio: opts.probe ? (info.hasAudio ?? false) : (body.source.hasAudio ?? false),
  };
  // Character swap's part defaults to the first 15 s (Openjutsu's Length); the other modes take up to 30 s.
  const longest = body.mode === "character" ? CHARACTER_SWAP.maxSeconds : GENJUTSU.maxSeconds;
  const range = body.range ?? (source.duration ? { start: 0, end: Math.min(source.duration, longest) } : null);
  if (!range) throw new ShortsError("Reading the clip… try again in a moment");
  const target = MODE_TARGETS[body.mode].length ? (body.target ?? MODE_TARGETS[body.mode][0]) : undefined;
  const references = body.references ?? [];
  const clicks = (body.points ?? []).filter((p) => p.label !== "negative").length;
  const problem = genjutsuProblem({ mode: body.mode, maker, source, range, references: references.length, target, subject: body.subject, prompt: body.prompt, points: clicks, mask: !!body.mask, look: body.look, seed: body.seed, character: body.character });
  if (problem) throw new ShortsError(problem, 422);
  const switched = body.mode === "character" && maker.h3 ? characterSwitches(maker, body.character ?? {}) : { character: body.character, notes: [] };

  // Clicks on the first frame, in the clip's pixels; paint is followed from its deepest points (SAM 3.1 on fal).
  let points: PixelPoint[] | undefined;
  const size = source.width && source.height ? { width: source.width, height: source.height } : null;
  if (target === "click") points = body.frame && size ? scalePoints(body.points!.slice(0, GENJUTSU.maxPoints), body.frame, size) : body.points;
  const pieces = planMakerPieces(maker, source, range);
  // Restyle on Fuobe's looks runs in the Shorts chain's segments (the open Original and partners).
  const shortsChain = body.mode === "restyle" && maker.looks === "fuobe" && !(maker.engine === "cloud" && maker.source === "original");
  const n = (shortsChain ? planSegments(range, maker.engine).length : pieces.length) || 1;
  const tracksPaint = maker.engine === "cloud" && body.mode === "swap" && target === "paint" && (maker.source === "original" || n > 1);
  if (tracksPaint) points = opts.probe ? await pointsFromPaint(body.mask!, source, "Paint over what to swap first") : [{ x: 1, y: 1, label: "positive" }];

  const notes = [...switched.notes, ...notesFor({ ...body, character: switched.character }, maker, source, range, n, references.length)];
  const name = (body.source.name ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").trim().slice(0, 40);
  const title = genjutsuTitle({ mode: body.mode, subject: body.subject, look: body.look });
  return {
    maker,
    notes,
    input: {
      engine: body.engine,
      mode: body.mode,
      maker,
      title: name ? `${title} · ${name}` : title,
      source,
      range,
      quality: body.quality ?? (body.mode === "character" ? CHARACTER_SWAP.defaultQuality : GENJUTSU.defaultQuality),
      references,
      target,
      subject: body.subject?.trim() || undefined,
      prompt: body.prompt?.trim() || undefined,
      points,
      mask: target === "paint" ? body.mask : undefined,
      look: body.look,
      ...(body.seed !== undefined ? { seed: body.seed } : {}),
      ...(body.mode === "character" ? { character: switched.character ?? {} } : {}),
    },
  };
}

/**
 * The Character swap with what Settings → Models & licences switched off taken out: the first-frame model (the next one
 * that is on, else no first frame) and the swap LoRA (on your GPU H3 runs without it; fal's route needs one). Turbo off
 * on the open engine stops the run: the 8-step graph can't go without it.
 */
function characterSwitches(m: Maker, c: CharacterOptions): { character: CharacterOptions; notes: string[] } {
  const notes: string[] = [];
  let out = c;
  if (m.h3?.anchor && c.anchor !== false) {
    const wanted = anchorModel(m.engine, c.anchorModel);
    if (!isOffered(wanted.id, m.engine)) {
      const next = ANCHOR_MODELS[m.engine].find((a) => isOffered(a.id, m.engine));
      out = next ? { ...out, anchorModel: next.id } : { ...out, anchor: false };
      notes.push(next ? `${wanted.label} is switched off in ${ACCESS_PLACE}: ${next.label} makes the first frame` : `The first-frame models are switched off in ${ACCESS_PLACE}: the swap runs without a first frame`);
    }
  }
  const lora = c.lora ?? "v1.5";
  if (lora !== "none" && offeredLoras([swapLoraRef(lora)]).dropped.length) {
    if (m.engine === "cloud") throw new ShortsError(`The swap LoRA (${SWAP_LORAS[lora].label}) is switched off in ${ACCESS_PLACE}, and fal's H3 route needs one — turn it on, or pick the other release`, 422);
    out = { ...out, lora: "none" };
    notes.push(`The swap LoRA is switched off in ${ACCESS_PLACE}: H3 runs with the Turbo LoRA alone`);
  }
  if (m.engine === "open" && offeredLoras([TURBO_LORA]).dropped.length) throw new ShortsError(`The H3 Turbo LoRA is switched off in ${ACCESS_PLACE}, and the Character swap's 8-step graph needs it — turn it on to run it on your GPU`, 422);
  return { character: out, notes };
}

function notesFor(body: GenjutsuBody, m: Maker, source: RemoveSource, range: RemoveRange, n: number, refs: number): string[] {
  const notes: string[] = [];
  const name = getModel(m.id)?.name ?? m.label;
  const fps = source.fps ?? 30;
  const fuobeLook = body.mode === "restyle" && m.looks === "fuobe";
  const len = range.end - range.start;
  if (body.mode === "character" && m.h3) {
    const c = body.character ?? {};
    if (m.engine === "open") {
      const plan = windowPlan(c.windowFrames, c.historyFrames);
      const windows = h3Windows(len, plan.window, plan.history);
      notes.push(
        windows > 1
          ? `MiniMax H3 swaps it in ${windows} windows of up to ${plan.window} frames at 24 fps, each continuing from the ${plan.history} frames before it; the clip's sound stays`
          : `MiniMax H3 swaps it in one window of up to ${plan.window} frames at 24 fps; the clip's sound stays`,
      );
      // One prompt for the whole part: past H3's trained range (~362 frames) the pack itself says quality is unverified.
      if (len > CHARACTER_SWAP.maxSeconds + 0.05) notes.push("Past 15 s is beyond what H3 was trained on, so quality there can drop");
    } else if (n > 1) notes.push(`fal's H3 takes up to 15 s a call: the part runs as ${n} pieces, joined with the clip's own sound. Each piece starts fresh (no history between them), so a seam can show where they meet`);
    if (m.engine === "cloud" && !source.hasAudio) notes.push("Your clip has no sound, and neither will the result: fal's H3 makes a soundtrack of its own, which is replaced with silence");
    if (m.h3.anchor && c.anchor !== false) {
      const am = anchorModel(m.engine, c.anchorModel);
      notes.push(`${am.label} first puts your character into the part's first frame${m.engine === "cloud" && n > 1 ? " (one per piece)" : ""}; if that fails the swap runs without it`);
    } else if (!m.h3.anchor) notes.push(`${name} runs without an anchor frame`);
    if (m.engine === "cloud") notes.push("On fal, H3 has no mask: who to swap is said in words, and the whole frame is regenerated around them");
    // 1080p / 2K / 4K (sharpen.ts): what each engine does with the 768p swap.
    const finish = characterFinish(qualityFor(m, body.quality ?? CHARACTER_SWAP.defaultQuality));
    if (finish && m.engine === "cloud") notes.push(`fal's H3 makes ${finish} from a 768P base: the whole frame is drawn at the higher size`);
    if (finish && m.engine === "open") {
      const film = filmSize(source.width, source.height);
      const made = sharpenTierFor("open", finish, film);
      notes.push("The 768p swap is redrawn by Open-H3 Regenerate and only your character is put back over your clip: the background and the sound stay as filmed. Faces can change slightly");
      if (made && made !== finish && film) notes.push(`Your clip is ${film.width}×${film.height}, so it is sharpened at ${made} (never above the clip's own size)`);
    }
    if (m.engine === "open" && c.who === "index" && !body.points?.length) notes.push("Person numbers follow SAM 3.1's detections, the one it is surest of first — not left to right");
    if (m.engine === "open" && !m.h3.maskSwitch && c.useMask === false) notes.push(`${name} always regenerates only the person: its graph has no switch for the whole frame`);
    const warn = cutWarning(cutsInPart(body.cuts, range));
    if (warn) notes.push(warn);
    notes.push(characterLicenceLine(m.engine, m.id));
  } else if (body.mode === "character") {
    notes.push(m.id === "h3-max-recast" ? characterLicenceLine(m.engine, m.id) : `${SOURCE_LABELS[m.source]}: ${m.note}`);
    const warn = m.id === "h3-max-recast" ? null : cutWarning(cutsInPart(body.cuts, range));
    if (warn) notes.push(warn);
  }
  if (n > 1 && body.mode !== "character") {
    if (m.engine === "open" && m.window) {
      notes.push(`${name} works on ${m.window.cap} frames at a time (${(m.window.cap / fps).toFixed(1)} s of this clip): it runs as ${n} windows, joined with the clip's own sound. Seams between windows aren't tested on a GPU yet`);
    } else if (fuobeLook) {
      notes.push(`${name} restyles ${m.engine === "open" ? "5 s" : m.window ? `${m.window.cap} frames (${(m.window.cap / fps).toFixed(1)} s of this clip)` : "up to 10 s"} at a time: the clip runs as ${n} segments, joined with its own sound`);
    } else {
      const limit = m.window ? `${m.window.cap} frames (${(m.window.cap / fps).toFixed(1)} s of this clip)` : `${m.maxSeconds} s`;
      notes.push(`${name} takes up to ${limit} a call: the clip runs as ${n} pieces, joined with its own sound. Seams between pieces aren't tested yet`);
    }
  }
  if (body.mode !== "restyle" && refs > m.refs.max) notes.push(m.refs.max === 1 ? `${name} uses your first reference image` : `${name} takes ${m.refs.max} references — your first ${m.refs.max} go`);
  if (fuobeLook && refs) notes.push("Restyle changes the whole shot: character references aren't used — try Motion transfer or Character swap for a character");
  if (fuobeLook && body.look?.kind === "custom" && m.readsLookImages && body.look.images.length > m.readsLookImages) notes.push(`${name} reads ${m.readsLookImages} of your look's images`);
  if (fuobeLook && body.look?.kind === "soul" && m.source === "original") notes.push("The Soul look's LoRAs restyle the first frame (Fuobe Soul's edit); every frame then follows it");
  const quality = body.quality ?? (body.mode === "character" ? CHARACTER_SWAP.defaultQuality : GENJUTSU.defaultQuality);
  const res = resolutionWords(m, quality);
  if (res) notes.push(`${name} ${res}${m.qualities ? "" : " (it has no resolution setting)"}`);
  if (m.id === "wan-22-vace-inpaint") {
    notes.push(body.mode === "insert" ? "The spot stays where you painted it for the whole shot — best with a still or slow camera" : "Only the area you marked changes; SAM 3.1 follows it through the selection when it runs as pieces or you clicked");
  }
  if (m.source === "original" && body.mode === "swap" && m.engine === "cloud") notes.push("SAM 3.1 follows what you named, clicked or painted through the selection; Wan VACE paints your reference into its mask");
  if (m.billFps && m.engine === "cloud" && source.fps && source.fps > m.billFps + 0.5) notes.push(`fal bills this clip's ${Math.round(source.fps)} fps as ${(source.fps / m.billFps).toFixed(1)}× its length (video seconds at ${m.billFps} fps)`);
  if (m.id === "oss-vace-insert") notes.push("The spot stays where you painted it for the whole shot — best with a still or slow camera");
  if (m.people && body.mode === "swap") notes.push(`${name} swaps the person on camera — for objects, pick Fuobe Genjutsu or Kling O3`);
  if (m.engine === "open" && body.mode !== "character") {
    if (m.modes.includes("motion")) notes.push("Wan Animate 2 needs a 24 GB GPU · Apache-2.0");
    else if (m.window) notes.push(`Wan 2.1 VACE 14B needs a 24 GB GPU · Apache-2.0${body.mode === "swap" ? " (SAM 3.1: Meta's SAM License)" : ""}`);
  }
  if (!wholeClip(range, source.duration)) notes.push("Only the selected part comes out (the rest of the clip isn't kept)");
  return notes;
}

const withChain = (s: PlanStep) => ({ ...s.request, ...(s.chain ? { chain: s.chain } : {}) });

/** The helper steps in words, for a run that can't have them (they run on fal; the open ones on ComfyUI). */
const HELPER_WORDS: Record<string, string> = {
  [REMOVE_TOOLS.cloud.cut]: "cutting the clip",
  [REMOVE_TOOLS.cloud.join]: "joining the pieces",
  [REMOVE_TOOLS.cloud.mux]: "putting the sound back",
  [MASK_TRACKER]: "following what you marked",
  "extract-frame": "taking the first frame",
  "scale-video": "fitting the clip",
  "gpt-image-2-5-sunburst": "the first frame with your character",
  "nano-banana-pro": "the first frame with your character",
};

/** The providers a step's model runs its operation on, on the step's engine (any one of them will do). */
const providersOf = (s: PlanStep): ProviderId[] => {
  const m = getModel(s.request.modelId);
  const routes = m ? (s.request.engine ? onEngine(m, s.request.engine) : m).routes : [];
  return [...new Set(routes.filter((r) => !s.request.op || r.op === s.request.op).map((r) => r.provider))];
};

const listWords = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

interface StepMode {
  step: PlanStep;
  /** It would run as a demo (no provider for it), or can't run at all (demo mode off). */
  demo: boolean;
}

/**
 * A run is all real or all a demo (chainMode in src/server/generations.ts): a real step after a demo one runs as a demo
 * too, a demo step after a real one fails, both after the paid steps were made. So when only some of the steps have a
 * provider — Replicate's P-Video without fal for the cuts and joins, say — name the missing key (and the way around
 * it) before anything is paid for.
 */
function mixProblem(modes: StepMode[], cannot: boolean, input: GenjutsuPlanInput): string | null {
  const missing = modes.filter((x) => x.demo);
  if (!missing.length || (!cannot && missing.length === modes.length)) return null;
  const m = input.maker;
  const makerName = getModel(m.id)?.name ?? m.label;
  const own = missing.filter((x) => x.step.request.modelId === m.id);
  const helpers = missing.filter((x) => x.step.request.modelId !== m.id);
  const ids = (xs: StepMode[]) => [...new Set(xs.flatMap((x) => providersOf(x.step)))];
  const label = (xs: ProviderId[]) => xs.map((id) => provider(id).label).join(" or ");
  const [ownIds, helperIds] = [ids(own), ids(helpers)];
  const parts: string[] = [];
  if (own.length) parts.push(`${makerName} runs on ${label(ownIds)}`);
  if (helpers.length) {
    const jobs = [...new Set(helpers.map((x) => HELPER_WORDS[x.step.request.modelId] ?? getModel(x.step.request.modelId)?.name ?? x.step.request.modelId))];
    parts.push(`${own.length ? listWords(jobs) : cap(listWords(jobs))} ${jobs.length > 1 ? "run" : "runs"} on ${label(helperIds)}`);
  }
  // The fewest keys that cover it: one provider both need, else one for each.
  const both = ownIds.filter((id) => helperIds.includes(id));
  const key = !own.length ? `a ${label(helperIds)} key` : !helpers.length ? `a ${label(ownIds)} key` : both.length ? `a ${label(both.slice(0, 1))} key` : `a ${label(helperIds)} key and a ${label(ownIds)} key`;
  const around = own.length ? otherModel(input) : undefined;
  return `${parts.join(", and ")} — add ${key} in Settings → Paid API configuration${around ? `, or ${around}` : ""}`;
}

/** Another model for the same job that runs with the keys set now (the way around a missing key). */
function otherModel(input: GenjutsuPlanInput): string | undefined {
  const runs = (id: string) => {
    const m = getModel(id);
    return !!m && isOffered(id, input.engine) && onEngine(m, input.engine).routes.some((r) => provider(r.provider).isConfigured());
  };
  const other = makersFor(input.engine, input.mode, input.target).find((x) => x.id !== input.maker.id && x.pair !== input.maker.id && runs(x.id));
  return other ? `pick ${other.label}` : undefined;
}

/** Whether a step's model has no route it could run on now (demo mode off: it would refuse). */
const unrunnable = (s: PlanStep) => !providersOf(s).some((id) => provider(id).isConfigured());

/** What the steps cost together (null when a price is unknown) and whether they would run as a demo. */
function price(steps: PlanStep[], input: GenjutsuPlanInput): { costUsd: number | null; demo: boolean; providers: ProviderId[]; tokenBilled: string[] } {
  let cost: number | null = 0;
  const modes: StepMode[] = [];
  const providers = new Set<ProviderId>();
  // Steps fal bills by tokens (the Sunburst first frame): left out of the total, and named.
  const tokenBilled = new Set<string>();
  let cannot = false;
  for (const s of steps) {
    let p: ReturnType<typeof previewChained>;
    try {
      p = previewChained(withChain(s), s.after?.length ?? 0);
    } catch (e) {
      // Demo mode off and no key for it: said with the other missing keys below.
      if (unrunnable(s)) {
        cannot = true;
        modes.push({ step: s, demo: true });
        continue;
      }
      if (e instanceof ConnectComfyError) throw e;
      throw new ShortsError((e as Error).message, 422);
    }
    modes.push({ step: s, demo: p.demo });
    providers.add(p.providerId);
    // Kling O3's edit price isn't the catalog's: the planner's table.
    const own = p.demo ? null : makerStepUsd(s.request.modelId, s.request.params);
    const usd = own ?? p.costUsd;
    const tokens = usd === null ? ANCHOR_MODELS.cloud.find((m) => m.id === s.request.modelId && m.tokens) : undefined;
    if (tokens) {
      tokenBilled.add(`${tokens.label}'s first frame is billed by tokens (${tokens.tokens}) and isn't in the price`);
      continue;
    }
    cost = cost === null || usd === null ? null : cost + usd;
  }
  const problem = mixProblem(modes, cannot, input);
  if (problem) throw new ShortsError(problem, 422);
  return { costUsd: cost === null ? null : Math.round(cost * 10000) / 10000, demo: modes.some((x) => x.demo), providers: [...providers], tokenBilled: [...tokenBilled] };
}

export interface GenjutsuEstimate {
  costUsd: number | null;
  demo: boolean;
  /** Where the steps run ("mock" for demo steps). */
  providers: ProviderId[];
  /** The model that runs (the default, or the one picked), its tier and where it comes from. */
  modelId: string;
  modelName: string;
  source: MakerSource;
  tier?: GenjutsuTier;
  /** The resolution it is asked for (none: it keeps the clip's size). */
  quality?: string;
  pieces: number;
  seconds: number;
  steps: number;
  notes: string[];
  /** Character swap: anchor frames made, the limits, and the GPU the open route was tested on. */
  anchors?: number;
  limits?: string[];
  gpu?: { weightsGb: number; tested: string; advice: string; speed: string };
}

export async function estimateGenjutsu(body: GenjutsuBody): Promise<GenjutsuEstimate> {
  const { input, maker, notes } = await planInput(body, { probe: false });
  let plan: ReturnType<typeof planGenjutsu>;
  try {
    plan = planGenjutsu(input);
  } catch (e) {
    if (e instanceof ConnectComfyError) throw e;
    throw new ShortsError((e as Error).message, 422);
  }
  const character = body.mode === "character";
  const { tokenBilled, ...cost } = price(plan.steps, input);
  return {
    ...cost,
    modelId: maker.id,
    modelName: getModel(maker.id)?.name ?? maker.label,
    source: maker.source,
    ...(maker.tier ? { tier: maker.tier } : {}),
    ...(qualityFor(maker, input.quality) ? { quality: qualityFor(maker, input.quality) } : {}),
    pieces: plan.pieces,
    seconds: Math.round((input.range.end - input.range.start) * 100) / 100,
    steps: plan.steps.length,
    notes: cost.demo ? notes : [...notes, ...tokenBilled],
    ...(plan.anchors !== undefined ? { anchors: plan.anchors } : {}),
    ...(character ? { limits: [...CHARACTER_LIMITS] } : {}),
    ...(character && maker.h3 && maker.engine === "open" ? { gpu: { ...CHARACTER_GPU } } : {}),
  };
}

/** Start it; returns the finished video's generation (the other steps wait for each other). */
export async function createGenjutsu(body: GenjutsuBody): Promise<{ final: Generation; items: Generation[] }> {
  const { input } = await planInput(body, { probe: true });
  try {
    const plan = planGenjutsu(input);
    // The same check as the estimate: nothing starts when only some of the steps have a provider.
    price(plan.steps, input);
    // A silent clip's cloud swap ends on silence: its WAV is written now (silenceRef, as Canvas mutes a clip).
    const withSilence = silenceWriter();
    const p = createPipeline(plan.steps.map((s) => ({ ...s, request: withSilence(s.request) })));
    return { final: p.byKey[plan.final], items: p.items };
  } catch (e) {
    if (e instanceof ShortsError) throw e;
    if (e instanceof ConnectComfyError) throw e;
    throw new ShortsError((e as Error).message, 422);
  }
}

// ---------------------------------------------------------------------------
// Character swap helpers: "Describe my character" and the part's words (Akatz Labs' description and transcript)

const DESCRIBE_SYSTEM =
  "You describe a character from one reference picture for a video model that will put them into a scene. Say only who they are and what they wear: " +
  "apparent age range, build, face, hair, skin tone, clothing, shoes, accessories and their colours. No pose, background, lighting, camera or art style, " +
  "no names, no guesses about personality. One plain sentence under 60 words, starting with \"a\" or \"an\", no quotes, no preamble.";

export const DescribeSchema = z.object({ engine: z.enum(["cloud", "open"]), image: z.string().startsWith("/api/files/").max(500) });

/**
 * "Describe my character": the engine's text model looks at the character picture and writes the description the
 * prompt and the anchor brief carry (Akatz Labs found generic prompts weak). Cloud: Claude, else a local model; your
 * GPU: a local vision model (Ollama, LM Studio or Unsloth Studio). A text model switched off in Settings → Models &
 * licences doesn't answer.
 */
export async function describeCharacter(body: z.infer<typeof DescribeSchema>): Promise<{ description: string }> {
  mustMatchMode(body.engine);
  const textModel = getModel(body.engine === "open" ? "oss-text-llm" : "text-llm");
  if (!textModel || !offeredModel(textModel)) throw new ShortsError(`The text model is switched off in ${ACCESS_PLACE} — describe your character in your own words`, 422);
  // A local model is asked on your GPU's engine (and when no Anthropic key is set): its server has to be running.
  const backend = llmTextBackend();
  const local = backend === "ollama" || (backend === "claude" && body.engine === "open");
  if (getSetting("demoMode") === "on" || !backend || (local && !(await probeOllama()))) {
    throw new ShortsError("Describing needs a text model: add an Anthropic key, or run a vision model in Ollama, LM Studio or Unsloth Studio (Settings → AI helper)", 422);
  }
  let file: Awaited<ReturnType<typeof readRef>>;
  try {
    file = await readRef(body.image);
  } catch {
    throw new ShortsError("Couldn't read the character picture — add it again", 422);
  }
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.contentType)) throw new ShortsError("Describe works on a PNG, JPEG or WebP picture", 422);
  const answer = await llmText(DESCRIBE_SYSTEM, "Describe the character in this picture.", [{ data: file.data, contentType: file.contentType }], { ollamaOnly: body.engine === "open" });
  const description = answer
    ?.replace(/^["“'\s]+|["”'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .slice(0, CHARACTER_SWAP.maxDescriptionChars);
  if (!description) throw new ShortsError(body.engine === "open" ? `${cap(localLabel())} didn't describe the picture — it needs a vision model (qwen3-vl, gemma3…)` : "The text model didn't answer — try again, or describe your character in your own words", 422);
  return { description };
}

/** The transcriber per engine (Fuobe's Transcribe studio's defaults). */
export const TRANSCRIBERS: Record<Engine, string> = { cloud: "scribe-v2", open: "oss-qwen3-asr" };

export const TranscribeSchema = z.object({
  engine: z.enum(["cloud", "open"]),
  source: z.object({ url: z.string().startsWith("/api/files/").max(500), duration: z.number().finite().positive().max(3600).optional() }),
});

/**
 * The clip's words, for "What's said": one transcription of the whole clip (word-timed cues), so any part picked
 * afterwards takes its own lines from it in the browser (partWords). A Genjutsu step: it stays out of the page's feed.
 */
export function transcribeClip(body: z.infer<typeof TranscribeSchema>): { id: string; modelId: string } {
  mustMatchMode(body.engine);
  const modelId = TRANSCRIBERS[body.engine];
  if (!isOffered(modelId, body.engine)) throw new ShortsError(`${getModel(modelId)?.name ?? modelId} is switched off in ${ACCESS_PLACE} — type the words instead`, 422);
  const seconds = body.source.duration;
  try {
    const [g] = createGenerations({
      feature: GENJUTSU.stepFeature,
      batchTitle: "Genjutsu · the clip's words",
      modelId,
      op: "transcribe",
      inputs: { video: body.source.url },
      ...(seconds ? { params: { duration: seconds, sourceDuration: seconds } } : {}),
      step: { label: "The clip's words", index: 0, of: 1 },
    });
    return { id: g.id, modelId };
  } catch (e) {
    if (e instanceof ConnectComfyError) throw e;
    throw new ShortsError((e as Error).message, 422);
  }
}
