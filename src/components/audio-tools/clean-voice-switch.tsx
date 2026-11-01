"use client";

import { AudioLines, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import { askToSignUp, useEngineMode, useIsGuest, useStatus } from "@/lib/api";
import { CLEAN_FEATURE } from "@/lib/av/clean-voice";
import type { Generation } from "@/lib/catalog/types";
import { responseError } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BeforeAfterAudio } from "./before-after-audio";

/**
 * "Clean up voice" beside a voice slot or the voice recorder (Lipsync and avatars, apps with a voice, Voice change,
 * clone samples, Elements, Faceless and Explainer narration). When it is on and an audio file lands in the slot, the file
 * is cleaned at once on the open engine (RE-USE: Full strength, matched level, Auto quality, nothing kept but the voice)
 * and the slot's file becomes the clean one, so the person hears it before a paid lipsync or clone is made from it. The
 * chip under the slot plays the original against the clean one. A failure leaves the original in the slot and says why.
 *
 * The switch shows where the open engine can run: the owner (unless the install is cloud only), an account with its own
 * GPU, and a guest (turning it on opens "Create a free account"). It is off by default and remembered in this browser.
 */

const PREF_KEY = "fuobe.cleanVoice";
const prefListeners = new Set<() => void>();

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function writePref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {}
  prefListeners.forEach((l) => l());
}

/** The remembered switch (every slot on the page follows it). */
export function useCleanVoicePref(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (cb) => {
      prefListeners.add(cb);
      return () => prefListeners.delete(cb);
    },
    readPref,
    () => false,
  );
  return [on, writePref];
}

/** Where the switch shows: "guest" (it asks to sign up), "ok", or "hidden" (cloud-only install, or an account without its GPU). */
export function useCleanVoiceAvailability(): "ok" | "guest" | "hidden" {
  const guest = useIsGuest();
  const mode = useEngineMode();
  const viewer = useStatus().data?.viewer;
  if (guest) return "guest";
  if (viewer?.kind === "account") return viewer.gpu.connected ? "ok" : "hidden";
  return mode === "cloud" ? "hidden" : "ok";
}

// How many cleans are running on this page: a studio's Generate waits for them (useVoiceCleaning).
let running = 0;
const runListeners = new Set<() => void>();
const bump = (d: number) => {
  running = Math.max(0, running + d);
  runListeners.forEach((l) => l());
};

/** True while a slot's voice is being cleaned on this page (Generate waits: "Waiting for the clean voice"). */
export function useVoiceCleaning(): boolean {
  return useSyncExternalStore(
    (cb) => {
      runListeners.add(cb);
      return () => runListeners.delete(cb);
    },
    () => running > 0,
    () => false,
  );
}

/** A slot's file after cleaning: the clean file, with the original kept for "Hear original". */
export type CleanedSlot = SlotValue & { original?: string };

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/audio-tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw responseError(res, j.error ?? `Clean up voice failed (${res.status})`);
  return j;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a slot waits for its clean voice before it keeps the original. */
export const CLEAN_WAIT_MS = 10 * 60_000;

/** Follow a generation until it is done (its own events aren't needed here: a clean takes seconds to a minute). */
async function settle(id: string, signal: AbortSignal, limitMs = CLEAN_WAIT_MS): Promise<Generation> {
  const until = Date.now() + limitMs;
  for (let wait = 800; ; wait = Math.min(3000, wait * 1.3)) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (Date.now() > until) throw new Error("it didn't finish in 10 minutes (is your ComfyUI running?)");
    const res = await fetch(`/api/generations/${id}`, { signal });
    if (res.ok) {
      const g = (await res.json()) as Generation;
      if (g.status === "succeeded") return g;
      if (g.status === "failed" || g.status === "canceled") throw new Error(g.error ?? "Couldn't clean the voice");
    }
    await sleep(wait);
  }
}

/** "Take 2.wav" -> "Take 2 · cleaned". */
export const cleanedName = (name?: string) => `${(name ?? "Recording").replace(/\.[a-z0-9]{2,4}$/i, "")} · cleaned`;

/** Clean one audio file on the open engine; resolves with the clean file's address. */
export async function cleanVoiceFile(media: string, name: string | undefined, signal: AbortSignal): Promise<{ url: string; generation: Generation }> {
  const run = await post<{ result: Generation }>({ tool: "clean", engine: "open", media, kind: "audio", ...(name && { name: name.slice(0, 200) }), strength: "full", level: "match", quality: "auto", background: "remove" });
  const g = await settle(run.result.id, signal);
  const out = g.outputs.find((o) => o.kind === "audio");
  if (!out) throw new Error("The clean voice didn't come back");
  return { url: out.url, generation: g };
}

/**
 * Clean the files a slot takes while the switch is on. `take(v)` returns the value to show now (the original, marked as
 * cleaning) and calls `onCleaned` with the clean value, or `onFailed` with the reason (the original stays).
 */
