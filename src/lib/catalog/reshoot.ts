/**
 * Fuobe Reshoot: the same shot with something changed. Viggle Remake (Viggle AI; MiniMax H3 with Viggle's swap or edit
 * weights merged in, ComfyUI-Viggle-Remake nodes) keeps the clip's motion, camera, timing and sound, and takes from a
 * painted first frame who is in it (swap) or what is in it (edit).
 *
 * A run: the part fitted to 24 fps on the H3 canvas, the part's first frame, that frame painted with the change
 * (Qwen-Image 2.1 on your GPU; or your own painted frame), then one Remake render pinned to it. The render's graph
 * describes the part's motion itself (Qwen3-VL 8B) and puts that description into Remake's six-section prompt where
 * "{scene}" stands.
 *
 * Pure module: limits, frame counts, the prompts and the graph's settings. Genjutsu plans the steps
 * (src/lib/catalog/genjutsu.ts planReshoot); the provider writes the settings (src/lib/reshoot-graph.ts).
 */

export type ReshootChoice = "swap" | "edit";

export const RESHOOT_CHOICES: { id: ReshootChoice; label: string; hint: string }[] = [
  { id: "swap", label: "Who's in it", hint: "Someone new plays the part: the same moves, the same camera, the same sound." },
  { id: "edit", label: "What's in it", hint: "Change an outfit, an object, the place, the weather or the light. Everything else stays as filmed." },
];

/** The two graphs, one per choice (each loads its own Remake weights). */
export const RESHOOT_WORKFLOWS: Record<ReshootChoice, string> = { swap: "video-reshoot-swap-h3", edit: "video-reshoot-edit-h3" };

/** The model a Reshoot render runs on (both graphs). */
export const RESHOOT_MODEL = "oss-h3-reshoot";

export const RESHOOT = {
  fps: 24,
  /** Remake's window: 90 to 345 frames on H3's 17n + 5 grid. */
  minFrames: 90,
  maxFrames: 345,
  /**
   * The longest render a 32 GB card makes at each size with the int8 weights: 294 frames (12.25 s, the most the authors
   * advise) at 480p; 175 frames (7.3 s) at 720p (1280 × 736).
   */
  maxFramesAt: { "480p": 294, "720p": 175 } as Record<string, number>,
  qualities: ["480p", "720p"],
  defaultQuality: "480p",
  /** The part: whole seconds a person picks. */
  minSeconds: 4,
  maxSeconds: 12,
  /** The canvas's short edge per quality (Remake's 480 and 736). */
  shortEdge: { "480p": 480, "720p": 736 } as Record<string, number>,
  /** Pictures: the character (swap) or how the change looks (edit); the painting step reads up to three. */
  maxPictures: 3,
  whoChars: 120,
  wordsChars: 600,
  /** The keyframes stop guiding the render below this noise level (the authors' setting). */
  keyframeUntil: 0.9,
} as const;

/** Remake's step schedule per choice (6 steps, from the authors' graphs). */
export const RESHOOT_SIGMAS: Record<ReshootChoice, string> = {
  swap: "1.0, 0.990476, 0.965243, 0.923077, 0.8, 0.631579, 0.0",
  edit: "1.0, 0.983607, 0.96, 0.923077, 0.857143, 0.705882, 0.0",
};

/** Reshoot's settings (Genjutsu's body.reshoot). */
export interface ReshootOptions {
  choice: ReshootChoice;
  /** Swap: who in the clip is replaced ("the woman in the red coat"); empty: the person with the most screen time. */
  who?: string;
  /** Swap: the new person in a few visible facts (optional). Edit: what changes (required). */
  words?: string;
  /** The first picture is already the part's first frame with the change painted in: no painting step. */
  painted?: boolean;
}

