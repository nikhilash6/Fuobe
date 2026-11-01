import "server-only";
import { getModel } from "@/lib/catalog";
import { CONNECT_GPU_HEADER, CONNECT_GPU_MESSAGE, GUEST_RUN_MESSAGE } from "@/lib/guest-access";
import { LIVE_MODEL_ID } from "@/lib/live/graph";
import { gpuLink, requestViewer, type Account } from "../auth";
import { offeredModel } from "../model-access";
import { computerScope, type OwnGpu } from "../providers/comfyui";
import { runAsTenant } from "../tenant";

/** Said when the owner turned live edit's model off. */
export const LIVE_OFF_MESSAGE = "Live edit is turned off in Models & licences.";
/** Said on the server path when ComfyUI runs on the person's own computer: the tab talks to it directly. */
export const LIVE_ON_COMPUTER = "ComfyUI runs on your computer: live edit talks to it from this tab.";

export type LiveWho = { kind: "owner"; principal: "owner" } | { kind: "account"; principal: `acct:${string}`; account: Account; gpu?: OwnGpu };

const no = (status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * Who may use live edit's routes, and on which GPU. The proxy has already refused guests and accounts without a GPU of
 * their own; this checks again, and adds the model's switch. `server`: a route that reaches ComfyUI from the server (an
 * account needs a linked GPU; the owner's ComfyUI must not be on the owner's computer).
 */
export function liveWho(request: Request, o: { server: boolean }): LiveWho | Response {
  const model = getModel(LIVE_MODEL_ID);
  if (!model || !offeredModel(model)) return no(403, LIVE_OFF_MESSAGE, { code: "off" });
  const v = requestViewer(request);
  if (v.kind === "guest") return no(401, GUEST_RUN_MESSAGE);
  if (v.kind === "owner") {
    if (o.server && computerScope()) return no(409, LIVE_ON_COMPUTER, { code: "computer" });
    return { kind: "owner", principal: "owner" };
  }
  const account = v.account;
  const link = gpuLink(account.gpu);
  if (o.server && !link) {
    return account.gpu?.mode === "computer" ? no(409, LIVE_ON_COMPUTER, { code: "computer" }) : no(403, CONNECT_GPU_MESSAGE, { code: "connect-gpu" }, { [CONNECT_GPU_HEADER]: "1" });
  }
  if (!account.gpu) return no(403, CONNECT_GPU_MESSAGE, { code: "connect-gpu" }, { [CONNECT_GPU_HEADER]: "1" });
  return { kind: "account", principal: `acct:${account.id}`, account, ...(link && { gpu: { url: link.url, token: link.token } }) };
}

/** Run as the asker: an account's work reads only its own files. */
export const asWho = <T,>(who: LiveWho, fn: () => T): T => (who.kind === "account" ? runAsTenant({ kind: "account", id: who.account.id }, fn) : fn());
