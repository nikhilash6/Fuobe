/**
 * The navigation's one model: every place the top bar, the Studios launcher, the phone tabs and sheets, the search
 * palette, Home's goal row and the next steps under a result link to. Pure data and helpers (no React, no icons as
 * components, no catalog), so the server and the browser share it: icons are names (src/lib/nav-icons.ts maps them),
 * covers are preset ids (src/lib/nav-covers.ts resolves them on the server). Every href is a route that exists; none
 * is renamed here.
 */
import { HUB_MODES, modeHref, type HubKind } from "./hubs";
import { navActive, NEW_CREATION_HREF } from "./nav";

export type ViewerKind = "guest" | "account" | "owner";
export type NavKind = "home" | "action" | "create" | "studio" | "presets" | "tool" | "library" | "settings";
/** Launcher columns, the Studios sheet chips and the palette's "Every studio" chips. */
export type LauncherGroupId = "film" | "social" | "sell" | "people" | "sound" | "finish";
/** The goal row on Home. An entry can serve several goals. */
export type GoalId = "film" | "social" | "sell" | "people" | "edit" | "sound";
/** A key of NAV_ICONS (src/lib/nav-icons.ts), where it is typed as keyof typeof NAV_ICONS. */
export type NavIconName = string;

export interface NavEntry {
  /** Stable slug, unique ("cinema", "audio-clean", "setting-comfyui"). */
  id: string;
  /** An existing route; may carry a query (/library?tab=favorites) or a hash (/settings#comfyui). */
  href: string;
  label: string;
  /** Phone tile label, 12 characters at most. */
  short?: string;
  /** One line, 34 characters at most, sentence case, no full stop. */
  what: string;
  kind: NavKind;
  /** Set: it is in the launcher, the Studios sheet and "Every studio". */
  group?: LauncherGroupId;
  /** The group's lead card (one per group). */
  lead?: true;
  /** Goal bands it can appear in. */
  goals: GoalId[];
  /** Search words: what people type for it that its label doesn't say. */
  keywords: string;
  /** A preset id with a real cover (in PRESET_COVERS). */
  cover?: string;
  icon: NavIconName;
  /** Who sees it anywhere (bar, menus, sheets, search, next steps). Omitted: everyone. */
  visibility?: readonly ViewerKind[];
  /** First in "Every studio" before a search, and among the featured studios. */
  popular?: true;
  /** ISO date: a "New" badge until then. */
  newUntil?: string;
  /** Prefetched as soon as it's on screen: the few routes most visits start from. */
  eager?: true;
  /** A tool's studio id ("audio" for audio-clean): search shows "Audio › Clean up voice". */
  parent?: string;
}

export interface LauncherGroup {
  id: LauncherGroupId;
  label: string;
  chip: string;
}

export interface Goal {
  id: GoalId;
  label: string;
  icon: NavIconName;
  title: string;
  line: string;
  /** "Studios" | "Tools" | "Audio and voice". */
  cardsLabel: string;
  /** 4-5 NavEntry ids (4:3 cover cards). */
  cards: string[];
  tapLabel: string;
  /** 2-4 listed presets. */
  taps: { preset: string; kind: "App" | "Camera motion" | "Effect" }[];
  /** "Finish" | "Picture tools". */
  finishLabel: string;
  /** 2-3 NavEntry ids (text links). */
  finish: string[];
  /** Show "Plan it with Assist" (to the owner only). */
  assist?: true;
}

const OWNER: readonly ViewerKind[] = ["owner"];
const ACCOUNT: readonly ViewerKind[] = ["account"];
const GUEST: readonly ViewerKind[] = ["guest"];
const VISITORS: readonly ViewerKind[] = ["guest", "account"];

/** Where the source lives (as connections.ts says it; kept here so this module imports nothing heavy). */
const REPO = "https://github.com/workingprototype/fuobe";
/** A "do this" entry that isn't a page: the palette toggles the theme. */
export const THEME_ACTION = "action:theme";

/**
 * "New" badges: a studio added after the first ones shows one for 30 days from the day its page was added (its
 * route's first commit). The first studios (the first week) never do.
 */
const newFor30Days = (added: string) => new Date(Date.parse(added) + 30 * 86_400_000).toISOString().slice(0, 10);

