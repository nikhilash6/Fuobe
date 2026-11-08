/**
 * Film looks for MOSS-Image (both engines): a picked look (params.extra.filmLook) is applied by the server just before
 * the run, never shown in the person's prompt. Each look is a short recipe of what the film or camera visibly does
 * (colour, contrast, grain, halation, vignette, borders, leaks), never a stock or camera brand: MOSS-Image draws the
 * effects it is told about and ignores names. The run reads it as a sandwich: the recipe, the person's scene, the
 * recipe again. Its negative names the opposite look, beside MOSS-Image's own base negative (MOSS runs at a low CFG,
 * so the negative steers a lot). A monochrome look also takes the colour words out of the scene first, or colour
 * survives; the server asks an LLM to do that (src/server/film-look.ts) and this file's word list is the fallback.
 *
 * Every recipe here was rendered on MOSS-Image SFT (25 steps, CFG 2.5, er_sde) over several pose-locked scenes and
 * judged before it shipped; looks that MOSS-Image renders weakly (missed focus, true panoramas, square frames, warm
 * portrait films it already looks like) are left out. Pure, so the composer, the server and the tests share it.
 */

/** The picker's groups, in their order. */
export const FILM_LOOK_GROUPS = ["Colour film", "Slide", "Black & white", "Instant", "Motion picture", "Toy & odd cameras", "Looks", "Broken film"] as const;
export type FilmLookGroup = (typeof FILM_LOOK_GROUPS)[number];

/** params.extra's key for the picked look. */
export const FILM_LOOK_PARAM = "filmLook";

export interface FilmLook {
  id: string;
  name: string;
  group: FilmLookGroup;
  /** One line for the picker: what the look does to a picture. */
  blurb: string;
  /** The look in words of what shows: said before the scene and again after it. */
  recipe: string;
  /** The opposite look (and colours the look would otherwise paint onto walls and clothes), for the negative field only. */
  negative: string;
  /** A monochrome look: the scene's colour words come out before the run. */
  mono?: true;
}

/** MOSS-Image's own negative (the graph's default), kept under every look's. */
export const MOSS_BASE_NEGATIVE = "nsfw, worst quality, bad anatomy, watermark, jpeg artifact";

/** The colours a monochrome look's negative names, so none creep back in. */
const COLOUR_NEGATIVE = "color, colorful, saturated colors, color cast, red, orange, yellow, green, blue, purple, pink";

