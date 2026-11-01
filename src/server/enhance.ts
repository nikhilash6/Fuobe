import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MediaKind, Operation } from "@/lib/catalog/types";
import { writeCaption } from "@/lib/ideogram-caption";
import { activeLocal, aiHelper, chatLocal, type JsonSpec } from "./llm";
import { engineMode, getSetting } from "./settings";
import { tenant } from "./tenant";

/**
 * "Enhance prompt": rewrite a short idea into a rich, model-friendly prompt.
 * Order: Claude (if an Anthropic key is set) → a local model (Ollama, LM Studio, Unsloth Studio…) → offline heuristic.
 */

const SYSTEM = `You rewrite short creative ideas into prompts for image and video generation models.
Rules:
- Keep the user's subject, intent and any quoted text exactly.
- Add concrete visual detail: subject, setting, lighting, lens/camera, composition, mood, style.
- For video, describe motion and camera movement in time order (e.g. "slow dolly in, then the subject turns").
- For edits (an input image is attached), write an instruction that says what to change and what to keep.
- One paragraph, under 90 words, no preamble, no quotes around the answer, no lists.`;

function instruction(prompt: string, kind: MediaKind, op: Operation): string {
  const what =
    op === "edit" || op === "inpaint"
      ? "an image-editing instruction"
      : kind === "video"
        ? op === "t2v"
          ? "a text-to-video prompt"
          : "an image-to-video motion prompt (the first frame is already given; focus on motion and camera)"
        : "a text-to-image prompt";
  return `Rewrite this as ${what}:\n\n${prompt}`;
}

/** A picture for a model that can see (Content Factory's reference frames): JPEG, PNG, GIF or WebP. */
export interface LlmImage {
  data: Buffer;
  contentType: string;
}

async function viaClaude(system: string, user: string, images: LlmImage[] = []): Promise<string | null> {
  const client = new Anthropic({ apiKey: getSetting("anthropicKey") });
  const content = images.length
    ? [
        ...images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.contentType as "image/jpeg", data: i.data.toString("base64") } })),
        { type: "text" as const, text: user },
      ]
    : user;
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: images.length ? 4096 : 1024,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content }],
  } as Parameters<typeof client.beta.messages.create>[0] & { fallbacks: string });
  if (!("content" in res) || res.stop_reason === "refusal") return null;
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || null;
}

export interface LlmTextOptions {
  /** The JSON Schema the answer follows on a local model (Claude follows the prompt); see JsonSpec. */
  json?: JsonSpec;
  /** How long to wait (default: 60 s, or 3 minutes with pictures or when the local model isn't loaded yet). */
  timeoutMs?: number;
  /** The open engine: a local model, never Claude (the AI helper set to Offline still means none). */
  ollamaOnly?: boolean;
}

/** The local model in use (Ollama, LM Studio, Unsloth Studio or the custom server), thinking off where the server allows it. */
async function viaLocal(system: string, user: string, images: LlmImage[], opts: LlmTextOptions): Promise<string | null> {
  const ready = await activeLocal();
  if (!ready) return null;
  const r = await chatLocal(ready, {
    messages: [
      { role: "system", content: system },
      // A vision model (qwen3-vl, gemma3…) reads the pictures; a text-only one answers from the words.
      { role: "user", content: user, ...(images.length && { images: images.map((i) => ({ data: i.data.toString("base64"), contentType: i.contentType })) }) },
    ],
    think: false,
    json: opts.json,
    timeoutMs: opts.timeoutMs ?? (images.length || ready.status.loaded === false ? 180_000 : 60_000),
  });
  return r.text || null;
}

/**
 * Which LLM llmText would ask right now (Claude is the one that costs money). "ollama" means a local
 * model, whichever server runs it (Ollama, LM Studio, Unsloth Studio or the custom one: Settings → AI helper).
 */
export function llmTextBackend(): "claude" | "ollama" | null {
  // An account's run or a visitor's price check never uses the install's AI helper (its LLM, its Claude key): the
  // offline wording (heuristicEnhance) is used instead.
  if (tenant()) return null;
  const choice = aiHelper();
  if (choice === "none") return null;
  if (choice === "anthropic" || (choice === "auto" && engineMode() !== "open" && !!getSetting("anthropicKey"))) return "claude";
  return "ollama";
}

