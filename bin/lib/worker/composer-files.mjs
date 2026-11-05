// The graph composer the worker builds in (docs/gpu-workers.md, "Job tickets"): the files of src/lib/ticket-compose.ts
// and everything it imports, and the catalog version, one SHA-256 over those files and the catalog's workflows. The
// studio computes the same version from its own copy (src/server/computer/catalog-version.ts), so a worker composes
// a ticket only from the catalog the ticket was made for.
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

/** A text file's SHA-256 with its line ends made plain (a Windows checkout's CRLF counts as LF). */
const textSha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex");

/**
 * The catalog version: one SHA-256 over each composer file's name and content, and each .json of the catalog's folder
 * (workflows/comfyui), with line ends made plain.
 */
export function catalogVersion(root, catalogDir = path.join(root, "workflows/comfyui")) {
  const entries = composerFiles(root).map((rel) => [rel, path.join(root, rel)]);
  for (const f of fs.readdirSync(catalogDir).filter((x) => x.endsWith(".json"))) entries.push([`workflows/comfyui/${f}`, path.join(catalogDir, f)]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const all = crypto.createHash("sha256");
  for (const [name, file] of entries) all.update(`${name}\u0000${textSha(file)}\n`);
  return all.digest("hex");
}