export const FILM_LOOKS: FilmLook[] = [
  // Colour film
  {
    id: "night-halation",
    name: "Night halation",
    group: "Colour film",
    blurb: "Cool teal shadows, warm highlights and a red glow around every light",
    recipe: "night colour film photograph, cool blue-teal shadows, warm orange highlights, a soft red halation glow around every bright light, fine visible film grain, deep inky blacks",
    negative: "flat even daylight, HDR, clean digital look, sterile sharpening, teal skin, orange walls",
  },
  {
    id: "muted-chrome",
    name: "Muted chrome",
    group: "Colour film",
    blurb: "Quiet documentary colour: low saturation, hard contrast, deep reds",
    recipe: "documentary colour film photograph, muted low-saturation colours, hard contrast, cool cyan-leaning shadows, deep dense reds, matte highlights, fine grain",
    negative: "vivid saturated colours, HDR, glossy digital look, warm golden glow, pastel colours",
  },
  // Slide
  {
    id: "vivid-slide",
    name: "Vivid slide",
    group: "Slide",
    blurb: "Deep saturated colour, dark low-key shadows and crisp grain",
    recipe: "vivid slide film photograph, deeply saturated colours, rich deep blues, dense greens, glowing reds, high contrast, underexposed, low-key, dark rich shadows, fine crisp grain",
    negative: "washed-out pastel colours, faded, lifted blacks, overexposed, HDR, flat lighting",
  },
  {
    id: "cross-processed",
    name: "Cross-processed",
    group: "Slide",
    blurb: "Shifted colour: yellow-green highlights, cyan shadows, punchy contrast",
    recipe: "cross-processed slide film photograph, punchy yellow-green highlights, deep cyan shadows, high contrast, oversaturated shifted colours, crushed blacks, strong grain",
    negative: "natural colours, neutral white balance, soft low contrast, clean digital look, accurate skin tones",
  },
  // Black & white
  {
    id: "bw-grain",
    name: "Grainy 400",
    group: "Black & white",
    blurb: "Classic black and white: gritty grain, deep blacks, bright whites",
    recipe: "black and white film photograph, monochrome, gritty silver grain, deep blacks, bright whites, strong punchy contrast",
    negative: `${COLOUR_NEGATIVE}, sepia tint, smooth digital look`,
    mono: true,
  },
  {
    id: "bw-fine",
    name: "Fine grain 100",
    group: "Black & white",
    blurb: "Smooth, silvery black and white with a long tonal range",
    recipe: "fine-grain black and white film photograph, monochrome, smooth silky tonal range, silvery mid-greys, crisp detail, soft deep blacks",
    negative: `${COLOUR_NEGATIVE}, sepia tint, harsh grain, crushed shadows`,
    mono: true,
  },
  {
    id: "bw-pushed",
    name: "Pushed 3200",
    group: "Black & white",
    blurb: "Black and white pushed hard: coarse grain, crushed blacks, blown whites",
    recipe: "pushed black and white film photograph, monochrome, coarse heavy grain, crushed blacks, blown-out highlights, harsh gritty contrast",
    negative: `${COLOUR_NEGATIVE}, sepia tint, smooth clean digital look, soft low contrast`,
    mono: true,
  },
  {
    id: "sepia",
    name: "Sepia print",
    group: "Black & white",
    blurb: "An old photographic print toned warm brown",
    recipe: "antique sepia-toned photographic print, warm brown monochrome, soft faded contrast, fine paper texture, gentle dark vignette",
    negative: "color, colorful, saturated colors, red, green, blue, purple, pink, modern digital look",
    mono: true,
  },
  {
    id: "tintype",
    name: "Tintype",
    group: "Black & white",
    blurb: "A wet-plate portrait on metal with dark lacquered edges",
    recipe: "wet plate tintype photograph, monochrome metallic grey-brown tones, dark lacquered plate edges, uneven chemical streaks and swirls at the borders, soft glowing highlights, antique",
    negative: `${COLOUR_NEGATIVE}, modern digital look, clean straight edges`,
    mono: true,
  },
  {
    id: "daguerreotype",
    name: "Daguerreotype",
    group: "Black & white",
    blurb: "A silvery mirror-plate portrait with tarnished edges",
    recipe: "daguerreotype photograph on a silvered mirror plate, cool silvery monochrome, soft glowing highlights, tarnished dark edges, faint fine scratches, antique",
    negative: `${COLOUR_NEGATIVE}, modern digital look, clean edges`,
    mono: true,
  },
  {
    id: "glass-plate",
    name: "Glass plate",
    group: "Black & white",
    blurb: "An antique glass-plate print with chipped dark corners",
    recipe: "antique glass plate photograph print, silvery monochrome, soft glow, chipped dark corners, uneven emulsion along the edges, fine dust specks",
    negative: `${COLOUR_NEGATIVE}, modern digital look, clean edges`,
    mono: true,
  },
  // Instant
  {
    id: "instant-classic",
    name: "Vintage instant",
    group: "Instant",
    blurb: "Soft dreamy colour in a white instant-film frame",
    recipe: "vintage instant film photograph, soft dreamy colours, creamy warm highlights, gentle low contrast, slightly faded blacks, thick white instant-film border with a wider bottom edge",
    negative: "HDR, crisp digital look, high contrast, borderless full-bleed image, black border",
  },
  {
    id: "instant-expired",
    name: "Expired instant",
    group: "Instant",
    blurb: "Faded colour shifts and chemical blotches in a white frame",
    recipe: "expired instant film photograph, faded washed-out colours, magenta and yellow colour shifts, chemical blotches and uneven development at the edges, soft low contrast, white instant-film border",
    negative: "crisp clean image, accurate colours, HDR, digital look, borderless full-bleed image",
  },
  {
    id: "instant-mini",
    name: "Mini instant",
    group: "Instant",
    blurb: "Bright airy flash colour in a narrow white frame",
    recipe: "mini instant film print, the photograph framed by a plain white card border on all four sides, a slightly wider white strip along the bottom edge, bright airy colours, soft on-camera flash, gentle contrast",
    negative: "dark moody grade, HDR, heavy grain, borderless full-bleed image, black border, cropped border",
  },
  // Motion picture
  {
    id: "cinema-500",
    name: "Cinema 500",
    group: "Motion picture",
    blurb: "A movie still: teal shadows, warm skin, soft halation, fine grain",
    recipe: "35mm motion picture film frame, cinematic colour grade, cool teal-blue shadows, warm natural skin tones, soft glowing halation around highlights, fine organic film grain, rich deep blacks",
    negative: "video look, HDR, digital sharpening, flat lighting, oversaturated colours",
  },
  {
    id: "super-8",
    name: "Super 8",
    group: "Motion picture",
    blurb: "A home-movie frame: warm faded colour, heavy grain, rounded corners",
    recipe: "Super 8 home movie film frame, warm faded colours, heavy grain, soft blooming highlights, dim corners, rounded dark frame edges, nostalgic 1970s",
    negative: "crisp digital look, HDR, clean modern colour, sharp square corners",
  },
  // Toy & odd cameras
  {
    id: "toy-plastic",
    name: "Plastic toy camera",
    group: "Toy & odd cameras",
    blurb: "Heavy vignette and soft edges around a sharp centre",
    recipe: "plastic toy camera photograph, heavy dark vignette, soft smeared edges around a sharp centre, saturated colours, coarse grain",
    negative: "even sharpness to the corners, clean digital look, HDR, bright corners",
  },
  {
    id: "lomo",
    name: "Lo-fi compact",
    group: "Toy & odd cameras",
    blurb: "Punchy saturated colour inside a strong dark vignette",
    recipe: "lo-fi compact camera snapshot, punchy saturated colours, strong dark vignette, high contrast, deep shadows, coarse grain",
    negative: "muted colours, bright even corners, soft low contrast, clean digital look",
  },
  {
    id: "pinhole",
    name: "Pinhole",
    group: "Toy & odd cameras",
    blurb: "Soft dreamy focus and corners that fade to black",
    recipe: "pinhole camera photograph, soft dreamy focus across the whole frame, deep dark vignette fading to black at the corners, gentle glow, muted colours",
    negative: "crisp sharp detail, bright corners, HDR, digital sharpening",
  },
  {
    id: "fisheye-toy",
    name: "Toy fisheye",
    group: "Toy & odd cameras",
    blurb: "A round fisheye picture in a black surround",
    recipe: "toy fisheye camera photograph, circular fisheye image inside a black surround, strong barrel distortion bending straight lines, saturated colours, dark vignette",
    negative: "rectilinear lens, straight lines, full-frame rectangular image, flat perspective",
  },
  {
    id: "half-frame",
    name: "Half-frame diptych",
    group: "Toy & odd cameras",
    blurb: "Two tall frames side by side, as a half-frame camera prints them",
    recipe: "half-frame film diptych, two tall vertical frames side by side with a thin dark gap between them, the same moment from two slightly different angles, warm film colours, grain",
    negative: "single image, one frame, panorama, digital look",
  },
  {
    id: "pocket-110",
    name: "Pocket 110",
    group: "Toy & odd cameras",
    blurb: "A small-format snapshot: soft detail, faded warm colour",
    recipe: "110 pocket camera snapshot, small-format grain, soft slightly smeared detail, faded warm 1970s colours, gentle flash, rounded corners",
    negative: "crisp digital look, HDR, cold modern colour, razor sharp detail",
  },
  {
    id: "disposable",
    name: "Disposable",
    group: "Toy & odd cameras",
    blurb: "Harsh direct flash, saturated colour and a darker background",
    recipe: "cheap disposable film camera snapshot taken with a harsh direct on-camera flash, the subject's face and clothes blown bright and flat by the flash, a hard dark flash shadow on the wall right behind the subject, the background falling off darker, punchy saturated colours, plastic lens softness, coarse grain",
    negative: "soft studio lighting, HDR, cinematic grade, clean digital look, shallow depth of field",
  },
  {
    id: "digicam-2000s",
    name: "2000s digicam",
    group: "Toy & odd cameras",
    blurb: "Early compact digital: hard flash, cool tones, a date stamp",
    recipe: "early 2000s compact digital camera photo, harsh direct flash, cool slightly overexposed tones, crisp digital noise, small sensor look, an orange digital date stamp in the bottom right corner",
    negative: "film grain, cinematic colour grade, shallow depth of field, bokeh, warm film tones",
  },
  // Looks
  {
    id: "teal-orange",
    name: "Teal and orange",
    group: "Looks",
    blurb: "The blockbuster grade: teal shadows, warm skin and highlights",
    recipe: "teal and orange cinematic colour grade, deep teal shadows, warm orange skin tones and highlights, rich contrast, polished blockbuster look",
    negative: "teal skin, orange walls, teal walls, desaturated, flat grey, pastel",
  },
  // Broken film
  {
    id: "light-leaks",
    name: "Light leaks",
    group: "Broken film",
    blurb: "A warm orange-red leak glowing in from the right edge",
    recipe: "film photograph with a warm orange-red light leak glowing in from the right edge of the frame, faded warm colours, soft grain",
    negative: "clean even exposure, HDR, digital look, blue light leak",
  },
  {
    id: "fogged",
    name: "Fogged film",
    group: "Broken film",
    blurb: "A milky haze and a soft orange fog from the top edge",
    recipe: "fogged film photograph, milky haze over the whole frame, lifted hazy blacks, soft orange fog glow spreading down from the top edge, low contrast, grain",
    negative: "crisp clean contrast, deep blacks, HDR, digital look",
  },
  {
    id: "double-exposure",
    name: "Double exposure",
    group: "Broken film",
    blurb: "A faint city skyline blended across the left half of the frame",
    recipe: "double exposure film photograph, a faint second exposure of tall city skyscrapers at night blended across the left half of the frame, the subject's face clear and sharp, soft film grain",
    negative: "single clean exposure, digital collage, hard cut-out edges, HDR",
  },
  {
    id: "end-of-roll",
    name: "End of roll",
    group: "Broken film",
    blurb: "The last frame: a burnt orange-red edge and sprocket holes",
    recipe: "last frame at the end of a film roll, the right edge of the frame burned to glowing orange-red, a bright overexposed streak fading into the picture, a strip of film edge with sprocket holes along the right side",
    negative: "clean even exposure, digital look, HDR, full clean frame",
  },
  {
    id: "scratches",
    name: "Scratched print",
    group: "Broken film",
    blurb: "Fine white scratches, dust and hair marks over faded colour",
    recipe: "old damaged film print, fine white vertical scratches, dust specks and hair marks across the whole frame, faded colours, grain",
    negative: "clean pristine image, digital look, HDR, vivid saturated colours",
  },
];

