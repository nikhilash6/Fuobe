// Loading and checking suite files (scripts/eval/cases/*.json, plus any path you pass).
import fs from "node:fs";
import path from "node:path";
import { CASES_DIR, LOCAL_DIR } from "./paths.mjs";
import { issues, SuiteSchema } from "./schema.mjs";

/** The bundled suites (cases/*.json) and your own (local/cases/*.json), by name. */
export function suiteFiles() {
  const list = (dir) =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((n) => n.endsWith(".json") && !n.endsWith(".schema.json"))
          .map((n) => path.join(dir, n))
      : [];
  return [...list(CASES_DIR), ...list(path.join(LOCAL_DIR, "cases"))];
}

/** A suite problem: the file and every issue, one per line. */
export class SuiteError extends Error {
  constructor(file, lines) {
    super(`${path.relative(process.cwd(), file) || file} isn't a valid suite:\n  ${lines.join("\n  ")}`);
    this.file = file;
    this.lines = lines;
  }
}

/** Parse and check one suite file; the result carries `file`. */
export function readSuite(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new SuiteError(file, [e.code === "ENOENT" ? "no such file" : `not JSON (${e.message})`]);
  }
  const parsed = SuiteSchema.safeParse(raw);
  if (!parsed.success) throw new SuiteError(file, issues(parsed.error));
  return { ...parsed.data, file };
}

/** A suite by name ("soul"; local/cases/<name>.json wins over cases/<name>.json) or by path. */
export function loadSuite(nameOrPath) {
  if (/[\\/]|\.json$/.test(nameOrPath)) return readSuite(path.resolve(nameOrPath));
  const files = suiteFiles().filter((f) => path.basename(f, ".json") === nameOrPath);
  if (!files.length) {
    const names = [...new Set(suiteFiles().map((f) => path.basename(f, ".json")))];
    throw new Error(`There's no suite “${nameOrPath}”. Suites: ${names.join(", ")}`);
  }
  return readSuite(files.at(-1));
}

/** Check every suite file; returns {file, ok, cases, lines}. */
export function validateAll(files = suiteFiles()) {
  return files.map((file) => {
    try {
      const s = readSuite(file);
      return { file, ok: true, suite: s.suite, cases: s.cases.length, ...(s.runFirst && { runFirst: s.runFirst }), lines: [] };
    } catch (e) {
      return { file, ok: false, cases: 0, lines: e instanceof SuiteError ? e.lines : [e.message] };
    }
  });
}
