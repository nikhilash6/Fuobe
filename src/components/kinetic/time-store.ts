"use client";

import { useSyncExternalStore } from "react";

/**
 * The editor's playhead, shared by the preview, the transport, the timeline and the key buttons without re-rendering
 * the whole editor on every frame: the preview writes it, readers subscribe (labels at most ten times a second).
 */
export interface TimeStore {
  get(): number;
  set(t: number): void;
  /** Whether the preview plays. */
  playing(): boolean;
  setPlaying(p: boolean): void;
  subscribe(fn: () => void): () => void;
  /** Asks the preview to go to a time (the timeline, the keys). */
  seek(t: number): void;
  onSeek(fn: (t: number) => void): () => void;
}

export function createTimeStore(): TimeStore {
  let t = 0;
  let play = false;
  let last = 0;
  const subs = new Set<() => void>();
  const seekers = new Set<(t: number) => void>();
  const emit = () => subs.forEach((f) => f());
  return {
    get: () => t,
    set(v) {
      t = v;
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      // Readers hear at most ten times a second while it plays.
      if (!play || now - last > 100) {
        last = now;
        emit();
      }
    },
    playing: () => play,
    setPlaying(p) {
      if (p === play) return;
      play = p;
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    seek(v) {
      seekers.forEach((f) => f(v));
    },
    onSeek(fn) {
      seekers.add(fn);
      return () => void seekers.delete(fn);
    },
  };
}

export function usePlayhead(store: TimeStore): number {
  return useSyncExternalStore(store.subscribe, store.get, () => 0);
}

export function usePlaying(store: TimeStore): boolean {
  return useSyncExternalStore(store.subscribe, store.playing, () => false);
}
