import "server-only";
import { db } from "../db";
import { gatherInventory, type GatherOptions } from "@/lib/gpu/gather";
import type { CheckLine, GpuInventory } from "@/lib/gpu/types";
import { loadIndex } from "./index-file";
import { targetHost, transportFor, urlHash, type ReadTarget, type ServerTarget, type TransportOptions } from "./target";

/**
 * Snapshots of what a target's ComfyUI had (SPEC §5.2, §15), in memory and in SQLite, per target and per way it
 * was read (review 18). One probe per target at a time (a second caller joins it and gets its lines), at most
 * four probes at once across the server, and a full check at most every 10 s per target (review 6d).
 */

export interface Snapshot {
  targetKey: string;
  via: "server" | "browser";
  urlHash: string;
  checkedAt: number;
  indexHash: string;
  inventory: GpuInventory;
  /** The views built from it (cached until the index changes). */
  views?: { indexHash: string; data: unknown };
  stale: boolean;
}

interface Row {
  target_key: string;
  via: string;
  url_hash: string;
  checked_at: number;
  index_hash: string;
  inventory_json: string;
  report_json: string | null;
  stale: number;
}

declare global {
  var __fuobeGpuSnaps: Map<string, Snapshot> | undefined;
  var __fuobeGpuProbes: Map<string, { promise: Promise<GpuInventory>; lines: CheckLine[]; listeners: Set<(l: CheckLine) => void>; full: boolean }> | undefined;
  var __fuobeGpuLast: Map<string, number> | undefined;
  var __fuobeGpuSlots: { active: number; queue: (() => void)[] } | undefined;
}

const mem = () => (globalThis.__fuobeGpuSnaps ??= new Map());
const probes = () => (globalThis.__fuobeGpuProbes ??= new Map());
const last = () => (globalThis.__fuobeGpuLast ??= new Map());
const slots = () => (globalThis.__fuobeGpuSlots ??= { active: 0, queue: [] });

export const MAX_PROBES = 4;
export const CHECK_INTERVAL_MS = 10_000;

const memKey = (key: string, via: string) => `${key}|${via}`;

export function readSnapshot(t: ReadTarget): Snapshot | null {
  const hash = urlHash(t);
  const k = memKey(t.key, t.via);
  const hit = mem().get(k);
  if (hit) return hit.urlHash === hash ? hit : null;
  const row = db().prepare("SELECT * FROM gpu_snapshots WHERE target_key = ? AND via = ?").get(t.key, t.via) as Row | undefined;
  if (!row || row.url_hash !== hash) return null;
  let inventory: GpuInventory;
  try {
    inventory = JSON.parse(row.inventory_json) as GpuInventory;
  } catch {
    return null;
  }
  let views: Snapshot["views"];
  try {
    views = row.report_json ? (JSON.parse(row.report_json) as Snapshot["views"]) : undefined;
  } catch {}
  const snap: Snapshot = { targetKey: row.target_key, via: t.via, urlHash: row.url_hash, checkedAt: row.checked_at, indexHash: row.index_hash, inventory, views, stale: !!row.stale };
  mem().set(k, snap);
  return snap;
}

/** Keep a check (the server's own, or one a computer's tab sent in for its own ComfyUI). */
export function writeSnapshot(t: ReadTarget, inventory: GpuInventory): Snapshot {
  const snap: Snapshot = { targetKey: t.key, via: t.via, urlHash: urlHash(t), checkedAt: inventory.checkedAt, indexHash: loadIndex().hash, inventory, stale: false };
  db()
    .prepare(
      `INSERT INTO gpu_snapshots (target_key, via, url_hash, checked_at, index_hash, inventory_json, report_json, stale)
       VALUES (@target_key, @via, @url_hash, @checked_at, @index_hash, @inventory_json, NULL, 0)
       ON CONFLICT(target_key, via) DO UPDATE SET url_hash = excluded.url_hash, checked_at = excluded.checked_at, index_hash = excluded.index_hash,
         inventory_json = excluded.inventory_json, report_json = NULL, stale = 0`,
    )
    .run({ target_key: t.key, via: t.via, url_hash: snap.urlHash, checked_at: snap.checkedAt, index_hash: snap.indexHash, inventory_json: JSON.stringify(inventory) });
  mem().set(memKey(t.key, t.via), snap);
  return snap;
}

/** Keep the views built from a snapshot (rebuilt when the index changes, without a new probe). */
export function saveViews(snap: Snapshot, data: unknown): void {
  snap.views = { indexHash: loadIndex().hash, data };
  db().prepare("UPDATE gpu_snapshots SET report_json = ? WHERE target_key = ? AND via = ?").run(JSON.stringify(snap.views), snap.targetKey, snap.via);
}

/** A failed run or a finished fix: the next look re-checks. */
export function markStale(targetKey: string): void {
  for (const [k, s] of mem()) if (k.startsWith(`${targetKey}|`)) s.stale = true;
  db().prepare("UPDATE gpu_snapshots SET stale = 1 WHERE target_key = ?").run(targetKey);
}

