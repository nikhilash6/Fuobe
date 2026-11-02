import { QMA_MODEL } from "@/lib/qma";
import { ANGLES_2511_LORA } from "./open-tools";
import { CUSTOM_COLOUR, ITEMS, RECOLOR, RECOLOR_TEMPLATE, SWATCHES } from "./recolor";
import { CAST_LOOK } from "./soul-cards";
import type { InputSlot, Preset, PresetOption, PresetRoute } from "./types";

/*
 * One-click "Apps". Most are an edit model plus a carefully written instruction —
 * exactly how Higgsfield builds them on Nano Banana / Seedream. The open-source route
 * runs the same instruction on Qwen-Image 2.1 (or a dedicated ComfyUI workflow; apps whose
 * LoRA was trained on Qwen-Image-Edit 2509 or 2511 name that model).
 * Video apps animate the photo with an image-to-video model and a template prompt
 * (Higgsfield's "viral_transform_video" templates work the same way).
 */

const EDIT_CLOUD = "nano-banana-pro";
const EDIT_OPEN = "oss-qwen-image-21";

/** Image → video templates. */
const VIDEO_CLOUD: PresetRoute = { modelId: "kling-2-5-turbo", op: "i2v", params: { duration: 5 } };
const VIDEO_OPEN: PresetRoute = { modelId: "oss-wan22-14b", op: "i2v", params: { duration: 5, resolution: "480p" } };
/** Start + end frame → video. */
const FLF_CLOUD: PresetRoute = { ...VIDEO_CLOUD, op: "flf2v" };
const FLF_OPEN: PresetRoute = { ...VIDEO_OPEN, op: "flf2v" };
/** Portrait + voice → talking video. */
const AVATAR_CLOUD: PresetRoute = { modelId: "kling-avatar-2", op: "avatar" };
const AVATAR_OPEN: PresetRoute = { modelId: "oss-infinitetalk", op: "avatar" };
/** Character image + driving video → video on your GPU. */
const ANIMATE_OPEN: PresetRoute = { modelId: "oss-wan22-animate", op: "motion-transfer" };
const BG_CLOUD: PresetRoute = { modelId: "birefnet-cloud", op: "bg-remove" };
const BG_OPEN: PresetRoute = { modelId: "oss-rmbg", op: "bg-remove" };
const UPSCALE_CLOUD: PresetRoute = { modelId: "topaz-image", op: "upscale-image" };
/** SeedVR2 (image) restores detail as it enlarges (4x ESRGAN stays in the Upscale studio's list). */
const UPSCALE_OPEN: PresetRoute = { modelId: "oss-seedvr2-image", op: "upscale-image" };
/**
 * Qwen-Image 2.1's expand: Qwen3-VL describes the picture on its grown canvas, and the words only add what goes in the
 * new margins. They never name the subject (it would appear again there), so the apps send their own short hint.
 */
const OUTPAINT_OPEN: PresetRoute = {
  modelId: "oss-qwen-image-21",
  op: "outpaint",
  promptTemplate: "more of the surrounding scene, continuing naturally past every edge with the same light, perspective and textures",
};

const photo: InputSlot = { key: "image", label: "Photo", accept: "image", required: true };
const product: InputSlot = { key: "image", label: "Product", hint: "A clear photo of the product", accept: "image", required: true };
const portrait: InputSlot = { key: "image", label: "Portrait", hint: "A clear, front-facing photo", accept: "image", required: true };
const voice: InputSlot = { key: "audio", label: "Voice audio", hint: "Speech or whisper track (record, upload or make one in Audio)", accept: "audio", required: true, cleanVoice: true };
const second = (label: string, hint?: string): InputSlot => ({ key: "image2", label, hint, accept: "image", required: true });
const third = (label: string, hint?: string): InputSlot => ({ key: "image3", label, hint, accept: "image", required: false });

/**
 * Shared notes for an app's Details popover (`parity`): a plain line about what Fuobe makes, for visitors. How a
 * preset differs from the app it was modelled on stays in code comments. TWO_STEP: the reference restyles the photo
 * with an edit model and then animates it, where Fuobe animates the change in one image-to-video pass. NO_AUDIO: the
 * i2v models these apps run on make silent clips.
 */
const TWO_STEP = "Animates the change from your photo in one pass.";
const NO_AUDIO = "This makes a silent clip. Add sound with Video to audio.";

type AppSpec = {
  /** Kept when an app is renamed, so links, previews and saved runs still find it (default: from the name). */
  id?: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  hue: number;
  prompt: string;
  inputs?: InputSlot[];
  options?: PresetOption[];
  userPrompt?: Preset["userPrompt"];
  placeholder?: string;
  cloud?: Partial<PresetRoute> | null;
  open?: Partial<PresetRoute> | null;
  openAlso?: PresetRoute[];
  badges?: Preset["badges"];
  parity?: string;
  tool?: Preset["tool"];
};

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function app(a: AppSpec): Preset {
  const cloud = a.cloud === null ? null : { modelId: EDIT_CLOUD, op: "edit" as const, ...a.cloud };
  const open = a.open === null ? null : { modelId: EDIT_OPEN, op: "edit" as const, ...a.open };
  return {
    id: a.id ?? `app-${slug(a.name)}`,
    type: "app",
    name: a.name,
    category: a.category,
    description: a.description,
    look: { icon: a.icon, from: `oklch(0.78 0.14 ${a.hue})`, to: `oklch(0.58 0.19 ${(a.hue + 40) % 360})` },
    badges: a.badges,
    inputs: a.inputs ?? [photo],
    options: a.options,
    promptTemplate: a.prompt,
    userPrompt: a.userPrompt ?? "none",
    promptPlaceholder: a.placeholder,
    cloud: cloud as PresetRoute | null,
    open: open as PresetRoute | null,
    ...(a.openAlso?.length && { openAlso: a.openAlso }),
    parity: a.parity,
    ...(a.tool && { tool: a.tool }),
  };
}

/** Image-to-video app (animates the uploaded photo). */
function videoApp(a: Omit<AppSpec, "cloud" | "open">): Preset {
  return app({ ...a, cloud: VIDEO_CLOUD, open: VIDEO_OPEN });
}

/** An option whose choices also set one of the model's settings (params.extra[param]). */
const angleOption = (key: string, label: string, param: string, choices: [string, string, number][]): PresetOption => ({
  key,
  label,
  choices: choices.map(([l, p, v]) => ({ value: slug(l), label: l, prompt: p, extra: { [param]: v } })),
});

const opt = (key: string, label: string, choices: [string, string][]): PresetOption => ({
  key,
  label,
  choices: choices.map(([l, p]) => ({ value: slug(l), label: l, prompt: p })),
});

/**
 * Old app ids still stored on generations (their Reuse / Retry look the preset up by id): the app they
 * became. The Virality Predictor app is the Hook Frame app since /virality took its name and URL.
 */
export const APP_ALIASES: Record<string, string> = { "app-virality-predictor": "app-hook-frame" };

