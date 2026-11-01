import "server-only";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { DATA_DIR, db } from "./db";
import type { MediaKind } from "@/lib/catalog/types";
import { probeMediaRangesSync, type MediaInfo } from "@/lib/media-probe";
import { fetchRemote } from "./remote-fetch";
import { tenant, tenantAccount } from "./tenant";
import { accountInputLimit } from "./account-files";
import { assetAccount, fileAccount, generationAccount } from "./account-library";
import { otherHeaderInfo } from "./media-facts";

export const FILES_DIR = path.join(DATA_DIR, "files");

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  // Text outputs (transcripts, translations, scripts) and 3D models.
  "text/plain": "txt",
  "application/x-subrip": "srt",
  "text/vtt": "vtt",
  "application/json": "json",
  "model/gltf-binary": "glb",
  "model/gltf+json": "gltf",
  // Gaussian splats (TripoSplat on fal writes .ply; the open TripoSplat graph writes .spz).
  "model/ply": "ply",
  "model/x-spz": "spz",
  "model/x-ksplat": "ksplat",
  // Pro exports: FFV1 in Matroska, EXR frames (ComfyUI's /view says image/aces) and their zip.
  "video/x-matroska": "mkv",
  // Character Swap Studio takes AVI clips (Akatz Labs' tool does).
  "video/x-msvideo": "avi",
  "image/x-exr": "exr",
  "image/aces": "exr",
  "application/zip": "zip",
};

const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  txt: "text/plain",
  srt: "application/x-subrip",
  vtt: "text/vtt",
  json: "application/json",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  ply: "model/ply",
  spz: "model/x-spz",
  ksplat: "model/x-ksplat",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  exr: "image/x-exr",
  zip: "application/zip",
};

export function contentTypeFor(fileName: string, fallback = "application/octet-stream"): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXT[ext] ?? fallback;
}

export function kindFor(contentType: string): MediaKind {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  // Transcripts, translations and scripts: plain text, subtitles or JSON cue lists.
  if (type.startsWith("text/") || type === "application/json" || type === "application/x-subrip") return "text";
  if (type.startsWith("model/")) return "model3d";
  return "image";
}

export interface Asset {
  id: string;
  kind: MediaKind;
  name: string | null;
  relPath: string;
  contentType: string;
  size: number;
  /** "derived": a picture a tool rendered for a model (a layer, a region, a mask), not listed with your uploads. */
  source: "upload" | "generation" | "derived";
  generationId: string | null;
  createdAt: number;
  url: string;
  /** Public sign-up: the account the file belongs to (its upload, or a file of its run); absent for the owner's. */
  accountId?: string;
}

interface AssetRow {
  id: string;
  kind: MediaKind;
  name: string | null;
  rel_path: string;
  content_type: string;
  size: number;
  source: Asset["source"];
  generation_id: string | null;
  created_at: number;
  account_id?: string | null;
}

export function fileUrl(relPath: string): string {
  return `/api/files/${relPath.split(path.sep).join("/")}`;
}

function toAsset(r: AssetRow): Asset {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    relPath: r.rel_path,
    contentType: r.content_type,
    size: r.size,
    source: r.source,
    generationId: r.generation_id,
    createdAt: r.created_at,
    url: fileUrl(r.rel_path),
    ...(r.account_id ? { accountId: r.account_id } : {}),
  };
}

/** `accountId`: the account a file is stored for (default: the tenant's, else the account whose run made it). */
type NewAsset = { contentType: string; name?: string; source: Asset["source"]; generationId?: string; accountId?: string };

/** The account a new file belongs to: given, the work's tenant, or the account whose run made it (null: the owner). */
function ownerOf(opts: NewAsset): string | null {
  return opts.accountId ?? tenantAccount() ?? (opts.generationId ? generationAccount(opts.generationId) : null) ?? null;
}

/**
 * Store a file under files/<outputs|uploads>/<day>/<id>.<ext>: `put` writes it there, then its row is added. The
 * extension comes from the type. A type Fuobe doesn't know keeps the plain extension of the owner's file name (a rig's
 * .fbx, an Assist source's .pdf or .md), never a page or script one (.html, .svg, .js), and an account's file name never
 * picks it: those are stored as .bin.
 */