const BY_ID = new Map(FILM_LOOKS.map((l) => [l.id, l]));

/** The models a film look is made for: MOSS-Image, on your GPU (oss-moss-image) and in the cloud (moss-image). */
export const takesFilmLooks = (model: { family?: string; kind?: string } | null | undefined): boolean => model?.family === "moss" && model.kind === "image";

/** The look with this id, if Fuobe has one. */
export const filmLook = (id: unknown): FilmLook | undefined => (typeof id === "string" ? BY_ID.get(id) : undefined);

/** The looks of each group, in the picker's order (empty groups left out). */
export function filmLookGroups(): { group: FilmLookGroup; looks: FilmLook[] }[] {
  return FILM_LOOK_GROUPS.map((group) => ({ group, looks: FILM_LOOKS.filter((l) => l.group === group) })).filter((g) => g.looks.length);
}

/** A look's thumbnail (public/previews/film-looks/<id>.<width>.avif and .webp, made from its best test render). */
export const filmLookThumb = (id: string, width: 320 | 640 = 320) => ({ avif: `/previews/film-looks/${id}.${width}.avif`, webp: `/previews/film-looks/${id}.${width}.webp` });

// ---------------------------------------------------------------------------
// Colour words out of a monochrome look's scene

/** Words that only ever name a colour. Black, white, grey and silver are tones: they stay. */
const HUES = [
  "red", "reds", "crimson", "scarlet", "burgundy", "maroon", "vermilion", "pink", "pinks", "fuchsia", "magenta",
  "yellow", "yellows", "mustard", "golden", "green", "greens", "teal", "turquoise", "cyan", "aquamarine",
  "blue", "blues", "navy", "cobalt", "azure", "indigo", "cerulean", "purple", "purples", "violet", "lavender", "lilac", "mauve",
  "brown", "browns", "beige", "auburn", "taupe", "terracotta", "ochre", "sienna", "umber", "blonde", "blond",
];
/**
 * Words that are colours only before a thing that wears or shows one ("camel wool coat", "emerald silk gown", "sage
 * walls"); elsewhere they are things themselves (a camel, an emerald ring's stone, sage leaves, champagne), so they stay.
 */
