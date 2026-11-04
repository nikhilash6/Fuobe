/**
 * The Openjutsu graphs Genjutsu sends to your GPU (Group swap, Scene edit, From picture, Fix faces, Fix colours): the
 * settings each request writes into Fuobe's copies of D3voz's Openjutsu graphs (MIT, scripts/comfy/hand-built/), and the
 * branches it leaves out. Ported from Openjutsu's lib/{simple,advanced,object,picture,face,color}.ts at 7fe118bb: nodes
 * are found by their titles, as there. Pure, so the provider (src/server/providers/comfyui.ts) and the tests share it.
 *
 * Fuobe's changes to the port: every job gets its own Context Loop run name (fuobe_<generation id>), so a job never
 * resumes another one's clips and its folder can be deleted afterwards; the request and look words name only what is
 * wanted; the video canvas never goes past 2048 px a side.
 */
import type { ComfyWorkflow } from "./comfy";

type Link = [string, number];
export const isLink = (v: unknown): v is Link => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

const clone = (g: ComfyWorkflow): ComfyWorkflow => JSON.parse(JSON.stringify(g)) as ComfyWorkflow;

export function nodeByTitle(graph: ComfyWorkflow, title: string): string {
  const ids = Object.keys(graph).filter((id) => graph[id]._meta?.title === title);
  if (ids.length !== 1) throw new Error(`Expected one "${title}" node in the workflow, found ${ids.length}.`);
  return ids[0];
}

/** Every link still points at a node that is there. */
export function danglingLinks(graph: ComfyWorkflow): string[] {
  const out: string[] = [];
  for (const [id, n] of Object.entries(graph)) for (const [k, v] of Object.entries(n.inputs)) if (isLink(v) && !graph[v[0]]) out.push(`${id}.${k} → ${v[0]}`);
  return out;
}

