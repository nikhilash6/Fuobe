import {
  BLOCK_SECONDS,
  defaultSettings,
  extractJson,
  formatLength,
  getStyle,
  MIN_BLOCK,
  STYLES,
  subjectOf,
  wordCount,
  wordsFor,
  type AnimationMode,
  type BriefLook,
  type CostBreakdown,
  type EpisodeAspect,
  type EpisodeCard,
  type EpisodeSettings,
  type FacelessChannel,
  type FacelessGenre,
  type GenreInfo,
  type NarratorVoice,
  type TimedText,
} from "./faceless";
import type { Engine } from "./types";

/*
 * Content Factory: a faceless short-video series in the style of a reference clip, made here (each episode is a
 * Faceless episode in a Content Factory channel, src/server/content-factory.ts) or handed to Claude over MCP.
 *
 * Research: docs/research/parity-delta-4.md §4.6 ("Generate in Claude" / "Generate here"; a reference upload,
 * a TikTok or Instagram link, or a preset; "Make a video about…"; 30 s – 5 min; episodes; four animation styles;
 * the four Faceless genres) and docs/research/comfyui-oss-4.md §i (reference-brief-gemma4: Gemma 4 E4B reads the
 * frames at 1 fps and the sound and writes a JSON style brief). The cloud reads the same brief from extracted
 * frames, the transcript and Claude. Both answers are parsed by parseBrief, which takes the keys either model
 * tends to write (snake or camel case, objects or plain strings, "2–3 s" or a number) and fills what's missing.
 *
 * The brief reaches an episode as EpisodeSettings.brief (a BriefLook): lines for the script writer (format,
 * hook, pacing, shot types, voice tone), words added to every picture and motion prompt, the music mood, the
 * scene length the writer aims for and the caption style. Nothing here copies the reference's people, logos or
 * words: the brief describes a style.
 */

// ---------------------------------------------------------------------------
// The composer's choices

/** The parity studio's four animation styles, as two render modes (a video model, or Ken Burns moves over stills) with their own pacing and camera. */
export type AnimationStyleId = "fully-animated" | "seamless" | "scene-by-scene" | "frame-by-frame";

export interface AnimationStyle {
  id: AnimationStyleId;
  label: string;
  /** What it looks like, and what it costs relative to the others. */
  copy: string;
  /** The same on the open engine (no prices, a GPU or none). */
  openCopy: string;
  /** How Faceless renders it. */
  mode: AnimationMode;
  /** Seconds a scene lasts before the reference's own cut rate pulls it shorter or longer. */
  sceneSeconds: number;
  /** Added to every motion prompt (animated modes). */
  camera: string;
  /** What the script writer is told about the scenes. */
  writer: string;
}

export const ANIMATION_STYLES: AnimationStyle[] = [
  {
    id: "fully-animated",
    label: "Fully animated",
    copy: "Every scene is an animated clip from a video model — the liveliest look, and the priciest",
    openCopy: "Every scene is an animated clip (Wan 2.2) — needs a GPU",
    mode: "animated",
    sceneSeconds: 8,
    camera: "",
    writer: "Every scene is a fully animated shot: characters and things visibly move.",
  },
  {
    id: "seamless",
    label: "Seamless motion",
    copy: "Animated clips that flow into each other like one long camera move",
    openCopy: "Animated clips that flow into each other like one long camera move — needs a GPU",
    mode: "animated",
    sceneSeconds: 10,
    camera: "one continuous camera move that starts and ends mid-movement, carrying on into the next scene with no pause",
    writer: "The scenes flow into each other like one long take: each picture continues from the one before, and the motion says how the camera travels on to the next scene.",
  },
  {
    id: "scene-by-scene",
    label: "Scene by scene",
    copy: "Short, punchy stills with a camera move each and hard cuts — no video model, a fraction of the price",
    openCopy: "Short, punchy stills with a camera move each and hard cuts — the motion needs no GPU",
    mode: "frames",
    sceneSeconds: 5,
    camera: "",
    writer: "Short, punchy scenes: one clear picture per line of narration, and a hard cut to a new angle each time.",
  },
  {
    id: "frame-by-frame",
    label: "Frame by frame",
    copy: "Each picture explored with a slow Ken Burns pan and zoom, documentary style — no video model, the cheapest",
    openCopy: "Each picture explored with a slow Ken Burns pan and zoom — the motion needs no GPU",
    mode: "frames",
    sceneSeconds: 8,
    camera: "",
    writer: "Each scene is one detailed illustration that the camera slowly explores, documentary style.",
  },
];

export const animationStyle = (id: string | null | undefined): AnimationStyle => ANIMATION_STYLES.find((s) => s.id === id) ?? ANIMATION_STYLES[0];

/** Lengths: 30 seconds to 5 minutes (research: "30 sec" default, then 1–5 min). */
export const CF_LENGTHS: { value: number; label: string }[] = [
  { value: 30, label: "30 sec" },
  { value: 60, label: "1 min" },
  { value: 120, label: "2 min" },
  { value: 180, label: "3 min" },
  { value: 240, label: "4 min" },
  { value: 300, label: "5 min" },
];
export const CF_LENGTH_VALUES = CF_LENGTHS.map((l) => l.value);
export const MAX_EPISODES = 10;
export const MAX_PROMPT = 2000;

/** The rotating examples under "Make a video about…" (research). */
export const IDEA_EXAMPLES = ["What if cars could fly", "What if cats ruled the world", "What if the Moon had a city", "What if dinosaurs never went extinct", "What if gravity switched off for a day"];

/** A reference clip is read up to this long (the cloud reads its frames and words; the open graph its first 30 s). */
export const MAX_REFERENCE_SECONDS = 300;
export const OPEN_REFERENCE_SECONDS = 30;
/** Frames Claude looks at (evenly spread over the clip, one a second at most). */
export const MAX_BRIEF_FRAMES = 20;

// ---------------------------------------------------------------------------
// The style brief

export type CaptionPosition = "top" | "center" | "bottom";

export interface StyleBrief {
  /** What kind of video it is ("what-if explainer", "countdown"…). */
  format: string;
  /** How the first seconds grab attention. */
  hook: string;
  /** Average seconds per shot (the cut rate). */
  shotSeconds: number;
  /** The pacing in words. */
  pacing: string;
  /** Shot types it uses. */
  shots: string[];
  /** Medium, palette, lighting, texture. */
  look: string;
  /** The nearest Faceless style preset (its picture prompt). */
  styleId: string;
  animation: AnimationStyleId;
  voice: { tone: string; wordsPerMinute?: number; language?: string };
  music: { mood: string; energy?: "low" | "medium" | "high" };
  captions: { style: string; position: CaptionPosition; words: number };
  aspect: EpisodeAspect;
  /** Topic ideas in the same format (offered as chips). */
  topics: string[];
}

