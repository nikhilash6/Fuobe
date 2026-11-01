"use client";

/**
 * Kept masters in this browser (IndexedDB "fuobe-live"), for the computer path: a step whose master the server couldn't
 * keep (the account's files are full) stays here, and a reload finds it. Every call is guarded: a browser that blocks
 * storage (a private window) just keeps nothing.
 */

const DB = "fuobe-live";
const STORE = "masters";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
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

export async function idbPut(key: string, bytes: Uint8Array): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(bytes, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbGet(key: string): Promise<Uint8Array | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result instanceof Uint8Array ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbDel(key: string): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Delete every stored master no session refers to any more (`keep`: the keys still in use). */
export async function idbPrune(keep: ReadonlySet<string>): Promise<void> {
  const db = await open();
  if (!db) return;
  const keys = await new Promise<IDBValidKey[]>((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
  for (const k of keys) if (typeof k === "string" && !keep.has(k)) await idbDel(k);
}
