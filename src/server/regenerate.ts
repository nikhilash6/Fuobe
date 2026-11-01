import "server-only";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  isH3Source,
  REGEN_COPY,
  REGEN_FILES,
  REGEN_LORA,
  REGEN_MAX_PARTS,
  REGEN_ONE_PASS_NOTE,
  REGEN_SEAM_NOTE,
  regenCropNote,
  regenCrops,
  regenTooLong,
  regenWindows,
} from "@/lib/catalog/regenerate";
import { ACCESS_PLACE } from "@/lib/model-access";
import type { Generation, GenerationRequest, ModelDef } from "@/lib/catalog/types";
import { fileAccount } from "./account-library";
import { db } from "./db";
import { offeredLoras } from "./model-access";
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

/** A stored clip's length and size from its header (none for a link or another's file). */
function clipHeader(ref: string | undefined): { seconds?: number; width?: number; height?: number } {
  const info = ref ? storedMedia(ref)?.info : undefined;
  return info ? { seconds: info.videoDuration ?? info.duration, width: info.width, height: info.height } : {};
}

const positive = (n: number | undefined) => (typeof n === "number" && n > 0 ? n : undefined);

/**
 * Why a Regenerate run can't start because Settings → Models & licences has the refiner LoRA switched off (the graph loads
 * it itself, so the run can't leave it out): the owner is told where the switch is; a visitor gets plain words.
 */
export function regenSwitchedOff(): string | undefined {
  if (!offeredLoras([REGEN_LORA]).dropped.length) return undefined;
  return tenant() ? REGEN_COPY.off : `Open-H3 Regenerate runs with the ${REGEN_FILES[0].item}, which is switched off in ${ACCESS_PLACE}. Turn it back on there, or pick Restore · faithful`;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

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
  const off = regenSwitchedOff();
  if (off) throw new Error(off);
  if (planned(original)) return null;
  const deps = opts.dependsOn === undefined ? [] : Array.isArray(opts.dependsOn) ? opts.dependsOn : [opts.dependsOn];
  const video = original.inputs?.video;
  const maker = deps.length ? (db().prepare("SELECT model_id AS model FROM generations WHERE id = ?").get(deps[0]) as { model: string } | undefined)?.model : clipMaker(video);
  // The preset's source half (every shape takes the preset: Prepare Draft cover-crops to 16:9 or 9:16).
  const extra = { ...original.params?.extra, draftFrom: isH3Source(maker) ? "h3" : "other" };
  // The clip's length: the stored file's own header (tenant-safe) first; a client's sourceDuration only for a link, which
  // has no header here. A run that waits for an earlier step learns its length when it starts (the provider refuses a
  // single pass over 15 s rather than cutting it).
  const header = deps.length ? {} : clipHeader(video);
  const total = deps.length ? undefined : (positive(header.seconds) ?? positive(original.params?.sourceDuration));
  const from = Math.max(0, original.params?.startTime ?? 0);
  const to = original.params?.endTime ?? total;
  const span = to !== undefined ? Math.max(0, to - from) : undefined;
  const windows = span === undefined ? [] : regenWindows(span);
  if (windows.length > REGEN_MAX_PARTS) throw new Error(regenTooLong(span!));
  const notes = [
    ...(header.width && header.height && regenCrops(header.width, header.height) ? [regenCropNote(header.width, header.height)] : []),
    ...(span === undefined ? [REGEN_ONE_PASS_NOTE] : []),
  ];
  const noted = (g: Generation) => (notes.length ? { ...g, notes: [...(g.notes ?? []), ...notes] } : g);
  if (windows.length <= 1) return create({ ...original, params: { ...original.params, extra } }, opts).map(noted);
  const batchId = opts.batchId ?? nanoid(10);
  const parts: Generation[] = [];
  try {
    for (const [i, w] of windows.entries()) {
      parts.push(
        create(
          {
            ...original,
            params: { ...original.params, startTime: round3(from + w.start), endTime: round3(from + w.start + w.duration), numOutputs: 1, extra },
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
    return [noted({ ...film, notes: [...(film.notes ?? []), REGEN_SEAM_NOTE] }), ...parts];
  } catch (e) {
    for (const p of parts) cancel(p.id);
    throw e;
  }
}
