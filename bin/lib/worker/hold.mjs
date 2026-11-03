// Finished results kept on the worker's own disk (docs/gpu-workers.md). The moment its ComfyUI finishes a job, before the
// studio hears of it, the worker copies every file the job's history entries name into hold/<task id>/ with a note of
// the entries (held.json). The results stay there until the studio has them all. If the worker or its ComfyUI stops in
// between, the next claim gives the job back to this worker, and it uploads the kept files from where the studio's copy
// got to, instead of running the job again. Kept results of a job that is no longer this worker's are deleted.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const TASK_ID = /^[A-Za-z0-9_-]{16}$/;
const NOTE = "held.json";

/** Every file the entries name in ComfyUI's output or temp folder (each once), with no path in its name. */
export function heldFiles(entries) {
  const out = new Map();
  for (const e of entries ?? []) {
    for (const ui of Object.values(e?.outputs ?? {})) {
      for (const v of Object.values(ui ?? {})) {
        if (!Array.isArray(v)) continue;
        for (const f of v) {
          if (!f || typeof f.filename !== "string" || (f.type !== "output" && f.type !== "temp")) continue;
          const subfolder = typeof f.subfolder === "string" ? f.subfolder : "";
          if (!f.filename || /[\\/]|^\.\.?$/.test(f.filename) || subfolder.split(/[\\/]/).some((s) => s === "..")) continue;
          out.set(`${f.type}\u0000${subfolder}\u0000${f.filename}`, { filename: f.filename, subfolder, type: f.type });
        }
      }
    }
  }
  return [...out.values()];
}

/** An entry as kept: its status, its outputs and its place (never the graph again, with someone's prompt in it). */
const slim = (e) => ({ ...(Array.isArray(e?.prompt) && { prompt: [e.prompt[0], e.prompt[1]] }), status: e?.status, outputs: e?.outputs });

export class Hold {
  constructor(dir) {
    this.dir = dir;
  }

  folder(id) {
    if (!TASK_ID.test(String(id))) throw new Error("Not a task id");
    return path.join(this.dir, id);
  }

  note(id) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.folder(id), NOTE), "utf8"));
    } catch {
      return null;
    }
  }

  /** The tasks with kept results. */
  ids() {
    try {
      return fs.readdirSync(this.dir).filter((id) => this.has(id));
    } catch {
      return [];
    }
  }

  has(id) {
    return TASK_ID.test(String(id)) && fs.existsSync(path.join(this.dir, id, NOTE));
  }

  /**
   * Keep a finished job's results: every file its entries name, read from its ComfyUI (`read`), then the note. The note
   * comes last, so a stop halfway keeps nothing that looks whole.
   */
  async keep(t, held, read) {
    const dir = this.folder(t.id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    try {
      for (const f of heldFiles(held.entries)) {
        const res = await read(f);
        if (!res?.ok || !res.body) throw new Error("A result couldn't be kept");
        const file = `f${files.length}`;
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(path.join(dir, file), { mode: 0o600 }));
        files.push({ ...f, file });
      }
      const note = { taskId: t.id, promptId: t.promptId, kind: held.kind, entries: held.entries.map(slim), ...(held.execMs !== undefined && { execMs: held.execMs }), files, at: Date.now() };
      fs.writeFileSync(path.join(dir, `${NOTE}.tmp`), JSON.stringify(note), { mode: 0o600 });
      fs.renameSync(path.join(dir, `${NOTE}.tmp`), path.join(dir, NOTE));
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }

  /** The results kept for this task's prompt: { kind, entries, execMs }, or null. */
  async get(t) {
    if (!this.has(t.id)) return null;
    const n = this.note(t.id);
    if (!n || n.taskId !== t.id || n.promptId !== t.promptId || !Array.isArray(n.entries)) return null;
    return { kind: n.kind === "passes" ? "passes" : "finished", entries: n.entries, ...(typeof n.execMs === "number" && { execMs: n.execMs }) };
  }

  /** One kept file of this task, as a Blob read from disk, or null. */
  async file(t, w) {
    const n = this.note(t.id);
    if (!n || n.taskId !== t.id) return null;
    const f = (n.files ?? []).find((x) => x.filename === w.filename && x.subfolder === (w.subfolder ?? "") && x.type === w.type);
    if (!f || !/^f\d+$/.test(f.file)) return null;
    const p = path.join(this.folder(t.id), f.file);
    if (!fs.existsSync(p)) return null;
    return typeof fs.openAsBlob === "function" ? fs.openAsBlob(p) : new Blob([fs.readFileSync(p)]);
  }

  /** Let go of one task's kept results. */
  drop(id) {
    if (TASK_ID.test(String(id))) fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
  }

  /** Let go of every task's kept results but `keep`'s, and of anything else in the folder. */
  dropAllBut(keep = null) {
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) if (name !== keep) fs.rmSync(path.join(this.dir, name), { recursive: true, force: true });
  }
}
