import { toSrt, type Cue } from "@/lib/cues";
import type { Engine, GenerationRequest } from "@/lib/catalog/types";

/**
 * Caption styles and how each burner takes them. The edited cue list is burned as-is: on the open
 * engine by ComfyUI's caption burn-in (core TextOverlay, cues in params.extra.cues), on the cloud by
 * VEED Subtitles from SRT text (srt_content skips its own transcription). Auto Subtitle is the
 * "quick" route: it transcribes and burns in one call (word-by-word karaoke), without your edits.
 */
export const CAPTIONS_FEATURE = "captions";

export type CaptionSize = "S" | "M" | "L";
export type CaptionPosition = "top" | "center" | "bottom";

export interface CaptionStyle {
  id: string;
  name: string;
  /** Google font the cloud burners render with (and the preview uses where loaded). */
  font: string;
  weight: 400 | 700 | 900;
  /** Text colour (hex). */
  color: string;
  /** Word-by-word: a few words at a time (open), the spoken word highlighted (cloud dynamic styles / Auto Subtitle). */
  karaoke: boolean;
  /** Highlight colour for karaoke (hex). */
  highlight?: string;
  /** A dark box behind the text instead of an outline. */
  box?: boolean;
  /** VEED's own preset this style starts from. */
  veed: string;
  /** Uppercase text (bold social styles). */
  upper?: boolean;
}

export const CAPTION_STYLES: CaptionStyle[] = [
  { id: "clean", name: "Clean", font: "Inter", weight: 700, color: "#ffffff", karaoke: false, veed: "simple" },
  { id: "bold", name: "Bold pop", font: "Montserrat", weight: 900, color: "#ffd400", karaoke: false, veed: "beans", upper: true },
  { id: "karaoke", name: "Karaoke", font: "Montserrat", weight: 900, color: "#ffffff", karaoke: true, highlight: "#8b5cf6", veed: "glide", upper: true },
  { id: "boxed", name: "Boxed", font: "Inter", weight: 700, color: "#ffffff", karaoke: false, box: true, veed: "backdrop" },
  { id: "subtle", name: "Subtle", font: "Inter", weight: 400, color: "#f5f5f5", karaoke: false, veed: "plain" },
  { id: "neon", name: "Neon", font: "Poppins", weight: 700, color: "#00e5ff", karaoke: true, highlight: "#ffffff", veed: "fusion" },
];

export const styleById = (id: string | undefined) => CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0];

export interface CaptionLook {
  style: string;
  size: CaptionSize;
  position: CaptionPosition;
  /** Overrides the style's colour. */
  color?: string;
}

/** The open burner's text size: % of the frame height. */
export const OPEN_FONT_SIZE: Record<CaptionSize, number> = { S: 4.5, M: 6, L: 8 };
/** Auto Subtitle's font size (px at its render size). */
const AUTO_FONT_SIZE: Record<CaptionSize, number> = { S: 60, M: 90, L: 120 };

/** Auto Subtitle's colour names: the nearest one to a hex colour. */
const NAMED: [string, [number, number, number]][] = [
  ["white", [255, 255, 255]],
  ["black", [0, 0, 0]],
  ["red", [230, 40, 40]],
  ["green", [40, 200, 80]],
  ["blue", [40, 90, 230]],
  ["yellow", [255, 212, 0]],
  ["orange", [255, 140, 0]],
  ["purple", [139, 92, 246]],
  ["pink", [244, 114, 182]],
  ["brown", [140, 90, 40]],
  ["gray", [128, 128, 128]],
  ["cyan", [0, 229, 255]],
  ["magenta", [230, 0, 230]],
];