/**
 * One-shot text from whichever LLM this install allows: Claude (when a key is set, and never
 * on "open source only" installs unless picked explicitly), else a local model. Null when none.
 * `images` go along for a model that can see them (Content Factory's reference frames); `json`
 * holds a local model to a schema. Takes (system, user, opts) or (system, user, images, opts).
 */
export async function llmText(system: string, user: string, opts?: LlmTextOptions): Promise<string | null>;
export async function llmText(system: string, user: string, images?: LlmImage[], opts?: LlmTextOptions): Promise<string | null>;
export async function llmText(system: string, user: string, a: LlmImage[] | LlmTextOptions = [], b: LlmTextOptions = {}): Promise<string | null> {
  const images: LlmImage[] = Array.isArray(a) ? a : [];
  const opts: LlmTextOptions = Array.isArray(a) ? b : a;
  // The open engine never calls a paid API: a local model, unless the AI helper is off.
  const backend = opts.ollamaOnly && llmTextBackend() === "claude" ? "ollama" : llmTextBackend();
  if (backend === "claude") return viaClaude(system, user, images).catch(() => null);
  if (backend === "ollama") return viaLocal(system, user, images, opts).catch(() => null);
  return null;
}

declare global {
  var __fuobeOllamaVision: Map<string, { sees: boolean; at: number }> | undefined;
}
const VISION_TTL_MS = 10 * 60_000;

/**
 * Whether the LLM llmText would ask (with the same `ollamaOnly`) sees the pictures it is sent: Claude does; an Ollama
 * model does when Ollama lists "vision" among its capabilities (qwen3-vl, gemma3…). A text-only model, an Ollama too
 * old to say, or none answering: false, so nothing is judged by a model that only reads the words.
 */