export const APPS: Preset[] = [
  // ---------------- Identity & people
  app({
    name: "Face Swap",
    category: "Identity",
    description: "Put a face onto another photo, keeping pose, light and style",
    icon: "Repeat2",
    hue: 300,
    badges: ["top"],
    inputs: [
      { key: "image", label: "Target photo", accept: "image", required: true, hint: "The scene to keep" },
      second("Face", "A clear photo of the face to use"),
    ],
    prompt:
      "Replace the face of the person in the first image with the face of the person in the second image. Keep the first image's pose, hairstyle, clothing, lighting, color grading, camera angle and background exactly. Match skin tone, head angle, perspective and lighting so the result looks like an untouched photograph.",
  }),
  app({
    name: "Character Swap",
    category: "Identity",
    description: "Swap the whole person into a new scene",
    icon: "UserRoundCog",
    hue: 280,
    inputs: [
      { key: "image", label: "Scene", accept: "image", required: true },
      second("Character", "Who should be in the scene"),
    ],
    prompt:
      "Replace the person in the first image with the person from the second image, keeping their identity, face, body shape, hair and outfit from the second image. Keep the first image's pose, composition, camera angle, lighting, shadows and background, and blend the new character in seamlessly.",
  }),
  app({
    name: "Headshot Generator",
    category: "Identity",
    description: "Studio-quality professional headshots from a selfie",
    icon: "BriefcaseBusiness",
    hue: 230,
    badges: ["top"],
    options: [
      opt("style", "Style", [
        ["Corporate", "a corporate LinkedIn headshot, navy blazer, neutral gray studio backdrop, soft key light"],
        ["Creative", "a creative agency headshot, casual smart clothing, warm textured backdrop, natural window light"],
        ["Outdoor", "an outdoor headshot with a softly blurred city background, golden hour light"],
        ["Black & white", "a dramatic black and white studio portrait with Rembrandt lighting"],
        ["Doctor", "a medical professional headshot in a white coat, clean bright clinic background"],
        ["Startup", "a modern startup founder headshot in a crisp t-shirt and jacket, bright office bokeh"],
      ]),
    ],
    prompt:
      "Turn this photo into {option:style}. Keep the person's exact face, identity, skin tone and hairline; shoulders-up framing, sharp eyes, natural skin texture, 85mm portrait lens look.",
  }),
  app({
    name: "Skin Enhancer",
    category: "Identity",
    description: "Natural, realistic skin retouch and deblur",
    icon: "Sparkle",
    hue: 20,
    badges: ["top"],
    options: [
      opt("level", "Retouch", [
        ["Natural", "a subtle natural retouch: even out redness and blemishes while keeping every pore, freckle and fine line"],
        ["Soft glow", "a soft beauty retouch with a healthy dewy glow, still keeping real pore texture"],
        ["Sharpen", "a sharpening pass that removes blur and noise and restores crisp detail in eyes, lashes, hair and skin"],
      ]),
    ],
    prompt:
      "Give the portrait {option:level}. Make the skin look like a high-end editorial photograph shot on a sharp lens, with real, natural skin texture and the same makeup. Keep the face shape, identity, expression, hair, lighting and background exactly the same.",
  }),
  app({
    name: "Age Shift",
    category: "Identity",
    description: "See yourself younger or older",
    icon: "Hourglass",
    hue: 40,
    options: [
      opt("age", "Age", [
        ["Child", "as a 7-year-old child"],
        ["Teen", "as a 16-year-old teenager"],
        ["40s", "in their mid 40s"],
        ["70s", "in their 70s with gray hair and natural wrinkles"],
      ]),
    ],
    prompt: "Show the same person {option:age}. Keep their identity recognizable, same pose, clothing and background.",
  }),
  app({
    name: "Hairstyle Try-On",
    category: "Identity",
    description: "Try a new haircut or color",
    icon: "Scissors",
    hue: 330,
    userPrompt: "optional",
    placeholder: "e.g. platinum blonde bob with bangs",
    prompt: "Change only the person's hairstyle to {prompt}. Keep the face, identity, lighting, clothing and background exactly the same.",
  }),
  app({
    name: "Makeup Studio",
    category: "Identity",
    description: "Apply a makeup look",
    icon: "Brush",
    hue: 350,
    options: [
      opt("look", "Look", [
        ["Natural glow", "soft natural glowy makeup"],
        ["Glam", "full glam makeup with winged eyeliner and red lips"],
        ["Editorial", "bold editorial makeup with graphic colorful eyeliner"],
        ["Goth", "dark gothic makeup with black lipstick"],
      ]),
    ],
    prompt: "Apply {option:look} to the person. Keep their identity, expression, hair and everything else unchanged.",
  }),
  app({
    name: "Expression Edit",
    category: "Identity",
    description: "Change someone's expression",
    icon: "Smile",
    hue: 60,
    options: [
      opt("expr", "Expression", [
        ["Big smile", "a big genuine smile showing teeth"],
        ["Laughing", "laughing joyfully"],
        ["Serious", "a serious, confident expression"],
        ["Surprised", "a surprised expression with raised eyebrows"],
      ]),
    ],
    prompt: "Change the person's facial expression to {option:expr}. Keep identity, pose, lighting and background identical.",
  }),
  app({
    name: "Commercial Faces",
    category: "Identity",
    description: "Turn your selfie into an ad-ready spokesperson shot",
    icon: "BadgeDollarSign",
    hue: 140,
    options: [
      opt("ad", "Campaign", [
        ["Beauty", "a premium skincare campaign: clean beauty lighting, dewy skin, holding a blank unbranded serum bottle near the cheek"],
        ["Tech", "a consumer tech campaign: bright minimal studio, holding a sleek unbranded smartphone, friendly confident smile"],
        ["Fitness", "a sportswear campaign: athletic outfit, gym or outdoor track background, energetic pose, hard sunlight"],
        ["Food & drink", "a beverage campaign: sunny café terrace, holding a chilled unbranded drink, candid laugh"],
        ["Fashion", "a luxury fashion campaign: tailored outfit, editorial pose, warm neutral backdrop"],
      ]),
    ],
    prompt:
      "Turn the person in this photo into the face of {option:ad}. Keep their exact face, identity, skin tone and hair; photograph them as a polished commercial model with professional retouching, magazine-quality lighting and empty space for ad copy.",
    parity: "Makes ad-ready pictures of you for the campaign you pick.",
  }),
  // ---------------- Camera & light
  app({
    name: "Angles",
    category: "Camera",
    description: "Re-shoot the same scene from any camera angle",
    icon: "Rotate3d",
    hue: 190,
    badges: ["top"],
    // The cloud model turns its rotate / tilt / zoom settings into the Multiple-Angles LoRA's own words; the open
    // route runs that LoRA on Qwen-Image-Edit 2511 with the same words ("<sks> front-left quarter view …"). Fuobe Angles
    // (the next app, O11) is Higgsfield Angles' 2509 recipe; it replaces this default only when the angles eval suite
    // (scripts/eval/cases/angles.json) promotes it.
    options: [
      angleOption("angle", "Angle", "horizontal_angle", [
        ["Front", "front view", 0],
        ["Front right", "front-right quarter view", 45],
        ["Right side", "right side view", 90],
        ["Back right", "back-right quarter view", 135],
        ["Back", "back view", 180],
        ["Back left", "back-left quarter view", 225],
        ["Left side", "left side view", 270],
        ["Front left", "front-left quarter view", 315],
      ]),
      angleOption("height", "Height", "vertical_angle", [
        ["Eye level", "eye-level shot", 0],
        ["Low angle", "low-angle shot", -30],
        ["Elevated", "elevated shot", 30],
        ["High angle", "high-angle shot", 60],
      ]),
      angleOption("distance", "Distance", "zoom", [
        ["Medium", "medium shot", 5],
        ["Close-up", "close-up", 10],
        ["Wide", "wide shot", 0],
      ]),
    ],
    userPrompt: "optional",
    placeholder: "Anything to keep in mind (optional)",
    prompt: "Show the exact same scene and subject as a {option:angle}, {option:height}, {option:distance}, as if the camera physically moved. Keep identity, outfit, props, lighting and environment consistent. {prompt}",
    // fal builds the camera words from the sliders; this goes in as its additional_prompt (never empty, so the
    // app runs without a note).
    cloud: { modelId: "qwen-multiple-angles", op: "edit", promptTemplate: "Keep the same subject, identity, outfit, lighting and environment. {prompt}" },
    open: {
      modelId: "oss-qwen-edit",
      op: "edit",
      loras: [ANGLES_2511_LORA],
      promptTemplate: "<sks> {option:angle} {option:height} {option:distance}. {prompt}",
    },
    // QMA · 96 views: Qwen-Image 2.1 with the QMA LoRA, on your GPU only (fal's Qwen-Image 2.1 takes no LoRAs).
    // The choices' angles (horizontal_angle, vertical_angle, zoom) become its words in the plan, the note after them.
    openAlso: [{ modelId: QMA_MODEL, op: "edit", promptTemplate: "{prompt}" }],
  }),
  app({
    name: "Fuobe Angles",
    category: "Camera",
    description: "Turn the camera on the same shot: rotate, tilt, move closer, go wide",
    icon: "Rotate3d",
    hue: 205,
    badges: ["new", "beta"],
    // Fuobe Angles (O11): Higgsfield Angles' recipe, Qwen-Image-Edit 2509 + dx8152's Multiple-angles LoRA on both engines, next
    // to the Angles app's 2511 route (which stays the default until the angles eval suite promotes this one). The choices set
    // the hosted route's own fields (rotate −90…90°, positive = left; vertical −1 above … 1 below; move forward 0–10; a
    // wide-angle lens); on the GPU they become the LoRA's words (src/lib/catalog/open-tools.ts). The default turns it.
    options: [
      {
        ...angleOption("rotate", "Rotate", "rotate_right_left", [
          ["90° left", "", 90],
          ["45° left", "", 45],
          ["Front", "", 0],
          ["45° right", "", -45],
          ["90° right", "", -90],
        ]),
        default: "45-left",
      },
      angleOption("height", "Camera height", "vertical_angle", [
        ["Eye level", "", 0],
        ["From above", "", -1],
        ["From below", "", 1],
      ]),
      angleOption("distance", "Distance", "move_forward", [
        ["As is", "", 0],
        ["Closer", "", 5],
        ["Close-up", "", 10],
      ]),
      {
        key: "lens",
        label: "Lens",
        choices: [
          { value: "normal", label: "Normal", prompt: "", extra: { wide_angle_lens: false } },
          { value: "wide", label: "Wide-angle", prompt: "", extra: { wide_angle_lens: true } },
        ],
      },
    ],
    userPrompt: "optional",
    placeholder: "Anything to keep in mind (optional)",
    prompt: "{prompt}",
    cloud: { modelId: "fuobe-angles", op: "edit" },
    open: { modelId: "fuobe-angles", op: "edit" },
    // The reference's recipe (Qwen-Image-Edit 2509 + the Multiple-angles LoRA), hosted on fal or with Qwen-Image-Lightning
    // on the GPU. Not yet measured: the Angles app stays the default until the angles evaluation suite promotes it.
    parity:
      "Follows your camera settings. Your words add detail when it runs on your GPU.",
  }),
  // Any Angle: a tool of its own (src/components/any-angle/any-angle-tool.tsx, src/lib/catalog/any-angle.ts). The photo
  // becomes a 3D view once (TripoSplat), each angle is that view rendered at the camera picked and repainted by
  // Qwen-Image 2.1 with the AnyAngle LoRA. GPU only: no hosted Qwen-Image 2.1 takes the LoRA.
  app({
    id: "app-any-angle",
    name: "Any Angle",
    category: "Camera",
    description: "Turn the camera around your photo. Same face, same outfit, same place",
    icon: "Rotate3d",
    hue: 170,
    badges: ["new"],
    tool: "any-angle",
    inputs: [{ key: "image", label: "Photo", hint: "One person or one product, in any setting", accept: "image", required: true }],
    prompt: "Change the camera angle",
    cloud: null,
    open: { modelId: "oss-any-angle", op: "edit" },
    parity: "Runs on your GPU. It builds a 3D view of your photo first, then shoots it again from the camera you pick.",
  }),
  app({
    name: "Shots",
    category: "Camera",
    description: "Essential cinematic storyboard shots from one image",
    icon: "LayoutGrid",
    hue: 210,
    badges: ["top"],
    options: [
      opt("shot", "Shot", [
        ["Storyboard grid", "a 3x3 storyboard contact sheet of nine different shots: extreme wide, wide, medium, medium close-up, close-up, extreme close-up of the eyes, over-the-shoulder, low angle and high angle"],
        ["Extreme wide", "an extreme wide establishing shot"],
        ["Wide", "a wide full-body shot"],
        ["Medium", "a medium shot from the waist up"],
        ["Medium close-up", "a medium close-up from the chest up"],
        ["Close-up", "a close-up of the face"],
        ["Extreme close-up", "an extreme close-up of the eyes"],
        ["Over the shoulder", "an over-the-shoulder shot"],
        ["Low angle", "a heroic low-angle shot"],
        ["High angle", "a high-angle shot looking down"],
      ]),
    ],
    prompt:
      "Re-shoot this scene as {option:shot}. Same characters, faces, wardrobe, location, lighting and color grade — consistent frames from one film, cinematic composition.",
    parity: "Makes the shot you pick, or nine shots as one 3x3 storyboard.",
  }),
  app({
    name: "Zooms",
    category: "Camera",
    description: "Nine zoom levels, from macro to wide",
    icon: "ZoomIn",
    hue: 170,
    options: [
      opt("level", "Zoom", [
        ["Grid of 9", "a 3x3 grid of nine zoom levels of the same moment, from a macro detail to an extreme wide shot"],
        ["Macro", "a macro shot of a tiny texture detail"],
        ["Extreme close-up", "an extreme close-up"],
        ["Close-up", "a close-up"],
        ["Medium", "a medium shot"],
        ["Wide", "a wide shot"],
        ["Very wide", "a very wide shot showing the whole location"],
        ["Aerial", "an aerial drone shot high above"],
        ["Satellite", "a satellite-height view where the location is a tiny dot"],
      ]),
    ],
    prompt: "Show the same moment as {option:level}, centered on the main subject. Keep subject, outfit, lighting, time of day and environment consistent.",
    parity: "Makes the zoom level you pick, or all nine as one 3x3 grid.",
  }),
  app({
    name: "What's Next",
    category: "Camera",
    description: "Explore where the story goes from one frame",
    icon: "GitBranch",
    hue: 260,
    userPrompt: "optional",
    placeholder: "Steer the story (optional)",
    options: [
      opt("dir", "Direction", [
        ["Next moment", "the very next moment, a few seconds later"],
        ["Plot twist", "an unexpected plot twist"],
        ["Action", "the scene erupts into action"],
        ["Romance", "a tender romantic turn"],
        ["Danger", "a sudden threat appears"],
        ["One year later", "the same characters one year later"],
        ["Storyboard of 8", "a 2x4 storyboard grid of eight different possible next scenes"],
      ]),
    ],
    prompt:
      "Imagine what happens next in this story: {option:dir}. {prompt}. Show it as a new cinematic film frame with the same characters, faces, wardrobe, world and visual style.",
    parity: "Makes the direction you pick, or eight next scenes as one storyboard.",
  }),
  app({
    name: "Relight",
    category: "Camera",
    description: "Change the lighting of any photo",
    icon: "Lamp",
    hue: 50,
    // Its page is its own tool (tap to place lights, a live preview, Generate lighting, an Intensity blend:
    // src/components/relight). The options and words below stay for the composer route the planner and Canvas use.
    tool: "relight",
    options: [
      opt("light", "Lighting", [
        ["Golden hour", "warm golden hour sunlight"],
        ["Neon night", "pink and blue neon lights at night"],
        ["Studio softbox", "soft, even studio softbox lighting"],
        ["Dramatic", "dramatic low-key lighting with a single hard light and deep shadows"],
        ["Overcast", "soft overcast daylight"],
        ["Candlelight", "warm flickering candlelight"],
        ["Silhouette", "strong backlight that turns the subject into a near-silhouette"],
        ["Window", "soft directional window light"],
      ]),
      opt("dir", "Direction", [
        ["Auto", ""],
        ["Left", "coming from the left"],
        ["Right", "coming from the right"],
        ["Front", "coming from the front"],
        ["Above", "coming from above"],
        ["Behind", "coming from behind the subject as a rim light"],
      ]),
    ],
    prompt:
      "Relight the image with {option:light} {option:dir}. Keep the subject, composition and all details identical; only the light, shadows, reflections and color temperature change.",
  }),
  app({
    name: "AI Influencer",
    category: "Identity",
    description: "Invent an original character and get a full character sheet",
    icon: "UserRoundCog",
    hue: 280,
    inputs: [],
    userPrompt: "required",
    placeholder: "Who are they? e.g. “a 26-year-old surfer and photographer from Lisbon, freckles, sun-bleached curls”",
    prompt: "{prompt}",
    // Fuobe Soul draws the wide sheet in the cloud in the casting look, as the AI Influencer builder does (build plan O10).
    cloud: {
      modelId: "fuobe-soul",
      op: "t2i",
      look: CAST_LOOK,
      params: { aspectRatio: "16:9", resolution: "1080p" },
      promptTemplate:
        "A character sheet of an original character: {prompt}. Front, three-quarter, profile and back views side by side on a plain light studio background, full body, the same face, hairstyle and outfit in every view, photorealistic, high detail.",
    },
    // The Soul Cast sheet workflow: Z-Image Turbo draws the turnaround (front, three-quarter, profile, back) and
    // cuts it into the four views, which make a better character element than one wide sheet.
    // Fuobe Soul's own base: the casting look's words and LoRAs go on it too.
    open: {
      modelId: "oss-zimage-soul-cast",
      op: "t2i",
      look: CAST_LOOK,
      promptTemplate: "An original character: {prompt}. The same face, hairstyle and outfit in every view, photorealistic, high detail.",
    },
    parity:
      "Save the sheet as a character (tile menu) to use it in any prompt with @. From your own photos or a Soul Cast build, use Character Sheet.",
  }),
  app({
    name: "Match Lighting",
    category: "Camera",
    description: "Relight a photo to match the light in a reference shot",
    icon: "Sunset",
    hue: 35,
    inputs: [photo, second("Lighting reference", "A photo whose light you want")],
    prompt:
      "Relight image 1 so its lighting matches image 2: the same light direction, softness, color temperature, contrast and mood. Keep the subject, composition and every detail of image 1 identical; only the light, shadows and reflections change.",
    open: { modelId: "oss-qwen-relight-ref", op: "edit" },
  }),
  app({
    name: "Match Colors",
    category: "Camera",
    description: "Give a photo the color palette of a reference image",
    icon: "Palette",
    hue: 300,
    inputs: [photo, second("Color reference", "A still, poster or frame with the colors you want")],
    prompt:
      "Recolor image 1 to match the color palette and grade of image 2: the same hues, saturation, contrast and tone in the shadows and highlights. Keep the content, composition and details of image 1 unchanged.",
    open: { modelId: "oss-palette-image", op: "color-match" },
    parity: "Copies the reference's palette onto your photo.",
  }),
  app({
    name: "Expand Image",
    category: "Camera",
    description: "Extend any image beyond its edges",
    icon: "Scaling",
    hue: 150,
    options: [
      opt("ratio", "Target", [
        ["16:9", "a wide 16:9 frame"],
        ["9:16", "a tall 9:16 vertical frame"],
        ["1:1", "a square 1:1 frame"],
        ["4:5", "a 4:5 portrait frame"],
        ["21:9", "an ultra-wide 21:9 cinematic frame"],
      ]),
    ],
    prompt:
      "Expand this image outward into {option:ratio}, continuing the scene naturally beyond every edge with matching perspective, lighting, textures and grain. Keep the original content untouched, and fill the new area with more of the same surroundings.",
    open: OUTPAINT_OPEN,
    parity: "Pick the shape you want before you expand.",
  }),
  app({
    name: "Zoom Out",
    category: "Camera",
    description: "Expand the frame and reveal more of the scene",
    icon: "Expand",
    hue: 170,
    prompt: "Zoom out to reveal much more of the surrounding scene around the subject, extending the environment naturally in all directions. Keep the subject identical.",
    open: OUTPAINT_OPEN,
  }),
  app({
    name: "Behind the Scenes",
    category: "Camera",
    description: "Reveal the film set behind any shot",
    icon: "Clapperboard",
    hue: 20,
    badges: ["top"],
    prompt:
      "The camera slowly pulls back from the original shot to reveal it is being filmed on a busy professional film set: a cinema camera on a dolly, crew members, light stands and softboxes, a boom mic overhead and monitors showing the shot. The subject stays in character, then glances at the crew and smiles. Handheld behind-the-scenes documentary footage.",
    cloud: VIDEO_CLOUD,
    open: VIDEO_OPEN,
  }),
  // ---------------- Products & ads
  app({
    name: "Packshot",
    category: "Product",
    description: "Clean e-commerce product shots",
    icon: "Package",
    hue: 210,
    badges: ["top"],
    options: [
      opt("bg", "Background", [
        ["Pure white", "a seamless pure white studio background with a soft contact shadow"],
        ["Pastel", "a soft pastel gradient backdrop with gentle shadows"],
        ["Marble", "a white marble surface with soft natural light"],
        ["Dark luxury", "a dark moody backdrop with a rim light"],
        ["Podium", "a minimal stone podium with sculpted shadows"],
      ]),
    ],
    prompt:
      "Create a professional product packshot of the product from the image on {option:bg}. Keep the product's exact shape, label, text and colors. Commercial photography, crisp focus.",
    parity: "Makes the packshot as a still. Animate it with Product 360.",
  }),
  app({
    name: "Product Shot",
    category: "Product",
    description: "Your product photo, relit into a new scene",
    icon: "Aperture",
    hue: 30,
    badges: ["new"],
    // Described scenes only: Bria takes a scene description or a reference photo, never both.
    inputs: [product],
    options: [
      opt("scene", "Scene", [
        ["Marble counter", "on a white marble kitchen counter, soft morning window light"],
        ["Studio podium", "on a minimal stone podium in a studio, soft key light and gentle shadows"],
        ["Nature", "outdoors on a mossy rock in a sunlit forest, dappled light"],
        ["Beach", "on warm sand at the beach at golden hour, the sea softly blurred behind"],
        ["Dark luxury", "on dark slate with dramatic rim light and reflections, luxury mood"],
        ["Bathroom shelf", "on a clean bathroom shelf with plants, bright and airy"],
      ]),
    ],
    userPrompt: "optional",
    placeholder: "Or describe your own scene (optional)",
    prompt: "The product {option:scene}. {prompt}",
    cloud: { modelId: "bria-product-shot", op: "edit" },
    open: { modelId: "oss-product-shot", op: "edit" },
    // The open version is Qwen-Image-Edit 2509 with the White_to_Scene LoRA.
    parity: "On your GPU it cuts the product out, puts it on white and relights it into the scene.",
  }),
  app({
    name: "Product Placement",
    category: "Product",
    description: "Place your product into any scene",
    icon: "PackagePlus",
    hue: 140,
    inputs: [
      { key: "image", label: "Scene", accept: "image", required: true },
      second("Product", "Cut-out or photo of the product"),
    ],
    prompt:
      "Place the product from the second image naturally into the first image, at a believable scale, with matching perspective, lighting, reflections and shadows. Keep the product's label and details exact.",
  }),
  app({
    name: "Ad Creative",
    category: "Product",
    description: "Turn a product photo into a scroll-stopping ad",
    icon: "Megaphone",
    hue: 10,
    userPrompt: "optional",
    placeholder: "Headline or brand vibe (optional)",
    inputs: [product],
    prompt:
      "Create a bold, high-end social media advertisement featuring the product from the image, dynamic composition, premium lighting, props that match the product. {prompt}. Keep the product exact.",
  }),
  // Click to Ad and Link to Video Ad open the Click to Ad flow (/marketing/click-to-ad, redirected in
  // next.config.ts): a product link → product kit → a 9:16 ad with voiceover and captions. The
  // entries stay so the gallery keeps its cards.
  app({
    name: "Click to Ad",
    category: "Product",
    description: "Product link → 9:16 video ad with voiceover and captions",
    icon: "MousePointerClick",
    hue: 30,
    inputs: [product],
    userPrompt: "optional",
    placeholder: "Product name, offer or audience (optional)",
    options: [
      opt("format", "Format", [
        ["UGC selfie", "an authentic UGC-style phone photo of a creator holding the product up to the camera in their home, natural window light, casual and relatable"],
        ["Studio hero", "a premium studio hero shot of the product with dramatic lighting and bold color backdrop"],
        ["Lifestyle", "a lifestyle photo of the product being used in a real everyday setting"],
        ["Flat lay", "a styled overhead flat lay of the product with complementary props"],
      ]),
    ],
    prompt:
      "Create an ad image: {option:format}. {prompt}. The product from the image must keep its exact shape, colors, label and logo. Leave clean space for a headline.",
  }),
  app({
    name: "Link to Video Ad",
    category: "Product",
    description: "Paste a product link, get a short video ad",
    icon: "Link",
    hue: 45,
    inputs: [product],
    userPrompt: "optional",
    placeholder: "Product name or selling point (optional)",
    prompt:
      "A short commercial for the product in the image: the camera glides in from a wide hero angle, the product rotates slightly as light sweeps across its surface, then the shot settles on a crisp close-up of the logo. {prompt}. Premium studio lighting, the product's design and label stay exactly the same.",
    cloud: VIDEO_CLOUD,
    open: VIDEO_OPEN,
  }),
  app({
    name: "Unboxing Video",
    category: "Product",
    description: "Hands unbox your product on camera",
    icon: "PackageOpen",
    hue: 30,
    inputs: [product],
    prompt: "Close-up shot of hands unboxing and revealing the product from the image on a clean desk, satisfying and smooth, natural light",
    cloud: VIDEO_CLOUD,
    open: VIDEO_OPEN,
  }),
  app({
    name: "Product 360",
    category: "Product",
    description: "Spin your product on a turntable",
    icon: "RefreshCw",
    hue: 200,
    inputs: [product],
    prompt: "The product from the image rotates slowly 360 degrees on a turntable in a clean studio, consistent lighting, product details stay exact",
    cloud: VIDEO_CLOUD,
    open: VIDEO_OPEN,
  }),
  app({
    name: "Image to 3D",
    category: "Product",
    description: "A 3D model of your product (.glb) to spin, download and animate",
    icon: "Box",
    hue: 240,
    badges: ["new"],
    inputs: [product],
    prompt: "",
    cloud: { modelId: "hunyuan-3d-3-1-pro", op: "image-to-3d" },
    open: { modelId: "oss-pixal3d", op: "image-to-3d" },
    parity: "Comes with a turntable video of your model.",
  }),
  videoApp({
    name: "Billboard Ad",
    category: "Product",
    description: "Your product on a giant city billboard",
    icon: "Presentation",
    hue: 220,
    inputs: [product],
    prompt:
      "Cinematic aerial shot of a busy city at dusk: the camera flies between skyscrapers toward a giant illuminated billboard showing the product from the image, then pushes in until the billboard fills the frame. Traffic streaks below, the product artwork stays exact and sharp.",
  }),
  videoApp({
    name: "Truck Ad",
    category: "Product",
    description: "Your product wrapped on a truck driving through the city",
    icon: "Truck",
    hue: 25,
    inputs: [product],
    prompt:
      "A clean box truck wrapped with large artwork of the product from the image drives through sunny city streets; the camera tracks alongside it, then the truck passes close to the lens revealing the full branded side. Realistic reflections, the product graphic stays exact.",
  }),
  videoApp({
    name: "Bullet Time Scene",
    category: "Product",
    description: "360° freeze-frame rotation through the full scene",
    icon: "Orbit",
    hue: 260,
    prompt:
      "Bullet time: the moment freezes completely — hair, dust and particles hang in mid-air — while the camera sweeps a smooth 360 degree arc around the subject through the full environment, then time resumes. Matrix-style cinematic shot.",
  }),
  videoApp({
    name: "Bullet Time White",
    category: "Product",
    description: "Freeze-frame 360° rotation on a clean white set",
    icon: "Disc",
    hue: 200,
    prompt:
      "The subject is placed on an infinite seamless white studio cyclorama; time freezes and the camera sweeps a smooth 360 degree bullet-time arc around them, showing every side with crisp, even light. Minimal, clean, premium.",
  }),
  videoApp({
    name: "Bullet Time Splash",
    category: "Product",
    description: "360° freeze-frame with a frozen water splash",
    icon: "Waves",
    hue: 195,
    prompt:
      "A huge splash of crystal-clear water bursts around the subject and freezes in mid-air into glittering droplets and sheets of liquid; the camera orbits 360 degrees through the frozen splash in bullet time, backlit highlights sparkling.",
  }),
  videoApp({
    name: "Poster",
    category: "Product",
    description: "Turn a product into a bold campaign poster",
    icon: "FileImage",
    hue: 350,
    inputs: [product],
    prompt:
      "The product from the image sits on a bold graphic color backdrop; oversized typography shapes and geometric color blocks slide into place around it like an animated campaign poster, then everything locks into a striking final layout with the product centered and exact.",
  }),
  videoApp({
    name: "Chameleon",
    category: "Product",
    description: "Color-shifting transformation",
    icon: "Rainbow",
    hue: 120,
    inputs: [product],
    prompt:
      "The product from the image stays perfectly still while its colors shift like a chameleon — waves of vivid hues ripple across its surface and the background changes color in sync, cycling through several bold palettes before settling. Shape and logo stay exact.",
  }),
  videoApp({
    name: "Macro Scene",
    category: "Product",
    description: "Product close-ups inside a matching lifestyle scene",
    icon: "Flower2",
    hue: 90,
    inputs: [product],
    prompt:
      "Extreme macro shot gliding slowly over the textures of the product from the image, then racking focus to reveal it placed in an elegant lifestyle setting that matches its mood — soft natural light, shallow depth of field, gentle particles in the air.",
  }),
  videoApp({
    name: "Macroshot Product",
    category: "Product",
    description: "Extreme close-up product video with cinematic detail",
    icon: "Microscope",
    hue: 160,
    inputs: [product],
    prompt:
      "Ultra-detailed macro camera move across the product from the image: the lens slides past materials, edges and the logo in razor-sharp focus with a moving highlight from a studio strip light, black background, slow and luxurious.",
  }),
  videoApp({
    name: "Magic Button",
    category: "Product",
    description: "A button press triggers a magical reveal",
    icon: "Pointer",
    hue: 280,
    prompt:
      "A finger presses a big glowing button in the foreground; a burst of sparkles and light sweeps across the frame and magically transforms the scene, revealing the subject from the image in a polished, upgraded version of the same setting. Fun, punchy, viral pacing.",
  }),
  videoApp({
    name: "Giant Product",
    category: "Product",
    description: "Your product towers over a city skyline",
    icon: "Building",
    hue: 30,
    inputs: [product],
    prompt:
      "Wide cinematic shot of a city skyline: a colossal version of the product from the image stands among the skyscrapers, taller than the buildings; the camera flies toward it as clouds drift past and tiny cars move below. Photoreal scale, product details exact.",
  }),
  videoApp({
    id: "app-kick-ad",
    name: "Keep Calm",
    category: "Product",
    description: "Unbothered, coffee in hand, as the room burns",
    icon: "Footprints",
    hue: 0,
    inputs: [product],
    prompt:
      "On a clean studio table the product from the image stands next to a plain unbranded rival product; a sneaker swings in and kicks the rival out of frame in slow motion, leaving the product alone in the spotlight as the camera pushes in. Funny, dynamic, product stays exact.",
  }),
  videoApp({
    name: "Graffiti Ad",
    category: "Product",
    description: "Your product sprayed as street art on a city wall",
    icon: "SprayCan",
    hue: 310,
    inputs: [product],
    prompt:
      "A brick city wall: spray-paint cans hiss as a bold, colorful graffiti mural of the product from the image appears stroke by stroke, drips and overspray included, then the camera pulls back to reveal the finished street-art piece.",
  }),
  videoApp({
    name: "Fridge Ad",
    category: "Product",
    description: "Your product in a fresh, glowing fridge",
    icon: "Refrigerator",
    hue: 185,
    inputs: [product],
    prompt:
      "A fridge door swings open with a cool glow of light and soft mist, revealing the product from the image on the middle shelf surrounded by fresh ingredients; condensation beads on its surface as the camera pushes in. Refreshing commercial look, label exact.",
  }),
  videoApp({
    name: "Volcano Ad",
    category: "Product",
    description: "Your product erupts from a volcano",
    icon: "Flame",
    hue: 15,
    inputs: [product],
    prompt:
      "Epic aerial shot of a volcano: it rumbles and erupts in a fountain of glowing lava, and the product from the image launches out of the crater and hangs majestically in the air amid sparks and smoke. Dramatic, cinematic, product exact.",
  }),
  videoApp({
    name: "ASMR Classic",
    category: "Product",
    description: "Turn any photo into a soothing ASMR clip",
    icon: "AudioLines",
    hue: 170,
    prompt:
      "Calm ASMR close-up: gentle hands slowly tap, stroke and handle the subject from the image with satisfying precision, soft diffused light, shallow depth of field, relaxing slow pace, macro detail.",
    parity: NO_AUDIO,
  }),
  videoApp({
    name: "ASMR Add-On",
    category: "Product",
    description: "Your character presents a product in an ASMR scene",
    icon: "Ear",
    hue: 150,
    inputs: [{ key: "image", label: "Character with product", hint: "Combine them first with Product Placement for best results", accept: "image", required: true }],
    prompt:
      "Intimate ASMR studio scene: the person gently presents the product, slowly turning it in their hands, tapping its surface with their nails and bringing it close to a microphone, soft warm light, calm and subtle movements.",
    parity: `Animates one photo of your character with the product. ${NO_AUDIO}`,
  }),
  app({
    name: "ASMR Host",
    category: "Product",
    description: "Your photo becomes a whispering ASMR presenter",
    icon: "Mic",
    hue: 330,
    inputs: [portrait, voice],
    userPrompt: "optional",
    placeholder: "How should they act? (optional)",
    prompt: "A soft-spoken ASMR host whispers close to a studio microphone with calm, gentle expressions and slow hand movements. {prompt}",
    cloud: AVATAR_CLOUD,
    open: AVATAR_OPEN,
    parity: "Your photo whispers the voice track you add. Make one with Text to speech.",
  }),
  app({
    name: "ASMR Promo",
    category: "Product",
    description: "A whispered product promo read by your character",
    icon: "Headphones",
    hue: 300,
    inputs: [
      { key: "image", label: "Character with product", hint: "Combine them first with Product Placement for best results", accept: "image", required: true },
      { ...voice, label: "Voiceover", hint: "Your script read as a soft whisper" },
    ],
    userPrompt: "optional",
    placeholder: "How should they act? (optional)",
    prompt: "The person softly whispers the product message to the camera in an ASMR studio, gently showing the product with slow, soothing gestures. {prompt}",
    cloud: AVATAR_CLOUD,
    open: AVATAR_OPEN,
    parity: "Uses one photo of your character with the product, and the voiceover you add. Make one with Text to speech.",
  }),
  // ---------------- Fashion
  app({
    name: "Virtual Try-On",
    category: "Fashion",
    description: "Dress a person in any garment",
    icon: "Shirt",
    hue: 260,
    badges: ["top"],
    inputs: [
      { key: "image", label: "Person", accept: "image", required: true },
      second("Garment", "Photo of the clothing item"),
    ],
    prompt:
      "Dress the person from the first image in the garment from the second image. Keep the person's face, body, pose and background; reproduce the garment's fabric, color, pattern, logo and fit realistically, with natural folds and shadows.",
    // FASHN Try-On 1.6 was built for exactly this (Garment / Quality settings); it takes no prompt.
    cloud: { modelId: "fashn-tryon", op: "edit" },
  }),
  app({
    name: "Outfit Swap",
    category: "Fashion",
    description: "Copy the outfit someone else is wearing onto you",
    icon: "ArrowLeftRight",
    hue: 280,
    inputs: [
      { key: "image", label: "Your photo", accept: "image", required: true },
      second("Outfit reference", "A photo of someone wearing the outfit you want"),
    ],
    prompt:
      "Take the complete outfit worn in the second image — every garment, shoes and accessories, with their exact colors, fabrics, prints and fit — and put it on the person in the first image. Keep the first person's face, hair, body shape, pose, lighting and background unchanged; only the clothing comes from the second image.",
  }),
  app({
    name: "AI Stylist",
    category: "Fashion",
    description: "Your own fitting room: mix clothes, poses and backdrops",
    icon: "Crown",
    hue: 300,
    inputs: [
      { key: "image", label: "You", accept: "image", required: true },
      second("Clothing item", "Top, dress, jacket…"),
      third("Second item (optional)", "Pants, shoes, bag…"),
    ],
    options: [
      opt("scene", "Scene", [
        ["Keep mine", "keep the original pose and background"],
        ["Street style", "a confident street-style pose on a city sidewalk, candid fashion photo"],
        ["Studio", "a full-body fashion pose against a seamless light gray studio backdrop"],
        ["Mirror selfie", "a mirror selfie in a stylish bedroom"],
        ["Runway", "walking a fashion show runway with audience bokeh"],
      ]),
    ],
    prompt:
      "Dress the person from the first image in all the clothing items shown in the other images, combined into one coherent outfit with accurate colors, fabrics and fit. Scene: {option:scene}. Keep the person's face, identity, hair and body proportions exactly.",
  }),
  app({
    name: "Style Snap",
    category: "Fashion",
    description: "Instant outfit makeover in a signature style",
    icon: "Aperture",
    hue: 320,
    options: [
      opt("style", "Style", [
        ["Old money", "an old-money look: cream cable-knit sweater, tailored trousers, loafers, gold watch"],
        ["Streetwear", "streetwear: oversized hoodie, cargo pants, chunky sneakers, cap"],
        ["Y2K", "a Y2K look: baby tee, low-rise flared jeans, tinted sunglasses, butterfly clips"],
        ["Business", "a sharp business suit with a crisp shirt"],
        ["Boho", "a bohemian look: flowy floral maxi dress or linen shirt, layered jewelry, suede"],
        ["Techwear", "black techwear: waterproof shell jacket, straps, utility pants, tactical boots"],
        ["Black tie", "black-tie evening wear: tuxedo or elegant floor-length gown"],
        ["Cottagecore", "cottagecore: puff-sleeve prairie dress or knit vest, straw hat"],
      ]),
    ],
    prompt:
      "Change only the person's outfit to {option:style}, fitted naturally to their body. Keep the face, identity, hairstyle, pose, lighting and background exactly the same.",
  }),
  app({
    name: "Steal the Look",
    category: "Fashion",
    description: "Copy the style, outfit and vibe of a reference",
    icon: "Wand2",
    hue: 320,
    inputs: [
      { key: "image", label: "You", accept: "image", required: true },
      second("Reference look", "A photo whose style you want"),
    ],
    prompt:
      "Restyle the person in the first image to match the outfit, styling, color grading, pose and photographic mood of the second image, while keeping the first person's face and identity.",
  }),
  app({
    name: "Outfit Vending",
    category: "Fashion",
    description: "Deconstruct an outfit into a glowing vending machine",
    icon: "Store",
    hue: 190,
    prompt:
      "Create a photo of a brightly illuminated retro vending machine on a night street. Behind its glass, every item of the outfit worn in the image — each garment, shoes, bag and accessories — is displayed separately on its own spiral slot with a small price tag, faithfully reproducing colors, fabrics and logos. The person from the image stands next to the machine in the same outfit. Neon reflections, cinematic night photography.",
  }),
  app({
    name: "Outfit Shot",
    category: "Fashion",
    description: "Up to 3 clothing items → a model photoshoot",
    icon: "Images",
    hue: 240,
    inputs: [
      { key: "image", label: "Clothing item", accept: "image", required: true },
      { key: "image2", label: "Second item (optional)", accept: "image", required: false },
      third("Third item (optional)"),
    ],
    userPrompt: "optional",
    placeholder: "Model or location (optional)",
    prompt:
      "Create a professional fashion campaign photo of a stylish model wearing all the clothing items from the images together as one outfit, reproducing each item's exact color, fabric, print and logo. {prompt}. Full-body editorial pose, natural light, high-end lookbook photography.",
    parity: "Makes the photoshoot as a still. Animate it with Bring to Life.",
  }),
  // Tap to Recolor: an app that is a tool of its own (src/components/recolor/recolor-tool.tsx): the taps (params.points)
  // pick the piece, the swatch or a custom colour (the prompt) names its new colour; only that piece is repainted.
  app({
    id: RECOLOR.appId,
    name: "Tap to Recolor",
    category: "Fashion",
    description: "Tap a piece, pick a colour; the fabric stays",
    icon: "Palette",
    hue: 330,
    badges: ["new"],
    tool: "recolor",
    options: [
      { key: "item", label: "What is it?", choices: ITEMS.map((i) => ({ value: i.value, label: i.label, prompt: i.words, extra: { recolorItem: i.value } })) },
      {
        key: "colour",
        label: "Colour",
        choices: [...SWATCHES.map((s) => ({ value: s.value, label: s.label, prompt: `${s.words} (${s.hex})` })), { value: CUSTOM_COLOUR, label: "Custom", prompt: "" }],
      },
    ],
    userPrompt: "optional",
    prompt: RECOLOR_TEMPLATE,
    cloud: null,
    open: { modelId: RECOLOR.modelId, op: "edit" },
    parity: "Runs on your own GPU. Only the piece you tap changes.",
  }),
  // ---------------- Style & art
  app({
    name: "Sketch to Real",
    category: "Style",
    description: "Turn a sketch or doodle into a photo",
    icon: "PencilRuler",
    hue: 90,
    userPrompt: "optional",
    placeholder: "What is it? (optional)",
    prompt:
      "Turn this sketch into a photorealistic image, following the drawing's composition and shapes exactly. {prompt}. Natural lighting, real materials, high detail.",
    parity: "Makes the photo. Animate it with Bring to Life.",
  }),
  app({
    name: "Style Transfer",
    category: "Style",
    description: "Restyle a photo in an art style",
    icon: "Palette",
    hue: 300,
    options: [
      opt("style", "Style", [
        ["Anime", "a vibrant Japanese anime illustration"],
        ["Pixar 3D", "a Pixar-style 3D animated film still"],
        ["Oil painting", "a classical oil painting with visible brushstrokes"],
        ["Watercolor", "a soft watercolor painting"],
        ["Claymation", "a stop-motion claymation scene"],
        ["Comic book", "a bold comic book panel with halftone shading"],
        ["Pixel art", "16-bit pixel art"],
        ["Ghibli", "a hand-painted Studio Ghibli style frame"],
      ]),
    ],
    prompt: "Redraw this image as {option:style}. Keep the composition, subject identity and pose.",
  }),
  app({
    name: "Color Grading",
    category: "Style",
    description: "Cinematic color grades in one click",
    icon: "SlidersHorizontal",
    hue: 30,
    options: [
      opt("grade", "Grade", [
        ["Teal & orange", "a blockbuster teal-and-orange grade with warm skin and cool shadows"],
        ["Film colors", "a Kodak Portra film look with soft contrast, warm highlights and fine grain"],
        ["Bleach bypass", "a desaturated, high-contrast bleach bypass look"],
        ["Classic B&W", "a rich classic black and white with deep blacks"],
        ["Cold steel", "a cold steel-blue thriller grade"],
        ["Hyper neon", "a saturated hyper-neon magenta and cyan night grade"],
        ["Nostalgic blue", "a faded nostalgic blue film look with lifted blacks"],
        ["Candy pink", "a soft pastel candy-pink grade"],
        ["Naturalistic", "a clean, naturalistic true-to-life grade"],
      ]),
      opt("grain", "Grain", [
        ["None", ""],
        ["Fine", "with fine film grain"],
        ["Heavy", "with heavy 16mm film grain and subtle halation"],
      ]),
    ],
    prompt:
      "Color grade this photo with {option:grade} {option:grain}. Only change color, contrast, tone and grain; keep every object, face, detail and the composition identical.",
    parity: "Repaints your photo in the grade you pick, with film grain if you want it.",
  }),
  app({
    name: "Colorize",
    category: "Style",
    description: "Bring black & white photos to color",
    icon: "Droplets",
    hue: 120,
    prompt: "Colorize this black and white photo with natural, historically plausible colors. Keep every detail and the composition identical.",
  }),
  app({
    name: "Restore Photo",
    category: "Style",
    description: "Fix scratches, blur and damage",
    icon: "Sparkles",
    hue: 160,
    prompt:
      "Restore this old photograph: remove scratches, dust, stains and blur, recover sharp detail and natural skin texture. Keep the people and composition identical.",
  }),
  app({
    name: "Figurine",
    category: "Style",
    description: "Turn anyone into a collectible figurine",
    icon: "Gem",
    hue: 30,
    badges: ["top"],
    prompt:
      "Create a 1/7 scale commercialized collectible figurine of the character in the image, realistic style, standing on a round transparent acrylic base on a computer desk, with the figure's packaging box with original artwork next to it and the modeling process on the monitor behind.",
  }),
  app({
    name: "Sticker Pack",
    category: "Style",
    description: "Make cute die-cut stickers of anyone",
    icon: "Sticker",
    hue: 70,
    prompt: "Turn the subject into a set of cute die-cut stickers with thick white borders showing different expressions, flat background.",
  }),
  app({
    name: "Glitter Sticker",
    category: "Style",
    description: "A holographic glitter sticker of you on a city wall",
    icon: "Star",
    hue: 290,
    prompt:
      "Turn the person in the image into a die-cut rainbow holographic foil sticker with glitter texture and a thick white border, slightly peeling at one corner, stuck on a weathered urban surface like a lamppost or graffiti wall. Iridescent reflections, the person's face stays recognizable, realistic street photo.",
  }),
  app({
    name: "Plushies",
    category: "Style",
    description: "Turn anyone into a cuddly plush doll",
    icon: "Rabbit",
    hue: 15,
    options: [
      opt("kind", "Material", [
        ["Plush", "a soft fuzzy plush toy with embroidered eyes"],
        ["Knitted", "a hand-knitted wool amigurumi doll with visible stitches"],
        ["Felt", "a handmade needle-felted doll"],
      ]),
    ],
    prompt:
      "Turn the person or pet in the image into {option:kind}, keeping their hairstyle, outfit colors and recognizable features in cute chibi proportions. Photograph it sitting on a cozy bed with soft daylight.",
    parity: "Makes the plush doll as a still. Animate it with Bring to Life.",
  }),
  // ---------------- Video
  app({
    name: "Talking Photo",
    category: "Video",
    description: "Make a photo speak with your audio",
    icon: "MessageCircle",
    hue: 150,
    badges: ["top"],
    inputs: [photo, voice],
    userPrompt: "optional",
    placeholder: "How should they act? (optional)",
    prompt: "{prompt}",
    cloud: AVATAR_CLOUD,
    open: AVATAR_OPEN,
  }),
  app({
    name: "Recast",
    category: "Video",
    description: "Swap the character in any video",
    icon: "Drama",
    hue: 270,
    inputs: [
      { key: "image", label: "New character", hint: "Who should star in the video", accept: "image", required: true },
      { key: "video", label: "Source video", hint: "The performance to copy", accept: "video", required: true },
    ],
    prompt: "The character from the image performs exactly the motion, expressions and timing of the source video.",
    cloud: null,
    open: ANIMATE_OPEN,
  }),
  app({
    name: "Video Face Swap",
    category: "Video",
    description: "Put a face into any video",
    icon: "ScanFace",
    hue: 310,
    inputs: [
      { key: "image", label: "Face", hint: "A clear photo of the face to use", accept: "image", required: true },
      { key: "video", label: "Target video", accept: "video", required: true },
    ],
    prompt: "The person from the image performs exactly the motion, expressions and timing of the target video.",
    cloud: null,
    open: ANIMATE_OPEN,
    parity: "Draws the whole person again from your photo, not only the face.",
  }),
  app({
    name: "Transitions",
    category: "Video",
    description: "Seamless transition between two shots",
    icon: "ArrowRightLeft",
    hue: 230,
    inputs: [
      { key: "image", label: "First shot", accept: "image", required: true },
      { key: "endImage", label: "Second shot", accept: "image", required: true },
    ],
    options: [
      opt("fx", "Transition", [
        ["Morph", "the first shot morphs fluidly into the second, shapes and colors flowing into their new positions"],
        ["Whip pan", "a fast whip pan with heavy motion blur carries the camera from the first shot into the second"],
        ["Zoom through", "the camera rushes forward through the first shot and emerges into the second"],
        ["Spin", "the frame spins rapidly around its center and lands on the second shot"],
        ["Light leak", "a burst of warm light leak flares across the lens, washing out the first shot and revealing the second"],
        ["Smoke", "thick smoke billows across the frame and clears to reveal the second shot"],
        ["Liquid", "a wave of liquid sweeps across the frame and washes the first shot away into the second"],
        ["Glitch", "a digital glitch with RGB split and pixel tearing jumps from the first shot to the second"],
      ]),
    ],
    prompt: "Seamless transition: {option:fx}. One continuous shot, the camera moving throughout; both shots keep their exact content.",
    cloud: FLF_CLOUD,
    open: FLF_OPEN,
    parity: "Makes the transition between two stills: the first shot and the second.",
  }),
  videoApp({
    name: "Hug",
    category: "Video",
    description: "Two people share a warm hug",
    icon: "Heart",
    hue: 0,
    prompt: "The two people in the image turn to each other and share a warm, heartfelt hug, natural motion",
  }),
  videoApp({
    name: "Bring to Life",
    category: "Video",
    description: "Subtle cinemagraph motion for any photo",
    icon: "Wand",
    hue: 110,
    prompt:
      "Subtle natural motion brings the photo to life: hair and clothes move gently in the breeze, soft blinking and breathing, slight handheld camera drift",
  }),
  videoApp({
    name: "Dance",
    category: "Video",
    description: "Make anyone dance",
    icon: "Music",
    hue: 280,
    options: [
      opt("dance", "Dance", [
        ["Hip hop", "dances energetic hip hop moves"],
        ["Salsa", "dances a lively salsa"],
        ["Robot", "does a funny robot dance"],
        ["Ballet", "performs graceful ballet"],
        ["K-pop", "performs a sharp, synchronized K-pop routine"],
        ["Shuffle", "does a fast shuffle dance"],
      ]),
    ],
    prompt: "The person {option:dance}, full body in frame, smooth natural motion, camera static",
  }),
  videoApp({
    name: "ClipCut",
    category: "Video",
    description: "One selfie → an outfit-change clip",
    icon: "Film",
    hue: 330,
    options: [
      opt("vibe", "Outfits", [
        ["Streetwear", "a series of streetwear outfits"],
        ["Glam", "a series of glamorous evening outfits"],
        ["Seasons", "outfits for summer, autumn, winter and spring"],
        ["Decades", "outfits from the 70s, 80s, 90s and 2000s"],
      ]),
    ],
    prompt:
      "Fashion reel: the person strikes a pose facing the camera, and on every beat their outfit snaps instantly into the next one — {option:vibe} — with a quick flash between each change while their face, hair and pose stay continuous. Energetic, music-video pacing.",
    parity: "Makes one continuous clip from your selfie. Add music with Video to audio.",
  }),
  videoApp({
    name: "Urban Cuts",
    category: "Video",
    description: "Outfit changes in the city, in one clip",
    icon: "Building2",
    hue: 200,
    userPrompt: "optional",
    placeholder: "Describe the outfit to switch into (optional)",
    prompt:
      "Urban fashion edit: the person walks toward the camera down a city street at night, spins on the beat and instantly reappears in a new outfit {prompt}, keeping their face and stride; neon reflections, handheld music-video energy.",
    parity: "Makes one continuous clip from your photo. Add music with Video to audio.",
  }),
  videoApp({
    name: "Sticker Match Cut",
    category: "Video",
    description: "Sparkling sticker match-cut animation",
    icon: "StickyNote",
    hue: 60,
    prompt:
      "The subject peels off the scene as a glossy die-cut sticker with a white border, flips toward the camera with sparkles, and slaps back down into a new matching pose in the same frame. Playful stop-motion sticker animation with glitter bursts.",
    parity: "Animates your photo into the match cut.",
  }),
  // ---------------- Fun: games, characters & trending templates
  app({
    name: "Game Dump",
    category: "Fun",
    description: "You in iconic video-game styles",
    icon: "Gamepad2",
    hue: 260,
    options: [
      opt("game", "Game style", [
        ["Open world", "a gritty open-world crime game loading-screen illustration"],
        ["Fortnite-style", "a colorful cartoony battle-royale game character render"],
        ["Minecraft-style", "a blocky voxel sandbox game character"],
        ["Sims-style", "a life-simulation game character with a green plumbob above the head"],
        ["Zelda-style", "a cel-shaded fantasy adventure game hero"],
        ["Pokémon trainer", "a pixel-art monster-catching game trainer sprite"],
        ["Street Fighter-style", "a 2D arcade fighting game character select portrait"],
        ["Final Fantasy-style", "a polished JRPG character render with dramatic hair and armor"],
        ["Animal Crossing-style", "a cute island-life game villager"],
        ["Retro 8-bit", "an 8-bit NES-era sprite"],
        ["Souls-like", "a dark fantasy souls-like armored knight"],
        ["Racing game", "a racing game driver on a podium"],
      ]),
    ],
    prompt:
      "Reimagine the person from the image as {option:game}, faithful to that game's art style, UI and lighting. Keep their face, hairstyle and outfit colors recognizable.",
    parity: "Makes the game style you pick, one per run.",
  }),
  videoApp({
    name: "Nano Strike",
    category: "Fun",
    description: "Tactical-shooter squad cinematic",
    icon: "Crosshair",
    hue: 100,
    inputs: [{ key: "image", label: "Squad photo", hint: "One photo of you or your group", accept: "image", required: true }],
    prompt:
      "Tactical shooter game cinematic: the people from the image, now in matching tactical gear and helmets, move in formation through a dusty compound with rifles raised, dust and light shafts, then turn to the camera in a heroic squad pose. Game-engine graphics with a HUD overlay.",
    parity: `${TWO_STEP} Put the whole squad in that one photo.`,
  }),
  videoApp({
    name: "Nano Theft",
    category: "Fun",
    description: "You as an open-world game character",
    icon: "CarFront",
    hue: 40,
    prompt:
      "The person from the image becomes a character in an open-world crime video game: third-person gameplay camera follows them as they run across a sunny city street, jump into a sports car and drive off, with game HUD, minimap and stylized game graphics.",
    parity: TWO_STEP,
  }),
  videoApp({
    name: "GTAI",
    category: "Fun",
    description: "Classic open-world game gameplay starring you",
    icon: "Car",
    hue: 50,
    prompt:
      "The person from the image is reimagined as a character in a classic open-world action game: in-game graphics, they walk confidently down a palm-lined street, pull a stylish move and the camera swings behind them as a loading-screen style title card flashes. Saturated sunset colors, game HUD.",
    parity: TWO_STEP,
  }),
  videoApp({
    name: "Simlife",
    category: "Fun",
    description: "Life-sim character creator starring you",
    icon: "House",
    hue: 130,
    prompt:
      "Life-simulation game character creator screen: the person from the image appears as a 3D game avatar with a green diamond floating above their head, rotating on a pedestal while outfits change with a soft chime, then they wave at the camera.",
    parity: TWO_STEP,
  }),
  videoApp({
    name: "3D Render",
    category: "Fun",
    description: "You as a polished 3D-animated character",
    icon: "Box",
    hue: 210,
    prompt:
      "The person from the image transforms into a high-quality 3D animated film character with stylized proportions, polished skin shading and soft studio lighting; they turn toward the camera and smile as the camera slowly orbits. Keep their face, hair and outfit recognizable.",
    parity: TWO_STEP,
  }),
  videoApp({
    name: "3D Figure",
    category: "Fun",
    description: "You as a collectible figurine, with box",
    icon: "PersonStanding",
    hue: 35,
    prompt:
      "The camera glides across a desk to reveal a detailed collectible figurine of the person from the image on a clear acrylic base, next to its colorful retail box with their artwork; the figurine slowly rotates under soft light. Realistic plastic paint details.",
    parity: `${TWO_STEP} For a still, use Figurine.`,
  }),
  videoApp({
    name: "Pixel Game",
    category: "Fun",
    description: "You as an 8-bit hero in a retro game",
    icon: "Joystick",
    hue: 110,
    prompt:
      "The person from the image becomes an 8-bit pixel-art game character running and jumping through a side-scrolling retro platformer world, collecting coins and stomping an enemy, with chiptune-era pixel graphics, score counter and parallax pixel background.",
    parity: TWO_STEP,
  }),
  videoApp({
    name: "Brick Cube",
    category: "Fun",
    description: "You as a toy brick figure",
    icon: "Blocks",
    hue: 0,
    prompt:
      "The person from the image is rebuilt as a glossy plastic toy brick minifigure in a brick-built mini world; it waves and walks a few steps with stop-motion toy animation, studs and plastic reflections visible. Keep their hair and outfit colors.",
    parity: TWO_STEP,
  }),
  app({
    name: "Meme Generator",
    category: "Fun",
    description: "Turn any photo into a captioned meme",
    icon: "Laugh",
    hue: 55,
    userPrompt: "required",
    placeholder: 'Caption, e.g. "me pretending to work when the boss walks by"',
    prompt:
      'Turn the image into a funny meme: exaggerate the subject\'s expression for comedic effect and add the caption "{prompt}" in bold white Impact-style text with a black outline at the top and bottom. Keep the subject recognizable.',
    parity: "Makes the meme from your photo and the caption you write.",
  }),
  app({
    name: "Micro-Beasts",
    category: "Fun",
    description: "Surround yourself with tiny cute animals",
    icon: "PawPrint",
    hue: 80,
    options: [
      opt("animal", "Animal", [
        ["Kittens", "dozens of tiny fluffy kittens"],
        ["Puppies", "dozens of tiny puppies"],
        ["Bunnies", "dozens of tiny bunnies"],
        ["Ducklings", "dozens of tiny yellow ducklings"],
        ["Hamsters", "dozens of tiny hamsters"],
        ["Penguins", "dozens of tiny penguins"],
      ]),
    ],
    prompt:
      "Surround the person in the image with {option:animal}, palm-sized, climbing on their shoulders, sitting on their head and gathered at their feet, all looking adorable. Keep the person's face, pose, outfit, lighting and background unchanged.",
  }),
  app({
    name: "Signboard",
    category: "Fun",
    description: "Your photo as a giant urban mural",
    icon: "Signpost",
    hue: 25,
    prompt:
      "Show the image painted as a huge mural on the side of a city building, with realistic brick texture showing through the paint, weathering, scaffolding nearby and pedestrians on the street below for scale. Photorealistic street photography.",
  }),
  app({
    name: "Paint App",
    category: "Fun",
    description: "Your photo inside a retro 90s paint program",
    icon: "Monitor",
    hue: 180,
    prompt:
      "Show the image as if it were being drawn in a 1990s desktop paint program on a bulky beige CRT monitor: chunky toolbar, color palette at the bottom, gray window chrome, slightly pixelated low-color version of the image on the canvas, screen glare and scanlines. Photo of the monitor on a desk.",
  }),
  app({
    name: "Japanese Show",
    category: "Fun",
    description: "You as a guest on a retro Japanese TV variety show",
    icon: "Tv",
    hue: 345,
    prompt:
      "Place the person from the image as the special guest on a colorful 1990s Japanese TV variety show: bright studio set, cheering panelists, giant colorful on-screen captions and emoji-style graphics around them, slightly soft VHS broadcast look. Keep their face and outfit.",
  }),
  videoApp({
    name: "Social Media Icon",
    category: "Fun",
    description: "Your photo framed by animated social icons",
    icon: "ThumbsUp",
    hue: 330,
    prompt:
      "The subject smiles at the camera while glossy 3D social media icons — hearts, likes, play buttons, chat bubbles and follower counters — pop in and float around them, spinning gently with soft shadows. Bright, clean, eye-catching creator intro.",
  }),
  videoApp({
    name: "This Is Fine",
    category: "Fun",
    description: "You in the iconic burning-room meme",
    icon: "Coffee",
    hue: 20,
    prompt:
      "The person from the image sits calmly at a small table holding a coffee mug in a room that is slowly filling with flames and smoke; they sip, smile and nod reassuringly at the camera as everything burns around them. Deadpan comedy.",
  }),
  videoApp({
    id: "app-skibidi",
    name: "Idol Stage",
    category: "Fun",
    description: "Your own K-pop concert moment",
    icon: "Bath",
    hue: 190,
    prompt:
      "Absurd meme video: the person's head pops out of a white toilet bowl in a public bathroom, bobbing and singing with exaggerated expressions while the camera zooms in and out to the beat. Silly, chaotic internet-meme energy.",
  }),
  videoApp({
    name: "Mukbang",
    category: "Fun",
    description: "Your own viral eating show",
    icon: "UtensilsCrossed",
    hue: 30,
    prompt:
      "Mukbang livestream: the person sits at a table piled with noodles, fried chicken and colorful dishes in front of a ring light and microphone, takes big enthusiastic bites, reacts with delight and gives a thumbs up to the camera.",
  }),
  videoApp({
    name: "Cloud Surf",
    category: "Fun",
    description: "Surf dreamy pink clouds",
    icon: "Cloud",
    hue: 330,
    prompt:
      "The person from the image surfs on a board across a sea of fluffy pastel-pink clouds at sunset, carving gracefully with arms out, hair blowing, soft dreamy light and glowing sky. The camera tracks alongside them.",
  }),
  videoApp({
    name: "Idol",
    category: "Fun",
    description: "Become a K-pop idol on stage",
    icon: "MicVocal",
    hue: 300,
    prompt:
      "The person becomes a K-pop idol performing on a dazzling concert stage in a sparkling stage outfit: sharp choreography, a confident wink to the camera, colorful light beams, confetti and a cheering crowd with lightsticks.",
  }),
  videoApp({
    id: "app-yes-kiss",
    name: "Mugshot",
    category: "Fun",
    description: "A playful police booking shot",
    icon: "HeartHandshake",
    hue: 350,
    prompt:
      "Comedic meme scene: someone leans in and plants a quick playful kiss on the person's cheek; the person freezes in surprise, then breaks into a huge grin and pumps a fist yelling yes. Lighthearted, wholesome, exaggerated reactions.",
  }),
  videoApp({
    name: "Latex",
    category: "Fun",
    description: "Glossy black latex high-fashion editorial",
    icon: "Droplet",
    hue: 270,
    prompt:
      "High-fashion editorial: the person's outfit transforms into a sleek, glossy black latex look with mirror-like reflections; they pose powerfully against a dark studio backdrop while hard strobe light glints across the shiny surface.",
  }),
  videoApp({
    name: "J-Magazine",
    category: "Fun",
    description: "You on a Japanese fashion magazine cover",
    icon: "BookOpen",
    hue: 0,
    prompt:
      "The person poses for a Japanese street-fashion magazine cover: bold Japanese headline typography, issue number and cover lines animate onto the frame around them as they shift between stylish poses, bright editorial flash photography.",
  }),
  videoApp({
    name: "Roller Coaster",
    category: "Fun",
    description: "Ride a wild roller coaster",
    icon: "FerrisWheel",
    hue: 15,
    prompt:
      "The person sits in the front row of a roller coaster as it crests the top and plunges down a steep drop; their hair whips back, they scream with joy and throw their arms up while the theme park rushes past. Front-facing on-ride camera.",
  }),
  videoApp({
    name: "60s Cafe",
    category: "Fun",
    description: "A vintage 1960s coffee-shop scene",
    icon: "CupSoda",
    hue: 40,
    prompt:
      "The person sits in a 1960s American diner-style café with checkered floor, chrome stools and a jukebox; they sip a milkshake and laugh, warm Technicolor film look with soft grain and gentle camera dolly.",
  }),
  videoApp({
    name: "Victory Card",
    category: "Fun",
    description: "A winner-style celebration card",
    icon: "Trophy",
    hue: 50,
    prompt:
      "Champion celebration: golden confetti bursts as the person raises a shining trophy overhead; a bold winner card frame with metallic gold graphics and light rays animates around them, like a game's victory screen.",
  }),
  videoApp({
    name: "Sand Worm",
    category: "Fun",
    description: "A colossal sand creature rises behind you",
    icon: "Worm",
    hue: 35,
    prompt:
      "Epic desert scene: the person stands on a dune in flowing robes as the ground trembles; behind them a colossal sandworm bursts out of the sand, its gaping circular maw rising into the sky with cascades of sand, while the person turns to look. Cinematic wide shot.",
  }),
  videoApp({
    name: "J-Poster",
    category: "Fun",
    description: "A Japanese-style poster with bold typography",
    icon: "Newspaper",
    hue: 355,
    prompt:
      "The person becomes the star of a Japanese movie poster: bold vertical Japanese typography, anime-inspired graphic shapes and a red sun circle animate in around them while they hold a dramatic pose, printed paper texture.",
  }),
  videoApp({
    name: "Mascot",
    category: "Fun",
    description: "Turn yourself into a brand mascot",
    icon: "SmilePlus",
    hue: 90,
    prompt:
      "The person transforms into a cheerful, chunky brand mascot costume version of themselves with an oversized cartoon head that keeps their features; the mascot waves, gives a thumbs up and does a little dance in a bright plaza.",
  }),
  videoApp({
    name: "Storm Creature",
    category: "Fun",
    description: "A looming monster in a dark storm behind you",
    icon: "CloudLightning",
    hue: 240,
    prompt:
      "Dark cinematic storm: rain lashes the person as they stand facing the camera; lightning flashes and reveals a gigantic shadowy creature looming in the clouds behind them, its eyes glowing, as thunder shakes the frame.",
  }),
  videoApp({
    name: "Burning Sunset",
    category: "Fun",
    description: "An epic fire-lit sunset sky",
    icon: "Sunset",
    hue: 20,
    prompt:
      "The sky behind the person ignites into an epic burning sunset of orange, crimson and gold with glowing clouds; warm rim light wraps around them as the camera slowly pushes in and embers drift through the air.",
  }),
  videoApp({
    name: "Comic Book",
    category: "Fun",
    description: "You in an animated comic panel",
    icon: "Zap",
    hue: 50,
    prompt:
      "The scene turns into a comic book panel with bold ink lines, halftone dots and flat colors; the person strikes an action pose as speech bubbles and onomatopoeia like POW appear, and the panel border snaps into place.",
  }),
  videoApp({
    name: "Melting Doodle",
    category: "Fun",
    description: "Dissolve into a trippy doodle drip",
    icon: "Pencil",
    hue: 280,
    prompt:
      "The photo slowly turns into a hand-drawn marker doodle, then the lines and colors start melting and dripping down the frame in hypnotic psychedelic streams while the subject's outline wobbles.",
  }),
  videoApp({
    name: "Giallo Horror",
    category: "Fun",
    description: "A 70s Italian horror movie scene",
    icon: "Skull",
    hue: 0,
    prompt:
      "1970s Italian giallo horror scene: saturated red and green lighting, the person slowly turns toward the camera in suspense as a black-gloved hand and a shadow appear in the foreground; dramatic zoom, film grain and vintage lens flares.",
  }),
  videoApp({
    name: "Renaissance",
    category: "Fun",
    description: "You as a living Renaissance painting",
    icon: "Frame",
    hue: 35,
    prompt:
      "The scene becomes a classical Renaissance oil painting with rich glazes, cracked varnish and chiaroscuro light; the person, dressed in period clothing, subtly moves, blinks and turns their head as if the painting came to life.",
  }),
  videoApp({
    name: "Rap God",
    category: "Fun",
    description: "An epic rap performance scene",
    icon: "Mic",
    hue: 280,
    prompt:
      "The person performs a hard-hitting rap verse in a recording studio and music-video set: gold chains, bold gestures to the beat, low-angle camera, smoke, colored lights and flashing strobes.",
    parity: NO_AUDIO,
  }),
  videoApp({
    name: "3D Rotation",
    category: "Fun",
    description: "Your photo as a rotating 3D model",
    icon: "Axis3d",
    hue: 200,
    prompt:
      "The subject becomes a solid 3D object on a clean background and rotates a smooth 360 degrees in place like a model in a 3D viewer, revealing consistent sides and back, soft studio lighting.",
  }),
  videoApp({
    name: "Ghoulgao",
    category: "Fun",
    description: "Turn your photo into a horror nightmare",
    icon: "Ghost",
    hue: 120,
    prompt:
      "The atmosphere turns sinister: lights flicker, the person's skin pales and their eyes turn milky as ghoulish shadows creep across the walls; their face distorts into a terrifying ghoul and they lunge toward the camera. Horror film look.",
  }),
  videoApp({
    name: "Mugshot",
    category: "Fun",
    description: "A police booking-scene video",
    icon: "Fingerprint",
    hue: 220,
    prompt:
      "Police booking scene: the person stands against a height chart wall holding a placard with a booking number; a camera flash fires, they turn to the side for the profile shot, then back to the front with a smirk. Gritty fluorescent lighting.",
  }),
  videoApp({
    id: "app-banana-eating",
    name: "Still Life Snack",
    category: "Fun",
    description: "A calm, minimalist banana moment",
    icon: "Banana",
    hue: 55,
    prompt:
      "Minimalist calm scene on a plain pastel background: the person peels a banana slowly and takes a bite, chewing contentedly with a serene smile. Soft even light, gentle and humorous.",
  }),
  // ---------------- Utility
  app({
    name: "Remove Background",
    category: "Utility",
    description: "Transparent cut-out in one click",
    icon: "Eraser",
    hue: 180,
    prompt: "Remove the background",
    cloud: BG_CLOUD,
    open: BG_OPEN,
  }),
  app({
    name: "Video Background Remover",
    category: "Utility",
    description: "Cut the subject out of a whole video",
    icon: "SquareDashed",
    hue: 175,
    inputs: [{ key: "video", label: "Video", hint: "The clip to cut out, every frame", accept: "video", required: true }],
    prompt: "Remove the background",
    cloud: { modelId: "birefnet-video", op: "bg-remove-video" },
    open: { modelId: "oss-video-matte-birefnet", op: "bg-remove-video" },
    parity: "Cuts the subject out of every frame into a transparent video. To keep only one object, use Remove background in Video tools.",
  }),
  // Clean up voice (NVIDIA RE-USE): an app that is the Audio tool itself (src/components/audio-tools/clean-voice-tool.tsx).
  app({
    id: "app-clean-up-voice",
    name: "Clean up voice",
    category: "Utility",
    description: "Remove noise, echo and room sound from any voice",
    icon: "AudioLines",
    hue: 195,
    badges: ["new"],
    tool: "clean-voice",
    inputs: [{ key: "audio", label: "Recording", hint: "Speech in any language, or a video with sound", accept: "audio", required: true }],
    prompt: "Clean up the voice",
    cloud: null,
    open: { modelId: "oss-reuse-voice", op: "enhance-voice" },
    parity: "Runs on open-source models only, on your GPU or CPU. RE-USE isn't hosted on fal or Replicate.",
  }),
  app({
    name: "Object Remover",
    category: "Utility",
    description: "Erase anything you describe",
    icon: "Eraser",
    hue: 0,
    userPrompt: "required",
    placeholder: "What should disappear? e.g. the people in the background",
    prompt: "Remove {prompt} from the image and fill the area naturally. Keep everything else exactly the same.",
  }),
  app({
    name: "Change Background",
    category: "Utility",
    description: "Put the subject somewhere new",
    icon: "Image",
    hue: 220,
    userPrompt: "required",
    placeholder: "New background, e.g. a rooftop in Tokyo at night",
    prompt:
      "Replace the background with {prompt}. Keep the subject, their pose and edges exactly, and match the lighting to the new environment.",
  }),
  app({
    name: "Upscale",
    category: "Utility",
    description: "Sharper, larger images",
    icon: "Maximize2",
    hue: 250,
    prompt: "Upscale",
    cloud: UPSCALE_CLOUD,
    open: UPSCALE_OPEN,
  }),
  app({
    name: "Vectorize",
    category: "Utility",
    description: "Turn a logo, icon or illustration into a clean SVG",
    icon: "PenTool",
    hue: 300,
    inputs: [{ key: "image", label: "Image", hint: "A logo, icon or flat illustration works best", accept: "image", required: true }],
    userPrompt: "none",
    prompt: "Vectorize",
    cloud: { modelId: "recraft-vectorize", op: "vectorize" },
    open: { modelId: "oss-vtracer", op: "vectorize" },
    parity: "Sharpest on logos, icons and flat art.",
  }),
  app({
    name: "Text Edit",
    category: "Utility",
    description: "Change any text in an image",
    icon: "Type",
    hue: 270,
    userPrompt: "required",
    placeholder: 'e.g. change the sign to say "OPEN 24/7"',
    prompt: "{prompt}. Match the original font, perspective, color and texture exactly, change nothing else.",
  }),
  app({
    name: "Breakdown",
    category: "Utility",
    description: "Split an image into labeled components",
    icon: "Boxes",
    hue: 210,
    prompt:
      "Create an exploded knolling layout of everything in the image: each object, garment and accessory separated and neatly arranged on a clean light background, each with a small label naming it. Keep every item's exact design, colors and logos.",
    parity: "Makes one image of your picture's parts, each one labeled.",
  }),
  // Higgsfield's Virality Predictor (a brain-response model) is the /virality page: a labelled heuristic hook
  // analysis. This app is the "make a stronger opening frame" step it links to.
  app({
    name: "Hook Frame",
    category: "Utility",
    description: "Turn your opening frame into a stronger hook",
    icon: "TrendingUp",
    hue: 95,
    inputs: [{ key: "image", label: "Opening frame", hint: "The first frame of your video", accept: "image", required: true }],
    prompt:
      "Rework this opening frame into a scroll-stopping hook thumbnail: stronger contrast and color, clearer focal point on the face or product, a more expressive moment and bold composition. Keep the same people, product and setting in a clean, purely photographic frame.",
  }),
  app({
    // Named for what it does: it takes out logos and recognizable IP (Fuobe has no detector to score similarity).
    id: "app-similarity-score",
    name: "IP Cleanup",
    category: "Utility",
    description: "Clean up logos and recognizable IP before posting",
    icon: "ShieldCheck",
    hue: 160,
    prompt:
      "Make this image safe to publish: replace every visible brand logo, trademark, copyrighted character and recognizable branded design with generic, unbranded equivalents of the same shape and color. Keep everything else — people, composition, lighting — exactly the same.",
    // The reference scores IP similarity with a detector; Fuobe has none, so this app removes likely IP instead.
    parity: "Finds logos and recognizable characters and replaces them with unbranded ones of the same shape and color.",
  }),
];
