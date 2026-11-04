import "server-only";
import fs from "node:fs";
import path from "node:path";
import { ANY_ANGLE } from "@/lib/catalog/any-angle";

const MANIFEST = path.join(process.cwd(), "workflows", "comfyui", "manifest.json");

/**
 * Whether the Any Angle app is open to everyone: both its workflows (the 3D view and one angle) have passed their check
 * on a GPU (the manifest's `validated`). Until then the studio's owner gets the tool and everyone else its cover.
 */
export function anyAngleToolLive(manifest = MANIFEST): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(manifest, "utf8")) as { workflows?: { id?: string; validated?: boolean }[] };
    return [ANY_ANGLE.buildGraph, ANY_ANGLE.shotGraph].every((id) => m.workflows?.some((w) => w.id === id && w.validated === true));
  } catch {
    return false;
  }
}
