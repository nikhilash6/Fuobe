import type { FileKey, RequirementIndex } from "./types";

/** "folder/file" for an index file. */
export const fileKey = (folder: string, file: string): FileKey => `${folder}/${file}` as FileKey;

/** The base name ComfyUI lists a file under: "wan/x.safetensors" and "wan\\x.safetensors" count as "x.safetensors". */
export const basename = (name: string): string => name.split(/[\\/]/).pop() ?? name;

/** The folder and file of a FileKey. */
export function splitKey(key: FileKey | string): { folder: string; file: string } {
  const i = key.indexOf("/");
  return { folder: key.slice(0, i), file: key.slice(i + 1) };
}

/**
 * How file names compare on that ComfyUI: case-sensitively on Linux, case-insensitively on Windows ("nt")
 * and macOS ("darwin", whose default file system ignores case).
 */
export function sameName(os: string | undefined): (a: string, b: string) => boolean {
  const fold = os === "nt" || os === "darwin" || os === "windows" || os === "win32";
  return fold ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;
}

/** A name key for lookups in a Set or Map (folded on case-insensitive systems). */
export function nameKey(os: string | undefined): (name: string) => string {
  const fold = os === "nt" || os === "darwin" || os === "windows" || os === "win32";
  return fold ? (n) => basename(n).toLowerCase() : (n) => basename(n);
}

/** Check that a parsed requirements.json has the shape this code reads (a stale or hand-edited file fails loudly). */
export function parseIndex(raw: unknown): RequirementIndex {
  const r = raw as Partial<RequirementIndex> | null;
  if (!r || typeof r !== "object" || r.v !== 1) throw new Error("requirements.json: not a v1 requirement index");
  if (typeof r.hash !== "string" || !r.comfyui || typeof r.comfyui.min !== "string") throw new Error("requirements.json: missing hash or comfyui.min");
  for (const k of ["packs", "files", "workflows"] as const) if (!r[k] || typeof r[k] !== "object") throw new Error(`requirements.json: missing ${k}`);
  if (!Array.isArray(r.folders) || !Array.isArray(r.sentinels)) throw new Error("requirements.json: missing folders or sentinels");
  return r as RequirementIndex;
}

/** Every node class an index names (core and pack). */
export function indexClasses(idx: RequirementIndex): Set<string> {
  const out = new Set<string>();
  for (const w of Object.values(idx.workflows)) {
    for (const c of w.core) out.add(c);
    for (const cs of Object.values(w.packs)) for (const c of cs) out.add(c);
  }
  return out;
}

/** The pack each pack class belongs to. */
export function classPacks(idx: RequirementIndex): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, p] of Object.entries(idx.packs)) for (const c of p.classes) out.set(c, name);
  for (const w of Object.values(idx.workflows)) for (const [p, cs] of Object.entries(w.packs)) for (const c of cs) if (!out.has(c)) out.set(c, p);
  return out;
}

/** Loader classes and inputs the index reads files through: "Class.input" → the base names it looks for. */
export function loaderInputs(idx: RequirementIndex): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of Object.values(idx.files)) {
    if (f.presence !== "loader") continue;
    for (const [cls, input] of f.loaders ?? []) {
      const k = `${cls}.${input}`;
      if (!out.has(k)) out.set(k, new Set());
      out.get(k)!.add(f.file);
    }
  }
  return out;
}

/** Compare dotted versions ("0.41.2" vs "0.41.0"): negative, zero or positive. Non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/i, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Bytes as "12.3 GB" / "340 MB" (decimal units, as the download sizes are). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 GB";
  if (bytes >= 1e9) return `${Math.round(bytes / 1e8) / 10} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** GiB of graphics memory as people say it ("12 GB", "7.6 GB"). */
export function vramGb(bytes: number | undefined): number | undefined {
  if (!bytes || bytes <= 0) return undefined;
  const gb = bytes / 2 ** 30;
  return gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10;
}
