/** A picture's shape outside what a tool takes (src/components/av/fit-crop.tsx): the crop offered. */

const SLACK = 0.005;

/** The crop of a `width`×`height` picture at the nearest shape `ratio` allows (centred), or null when it fits. */
export function cropFor(width: number, height: number, ratio: [number, number]): { x: number; y: number; width: number; height: number } | null {
  const shape = width / height;
  if (shape >= ratio[0] - SLACK && shape <= ratio[1] + SLACK) return null;
  if (shape < ratio[0]) {
    const h = Math.floor(width / ratio[0]);
    return { x: 0, y: Math.floor((height - h) / 2), width, height: h };
  }
  const w = Math.floor(height * ratio[1]);
  return { x: Math.floor((width - w) / 2), y: 0, width: w, height };
}
