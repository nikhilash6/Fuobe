"use client";

import { Loader2, Scissors, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SlotValue } from "@/components/studio/media-slot";
import { useAskBeforeUpload, useIsGuest } from "@/lib/api";
import { clock, convertedLine, fitSourceKind, FIT_SOURCE_MAX_BYTES, mp3Kbps, planAudioFit, type AudioFitRule, type FitPlan } from "@/lib/av/fit-upload";
import { songFormat } from "@/lib/lyrics";
import { postFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { readSeconds, toMp3 } from "./fit-audio";

/**
 * The fitting step on a sound slot (src/lib/av/fit-upload.ts): a file the tool can't take as it is becomes one it takes, in
 * this browser, instead of being refused.
 * - A file picked, dropped or pasted: its length read from its header, then kept, converted to an MP3 before it is
 *   uploaded, offered as a part (the person picks it), or refused in one line (too big or too long to read here; nothing
 *   is uploaded).
 * - A file already stored (a library pick, a Reuse): the same, fetched from here and uploaded again once fitted.
 * While it converts, the slot shows as uploading, so Generate waits. `skip` leaves a file alone (Mureka's own song, sent by
 * its id).
 */

type Offer = { source: Blob | string; name?: string; seconds: number; max: number; line: string; stored?: SlotValue };

/** A part a hair shorter than the tool's limit, so the file's own header never reads a frame over it. */
const MARGIN = 0.5;

export function useFitUpload({
  rule,
  value,
  skip = false,
  seconds,
  setValue,
  upload,
}: {
  /** The tool's rule; null turns the step off. Keep it stable between renders (useMemo). */
  rule: AudioFitRule | null;
  value: SlotValue | null | undefined;
  skip?: boolean;
  /** The stored file's length, when the page has read it already. */
  seconds?: number;
  setValue: (v: SlotValue | null) => void;
  /** The slot's own upload (it places the tile and swaps in the stored file, or keeps it for a guest). */
  upload: (f: File) => void;
}) {
  const guest = useIsGuest();
  const askFirst = useAskBeforeUpload();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ line: string; at: string | null } | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [start, setStart] = useState(0);
  const [made, setMade] = useState<Set<string>>(() => new Set());
  const failed = useRef(new Set<string>());
  const latest = useRef(value);
  const cb = useRef({ setValue, upload, rule });
  useEffect(() => {
    latest.current = value;
    cb.current = { setValue, upload, rule };
  });
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  // A file this step handed to the slot's upload, by name: once it lands (stored, or kept for a guest) it is marked.
  const expect = useRef<string | null>(null);
  const landed = value && !value.uploading ? (value.held ?? value.ref) || undefined : undefined;
  useEffect(() => {
    if (!expect.current || value?.uploading) return;
    if (value?.name === expect.current && landed) setMade((m) => new Set(m).add(landed));
    expect.current = null;
  }, [value, landed]);

  /** Put a stand-in in the slot (uploading, so Generate waits) and know it at once. */
  const hold = useCallback((v: SlotValue) => {
    cb.current.setValue(v);
    latest.current = v;
  }, []);
  // Stored files offered a part already: not offered again (a Cancel stands).
  const offered = useRef(new Set<string>());

  /** Convert while the slot holds `token` (the person may remove or replace the file meanwhile), then hand the MP3 on. */
  const convert = useCallback(
    async (token: string, source: () => Promise<Blob>, opts: { kbps: number; name?: string; from?: number; to?: number }, done: (f: File) => Promise<void> | void, onFail: (why: string) => void) => {
      ctl.current?.abort();
      const c = new AbortController();
      ctl.current = c;
      setBusy(true);
      setError(null);
      const still = () => !c.signal.aborted && latest.current?.id === token;
      try {
        const mp3 = await toMp3(await source(), { ...opts, signal: c.signal });
        if (still()) await done(mp3);
      } catch (e) {
        if (!still() || (e as Error).name === "AbortError") return;
        onFail((e as Error).message || "We couldn't convert the sound here. Save it as an MP3 and add it again");
      } finally {
        if (ctl.current === c) {
          ctl.current = null;
          setBusy(false);
        }
      }
    },
    [],
  );

  /** A new file: converted (all of it, or `from`-`to`) and handed to the slot's upload. */
  const convertFile = useCallback(
    (f: Blob, name: string | undefined, opts: { kbps: number; from?: number; to?: number }) => {
      const token = nanoid(8);
      hold({ id: token, ref: "", preview: "", kind: "audio", name, uploading: true });
      void convert(
        token,
        async () => f,
        { ...opts, name },
        (mp3) => {
          expect.current = mp3.name;
          cb.current.upload(mp3);
        },
        (why) => {
          cb.current.setValue(null);
          setError({ line: why, at: null });
        },
      );
    },
    [convert, hold],
  );

  /** A stored file: fetched, converted, uploaded as a new file and put in the slot. */
  const convertStored = useCallback(
    (v: SlotValue, opts: { kbps: number; from?: number; to?: number }) => {
      const token = nanoid(8);
      hold({ ...v, id: token, uploading: true });
      void convert(
        token,
        async () => {
          const res = await fetch(v.ref);
          if (!res.ok) throw new Error("We couldn't open the file to convert it. Add it again");
          return res.blob();
        },
        { ...opts, name: v.name ?? v.ref.split("/").pop() },
        async (mp3) => {
          const asset = await postFile(mp3);
          if (latest.current?.id !== token) return;
          cb.current.setValue({ ref: asset.url, preview: asset.url, kind: asset.kind ?? "audio", name: mp3.name, source: "upload" });
          setMade((m) => new Set(m).add(asset.url));
        },
        (why) => {
          failed.current.add(v.ref);
          cb.current.setValue({ ...v, uploading: false });
          setError({ line: why, at: v.ref });
        },
      );
    },
    [convert, hold],
  );

  /** Act on a plan: keep (the caller's own path), convert, offer a part, or say why not. */
  const follow = useCallback(
    (plan: FitPlan, source: Blob | string, name: string | undefined, keep: () => void, stored?: SlotValue) => {
      const r = cb.current.rule;
      if (!r || plan.kind === "keep") return keep();
      if (plan.kind === "refuse") {
        if (stored) failed.current.add(stored.ref);
        else cb.current.setValue(null);
        return setError({ line: plan.line, at: stored?.ref ?? null });
      }
      if (plan.kind === "trim") {
        if (stored) offered.current.add(stored.ref);
        else cb.current.setValue(null);
        setStart(0);
        return setOffer({ source, name, seconds: plan.seconds, max: plan.max, line: plan.line, stored });
      }
      if (stored) convertStored(stored, { kbps: plan.kbps });
      else convertFile(source as Blob, name, { kbps: plan.kbps });
    },
    [convertFile, convertStored],
  );

  /** True when this step takes the file (any sound or video file while a rule is on). */
  const wants = useCallback((f: File) => !!rule && !!fitSourceKind(f), [rule]);

  /** A file picked, dropped or pasted: its length read from its header first (nothing else is read), then fitted. */
  const take = useCallback(
    (f: File) => {
      const r = cb.current.rule;
      if (!r) return cb.current.upload(f);
      setOffer(null);
      setError(null);
      const facts = { format: songFormat(f.type, f.name), bytes: f.size, video: fitSourceKind(f) === "video" };
      const first = planAudioFit(r, facts);
      // Taken as it is, by a tool with no length rule; or too big to read at all: no need for its length.
      if (first.kind === "keep" && !r.maxSeconds) return cb.current.upload(f);
      if (first.kind === "refuse" && f.size > FIT_SOURCE_MAX_BYTES) return follow(first, f, f.name, () => {});
      const token = nanoid(8);
      hold({ id: token, ref: "", preview: "", kind: "audio", name: f.name, uploading: true });
      void readSeconds(f, facts.video).then((seconds) => {
        if (latest.current?.id !== token) return;
        follow(planAudioFit(r, { ...facts, seconds }), f, f.name, () => cb.current.upload(f));
      });
    },
    [follow, hold],
  );

  // A file already stored that the tool can't take as it is (a library pick, a Reuse): fitted once, at once.
  const ref = rule && value && !value.uploading && !value.held && value.ref.startsWith("/api/files/") ? value.ref : undefined;
  useEffect(() => {
    if (!rule || !ref || skip || guest || failed.current.has(ref) || offered.current.has(ref) || made.has(ref)) return;
    const v = latest.current;
    if (!v) return;
    let gone = false;
    void (async () => {
      const format = songFormat(undefined, ref) ?? songFormat(undefined, v.name);
      // Its size from the answer for its first byte, when the tool has a size rule.
      let bytes: number | undefined;
      if (rule.maxBytes) {
        const r = await fetch(ref, { headers: { Range: "bytes=0-0" } }).catch(() => null);
        void r?.body?.cancel();
        bytes = Number(/\/(\d+)$/.exec(r?.headers.get("content-range") ?? "")?.[1] ?? r?.headers.get("content-length")) || undefined;
      }
      const facts = { format, bytes };
      let plan = planAudioFit(rule, facts);
      if (plan.kind !== "keep" || rule.maxSeconds) plan = planAudioFit(rule, { ...facts, seconds: seconds ?? (await readSeconds(ref)) });
      if (gone || latest.current?.ref !== ref || latest.current.uploading) return;
      follow(plan, ref, v.name, () => {}, latest.current);
    })();
    return () => {
      gone = true;
    };
  }, [rule, ref, skip, guest, made, seconds, follow]);

  // An offer belongs to the file it was made for: another file in the slot (or a stored one taken out) ends it.
  const offerGone = !!offer && (offer.stored ? value?.ref !== offer.stored.ref : !!value && !value.uploading);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (offerGone) setOffer(null);
  }

  const usePart = useCallback(() => {
    const r = cb.current.rule;
    if (!offer || !r || askFirst()) return;
    const from = Math.min(start, Math.max(0, offer.seconds - offer.max));
    const opts = { kbps: mp3Kbps(offer.max, r.outMaxBytes) ?? 96, from, to: from + offer.max - MARGIN };
    setOffer(null);
    if (offer.stored) convertStored(offer.stored, opts);
    else convertFile(offer.source as Blob, offer.name, opts);
  }, [offer, start, askFirst, convertFile, convertStored]);

  // A file refused before it landed is said while the slot stays empty; a stored one's while it is in the slot.
  const shownError = error && (error.at === null ? !value : error.at === landed) ? error.line : null;
  const converted = !!landed && made.has(landed);
  const line = !rule ? null : busy ? `Converting to MP3 for ${rule.for}…` : (shownError ?? (converted ? convertedLine(rule) : null));
  return {
    on: !!rule,
    wants,
    take,
    busy,
    line,
    failedNow: !!shownError && !busy,
    offer: offer && !offerGone ? { ...offer, start, setStart, use: usePart, cancel: () => setOffer(null) } : null,
  };
}