/** Top level, create, presets, library and settings pages. */
const PAGES: NavEntry[] = [
  { id: "home", href: "/", label: "Home", what: "Start from words or a picture", kind: "home", goals: [], keywords: "start new creation home", icon: "Home", eager: true },
  { id: "new", href: NEW_CREATION_HREF, label: "New creation", what: "A fresh composer on Home", kind: "action", goals: [], keywords: "new creation start fresh blank compose", icon: "Plus" },
  { id: "assist", href: "/assist", label: "Assist", what: "Plan it with an agent", kind: "create", goals: [], keywords: "agent chat plan assistant ai helper", icon: "MessageCircle", eager: true },
  { id: "image", href: "/image", label: "Image", what: "Text to image", kind: "create", goals: [], keywords: "text to image picture photo generate", cover: "app-poster", icon: "ImageIcon", eager: true, popular: true },
  { id: "video", href: "/video", label: "Video", what: "Text or image to video", kind: "create", goals: ["film"], keywords: "text to video image to video animate clip", cover: "motion-fpv-drone", icon: "Video", eager: true, popular: true },
  { id: "edit", href: "/edit", label: "Edit", what: "Change a picture with words", kind: "create", goals: ["edit"], keywords: "edit image change photo retouch", cover: "app-relight", icon: "Wand2" },
  { id: "live-edit", href: "/live-edit", label: "Live edit", what: "Changes as you type", kind: "create", goals: ["edit"], keywords: "realtime live as you type instant change", icon: "Zap", newUntil: newFor30Days("2026-11-01") },
  { id: "inpaint", href: "/inpaint", label: "Inpaint", what: "Paint over a part", kind: "create", goals: ["edit", "people"], keywords: "mask fill remove brush fix", cover: "app-change-background", icon: "Brush" },
  { id: "layers", href: "/layers", label: "Layers", what: "Split a picture into layers", kind: "create", goals: ["edit"], keywords: "layered psd split cutout", cover: "app-packshot", icon: "Layers2" },
  { id: "color-grade", href: "/color-grade", label: "Color grading", what: "Grade and match colors", kind: "create", goals: ["edit", "film"], keywords: "grade lut colour color", cover: "app-color-grading", icon: "SlidersHorizontal" },
  { id: "canvas", href: "/canvas", label: "Canvas", what: "Wire models together", kind: "create", goals: [], keywords: "nodes flow workflow graph", icon: "Network" },
  { id: "motions", href: "/motions", label: "Camera motions", what: "Crane and drone moves for any shot", kind: "presets", goals: ["film"], keywords: "camera moves presets dolly crane drone orbit", cover: "motion-crane-up", icon: "Film" },
  { id: "effects", href: "/effects", label: "Effects", what: "Visual effects for any clip", kind: "presets", goals: ["film", "social"], keywords: "vfx presets visual effects", cover: "effect-nature-bloom", icon: "Sparkles" },
  { id: "library", href: "/library", label: "All creations", what: "Everything you have made", kind: "library", goals: [], keywords: "library history results creations", icon: "Library", eager: true },
  { id: "favorites", href: "/library?tab=favorites", label: "Favorites", what: "The ones you starred", kind: "library", goals: [], keywords: "starred liked", icon: "Star" },
  { id: "settings", href: "/settings", label: "Settings", what: "Account, GPU and preferences", kind: "settings", goals: [], keywords: "account gpu preferences", icon: "Settings" },
  { id: "connect", href: "/connect", label: "Connect your GPU", what: "Run on your own ComfyUI, free", kind: "settings", goals: [], keywords: "comfyui gpu own server sign up account open source", icon: "Cpu", visibility: VISITORS },
  {
    id: "models-licences",
    href: "/settings/models",
    label: "Models & licences",
    what: "Switch models on or off",
    kind: "settings",
    goals: [],
    keywords: "licence license commercial non-commercial switch off turn on admin providers node packs allow block",
    icon: "Scale",
    visibility: OWNER,
  },
  {
    id: "thanks",
    href: "/settings/licences",
    label: "Thanks & licences",
    what: "The open models Fuobe is built on",
    kind: "settings",
    goals: [],
    keywords: "about credits thanks licence license open source models loras node packs libraries attribution",
    icon: "Heart",
  },
];