export function nearestColorName(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "white";
  const n = parseInt(m[1], 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = NAMED[0];
  let bestD = Infinity;
  for (const c of NAMED) {
    const d = c[1].reduce((acc, v, i) => acc + (v - rgb[i]) ** 2, 0);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best[0];
}

export type BurnRoute = "open" | "veed" | "auto";

export const BURN_MODELS: Record<BurnRoute, string> = { open: "oss-captions-burnin", veed: "veed-subtitles", auto: "auto-subtitle" };

/** Which burner a route uses on an engine ("auto" is cloud only, "open" is the open engine's). */
export const burnRouteFor = (engine: Engine, quick: boolean): BurnRoute => (engine === "open" ? "open" : quick ? "auto" : "veed");

/** Whether a route burns your edited lines (Auto Subtitle transcribes again by itself). */
export const usesCues = (route: BurnRoute) => route !== "auto";

/** What each burner can draw, so the controls and the live preview promise only that. */
export interface BurnCaps {
  positions: CaptionPosition[];
  /** S / M / L reaches the burner (VEED sizes the text by its preset). */
  sizes: boolean;
  /** It draws a box behind the text (the open burner outlines it). */
  box: boolean;
  /** What a karaoke style's highlight colour marks: the spoken word, the burner's own key words, or nothing. */
  highlight: "spoken" | "keywords" | "none";
  /** Karaoke styles show this many words at a time (0: the whole line). */
  karaokeWords: number;
  /** It draws each style's own font and weight (the open burner has one font of its own). */
  fonts: boolean;
}

export const BURN_CAPS: Record<BurnRoute, BurnCaps> = {
  open: { positions: ["top", "bottom"], sizes: true, box: false, highlight: "none", karaokeWords: 3, fonts: false },
  veed: { positions: ["top", "center", "bottom"], sizes: false, box: true, highlight: "keywords", karaokeWords: 0, fonts: true },
  auto: { positions: ["top", "center", "bottom"], sizes: true, box: true, highlight: "spoken", karaokeWords: 3, fonts: true },
};

/** The look a burner will actually draw: a position it lacks falls back to the bottom. */
export function lookFor(route: BurnRoute, look: CaptionLook): CaptionLook {
  return BURN_CAPS[route].positions.includes(look.position) ? look : { ...look, position: "bottom" };
}

/** VEED's dynamic presets bill twice the basic rate. */
const VEED_DYNAMIC = new Set(["glass", "whisper", "glide2", "fusion", "glide", "terminal", "handwritten", "backdrop", "backdrop2"]);

/** VEED's translated subtitles add this per minute (its catalog note: "translation +$0.20/min"). */
const VEED_TRANSLATION = 0.2;

/** The burn's price per minute of video (USD), for the route's note; 0 on the open engine. `translated`: VEED also translates. */
export function burnPricePerMinute(route: BurnRoute, style: string, translated = false): number {
  if (route === "open") return 0;
  if (route === "auto") return 0.03;
  return (VEED_DYNAMIC.has(styleById(style).veed) ? 0.2 : 0.1) + (translated ? VEED_TRANSLATION : 0);
}

/** What the style controls mean on this burner, in one line. */
export function burnNote(route: BurnRoute): string {
  if (route === "open") return "The open burner draws outlined text in one font of its own, at the top or the bottom: a style sets the colour and capitals, and karaoke styles show 3 words at a time, without a highlight.";
  if (route === "veed") return "Text size follows the style. Karaoke styles highlight key words, not each spoken one.";
  return "Auto Subtitle shows 3 words at a time and highlights the spoken word in karaoke styles.";
}

const upper = (cues: Cue[], on?: boolean) => (on ? cues.map((c) => ({ ...c, text: c.text.toUpperCase() })) : cues);

/** The burn job for a style: the model, its settings (params.extra) and the cues it takes. */
export function burnRequest(o: { route: BurnRoute; video: string; cues: Cue[]; look: CaptionLook; sourceLanguage?: string }): GenerationRequest {
  const style = styleById(o.look.style);
  const color = o.look.color ?? style.color;
  const cues = upper(o.cues.filter((c) => c.text.trim()), style.upper);
  // The feed names it by the style (Captions · Karaoke) rather than "Captions · VEED Subtitles".
  const title = `Captions · ${o.route === "auto" ? "Quick karaoke" : style.name}`;
  const base = { feature: CAPTIONS_FEATURE, modelId: BURN_MODELS[o.route], op: "captions" as const, inputs: { video: o.video }, title };
  if (o.route === "open") {
    if (!cues.length) throw new Error("There are no lines to burn in");
    return {
      ...base,
      params: {
        extra: {
          cues: cues.map((c) => ({ start: c.start, end: c.end, text: c.text.trim() })),
          fontSize: OPEN_FONT_SIZE[o.look.size],
          fontColor: color,
          // The open burner places text at the top or the bottom.
          captionPosition: o.look.position === "top" ? "top" : "bottom",
          wordsPerCaption: style.karaoke ? 3 : 0,
        },
      },
    };
  }
  if (o.route === "veed") {
    if (!cues.length) throw new Error("There are no lines to burn in");
    return {
      ...base,
      params: {
        extra: {
          preset: style.veed,
          srt_content: toSrt(cues),
          "customization.position": o.look.position,
          "customization.shadow": style.box ? "none" : "mid",
          "customization.text_customizations.baseline.font": style.font,
          "customization.text_customizations.baseline.weight": style.weight,
          "customization.text_customizations.baseline.color": color,
          ...(style.highlight && { "customization.text_customizations.highlighted.color": style.highlight }),
        },
      },
    };
  }
  return {
    ...base,
    params: {
      ...(o.sourceLanguage && o.sourceLanguage !== "auto" && { sourceLanguage: o.sourceLanguage }),
      extra: {
        font_name: style.font,
        font_weight: style.weight >= 900 ? "black" : style.weight >= 700 ? "bold" : "normal",
        font_color: nearestColorName(color),
        highlight_color: nearestColorName(style.highlight ?? color),
        position: o.look.position,
        font_size: AUTO_FONT_SIZE[o.look.size],
        words_per_subtitle: style.karaoke ? 3 : 6,
        background_color: style.box ? "black" : "none",
        ...(style.box && { background_opacity: 0.6 }),
      },
    },
  };
}

/** The transcription job: the engine's transcriber, the spoken language if known. */
export function transcribeRequest(o: { engine: Engine; video: string; modelId?: string; sourceLanguage?: string; cleanVoiceFirst?: boolean; seconds?: number }): GenerationRequest {
  const params = {
    ...(o.sourceLanguage && o.sourceLanguage !== "auto" && { sourceLanguage: o.sourceLanguage }),
    ...(o.seconds && o.seconds > 0 && { sourceDuration: o.seconds }),
    // "Clean the voice first" (src/lib/av/voice-first.ts): the speech apart from the music and effects before it's read.
    ...(o.cleanVoiceFirst && { extra: { cleanVoiceFirst: true } }),
  };
  return {
    feature: CAPTIONS_FEATURE,
    modelId: o.modelId ?? (o.engine === "open" ? "oss-qwen3-asr" : "scribe-v2"),
    op: "transcribe",
    inputs: { video: o.video },
    ...(Object.keys(params).length && { params }),
  };
}

/**
 * The words shown at time `t`, the way the route's burner shows them (for the live preview): karaoke
 * styles show a few words at a time where the burner does, and the spoken word is highlighted only
 * where the burner highlights it.
 */
export function previewText(cues: Cue[], t: number, look: CaptionLook, route: BurnRoute = "auto"): { text: string; highlight?: number } | null {
  const c = cues.find((x) => t >= x.start && t < x.end);
  if (!c) return null;
  const style = styleById(look.style);
  const caps = BURN_CAPS[route];
  const text = style.upper ? c.text.toUpperCase() : c.text;
  if (!style.karaoke || !caps.karaokeWords) return { text };
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const n = caps.karaokeWords;
  const i = Math.min(words.length - 1, Math.floor(((t - c.start) / Math.max(0.01, c.end - c.start)) * words.length));
  const group = Math.floor(i / n) * n;
  return { text: words.slice(group, group + n).join(" "), ...(caps.highlight === "spoken" && { highlight: i - group }) };
}
