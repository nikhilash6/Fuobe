import { connection } from "next/server";
import { eventFrame, imageFrame, LIVE_STREAM_TYPE, type LiveEvent } from "@/lib/live/frames";
import { slotBindings, type LiveGraphParams } from "@/lib/live/graph";
import { LIVE_INPUT, pictureExt, pngSize } from "@/lib/live/names";
import { isAspect, isKeepRes, isLiveSize, editSize, MAX_MASTER_SIDE } from "@/lib/live/sizes";
import { DEFAULT_METHOD, METHODS, type Method } from "@/lib/live/steps";
import { MAX_LIVE_TEXT, normalize, renderKey } from "@/lib/live/text";
import { ACCOUNT_MESSAGES, accountTotalBytes, accountUsage, diskHasRoom, filesFullMessage } from "@/server/account-files";
import { asWho, liveWho } from "@/server/live/access";
import { LiveRenderError } from "@/server/live/comfy-live";
import { sessionOf, stage, submit, type Rendered } from "@/server/live/sessions";
import { enter, hit } from "@/server/rate";
import { deleteAsset, readRef, saveFile } from "@/server/storage";

const SLOTS = new Set(["live", "settle", "keep", "warm"]);

interface Body {
  sessionId?: unknown;
  seq?: unknown;
  slot?: unknown;
  urgent?: unknown;
  text?: unknown;
  seed?: unknown;
  size?: unknown;
  keepRes?: unknown;
  base?: unknown;
  refs?: unknown;
  mask?: unknown;
  aspect?: unknown;
  method?: unknown;
  fromSettled?: unknown;
}

const isName = (v: unknown): v is string => typeof v === "string" && LIVE_INPUT.test(v);

/**
 * One live render, answered as a framed stream (src/lib/live/frames.ts): queued, started, progress, then the picture
 * (or dropped / error). Stale renders end when the tab aborts the request (deleted from ComfyUI's queue while waiting,
 * interrupted while running); /api/live/cancel does the same for a request whose abort didn't arrive. A keep stores
 * the picture as a full-size PNG master (the settled render on screen, when it is still held) and stages it as the
 * next base.
 */
