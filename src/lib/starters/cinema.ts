import "server-only";
import type { DirectorShot } from "@/lib/catalog/cinema";
import type { Starter } from "./catalog";

const shot = (title: string, prompt: string, moves: string[], duration = 5): DirectorShot => ({ title, prompt, duration, moves, settings: {} });

/** The brief's words: the film in one line, then its shots. */
const brief = (logline: string, shots: DirectorShot[]) => `${logline}\n\n${shots.map((s, i) => `${i + 1}. ${s.title}: ${s.prompt}`).join("\n")}`;

const RIVIERA = [
  shot(
    "Wide, the terrace",
    "A fashion model in a long emerald silk gown walks out of a Monte Carlo casino onto the terrace at blue hour, warm lamps along the stone balustrade, the harbour lights glittering below.",
    ["dolly-in"],
  ),
  shot("Close-up, the turn", "Close-up of the model in the emerald silk gown as she turns to the lens, the warm terrace lamps catching her face and her diamond earrings, the harbour soft behind her.", ["arc-left"]),
  shot(
    "Medium, the drive",
    "The model in the emerald silk gown steps into a silver vintage convertible and drives off along the coast road at blue hour, the lights of Monaco glowing below the cliffs.",
    ["tracking"],
  ),
];

const NOIR = [
  shot("Wide, the street", "A fashion model in a black satin trench coat walks a rain-slick Paris street at night, the shop windows and street lamps shining in the wet cobbles.", ["tracking"]),
  shot("Close-up, the bottle", "Close-up of her gloved hand lifting a matte black perfume bottle with a gold cap into the lamplight, raindrops glittering behind it.", ["slow-zoom-in"]),
  shot("Wide, the doorway", "The model in the black satin trench coat walks into a glowing hotel doorway, the rain shining in the golden light behind her.", ["dolly-out"]),
];

const DESERT = [
  shot("Aerial, the dune", "Aerial shot of a fashion model in flowing saffron silk standing on the crest of a vast Sahara dune at sunrise, long ripples of sand glowing gold around her.", ["crane-up"]),
  shot("Tracking, the ridge", "The saffron silk streams behind the model as she walks along the sharp ridge of the dune, the low sun turning the sand to copper.", ["side-tracking"]),
  shot("Close-up, the look back", "Close-up of the model looking back at the lens over her shoulder, the rising sun behind her lighting the edge of her saffron silk veil.", ["slow-zoom-in"]),
];

/**
 * Cinema Studio's starters: a project with its look (genre, camera, lens, light, palette), its brief and three shots
 * the AI Director proposes; it opens with shot 1 in the prompt bar. Every slug and move is checked against the
 * catalog (tests/starters-catalog.test.ts).
 */
export const CINEMA_STARTERS: Starter[] = [
  {
    id: "cinema.riviera-night",
    surface: "cinema",
    rank: 1,
    name: "Riviera night",
    description: "A three-shot fashion film on the Côte d'Azur at blue hour",
    icon: "Moon",
    hue: 160,
    flow: ["Look", "3 shots", "Film"],
    steps: [
      "The look is set: drama, 35mm film, anamorphic lens, warm practical lamps and a blue-hour palette.",
      "Shot 1: she walks out of the casino onto the terrace, the harbour lights below.",
      "Shot 2: she turns to the lens as the terrace lamps catch her face.",
      "Shot 3: she drives off in a silver vintage convertible along the coast road.",
    ],
    makes: "A short fashion film in three shots, each about 5 seconds.",
    words: RIVIERA.map((s, i) => ({ label: `Shot ${i + 1}`, text: s.prompt })),
    seed: {
      kind: "cinema",
      project: { name: "Riviera night", description: "A three-shot fashion film on the Côte d'Azur at blue hour" },
      director: {
        genre: "drama",
        era: "2020s",
        tempo: "calm",
        camera: "35mm-film",
        lens: "anamorphic",
        aperture: "f14-wide-open",
        lighting: { kind: "preset", slug: "practicals" },
        palette: { kind: "preset", slug: "twilight-fable" },
      },
      brief: { title: "Riviera night", body: brief("A model in an emerald silk gown leaves the casino at blue hour and drives off along the coast.", RIVIERA) },
      shots: RIVIERA,
    },
  },
  {
    id: "cinema.noir-perfume",
    surface: "cinema",
    rank: 2,
    name: "Nuit Noire",
    description: "A noir perfume film in three shots on a rainy Paris night",
    icon: "Gem",
    hue: 270,
    flow: ["Look", "3 shots", "Film"],
    steps: [
      "The look is set: noir, a clean modern lens and light from behind.",
      "Shot 1: she walks a rain-slick Paris street at night.",
      "Shot 2: her gloved hand lifts the black bottle into the lamplight.",
      "Shot 3: she walks into a glowing hotel doorway.",
    ],
    makes: "A perfume film in three shots, each about 5 seconds.",
    words: NOIR.map((s, i) => ({ label: `Shot ${i + 1}`, text: s.prompt })),
    seed: {
      kind: "cinema",
      project: { name: "Nuit Noire", description: "A noir perfume film in three shots on a rainy Paris night" },
      director: {
        genre: "noir",
        tempo: "calm",
        camera: "modern",
        lens: "clean-sharp",
        lighting: { kind: "preset", slug: "contre-jour" },
        // Deep blacks and muted gold: the night, the rain and the bottle's cap.
        palette: { kind: "preset", slug: "oil-ochre" },
      },
      brief: { title: "Nuit Noire", body: brief("A model in a black satin trench walks through the Paris rain with a matte black perfume bottle.", NOIR) },
      shots: NOIR,
    },
  },
  {
    id: "cinema.desert-couture",
    surface: "cinema",
    rank: 3,
    name: "Desert couture",
    description: "An epic three-shot couture film on the Sahara dunes at sunrise",
    icon: "Sun",
    hue: 35,
    flow: ["Look", "3 shots", "Film"],
    steps: [
      "The look is set: epic, an anamorphic lens, silhouette light and an ochre palette.",
      "Shot 1: from the air, she stands on the crest of a vast dune at sunrise.",
      "Shot 2: the saffron silk streams behind her as she walks the ridge.",
      "Shot 3: she looks back at the lens, the sun behind her.",
    ],
    makes: "A couture film in three shots, each about 5 seconds.",
    words: DESERT.map((s, i) => ({ label: `Shot ${i + 1}`, text: s.prompt })),
    seed: {
      kind: "cinema",
      project: { name: "Desert couture", description: "An epic three-shot couture film on the Sahara dunes at sunrise" },
      director: {
        genre: "epic",
        tempo: "calm",
        camera: "modern",
        lens: "anamorphic",
        lighting: { kind: "preset", slug: "silhouette" },
        palette: { kind: "preset", slug: "oil-ochre" },
      },
      brief: { title: "Desert couture", body: brief("A model in flowing saffron silk on the Sahara dunes at sunrise.", DESERT) },
      shots: DESERT,
    },
  },
];
