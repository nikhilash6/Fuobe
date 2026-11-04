/**
 * "Keep going with this": three to five next steps under a finished result, each opening the studio or app that
 * takes it further with the result already in it. Built on outputActions() (src/lib/output-actions.ts), so a step
 * goes through the same hand-off URL as the result's own menu, and what a guest or an account can't open is left
 * out the same way. Pure: components/nav/next-steps.tsx renders it.
 */
import { animateSpinHref, model3dView } from "./av/model3d";
import type { Generation } from "./catalog/types";
import { STEP_COVERS } from "./nav-model";
import { isVector, nextSteps, outputActions, type ActionContext, type OutputActionId } from "./output-actions";

export interface NextStep {
  /** Unique within one list ("animate", "upscale"). */
  id: string;
  /** What it does, short ("Animate it"). */
  verb: string;
  /** Where it opens ("Video"). */
  where: string;
  href: string;
  /** A preset id with a real cover (nav-covers.ts resolves it). */
  cover?: string;
}

export interface KeepGoingContext {
  engineMode?: "both" | "open" | "cloud";
  /** A guest or an account: hand-offs to tools only a self-hosted Fuobe runs are left out. */
  visitor?: boolean;
  /** Studios that read ?image= on arrival; until they do, no step links to them. */
  adapters?: { characterSheet?: boolean; imageTo3d?: boolean };
}

const q = (url: string) => encodeURIComponent(url);

const PERSON_WORDS = /\b(model|models|woman|women|man|men|girl|girls|boy|boys|person|people|portrait|face|she|he|her|his|influencer|actor|actress|outfit|dress)\b/g;
const PRODUCT_WORDS = /\b(product|products|bottle|perfume|fragrance|shoe|shoes|sneaker|sneakers|bag|handbag|watch|ring|packshot|ad|advert|cosmetic|lipstick|skincare)\b/g;
/** Results from a studio about people, or about selling. */
const PEOPLE_FEATURES = /^(fashion|photodump|influencer|character-sheet|swap-studio|genjutsu|lipsync|motion-control|elements)/;
const PRODUCT_FEATURES = /^(marketing|ads|ad-multiplier|click-to-ad|product)/;

/** Whether a picture is of someone, of a product, or something else: its studio first, then its words. */
export function imageSubject(g: Pick<Generation, "feature" | "prompt" | "presetId" | "request">): "person" | "product" | "other" {
  if (PEOPLE_FEATURES.test(g.feature ?? "")) return "person";
  if (PRODUCT_FEATURES.test(g.feature ?? "")) return "product";
  const words = `${g.prompt ?? g.request?.prompt ?? ""} ${(g.presetId ?? g.request?.presetId ?? "").replace(/-/g, " ")}`.toLowerCase();
  const person = words.match(PERSON_WORDS)?.length ?? 0;
  const product = words.match(PRODUCT_WORDS)?.length ?? 0;
  if (product > person) return "product";
  if (person) return "person";
  return "other";
}

/** A video's next steps from the result's own hand-offs (outputActions), with their words here. */
const VIDEO_STEPS: Partial<Record<OutputActionId, { verb: string; where: string; cover?: string }>> = {
  grade: { verb: "Color grade", where: "Color grading", cover: STEP_COVERS.grade },
  extend: { verb: "Make it longer", where: "Extend video", cover: STEP_COVERS.extend },
  upscale: { verb: "Sharpen to 4K", where: "Upscale", cover: STEP_COVERS.upscale },
  regenerate: { verb: "Regenerate in 2K", where: "Upscale", cover: STEP_COVERS.upscale },
  "add-sound": { verb: "Add sound", where: "Audio", cover: STEP_COVERS.sound },
  "split-soundtrack": { verb: "Split voice and music", where: "Audio", cover: STEP_COVERS.split },
  "remove-dialogue": { verb: "Remove dialogue", where: "Video tools" },
  reframe: { verb: "Reframe for phones", where: "Reframe", cover: STEP_COVERS.reframe },
  genjutsu: { verb: "Swap who is in it", where: "Genjutsu", cover: STEP_COVERS.swap },
};

/**
 * Up to `max` next steps for output `index` of `g`, best first. Nothing for a result that failed, was deleted, is
 * text, or is a vector (the hand-offs read pixels).
 */