/** The launcher's studios (and Apps), column by column; each column's lead first. */
const STUDIOS: NavEntry[] = [
  // Film & video
  { id: "cinema", href: "/cinema", label: "Cinema Studio", short: "Cinema", what: "Direct shots like a film set", kind: "studio", group: "film", lead: true, goals: ["film"], keywords: "film director shots movie cinematic scene", cover: "motion-arc-left", icon: "Clapperboard", popular: true },
  { id: "storyboard", href: "/storyboard", label: "Storyboard", short: "Storyboard", what: "Plan a film frame by frame", kind: "studio", group: "film", goals: ["film"], keywords: "frames story plan shots", cover: "app-shots", icon: "GalleryHorizontal" },
  { id: "motion-control", href: "/motion-control", label: "Motion control", short: "Motion", what: "Copy any dance or pose", kind: "studio", group: "film", goals: ["film", "people"], keywords: "pose dance transfer choreography", cover: "motion-static", icon: "PersonStanding" },
  { id: "extend", href: "/extend", label: "Extend video", short: "Extend", what: "Make a clip longer", kind: "studio", group: "film", goals: ["film", "edit"], keywords: "longer continue lengthen", cover: "motion-aerial-pullback", icon: "FastForward" },
  { id: "reframe", href: "/reframe", label: "Reframe", short: "Reframe", what: "Any shape, vertical first", kind: "studio", group: "film", goals: ["film", "social", "edit"], keywords: "aspect ratio outpaint vertical crop resize", cover: "app-expand-image", icon: "Crop" },
  { id: "video-edit", href: "/video-edit", label: "Edit video", short: "Edit video", what: "Restyle a clip with words", kind: "studio", group: "film", goals: ["film", "edit"], keywords: "video edit restyle change clip", cover: "effect-outfit-switch", icon: "Scissors" },
  { id: "katana", href: "/katana", label: "Katana", short: "Katana", what: "Cut clips into a story", kind: "studio", group: "film", goals: ["film"], keywords: "cut edit clips timeline montage", cover: "app-clipcut", icon: "Swords" },
  {
    id: "video-tools",
    href: "/video-tools",
    label: "Video tools",
    short: "Video tools",
    what: "Trim, matte, depth, captions",
    kind: "studio",
    group: "film",
    goals: ["film", "edit"],
    keywords: "join trim matte depth captions evolution remove object restore colourise colorize archive old footage black and white",
    cover: "app-video-background-remover",
    icon: "Layers",
  },
  // Social & shorts
  { id: "shorts", href: "/shorts", label: "Shorts Studio", short: "Shorts", what: "Vertical reels ready to post", kind: "studio", group: "social", lead: true, goals: ["social"], keywords: "vertical reels tiktok short instagram", cover: "motion-catwalk", icon: "Smartphone", popular: true },
  { id: "faceless", href: "/faceless", label: "Faceless Studio", short: "Faceless", what: "A channel without a face", kind: "studio", group: "social", goals: ["social"], keywords: "youtube channel episodes faceless", cover: "motion-hyperlapse", icon: "Tv" },
  { id: "content-factory", href: "/content-factory", label: "Content Factory", short: "Content", what: "A series from one brief", kind: "studio", group: "social", goals: ["social", "sell"], keywords: "series reference brief episodes batch", cover: "app-transitions", icon: "Factory", newUntil: newFor30Days("2026-10-24") },
  { id: "lipsync", href: "/lipsync", label: "Lipsync & avatars", short: "Lipsync", what: "A photo that talks", kind: "studio", group: "social", goals: ["social", "sound", "people"], keywords: "talking avatar lip sync speak presenter", cover: "app-talking-photo", icon: "Mic2", popular: true },
  { id: "explainer", href: "/explainer", label: "Explainer", short: "Explainer", what: "Slides into a video", kind: "studio", group: "social", goals: ["social"], keywords: "slides pdf video presentation tutorial", cover: "app-breakdown", icon: "Presentation" },
  { id: "virality", href: "/virality", label: "Hook check", short: "Hook check", what: "Score your first 3 seconds", kind: "studio", group: "social", goals: ["social"], keywords: "virality predictor hook score retention", cover: "app-hook-frame", icon: "TrendingUp" },
  // Sell & advertise
  { id: "marketing", href: "/marketing", label: "Marketing Studio", short: "Marketing", what: "UGC and product films", kind: "studio", group: "sell", lead: true, goals: ["sell"], keywords: "ugc product ads commercial brand", cover: "app-macroshot-product", icon: "Megaphone", popular: true },
  { id: "ads", href: "/ads", label: "Ads Studio", short: "Ads", what: "Campaigns in every size", kind: "studio", group: "sell", goals: ["sell"], keywords: "brand campaign advert banner sizes", cover: "app-billboard-ad", icon: "Target" },
  { id: "mixed-media", href: "/mixed-media", label: "Mixed Media", short: "Mixed Media", what: "Collage, paint and photo", kind: "studio", group: "sell", goals: ["sell", "film"], keywords: "collage paint scrapbook", cover: "effect-magazine", icon: "Shapes" },
  { id: "moodboards", href: "/moodboards", label: "Moodboards", short: "Moodboards", what: "Lock a look, reuse it", kind: "studio", group: "sell", goals: ["sell", "people"], keywords: "style references mood look", cover: "app-steal-the-look", icon: "Images" },
  { id: "photodump", href: "/photodump", label: "Photodump", short: "Photodump", what: "A photo pack of one person", kind: "studio", group: "sell", goals: ["sell", "people", "social"], keywords: "photo pack character photoshoot", cover: "app-headshot-generator", icon: "Camera" },
  // People & fashion
  { id: "fashion-factory", href: "/fashion-factory", label: "Fashion Factory", short: "Fashion", what: "Outfits, try-ons, lookbooks", kind: "studio", group: "people", lead: true, goals: ["people", "sell"], keywords: "outfits try-on lookbook dress clothes fashion", cover: "app-outfit-swap", icon: "Shirt", popular: true },
  { id: "influencer", href: "/influencer", label: "AI Influencer", short: "Influencer", what: "Build a character", kind: "studio", group: "people", goals: ["people", "social"], keywords: "character builder avatar creature shuffle", cover: "app-ai-influencer", icon: "UserRoundPen", newUntil: newFor30Days("2026-10-24") },
  { id: "character-sheet", href: "/character-sheet", label: "Character Sheet", short: "Character sheet", what: "One face, every angle", kind: "studio", group: "people", goals: ["people"], keywords: "turnaround angles consistent", cover: "app-fuobe-angles", icon: "UserRoundCog" },
  {
    id: "character-swap",
    href: "/character-swap",
    label: "Character Swap",
    short: "Character swap",
    what: "Swap the star of a clip",
    kind: "studio",
    group: "people",
    goals: ["people", "edit", "film"],
    keywords: "h3 akatz swap character whole clip shots segments takes",
    cover: "app-character-swap",
    icon: "Drama",
    newUntil: newFor30Days("2026-10-27"),
  },
  { id: "genjutsu", href: "/genjutsu", label: "Genjutsu", short: "Genjutsu", what: "Insert or swap anyone", kind: "studio", group: "people", goals: ["people", "edit"], keywords: "swap insert character motion transfer", cover: "effect-turning-metal", icon: "WandSparkles", newUntil: newFor30Days("2026-10-23") },
  { id: "elements", href: "/elements", label: "Elements", short: "Elements", what: "Your people, places, props", kind: "studio", group: "people", goals: ["people", "film"], keywords: "characters places props", cover: "app-figurine", icon: "AtSign" },
  // Sound (the Audio studio leads; its main modes follow it, from HUB_TOOLS)
  {
    id: "audio",
    href: "/audio",
    label: "Audio",
    short: "Audio",
    what: "Voice, music and dubbing",
    kind: "studio",
    group: "sound",
    lead: true,
    goals: ["sound"],
    keywords: "voice voiceover tts text to speech narration music sfx dub transcribe sound",
    cover: "app-asmr-host",
    icon: "AudioLines",
  },
  // Finish & convert
  { id: "upscale", href: "/upscale", label: "Upscale", short: "Upscale", what: "Sharper images and video", kind: "studio", group: "finish", lead: true, goals: ["edit"], keywords: "enhance resolution 4k sharpen", cover: "app-upscale", icon: "ZoomIn" },
  { id: "image-to-3d", href: "/image-to-3d", label: "Image to 3D", short: "Image to 3D", what: "A model you can turn", kind: "studio", group: "finish", goals: ["edit", "sell"], keywords: "3d mesh glb model", cover: "app-3d-rotation", icon: "Box" },
  { id: "apps", href: "/apps", label: "Apps", short: "Apps", what: "One-tap photo and clip tools", kind: "presets", group: "finish", goals: ["social", "sell", "people"], keywords: "one-click tools one tap", cover: "app-3d-figure", icon: "LayoutGrid" },
];

