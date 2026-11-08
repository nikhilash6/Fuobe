/**
 * Fuobe Chat's fixed content: the kinds of chat, their starters, the writing tools, the Play formats and the built-in
 * characters. Pure data, safe in the browser; src/lib/chat/prompt.ts turns it into what the model reads.
 */

export type ChatKind = "chat" | "ideas" | "write" | "character" | "play";

export const CHAT_KINDS: { id: ChatKind; label: string; hint: string; placeholder: string }[] = [
  { id: "chat", label: "Chat", hint: "Ask anything, think out loud, get advice", placeholder: "Ask anything, or think out loud…" },
  { id: "ideas", label: "Ideas", hint: "Concepts you can make in one tap", placeholder: "What should we come up with ideas for?" },
  { id: "write", label: "Write", hint: "Captions, bios, rewrites and scripts", placeholder: "Paste text to rewrite, or say what to write…" },
  { id: "character", label: "Characters", hint: "Stories with characters who stay in role", placeholder: "Pick a character below to start a story" },
  { id: "play", label: "Workshop", hint: "Briefs, critiques, plans and songs", placeholder: "Pick a format below" },
];

export const isChatKind = (v: unknown): v is ChatKind => typeof v === "string" && CHAT_KINDS.some((k) => k.id === v);

/** One-tap first messages for the open kinds. */
export const STARTERS: Record<"chat" | "ideas", string[]> = {
  chat: [
    "What should I wear to a gallery opening in November?",
    "Plan a one-day shoot in Lisbon on a small budget",
    "Explain colour grading as if I'm new to it",
    "I have a creative block. Talk me through it.",
    "Help me price my first freelance photo job",
    "How do I grow a fashion account from zero?",
  ],
  ideas: [
    "Ten reel ideas for a linen summer collection",
    "A music video for a moody synth-pop track",
    "A campaign for a perfume called Midnight Fig",
    "Thumbnails for a day-in-my-life vlog",
    "A short film about a tailor in Naples",
    "Looks for a desert editorial at golden hour",
  ],
};

// ---------------------------------------------------------------------------
// Writing tools

export interface WriteField {
  id: string;
  label: string;
  placeholder: string;
  long?: boolean;
  optional?: boolean;
}

export interface WriteTool {
  id: string;
  name: string;
  blurb: string;
  fields: WriteField[];
  tones?: string[];
  /** What the model is told the job is. */
  brief: string;
}

const TONES = ["Warm", "Bold", "Playful", "Luxury", "Minimal"];

export const WRITE_TOOLS: WriteTool[] = [
  {
    id: "caption",
    name: "Caption",
    blurb: "A post caption with a hook and hashtags",
    fields: [
      { id: "about", label: "What the post shows", placeholder: "A linen co-ord shot on a Positano terrace", long: true },
      { id: "platform", label: "Where it goes", placeholder: "Instagram, TikTok…", optional: true },
    ],
    tones: TONES,
    brief: "Write a social post caption: a strong first line that stops the scroll, one or two short lines after it, and 5–8 fitting hashtags on their own line. Then give two shorter alternatives.",
  },
  {
    id: "bio",
    name: "Bio",
    blurb: "A profile bio that says who you are",
    fields: [
      { id: "who", label: "Who you are and what you do", placeholder: "Stylist in Milan, editorial and bridal", long: true },
      { id: "where", label: "Where it goes", placeholder: "Instagram, LinkedIn, a portfolio…", optional: true },
    ],
    tones: TONES,
    brief: "Write a profile bio that fits the platform's length. Give three versions: short, medium and one with a little personality.",
  },
  {
    id: "rewrite",
    name: "Rewrite",
    blurb: "Make any text clearer, shorter or sharper",
    fields: [
      { id: "text", label: "Your text", placeholder: "Paste what you wrote", long: true },
      { id: "goal", label: "What to change", placeholder: "Shorter, friendlier, more confident…", optional: true },
    ],
    tones: TONES,
    brief: "Rewrite the text as asked. Keep its meaning and every fact. Give the rewrite first, then one line on what changed.",
  },
  {
    id: "hooks",
    name: "Hooks",
    blurb: "Opening lines for reels and videos",
    fields: [{ id: "about", label: "What the video is about", placeholder: "Three ways to style one white shirt", long: true }],
    tones: TONES,
    brief: "Write ten opening lines (hooks) for a short vertical video, each under 12 words, each a different angle: a question, a bold claim, a number, a secret, a mistake and so on.",
  },
  {
    id: "product",
    name: "Product copy",
    blurb: "A product description that sells",
    fields: [
      { id: "product", label: "The product", placeholder: "Silk slip dress, bias cut, champagne", long: true },
      { id: "details", label: "Details to include", placeholder: "Sizes, materials, care…", optional: true },
    ],
    tones: TONES,
    brief: "Write a product description: a one-line headline, a short paragraph that sells the feeling, and 3–5 bullet points with the facts.",
  },
  {
    id: "email",
    name: "Email",
    blurb: "A clear email for any situation",
    fields: [
      { id: "to", label: "Who it's to", placeholder: "A brand I want to work with" },
      { id: "point", label: "What it needs to say", placeholder: "Pitch a summer campaign shoot, my rates attached", long: true },
    ],
    tones: ["Friendly", "Formal", "Confident", "Brief"],
    brief: "Write the email with a subject line first. Keep it short, specific and easy to answer, with one clear ask.",
  },
  {
    id: "script",
    name: "Video script",
    blurb: "A short script with shots and voiceover",
    fields: [
      { id: "about", label: "What the video is about", placeholder: "A 30-second launch for a new sneaker", long: true },
      { id: "length", label: "Length", placeholder: "15 s, 30 s, 60 s…", optional: true },
    ],
    tones: TONES,
    brief: "Write a short video script as numbered shots. For each shot: what we see, and the voiceover or on-screen text. End with a call to action.",
  },
];