/** The slot's line: converting, converted, why it couldn't; and the part to use when the file is longer than the tool takes. */
export function FitUploadNote({ fit, className }: { fit: ReturnType<typeof useFitUpload>; className?: string }) {
  const o = fit.offer;
  if (!fit.line && !o) return null;
  const last = o ? Math.max(0, Math.floor(o.seconds - o.max)) : 0;
  return (
    <div className={cn("space-y-1.5 pb-2 text-xs text-muted-foreground", className)}>
      {fit.line && (
        <p role="status" className={cn("flex items-center gap-1.5", fit.failedNow && "text-destructive")}>
          {fit.busy && <Loader2 className="size-3 shrink-0 animate-spin" />}
          {fit.line}
        </p>
      )}
      {o && (
        <div className="space-y-1.5 rounded-xl border bg-muted/40 p-2.5">
          <p className="text-foreground">{o.line}</p>
          {last > 0 && (
            <label className="flex items-center gap-2">
              <span className="w-24 shrink-0 tabular-nums">
                {clock(Math.min(o.start, last))}–{clock(Math.min(o.start, last) + o.max)}
              </span>
              <input type="range" min={0} max={last} step={1} value={Math.min(o.start, last)} onChange={(e) => o.setStart(Number(e.target.value))} aria-label="Where the part starts" className="h-9 min-w-0 flex-1 accent-primary" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={o.use} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-foreground px-3.5 font-medium text-background">
              <Scissors className="size-3.5" />
              Use this part
            </button>
            <button type="button" onClick={o.cancel} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 font-medium text-foreground hover:bg-accent">
              <X className="size-3.5" />
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
