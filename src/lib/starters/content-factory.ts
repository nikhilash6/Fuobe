/**
 * Content Factory's ready series: a trending style and an idea, filled into the composer. Server only, listed in
 * catalog.ts.
 */
import "server-only";
import type { Starter } from "./catalog";

export const CONTENT_FACTORY_STARTERS: Starter[] = [
  {
    id: "cf.underwater-fashion-week",
    surface: "content-factory",
    rank: 1,
    name: "Fashion week, underwater",
    description: "What if Paris fashion week was held underwater? Quick glossy 3D scenes, vertical",
    icon: "Waves",
    hue: 200,
    flow: ["Style", "Idea", "Short"],
    steps: ["The style is set: an impossible question, answered in quick 3D scenes.", "The idea is in: what if Paris fashion week was held underwater?", "A script, a narrator, pictures, motion, music and captions are made in that style."],
    makes: "A 30-second vertical short with narration, music and captions.",
    words: [
      { label: "Style", text: "What if…? An impossible question, answered in quick 3D scenes." },
      { label: "Make a video about", text: "What if Paris fashion week was held underwater?" },
    ],
    seed: { kind: "fill", fill: { kind: "content-factory", presetId: "what-if", prompt: "What if Paris fashion week was held underwater?", length: 30, episodes: 1 } },
  },
  {
    id: "cf.perfume-atelier",
    surface: "content-factory",
    rank: 2,
    name: "A perfume atelier in a bottle",
    description: "A tiny perfume atelier inside a crystal bottle, in miniature close-ups",
    icon: "FlaskConical",
    hue: 40,
    flow: ["Style", "Idea", "Short"],
    steps: ["The style is set: a tiny world, filmed in miniature close-ups.", "The idea is in: a tiny perfume atelier inside a crystal bottle.", "A script, a narrator, pictures, motion, music and captions are made in that style."],
    makes: "A 30-second vertical short with narration, music and captions.",
    words: [
      { label: "Style", text: "Tiny worlds: a miniature world, filmed up close." },
      { label: "Make a video about", text: "A tiny perfume atelier inside a crystal bottle" },
    ],
    seed: { kind: "fill", fill: { kind: "content-factory", presetId: "tiny-worlds", prompt: "A tiny perfume atelier inside a crystal bottle", length: 30, episodes: 1 } },
  },
  {
    id: "cf.narcissus",
    surface: "content-factory",
    rank: 3,
    name: "Narcissus, the supermodel",
    description: "The myth of Narcissus, retold as the story of a modern supermodel",
    icon: "Gem",
    hue: 280,
    flow: ["Style", "Idea", "Short"],
    steps: ["The style is set: an old myth, retold for today.", "The idea is in: Narcissus as a modern supermodel.", "A script, a narrator, pictures, motion, music and captions are made in that style."],
    makes: "A 30-second vertical short with narration, music and captions.",
    words: [
      { label: "Style", text: "Myth retold: an ancient story, told for today." },
      { label: "Make a video about", text: "Narcissus retold as a modern supermodel" },
    ],
    seed: { kind: "fill", fill: { kind: "content-factory", presetId: "myth-retold", prompt: "Narcissus retold as a modern supermodel", length: 30, episodes: 1 } },
  },
];