export function useCleanVoice(opts: { enabled: boolean; onCleaned: (v: CleanedSlot) => void; onFailed?: (why: string) => void }) {
  const [busy, setBusy] = useState<{ ref: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
  });
  useEffect(() => () => ctl.current?.abort(), []);
  // Counted while busy, so a studio's Generate waits for it.
  const isBusy = !!busy;
  useEffect(() => {
    if (!isBusy) return;
    bump(1);
    return () => bump(-1);
  }, [isBusy]);

  const take = useCallback(
    (v: SlotValue | null): boolean => {
      ctl.current?.abort();
      setError(null);
      if (!v || v.kind !== "audio" || v.uploading || !v.ref?.startsWith("/api/files/") || !cb.current.enabled) {
        setBusy(null);
        return false;
      }
      const c = new AbortController();
      ctl.current = c;
      setBusy({ ref: v.ref });
      void cleanVoiceFile(v.ref, v.name, c.signal)
        .then(({ url }) => {
          if (c.signal.aborted) return;
          setBusy(null);
          cb.current.onCleaned({ ...v, ref: url, preview: url, name: cleanedName(v.name), original: v.ref });
        })
        .catch((e: Error) => {
          if (c.signal.aborted || e.name === "AbortError") return;
          setBusy(null);
          setError(e.message);
          cb.current.onFailed?.(e.message);
        });
      return true;
    },
    [],
  );
  const cancel = useCallback(() => {
    ctl.current?.abort();
    setBusy(null);
  }, []);
  return { take, cancel, busy: !!busy, error };
}

/**
 * For a sample row's upload (clone samples, Elements, narration): while the switch is on, an uploaded file is cleaned
 * before it is handed over; a failure hands over the original and says why.
 */
export function useMaybeClean() {
  const [on] = useCleanVoicePref();
  const where = useCleanVoiceAvailability();
  const ok = on && where === "ok";
  const [busy, setBusy] = useState(false);
  const ctl = useRef<{ c: AbortController; skip: () => void } | null>(null);
  useEffect(() => () => ctl.current?.c.abort(), []);
  const run = useCallback(
    async (v: SlotValue, done: (v: CleanedSlot) => void) => {
      if (!ok || v.kind !== "audio" || !v.ref?.startsWith("/api/files/")) return done(v);
      ctl.current?.c.abort();
      const c = new AbortController();
      let skipped = false;
      ctl.current = {
        c,
        skip: () => {
          skipped = true;
          c.abort();
        },
      };
      setBusy(true);
      try {
        const { url } = await cleanVoiceFile(v.ref, v.name, c.signal);
        done({ ...v, ref: url, preview: url, name: cleanedName(v.name), original: v.ref });
      } catch (e) {
        // Unmounted or replaced: nothing to hand over. Skipped: the original, quietly.
        if (c.signal.aborted && !skipped) return;
        if (!skipped) toast.error(`Couldn't clean the voice, so the original is kept: ${(e as Error).message}`);
        done(v);
      } finally {
        if (ctl.current?.c === c) {
          ctl.current = null;
          setBusy(false);
        }
      }
    },
    [ok],
  );
  /** Stop waiting and hand over the original. */
  const skip = useCallback(() => ctl.current?.skip(), []);
  return { run, busy, skip };
}

type SlotStatus = { busy: boolean; error: string | null; value: CleanedSlot | null; cancel: () => void };
let slotStatus: SlotStatus | null = null;
const statusListeners = new Set<() => void>();
const setSlotStatus = (s: SlotStatus | null) => {
  slotStatus = s;
  statusListeners.forEach((l) => l());
};
/** The voice slot's clean on this page (CleanVoiceSlot reports it; the switch beside it says it in words). */
function useSlotStatus(): SlotStatus | null {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    () => slotStatus,
    () => null,
  );
}

/**
 * The switch itself ("Clean up voice"), with a one-line hint. `status`: beside a composer's voice slot, the hint gives way
 * to what the slot's clean is doing ("Cleaning the voice…", "Clean voice · Hear original", or why the original was kept).
 */
export function CleanVoiceSwitch({ className, hint, status }: { className?: string; hint?: string; status?: boolean }) {
  const id = useId();
  const [on, setOn] = useCleanVoicePref();
  const where = useCleanVoiceAvailability();
  const slot = useSlotStatus();
  if (where === "hidden") return null;
  const live = status && slot && (slot.busy || slot.error || slot.value?.original) ? slot : null;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <Switch
        id={id}
        checked={on && where === "ok"}
        onCheckedChange={(v) => {
          if (where === "guest") return askToSignUp("run");
          setOn(v);
        }}
      />
      <label htmlFor={id} className="min-w-0 text-[12px] leading-tight">
        <span className="font-medium">Clean up voice</span>
        {!live && <span className="text-muted-foreground"> {hint ?? "noise, echo and room sound removed first (free, on your GPU)"}</span>}
      </label>
      {live && <CleanVoiceStatus value={live.value} busy={live.busy} error={live.error} onCancel={live.cancel} />}
    </div>
  );
}