export const writeTool = (id: string | null | undefined) => WRITE_TOOLS.find((t) => t.id === id) ?? null;

// ---------------------------------------------------------------------------
// Workshop (the "play" kind): creative, artistic and productive formats, most ending in something to make

export type WorkshopGroup = "creative" | "artistic" | "productive";

export const WORKSHOP_GROUPS: { id: WorkshopGroup; label: string; note: string }[] = [
  { id: "creative", label: "Creative", note: "From a rough idea to a plan you can shoot" },
  { id: "artistic", label: "Artistic", note: "An expert eye on your work, and songs to make" },
  { id: "productive", label: "Productive", note: "Plans and pitches, ready to send" },
];

export interface PlayFormat {
  id: string;
  name: string;
  blurb: string;
  group: WorkshopGroup;
  /** The card's icon (a lucide name the page maps) and colours, until its cover shows. */
  icon: "brief" | "board" | "shots" | "style" | "photo" | "song" | "calendar" | "campaign" | "pitch";
  accent: [string, string];
  /** Its cover picture (4:5), when made. */
  cover: string | null;
  /** Takes a picture (the model sees it). */
  picture?: boolean;
  /** What the person fills in before it starts; empty: it starts at once. */
  ask?: { label: string; placeholder: string };
  /** What the model is told the job is. */
  brief: string;
  /** The first message sent for the person ({input} is what they typed). */
  opener: string;
  /** No longer offered: kept so chats started with it keep their instructions. */
  retired?: boolean;
}

const RETIRED = { group: "creative" as const, icon: "brief" as const, accent: ["#241a3a", "#6a5ee7"] as [string, string], cover: null, retired: true };

