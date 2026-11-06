/**
 * Elements: reusable characters, locations, props and styles that can be dropped into
 * any prompt with `@handle` (the parity studio's "Elements" / Soul ID). Resolution is pure so the
 * server (authoritative), the composer (live preview + cost) and the agent share it.
 */
import { identityFor, type TrainingFamily } from "./training";
import { imageLimit } from "./plan";
import type { Engine, GenParams, GenerationRequest, LoraRef, ModelDef, Operation } from "./types";

export type ElementKind = "character" | "location" | "prop" | "style" | "voice";

export const ELEMENT_KINDS: { kind: ElementKind; label: string; plural: string; noun: string; refs: number }[] = [
  { kind: "character", label: "Character", plural: "Characters", noun: "the person", refs: 3 },
  { kind: "location", label: "Location", plural: "Locations", noun: "the location", refs: 2 },
  { kind: "prop", label: "Prop", plural: "Props", noun: "the object", refs: 1 },
  { kind: "style", label: "Style", plural: "Styles", noun: "the visual style", refs: 2 },
  { kind: "voice", label: "Voice", plural: "Voices", noun: "the voice", refs: 0 },
];

export const elementKindInfo = (k: ElementKind) => ELEMENT_KINDS.find((x) => x.kind === k) ?? ELEMENT_KINDS[0];

/** Photos an element keeps: a Soul ID trains on up to 80 (the parity studio's web limit). */
export const MAX_ELEMENT_PHOTOS = 80;

/**
 * A trained LoRA for an element (Fuobe Soul ID, src/lib/catalog/training.ts). Since O3 it belongs to a family (its
 * base) and runs on every model of it, on both engines; before, to one model (`modelId`).
 */
export interface ElementLora {
  /** The engine it was trained on (it runs on both when usableOn says so). */
  engine: Engine;
  /** The model it was trained for: the family's lead model since O3 (fuobe-soul, fuobe-soul-hd). */
  modelId: string;
  /** Its base: the LoRA runs on every model of this family. Unset on LoRAs from before O3 (read from modelId). */
  family?: TrainingFamily;
  /** The training target that made it. */
  target?: string;
  /** ComfyUI models/loras file name (unique per training: fuobe/<handle>-<id>.safetensors). */
  file: string;
  /** A URL the cloud LoRA endpoints fetch (fal's copy of a cloud training). */
  url?: string;
  /** Fuobe keeps its own copy of the file (src/server/loras.ts TRAINED_DIR): it can go to ComfyUI or the cloud. */
  own?: true;
  trigger: string;
  strength?: number;
  trainedAt?: number;
  /** A demo training's stand-in (no key, no GPU): nothing was trained, so no run uses it. */
  demo?: true;
  /** An older Soul ID (the retired provider's, before O3): a reference id no current model takes. Retrain for Fuobe Soul. */
  referenceId?: string;
}

/**
 * A voice made with Design a voice, on the element that keeps it: its clip (references[0], the take
 * picked) is what later lines clone, on either engine. The cloud's Qwen3-TTS reuses a voice by cloning that clip into an
 * embedding file, which Fuobe keeps after its first cloud line (src/server/voices.ts), so it isn't cloned again.
 */
export interface ElementVoice {
  /** The model that made it (oss-qwen3-tts, oss-voxcpm2, qwen-3-tts). */
  modelId: string;
  engine: Engine;
  /** The words it was designed from. */
  description?: string;
  /** What the clip says (the take's test line): VoxCPM2's closest ("ultimate") clone and Qwen3-TTS's reference text. */
  transcript?: string;
  /** Qwen3-TTS's embedding of the clip on fal, stored by Fuobe (/api/files/…). */
  embedding?: string;
}

/** Element voices: the most an ElementVoice's words hold (the API and the form keep to these). */
export const VOICE_DESCRIPTION_MAX = 500;
export const VOICE_TRANSCRIPT_MAX = 1000;

export interface StudioElement {
  id: string;
  name: string;
  handle: string;
  kind: ElementKind;
  description: string | null;
  references: string[];
  loras: ElementLora[];
  /** A designed voice's model, words and (once the cloud has cloned it) embedding: voices only. */
  voice?: ElementVoice;
  status: "ready" | "training" | "failed";
  createdAt: number;
}

/**
 * What a model does with @mentioned Elements, for the mention menu, when it has elements of its own (Kling 4.0): how many,
 * which kinds, and that voices aren't sent (they need the provider's voice ids, which Fuobe can't make).
 */
export function elementsNote(model: Pick<ModelDef, "name" | "options"> | undefined): string | undefined {
  const e = model?.options.elements;
  if (!e) return undefined;
  return `${model!.name}: characters and props go as its elements, up to ${e.max} (a photo and ${e.views} more angles, or a clip) · voices aren't used`;
}

/** `Maya Lopez` → `Maya_Lopez`. Letters, digits, `_` and `-` only. */
export function handleFor(name: string): string {
  return (
    name
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^\p{L}\p{N}_-]/gu, "")
      .slice(0, 40) || "element"
  );
}

