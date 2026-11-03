/**
 * Lets a child `node` process load the server's TypeScript the way the tests do: "@/…" from src, the "server-only"
 * stub, and imports written without an extension. Used with --import tests/helpers/ts-register.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tryFile = (p) => [p, `${p}.ts`, `${p}.tsx`, path.join(p, "index.ts")].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: pathToFileURL(path.join(root, "tests/stubs/server-only.ts")).href, shortCircuit: true };
  let base = null;
  if (specifier.startsWith("@/")) base = path.join(root, "src", specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parent = fileURLToPath(context.parentURL);
    if (parent.endsWith(".ts") || parent.endsWith(".tsx")) base = path.resolve(path.dirname(parent), specifier);
  }
  const file = base && tryFile(base);
  if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  return next(specifier, context);
}

/** TypeScript to JavaScript (the typescript package, as the editor sees it), as ES modules. */
let ts;
export async function load(url, context, next) {
  if (!url.startsWith("file:") || !/\.tsx?$/.test(url)) return next(url, context);
  ts ??= (await import("typescript")).default;
  const source = fs.readFileSync(fileURLToPath(url), "utf8");
  const out = ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false, isolatedModules: true },
  });
  return { format: "module", source: out.outputText, shortCircuit: true };
}
