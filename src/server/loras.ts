import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cloudPath, civitaiVersion, gated, libraryEntry, localOnly, loraByFile, loraName, needsToken, type LoraEntry } from "@/lib/catalog/loras";
import type { LoraRef } from "@/lib/catalog/types";
import { DATA_DIR, db } from "./db";
import { getSetting } from "./settings";
import { tenant } from "./tenant";

/**
 * LoRA files for both engines. Nothing here is committed to the repo: files are fetched when a run needs them.
 * - Open engine: before a ComfyUI run, a LoRA its server lacks is downloaded into ComfyUI's loras folder
 *   (Settings → LoRA folder): Hugging Face files at their pinned commit, civitai files by their pinned version
 *   with the user's civitai key, checked against the SHA256 pinned in the library (else the one the source
 *   states), saved under the unique `file`. A file whose bytes can't be checked is not kept.
 * - Cloud engine: a civitai LoRA can't go to fal or Replicate as a URL (civitai answers 401 without the key,
 *   and the key never leaves this server), so it is mirrored once to the provider's storage, only when civitai
 *   confirms that day that the model's permissions still include "Rent" (no answer, no copy).
 * Every copy is recorded in `lora_mirrors` with the licence / permission snapshot it was made under.
 */

export class LoraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoraError";
  }
}

const CIVITAI_API = "https://civitai.com/api/v1";
/** fal and Replicate don't document how long an upload lives (unverified): mirrors are made again after this. */
const MIRROR_TTL_MS: Record<string, number> = { fal: 7 * 86_400_000, replicate: 86_400_000 };
/** Where Fuobe keeps a LoRA it downloaded only to mirror it (ComfyUI's folder is used when it has the file). */
export const LORA_CACHE_DIR = path.join(DATA_DIR, "loras");

export type MirrorTarget = "comfyui" | "fal" | "replicate";

export interface LoraCopy {
  file: string;
  target: MirrorTarget;
  sourceUrl: string;
  version: string | null;
  hostedUrl: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  /** The licence the copy was made under: the research's snapshot and, for civitai, the permissions read that day. */
  licence: Record<string, unknown> | null;
  createdAt: number;
}

interface Row {
  file: string;
  target: MirrorTarget;
  source_url: string;
  version: string | null;
  hosted_url: string | null;
  sha256: string | null;
  size_bytes: number | null;
  licence_json: string | null;
  created_at: number;
}

const toCopy = (r: Row): LoraCopy => ({
  file: r.file,
  target: r.target,
  sourceUrl: r.source_url,
  version: r.version,
  hostedUrl: r.hosted_url,
  sha256: r.sha256,
  sizeBytes: r.size_bytes,
  licence: r.licence_json ? (JSON.parse(r.licence_json) as Record<string, unknown>) : null,
  createdAt: r.created_at,
});

export function listLoraCopies(): LoraCopy[] {
  return (db().prepare("SELECT * FROM lora_mirrors ORDER BY created_at DESC").all() as Row[]).map(toCopy);
}

function getCopy(file: string, target: MirrorTarget): LoraCopy | null {
  const r = db().prepare("SELECT * FROM lora_mirrors WHERE file = ? AND target = ?").get(file, target) as Row | undefined;
  return r ? toCopy(r) : null;
}

function recordCopy(c: Omit<LoraCopy, "createdAt">): void {
  db()
    .prepare(
      `INSERT INTO lora_mirrors (file, target, source_url, version, hosted_url, sha256, size_bytes, licence_json, created_at)
       VALUES (@file, @target, @source_url, @version, @hosted_url, @sha256, @size_bytes, @licence_json, @created_at)
       ON CONFLICT(file, target) DO UPDATE SET source_url = excluded.source_url, version = excluded.version, hosted_url = excluded.hosted_url,
         sha256 = excluded.sha256, size_bytes = excluded.size_bytes, licence_json = excluded.licence_json, created_at = excluded.created_at`,
    )
    .run({
      file: c.file,
      target: c.target,
      source_url: c.sourceUrl,
      version: c.version,
      hosted_url: c.hostedUrl,
      sha256: c.sha256,
      size_bytes: c.sizeBytes,
      licence_json: c.licence ? JSON.stringify(c.licence) : null,
      created_at: Date.now(),
    });
}

