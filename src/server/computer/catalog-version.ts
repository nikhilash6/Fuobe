import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The catalog version the studio makes job tickets for (src/lib/job-ticket.ts): one SHA-256 over the graph composer's
 * files (src/lib/ticket-compose.ts and everything it imports) and the catalog's workflows, with line ends made plain.
 * The worker program's build computes the same from its own checkout (bin/lib/worker/composer-files.mjs), so a worker
 * built from another catalog says "update the worker" and takes no ticket. Read from this server's own files once.
 */

const ROOTS = ["src/lib/ticket-compose.ts"];

function specifiers(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"'\n]+)["']/g)) if (!m[2]) out.add(m[3]);
  for (const m of src.matchAll(/\bimport\(\s*["']([^"'\n]+)["']\s*\)/g)) out.add(m[1]);
  return [...out];
}

function resolveSpec(root: string, fromRel: string, spec: string): string | null {
  if (spec.startsWith("node:")) return null;
  const base = spec.startsWith("@/") ? path.join(root, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(root, path.dirname(fromRel), spec) : null;
  if (!base) return null;
  for (const f of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), base]) {
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return path.relative(root, f).split(path.sep).join("/");
  }
  return null;
}

/** The composer's files, repo-relative and sorted. */
export function composerFiles(root = process.cwd()): string[] {
  const seen = new Set<string>();
  const walk = (rel: string) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    if (rel.endsWith(".json")) return;
    for (const spec of specifiers(fs.readFileSync(path.join(root, rel), "utf8"))) {
      const r = resolveSpec(root, rel, spec);
      if (r) walk(r);
    }
  };
  for (const r of ROOTS) walk(r);
  return [...seen].sort();
}

const textSha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex");

/** The catalog version of the files under `root` (null when they aren't there to read). */
export function computeCatalogVersion(root = process.cwd(), catalogDir = path.join(root, "workflows", "comfyui")): string | null {
  try {
    const entries: [string, string][] = composerFiles(root).map((rel) => [rel, path.join(root, rel)]);
    for (const f of fs.readdirSync(catalogDir).filter((x) => x.endsWith(".json"))) entries.push([`workflows/comfyui/${f}`, path.join(catalogDir, f)]);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const all = crypto.createHash("sha256");
    for (const [name, file] of entries) all.update(`${name}\u0000${textSha(file)}\n`);
    return all.digest("hex");
  } catch {
    return null;
  }
}

declare global {
  var __fuobeCatalogVersion: { version: string | null } | undefined;
}

/**
 * This studio's catalog version (computed once; FUOBE_CATALOG_VERSION, a 64-hex value, wins: a server that runs from a
 * build without its sources sets it from the build). Null: unknown, and then no ticket is made (accounts' runs on the
 * workers are refused before they are queued).
 */
export function catalogVersion(): string | null {
  const env = process.env.FUOBE_CATALOG_VERSION;
  if (env && /^[0-9a-f]{64}$/.test(env)) return env;
  return (globalThis.__fuobeCatalogVersion ??= { version: computeCatalogVersion() }).version;
}

/** Forget the computed version (tests that change the catalog). */
export const forgetCatalogVersion = () => {
  globalThis.__fuobeCatalogVersion = undefined;
};