export async function POST(request: Request) {
  await connection();
  const who = liveWho(request, { server: true });
  if (who instanceof Response) return who;
  const b = ((await request.json().catch(() => null)) ?? {}) as Body;
  const s = sessionOf(who.principal, b.sessionId);
  if (!s) return Response.json({ error: "This live session ended. Reload the page.", code: "session" }, { status: 410 });
  const seq = Number(b.seq);
  const slot = String(b.slot);
  if (!Number.isSafeInteger(seq) || seq < 0 || !SLOTS.has(slot)) return Response.json({ error: "Bad render" }, { status: 400 });
  const live = hit(`live-render:${s.id}`, 12, 1000);
  const all = hit(`live-render:${who.principal}`, 40, 1000);
  if (!live.ok || !all.ok) return Response.json({ error: "Too many renders" }, { status: 429, headers: { "Retry-After": "1" } });

  // What to render: every value checked against the session and the size tables.
  if (b.method !== undefined && !METHODS.includes(b.method as Method)) return Response.json({ error: "Bad method" }, { status: 400 });
  const method: Method = (b.method as Method | undefined) ?? DEFAULT_METHOD;
  const text = typeof b.text === "string" ? b.text : "";
  const prompt = normalize(text.slice(0, MAX_LIVE_TEXT * 2));
  const seed = Number(b.seed);
  if (!Number.isSafeInteger(seed) || seed < 0) return Response.json({ error: "Bad seed" }, { status: 400 });
  const base = b.base === undefined || b.base === null ? undefined : b.base;
  if (base !== undefined && (!isName(base) || !s.staged.has(base))) return Response.json({ error: "That picture isn't in this session. Add it again.", code: "missing-input" }, { status: 409 });
  const refs = Array.isArray(b.refs) ? b.refs.slice(0, 3) : [];
  if (!refs.every((r) => isName(r) && s.staged.has(r))) return Response.json({ error: "A reference isn't in this session", code: "missing-input" }, { status: 409 });
  const mask = b.mask === undefined || b.mask === null ? undefined : b.mask;
  if (mask !== undefined && (!isName(mask) || !s.staged.has(mask))) return Response.json({ error: "The painted region isn't in this session", code: "missing-input" }, { status: 409 });
  if (!base && slot !== "warm" && !prompt) return Response.json({ error: "Type what to make" }, { status: 400 });
  const size = Number(b.size);
  const keepRes = Number(b.keepRes);
  if (!isLiveSize(size) || !isKeepRes(keepRes)) return Response.json({ error: "Bad size" }, { status: 400 });
  const aspect = isAspect(b.aspect) ? b.aspect : "1:1";
  const baseInfo = base ? s.staged.get(base) : undefined;
  const liveLong = baseInfo?.w ? Math.max(...editSize(size, baseInfo.w, baseInfo.h)) : size;
  const bind = slotBindings(slot as "live", { liveSize: size, keepRes, hasMask: !!mask, to: s.gpu ? "temp" : "socket", liveLongSide: liveLong });
  const params: LiveGraphParams = {
    prompt: slot === "warm" ? "warm-up" : prompt,
    seed: slot === "warm" ? 0 : seed,
    ...bind,
    ...(base && { base }),
    ...(refs.length && { refs: refs as string[] }),
    ...(mask && { mask }),
    ...(!base && { aspect }),
  };
  const quality = slot === "settle" || slot === "keep" ? "keep" : "live";
  const key = renderKey({ base: base ?? "", refs: refs as string[], mask, text: prompt, seed, size: params.res, aspect, method, quality });
  // Keep after a settle of the same text, seed and size: the settled picture on screen is stored as it is (no new render).
  const fromSettled = slot === "keep" && b.fromSettled !== false ? key : undefined;

  const leave = enter(`live-render-now:${s.id}`, 3);
  if (!leave) return Response.json({ error: "Too many renders at once" }, { status: 429, headers: { "Retry-After": "1" } });
  let closed = false;
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const send = (u: Uint8Array) => {
    if (closed) return;
    try {
      ctl.enqueue(u);
    } catch {
      closed = true;
    }
  };
  const end = () => {
    if (closed) return;
    closed = true;
    try {
      ctl.close();
    } catch {}
  };
  const onEvent = (e: LiveEvent) => send(eventFrame(e));
  const stop = () => {
    // A stale request: taken off (keeps are never cancelled by a lost connection).
    if (slot !== "keep") s.scheduler.cancel((j) => j.seq === seq);
  };
  request.signal.addEventListener("abort", stop, { once: true });

  const work = async () => {
    try {
      const out = await submit(s, { seq, slot: slot as "live", key, urgent: b.urgent === true, payload: { params, fromSettled, onEvent } });
      if (!out.ok) {
        if ("dropped" in out) onEvent({ type: "dropped", why: out.dropped });
        else onEvent({ type: "error", message: out.error });
        return;
      }
      const pic: Rendered = out.result;
      let extra: { masterId?: string; url?: string; name?: string } = {};
      if (slot === "keep") {
        extra = await keepMaster(pic);
        if ("error" in extra) return;
      }
      send(imageFrame({ seq, slot, key, w: pic.w, h: pic.h, type: pic.type, ms: pic.ms, sha256: pic.sha256, ...extra }, pic.data));
    } catch (e) {
      onEvent({ type: "error", message: e instanceof LiveRenderError ? e.message : "The render failed", ...(e instanceof LiveRenderError && { code: e.code }) });
    } finally {
      request.signal.removeEventListener("abort", stop);
      leave();
      end();
    }
  };

  /** Store a kept picture as the step's master (the owner's file, or the account's own) and stage it as the next base. */
  const keepMaster = async (pic: Rendered): Promise<{ masterId?: string; url?: string; name?: string } & { error?: true }> => {
    // Checked by its bytes, not by what ComfyUI said it is.
    const size = pictureExt(pic.data) === "png" ? pngSize(pic.data) : null;
    if (pic.type !== "image/png" || !size) {
      onEvent({ type: "error", message: "A kept picture must be a PNG master" });
      return { error: true };
    }
    if (Math.max(size.w, size.h) > MAX_MASTER_SIDE) {
      onEvent({ type: "error", message: `Kept pictures are at most ${MAX_MASTER_SIDE} px on the long side` });
      return { error: true };
    }
    const data = Buffer.from(pic.data);
    if (who.kind === "account") {
      if (!diskHasRoom()) {
        onEvent({ type: "error", message: ACCOUNT_MESSAGES.diskLow, code: "space" });
        return { error: true };
      }
      if (accountUsage(who.account.id).total + data.length > accountTotalBytes(who.account.id)) {
        onEvent({ type: "error", message: filesFullMessage(who.account.id), code: "space" });
        return { error: true };
      }
    }
    const asset = saveFile({ data, contentType: "image/png", name: `live-edit-${seq}.png`, source: "derived", ...(who.kind === "account" && { accountId: who.account.id }) });
    try {
      const st = await stage(s, pic.data, () => asWho(who, () => readRef(asset.url)).then((r) => new Uint8Array(r.data)));
      return { masterId: asset.id, url: asset.url, name: st.name };
    } catch (e) {
      // Not staged, so not kept: the file goes too (it would count against the account's space for nothing).
      deleteAsset(asset.id);
      throw e;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
      void work();
    },
    cancel() {
      closed = true;
      stop();
    },
  });
  return new Response(stream, { headers: { "Content-Type": LIVE_STREAM_TYPE, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Live-Key": encodeURIComponent(key) } });
}