/** Keys of a brief the parser couldn't find (filled with defaults). */
export type BriefField = "format" | "hook" | "pacing" | "shots" | "look" | "animation" | "voice" | "music" | "captions" | "topics";

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The value under the first of `names` the object has, matching keys loosely ("visual_style" = "visualStyle"). */
function field(o: Record<string, unknown>, ...names: string[]): unknown {
  const keys = Object.keys(o);
  for (const n of names) {
    const k = keys.find((x) => norm(x) === norm(n));
    if (k !== undefined && o[k] !== null && o[k] !== undefined && o[k] !== "") return o[k];
  }
  return undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Any answer value as one line of text (lists joined, objects' values joined). */
function text(v: unknown, max = 400): string {
  const s =
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : Array.isArray(v)
        ? v.map((x) => text(x, max)).filter(Boolean).join(", ")
        : isObj(v)
          ? Object.values(v)
              .map((x) => text(x, max))
              .filter(Boolean)
              .join(", ")
          : "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

const clampNum = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A narrator's pace a brief can carry (words a minute); the brief editor's schema accepts a little more either side. */
export const MIN_WPM = 80;
export const MAX_WPM = 260;

/** "2–3 s" → 2.5, "about 4 seconds" → 4, "fast" → 2.5; null when it says nothing about time. */
export function secondsFrom(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (isObj(v)) {
    const n = field(v, "average_shot_seconds", "averageShotLength", "average_shot_length", "shot_seconds", "seconds", "avg", "average");
    const got = secondsFrom(n);
    if (got !== null) return got;
    return secondsFrom(text(v));
  }
  const s = text(v).toLowerCase();
  if (!s) return null;
  const range = /(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(?:s\b|sec|second)/.exec(s);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const one = /(\d+(?:\.\d+)?)\s*(?:s\b|sec|second)/.exec(s) ?? /^(\d+(?:\.\d+)?)$/.exec(s.trim());
  if (one) return Number(one[1]);
  if (/very fast|rapid|frenetic|hyper/.test(s)) return 1.5;
  if (/fast|quick|snappy|punchy/.test(s)) return 2.5;
  if (/slow|calm|leisurely|lingering/.test(s)) return 6;
  if (/medium|moderate|steady/.test(s)) return 4;
  return null;
}

/** Shot types from a list of shot objects ({seconds, visual, camera, on_screen_text}) or words. */
function shotTypes(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]+/) : isObj(v) ? Object.values(v) : [];
  const out: string[] = [];
  for (const s of list) {
    const t = isObj(s) ? text(field(s, "type", "shot", "shot_type", "camera", "framing", "angle", "visual"), 80) : text(s, 80);
    const clean = t.replace(/^[-•*\d.)\s]+/, "").trim();
    if (clean && !out.some((x) => x.toLowerCase() === clean.toLowerCase())) out.push(clean);
  }
  return out.slice(0, 8);
}

/** Which of the four styles an answer names ("seamless motion video", "Ken Burns stills"…). */
export function animationFrom(v: unknown): AnimationStyleId | null {
  const s = text(v).toLowerCase();
  if (!s) return null;
  if (/seamless|continuous|one take|single take|flowing|flows/.test(s)) return "seamless";
  if (/scene.?by.?scene|slideshow|hard cuts?|jump cuts?/.test(s)) return "scene-by-scene";
  if (/frame.?by.?frame|ken burns|stills?|pan and zoom|zoom and pan|static images?/.test(s)) return "frame-by-frame";
  if (/anim|motion|moving|cartoon/.test(s)) return "fully-animated";
  return null;
}

const STYLE_WORDS: [RegExp, string][] = [
  [/stick ?(man|men|figure)/, "stickman-cartoon"],
  [/whiteboard|doodle|marker/, "whiteboard-doodle"],
  [/watercolou?r/, "watercolor-chronicle"],
  [/pixel/, "pixel-art"],
  [/clay|plasticine|stop[- ]motion/, "claymotion"],
  [/low[- ]poly/, "low-poly"],
  [/isometric/, "isometric-flat-vector"],
  [/papercraft|origami|folded paper/, "3d-papercraft"],
  [/diorama|cut[- ]paper|layered paper/, "paper-diorama"],
  [/collage|torn paper|magazine/, "paper-collage"],
  [/plush|fluffy|felt|stuffed/, "fluffy-toy"],
  [/mannequin/, "mannequin"],
  [/fairy|myth|storybook|fantasy/, "fairy-tale-myth"],
  [/pastel/, "pastel-flat-2d"],
  [/hand[- ]drawn|sketch|pencil|\bink\b/, "hand-drawn"],
  [/mixed[- ]media/, "mixed-media"],
  [/motion graphics|infographic|diagram|editorial/, "editorial-motion-graphics"],
  [/poster|vector|flat/, "poster-vector"],
  [/photo|realistic|live[- ]action|cinematic|studio|product/, "studio-3d"],
  [/3d|pixar|render|cgi|toy/, "colorful-3d"],
  [/anime|cartoon|2d|illustrat|comic/, "2d-illustrator"],
];

/** The Faceless style preset whose picture prompt is closest to a brief's look. */
export function styleFor(look: string, fallback = "colorful-3d"): string {
  const s = look.toLowerCase();
  const hit = STYLE_WORDS.find(([re]) => re.test(s))?.[1];
  return hit && STYLES.some((x) => x.id === hit) ? hit : fallback;
}

function captionsFrom(v: unknown): StyleBrief["captions"] | null {
  if (v === undefined) return null;
  const style = isObj(v) ? text(field(v, "style", "look", "font", "type") ?? v, 160) : text(v, 160);
  const where = (isObj(v) ? text(field(v, "position", "placement", "location")) : "") || style;
  const s = `${style} ${where}`.toLowerCase();
  if (/\b(none|no captions|no subtitles|without captions)\b/.test(s)) return { style: "No on-screen captions", position: "bottom", words: 3 };
  const position: CaptionPosition = /top|upper/.test(where.toLowerCase()) ? "top" : /center|centre|middle/.test(where.toLowerCase()) ? "center" : "bottom";
  const words = /word.?by.?word|one word|single word|karaoke|1 word/.test(s) ? 1 : /two words|2 words/.test(s) ? 2 : /sentence|full line|whole line|line by line|subtitle/.test(s) ? 6 : 3;
  return { style: style || "Bold captions, a few words at a time", position, words };
}

function energyFrom(s: string): "low" | "medium" | "high" | undefined {
  const t = s.toLowerCase();
  if (/high|energetic|intense|driving|upbeat|epic|hype|fast/.test(t)) return "high";
  if (/low|calm|soft|gentle|ambient|chill|quiet|lo-?fi|relax/.test(t)) return "low";
  if (/medium|moderate|steady/.test(t)) return "medium";
  return undefined;
}

/** A brief with nothing read yet (the starting point the parser fills, and the offline writer's base). */
export function defaultBrief(o: { aspect?: EpisodeAspect } = {}): StyleBrief {
  return {
    format: "Short narrated explainer",
    hook: "Open on the most surprising picture and ask a question in the first two seconds",
    shotSeconds: 3,
    pacing: "Quick cuts, one idea per shot, no slow intro",
    shots: ["Wide establishing shot", "Close-up detail", "Dramatic low angle"],
    look: "Bright, saturated colours, soft cinematic light, clean shapes",
    styleId: "colorful-3d",
    animation: "fully-animated",
    voice: { tone: "Energetic, curious storyteller" },
    music: { mood: "Driving, curious electronic pulse", energy: "high" },
    captions: { style: "Bold captions, a few words at a time", position: "center", words: 3 },
    aspect: o.aspect ?? "9:16",
    topics: [],
  };
}

/**
 * A brief from an object either model wrote, tolerantly: keys in any case, plain strings or nested objects,
 * numbers written as words. What's missing comes from `base` (or the defaults). Null when it has fewer than
 * two fields we know (not a brief at all).
 */
export function normalizeBrief(raw: unknown, base: StyleBrief = defaultBrief()): { brief: StyleBrief; missing: BriefField[] } | null {
  const root = isObj(raw) ? (isObj(field(raw, "brief", "style_brief", "styleBrief")) ? (field(raw, "brief", "style_brief", "styleBrief") as Record<string, unknown>) : raw) : null;
  if (!root) return null;
  const missing: BriefField[] = [];
  const got = <T,>(name: BriefField, v: T | null | undefined | "", fallback: T): T => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) {
      missing.push(name);
      return fallback;
    }
    return v;
  };

  const format = got("format", text(field(root, "format", "video_format", "type", "genre", "category"), 120), base.format);
  const hook = got("hook", text(field(root, "hook", "hook_structure", "opening", "first_3_seconds", "first_3s", "intro"), 300), base.hook);
  const pacingRaw = field(root, "pacing", "pace", "cut_rate", "rhythm", "average_shot_length", "average_shot_seconds", "shot_length");
  const secs = secondsFrom(pacingRaw);
  const pacingText = isObj(pacingRaw) ? text(field(pacingRaw, "description", "notes", "summary", "style") ?? "", 240) : typeof pacingRaw === "string" ? text(pacingRaw, 240) : "";
  if (secs === null && !pacingText) missing.push("pacing");
  const shotSeconds = round1(clampNum(secs ?? base.shotSeconds, 1, 12));
  const pacing = pacingText && !/^\d+(\.\d+)?$/.test(pacingText) ? pacingText : secs !== null ? `Cuts about every ${shotSeconds} s` : base.pacing;
  const shots = got("shots", shotTypes(field(root, "shots", "shot_types", "shot_list", "shotList", "camera_shots", "framing")), base.shots);
  const lookRaw = field(root, "visual_style", "visual", "look", "art_style", "aesthetic", "style", "visuals");
  const look = got("look", text(lookRaw, 400), base.look);
  const styleGiven = text(field(root, "style_id", "styleId", "preset"), 60);
  const styleId = STYLES.some((s) => s.id === styleGiven) ? styleGiven : lookRaw !== undefined ? styleFor(`${look} ${format}`, base.styleId) : base.styleId;
  const animation = got("animation", animationFrom(field(root, "animation_style", "animation", "motion_style", "motion")), base.animation);

  const voiceRaw = field(root, "narration", "voice", "voiceover", "voice_over", "narrator", "tone");
  let voice = base.voice;
  if (voiceRaw === undefined) missing.push("voice");
  else if (isObj(voiceRaw)) {
    const wpm = Number(text(field(voiceRaw, "words_per_minute", "wordsPerMinute", "wpm", "pace", "speed")).match(/\d+/)?.[0] ?? NaN);
    const tone = text([field(voiceRaw, "tone", "style", "delivery"), field(voiceRaw, "voice", "gender", "character")].filter((x) => x !== undefined), 160) || base.voice.tone;
    const language = text(field(voiceRaw, "language", "lang"), 40);
    voice = { tone, ...(Number.isFinite(wpm) && wpm >= MIN_WPM && wpm <= MAX_WPM && { wordsPerMinute: Math.round(wpm) }), ...(language && { language }) };
  } else voice = { tone: text(voiceRaw, 160) || base.voice.tone };

  const musicRaw = field(root, "music", "soundtrack", "background_music", "audio", "sound");
  let music = base.music;
  if (musicRaw === undefined) missing.push("music");
  else {
    const mood = isObj(musicRaw) ? text([field(musicRaw, "genre", "style"), field(musicRaw, "mood", "feel")].filter((x) => x !== undefined), 200) || text(musicRaw, 200) : text(musicRaw, 200);
    const energyText = isObj(musicRaw) ? text(field(musicRaw, "energy", "intensity", "tempo") ?? mood) : mood;
    music = { mood: mood || base.music.mood, ...((energyFrom(energyText) ?? base.music.energy) && { energy: energyFrom(energyText) ?? base.music.energy }) };
  }

  const captions = captionsFrom(field(root, "captions", "subtitles", "on_screen_text", "onscreen_text", "text_style", "text"));
  if (!captions) missing.push("captions");
  const aspectText = text(field(root, "aspect", "aspect_ratio", "aspectRatio", "orientation"));
  const aspect: EpisodeAspect = /16\s*:\s*9|landscape|horizontal/i.test(aspectText) ? "16:9" : /9\s*:\s*16|portrait|vertical/i.test(aspectText) ? "9:16" : base.aspect;
  const topicsRaw = field(root, "topic_ideas", "topicIdeas", "topics", "ideas", "episode_ideas", "next_topics");
  const topicList = Array.isArray(topicsRaw) ? topicsRaw : typeof topicsRaw === "string" ? topicsRaw.split(/\n|;/) : [];
  const topics = got(
    "topics",
    topicList
      .map((t) => (isObj(t) ? text(field(t, "title", "topic", "idea") ?? t, 140) : text(t, 140)).replace(/^[-•*\d.)\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 5),
    base.topics,
  );

  if (missing.length > 8) return null;
  return { brief: { format, hook, shotSeconds, pacing, shots, look, styleId, animation, voice, music, captions: captions ?? base.captions, aspect, topics }, missing };
}

