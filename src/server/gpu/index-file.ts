import "server-only";
import fs from "node:fs";
import path from "node:path";
import { parseIndex } from "@/lib/gpu/requirements";
import type { RequirementIndex } from "@/lib/gpu/types";

/**
 * The GPU pre-flight: on unless FUOBE_GPU_PREFLIGHT=0. It only reads the viewer's ComfyUI and fails open
 * (a check that is unknown or failed never blocks a run), so it ships on.
 */
export const preflightOn = (): boolean => process.env.FUOBE_GPU_PREFLIGHT?.trim() !== "0";

export const INDEX_FILE = path.join(process.cwd(), "workflows", "comfyui", "requirements.json");

let cache: { mtime: number; index: RequirementIndex; raw: string } | null = null;

/** workflows/comfyui/requirements.json (scripts/comfy/build-requirements.mjs), cached by mtime like loadManifest. */
export function loadIndex(): RequirementIndex {
  return loadIndexRaw().index;
}

/** The index and its file text (GET /api/gpu/requirements serves the text as it is). */
export function loadIndexRaw(): { index: RequirementIndex; raw: string } {
  const mtime = fs.statSync(INDEX_FILE).mtimeMs;
  if (!cache || cache.mtime !== mtime) {
    const raw = fs.readFileSync(INDEX_FILE, "utf8");
    cache = { mtime, index: parseIndex(JSON.parse(raw)), raw };
  }
  return cache;
}
