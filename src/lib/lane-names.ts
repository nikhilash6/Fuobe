/**
 * Lanes by name for the owner (Settings → Workers): a lane is the workflows that share their largest model file
 * (src/lib/lanes.ts), so its name says who uses it and which model it loads, "InfiniteTalk · Wan 2.1 I2V 480p fp8", with
 * the file itself under it. Pure: the server and the tests share it.
 */

/** Parts of a model file's name that say how it was stored, not what it is. */
const STORAGE_WORDS = /^(e4m3fn|e5m2|e4m3|scaled|kj|comfy|comfyui|repackaged|model|diffusion|fp8e4m3fn|fp8e5m2)$/i;

/**
 * A model file's name as a title: no folder or extension, words apart, versions with their dot ("Wan2_1" → "Wan 2.1"),
 * without the parts that only say how it was stored or how many parameters it has.
 * "Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors" → "Wan 2.1 I2V 480p fp8".
 */
export function modelTitle(file: string): string {
  const base = (file.split("/").pop() ?? file).replace(/\.(safetensors|gguf|pth|ckpt|pt|bin|sft|onnx)$/i, "");
  const words = base
    .replace(/(\d)_(\d)/g, "$1.$2")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .filter((w) => !STORAGE_WORDS.test(w) && !/^\d+(\.\d+)?[bm]$/i.test(w))
    .map((w) => w.replace(/^([A-Za-z]+)(\d+\.\d+)$/, "$1 $2"));
  const title = words.join(" ").trim();
  return title ? title[0].toUpperCase() + title.slice(1) : base;
}

export interface LaneName {
  lane: string;
  /** "InfiniteTalk · Wan 2.1 I2V 480p fp8": who uses it (at most two names, then "+N"), and its model. */
  label: string;
  /** Every app and model that runs a workflow of the lane, by name. */
  apps: string[];
  /** Its model's title (modelTitle of its largest file), or null. */
  model: string | null;
  /** Its largest file, as the index names it (no folder), or null. */
  file: string | null;
}

/** At most this many names in a lane's label; the rest as "+N". */
const LABEL_NAMES = 2;

/**
 * A lane's name from its largest file (`file`, null for none) and who uses its workflows (`apps`, in order, repeats
 * left out). `fallback`: the label it had before, for a lane with neither.
 */
export function laneName(lane: string, o: { file: string | null; apps: string[]; fallback: string }): LaneName {
  const apps = [...new Set(o.apps.filter(Boolean))];
  const model = o.file ? modelTitle(o.file) : null;
  const who = apps.length ? `${apps.slice(0, LABEL_NAMES).join(", ")}${apps.length > LABEL_NAMES ? ` +${apps.length - LABEL_NAMES}` : ""}` : null;
  const label = who && model ? `${who} · ${model}` : (who ?? model ?? o.fallback);
  return { lane, label, apps, model, file: o.file ? (o.file.split("/").pop() ?? o.file) : null };
}

/** Does a lane match a search: its label, apps, model, file, lane id or workflows hold the words (any case)? */
export function laneMatches(l: { lane: string; label: string; apps?: string[]; model?: string | null; file?: string | null; workflowIds?: string[] }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [l.lane, l.label, ...(l.apps ?? []), l.model ?? "", l.file ?? "", ...(l.workflowIds ?? [])].join("\n").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}
