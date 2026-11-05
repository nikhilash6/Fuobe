import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The catalog version the studio makes job tickets for (src/lib/job-ticket.ts): one SHA-256 over what can change a
 * composed graph: the graph composer's files (src/lib/ticket-compose.ts and everything it imports) and the catalog's
 * workflows, leaving out what people only read or see and every comment (VERSION_LEAVES_OUT, versionText).
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

const textSha = (name: string, file: string) => crypto.createHash("sha256").update(versionText(name, fs.readFileSync(file, "utf8"))).digest("hex");

/**
 * The composer's files and catalog files the catalog version leaves out: they hold only what people read or see (tile
 * covers and cards, the counts, prices and licence words the pages quote, the cloud models, Kinetic's motion groups,
 * which graphs passed a real render), so a change to one never changes a composed graph. The same list as the worker
 * build's (bin/lib/worker/composer-files.mjs VERSION_LEAVES_OUT).
 */
export const VERSION_LEAVES_OUT: ReadonlySet<string> = new Set([
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
 * A file's text as the catalog version reads it: line ends made plain, and in a script without its comment lines, comment
 * blocks, blank lines, each line's indent and a model's one-line description (a `tagline:` line), as the worker build
 * reads it (composer-files.mjs versionText).
 */
export function versionText(name: string, text: string): string {
  const plain = text.replace(/\r\n/g, "\n");
  if (!/\.[cm]?[jt]sx?$/.test(name)) return plain;
  const out: string[] = [];
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

/** The catalog version of the files under `root` (null when they aren't there to read). */
export function computeCatalogVersion(root = process.cwd(), catalogDir = path.join(root, "workflows", "comfyui")): string | null {
  try {
    const entries: [string, string][] = composerFiles(root).map((rel) => [rel, path.join(root, rel)]);
    for (const f of fs.readdirSync(catalogDir).filter((x) => x.endsWith(".json"))) entries.push([`workflows/comfyui/${f}`, path.join(catalogDir, f)]);
    const kept = entries.filter(([name]) => !VERSION_LEAVES_OUT.has(name));
    kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const all = crypto.createHash("sha256");
    for (const [name, file] of kept) all.update(`${name}\u0000${textSha(name, file)}\n`);
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