function assertLinked(graph: ComfyWorkflow) {
  const d = danglingLinks(graph);
  if (d.length) throw new Error(`The graph still links to removed nodes: ${d.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Shared settings

/** Genjutsu's quality → the pack's preset (short edge): 720p is the pack's own 736p. */
export const OJ_RESOLUTION: Record<string, string> = { "480p": "480p", "720p": "736p", "1080p": "1080p" };
export const ojResolution = (q: string | undefined) => OJ_RESOLUTION[q ?? ""] ?? "736p";

/** Mask growth at SAM's 1008 px canvas. */
export const SWAP_MARGINS = { tight: 20, normal: 40, loose: 60 } as const;
export const OBJECT_MARGINS = { tight: 10, normal: 20, loose: 40 } as const;
export type Edge = keyof typeof SWAP_MARGINS;

/** Long edge of the grey-mannequin motion reference H3 follows. */
export const MOTION_SIZES = [512, 768] as const;
export type MotionSize = (typeof MOTION_SIZES)[number];

/** Each H3 clip of a Context Loop job: 6 s, with 39 frames of overlap. */
export const CLIP_SECONDS = 6;

/** The canvas the pack makes for a source of this size (plan_clips), on 32 px steps. */
export function canvasSize(width: number, height: number, preset: string): [number, number] {
  const scale = parseInt(preset, 10) / Math.min(width, height);
  return [width, height].map((side) => Math.max(32, Math.round((side * scale) / 32) * 32)) as [number, number];
}

/** A canvas at most `max` px on its long side (Openjutsu issue #37: wide clips at 1080p went past 2048). */
export function clampCanvas([w, h]: [number, number], max = 2048): [number, number] {
  const k = Math.min(1, max / Math.max(w, h));
  return k === 1 ? [w, h] : [Math.max(32, Math.floor((w * k) / 32) * 32), Math.max(32, Math.floor((h * k) / 32) * 32)];
}

/** The Context Loop run name of one Fuobe job: its folder under output/h3_chains is this job's alone. */
export const runName = (generationId: string) => `fuobe_${generationId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48) || "job"}`;

function setRunName(graph: ComfyWorkflow, name: string) {
  const plans = Object.values(graph).filter((n) => n.class_type === "MiniMaxH3ChainPlanModern");
  if (plans.length !== 1) throw new Error(`Expected one Production Plan node in the workflow, found ${plans.length}.`);
  plans[0].inputs.run_name = name;
}

function setMotionSize(graph: ComfyWorkflow, size: MotionSize) {
  const nodes = Object.values(graph).filter((n) => n.class_type === "ImageScaleToMaxDimension" && /motion reference/i.test(n._meta?.title ?? ""));
  if (!nodes.length) throw new Error("Expected a motion reference resize in the workflow.");
  for (const n of nodes) n.inputs.largest_size = size;
}

// The No lip-sync nodes, titled the same in every swap graph.
const MUTE = /^Mute the (clip|reference) audio H3 hears$/;
const NO_LIP_SYNC = /^(No lip-sync in the prompt|SAM: faces|SAM 3\.1 track faces|Faces \(shown on the mannequins?\))$/;

/** Mouths follow the sound (No lip-sync off): those nodes go, H3 hears the soundtrack and the mannequins get no faces. */
export function dropNoLipSync(graph: ComfyWorkflow) {
  const through = new Map<string, unknown>();
  for (const [id, n] of Object.entries(graph)) {
    const title = n._meta?.title ?? "";
    if (MUTE.test(title)) through.set(id, n.inputs.audio);
    else if (NO_LIP_SYNC.test(title)) through.set(id, undefined);
  }
  for (const id of through.keys()) delete graph[id];
  for (const [id, n] of Object.entries(graph)) {
    for (const [name, value] of Object.entries(n.inputs)) {
      if (!isLink(value) || !through.has(value[0])) continue;
      if (through.get(value[0])) n.inputs[name] = through.get(value[0]);
      else if (["no_lip_sync", "faces", "face_size"].includes(name)) delete n.inputs[name];
      else throw new Error(`Node ${id}.${name} still links to removed node ${value[0]}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Group swap (advanced / advanced_maxq)

export const GROUP_PLAN = "Swap Plan (roles, seed, size)";
export const MAX_CHARACTERS = 4;
const HAT = /\bhats?\b/i;

export interface GroupSwapSettings {
  /** Character pictures sent (1–4; one by one takes exactly 2). */
  pictures: number;
  /** Who each character replaces, in words ("" lets the describer name them). */
  roles: string[];
  resolution: string;
  motion: MotionSize;
  hatFix: boolean;
  noLipSync: boolean;
  edge: Edge;
  seed: number;
  run: string;
}

export const pictureCount = (graph: ComfyWorkflow) => Object.values(graph).filter((n) => n.class_type === "LoadImage" && /^Picture \d$/.test(n._meta?.title ?? "")).length;

/** Names for characters left without a role when others have one, as the Swap Plan's own defaults. */
export function ordinalRole(i: number, count: number): string {
  return count === 1 ? "the main person" : `the person with the ${["", "second ", "third ", "fourth "][i]}most screen time`;
}

/** The Swap Plan's roles, one line per character ("" when none was given). */
export function rolesText(roles: string[], pictures: number): string {
  const r = Array.from({ length: pictures }, (_, i) => (roles[i] ?? "").replace(/\s+/g, " ").trim().slice(0, 80));
  return r.some(Boolean) ? r.map((role, i) => role || ordinalRole(i, pictures)).join("\n") : "";
}

export function pruneGroupSwap(source: ComfyWorkflow, s: GroupSwapSettings): ComfyWorkflow {
  const graph = clone(source);
  const available = pictureCount(graph);
  if (s.pictures < 1 || s.pictures > available) throw new Error(`This takes 1–${available} character pictures.`);
  const removed = new Set<string>();
  // Unused pictures: the photo, its shrink and its describer go; inputs that read them are dropped.
  for (let k = s.pictures + 1; k <= available; k++) {
    const load = nodeByTitle(graph, `Picture ${k}`);
    const shrink = Object.keys(graph).find((id) => graph[id].class_type === "ImageScaleToMaxDimension" && isLink(graph[id].inputs.image) && (graph[id].inputs.image as Link)[0] === load);
    const describe = nodeByTitle(graph, `Describe picture ${k}`);
    for (const id of [load, shrink, describe]) if (id) removed.add(id);
  }
  // Hats off: the hat nodes go; whatever read "people + hats" reads the people mask instead.
  const bypass = new Map<string, unknown>();
  if (!s.hatFix) {
    for (const [id, n] of Object.entries(graph)) {
      if (!HAT.test(n._meta?.title ?? "")) continue;
      removed.add(id);
      if (n.class_type === "MaskComposite" && n.inputs.operation === "add") bypass.set(id, n.inputs.destination);
    }
  }
  for (const id of removed) delete graph[id];
  for (const [id, n] of Object.entries(graph)) {
    for (const [name, value] of Object.entries(n.inputs)) {
      if (!isLink(value) || !removed.has(value[0])) continue;
      if (bypass.has(value[0])) n.inputs[name] = bypass.get(value[0]);
      else if (/^picture_\d/.test(name) || name.startsWith("ref_images.")) delete n.inputs[name];
      else throw new Error(`Node ${id}.${name} still links to removed node ${value[0]}.`);
    }
  }
  if (!s.noLipSync) dropNoLipSync(graph);
  setMotionSize(graph, s.motion);
  for (const n of Object.values(graph)) if (n.class_type === "GrowMaskWithBlur" && / grow mask /.test(n._meta?.title ?? "")) n.inputs.expand = SWAP_MARGINS[s.edge];
  const plan = graph[nodeByTitle(graph, GROUP_PLAN)].inputs;
  Object.assign(plan, { resolution: s.resolution, seed: s.seed, clip_seconds: CLIP_SECONDS, roles: rolesText(s.roles, s.pictures) });
  setRunName(graph, s.run);
  assertLinked(graph);
  return graph;
}

// ---------------------------------------------------------------------------
// Scene edit (object)

export type SceneAction = "change" | "remove" | "background";
export const SCENE_PLAN = "Object Swap Plan (what to change)";

/** A painted keyframe: run-length encoded at ≤ 256 px (start, length pairs over the row-major mask). */
export interface PaintKeyframe {
  frame: number;
  width: number;
  height: number;
  runs: number[];
}

export interface SceneEditSettings {
  action: SceneAction;
  /** What SAM tracks (several, comma-separated); for New background, what stays. */
  target: string;
  /** What it becomes, or for Remove it what shows there. */
  becomes: string;
  /** A picture was sent ("What goes in" / "The new place"). */
  picture: boolean;
  biggestOnly: boolean;
  keepShape: boolean;
  edge: Edge;
  motion: MotionSize;
  resolution: string;
  seed: number;
  run: string;
  paint?: PaintKeyframe[];
}

export const objectTargets = (target: string) => target.split(",").map((t) => t.trim()).filter(Boolean);

/** The picture describer names only what is copied from the picture, about 20 more words for each thing. */
function sceneDescriber(s: SceneEditSettings) {
  const background = s.action === "background";
  const things = background ? ["place (the setting, its lighting and what is around)"] : objectTargets(s.target);
  const named = things.length === 1 ? things[0] : `${things.slice(0, -1).join(", ")} and the ${things.at(-1)}`;
  const words = 30 + 20 * things.length;
  return {
    prompt:
      `Describe the ${named} in this picture in about ${words} words${things.length > 1 ? ", one sentence for each" : ""}: their shape, colours, materials, patterns and details. ` +
      (background ? "" : "Include every layer worn there, outer layer first: an open shirt or jacket over a top is part of the top. ") +
      "Start straight with the description.",
    max_length: 2 * words + 40,
  };
}

/** A painted mask (white = paint) as the pack's run-length keyframe, scaled to at most 256 px a side. */
export function paintKeyframe(mask: { width: number; height: number; data: Uint8Array | Uint8ClampedArray; channels?: number }): PaintKeyframe {
  const ch = mask.channels ?? 4;
  const k = Math.min(1, 256 / Math.max(mask.width, mask.height));
  const w = Math.max(1, Math.round(mask.width * k));
  const h = Math.max(1, Math.round(mask.height * k));
  const runs: number[] = [];
  let start = -1;
  for (let i = 0; i < w * h; i++) {
    const x = Math.min(mask.width - 1, Math.floor(((i % w) + 0.5) / k));
    const y = Math.min(mask.height - 1, Math.floor((Math.floor(i / w) + 0.5) / k));
    const on = mask.data[(y * mask.width + x) * ch] > 127;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      runs.push(start, i - start);
      start = -1;
    }
  }
  if (start >= 0) runs.push(start, w * h - start);
  return { frame: 0, width: w, height: h, runs };
}

