// What this worker has (docs/gpu-workers.md): the model files in its model folders that the studio's catalog names,
// each checked by folder, name, exact size and SHA-256 (every file the catalog names has its hash pinned in the
// worker's build: dist/file-pins.json); and its ComfyUI's node packs with their commits. Hashes are cached by path,
// size and modified time, so a restart doesn't read hundreds of GB again.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The SHA-256 of every model file the catalog names ("folder/file" → hex), built into this worker. */
export function filePins(file = path.join(here, "dist", "file-pins.json")) {
  try {
    const p = JSON.parse(fs.readFileSync(file, "utf8")).files;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

/**
 * The files a run may add beyond its workflow's own, built into this worker (dist/runtime-files.json: every LoRA library
 * entry with a pinned size and SHA-256, src/lib/runtime-files.ts): [{ folder, file, sizeBytes, sha256 }]. None when the
 * build has no such list (a build from before it): the worker then reports the catalog's own files only.
 */
export function runtimeFileList(file = path.join(here, "dist", "runtime-files.json")) {
  try {
    const list = JSON.parse(fs.readFileSync(file, "utf8")).files;
    return Array.isArray(list)
      ? list.filter((f) => f && typeof f.folder === "string" && typeof f.file === "string" && Number.isInteger(f.sizeBytes) && typeof f.sha256 === "string" && /^[0-9a-f]{64}$/.test(f.sha256))
      : [];
  } catch {
    return [];
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/**
 * The pack folders in ComfyUI's custom_nodes that the catalog knows, matched whatever their case: { name (as the
 * catalog names it), folder (as it is on disk, which is what ComfyUI's --whitelist-custom-nodes compares), commit }.
 */
export function packFolders(comfyDir, index) {
  const dir = path.join(comfyDir ?? "", "custom_nodes");
  if (!comfyDir || !fs.existsSync(dir)) return [];
  const known = new Map();
  for (const [name, p] of Object.entries(index.packs ?? {})) {
    known.set(name.toLowerCase(), name);
    const repo = String(p.repo ?? "").split("/").pop()?.replace(/\.git$/, "");
    if (repo) known.set(repo.toLowerCase(), name);
  }
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "__pycache__") continue;
    const name = known.get(e.name.toLowerCase());
    if (!name) continue;
    out.push({ name, folder: e.name, commit: gitCommit(path.join(dir, e.name)) });
  }
  return out;
}

/** The node packs as the studio sees them: the catalog's name and the commit. */
export const nodePacks = (comfyDir, index) => packFolders(comfyDir, index).map(({ name, commit }) => ({ name, commit }));

/**
 * What its ComfyUI loaded of each pack it has (GET /object_info's node classes): for every pack folder, the catalog's
 * classes of that pack (requirements.json packs → classes) that ComfyUI doesn't list, sorted. A pack whose import
 * failed (a missing Python module) lists none of its classes: a folder alone doesn't run its workflows.
 * { [pack name]: { commit, missing: [class, …] } }.
 * @returns {Record<string, { commit: string | null; missing: string[] }>}
 */
export function loadedPacks(packs, index, objectInfo) {
  /** @type {Record<string, { commit: string | null; missing: string[] }>} */
  const out = {};
  for (const p of packs) {
    const classes = Array.isArray(index.packs?.[p.name]?.classes) ? index.packs[p.name].classes : [];
    out[p.name] = { commit: p.commit ?? null, missing: classes.filter((c) => typeof c === "string" && !Object.hasOwn(objectInfo, c)).sort() };
  }
  return out;
}

/**
 * The node packs as the studio sees them, with what its ComfyUI loaded of each (`missingClasses`: the catalog classes it
 * didn't list) where it was read at the same commit (`loaded`: loadedPacks, kept from its last start). A pack not read
 * yet has no `missingClasses`: the studio then counts its folder, as from a worker that doesn't say.
 */
export function packsAsSeen(packs, loaded = {}) {
  return packs.map(({ name, commit }) => {
    const l = loaded[name];
    return l && Array.isArray(l.missing) && (l.commit ?? null) === (commit ?? null) ? { name, commit, missingClasses: l.missing } : { name, commit };
  });
}

/** Its last reading of what its ComfyUI loaded (loadedPacks), kept in its working folder across restarts. */
export function readLoaded(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function writeLoaded(file, loaded) {
  try {
    fs.writeFileSync(file, JSON.stringify(loaded), { mode: 0o600 });
  } catch {}
}

function gitCommit(dir) {
  try {
    const head = fs.readFileSync(path.join(dir, ".git", "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    if (!ref) return null;
    const loose = path.join(dir, ".git", ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim().slice(0, 40);
    const packed = fs.readFileSync(path.join(dir, ".git", "packed-refs"), "utf8");
    return packed.split("\n").find((l) => l.endsWith(` ${ref}`))?.slice(0, 40) ?? null;
  } catch {
    return null;
  }
}

/** ComfyUI's older folder names and the ones they stand for (its folder_paths.map_legacy). */
const LEGACY = { unet: "diffusion_models", clip: "text_encoders" };
/** ComfyUI's own models folder: the subfolders it reads for a folder name, where they aren't just that name. */
const OWN_SUBFOLDERS = { diffusion_models: ["unet", "diffusion_models"], text_encoders: ["text_encoders", "clip"] };
const canonical = (folder) => LEGACY[folder] ?? folder;

/**
 * The subfolders of one of the worker's model folders where its ComfyUI looks for a folder name's files, in the order it
 * looks: the name itself, then its older twin (text_encoders also reads clip, diffusion_models also reads unet), as the
 * worker's extra_model_paths.yaml lists them (comfy.mjs modelPathsYaml).
 */
export function twinFolders(folder) {
  const name = canonical(folder);
  return [name, ...Object.keys(LEGACY).filter((old) => LEGACY[old] === name)];
}

/** A path from an extra_model_paths.yaml with ~ and environment variables ($X, ${X}, and %X% on Windows) filled in. */
function expand(p, env, home) {
  const vars = (name, whole) => env[name] ?? env[Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase()) ?? ""] ?? whole;
  let out = String(p).replace(/\$\{([^}]+)\}|\$(\w+)/g, (whole, a, b) => vars(a ?? b, whole));
  if (process.platform === "win32") out = out.replace(/%([^%]+)%/g, (whole, a) => vars(a, whole));
  return /^~(?=$|[\\/])/.test(out) ? path.join(home, out.slice(1)) : out;
}

const unquote = (v) => {
  const s = v.trim();
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s.length >= 2 && s[0] === "'" && s.at(-1) === "'" ? s.slice(1, -1).replaceAll("''", "'") : s;
};

/**
 * The folders an extra_model_paths.yaml adds, as ComfyUI reads it (utils/extra_config.py): { folder name → [folders] }.
 * It reads the shape ComfyUI's example uses: entries of `base_path`, `is_default` and `name: subfolder` (or a `|` block
 * with one subfolder a line), a subfolder joined to base_path, or to the file's own folder when it isn't a full path.
 * @param {string} text
 * @param {string} yamlDir
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [home]
 * @returns {Record<string, string[]>}
 */
export function yamlModelDirs(text, yamlDir, env = process.env, home = os.homedir()) {
  const entries = [];
  let entry = null;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/(^|\s)#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      entry = /^[^:]+:\s*$/.test(line) ? {} : null;
      if (entry) entries.push(entry);
      continue;
    }
    const m = /^\s+([^:\s][^:]*?)\s*:\s*(.*)$/.exec(line);
    if (!entry || !m) continue;
    let value = m[2];
    if (/^[|>][+-]?$/.test(value.trim())) {
      // A block: the lines indented more than this one, each one subfolder.
      const block = [];
      while (i + 1 < lines.length && (!lines[i + 1].trim() || lines[i + 1].length - lines[i + 1].trimStart().length > indent)) block.push(lines[++i].trim());
      value = block.filter(Boolean).join("\n");
    } else value = unquote(value);
    entry[m[1]] = value;
  }
  const out = {};
  for (const e of entries) {
    let base = typeof e.base_path === "string" && e.base_path ? expand(e.base_path, env, home) : null;
    if (base && !path.isAbsolute(base)) base = path.resolve(yamlDir, base);
    for (const [name, value] of Object.entries(e)) {
      if (name === "base_path" || name === "is_default" || typeof value !== "string") continue;
      for (const sub of value.split("\n").map((s) => s.trim()).filter(Boolean)) {
        const full = base ? path.join(base, sub) : path.isAbsolute(sub) ? sub : path.resolve(yamlDir, sub);
        (out[canonical(name)] ??= []).push(path.normalize(full));
      }
    }
  }
  return out;
}

/**
 * Where ComfyUI itself also looks for a folder's files, outside the worker's model folders: its own models folder (which
 * some node packs read directly), and the folders its own extra_model_paths.yaml adds.
 */
export function comfyModelDirs(comfyDir, env = process.env, home = os.homedir()) {
  if (!comfyDir) return () => [];
  let fromYaml = {};
  try {
    fromYaml = yamlModelDirs(fs.readFileSync(path.join(comfyDir, "extra_model_paths.yaml"), "utf8"), comfyDir, env, home);
  } catch {}
  return (folder) => {
    const name = canonical(folder);
    return [...(OWN_SUBFOLDERS[name] ?? [name]).map((sub) => path.join(comfyDir, "models", sub)), ...(fromYaml[name] ?? [])];
  };
}

/**
 * The model folders that aren't there now: each one must be a folder the worker can read. A drive that is still locked
 * or not yet connected after a restart makes its folder missing, and the worker then waits for it (run.mjs) instead of
 * telling the studio it lacks those files.
 */
export function missingModelDirs(modelDirs) {
  const readable = (dir) => {
    try {
      if (!fs.statSync(dir).isDirectory()) return false;
      fs.readdirSync(dir);
      return true;
    } catch {
      return false;
    }
  };
  return (modelDirs ?? []).filter((dir) => !readable(dir));
}

/** The same file, by its full path (whatever its case on Windows). */
const samePath = (a, b) => (process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

/**
 * The verified files: for every file the catalog names with a pinned SHA-256 (`pins`, else the index's own), the copy
 * that ComfyUI finds first, with the exact size and that hash. ComfyUI looks in the model folders in order and takes the
 * first one that has the file, so only that copy counts: one of the wrong size or with another hash isn't reported,
 * even when a later folder has a good copy. In each model folder it looks under the folder's name and then under its
 * older twin (twinFolders: text_encoders/x and then clip/x). Every copy where ComfyUI itself also looks (`o.comfyDir`: its own models
 * folder and its extra_model_paths.yaml) must be the same file too, or it isn't reported. A file with no pin isn't
 * reported at all, so no job that needs it comes here.
 *
 * `o.runtime`: the run-time files (runtimeFileList), checked the same way after the catalog's own (a file the catalog
 * names already counts once), so a look's or a motion's LoRA on this PC is verified and a job that loads it may come.
 */
export async function modelFiles(modelDirs, index, cacheFile, pins = filePins(), o = {}) {
  const cache = (() => {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } catch {
      return {};
    }
  })();
  const elsewhere = comfyModelDirs(o.comfyDir, o.env, o.home);
  /** The file at `p` (or null when there's none), and whether it is the pinned one. */
  const look = async (p, f, want) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return null;
    }
    if (!st.isFile()) return null;
    if (st.size !== f.sizeBytes) return { ok: false };
    const key = `${p}|${st.size}|${st.mtimeMs}`;
    // worker.json `fileCheck: "size"`: a file of the exact size counts as the pinned one until its hash is known (a
    // hash already in the cache still decides), so a first start doesn't read hundreds of GB. Nothing is cached for it.
    if (o.fileCheck === "size" && cache[key] === undefined) return { ok: true, size: st.size, sha: want };
    const sha = cache[key] ?? (cache[key] = await sha256File(p));
    return { ok: sha === want, size: st.size, sha };
  };
  const out = [];
  const catalog = Object.values(index.files ?? {});
  const named = new Set(catalog.map((f) => `${f.folder}/${f.file}`));
  const runtime = (o.runtime ?? []).filter((f) => !named.has(`${f.folder}/${f.file}`));
  for (const f of [...catalog, ...runtime]) {
    const want = pins[`${f.folder}/${f.file}`] ?? f.sha256;
    if (typeof want !== "string" || !/^[0-9a-f]{64}$/.test(want)) continue;
    let first = null;
    let firstPath = null;
    // In each model folder, the folder's own name first, then its older twin (as the worker's ComfyUI looks).
    search: for (const root of modelDirs ?? []) {
      for (const sub of twinFolders(f.folder)) {
        const p = path.join(root, sub, f.file);
        first = await look(p, f, want);
        if (first) {
          firstPath = p;
          break search;
        }
      }
    }
    if (!first?.ok) continue;
    let shadowed = false;
    for (const dir of elsewhere(f.folder)) {
      const p = path.join(dir, f.file);
      if (samePath(p, firstPath)) continue;
      const other = await look(p, f, want);
      if (other && !other.ok) {
        shadowed = true;
        break;
      }
    }
    if (shadowed) continue;
    out.push({ folder: f.folder, name: f.file, size: first.size, sha256: first.sha });
  }
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
  } catch {}
  return out;
}

/** A pack in the hash: name@commit, and the classes its ComfyUI didn't load after a "!" (none: as before). */
const packKey = (p) => `${p.name}@${p.commit ?? ""}${p.missingClasses?.length ? `!${[...p.missingClasses].sort().join(",")}` : ""}`;

/** The same hash the studio computes (src/server/computer/pool.ts inventoryHash), with the kinds of input it takes. */
export function inventoryHash(inv) {
  const files = inv.files.map((f) => `${f.folder}/${f.name}:${f.size}:${f.sha256 ?? ""}`).sort();
  const packs = inv.nodePacks.map(packKey).sort();
  return crypto.createHash("sha256").update(JSON.stringify({ files, packs, ...(inv.media && { media: [...inv.media].sort() }) })).digest("hex");
}
