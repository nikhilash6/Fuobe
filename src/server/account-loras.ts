import "server-only";
import type { LoraRef, ModelRoute } from "@/lib/catalog/types";
import { missingFilesMessage, missingLoras, type MissingFiles } from "@/lib/missing-files";
import { comfyLoraFiles, ownGpu } from "./providers/comfyui";
import { tenantAccount } from "./tenant";

/**
 * The LoRAs an account's run adds (a preset's, a model's, the request's, a graph's own) must be on the account's own
 * ComfyUI: Fuobe checks its GET /models/loras before the run is queued and again when it is handed over, and says
 * what to download when one is missing. Nothing is ever downloaded onto the account's machine. The workflow's other
 * files (checkpoints, encoders…) are the pre-flight's to check; ComfyUI's own "not in list" answer is the last word.
 */

declare global {
  var __fuobeAccountLoras: Map<string, { at: number; files: string[] }> | undefined;
}

const TTL_MS = 60_000;
const cache = () => (globalThis.__fuobeAccountLoras ??= new Map());

/** The LoRA files on the account's ComfyUI (inside its run: onOwnGpu), cached a minute; null when it can't say. */
export async function accountLoraList(route?: ModelRoute): Promise<string[] | null> {
  const gpu = ownGpu();
  const where = gpu?.kind === "computer" ? "computer" : gpu?.url;
  if (!where) return null;
  const key = `${tenantAccount() ?? ""}|${where}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.files;
  const files = await comfyLoraFiles(route);
  if (!files || !Array.isArray(files)) return null;
  const clean = files.filter((f): f is string => typeof f === "string");
  cache().set(key, { at: Date.now(), files: clean });
  if (cache().size > 5000) cache().delete(cache().keys().next().value!);
  return clean;
}

/** Forget an account's list (its GPU address changed, or it was disconnected). */
export function clearAccountLoras(accountId: string): void {
  for (const k of cache().keys()) if (k.startsWith(`${accountId}|`)) cache().delete(k);
}

/** A run that needs files the account's ComfyUI doesn't have: `fix` lists them (409 comfy_missing_model). */
export class MissingFilesError extends Error {
  readonly status = 409;
  constructor(readonly fix: MissingFiles) {
    super(missingFilesMessage(fix));
  }
}

/**
 * The LoRAs in `needs` the account's ComfyUI lacks, or null (all there, nothing needed, or its list couldn't be read:
 * the run goes ahead and ComfyUI's own check has the last word).
 */
export async function checkAccountLoras(needs: LoraRef[], workflowId?: string, route?: ModelRoute): Promise<MissingFiles | null> {
  const wanted = needs.filter((l) => l?.file);
  if (!wanted.length) return null;
  const listed = await accountLoraList(route);
  if (!listed) return null;
  const items = missingLoras(wanted, listed);
  return items.length ? { code: "comfy_missing_model", ...(workflowId && { workflowId }), items } : null;
}
