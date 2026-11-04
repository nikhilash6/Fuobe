"use client";

import { nanoid } from "nanoid";
import { createContext } from "react";

/**
 * Files a guest attaches before signing up (hosted runs on): kept in this browser, never uploaded, until the guest has an
 * account. They live in IndexedDB, so they survive the sign-up page and the reload after it (the studio then uploads them
 * as the new account's own files); where IndexedDB isn't there (a private window), in this page's memory only.
 *
 * Nothing is kept longer than it is needed. Each studio page that opens sweeps the kept files (sweepHeld): a file kept
 * for more than a day goes, and so does one that no saved draft of its tab holds any more, once that tab has no page
 * open (each tab marks its pages with a lock while they are open). A file read after a day is dropped as it is read.
 */

const DB = "fuobe-held-files";
const STORE = "files";
const MAX_AGE_MS = 24 * 60 * 60_000;
/** This tab's id for the files it keeps (sessionStorage: the same through reloads, gone with the tab). */
const TAB_KEY = "fuobe:held-tab";
const LOCK_PREFIX = "fuobe-held:";

/** The studio composer holds a guest's files this way (useAskBeforeUpload then opens no sign-up card for them). */
export const HoldFilesCtx = createContext(false);

declare global {
  var __fuobeHeldFiles: Map<string, File> | undefined;
  var __fuobeHeldTab: Promise<string> | undefined;
}

const memory = () => (globalThis.__fuobeHeldFiles ??= new Map());

/** A kept file as IndexedDB stores it. */
interface HeldRow {
  file: Blob;
  name: string;
  type: string;
  at: number;
  /** The tab that kept it (rows from before tabs were noted have none). */
  tab?: string;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      db.close();
      resolve(null);
    }
  });
}

function tabStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function newTab(): string {
  const id = nanoid(10);
  try {
    tabStorage()?.setItem(TAB_KEY, id);
  } catch {}
  return id;
}

/** Hold a tab's lock while this page is open, without waiting: false when another page holds it (a duplicated tab). */
function takeLock(locks: LockManager, tab: string): Promise<boolean> {
  return new Promise((resolve) => {
    locks
      .request(`${LOCK_PREFIX}${tab}`, { ifAvailable: true }, (lock) => {
        resolve(!!lock);
        return lock ? new Promise<never>(() => {}) : undefined;
      })
      .catch(() => resolve(false));
  });
}

/**
 * This page's tab id, marked as in use for as long as the page is open, so another tab's sweep leaves its files alone.
 * A duplicated tab (which copies the id with its sessionStorage) takes a new one.
 */
export function claimTab(): Promise<string> {
  return (globalThis.__fuobeHeldTab ??= (async () => {
    let tab = tabStorage()?.getItem(TAB_KEY) || newTab();
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return tab;
    if (!(await takeLock(locks, tab))) {
      tab = newTab();
      await takeLock(locks, tab);
    }
    return tab;
  })());
}

/** The tabs with a page open now (null: this browser can't tell, so every other tab counts as open). */
async function openTabs(): Promise<Set<string> | null> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return null;
  try {
    const q = await locks.query();
    return new Set((q.held ?? []).map((l) => l.name ?? "").filter((n) => n.startsWith(LOCK_PREFIX)).map((n) => n.slice(LOCK_PREFIX.length)));
  } catch {
    return null;
  }
}

/** Keep a file under `id` until the guest signs up (or for a day). Never throws. */
export async function holdFile(id: string, file: File): Promise<void> {
  memory().set(id, file);
  const tab = await claimTab();
  await withStore("readwrite", (s) => s.put({ file, name: file.name, type: file.type, at: Date.now(), tab } satisfies HeldRow, id));
}

/** A kept file, or null when it is gone (cleared by the browser, older than a day, never kept here). */
export async function readHeld(id: string): Promise<File | null> {
  const mem = memory().get(id);
  if (mem) return mem;
  const row = (await withStore("readonly", (s) => s.get(id) as IDBRequest<HeldRow | undefined>)) ?? null;
  if (!row) return null;
  if (Date.now() - row.at > MAX_AGE_MS) {
    void dropHeld(id);
    return null;
  }
  return row.file instanceof File ? row.file : new File([row.file], row.name, { type: row.type });
}

/** Forget a kept file (uploaded, or taken out of the draft). */
export async function dropHeld(id: string): Promise<void> {
  memory().delete(id);
  await withStore("readwrite", (s) => s.delete(id));
}

/**
 * The kept files a sweep drops: every one older than a day; and, with `keep` (the files this tab's saved drafts and this
 * page hold, swept for a guest), every other one of this tab's, or of a tab with no page open any more.
 */
export function heldToSweep(rows: { id: string; at: number; tab?: string }[], o: { now: number; tab: string; keep: ReadonlySet<string> | null; open: ReadonlySet<string> | null }): string[] {
  return rows
    .filter((r) => {
      if (o.now - r.at > MAX_AGE_MS) return true;
      if (!o.keep || o.keep.has(r.id)) return false;
      if (!r.tab || r.tab === o.tab) return true;
      return !!o.open && !o.open.has(r.tab);
    })
    .map((r) => r.id);
}

/** Does this browser have the kept files' store (null: it can't say)? */
async function heldStoreExists(): Promise<boolean | null> {
  try {
    if (typeof indexedDB === "undefined") return false;
    if (typeof indexedDB.databases !== "function") return null;
    return (await indexedDB.databases()).some((d) => d.name === DB);
  } catch {
    return null;
  }
}

/**
 * Sweep the kept files as a studio page opens (heldToSweep). `keep`: the files this tab's saved drafts hold, for a
 * guest; null sweeps only the files older than a day. Never throws.
 */
export async function sweepHeld(keep: ReadonlySet<string> | null): Promise<void> {
  // Nothing kept in this browser: nothing to sweep (and no store is made for it). Anyone else's page sweeps only a
  // store it knows is there.
  const store = await heldStoreExists();
  if (store === false || (store === null && !keep)) return;
  const tab = keep ? await claimTab() : "";
  const live = keep ? await openTabs() : null;
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const files = tx.objectStore(STORE);
    const rows: { id: string; at: number; tab?: string }[] = [];
    const cursor = files.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        const v = c.value as Partial<HeldRow> | undefined;
        rows.push({ id: String(c.key), at: v?.at ?? 0, ...(v?.tab && { tab: v.tab }) });
        return c.continue();
      }
      const kept = keep && new Set([...keep, ...memory().keys()]);
      for (const id of heldToSweep(rows, { now: Date.now(), tab, keep: kept, open: live })) files.delete(id);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  } catch {
    db.close();
  }
}
