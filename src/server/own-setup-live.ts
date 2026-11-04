import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getModel } from "@/lib/catalog";

const MANIFEST = path.join(process.cwd(), "workflows", "comfyui", "manifest.json");

/**
 * Whether a model's ComfyUI graphs have all passed their check on this studio's GPU (the manifest's `validated`), read
 * when a page is made. Until then its surface marks it with what it runs on (src/lib/own-setup.ts); the mark leaves by
 * itself once the flags say so. False for a model with no ComfyUI graph, or when the manifest can't be read.
 */
export function graphsReady(modelId: string, manifest = MANIFEST): boolean {
  const graphs = (getModel(modelId)?.routes ?? []).filter((r) => r.provider === "comfyui").map((r) => r.endpoint);
  if (!graphs.length) return false;
  try {
    const m = JSON.parse(fs.readFileSync(manifest, "utf8")) as { workflows?: { id?: string; validated?: boolean }[] };
    const validated = new Set((m.workflows ?? []).filter((w) => w.validated === true).map((w) => w.id));
    return graphs.every((g) => validated.has(g));
  } catch {
    return false;
  }
}