// ---------------------------------------------------------------------------
// Sources

/** The civitai key, as set in Settings or CIVITAI_API_KEY. */
const civitaiKey = () => getSetting("civitaiKey");

/** A URL as it may be shown or stored: never with a token in it. */
export function redact(text: string, token = civitaiKey()): string {
  let out = text.replace(/([?&]token=)[^&\s"']+/gi, "$1•••");
  if (token) out = out.split(token).join("•••");
  return out;
}

const withToken = (url: string, token: string) => `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;

/** What civitai says about a pinned version: the file's size and SHA256, and the model it belongs to. */
async function civitaiVersionFacts(version: string): Promise<{ sha256?: string; sizeBytes?: number; modelId?: string }> {
  const token = civitaiKey();
  const res = await fetch(`${CIVITAI_API}/model-versions/${encodeURIComponent(version)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res?.ok) return {};
  const body = (await res.json().catch(() => ({}))) as { modelId?: number; files?: { name?: string; primary?: boolean; type?: string; sizeKB?: number; hashes?: { SHA256?: string } }[] };
  const files = body.files ?? [];
  const f = files.find((x) => x.primary) ?? files.find((x) => x.name?.endsWith(".safetensors")) ?? files[0];
  return {
    ...(f?.hashes?.SHA256 && { sha256: f.hashes.SHA256.toLowerCase() }),
    ...(f?.sizeKB && { sizeBytes: Math.round(f.sizeKB * 1024) }),
    ...(body.modelId && { modelId: String(body.modelId) }),
  };
}

/** The permissions a civitai model shows today (allowCommercialUse: Image, RentCivit, Rent, Sell…). */
export async function civitaiPermissions(modelId: string): Promise<string[] | null> {
  const res = await fetch(`${CIVITAI_API}/models/${encodeURIComponent(modelId)}`, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { allowCommercialUse?: string[] | string };
  const v = body.allowCommercialUse;
  return Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/).filter(Boolean) : [];
}

/** What Hugging Face says about a file before the download: its SHA256 (x-linked-etag), size and the commit it's at. */
async function hfFacts(url: string): Promise<{ sha256?: string; sizeBytes?: number; revision?: string }> {
  const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res) return {};
  const etag = res.headers.get("x-linked-etag")?.replace(/"/g, "");
  const size = Number(res.headers.get("x-linked-size"));
  const revision = res.headers.get("x-repo-commit") ?? undefined;
  return { ...(etag && /^[0-9a-f]{64}$/i.test(etag) && { sha256: etag.toLowerCase() }), ...(size > 0 && { sizeBytes: size }), ...(revision && { revision }) };
}

/** Where `file` goes inside `dir`: a plain relative path that stays inside it (trained LoRAs live in fuobe/). */
export function lorasPath(dir: string, file: string): string {
  const root = path.resolve(dir);
  const dest = path.resolve(root, file);
  if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes("..") || !dest.startsWith(root + path.sep) || !/\.safetensors$/i.test(file)) {
    throw new LoraError(`"${file}" isn't a LoRA file name Fuobe can save`);
  }
  return dest;
}

const mb = (n: number) => `${Math.max(1, Math.round(n / 1_048_576))} MB`;

export interface Downloaded {
  path: string;
  sha256: string;
  sizeBytes: number;
  sourceUrl: string;
  version: string | null;
}

/**
 * Download one LoRA into `dir` under its unique file name: a pinned civitai version with the user's key
 * (?token=, never logged or stored), or a public Hugging Face file. The bytes are checked against the
 * SHA256 the source states (civitai's version API, Hugging Face's x-linked-etag), else its size, and land
 * under the final name only when they match.
 */