/** What each hub mode does, and the words people type for it. */
const TOOL_COPY: Record<string, { what: string; keywords: string; cover?: string; label?: string; short?: string }> = {
  "upscale-image": { what: "Sharper, larger pictures", keywords: "photo picture enhance 4k 8k sharpen resolution" },
  "upscale-video": { what: "Sharper, larger clips", keywords: "4k 8k enhance clip restore faces resolution" },
  "upscale-fps": { what: "Smoother motion", keywords: "frame interpolation 60fps 120fps slow motion slowmo" },
  "upscale-hdr": { what: "10-bit HDR from any clip", keywords: "sdr hdr hdr10 exr prores 10 bit" },
  "upscale-export": { what: "ProRes and lossless files", keywords: "export prores h265 ffv1 exr codec deliver master" },
  "audio-speech": { what: "Text to speech in any voice", keywords: "tts voiceover narration read aloud clone voice" },
  "audio-dialogue": { what: "A conversation, one voice each", keywords: "conversation podcast two speakers multi voice" },
  "audio-voice-change": { what: "Swap the voice, keep the timing", keywords: "voice changer convert speech to speech" },
  "audio-design": { what: "A new voice from a few words", keywords: "voice design create custom new voice describe" },
  "audio-translate": { what: "Your video in another language", keywords: "dub dubbing localize translate lip sync", cover: "app-asmr-promo", label: "Translate & dub", short: "Translate" },
  "audio-transcribe": { what: "Words from any clip", keywords: "subtitles text speech to text srt vtt captions" },
  "audio-clean": { what: "Remove noise and echo", keywords: "denoise podcast mic fix reverb enhance speech", cover: "app-clean-up-voice", short: "Clean up" },
  "audio-split": { what: "Voice and music apart", keywords: "stems karaoke separate vocals instrumental" },
  "audio-sfx": { what: "Sound effects from words", keywords: "sfx foley whoosh sound effect", cover: "app-asmr-add-on", short: "Sound effects" },
  "audio-music": { what: "A track from a few words", keywords: "song soundtrack beat jingle background music score", cover: "effect-live-concert", short: "Music" },
  "audio-song": { what: "Extend, remix or split a song", keywords: "song extend remix stems lyrics longer vocals mureka" },
  "audio-loop": { what: "Loop or lengthen a track", keywords: "loop extend longer repeat" },
  "audio-join": { what: "Join sounds into one", keywords: "merge combine concatenate audio" },
  "audio-video": { what: "Sound that fits the picture", keywords: "foley sfx v2a video to audio", cover: "app-asmr-classic" },
  "video-tools-matte": { what: "Cut out the background", keywords: "remove background green screen alpha matte rotoscope" },
  "video-tools-remove-object": { what: "Erase anything from a clip", keywords: "erase clean plate inpaint video object" },
  "video-tools-remove-person": { what: "Take a person out of a clip", keywords: "erase person people remove someone clean plate" },
  "video-tools-remove-dialogue": { what: "Keep the sound, lose the words", keywords: "speech mute voice keep music" },
  "video-tools-evolution": { what: "One shot that morphs over time", keywords: "morph transformation timelapse ageing" },
  "video-tools-restore": { what: "Old footage, sharp and in color", keywords: "colourise colorize archive old footage black and white" },
  "video-tools-relight": { what: "New light on any clip", keywords: "lighting golden hour neon" },
  "video-tools-depth": { what: "A depth map of every frame", keywords: "depth map z pass parallax compositing" },
  "video-tools-captions": { what: "Burned-in captions", keywords: "subtitles srt captions text" },
  "video-tools-trim": { what: "Cut a clip to length", keywords: "cut shorten" },
  "video-tools-join": { what: "Cut clips together", keywords: "merge combine clips" },
  "video-tools-colors": { what: "Match colors to a picture", keywords: "match colors colour palette grade" },
};