/** The brief in an LLM's answer (JSON, maybe in fences or prose); null when there isn't one. */
export function parseBrief(answer: string, base?: StyleBrief): { brief: StyleBrief; missing: BriefField[] } | null {
  const j = extractJson(answer.replace(/^﻿/, ""));
  return normalizeBrief(Array.isArray(j) ? j[0] : j, base);
}

/** What Claude (or Ollama) is asked for: the same keys the open graph's instruction asks Gemma 4 for. */
export const BRIEF_SYSTEM = `You study a short-form reference video (its frames in order, about one a second, and the transcript of its soundtrack) and write a reusable style brief for a NEW faceless video in the same style.
Reply with JSON only:
{"format": string, "hook": string, "pacing": {"average_shot_seconds": number, "description": string}, "shots": [string], "visual_style": {"medium": string, "palette": string, "lighting": string, "texture": string}, "animation_style": "Fully animated" | "Seamless motion video" | "Scene by scene video" | "Frame by frame", "narration": {"tone": string, "words_per_minute": number, "language": string}, "music": {"genre": string, "mood": string, "energy": "low" | "medium" | "high"}, "captions": {"style": string, "position": "top" | "center" | "bottom"}, "aspect_ratio": "9:16" | "16:9", "topic_ideas": [5 strings]}
- format: what kind of video it is (e.g. "what-if explainer", "top-5 countdown", "bedtime fable").
- hook: how the first three seconds grab attention, as a structure someone else can reuse.
- shots: the shot types it uses (e.g. "extreme close-up", "aerial pull-back", "over-the-shoulder").
- Describe the style only. Never copy the reference's people, characters, logos, brand names or exact words.`;

