import "server-only";
import { readUploadSwitches, type UploadSwitches } from "@/lib/av/upload-switches";
import { db } from "./db";

/**
 * The owner's switches for the fitting step (src/lib/av/upload-switches.ts), kept in the settings table under one key as
 * JSON. Nothing set: all on. Read again at most every 2 s, so both of a deploy's processes see a change within that.
 */

const KEY = "uploads.switches";

declare global {
  var __fuobeUploadSwitches: { at: number; raw: string | null; value: UploadSwitches } | undefined;
}

function fromStored(raw: string | null): UploadSwitches {
  if (!raw) return readUploadSwitches(null);
  try {
    return readUploadSwitches(JSON.parse(raw));
  } catch {
    return readUploadSwitches(null);
  }
}

/** The switches in effect. */
export function uploadSwitches(now = Date.now()): UploadSwitches {
  const c = globalThis.__fuobeUploadSwitches;
  if (c && now - c.at < 2000) return { ...c.value };
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  const raw = row?.value ?? null;
  const value = c && c.raw === raw ? c.value : fromStored(raw);
  globalThis.__fuobeUploadSwitches = { at: now, raw, value };
  return { ...value };
}

/** Save the switches (checked first with checkUploadSwitches). */
export function saveUploadSwitches(s: UploadSwitches): UploadSwitches {
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(KEY, JSON.stringify(s));
  globalThis.__fuobeUploadSwitches = undefined;
  return uploadSwitches();
}
