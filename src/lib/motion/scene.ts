/**
 * The scene contract (pure). A scene turns a recipe into a plan once (its text laid out, its timeline built), and the
 * plan gives the display list at any absolute time. Nothing in a scene reads a clock, the DOM or Math.random: the same
 * recipe and time always give the same picture, in any order of seeks.
 */

import type { DisplayList, Matrix } from "./display";
import type { Measure } from "./layout";
import type { Recipe } from "./recipe";
import type { SizeSpec } from "./sizes";
import type { MotionEvent, Timeline } from "./tween";

/** An SVG logo's outlines, read from the file before the scene runs (the drawer's DOM does it). */
export interface LogoPath {
  d: string;
  /** From the path's own units to the SVG's viewBox units. */
  m: Matrix;
  /** Its length in its own units. */
  length: number;
}

export interface LogoInfo {
  /** Its natural size. */
  w: number;
  h: number;
  kind: "svg" | "raster";
  /** Outlines a stroke can trace (SVG logos with at least one). */
  paths?: LogoPath[];
  viewBox?: { x: number; y: number; w: number; h: number };
}

/** What a scene is given besides the recipe: sizes known before it runs, never elements. */
export interface SceneInput {
  recipe: Recipe;
  measure: Measure;
  logo: LogoInfo | null;
  /** The pictures' natural sizes by key ("product"). */
  images?: Record<string, { w: number; h: number }>;
  /** A cut-out picture's outline by key (traced from its transparency; null: it has none, so it gets a frame). */
  outlines?: Record<string, Outline | null>;
  /** The person's clips by key ("clip"): their size and length, known before planning (Kinetic's video layer). */
  clips?: Record<string, { w: number; h: number; duration: number }>;
}

/** A cut-out's outer edge, traced from its transparency (outline.ts), in the traced grid's units. */
export interface Outline {
  /** The grid it was traced on (the picture scaled to it). */
  w: number;
  h: number;
  /** A closed smooth path, starting at its lowest point and going round. */
  d: string;
  length: number;
  /** Where the path starts (its lowest point). */
  start: [number, number];
}

export interface ScenePlan {
  /** Design units. */
  design: { w: number; h: number };
  timeline: Timeline;
  /** The last frame's time: everything is set and the camera is home. The frame there is the poster. */
  rest: number;
  /** Every element is in place by then (only a slow camera move may follow). */
  settled: number;
  /** A moment that shows what sets this scene apart (a chooser's still picture of it); the rest frame when absent. */
  signature?: number;
  /** Times where the picture cuts (motion blur never mixes across one). */
  cuts: number[];
  /** Typed fields that don't fit even at their smallest size: the page asks for shorter words, and nothing renders. */
  overflow: string[];
  evaluate(t: number): DisplayList;
  /** Nothing moves at `t` (a held frame needs no motion blur samples). */
  still(t: number): boolean;
}

export interface Scene {
  id: string;
  name: string;
  durations: { min: number; max: number; default: number };
  sizes: SizeSpec[];
  plan(input: SceneInput): ScenePlan;
}

export const events = (plan: ScenePlan): MotionEvent[] => plan.timeline.events;
