/**
 * Module hooks that let a Node script import Fuobe's TypeScript sources directly (Node strips the types itself): the
 * `@/` alias resolves to src/, and an import with no extension tries .ts, .tsx and index.ts, as the bundler does.
 * Install with `module.registerHooks({ resolve })`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function existing(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

export function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    base = path.join(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  const file = base && existing(base);
  return file ? next(pathToFileURL(file).href, context) : next(specifier, context);
}
