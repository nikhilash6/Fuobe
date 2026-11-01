// What each score means, which way is better, and how big a difference is noise. The Python side
// (metrics/fuobe_metrics/registry.py) writes the same keys; timing and cost come from the runner.

/** @type {Record<string, { label: string, better: "higher" | "lower" | "none", unit: string, tie: number, digits: number }>} */
export const METRIC_INFO = {
  clip: { label: "CLIP prompt adherence", better: "higher", unit: "CLIPScore 0–100", tie: 0.5, digits: 1 },
  aesthetic: { label: "Aesthetic (LAION v2)", better: "higher", unit: "1–10", tie: 0.05, digits: 2 },
  style: { label: "Style vs references", better: "higher", unit: "cosine", tie: 0.005, digits: 3 },
  styleNearest: { label: "Style, nearest reference", better: "higher", unit: "cosine", tie: 0.005, digits: 3 },
  identity: { label: "Identity vs references", better: "higher", unit: "cosine", tie: 0.01, digits: 3 },
  faceRate: { label: "Frames with a face", better: "higher", unit: "0–1", tie: 0.01, digits: 2 },
  drift: { label: "Frame-to-frame drift", better: "lower", unit: "1 − cosine", tie: 0.002, digits: 4 },
  driftMax: { label: "Worst frame jump", better: "lower", unit: "1 − cosine", tie: 0.005, digits: 4 },
  warp: { label: "Warp error (flicker)", better: "lower", unit: "0–1", tie: 0.001, digits: 4 },
  lipsync: { label: "Lip-sync proxy", better: "higher", unit: "Pearson r", tie: 0.02, digits: 3 },
  lipsyncOffset: { label: "A/V offset", better: "none", unit: "frames", tie: 0, digits: 0 },
  syncnet: { label: "SyncNet confidence", better: "higher", unit: "conf", tie: 0.1, digits: 2 },
  continuity: { label: "Shot continuity", better: "higher", unit: "cosine", tie: 0.005, digits: 3 },
  paletteFit: { label: "Palette distance", better: "lower", unit: "mean ΔE76", tie: 0.5, digits: 1 },
  paletteCover: { label: "Palette used", better: "higher", unit: "0–1", tie: 0.05, digits: 2 },
  bgDiff: { label: "Background change vs the source", better: "lower", unit: "0–1", tie: 0.002, digits: 4 },
  bgPsnr: { label: "Background PSNR vs the source", better: "higher", unit: "dB", tie: 0.3, digits: 1 },
  seconds: { label: "Time", better: "lower", unit: "s (wall clock)", tie: 0.5, digits: 1 },
  costUsd: { label: "Cost", better: "lower", unit: "US$", tie: 0.0005, digits: 4 },
  vramGb: { label: "Peak memory", better: "lower", unit: "GB", tie: 0.1, digits: 2 },
};

/** Keys in the order reports show them. */
export const METRIC_ORDER = Object.keys(METRIC_INFO);

/** b against a: "win" when b is better by more than the metric's tie band, "loss" when worse, else "tie". */
export function verdict(metric, a, b) {
  const info = METRIC_INFO[metric];
  if (!info || info.better === "none" || a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return null;
  const gain = info.better === "higher" ? b - a : a - b;
  return gain > info.tie ? "win" : gain < -info.tie ? "loss" : "tie";
}

/** b − a, signed so that positive is better. */
export function gain(metric, a, b) {
  const info = METRIC_INFO[metric];
  if (!info || a == null || b == null) return null;
  return info.better === "lower" ? a - b : b - a;
}

export const fmt = (metric, v) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(METRIC_INFO[metric]?.digits ?? 3));