const THING_HUES = [
  "camel", "cream", "ivory", "emerald", "sapphire", "ruby", "jade", "amethyst", "gold", "sage", "olive", "mint", "lime", "lemon", "peach", "apricot", "coral",
  "salmon", "plum", "cherry", "wine", "rust", "copper", "bronze", "amber", "saffron", "khaki", "tan", "sand", "chocolate", "caramel", "cognac", "chestnut",
  "hazel", "honey", "champagne", "blush", "aqua", "orange",
];
const THINGS =
  "silk|satin|linen|wool|cashmere|leather|suede|velvet|cotton|tweed|denim|knit|lace|chiffon|tulle|dress|gown|coat|overcoat|trench|jacket|blazer|suit|shirt|blouse|top|tee|trousers|pants|jeans|skirt|scarf|shawl|hat|beret|shoes|heels|pumps|boots|loafers|sneakers|bag|handbag|clutch|tie|sweater|jumper|turtleneck|cardigan|vest|waistcoat|gloves|belt|wall|walls|door|doors|sofa|chair|curtains?|drapes|tiles?|backdrop|background|sky|light|glow|tones?|hues?|shades?|accents?|trim|fabric|paint|eyes|lips|lipstick|nails|eyeshadow|car|flowers?|petals?|roses?";