export async function downloadLora(ref: LoraRef, dir: string, onProgress?: (message: string) => void): Promise<Downloaded> {
  const entry = libraryEntry(ref);
  const name = loraName(ref);
  const url = entry?.url ?? ref.url;
  if (!url) throw new LoraError(`${name} has no download address — put ${ref.file} in ComfyUI/models/loras`);
  if (entry?.download === "hf-gated") {
    throw new LoraError(`${name} is in a gated Hugging Face repo: accept its licence on ${entry.page}, then put ${ref.file} in ComfyUI/models/loras`);
  }
  const dest = lorasPath(dir, ref.file);
  let expect: { sha256?: string; sizeBytes?: number } = {};
  let version: string | null = null;
  let fetchUrl = url;
  // The bytes must match a hash: the one pinned in the library (read once, committed), else the one the source states.
  const unchecked = () => new LoraError(`Couldn't read what ${new URL(url).host} says ${name} is, so the download can't be checked and Fuobe won't fetch it. Try again in a moment`);
  if (needsToken(url)) {
    version = ref.version ?? entry?.version ?? civitaiVersion(url) ?? null;
    if (!version || civitaiVersion(url) !== version) throw new LoraError(`${name} isn't pinned to a civitai version, so Fuobe won't download it`);
    const token = civitaiKey();
    if (!token) throw new LoraError(`${name} downloads from civitai, which needs your free API key: add it in Settings → LoRAs (civitai.com/user/account)`);
    const facts = await civitaiVersionFacts(version);
    if (facts.modelId && entry?.civitaiModel && facts.modelId !== entry.civitaiModel) throw new LoraError(`civitai version ${version} belongs to another model than ${name}`);
    expect = entry?.sha256 ? { sha256: entry.sha256, sizeBytes: entry.sizeBytes } : facts;
    if (!expect.sha256) throw unchecked();
    fetchUrl = withToken(url, token);
  } else {
    const facts = await hfFacts(url);
    expect = entry?.sha256 ? { sha256: entry.sha256, sizeBytes: entry.sizeBytes } : facts;
    version = entry?.version ?? facts.revision ?? null;
    // A Hugging Face file always states its SHA256; other hosts (a trained LoRA on fal storage) state none.
    if (!expect.sha256 && /^https:\/\/huggingface\.co\//.test(url)) throw unchecked();
  }
  onProgress?.(`Downloading ${name}${expect.sizeBytes ? ` (${mb(expect.sizeBytes)})` : ""}`);
  let res: Response;
  try {
    res = await fetch(fetchUrl, { redirect: "follow", signal: AbortSignal.timeout(60 * 60_000) });
  } catch (e) {
    throw new LoraError(`Couldn't reach ${new URL(url).host} to download ${name} (${redact((e as Error).message)})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new LoraError(
      needsToken(url) ? `civitai refused the download of ${name} (${res.status}): check your civitai key in Settings → LoRAs` : `${new URL(url).host} refused the download of ${name} (${res.status})`,
    );
  }
  if (!res.ok || !res.body) throw new LoraError(`Downloading ${name} failed: ${new URL(url).host} answered ${res.status}`);
  const total = Number(res.headers.get("content-length")) || expect.sizeBytes || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  let shown = 0;
  const out = fs.createWriteStream(part);
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      bytes += chunk.length;
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
      const pct = total ? Math.floor((bytes / total) * 10) : 0;
      if (pct > shown) {
        shown = pct;
        onProgress?.(`Downloading ${name} · ${pct * 10}%`);
      }
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw new LoraError(`Downloading ${name} was cut off (${redact((e as Error).message)})`);
  }
  const sha256 = hash.digest("hex");
  const bad = expect.sha256 ? sha256 !== expect.sha256 : expect.sizeBytes ? Math.abs(bytes - expect.sizeBytes) > 1024 : false;
  if (bad || (total && Number(res.headers.get("content-length")) && bytes !== Number(res.headers.get("content-length")))) {
    fs.rmSync(part, { force: true });
    throw new LoraError(`The downloaded ${name} doesn't match what ${new URL(url).host} says it is, so it wasn't kept — try again`);
  }
  fs.renameSync(part, dest);
  return { path: dest, sha256, sizeBytes: bytes, sourceUrl: url, version };
}

const sha256File = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** One download per file at a time (two jobs needing the same LoRA wait for the same download). */
const inFlight = new Map<string, Promise<Downloaded>>();

function downloadOnce(ref: LoraRef, dir: string, onProgress?: (m: string) => void): Promise<Downloaded> {
  const key = `${path.resolve(dir)}::${ref.file}`;
  const cur = inFlight.get(key);
  if (cur) return cur;
  const p = downloadLora(ref, dir, onProgress).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * One copy per file and host at a time: a per-frame render (Fuobe Mixed Media: up to 240 frames with the same look LoRA)
 * starts many submits at once, and each would otherwise read the file, ask civitai and upload it again. The ones that
 * come after the first wait for its copy (or its error).
 */
const mirroring = new Map<string, Promise<LoraRef>>();

function mirrorOnce(l: LoraRef, target: "fal" | "replicate", copy: () => Promise<LoraRef>): Promise<LoraRef> {
  const key = `${target}::${l.file}`;
  const cur = mirroring.get(key);
  if (cur) return cur.then((done) => ({ ...l, hostedUrl: done.hostedUrl }));
  const p = copy().finally(() => mirroring.delete(key));
  mirroring.set(key, p);
  return p;
}

/** The licence a copy is made under: the research's snapshot (and the permissions civitai shows today, when read). */
const licenceSnapshot = (ref: LoraRef, entry: LoraEntry | undefined, permissionsNow?: string[] | null) => {
  const l = ref.licence ?? entry?.licence;
  return l || permissionsNow ? { ...l, ...(permissionsNow && { permissionsNow, readOn: new Date().toISOString().slice(0, 10) }) } : null;
};

// ---------------------------------------------------------------------------
// Open engine

/**
 * Before a ComfyUI run: every LoRA it names must be in ComfyUI's loras folder. A missing one is downloaded
 * into Settings → LoRA folder (when that is ComfyUI's folder on this machine); otherwise the run stops
 * with what to do. `listed` is ComfyUI's own list (GET /models/loras), null when it can't be read.
 */
export async function ensureLorasOnComfy(loras: LoraRef[] | undefined, listed: string[] | null, onProgress?: (m: string) => void): Promise<void> {
  // Never for an account's run: this writes to the install's own LoRA folder (account-loras.ts checks its ComfyUI instead).
  if (tenant()) throw new Error("LoRAs are never downloaded for a run on someone's own GPU");
  if (!loras?.length) return;
  const dir = getSetting("comfyLorasDir");
  // A list ComfyUI couldn't give says nothing: without a folder to check, ComfyUI's own check has the last word.
  if (!listed && !dir) return;
  const have = new Set((listed ?? []).map((f) => f.replace(/\\/g, "/")));
  const onDisk = (file: string) => {
    try {
      return !!dir && fs.existsSync(lorasPath(dir, file));
    } catch {
      return false;
    }
  };
  const missing = loras.filter((l) => l.file && !have.has(l.file) && !onDisk(l.file));
  for (const l of missing) {
    const entry = libraryEntry(l);
    const name = loraName(l);
    // The user's own trained LoRA: Fuobe's copy goes into the folder (no download), else fal's copy is fetched.
    const own = l.own ? ownCopy(l.file) : null;
    if (own && dir) {
      const dest = lorasPath(dir, l.file);
      onProgress?.(`Copying ${name} into ComfyUI's LoRA folder`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(own, dest);
      recordCopy({ file: l.file, target: "comfyui", sourceUrl: `fuobe:${l.file}`, version: null, hostedUrl: null, sha256: sha256File(dest), sizeBytes: fs.statSync(dest).size, licence: null });
      continue;
    }
    if (l.own && !l.url && !own) throw new LoraError(`${name} isn't on this machine any more: train the element again, or put ${l.file} in ComfyUI/models/loras`);
    if (!l.url && !entry) throw new LoraError(`ComfyUI doesn't have ${l.file}: put it in ComfyUI/models/loras`);
    if (!dir) {
      const where = entry?.page ?? (l.url ? redact(l.url) : "");
      throw new LoraError(`ComfyUI doesn't have ${name} yet. Set the LoRA folder in Settings → LoRAs so Fuobe can download it, or put ${l.file} in ComfyUI/models/loras${where ? ` (from ${where})` : ""}`);
    }
    const got = await downloadOnce(l, dir, onProgress);
    recordCopy({ file: l.file, target: "comfyui", sourceUrl: got.sourceUrl, version: got.version, hostedUrl: null, sha256: got.sha256, sizeBytes: got.sizeBytes, licence: licenceSnapshot(l, entry) });
  }
}

// ---------------------------------------------------------------------------
// Cloud engine

/**
 * Before a fal or Replicate run: every LoRA gets a URL the provider can fetch. Public files go as they are;
 * a civitai file is mirrored once to the provider's storage (`upload`) and the mirror is reused while it lives.
 * The civitai permissions are read before each copy and recorded with it (information). Only while Settings →
 * Models & licences keeps LoRAs licensed for your GPU only on the GPU (the run's LoRAs are marked `keepOnGpu`)
 * do they decide: no "Rent", or no answer, and the file isn't copied.
 */
export async function prepareCloudLoras(
  loras: LoraRef[] | undefined,
  target: "fal" | "replicate",
  upload: (data: Buffer, name: string) => Promise<string>,
  onProgress?: (m: string) => void,
): Promise<LoraRef[] | undefined> {
  if (!loras?.length) return loras;
  const host = target === "fal" ? "fal.ai" : "Replicate";
  const out: LoraRef[] = [];
  for (const l of loras) {
    const entry = libraryEntry(l);
    const name = loraName(l);
    // An account's run on its own key: only LoRAs the provider fetches from a public address. Nothing is downloaded or
    // copied for it (that would use the studio's civitai key and its copies), so a civitai file or a trained one is
    // refused (withoutUnreachableCivitai leaves civitai files out first).
    if (tenant()) {
      const at = cloudPath(l);
      if (!at || localOnly(l)) throw new LoraError(`${name} can't be sent to ${host} with your key: it runs on your GPU`);
      out.push(l);
      continue;
    }
    // Only while the admin keeps GPU-only LoRAs on the GPU (fitLoras has left it out of a cloud run already).
    if (localOnly(l)) throw new LoraError(`${name} is licensed for your GPU only, and Settings → Models & licences keeps such LoRAs off the cloud`);
    if (l.own && !l.hostedUrl) {
      out.push(await mirrorOnce(l, target, () => sendOwnLora(l, target, upload, onProgress)));
      continue;
    }
    if (cloudPath(l)) {
      out.push(l);
      continue;
    }
    if (gated(l)) throw new LoraError(`${name} is in a gated Hugging Face repo, so it can't be sent to ${host}: it runs on your GPU once you've accepted its licence`);
    if (!l.url || !needsToken(l.url)) throw new LoraError(`${name} can't be sent to ${host}: it exists only as a file on your ComfyUI`);
    const cached = getCopy(l.file, target);
    if (cached?.hostedUrl && Date.now() - cached.createdAt < MIRROR_TTL_MS[target]) {
      out.push({ ...l, hostedUrl: cached.hostedUrl });
      continue;
    }
    const civitai = { ...l, url: l.url };
    out.push(await mirrorOnce(l, target, () => mirrorCivitai(civitai, entry, target, upload, onProgress)));
  }
  return out;
}

/** A civitai LoRA copied to the provider's storage (once: prepareCloudLoras runs it through mirrorOnce). */
async function mirrorCivitai(
  l: LoraRef & { url: string },
  entry: LoraEntry | undefined,
  target: "fal" | "replicate",
  upload: (data: Buffer, name: string) => Promise<string>,
  onProgress?: (m: string) => void,
): Promise<LoraRef> {
  const host = target === "fal" ? "fal.ai" : "Replicate";
  const name = loraName(l);
  // The hosting right is read again before a copy is made (civitai permissions can change) and recorded with the copy.
  // It decides only while the admin keeps GPU-only LoRAs on the GPU: then no answer, or no "Rent", means no copy.
  const version = l.version ?? entry?.version ?? civitaiVersion(l.url);
  const strict = !!l.keepOnGpu;
  const modelId = entry?.civitaiModel ?? (version ? (await civitaiVersionFacts(version)).modelId : undefined);
  const now = modelId ? await civitaiPermissions(modelId) : null;
  if (strict && !now) throw new LoraError(`Couldn't confirm on civitai that ${name} may run on a hosted service, so it isn't copied to ${host} (Settings → Models & licences keeps LoRAs licensed for your GPU only off the cloud). Try again in a moment, or run it on your GPU`);
  if (strict && !now!.includes("Rent")) {
    throw new LoraError(`${name}'s civitai licence no longer allows running it on a hosted service, and Settings → Models & licences keeps such LoRAs off the cloud, so it runs only on your GPU`);
  }
  // A copy already on this machine is used when its bytes are the pinned ones (a same-named file may be another LoRA).
  const local = [getSetting("comfyLorasDir"), LORA_CACHE_DIR]
    .filter(Boolean)
    .map((d) => {
      try {
        return lorasPath(d, l.file);
      } catch {
        return "";
      }
    })
    .find((p) => p && fs.existsSync(p) && (!entry?.sha256 || sha256File(p) === entry.sha256));
  let file = local;
  let facts: Pick<Downloaded, "sha256" | "sizeBytes" | "version"> | null = null;
  if (!file) {
    const got = await downloadOnce(l, LORA_CACHE_DIR, onProgress);
    file = got.path;
    facts = got;
  }
  onProgress?.(`Copying ${name} to ${host} (once)`);
  const data = fs.readFileSync(file);
  const hostedUrl = await upload(data, path.basename(l.file));
  recordCopy({
    file: l.file,
    target,
    sourceUrl: l.url,
    version: facts?.version ?? l.version ?? entry?.version ?? null,
    hostedUrl,
    sha256: facts?.sha256 ?? crypto.createHash("sha256").update(data).digest("hex"),
    sizeBytes: data.length,
    licence: { ...licenceSnapshot(l, entry, now), ...(hostingNote(now) && { hosting: hostingNote(now) }) },
  });
  return { ...l, hostedUrl };
}

// ---------------------------------------------------------------------------
// The user's own trained LoRAs (Fuobe Soul ID)

/** Where Fuobe keeps the LoRAs its trainings made (fuobe/<handle>-<id>.safetensors under it). */
export const TRAINED_DIR = LORA_CACHE_DIR;

/** Fuobe's own copy of a trained LoRA, when it has one. */
export function ownCopy(file: string): string | null {
  try {
    const p = lorasPath(TRAINED_DIR, file);
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Keep a trained LoRA in Fuobe's own folder: copied from a file on this machine (AI-Toolkit's output, ComfyUI's
 * folder) or downloaded from the trainer's URL (fal storage, which states no hash: the length must match).
 */
export async function keepTrainedLora(file: string, from: { path?: string; url?: string }): Promise<string> {
  const dest = lorasPath(TRAINED_DIR, file);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  if (from.path) {
    // Asynchronous: a LoRA of a few hundred MB doesn't hold up the server while it copies.
    if (path.resolve(from.path) !== dest) await fs.promises.copyFile(from.path, dest);
    return dest;
  }
  if (!from.url) throw new LoraError(`Nowhere to copy ${file} from`);
  return (await downloadLora({ file, url: from.url }, TRAINED_DIR)).path;
}

/** Record the URL a trainer left a LoRA at (fal's own storage), so cloud runs use it while it lives. */
export function recordTrainedMirror(file: string, target: "fal" | "replicate", url: string): void {
  const own = ownCopy(file);
  recordCopy({
    file,
    target,
    sourceUrl: url,
    version: null,
    hostedUrl: url,
    sha256: own ? sha256File(own) : null,
    sizeBytes: own ? fs.statSync(/*turbopackIgnore: true*/ own).size : null,
    licence: { own: true },
  });
}

/**
 * A trained LoRA on its way to fal or Replicate: the copy already there while it lives (fal's from the training, or
 * one Fuobe sent), else Fuobe's copy sent once (the user's own LoRA, trained on their photos: no licence stops it),
 * else the trainer's URL as a last try. A LoRA only ComfyUI has can't go.
 */
async function sendOwnLora(l: LoraRef, target: "fal" | "replicate", upload: (data: Buffer, name: string) => Promise<string>, onProgress?: (m: string) => void): Promise<LoraRef> {
  const name = loraName(l);
  const cached = getCopy(l.file, target);
  if (cached?.hostedUrl && Date.now() - cached.createdAt < MIRROR_TTL_MS[target]) return { ...l, hostedUrl: cached.hostedUrl };
  const comfyDir = getSetting("comfyLorasDir");
  const inComfy = (() => {
    if (!comfyDir) return null;
    try {
      const p = lorasPath(comfyDir, l.file);
      return fs.existsSync(p) ? p : null;
    } catch {
      return null;
    }
  })();
  const local = ownCopy(l.file) ?? inComfy;
  if (local) {
    onProgress?.(`Sending ${name} to ${target === "fal" ? "fal.ai" : "Replicate"} (once)`);
    const data = fs.readFileSync(/*turbopackIgnore: true*/ local);
    const hostedUrl = await upload(data, path.basename(l.file));
    recordCopy({ file: l.file, target, sourceUrl: `fuobe:${l.file}`, version: null, hostedUrl, sha256: crypto.createHash("sha256").update(data).digest("hex"), sizeBytes: data.length, licence: { own: true } });
    return { ...l, hostedUrl };
  }
  if (l.url) return { ...l, hostedUrl: l.url };
  throw new LoraError(`${name} exists only on your GPU's machine, so it can't run in the cloud: run it on your GPU, or train it in the cloud`);
}

/**
 * What a mirror records about the hosting right it was copied under (nothing when civitai lists "Rent"): civitai
 * didn't answer, so it is unknown, or civitai lists no "Rent" and the admin lets such LoRAs go to the cloud.
 */
function hostingNote(now: string[] | null): string | undefined {
  if (!now) return "copied without civitai's current permissions: civitai didn't answer, so its hosting right wasn't confirmed";
  if (!now.includes("Rent")) return "copied without civitai's “Rent” permission: Settings → Models & licences lets LoRAs licensed for your GPU only go to the cloud";
  return undefined;
}

/**
 * Download a library LoRA into the LoRA folder ahead of a run (Settings → LoRAs). Returns the copy recorded.
 */
export async function downloadToComfy(file: string): Promise<LoraCopy> {
  const entry = loraByFile(file);
  if (!entry) throw new LoraError("That LoRA isn't in Fuobe's library");
  const dir = getSetting("comfyLorasDir");
  if (!dir) throw new LoraError("Set the LoRA folder first (ComfyUI's models/loras on this machine)");
  const got = await downloadOnce(entry, dir);
  recordCopy({ file, target: "comfyui", sourceUrl: got.sourceUrl, version: got.version, hostedUrl: null, sha256: got.sha256, sizeBytes: got.sizeBytes, licence: licenceSnapshot(entry, entry) });
  return getCopy(file, "comfyui")!;
}

/**
 * Which library files are in the LoRA folder now (a file someone put there by hand counts too), and what is
 * wrong with the folder setting when it can't be read (not a folder, no permission).
 */
export function filesInLoraFolder(): { files: Set<string>; problem?: string } {
  const dir = getSetting("comfyLorasDir");
  const files = new Set<string>();
  if (!dir) return { files };
  if (!fs.existsSync(dir)) return { files, problem: `The LoRA folder ${dir} doesn't exist on this machine` };
  try {
    for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith(".safetensors")) continue;
      const rel = path.relative(dir, path.join(e.parentPath ?? dir, e.name)).split(path.sep).join("/");
      files.add(rel);
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { files, problem: code === "ENOTDIR" ? `The LoRA folder ${dir} is a file, not a folder` : `Fuobe can't read the LoRA folder ${dir} (${code ?? (e as Error).message})` };
  }
  return { files };
}

/**
 * Before a Fuobe Soul run, without a civitai key: the civitai LoRAs it can't get, so the run goes ahead without
 * them (the look's words still carry it) and says how to add them, instead of failing at the download. A LoRA is
 * still reachable when ComfyUI's LoRA folder already has it (open engine) or a live mirror exists (cloud). A LoRA
 * licensed for the GPU only counts on both engines, unless the admin keeps such LoRAs on the GPU: then a cloud run
 * never carries it (fitLoras leaves it out and says so).
 */
export function withoutUnreachableCivitai(loras: LoraRef[], target: MirrorTarget): { loras: LoraRef[]; notes: string[] } {
  // An account's run: the install's civitai key and LoRA folder say nothing about its ComfyUI (account-loras.ts checks that).
  // On its own fal.ai or Replicate key, a civitai file isn't copied for it (that needs the studio's civitai key): it's left out.
  if (tenant()) {
    const civitai = target === "comfyui" ? [] : loras.filter((l) => !l.hostedUrl && needsToken(l.url));
    if (!civitai.length) return { loras, notes: [] };
    const names = civitai.map(loraName);
    const list = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return {
      loras: loras.filter((l) => !civitai.includes(l)),
      notes: [`${list} ${names.length > 1 ? "download" : "downloads"} from civitai, so runs on your key leave ${names.length > 1 ? "them" : "it"} out`],
    };
  }
  const civitai = loras.filter((l) => !l.hostedUrl && needsToken(l.url) && (target === "comfyui" || !localOnly(l)));
  if (!civitai.length || civitaiKey()) return { loras, notes: [] };
  const folder = target === "comfyui" && getSetting("comfyLorasDir") ? filesInLoraFolder().files : null;
  const unreachable = civitai.filter((l) => {
    if (target === "comfyui") return !!folder && !folder.has(l.file);
    const cached = getCopy(l.file, target);
    return !(cached?.hostedUrl && Date.now() - cached.createdAt < MIRROR_TTL_MS[target]);
  });
  if (!unreachable.length) return { loras, notes: [] };
  const names = unreachable.map(loraName);
  const list = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return {
    loras: loras.filter((l) => !unreachable.includes(l)),
    notes: [`${list} ${names.length > 1 ? "download" : "downloads"} from civitai, which needs your free API key (Settings → LoRAs), so this run leaves ${names.length > 1 ? "them" : "it"} out`],
  };
}

/**
 * Before a look's run on your GPU (Fuobe Mixed Media) while Settings → LoRAs has no LoRA folder: Fuobe can't download a
 * LoRA for ComfyUI then, so one ComfyUI doesn't list is left out (and said) and the look runs on its words, instead of
 * failing when the run is handed over (ensureLorasOnComfy). `listed`: ComfyUI's LoRA files (null when it couldn't say:
 * nothing is left out, ComfyUI's own check has the last word).
 */
export function withoutMissingOnComfy(loras: LoraRef[], listed: string[] | null): { loras: LoraRef[]; notes: string[] } {
  // An account's run: account-loras.ts names what its ComfyUI lacks.
  if (tenant() || !loras.length || !listed || getSetting("comfyLorasDir")) return { loras, notes: [] };
  const have = new Set(listed.map((f) => f.replace(/\\/g, "/")));
  const missing = loras.filter((l) => l.file && !have.has(l.file));
  if (!missing.length) return { loras, notes: [] };
  const names = [...new Set(missing.map(loraName))];
  const list = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return {
    loras: loras.filter((l) => !missing.includes(l)),
    notes: [
      `ComfyUI doesn't have ${list} yet, and Fuobe downloads LoRAs for it only once Settings → LoRAs has its LoRA folder, so this run leaves ${names.length > 1 ? "them" : "it"} out (the look runs on its words)`,
    ],
  };
}

/** Test the civitai key (Settings → Save & test): civitai's /me answers 200 for a good key. */
export async function testCivitaiKey(): Promise<{ ok: boolean; detail: string }> {
  const token = civitaiKey();
  if (!token) return { ok: false, detail: "No key set" };
  let res: Response;
  try {
    res = await fetch(`${CIVITAI_API}/me`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    return { ok: false, detail: `Can't reach civitai (${redact((e as Error).message, token)})` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, detail: `Key rejected (${res.status})` };
  if (!res.ok) return { ok: false, detail: `Couldn't check the key: civitai answered ${res.status}. Try again in a moment` };
  const me = (await res.json().catch(() => ({}))) as { username?: string };
  return { ok: true, detail: me.username ? `Signed in as ${me.username}` : "Key accepted" };
}
