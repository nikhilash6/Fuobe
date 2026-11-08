import "server-only";
import fs from "node:fs";
import path from "node:path";
import { FRONT_YAW } from "@/lib/av/model3d";
import { hazeCutoffFor, splatPose } from "@/lib/av/splat-view";
import type { GenerationRequest, OutputFile } from "@/lib/catalog/types";
import { PREVIEW_FILES, PREVIEW_MAX_BYTES, type PreviewFormat } from "@/lib/finish-ticket";
import { previewFormatOf, type Preview3d } from "@/lib/preview3d";
import { finishOutcome, finishTask, queueFinish, workersFinish } from "./computer/finish";
import { ownerRunClass } from "./computer/pool";
import { json } from "./computer/tasks";
import { db } from "./db";
import { removePreviewDir, renderPreviewHere } from "./model3d-finish";
import { getSetting } from "./settings";
import { absolutePath, deleteAsset, getAsset, saveFile, type Asset } from "./storage";

/**
 * Every finished 3D result gets a preview, made once: a turntable clip (one turn, about 5 s, looping with no seam) and a
 * still from its first frame, each on a light and a dark studio backdrop, so a tile shows a picture of the model and
 * turns it on hover without ever loading the 3D file. A GLB mesh (Pixal3D, TRELLIS, Hunyuan3D, Idol 3D's mesh, a
 * provider's model) and a Gaussian splat (.spz, .ply) alike. scripts/model3d/render-preview.mjs draws it on the CPU, with
 * no browser and no GPU.
 *
 * Where: on a worker's CPU slot when one draws previews (a "preview3d" finishing job, src/lib/finish-ticket.ts), in the
 * run's place in line (an older result's, after everyone's). Without one, this server draws it only where that is its
 * work: an install that runs ComfyUI itself, or a provider's result of the owner's. An account's result on an install
 * with workers waits for a worker.
 *
 * What it writes: meta.preview3d on the model output ({ state, poster, clip, webm, seconds }, src/lib/preview3d.ts).
 * A result whose model already has a turntable (the server's own, rendered in a browser) keeps it. Older results get
 * theirs the same way, newest first, a few at a time: tickPreviews looks every few seconds.
 */

/** How many previews are being made at once (the rest wait their turn, newest first). */
const IN_FLIGHT = 3;
/** How often tickPreviews looks. */
const LOOK_MS = 8_000;
/** A preview this server was drawing when it stopped (a restart) is drawn again after this. */
const STALE_HERE_MS = 15 * 60_000;
/** How many times one result's preview is tried, and the failures worth another try (a draw here that stopped or failed). */
const TRIES = 2;
const RETRY = ["stopped", "failed", "not kept", "not queued"];

type Row = {
  id: string;
  status: string;
  provider: string;
  model_id: string;
  op: string;
  request_json: string;
  outputs_json: string;
  completed_at: number | null;
};

declare global {
  var __fuobePreview3d: { last: number; here: Map<string, AbortController> } | undefined;
}
const state = () => (globalThis.__fuobePreview3d ??= { last: 0, here: new Map() });

const turntableOf = (o: OutputFile) => (o.meta?.finish as { turntable?: unknown } | undefined)?.turntable;

/**
 * The model outputs of a run that still need a preview: a GLB, .spz or .ply kept as one of its files, with no preview
 * and no turntable of its own (one still being rendered in a browser is waited for).
 */
export function previewTargets(outputs: OutputFile[]): number[] {
  const out: number[] = [];
  outputs.forEach((o, i) => {
    if (o.kind !== "model3d" || !o.assetId || o.meta?.preview3d) return;
    if (!previewFormatOf(o)) return;
    const tt = turntableOf(o);
    if (tt === "done" || tt === "queued" || tt === "rendering") return;
    out.push(i);
  });
  return out;
}