/** A hue's light/dark/pale qualifiers that go with it. */
const SHADE = "(?:(?:pale|light|dark|deep|bright|soft|muted|dusty|rich|vivid|warm|cool|neon|pastel|electric|burnt|hot)[\\s-]+)?";
/** "-coloured", "-toned", "-tinted", "-hued", "-ish" after a hue. */
const SUFFIX = "(?:[\\s-]*(?:colou?red|toned|tinted|hued|ish))?";
const HUE_WORDS = new RegExp(
  `\\b${SHADE}(?:(?:${HUES.join("|")}|(?<!\\b(?:an|some|two|three|\\d+)\\s)orange)${SUFFIX}|(?:${THING_HUES.join("|")})${SUFFIX}(?=[\\s-]+(?:(?:${HUES.join("|")}|${THING_HUES.join("|")}|and|or)[\\s,-]+)*(?:${THINGS})\\b))\\b`,
  "gi",
);
/** A closing list of colours ("… in sand, sage, ivory and gold."): two or more, after "in", at the end of a sentence. */
const ANY_HUE = `(?:${SHADE}(?:${[...HUES, ...THING_HUES].join("|")}))`;
const COLOUR_LIST = new RegExp(`\\s+in\\s+${ANY_HUE}(?:\\s*,\\s*${ANY_HUE})*\\s*(?:,\\s*)?(?:and|&)\\s+${ANY_HUE}(?=\\s*(?:[.;!?]|$))`, "gi");
/** Anything "-coloured", "-toned" or "-tinted" ("sand-coloured", "wine-toned"). */
const COLOURED = /\b[\p{L}]+[\s-](?:colou?red|toned|tinted|hued)\b/giu;
/** Whole colour phrases, said before the single words. */
const PHRASES: [RegExp, string][] = [
  [/\bgolden[\s-]hour(?:\s+(?:light|sun|sunlight|glow))?\b/gi, "low late-day sun"],
  [/\brose[\s-]gold\b/gi, "polished metal"],
  [/\b(?:in|with) (?:vivid|rich|bright|bold|warm|cool|pastel|muted|jewel|earthy) (?:colou?rs|tones|hues)\b/gi, ""],
  [/\b(?:vivid|vibrant|bright|bold|rich|saturated|pastel|jewel|earthy|warm|cool) (?:colou?rs|tones|hues|palette)\b/gi, ""],
  [/\b(?:multi-?colou?red|colou?rful|vibrant)\b/gi, ""],
  [/\bcolou?r palette of\b[^.,;]*/gi, ""],
  [/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi, ""],
];
/** "gold" and "golden" as a material: "gold drop earrings" → "metal drop earrings", so the jewellery stays. */
const GOLD_MATERIAL =
  /\b(?:gold|golden|brass|copper|bronze)(?=[\s-]+(?:[\p{L}]+[\s-]+)?(?:earrings?|necklace|pendant|chain|rings?|bracelets?|bangles?|cuffs?|hoops?|studs?|buttons?|buckles?|frames?|watch|dropper|lid|clasp|hardware|trim|leaf|jewellery|jewelry)\b)/giu;
