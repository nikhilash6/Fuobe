// `fuobe skills add`: where a skill comes from (a SKILL.md, a .zip / .skill, a folder, a git repo
// or a link), finding the skills in a folder the way the open `skills` CLI does, and packing one
// skill folder for /api/assist/skills/upload.
import fs from "node:fs";
import path from "node:path";
import { UsageError } from "./args.mjs";
import { zipFiles } from "./zip.mjs";

/** Text files a skill may carry next to SKILL.md (the server keeps these, and drops the rest). */
export const TEXT_FILE = /\.(md|markdown|txt|json|ya?ml|csv|tsv|srt|vtt|html?|css|xml|js|mjs|ts|py|sh)$/i;
/** The server's limits for the files beside SKILL.md. */
export const MAX_FILES = 30;
export const MAX_FILES_BYTES = 400_000;

/** Folders the `skills` CLI looks in (the common ones; see its docs/creating-skills.md). */
const CONTAINERS = ["skills", "skills/.curated", "skills/.experimental", "skills/.system", ".agents/skills", ".claude/skills", "data/skills"];
const SKIP = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".next"]);

/**
 * What `fuobe skills add <source>` was given.
 * @param {string} source
 * @param {(p: string) => fs.Stats | null} stat a stat that returns null for a missing path
 * @returns {{ type: "markdown" | "archive" | "dir", path: string } | { type: "git", url: string, ref?: string, subpath?: string } | { type: "link", url: string }}
 */
export function parseSource(source, stat) {
  const s = source.trim();
  const st = stat(s);
  if (st?.isDirectory()) return { type: "dir", path: s };
  if (st?.isFile()) {
    if (/\.(zip|skill)$/i.test(s)) return { type: "archive", path: s };
    if (/\.(md|markdown)$/i.test(s)) return { type: "markdown", path: s };
    throw new UsageError(`${s} isn't a skill: give a SKILL.md, a .zip or .skill archive, a folder or a git repository`, "skills");
  }
  // https://github.com/owner/repo/tree/<ref>/<path>: one folder of a repository.
  const tree = /^https:\/\/(github\.com|gitlab\.com)\/([^/]+)\/([^/]+?)(?:\.git)?\/(?:-\/)?tree\/([^/]+)(?:\/(.+?))?\/?$/.exec(s);
  if (tree) return { type: "git", url: `https://${tree[1]}/${tree[2]}/${tree[3]}.git`, ref: tree[4], ...(tree[5] && { subpath: tree[5] }) };
  if (/^https?:\/\/.+\.(zip|skill|md)(\?.*)?$/i.test(s)) return { type: "link", url: s };
  if (/^(https?:\/\/|ssh:\/\/|git@|git:\/\/|file:\/\/)/.test(s) || /\.git$/.test(s)) return { type: "git", url: s };
  // owner/repo: GitHub, as `npx skills add owner/repo` reads it.
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !s.startsWith(".")) return { type: "git", url: `https://github.com/${s.replace(/\.git$/, "")}.git` };
  throw new UsageError(`Can't find ${s}. Give a SKILL.md, a .zip or .skill archive, a folder, owner/repo or a git URL.`, "skills");
}

/** The frontmatter fields `skills add` needs: the name, and whether it's marked internal. */
export function skillHead(markdown) {
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
  const name = /^name:\s*["']?([^"'\r\n#]+?)["']?\s*(?:#.*)?$/m.exec(fm)?.[1]?.trim() ?? null;
  // metadata.internal: true (the skills CLI hides these unless asked for by name).
  const internal = /^metadata:\s*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+internal:\s*true\s*$/m.test(fm);
  return { name, internal };
}

/**
 * Skill folders under `root`: the root itself when it has a SKILL.md, else the usual container
 * folders (and folders right under the root) up to three levels deep, else any SKILL.md up to five
 * levels down. A SKILL.md shadows anything nested below it.
 * @returns {string[]} folder paths
 */
export function findSkillDirs(root) {
  const has = (dir) => fs.existsSync(path.join(dir, "SKILL.md"));
  if (has(root)) return [root];
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      const sub = path.join(dir, e.name);
      if (has(sub)) found.push(sub);
      else if (depth > 1) walk(sub, depth - 1);
    }
  };
  walk(root, 1);
  for (const c of CONTAINERS) if (fs.existsSync(path.join(root, c))) walk(path.join(root, c), 3);
  if (!found.length) walk(root, 5);
  return [...new Set(found.map((d) => path.resolve(d)))].sort();
}

