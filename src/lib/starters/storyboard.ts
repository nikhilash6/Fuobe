import "server-only";
import type { Starter } from "./catalog";

const PERFUME =
  "Nuit Noire perfume ad. A model in a black satin gown on a Paris balcony at night; a close-up of her hand lifting the matte black bottle; the gold cap catching the light; she sprays it and the mist glitters in the street light; she walks down a glowing hotel corridor; the bottle on black marble with the city lights behind it.";

const HEIST =
  "A jewel heist in Paris at night. A model in a black trench coat crouches on a zinc rooftop above the glowing boulevards; a close-up as she checks a slim gold watch on her gloved wrist; she lowers herself on a rope through a glass skylight into a dark jewellery salon; she lifts a diamond necklace from a glowing display case; she runs along a rain-slick street past glowing café terraces; she smiles in the back of a black vintage car, the Eiffel Tower glowing through the rear window.";

const CAPRI =
  "A swimwear campaign on Capri: a model in a white one-piece on the rocks at sunrise; diving into turquoise water; laughing on a yacht deck; walking a cliff path in a linen shirt at golden hour.";

/**
 * Storyboard's starters: a story, its frame count, its shape and its look, put into the composer for everyone (the
 * price shows at once; Generate runs it for the owner).
 */
export const STORYBOARD_STARTERS: Starter[] = [
  {
    id: "storyboard.perfume-ad",
    surface: "storyboard",
    rank: 1,
    name: "Perfume ad in 6 frames",
    description: "A night in Paris with a black perfume bottle, from the balcony to black marble",
    icon: "Gem",
    hue: 40,
    flow: ["Story", "6 frames"],
    steps: [
      "The story is split into six frames.",
      "Frame 1 sets the model, the gown and the night light.",
      "Each next frame is made from the one before, so her face and the gown carry through.",
    ],
    makes: "Six 16:9 frames of one perfume ad, ready to animate into a film.",
    words: [{ label: "The story", text: PERFUME }],
    seed: { kind: "storyboard", story: PERFUME, frames: 6, aspectRatio: "16:9", look: "v1-quiet-luxury" },
  },
  {
    id: "storyboard.heist",
    surface: "storyboard",
    rank: 2,
    name: "A heist in Paris",
    description: "Six frames of a jewel heist, from the rooftops to a getaway car",
    icon: "Moon",
    hue: 230,
    flow: ["Story", "6 frames"],
    steps: ["The story is split into six frames.", "Frame 1 sets the model on the rooftop at night.", "Each next frame is made from the one before, so she stays the same."],
    makes: "Six 16:9 frames of one heist, ready to animate into a film.",
    words: [{ label: "The story", text: HEIST }],
    coverOf: { template: "examples/storyboard-heist" },
    seed: { kind: "storyboard", story: HEIST, frames: 6, aspectRatio: "16:9" },
  },
  {
    id: "storyboard.capri-swim",
    surface: "storyboard",
    rank: 3,
    name: "Swimwear on Capri",
    description: "Four vertical frames of a swimwear campaign, from sunrise to golden hour",
    icon: "Sun",
    hue: 190,
    flow: ["Story", "4 frames"],
    steps: ["The story is split into four frames.", "Frame 1 sets the model on the rocks at sunrise.", "Each next frame is made from the one before, in warm film colour."],
    makes: "Four 9:16 frames for phones, ready to animate into a film.",
    words: [{ label: "The story", text: CAPRI }],
    seed: { kind: "storyboard", story: CAPRI, frames: 4, aspectRatio: "9:16", look: "v2-warm-vivid-film" },
  },
];
