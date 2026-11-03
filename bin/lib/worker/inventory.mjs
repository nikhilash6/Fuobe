// What this worker has (docs/gpu-workers.md): the model files in its model folders that the studio's catalog names,
// each checked by folder, name, exact size and SHA-256 (every file the catalog names has its hash pinned in the
// worker's build: dist/file-pins.json); and its ComfyUI's node packs with their commits. Hashes are cached by path,
// size and modified time, so a restart doesn't read hundreds of GB again.
import crypto from "node:crypto";
import fs from "node:fs";
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

/**
 * The verified files: for every file the catalog names, found in one of the model folders under its folder with the
 * exact size and its pinned SHA-256 (`pins`, else the index's own). A file with no pinned hash, of the wrong size or
 * with another hash isn't reported at all, so no job that needs it comes here.
 */
export async function modelFiles(modelDirs, index, cacheFile, pins = filePins()) {
  const cache = (() => {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } catch {
      return {};
    }
  })();
  const out = [];
  for (const f of Object.values(index.files ?? {})) {
    const want = pins[`${f.folder}/${f.file}`] ?? f.sha256;
    if (typeof want !== "string" || !/^[0-9a-f]{64}$/.test(want)) continue;
    for (const root of modelDirs ?? []) {
      const p = path.join(root, f.folder, f.file);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size !== f.sizeBytes) continue;
      const key = `${p}|${st.size}|${st.mtimeMs}`;
      const sha = cache[key] ?? (cache[key] = await sha256File(p));
      if (sha !== want) continue;
      out.push({ folder: f.folder, name: f.file, size: st.size, sha256: sha });
      break;
    }
  }
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
  } catch {}
  return out;
}

/** The same hash the studio computes (src/server/computer/pool.ts inventoryHash). */
export function inventoryHash(inv) {
  const files = inv.files.map((f) => `${f.folder}/${f.name}:${f.size}:${f.sha256 ?? ""}`).sort();
  const packs = inv.nodePacks.map((p) => `${p.name}@${p.commit ?? ""}`).sort();
  return crypto.createHash("sha256").update(JSON.stringify({ files, packs })).digest("hex");
}
