import type { ModelRoute } from "./types";

/**
 * Hosted routes that put their own look on whatever the prompt describes: fal's H3 Max looks (16-bit Pixel, Hand-drawn,
 * Low Poly, Retro Toon 70s, VHS). Each endpoint's prompt field says "Describe the scene, action, camera and sound. The …
 * style is applied automatically." Enhance adds no look of its own to their prompts (src/server/enhance.ts).
 */
export function appliesOwnStyle(route: Pick<ModelRoute, "provider" | "endpoint">): boolean {
  return route.provider === "fal" && route.endpoint.startsWith("minimax/h3-max/styles/");
}