const clean = (s: string | undefined, max: number) =>
  (s ?? "")
    .replace(/[{}<>[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "")
    .slice(0, max);

/** The quality a run renders at: 480p unless 720p is asked for and the part fits its limit. */
export function reshootQuality(quality: string | undefined): "480p" | "720p" {
  return quality === "720p" || quality === "768p" || quality === "1080p" ? "720p" : "480p";
}

/**
 * Frames Remake renders for a part of `seconds` at `quality`: the longest 17n + 5 count the part holds, at most the
 * quality's limit. Null when the part is too short (under 90 frames, 3.75 s).
 */
export function reshootFrames(seconds: number, quality: string): number | null {
  const have = Math.floor(seconds * RESHOOT.fps + 1e-6);
  const cap = Math.min(RESHOOT.maxFrames, RESHOOT.maxFramesAt[reshootQuality(quality)]);
  let f = Math.min(have, cap);
  while (f >= RESHOOT.minFrames && f % 17 !== 5) f--;
  return f >= RESHOOT.minFrames ? f : null;
}

/** The longest part a quality renders in full, in seconds (12.25 at 480p, 7.29 at 720p). */
export const reshootMaxSeconds = (quality: string) => RESHOOT.maxFramesAt[reshootQuality(quality)] / RESHOOT.fps;

/** "MM:SS.mmm" for a frame count at 24 fps. */
export function stamp(frames: number): string {
  const ms = Math.round((frames / RESHOOT.fps) * 1000);
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

/** What stops a Reshoot request, in words, or null. */
export function reshootProblem(o: ReshootOptions | undefined, pictures: number, seconds: number, quality: string): string | null {
  const r = o ?? { choice: "swap" as const };
  if (r.choice === "swap" && pictures < 1) return r.painted ? "Add your painted first frame" : "Add a picture of who plays the part";
  if (r.choice === "edit" && !clean(r.words, RESHOOT.wordsChars)) return "Say what changes";
  if (r.choice === "edit" && r.painted && pictures < 1) return "Add your painted first frame";
  if (pictures > RESHOOT.maxPictures) return `Up to ${RESHOOT.maxPictures} pictures`;
  if (!reshootFrames(seconds, quality)) return `Pick at least ${RESHOOT.minSeconds} seconds`;
  return null;
}

/**
 * The painting step's instruction (an image edit of the part's first frame, image 1; the pictures follow as images 2…).
 * It names only what the frame should show.
 */
export function paintPrompt(o: ReshootOptions, pictures: number): string {
  if (o.choice === "swap") {
    const who = clean(o.who, RESHOOT.whoChars) || "the person with the most screen time";
    const about = clean(o.words, RESHOOT.wordsChars);
    return (
      `Image 1 is a frame from a video. Replace ${who} in image 1 with the person from image 2${about ? ` (${about})` : ""}: ` +
      "their face, hair, body and complete outfit exactly as image 2 shows them. " +
      "Keep the exact pose, head angle, gaze, mouth, expression, hand positions and size from image 1, and keep everyone else, the whole setting, the framing, the light and the aspect ratio of image 1 as they are. " +
      "One photorealistic frame of the same video."
    );
  }
  const change = clean(o.words, RESHOOT.wordsChars);
  const look = pictures > 0 ? ` Take how it looks from ${pictures > 1 ? `images 2 to ${pictures + 1}` : "image 2"}.` : "";
  return (
    `Image 1 is a frame from a video. Edit image 1 so that ${change}.${look} ` +
    "Keep the framing, the camera angle, the people and their poses, and the aspect ratio of image 1, and keep every part of image 1 that the change leaves alone exactly as it is. " +
    "One photorealistic frame of the same video."
  );
}

/**
 * The describer's instruction (Qwen3-VL 8B reads the part at two frames a second). Its paragraph replaces "{scene}" in
 * the render's prompt: movement, gaze, camera and cuts only, so the painted frame carries every look.
 */
export function describerPrompt(o: ReshootOptions): string {
  const who = o.choice === "swap" ? clean(o.who, RESHOOT.whoChars) || "the person with the most screen time" : "the main person";
  return (
    "These are frames from one video clip, in time order, two per second. Describe how things move, for a video model that remakes the clip. " +
    `Write one paragraph of 50 to 140 words in the present tense, calling ${who} "the person". ` +
    "Go through the frames in order: what each person does with their body, hands, head and mouth, where they look, how the camera moves, and when the shot cuts. " +
    "Describe movement only: say nothing about anyone's hair, face, body, skin or clothing, nothing about objects, the setting, the weather, the light or colours, and no times. " +
    "Write movements at the speed they happen. No preamble, lists or Markdown."
  );
}

/**
 * Remake's six-section prompt, written as the target video (MiniMax H3's layout with <Video 1> the part and
 * <Picture 1> the painted first frame, pinned at frame 0). "{scene}" is where the graph puts the describer's paragraph.
 */
export function reshootPrompt(o: ReshootOptions, frames: number): string {
  const end = stamp(frames);
  if (o.choice === "swap") {
    const who = clean(o.who, RESHOOT.whoChars) || "the person with the most screen time";
    const about = clean(o.words, RESHOOT.wordsChars);
    return [
      "subject_definitions:",
      "<Video 1> is the source video for the target video edit.",
      "<Picture 1> is the first frame of the target video, exactly as the target video shows it at 00:00.000.",
      `<Subject 1> is the person in <Picture 1>${about ? `: ${about}` : ""}. <Subject 1> takes the place of ${who} in <Video 1>.`,
      "",
      "summary:",
      `[video editing + character replacement] The target video is an edited version of <Video 1> in which ${who} becomes <Subject 1>, exactly as in <Picture 1>, in every frame through the last frame. The framing, the camera movement, the setting, every movement and the timing stay as in <Video 1>.`,
      "",
      "retention_analysis:",
      `<Video 1> (source video editing): fully_preserved - the framing, the camera movement, every cut, the setting, the light, the other people, and every movement, gesture, expression and mouth movement with its timing, from 00:00.000 to ${end}, are copied frame for frame.`,
      "<Picture 1> (target keyframe): fully_preserved - the target video passes through this exact frame at 00:00.000. The face, hair and complete outfit of <Subject 1> are taken from <Picture 1>.",
      `<Subject 1> (appears in [Shot 1]): changed - ${who} becomes <Subject 1>; the face, hair and complete outfit of <Subject 1> stay identical in every frame through the last frame, also in close-up and in profile.`,
      "",
      "detailed_description:",
      "The target video keeps the look, the light and the colour of <Video 1>.",
      `[Shot 1] {scene} The person is <Subject 1>, exactly as in <Picture 1>, in every frame from 00:00.000 to ${end}, moving at the pace of <Video 1> in real time. Everything else stays as in <Video 1>.`,
      "",
      "overall_soundscape:",
      "The source soundtrack of <Video 1> is reused unchanged as the whole sound.",
      "",
      "non_diegetic_music:",
      "N/A",
    ].join("\n");
  }
  const change = clean(o.words, RESHOOT.wordsChars);
  return [
    "subject_definitions:",
    "<Video 1> is the source video for the target video edit.",
    "<Picture 1> is the first frame of the target video, exactly as the target video shows it at 00:00.000.",
    `<Subject 1> is what changes, as <Picture 1> shows it: ${change}.`,
    "",
    "summary:",
    `[video editing] The target video is an edited version of <Video 1>: ${change}, from the first frame to the last, exactly as in <Picture 1>, with the same framing, camera movement, motion and timing as <Video 1>.`,
    "",
    "retention_analysis:",
    `<Video 1> (source video editing): fully_preserved - the framing, the camera movement, every cut, and every movement and gesture of the people with its timing, from 00:00.000 to ${end}, are copied frame for frame; every part of the shot that <Subject 1> leaves alone stays as in <Video 1>.`,
    "<Picture 1> (target keyframe): fully_preserved - the target video passes through this exact frame at 00:00.000.",
    `<Subject 1> (appears in [Shot 1]): changed - ${change}, in every frame from the first to the last and in every part of the frame, as in <Picture 1>.`,
    "",
    "detailed_description:",
    `[Shot 1] {scene} Throughout, ${change}, exactly as in <Picture 1>, from 00:00.000 to ${end}. Every part of the shot that this leaves alone stays as in <Video 1>.`,
    "",
    "overall_soundscape:",
    "The source soundtrack of <Video 1> is reused unchanged as the whole sound.",
    "",
    "non_diegetic_music:",
    "N/A",
  ].join("\n");
}

/** Reshoot's settings as they travel to the graph (params.extra.openjutsu). */
export interface ReshootGraphSettings {
  frames: number;
  quality: "480p" | "720p";
  /** The describer's instruction. */
  describe: string;
  seed: number;
}
