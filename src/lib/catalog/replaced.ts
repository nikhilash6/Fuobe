/**
 * What replaced each retired model, look and training target when Fuobe stopped calling Higgsfield's API (build plan O7,
 * docs/research/fuobe-originals-recipes-5.md, "What replaces each Higgsfield model when the provider is removed").
 *
 * One way only: an id stored before the switch — a past generation's Reuse, a saved Cinema or Canvas project, an Assist
 * plan, a Genjutsu setup code, a Katana job, a moodboard pick, a training — resolves here to the model that does the job
 * now, a Fuobe Original where there is one, else a partner model on fal or Replicate. Nothing here is ever sent to a
 * provider. Past generations stay viewable as they are: the Library reads their saved outputs, not a provider.
 *
 * Soul's old style ids resolve to Fuobe looks through lookCard() (each look keeps the id it replaces, never sent);
 * Genjutsu's old looks are dropped (a Soul look or your own images replace them).
 *
 * Pure and browser-safe (cards only, no recipes); shared by the browser and the server. tests/no-higgsfield.test.ts checks every target exists.
 */
import { lookCard } from "./soul-cards";
import type { Operation } from "./types";

/** Where one operation of a retired (or partner) model went, when the replacement doesn't do it under the same name. */
export interface OpReplacement {
  /** Another model that does it (else the replacement's own). */
  id?: string;
  /** The operation's name there (else the same). */
  op?: Operation;
  /** One line on what changed, instead of the model's note. */
  note?: string;
}

export interface Replacement {
  /** The model (or training target) that does the job now. */
  id: string;
  /** What the retired item was called, for history (the Library, Assist, an old setup). */
  was: string;
  /** One line on what changed, shown where an old setup or run is opened again. */
  note: string;
  /**
   * A Fuobe Original (both engines). A stored request names no engine (the retired model ran in the cloud only because
   * its provider was a cloud API), so it runs where the install runs an Original: its engine mode, else the first
   * engine connected (GenerationRequest.engine).
   */
  original?: true;
  /** Operations the replacement doesn't do under the same name. */
  ops?: Partial<Record<Operation, OpReplacement>>;
  /** The operation a stored request with images or clips and no op ran as (the retired model read them that way). */
  withReferences?: Operation;
  /** Its request carried Cinema Studio's own Director fields (genre, era, lens…): they become prompt words, and the note says what became of them. */
  director?: true;
}

/** Retired model id → the model that replaced it. */
export const REPLACED_BY: Readonly<Record<string, Replacement>> = {
  "soul-1": { id: "fuobe-soul", was: "Soul (Higgsfield)", note: "Soul now runs as Fuobe Soul, with Soul's 106 looks on open weights", original: true },
  "soul-2": { id: "fuobe-soul", was: "Soul 2.0 (Higgsfield)", note: "Soul 2.0 now runs as Fuobe Soul, with Soul 2.0's 33 looks on open weights", original: true },
  "soul-cinema": { id: "fuobe-soul-cinema", was: "Soul Cinema (Higgsfield)", note: "Soul Cinema now runs as Fuobe Soul Cinema on open weights", original: true },
  "cinema-studio-4": {
    id: "fuobe-cinema",
    was: "Cinema Studio 4.0 (Higgsfield)",
    note: "Cinema Studio's clips now run on Fuobe Cinema",
    original: true,
    director: true,
    // It had no start-frame route: images were references (cast, location). Fuobe Cinema takes none yet, so a reference
    // take runs where the Cinema studio sends one (cinema.ts clipModel): Seedance 2.5, a partner model on fal.
    withReferences: "ref2v",
    ops: { ref2v: { id: "seedance-2-5", note: "Cinema Studio's reference takes now run on Seedance 2.5 (Fuobe Cinema takes no references yet)" } },
  },
  "genjutsu-motion-transfer": { id: "fuobe-genjutsu-motion", was: "Genjutsu Motion Transfer (Higgsfield)", note: "Motion transfer now runs on Fuobe Genjutsu (Wan Animate)", original: true },
  "genjutsu-lite-motion-transfer": { id: "fuobe-genjutsu-motion-lite", was: "Genjutsu Lite Motion Transfer (Higgsfield)", note: "Motion transfer Lite now runs on Fuobe Genjutsu Lite", original: true },
  // Its v2v and video-swap routes were the same endpoint.
  "genjutsu-object-swap": { id: "fuobe-genjutsu-swap", was: "Genjutsu Object Swap (Higgsfield)", note: "Object swap now runs on Fuobe Genjutsu (SAM 3.1 + Wan VACE)", original: true, ops: { v2v: { op: "video-swap" } } },
  "genjutsu-lite-object-swap": { id: "fuobe-genjutsu-swap-lite", was: "Genjutsu Lite Object Swap (Higgsfield)", note: "Object swap Lite now runs on Fuobe Genjutsu Lite", original: true },
  "genjutsu-restyle": { id: "fuobe-genjutsu-restyle", was: "Genjutsu Restyle (Higgsfield)", note: "Restyle now runs on Fuobe Genjutsu with a Fuobe look", original: true },
  // Marketing Studio Image's Original (O10): Qwen-Image-Edit 2511 with Fuobe's format templates on both engines.
  "marketing-studio-image": { id: "fuobe-marketing-image", was: "Marketing Studio Image (Higgsfield)", note: "Marketing images now run on Fuobe Marketing Image (Qwen-Image-Edit 2511) with Fuobe's format prompts", original: true },
  // Ads Studio's one-shot ad became Fuobe's Ads pipeline (copy, then a visual, composited in the browser); a single run reuses its visual model.
  "ads-studio": { id: "fuobe-marketing-image", was: "Ads Studio (Higgsfield)", note: "Ads now come from Fuobe's Ads pipeline: written copy, a Fuobe Marketing Image visual and your fonts", original: true },
  // The AI Influencer sheet runs on Fuobe Soul (O10), as the builder's does: the Realistic look, a wide sheet.
  "ai-influencer": { id: "fuobe-soul", was: "AI Influencer (Higgsfield)", note: "The AI Influencer sheet now runs on Fuobe Soul (the Soul Cast sheet on your GPU)", original: true },
};