const HUB_ORDER: HubKind[] = ["upscale", "audio", "video-tools"];
const HUB_ICON: Record<HubKind, NavIconName> = { upscale: "ZoomIn", audio: "AudioLines", "video-tools": "Layers" };

/**
 * The Sound column: the Audio studio, then its main modes in this order (voice is the studio's first mode, so the lead
 * card stands for it). These modes are in the launcher, the Studios sheet and "Every studio" as well as in search.
 */
const SOUND_COLUMN = ["audio", "audio-music", "audio-sfx", "audio-clean", "audio-translate"];

/** Every hub mode as a tool of its studio (found by search, linked from the goal bands). */
const HUB_TOOLS: NavEntry[] = HUB_ORDER.flatMap((hub) =>
  HUB_MODES[hub].map((m): NavEntry => {
    const id = `${hub}-${m.id}`;
    const copy = TOOL_COPY[id];
    return {
      id,
      href: modeHref(hub, m.id),
      label: copy?.label ?? m.label,
      what: copy?.what ?? m.label,
      kind: "tool",
      goals: [],
      keywords: copy?.keywords ?? "",
      // Its studio's icon: in search a tool shows its studio's cover (or its own), so the bar's code carries no extra icons.
      icon: HUB_ICON[hub],
      parent: hub,
      ...(copy?.cover && { cover: copy.cover }),
      ...(copy?.short && { short: copy.short }),
      ...(SOUND_COLUMN.includes(id) && { group: "sound" as const, goals: ["sound" as const] }),
      ...(m.ownerOnly && { visibility: OWNER }),
    };
  }),
);

/** Pages inside a studio that people look for by name. */
const SUB_TOOLS: NavEntry[] = [
  { id: "marketing-click-to-ad", href: "/marketing/click-to-ad", label: "Click to ad", what: "From a product link to an ad", kind: "tool", goals: [], keywords: "product link url to ad shop page amazon", icon: "Megaphone", parent: "marketing" },
  { id: "ads-multiplier", href: "/ads/multiplier", label: "Ad multiplier", what: "One ad in many versions", kind: "tool", goals: [], keywords: "variations versions sizes multiply", icon: "Target", parent: "ads" },
  { id: "assist-skills", href: "/assist/skills", label: "Skills", what: "Reusable recipes", kind: "tool", goals: [], keywords: "skill recipe playbook automation", icon: "MessageCircle", parent: "assist" },
];

