"use client";

import { createContext } from "react";

/**
 * Files a guest attaches before signing up (hosted runs on): kept in this browser, never uploaded, until the guest has an
 * account. They live in IndexedDB, so they survive the sign-up page and the reload after it (the studio then uploads them
 * as the new account's own files); where IndexedDB isn't there (a private window), in this page's memory only. A file
 * kept for more than a day is dropped.
 */

const DB = "fuobe-held-files";
const STORE = "files";
const MAX_AGE_MS = 24 * 60 * 60_000;

/** The studio composer holds a guest's files this way (useAskBeforeUpload then opens no sign-up card for them). */
export const HoldFilesCtx = createContext(false);

declare global {
  var __fuobeHeldFiles: Map<string, File> | undefined;
}

const memory = () => (globalThis.__fuobeHeldFiles ??= new Map());

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

/** Keep a file under `id` until the guest signs up (or for a day). Never throws. */
export async function holdFile(id: string, file: File): Promise<void> {
  memory().set(id, file);
  await withStore("readwrite", (s) => s.put({ file, name: file.name, type: file.type, at: Date.now() }, id));
  void dropOldHeld();
}

/** A kept file, or null when it is gone (cleared by the browser, older than a day, never kept here). */
export async function readHeld(id: string): Promise<File | null> {
  const mem = memory().get(id);
  if (mem) return mem;
  const row = (await withStore("readonly", (s) => s.get(id) as IDBRequest<{ file: Blob; name: string; type: string; at: number } | undefined>)) ?? null;
  if (!row || Date.now() - row.at > MAX_AGE_MS) return null;
  return row.file instanceof File ? row.file : new File([row.file], row.name, { type: row.type });
}

/** Forget a kept file (uploaded, or taken out of the draft). */
export async function dropHeld(id: string): Promise<void> {
  memory().delete(id);
  await withStore("readwrite", (s) => s.delete(id));
}

/** Forget every kept file older than a day. */
async function dropOldHeld(): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const cursor = tx.objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      const at = (c.value as { at?: number } | undefined)?.at ?? 0;
      if (Date.now() - at > MAX_AGE_MS) c.delete();
      c.continue();
    };
    tx.oncomplete = () => db.close();
  } catch {
    db.close();
  }
}
