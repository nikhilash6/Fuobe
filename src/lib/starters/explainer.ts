/**
 * Explainer's ready explainers: a topic, a style, a length and a voice, filled into the form. Server only, listed in
 * catalog.ts.
 */
import "server-only";
import type { Starter } from "./catalog";

export const EXPLAINER_STARTERS: Starter[] = [
  {
    id: "ex.couture-400-hours",
    surface: "explainer",
    rank: 1,
    name: "A couture gown in 400 hours",
    description: "How a couture gown takes 400 hours to make, in editorial motion graphics",
    icon: "Scissors",
    hue: 265,
    flow: ["Topic", "Script", "Video"],
    steps: ["The topic, the style and the length are set.", "A script is written to explain it, scene by scene.", "Each scene gets a picture, motion and a calm narrator, then subtitles and music."],
    makes: "A 1-minute explainer video with narration and subtitles, in 16:9.",
    words: [
      { label: "What it explains", text: "How a couture gown takes 400 hours to make" },
      { label: "Style", text: "Editorial motion graphics" },
    ],
    seed: { kind: "fill", fill: { kind: "explainer", prompt: "How a couture gown takes 400 hours to make", styleId: "editorial-motion-graphics", duration: 60, aspect: "16:9", voice: "pFZP5JQG7iQjIQuC4Bku" } },
  },
  {
    id: "ex.riviera-light",
    surface: "explainer",
    rank: 2,
    name: "The golden Riviera light",
    description: "Why the light on the French Riviera looks golden, painted in watercolour",
    icon: "Sun",
    hue: 45,
    flow: ["Topic", "Script", "Video"],
    steps: ["The topic, the style and the length are set.", "A script is written to explain it, scene by scene.", "Each scene gets a picture, motion and a narrator, then subtitles and music."],
    makes: "A 45-second explainer video with narration and subtitles, in 16:9.",
    words: [
      { label: "What it explains", text: "Why the light on the Riviera looks golden" },
      { label: "Style", text: "Watercolour chronicle" },
    ],
    seed: { kind: "fill", fill: { kind: "explainer", prompt: "Why the light on the Riviera looks golden", styleId: "watercolor-chronicle", duration: 45, aspect: "16:9" } },
  },
  {
    id: "ex.perfume-notes",
    surface: "explainer",
    rank: 3,
    name: "A perfume's notes, explained",
    description: "A perfume's top, heart and base notes, in clean studio-lit 3D",
    icon: "FlaskConical",
    hue: 250,
    flow: ["Topic", "Script", "Video"],
    steps: ["The topic, the style and the length are set.", "A script is written to explain it, scene by scene.", "Each scene gets a picture, motion and a narrator, then subtitles and music."],
    makes: "A 45-second explainer video with narration and subtitles, in 16:9.",
    words: [
      { label: "What it explains", text: "A perfume's top, heart and base notes, explained" },
      { label: "Style", text: "Studio 3D" },
    ],
    seed: { kind: "fill", fill: { kind: "explainer", prompt: "A perfume's top, heart and base notes, explained", styleId: "studio-3d", duration: 45, aspect: "16:9" } },
  },
];
