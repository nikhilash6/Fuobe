"use client";

import { preload } from "react-dom";
import { faceUrl, facesOf, KINETIC_UNICODE_RANGE, type FontStyle, type KineticFace } from "@/lib/motion/type/faces";

/**
 * Kinetic's own faces in the page: each is registered once (FontFace, self-hosted WOFF2), only when a template uses it,
 * and preloaded while the page renders so its first frame already has the right type.
 */

const registered = new Map<string, Promise<void>>();

function register(face: KineticFace): Promise<void> {
  let p = registered.get(face.id);
  if (!p) {
    p = (async () => {
      if (typeof document === "undefined" || typeof FontFace === "undefined") return;
      const weight = face.weight[0] === face.weight[1] ? String(face.weight[0]) : `${face.weight[0]} ${face.weight[1]}`;
      const ff = new FontFace(face.family, `url(${faceUrl(face)}) format("woff2")`, { weight, style: face.style, display: "block", unicodeRange: KINETIC_UNICODE_RANGE });
      document.fonts.add(ff);
      await ff.load();
    })().catch(() => {
      // Let a later call try again.
      registered.delete(face.id);
    });
    registered.set(face.id, p);
  }
  return p;
}

type Wanted = string | { family: string; style?: FontStyle } | null | undefined;

/** Load the Kinetic faces these families need (others are ignored: brand fonts load through their own path). */
export async function loadKineticFaces(families: Iterable<Wanted>): Promise<void> {
  await Promise.all(facesOf(families).map(register));
}

/** Ask the browser to fetch these faces early (call while rendering a template's page). */
export function preloadKineticFaces(families: Iterable<Wanted>): void {
  for (const f of facesOf(families)) preload(faceUrl(f), { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
}