export function keepGoing(g: Generation, index: number, ctx: KeepGoingContext = {}, max = 5): NextStep[] {
  const o = g.outputs[index];
  if (!o || g.status !== "succeeded" || g.deletedAt || o.kind === "text") return [];
  if (o.kind === "image" && isVector(g, o)) return [];
  const actx: ActionContext = { engineMode: ctx.engineMode, visitor: ctx.visitor };
  const steps: NextStep[] = [];
  const add = (s: NextStep | null | undefined | false) => {
    if (s && !steps.some((x) => x.id === s.id)) steps.push(s);
  };

  switch (o.kind) {
    case "image": {
      const U = q(o.url);
      const animate: NextStep = { id: "animate", verb: "Animate it", where: "Video", href: `/video?image=${U}`, cover: STEP_COVERS.animate };
      const upscale: NextStep = { id: "upscale", verb: "Sharpen to 4K", where: "Upscale", href: `/upscale?image=${U}`, cover: STEP_COVERS.upscale };
      const edit: NextStep = { id: "edit", verb: "Change it with words", where: "Edit", href: `/edit?image=${U}`, cover: STEP_COVERS.edit };
      const threeD = ctx.adapters?.imageTo3d && { id: "image-to-3d", verb: "Turn it into 3D", where: "Image to 3D", href: `/image-to-3d?image=${U}`, cover: STEP_COVERS.threeD };
      const subject = imageSubject(g);
      if (subject === "person") {
        add(animate);
        add({ id: "talk", verb: "Make it talk", where: "Lipsync & avatars", href: `/lipsync?image=${U}`, cover: STEP_COVERS.talk });
        add(ctx.adapters?.characterSheet && { id: "character-sheet", verb: "Make a character sheet", where: "Character Sheet", href: `/character-sheet?image=${U}`, cover: STEP_COVERS.sheet });
        add({ id: "billboard", verb: "Put it in an ad", where: "Billboard ad", href: `/apps/app-billboard-ad?image=${U}`, cover: STEP_COVERS.billboard });
        add(upscale);
      } else if (subject === "product") {
        add(animate);
        add({ id: "giant", verb: "Put it in an ad", where: "Giant product", href: `/apps/app-giant-product?image=${U}`, cover: STEP_COVERS.giant });
        add(threeD);
        add(upscale);
        add(edit);
      } else {
        add(animate);
        add(edit);
        add(upscale);
        add({ id: "grade", verb: "Color grade", where: "Color grading", href: `/color-grade?image=${U}`, cover: STEP_COVERS.grade });
        add(threeD);
      }
      break;
    }
    case "video": {
      // Today's order first (a grade still to apply, Extend, Upscale or Regenerate, sound), then the rest.
      for (const a of nextSteps(g, index, 5, actx)) {
        const words = VIDEO_STEPS[a.id];
        // A grade to apply says which one ("Apply the Teal & Orange grade").
        if (words && a.href) add({ id: a.id, ...words, ...(a.id === "grade" && { verb: a.label }), href: a.href });
      }
      const all = outputActions(g, index, actx);
      for (const id of ["extend", "upscale", "add-sound", "reframe", "genjutsu"] as const) {
        const a = all.find((x) => x.id === id && x.href);
        if (a?.href && VIDEO_STEPS[id]) add({ id, ...VIDEO_STEPS[id], href: a.href });
      }
      break;
    }
    case "audio": {
      const all = outputActions(g, index, actx);
      const pick = (id: OutputActionId, verb: string, where: string, cover?: string) => {
        const a = all.find((x) => x.id === id && x.href);
        return a?.href ? { id, verb, where, href: a.href, ...(cover && { cover }) } : null;
      };
      add(pick("lipsync", "Make a photo say it", "Lipsync & avatars", STEP_COVERS.talk));
      add(pick("voice-change", "Change the voice", "Audio", STEP_COVERS.voice));
      add(pick("loop-audio", "Loop or extend", "Audio", STEP_COVERS.split));
      add(pick("split-soundtrack", "Split voice and music", "Audio", STEP_COVERS.split));
      add(pick("clean-voice", "Clean up voice", "Audio", STEP_COVERS.clean));
      break;
    }
    case "model3d": {
      const view = model3dView(g);
      const spin = animateSpinHref(view);
      if (spin) add({ id: "animate-spin", verb: "Animate the spin", where: "Video", href: spin, cover: STEP_COVERS.animate });
      if (view.poster) {
        const P = q(view.poster);
        add({ id: "product-360", verb: "Put it in an ad", where: "Product 360", href: `/apps/app-product-360?image=${P}`, cover: STEP_COVERS.spin });
        add({ id: "upscale", verb: "Sharpen the still", where: "Upscale", href: `/upscale?image=${P}`, cover: STEP_COVERS.upscale });
      }
      break;
    }
  }
  return steps.slice(0, max);
}