/**
 * Settings sections (ids as in settings-form.tsx). The install's own settings are its owner's; an account gets its
 * own GPU, keys and account; a guest the way to connect a GPU. Everyone may read Thanks & licences.
 */
const SETTINGS: NavEntry[] = (
  [
    ["cloud", "API keys", "fal replicate paid cloud connect", "KeyRound"],
    ["comfyui", "ComfyUI server", "open source gpu url connect local", "Server"],
    ["engine", "Engine mode", "open source cloud both", "Cpu"],
    ["loras", "LoRAs", "lora folder civitai key looks motions effects download licence", "Layers"],
    ["training", "Training (AI-Toolkit)", "ai-toolkit aitk train lora soul id gpu url token", "GraduationCap"],
    ["text-ai", "AI helper", "claude ollama lm studio unsloth local llm model enhancer prompt enhancement context", "Sparkles"],
    ["assist-connectors", "Assist connectors", "mcp connector claude tools notion linear slack server token", "Plug"],
    ["notifications", "Notifications", "browser done alerts", "Bell"],
    ["security", "Password and API tokens", "security sign in mcp token", "ShieldCheck"],
    ["demo", "Placeholder results", "demo mode placeholder tour free try", "Settings2"],
  ] as const
).map(([section, label, keywords, icon]): NavEntry => ({
  id: `setting-${section}`,
  href: `/settings#${section}`,
  label,
  what: "Settings",
  kind: "settings",
  goals: [],
  keywords,
  icon,
  visibility: OWNER,
}));

const ACCOUNT_SETTINGS: NavEntry[] = [
  { id: "your-gpu", href: "/settings#your-gpu", label: "Your GPU", what: "Run on your own ComfyUI", kind: "settings", goals: [], keywords: "comfyui gpu connect own server open source", icon: "Cpu", visibility: ACCOUNT },
  {
    id: "your-keys",
    href: "/settings#your-keys",
    label: "Your keys",
    what: "Your own paid model keys",
    kind: "settings",
    goals: [],
    keywords: "fal fal.ai replicate api key token paid models nano banana kling veo billing",
    icon: "KeyRound",
    visibility: ACCOUNT,
  },
  { id: "account", href: "/settings#account", label: "Account", what: "Email, sign out, delete", kind: "settings", goals: [], keywords: "email sign out delete account", icon: "UserRound", visibility: ACCOUNT },
];

/** Things to do rather than pages to open: search only. Sign up and Log in get their return path at render. */
const ACTIONS: NavEntry[] = [
  { id: "toggle-theme", href: THEME_ACTION, label: "Toggle dark mode", what: "Switch light and dark", kind: "action", goals: [], keywords: "dark light theme night mode appearance", icon: "SunMoon" },
  { id: "github", href: REPO, label: "Source on GitHub", what: "Open source, MIT", kind: "action", goals: [], keywords: "github code repo repository open source download install self host", icon: "Code" },
  { id: "signup", href: "/login?signup=1", label: "Sign up free", what: "Save your work, run more", kind: "action", goals: [], keywords: "sign up register create account join", icon: "UserPlus", visibility: GUEST },
  { id: "login", href: "/login", label: "Log in", what: "Back to your account", kind: "action", goals: [], keywords: "log in login sign in account", icon: "LogIn", visibility: GUEST },
];

export const NAV_ENTRIES: readonly NavEntry[] = [...PAGES, ...STUDIOS, ...HUB_TOOLS, ...SUB_TOOLS, ...SETTINGS, ...ACCOUNT_SETTINGS, ...ACTIONS];

export const LAUNCHER_GROUPS: readonly LauncherGroup[] = [
  { id: "film", label: "Film & video", chip: "Film" },
  { id: "social", label: "Social & shorts", chip: "Social" },
  { id: "sell", label: "Sell & advertise", chip: "Sell" },
  { id: "people", label: "People & fashion", chip: "People" },
  { id: "sound", label: "Sound", chip: "Sound" },
  { id: "finish", label: "Finish & convert", chip: "Finish" },
];