export function pruneSceneEdit(source: ComfyWorkflow, s: SceneEditSettings): ComfyWorkflow {
  const graph = clone(source);
  const id = (title: string) => nodeByTitle(graph, title);
  const plan = graph[id(SCENE_PLAN)].inputs;
  const ref = graph[id("Reference Conditioning")].inputs;
  const grow = graph[id("Grow mask")].inputs;
  const grey = graph[id("Turn it grey (shape and movement only)")].inputs;
  if (s.picture && s.action !== "remove") Object.assign(graph[id("Describe picture 1")].inputs, sceneDescriber(s));
  if (!s.picture || s.action === "remove") {
    for (const title of ["Picture 1", "Shrink for the describer", "Describe picture 1"]) delete graph[id(title)];
    delete plan.picture_1;
    delete plan.picture_1_text;
    delete ref["ref_images.ref_image_0"];
  }
  // H3 copies a grey shape's outline: a changed top keeps the old silhouette, and a removed thing would come back grey.
  if (s.action === "remove" || (s.action === "change" && !s.keepShape)) {
    delete ref["ref_videos.ref_video_0"];
    delete ref["ref_video_audios.ref_video_audio_0"];
  }
  // New background: everything but what stays, reaching a little into its edge; the whole of it turns grey.
  if (s.action === "background") {
    grow.flip_input = true;
    grey.mask = [id("Grow mask"), 0];
    grey.size = [id("Grow mask"), 0];
  }
  grow.expand = OBJECT_MARGINS[s.edge];
  setMotionSize(graph, s.motion);
  const most = s.biggestOnly ? objectTargets(s.target).length : 0;
  for (const title of ["Tracked area", "Tracked area, tight (for the grey shape)"]) graph[id(title)].inputs.max_people = most;
  graph[id("SAM: what to change")].inputs.text = s.target;
  Object.assign(plan, { mode: s.action, target: s.target, change_to: s.becomes, keep_outline: s.keepShape, seed: s.seed, clip_seconds: CLIP_SECONDS, resolution: s.resolution });
  if (s.action === "change" && s.paint?.length) {
    const paint = JSON.stringify(s.paint);
    plan.paint = paint;
    // Track the whole part once: later clips still need the box at each painted frame.
    graph[id("SAM 3.1 track it")].inputs.images = [id("SAM video (1008 px, SAM's own size)"), 0];
    graph[id("Tracked area")].inputs.hold_frames = 0;
    graph.object_paint = {
      class_type: "H3PaintedEditArea",
      inputs: { tracked: [id("Tracked area"), 0], paint, start_frame: 0, width: [id(SCENE_PLAN), 1], height: [id(SCENE_PLAN), 2] },
      _meta: { title: "Painted edit area (follows tracked mask)" },
    };
    const slice = (mask: Link) => ({ class_type: "MiniMaxH3ContexLoopMaskSlice", inputs: { mask, state: [id("Current Clip"), 0], source_fps: 24 } });
    graph.object_paint_clip = slice(["object_paint", 0]);
    grow.mask = ["object_paint_clip", 0];
    for (const [input, output] of [["mask", 0], ["size", 1]] as const) {
      const key = `object_tight_${input}`;
      graph[key] = slice([id("Tracked area, tight (for the grey shape)"), output]);
      grey[input] = [key, 0];
    }
  }
  setRunName(graph, s.run);
  assertLinked(graph);
  return graph;
}

// ---------------------------------------------------------------------------
// From picture: the first frame, what happens, the video

