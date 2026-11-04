"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KineticDoc } from "@/lib/motion/kinetic-doc";
import { canRedo, canUndo, change, redo, restore, settle, SETTLE_MS, startHistory, undo, type History } from "./history";

/**
 * The editor's document with undo and redo for this visit. `apply` makes a change: a plain one is a step of its own; a
 * gesture's changes (a drag, typing) join one step until it settles (`end`, or SETTLE_MS after the last change).
 * Ctrl/⌘ Z undoes; Ctrl/⌘ Shift Z and Ctrl Y redo (not while typing in a field, where the browser's own undo works).
 */
export function useKineticEditor() {
  const [h, setH] = useState<History<KineticDoc> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const end = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setH((x) => (x ? settle(x) : x));
  }, []);

  const apply = useCallback(
    (f: (d: KineticDoc) => KineticDoc, o: { gesture?: boolean } = {}) => {
      setH((x) => (x ? change(x, f(x.present), o) : x));
      if (o.gesture) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(end, SETTLE_MS);
      }
    },
    [end],
  );

  /** Opens a document: the first one starts the history; later ones (another scene) are a step. */
  const open = useCallback((doc: KineticDoc) => setH((x) => (x ? change(settle(x), doc) : startHistory(doc))), []);
  const restoreTo = useCallback((doc: KineticDoc) => setH((x) => (x ? restore(x, doc) : startHistory(doc))), []);
  const doUndo = useCallback(() => setH((x) => (x ? undo(x) : x)), []);
  const doRedo = useCallback(() => setH((x) => (x ? redo(x) : x)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range") || el.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if ((k === "z" && e.shiftKey) || (k === "y" && !e.metaKey)) {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return {
    doc: h?.present ?? null,
    apply,
    end,
    open,
    restore: restoreTo,
    undo: doUndo,
    redo: doRedo,
    canUndo: !!h && canUndo(h),
    canRedo: !!h && canRedo(h),
  };
}

export type KineticEditor = ReturnType<typeof useKineticEditor>;
