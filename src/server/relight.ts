import "server-only";
import fs from "node:fs";
import path from "node:path";
import { RELIGHT_WORKFLOW } from "@/lib/relight/engine";

const MANIFEST = path.join(process.cwd(), "workflows", "comfyui", "manifest.json");

/**
 * Whether the Relight app's own tool is open to everyone: its Generate lighting workflow has passed its check on a GPU
 * (the manifest's `validated`). Until then the app's page stays its composer for visitors and the owner gets the tool.
 */
export function relightToolLive(manifest = MANIFEST): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(manifest, "utf8")) as { workflows?: { id?: string; validated?: boolean }[] };
    return m.workflows?.some((w) => w.id === RELIGHT_WORKFLOW && w.validated === true) ?? false;
  } catch {
    return false;
  }
}
