"use client";

import { Loader2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SlotValue } from "@/components/studio/media-slot";
import { useAskBeforeUpload, useIsGuest } from "@/lib/api";
import { clock } from "@/lib/av/fit-upload";
import { cutMp4, readMp4Index, type CutPart, type Mp4Index } from "@/lib/av/mp4-cut";
import { postFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { readSeconds } from "./fit-audio";
import { TrimPicker } from "./trim-picker";
import { useUploadSwitches } from "./use-upload-switches";

/**
 * The fitting step on a clip slot: a clip longer than the tool takes gets a part offered (src/components/av/trim-picker.tsx)
 * instead of only a refusal. The part is cut without encoding again (src/lib/av/mp4-cut.ts), from a key frame, so it
 * keeps its quality and takes a moment. An MP4 or MOV only: another kind of clip, or the owner's "Offer a part" switch off,
 * leaves the clip as it is, and the tool's own check says why it can't take it.
 * - A clip picked, dropped or pasted (`take`): offered before it is uploaded.
 * - A clip already stored (a library pick, a Reuse, one uploaded elsewhere): offered once it is in the slot.
 * Cancel keeps the clip as it is. While the part is cut and uploaded, the slot shows as uploading.
 */

export interface ClipFitRule {
  /** Who the part is for, in the line after it is cut ("for H3 Max"). */
  for: string;
  /** The tool's name in the line ("Kandinsky VSR takes up to 0:05"). */
  tool: string;
  minSeconds?: number;
  maxSeconds: number;
  /** The picker's line, when the page says it its own way (a part to cut so clips fit together). */
  line?: string;
}

type Offer = { source: Blob | string; name?: string; seconds: number; index: Mp4Index; stored?: SlotValue };

/** A part a hair shorter than the tool's limit, so its header never reads a frame over it. */
const MARGIN = 0.05;
const SLACK = 0.05;

/** A stored file's bytes by range (its header boxes only). */
const rangeReader = (url: string) => async (a: number, b: number) => {
  const res = await fetch(url, { headers: { Range: `bytes=${a}-${b - 1}` } });
  if (!res.ok) throw new Error(String(res.status));
  const buf = new Uint8Array(await res.arrayBuffer());
  // A server that ignores Range sends the whole file: the part asked for is in it.
  return res.status === 206 ? buf : buf.subarray(a, b);
};
const blobReader = (b: Blob) => async (a: number, c: number) => new Uint8Array(await b.slice(a, c).arrayBuffer());

async function storedSize(url: string): Promise<number | undefined> {
  const r = await fetch(url, { headers: { Range: "bytes=0-0" } }).catch(() => null);
  void r?.body?.cancel();
  return Number(/\/(\d+)$/.exec(r?.headers.get("content-range") ?? "")?.[1] ?? r?.headers.get("content-length")) || undefined;
}

/** "Beach.mov" -> "Beach (part).mov". */
const partName = (name: string | undefined, type: string) => {
  const base = (name ?? "").split(/[\\/]/).pop()?.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || "Clip";
  return `${base} (part).${type === "video/quicktime" ? "mov" : "mp4"}`;
};

function partFile(src: Blob, parts: CutPart[], name: string | undefined): File {
  const type = src.type === "video/quicktime" ? "video/quicktime" : "video/mp4";
  const blobs: BlobPart[] = parts.map((p) => (p instanceof Uint8Array ? (p as Uint8Array<ArrayBuffer>) : src.slice(p.start, p.end)));
  return new File(blobs, partName(name, type), { type });
}

export function useClipFit({
  rule,
  value,
  seconds,
  setValue,
  upload,
}: {
  /** The tool's rule; null turns the step off. Keep it stable between renders (useMemo). */
  rule: ClipFitRule | null;
  value: SlotValue | null | undefined;
  /** The stored clip's length, when the page has read it already. */
  seconds?: number;
  setValue: (v: SlotValue | null) => void;
  /** The slot's own upload (it places the tile and swaps in the stored file, or keeps it for a guest). */
  upload: (f: File) => void;
}) {
  const sw = useUploadSwitches();
  const on = !!rule && sw.videoTrim;
  const guest = useIsGuest();
  const askFirst = useAskBeforeUpload();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ ref: string; line: string; max: number } | null>(null);
  // A stored clip whose offer was cancelled (Again offers it once more), and one this can't cut (not an MP4 or MOV).
  const [declined, setDeclined] = useState<string | null>(null);
  const [uncut, setUncut] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(value);
  const cb = useRef({ rule, setValue, upload });
  useEffect(() => {
    latest.current = value;
    cb.current = { rule, setValue, upload };
  });
  // Stored clips offered a part already: not offered again (a Cancel stands).
  const offered = useRef(new Set<string>());
  // A part handed to the slot's upload, by name: its stored address is marked once it lands.
  const expect = useRef<{ name: string; line: string; max: number } | null>(null);
  const landed = value && !value.uploading ? value.held ?? value.ref : undefined;
  useEffect(() => {
    if (!expect.current || value?.uploading) return;
    if (value?.name === expect.current.name && landed) setMade({ ref: landed, line: expect.current.line, max: expect.current.max });
    expect.current = null;
  }, [value, landed]);

  const lineFor = (s: number, max: number, r: ClipFitRule) => `This clip is ${clock(s)}. ${r.tool} takes up to ${max < 60 ? `${Math.floor(max * 10) / 10} s` : clock(max)}: pick the part to use`;

  /** True when this step takes the file: a clip, while a rule and the switch are on. */
  const wants = useCallback((f: File) => on && (f.type.startsWith("video/") || /\.(mp4|mov|m4v)$/i.test(f.name)), [on]);

  /** A clip picked, dropped or pasted: its length from its header, then a part offered, or the clip uploaded as it is. */
  const take = useCallback(
    (f: File) => {
      const r = cb.current.rule;
      setOffer(null);
      setError(null);
      if (!r || !on) return cb.current.upload(f);
      void (async () => {
        const s = await readSeconds(f, true);
        if (!s || s <= r.maxSeconds + SLACK) return cb.current.upload(f);
        const index = await readMp4Index(blobReader(f), f.size);
        // Not an MP4 or MOV this can cut: as it is, and the tool's check says why.
        if (!index) return cb.current.upload(f);
        setOffer({ source: f, name: f.name, seconds: index.seconds || s, index });
      })();
    },
    [on],
  );

  // A stored clip longer than the tool takes: offered once.
  const ref = on && value && !value.uploading && !value.held && value.ref.startsWith("/api/files/") ? value.ref : undefined;
  useEffect(() => {
    const r = cb.current.rule;
    if (!r || !ref || guest || offered.current.has(ref) || (made?.ref === ref && made.max <= r.maxSeconds + SLACK) || !seconds || seconds <= r.maxSeconds + SLACK) return;
    let gone = false;
    void (async () => {
      const size = await storedSize(ref);
      const index = size ? await readMp4Index(rangeReader(ref), size).catch(() => null) : null;
      if (gone || latest.current?.ref !== ref) return;
      if (!index) return setUncut(ref);
      offered.current.add(ref);
      setOffer({ source: ref, name: latest.current.name, seconds: index.seconds || seconds, index, stored: latest.current });
    })();
    return () => {
      gone = true;
    };
  }, [ref, seconds, guest, made, tick]);

  // An offer belongs to the clip it was made for.
  const offerGone = !!offer && (offer.stored ? value?.ref !== offer.stored.ref : !!value && !value.uploading);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (offerGone) setOffer(null);
  }

  const use = useCallback(
    async (from: number, to: number) => {
      const r = cb.current.rule;
      if (!offer || !r || askFirst()) return;
      const o = offer;
      setOffer(null);
      setError(null);
      const cut = cutMp4(o.index, from, Math.min(to - from, r.maxSeconds - MARGIN));
      if (!cut) return setError("We couldn't cut this clip here. Trim it in another app and add it again");
      const line = `Using ${clock(cut.from)}–${clock(cut.from + cut.seconds)} for ${r.for}`;
      if (!o.stored) {
        const file = partFile(o.source as Blob, cut.parts, o.name);
        expect.current = { name: file.name, line, max: r.maxSeconds };
        return cb.current.upload(file);
      }
      const token = nanoid(8);
      const stored = o.stored;
      cb.current.setValue({ ...stored, id: token, uploading: true });
      latest.current = { ...stored, id: token, uploading: true };
      setBusy(true);
      try {
        const res = await fetch(stored.ref);
        if (!res.ok) throw new Error("We couldn't open the clip to cut it. Add it again");
        const file = partFile(await res.blob(), cut.parts, o.name);
        const asset = await postFile(file);
        if (latest.current?.id !== token) return;
        cb.current.setValue({ ref: asset.url, preview: asset.url, kind: asset.kind ?? "video", name: file.name, source: "upload" });
        setMade({ ref: asset.url, line, max: r.maxSeconds });
      } catch (e) {
        if (latest.current?.id !== token) return;
        cb.current.setValue({ ...stored, uploading: false });
        setError((e as Error).message || "We couldn't cut this clip here. Trim it in another app and add it again");
      } finally {
        setBusy(false);
      }
    },
    [offer, askFirst],
  );

  const shownOffer = offer && !offerGone && rule ? offer : null;
  const line = busy
    ? "Cutting the part…"
    : (error ?? (made && landed === made.ref ? made.line : uncut && uncut === ref ? "This clip can't be cut here (MP4 and MOV only): trim it in another app and add it again" : null));
  return {
    on,
    wants,
    take,
    busy,
    line,
    failedNow: (!!error || (!!uncut && uncut === ref)) && !busy,
    /** The stored clip in the slot had its part offered and the offer was cancelled. */
    declined: !!ref && declined === ref && !offer,
    /** Offer the stored clip's part again (after a Cancel). */
    again: () => {
      offered.current.clear();
      setDeclined(null);
      setTick((t) => t + 1);
    },
    offer: shownOffer
      ? {
          ...shownOffer,
          max: rule!.maxSeconds,
          min: rule!.minSeconds,
          line: rule!.line ?? lineFor(shownOffer.seconds, rule!.maxSeconds, rule!),
          use: (a: number, b: number) => void use(a, b),
          cancel: () => {
            const o = shownOffer;
            setOffer(null);
            if (o.stored) setDeclined(o.stored.ref);
            // A clip picked here and not cut goes in as it is: the tool's own check says why it can't take it.
            else cb.current.upload(o.source as File);
          },
        }
      : null,
  };
}

/** The slot's line (cutting, the part used, why not) and the part to pick when the clip is longer than the tool takes. */
export function FitClipNote({ fit, className }: { fit: ReturnType<typeof useClipFit>; className?: string }) {
  const o = fit.offer;
  if (!fit.line && !o) return null;
  return (
    <div className={cn("space-y-1.5 pb-2 text-xs text-muted-foreground", className)}>
      {fit.line && (
        <p role="status" className={cn("flex items-center gap-1.5", fit.failedNow && "text-destructive")}>
          {fit.busy && <Loader2 className="size-3 shrink-0 animate-spin" />}
          {fit.line}
        </p>
      )}
      {o && <TrimPicker source={o.source} kind="video" seconds={o.seconds} max={o.max} min={o.min} line={o.line} keyframes={o.index.keyframes} onUse={o.use} onCancel={o.cancel} />}
    </div>
  );
}
