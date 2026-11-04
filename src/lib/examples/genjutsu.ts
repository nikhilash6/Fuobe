/**
 * A Genjutsu mode's example (its card under the mode's title): which one a viewer sees, the settings it shows, and the
 * rules that make "Use this example" exact. The recipe is a setup (src/lib/catalog/genjutsu.ts) with the seed, the part's
 * length and the original sound, and none of the fields that describe the example's own clip or photos: those are the
 * viewer's to give. Client-safe: the catalog (catalog.ts) checks every row with these same rules when it is built.
 */
import { CHARACTER_SWAP } from "@/lib/catalog/character-swap";
import {
  ALL_FEATURES,
  decodeSetup,
  encodeSetup,
  FINISH_COLOURS_DEFAULT,
  GENJUTSU,
  getMaker,
  lookName,
  modeOpen,
  OPENJUTSU_LIMITS,
  SCENE_ACTIONS,
  type FeatureCheck,
  type GenjutsuMode,
  type GenjutsuSetup,
} from "@/lib/catalog/genjutsu";
import { originalSoundLabel } from "@/lib/av/original-sound";
import type { ExampleCard, ExampleSurface, GenjutsuExampleLoad, GenjutsuRecipe } from "./types";

/** The surface a mode's examples belong to: "tool:genjutsu/<mode>" (its id: "genjutsu-<mode>.<n>"). */
export const genjutsuSurface = (mode: GenjutsuMode): ExampleSurface => `tool:genjutsu/${mode}`;

/** A Genjutsu example card (its load is always "genjutsu"). */
export type GenjutsuExampleCard = ExampleCard & { load: GenjutsuExampleLoad };

/** Each mode's examples, best first. */
export type ModeExamples = Partial<Record<GenjutsuMode, GenjutsuExampleCard[]>>;

/**
 * Fields that describe the example's own clip or photos, never part of a recipe (cleared when it loads): the character
 * photo's description, who is who in the clip (roles, pins, the person's place or number, the words naming them).
 */
export const OWN_CHARACTER_FIELDS = ["description", "people", "who", "index", "subject"] as const;

/**
 * Words that came from the example's clip but often still fit the viewer's ("the dress"): loaded, with a note under the
 * field. Object swap's words naming what is swapped, and Scene edit's target.
 */
export const MARKED_NOTE = "From the example. Change it to fit your clip.";

/** The part a mode takes, in seconds (a model's own part where it has one). */
export function partLimits(mode: GenjutsuMode, model?: string): { min: number; max: number } {
  const own = getMaker(model)?.part;
  if (own) return own;
  if (mode === "character") return { min: CHARACTER_SWAP.minSeconds, max: CHARACTER_SWAP.maxSeconds };
  if (mode === "picture") return { min: OPENJUTSU_LIMITS.minSeconds, max: OPENJUTSU_LIMITS.maxSeconds };
  if (mode === "finish") return { min: 1, max: OPENJUTSU_LIMITS.coloursMaxSeconds };
  return { min: GENJUTSU.minSeconds, max: GENJUTSU.maxSeconds };
}

/** JSON with its keys in order: two setups with the same fields compare equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/**
 * A form's setup as a recipe: its references and the fields about its own clip and photos left out, and the quality
 * left out where the model has none to pick (Finish keeps the clip's size). What "Use this example" compares with.
 */
export function toRecipe(s: GenjutsuSetup & { length?: number }): Omit<GenjutsuRecipe, "length"> & { length?: number } {
  const { references: _refs, ...rest } = s;
  void _refs;
  const out: Omit<GenjutsuRecipe, "length"> & { length?: number } = { ...rest };
  if (out.character) {
    const c: Record<string, unknown> = { ...out.character };
    for (const k of OWN_CHARACTER_FIELDS) delete c[k];
    if (Object.keys(c).length) out.character = c as GenjutsuSetup["character"];
    else delete out.character;
  }
  const maker = getMaker(s.model, s.engine);
  if (maker && !maker.qualities && !maker.h3) delete out.quality;
  if (s.mode === "finish") delete out.quality;
  if (out.object && !out.object.target) delete out.object.target;
  return out;
}

