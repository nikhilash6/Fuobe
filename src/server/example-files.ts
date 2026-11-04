import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EXAMPLE_MEDIA } from "@/lib/examples/media.generated";

/**
 * Fuobe's published example files: the pictures, clips and recordings an example on a page puts into the composer. A run
 * may read them by their exact public path, the same for everyone (a guest's price check, an account's run, the owner's),
 * with no upload and no space used. Nothing else outside the visitor's own files: the list is the manifest of published
 * inputs (src/lib/examples/media.generated.ts), never a link, never a path that steps out of its folder. A published
 * example file is never removed or renamed, so a run that named one can be reused later.
 */

/**
 * The folders under public/ an example input may sit in: Fuobe's own copies, which no other script rewrites (a preset's
 * before/after stills under /previews/ are regenerated in place, so an example copies them here first).
 */
const FOLDERS = ["/examples/", "/samples/"];

const PUBLIC_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "public");

/** The manifest path a ref names, or null: an exact listed input path, with no query or fragment, decoded once. */
export function exampleRel(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith("/") || ref.length > 300) return null;
  if (/[?#\\\0]/.test(ref)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(ref);
  } catch {
    return null;
  }
  // The decoded path must be the path as written: an encoded dot, slash or anything else is no listed file.
  if (decoded !== ref) return null;
  if (!FOLDERS.some((f) => ref.startsWith(f))) return null;
  if (ref.split("/").some((p, i) => (i > 0 && !p) || p === "." || p === "..")) return null;
  const entry = Object.hasOwn(EXAMPLE_MEDIA, ref) ? EXAMPLE_MEDIA[ref] : undefined;
  return entry && entry.role === "in" ? ref : null;
}

/** Whether a run may read this ref as one of Fuobe's published example inputs. */
export function isExampleRef(ref: unknown): boolean {
  return exampleRel(ref) !== null;
}

/** Files whose bytes matched their listed hash, by path, with the size and time they had then (hashed once, not per read). */
const checked = new Map<string, string>();

/** The file on disk, checked to be under public/ and to have the size and content hash the manifest lists. Throws for anything else. */
function exampleFile(ref: string): { abs: string; type: string; bytes: number } {
  const rel = exampleRel(ref);
  if (!rel) throw new Error("Not an example file");
  const abs = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) throw new Error("Not an example file");
  const entry = EXAMPLE_MEDIA[rel];
  const st = fs.statSync(/*turbopackIgnore: true*/ abs);
  if (!st.isFile() || st.size !== entry.bytes) throw new Error("That example file has changed");
  // Another file of the same size is still another file: its bytes must hash to the listed sha256.
  const stamp = `${st.size}:${st.mtimeMs}`;
  if (checked.get(abs) !== stamp) {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(/*turbopackIgnore: true*/ abs)).digest("hex");
    if (sha !== entry.sha256) throw new Error("That example file has changed");
    checked.set(abs, stamp);
  }
  return { abs, type: entry.type, bytes: entry.bytes };
}

/** An example input's bytes, its type and its name, as readRef returns a stored file. */
export async function readExampleFile(ref: string): Promise<{ data: Buffer; contentType: string; name: string }> {
  const f = exampleFile(ref);
  return { data: await fs.promises.readFile(/*turbopackIgnore: true*/ f.abs), contentType: f.type, name: path.basename(f.abs) };
}

/** An example input's first bytes (a price check reads a picture's size or a clip's header), or null. */
export function exampleHead(ref: string, maxBytes = 512 * 1024): Buffer | null {
  try {
    const f = exampleFile(ref);
    const fd = fs.openSync(/*turbopackIgnore: true*/ f.abs, "r");
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, f.bytes));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return buf;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** An example input's path on disk and its size (storedMedia reads a clip's header from it), or null. */
export function exampleStat(ref: string): { abs: string; type: string; bytes: number; mtimeMs: number } | null {
  try {
    const f = exampleFile(ref);
    return { ...f, mtimeMs: fs.statSync(/*turbopackIgnore: true*/ f.abs).mtimeMs };
  } catch {
    return null;
  }
}
