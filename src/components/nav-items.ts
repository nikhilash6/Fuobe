import {
  AtSign,
  AudioLines,
  Boxes,
  Box,
  Brush,
  Camera,
  Clapperboard,
  Drama,
  Crop,
  Factory,
  FastForward,
  Film,
  GalleryHorizontal,
  Home,
  ImageIcon,
  Images,
  Layers,
  Layers2,
  LayoutGrid,
  Library,
  ListChecks,
  Megaphone,
  MessageCircle,
  Mic2,
  Network,
  PersonStanding,
  Presentation,
  Scale,
  Scissors,
  Settings,
  Shapes,
  Shirt,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Star,
  Swords,
  Target,
  TrendingUp,
  Tv,
  UserRoundCog,
  UserRoundPen,
  Video,
  Wand2,
  WandSparkles,
  Workflow,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shorter label for compact groups (the full one is the tooltip). */
  short?: string;
  /** Prefetched as soon as it's on screen (the rows most visits start from); the others wait for a hover or touch. */
  eager?: boolean;
  /** More words the ⌘K palette matches ("tts" finds Audio). */
  keywords?: string;
}

export interface NavGroupDef {
  label: string;
  items: NavItem[];
  /** Can be folded away; the choice is remembered (Engine starts folded, see DEFAULT_NAV_CLOSED). */
  collapsible?: boolean;
  /** Two small items per row. */
  compact?: boolean;
}

/** The sidebar, and the destinations of the ⌘K palette. Add a destination with one line in the right group. */
export const NAV: NavGroupDef[] = [
  {
    label: "Create",
    items: [
      { href: "/", label: "Home", icon: Home, eager: true, keywords: "start new creation" },
      { href: "/assist", label: "Assist", icon: MessageCircle, eager: true, keywords: "agent chat plan" },
      { href: "/image", label: "Image", icon: ImageIcon, eager: true, keywords: "text to image picture photo" },
      { href: "/video", label: "Video", icon: Video, eager: true, keywords: "text to video image to video animate" },
      { href: "/edit", label: "Edit", icon: Wand2, keywords: "edit image change" },
      { href: "/layers", label: "Layers", icon: Layers2, keywords: "layered psd split" },
      { href: "/inpaint", label: "Inpaint", icon: Brush, keywords: "mask fill remove" },
      { href: "/color-grade", label: "Color grading", icon: SlidersHorizontal, keywords: "grade lut colour" },
      { href: "/motions", label: "Camera motions", icon: Film, keywords: "camera moves presets" },
      { href: "/effects", label: "Effects", icon: Sparkles, keywords: "vfx presets" },
      { href: "/storyboard", label: "Storyboard", icon: GalleryHorizontal, keywords: "frames story" },
      { href: "/canvas", label: "Canvas", icon: Network, keywords: "nodes flow workflow" },
      { href: "/apps", label: "Apps", icon: LayoutGrid, keywords: "one-click tools" },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/library", label: "All creations", icon: Library, eager: true, keywords: "library history results" },
      { href: "/library?tab=favorites", label: "Favorites", icon: Star, keywords: "starred liked" },
    ],
  },
  {
    label: "Studios",
    items: [
      { href: "/cinema", label: "Cinema Studio", icon: Clapperboard, keywords: "film director shots" },
      { href: "/shorts", label: "Shorts Studio", icon: Smartphone, keywords: "vertical reels tiktok" },
      { href: "/mixed-media", label: "Mixed Media", icon: Shapes, keywords: "collage" },
      { href: "/marketing", label: "Marketing Studio", icon: Megaphone, keywords: "ugc product ads" },
      { href: "/ads", label: "Ads Studio", icon: Target, keywords: "brand campaign" },
      { href: "/moodboards", label: "Moodboards", icon: Images, keywords: "style references" },
      { href: "/photodump", label: "Photodump", icon: Camera, keywords: "photo pack character" },
      { href: "/fashion-factory", label: "Fashion Factory", icon: Shirt, keywords: "outfits try-on lookbook" },
      { href: "/character-sheet", label: "Character Sheet", icon: UserRoundCog, keywords: "turnaround" },
      { href: "/influencer", label: "AI Influencer", icon: UserRoundPen, keywords: "character builder avatar creature shuffle" },
      { href: "/faceless", label: "Faceless Studio", icon: Tv, keywords: "youtube channel episodes" },
      { href: "/content-factory", label: "Content Factory", icon: Factory, keywords: "series reference brief episodes" },
      { href: "/explainer", label: "Explainer", icon: Presentation, keywords: "slides pdf video" },
      { href: "/lipsync", label: "Lipsync & avatars", icon: Mic2, keywords: "talking avatar" },
      { href: "/genjutsu", label: "Genjutsu", icon: WandSparkles, keywords: "swap insert character motion transfer" },
      { href: "/character-swap", label: "Character Swap Studio", short: "Character swap", icon: Drama, keywords: "h3 akatz swap character whole clip shots segments takes" },
      { href: "/motion-control", label: "Motion control", icon: PersonStanding, keywords: "pose dance transfer" },
      { href: "/video-edit", label: "Edit video", icon: Scissors, keywords: "video edit restyle" },
      { href: "/extend", label: "Extend video", icon: FastForward, keywords: "longer continue" },
      { href: "/reframe", label: "Reframe", icon: Crop, keywords: "aspect ratio outpaint" },
      { href: "/video-tools", label: "Video tools", icon: Layers, keywords: "join trim matte depth captions evolution remove object" },
      { href: "/elements", label: "Elements", icon: AtSign, keywords: "characters places props" },
      { href: "/upscale", label: "Upscale", icon: ZoomIn, keywords: "enhance resolution 4k" },
      { href: "/audio", label: "Audio", icon: AudioLines, keywords: "voice tts music sfx dub transcribe" },
      { href: "/katana", label: "Katana", icon: Swords, keywords: "cut edit clips" },
      { href: "/image-to-3d", label: "Image to 3D", icon: Box, keywords: "3d mesh glb" },
      { href: "/virality", label: "Virality predictor", icon: TrendingUp, keywords: "hook score" },
    ],
    collapsible: true,
  },
  {
    label: "Engine",
    items: [
      { href: "/models", label: "Models", icon: Boxes, keywords: "catalog prices" },
      { href: "/workflows", label: "ComfyUI workflows", short: "Workflows", icon: Workflow, keywords: "open source graphs" },
      { href: "/settings", label: "Settings", icon: Settings, keywords: "keys preferences" },
      { href: "/status", label: "Project status", short: "Status", icon: ListChecks, keywords: "parity progress" },
      { href: "/settings/about", label: "About & licences", short: "Licences", icon: Scale, keywords: "licence license mit notices credits version open source" },
    ],
    collapsible: true,
    compact: true,
  },
];