/** The 17 light looks: Fuobe's names and hints, and the words the prompt helper reads (each names only what is wanted). */
export const LIGHT_LOOKS = [
  { id: "cold-spotlight", name: "Cold spotlight", hint: "One narrow beam from above, deep shadows", light: "Light the new photo as a dark, dramatic scene: a single narrow cold white spotlight shines straight down from directly above, with a visible beam of light cutting through dusty air above the head; it lights the top of the hair, forehead, cheekbones, nose and shoulders, leaves deep shadows in the eye sockets and under the nose and chin, and the background falls to black. Cold, desaturated blue-grey colour grade." },
  { id: "golden-halo", name: "Golden halo", hint: "Warm amber backlight and a golden rim", light: "Light the new photo with a warm golden glow: a strong amber backlight behind the head turns the background into glowing orange-gold haze and puts a bright golden rim on the hair and shoulders, while soft warm gold light falls on the face from the front. Rich honey and orange tones, glowing highlights, warm shadows, like sunset in a cathedral." },
  { id: "red-and-blue", name: "Red and blue", hint: "Two coloured lights, one from each side", light: "Light the new photo with two coloured gel lights in a dark room: saturated red light from the left and deep electric blue light from the right, each colour wrapping around its side of the face, hair and body, purple where they meet, and a dark red-blue background. High-contrast cinematic colour." },
  { id: "magenta-club", name: "Magenta club", hint: "Colours the room more than the person", light: "Light the new photo as a night club scene: the face, hair, skin and clothes are washed in hot magenta and purple stage light from above and the left, with pink highlights and deep violet shadows on the person, pink haze in the air and a blurry purple background with sparkling lights." },
  { id: "teal-lasers", name: "Teal lasers", hint: "Colours the room more than the person", light: "Light the new photo as a dark club scene in teal and blue: the face, hair, skin and clothes are lit by cold cyan light from the side, with blue-tinted skin, cyan highlights and deep navy shadows on the person; thin bright cyan laser beams cut diagonally through the haze behind, and the background is dark blue-black." },
  { id: "acid-green", name: "Acid green", hint: "Vivid green light from below", light: "Light the new photo with eerie toxic green light: a vivid green light from below and the side lights the face, hair and clothes, green laser beams shine through dark haze behind, deep green-black shadows, the whole scene tinted acid green." },
  { id: "lime-and-violet", name: "Lime and violet", hint: "Bold lime light, violet shadows", light: "Light the new photo with two bold gel colours: acid yellow-lime light from the front left floods the face and hair, deep purple light fills the shadows on the right and the background, high saturation and strong contrast, like a music video." },
  { id: "cyan-glow", name: "Cyan glow", hint: "A small cool light close to the face", light: "Light the new photo as a dark, moody scene lit only by a small glowing cold-blue light orb floating close to the face on the right side of the frame; the person is in darkness except where the orb's cool cyan-white light falls on the near side of the face, falling off quickly into blue-black shadow, with blue highlights in the eyes. The orb is the only light source." },
  { id: "crimson-room", name: "Crimson room", hint: "Deep red everywhere, one white highlight", light: "Light the new photo with deep crimson red light filling the whole scene, dark red shadows and a red-black background, and one small bright white light at the left edge of the frame that puts a cold white highlight on the near cheek and in the eyes." },
  { id: "venetian-blinds", name: "Venetian blinds", hint: "Film-noir stripes of sunlight", light: "Light the new photo as a film noir scene: hard low afternoon sunlight comes through venetian blinds from the left and casts sharp parallel diagonal stripes of bright light and black shadow across the face, hair, neck, clothes and the wall behind; thin rays of light are visible in the smoky air, the rest of the room is dark. Warm amber highlights, deep black shadows, high contrast." },
  { id: "phone-glow", name: "Phone glow", hint: "A screen's cool light from below", light: "Light the new photo as a dark room at night lit only by a phone screen held just below the face; its cold blue-white light falls on the chin, lips, nose and cheeks from below, reflects as small bright squares in the eyes, and fades to black on the hair, shoulders and body, with a pitch-black background. Cold blue tones, the rest of the frame in deep darkness." },
  { id: "firelight", name: "Firelight", hint: "Warm flicker from a fire below", light: "Light the new photo as a night scene beside a campfire just outside the frame at the bottom left; flickering orange-red firelight lights the face, hair and clothes from below and the left, glowing embers and sparks float up through the dark air, the far side of the face falls into deep shadow and the background is black night. Hot orange and red tones against darkness." },
  { id: "sunset-window", name: "Sunset window", hint: "Low golden sun through a window", light: "Light the new photo as a dim room at golden hour: low orange sunlight through a window on the left falls as a hard warm patch across one side of the face, hair and shoulder, with the window-frame shadow cutting across the body; the other side of the face is in deep brown shadow and the room behind is dark. Rich orange highlights, dark warm shadows." },
  { id: "evening-lamp", name: "Evening lamp", hint: "One warm lamp, an intimate night", light: "Light the new photo as a room in the evening lit only by a table lamp just out of frame on the right at shoulder height: soft warm orange light falls on that side of the face, hair and body, the other side fades into dim brown shadow, and the room behind is dark and cosy at night. Warm amber tones, low brightness, intimate night-time mood." },
  { id: "rim-light", name: "Rim light", hint: "A bright outline from behind", light: "Light the new photo with one hard light directly behind the person and slightly above: it draws a thin bright white rim along the hair, the edges of the face, the shoulders and the arms, light glows through loose strands of hair, the front of the face and body stay in deep shadow with only a faint fill, and the background is dark. High-contrast cinematic silhouette lighting." },
  { id: "blue-night", name: "Blue night", hint: "Soft cool light from one side", light: "Light the new photo as a room at night lit by soft cool light from the left side: dim blue-violet light falls on the near side of the face, hair and clothes, the other side sinks into deep blue-black shadow, and the background is dark navy. Low brightness, quiet futuristic night mood, cool blue and purple tones." },
  { id: "camera-flash", name: "Camera flash", hint: "Direct flash, a candid night look", light: "Light the new photo with a direct on-camera flash at night: hard flat white light straight from the camera hits the face and body brightly, gives the skin a slight glossy shine, small bright catchlights in the eyes, a hard dark shadow just behind the person on the wall, and the background falls off quickly into darkness. Candid party-photo look, high contrast." },
] as const;

