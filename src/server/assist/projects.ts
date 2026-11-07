import "server-only";
import { nanoid } from "nanoid";
import { MAX_PROJECT_SOURCES, PROJECT_COLORS, PROJECT_LIMITS, type AssistProject, type ProjectColor, type ProjectSource, type SourceKind } from "@/lib/assist";
import { bodyOf, firstInner, metaContent, stripComments, stripElements } from "@/lib/html-scan";
import { db } from "../db";
import { getElement } from "../elements";
import { PdfError, pdfText } from "./pdf";
import { fetchRemote } from "../remote-fetch";
import { readRef } from "../storage";
import { deleteProjectMemories } from "./memory";

/**
 * Assist projects: chats grouped with shared instructions, up to 20 sources (links, files,
 * images, videos, elements, notes) and project skills (Supercomputer's Projects). New chats in a
 * project start with its context; its sources are listed to the agent, which reads one in full
 * with read_source.
 */

export class ProjectError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface ProjectRow {
  id: string;
  name: string;
  color: string;
  instructions: string;
  skills_json: string;
  use_personal_memory: number;
  created_at: number;
  updated_at: number;
}

interface SourceRow {
  id: string;
  project_id: string;
  kind: SourceKind;
  title: string;
  url: string | null;
  element_id: string | null;
  content: string | null;
  status: "ready" | "error";
  error: string | null;
  created_at: number;
}

const EXCERPT = 280;

function toSource(r: SourceRow): ProjectSource {
  const text = r.content?.trim() ?? "";
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    ...(r.url && { url: r.url }),
    ...(r.element_id && { elementId: r.element_id }),
    ...(text && { excerpt: text.length > EXCERPT ? `${text.slice(0, EXCERPT).replace(/\s+\S*$/, "")}…` : text, chars: text.length }),
    status: r.status,
    ...(r.error && { error: r.error }),
    createdAt: r.created_at,
  };
}

function sourcesOf(projectId: string): ProjectSource[] {
  return (db().prepare("SELECT * FROM assist_project_sources WHERE project_id = ? ORDER BY created_at").all(projectId) as SourceRow[]).map(toSource);
}

const chatCount = (id: string) => (db().prepare("SELECT COUNT(*) AS n FROM assist_thread_state WHERE project_id = ?").get(id) as { n: number }).n;