/**
 * One skill folder as a zip for the upload: SKILL.md and the text files beside it (skipping
 * dot-files, binaries and anything past the server's limits, which are listed in `skipped`).
 */
export function packSkill(dir) {
  const folder = path.basename(path.resolve(dir));
  const files = [{ name: `${folder}/SKILL.md`, data: fs.readFileSync(path.join(dir, "SKILL.md")) }];
  const skipped = [];
  let bytes = 0;
  const walk = (sub) => {
    for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      if (e.isDirectory()) {
        walk(rel);
        continue;
      }
      if (!e.isFile() || rel === "SKILL.md") continue;
      const data = fs.readFileSync(path.join(dir, rel));
      if (!TEXT_FILE.test(rel) || data.includes(0) || files.length > MAX_FILES || bytes + data.length > MAX_FILES_BYTES) {
        skipped.push(rel);
        continue;
      }
      bytes += data.length;
      files.push({ name: `${folder}/${rel}`, data });
    }
  };
  walk("");
  return { zip: zipFiles(files), files: files.map((f) => f.name.slice(folder.length + 1)), skipped };
}

// ---------------------------------------------------------------------------
// Running a skill that runs by itself (its recipe): `fuobe skills params | estimate | run | export`

/** A skill input that takes a file. */
export const isFileInput = (p) => p.type === "image" || p.type === "video" || p.type === "audio";

/**
 * `-p key=value` for a skill's inputs. Every value stays text, as the Run form sends it (the server reads a number from
 * its digits); `key=` leaves the input to its default. A key given twice is a mistake, not the last one winning.
 * @param {string[]} pairs
 * @returns {Record<string, string>}
 */
export function skillValues(pairs) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new UsageError(`-p takes input=value, not “${pair}” (fuobe skills params <name> lists the inputs)`, "skills");
    const key = pair.slice(0, eq).trim();
    if (key in out) throw new UsageError(`-p ${key} is given twice`, "skills");
    out[key] = pair.slice(eq + 1);
  }
  return out;
}

/**
 * Rows of a CSV or TSV text (a spreadsheet's paste is tab-separated): quotes, doubled quotes, line breaks inside quotes,
 * a byte-order mark. Read the way Fuobe reads a pasted table (csvCells in src/lib/recipe.ts), with each row's first line.
 * @param {string} text
 * @returns {{ cells: string[], line: number }[]}
 */
export function csvCells(text) {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = first.includes("\t") && !first.includes(",") ? "\t" : first.includes(";") && !first.includes(",") && !first.includes("\t") ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === "\n") line++;
        cell += c;
      }
      continue;
    }
    if (c === '"' && !cell.trim()) {
      quoted = true;
      cell = "";
    } else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push({ cells: row, line: start });
      row = [];
      cell = "";
      line++;
      start = line;
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push({ cells: row, line: start });
  }
  return rows.map((r) => ({ ...r, cells: r.cells.map((x) => x.trim()) })).filter((r) => r.cells.some((c) => c));
}

const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, " ").trim();

/** The input each header cell names (by its id or its label, as Fuobe matches them), or null. */
export function headerInputs(header, params) {
  const byName = new Map();
  for (const p of params) {
    byName.set(norm(p.id), p.id);
    byName.set(norm(p.label), p.id);
  }
  return header.map((h) => byName.get(norm(h)) ?? null);
}