export type LookId = (typeof LIGHT_LOOKS)[number]["id"];
export const LOOK_IDS = LIGHT_LOOKS.map((l) => l.id) as LookId[];
export const getLook = (id: string) => LIGHT_LOOKS.find((l) => l.id === id);

export const RELIGHT_PROMPT =
  "Create a photograph of the person from <image 1>, with their own face, identity, eye colour, hair and clothing, in exactly the pose, head angle, hand and arm positions, camera angle, framing and body cut of the person in <image 2>; describe that pose fully. They make exactly the facial expression of the person in <image 2>, with the same mouth shape, eyebrows and gaze; describe that expression. {look}";

export const FRAME_RELIGHT_PROMPT = "Relight this photograph. Keep the person, face, identity, expression, pose, hair, clothing, framing and setting exactly as they are; change only the lighting and the colour of the light. {look}";

const KLEIN_UPSAMPLER =
  "You are the prompt upsampler of an image-editing model. You see the reference image(s), attached in order (the first image, the second image, ...), and the user's short request. Expand it into ONE detailed, self-contained instruction: the caption the editing model receives together with the same images. Output only the instruction as one continuous English prose block, with no greetings, explanations, Markdown, JSON, coordinates, ids or angle-bracket tokens. Read a vague or conversational request as the most plausible edit of the supplied images.\n\nPick the voice by task shape. When one reference stays and gets bounded changes, write an imperative editing instruction on it (\"Remove the ...\", \"Change the ... to ...\", \"Zoom in on ...\"); a whole-image transformation opens with its scope (\"Convert the entire image into ...\", \"Apply a ... filter over the entire scene\", \"Horizontally flip the entire image so that ...\", \"Shift the camera viewpoint to ...\", then where the major elements should now be). When the references are drawn into a newly composed frame (combining subjects, a new scene, a garment, object or style donor), write a generation request (\"Create a photograph of ...\", \"Create an anime-style illustration of ...\", \"Generate a new image featuring ...\") that says what to take from each image, by ordinal, and what is newly generated.\n\nKeep every explicit edit, constraint, count, position, style cue and piece of wording, and decide what is left open as one concrete plan. Ground everything in what is actually visible: identify each referent unambiguously by its real appearance, never mention content that is not there, and use every image the user attached. State every end state concretely (which color, how large, which pose, which material) and give new content enough appearance to be generated. Cover the knock-on effects of the change (shadows, reflections, occlusion, perspective, scale, lighting) and say what fills a removed region. A zoom-in names what stays in frame and which neighbors are cropped out; an outpainting continues the scene in the same medium. Describe the change, not the whole scene, and close an editing instruction with one compact clause naming what stays unchanged; transferred people keep their identity, face and accessories unless asked otherwise. Transcribe on-image text verbatim in its original language inside double quotes, with line breaks as \\n, and match the original font, size and color when replacing it. Name recognizable public figures, brands and landmarks you can see. Directions are frame-relative; use no evaluative or quality words. Typical length is 50 to 150 words.\n\nOutput only the instruction.";

/** The light asked for, in the prompt helper's words ("" for none). */
export function lightWords(light: { look: string } | { words: string } | undefined): string {
  if (!light) return "";
  if ("look" in light) return getLook(light.look)?.light ?? "";
  const w = light.words.replace(/\s+/g, " ").trim().slice(0, 300);
  return w ? `Light the new photo this way: ${w.replace(/[.\s]+$/, "")}.` : "";
}

export interface PrepareSettings {
  /** The clip's size: the edit canvas is its shape at 768 px on the short side. */
  width: number;
  height: number;
  seed: number;
  /** The light's words (lightWords), or "" to keep the picture's own light. */
  light: string;
  /** Relight the person already in the clip (no character picture). */
  ownPerson: boolean;
  /** Own person: keep the frame's crop (start from it at denoise 0.9). */
  keepCrop: boolean;
  /** Extra words for the pose ("arms crossed, chin up"). */
  adjust?: string;
}

function relightRequest(graph: ComfyWorkflow, light: string) {
  const request = String(graph["6"].inputs.value);
  graph["6"].inputs.value = request.includes("{look}") ? request.replaceAll("{look}", light) : `${request} ${light}`;
  graph["25"].inputs.value = KLEIN_UPSAMPLER;
  Object.assign(graph["23"].inputs, {
    max_length: 3584,
    sampling_mode: "on",
    "sampling_mode.temperature": 1,
    "sampling_mode.top_k": 1,
    "sampling_mode.top_p": 0.95,
    "sampling_mode.min_p": 0,
    "sampling_mode.repetition_penalty": 1.05,
    "sampling_mode.seed": 0,
  });
}