/** Hair and eyes keep their tone: fair or dark hair, light or dark eyes. */
const FAIR_HAIR = /\b(?:(?:platinum|honey|ash|strawberry)[\s-])?blonde?(?=[\s-]+(?:[\p{L}]+[\s-]+)?(?:hair|waves|curls|locks|bob|ponytail|braids?|bun|lob)\b)/giu;
const DARK_HAIR = /\b(?:auburn|chestnut|brown|red|copper|ginger|chocolate|caramel|mahogany|burgundy)(?=[\s-]+(?:[\p{L}]+[\s-]+)?(?:hair|waves|curls|locks|bob|ponytail|braids?|bun|lob)\b)/giu;
const LIGHT_EYES = /\b(?:blue|green|grey|gray|hazel|amber|aqua|turquoise|emerald|sapphire|ice[\s-]blue)(?=[\s-]+eyes\b)/gi;
const DARK_EYES = /\b(?:brown|chocolate|honey|cognac)(?=[\s-]+eyes\b)/gi;

/** Tidy what taking words out leaves: doubled spaces and commas, "in and", a list that lost its items. */
function tidy(text: string): string {
  let t = text;
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/,\s*(?:,\s*)+/g, ", ")
      .replace(/\b(?:and|or|with|in)\s*([,.;:])/gi, "$1")
      .replace(/,\s*(?:and|or)\s+(?=[,.;:]|$)/gi, "")
      .replace(/(^|[.;:]\s*),\s*/g, "$1")
      .replace(/\b(a|an|the)\s+(?=[,.;:]|$)/gi, "")
      .replace(/\b(a|an)\s+(?=(?:and|or)\b)/gi, "")
      .replace(/\ban (?=[^aeiou\s])/gi, (m) => (m[0] === "A" ? "A " : "a "))
      .replace(/\ba (?=[aeiou])/gi, (m) => (m[0] === "A" ? "An " : "an "))
      .replace(/,\s*([.;:])/g, "$1");
  }
  return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * The scene without its colour words, for a monochrome look (the fallback when no LLM answers, and a last check on the
 * LLM's answer): hues and their shades, "-coloured" words, colour phrases and hex codes come out; tones (black, white,
 * grey, silver) and everything else stay. Hair keeps its shape ("auburn waves" → "waves"); gold jewellery stays metal.
 */
export function scrubColourWords(scene: string): string {
  let t = scene;
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  t = t.replace(GOLD_MATERIAL, "metal").replace(FAIR_HAIR, "fair").replace(DARK_HAIR, "dark").replace(LIGHT_EYES, "light").replace(DARK_EYES, "dark");
  t = t.replace(COLOUR_LIST, "").replace(COLOURED, "").replace(HUE_WORDS, "");
  return tidy(t);
}

/** Whether words still name a colour a monochrome look would show. */
export const hasColourWords = (text: string): boolean => scrubColourWords(text) !== tidy(text);

// ---------------------------------------------------------------------------
// Applying a look

/** Negative terms joined without repeats (case-insensitive), in order. */
export function joinNegatives(...parts: (string | undefined | null)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const raw of (part ?? "").split(",")) {
      const term = raw.trim();
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      out.push(term);
    }
  }
  return out.join(", ");
}

const sentence = (s: string) => {
  const t = s.trim().replace(/[.\s]+$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
};

export interface AppliedFilmLook {
  /** What MOSS-Image reads: the recipe, the scene, the recipe again. */
  prompt: string;
  /** The person's negative (if any), the look's opposite, then MOSS-Image's base negative. */
  negative: string;
}

/**
 * A scene in a look: the sandwich and the negatives. `scene` is the person's words as the run sends them (after
 * Enhance), already without colour words for a monochrome look (scrubbed by the caller: the server asks an LLM first).
 */
export function applyFilmLook(look: FilmLook, scene: string, negative?: string | null): AppliedFilmLook {
  const recipe = sentence(look.recipe);
  const body = sentence(scene);
  return {
    prompt: [recipe, body, recipe].filter(Boolean).join(" "),
    negative: joinNegatives(negative, look.negative, MOSS_BASE_NEGATIVE),
  };
}
