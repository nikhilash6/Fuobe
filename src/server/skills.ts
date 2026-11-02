import "server-only";
import fs from "node:fs";
import path from "node:path";
import { parseSkillMd, SKILL_LIMITS, SKILL_NAME_RE, toSkillMd, type Skill, type SkillMeta, type SkillSummary } from "@/lib/assist";
import { NESTED_SKILL, parseRecipe, RECIPE_FILE, runsASkill, stripChecks, stripExamples, type Recipe } from "@/lib/recipe";
import { unzip, ZipError } from "./assist/unzip";
import { db } from "./db";
import { zip } from "./zip";

/**
 * Assist skills: SKILL.md playbooks the agent loads on demand (Supercomputer's Skills).
 * Built-ins are folders in `skills/` at the repo root, read from disk (edits apply on the next
 * request); people's own skills live in the `skills` table. Built-ins can be switched off
 * (`skill_toggles`) but not edited — duplicate one to change it.
 */

export class SkillError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const BUILTIN_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.FUOBE_SKILLS_DIR ?? path.join(process.cwd(), "skills"));

/** Text files a skill may carry next to SKILL.md (references, examples, templates). */
const TEXT_FILE = /\.(md|markdown|txt|json|ya?ml|csv|tsv|srt|vtt|html?|css|xml|js|mjs|ts|py|sh)$/i;
const MAX_FILES = 30;
const MAX_FILES_BYTES = 400_000;

interface BuiltinEntry {
  mtime: number;
  skill: Omit<Skill, "enabled"> | null;
  error?: string;
}

declare global {
  var __fuobeBuiltinSkills: Map<string, BuiltinEntry> | undefined;
}
const cache = (globalThis.__fuobeBuiltinSkills ??= new Map());

function readBuiltin(dir: string): BuiltinEntry {
  const file = path.join(BUILTIN_DIR, dir, "SKILL.md");
  const mtime = fs.statSync(file).mtimeMs;
  const hit = cache.get(dir);
  if (hit && hit.mtime === mtime) return hit;
  const parsed = parseSkillMd(fs.readFileSync(file, "utf8"));
  let entry: BuiltinEntry;
  if (!parsed.ok) entry = { mtime, skill: null, error: parsed.error };
  else {
    const files = fs
      .readdirSync(path.join(BUILTIN_DIR, dir), { recursive: true, withFileTypes: false })
      .map(String)
      .filter((f) => f !== "SKILL.md" && TEXT_FILE.test(f))
      .slice(0, MAX_FILES)
      .map((f) => ({ path: f.split(path.sep).join("/"), size: fs.statSync(path.join(BUILTIN_DIR, dir, f)).size }));
    const recipe = files.some((f) => f.path === RECIPE_FILE) && parseRecipe(fs.readFileSync(path.join(BUILTIN_DIR, dir, RECIPE_FILE), "utf8")).ok;
    entry = { mtime, skill: { ...parsed.skill, source: "builtin", files, ...(recipe && { recipe }), createdAt: mtime, updatedAt: mtime } };
  }
  cache.set(dir, entry);
  if (entry.error) console.warn(`[skills] skills/${dir}/SKILL.md: ${entry.error}`);
  return entry;
}

function builtins(): Omit<Skill, "enabled">[] {
  let dirs: string[];
  try {
    dirs = fs
      .readdirSync(BUILTIN_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(BUILTIN_DIR, d.name, "SKILL.md")))
      .map((d) => d.name);
  } catch {
    return [];
  }
  return dirs.flatMap((d) => {
    try {
      const s = readBuiltin(d).skill;
      return s ? [s] : [];
    } catch {
      return [];
    }
  });
}

