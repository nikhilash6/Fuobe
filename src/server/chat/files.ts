import "server-only";
import fs from "node:fs";
import path from "node:path";
import { localHead, readRef, saveFile } from "../storage";
import { runAsTenant } from "../tenant";

/**
 * Pictures in Fuobe Chat: one sent with a message ("Rate my look") and a character's portrait. Each is one of the
 * person's own stored files (an /api/files/ URL), read as them, so nobody points a chat at another account's file.
 */

const FILE_REF = /^\/api\/files\/[\w./-]{1,300}$/;
const PICTURE = /^image\/(png|jpeg|webp|gif)$/;

const asWho = <T,>(who: string, fn: () => T): T => (who === "owner" ? fn() : runAsTenant({ kind: "account", id: who }, fn));

/** The ref, when it is a picture this person owns; else null. */
export function ownPicture(who: string, ref: unknown): string | null {
  if (typeof ref !== "string" || !FILE_REF.test(ref) || ref.includes("..")) return null;
  const head = asWho(who, () => localHead(ref, 64));
  if (!head) return null;
  const png = head[0] === 0x89 && head[1] === 0x50;
  const jpeg = head[0] === 0xff && head[1] === 0xd8;
  const webp = head.subarray(8, 12).toString("latin1") === "WEBP";
  const gif = head.subarray(0, 3).toString("latin1") === "GIF";
  return png || jpeg || webp || gif ? ref : null;
}

/** The bytes of one of their pictures, or null. */
export async function readPicture(who: string, ref: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (!ownPicture(who, ref)) return null;
  try {
    const f = await asWho(who, () => readRef(ref));
    return PICTURE.test(f.contentType) ? { data: f.data, contentType: f.contentType } : null;
  } catch {
    return null;
  }
}

/** A built-in character's portrait: a public file the site ships (src/lib/chat/catalog.ts). */
const BUILT_IN_PORTRAIT = /^\/previews\/chat\/([a-z0-9-]{1,60})\.jpg(?:\?v=[0-9a-f]{8})?$/;

/** A picture read for anyone (a shared chat's portrait): no account check. Only for refs a share row holds. */
export async function readSharedPicture(ref: string): Promise<{ data: Buffer; contentType: string } | null> {
  const builtIn = BUILT_IN_PORTRAIT.exec(ref);
  if (builtIn) {
    try {
      return { data: await fs.promises.readFile(path.join(process.cwd(), "public", "previews", "chat", `${builtIn[1]}.jpg`)), contentType: "image/jpeg" };
    } catch {
      return null;
    }
  }
  if (!FILE_REF.test(ref) || ref.includes("..")) return null;
  try {
    const f = await readRef(ref);
    return PICTURE.test(f.contentType) ? { data: f.data, contentType: f.contentType } : null;
  } catch {
    return null;
  }
}

/** A copy of a shared portrait as this person's own file (making a character from a shared chat). */
export async function copyPicture(who: string, ref: string): Promise<string | null> {
  const f = await readSharedPicture(ref);
  if (!f) return null;
  try {
    return saveFile({ data: f.data, contentType: f.contentType, name: "portrait", source: "upload", ...(who !== "owner" && { accountId: who }) }).url;
  } catch {
    return null;
  }
}
