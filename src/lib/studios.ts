import { getModel } from "@/lib/catalog";
import { SIGNATURE_MODELS } from "@/lib/catalog/palettes";
import { FACE_MOSAIC_MODELS } from "@/lib/catalog/open-tools";
import type { Preset } from "@/lib/catalog/types";
import type { StudioConfig } from "@/components/studio/studio-context";

export const IMAGE_STUDIO: StudioConfig = {
  feature: "image",
  title: "Image",
  hero: "What should we make today?",
  placeholder: "Describe an image… try “a koi pond at night, neon rain”",
  kind: "image",
  ops: ["t2i", "edit"],
  // Text-to-image models (most also edit with refs); single-purpose edit tools (try-on, product shots,
  // style transfer, angles) are listed in the Edit studio.
  pickerOps: ["t2i"],
  feed: { kind: "image", features: ["image", "edit", "app:*", "character:*"] },
  slots: [],
  multiRef: { label: "Add ref", max: 8 },
  defaultModels: { cloud: "nano-banana-pro", open: "oss-ideogram-4" },
  // Ideogram 4 runs on a caption the install's local model writes: an account, a guest or an install with none opens on
  // Qwen-Image 2.1, the next pick (plain words give Ideogram's grey safety card on about half the pictures of people).
  uncaptioned: { open: "oss-qwen-image-21" },
  // A model's own settings (MOSS-Image's Quality, Ideogram's speed) sit under "Options".
  controlsTitle: "Options",
  // Layout mode: boxes on the picture, one row each, read in place by MOSS-Image, FLUX.3 and Ideogram 4.5.
  layout: true,
  // Color signature + Moodboard chips, and the models they can move a request to. Fuobe Soul's PixeletedFace look runs
  // the face mosaic after the picture: its step's model is known here so the price counts it before the run.
  signature: true,
  extraModels: [...Object.values(SIGNATURE_MODELS), ...Object.values(FACE_MOSAIC_MODELS)],
  suggestions: [
    "Editorial portrait of a woman in a yellow raincoat, Tokyo crosswalk at dusk, 35mm film",
    "Isometric cozy reading nook with plants and warm lamp light, 3D render",
    "Product shot of a matte black perfume bottle on wet volcanic rock",
    "A koi pond at night, neon rain, cinematic",
  ],
};

export const EDIT_STUDIO: StudioConfig = {
  feature: "edit",
  title: "Edit",
  hero: "What should change?",
  placeholder: "Describe the change… e.g. “replace the sky with a sunset”",
  kind: "image",
  ops: ["edit"],
  feed: { kind: "image", features: ["edit"] },
  slots: [{ key: "image", label: "Image", accept: "image", required: true }],
  multiRef: { label: "Add ref", max: 6 },
  sketch: ["mask", "draw"],
  defaultModels: { cloud: "nano-banana-pro", open: "oss-qwen-image-21" },
  suggestions: [
    "Make it golden hour",
    "Remove the people in the background",
    "Turn this into a watercolor painting",
    "Put the person from image 2 next to them, same lighting",
  ],
};

export const INPAINT_STUDIO: StudioConfig = {
  feature: "edit",
  title: "Inpaint",
  hero: "Paint it, then say what goes there",
  subtitle: "Paint the area to change, then say what goes there. Qwen-Image 2.1 and FLUX Fill use your mask directly.",
  placeholder: "What should fill the painted area? e.g. “a vase of white tulips”",
  kind: "image",
  ops: ["inpaint", "edit"],
  feed: { kind: "image", features: ["edit"] },
  slots: [{ key: "image", label: "Image", accept: "image", required: true }],
  multiRef: { label: "Add ref", max: 3 },
  sketch: ["mask"],
  sketchAutoOpen: "mask",
  defaultModels: { cloud: "nano-banana-pro", open: "oss-qwen-image-21" },
  suggestions: ["Remove it and fill in the background", "A golden retriever sitting there", "Make the shirt navy linen", "Add sunglasses"],
};

