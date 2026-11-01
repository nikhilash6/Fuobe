import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

/**
 * Secrets sealed at rest: an account's own fal.ai key or Replicate token (src/server/account-keys.ts). AES-256-GCM under a
 * server key in data/secrets.key: 32 random bytes made the first time something is sealed, never derived from the
 * sign-in secret (a new password or "Sign everyone out" leaves sealed values readable). Each value is bound to its
 * context (the account and the provider), so a sealed value copied to another account or provider doesn't open.
 *
 * Fails closed: a key file that can't be read or isn't a key seals nothing and opens nothing, and is never written
 * over. Back it up with auth.json: without it, the saved keys must be added again.
 */

const VERSION = "v1";

export class SecretBoxError extends Error {}

/** What an account's key is sealed for: that account and that provider. */
export const accountKeyContext = (accountId: string, provider: string) => `fuobe:account-key:v1:${accountId}:${provider}`;

declare global {
  /** The server key as last read, by the file's path and modification time (dev reloads share it). */
  var __fuobeSecretKey: { file: string; mtimeMs: number; key: Buffer } | undefined;
  var __fuobeSecretKeyWarned: number | undefined;
}

const keyFile = () => path.join(DATA_DIR, "secrets.key");

function warnBroken(file: string, why: string): void {
  if (Date.now() - (globalThis.__fuobeSecretKeyWarned ?? 0) < 60 * 60_000) return;
  globalThis.__fuobeSecretKeyWarned = Date.now();
  console.warn(`[fuobe] ${file} isn't a usable key (${why}): accounts' saved keys can't be opened or saved until it is restored.`);
}

/** The server key: null when there is none yet, or the file is broken (warned). */
function readKey(): Buffer | null {
  const file = keyFile();
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") warnBroken(file, (e as NodeJS.ErrnoException).code ?? "can't be read");
    return null;
  }
  const cached = globalThis.__fuobeSecretKey;
  if (cached?.file === file && cached.mtimeMs === mtimeMs) return cached.key;
  let hex: string;
  try {
    hex = fs.readFileSync(file, "utf8").trim();
  } catch (e) {
    warnBroken(file, (e as NodeJS.ErrnoException).code ?? "can't be read");
    return null;
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    warnBroken(file, "not 64 hex characters");
    return null;
  }
  const key = Buffer.from(hex, "hex");
  globalThis.__fuobeSecretKey = { file, mtimeMs, key };
  return key;
}

/** The server key, made once when there is no file yet. Throws when the file is there but broken. */
function keyForSealing(): Buffer {
  const key = readKey();
  if (key) return key;
  const file = keyFile();
  if (fs.existsSync(file)) throw new SecretBoxError("Keys can't be saved on this studio right now. Try again later.");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    // "wx": only when no other process made it first; then that one is read.
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw new SecretBoxError("Keys can't be saved on this studio right now. Try again later.");
  }
  const made = readKey();
  if (!made) throw new SecretBoxError("Keys can't be saved on this studio right now. Try again later.");
  return made;
}

/** Seal a value for a context: "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function seal(plain: string, context: string): string {
  const key = keyForSealing();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** The value sealed for this context, or null: another context, a changed value, no server key or a broken one. */
export function open(sealed: string, context: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const key = readKey();
  if (!key) return null;
  try {
    const [, iv, tag, ct] = parts.map((p, i) => (i ? Buffer.from(p, "base64url") : Buffer.alloc(0)));
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
