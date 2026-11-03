import "server-only";
import { inferOperation } from "@/lib/catalog/plan";
import type { Generation, GenerationRequest, ModelDef } from "@/lib/catalog/types";
import { planVoiceFirst, voiceFirstApplies, voiceSource, VOICE_FIRST_LABEL, VOICE_FIRST_MODELS, type VoiceFirstPlan } from "@/lib/av/voice-first";
import { getModel } from "@/lib/catalog";
import { createPipeline, withAsked } from "./chains";
import { storedMedia } from "./storage";

/**
 * "Clean the voice first" on the server (src/lib/av/voice-first.ts plans it): a request with `voiceFirst` becomes one
 * batch of steps, the clean voice before the transcript or lip sync and, for a lip re-sync on your GPU, the clip's music
 * and effects put back after it. Every studio that sends a transcript or a lip sync through createGenerations gets it
 * (Transcribe, Captions, Lipsync & avatars, Genjutsu's "What's said", Character Swap Studio's transcript).
 *
 * The files read are the request's own (the route checked them for an account, account-inputs.ts), and their headers are
 * read through storedMedia, which inside an account's run sees only the account's files.
 */

/** A file's length, channels and sound from its header (null when nothing reads it). */
function facts(url: string | undefined): { duration?: number; channels?: number; hasAudio?: boolean } | null {
  if (!url) return null;
  const info = storedMedia(url, { allContainers: true })?.info;
  if (!info) return null;
  return { ...(info.duration && info.duration > 0 && { duration: info.duration }), ...(info.channels && { channels: info.channels }), hasAudio: info.hasAudio };
}

/** The steps a request with "Clean the voice first" runs as, or null when it doesn't apply (no speech attached, another operation). */
export function voiceFirstPlanFor(req: GenerationRequest, model: ModelDef): VoiceFirstPlan | null {
  if (!req.voiceFirst) return null;
  const op = inferOperation(model, req);
  if (!voiceFirstApplies(req, op)) return null;
  const src = voiceSource(req, op)!;
  const heard = facts(src.url);
  // A recording with no sound in it: nothing to clean, and the run itself says what's wrong.
  if (heard?.hasAudio === false) return null;
  const clip = op === "lipsync" && req.inputs?.video ? facts(req.inputs.video) : null;
  return planVoiceFirst({
    request: { ...req, op },
    op,
    engine: model.engine,
    seconds: req.params?.sourceDuration ?? heard?.duration,
    channels: heard?.channels,
    clipHasSound: clip ? clip.hasAudio : undefined,
    clipChannels: clip?.channels,
  });
}

/** Why the clean voice can't run, in the studio's words (its model switched off, the other engine only…). */
function refused(e: unknown, plan: VoiceFirstPlan): Error {
  const msg = (e as Error).message ?? String(e);
  const step = /^Step “(\w+)”: (.*)$/s.exec(msg);
  if (!step || step[1] === "main") return new Error(step ? step[2] : msg);
  const model = getModel(plan.steps.find((s) => s.key === step[1])?.request.modelId ?? VOICE_FIRST_MODELS.open);
  return new Error(`${VOICE_FIRST_LABEL} can't run${model ? ` (${model.name})` : ""}: ${step[2]}. Turn it off to run without it`);
}

/**
 * The run as steps (one batch), its result first, as createMosaicRun returns it: a caller that takes the first row (a
 * studio's card, Genjutsu's transcript id) gets the transcript or the lip sync. Null when the switch doesn't apply.
 */
export function createVoiceFirstRun(req: GenerationRequest, model: ModelDef, opts: { batchId?: string } = {}): Generation[] | null {
  const plan = voiceFirstPlanFor(req, model);
  if (!plan) return null;
  let made: ReturnType<typeof createPipeline>;
  try {
    made = createPipeline(plan.steps, { ...(opts.batchId && { batchId: opts.batchId }) });
  } catch (e) {
    throw refused(e, plan);
  }
  const result = made.byKey[plan.result];
  // The result keeps the request as asked (the switch on, the file given), so Reuse and a skill run it the same way.
  return withAsked([result, ...made.items.filter((g) => g.id !== result.id)], req, model.engine);
}