function addAsset(opts: NewAsset, put: (abs: string) => void): Asset {
  const id = nanoid(12);
  const account = ownerOf(opts);
  const named = opts.name?.includes(".") ? opts.name.split(".").pop()?.toLowerCase() : undefined;
  const fromName = !account && named && /^[a-z0-9]{1,8}$/.test(named) && !/^(html?|xht|xhtml|xml|svgz?|js|mjs)$/.test(named) ? named : undefined;
  const ext = EXT_BY_TYPE[opts.contentType.split(";")[0].trim()] ?? fromName ?? "bin";
  const day = new Date().toISOString().slice(0, 10);
  const relPath = path.join(/*turbopackIgnore: true*/ opts.source === "generation" ? "outputs" : "uploads", day, `${id}.${ext}`);
  const abs = path.join(FILES_DIR, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  put(abs);
  const row: AssetRow = {
    id,
    kind: kindFor(opts.contentType),
    name: opts.name ?? null,
    rel_path: relPath,
    content_type: opts.contentType,
    size: fs.statSync(abs).size,
    source: opts.source,
    generation_id: opts.generationId ?? null,
    created_at: Date.now(),
    account_id: account,
  };
  db()
    .prepare(
      `INSERT INTO assets (id, kind, name, rel_path, content_type, size, source, generation_id, created_at, account_id)
       VALUES (@id, @kind, @name, @rel_path, @content_type, @size, @source, @generation_id, @created_at, @account_id)`,
    )
    .run(row);
  return toAsset(row);
}

export function saveFile(opts: NewAsset & { data: Buffer }): Asset {
  return addAsset(opts, (abs) => fs.writeFileSync(abs, opts.data));
}

/**
 * A file that is already ready on disk (a zip a provider wrote while finishing a job) becomes an asset:
 * moved into the files folder, not copied. `from` must be on the same file system (scratchDir()).
 */
export function adoptFile(opts: NewAsset & { from: string }): Asset {
  return addAsset(opts, (abs) => fs.renameSync(opts.from, abs));
}

/** A scratch folder next to the files folder (same file system, so adoptFile can move from it; never served). */
export function scratchDir(): string {
  const dir = path.join(DATA_DIR, "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getAsset(id: string): Asset | null {
  const row = db().prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
  return row ? toAsset(row) : null;
}

/** Newest first; page with `before` (+ `beforeId`): the last asset of the previous page. Derived renders only when asked for. */
export function listAssets(opts: { source?: Asset["source"]; kind?: MediaKind; limit?: number; before?: number; beforeId?: string; accountId?: string | null }): Asset[] {
  // The owner's files, or with `accountId` that account's own (public sign-up: its uploads and results are its own).
  const where: string[] = [opts.accountId ? "account_id = ?" : "account_id IS NULL"];
  const args: unknown[] = opts.accountId ? [opts.accountId] : [];
  if (opts.source) {
    where.push("source = ?");
    args.push(opts.source);
  } else where.push("source != 'derived'");
  if (opts.kind) {
    where.push("kind = ?");
    args.push(opts.kind);
  }
  if (opts.before) {
    where.push(opts.beforeId ? "(created_at < ? OR (created_at = ? AND id < ?))" : "created_at < ?");
    args.push(...(opts.beforeId ? [opts.before, opts.before, opts.beforeId] : [opts.before]));
  }
  const sql = `SELECT * FROM assets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
  return (db().prepare(sql).all(...args, opts.limit ?? 100) as AssetRow[]).map(toAsset);
}

export function deleteAsset(id: string): void {
  const a = getAsset(id);
  if (!a) return;
  fs.rmSync(absolutePath(a.relPath), { force: true });
  db().prepare("DELETE FROM assets WHERE id = ?").run(id);
}

/** Resolve a relative path inside FILES_DIR, refusing traversal. */
export function absolutePath(relPath: string): string {
  const abs = path.resolve(FILES_DIR, relPath);
  if (!abs.startsWith(FILES_DIR + path.sep)) throw new Error("Invalid path");
  return abs;
}

/**
 * The first bytes of a file saved in Fuobe (an /api/files/ URL or an asset id), read at once: enough for a picture's
 * size (src/lib/image-size.ts). Null for a link elsewhere, a data URI or a file that's gone.
 */
export function localHead(ref: string, maxBytes = 512 * 1024): Buffer | null {
  try {
    const rel = ref.startsWith("/api/files/") ? filesRel(ref) : /^[\w-]{6,40}$/.test(ref) ? getAsset(ref)?.relPath : undefined;
    if (!rel) return null;
    // A visitor's price check or an account's run: only its own files, and no word on whether another one exists.
    if (tenant() && !ownsRef(ref, rel)) return null;
    const fd = fs.openSync(absolutePath(rel), "r");
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, fs.fstatSync(fd).size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return buf;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Resolve an asset reference from the UI (asset id, /api/files/... URL, http(s) URL or data URI)
 * to bytes + content type.
 */
export async function readRef(ref: string): Promise<{ data: Buffer; contentType: string; name: string }> {
  // An account's run (or a visitor's price check): only its own files (guardRef), and none bigger than an upload may be.
  if (tenant()) guardRef(ref);
  const read = async (abs: string, contentType: string) => {
    if (tenant()) {
      const limit = accountInputLimit(contentType);
      if ((await fs.promises.stat(abs)).size > limit.bytes) throw new RefError(limit.message, 413);
    }
    // Read without holding up the server.
    return fs.promises.readFile(abs);
  };
  if (ref.startsWith("data:")) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(ref);
    if (!m) throw new Error("Malformed data URI");
    const contentType = m[1] ?? "application/octet-stream";
    const data = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    return { data, contentType, name: `input.${EXT_BY_TYPE[contentType] ?? "bin"}` };
  }
  if (ref.startsWith("/api/files/")) {
    // The same path guardRef checked: the query left out, decoded once, never a step out of its folder.
    const rel = filesRel(ref);
    if (rel === null) throw new Error("Invalid path");
    const abs = absolutePath(rel);
    const contentType = contentTypeFor(abs);
    return { data: await read(abs, contentType), contentType, name: path.basename(abs) };
  }
  if (/^https?:\/\//.test(ref)) {
    // Public links only: never this machine or its private network (see remote-fetch.ts).
    const res = await fetchRemote(ref);
    const path0 = new URL(res.url).pathname;
    const header = res.contentType && res.contentType !== "application/octet-stream" ? res.contentType : null;
    return { data: res.data, contentType: header ?? contentTypeFor(path0), name: path0.split("/").pop() || "input" };
  }
  const asset = getAsset(ref);
  if (!asset) throw new Error(`Unknown asset ${ref}`);
  return {
    data: await read(absolutePath(asset.relPath), asset.contentType),
    contentType: asset.contentType,
    name: asset.name ?? path.basename(asset.relPath),
  };
}

// ---------------------------------------------------------------------------
// Public sign-up: an account's run reads only its own files

/** A file a run may not read: `status` is the HTTP answer a route gives (403; 404 for one that is gone; 413 too big). */
export class RefError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 413,
  ) {
    super(message);
  }
}

export const LINK_INPUT_MESSAGE = "Upload the file first. Runs on your GPU can't fetch links.";
export const NOT_YOURS_MESSAGE = "That file isn't yours. Upload your own.";
export const GONE_MESSAGE = "That file has expired. Upload it again.";

/**
 * A stored file's path under the files folder, from an /api/files/… reference: the query and fragment left out, then
 * decoded once. Null when it isn't one, doesn't decode, or a part of it is empty, "." or "..", or holds a backslash, a
 * colon or a NUL. Every check and every read goes by it, so the path a check looks up is always the path that is read.
 */
export function filesRel(ref: string): string | null {
  if (!ref.startsWith("/api/files/")) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(ref.slice("/api/files/".length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  return rel.split("/").every((p) => p && p !== "." && p !== ".." && !/[\\:\0]/.test(p)) ? rel : null;
}

/** Whether the tenant owns this file (an account: its own; a guest: none). */
function ownsRef(ref: string, rel?: string | null): boolean {
  const who = tenantAccount();
  if (!who) return false;
  if (ref.startsWith("/api/files/")) {
    const r = rel ?? filesRel(ref);
    return !!r && fileAccount(r) === who;
  }
  return assetAccount(ref) === who;
}

/**
 * Inside a tenant (an account's run, a visitor's price check), what a run may read: a data: URI (the server makes these;
 * the run route refuses them from accounts) and the tenant's own stored files. A link is refused (the server never
 * fetches one for an account); another's file reads as not yours, one that is gone as gone. Throws a RefError.
 */
export function guardRef(ref: string): void {
  if (!tenant() || ref.startsWith("data:")) return;
  if (/^https?:\/\//i.test(ref)) throw new RefError(LINK_INPUT_MESSAGE, 403);
  const owner = ref.startsWith("/api/files/") ? (filesRel(ref) === null ? undefined : fileAccount(filesRel(ref)!)) : assetAccount(ref);
  if (owner === undefined) throw new RefError(GONE_MESSAGE, 404);
  if (!tenantAccount() || owner !== tenantAccount()) throw new RefError(NOT_YOURS_MESSAGE, 403);
}

declare global {
  var __fuobeStoredFacts: Map<string, MediaInfo | null> | undefined;
}
const STORED_FACTS_KEPT = 500;
/** The most read of a file's start for its header, and of an MP4's index (moov) inside a tenant and outside. */
const STORED_HEAD_BYTES = 1024 * 1024;
const TENANT_MOOV_BYTES = 8 * 1024 * 1024;
const OWNER_MOOV_BYTES = 64 * 1024 * 1024;

/**
 * What a stored file's header says (length, size, tracks), for a price check or a plan: only the header (and an MP4's
 * index) is read, never the whole file, at once and cached by the file's own path, size and time.
 *
 * - null: no such file here, as far as this asker may know. Inside a tenant (a visitor's price check, an account's run)
 *   that is also another's file: it answers like one that is gone, before any cache is looked at.
 * - { info: null }: a file the asker may use whose header says nothing Fuobe reads (WebM…), or, inside a tenant, one
 *   bigger than an upload of its kind may be (never read: the run itself says it is too big).
 *
 * `allContainers` (Split soundtrack): a WebM / Matroska or AVI header is read too, from the same first bytes
 * (media-facts.ts otherHeaderInfo), when the header says nothing else Fuobe reads. Cached apart, so every other caller's
 * answer for those files stays as it was.
 */
export function storedMedia(ref: string, opts: { allContainers?: boolean } = {}): { info: MediaInfo | null } | null {
  const rel = filesRel(ref);
  if (rel === null) return null;
  if (tenant() && !ownsRef(ref, rel)) return null;
  let abs: string;
  let st: fs.Stats;
  try {
    abs = absolutePath(rel);
    st = fs.statSync(/*turbopackIgnore: true*/ abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  if (tenant() && st.size > accountInputLimit(contentTypeFor(rel)).bytes) return { info: null };
  const cache = (globalThis.__fuobeStoredFacts ??= new Map());
  const key = `${rel}:${st.size}:${st.mtimeMs}${opts.allContainers ? ":all" : ""}`;
  if (cache.has(key)) return { info: cache.get(key) ?? null };
  let info: MediaInfo | null = null;
  try {
    const fd = fs.openSync(/*turbopackIgnore: true*/ abs, "r");
    try {
      const read = (start: number, end: number) => {
        const buf = Buffer.alloc(Math.max(0, end - start));
        return buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, start));
      };
      info = probeMediaRangesSync(read, st.size, { headBytes: STORED_HEAD_BYTES, maxMoov: tenant() ? TENANT_MOOV_BYTES : OWNER_MOOV_BYTES });
      if (!info && opts.allContainers) {
        try {
          info = otherHeaderInfo(read(0, Math.min(st.size, STORED_HEAD_BYTES)));
        } catch {
          info = null;
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  if (cache.size >= STORED_FACTS_KEPT) cache.delete(cache.keys().next().value!);
  cache.set(key, info);
  return { info };
}

export function toDataUri(data: Buffer, contentType: string): string {
  return `data:${contentType};base64,${data.toString("base64")}`;
}
