"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadFile, useAskBeforeUpload, useIsAccount } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { recipeKey, type Recipe } from "@/lib/motion/recipe";
import { responseError, toastError } from "@/lib/refusals";

/**
 * Everything made here goes through Fuobe: a finished render is uploaded (POST /api/uploads, the same rule as any
 * upload: the owner, or an account with its own GPU or key) and recorded as a Kinetic Motion result (POST
 * /api/generations/local), which shows in the Library (the owner's) or the account's own runs at once. The person
 * downloads it from there, never straight from the page.
 */

export const MOTION_MODEL = "local-motion";

export interface MotionResult {
  blob: Blob;
  type: string;
  /** Its last frame (a PNG): the saved clip's tile shows it. */
  poster?: Blob;
}

export interface SaveMeta {
  recipe: Recipe;
  feature: string;
  title: string;
  /** The typed words, joined (what the Library shows and searches). */
  prompt: string;
  /** The person's own stored files the clip was made from (logo, product). */
  images?: string[];
}

/** Uploads a rendered clip and records it as a result; returns the result. */
export async function saveMotionResult(clip: MotionResult, meta: SaveMeta): Promise<Generation> {
  const ext = clip.type === "video/webm" ? "webm" : "mp4";
  const [asset, poster] = await Promise.all([
    uploadFile(new File([clip.blob], `kinetic-motion.${ext}`, { type: clip.type })),
    clip.poster ? uploadFile(new File([clip.poster], "kinetic-motion.png", { type: "image/png" })).catch(() => null) : null,
  ]);
  const images = (meta.images ?? []).filter((u) => u.startsWith("/api/files/")).slice(0, 4);
  const res = await fetch("/api/generations/local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      feature: meta.feature,
      modelId: MOTION_MODEL,
      op: "motion",
      prompt: meta.prompt.slice(0, 2000),
      title: meta.title.slice(0, 200),
      inputs: images.length ? { images } : {},
      params: { extra: { motion: meta.recipe } },
      output: { url: asset.url, kind: "video", contentType: asset.contentType, ...(poster && { meta: { poster: poster.url } }) },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Generation & { error?: string };
  if (!res.ok) throw responseError(res, body.error ?? "Couldn't save it. Try again.");
  return body;
}

export type SavePhase = { kind: "idle" } | { kind: "rendering"; done: number; total: number } | { kind: "saving" } | { kind: "saved"; id: string };

/**
 * Render-then-save for a page: asks first whoever couldn't save (a guest: "Create a free account"; an account with no
 * GPU or key: "Connect your GPU"), before anything renders. A look saves once per visit; a failed save keeps the
 * rendered clip, so Try again uploads without rendering again.
 */
export function useMotionSave() {
  const qc = useQueryClient();
  const ask = useAskBeforeUpload();
  const router = useRouter();
  const account = useIsAccount();
  const [phase, setPhase] = useState<SavePhase>({ kind: "idle" });
  const rendered = useRef<{ key: string; clip: MotionResult } | null>(null);
  const saved = useRef(new Map<string, string>());
  const abort = useRef<AbortController | null>(null);

  const save = useCallback(
    async (meta: SaveMeta, render: (signal: AbortSignal, progress: (done: number, total: number) => void) => Promise<MotionResult>): Promise<Generation | null> => {
      if (ask()) return null;
      const key = recipeKey(meta.recipe);
      if (saved.current.has(key)) {
        toast(account ? "Already saved to your runs" : "Already saved to your Library", { action: { label: "Open", onClick: () => router.push("/library") } });
        return null;
      }
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        let clip = rendered.current?.key === key ? rendered.current.clip : null;
        if (!clip) {
          setPhase({ kind: "rendering", done: 0, total: 1 });
          clip = await render(ctl.signal, (done, total) => setPhase({ kind: "rendering", done, total }));
          rendered.current = { key, clip };
        }
        setPhase({ kind: "saving" });
        const g = await saveMotionResult(clip, meta);
        saved.current.set(key, g.id);
        setPhase({ kind: "saved", id: g.id });
        void qc.invalidateQueries({ queryKey: ["generations"] });
        toast.success(account ? "Saved to your runs" : "Saved to your Library", { action: { label: "Open", onClick: () => router.push("/library") } });
        return g;
      } catch (e) {
        setPhase({ kind: "idle" });
        if ((e as Error).name !== "AbortError") toastError(e, "Couldn't save it. Try again.");
        return null;
      } finally {
        if (abort.current === ctl) abort.current = null;
      }
    },
    [ask, account, qc, router],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);
  return { save, cancel, phase, label: account ? "Save to your runs" : "Save to Library" };
}

/** "Rendering 42 of 75", "Saving…", or null. */
export function phaseLine(p: SavePhase): string | null {
  if (p.kind === "rendering") return `Rendering ${p.done} of ${p.total}`;
  if (p.kind === "saving") return "Saving…";
  return null;
}
