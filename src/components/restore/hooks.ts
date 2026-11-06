"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Size } from "@/lib/catalog/restore";
import type { Engine, Generation } from "@/lib/catalog/types";
import { useDebounced } from "@/components/faceless/hooks";
import { send } from "@/components/shorts/hooks";

/** React Query hooks for /api/restore/** (Video tools → Restore & colourise). */

export interface RestoreBody {
  engine: Engine;
  source: { url: string; name?: string; duration?: number; fps?: number; width?: number; height?: number; hasAudio?: boolean };
  prompt?: string;
  negative?: string;
  hint?: string;
  refine?: boolean;
  deinterlace?: boolean;
  /** Upscale after (Upscale → Restore archive footage first). */
  upscale?: boolean;
  reference?: string;
  resolution?: string;
  /** Client nonce: a repeat of it gets the first answer (see useSubmitGuard). */
  requestId?: string;
}

export interface RestoreEstimate {
  costUsd: number | null;
  demo: boolean;
  engine: Engine;
  pieces: number;
  canvas: Size;
  tiles: number;
  refined?: Size;
  seconds: number;
  dropped: number;
  steps: number;
  resolution?: string;
  /** The gated Restore IC-LoRA is within reach (a token, or a copy Fuobe holds); left out for a visitor. */
  loraReady?: boolean;
  notes: string[];
}

export interface PromptAnswer {
  prompt: string;
  negative: string;
  by: "claude" | "local" | "free" | "offline";
  why?: string;
}

/** The price and shape of a run for the current settings, asked for once typing pauses (300 ms). */
export function useRestoreEstimate(body: RestoreBody | null) {
  // The words don't change the price: they stay out of the key, so typing doesn't ask again.
  const key = useDebounced(body ? JSON.stringify({ ...body, prompt: undefined, negative: undefined, hint: undefined }) : null, 300);
  return useQuery({
    queryKey: ["restore", "estimate", key],
    queryFn: async () => send<RestoreEstimate>("/api/restore/estimate", "POST", JSON.parse(key!)),
    enabled: !!key,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });
}

export function useRestoreActions() {
  const qc = useQueryClient();
  return {
    run: useMutation({
      mutationFn: (b: RestoreBody) => send<{ final: Generation; items: Generation[]; prompt: string; negative: string; by: PromptAnswer["by"] | "you" }>("/api/restore", "POST", b),
      onSuccess: (r) => {
        r.items.forEach((g) => qc.setQueryData(["generation", g.id], g));
        void qc.invalidateQueries({ queryKey: ["generations"] });
      },
    }),
    prompt: useMutation({
      mutationFn: (b: { engine: Engine; hint?: string; frames: string[]; seconds?: number }) => send<PromptAnswer>("/api/restore/prompt", "POST", b),
    }),
  };
}

/**
 * A few frames of a clip as small JPEG data URLs (for the prompt writer): a hidden video seeks to each point and a canvas
 * draws it at `width` px. Frames that can't be read (a codec the browser doesn't play) are left out.
 */
export async function grabFrames(src: string, duration: number | undefined, at = [0.15, 0.5, 0.85], width = 512): Promise<string[]> {
  if (typeof document === "undefined") return [];
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  v.src = src;
  const ready = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    v.onloadeddata = () => (clearTimeout(t), resolve(true));
    v.onerror = () => (clearTimeout(t), resolve(false));
  });
  if (!ready) return [];
  const len = duration && duration > 0 ? duration : v.duration;
  if (!len || !Number.isFinite(len)) return [];
  const out: string[] = [];
  const canvas = document.createElement("canvas");
  for (const f of at) {
    const ok = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 5000);
      v.onseeked = () => (clearTimeout(t), resolve(true));
      v.currentTime = Math.min(len - 0.05, Math.max(0, f * len));
    });
    if (!ok || !v.videoWidth) continue;
    canvas.width = width;
    canvas.height = Math.round((width * v.videoHeight) / v.videoWidth);
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    try {
      const url = canvas.toDataURL("image/jpeg", 0.8);
      if (url.length < 900_000) out.push(url);
    } catch {
      // A clip from another origin taints the canvas: no frames, the writer works from the words.
    }
  }
  v.removeAttribute("src");
  v.load();
  return out;
}
