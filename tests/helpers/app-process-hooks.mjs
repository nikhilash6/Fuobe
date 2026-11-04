/**
 * The second app process's own loader hook (tests/helpers/app-process-child.ts registers it after ts-register.mjs's):
 * "next/server" is tests/stubs/next-server.ts, as the tests mock it.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const stub = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "stubs", "next-server.ts")).href;

export async function resolve(specifier, context, next) {
  if (specifier === "next/server") return { url: stub, shortCircuit: true };
  return next(specifier, context);
}