/** The user turn that goes with the frames. */
export function briefRequest(o: { seconds?: number; width?: number; height?: number; frames: number; transcript?: string; title?: string }): string {
  return [
    o.title ? `Reference: ${o.title}` : "",
    o.seconds ? `Length: ${Math.round(o.seconds)} s${o.width && o.height ? `, ${o.width}×${o.height}` : ""}.` : "",
    o.frames ? `${o.frames} frames are attached, in order.` : "No frames could be read; work from the transcript and the length.",
    o.transcript?.trim() ? `Transcript of the soundtrack (timed):\n${o.transcript.trim().slice(0, 12_000)}` : "The soundtrack has no speech that could be transcribed.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Narrated words a minute in a timed transcript (null with too few words to tell). */
export function speechRate(cues: TimedText[]): number | null {
  const spoken = cues.filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.text?.trim());
  const words = spoken.reduce((n, c) => n + wordCount(c.text), 0);
  const secs = spoken.reduce((n, c) => n + (c.end - c.start), 0);
  return words >= 12 && secs > 3 ? Math.round((words / secs) * 60) : null;
}

/**
 * A brief without an LLM (demo mode, or nothing that can see the frames): what the clip's header and its
 * transcript say — its shape, its length, how fast the narrator talks — over the defaults.
 */
export function offlineBrief(o: { seconds?: number; width?: number; height?: number; cues?: TimedText[]; title?: string } = {}): StyleBrief {
  const aspect: EpisodeAspect = o.width && o.height ? (o.width > o.height ? "16:9" : "9:16") : "9:16";
  const b = defaultBrief({ aspect });
  // A rap or a sped-up voice reads faster than any narrator speaks: kept within what a brief can say (and save).
  const rate = o.cues ? speechRate(o.cues) : null;
  const wpm = rate === null ? null : clampNum(rate, MIN_WPM, MAX_WPM);
  const long = (o.seconds ?? 0) > 90;
  return {
    ...b,
    format: long ? "Narrated explainer" : b.format,
    shotSeconds: long ? 5 : b.shotSeconds,
    pacing: long ? "Steady pacing, a new picture every few seconds" : b.pacing,
    voice: { tone: wpm && wpm > 170 ? "Fast, energetic storyteller" : wpm && wpm < 130 ? "Calm, warm storyteller" : b.voice.tone, ...(wpm && { wordsPerMinute: wpm }) },
  };
}

/** The brief as lines for the script writer, the brief card and the Claude message. */
export function briefLines(b: StyleBrief): string[] {
  return [
    `Format: ${b.format}`,
    `Hook (first 3 seconds): ${b.hook}`,
    `Pacing: ${b.pacing} (about ${b.shotSeconds} s a shot)`,
    b.shots.length ? `Shot types: ${b.shots.join(", ")}` : "",
    `Narrator: ${b.voice.tone}${b.voice.wordsPerMinute ? `, about ${b.voice.wordsPerMinute} words a minute` : ""}${b.voice.language ? `, in ${b.voice.language}` : ""}`,
    `Music: ${b.music.mood}${b.music.energy ? ` (${b.music.energy} energy)` : ""}`,
    `Captions: ${b.captions.style} (${b.captions.position}, ${b.captions.words === 1 ? "word by word" : `${b.captions.words} words at a time`})`,
  ].filter(Boolean);
}

/** Seconds a scene lasts: the style's own length pulled toward the reference's cut rate (within one block). */
export function sceneSecondsFor(style: AnimationStyle, shotSeconds: number): number {
  return clampNum(Math.round((style.sceneSeconds + clampNum(shotSeconds, MIN_BLOCK, BLOCK_SECONDS)) / 2), MIN_BLOCK + 1, BLOCK_SECONDS);
}

/** How a brief reaches an episode (EpisodeSettings.brief). */
export function briefLook(b: StyleBrief, style: AnimationStyle): BriefLook {
  return {
    script: [...briefLines(b).filter((l) => !l.startsWith("Music:") && !l.startsWith("Captions:")), style.writer, "Take the style only: never copy the reference's people, characters, logos, brand names or exact words."],
    ...(b.look && { look: b.look }),
    ...(style.camera && { camera: style.camera }),
    ...(b.music.mood && { music: `${b.music.mood}${b.music.energy ? `, ${b.music.energy} energy` : ""}` }),
    sceneSeconds: sceneSecondsFor(style, b.shotSeconds),
    captions: { position: b.captions.position, words: b.captions.words },
  };
}

// ---------------------------------------------------------------------------
// Presets ("Pick a trending style to start from"): ready briefs, no reference to read

export interface StylePreset {
  id: string;
  name: string;
  tagline: string;
  genre: FacelessGenre;
  brief: StyleBrief;
  /** Topics that suit it ("Make a video about…" chips). */
  examples: string[];
}

const preset = (id: string, name: string, tagline: string, genre: FacelessGenre, b: Partial<StyleBrief> & Pick<StyleBrief, "styleId" | "animation">, examples: string[]): StylePreset => ({
  id,
  name,
  tagline,
  genre,
  brief: { ...defaultBrief(), ...b, topics: examples },
  examples,
});

export const PRESETS: StylePreset[] = [
  preset(
    "what-if",
    "What if…?",
    "An impossible question, answered in quick 3D scenes",
    "storytelling",
    {
      format: "What-if speculation: one impossible premise followed to its consequences",
      hook: "The impossible image first, then the question “What if…?” in the first second",
      shotSeconds: 2.5,
      pacing: "Fast cuts, each consequence bigger than the last, a twist at the end",
      shots: ["Epic wide shot", "Street-level close-up", "Aerial pull-back"],
      look: "Glossy toy-like 3D, saturated colours, soft cinematic light",
      styleId: "colorful-3d",
      animation: "fully-animated",
      voice: { tone: "Excited, curious storyteller", wordsPerMinute: 175 },
      music: { mood: "Driving, curious electronic pulse", energy: "high" },
      captions: { style: "Big bold captions, word by word", position: "center", words: 1 },
    },
    IDEA_EXAMPLES,
  ),
  preset(
    "dark-history",
    "Dark history",
    "Grim true stories over painterly stills",
    "history",
    {
      format: "True story from history, told as a slow-burning mystery",
      hook: "A date, a place and an unsettling fact in the first line",
      shotSeconds: 5,
      pacing: "Slow, ominous build with pauses before the reveal",
      shots: ["Wide landscape", "Candle-lit close-up", "Map detail"],
      look: "Muted watercolour washes, sepia and deep blues, candlelight",
      styleId: "watercolor-chronicle",
      animation: "frame-by-frame",
      voice: { tone: "Low, calm, grave narrator", wordsPerMinute: 135 },
      music: { mood: "Dark cinematic drones, low strings", energy: "low" },
      captions: { style: "Plain white subtitles, full lines", position: "bottom", words: 6 },
    },
    ["The town that vanished overnight", "The plague doctor's last letter", "The lighthouse keepers who disappeared"],
  ),
  preset(
    "did-you-know",
    "Did you know?",
    "Snappy facts with labels and diagrams",
    "education",
    {
      format: "Rapid-fire facts: one surprising fact per beat, numbers on screen",
      hook: "“Did you know…?” with the most surprising number first",
      shotSeconds: 3,
      pacing: "Quick and punchy, one fact per shot",
      shots: ["Infographic close-up", "Labelled diagram", "Before/after split"],
      look: "Editorial motion graphics, photo cutouts, bold flat shapes, clean labels",
      styleId: "editorial-motion-graphics",
      animation: "scene-by-scene",
      voice: { tone: "Clear, upbeat explainer", wordsPerMinute: 165 },
      music: { mood: "Light upbeat pizzicato and claps", energy: "medium" },
      captions: { style: "Bold two-word captions with a highlight colour", position: "center", words: 2 },
    },
    ["Why octopuses have three hearts", "How a single ant colony feeds itself", "What happens to your body in space"],
  ),
  preset(
    "bedtime-fable",
    "Bedtime fable",
    "Gentle stories in a soft plush world",
    "kids",
    {
      format: "A short fable with a kind lesson at the end",
      hook: "“Once, in a cosy little forest…” over a warm establishing shot",
      shotSeconds: 6,
      pacing: "Slow and soothing, long gentle moves",
      shots: ["Cosy wide shot", "Soft close-up on the hero", "Starry night sky"],
      look: "Soft plush-toy world, felt textures, warm lamplight, pastel colours",
      styleId: "fluffy-toy",
      animation: "seamless",
      voice: { tone: "Warm, gentle, playful", wordsPerMinute: 130 },
      music: { mood: "Soft music box and glockenspiel lullaby", energy: "low" },
      captions: { style: "Rounded captions, short lines", position: "bottom", words: 4 },
    },
    ["The little cloud who was afraid of rain", "The fox who shared his lantern", "The turtle who wanted to fly"],
  ),
  preset(
    "countdown",
    "Top 5 countdown",
    "A ranked list with a big number one",
    "education",
    {
      format: "Top-5 countdown, from five to the number-one reveal",
      hook: "“Number one will surprise you” over a flash of all five",
      shotSeconds: 3,
      pacing: "Quick, each entry its own beat, a pause before number one",
      shots: ["Bold title card style frame", "Hero close-up", "Dramatic reveal"],
      look: "Bold flat poster vector art, strong silhouettes, limited palette, screen-print grain",
      styleId: "poster-vector",
      animation: "scene-by-scene",
      voice: { tone: "Punchy, confident host", wordsPerMinute: 170 },
      music: { mood: "Hype trap beat with risers", energy: "high" },
      captions: { style: "Huge bold captions, word by word", position: "center", words: 1 },
    },
    ["Top 5 deadliest animals that look harmless", "Top 5 inventions that happened by accident", "Top 5 places you're not allowed to visit"],
  ),
  preset(
    "tiny-worlds",
    "Tiny worlds",
    "Miniature paper dioramas, one calm long take",
    "storytelling",
    {
      format: "A calm journey through a miniature world",
      hook: "The camera glides into a tiny handmade world",
      shotSeconds: 7,
      pacing: "Slow, continuous, meditative",
      shots: ["Gliding wide shot", "Macro close-up", "Through-the-window move"],
      look: "Layered paper diorama, visible paper texture, warm miniature light",
      styleId: "paper-diorama",
      animation: "seamless",
      voice: { tone: "Soft, calm, wondering", wordsPerMinute: 125 },
      music: { mood: "Lo-fi ambient piano", energy: "low" },
      captions: { style: "Small clean subtitles, full lines", position: "bottom", words: 6 },
    },
    ["A day in a paper city", "The secret life of a tiny lighthouse", "A train through the paper mountains"],
  ),
  preset(
    "stick-explainer",
    "Stick-figure explainer",
    "Funny stickman scenes that explain one idea",
    "education",
    {
      format: "Humorous explainer: one idea told with stick figures",
      hook: "A stick figure in trouble and a question about why",
      shotSeconds: 3.5,
      pacing: "Comic timing, quick setups and punchlines",
      shots: ["Simple wide gag", "Reaction close-up", "Diagram on a whiteboard"],
      look: "Thick black stickman lines on off-white, a few flat colour accents",
      styleId: "stickman-cartoon",
      animation: "scene-by-scene",
      voice: { tone: "Dry, witty, friendly", wordsPerMinute: 165 },
      music: { mood: "Quirky ukulele and claps", energy: "medium" },
      captions: { style: "Hand-written style captions, a few words at a time", position: "bottom", words: 3 },
    },
    ["Why we procrastinate", "How compound interest actually works", "Why you can't tickle yourself"],
  ),
  preset(
    "myth-retold",
    "Myths retold",
    "Epic legends as animated storybook scenes",
    "storytelling",
    {
      format: "An ancient myth retold as an epic short",
      hook: "The god, the monster or the curse, named in the first line",
      shotSeconds: 4,
      pacing: "Epic build, big moments held a beat longer",
      shots: ["Heroic low angle", "Sweeping landscape", "Glowing magical close-up"],
      look: "Storybook gouache, glowing magical light, rich jewel tones, ornate details",
      styleId: "fairy-tale-myth",
      animation: "fully-animated",
      voice: { tone: "Deep, dramatic storyteller", wordsPerMinute: 145 },
      music: { mood: "Epic orchestral with choir", energy: "high" },
      captions: { style: "Elegant serif captions, full lines", position: "bottom", words: 5 },
    },
    ["Prometheus steals fire", "Thor loses his hammer", "The curse of King Midas"],
  ),
];

export const getPreset = (id: string | null | undefined): StylePreset | undefined => PRESETS.find((p) => p.id === id);

// ---------------------------------------------------------------------------
// The reference link

export type ReferencePlatform = "tiktok" | "instagram" | "youtube" | "direct" | "web";

export const PLATFORM_LABEL: Record<ReferencePlatform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", direct: "Video file", web: "Web page" };

/** Shown next to the link field (and on a reference from a link). */
export const PLATFORM_NOTE =
  "Use clips you have the right to use — TikTok's, Instagram's and YouTube's terms apply. Fuobe reads the style only (pacing, shots, captions, music mood), never the people, logos or words.";

const VIDEO_FILE = /\.(mp4|m4v|mov|webm)$/i;

/**
 * A pasted reference link, checked before anything is fetched: http(s) only, no user name or password, no
 * local host names, and for TikTok and Instagram a link to one video (not a profile). The server still fetches
 * it only through the SSRF-safe fetchRemote, which refuses private addresses.
 */
export function referenceLink(raw: string): { url: string; platform: ReferencePlatform } | { error: string } {
  let s = raw.trim();
  if (!s) return { error: "Paste a link to a video" };
  if (s.length > 2000) return { error: "That link is too long" };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "That doesn't look like a link — paste the whole address, starting with https://" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Paste a web link (https://…)" };
  if (u.username || u.password) return { error: "Links with a user name or password aren't fetched" };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || /\.(localhost|local|internal|lan|home)$/.test(host) || (!host.includes(".") && !host.includes(":"))) {
    return { error: "Paste a public link — Fuobe doesn't fetch from this machine or your network. Upload the file instead." };
  }
  const bare = host.replace(/^(www|m|mobile)\./, "");
  if (bare === "tiktok.com" || bare.endsWith(".tiktok.com")) {
    const short = /^(vm|vt)\.tiktok\.com$/.test(bare) && u.pathname.length > 1;
    if (!short && !/\/video\/\d+/.test(u.pathname) && !/^\/t\/\w+/.test(u.pathname)) return { error: "Paste the link to one TikTok video, not a profile or a search" };
    return { url: u.toString(), platform: "tiktok" };
  }
  if (bare === "instagram.com" || bare === "instagr.am") {
    if (!/^\/(reels?|p|tv)\/[\w-]+/.test(u.pathname)) return { error: "Paste the link to one Instagram reel or post, not a profile" };
    return { url: u.toString(), platform: "instagram" };
  }
  if (bare === "youtube.com" || bare === "youtu.be" || bare === "music.youtube.com") return { url: u.toString(), platform: "youtube" };
  return { url: u.toString(), platform: VIDEO_FILE.test(u.pathname) ? "direct" : "web" };
}

/** Why a link gave no video, and what to do instead (upload it). */
export function noMediaMessage(platform: ReferencePlatform): string {
  if (platform === "tiktok" || platform === "instagram" || platform === "youtube") {
    return `${PLATFORM_LABEL[platform]} doesn't hand its videos to other apps, so Fuobe can't fetch this one. Save the clip from the app (where its terms allow) and upload it here instead.`;
  }
  return "That page has no video Fuobe can fetch. Upload the clip instead.";
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\u002F/gi, "/");

/** A page's own video (Open Graph, Twitter player stream, a <video> or <source> tag), title and picture. */
export function pageMedia(html: string, base: string): { video: string | null; title: string | null; image: string | null } {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (...names: string[]) => {
    for (const n of names) {
      for (const m of metas) {
        const key = attr(m, "property") ?? attr(m, "name");
        if (key?.toLowerCase() === n) {
          const v = attr(m, "content");
          if (v) return decodeEntities(v);
        }
      }
    }
    return null;
  };
  const abs = (v: string | null) => {
    if (!v) return null;
    try {
      const u = new URL(v, base);
      return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
    } catch {
      return null;
    }
  };
  let video = abs(meta("og:video:secure_url", "og:video:url", "og:video", "twitter:player:stream"));
  if (!video) {
    const tag = /<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i.exec(html)?.[1];
    video = abs(tag ? decodeEntities(tag) : null);
  }
  // A player page (an embed) isn't the file itself.
  if (video && !VIDEO_FILE.test(new URL(video).pathname) && /\/(embed|player)\b/i.test(new URL(video).pathname)) video = null;
  const title = meta("og:title", "twitter:title") ?? (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || null);
  return { video, title: title ? decodeEntities(title).replace(/\s+/g, " ").slice(0, 200) : null, image: abs(meta("og:image:secure_url", "og:image", "twitter:image")) };
}

// ---------------------------------------------------------------------------
// The series: episode topics, and the settings every episode renders with

export interface SeriesEpisodePlan {
  title: string;
  synopsis: string;
}

export const SERIES_SYSTEM = `You plan a series of short faceless videos (one narrator over illustrated scenes).
Reply with JSON only: {"name": string, "episodes": [{"title": string, "synopsis": string}]}.
- name: a short, memorable series name (2–4 words).
- title: a specific, clickable episode title under 70 characters.
- synopsis: one or two sentences on what happens in that episode.
- Each episode works on its own, but together they build: the next one picks up where the last left off.
- Follow the genre, the tone and the format you are given.`;

export function seriesBrief(o: { prompt: string; genre: GenreInfo; count: number; format?: string; previous?: string[]; next?: string }): string {
  return [
    `Series about: ${o.prompt}`,
    `Genre: ${o.genre.label} — ${o.genre.hint}. Tone: ${o.genre.tone}.`,
    o.format ? `Format of every episode: ${o.format}` : "",
    o.previous?.length ? `Episodes so far (continue after them, don't repeat): ${o.previous.join("; ")}` : "",
    o.next?.trim() ? `What happens in the next episode: ${o.next.trim()}` : "",
    `Plan ${o.count} episode${o.count === 1 ? "" : "s"}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseSeries(answer: string): { name: string | null; episodes: SeriesEpisodePlan[] } | null {
  const j = extractJson(answer);
  const root = isObj(j) ? j : null;
  const list = Array.isArray(j) ? j : root ? field(root, "episodes", "items", "series") : null;
  if (!Array.isArray(list)) return null;
  const episodes = list
    .map((e) => (typeof e === "string" ? { title: e, synopsis: "" } : isObj(e) ? { title: text(field(e, "title", "name", "topic"), 140), synopsis: text(field(e, "synopsis", "summary", "description", "hook", "plot"), 400) } : null))
    .filter((e): e is SeriesEpisodePlan => !!e?.title);
  if (!episodes.length) return null;
  const name = root ? text(field(root, "name", "series_name", "title"), 60) || null : null;
  return { name, episodes };
}

const PARTS: Record<FacelessGenre, [string, string][]> = {
  storytelling: [
    ["The beginning", "Where it all starts, and the first sign that something is different."],
    ["The first change", "The world starts to bend, and someone notices."],
    ["The turning point", "One choice changes everything that follows."],
    ["Into the unknown", "Nobody knows what comes next, and the stakes rise."],
    ["The price", "What it costs, and who pays."],
    ["The truth comes out", "A secret about how it all began."],
    ["The last chance", "One way left to put it right."],
    ["The ending", "How it all ends, and what it leaves behind."],
  ],
  education: [
    ["The basics", "What it is and why it matters, in plain words."],
    ["How it works", "The mechanism, step by step, with pictures."],
    ["The surprising part", "The detail most people get wrong."],
    ["In everyday life", "Where you meet it without noticing."],
    ["The big numbers", "The figures that tell the real story."],
    ["Myths and mistakes", "What's true, what isn't, and why."],
    ["What's next", "Where it's heading, and what changes."],
    ["The recap", "Everything in one minute."],
  ],
  history: [
    ["Before it began", "The world just before it happened."],
    ["The spark", "The moment that set it off."],
    ["The rise", "How it grew faster than anyone expected."],
    ["The struggle", "Who fought back, and how."],
    ["The turning point", "The day the outcome was decided."],
    ["The fall", "How it came apart."],
    ["The forgotten people", "Names that deserve to be remembered."],
    ["The legacy", "What it left behind, and where to see it today."],
  ],
  kids: [
    ["Let's meet it!", "A bright, friendly first look."],
    ["What can it do?", "Fun things to spot and count."],
    ["A big surprise", "Something amazing, and nothing scary."],
    ["Let's try it!", "Play along at home."],
    ["Friends and helpers", "Who helps, and how we share."],
    ["The colours and shapes", "Spot every colour together."],
    ["A song to remember", "Sing along and remember it."],
    ["Goodnight", "A calm ending to the day."],
  ],
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Episode topics without an LLM: the genre's beats around the prompt, continuing after `offset` episodes. */
export function offlineSeries(prompt: string, genre: FacelessGenre, count: number, offset = 0): SeriesEpisodePlan[] {
  const subject = capital(subjectOf(prompt).replace(/[.!?]+$/, ""));
  if (count === 1 && offset === 0) return [{ title: subject.length > 70 ? `${subject.slice(0, 69)}…` : subject, synopsis: "" }];
  const parts = PARTS[genre] ?? PARTS.storytelling;
  return Array.from({ length: count }, (_, i) => {
    const n = offset + i;
    const [part, synopsis] = parts[n % parts.length];
    const round = Math.floor(n / parts.length);
    return { title: `${subject.length > 48 ? `${subject.slice(0, 47)}…` : subject}: ${part}${round ? ` (${round + 1})` : ""}`, synopsis };
  });
}

/**
 * What the writer of one episode is told: a single video is just the prompt; an episode of a series says
 * which one it is, what happens in it and which came before (so the story continues).
 */
export function episodeTopic(prompt: string, ep: SeriesEpisodePlan, o: { number: number; earlier: string[]; series: boolean }): string {
  const p = prompt.trim();
  if (!o.series) return [p, ep.synopsis].filter(Boolean).join(" — ").slice(0, 4800);
  return [
    `Episode ${o.number} of the series “${p.slice(0, 300)}”: ${ep.title}.`,
    ep.synopsis,
    o.earlier.length ? `Earlier episodes: ${o.earlier.slice(-6).join("; ")}.` : "This is the first episode: introduce the premise.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 4800);
}

/** A narrator for a tone: the premade voice whose description shares the most words with it. */
export function voiceForTone(tone: string, voices: { id: string; name: string; hint?: string }[], fallback: string): string {
  const SYN: Record<string, string[]> = {
    calm: ["relaxed", "smooth", "reassuring", "neutral"],
    gentle: ["warm", "relaxed", "soft"],
    soft: ["warm", "relaxed"],
    deep: ["deep", "resonant"],
    low: ["deep", "resonant"],
    grave: ["deep", "resonant", "mature"],
    energetic: ["energetic", "enthusiast", "social"],
    excited: ["energetic", "enthusiast"],
    upbeat: ["energetic", "bright", "optimist"],
    punchy: ["energetic", "confident"],
    warm: ["warm"],
    playful: ["playful", "quirky", "bright"],
    witty: ["quirky", "trickster", "charming"],
    dry: ["laid-back", "casual"],
    mysterious: ["husky", "captivating"],
    dramatic: ["captivating", "deep", "fierce"],
    epic: ["fierce", "deep", "captivating"],
    storyteller: ["storyteller", "captivating"],
    documentary: ["informative", "knowledgable", "professional"],
    clear: ["clear", "educator", "informative"],
    explainer: ["educator", "informative", "clear"],
    host: ["confident", "social"],
    confident: ["confident"],
    friendly: ["charming", "down-to-earth", "warm"],
    curious: ["engaging", "enthusiast"],
  };
  const words = tone.toLowerCase().match(/[a-z-]{3,}/g) ?? [];
  const wanted = new Set(words.flatMap((w) => [w, ...(SYN[w] ?? [])]));
  let best: { id: string; score: number } | null = null;
  for (const v of voices) {
    const hint = `${v.name} ${v.hint ?? ""}`.toLowerCase();
    let score = 0;
    for (const w of wanted) if (hint.includes(w)) score++;
    if (score > (best?.score ?? 0)) best = { id: v.id, score };
  }
  return best?.id ?? fallback;
}

/** Every episode's settings: the style's render mode, the brief's look and pacing, a narrator for its tone. */
export function seriesSettings(o: {
  engine: Engine;
  length: number;
  animation: AnimationStyleId;
  aspect: EpisodeAspect;
  brief: StyleBrief;
  genre: GenreInfo;
  /** The narrator the user picked (null on the open engine = none yet); undefined picks one for the brief's tone. */
  voice?: NarratorVoice | null;
  voices?: { id: string; name: string; hint?: string }[];
  subtitles?: boolean;
  music?: boolean;
}): EpisodeSettings {
  const style = animationStyle(o.animation);
  const base = defaultSettings(o.engine, o.genre);
  const voice = o.voice !== undefined ? o.voice : o.engine === "open" ? null : { kind: "preset" as const, id: voiceForTone(o.brief.voice.tone, o.voices ?? [], o.genre.voice) };
  return {
    ...base,
    length: CF_LENGTH_VALUES.includes(o.length) ? o.length : CF_LENGTH_VALUES[0],
    animation: style.mode,
    aspect: o.aspect,
    styleId: getStyle(o.brief.styleId).id,
    voice,
    subtitles: o.subtitles ?? true,
    music: o.music ?? true,
    brief: briefLook(o.brief, style),
  };
}

/** Scenes an episode of this length has at the brief's pace (what the writer is asked for). */
export const scenesFor = (length: number, sceneSeconds: number) => Math.max(1, Math.round(length / Math.max(MIN_BLOCK, sceneSeconds)));

// ---------------------------------------------------------------------------
// Prices

export interface SeriesPrice {
  /** The whole series (every episode, plus reading the reference when that's still to come). */
  total: number;
  perEpisode: number;
  episodes: number;
  analysisUsd: number;
  /** Some step has no published price (the total is a floor). */
  unknown: boolean;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function seriesPrice(perEpisode: Pick<CostBreakdown, "total" | "unknown">, episodes: number, analysisUsd = 0): SeriesPrice {
  const n = Math.max(1, Math.min(MAX_EPISODES, Math.round(episodes)));
  return { total: cents(perEpisode.total * n + analysisUsd), perEpisode: cents(perEpisode.total), episodes: n, analysisUsd: cents(analysisUsd), unknown: perEpisode.unknown };
}

/** Tokens Claude counts for one frame (a 9:16 or 16:9 frame resized to 1568 px on its long edge ≈ 882 × 1568 / 750). */
export const FRAME_TOKENS = 1850;
/** Claude Opus 5.5: $4 / $20 per million input / output tokens. */
const CLAUDE_IN = 4 / 1e6;
const CLAUDE_OUT = 20 / 1e6;

/** Reading a reference on the cloud: the frames (fal), the transcript (Scribe v2, per minute) and Claude looking at both. */
export function briefCostUsd(o: { seconds: number; framesUsd?: number; transcribePerMinute?: number; claude?: boolean }): number {
  const frames = Math.min(MAX_BRIEF_FRAMES, Math.max(1, Math.round(o.seconds)));
  const words = Math.round((o.seconds / 60) * 170 * 1.4);
  const claude = o.claude === false ? 0 : (frames * FRAME_TOKENS + 900 + words) * CLAUDE_IN + 1800 * CLAUDE_OUT;
  return Math.round(((o.framesUsd ?? 0) + (o.transcribePerMinute ?? 0) * Math.max(1, Math.ceil(o.seconds / 60)) + claude) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// "Generate in Claude": a message to paste into Claude Code with Fuobe's MCP server connected

/** Research: the composed message is capped at 64 KB. */
export const MAX_CLAUDE_MESSAGE = 64 * 1024;
/** faceless_episode (src/server/assist/studio-tools.ts) takes 2–8 scenes a call: a longer episode goes in parts. */
export const TOOL_MAX_SCENES = 8;

export function mcpCommand(origin: string, needsToken: boolean): string {
  return `claude mcp add --transport http fuobe ${origin.replace(/\/+$/, "")}/api/mcp${needsToken ? ' --header "Authorization: Bearer fuobe_…"' : ""}`;
}

export interface ClaudePlan {
  /** Seconds of narration a scene carries in the message. */
  sceneSeconds: number;
  /** What the brief's own pace would give a scene (shorter when the tool's 8 scenes don't cover the episode). */
  briefSceneSeconds: number;
  scenes: number;
  /** faceless_episode calls (separate videos) per episode. */
  parts: number;
  perPart: number;
  partSeconds: number;
}

/**
 * How an episode fits faceless_episode, which takes up to 8 scenes a call: scenes are lengthened first (up to
 * 10 s, the tool's own scene length), then a longer episode is made as parts, one call (one video) each.
 */
export function claudePlan(o: { length: number; brief: StyleBrief; animation: AnimationStyleId }): ClaudePlan {
  const briefSceneSeconds = sceneSecondsFor(animationStyle(o.animation), o.brief.shotSeconds);
  const sceneSeconds = Math.min(BLOCK_SECONDS, Math.max(briefSceneSeconds, Math.round(o.length / TOOL_MAX_SCENES)));
  const scenes = Math.max(2, scenesFor(o.length, sceneSeconds));
  const parts = Math.ceil(scenes / TOOL_MAX_SCENES);
  return { sceneSeconds, briefSceneSeconds, scenes, parts, perPart: Math.max(2, Math.ceil(scenes / parts)), partSeconds: Math.round(o.length / parts) };
}

export function claudeMessage(o: {
  prompt: string;
  brief: StyleBrief;
  length: number;
  episodes: number;
  animation: AnimationStyleId;
  genre: GenreInfo;
  aspect: EpisodeAspect;
  /** The engine Fuobe's MCP server runs on (Settings → Engine mode), not the composer's switch. */
  engine: Engine;
  voice?: string | null;
  /** On the open engine: the narrator's recording (a /api/files/ URL), so Claude needn't ask for one. */
  voiceSample?: string | null;
  reference?: string | null;
}): string {
  const style = animationStyle(o.animation);
  const { sceneSeconds: sceneSecs, briefSceneSeconds, scenes, parts, perPart, partSeconds } = claudePlan(o);
  const styleId = getStyle(o.brief.styleId).id;
  const words = wordsFor(sceneSecs);
  const look = `${getStyle(o.brief.styleId).look}. ${o.brief.look}`;
  const n = Math.max(1, Math.min(MAX_EPISODES, o.episodes));
  const lines = [
    `Make a faceless short-video ${n === 1 ? "episode" : `series of ${n} episodes`} with Fuobe (its MCP server is connected as "fuobe").`,
    "",
    `Make a video about: ${o.prompt.trim()}`,
    `Each episode: about ${formatLength(o.length)} long, ${o.aspect === "9:16" ? "vertical 9:16" : "horizontal 16:9"}, ${o.genre.label.toLowerCase()} (${o.genre.hint.toLowerCase()}; tone: ${o.genre.tone}).`,
    `Animation: ${style.label} — ${o.engine === "open" ? style.openCopy : style.copy}.`,
    "",
    `Style brief${o.reference ? ` (read from the reference ${o.reference})` : ""}. Use the style only, never the reference's people, characters, logos, brand names or exact words:`,
    ...briefLines(o.brief).map((l) => `- ${l}`),
    `- Look of every picture: ${look}`,
    "",
    "How to make it:",
    `1. Load the faceless-video skill (load_skill "faceless-video").`,
    n > 1 ? `2. Plan ${n} episode titles that build on each other, and show them to me.` : "2. Pick a specific, clickable title.",
    `3. For each episode write ${scenes} scenes: narration of at most ${words} words each (about ${sceneSecs} s spoken), the first one a hook as the brief says, and a visual for each in the look above. ${style.writer}`,
    sceneSecs > briefSceneSeconds
      ? `   Scenes run about ${sceneSecs} s here, longer than the brief's cuts (about ${o.brief.shotSeconds} s a shot), so that faceless_episode's ${TOOL_MAX_SCENES} scenes a call cover more of the episode: give every visual a camera move or a change of view so it keeps the brief's pace.`
      : null,
    parts > 1
      ? `   faceless_episode makes one video of up to ${TOOL_MAX_SCENES} scenes a call, so each episode comes out as ${parts} parts of about ${perPart} scenes (about ${formatLength(partSeconds)} each), one call per part, titled “<episode title> — Part 1”, “— Part 2”…. Tell me this before I approve anything, and when they're done list each episode's parts in order: Join clips in Fuobe's Video tools puts them together into one video.`
      : null,
    `4. Price each ${parts > 1 ? "part" : "episode"} with estimate_job (tool "faceless_episode") and wait for my OK before running anything.`,
    `5. Run faceless_episode once per ${parts > 1 ? "part" : "episode"} with style_id "${styleId}", style "${look.replace(/"/g, "'").slice(0, 600)}", aspect_ratio "${o.aspect}"${o.engine === "open" ? (o.voiceSample ? ` and voice_sample "${o.voiceSample}"` : "") : o.voice ? ` and voice "${o.voice}"` : ""}, then follow it with check_generations and give me the links when they're done.`,
    o.engine === "open"
      ? o.voiceSample
        ? "Fuobe runs this on the open-source engine (my ComfyUI): no fees, and the narration clones the voice sample above."
        : "Fuobe runs this on the open-source engine (my ComfyUI), which clones the narrator's voice: ask me for a 10–60 s voice sample (voice_sample) before running."
      : null,
  ]
    .filter((l): l is string => l !== null)
    .filter((l, i, all) => l !== "" || (all[i - 1] !== "" && i > 0));
  let out = lines.join("\n");
  // Within the parity studio's 64 KB cap (a very long prompt is cut, never the instructions).
  while (new TextEncoder().encode(out).length > MAX_CLAUDE_MESSAGE) out = out.replace(/Make a video about: ([\s\S]*?)\n/, (_m, p: string) => `Make a video about: ${p.slice(0, Math.floor(p.length * 0.8))}…\n`);
  return out;
}

// ---------------------------------------------------------------------------
// What the API sends (shared by src/server/content-factory.ts and the browser)

export interface SeriesReference {
  kind: "upload" | "link" | "preset";
  /** The clip, saved here (an upload, or fetched from the link). */
  url?: string;
  /** The pasted link it came from. */
  link?: string;
  platform?: ReferencePlatform;
  presetId?: string;
  title?: string;
  /** A picture for the card (the link's preview image, saved as an upload). */
  thumbnail?: string;
  seconds?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export type AnalysisStatus = "reading" | "ready" | "failed";

export interface SeriesAnalysis {
  engine: Engine;
  status: AnalysisStatus;
  /** Generations that read the clip: its frames and transcript (cloud), or the brief itself (open). */
  steps: { frames?: string; transcript?: string; brief?: string };
  /** What's happening now ("Reading the frames…"). */
  stage?: string;
  error?: string;
  /** The brief came from the offline writer (and why). */
  offline?: boolean;
  note?: string;
  costUsd?: number | null;
  demo?: boolean;
}

export interface SeriesSettings {
  engine: Engine;
  length: number;
  episodes: number;
  animation: AnimationStyleId;
  genre: FacelessGenre;
  aspect: EpisodeAspect;
}

export interface SeriesView {
  id: string;
  name: string | null;
  prompt: string;
  reference: SeriesReference | null;
  analysis: SeriesAnalysis | null;
  brief: StyleBrief | null;
  settings: SeriesSettings | null;
  /** The planned episodes (titles), in order. */
  plan: SeriesEpisodePlan[];
  channel: FacelessChannel | null;
  /** "Generate here" has made it (its channel may since have been deleted in Faceless Studio: then channel is null). */
  made: boolean;
  episodes: EpisodeCard[];
  createdAt: number;
  updatedAt: number;
}

/** A series in the list. */
export interface SeriesCard {
  id: string;
  name: string;
  prompt: string;
  channelId: string;
  episodes: number;
  done: number;
  rendering: number;
  poster: EpisodeCard["still"];
  thumbnail: string | null;
  styleId: string;
  aspect: EpisodeAspect;
  updatedAt: number;
}

/** What the "Generate in Claude" dialog shows (POST /api/content-factory/claude). */
export interface ClaudePrompt {
  message: string;
  bytes: number;
  needsToken: boolean;
  /** The engine Claude's runs use: Fuobe's MCP server follows Settings → Engine mode (cloud unless it's "open source only"). */
  engine: Engine;
  /** Said in the dialog when that isn't the composer's engine. */
  engineNote?: string;
  /** How each episode reaches faceless_episode (8 scenes a call): more than one part means separate videos. */
  parts: number;
  partSeconds: number;
}

export interface SeriesEstimate {
  price: SeriesPrice;
  demo: boolean;
  /** The episode's length and scenes at the brief's pace. */
  seconds: number;
  scenes: number;
  error?: string;
  notes?: string[];
  /** What reading a 1-minute reference costs on this engine (shown before an upload). */
  analysisPerMinute: number;
  /** The reference is still being read: priced from its length and shape, and priced again once its brief is in. */
  briefPending?: boolean;
}