/** Retired training targets (Higgsfield Soul ID) → the trainer that makes a Fuobe Soul ID from the same photos. */
export const TRAINING_REPLACED_BY: Readonly<Record<string, Replacement>> = {
  "soul-id-v2": { id: "fal-z-image", was: "Soul ID for Soul 2.0 (Higgsfield)", note: "Train the character again for Fuobe Soul on the same photos" },
  "soul-id-cinema": { id: "fal-z-image", was: "Soul ID for Soul Cinema (Higgsfield)", note: "Train the character again for Fuobe Soul on the same photos" },
};

/**
 * Operations of current partner models that only the retired provider ran (build plan, "What replaces each Higgsfield
 * model": the lost ops) → the model that does them now.
 */
export const OPS_REPLACED_BY: Readonly<Record<string, Partial<Record<Operation, OpReplacement>>>> = {
  // bytedance/seedance-2.5/video-edit isn't on fal: Kling O3's edit takes the clip and @images the same way.
  "seedance-2-5": { v2v: { id: "kling-o3", note: "Seedance 2.5's video edit isn't offered any more: this edit runs on Kling O3" } },
  // LTX-2.3 on fal takes an end frame (end_image_url): Fuobe Cinema's start/end-frame route, on either engine.
  "ltx-2-5": { flf2v: { id: "fuobe-cinema", note: "LTX 2.5's start/end-frame clip isn't offered any more: it runs on Fuobe Cinema (LTX-2.3)" } },
};

/** The replacement of a retired model id, or undefined for a current one. */
export const replacedBy = (id: string | undefined | null): Replacement | undefined => (id && Object.hasOwn(REPLACED_BY, id) ? REPLACED_BY[id] : undefined);

/** The id to use for a stored model id: its replacement when it was retired, else itself. */
export const currentModelId = (id: string): string => replacedBy(id)?.id ?? id;

/**
 * Where a stored model and operation run now: the retired model's replacement (with the operation's own target when
 * it has one, OpReplacement), or a current partner model's lost operation (OPS_REPLACED_BY). Undefined when nothing
 * changed. `op` is set only when it changes.
 */
export function replacementOf(modelId: string, op?: Operation): { id: string; op?: Operation; note: string; original: boolean } | undefined {
  const r = replacedBy(modelId);
  if (!r) {
    const lost = op && Object.hasOwn(OPS_REPLACED_BY, modelId) ? OPS_REPLACED_BY[modelId][op] : undefined;
    return lost && { id: lost.id ?? modelId, ...(lost.op && { op: lost.op }), note: lost.note ?? `${modelId} now runs ${op} elsewhere`, original: false };
  }
  const moved = op ? r.ops?.[op] : undefined;
  return { id: moved?.id ?? r.id, ...(moved?.op && { op: moved.op }), note: moved?.note ?? r.note, original: !moved?.id && !!r.original };
}

/** The settings keys a retired model's request carried that mean nothing to its replacement (style ids, Soul ID refs, looks). */
const RETIRED_EXTRA = ["style_id", "custom_reference_id", "custom_reference_strength", "preset_id", "color_palette", "template_id"] as const;

/** Cinema Studio 4.0's own Director fields (params.extra): words for any other model (cinema.ts directorFieldWords). */
export const DIRECTOR_FIELDS = ["genre", "era", "pacing", "camera_model", "camera_lens", "camera_aperture", "light", "color_palette", "camera_movement"] as const;