/** The account's GPU changed or the account went (A4): its snapshots go. */
export function dropSnapshots(targetKey: string): void {
  for (const k of [...mem().keys()]) if (k.startsWith(`${targetKey}|`)) mem().delete(k);
  db().prepare("DELETE FROM gpu_snapshots WHERE target_key = ?").run(targetKey);
}

/** Wait for one of the server's probe slots. */
async function slot<T>(job: () => Promise<T>): Promise<T> {
  const s = slots();
  if (s.active >= MAX_PROBES) await new Promise<void>((r) => s.queue.push(r));
  s.active++;
  try {
    return await job();
  } finally {
    s.active--;
    s.queue.shift()?.();
  }
}

/** Seconds until this target may be checked again (0: now). */
export function checkWait(t: ServerTarget, now = Date.now()): number {
  const at = last().get(t.key) ?? 0;
  return Math.max(0, Math.ceil((at + CHECK_INTERVAL_MS - now) / 1000));
}

export function probeRunning(t: ServerTarget): boolean {
  return probes().has(t.key);
}

export function audit(row: { actor: string; targetKey: string; host: string; action: string; result: string; item?: string; detail?: string }): void {
  const d = db();
  d.prepare("INSERT INTO gpu_audit (at, actor, target_key, host, action, item, result, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    Date.now(),
    row.actor,
    row.targetKey,
    row.host,
    row.action,
    row.item ?? null,
    row.result,
    row.detail ?? null,
  );
  // 90 days, and at most 500 rows per target.
  if (Math.random() < 0.05) {
    d.prepare("DELETE FROM gpu_audit WHERE at < ?").run(Date.now() - 90 * 86_400_000);
    d.prepare("DELETE FROM gpu_audit WHERE target_key = ? AND id NOT IN (SELECT id FROM gpu_audit WHERE target_key = ? ORDER BY at DESC LIMIT 500)").run(row.targetKey, row.targetKey);
  }
}

export interface ProbeOptions extends TransportOptions {
  actor: string;
  onLine?: (l: CheckLine) => void;
  /** A targeted re-check (the gate, a plan): only these. */
  classes?: string[];
  folders?: string[];
  loraNames?: string[];
}

/**
 * Probe a target and store the result. A full check joins one that is already running for the target (and
 * gets the lines it already sent). A targeted re-check merges what it read into the stored snapshot.
 */
export async function probe(t: ServerTarget, o: ProbeOptions): Promise<GpuInventory> {
  const running = probes().get(t.key);
  const targeted = !!(o.classes || o.folders);
  if (running && (running.full || targeted)) {
    if (o.onLine) {
      running.lines.forEach(o.onLine);
      running.listeners.add(o.onLine);
    }
    try {
      return await running.promise;
    } finally {
      if (o.onLine) running.listeners.delete(o.onLine);
    }
  }
  const entry = { promise: null as unknown as Promise<GpuInventory>, lines: [] as CheckLine[], listeners: new Set<(l: CheckLine) => void>(), full: !targeted };
  if (o.onLine) entry.listeners.add(o.onLine);
  const opts: GatherOptions = {
    where: t.kind === "install" ? "install" : "link",
    onLine: (l) => {
      entry.lines.push(l);
      for (const fn of entry.listeners) fn(l);
    },
    ...(targeted && { classes: o.classes ?? [], folders: o.folders ?? [], loraNames: o.loraNames }),
    ...(!targeted && o.loraNames && { loraNames: o.loraNames }),
  };
  entry.promise = slot(() => gatherInventory(transportFor(t, o), loadIndex(), opts));
  probes().set(t.key, entry);
  last().set(t.key, Date.now());
  try {
    const inv = await entry.promise;
    const base = readSnapshot(t);
    const stored = targeted ? (base && inv.reachable ? mergeTargeted(base.inventory, inv, o) : null) : inv;
    if (stored) writeSnapshot(t, stored);
    audit({ actor: o.actor, targetKey: t.key, host: targetHost(t), action: targeted ? "recheck" : "check", result: inv.reachable ? "ok" : (inv.problem ?? "failed"), detail: `${inv.tookMs} ms` });
    return targeted && stored ? stored : inv;
  } finally {
    probes().delete(t.key);
  }
}

/** A targeted read folded into the stored inventory: the classes and folders it read replace what was stored. */
export function mergeTargeted(base: GpuInventory, fresh: GpuInventory, o: { classes?: string[]; folders?: string[] }): GpuInventory {
  const asked = new Set(o.classes ?? []);
  const keep = (list: string[]) => list.filter((c) => !asked.has(c));
  const folders = new Set(o.folders ?? []);
  const models = { ...base.models };
  for (const f of folders) if (fresh.models[f]) models[f] = fresh.models[f];
  return {
    ...base,
    checkedAt: fresh.checkedAt,
    nodes: {
      ...base.nodes,
      have: [...new Set([...keep(base.nodes.have), ...fresh.nodes.have])].sort(),
      missing: [...new Set([...keep(base.nodes.missing), ...fresh.nodes.missing])].sort(),
      readAt: fresh.nodes.readAt,
    },
    combos: { ...base.combos, ...fresh.combos },
    models,
    loras: folders.has("loras") ? { ...fresh.loras } : base.loras,
    errors: fresh.errors.length ? fresh.errors : base.errors,
  };
}
