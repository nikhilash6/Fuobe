/**
 * Virality predictor, honestly: Higgsfield's predictor scores a video with Meta's TRIBE v2 (a brain-response
 * model, CC BY-NC — non-commercial only) and no provider hosts it. Fuobe doesn't invent a score. It
 * measures the hook — the first 3 seconds — in the browser (movement, a cut, faces, on-screen text,
 * sound, the opening frame's contrast, the format) and holds each measurement against a plain rule of
 * thumb. Every signal says what was measured and why it matters; nothing here is a prediction.
 *
 * This module is the pure part: the measurements in, the signals out. The browser side that takes the
 * measurements is src/components/virality/measure.ts.
 */

/** The hook: what a viewer sees before deciding to keep watching. */
export const HOOK_SECONDS = 3;
/** Frames sampled across the hook, this far apart. */
export const HOOK_STEP = 0.25;
/** Loudness windows, seconds. */
export const LOUDNESS_STEP = 0.1;
/** Larger files aren't decoded for loudness in the browser (the whole track would sit in memory). */
export const MAX_AUDIO_BYTES = 150 * 1024 * 1024;
/** Quieter than this (dBFS RMS) counts as silence. */
export const SILENCE_DB = -45;

export const VIRALITY_PARITY = {
  title: "A heuristic hook check, not a prediction",
  lead: "A quick check of your first 3 seconds: motion, cuts, faces, text and sound, held against common rules of thumb. Useful for spotting a slow opening, not a forecast of views.",
  body: "Higgsfield's Virality Predictor scores videos with Meta's TRIBE v2, a brain-response model released for non-commercial use only (CC BY-NC 4.0). No cloud provider hosts it, so Fuobe shows no virality score. This page measures your first 3 seconds in your browser and holds them against common rules of thumb — useful for spotting a slow opening, not a forecast of views.",
  cloud: "Cloud: no hosted TRIBE v2 model exists to call.",
  open: "Open engine: TRIBE v2 can run on your own GPU as an optional, non-commercial worker; Fuobe doesn't bundle it.",
};

/** The optional TRIBE v2 worker's contract (docs/workers/tribe-v2.md), as the page summarises it. */
export const TRIBE_WORKER = {
  endpoint: "POST {TRIBE_URL}/analyze · multipart field “video” (MP4, up to 60 s)",
  output: [
    "engagement: one value per second, 0–100",
    "peak_t / peak_val: the strongest second",
    "hook_score: mean engagement over 0–3 s",
    "regions: visual, attention, auditory, language and default mode (focus drift, lower is better), per second",
  ],
  needs: [
    "facebook/tribev2 weights — CC BY-NC 4.0, non-commercial use only",
    "Llama-3.2-3B (gated on Hugging Face: accept Meta's licence, give the worker a token)",
    "V-JEPA2 and Wav2Vec-BERT (TRIBE v2's video and audio encoders) on your own GPU",
  ],
  status: "Documented only: Fuobe has no TRIBE_URL setting yet, so this page keeps its browser heuristics.",
};

export type Verdict = "strong" | "ok" | "weak" | "unknown";

export type SignalId = "motion" | "change" | "faces" | "text" | "sound" | "contrast" | "format";

export interface HookSignal {
  id: SignalId;
  label: string;
  verdict: Verdict;
  /** What was measured, in words. */
  detail: string;
  /** What to try when it's weak (or why it couldn't be measured). */
  tip?: string;
  /** When it happens, seconds from the start. */
  at?: number;
}

export type AudioMeasure = { step: number; db: number[] } | { error: "no-audio" | "unreadable" | "too-large" };

export interface HookInput {
  duration: number;
  width: number;
  height: number;
  /** Frames across the hook: time and mean luma difference from the previous sample (the first is 0). */
  motion: { t: number; diff: number }[];
  /** The first frame: luma standard deviation and mean, 0–1. */
  opening: { contrast: number; brightness: number };
  /** Faces found per checked frame; null when the browser has no face detector. */
  faces: { t: number; count: number }[] | null;
  /** Characters of text found per checked frame; null when the browser has no text detector. */
  text: { t: number; chars: number }[] | null;
  /** Loudness (dBFS RMS) per `step` seconds from 0, or why it couldn't be read. */
  loudness: AudioMeasure;
}

// Rules of thumb (not calibrated against outcomes — they flag a still, silent or flat opening).
const MOTION_STRONG = 0.03;
const MOTION_OK = 0.01;
const CUT = 0.12;
const CONTRAST_STRONG = 0.2;
const CONTRAST_OK = 0.12;
const DARK = 0.12;

const r1 = (n: number) => Math.round(n * 10) / 10;
const dbfs = (n: number) => `${Math.round(n)}`.replace("-", "\u2212") + " dBFS";
const NO_DETECTOR = "Chrome's Shape Detection API adds one (chrome://flags › Experimental Web Platform features)";
const secs = (t: number) => `${r1(t).toFixed(1)} s`;

