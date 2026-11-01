import "server-only";
import { db } from "../db";
import { json, type TaskRow } from "./tasks";
import type { WorkerRow } from "./workers";

/**
 * Benchmarks for workers (docs/gpu-workers.md): how long each lane takes on each worker. Every job a worker finishes
 * counts (its last 20 per lane give the median and the 90th percentile), so the numbers follow real work. Bench jobs
 * (one small fixed job per lane, made for one worker only, never billed) fill them in before any real work; a lane
 * gets one once the catalog defines it (BENCH_JOBS, empty until then).
 */

export interface LaneBench {
  medianMs?: number;
  p90Ms?: number;
  loadMs?: number;
  peakVramBytes?: number;
  /** The last durations, newest last. */
  runs?: number[];
}

/** Workflow id → the fixed input of its bench job. Filled in by the catalog's bench definitions. */
export const BENCH_JOBS: Record<string, { prompt: string; seed: number }> = {};

const KEEP = 20;

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/** A worker finished a task: its time (from start to finish) and peak VRAM count for its lane there. */
export function noteFinished(t: Pick<TaskRow, "worker_id" | "lane" | "started_at" | "sent_at">, now = Date.now(), peakVramBytes?: number): void {
  if (!t.worker_id || !t.lane) return;
  const from = t.started_at ?? t.sent_at;
  if (!from || now <= from) return;
  const w = db().prepare("SELECT bench_json FROM relay_workers WHERE id = ?").get(t.worker_id) as { bench_json: string | null } | undefined;
  if (!w) return;
  const all = json<Record<string, LaneBench>>(w.bench_json, {});
  const lane = all[t.lane] ?? {};
  const runs = [...(lane.runs ?? []), now - from].slice(-KEEP);
  const sorted = [...runs].sort((a, b) => a - b);
  all[t.lane] = {
    ...lane,
    runs,
    medianMs: percentile(sorted, 0.5),
    p90Ms: percentile(sorted, 0.9),
    ...(peakVramBytes && peakVramBytes > 0 && { peakVramBytes: Math.max(peakVramBytes, lane.peakVramBytes ?? 0) }),
  };
  db().prepare("UPDATE relay_workers SET bench_json = ? WHERE id = ?").run(JSON.stringify(all), t.worker_id);
}

/** Bench tasks for this worker's allowed lanes (or the ones asked for): how many were made. */
export async function benchTasks(w: WorkerRow, lanes?: string[]): Promise<number> {
  const allowed = Object.keys(json<Record<string, unknown>>(w.allow_json, {}));
  const want = lanes ? allowed.filter((l) => lanes.includes(l)) : allowed;
  if (!want.length || !Object.keys(BENCH_JOBS).length) return 0;
  // The catalog defines no bench job yet; when it does, each runs through the owner's normal run path with
  // only_worker set to this worker (pool.ts poolFields).
  return 0;
}
