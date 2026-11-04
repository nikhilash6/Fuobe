/**
 * Faceless Studio's ready channels: a channel, its first episode's topic and its look (the owner's "Use template" makes
 * the channel and opens its first episode, src/server/starters.ts). Server only, listed in catalog.ts.
 */
import "server-only";
import type { Starter } from "./catalog";

export const FACELESS_STARTERS: Starter[] = [
  {
    id: "faceless.boat-hotels",
    surface: "faceless",
    rank: 1,
    name: "Hotels you reach by boat",
    description: "A calm luxury travel channel. Episode 1: five hotels you can only reach by boat",
    icon: "Sailboat",
    hue: 200,
    flow: ["Idea", "Script", "Episode"],
    steps: [
      "The channel is set up with its idea, its name and its look.",
      "Episode 1's topic is ready: five hotels you can only reach by boat.",
      "A script is written scene by scene, for you to read and change.",
      "Each scene gets a picture, motion, a narrator and music, then the film is put together with subtitles.",
    ],
    makes: "A 1-minute narrated episode with subtitles, and a channel ready for the next one.",
    words: [
      { label: "Channel idea", text: "Channel about the world's most beautiful hotels you can only reach by boat" },
      { label: "Episode 1", text: "Five hotels you can only reach by boat" },
      { label: "Look", text: "Editorial motion graphics: layered photo cutouts, clean labels and documentary pacing." },
    ],
    seed: {
      kind: "faceless",
      channel: { idea: "Channel about the world's most beautiful hotels you can only reach by boat", genre: "education", name: "Only by Boat" },
      episode: { topic: "Five hotels you can only reach by boat", styleId: "editorial-motion-graphics", length: 60 },
    },
  },
  {
    id: "faceless.couture-icons",
    surface: "faceless",
    rank: 2,
    name: "Dresses that changed fashion",
    description: "A fashion history channel in paper collage. Episode 1: the little black dress",
    icon: "Shirt",
    hue: 330,
    flow: ["Idea", "Script", "Episode"],
    steps: [
      "The channel is set up with its idea, its name and its look.",
      "Episode 1's topic is ready: the little black dress, from 1926 to today.",
      "A script is written scene by scene, for you to read and change.",
      "Each scene gets a picture, motion, a narrator and music, then the film is put together with subtitles.",
    ],
    makes: "A 1-minute narrated episode with subtitles, and a channel ready for the next one.",
    words: [
      { label: "Channel idea", text: "Channel about the dresses that changed fashion" },
      { label: "Episode 1", text: "The little black dress: from 1926 to today" },
      { label: "Look", text: "Paper collage: layered magazine cutouts with torn edges and halftone print texture." },
    ],
    seed: {
      kind: "faceless",
      channel: { idea: "Channel about the dresses that changed fashion", genre: "history", name: "Couture Icons" },
      episode: { topic: "The little black dress: from 1926 to today", styleId: "paper-collage", length: 60 },
    },
  },
  {
    id: "faceless.lost-empires",
    surface: "faceless",
    rank: 3,
    name: "Lost empires of the sea",
    description: "Ancient Mediterranean history in watercolour. Episode 1: the rise and fall of the Minoans",
    icon: "Landmark",
    hue: 30,
    flow: ["Idea", "Script", "Episode"],
    steps: [
      "The channel is set up with its idea, its name and its look.",
      "Episode 1's topic is ready: the rise and fall of the Minoans.",
      "A script is written scene by scene, for you to read and change.",
      "Each scene gets a picture, motion, a narrator and music, then the film is put together with subtitles.",
    ],
    makes: "A 1-minute narrated episode with subtitles, and a channel ready for the next one.",
    words: [
      { label: "Channel idea", text: "Channel about the lost empires of the Mediterranean" },
      { label: "Episode 1", text: "The rise and fall of the Minoans" },
      { label: "Look", text: "Watercolour chronicle: loose painterly washes on textured paper, cinematic framing." },
    ],
    seed: {
      kind: "faceless",
      channel: { idea: "Channel about the lost empires of the Mediterranean", genre: "history", name: "Lost Empires" },
      episode: { topic: "The rise and fall of the Minoans", styleId: "watercolor-chronicle", length: 60 },
    },
  },
];
