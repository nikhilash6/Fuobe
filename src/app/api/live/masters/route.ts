import { connection } from "next/server";
import { imageSize } from "@/lib/image-size";
import { pictureExt } from "@/lib/live/names";
import { MAX_MASTER_SIDE } from "@/lib/live/sizes";
import { ACCOUNT_MESSAGES, accountTotalBytes, accountUsage, diskHasRoom, filesFullMessage } from "@/server/account-files";
import { gateAsProxy, readBodyWithin } from "@/server/direct-gate";
import { liveWho } from "@/server/live/access";
import { enter, hit, unhit } from "@/server/rate";
import { saveFile } from "@/server/storage";
import { limitWords } from "@/lib/limit-words";

/** A master is a PNG of at most 4096 px a side: this holds the largest with room to spare. */
const MAX_BYTES = 80 * 2 ** 20;
/** An account's kept masters per hour. */
const ACCOUNT_MASTERS_PER_HOUR = 120;

/**
 * A kept step's master from a tab that renders on its own computer ("Use the ComfyUI on this computer"): the PNG body
 * as the tab received it from ComfyUI. Stored as the owner's file, or as the account's own within its limits. Answers
 * { id, url }. The proxy's matcher leaves this route out (a large body), so its rules run here first.
 */
export async function POST(request: Request) {
  await connection();
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const who = liveWho(request, { server: false });
  if (who instanceof Response) return who;
  const refuse = (status: number, error: string, code?: string, headers: Record<string, string> = {}) =>
    Response.json({ error, ...(code && { code }) }, { status, headers: { "Cache-Control": "no-store", ...headers } });
  const reading = who.kind === "account" ? enter(`live-master-now:${who.account.id}`, 2) : () => {};
  if (!reading) return refuse(429, "One master at a time. Try again in a moment.", undefined, { "Retry-After": "2" });
  let body: Buffer | "too-big" | null;
  try {
    body = await readBodyWithin(request, MAX_BYTES);
  } finally {
    reading();
  }
  if (body === "too-big") return refuse(413, "That master is too large");
  if (!body || pictureExt(body) !== "png") return refuse(415, "A master is a PNG picture");
  const size = imageSize(body);
  if (!size || Math.max(size.width, size.height) > MAX_MASTER_SIDE) return refuse(413, `Masters up to ${MAX_MASTER_SIDE} px on the long side`);
  if (who.kind === "account") {
    if (!diskHasRoom()) return refuse(507, ACCOUNT_MESSAGES.diskLow, "space");
    if (accountUsage(who.account.id).total + body.length > accountTotalBytes(who.account.id)) return refuse(507, filesFullMessage(who.account.id), "space");
    const rate = hit(`live-masters:${who.account.id}`, ACCOUNT_MASTERS_PER_HOUR, 60 * 60_000);
    if (!rate.ok) return refuse(429, limitWords("steps", rate.retryAfterS), "rate", { "Retry-After": String(rate.retryAfterS) });
    try {
      const a = saveFile({ data: body, contentType: "image/png", name: "live-edit.png", source: "derived", accountId: who.account.id });
      return Response.json({ id: a.id, url: a.url }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      unhit(`live-masters:${who.account.id}`);
      throw e;
    }
  }
  const a = saveFile({ data: body, contentType: "image/png", name: "live-edit.png", source: "derived" });
  return Response.json({ id: a.id, url: a.url }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