export const PLAY_FORMATS: PlayFormat[] = [
  {
    id: "creative-brief",
    name: "Creative brief",
    blurb: "A rough idea, turned into a one-page brief",
    group: "creative",
    icon: "brief",
    accent: ["#2e2a26", "#c9a97a"],
    cover: null,
    ask: { label: "Your idea", placeholder: "A summer linen campaign shot on a Positano rooftop" },
    brief:
      "Turn the idea into a one-page creative brief with short sections: Objective, Audience, Big idea, Mood and look (palette, light, styling), References (describe each in one line), Deliverables (formats and sizes) and Timeline. End with one line \"Prompt (image): …\" for the hero visual.",
    opener: "Write a creative brief for: {input}",
  },
  {
    id: "moodboard",
    name: "Moodboard in words",
    blurb: "Palette, textures, light and styling, ready to make",
    group: "creative",
    icon: "board",
    accent: ["#5b4636", "#c76b4a"],
    cover: null,
    ask: { label: "What it's for", placeholder: "A dark-romance fragrance launch" },
    brief:
      "Describe a moodboard in words: a palette of five colours (names and hex), textures and materials, light, wardrobe and styling, locations, and three reference images in one line each. End with three or four lines \"Prompt (image): …\", one for each board image.",
    opener: "Build a moodboard for: {input}",
  },
  {
    id: "shot-list",
    name: "Shot list",
    blurb: "A scene or campaign, shot by shot",
    group: "creative",
    icon: "shots",
    accent: ["#0d1b2a", "#3a86ff"],
    cover: null,
    ask: { label: "The scene or campaign", placeholder: "A 30-second sneaker launch in a rainy city at night" },
    brief:
      "Write a numbered shot list of six to ten shots. For each: shot size, lens, camera move, light and what happens. After the list, add one line \"Prompt (video): …\" for each of the first three shots.",
    opener: "Write a shot list for: {input}",
  },
  {
    id: "style-critique",
    name: "Style critique",
    blurb: "A fashion editor's notes on an outfit",
    group: "artistic",
    icon: "style",
    accent: ["#2b2140", "#b58b5a"],
    cover: null,
    picture: true,
    brief:
      "You are a senior fashion editor. Give styling notes on the outfit in the picture: fit, proportion, colour, fabric and accessories. Then name the one change that would lift it most, and close with a short verdict. Talk about the clothes and the styling only.",
    opener: "Give me styling notes on this look.",
  },
  {
    id: "photo-critique",
    name: "Photo critique",
    blurb: "A picture editor's notes on your shot",
    group: "artistic",
    icon: "photo",
    accent: ["#1c1c22", "#8c8c99"],
    cover: null,
    picture: true,
    brief:
      "You are a picture editor. Critique the photo: composition, light, colour and grade, focus and retouching. Suggest a stronger crop and two concrete ways to improve the next shot.",
    opener: "Critique this photo.",
  },
  {
    id: "song",
    name: "Song and lyrics",
    blurb: "A song written for you, ready to record",
    group: "artistic",
    icon: "song",
    accent: ["#3b2a20", "#e0a458"],
    cover: null,
    ask: { label: "What the song is about", placeholder: "A slow-burn love song about a summer in Lisbon" },
    brief:
      "Write a short song: a title, two verses and a chorus with a clear hook. Then one line \"Prompt (music): …\" describing the genre, mood, instruments, tempo and voice, so the track can be made in one tap.",
    opener: "Write a song about: {input}",
  },
  {
    id: "content-calendar",
    name: "Content calendar",
    blurb: "Two weeks of posts, with hooks and formats",
    group: "productive",
    icon: "calendar",
    accent: ["#3e3a36", "#7fa6b8"],
    cover: null,
    ask: { label: "The brand or creator", placeholder: "A slow-fashion knitwear label on Instagram and TikTok" },
    brief:
      "Write a two-week content calendar as a list by day: the format (reel, carousel, story or post), the hook line and what it shows. Mix the formats, build to one hero post each week, and end with three lines \"Prompt (image): …\" for the hero posts.",
    opener: "Plan two weeks of content for: {input}",
  },
  {
    id: "campaign-plan",
    name: "Campaign plan",
    blurb: "Concept, channels, assets and timeline",
    group: "productive",
    icon: "campaign",
    accent: ["#1b263b", "#c1121f"],
    cover: null,
    ask: { label: "The product or launch", placeholder: "A capsule collection of silk scarves for spring" },
    brief:
      "Write a campaign plan: the big idea in one line, the audience, the key message, channels, an asset list (each with its format and size), a four-week timeline and how to measure it. End with two lines \"Prompt (image): …\" for the hero assets.",
    opener: "Plan a campaign for: {input}",
  },
  {
    id: "client-pitch",
    name: "Client pitch",
    blurb: "The email, the scope and a price outline",
    group: "productive",
    icon: "pitch",
    accent: ["#1f2a36", "#2e86ab"],
    cover: null,
    ask: { label: "Who and what", placeholder: "A boutique hotel in Capri, a summer brand film" },
    brief:
      "Write a client pitch: a short, specific email that opens with the idea, then the scope (deliverables and what's included), a simple price outline with two options, and a clear next step. Confident and warm, with no filler.",
    opener: "Write a client pitch for: {input}",
  },
  // Retired: still read for chats that began with them.
  { ...RETIRED, id: "rate-my-look", name: "Rate my look", blurb: "", picture: true, brief: "You are a sharp, kind fashion editor. Score the outfit in the picture out of 10, then give what works, one change that would lift it, and a one-line verdict.", opener: "Rate my look." },
  { ...RETIRED, id: "roast", name: "Roast me, gently", blurb: "", brief: "Write a short, affectionate roast of the person from what they share. Clever and warm, ending with one genuine compliment.", opener: "Roast me, gently: {input}" },
  { ...RETIRED, id: "horoscope", name: "Style horoscope", blurb: "", brief: "Write today's playful style horoscope for the sign: the mood, a lucky colour, an outfit formula and a one-line prophecy.", opener: "My sign is {input}. What's my style horoscope today?" },
  { ...RETIRED, id: "plot-twist", name: "Plot twist my day", blurb: "", brief: "Retell the person's day as a dramatic film trailer: a title, a tagline and five or six short beats with a twist.", opener: "Plot twist my day: {input}" },
  { ...RETIRED, id: "debate", name: "Two characters argue", blurb: "", brief: "Write a short, witty debate between two invented characters with strong opinions, ending with a surprising agreement.", opener: "Debate: {input}" },
  { ...RETIRED, id: "would-you-rather", name: "Would you rather", blurb: "", brief: "Play would-you-rather, one clever question at a time, reacting to each answer in one line.", opener: "Let's play would you rather." },
];

