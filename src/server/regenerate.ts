import "server-only";
import path from "node:path";
import { nanoid } from "nanoid";
import { isH3Source, REGEN_SEAM_NOTE, regenWindows } from "@/lib/catalog/regenerate";
import type { Generation, GenerationRequest, ModelDef } from "@/lib/catalog/types";
import { fileAccount } from "./account-library";
import { db } from "./db";
import { filesRel, storedMedia } from "./storage";
import { tenant, tenantAccount } from "./tenant";

/**
 * Open-H3 Regenerate on the server (src/lib/catalog/regenerate.ts): what the clip is (the model that made it, for the
 * draft preset; its length, for the 15 s windows), and the run itself: one pass up to 15 s, or one pass per window
 * joined packet by packet. Nothing is fetched: a clip is read from Fuobe's own files, inside a tenant only the
 * account's own (storage.ts storedMedia and the asset's owner), so an account never learns about the owner's runs.
 */

/** The model that made a stored clip (its run's), or undefined: an upload, a link, or a file the asker may not use. */
export function clipMaker(ref: string | undefined): string | undefined {
  const rel = ref ? filesRel(ref) : null;
  if (!rel) return undefined;
  if (tenant()) {
    const who = tenantAccount();
    if (!who || fileAccount(rel) !== who) return undefined;
  }
  const native = rel.split("/").join(path.sep);
  const row = db()
    .prepare("SELECT g.model_id AS model FROM assets a JOIN generations g ON g.id = a.generation_id WHERE a.rel_path IN (?, ?) LIMIT 1")
    .get(rel, native) as { model: string } | undefined;
  return row?.model;
}

/** A stored clip's length from its header (none for a link or another's file). */
function clipSeconds(ref: string | undefined): number | undefined {
  const info = ref ? storedMedia(ref)?.info : undefined;
  return info ? (info.videoDuration ?? info.duration) : undefined;
}

/** Whether a request was already planned here (its draft preset is set): a retry, or one of a split run's windows. */
const planned = (r: GenerationRequest) => typeof r.params?.extra?.draftFrom === "string";

/**
 * A Regenerate run: the draft preset decided once from the clip's maker (an earlier step's model when it waits for one),
 * then one pass for a clip up to 15 s, or a pass per 15 s window and a copy join (each window keeps its own sound; all
 * come out at the same size at 24 fps). `create` is createGenerations (passed in: this module sits under it).
 */
export function createRegenerateRun(
  original: GenerationRequest,
  model: ModelDef,
  opts: { batchId?: string; dependsOn?: string | string[] },
  create: (r: GenerationRequest, o?: { batchId?: string; dependsOn?: string | string[] }) => Generation[],
  join: (ids: string[], o: { engine: "open"; feature: string; batchId: string; title: string; copy: true; demo?: boolean; step: GenerationRequest["step"] }) => Generation,
  cancel: (id: string) => void,
): Generation[] | null {
  if (planned(original)) return null;
  const deps = opts.dependsOn === undefined ? [] : Array.isArray(opts.dependsOn) ? opts.dependsOn : [opts.dependsOn];
  const video = original.inputs?.video;
  const maker = deps.length ? (db().prepare("SELECT model_id AS model FROM generations WHERE id = ?").get(deps[0]) as { model: string } | undefined)?.model : clipMaker(video);
  // The preset's source half; the provider adds the shape from the header ComfyUI is sent (draftSizeFor).
  const extra = { ...original.params?.extra, draftFrom: isH3Source(maker) ? "h3" : "other" };
  const seconds = original.params?.sourceDuration ?? (deps.length ? undefined : clipSeconds(video));
  const windows = deps.length || original.params?.startTime !== undefined || original.params?.endTime !== undefined ? [] : regenWindows(seconds);
  if (windows.length <= 1) return create({ ...original, params: { ...original.params, extra } }, opts);
  const batchId = opts.batchId ?? nanoid(10);
  const parts: Generation[] = [];
  try {
    for (const [i, w] of windows.entries()) {
      parts.push(
        create(
          {
            ...original,
            params: { ...original.params, startTime: w.start, endTime: Math.round((w.start + w.duration) * 1000) / 1000, numOutputs: 1, extra },
            step: { label: `Part ${i + 1} of ${windows.length}`, index: i, of: windows.length + 1 },
          },
          { batchId },
        )[0],
      );
    }
    const film = join(
      parts.map((p) => p.id),
      {
        engine: "open",
        feature: original.feature,
        batchId,
        title: original.prompt?.trim().slice(0, 120) || model.name,
        copy: true,
        ...(original.demo && { demo: true }),
        step: { label: `Regenerated · ${windows.length} parts joined`, index: windows.length, of: windows.length + 1 },
      },
    );
    return [{ ...film, notes: [...(film.notes ?? []), REGEN_SEAM_NOTE] }, ...parts];
  } catch (e) {
    for (const p of parts) cancel(p.id);
    throw e;
  }
}
