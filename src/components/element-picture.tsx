"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { uploadFile } from "@/lib/api";
import type { StudioElement } from "@/lib/catalog/elements";
import { addPhotoLabel, noStillWhy, pictureSource } from "@/lib/clip-thumb";
import { toastError } from "@/lib/refusals";
import type { Unavailable } from "@/lib/unavailable";
import { grabClipFrame, useClipStills } from "./element-thumb";

// The element dialog opens only when a photo is added from a picker, so it loads then.
const ElementDialog = dynamic(() => import("@/components/elements-view").then((m) => m.ElementDialog), { ssr: false });

/** A still's longest side when it is used as a picture (an avatar, an image reference). */
const PICTURE_SIDE = 2048;

/**
 * A clip's still as a stored picture, made and uploaded once per clip: its address, or null when this browser can't read
 * the clip. An upload that fails throws (and is tried again next time).
 */
const uploaded = new Map<string, Promise<string | null>>();
function clipPicture(clip: string): Promise<string | null> {
  let p = uploaded.get(clip);
  if (!p) {
    p = (async () => {
      const blob = await grabClipFrame(clip, PICTURE_SIDE, 0.92);
      if (!blob) return null;
      return (await uploadFile(new File([blob], "still.jpg", { type: "image/jpeg" }))).url;
    })();
    uploaded.set(clip, p);
    p.catch(() => uploaded.delete(clip));
  }
  return p;
}

/**
 * Pictures from elements, for pickers that need a picture (Blockout's references, the marketing avatar). An element with a
 * photo gives it; one with only a clip gives a still of its clip, made in the browser and uploaded when it is picked. A
 * clip this browser can't read leaves its element listed but unavailable, with the way to fix it: "Add a photo to Maya"
 * opens the element's dialog here.
 */
export function useElementPictures(elements: readonly StudioElement[]) {
  const clipOnly = elements.flatMap((e) => {
    const src = pictureSource(e.references);
    return src && "clip" in src ? [{ id: e.id, clip: src.clip }] : [];
  });
  const states = useClipStills(clipOnly.map((c) => c.clip));
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<StudioElement | null>(null);

  const unreadable = (e: StudioElement) => {
    const i = clipOnly.findIndex((c) => c.id === e.id);
    return i >= 0 && (failed.has(e.id) || states[i] === null);
  };
  /** Why an element has no picture to give, with the fix: "Add a photo to Maya" opens its dialog. */
  const reasonFor = (e: StudioElement): Unavailable => ({ why: noStillWhy(e.name), fix: { label: addPhotoLabel(e.name), run: () => setEditing(e) } });
  /** Why an element can't give a picture now (undefined: it can). */
  const unavailable = (e: StudioElement): Unavailable | undefined => (unreadable(e) ? reasonFor(e) : undefined);

  /**
   * The element's picture: its photo at once, else its clip's still once it is made and stored. "unreadable": its clip
   * can't be read here (the caller says why with reasonFor); null: nothing to use, or the upload failed (said in a toast).
   */
  const pick = async (e: StudioElement): Promise<{ url: string; still: boolean } | "unreadable" | null> => {
    const src = pictureSource(e.references);
    if (!src) return null;
    if ("photo" in src) return { url: src.photo, still: false };
    setBusy(e.id);
    try {
      const url = await clipPicture(src.clip);
      if (!url) {
        setFailed((s) => new Set(s).add(e.id));
        return "unreadable";
      }
      return { url, still: true };
    } catch (err) {
      toastError(err, `We couldn't save a still from ${e.name}'s clip. Try again`);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const dialog = editing ? <ElementDialog open onOpenChange={(o) => !o && setEditing(null)} element={editing} /> : null;
  return { pick, busy, unavailable, reasonFor, dialog };
}