/** Whether two recipes run the same (the same fields, after a setup code's own checks). */
export function sameRecipe(a: Omit<GenjutsuRecipe, "length"> & { length?: number }, b: Omit<GenjutsuRecipe, "length"> & { length?: number }): boolean {
  const norm = (r: typeof a) => {
    const back = decodeSetup(encodeSetup(r)) ?? { mode: r.mode };
    // The part's length to the trimmer's 2 decimals: a part set from the example reads back as such.
    if (back.length !== undefined) back.length = Math.round(back.length * 100) / 100;
    return canonical(toRecipe(back));
  };
  return norm(a) === norm(b);
}

/** Why a row's recipe can't be an example (null: it can). The catalog fails the build on one. */
export function recipeProblem(r: GenjutsuRecipe, mode: GenjutsuMode): string | null {
  if (r.mode !== mode) return `its recipe runs ${r.mode}, not ${mode}`;
  if ((r as GenjutsuSetup).references) return "a recipe never names files: the viewer's own photos go in";
  for (const k of OWN_CHARACTER_FIELDS) if (r.character && k in r.character) return `character.${k} describes the example's own clip or photo`;
  const maker = getMaker(r.model, r.engine);
  if (!maker) return `its model ${r.model ?? "(none)"} isn't a Genjutsu model on the ${r.engine ?? "?"} engine`;
  if (!maker.modes.includes(r.mode)) return `${maker.id} doesn't run ${r.mode}`;
  const { min, max } = partLimits(r.mode, r.model);
  if (!(r.length >= min && r.length <= max)) return `its part (${r.length} s) is outside ${min}–${max} s`;
  // Every field survives a setup code: nothing a viewer loads is dropped or changed on the way.
  const back = decodeSetup(encodeSetup(r), ALL_FEATURES);
  if (!back || canonical(back) !== canonical(r)) return `its recipe doesn't survive a setup code (${canonical(back)})`;
  return null;
}

const FINISH_LABEL: Record<string, string> = { soft: "Soft film", filmic: "Filmic", rich: "Rich", off: "Off" };

/**
 * "Settings it used", as the form labels them. Everyone: the size, the length in whole seconds (as "What went in" says
 * it) and the sound. The owner's card adds the model first (not for Finish, whose finish chip already names it), the
 * seed and the exact length. The copied setup keeps every one.
 */
export function exampleSettings(r: GenjutsuRecipe, opts: { owner?: boolean } = {}): string[] {
  const out: string[] = [];
  const maker = getMaker(r.model, r.engine);
  if (opts.owner && maker && r.mode !== "finish") out.push(maker.label);
  if (r.mode === "finish" && r.finish?.tool === "colours") {
    out.push(`Finish: ${FINISH_LABEL[r.finish.finish ?? FINISH_COLOURS_DEFAULT.finish]}`);
    out.push(`Strength ${Math.round((r.finish.strength ?? FINISH_COLOURS_DEFAULT.strength) * 100)}%`);
    out.push(`Soften detail ${Math.round((r.finish.soften ?? FINISH_COLOURS_DEFAULT.soften) * 100)}%`);
  }
  if (r.object) out.push(SCENE_ACTIONS.find((a) => a.id === r.object!.action)!.label);
  if (r.look) out.push(`Look: ${lookName(r.look)}`);
  if (r.tier) out.push(r.tier === "high" ? "High" : "Standard");
  if (r.quality && maker && (maker.qualities || maker.h3)) out.push(r.quality);
  out.push(opts.owner ? `${Math.round(r.length * 10) / 10} s` : `${Math.max(1, Math.round(r.length))} s`);
  if (r.originalSound) out.push(r.originalSound === "everything" ? "Original sound" : `Sound: ${originalSoundLabel(r.originalSound)}`);
  if (opts.owner && r.seed !== undefined) out.push(`Seed ${r.seed}`);
  return out;
}

/** The example a viewer sees for a mode: the best one whose mode and features are open to them (none: no card). */
export function exampleFor(examples: ModeExamples | undefined, mode: GenjutsuMode, open: FeatureCheck): GenjutsuExampleCard | undefined {
  if (!modeOpen(mode, open)) return undefined;
  return examples?.[mode]?.find((c) => c.load.needs.every(open));
}
