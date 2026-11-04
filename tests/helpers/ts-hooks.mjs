/**
 * Lets a child `node` process load the server's TypeScript the way the tests do: "@/…" from src, the "server-only"
 * stub, imports written without an extension (a package's own files too, "next/server"), and JSON imports without an
 * import attribute. Used with
 * --import tests/helpers/ts-register.mjs.
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
  try {
    return await next(specifier, context);
  } catch (e) {
    // A package's file named without its extension ("next/server"), as the bundler allows.
    if (e?.code !== "ERR_MODULE_NOT_FOUND" || specifier.startsWith(".") || !specifier.includes("/") || specifier.endsWith(".js")) throw e;
    return next(`${specifier}.js`, context);
  }
}

/** TypeScript to JavaScript (the typescript package, as the editor sees it), as ES modules; JSON as the bundler reads it. */
let ts;
export async function load(url, context, next) {
  // The server imports JSON files (the catalog) with no import attribute, as the bundler allows.
  if (url.startsWith("file:") && url.endsWith(".json")) return { format: "json", source: fs.readFileSync(fileURLToPath(url), "utf8"), shortCircuit: true };
  if (!url.startsWith("file:") || !/\.tsx?$/.test(url)) return next(url, context);
  ts ??= (await import("typescript")).default;
  const source = fs.readFileSync(fileURLToPath(url), "utf8");
  const out = ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false, isolatedModules: true },
  });
  return { format: "module", source: out.outputText, shortCircuit: true };
}