function toProject(r: ProjectRow): AssistProject {
  return {
    id: r.id,
    name: r.name,
    color: (PROJECT_COLORS as readonly string[]).includes(r.color) ? (r.color as ProjectColor) : "iris",
    instructions: r.instructions,
    skills: JSON.parse(r.skills_json) as string[],
    usePersonalMemory: !!r.use_personal_memory,
    sources: sourcesOf(r.id),
    chats: chatCount(r.id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listProjects(): AssistProject[] {
  return (db().prepare("SELECT * FROM assist_projects ORDER BY updated_at DESC").all() as ProjectRow[]).map(toProject);
}

export function getProject(id: string): AssistProject | null {
  const r = db().prepare("SELECT * FROM assist_projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return r ? toProject(r) : null;
}

export interface ProjectInput {
  name?: string;
  color?: ProjectColor;
  instructions?: string;
  skills?: string[];
  usePersonalMemory?: boolean;
}

function clean(input: ProjectInput) {
  const name = input.name?.replace(/\s+/g, " ").trim();
  if (input.name !== undefined && !name) throw new ProjectError("Give the project a name");
  if (name && name.length > PROJECT_LIMITS.name) throw new ProjectError(`Keep the name under ${PROJECT_LIMITS.name} characters`);
  if (input.instructions && input.instructions.length > PROJECT_LIMITS.instructions) throw new ProjectError(`Instructions can be up to ${PROJECT_LIMITS.instructions} characters`);
  return { ...input, name, skills: input.skills ? [...new Set(input.skills)].slice(0, 30) : undefined };
}

export function createProject(input: ProjectInput): AssistProject {
  const c = clean(input);
  if (!c.name) throw new ProjectError("Give the project a name");
  const id = nanoid(10);
  const now = Date.now();
  db()
    .prepare("INSERT INTO assist_projects (id, name, color, instructions, skills_json, use_personal_memory, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, c.name, c.color ?? "iris", c.instructions?.trim() ?? "", JSON.stringify(c.skills ?? []), c.usePersonalMemory === false ? 0 : 1, now, now);
  return getProject(id)!;
}

export function updateProject(id: string, input: ProjectInput): AssistProject {
  const cur = getProject(id);
  if (!cur) throw new ProjectError("That project doesn't exist anymore", 404);
  const c = clean(input);
  db()
    .prepare("UPDATE assist_projects SET name = ?, color = ?, instructions = ?, skills_json = ?, use_personal_memory = ?, updated_at = ? WHERE id = ?")
    .run(
      c.name ?? cur.name,
      c.color ?? cur.color,
      c.instructions !== undefined ? c.instructions.trim() : cur.instructions,
      JSON.stringify(c.skills ?? cur.skills),
      (c.usePersonalMemory ?? cur.usePersonalMemory) ? 1 : 0,
      Date.now(),
      id,
    );
  return getProject(id)!;
}

/** Delete a project with its sources and project memories; its chats become personal chats. */
export function deleteProject(id: string): boolean {
  const n = db().transaction(() => {
    db().prepare("DELETE FROM assist_project_sources WHERE project_id = ?").run(id);
    deleteProjectMemories(id);
    db().prepare("UPDATE assist_thread_state SET project_id = NULL WHERE project_id = ?").run(id);
    // Its scheduled tasks move out with the chats, paused: they were written for the project's brief.
    // The last result becomes the reason (not the last run's chat, which the page would read instead).
    db()
      .prepare(
        "UPDATE assist_schedules SET project_id = NULL, paused = 1, last_thread_id = NULL, last_status = 'failed', last_text = 'Paused: its project was deleted', updated_at = ? WHERE project_id = ?",
      )
      .run(Date.now(), id);
    return db().prepare("DELETE FROM assist_projects WHERE id = ?").run(id).changes;
  })();
  return n > 0;
}

export function touchProject(id: string): void {
  db().prepare("UPDATE assist_projects SET updated_at = ? WHERE id = ?").run(Date.now(), id);
}

// ---------------------------------------------------------------------------
// Sources

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Readable text from a web page: the title, the description, then the body without scripts, styles or navigation chrome. */
export function htmlToText(html: string): { title: string; text: string } {
  // Linear scans only (src/lib/html-scan.ts): the page is someone else's, and the server reads it on its one thread.
  const title = decode(firstInner(html, "title") ?? "").replace(/\s+/g, " ").trim();
  const desc = decode(metaContent(html, ["description", "og:description"])).trim();
  const body = stripElements(stripComments(bodyOf(html)), ["script", "style", "noscript", "svg", "template", "iframe", "nav", "footer", "form"])
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre|ul|ol|table|header|main)>/gi, "\n")
    .replace(/<li\b[^<>]*>/gi, "- ")
    .replace(/<[^<>]+>/g, " ");
  const text = decode(body)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { title, text: [desc, text].filter(Boolean).join("\n\n") };
}

const TEXT_TYPE = /^(text\/|application\/(json|xml|x-subrip|x-yaml|yaml|csv|javascript))/;

function insertSource(projectId: string, s: Omit<SourceRow, "id" | "project_id" | "created_at">): ProjectSource {
  const id = nanoid(10);
  db()
    .prepare("INSERT INTO assist_project_sources (id, project_id, kind, title, url, element_id, content, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, projectId, s.kind, s.title.slice(0, 160), s.url, s.element_id, s.content?.slice(0, PROJECT_LIMITS.sourceText) ?? null, s.status, s.error, Date.now());
  touchProject(projectId);
  return toSource(db().prepare("SELECT * FROM assist_project_sources WHERE id = ?").get(id) as SourceRow);
}

export type SourceInput =
  | { kind: "link"; url: string }
  | { kind: "file"; url: string; name?: string }
  | { kind: "element"; elementId: string }
  | { kind: "text"; title?: string; text: string };

/** Fetch a public page through the guarded fetcher (no private addresses, size and time caps). */
async function fetchLink(url: string): Promise<{ title: string; text: string }> {
  const res = await fetchRemote(url, { maxBytes: 4_000_000, timeoutMs: 20_000 });
  const type = res.contentType ?? "";
  if (/application\/pdf/.test(type) || res.data.subarray(0, 5).toString("latin1") === "%PDF-") {
    const pdf = await pdfText(res.data, { maxChars: PROJECT_LIMITS.sourceText });
    return { title: pdf.title ?? "", text: pdf.text };
  }
  const raw = res.data.toString("utf8");
  if (/html|xml/.test(type) || /^\s*</.test(raw)) return htmlToText(raw);
  if (TEXT_TYPE.test(type) || !type) return { title: "", text: raw };
  throw new Error(`That link is a ${type.split(";")[0]} file, not a page — upload it instead`);
}

export async function addSource(projectId: string, input: SourceInput): Promise<ProjectSource> {
  if (!getProject(projectId)) throw new ProjectError("That project doesn't exist anymore", 404);
  const count = (db().prepare("SELECT COUNT(*) AS n FROM assist_project_sources WHERE project_id = ?").get(projectId) as { n: number }).n;
  if (count >= MAX_PROJECT_SOURCES) throw new ProjectError(`This project can have up to ${MAX_PROJECT_SOURCES} sources. Remove one to add another.`, 409);
  switch (input.kind) {
    case "link": {
      let url: URL;
      try {
        url = new URL(input.url.trim());
      } catch {
        throw new ProjectError("That doesn't look like a link — paste the full address, starting with https://");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new ProjectError("Only http(s) links can be added");
      try {
        const page = await fetchLink(url.toString());
        if (!page.text.trim()) throw new Error("The page has no readable text (it may need JavaScript)");
        return insertSource(projectId, { kind: "link", title: page.title || url.hostname + url.pathname.replace(/\/$/, ""), url: url.toString(), element_id: null, content: page.text, status: "ready", error: null });
      } catch (e) {
        // Kept with the error so the project still lists the link (and Assist still knows it).
        return insertSource(projectId, { kind: "link", title: url.hostname + url.pathname.replace(/\/$/, ""), url: url.toString(), element_id: null, content: null, status: "error", error: (e as Error).message.slice(0, 300) });
      }
    }
    case "file": {
      if (!input.url.startsWith("/api/files/")) throw new ProjectError("Upload the file first");
      const { data, contentType, name } = await readRef(input.url).catch(() => {
        throw new ProjectError("That file isn't on this server anymore", 404);
      });
      const title = (input.name ?? name).slice(0, 160);
      const kind: SourceKind = contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : "file";
      if (kind !== "file") return insertSource(projectId, { kind, title, url: input.url, element_id: null, content: null, status: "ready", error: null });
      if (TEXT_TYPE.test(contentType) || /\.(md|txt|csv|json|srt|vtt|ya?ml)$/i.test(title)) {
        return insertSource(projectId, { kind: "file", title, url: input.url, element_id: null, content: data.toString("utf8"), status: "ready", error: null });
      }
      if (contentType.startsWith("application/pdf") || /\.pdf$/i.test(title)) {
        // A PDF that can't be read is refused (not saved), so it doesn't take one of the 20 places.
        const pdf = await pdfText(data, { maxChars: PROJECT_LIMITS.sourceText }).catch((e) => {
          throw new ProjectError(e instanceof PdfError ? e.message : "Couldn't read that PDF — paste the text as a note instead", 422);
        });
        return insertSource(projectId, { kind: "file", title, url: input.url, element_id: null, content: pdf.text, status: "ready", error: null });
      }
      throw new ProjectError(`Assist can't read ${/\.([a-z0-9]{1,8})$/i.exec(title)?.[1]?.toUpperCase() ?? contentType.split(";")[0]} files — paste the text as a note, or add a PDF, .txt or .md version`, 415);
    }
    case "element": {
      const el = getElement(input.elementId);
      if (!el) throw new ProjectError("That element doesn't exist anymore", 404);
      const about = [`@${el.handle} — ${el.kind}`, el.description, `${el.references.length} reference photo${el.references.length === 1 ? "" : "s"}`].filter(Boolean).join("\n");
      return insertSource(projectId, { kind: "element", title: el.name, url: el.references[0] ?? null, element_id: el.id, content: about, status: "ready", error: null });
    }
    case "text": {
      const text = input.text.trim();
      if (!text) throw new ProjectError("Write the note first");
      if (text.length > PROJECT_LIMITS.note) throw new ProjectError(`A note can be up to ${PROJECT_LIMITS.note / 1000}k characters`);
      const title = input.title?.trim() || text.split("\n")[0].slice(0, 60);
      return insertSource(projectId, { kind: "text", title, url: null, element_id: null, content: text, status: "ready", error: null });
    }
  }
}

/** Fetch a link source again (it failed, or the page changed). */
export async function refreshSource(projectId: string, sourceId: string): Promise<ProjectSource> {
  const r = db().prepare("SELECT * FROM assist_project_sources WHERE id = ? AND project_id = ?").get(sourceId, projectId) as SourceRow | undefined;
  if (!r) throw new ProjectError("That source isn't in this project", 404);
  if (r.kind !== "link" || !r.url) return toSource(r);
  try {
    const page = await fetchLink(r.url);
    db().prepare("UPDATE assist_project_sources SET title = ?, content = ?, status = 'ready', error = NULL WHERE id = ?").run((page.title || r.title).slice(0, 160), page.text.slice(0, PROJECT_LIMITS.sourceText), sourceId);
  } catch (e) {
    db().prepare("UPDATE assist_project_sources SET status = 'error', error = ? WHERE id = ?").run((e as Error).message.slice(0, 300), sourceId);
  }
  return toSource(db().prepare("SELECT * FROM assist_project_sources WHERE id = ?").get(sourceId) as SourceRow);
}

export function deleteSource(projectId: string, sourceId: string): boolean {
  const n = db().prepare("DELETE FROM assist_project_sources WHERE id = ? AND project_id = ?").run(sourceId, projectId).changes;
  if (n) touchProject(projectId);
  return n > 0;
}

/** A source's full text for the agent (read_source). */
export function sourceText(projectId: string, sourceId: string): { source: ProjectSource; text: string | null } | null {
  const r = db().prepare("SELECT * FROM assist_project_sources WHERE id = ? AND project_id = ?").get(sourceId, projectId) as SourceRow | undefined;
  return r ? { source: toSource(r), text: r.content } : null;
}