export const VIDEO_STUDIO: StudioConfig = {
  feature: "video",
  title: "Video",
  hero: "What’s the shot?",
  placeholder: "Describe a shot… e.g. “slow dolly-in on a rainy street, neon reflections”",
  kind: "video",
  ops: ["t2v", "i2v", "flf2v", "ref2v"],
  feed: { kind: "video", features: ["video", "motion:*", "effect:*"] },
  slots: [
    { key: "image", label: "Start frame", accept: "image" },
    { key: "endImage", label: "End frame", accept: "image" },
  ],
  multiRef: { label: "Add ref", max: 3 },
  sketch: ["draw"],
  presetPicker: "motion",
  // Kling 4.0's Frames mode: up to 10 keyframes (FLUX 3 Max on the cloud, Wan 2.2 14B clip by clip on the open engine).
  frames: true,
  // MiniMax H3 on both engines: hosted on fal, and on your GPU. Frames mode runs its own model (FRAMES_MODELS).
  defaultModels: { cloud: "minimax-h3", open: "oss-minimax-h3" },
  suggestions: [
    "A paper boat drifts down a rain-soaked street gutter, macro, slow motion",
    "FPV drone dives off a sea cliff at sunrise and skims the waves",
    "A chef flambés a pan in a dark kitchen, sparks fly, handheld",
    "Astronaut walks through a field of glowing flowers on an alien planet",
  ],
};

export const LIPSYNC_STUDIO: StudioConfig = {
  feature: "lipsync",
  title: "Lipsync & avatars",
  hero: "Make anyone talk",
  placeholder: "Optional: how should they act? e.g. “friendly, nodding, hand gestures”",
  kind: "video",
  ops: ["avatar", "lipsync"],
  feed: { kind: "video", features: ["lipsync"] },
  slots: [
    { key: "image", label: "Portrait", accept: "image", hint: "For a talking avatar" },
    { key: "video", label: "Video", accept: "video", hint: "To re-sync an existing clip" },
    { key: "audio", label: "Voice", accept: "audio", required: true },
  ],
  anyOf: [["image", "video"]],
  defaultModels: { cloud: "kling-avatar-2", open: "oss-infinitetalk" },
  promptOptional: true,
  voiceFacts: true,
};

export const UPSCALE_STUDIO: StudioConfig = {
  feature: "upscale",
  title: "Upscale",
  hero: "Sharper, bigger, cleaner",
  placeholder: "",
  kind: "image",
  ops: ["upscale-image", "upscale-video"],
  feed: { features: ["upscale"] },
  slots: [{ key: "image", label: "Image", accept: "image", required: true }],
  defaultModels: { cloud: "topaz-image", open: "oss-seedvr2-image" },
  promptOptional: true,
  hidePrompt: true,
  modelPrompt: "Optional: details to keep or bring out, e.g. “the lettering on the shop sign”",
  controlsTitle: "Options",
};

/** Upscale → Video: Topaz Video and Starlight, ByteDance (to 8K), FLUX.3, SeedVR2; SeedVR2 or ESRGAN in passes on the open engine. */
export const VIDEO_UPSCALE_STUDIO: StudioConfig = {
  ...UPSCALE_STUDIO,
  kind: "video",
  hero: "Sharper, bigger, cleaner video",
  subtitle: "Upscale a clip to 1080p, 4K or up to 8K, and restore faces, textures and text.",
  // Archive footage (scans, tape, black and white) is restored and colourised first: Fuobe Restore rebuilds it, then upscales.
  related: { href: "/video-tools/restore", label: "Old or black-and-white footage? Restore archive footage first" },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  defaultModels: { cloud: "topaz-video", open: "oss-seedvr2" },
  clipFacts: true,
};

