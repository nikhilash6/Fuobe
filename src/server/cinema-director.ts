import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  APERTURES,
  CAMERA_BODIES,
  CAMERA_MOVES,
  DURATION,
  ERAS,
  FOCAL_LENGTHS,
  GENRES,
  LENSES,
  LIGHTING_PRESETS,
  PALETTES,
  TEMPOS,
  directorSummary,
  type CinemaProject,
  type DirectorMessage,
  type DirectorSettings,
  type DirectorShot,
} from "@/lib/catalog/cinema";
import { appendChat, getChat, getProject, CinemaError } from "./cinema";
import { llmText } from "./enhance";

/**
 * The AI Director: turns an idea or a script into shots with Director settings, camera moves and
 * prompts. It only proposes — every shot card has "Load into prompt bar" and nothing is generated
 * until the user presses Generate (Higgsfield's rule). Uses the configured LLM (Claude or a local model)
 * and falls back to an offline breakdown so it always answers.
 */

const slugs = (xs: { slug: string | null }[]) => xs.flatMap((x) => (x.slug ? [x.slug] : []));

const SYSTEM = `You are the AI Director of a film studio app (Fuobe Cinema).
You break ideas and scripts into shots, pick the camera, light the scene and write prompts. You never generate anything yourself: the user reviews each shot and presses Generate.

Answer with ONE JSON object and nothing else:
{"reply": "1–3 short sentences to the user", "shots": [{"title": "Shot name", "prompt": "what the camera sees: subject, action, setting, framing", "duration": 5, "moves": ["dolly-in"], "settings": {"genre": "noir", "era": "1980s", "tempo": "calm", "camera": "35mm-film", "lens": "anamorphic", "focal": "50mm", "aperture": "f4-moderate", "lighting": "window", "palette": "neon-rain-at-midnight"}}], "brief": "optional: a project brief, only when the user asks for one"}

Rules:
- Use only these values (omit a field to leave it on Auto):
  genre: ${slugs(GENRES).join(", ")}
  era: ${slugs(ERAS).join(", ")}
  tempo: ${slugs(TEMPOS).join(", ")}
  camera: ${slugs(CAMERA_BODIES).join(", ")}
  lens: ${slugs(LENSES).join(", ")}
  focal: ${slugs(FOCAL_LENGTHS).join(", ")}
  aperture: ${slugs(APERTURES).join(", ")}
  lighting: ${slugs(LIGHTING_PRESETS).join(", ")}
  palette: ${PALETTES.map((p) => p.slug).join(", ")}
  moves (camera moves, 0–3 per shot, in order): ${CAMERA_MOVES.map((m) => m.slug).join(", ")}
- duration: whole seconds from ${DURATION.min} to ${DURATION.max}. Keep @handles (characters, locations) exactly as the user wrote them.
- Put shared look decisions (genre, era, camera, palette, lighting) in every shot's settings so each shot can be loaded on its own.
- Follow the project brief. No shots when the user only asks a question; then just reply.`;

/** The answer's JSON as a JSON Schema, for local models that decode to one: settings left out stay Auto. */
const oneOf = (values: string[]) => ({ type: "string", enum: values });
const ANSWER_SCHEMA = {
  name: "director",
  schema: {
    type: "object",
    properties: {
      reply: { type: "string" },
      shots: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            prompt: { type: "string" },
            duration: { type: "integer" },
            moves: { type: "array", maxItems: 3, items: oneOf(CAMERA_MOVES.map((m) => m.slug)) },
            settings: {
              type: "object",
              properties: {
                genre: oneOf(slugs(GENRES)),
                era: oneOf(slugs(ERAS)),
                tempo: oneOf(slugs(TEMPOS)),
                camera: oneOf(slugs(CAMERA_BODIES)),
                lens: oneOf(slugs(LENSES)),
                focal: oneOf(slugs(FOCAL_LENGTHS)),
                aperture: oneOf(slugs(APERTURES)),
                lighting: oneOf(slugs(LIGHTING_PRESETS)),
                palette: oneOf(PALETTES.map((p) => p.slug)),
              },
              additionalProperties: false,
            },
          },
          required: ["title", "prompt", "duration", "moves", "settings"],
          additionalProperties: false,
        },
      },
      brief: { type: "string" },
    },
    required: ["reply", "shots"],
    additionalProperties: false,
  },
};

