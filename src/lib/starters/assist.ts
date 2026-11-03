import "server-only";
import type { Starter } from "./catalog";

const JEWEL =
  "A campaign for an emerald and diamond necklace: a hero still of a model in a black velvet gown wearing it in a candlelit palace hall, a close-up still of the necklace on her collarbone catching the candlelight, then animate the hero still into a slow 5-second push-in.";

/**
 * Assist's starters: one whole job each, in words that need nothing else (no photo to attach), with the skill that
 * does it when one fits. The owner's tap types it into a new chat's composer (nothing is sent); a guest or an account
 * gets its page.
 */
export const ASSIST_STARTERS: Starter[] = [
  {
    id: "assist.jewel-campaign",
    surface: "assist",
    rank: 1,
    name: "Emerald necklace campaign",
    description: "Two stills of a model in an emerald necklace in a candlelit palace, then a slow film",
    icon: "Gem",
    hue: 150,
    flow: ["Plan", "Stills", "Film"],
    steps: [
      "Assist plans the shoot and shows you the cost before anything runs.",
      "A hero still of a model in a black velvet gown wearing the necklace in a candlelit palace hall.",
      "A close-up of the necklace on her collarbone, the emeralds catching the candlelight.",
      "The hero still turns into a slow 5-second push-in.",
    ],
    makes: "Two campaign stills and a 5-second film of the necklace.",
    words: [{ label: "The brief", text: JEWEL }],
    seed: { kind: "assist", prompt: JEWEL },
  },
  {
    id: "assist.monaco-short",
    surface: "assist",
    rank: 2,
    name: "One night in Monaco",
    description: "A 30-second short film in four shots, from the casino steps to fireworks over the harbour",
    icon: "Clapperboard",
    hue: 160,
    flow: ["Story", "Shots", "Film"],
    steps: [
      "Assist breaks the story into four shots and shows you the cost.",
      "A woman in an emerald silk gown leaves the casino at blue hour.",
      "She drives a silver vintage convertible along the coast road.",
      "She stops at a cliff overlook as fireworks open over the harbour, and the shots are joined into one film.",
    ],
    makes: "A 30-second film in four shots.",
    words: [
      {
        label: "The story",
        text: "A 30-second short film in 4 shots: a woman in an emerald silk gown leaves a Monte Carlo casino at blue hour, steps into a silver vintage convertible, drives the coast road, and stops at a cliff overlook as fireworks open over the harbour.",
      },
    ],
    // The same night on the Riviera as Cinema Studio's first film, until its own cover is made.
    coverOf: { template: "starters/cinema.riviera-night" },
    seed: {
      kind: "assist",
      skill: "short-film",
      prompt:
        "A 30-second short film in 4 shots: a woman in an emerald silk gown leaves a Monte Carlo casino at blue hour, steps into a silver vintage convertible, drives the coast road, and stops at a cliff overlook as fireworks open over the harbour.",
    },
  },
  {
    id: "assist.linen-lookbook",
    surface: "assist",
    rank: 3,
    name: "Linen capsule lookbook",
    description: "Six stills of one model in cream linen on a Capri terrace at golden hour",
    icon: "Shirt",
    hue: 30,
    flow: ["Plan", "6 stills"],
    steps: [
      "Assist plans six stills of the same model and shows you the cost.",
      "Full length, walking, seated on a stone bench, a close-up of the fabric, laughing over her shoulder, and a wide with the sea.",
      "Every still keeps her face, the collection and the golden light.",
    ],
    makes: "Six lookbook stills of one model on a Capri terrace.",
    words: [
      {
        label: "The brief",
        text: "Six lookbook stills of one model in a cream linen capsule collection on a Capri terrace at golden hour: full length, walking, seated on a stone bench, a close-up of the fabric, laughing over her shoulder, and a wide with the sea.",
      },
    ],
    seed: {
      kind: "assist",
      prompt:
        "Six lookbook stills of one model in a cream linen capsule collection on a Capri terrace at golden hour: full length, walking, seated on a stone bench, a close-up of the fabric, laughing over her shoulder, and a wide with the sea.",
    },
  },
  {
    id: "assist.serum-ugc",
    surface: "assist",
    rank: 4,
    name: "Serum video, creator style",
    description: "A 15-second vertical video of a model showing a glass serum bottle to her phone",
    icon: "Droplet",
    hue: 200,
    flow: ["Script", "Video"],
    steps: [
      "Assist writes the shot and the line she says.",
      "A model in a white robe in a marble bathroom shows the serum bottle to her phone camera.",
      "She applies one drop and says the line, in soft daylight.",
    ],
    makes: "A 15-second vertical video with her voice.",
    words: [
      {
        label: "The brief",
        text: "A 15-second vertical creator video: a model in a white robe in a marble bathroom shows a glass serum bottle to her phone camera, applies one drop and says: 'Three weeks in, and my skin feels calm and glowing.' Soft daylight.",
      },
    ],
    seed: {
      kind: "assist",
      prompt:
        "A 15-second vertical creator video: a model in a white robe in a marble bathroom shows a glass serum bottle to her phone camera, applies one drop and says: 'Three weeks in, and my skin feels calm and glowing.' Soft daylight.",
    },
  },
  {
    id: "assist.boat-hotels",
    surface: "assist",
    rank: 5,
    name: "Travel short with narration",
    description: "A 45-second video about five hotels you can only reach by boat, with calm narration",
    icon: "Ship",
    hue: 190,
    flow: ["Script", "Voice", "Video"],
    steps: [
      "Assist writes a 45-second script about five hotels you can only reach by boat.",
      "A calm voice reads it over cinematic drone shots.",
      "Gentle piano plays under it all.",
    ],
    makes: "A 45-second travel video with narration and music.",
    words: [{ label: "The brief", text: "A 45-second video for a luxury travel channel, 'Five hotels you can only reach by boat': cinematic drone shots over turquoise water and island hotels, a calm voice telling the story, gentle piano." }],
    // The same channel as Faceless Studio's first, until its own cover is made.
    coverOf: { template: "starters/faceless.boat-hotels" },
    seed: {
      kind: "assist",
      skill: "faceless-video",
      prompt: "A 45-second video for a luxury travel channel, 'Five hotels you can only reach by boat': cinematic drone shots over turquoise water and island hotels, a calm voice telling the story, gentle piano.",
    },
  },
];
