import type { Place } from "./place-name";

/**
 * What a visitor's Run on a canvas board opens (src/components/canvas/visitor-canvas.tsx): a board is built, changed and
 * kept here, and made in a studio, which runs every step at once. `oneStep`: the board is one effect of the Video studio.
 * `place` (hosted runs on): the name visitors read for this install's GPUs, said as where the studio runs it, never
 * "isn't available here". Null: today's words. Pure: tests/hosted-surface-labels.test.ts.
 */
export function boardRunWords(oneStep: boolean, place: Place | null): { title: string; body: string } {
  if (!place) {
    return {
      title: "Running a board isn't available here",
      body: `You can build, change and keep boards here. ${oneStep ? "To make this result now, use the same effect in the Video studio: it runs every step at once." : "To make something now, use the Image, Video or Audio studio, or an app, effect or camera motion."}`,
    };
  }
  return oneStep
    ? { title: "Make this in the Video studio", body: `You can build, change and keep boards here. The same effect in the Video studio runs every step at once, on ${place.text}.` }
    : {
        title: "Make it in a studio",
        body: `You can build, change and keep boards here. To make something now, use the Image, Video or Audio studio, or an app, effect or camera motion. They run on ${place.text}.`,
      };
}