const quote = (s) => (/[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * Rows written back as CSV for the server, and the line each row starts on there (a cell with a line break takes more
 * than one), so its answers ("Row 3: …") can name the row's line in the person's own file.
 * @param {string[][]} rows header first
 */
export function toCsv(rows) {
  const lines = [];
  let line = 1;
  const text = rows
    .map((r) => {
      lines.push(line);
      const out = r.map(quote).join(",");
      line += out.split("\n").length;
      return out;
    })
    .join("\n");
  return { text: `${text}\n`, lines };
}

/** $12.40: a skill's price before it runs, to the cent. */
export const exactCost = (usd) => (usd === 0 ? "free" : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`);

const TYPE_WORDS = { image: "image", video: "video", audio: "audio", text: "text", number: "number", choice: "choice", element: "@element" };

/**
 * A skill's inputs as a table: id, type, needed or its default, and what it takes.
 * @param {{ name: string, title: string, recipe: { params: any[] }, engines: string[], ready: string[], line?: string }} view GET /api/assist/skills/<name>/recipe
 */
export function paramsTable(view) {
  return view.recipe.params.map((p) => {
    const needed = p.required && p.default === undefined ? "needed" : p.default !== undefined ? `default ${p.default}` : "optional";
    const what = [
      p.label,
      p.type === "choice" ? (p.options ?? []).join(" | ") : null,
      p.type === "number" && (p.min !== undefined || p.max !== undefined) ? `${p.min ?? "…"}–${p.max ?? "…"}` : null,
      p.type === "text" && p.max ? `up to ${p.max} characters` : null,
      isFileInput(p) ? "a file, an https:// link or a /api/files/… URL" : null,
      p.example !== undefined && p.example !== null && p.example !== "" && !isFileInput(p) ? `e.g. ${p.example}` : null,
    ].filter(Boolean);
    return [p.id, TYPE_WORDS[p.type] ?? p.type, needed, what.join(" · ")];
  });
}

const ENGINE_WORDS = { cloud: "the cloud", open: "your GPU (open source)" };

/** "on the cloud", "on your GPU (open source)". */
export const engineWords = (engine) => ENGINE_WORDS[engine] ?? engine;

/**
 * A skill's price in words: the steps of one run, then the total. With `rows` (a --rows file), a row's problem names
 * its line in that file (`lineOf`).
 * @param {any} est POST /api/assist/skills/<name>/estimate
 * @param {string} title
 * @param {{ rows?: boolean, lineOf?: (line: number) => number }} [o]
 */
export function estimateLines(est, title, { rows = false, lineOf = (l) => l } = {}) {
  const runs = est.runs.length;
  const out = [`${title} on ${engineWords(est.engine)}: ${est.jobs.length} step${est.jobs.length === 1 ? "" : "s"}${runs > 1 ? " a run" : ""}`];
  for (const [i, j] of est.jobs.entries()) {
    const price = j.demo ? "demo, free" : j.costUsd === null ? "price varies" : exactCost(j.costUsd);
    out.push(`  ${i + 1}. ${j.modelName}${j.note ? ` · ${j.note}` : ""}${j.count > 1 ? ` · ${j.count} outputs` : ""} · ${price}${j.error ? ` — ${j.error}` : ""}`);
  }
  out.push(...estimateProblems(est, { rows, lineOf }, false));
  if (est.runnable) out.push(priceWords(est, runs));
  return out;
}

/** What stops a skill's run, row by row (`jobs`: a step's own problem too, when nothing else says why). */
export function estimateProblems(est, { rows = false, lineOf = (l) => l } = {}, jobs = true) {
  const out = [...est.errors];
  for (const r of est.runs) for (const e of r.errors) out.push(rows ? `Row ${lineOf(r.line)}: ${e}` : e);
  if (jobs && !out.length) for (const j of est.jobs) if (j.error) out.push(`${j.modelName}: ${j.error}`);
  return out;
}

/** "20 runs · $12.40 in all", "Free on your GPU", "A demo: free". */
export function priceWords(est, runs) {
  if (est.demo) return `${runs > 1 ? `${runs} runs · ` : ""}a demo (nothing connected), free`;
  if (est.total === null) return `${runs > 1 ? `${runs} runs · ` : ""}some prices vary`;
  if (est.total === 0) return `${runs > 1 ? `${runs} runs · ` : ""}free`;
  return runs > 1 ? `${runs} runs · ${exactCost(est.total)} in all` : `about ${exactCost(est.total)}`;
}