/** From picture's first frame: the character in the clip's first-frame pose, in the picture's setting (and light). */
export function preparePicture(source: ComfyWorkflow, s: PrepareSettings): ComfyWorkflow {
  const graph = clone(source);
  const [w, h] = canvasSize(s.width, s.height, "768p");
  for (const id of ["3", "5"]) if (graph[id]) Object.assign(graph[id].inputs, { width: w, height: h });
  graph["19"].inputs.seed = s.seed;
  const adjust = (s.adjust ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (s.ownPerson) {
    if (!s.light) throw new Error("Pick a light for the clip's own person.");
    graph["6"].inputs.value = FRAME_RELIGHT_PROMPT;
    relightRequest(graph, s.light);
    for (const id of ["4", "5", "7"]) delete graph[id];
    graph["8"].inputs.image = ["2", 0];
    const { positive, negative, vae } = graph["15"].inputs;
    graph["15"] = { class_type: "ReferenceMultiLatent", inputs: { positive, negative, vae, resolution: "resize", "resolution.megapixels": 3, "images.image0": ["2", 0] }, _meta: { title: "Raw frame only, 3 MP" } };
    graph["19"].inputs.denoise = s.keepCrop ? 0.9 : 1;
    if (s.keepCrop) {
      graph.relight_frame = { class_type: "ImageScaleToTotalPixels", inputs: { image: ["2", 0], upscale_method: "lanczos", megapixels: 3, resolution_steps: 16 }, _meta: { title: "Raw frame at 3 MP" } };
      graph.relight_start = { class_type: "VAEEncode", inputs: { pixels: ["relight_frame", 0], vae: ["12", 0] }, _meta: { title: "Start from the frame" } };
      graph["19"].inputs.latent_image = ["relight_start", 0];
    }
  } else if (s.light) {
    // Pose and light in one pass: FLUX sees only the character at 3 MP; the frame reaches it through the written pose.
    graph["6"].inputs.value = adjust ? `${RELIGHT_PROMPT.replace(" {look}", "")} ${cap(adjust)}. {look}` : RELIGHT_PROMPT;
    relightRequest(graph, s.light);
    delete graph["5"];
    graph["7"] = { class_type: "BatchImagesNode", inputs: { "images.image0": ["4", 0], "images.image1": ["3", 0] }, _meta: { title: "Character picture + raw frame for the prompt upsampler" } };
    const { positive, negative, vae } = graph["15"].inputs;
    graph["15"] = { class_type: "ReferenceMultiLatent", inputs: { positive, negative, vae, resolution: "resize", "resolution.megapixels": 3, "images.image0": ["4", 0] }, _meta: { title: "Character picture only, 3 MP" } };
    graph.relight_canvas = { class_type: "ImageScaleToTotalPixels", inputs: { image: ["3", 0], upscale_method: "lanczos", megapixels: 3, resolution_steps: 16 }, _meta: { title: "Frame shape at 3 MP" } };
    graph.relight_size = { class_type: "GetImageSize", inputs: { image: ["relight_canvas", 0] } };
    graph.relight_latent = { class_type: "EmptyFlux2LatentImage", inputs: { width: ["relight_size", 0], height: ["relight_size", 1], batch_size: 1 }, _meta: { title: "Relit canvas" } };
    graph["19"].inputs.latent_image = ["relight_latent", 0];
  } else if (adjust) {
    graph["6"].inputs.value = `${String(graph["6"].inputs.value)} ${cap(adjust)}.`;
  }
  assertLinked(graph);
  return graph;
}

const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1).replace(/[.\s]+$/, "") : t);

/** From picture's video length: whole frames on H3's 17k + 5 grid at 24 fps (6 s → 141 frames, 5.875 s). */
export function pictureFrames(seconds: number): number {
  return Math.max(5, Math.floor((Math.floor(seconds * 24 + 1e-6) - 5) / 17) * 17 + 5);
}

/** What happens in the part: the describer reads it at 2 fps and rewrites it for the approved frame (or not, for the clip's own person). */
export function describeScene(source: ComfyWorkflow, s: { frames: number; ownPerson: boolean }): ComfyWorkflow {
  const graph = clone(source);
  graph["1"].inputs.frame_load_cap = s.frames;
  if (s.ownPerson) {
    for (const id of ["74", "75", "76", "77", "78", "80", "81", "82"]) delete graph[id];
    graph["79"].inputs.source = ["73", 0];
  }
  assertLinked(graph);
  return graph;
}

export interface PictureVideoSettings {
  renderer: "solar" | "h3";
  /** The part's length in seconds (rounded down to the frame grid). */
  seconds: number;
  /** The clip's size and the quality: the canvas keeps the clip's shape at that short edge, at most 2048 px. */
  width: number;
  height: number;
  quality: string;
  /** Motion detail: 0 = the output canvas, else the long edge of the motion reference. */
  motion: 0 | MotionSize;
  seed: number;
  /** What happens, in words (the describer's, edited): opens the detailed description. */
  description?: string;
}

/** The two renderers' fixed steps: Solar's four-step LoRA, H3's DMAD at six. */
export const PICTURE_STEPS = { solar: 4, h3: 6 } as const;

