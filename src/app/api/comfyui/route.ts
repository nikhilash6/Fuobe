import { connection } from "next/server";
import type { ManifestWorkflow } from "@/lib/comfy";
import { basename } from "@/lib/gpu/requirements";
import { requestViewer } from "@/server/auth";
import { runnerFacts } from "@/server/computer/tasks";
import { readSnapshot } from "@/server/gpu/snapshots";
import { loadManifest, modelInventory, probeComfy } from "@/server/providers/comfyui";
import { getSetting } from "@/server/settings";

/**
 * Workflow library + which required models are present on the connected server. A guest or an account (public
 * sign-up) gets the library only: the studio's own ComfyUI is neither asked nor described to them (its files
 * aren't theirs, and an open read would let anyone make the studio's GPU answer). Their own GPU is on /connect.
 * When the owner's ComfyUI runs on the owner's computer, nothing is asked from here: whether it is online is what the
 * owner's Fuobe tab there last said, and the models are from the last check that tab sent in (`where: "computer"`,
 * `checkedAt`; none yet: every `present` is null).
 */
export async function GET(request?: Request) {
  await connection();
  const manifest = loadManifest();
  const visitor = !!request && requestViewer(request).kind !== "owner";
  if (!visitor && getSetting("comfyWhere") === "computer") {
    const snap = readSnapshot({ kind: "computer", key: "install", via: "browser" });
    const inv = snap?.inventory.reachable ? snap.inventory : null;
    // Folder → the file names that check found there (as the index names them, compared without case).
    const has = (folder: string, file: string): boolean | null => {
      const f = inv?.models[folder];
      if (!f) return null;
      if (f.folderMissing) return false;
      const want = basename(file).toLowerCase();
      return Object.keys(f.have).some((n) => basename(n).toLowerCase() === want);
    };
    return Response.json({
      reachable: !!runnerFacts("owner")?.online,
      where: "computer",
      checkedAt: inv ? snap!.checkedAt : null,
      generatedAt: manifest.generatedAt,
      comfyuiCommit: manifest.comfyuiCommit,
      workflows: manifest.workflows.map((w) => ({ ...w, models: w.models.map((m) => ({ ...m, present: has(m.folder, m.file) })) })),
    });
  }
  const reachable = visitor ? null : await probeComfy(true);
  const inventory = reachable ? await modelInventory() : null;
  const present = new Set(Object.values(inventory ?? {}).flat());
  return Response.json({
    reachable,
    generatedAt: manifest.generatedAt,
    comfyuiCommit: manifest.comfyuiCommit,
    workflows: manifest.workflows.map((w) => ({
      ...(visitor ? forVisitor(w) : w),
      models: w.models.map((m) => ({ ...m, present: inventory ? present.has(m.file) : null })),
    })),
  });
}

/** A workflow as anyone but the owner gets it: `validated` only on a checked one (its mark on the Workflows page), and no check details. */
function forVisitor({ validated, ...w }: ManifestWorkflow): Omit<ManifestWorkflow, "validated" | "validationError"> & { validated?: true } {
  delete w.validationError;
  return validated ? { ...w, validated } : w;
}