/** How a model is drawn: its format, which way is up and front, and the haze a splat leaves out. */
export function previewSettings(
  r: Pick<Row, "provider" | "model_id">,
  o: OutputFile,
): {
  format: PreviewFormat;
  yDown: boolean;
  frontYaw: number;
  cutoff: number;
} | null {
  const format = previewFormatOf(o);
  if (!format) return null;
  if (format === "glb")
    return {
      format,
      yDown: false,
      frontYaw: Math.round(FRONT_YAW[r.model_id] ?? 0),
      cutoff: 0,
    };
  const pose = splatPose({ provider: r.provider }, o);
  return {
    format,
    yDown: pose.yDown,
    frontYaw: Math.round(pose.frontYaw),
    cutoff: Math.min(0.5, hazeCutoffFor(r.model_id)),
  };
}

/** Store a preview's state on a run's model output (by its file), as one change of the run (its live update). */
function setPreview(id: string, assetId: string, p: Preview3d): boolean {
  return db()
    .transaction((): boolean => {
      const row = db().prepare("SELECT outputs_json FROM generations WHERE id = ?").get(id) as Pick<Row, "outputs_json"> | undefined;
      if (!row) return false;
      const outputs = json<OutputFile[]>(row.outputs_json, []);
      const i = outputs.findIndex((o) => o.kind === "model3d" && o.assetId === assetId);
      if (i < 0) return false;
      outputs[i] = {
        ...outputs[i],
        meta: { ...outputs[i].meta, preview3d: p },
      };
      db().prepare("UPDATE generations SET outputs_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(outputs), Date.now(), id);
      return true;
    })
    .immediate();
}

/** The preview's files from a folder (by role), kept as the run's derived files; the preview state that names them. */
function keepFiles(id: string, files: Partial<Record<keyof typeof PREVIEW_FILES, string>>, tries: number): Preview3d | null {
  const saved: Asset[] = [];
  const save = (role: keyof typeof PREVIEW_FILES) => {
    const file = files[role];
    if (!file || !fs.existsSync(file)) return null;
    const f = PREVIEW_FILES[role];
    const a = saveFile({
      data: fs.readFileSync(file),
      contentType: f.contentType,
      name: f.file,
      source: "derived",
      generationId: id,
    });
    saved.push(a);
    return a.url;
  };
  try {
    const poster = { light: save("posterLight"), dark: save("posterDark") };
    const clip = { light: save("clipLight"), dark: save("clipDark") };
    if (!poster.light || !poster.dark || !clip.light || !clip.dark) throw new Error("a still or a clip is missing");
    const webmLight = save("webmLight");
    const webmDark = save("webmDark");
    return {
      state: "done",
      at: Date.now(),
      tries,
      poster: { light: poster.light, dark: poster.dark },
      clip: { light: clip.light, dark: clip.dark },
      ...(webmLight && webmDark && { webm: { light: webmLight, dark: webmDark } }),
      seconds: 5,
      assets: saved.map((a) => a.id),
    };
  } catch (e) {
    for (const a of saved) deleteAsset(a.id);
    console.warn(`[fuobe] 3D preview for ${id}: ${(e as Error).message}`);
    return null;
  }
}

/** Whether this server draws a run's preview itself when no worker does (see the header). */
function drawsHere(r: Pick<Row, "provider">, account: string | undefined): boolean {
  if (getSetting("comfyWhere") !== "workers") return true;
  return !account && r.provider !== "comfyui";
}

const accountOf = (r: Pick<Row, "request_json">) => json<GenerationRequest | null>(r.request_json, null)?.account;

/** Start one output's preview: queued for a worker, drawn here, or (neither now) left for a later look. */
function start(r: Row, i: number, outputs: OutputFile[], tries: number): void {
  const o = outputs[i];
  const asset = getAsset(o.assetId!);
  const s = previewSettings(r, o);
  if (!asset || !s)
    return void setPreview(r.id, o.assetId!, {
      state: "failed",
      at: Date.now(),
      tries,
      why: "no file",
    });
  if (asset.size > PREVIEW_MAX_BYTES)
    return void setPreview(r.id, o.assetId!, {
      state: "failed",
      at: Date.now(),
      tries,
      why: "too big",
    });
  const account = accountOf(r);
  if (workersFinish("preview3d")) {
    // A run finished in the last hour keeps its place in line; an older result's preview goes after everyone's.
    const fresh = !!r.completed_at && Date.now() - r.completed_at < 60 * 60_000;
    const place = fresh ? undefined : { class: "owner" as const, rankAt: Date.now() };
    try {
      queueFinish({
        kind: "preview3d",
        generationId: r.id,
        ...(account && { account }),
        step: i,
        inputs: [
          {
            slot: "model",
            data: fs.readFileSync(absolutePath(asset.relPath)),
            contentType: o.contentType || "application/octet-stream",
            name: `model.${s.format}`,
          },
        ],
        settings: s,
        place:
          place ??
          (account
            ? undefined
            : {
                class: ownerRunClass(r.id),
                rankAt: r.completed_at ?? Date.now(),
              }),
      });
      setPreview(r.id, o.assetId!, {
        state: "queued",
        at: Date.now(),
        tries,
        where: "worker",
        step: i,
      });
    } catch (e) {
      console.warn(`[fuobe] 3D preview for ${r.id} wasn't queued: ${(e as Error).message}`);
      setPreview(r.id, o.assetId!, {
        state: "failed",
        at: Date.now(),
        tries,
        why: "not queued",
      });
    }
    return;
  }
  if (!drawsHere(r, account)) return;
  const ctl = new AbortController();
  state().here.set(`${r.id}:${o.assetId}`, ctl);
  setPreview(r.id, o.assetId!, {
    state: "drawing",
    at: Date.now(),
    tries,
    where: "here",
  });
  void renderPreviewHere(absolutePath(asset.relPath), s, ctl.signal)
    .then(async ({ dir, code, error }) => {
      try {
        const files = Object.fromEntries(Object.entries(PREVIEW_FILES).map(([role, f]) => [role, path.join(dir, f.file)]));
        const kept = code === 0 ? keepFiles(r.id, files, tries) : null;
        if (code !== 0) console.warn(`[fuobe] 3D preview for ${r.id}: ${code === 3 ? "not drawn here" : "failed"}${error ? ` (${error})` : ""}`);
        setPreview(
          r.id,
          o.assetId!,
          kept ?? {
            state: "failed",
            at: Date.now(),
            tries,
            why: code === 3 ? "can't draw" : "failed",
          },
        );
      } finally {
        await removePreviewDir(dir);
      }
    })
    .catch((e) => {
      if (!ctl.signal.aborted) {
        console.warn(`[fuobe] 3D preview for ${r.id}: ${(e as Error).message}`);
        setPreview(r.id, o.assetId!, {
          state: "failed",
          at: Date.now(),
          tries,
          why: "failed",
        });
      }
    })
    .finally(() => state().here.delete(`${r.id}:${o.assetId}`));
}

/** Look at a preview on its way: a worker's job that ended (its files kept, or failed), or a draw here that stopped. */
function follow(r: Row, o: OutputFile, p: Preview3d): void {
  if (p.where === "here") {
    if (state().here.has(`${r.id}:${o.assetId}`)) return;
    // Drawn by a process that stopped (a restart, a deploy's other instance takes a while): again, later.
    if (Date.now() - p.at > STALE_HERE_MS)
      setPreview(r.id, o.assetId!, {
        state: "failed",
        at: Date.now(),
        tries: p.tries ?? 1,
        why: "stopped",
      });
    return;
  }
  const t = finishTask(r.id, "preview3d", p.step ?? 0);
  if (!t)
    return void setPreview(r.id, o.assetId!, {
      state: "failed",
      at: Date.now(),
      tries: TRIES,
      why: "gone",
    });
  const out = finishOutcome(t);
  if (out.state === "waiting") return;
  // (A worker's job is tried again by the line itself; one that failed there stays as it is.)
  if (out.state === "failed")
    return void setPreview(r.id, o.assetId!, {
      state: "failed",
      at: Date.now(),
      tries: TRIES,
      why: "worker",
    });
  // Kept once, whichever app process looks first (a deploy's overlap): the job notes the preview it gave.
  const kept = db()
    .transaction((): Preview3d | null => {
      const extra = json<{ preview?: Preview3d }>(
        (db().prepare("SELECT extra_json FROM relay_tasks WHERE id = ?").get(t.id) as { extra_json: string | null } | undefined)?.extra_json ?? null,
        {},
      );
      if (extra.preview) return extra.preview;
      const files = Object.fromEntries(Object.entries(out.files).map(([role, f]) => [role, f.path]));
      const p2 = keepFiles(r.id, files, p.tries ?? 1);
      if (p2)
        db()
          .prepare("UPDATE relay_tasks SET extra_json = json_set(COALESCE(extra_json, '{}'), '$.preview', json(?)) WHERE id = ?")
          .run(JSON.stringify(p2), t.id);
      return p2;
    })
    .immediate();
  setPreview(
    r.id,
    o.assetId!,
    kept ?? {
      state: "failed",
      at: Date.now(),
      tries: p.tries ?? 1,
      why: "not kept",
    },
  );
}

/**
 * Every few seconds (the runner's tick): the previews on their way followed, failed ones tried again (up to TRIES),
 * and new ones started (newest results first) while fewer than IN_FLIGHT are on their way.
 */
export function tickPreviews(now = Date.now()): void {
  // FUOBE_PREVIEWS_3D=0 turns it off (the tests do, but for their own).
  if (process.env.FUOBE_PREVIEWS_3D === "0") return;
  const s = state();
  if (now - s.last < LOOK_MS) return;
  s.last = now;
  try {
    const going = db()
      .prepare(
        `SELECT id, status, provider, model_id, op, request_json, outputs_json, completed_at FROM generations
         WHERE status = 'succeeded' AND (outputs_json LIKE '%"preview3d":{"state":"queued"%' OR outputs_json LIKE '%"preview3d":{"state":"drawing"%')`,
      )
      .all() as Row[];
    let inFlight = 0;
    for (const r of going) {
      for (const o of json<OutputFile[]>(r.outputs_json, [])) {
        const p = o.meta?.preview3d as Preview3d | undefined;
        if (o.kind !== "model3d" || !p || (p.state !== "queued" && p.state !== "drawing")) continue;
        inFlight++;
        follow(r, o, p);
      }
    }
    if (inFlight >= IN_FLIGHT) return;
    // Results with a model and no preview yet (or one to try again), newest first; a run in the Trash waits.
    const rows = db()
      .prepare(
        `SELECT g.id, g.status, g.provider, g.model_id, g.op, g.request_json, g.outputs_json, g.completed_at FROM generations g
         LEFT JOIN generation_trash t ON t.generation_id = g.id
         WHERE g.status = 'succeeded' AND t.generation_id IS NULL AND g.outputs_json LIKE '%"kind":"model3d"%'
           AND (g.outputs_json NOT LIKE '%"preview3d"%' OR g.outputs_json LIKE '%"preview3d":{"state":"failed"%')
         ORDER BY COALESCE(g.completed_at, g.created_at) DESC LIMIT 40`,
      )
      .all() as Row[];
    for (const r of rows) {
      if (inFlight >= IN_FLIGHT) break;
      const outputs = json<OutputFile[]>(r.outputs_json, []);
      for (const [i, o] of outputs.entries()) {
        if (inFlight >= IN_FLIGHT) break;
        const p = o.meta?.preview3d as Preview3d | undefined;
        // A failed one is tried again once, a while after.
        if (p) {
          if (p.state !== "failed" || (p.tries ?? 1) >= TRIES || now - p.at < 10 * 60_000 || !RETRY.includes(p.why ?? "")) continue;
          const again = outputs.map((x, j) => (j === i ? { ...x, meta: { ...x.meta, preview3d: undefined } } : x));
          if (!previewTargets(again).includes(i)) continue;
          start(r, i, outputs, (p.tries ?? 1) + 1);
          inFlight++;
          continue;
        }
        if (!previewTargets(outputs).includes(i)) continue;
        start(r, i, outputs, 1);
        inFlight++;
      }
    }
  } catch (e) {
    console.warn(`[fuobe] 3D previews: ${(e as Error).message}`);
  }
}

/** Stop a preview this server is drawing (the run was deleted). */
export function stopPreviews(id: string): void {
  for (const [k, ctl] of state().here) if (k.startsWith(`${id}:`)) ctl.abort();
}