/** Under a slot: "Cleaning the voice…", then "Clean voice · Hear original" (a popover with the before / after player). */
export function CleanVoiceStatus({ value, busy, error, className, onCancel }: { value: CleanedSlot | null; busy: boolean; error: string | null; className?: string; onCancel?: () => void }) {
  if (busy)
    return (
      <p className={cn("inline-flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground", className)} role="status">
        <Loader2 className="size-3 animate-spin" /> Cleaning the voice… about 20 s
        {onCancel && (
          <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={onCancel}>
            Use the original
          </button>
        )}
      </p>
    );
  if (error)
    return (
      <p className={cn("text-[12px] text-destructive", className)} role="alert">
        Kept the original: {error}
      </p>
    );
  if (!value?.original) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-[12px] font-medium text-success", className)}>
          <Sparkles className="size-3" /> Clean voice · Hear original
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,440px)] p-3" collisionPadding={12}>
        <p className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium">
          <AudioLines className="size-3.5" /> Original and clean voice
        </p>
        <BeforeAfterAudio before={value.original} after={value.ref} labels={{ before: "Original", after: "Clean" }} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Clean every new file a slot gets (an upload once it has landed, a recording, a Library pick) while the switch is on,
 * and put the clean file in the slot when it's back (unless the slot holds something else by then).
 */
export function useAutoClean(value: CleanedSlot | null, set: (v: CleanedSlot) => void) {
  const [on] = useCleanVoicePref();
  const where = useCleanVoiceAvailability();
  const enabled = on && where === "ok";
  const current = useRef(value?.ref);
  useEffect(() => {
    current.current = value?.ref;
  }, [value?.ref]);
  const handled = useRef<string | null>(null);
  const setRef = useRef(set);
  useEffect(() => {
    setRef.current = set;
  });
  const clean = useCleanVoice({ enabled, onCleaned: (v) => current.current === v.original && setRef.current(v) });
  const { take, cancel } = clean;
  const was = useRef(enabled);
  useEffect(() => {
    const turnedOff = was.current && !enabled;
    was.current = enabled;
    if (!enabled) {
      handled.current = null;
      if (!turnedOff) return;
      // Switched off: stop a clean in progress, and the slot goes back to the file as it was added.
      cancel();
      if (value?.original && !value.uploading) setRef.current({ ...value, ref: value.original, preview: value.original, name: value.name?.replace(/ · cleaned$/, ""), original: undefined });
      return;
    }
    if (!value?.ref || value.uploading || value.original || handled.current === value.ref) return;
    // Only a file it took counts: with the switch off it waits, and turning the switch on cleans it.
    if (take(value)) handled.current = value.ref;
  }, [value, take, cancel, enabled]);
  return clean;
}

/** A composer's voice slot with "Clean up voice": the tile, a spinner while it cleans, then a badge to hear the original. */
export function CleanVoiceSlot({
  slotKey,
  label,
  required,
  value,
  onChange,
  onFile,
}: {
  slotKey: string;
  label: string;
  required?: boolean;
  value: CleanedSlot | null;
  onChange: (v: SlotValue | null) => void;
  onFile?: (f: File) => void;
}) {
  const clean = useAutoClean(value, onChange);
  const { busy, error, cancel } = clean;
  useEffect(() => {
    setSlotStatus({ busy, error, value: value?.original ? value : null, cancel });
  }, [busy, error, value, cancel]);
  useEffect(() => () => setSlotStatus(null), []);
  return (
    <div className="relative shrink-0">
      <MediaSlot slotKey={slotKey} label={label} kind="audio" required={required} caption value={value} onChange={onChange} onFile={onFile} />
      {clean.busy && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-background/70" role="status" aria-label="Cleaning the voice">
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}
      {(value?.original || clean.error) && !clean.busy && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={clean.error ? "Clean up voice failed" : "Clean voice: hear the original"}
              className={cn("absolute -bottom-1.5 -left-1.5 grid size-5 place-items-center rounded-full shadow-soft", clean.error ? "bg-destructive text-white" : "bg-success text-white")}
            >
              <Sparkles className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(92vw,440px)] p-3" collisionPadding={12}>
            {clean.error ? (
              <p className="text-[13px] text-destructive">Kept the original: {clean.error}</p>
            ) : (
              <>
                <p className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium">
                  <AudioLines className="size-3.5" /> Clean voice · hear the original
                </p>
                <BeforeAfterAudio before={value!.original!} after={value!.ref} labels={{ before: "Original", after: "Clean" }} />
              </>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export { CLEAN_FEATURE };
