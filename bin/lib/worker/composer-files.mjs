// The graph composer the worker builds in (docs/gpu-workers.md, "Job tickets"): the files of src/lib/ticket-compose.ts
// and everything it imports, and the catalog version, one SHA-256 over what of those files and the catalog's workflows
// can change a composed graph. The studio computes the same version from its own copy
// (src/server/computer/catalog-version.ts), so a worker composes a ticket only from the catalog the ticket was made for.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Where the composer starts: the worker's side of job tickets, and everything it imports. */
export const COMPOSER_ROOTS = ["src/lib/ticket-compose.ts"];

/** The file built for a composer file, inside dist/compose/ ("src/lib/comfy.ts" → "lib/comfy.mjs"; JSON → ".json.mjs"). */
export const builtName = (rel) => rel.replace(/^src\//, "").replace(/\.tsx?$/, ".mjs").replace(/\.json$/, ".json.mjs");

/** Every module a source names: imports, re-exports and import() with a fixed name. Type-only ones are left out. */
export function specifiers(src) {
  const out = new Set();
  for (const m of src.matchAll(/(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"'\n]+)["']/g)) if (!m[2]) out.add(m[3]);
  for (const m of src.matchAll(/\bimport\(\s*["']([^"'\n]+)["']\s*\)/g)) out.add(m[1]);
  return [...out];
}

/** A module name as a repo file ("@/lib/x" → src/lib/x.ts), "node:" for Node's own, or null for a package. */
export function resolveSpec(root, fromRel, spec) {
  if (spec.startsWith("node:")) return "node:";
  let base;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(root, path.dirname(fromRel), spec);
  else return null;
  for (const f of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), base]) {
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return path.relative(root, f).split(path.sep).join("/");
  }
  throw new Error(`${fromRel} imports ${spec}, which isn't there`);
}

/** The composer's files, repo-relative and sorted. Throws when one imports a package (the worker installs none). */
export function composerFiles(root) {
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    if (rel.endsWith(".json")) return;
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    for (const spec of specifiers(src)) {
      const r = resolveSpec(root, rel, spec);
      if (r === "node:") continue;
      if (r === null) throw new Error(`${rel} imports the package ${spec}: the composer may import only its own files and Node's`);
      walk(r);
    }
  };
  for (const r of COMPOSER_ROOTS) walk(r);
  return [...seen].sort();
}

/**
 * The composer's files and catalog files the catalog version leaves out: they hold only what people read or see (tile
 * covers and cards, the counts, prices and licence words the pages quote, the cloud models, Kinetic's motion groups,
 * which graphs passed a real render), so a change to one never changes a composed graph. The worker still builds the
 * composer's ones in (the composer imports them). The studio leaves out the same (src/server/computer/catalog-version.ts).
 */
export const VERSION_LEAVES_OUT = new Set([
  "src/lib/catalog/cloud-models.generated.ts",
  "src/lib/catalog/counts.ts",
  "src/lib/catalog/promo.ts",
  "src/lib/licences.ts",
  "src/lib/motion/kinetic-groups.ts",
  "src/lib/preset-cards.ts",
  "src/lib/preset-peaks.generated.ts",
  "src/lib/template-covers.generated.ts",
  "src/lib/template-covers.ts",
  "workflows/comfyui/gpu-tested.json",
]);

/**
 * A file's text as the catalog version reads it: line ends made plain (a Windows checkout's CRLF counts as LF), and in
 * a script without its comment lines, comment blocks, blank lines, each line's indent and a model's one-line description
 * (a `tagline:` line, which only pages show): none of them changes a composed graph.
 */
export function versionText(name, text) {
  const plain = text.replace(/\r\n/g, "\n");
  if (!/\.[cm]?[jt]sx?$/.test(name)) return plain;
  const out = [];
  let inBlock = false;
  for (const line of plain.split("\n")) {
    let t = line.trim();
    if (inBlock) {
      const end = t.indexOf("*/");
      if (end < 0) continue;
      inBlock = false;
      t = t.slice(end + 2).trim();
    } else if (t.startsWith("/*")) {
      const end = t.indexOf("*/", 2);
      if (end < 0) {
        inBlock = true;
        continue;
      }
      t = t.slice(end + 2).trim();
    }
    if (!t || t.startsWith("//") || /^tagline: /.test(t)) continue;
    out.push(t);
  }
  return out.join("\n");
}

const versionSha = (name, file) => crypto.createHash("sha256").update(versionText(name, fs.readFileSync(file, "utf8"))).digest("hex");

/**
 * The catalog version: one SHA-256 over what changes a composed graph: each composer file's name and code, and each
 * .json of the catalog's folder (workflows/comfyui), but for VERSION_LEAVES_OUT (versionText says what of a file counts).
 */
export function catalogVersion(root, catalogDir = path.join(root, "workflows/comfyui")) {
  const entries = composerFiles(root).map((rel) => [rel, path.join(root, rel)]);
  for (const f of fs.readdirSync(catalogDir).filter((x) => x.endsWith(".json"))) entries.push([`workflows/comfyui/${f}`, path.join(catalogDir, f)]);
  const kept = entries.filter(([name]) => !VERSION_LEAVES_OUT.has(name));
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const all = crypto.createHash("sha256");
  for (const [name, file] of kept) all.update(`${name}\u0000${versionSha(name, file)}\n`);
  return all.digest("hex");
}