export function pictureVideo(source: ComfyWorkflow, s: PictureVideoSettings): ComfyWorkflow {
  const graph = clone(source);
  const [width, height] = clampCanvas(canvasSize(s.width, s.height, s.quality === "720p" ? "736p" : "480p"));
  const length = pictureFrames(s.seconds);
  if (s.renderer === "solar" && length < 22) throw new Error("Pick a part of at least one second.");
  graph["1"].inputs.frame_load_cap = length;
  Object.assign(graph["56"].inputs, { width, height, length });
  const scale = s.motion ? s.motion / Math.max(width, height) : 1;
  Object.assign(graph["33"].inputs, { width: Math.max(32, Math.round((width * scale) / 32) * 32), height: Math.max(32, Math.round((height * scale) / 32) * 32), crop: "center" });
  graph["58"].inputs.noise_seed = s.seed;
  graph["60"].inputs.steps = PICTURE_STEPS[s.renderer];
  if (s.renderer === "solar" && graph["65"]) graph["65"].inputs.seed = s.seed;
  const text = (s.description ?? "").trim().replace(/\s+/g, " ").slice(0, 2000);
  if (text) {
    const prompt = String(graph["56"].inputs.prompt);
    graph["56"].inputs.prompt = s.renderer === "solar"
      ? prompt.replace(/detailed_description:\n(\[Shot 1\] The shot begins from <Video 2>\. )?/, (head) => `${head}${text} `)
      : prompt.replace(/detailed_description:\n/, (head) => `${head}${text} `);
  }
  assertLinked(graph);
  return graph;
}

// ---------------------------------------------------------------------------
// Finish: Fix faces, Fix colours

export type FaceStyle = "photo" | "mouth";
export const CHUNK_SECONDS = [4, 6.5, 10] as const;

/** How many sections Fix faces renders (H3FaceChunks, before close-up-only sections are dropped). */
export function faceChunkCount(seconds: number, chunkSeconds: number): number {
  const total = Math.floor(seconds * 24);
  const length = Math.floor((Math.floor(chunkSeconds * 24) - 5) / 17) * 17 + 5;
  return total <= length ? 1 : Math.ceil((total - 24) / (length - 24));
}

export function pruneFace(source: ComfyWorkflow, s: { style: FaceStyle; seed: number; chunkSeconds: number }): ComfyWorkflow {
  const graph = clone(source);
  const id = (title: string) => nodeByTitle(graph, title);
  const chunks = graph[id("Face Fix Chunks")].inputs;
  // Match the photo: no blurred face to follow, so H3 draws the expressions and mouth anew from the picture.
  if (s.style === "photo") {
    delete graph[id("Blurred face (follow the mouth)")];
    delete chunks.follow_mouth;
    delete graph[id("Reference Conditioning")].inputs["ref_videos.ref_video_0"];
  }
  chunks.chunk_seconds = s.chunkSeconds;
  graph[id("Seed")].inputs.noise_seed = s.seed;
  for (const n of Object.values(graph)) if (n.class_type === "H3FaceTrackCrop") n.inputs.select = "largest_face";
  assertLinked(graph);
  return graph;
}

export type ColourFinish = "soft" | "filmic" | "rich" | "off";

/** Openjutsu's "H3 soft" tone settings, with the strength the slider sets (0–1 → Orion's 0–0.5). */
const SOFT_TONE = { mode: "Reinhard", exposure: 0.09, contrast: 0.84, pivot: 0.69, highlight_rolloff: 0.27, shadow_lift: 0.15, black_floor: 0.03, saturation: 1.05 };

/** The tone mapper's settings for a finish (null: no tone step). */
export function toneFor(finish: ColourFinish, strength01: number): Record<string, number | string> | null {
  if (finish === "off") return null;
  const strength = Math.round(Math.max(0, Math.min(1, strength01)) * 0.5 * 1000) / 1000;
  if (finish === "soft") return { ...SOFT_TONE, strength };
  if (finish === "filmic") return { ...SOFT_TONE, mode: "Filmic Soft", strength };
  return { ...SOFT_TONE, mode: "Filmic Strong", strength: Math.max(strength, 0.35) };
}

/** Soften detail 0–1 → the detail contrast 0 … −0.6 (0 drops the step). */
export const detailFor = (soften01: number) => (soften01 <= 0 ? null : -Math.round(Math.min(1, soften01) * 0.6 * 1000) / 1000);

export function pruneColor(source: ComfyWorkflow, s: { detail: number | null; tone: Record<string, number | string> | null }): ComfyWorkflow {
  const graph = clone(source);
  const detail = nodeByTitle(graph, "Detail contrast");
  const tone = nodeByTitle(graph, "Tone mapper");
  if (s.detail === null) {
    graph[tone].inputs.image = graph[detail].inputs.image;
    delete graph[detail];
  } else graph[detail].inputs.detail_contrast = s.detail;
  if (s.tone === null) {
    graph[nodeByTitle(graph, "Fixed video")].inputs.images = graph[tone].inputs.image;
    delete graph[tone];
  } else {
    const n = graph[tone].inputs;
    n.raw_settings = JSON.stringify({ node_type: "color_fx_dctl_tone_mapper", preset: n.preset, settings: { ...s.tone, preserve_luminosity: false, clamp_output: true } });
  }
  assertLinked(graph);
  return graph;
}

// ---------------------------------------------------------------------------
// The provider's branch: one settings object per workflow (params.extra.openjutsu)

export const OPENJUTSU_WORKFLOWS = {
  group: "video-group-swap-h3",
  groupOneByOne: "video-group-swap-h3-one-by-one",
  scene: "video-scene-edit-h3",
  prepare: "image-from-picture-prepare",
  describe: "video-scene-describe",
  solar: "video-from-picture-solar",
  h3: "video-from-picture-h3",
  /** Motion transfer's MiniMax H3: the From picture H3 graph with the character photo itself as Picture 1. */
  motionH3: "video-motion-transfer-h3",
  faces: "video-fix-faces-h3",
  colours: "video-fix-colours",
} as const;