interface Row {
  name: string;
  title: string;
  description: string;
  when_to_use: string;
  body: string;
  meta_json: string;
  files_json: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

type StoredFile = { path: string; content: string };

function fromRow(r: Row): Skill {
  const meta = JSON.parse(r.meta_json) as Pick<SkillMeta, "icon" | "studio" | "tags" | "offline">;
  const files = JSON.parse(r.files_json) as StoredFile[];
  const recipe = files.find((f) => f.path === RECIPE_FILE);
  return {
    name: r.name,
    title: r.title,
    description: r.description,
    whenToUse: r.when_to_use,
    body: r.body,
    ...meta,
    source: "user",
    enabled: !!r.enabled,
    files: files.map((f) => ({ path: f.path, size: Buffer.byteLength(f.content) })),
    ...(recipe && parseRecipe(recipe.content).ok && { recipe: true }),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toggles(): Map<string, boolean> {
  return new Map((db().prepare("SELECT name, enabled FROM skill_toggles").all() as { name: string; enabled: number }[]).map((r) => [r.name, !!r.enabled]));
}

const summary = ({ body, ...s }: Skill): SkillSummary => ({ ...s, chars: body.length });

/** Every skill, built-in first (by title), then the user's own (newest first). */
export function listSkills(): SkillSummary[] {
  return allSkills().map(summary);
}

function allSkills(): Skill[] {
  const t = toggles();
  const builtin = builtins()
    .map((s) => ({ ...s, enabled: t.get(s.name) ?? true }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const names = new Set(builtin.map((s) => s.name));
  const own = (db().prepare("SELECT * FROM skills ORDER BY created_at DESC").all() as Row[]).map(fromRow).filter((s) => !names.has(s.name));
  return [...builtin, ...own];
}

/** Skills the agent may use (enabled), in list order. */
export function enabledSkills(): Skill[] {
  return allSkills().filter((s) => s.enabled);
}

export function getSkill(name: string): Skill | null {
  if (!SKILL_NAME_RE.test(name)) return null;
  const b = builtins().find((s) => s.name === name);
  if (b) return { ...b, enabled: toggles().get(name) ?? true };
  const r = db().prepare("SELECT * FROM skills WHERE name = ?").get(name) as Row | undefined;
  return r ? fromRow(r) : null;
}

/** A file bundled with a skill (built-in folder or upload), as text. */
export function skillFile(name: string, file: string): string | null {
  const s = getSkill(name);
  if (!s || !s.files.some((f) => f.path === file)) return null;
  if (s.source === "builtin") {
    const abs = path.resolve(BUILTIN_DIR, name, file);
    if (!abs.startsWith(path.join(BUILTIN_DIR, name) + path.sep)) return null;
    return fs.readFileSync(abs, "utf8");
  }
  const r = db().prepare("SELECT files_json FROM skills WHERE name = ?").get(name) as { files_json: string } | undefined;
  return (JSON.parse(r?.files_json ?? "[]") as StoredFile[]).find((f) => f.path === file)?.content ?? null;
}

/** Every file bundled with a skill, with its text (the .zip download). */
export function skillFiles(name: string): StoredFile[] {
  const s = getSkill(name);
  if (!s) return [];
  return s.files.flatMap((f) => {
    const content = skillFile(name, f.path);
    return content === null ? [] : [{ path: f.path, content }];
  });
}

/** A skill's recipe (a valid recipe.json in its files), or null. */
export function skillRecipe(name: string): Recipe | null {
  const text = skillFile(name, RECIPE_FILE);
  if (text === null) return null;
  const parsed = parseRecipe(text);
  return parsed.ok ? parsed.recipe : null;
}

/** A path a skill's file may have: relative, no `..`, a text file. */
const safeFilePath = (p: string) => p.length <= 200 && TEXT_FILE.test(p) && !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((x) => !x || x === "." || x === "..");

/**
 * Write (or with null, remove) one of a user skill's files, within its limits (MAX_FILES, MAX_FILES_BYTES). Built-in
 * skills are read from disk and never change: duplicate one first.
 */
export function setSkillFile(name: string, file: string, content: string | null): Skill {
  const cur = getSkill(name);
  if (!cur) throw new SkillError("No such skill", 404);
  if (cur.source === "builtin") throw new SkillError("Built-in skills can't be changed — Duplicate it first, then change your copy", 403);
  if (!safeFilePath(file)) throw new SkillError(`“${file}” isn't a file name a skill can carry (a text file such as notes.md or recipe.json)`);
  if (file === RECIPE_FILE && content !== null && runsASkill(content)) throw new SkillError(`Check recipe.json: ${NESTED_SKILL}`, 422);
  const r = db().prepare("SELECT files_json FROM skills WHERE name = ?").get(name) as { files_json: string };
  const files = (JSON.parse(r.files_json) as StoredFile[]).filter((f) => f.path !== file);
  if (content !== null) files.push({ path: file, content });
  if (files.length > MAX_FILES) throw new SkillError(`A skill carries at most ${MAX_FILES} files`);
  const bytes = files.reduce((n, f) => n + Buffer.byteLength(f.content), 0);
  if (bytes > MAX_FILES_BYTES) throw new SkillError(`A skill's files add up to at most ${Math.round(MAX_FILES_BYTES / 1000)} KB`);
  db().prepare("UPDATE skills SET files_json = ?, updated_at = ? WHERE name = ?").run(JSON.stringify(files), Date.now(), name);
  return getSkill(name)!;
}

/**
 * The skill with its files as a .zip (one folder, as importSkill reads it). A recipe's examples and source stay home
 * unless `examples` (they name this install's files, faces and words), and files fixed in its steps become inputs the
 * other install asks for (stripExamples). Its checks never travel: they were this install's (stripChecks).
 */
export function skillArchive(name: string, o: { examples?: boolean } = {}): Buffer | null {
  const s = getSkill(name);
  if (!s) return null;
  const files = skillFiles(name).map((f) => {
    if (f.path !== RECIPE_FILE) return f;
    const parsed = parseRecipe(f.content);
    return parsed.ok ? { ...f, content: `${JSON.stringify(o.examples ? stripChecks(parsed.recipe) : stripExamples(parsed.recipe), null, 2)}\n` } : f;
  });
  return zip([{ name: `${name}/SKILL.md`, data: Buffer.from(toSkillMd(s)) }, ...files.map((f) => ({ name: `${name}/${f.path}`, data: Buffer.from(f.content) }))]);
}

/** The skill as a SKILL.md file (download, duplicate). */
export function skillMarkdown(name: string): string | null {
  const s = getSkill(name);
  return s ? toSkillMd(s) : null;
}

export interface SkillInput {
  name?: string;
  title: string;
  description: string;
  whenToUse?: string;
  body: string;
  icon?: string;
  studio?: string;
  tags?: string[];
}

/** Validate a form the same way an uploaded SKILL.md is validated. */
function validated(input: SkillInput & { name: string }) {
  const parsed = parseSkillMd(toSkillMd({ ...input, whenToUse: input.whenToUse ?? "" }));
  if (!parsed.ok) throw new SkillError(parsed.error.replace("Check SKILL.md and try again: ", "").replace(/^./, (c) => c.toUpperCase()));
  return parsed.skill;
}

/** Names the API routes use (static routes beside /api/assist/skills/[name]). */
const RESERVED = new Set(["upload", "new", "draft"]);

function taken(name: string): string | null {
  if (RESERVED.has(name)) return `“${name}” is reserved — pick another name`;
  if (builtins().some((s) => s.name === name)) return `/${name} is a built-in skill — pick another name`;
  if (db().prepare("SELECT 1 FROM skills WHERE name = ?").get(name)) return `You already have a skill called /${name}`;
  return null;
}

function insert(s: SkillMeta & { body: string }, files: StoredFile[] = []): Skill {
  const now = Date.now();
  const meta = { ...(s.icon && { icon: s.icon }), ...(s.studio && { studio: s.studio }), ...(s.tags?.length && { tags: s.tags }), ...(s.offline && { offline: s.offline }) };
  db()
    .prepare(
      `INSERT INTO skills (name, title, description, when_to_use, body, meta_json, files_json, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(s.name, s.title, s.description, s.whenToUse, s.body, JSON.stringify(meta), JSON.stringify(files), now, now);
  return getSkill(s.name)!;
}

export function createSkill(input: SkillInput): Skill {
  const name = input.name?.trim() || "";
  if (!name) throw new SkillError("Give the skill a name");
  const conflict = taken(name);
  if (conflict) throw new SkillError(conflict, 409);
  return insert(validated({ ...input, name }));
}

export function updateSkill(name: string, patch: Partial<SkillInput>): Skill {
  const cur = getSkill(name);
  if (!cur) throw new SkillError("No such skill", 404);
  if (cur.source === "builtin") throw new SkillError("Built-in skills can't be edited — duplicate it to make your own version", 403);
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as SkillInput & { name: string };
  const s = validated({ ...next, name: patch.name?.trim() || name });
  if (s.name !== name) {
    const conflict = taken(s.name);
    if (conflict) throw new SkillError(conflict, 409);
  }
  const meta = { ...(s.icon && { icon: s.icon }), ...(s.studio && { studio: s.studio }), ...(s.tags?.length && { tags: s.tags }), ...(cur.offline && { offline: cur.offline }) };
  db().transaction(() => {
    db()
      .prepare("UPDATE skills SET name = ?, title = ?, description = ?, when_to_use = ?, body = ?, meta_json = ?, updated_at = ? WHERE name = ?")
      .run(s.name, s.title, s.description, s.whenToUse, s.body, JSON.stringify(meta), Date.now(), name);
    if (s.name !== name) renameSkillRefs(name, s.name);
  })();
  return getSkill(s.name)!;
}

/**
 * Keep the skill lists of projects and chats in step with a rename (`to`) or a delete (`to` null):
 * a project whose only skill went away would otherwise have no skills at all.
 */
function renameSkillRefs(from: string, to: string | null): void {
  const like = `%${JSON.stringify(from)}%`;
  for (const [table, key] of [
    ["assist_projects", "id"],
    ["assist_thread_state", "thread_id"],
  ] as const) {
    const rows = db().prepare(`SELECT ${key} AS id, skills_json FROM ${table} WHERE skills_json LIKE ?`).all(like) as { id: string; skills_json: string }[];
    for (const r of rows) {
      const list = JSON.parse(r.skills_json) as string[];
      if (!list.includes(from)) continue;
      const next = [...new Set(list.flatMap((n) => (n === from ? (to ? [to] : []) : [n])))];
      db().prepare(`UPDATE ${table} SET skills_json = ? WHERE ${key} = ?`).run(JSON.stringify(next), r.id);
    }
  }
}

/** A user copy of any skill (the way to change a built-in). */
export function duplicateSkill(name: string): Skill {
  const cur = getSkill(name);
  if (!cur) throw new SkillError("No such skill", 404);
  let copy = `${name}-copy`.slice(0, SKILL_LIMITS.name);
  for (let i = 2; taken(copy); i++) copy = `${name.slice(0, SKILL_LIMITS.name - 8)}-copy-${i}`;
  const files = cur.files.flatMap((f) => {
    const content = skillFile(name, f.path);
    return content === null ? [] : [{ path: f.path, content }];
  });
  return insert({ ...cur, name: copy, title: `${cur.title} (copy)`.slice(0, SKILL_LIMITS.title) }, files);
}

export function deleteSkill(name: string): void {
  const cur = getSkill(name);
  if (!cur) throw new SkillError("No such skill", 404);
  if (cur.source === "builtin") throw new SkillError("Built-in skills can't be deleted — switch it off instead", 403);
  db().transaction(() => {
    db().prepare("DELETE FROM skills WHERE name = ?").run(name);
    renameSkillRefs(name, null);
  })();
}

export function setSkillEnabled(name: string, enabled: boolean): Skill {
  const cur = getSkill(name);
  if (!cur) throw new SkillError("No such skill", 404);
  if (cur.source === "builtin") db().prepare("INSERT INTO skill_toggles (name, enabled) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled").run(name, enabled ? 1 : 0);
  else db().prepare("UPDATE skills SET enabled = ?, updated_at = ? WHERE name = ?").run(enabled ? 1 : 0, Date.now(), name);
  return getSkill(name)!;
}

/**
 * An uploaded recipe.json without its `verified` dates: they were another install's checks (or anyone's typing), and
 * a recipe runs here only after it has been checked here (src/server/recipes.ts verifyRecipe).
 */
function unverified(text: string): string {
  const parsed = parseRecipe(text);
  if (!parsed.ok || !parsed.recipe.verified) return text;
  return `${JSON.stringify(stripChecks(parsed.recipe), null, 2)}\n`;
}

export interface ImportResult {
  skill: Skill;
  /** Files in the archive that weren't kept (binary, too many, too big). */
  skipped: string[];
  replaced: boolean;
}

/**
 * Add a skill from an upload: a SKILL.md, or a .zip / .skill archive with exactly one SKILL.md
 * (at the top or in one folder). Text files beside it are kept as the skill's references.
 */
export function importSkill(file: { name: string; data: Buffer }, opts: { replace?: boolean } = {}): ImportResult {
  const lower = file.name.toLowerCase();
  let md: string;
  let files: StoredFile[] = [];
  const skipped: string[] = [];
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt")) {
    md = file.data.toString("utf8");
  } else if (lower.endsWith(".zip") || lower.endsWith(".skill")) {
    let entries;
    try {
      entries = unzip(file.data);
    } catch (e) {
      throw new SkillError(e instanceof ZipError ? `${e.message}.` : "Couldn't open that archive.");
    }
    entries = entries.filter((e) => !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(e.name));
    const docs = entries.filter((e) => /(^|\/)skill\.md$/i.test(e.name));
    if (!docs.length) throw new SkillError("Check SKILL.md and try again: the archive has no SKILL.md.");
    // The shallowest SKILL.md is the skill; nested ones (examples) are plain files.
    const depth = (n: string) => n.split("/").length;
    docs.sort((a, b) => depth(a.name) - depth(b.name));
    if (docs.length > 1 && depth(docs[0].name) === depth(docs[1].name)) throw new SkillError("Check SKILL.md and try again: the archive holds more than one skill — upload them one at a time.");
    const root = docs[0].name.slice(0, docs[0].name.length - "SKILL.md".length);
    md = docs[0].data.toString("utf8");
    let bytes = 0;
    for (const e of entries) {
      if (e === docs[0]) continue;
      const rel = e.name.startsWith(root) ? e.name.slice(root.length) : e.name;
      if (!TEXT_FILE.test(rel) || e.data.includes(0) || files.length >= MAX_FILES || bytes + e.data.length > MAX_FILES_BYTES) {
        skipped.push(rel);
        continue;
      }
      bytes += e.data.length;
      if (rel === RECIPE_FILE && runsASkill(e.data.toString("utf8"))) throw new SkillError(`Check recipe.json and try again: ${NESTED_SKILL}.`);
      files.push({ path: rel, content: rel === RECIPE_FILE ? unverified(e.data.toString("utf8")) : e.data.toString("utf8") });
    }
  } else {
    throw new SkillError("Upload a .zip or .skill archive, or a SKILL.md file");
  }
  const parsed = parseSkillMd(md);
  if (!parsed.ok) throw new SkillError(parsed.error);
  const s = parsed.skill;
  if (RESERVED.has(s.name)) throw new SkillError(`Check SKILL.md and try again: “${s.name}” is a reserved name — rename it.`);
  if (builtins().some((b) => b.name === s.name)) throw new SkillError(`/${s.name} is a built-in skill — rename it in SKILL.md (name: …) and upload again`, 409);
  const exists = !!db().prepare("SELECT 1 FROM skills WHERE name = ?").get(s.name);
  if (exists && !opts.replace) throw new SkillError(`You already have a skill called /${s.name}`, 409);
  if (exists) db().prepare("DELETE FROM skills WHERE name = ?").run(s.name);
  files = files.slice(0, MAX_FILES);
  return { skill: insert(s, files), skipped, replaced: exists };
}