export async function llmSeesImages(o: { ollamaOnly?: boolean } = {}): Promise<boolean> {
  const backend = o.ollamaOnly && llmTextBackend() === "claude" ? "ollama" : llmTextBackend();
  if (backend === "claude") return true;
  if (backend !== "ollama") return false;
  const url = getSetting("ollamaUrl").replace(/\/+$/, "");
  const model = getSetting("ollamaModel");
  const key = `${url} ${model}`;
  const cache = (globalThis.__fuobeOllamaVision ??= new Map());
  const known = cache.get(key);
  if (known && Date.now() - known.at < VISION_TTL_MS) return known.sees;
  try {
    const res = await fetch(`${url}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return false;
    const j = (await res.json()) as { capabilities?: unknown };
    const sees = Array.isArray(j.capabilities) && j.capabilities.includes("vision");
    cache.set(key, { sees, at: Date.now() });
    return sees;
  } catch {
    return false;
  }
}

/** Deterministic fallback so the toggle always does something useful offline. */
export function heuristicEnhance(prompt: string, kind: MediaKind, op: Operation): string {
  const p = prompt.trim().replace(/[.\s]+$/, "");
  if (op === "edit" || op === "inpaint") return `${p}. Keep everything else unchanged: identity, pose, framing, lighting and background.`;
  if (kind === "video") {
    return op === "t2v"
      ? `${p}. Cinematic shot, natural motion, smooth camera movement, realistic physics, soft volumetric light, shallow depth of field, rich detail, 24fps film look.`
      : `${p}. Natural, fluid motion that stays consistent with the first frame, smooth cinematic camera movement, stable identity and details.`;
  }
  return `${p}. Highly detailed, natural skin and material texture, cinematic lighting, thoughtful composition, shot on a full-frame camera with a 50mm lens, shallow depth of field.`;
}

/** Fuobe Soul's enhancer (research §4.2): the user's words grown into one scene; the look adds the style itself. */
const SOUL_SYSTEM =
  "You expand a short image prompt into one vivid scene of 60 to 120 words for a photographic image model. Keep every word and idea the user wrote. " +
  "Add only what a photographer would decide: subject, wardrobe, pose, place, light, lens and film stock. Don't name an art style, filter or colour grade, and don't add text, signs or watermarks. " +
  "Answer with the prompt only: plain sentences, no quotes, no lists, no preamble.";

/**
 * Soul's words, expanded when an LLM is available (Claude or a local model); otherwise the user's own words, since the
 * look already says how the picture should look (the generic offline rewrite would fight it).
 */
export async function enhanceSoulWords(words: string): Promise<string> {
  const w = words.trim();
  if (!w || w.split(/\s+/).length >= 60) return words;
  const out = (await llmText(SOUL_SYSTEM, w))?.trim().replace(/^["“]|["”]$/g, "").replace(/[.\s]+$/, "");
  return out && out.length > w.length ? out : words;
}

export async function enhancePrompt(prompt: string, kind: MediaKind, op: Operation): Promise<string> {
  return (await llmText(SYSTEM, instruction(prompt, kind, op))) ?? heuristicEnhance(prompt, kind, op);
}

/**
 * Ideogram 4's caption writer (src/lib/ideogram-caption.ts): the schema in its key order and the "lean JSON" house style.
 * Written for Fuobe after Ideogram's own docs and caption verifier, and the preview pipeline's measured rules.
 */
const IDEOGRAM_SYSTEM = `You turn an idea into a JSON caption for the Ideogram 4 image model. Answer with one JSON object and nothing else: no code fence, no words before or after it.
The schema, with the keys in exactly this order:
{"high_level_description":"...","style_description":{"aesthetics":"...","lighting":"...","photo":"...","medium":"photograph","color_palette":["#RRGGBB"]},"compositional_deconstruction":{"background":"...","elements":[{"type":"obj","bbox":[top,left,bottom,right],"desc":"..."},{"type":"text","text":"...","desc":"..."}]}}
Rules:
- A picture that isn't a photograph has "medium" (illustration, painting, 3d_render, graphic_design…) then "art_style" in place of "photo": aesthetics, lighting, medium, art_style, color_palette.
- high_level_description: 25 to 35 words. The shot size first, then the subject, the main clothing or materials, the place and the time of day. Name everything the picture must show.
- The first element is the main subject, in at most 45 words, and it is the only element with a bbox: whole numbers 0 to 1000 from the top left, [top, left, bottom, right]. At most 4 more elements of up to 20 words each, without a bbox.
- People are adults, fully clothed and styled like fashion models, in their late twenties unless the idea gives an age. Describe the hair, one or two face features, each garment's material and colour on an opaque base, the shoes when the whole body shows, the pose as physical facts and where they look. End a person's desc with "Her whole head is inside the frame." (His or Their as fits).
- lighting: at most 18 words, one named light source and at most one fill, ending with "neutral white balance".
- photo: at most 13 words: the lens, the camera height and the aperture; for people add "smooth skin with fine pores".
- background: at most 35 words, only what must be visible.
- color_palette: 5 to 7 uppercase hex colours that fit the idea.
- Words the picture shows as lettering go in "text" elements, exactly as the idea quotes them. A picture without lettering mentions no text, logo, sign or label anywhere.
- Describe only what is in the picture. Never write no, not, without, never, empty or free of: a thing that is named gets drawn. Never write "sexy". Leave out sheer, mesh, see-through, translucent, stubble, weathered, rugged and wrinkles.
- Keep the idea's subject and intent. Write in English. No other keys (no aspect_ratio).`;

/**
 * An Ideogram 4 caption for some words at a picture size: the local model's (the open engine never calls a paid API, so
 * never Claude: the run is free), checked and asked once more when it breaks the rules, else the plain wrapper. An
 * account's run has no LLM here, so it gets the wrapper (the Image studio opens such viewers on Qwen-Image 2.1).
 */
export function ideogramCaption(words: string, size: { width?: number; height?: number } = {}): Promise<string> {
  return writeCaption(words, size, (request) => llmText(IDEOGRAM_SYSTEM, request, { json: "object", ollamaOnly: true }));
}
