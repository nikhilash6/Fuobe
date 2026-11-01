"use client";

import { useEffect, useState } from "react";

/**
 * One setup for every <model-viewer> in Fuobe (the 3D page, the result viewer): load the element on demand,
 * point it at the same-origin meshopt decoder before the first model loads (the web GLBs are
 * meshopt-compressed; model-viewer only enables its decoder when this is set) and keep full render
 * resolution. The look matches the server turntable: neutral environment and tone mapping, a soft contact
 * shadow, a long lens, the exposure the turntable used for that material.
 */

/** Copied from node_modules/meshoptimizer/meshopt_decoder.cjs (tests/model3d-finish.test.ts keeps it in sync). */
export const MESHOPT_DECODER_URL = "/vendor/meshopt_decoder.js";

type ModelViewerClass = CustomElementConstructor & { meshoptDecoderLocation?: string; minimumRenderScale?: number };

let loading: Promise<void> | null = null;

/** Import @google/model-viewer once and configure it before any model loads. */
export function loadModelViewer(): Promise<void> {
  loading ??= import("@google/model-viewer").then(
    () => {
      const MV = customElements.get("model-viewer") as ModelViewerClass | undefined;
      if (MV) {
        MV.meshoptDecoderLocation = MESHOPT_DECODER_URL;
        // No dynamic resolution drop (model-viewer lowers it to 0.5 on a slow frame).
        MV.minimumRenderScale = 1;
      }
    },
    (e) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}

/**
 * Attributes every viewer shares (lighting, shadow, lens). `material` is the class the server's finish read
 * (meta.finish.material): the exposure the server turntable used with the neutral environment, so opening the
 * 3D view doesn't change the model's look. Results without one keep model-viewer's default exposure.
 */
export function viewerLook(material?: string): Record<string, string> {
  return {
    "environment-image": "neutral",
    "tone-mapping": "neutral",
    exposure: material === "metal" ? "1.3" : material ? "1.15" : "1",
    "shadow-intensity": "1",
    "shadow-softness": "0.9",
    // A long lens like a product photo; zooming narrows the field of view down to 5 degrees.
    "field-of-view": "20deg",
    "min-field-of-view": "5deg",
    // The framing radius is computed for a 30 degree lens: step back so the model still fits at 20 degrees.
    "camera-orbit": "0deg 75deg 130%",
    "max-camera-orbit": "Infinity 157.5deg 200%",
  };
}

/** The studio sweep behind the server's turntable (scripts/model3d/render-turntable.mjs), as a CSS background. */
export const TURNTABLE_BACKDROP = "radial-gradient(61% 65% at 50% 45.6%, #f3ece3 0%, #f0e8df 25%, #eae1d6 50%, #e2d7ca 75%, #d8cbbb 100%)";

/**
 * The GLB a viewer should load: the web GLB, or the original once the web one fails to load (the decoder
 * blocked, a bad file). `el` is the mounted <model-viewer>.
 */
export function useViewerSrc(el: HTMLElement | null, web: string | undefined, original: string | undefined): string | undefined {
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!el || !web || !original || web === original) return;
    const onError = (e: Event) => {
      if ((e as CustomEvent<{ type?: string }>).detail?.type === "loadfailure") setFailed(web);
    };
    el.addEventListener("error", onError);
    return () => el.removeEventListener("error", onError);
  }, [el, web, original]);
  return failed && failed === web ? original : web;
}