const MENTION = /@([\p{L}\p{N}_-]+)/gu;

/** Elements mentioned in a prompt, in order of first mention, without duplicates. */
export function findMentions(prompt: string | undefined, elements: StudioElement[]): StudioElement[] {
  if (!prompt || !elements.length) return [];
  const byHandle = new Map(elements.map((e) => [e.handle.toLowerCase(), e]));
  const out: StudioElement[] = [];
  for (const m of prompt.matchAll(MENTION)) {
    const el = byHandle.get(m[1].toLowerCase());
    if (el && !out.includes(el)) out.push(el);
  }
  return out;
}

/** The `@partial` being typed at the caret, if any. */
export function mentionAtCaret(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(“"'])@([\p{L}\p{N}_-]*)$/u.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

export interface MentionResolution {
  request: GenerationRequest;
  mentioned: StudioElement[];
  /** Human notes, e.g. "Maya is described in words — Kling 2.5 can't take reference images". */
  notes: string[];
}

const ops = (m: ModelDef) => new Set(m.routes.map((r) => r.op));

/** A reference that is a clip (a video element), by its file's extension. */
const isClipRef = (ref: string) => /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(ref);

/** Element kinds a model's own elements stand for (Kling 4.0: "characters/objects"). */
const ELEMENT_KINDS_AS_ELEMENTS = new Set<ElementKind>(["character", "prop"]);

/**
 * Which mentioned Elements go as the model's own elements (ModelOptions.elements), and on which route: the run's own
 * operation when it takes elements (an edit), else reference-to-video for a clip from words alone (as references do,
 * never in place of a start or end frame). Null when the model has none, or nothing mentioned fits.
 */
function elementPlan(req: GenerationRequest, model: ModelDef, mentioned: StudioElement[], op: Operation | undefined) {
  const spec = model.options.elements;
  if (!spec) return null;
  const takes = new Set(spec.ops);
  const existing = req.inputs?.images?.length ?? 0;
  const target: Operation | undefined =
    op && takes.has(op) ? op : takes.has("ref2v") && model.kind === "video" && (!op || op === "t2v") && !existing && !req.inputs?.endImage ? "ref2v" : undefined;
  if (!target) return null;
  const fit = mentioned.filter((e) => ELEMENT_KINDS_AS_ELEMENTS.has(e.kind) && e.references.length);
  if (!fit.length) return null;
  return { op: target, elements: fit.slice(0, spec.max), left: fit.slice(spec.max) };
}

/**
 * Turn `@handle` mentions into reference images (or a trained LoRA + trigger word) and a
 * prompt that tells the model which image is which. Leaves the request alone when nothing
 * is mentioned.
 */
export function applyMentions(asked: GenerationRequest, model: ModelDef, elements: StudioElement[]): MentionResolution {
  // "Run without LoRAs": none of the request's own either.
  const req = asked.lorasOff && asked.loras ? { ...asked, loras: undefined } : asked;
  // Shots (multi-shot) can mention elements too.
  const shots = req.params?.shots;
  // Voices are picked in the voice menu, not mentioned in visual prompts.
  const visual = elements.filter((e) => e.kind !== "voice");
  const mentioned = findMentions([req.prompt ?? "", ...(shots ?? []).map((s) => s.prompt)].join("\n"), visual);
  if (!mentioned.length) return { request: req, mentioned, notes: [] };

  const notes: string[] = [];
  const has = ops(model);
  const existing = [...(req.inputs?.images ?? [])];
  let op: Operation | undefined = req.op;

  // Where can references go?
  let budget = 0;
  if (model.kind === "image" && has.has("edit")) {
    budget = Math.max(0, (model.options.maxImages ?? 1) - existing.length);
    if (!op || op === "t2i") op = undefined; // edit is inferred once images are attached
  } else if (model.kind === "video" && has.has("ref2v") && !req.inputs?.endImage && (existing.length === 0 || op === "ref2v")) {
    budget = Math.max(0, (model.options.maxImages ?? 4) - existing.length);
  }

  // LoRAs win over references for the model they were trained on.
  const loras: LoraRef[] = [...(req.loras ?? [])];
  const viaLora = new Set<string>();
  // (Asked without LoRAs: every element goes in as its photos.)
  for (const el of req.lorasOff ? [] : mentioned) {
    // A trained LoRA of this model's family, on the engine it runs on (Fuobe Soul ID). An older Soul ID kept only by
    // a reference id runs nowhere: the element is retrained on its photos.
    const l = identityFor(el.loras, model);
    if (!l) continue;
    loras.push({ file: l.file, ...(l.url && { url: l.url }), strength: l.strength ?? 1, trigger: l.trigger, ...(l.own && { own: true as const }) });
    viaLora.add(el.id);
  }

  // Kling 4.0 takes characters and props as its own elements (@Element1..: a frontal photo and up to 3 more angles, or a
  // short clip), on the routes that have them; locations and styles stay reference images.
  const asElement = elementPlan(req, model, mentioned.filter((e) => !viaLora.has(e.id)), op);
  if (asElement) op = asElement.op;
  const elementNo = new Map<string, number>((asElement?.elements ?? []).map((e, i) => [e.id, i + 1]));
  if (asElement) budget = Math.max(0, (imageLimit(model, asElement.op) ?? model.options.maxImages ?? 4) - existing.length);

  // Share the reference budget: one image each first, then fill up to each kind's ideal count.
  const wanted = mentioned.filter((e) => !viaLora.has(e.id) && !elementNo.has(e.id) && e.references.length);
  const take = new Map<string, number>(wanted.map((e) => [e.id, 0]));
  let left = budget;
  for (let round = 0; left > 0; round++) {
    let gave = false;
    for (const e of wanted) {
      const want = Math.min(e.references.length, elementKindInfo(e.kind).refs);
      if (left > 0 && take.get(e.id)! < want && take.get(e.id)! === round) {
        take.set(e.id, round + 1);
        left--;
        gave = true;
      }
    }
    if (!gave) break;
  }

  const images = [...existing];
  const positions = new Map<string, number[]>();
  for (const e of wanted) {
    const n = take.get(e.id) ?? 0;
    const pos: number[] = [];
    for (const ref of e.references.slice(0, n)) {
      images.push(ref);
      pos.push(images.length);
    }
    positions.set(e.id, pos);
  }
  if (model.kind === "video" && images.length > existing.length && !asElement) op = "ref2v";
  // The elements' files go after every reference image, so the references keep the numbers the legend gives them.
  const groups: NonNullable<GenParams["elements"]> = [];
  const videos = [...(req.inputs?.videos ?? [])];
  for (const el of asElement?.elements ?? []) {
    const clip = el.references.find(isClipRef);
    if (clip && groups.filter((g) => g.video !== undefined).length < (model.options.elements?.videos ?? 0)) {
      videos.push(clip);
      groups.push({ video: videos.length - 1 });
      continue;
    }
    const photos = el.references.filter((r) => !isClipRef(r)).slice(0, 1 + (model.options.elements?.views ?? 3));
    const at = photos.map((r) => images.push(r) - 1);
    groups.push({ images: at });
  }

  // Rewrite the prompt: "@Maya" → "Maya", plus who/what each image is.
  const seen = new Set<string>();
  const rewrite = (text: string) => text.replace(MENTION, (whole, h: string) => {
    const el = mentioned.find((e) => e.handle.toLowerCase() === h.toLowerCase());
    if (!el) return whole;
    // An element is named as the model names it.
    if (elementNo.has(el.id)) return `@Element${elementNo.get(el.id)}`;
    const first = !seen.has(el.id);
    seen.add(el.id);
    const lora = loras.find((l) => viaLora.has(el.id) && el.loras.some((x) => x.file === l.file));
    if (lora?.trigger && first) return `${lora.trigger} ${el.name}`;
    if (viaLora.has(el.id)) return el.name;
    if (first && !positions.get(el.id)?.length && !viaLora.has(el.id) && el.description) return `${el.name} (${el.description.replace(/[.\s]+$/, "")})`;
    return el.name;
  });
  let prompt = rewrite(req.prompt ?? "");
  const newShots = shots?.map((s) => ({ ...s, prompt: rewrite(s.prompt) }));
  const legend = mentioned
    .map((e) => {
      const pos = positions.get(e.id) ?? [];
      if (!pos.length) return null;
      const which = pos.length === 1 ? `image ${pos[0]}` : `images ${pos.slice(0, -1).join(", ")} and ${pos[pos.length - 1]}`;
      const noun = elementKindInfo(e.kind).noun;
      return e.kind === "character"
        ? `${e.name} is ${noun} in ${which} — keep their exact face, identity, skin tone and hair`
        : e.kind === "style"
          ? `Use ${noun} of ${which} for ${e.name}`
          : `${e.name} is ${noun} in ${which}`;
    })
    .filter(Boolean);
  if (legend.length) prompt = `${prompt.trim().replace(/[.\s]+$/, "")}${prompt.trim() ? ". " : ""}${legend.join(". ")}.`;

  for (const e of asElement?.left ?? []) notes.push(`${e.name} is described in words — ${model.name} takes up to ${model.options.elements?.max} elements`);
  for (const e of mentioned) {
    if (viaLora.has(e.id) || elementNo.has(e.id)) continue;
    if (!positions.get(e.id)?.length) {
      notes.push(
        budget === 0
          ? `${e.name} is described in words — ${model.name} can't take reference images here`
          : `${e.name} is described in words — no room for more reference images`,
      );
    }
  }

  return {
    request: {
      ...req,
      op,
      prompt,
      inputs: { ...req.inputs, images: images.length ? images : undefined, ...(videos.length > (req.inputs?.videos?.length ?? 0) && { videos }) },
      loras: loras.length ? loras : undefined,
      params: { ...req.params, ...(newShots && { shots: newShots }), ...(groups.length && { elements: groups }) },
    },
    mentioned,
    notes,
  };
}