/** Upscale → FPS Boost: frame interpolation to 24–120 fps, or slow motion (Topaz, RIFE / FILM). */
export const FPS_BOOST_STUDIO: StudioConfig = {
  feature: "fps-boost",
  title: "Upscale",
  hero: "Smoother motion, or slow motion",
  subtitle: "New in-between frames take a clip to 24–120 fps, or stretch it up to 8× slower.",
  placeholder: "",
  kind: "video",
  ops: ["interpolate"],
  feed: { features: ["fps-boost"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  defaultModels: { cloud: "topaz-fps-boost", open: "oss-rife" },
  promptOptional: true,
  hidePrompt: true,
  clipFacts: true,
  controlsTitle: "Options",
};

/** Upscale → SDR to HDR: Topaz Hyperion (HDR10 H.265, ProRes), LTX (EXR frames), or ComfyUI's tone map (HLG, PQ, EXR). */
export const SDR_TO_HDR_STUDIO: StudioConfig = {
  feature: "sdr-to-hdr",
  title: "Upscale",
  hero: "Take it to HDR",
  subtitle: "Expands SDR footage to 10-bit HDR: an HDR10 video, ProRes for grading, or 16-bit EXR frames for compositing.",
  placeholder: "",
  kind: "video",
  ops: ["sdr-to-hdr"],
  feed: { features: ["sdr-to-hdr"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  defaultModels: { cloud: "topaz-sdr-to-hdr", open: "oss-sdr-to-hdr" },
  promptOptional: true,
  hidePrompt: true,
  clipFacts: true,
  formatPicker: true,
  controlsTitle: "Options",
};

/** Upscale → Export: pro codecs written by ComfyUI (no cloud API transcodes a finished clip). */
export const VIDEO_EXPORT_STUDIO: StudioConfig = {
  feature: "export-video",
  title: "Upscale",
  hero: "Export for the edit",
  subtitle: "ProRes 422 HQ or 4444, H.265 10-bit, lossless FFV1 or EXR frames, written by ComfyUI on your machine for free.",
  placeholder: "",
  kind: "video",
  ops: ["export-video"],
  feed: { features: ["export-video"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  defaultModels: { cloud: "", open: "oss-export-video" },
  promptOptional: true,
  hidePrompt: true,
  clipFacts: true,
  formatPicker: true,
  controlsTitle: "Options",
  // No cloud API transcodes a finished clip, and the server runs no ffmpeg of its own.
  comfyOnly: {
    note: "Export formats are written by ComfyUI on your own machine, for free, and no ComfyUI is connected. Connect one under Settings → Open-source engine.",
    alternative: { label: "ProRes 422 HQ in the cloud: Topaz SDR to HDR (also converts it to HDR)", href: "/upscale/hdr?model=topaz-sdr-to-hdr&format=prores_422_hq" },
  },
};

export const AUDIO_STUDIO: StudioConfig = {
  feature: "audio",
  title: "Audio",
  hero: "Give it a voice",
  subtitle: "Clone any voice from a 10-second sample, then give it your words.",
  placeholder: "What should it say?",
  kind: "audio",
  ops: ["tts"],
  feed: { kind: "audio", features: ["audio"] },
  slots: [],
  defaultModels: { cloud: "elevenlabs-v4", open: "oss-chatterbox" },
  suggestions: ["Welcome to Fuobe — make anything, with any model.", "Don't look now… but I think it's following us.", "Breaking news: the robots have learned to paint."],
};

export const DIALOGUE_STUDIO: StudioConfig = {
  feature: "audio",
  title: "Audio",
  hero: "Write a conversation",
  subtitle: "Every line gets its own voice, timed like a real conversation.",
  placeholder: "",
  kind: "audio",
  ops: ["dialogue"],
  feed: { kind: "audio", features: ["audio"] },
  slots: [],
  defaultModels: { cloud: "elevenlabs-dialogue", open: "oss-chatterbox-dialogue" },
  promptOptional: true,
  hidePrompt: true,
};

export const VOICE_CHANGE_STUDIO: StudioConfig = {
  feature: "audio",
  title: "Audio",
  hero: "Say it in another voice",
  subtitle: "Keeps your timing and emotion, swaps the voice.",
  placeholder: "",
  kind: "audio",
  ops: ["voice-change"],
  feed: { kind: "audio", features: ["audio"] },
  slots: [{ key: "audio", label: "Recording", accept: "audio", required: true }],
  defaultModels: { cloud: "elevenlabs-voice-changer", open: "oss-chatterbox-vc" },
  promptOptional: true,
  hidePrompt: true,
};

export const TRANSLATE_STUDIO: StudioConfig = {
  feature: "translate",
  title: "Audio",
  hero: "Speak every language",
  subtitle: "Translates the speech, keeps each speaker's voice and re-syncs the lips.",
  placeholder: "",
  kind: "video",
  ops: ["dub"],
  feed: { features: ["translate"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  defaultModels: { cloud: "heygen-translate", open: "" },
  promptOptional: true,
  hidePrompt: true,
};

export const TRANSCRIBE_STUDIO: StudioConfig = {
  feature: "transcribe",
  title: "Audio",
  hero: "Turn speech into text",
  subtitle: "Timed lines from a recording or a video. Copy them, or download .srt and .vtt captions.",
  placeholder: "",
  kind: "text",
  ops: ["transcribe"],
  feed: { kind: "text", features: ["transcribe"] },
  slots: [
    { key: "audio", label: "Recording", accept: "audio" },
    { key: "video", label: "Video", accept: "video" },
  ],
  anyOf: [["audio", "video"]],
  defaultModels: { cloud: "scribe-v2", open: "oss-qwen3-asr" },
  promptOptional: true,
  hidePrompt: true,
};

export const SFX_STUDIO: StudioConfig = {
  feature: "audio",
  title: "Audio",
  hero: "Describe a sound",
  placeholder: "e.g. “thunder rolling over a quiet forest, rain on leaves”",
  kind: "audio",
  ops: ["sfx"],
  feed: { kind: "audio", features: ["audio"] },
  slots: [],
  defaultModels: { cloud: "mirelo-sfx-2", open: "oss-stable-audio-3" },
  suggestions: ["Thunder rolling over a quiet forest", "Footsteps on gravel, distant birds", "Sci-fi door whooshing open"],
};

export const MUSIC_STUDIO: StudioConfig = {
  feature: "audio",
  title: "Audio",
  hero: "What should it sound like?",
  placeholder: "Genre, mood, instruments, tempo — add lyrics on new lines",
  kind: "audio",
  ops: ["music"],
  feed: { kind: "audio", features: ["audio"] },
  slots: [],
  defaultModels: { cloud: "sonilo-music", open: "oss-ace-step" },
  suggestions: ["Lo-fi hip hop beat with soft piano, 80 bpm", "Epic orchestral trailer music building to a drop", "Upbeat indie pop with handclaps and a whistled hook"],
};

export const FOLEY_STUDIO: StudioConfig = {
  feature: "audio",
  title: "Audio",
  hero: "Add sound to a video",
  subtitle: "Foley in sync with the picture: HunyuanVideo-Foley or MMAudio on your ComfyUI.",
  placeholder: "Optional: describe the sound, e.g. “footsteps on gravel, distant birds”",
  kind: "video",
  ops: ["v2a"],
  feed: { features: ["audio"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  defaultModels: { cloud: "mirelo-sfx-2-video", open: "oss-hunyuan-foley-video" },
  promptOptional: true,
};


/** Studio config for a one-click app. */
export function appStudio(preset: Preset): StudioConfig {
  const base = preset.cloud ?? preset.open!;
  const kind = getModel(base.modelId)?.kind ?? "image";
  const ops = [...new Set([preset.cloud?.op, preset.open?.op].filter(Boolean))] as StudioConfig["ops"];
  return {
    feature: `app:${preset.id}`,
    title: preset.name,
    hero: preset.description,
    // Which model runs it on each engine, and how the two versions differ, live in the preset header's Details popover
    // (U23); the hero only says when an engine has no version.
    subtitle: !preset.cloud ? "Open source only for now" : !preset.open ? "Cloud only for now" : undefined,
    placeholder: preset.promptPlaceholder ?? "Add details (optional)",
    kind,
    ops,
    feed: { features: [`app:${preset.id}`] },
    slots: preset.inputs,
    preset,
    defaultModels: { cloud: preset.cloud?.modelId ?? preset.open!.modelId, open: preset.open?.modelId ?? preset.cloud!.modelId },
    promptOptional: preset.userPrompt !== "required",
    hidePrompt: preset.userPrompt === "none",
    ...(APP_RELATED[preset.id] && { related: APP_RELATED[preset.id] }),
  };
}

/** Apps whose job a studio does in more depth: linked under the hero. */
const APP_RELATED: Record<string, { href: string; label: string }> = {
  "app-ai-influencer": { href: "/influencer", label: "Build one game-style: 18 categories, creatures, Shuffle" },
  // Their clips come out silent: the sound is a second step.
  "app-asmr-classic": { href: "/audio/video", label: "Add sound to your clip" },
  "app-asmr-add-on": { href: "/audio/video", label: "Add sound to your clip" },
  "app-rap-god": { href: "/audio/video", label: "Add sound to your clip" },
};

export const MOTION_CONTROL_STUDIO: StudioConfig = {
  feature: "motion-control",
  title: "Motion control",
  hero: "Make your character copy any move",
  placeholder: "Optional: describe the character or scene",
  kind: "video",
  ops: ["motion-transfer"],
  feed: { features: ["motion-control"] },
  slots: [
    { key: "image", label: "Character", accept: "image", required: true },
    { key: "video", label: "Driving video", accept: "video", required: true },
  ],
  defaultModels: { cloud: "kling-motion-control", open: "oss-wan22-animate" },
  promptOptional: true,
  related: { href: "/genjutsu?mode=character", label: "Swap the person in a clip for your character with Genjutsu" },
};

export const VIDEO_EDIT_STUDIO: StudioConfig = {
  feature: "video-edit",
  title: "Edit video",
  hero: "Change anything in a clip",
  placeholder: "Describe the edit… e.g. “make it snow”, “replace the car with a horse”",
  kind: "video",
  ops: ["v2v"],
  feed: { features: ["video-edit"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  multiRef: { label: "Add ref", max: 4 },
  // A clip edit that keeps the clip's length is priced on its seconds, and one outside the model's window is refused.
  clipFacts: true,
  // On your GPU: Fuobe Mixed Media, the first v2v model in the picker that runs on a clip and words alone (Genjutsu
  // Restyle also needs the restyled first frame).
  defaultModels: { cloud: "kling-o3", open: "fuobe-mixed-media" },
  related: { href: "/genjutsu?mode=swap", label: "Swap an object or restyle it with Genjutsu" },
};

export const EXTEND_STUDIO: StudioConfig = {
  feature: "extend",
  title: "Extend video",
  hero: "What happens next?",
  subtitle: "Continues the clip from its last frames — same look, same characters.",
  placeholder: "Describe what happens next… e.g. “the camera keeps tracking as she runs into the crowd”",
  kind: "video",
  ops: ["extend"],
  feed: { features: ["extend"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  defaultModels: { cloud: "seedance-2-5", open: "oss-wan22-vace-extend" },
  suggestions: ["The camera pulls back to reveal the whole city", "She turns and smiles at the camera", "A storm rolls in and lightning hits"],
};

export const REFRAME_STUDIO: StudioConfig = {
  feature: "reframe",
  title: "Reframe",
  hero: "Same shot, new shape",
  subtitle: "Turn a 16:9 clip into 9:16 (or any ratio) — the model invents what was outside the frame.",
  placeholder: "Optional: what should fill the new space? e.g. “more of the crowd and the night sky”",
  kind: "video",
  ops: ["reframe"],
  feed: { features: ["reframe"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  // MiniMax H3 Max Reframe keeps the clip's sound and timing; Luma Ray 3.2 stays in the picker.
  defaultModels: { cloud: "minimax-h3-max-reframe", open: "oss-wan22-vace-reframe" },
  promptOptional: true,
};

export const VIDEO_MATTE_STUDIO: StudioConfig = {
  feature: "video-tools",
  title: "Video tools",
  hero: "Cut out the subject",
  subtitle: "Every frame matted — a transparent WebM you can drop over anything, or its black-and-white alpha mask. Pick SAM to keep just what you name.",
  placeholder: "What to keep, e.g. “the dog” or “the woman in red”",
  kind: "video",
  ops: ["bg-remove-video"],
  feed: { features: ["video-tools"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  defaultModels: { cloud: "bria-video-bg", open: "oss-video-matte-birefnet" },
  promptOptional: true,
};

export const VIDEO_DEPTH_STUDIO: StudioConfig = {
  ...VIDEO_MATTE_STUDIO,
  hero: "A depth map for every frame",
  subtitle: "For compositing, fog, parallax and 3D effects — in grayscale or a color map, alone or next to the original.",
  placeholder: "",
  ops: ["depth-video"],
  defaultModels: { cloud: "depth-anything-video-cloud", open: "oss-video-depth-vda" },
  hidePrompt: true,
};

export const VIDEO_RELIGHT_STUDIO: StudioConfig = {
  ...VIDEO_MATTE_STUDIO,
  hero: "Relight the shot",
  subtitle: "Describe the new light — golden hour, neon, a single window, a campfire.",
  placeholder: "e.g. “warm sunset light from the left, long soft shadows”",
  ops: ["relight-video"],
  defaultModels: { cloud: "lightx-relight", open: "oss-bernini-relight" },
  promptOptional: false,
  suggestions: ["Warm golden-hour sun from the left", "Pink and blue neon from the street", "A single cold window light, dark room", "Flickering campfire light from below"],
};

export const JOIN_CLIPS_STUDIO: StudioConfig = {
  feature: "video-tools",
  title: "Video tools",
  hero: "Join clips into one video",
  subtitle: "Add clips in order — they're scaled to one size and cut together.",
  placeholder: "",
  kind: "video",
  ops: ["concat"],
  feed: { features: ["video-tools"] },
  slots: [],
  multiRef: { label: "Add clip", max: 12, kind: "video" },
  defaultModels: { cloud: "join-clips", open: "oss-join-clips" },
  promptOptional: true,
  hidePrompt: true,
};

export const VIDEO_COLOR_MATCH_STUDIO: StudioConfig = {
  ...VIDEO_MATTE_STUDIO,
  hero: "Match the colors of a reference",
  subtitle: "Every frame takes on the palette of the image you add — no AI model, runs on CPU.",
  placeholder: "",
  ops: ["color-match"],
  slots: [
    { key: "video", label: "Video", accept: "video", required: true },
    { key: "image", label: "Color reference", accept: "image", required: true },
  ],
  defaultModels: { cloud: "", open: "oss-palette-video" },
  hidePrompt: true,
};
