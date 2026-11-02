/**
 * The run a composer's draft asks for (what Generate sends): its own module, so a test can build the run an example's
 * draft makes (tests/examples-catalog.test.ts) the way the composer does.
 */
import type { Engine, GenerationRequest, MediaKind, Operation } from "@/lib/catalog/types";
import type { FrameSupport } from "@/lib/catalog/keyframes";
import { framesRequest, layoutRequest } from "@/lib/composer";
import type { SlotValue } from "./media-slot";
import type { Draft } from "./studio-context";

/** Frames mode, as the request needs it: what the model does with frames, the clip's length, and whether it's the open chain. */
export interface FramesContext {
  support: FrameSupport;
  duration: number;
  chained: boolean;
}

export function buildRequest(
  feature: string,
  draft: Pick<Draft, "slots" | "refs" | "presetId" | "modelId" | "prompt" | "negativePrompt" | "params" | "presetOptions" | "presetStrength" | "mix" | "frames" | "layout">,
  op: Operation | undefined,
  promptSuffix?: string,
  refKind: MediaKind = "image",
  frames?: FramesContext,
  /**
   * The model's needs: a Fuobe Original (runs on both engines) names the engine switched to; a model that takes
   * looks (Fuobe Soul) takes the look's strength with its default look too (no presetId).
   */
  target: { engine?: Engine; looks?: boolean } = {},
): GenerationRequest {
  const s = draft.slots;
  const refs = draft.refs.filter((x) => !!x?.ref).map((x) => x.ref);
  let images = [s.image, s.image2, s.image3].filter((x): x is SlotValue => !!x?.ref).map((x) => x.ref).concat(refKind === "image" ? refs : []);
  const videos = refKind === "video" ? refs : [];
  let endImage = s.endImage?.ref || undefined;
  let params = draft.params;
  let pinned = op;
  // Frames mode: the stills in order at their times (or the first and last as start and end frame), at the strip's length.
  if (draft.frames && frames) {
    const sent = framesRequest(draft.frames, frames);
    images = sent.images;
    endImage = sent.endImage;
    params = { ...params, ...sent.params };
    pinned = op ?? sent.op;
  }
  // Layout mode: the boxes ride as params.extra.layout, captioned with the prompt; the plan compiles them for the model.
  if (draft.layout) params = layoutRequest(draft.layout, draft.prompt, params).params;
  return {
    feature,
    presetId: draft.presetId,
    modelId: draft.modelId,
    op: pinned,
    prompt: promptSuffix && draft.prompt.trim() ? `${draft.prompt.trim().replace(/[.\s]+$/, "")}. ${promptSuffix}` : draft.prompt,
    negativePrompt: draft.negativePrompt || undefined,
    inputs: {
      images: images.length ? images : undefined,
      endImage,
      mask: s.mask?.ref || undefined,
      sketch: s.sketch?.ref || undefined,
      voiceAudio: s.voiceAudio?.ref || undefined,
      voiceAudio2: s.voiceAudio2?.ref || undefined,
      video: s.video?.ref || undefined,
      audio: s.audio?.ref || undefined,
      videos: videos.length && !draft.frames ? videos : undefined,
    },
    params,
    presetOptions: draft.presetOptions,
    ...((draft.presetId || target.looks) && draft.presetStrength !== undefined && draft.presetStrength < 1 && { presetStrength: draft.presetStrength }),
    ...(draft.presetId && draft.mix && { mix: draft.mix }),
    ...(target.engine && { engine: target.engine }),
  };
}

