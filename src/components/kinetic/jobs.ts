"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { measureText } from "@/components/ads/render";
import { loadClip } from "@/components/motion/clip-source";
import { fontsReady } from "@/components/motion/fonts";
import { loadMotionInputs } from "@/components/motion/inputs";
import { renderClip, renderFrame, renderRest, renderSheet, type RenderOptions } from "@/components/motion/render";
import { saveMotionPicture, saveMotionResult, type SaveMeta } from "@/components/motion/save";
import { askToSignUp, useIsGuest, useIsOwner } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { videoNodeOf } from "@/lib/motion/display";
import { recipeKey, type Recipe } from "@/lib/motion/recipe";
import { loadScene } from "@/lib/motion/registry";
import { toastError } from "@/lib/refusals";
import type { KineticInputs } from "./preview";

/**
 * Kinetic's outputs, one render at a time: a clip, a frame, a contact sheet or a version. A guest is asked to sign up
 * before anything renders. Each output is uploaded and recorded as a result (save.ts: the owner's Library, an account's
 * own runs), where it downloads; nothing is handed to the browser as a download here.
 */

export type JobKind = "clip" | "frame" | "sheet" | "version";

export const JOB_FEATURE: Record<JobKind, string> = { clip: "kinetic", frame: "kinetic-frame", sheet: "kinetic-sheet", version: "kinetic-version" };

export interface JobState {
  kind: JobKind;
  done: number;
  total: number;
  saving: boolean;
}

export interface SavedItem {
  id: string;
  kind: JobKind;
  title: string;
}

/** The render options for a recipe: the brand's fonts (strict), its pictures, and its clip on a video of its own (exact seeks). */
async function optionsFor(recipe: Recipe, inputs: KineticInputs, signal: AbortSignal, onProgress?: (d: number, n: number) => void): Promise<{ opts: RenderOptions; dispose: () => void }> {
  await fontsReady([recipe.brand.fonts.heading, recipe.brand.fonts.body], { strict: true, text: [...Object.values(recipe.fields), recipe.brand.name].join(" ") });
  const src = recipe.layers?.video?.src;
  const clip = src ? await loadClip(src, { signal }) : null;
  const sources = clip ? { ...inputs.sources, clips: new Map([["clip", clip.el as CanvasImageSource]]) } : inputs.sources;
  const opts: RenderOptions = {
    sources,
    logo: inputs.logo,
    images: inputs.images,
    outlines: inputs.outlines,
    measure: measureText,
    signal,
    formats: [recipe.export.format],
    onProgress: (d, n) => onProgress?.(d, n),
    ...(clip && {
      clips: { clip: clip.info },
      prepare: async (list) => {
        const v = videoNodeOf(list);
        if (v) await clip.seek(v.time);
      },
    }),
  };
  return { opts, dispose: () => clip?.dispose() };
}

export function useKineticJobs() {
  const guest = useIsGuest();
  const owner = useIsOwner();
  const qc = useQueryClient();
  const router = useRouter();
  const [job, setJob] = useState<JobState | null>(null);
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const done = useRef(new Map<string, string>());
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(
    async (kind: JobKind, recipe: Recipe, inputs: KineticInputs, meta: Omit<SaveMeta, "recipe" | "feature">, o: { at?: number } = {}): Promise<Generation | null> => {
      if (guest) {
        askToSignUp("upload");
        return null;
      }
      if (abort.current) return null;
      const key = `${kind}|${recipeKey(recipe)}|${o.at ?? ""}`;
      const where = owner ? "Saved to your Library" : "Saved to your runs";
      const openLibrary = { label: "Open", onClick: () => router.push("/library") };
      if (done.current.has(key)) {
        toast(owner ? "Already saved to your Library" : "Already saved to your runs", { action: openLibrary });
        return null;
      }
      const ctl = new AbortController();
      abort.current = ctl;
      let dispose = () => {};
      try {
        setJob({ kind, done: 0, total: 1, saving: false });
        const progress = (d: number, n: number) => setJob({ kind, done: d, total: n, saving: false });
        const scene = await loadScene(recipe.scene);
        const made = await optionsFor(recipe, inputs, ctl.signal, progress);
        dispose = made.dispose;
        const full: SaveMeta = { ...meta, recipe, feature: JOB_FEATURE[kind] };
        let g: Generation;
        if (kind === "clip") {
          const clip = await renderClip(scene, recipe, made.opts);
          if (ctl.signal.aborted) throw new DOMException("Stopped", "AbortError");
          setJob({ kind, done: 1, total: 1, saving: true });
          g = await saveMotionResult({ blob: clip.blob, type: clip.type, poster: clip.poster }, full);
        } else {
          const pic = kind === "frame" ? await renderFrame(scene, recipe, o.at ?? 0, made.opts) : kind === "sheet" ? await renderSheet(scene, recipe, made.opts) : await renderRest(scene, recipe, made.opts);
          if (ctl.signal.aborted) throw new DOMException("Stopped", "AbortError");
          setJob({ kind, done: 1, total: 1, saving: true });
          g = await saveMotionPicture(pic.blob, full);
        }
        done.current.set(key, g.id);
        setSaved((s) => [{ id: g.id, kind, title: meta.title }, ...s].slice(0, 20));
        void qc.invalidateQueries({ queryKey: ["generations"] });
        toast.success(where, { action: openLibrary });
        return g;
      } catch (e) {
        if ((e as Error).name !== "AbortError") toastError(e, "Couldn't save it. Try again.");
        return null;
      } finally {
        dispose();
        if (abort.current === ctl) abort.current = null;
        setJob(null);
      }
    },
    [guest, owner, qc, router],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);
  // An account (not the owner, not a guest): its saves count toward its hourly limits, which the sheet says.
  return { run, cancel, job, saved, saveLabel: owner ? "Save to Library" : "Save to your runs", account: !owner && !guest, guest };
}

export type KineticJobs = ReturnType<typeof useKineticJobs>;

/** "Rendering 42 of 75", "Saving…", or null. */
export function jobLine(j: JobState | null): string | null {
  if (!j) return null;
  if (j.saving) return "Saving…";
  return `Rendering ${j.done} of ${j.total}`;
}

/**
 * A recipe's clip rendered with its own inputs loaded here (the Canvas node renders a row this way): its pictures, its
 * fonts and its clip. MP4 where the browser makes one, else WebM.
 */
export async function renderKineticClip(recipe: Recipe, o: { signal?: AbortSignal; onProgress?: (d: number, n: number) => void } = {}) {
  const loaded = await loadMotionInputs({ logo: recipe.brand.logo, product: recipe.media?.product });
  const inputs = { ...loaded, ready: true, version: 1, clip: { source: null, info: null, failed: false } } as KineticInputs;
  const ctl = new AbortController();
  o.signal?.addEventListener("abort", () => ctl.abort());
  const scene = await loadScene(recipe.scene);
  const made = await optionsFor(recipe, inputs, ctl.signal, o.onProgress);
  try {
    return await renderClip(scene, recipe, { ...made.opts, formats: ["mp4", "webm"] });
  } finally {
    made.dispose();
  }
}