const Shot = z.object({
  title: z.string().max(120).catch("Shot"),
  prompt: z.string().min(1).max(2000),
  duration: z.coerce.number().catch(DURATION.default),
  moves: z.array(z.string()).catch([]),
  settings: z.record(z.string(), z.unknown()).catch({}),
});
const Answer = z.object({
  reply: z.string().catch(""),
  shots: z.array(z.unknown()).catch([]),
  brief: z.string().optional().catch(undefined),
});

const pickSlug = (list: { slug: string | null }[], v: unknown) => (typeof v === "string" && list.some((o) => o.slug === v) ? v : undefined);

/** Keep only values the Director's Panel knows; everything else stays Auto. */
export function cleanSettings(raw: Record<string, unknown>): Partial<DirectorSettings> {
  const out: Partial<DirectorSettings> = {};
  const set = <K extends keyof DirectorSettings>(k: K, v: DirectorSettings[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("genre", pickSlug(GENRES, raw.genre));
  set("era", pickSlug(ERAS, raw.era));
  set("tempo", pickSlug(TEMPOS, raw.tempo));
  set("camera", pickSlug(CAMERA_BODIES, raw.camera));
  set("lens", pickSlug(LENSES, raw.lens));
  set("focal", pickSlug(FOCAL_LENGTHS, raw.focal));
  set("aperture", pickSlug(APERTURES, raw.aperture));
  const light = pickSlug(LIGHTING_PRESETS, raw.lighting);
  if (light) out.lighting = { kind: "preset", slug: light };
  const palette = typeof raw.palette === "string" && PALETTES.some((p) => p.slug === raw.palette) ? raw.palette : undefined;
  if (palette) out.palette = { kind: "preset", slug: palette };
  return out;
}

function cleanShot(raw: unknown): DirectorShot | null {
  const s = Shot.safeParse(raw);
  if (!s.success) return null;
  return {
    title: s.data.title.trim() || "Shot",
    prompt: s.data.prompt.trim(),
    duration: Math.max(DURATION.min, Math.min(DURATION.max, Math.round(s.data.duration || DURATION.default))),
    moves: s.data.moves.filter((m) => CAMERA_MOVES.some((c) => c.slug === m)).slice(0, 3),
    settings: cleanSettings(s.data.settings),
  };
}

/** The first {...} block of a model's answer (models sometimes wrap JSON in prose or fences). */
export function parseDirectorAnswer(text: string): { reply: string; shots: DirectorShot[]; brief?: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const a = Answer.parse(JSON.parse(text.slice(start, end + 1)));
    return { reply: a.reply.trim(), shots: a.shots.map(cleanShot).filter((s): s is DirectorShot => !!s).slice(0, 12), brief: a.brief?.trim() || undefined };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Offline breakdown (no LLM configured): keywords → look, sentences → beats.

const has = (t: string, ...words: string[]) => words.some((w) => new RegExp(`\\b${w}`, "i").test(t));

function guessLook(t: string, current: DirectorSettings): Partial<DirectorSettings> {
  const s: Partial<DirectorSettings> = {};
  if (has(t, "chase", "fight", "explosion", "heist", "escape", "race", "gun")) s.genre = "action";
  else if (has(t, "ghost", "haunt", "blood", "scream", "monster", "creep")) s.genre = "horror";
  else if (has(t, "detective", "crime", "noir", "smok", "cigarette", "rain")) s.genre = "noir";
  else if (has(t, "funny", "comed", "laugh", "prank", "awkward")) s.genre = "comedy";
  else if (has(t, "battle", "kingdom", "empire", "vast", "epic", "army", "desert")) s.genre = "epic";
  else if (has(t, "love", "tears", "goodbye", "family", "grief", "letter")) s.genre = "drama";
  if (has(t, "commercial", "perfume", "product", "advert", "music video", "trailer")) s.tempo = "dynamic";
  else if (s.genre === "action") s.tempo = "chaotic";
  else if (s.genre === "drama" || s.genre === "noir") s.tempo = "calm";
  if (has(t, "80s", "1980")) s.era = "1980s";
  else if (has(t, "60s", "1960")) s.era = "1960s";
  else if (has(t, "90s", "1990", "vhs")) s.era = "1990s";
  if (has(t, "night", "neon", "candle", "lamp", "bar", "club")) s.lighting = { kind: "preset", slug: "practicals" };
  else if (has(t, "sunset", "backlit", "golden hour", "dawn")) s.lighting = { kind: "preset", slug: "contre-jour" };
  else if (has(t, "window", "morning", "kitchen", "office")) s.lighting = { kind: "preset", slug: "window" };
  else if (s.genre === "horror") s.lighting = { kind: "preset", slug: "silhouette" };
  if (s.genre === "noir") s.palette = { kind: "preset", slug: "neon-rain-at-midnight" };
  else if (s.genre === "epic") s.palette = { kind: "preset", slug: "amber-wasteland" };
  else if (s.genre === "horror") s.palette = { kind: "preset", slug: "the-iron-borough" };
  else if (has(t, "perfume", "fashion", "luxury", "beauty")) s.palette = { kind: "preset", slug: "pink-velvet" };
  s.camera = current.camera ?? (s.era === "1990s" ? "dv-camcorder" : s.era ? "35mm-film" : "modern");
  s.lens = current.lens ?? (s.genre === "epic" || s.genre === "noir" ? "anamorphic" : "clean-sharp");
  // Keep what the user already chose on the panel.
  return { ...s, ...Object.fromEntries(Object.entries(current).filter(([k, v]) => v != null && k !== "emotions")) };
}

const FRAMES: { title: string; frame: string; moves: (t: string) => string[]; focal: string }[] = [
  { title: "Establishing", frame: "Wide establishing shot", moves: (t) => (has(t, "city", "landscape", "desert", "sea", "mountain") ? ["aerial-pullback"] : ["crane-down"]), focal: "24mm" },
  { title: "The action", frame: "Medium shot", moves: (t) => (has(t, "run", "chase", "walk", "drive", "ride") ? ["tracking"] : ["slider-right"]), focal: "35mm" },
  { title: "Close-up", frame: "Close-up", moves: () => ["dolly-in"], focal: "85mm" },
  { title: "Detail", frame: "Insert detail shot", moves: (t) => (has(t, "product", "perfume", "bottle", "watch") ? ["robot-arm"] : ["rack-focus"]), focal: "50mm" },
  { title: "Reaction", frame: "Over-the-shoulder shot", moves: () => ["static-shot"], focal: "50mm" },
  { title: "Turn", frame: "Low-angle medium shot", moves: (t) => (has(t, "fight", "chase", "escape") ? ["whip-pan"] : ["arc-right"]), focal: "35mm" },
  { title: "Reveal", frame: "High wide shot", moves: () => ["crane-up"], focal: "24mm" },
  { title: "Closing", frame: "Wide closing shot", moves: () => ["dolly-out"], focal: "35mm" },
];

/** "Generate an 8-shot storyboard for a sci-fi chase in Tokyo" → "a sci-fi chase in Tokyo". */
export function ideaOf(text: string): string {
  return text
    .trim()
    .replace(/^(please\s+)?(can you\s+)?(write|make|create|generate|give me|break( down)?|turn|draft|plan|storyboard|shoot|direct)\b\s*(me\s+)?/i, "")
    .replace(/^(an?|the)\s+/i, "")
    .replace(/\b\d+\s*[- ]?\s*(shots?|seconds?|secs?|s)\b[- ]?/gi, "")
    .replace(/^(cinematic\s+)?(storyboard|shot list|breakdown|sequence|scene list)\s+(for|of|about)\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
}

const STORY_BEATS = ["the world is introduced", "the action begins", "a closer look at the character", "a telling detail", "a reaction", "the turning point", "the reveal", "the resolution"];
const AD_BEATS = [
  "the world of the product, setting the mood",
  "the hero finds it",
  "the product up close, light catching every surface",
  "a sensory detail that sells the feeling",
  "a reaction: the pleasure of using it",
  "a bold, dynamic angle on the product",
  "the brand world revealed",
  "the final hero shot, product centred, room for the logo",
];

/** A script's lines (or sentences) are its beats; a one-line idea gets a shot structure around it. */
function beats(text: string, want?: number): { beat: string; frame?: number }[] {
  const body = text.replace(/^(please\s+)?(write|make|create|generate|break( down)?|turn)\b[^:\n]*:\s*/i, "").trim();
  const lines = body.split(/\n+/).map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()).filter((l) => l.length > 3);
  const parts = lines.length > 1 ? lines : body.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 3);
  if (parts.length > 1) return parts.slice(0, want ?? 12).map((beat) => ({ beat }));
  const idea = ideaOf(text);
  const ad = has(text, "commercial", "advert", "product", "perfume", "brand", "spot", "promo");
  const n = want ?? 4;
  const order = n <= 4 ? [0, 1, 2, 7].slice(0, n) : Array.from({ length: n }, (_, i) => i % FRAMES.length);
  return order.map((frame) => ({ beat: `${idea}, ${(ad ? AD_BEATS : STORY_BEATS)[frame]}`, frame }));
}

/** "Which lens should I use for a close-up?" — a question to answer, not an idea to storyboard. */
export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (t.includes("\n") || /\b(storyboard|shot list|break (it |this )?down|\d+[- ]?shots?)\b/i.test(t)) return false;
  // Requests ("Can you write a script about…?") and ideas ("What if a cat ran a bakery?") get the breakdown.
  if (/^(please\s+)?(can|could|would|will) you\s+(please\s+)?(write|make|create|generate|give|break|turn|draft|plan|storyboard|shoot|direct)\b/i.test(t) || /^(what if|how about)\b/i.test(t)) return false;
  return /\?\s*$/.test(t) || /^(what|which|how|why|when|where|should|shall|can|could|would|is|are|does|do)\b/i.test(t);
}

const TIPS: { when: RegExp; tip: string }[] = [
  {
    when: /\b(lens|focal|mm\b|close[- ]?up|portrait|wide angle|telephoto)/i,
    tip: "For a close-up, 85mm flatters faces and softens the background; 50mm feels natural, like the eye; 24–35mm keeps the room in frame for wides and movement. Pick it under Camera → Focal length — an anamorphic lens adds the oval bokeh and flares.",
  },
  {
    when: /\b(light|lighting|lit|shadow|exposure|backlight|silhouette)/i,
    tip: "Start from the story's mood: Window light for soft, honest drama; Practicals (lamps, neon, candles in frame) for night interiors; Contre-jour for a backlit, hopeful glow; Silhouette or hard top light for menace. Set it under Lighting, or build your own two-light rig.",
  },
  {
    when: /\b(move|movement|camera move|dolly|pan|tilt|crane|tracking|handheld|orbit|zoom)/i,
    tip: "Move with intent: a slow dolly-in builds tension or intimacy, tracking follows action, a crane reveals the world, a static shot lets the acting breathe. Type # in the prompt to add moves — chain two at most per shot.",
  },
  {
    when: /\b(colou?r|palette|grade|tone|look)\b/i,
    tip: "A palette carries the genre: teal and amber for modern thrillers, desaturated steel for war and horror, warm pastels for romance. Pick one under Palette (or pull one from a frame you like) — on the open engine, Palette lock grades every take to it.",
  },
  {
    when: /\b(aperture|depth of field|bokeh|f\/?\d|blur)/i,
    tip: "Open the aperture (f/1.4–f/2) to isolate a face against a soft background; stop down (f/8 and up) to keep a whole room sharp. Set it under Camera → Aperture.",
  },
  {
    when: /\b(how long|duration|seconds|length|pacing|tempo|cut)/i,
    tip: "Most shots land at 4–8 seconds: shorter for action and commercials, longer for dialogue and mood. Tempo in Film setup decides how fast the cuts come; Extend makes a take longer without losing continuity.",
  },
];

/** A short, practical answer to a craft question, without a storyboard. */
function answerQuestion(text: string): string {
  const tip = TIPS.find((x) => x.when.test(text))?.tip;
  return (
    tip ??
    "Tell me the scene and the feeling you're after and I'll suggest the camera, lens, light and palette — or ask for a storyboard (“break this into 6 shots”) and I'll write the shots for you."
  );
}

/** "an action look", "a noir look". */
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

export function offlineDirector(text: string, project: Pick<CinemaProject, "brief" | "director">): { reply: string; shots: DirectorShot[]; brief?: string } {
  if (isQuestion(text)) return { reply: answerQuestion(text), shots: [] };
  const t = `${text} ${project.brief.body}`;
  if (/\bbrief\b/i.test(text) && !/\bshots?\b|storyboard|script/i.test(text)) {
    const look = guessLook(t, project.director);
    const summary = directorSummary(look as DirectorSettings).join(", ");
    const brief = [
      `Context: ${text.replace(/^(please\s+)?(write|draft|make)\s+(me\s+)?(a\s+)?(project\s+)?brief\s*(for|about)?\s*:?\s*/i, "").trim() || "Describe the production here."}`,
      `Look: ${summary || "decide genre, era, camera and palette on the Director's Panel"}.`,
      "Do: keep characters and locations as @elements so they stay the same in every shot; one idea per shot.",
      "Don't: change wardrobe, time of day or grade between shots of the same scene unless the story asks for it.",
    ].join("\n");
    return { reply: "Here's a starting brief. Apply it to the project, then edit it as you like.", shots: [], brief };
  }
  const idea = ideaOf(text);
  if (!text.includes("\n") && (!idea || /^(script|story|film|movie|scene|something)$/i.test(idea))) {
    return {
      reply: "What's the film about? Give me a line or two — a character, a place, what goes wrong — or paste your script, and I'll break it into shots with the camera, light and palette filled in.",
      shots: [],
    };
  }
  const count = /(\d+)\s*[- ]?\s*shots?/i.exec(text)?.[1];
  const seconds = /(\d+)\s*[- ]?\s*(s|sec|second)s?\b/i.exec(text)?.[1];
  const parts = beats(text, count ? Math.max(1, Math.min(12, Number(count))) : undefined);
  const each = seconds ? Math.max(DURATION.min, Math.min(DURATION.max, Math.round(Number(seconds) / parts.length))) : DURATION.default;
  const look = guessLook(t, project.director);
  const shots = parts.map(({ beat, frame }, i): DirectorShot => {
    const f = FRAMES[frame ?? (parts.length <= 4 ? [0, 1, 2, 7][i] : i % FRAMES.length)] ?? FRAMES[i % FRAMES.length];
    return {
      title: `${i + 1}. ${f.title}`,
      prompt: `${f.frame}: ${beat.replace(/[.\s]+$/, "")}`,
      duration: each,
      moves: f.moves(beat),
      settings: { ...look, focal: project.director.focal ?? f.focal },
    };
  });
  const genre = look.genre ? GENRES.find((g) => g.slug === look.genre)?.name.toLowerCase() : undefined;
  return {
    reply: `Here's a ${shots.length}-shot breakdown${genre ? ` with ${article(genre)} ${genre} look` : ""}. Load a shot into the prompt bar to review it — nothing renders until you press Generate.`,
    shots,
  };
}

/** An LLM's plain-text answer, without code fences, trimmed to a chat message. */
export function prose(raw: string): string {
  return raw
    .replace(/```[a-z]*\n?/gi, "")
    .trim()
    .slice(0, 4000);
}

function settingsLine(s: DirectorSettings): string {
  const d = directorSummary(s);
  return d.length ? d.join(", ") : "all Auto";
}

/** Add the user's message, ask the Director, store and return the whole conversation. */
export async function askDirector(projectId: string, text: string): Promise<DirectorMessage[]> {
  const project = getProject(projectId);
  if (!project) throw new CinemaError("Project not found", 404);
  const user: DirectorMessage = { id: nanoid(8), role: "user", text: text.trim().slice(0, 8000), createdAt: Date.now() };
  const history = getChat(projectId).slice(-8);
  const context = [
    project.brief.body.trim() ? `Project brief:\n${project.brief.body.trim().slice(0, 4000)}` : "Project brief: (empty)",
    `Project: ${project.name}${project.description ? ` — ${project.description}` : ""}`,
    `Current Director's Panel: ${settingsLine(project.director)}`,
    history.length ? `Recent conversation:\n${history.map((m) => `${m.role === "user" ? "User" : "Director"}: ${m.text}${m.shots?.length ? ` [${m.shots.length} shots]` : ""}`).join("\n")}` : "",
    `User: ${user.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = (await llmText(SYSTEM, context, { json: ANSWER_SCHEMA }).catch(() => null))?.trim() || null;
  const parsed = raw ? parseDirectorAnswer(raw) : null;
  const answer =
    parsed && (parsed.reply || parsed.shots.length || parsed.brief)
      ? { ...parsed, source: "llm" as const }
      : raw && !parsed
        ? // The model answered in prose (no JSON): that's still its answer.
          { reply: prose(raw), shots: [], source: "llm" as const }
        : { ...offlineDirector(user.text, project), source: "offline" as const };
  const reply: DirectorMessage = {
    id: nanoid(8),
    role: "assistant",
    text: answer.reply || (answer.shots.length ? `${answer.shots.length} shots, ready to review.` : "Done."),
    ...(answer.shots.length ? { shots: answer.shots } : {}),
    ...(answer.brief ? { brief: answer.brief } : {}),
    source: answer.source,
    createdAt: Date.now() + 1,
  };
  return appendChat(projectId, user, reply);
}