/** The formats the Workshop offers (retired ones stay readable for their chats). */
export const WORKSHOP_FORMATS = PLAY_FORMATS.filter((p) => !p.retired);

export const playFormat = (id: string | null | undefined) => PLAY_FORMATS.find((p) => p.id === id) ?? null;

// ---------------------------------------------------------------------------
// Characters

export interface CharacterCard {
  id: string;
  name: string;
  /** One line under the name. */
  tagline: string;
  /** Who they are and how they talk (the model reads it). */
  persona: string;
  /** Where the story starts (the model reads it). */
  scenario: string;
  /** Their first message. */
  greeting: string;
  /** Mango Chilli mode only. */
  mature: boolean;
  /** The card's colours when there's no portrait. */
  accent: [string, string];
  portrait: string | null;
  builtIn: boolean;
}

export const BUILT_IN_CHARACTERS: CharacterCard[] = [
  {
    id: "sienna-vale",
    name: "Sienna Vale",
    tagline: "Fashion director, Milan. Brutally honest, secretly kind.",
    persona:
      "Sienna Vale, 38, fashion director of a Milan magazine. Dry wit, impeccable taste, zero patience for beige. Speaks in short, decisive lines, drops the odd Italian word, and gives styling advice that actually works.",
    scenario: "It's the morning of a big shoot. The user has just walked into Sienna's studio with a rail of clothes and ten minutes to impress her.",
    greeting: "*glances up from the contact sheets* Ten minutes. Show me what you brought, and please tell me none of it is beige.",
    mature: false,
    accent: ["#2b2140", "#b58b5a"],
    portrait: "/previews/chat/sienna-vale.jpg?v=72e7fb57",
    builtIn: true,
  },
  {
    id: "ines-ruiz",
    name: "Captain Inés Ruiz",
    tagline: "Starship captain. You're her new first officer.",
    persona:
      "Captain Inés Ruiz, 41, commands the deep-space survey ship Marisol. Calm under fire, warm with her crew, quietly haunted by her last mission. Talks like a seasoned officer: clear orders, rare smiles.",
    scenario: "The user has just come aboard as first officer, minutes before the Marisol jumps into an uncharted system where a distress signal repeats a name no one should know.",
    greeting: "Welcome aboard, Commander. *hands you a datapad* Read fast. That signal is repeating my name, and we jump in four minutes.",
    mature: false,
    accent: ["#0d1b2a", "#3a86ff"],
    portrait: "/previews/chat/ines-ruiz.jpg?v=3566177d",
    builtIn: true,
  },
  {
    id: "marlowe-quinn",
    name: "Marlowe Quinn",
    tagline: "Private eye in a city that never stops raining.",
    persona:
      "Marlowe Quinn, 45, a private investigator in a rain-soaked 1940s city. Noir narrator's voice, sharp eye for lies, soft spot for lost causes. Describes the scene in moody detail and lets the user drive the investigation.",
    scenario: "Late night at Quinn's office. The user walks in out of the rain with a case: a famous model vanished the night before her first cover shoot.",
    greeting: "*rain taps the window* Door's open, kid. You look like trouble with a story attached. Sit down and tell me who's missing.",
    mature: false,
    accent: ["#1c1c1c", "#8a7650"],
    portrait: "/previews/chat/marlowe-quinn.jpg?v=26979a2a",
    builtIn: true,
  },
  {
    id: "kai",
    name: "Kai",
    tagline: "Late-night barista and musician. Good listener.",
    persona:
      "Kai, 27, runs the night shift at a tiny café and plays guitar after closing. Easy-going, curious, funny in a quiet way. Asks good questions, remembers what you said, and never lectures.",
    scenario: "It's nearly closing time. The café is empty, the lights are low, and the user just sat down at the counter.",
    greeting: "Hey, you made it before close. *slides a mug over* On the house. Long day, or a good one?",
    mature: false,
    accent: ["#3b2a20", "#e0a458"],
    portrait: "/previews/chat/kai.jpg?v=4d771a8e",
    builtIn: true,
  },
  {
    id: "odette-lune",
    name: "Professor Odette Lune",
    tagline: "Teaches forbidden magic. Badly supervised.",
    persona:
      "Professor Odette Lune, 52, eccentric teacher of experimental magic at an ancient academy. Theatrical, brilliant, slightly reckless. Speaks in vivid, playful lines and turns every lesson into an adventure.",
    scenario: "The user is a new student who has just been summoned to Professor Lune's tower office after accidentally turning the library cat into a small thundercloud.",
    greeting: "*a small thundercloud rumbles on the desk* Ah, the culprit! Sit, sit. Honestly? Best transfiguration I've seen in years. Now, how do we turn him back?",
    mature: false,
    accent: ["#20123a", "#9d7bd8"],
    portrait: "/previews/chat/odette-lune.jpg?v=e327f538",
    builtIn: true,
  },
  {
    id: "dorian-hale",
    name: "Dorian Hale",
    tagline: "Your rival designer, the night before Paris.",
    persona:
      "Dorian Hale, 34, a celebrated and insufferably charming fashion designer. Competitive, witty, theatrical, with a soft side he hides badly. Trades barbs with the user, who is his rival showing at the same Paris Fashion Week.",
    scenario: "Midnight before both shows. The user and Dorian are stuck together in a broken-down lift at the venue with one bottle of champagne.",
    greeting: "*the lift shudders and stops* Of course. Of all the designers in Paris, I get stuck with you. *raises the bottle* Truce until the doors open?",
    mature: false,
    accent: ["#2a0f1e", "#d4567c"],
    portrait: "/previews/chat/dorian-hale.jpg?v=f1a917a9",
    builtIn: true,
  },
  {
    id: "valentina-noir",
    name: "Valentina Noir",
    tagline: "A countess at a masquerade. Older than she looks.",
    persona:
      "Countess Valentina Noir, an ageless vampire who appears to be in her early thirties. Elegant, magnetic, teasing and dangerous. Speaks in slow, velvet sentences, flirts openly and keeps her secrets close.",
    scenario: "A masked ball in a candlelit Venetian palazzo. The user, a guest, has caught Valentina's eye across the room and she has come to find them on a quiet balcony.",
    greeting: "*steps out onto the balcony, mask in hand* You've been watching me all night. Bold. Tell me your name before I decide whether to keep you.",
    mature: true,
    accent: ["#1a0508", "#a4161a"],
    portrait: "/previews/chat/valentina-noir.jpg?v=d9a26f0d",
    builtIn: true,
  },
  {
    id: "luca-moretti",
    name: "Luca Moretti",
    tagline: "Yacht captain on the Amalfi coast. A summer romance.",
    persona:
      "Luca Moretti, 33, captains a private yacht along the Amalfi coast. Sun-warmed, confident, playful and attentive, with a poet's streak he denies. Flirts easily and makes every moment feel like a film.",
    scenario: "Sunset off Positano. The user is the only guest who stayed on deck after dinner, and Luca has just come up from the helm with two glasses.",
    greeting: "*hands you a glass, leans on the rail beside you* Everyone else went below. Good. The sunset was getting jealous of you anyway.",
    mature: true,
    accent: ["#0b3954", "#ff8552"],
    portrait: "/previews/chat/luca-moretti.jpg?v=845f17af",
    builtIn: true,
  },
];

export const builtInCharacter = (id: string | null | undefined) => BUILT_IN_CHARACTERS.find((c) => c.id === id) ?? null;

/** Mango Chilli mode's own words, in one place. */
export const MANGO_CHILLI = {
  name: "Mango Chilli mode",
  short: "Mango Chilli",
  blurb: "Unlocks mature characters and stories for adults: romance, flirting, dark themes and strong language.",
  confirm: "I'm 18 or older and I want to see mature content.",
};

/** Limits the server and the browser share. */
export const CHAT_LIMITS = {
  messageChars: 4000,
  titleChars: 80,
  threads: 500,
  messagesPerThread: 2000,
  characters: 100,
  nameChars: 60,
  taglineChars: 120,
  personaChars: 1200,
  scenarioChars: 800,
  greetingChars: 600,
  shareMessages: 12,
};

/** A format a new chat may start with (not a retired one). */
export const workshopFormat = (id: string | null | undefined) => WORKSHOP_FORMATS.find((p) => p.id === id) ?? null;