interface StoredRequest {
  modelId: string;
  op?: Operation;
  prompt?: string;
  presetId?: string;
  inputs?: { images?: string[]; videos?: string[]; audios?: string[] };
  params?: { extra?: Record<string, unknown> };
}

export interface MigrateOptions {
  /**
   * Cinema Studio's Director fields as prompt words (the server passes cinema.ts directorFieldWords; without it, as in
   * the browser, the fields are dropped).
   */
  directorWords?: (fields: Record<string, string>) => string;
}

const sentence = (a: string | undefined, b: string): string => {
  const head = (a ?? "").trim().replace(/[.\s]+$/, "");
  return head ? `${head}. ${b}` : b;
};

/** Mureka's earlier song versions, run by the versioned route's model (mureka-8 · its Version control). */
const MUREKA_EARLIER = new Set(["mureka-8", "mureka-o2", "mureka-7.6"]);

/**
 * A Mureka song saved with its Version (params.extra.model, when mureka-song ran every version on one route) goes to the
 * model that runs that version now: Mureka 9 to its own model, 8, O2 and 7.6 to Mureka 8 with the Version kept; 9.5 stays
 * (the setting is dropped). The same version runs, so nothing to say. Null for any other request.
 */
function murekaVersion<T extends StoredRequest>(req: T): T | null {
  const version = req.modelId === "mureka-song" ? req.params?.extra?.model : undefined;
  if (typeof version !== "string") return null;
  if (MUREKA_EARLIER.has(version)) return { ...req, modelId: "mureka-8" };
  if (version !== "mureka-9" && version !== "mureka-9.5") return null;
  const extra = { ...req.params!.extra };
  delete extra.model;
  const params = { ...req.params, extra: Object.keys(extra).length ? extra : undefined };
  if (!params.extra) delete params.extra;
  return { ...req, ...(version === "mureka-9" && { modelId: "mureka-9" }), params };
}

/**
 * A stored request (Reuse, a saved project's step, an Assist plan, a retry, a script) moved to the model that does its
 * job now, with what still means something kept: a Soul style id becomes the Fuobe look that replaced it (`presetId`),
 * Cinema Studio's Director fields become prompt words, the retired API's own settings (style, Soul ID reference, Genjutsu
 * look) are dropped, and an operation the replacement doesn't do goes where OpReplacement says (also for the partner
 * models' lost ops, OPS_REPLACED_BY). An Original gets no engine: the install picks it. A current model's request is
 * returned as it is. `note` says what changed, for a toast or the API's notes.
 */
export function migrateRequest<T extends StoredRequest>(req: T, opts: MigrateOptions = {}): { request: T; note?: string } {
  const version = murekaVersion(req);
  if (version) return { request: version };
  const r = replacedBy(req.modelId);
  const refs = !!(req.inputs?.images?.length || req.inputs?.videos?.length || req.inputs?.audios?.length);
  const op = req.op ?? (r?.withReferences && refs ? r.withReferences : undefined);
  const to = replacementOf(req.modelId, op);
  if (!to) return { request: req };
  const newOp = to.op ?? op;
  if (!r) return { request: { ...req, modelId: to.id, ...(newOp && newOp !== req.op && { op: newOp }) } as T, note: to.note };
  const extra = { ...(req.params?.extra ?? {}) };
  const look = typeof extra.style_id === "string" ? lookCard(extra.style_id) : undefined;
  let prompt = req.prompt;
  let note = to.note;
  if (r.director) {
    const fields: Record<string, string> = {};
    for (const k of DIRECTOR_FIELDS) {
      if (typeof extra[k] === "string" && extra[k]) fields[k] = extra[k] as string;
      delete extra[k];
    }
    const words = Object.keys(fields).length && opts.directorWords ? opts.directorWords(fields).trim() : "";
    if (words) prompt = sentence(prompt, words);
    // The browser has no words to write (Reuse): the settings are left out, and the toast says so.
    if (Object.keys(fields).length) note += words ? ", with the Director settings written into the prompt" : "; its Director settings (genre, era, lens, light…) were left out: pick them again in Cinema Studio";
  }
  for (const k of RETIRED_EXTRA) delete extra[k];
  const params = req.params ? { ...req.params, ...(req.params.extra && { extra }) } : undefined;
  if (params?.extra && !Object.keys(params.extra).length) delete params.extra;
  const request = {
    ...req,
    modelId: to.id,
    ...(newOp && newOp !== req.op && { op: newOp }),
    ...(params && { params }),
    ...(look && { presetId: look.id }),
    ...(prompt !== req.prompt && { prompt }),
  } as T;
  return { request, note };
}