export const OPENJUTSU_IDS = new Set<string>(Object.values(OPENJUTSU_WORKFLOWS));
/** The Context Loop jobs: their run folder is deleted once the result is in. */
export const CONTEXT_LOOP_IDS = new Set<string>([OPENJUTSU_WORKFLOWS.group, OPENJUTSU_WORKFLOWS.groupOneByOne, OPENJUTSU_WORKFLOWS.scene]);

/** Settings as they travel (params.extra.openjutsu). Unknown values fall back to the defaults. */
export type OpenjutsuSettings = Record<string, unknown>;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const edgeOf = (v: unknown): Edge => (v === "tight" || v === "loose" ? v : "normal");
const motionOf = (v: unknown): MotionSize => (v === 768 ? 768 : 512);

/** The graph for one Openjutsu workflow, with this request's settings (after the manifest's bindings went in). */
export function openjutsuGraph(id: string, wf: ComfyWorkflow, o: OpenjutsuSettings, ctx: { generationId: string; clip?: { width?: number; height?: number } }): ComfyWorkflow {
  const run = runName(ctx.generationId);
  const seed = Math.max(0, Math.min(0xffffffff, Math.round(num(o.seed, 0))));
  switch (id) {
    case OPENJUTSU_WORKFLOWS.group:
    case OPENJUTSU_WORKFLOWS.groupOneByOne:
      return pruneGroupSwap(wf, {
        pictures: Math.round(num(o.pictures, 1)),
        roles: Array.isArray(o.roles) ? o.roles.map((r) => str(r)) : [],
        resolution: ojResolution(str(o.quality)),
        motion: motionOf(o.motion),
        hatFix: o.hats === true,
        noLipSync: o.mouthsFollowSound === false,
        edge: edgeOf(o.edge),
        seed,
        run,
      });
    case OPENJUTSU_WORKFLOWS.scene: {
      const action = o.action === "remove" || o.action === "background" ? o.action : "change";
      return pruneSceneEdit(wf, {
        action,
        target: str(o.target, action === "background" ? "person" : "").slice(0, 120),
        becomes: str(o.becomes).slice(0, 300),
        picture: o.picture === true,
        biggestOnly: o.biggestOnly === true,
        keepShape: o.keepShape === true,
        edge: edgeOf(o.edge),
        motion: motionOf(o.motion),
        resolution: ojResolution(str(o.quality)),
        seed,
        run,
        paint: Array.isArray(o.paint) ? (o.paint as PaintKeyframe[]) : undefined,
      });
    }
    case OPENJUTSU_WORKFLOWS.prepare: {
      const w = ctx.clip?.width;
      const h = ctx.clip?.height;
      if (!w || !h) throw new Error("Couldn't read the clip's size to make the first frame.");
      return preparePicture(wf, { width: w, height: h, seed, light: str(o.light), ownPerson: o.ownPerson === true, keepCrop: o.keepCrop === true, adjust: str(o.adjust) });
    }
    case OPENJUTSU_WORKFLOWS.describe:
      return describeScene(wf, { frames: pictureFrames(num(o.seconds, 6)), ownPerson: o.ownPerson === true });
    case OPENJUTSU_WORKFLOWS.solar:
    case OPENJUTSU_WORKFLOWS.h3:
    case OPENJUTSU_WORKFLOWS.motionH3: {
      const w = ctx.clip?.width;
      const h = ctx.clip?.height;
      if (!w || !h) throw new Error("Couldn't read the clip's size to make the video.");
      const motion = o.motion === 512 || o.motion === 768 ? o.motion : 0;
      return pictureVideo(wf, { renderer: id === OPENJUTSU_WORKFLOWS.solar ? "solar" : "h3", seconds: num(o.seconds, 6), width: w, height: h, quality: str(o.quality, "480p"), motion, seed, description: str(o.scene) });
    }
    case OPENJUTSU_WORKFLOWS.faces:
      return pruneFace(wf, { style: o.faceStyle === "photo" ? "photo" : "mouth", seed, chunkSeconds: (CHUNK_SECONDS as readonly number[]).includes(num(o.chunkSeconds, 6.5)) ? num(o.chunkSeconds, 6.5) : 6.5 });
    case OPENJUTSU_WORKFLOWS.colours: {
      const finish: ColourFinish = o.finish === "filmic" || o.finish === "rich" || o.finish === "off" ? o.finish : "soft";
      return pruneColor(wf, { detail: detailFor(num(o.soften, 0.33)), tone: toneFor(finish, num(o.strength, 0.4)) });
    }
    default:
      return wf;
  }
}

/** The media inputs a request leaves out on purpose (their nodes go in openjutsuGraph). */
export function openjutsuLeftOut(id: string, o: OpenjutsuSettings): string[] {
  if (id === OPENJUTSU_WORKFLOWS.group || id === OPENJUTSU_WORKFLOWS.groupOneByOne) {
    const n = Math.round(num(o.pictures, 1));
    return ["image", "image2", "image3", "image4"].slice(Math.max(1, n));
  }
  if (id === OPENJUTSU_WORKFLOWS.scene) return o.picture === true && o.action !== "remove" ? [] : ["image"];
  if (id === OPENJUTSU_WORKFLOWS.prepare || id === OPENJUTSU_WORKFLOWS.describe) return o.ownPerson === true ? ["image"] : [];
  return [];
}