export const GOALS: readonly Goal[] = [
  {
    id: "film",
    label: "Make a film",
    icon: "Clapperboard",
    title: "Make a film",
    line: "Studios, camera moves and finishing tools for film",
    cardsLabel: "Studios",
    cards: ["cinema", "storyboard", "katana", "motion-control", "extend"],
    tapLabel: "One-tap for films",
    taps: [
      { preset: "motion-drone-reveal", kind: "Camera motion" },
      { preset: "effect-northern-lights", kind: "Effect" },
      { preset: "effect-turning-metal", kind: "Effect" },
      { preset: "app-color-grading", kind: "App" },
    ],
    finishLabel: "Finish",
    finish: ["video-tools", "audio", "upscale"],
    assist: true,
  },
  {
    id: "social",
    label: "Grow on social",
    icon: "TrendingUp",
    title: "Grow on social",
    line: "Studios, one-tap apps and finishing tools for social",
    cardsLabel: "Studios",
    cards: ["shorts", "faceless", "content-factory", "lipsync", "explainer"],
    tapLabel: "One-tap for social",
    taps: [
      { preset: "app-talking-photo", kind: "App" },
      { preset: "app-plushies", kind: "App" },
      { preset: "effect-outfit-switch", kind: "Effect" },
      { preset: "app-renaissance", kind: "App" },
    ],
    finishLabel: "Finish",
    finish: ["virality", "reframe", "video-tools-captions"],
    assist: true,
  },
  {
    id: "sell",
    label: "Sell a product",
    icon: "ShoppingBag",
    title: "Sell a product",
    line: "Studios, one-tap apps and finishing tools for products",
    cardsLabel: "Studios",
    cards: ["marketing", "ads", "photodump", "mixed-media", "moodboards"],
    tapLabel: "One-tap for products",
    taps: [
      { preset: "app-giant-product", kind: "App" },
      { preset: "app-billboard-ad", kind: "App" },
      { preset: "app-commercial-faces", kind: "App" },
      { preset: "motion-drone-reveal", kind: "Camera motion" },
    ],
    finishLabel: "Finish",
    finish: ["upscale", "reframe"],
    assist: true,
  },
  {
    id: "people",
    label: "People & fashion",
    icon: "UserRound",
    title: "People & fashion",
    line: "Studios and one-tap looks for people and fashion",
    cardsLabel: "Studios",
    cards: ["fashion-factory", "influencer", "character-sheet", "genjutsu", "elements"],
    tapLabel: "One-tap for people",
    taps: [
      { preset: "app-makeup-studio", kind: "App" },
      { preset: "app-commercial-faces", kind: "App" },
      { preset: "app-3d-figure", kind: "App" },
      { preset: "app-plushies", kind: "App" },
    ],
    finishLabel: "Finish",
    finish: ["inpaint", "upscale"],
  },
  {
    id: "edit",
    label: "Edit & finish",
    icon: "SlidersHorizontal",
    title: "Edit & finish",
    line: "Change a picture or a clip you already have",
    cardsLabel: "Tools",
    cards: ["video-edit", "character-swap", "upscale", "reframe", "image-to-3d"],
    tapLabel: "One-tap looks",
    taps: [
      { preset: "app-renaissance", kind: "App" },
      { preset: "app-color-grading", kind: "App" },
      { preset: "effect-turning-metal", kind: "Effect" },
      { preset: "app-3d-render", kind: "App" },
    ],
    finishLabel: "Picture tools",
    finish: ["edit", "inpaint", "layers"],
  },
  {
    id: "sound",
    label: "Sound",
    icon: "AudioLines",
    title: "Sound",
    line: "Voice, music and sound for anything you make",
    cardsLabel: "Audio and voice",
    cards: ["audio", "lipsync", "audio-translate", "audio-video"],
    tapLabel: "One-tap with a voice",
    taps: [
      { preset: "app-talking-photo", kind: "App" },
      { preset: "app-asmr-host", kind: "App" },
    ],
    finishLabel: "Finish",
    finish: ["audio-clean", "audio-split", "audio-transcribe"],
  },
];

/**
 * Covers of the next steps under a result (src/lib/next-steps.ts), by step: listed here so coverIds() names every
 * cover the navigation shows, and nav-covers.ts resolves them all on the server.
 */
export const STEP_COVERS = {
  animate: "motion-dolly-in",
  talk: "app-talking-photo",
  sheet: "app-fuobe-angles",
  billboard: "app-billboard-ad",
  upscale: "app-upscale",
  giant: "app-giant-product",
  edit: "app-relight",
  grade: "app-color-grading",
  threeD: "app-3d-rotation",
  extend: "motion-aerial-pullback",
  sound: "effect-live-concert",
  split: "app-asmr-host",
  reframe: "app-expand-image",
  swap: "effect-turning-metal",
  voice: "app-asmr-promo",
  clean: "app-clean-up-voice",
  spin: "app-product-360",
} as const;

const byId = new Map(NAV_ENTRIES.map((e) => [e.id, e]));

export function entry(id: string): NavEntry | undefined {
  return byId.get(id);
}

/** Whether a viewer sees an entry anywhere. A viewer not known yet sees what a guest may see, and no more. */
export function visibleTo(e: NavEntry, kind: ViewerKind | undefined): boolean {
  return !e.visibility || e.visibility.includes(kind ?? "guest");
}

export function entriesFor(kind: ViewerKind | undefined): NavEntry[] {
  return NAV_ENTRIES.filter((e) => visibleTo(e, kind));
}

