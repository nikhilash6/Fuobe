"use client";

import { useEffect, useState } from "react";
import { measureText } from "@/components/ads/render";
import { drawDisplayList } from "@/components/motion/draw";
import { fontsReady } from "@/components/motion/fonts";
import { loadMotionInputs } from "@/components/motion/inputs";
import { drawFrame, renderClip } from "@/components/motion/render";
import { TEMPLATES } from "@/lib/catalog/marketing";
import type { Recipe } from "@/lib/motion/recipe";
import { loadScene } from "@/lib/motion/registry";
import { SHOWCASES, showcaseRecipe } from "@/lib/motion/showcase";
import { exportSize } from "@/lib/motion/sizes";

/** Every code-drawn template with its showcase recipe (at its own length). */
function showcases(): { id: string; name: string; recipe: Recipe; poster?: string }[] {
  return TEMPLATES.filter((t) => t.render === "code" && t.scene).flatMap((t) => {
    const r = showcaseRecipe(t.id, t.scene!, t.lengths?.default ?? t.duration ?? 5, { cover: true });
    const poster = SHOWCASES[t.id]?.poster;
    return r ? [{ id: t.id, name: t.name, recipe: r, ...(poster && { poster }) }] : [];
  });
}

const b64 = async (b: Blob) => {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
};

async function prepare(recipe: Recipe) {
  const inputs = await loadMotionInputs({ logo: recipe.brand.logo, product: recipe.media?.product });
  await fontsReady([recipe.brand.fonts.heading, recipe.brand.fonts.body], { strict: true, text: Object.values(recipe.fields).join(" ") + recipe.brand.name });
  const scene = await loadScene(recipe.scene);
  return { inputs, scene };
}

declare global {
  interface Window {
    __kinetic?: {
      showcases: typeof showcases;
      render(recipe: Recipe): Promise<{ ms: number; frames: number; w: number; h: number; type: string; clip: string; poster: string }>;
      frames(recipe: Recipe, times: number[], blur?: boolean): Promise<{ out: string[]; rest: number; overflow: string[]; events: [string, number, number][] }>;
    };
  }
}

export function KineticCovers() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    window.__kinetic = {
      showcases,
      async render(recipe) {
        const { inputs, scene } = await prepare(recipe);
        const t0 = performance.now();
        const r = await renderClip(scene, recipe, { ...inputs, measure: measureText, formats: ["mp4"] });
        return { ms: performance.now() - t0, frames: r.frames, w: r.width, h: r.height, type: r.type, clip: await b64(r.blob), poster: await b64(r.poster) };
      },
      async frames(recipe, times, blur = true) {
        const { inputs, scene } = await prepare(recipe);
        const plan = scene.plan({ recipe, measure: measureText, logo: inputs.logo, images: inputs.images, outlines: inputs.outlines });
        const { w, h } = exportSize(recipe.size);
        const target = new OffscreenCanvas(w, h);
        const scratch = new OffscreenCanvas(w, h);
        const out: string[] = [];
        for (const t of times) {
          if (blur) drawFrame(plan, t, target, scratch, inputs.sources, { fps: recipe.fps, samples: recipe.export.blurSamples, shutter: recipe.export.shutter, duration: recipe.duration });
          else drawDisplayList(target.getContext("2d", { alpha: false })!, plan.evaluate(t), inputs.sources);
          out.push(await b64(await target.convertToBlob({ type: "image/png" })));
        }
        return { out, rest: plan.rest, overflow: plan.overflow, events: plan.timeline.events.map((e) => [e.id, +e.start.toFixed(3), +e.dur.toFixed(3)] as [string, number, number]) };
      },
    };
    // Ready once the hooks are on window (a microtask later, not inside the effect itself).
    queueMicrotask(() => setReady(true));
  }, []);
  return (
    <main className="p-6 text-[13px]">
      <h1 className="font-heading text-[22px]">Kinetic covers</h1>
      <p data-kinetic-ready={ready || undefined}>{ready ? `${showcases().length} templates ready` : "Loading…"}</p>
      <ul className="mt-2 list-disc pl-5">
        {showcases().map((s) => (
          <li key={s.id}>
            {s.name} · {typeof s.recipe.size === "string" ? s.recipe.size : "custom"} · {s.recipe.duration}s
          </li>
        ))}
      </ul>
    </main>
  );
}