/** Luma mean and standard deviation (0–1) of an RGBA frame. */
export function lumaStats(frame: { data: ArrayLike<number> }): { brightness: number; contrast: number } {
  const d = frame.data;
  const n = Math.floor(d.length / 4);
  if (!n) return { brightness: 0, contrast: 0 };
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < n * 4; i += 4) {
    const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    sum += l;
    sq += l * l;
  }
  const mean = sum / n;
  return { brightness: mean, contrast: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

/** RMS loudness in dBFS per `step` seconds of a mono signal (−100 for digital silence). */
export function loudnessSeries(samples: ArrayLike<number>, sampleRate: number, step = LOUDNESS_STEP): number[] {
  const size = Math.max(1, Math.round(sampleRate * step));
  const out: number[] = [];
  for (let start = 0; start < samples.length; start += size) {
    const end = Math.min(samples.length, start + size);
    let sq = 0;
    for (let i = start; i < end; i++) sq += samples[i] * samples[i];
    const rms = Math.sqrt(sq / Math.max(1, end - start));
    out.push(rms > 1e-5 ? Math.max(-100, 20 * Math.log10(rms)) : -100);
  }
  return out;
}

/** The power average of dB values (what a meter shows for the span), or null for none. */
export function meanDb(db: number[]): number | null {
  if (!db.length) return null;
  const p = db.reduce((s, d) => s + 10 ** (d / 10), 0) / db.length;
  return p > 0 ? Math.max(-100, 10 * Math.log10(p)) : -100;
}

/** Sample times across the hook (and no further than the clip). */
export function hookTimes(duration: number, step = HOOK_STEP): number[] {
  const end = Math.min(HOOK_SECONDS, Math.max(0, duration - 0.05));
  const out: number[] = [];
  for (let t = 0; t <= end + 1e-6; t += step) out.push(Math.round(t * 100) / 100);
  return out.length ? out : [0];
}

function motionSignal(m: HookInput["motion"]): HookSignal {
  const label = "Movement in the first second";
  const first = m.filter((f) => f.t > 0 && f.t <= 1.0001);
  if (!first.length) return { id: "motion", label, verdict: "unknown", detail: "The clip is too short to tell", tip: "Hooks need at least a second" };
  const peak = Math.max(...first.map((f) => f.diff));
  const at = first.find((f) => f.diff === peak)!.t;
  if (peak >= MOTION_STRONG) return { id: "motion", label, verdict: "strong", detail: `Clear movement by ${secs(at)}`, at };
  if (peak >= MOTION_OK) return { id: "motion", label, verdict: "ok", detail: "Some movement, but subtle", tip: "Open on the action — a gesture, a reveal or a fast push-in reads as “something is happening”" };
  return { id: "motion", label, verdict: "weak", detail: "The first second is nearly still", tip: "Cut the slow start: begin on movement, or trim the first beat" };
}

function changeSignal(m: HookInput["motion"]): HookSignal {
  const label = "A change within 3 seconds";
  const hook = m.filter((f) => f.t > 0 && f.t <= HOOK_SECONDS + 1e-4);
  if (!hook.length) return { id: "change", label, verdict: "unknown", detail: "The clip is too short to tell" };
  const peak = Math.max(...hook.map((f) => f.diff));
  const at = hook.find((f) => f.diff === peak)!.t;
  if (peak >= CUT) return { id: "change", label, verdict: "strong", detail: `A cut or big change at ${secs(at)}`, at };
  const mean = hook.reduce((s, f) => s + f.diff, 0) / hook.length;
  if (mean >= MOTION_OK) return { id: "change", label, verdict: "ok", detail: "Continuous movement, no cut", tip: "A cut, zoom or new angle before 3 s resets attention" };
  return { id: "change", label, verdict: "weak", detail: "The picture barely changes in 3 s", tip: "Add a cut, a zoom or a new angle before the 3-second mark" };
}

function facesSignal(f: HookInput["faces"]): HookSignal {
  const label = "A face early";
  if (!f) return { id: "faces", label, verdict: "unknown", detail: "This browser has no face detector", tip: NO_DETECTOR };
  const seen = f.filter((x) => x.count > 0).sort((a, b) => a.t - b.t)[0];
  if (!seen) return { id: "faces", label, verdict: "weak", detail: "No face found in the first 3 s", tip: "For person-led videos, open on a face looking into the lens — feeds stop for faces" };
  const most = Math.max(...f.map((x) => x.count));
  const who = most > 1 ? `${most} faces` : "A face";
  return seen.t <= 1 ? { id: "faces", label, verdict: "strong", detail: `${who} from ${secs(seen.t)}`, at: seen.t } : { id: "faces", label, verdict: "ok", detail: `${who} from ${secs(seen.t)}`, tip: "Bring the face into the first second", at: seen.t };
}

function textSignal(f: HookInput["text"]): HookSignal {
  const label = "On-screen text";
  if (!f) return { id: "text", label, verdict: "unknown", detail: "This browser has no text detector", tip: NO_DETECTOR };
  const seen = f.filter((x) => x.chars >= 3).sort((a, b) => a.t - b.t)[0];
  if (!seen) return { id: "text", label, verdict: "weak", detail: "No text found in the first 3 s", tip: "Many people watch muted: a short title or captions say what's coming" };
  return seen.t <= 1 ? { id: "text", label, verdict: "strong", detail: `Text on screen from ${secs(seen.t)}`, at: seen.t } : { id: "text", label, verdict: "ok", detail: `Text appears at ${secs(seen.t)}`, tip: "Put the title up from the first frame", at: seen.t };
}

function soundSignal(a: AudioMeasure): HookSignal {
  const label = "Sound from the start";
  if ("error" in a) {
    if (a.error === "no-audio") return { id: "sound", label, verdict: "weak", detail: "No audio track", tip: "Add a voice, music or a sound effect — Sound effects and Music can make one" };
    if (a.error === "too-large") return { id: "sound", label, verdict: "unknown", detail: "The file is too large to decode in the browser", tip: "Trim it to the opening and check again" };
    return { id: "sound", label, verdict: "unknown", detail: "No audio track, or a format this browser can't decode" };
  }
  const per = Math.round(HOOK_SECONDS / a.step);
  const hook = a.db.slice(0, per);
  const rest = a.db.slice(per);
  const first = hook.findIndex((d) => d > SILENCE_DB);
  if (first < 0) return { id: "sound", label, verdict: "weak", detail: "Silent for the first 3 s", tip: "Start with a line, a beat or a sound — silence reads as a slow start" };
  const at = r1(first * a.step);
  const hookDb = meanDb(hook.filter((d) => d > SILENCE_DB));
  const restDb = meanDb(rest.filter((d) => d > SILENCE_DB));
  const level = `opening ${dbfs(hookDb!)}${restDb != null ? ` · after ${dbfs(restDb)}` : ""}`;
  const quieter = restDb != null && hookDb! < restDb - 6;
  if (at <= 0.5 && !quieter) return { id: "sound", label, verdict: "strong", detail: `Sound from ${secs(at)} · ${level}`, at };
  if (at <= 1.5)
    return { id: "sound", label, verdict: "ok", detail: `Sound from ${secs(at)} · ${level}`, tip: quieter ? "The opening is quieter than the rest — lead with your strongest audio" : "Start the sound on the first frame", at };
  return { id: "sound", label, verdict: "weak", detail: `Silent until ${secs(at)} · ${level}`, tip: "Start with a line, a beat or a sound — silence reads as a slow start", at };
}

function contrastSignal(o: HookInput["opening"]): HookSignal {
  const label = "Opening frame contrast";
  const pct = `${Math.round(o.contrast * 100)}% luma spread`;
  if (o.brightness < DARK) return { id: "contrast", label, verdict: "weak", detail: `A very dark opening frame · ${pct}`, tip: "Lift the exposure of the first shot — the Hook Frame app can rework it" };
  if (o.contrast >= CONTRAST_STRONG) return { id: "contrast", label, verdict: "strong", detail: `Punchy · ${pct}` };
  if (o.contrast >= CONTRAST_OK) return { id: "contrast", label, verdict: "ok", detail: `Moderate · ${pct}`, tip: "More contrast and a clear focal point stand out in a busy feed" };
  return { id: "contrast", label, verdict: "weak", detail: `Flat · ${pct}`, tip: "More contrast and a clear focal point stand out in a busy feed — the Hook Frame app can rework it" };
}

function formatSignal(i: Pick<HookInput, "width" | "height" | "duration">): HookSignal {
  const label = "Format";
  const mins = `${Math.floor(i.duration / 60)}:${String(Math.round(i.duration % 60)).padStart(2, "0")}`;
  const long = i.duration > 90 ? ` · ${mins} long` : "";
  const longTip = i.duration > 90 ? "Short-form feeds favour clips under a minute — consider a cut-down" : undefined;
  if (!i.width || !i.height) return { id: "format", label, verdict: "unknown", detail: "Unknown size" };
  const ratio = i.width / i.height;
  if (ratio <= 0.66) return { id: "format", label, verdict: i.duration > 90 ? "ok" : "strong", detail: `Vertical ${i.width}×${i.height}${long}`, tip: longTip };
  if (ratio <= 1.05) return { id: "format", label, verdict: "ok", detail: `Square-ish ${i.width}×${i.height}${long}`, tip: longTip ?? "Vertical 9:16 fills the whole phone screen — Reframe can convert it" };
  return { id: "format", label, verdict: "weak", detail: `Landscape ${i.width}×${i.height}${long}`, tip: "Letterboxed in vertical feeds — Reframe can make a 9:16 version" };
}

/** Every signal, in the order the page lists them. */
export function hookSignals(input: HookInput): HookSignal[] {
  return [motionSignal(input.motion), changeSignal(input.motion), facesSignal(input.faces), textSignal(input.text), soundSignal(input.loudness), contrastSignal(input.opening), formatSignal(input)];
}

/** Counts per verdict — the page shows these, never a made-up overall score. */
export function hookSummary(signals: HookSignal[]): Record<Verdict, number> {
  const out: Record<Verdict, number> = { strong: 0, ok: 0, weak: 0, unknown: 0 };
  for (const s of signals) out[s.verdict]++;
  return out;
}