/** Who is looking: the owner, an account (public sign-up) or a guest (signed out while sign-up is open). */
export function viewerKindOf(v: { owner?: boolean; account?: unknown; publicSignup?: boolean } | undefined): ViewerKind | undefined {
  if (!v) return undefined;
  return v.owner ? "owner" : v.account ? "account" : v.publicSignup ? "guest" : "owner";
}

/** The launcher's columns, one per group, each with its lead card and the rest in order. */
export function launcherColumns(kind: ViewerKind | undefined): { group: LauncherGroup; lead: NavEntry; rest: NavEntry[] }[] {
  return LAUNCHER_GROUPS.map((group) => {
    const all = NAV_ENTRIES.filter((e) => e.group === group.id && visibleTo(e, kind));
    if (group.id === "sound") all.sort((a, b) => SOUND_COLUMN.indexOf(a.id) - SOUND_COLUMN.indexOf(b.id));
    const lead = all.find((e) => e.lead) ?? all[0];
    return { group, lead, rest: all.filter((e) => e !== lead) };
  });
}

/** Every launcher entry in column order (the Studios sheet's tiles and the palette's "Every studio"). */
export function launcherEntries(kind: ViewerKind | undefined, group?: LauncherGroupId): NavEntry[] {
  return launcherColumns(kind)
    .filter((c) => !group || c.group.id === group)
    .flatMap((c) => [c.lead, ...c.rest]);
}

const LAUNCHER_HREFS = NAV_ENTRIES.filter((e) => e.group).map((e) => e.href);

/**
 * The launcher entry the path is on (its id), the one whose link matches best: /audio/music is Music, /audio and
 * /audio/dialogue are Audio, /marketing/click-to-ad is Marketing Studio. None for a page outside the launcher.
 */
export function launcherActive(pathname: string): string | undefined {
  let best: NavEntry | undefined;
  for (const e of NAV_ENTRIES) {
    if (!e.group || !navActive(e.href, pathname, new URLSearchParams(), LAUNCHER_HREFS)) continue;
    if (!best || e.href.length > best.href.length) best = e;
  }
  return best?.id;
}

/** How many studios there are (Apps is not one): for copy such as "28 studios". */
export function studioCount(): number {
  return NAV_ENTRIES.filter((e) => e.group && e.kind === "studio").length;
}

/** A goal's band on Home: its cards and finishing links that this viewer may see. */
export function goalBand(id: GoalId, kind: ViewerKind | undefined): { goal: Goal; cards: NavEntry[]; finish: NavEntry[] } {
  const goal = GOALS.find((g) => g.id === id);
  if (!goal) throw new Error(`No goal ${id}`);
  const pick = (ids: string[]) => ids.map((i) => byId.get(i)).filter((e): e is NavEntry => !!e && visibleTo(e, kind));
  return { goal, cards: pick(goal.cards), finish: pick(goal.finish) };
}

/** Entries that are pages of their own (no actions, no settings sections, nothing off the site). */
const ROUTES = NAV_ENTRIES.filter((e) => e.kind !== "tool" && e.kind !== "action" && e.href.startsWith("/") && !e.href.includes("#"));
const ROUTE_HREFS = ROUTES.map((e) => e.href);

/**
 * The page the path is on: the entry whose link matches best (navActive, with every other page as a sibling, so
 * /library?tab=favorites wins over /library, and /settings/models over /settings). A hub's modes and a studio's own
 * pages count as the studio (/audio/clean is Audio, /marketing/click-to-ad is Marketing Studio).
 */
export function activeEntry(pathname: string, search: URLSearchParams): NavEntry | undefined {
  let best: NavEntry | undefined;
  for (const e of ROUTES) {
    if (!navActive(e.href, pathname, search, ROUTE_HREFS)) continue;
    if (!best || e.href.length > best.href.length) best = e;
  }
  return best;
}

/** Whether an entry shows its "New" badge now (the browser's clock). */
export function isNew(e: NavEntry, now: number = Date.now()): boolean {
  return !!e.newUntil && now < Date.parse(e.newUntil);
}

/** Every preset id the navigation shows a cover for: entries, goal taps, next steps. nav-covers.ts resolves these. */
export function coverIds(): string[] {
  const ids = [
    ...NAV_ENTRIES.map((e) => e.cover),
    ...GOALS.flatMap((g) => g.taps.map((t) => t.preset)),
    ...Object.values(STEP_COVERS),
  ].filter((id): id is string => !!id);
  return [...new Set(ids)];
}

/** Where a goal tap's preset opens, as the galleries link it: an app's page, else Video with it picked. */
export const tapHref = (preset: string) => (preset.startsWith("app-") ? `/apps/${preset}` : `/video?preset=${preset}`);
