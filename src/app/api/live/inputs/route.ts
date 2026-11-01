import { connection } from "next/server";
import { pictureExt } from "@/lib/live/names";
import { MAX_MASTER_SIDE } from "@/lib/live/sizes";
import { imageSize } from "@/lib/image-size";
import { asWho, liveWho } from "@/server/live/access";
import { LiveRenderError } from "@/server/live/comfy-live";
import { sessionOf, stage } from "@/server/live/sessions";
import { hit } from "@/server/rate";
import { readRef, RefError } from "@/server/storage";

/** The largest mask a tab sends (a painted region, PNG). */
const MASK_BYTES = 8 * 2 ** 20;
const FILE_REF = /^\/api\/files\/[\w./%-]{1,300}$/;

/**
 * Put a picture into ComfyUI's input folder for this session, under its content name: a Fuobe file (the picture
 * being edited, a reference, or a kept master), JSON { sessionId, file }; or a painted mask, sent as a PNG body with
 * the x-live-session header. Answers { name, width, height, sha256 }. Nothing is uploaded twice.
 */
export async function POST(request: Request) {
  await connection();
  const who = liveWho(request, { server: true });
  if (who instanceof Response) return who;
  const rate = hit(`live-inputs:${who.principal}`, 30, 60_000);
  if (!rate.ok) return Response.json({ error: "Too many pictures at once. Try again in a moment." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS) } });
  const type = request.headers.get("content-type") ?? "";
  let sessionId: unknown;
  let data: Uint8Array;
  let reread: (() => Promise<Uint8Array>) | undefined;
  if (type.startsWith("image/png")) {
    sessionId = request.headers.get("x-live-session");
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.length > MASK_BYTES) return Response.json({ error: "That mask is too large" }, { status: 413 });
    data = buf;
  } else {
    const body = (await request.json().catch(() => null)) as { sessionId?: unknown; file?: unknown } | null;
    sessionId = body?.sessionId;
    const file = body?.file;
    if (typeof file !== "string" || !FILE_REF.test(file)) return Response.json({ error: "Send a picture from your files" }, { status: 400 });
    try {
      const read = () => asWho(who, () => readRef(file)).then((r) => new Uint8Array(r.data));
      data = await read();
      reread = read;
    } catch (e) {
      if (e instanceof RefError) return Response.json({ error: e.message }, { status: e.status });
      return Response.json({ error: "That picture can't be read" }, { status: 404 });
    }
  }
  const s = sessionOf(who.principal, sessionId);
  if (!s) return Response.json({ error: "This live session ended. Reload the page.", code: "session" }, { status: 410 });
  if (!pictureExt(data)) return Response.json({ error: "Only PNG, JPEG or WebP pictures" }, { status: 415 });
  const size = imageSize(data);
  if (!size || Math.max(size.width, size.height) > MAX_MASTER_SIDE) return Response.json({ error: `Pictures up to ${MAX_MASTER_SIDE} px on the long side` }, { status: 413 });
  try {
    const st = await stage(s, data, reread);
    return Response.json({ name: st.name, width: size.width, height: size.height, sha256: st.sha256 }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof LiveRenderError ? e.message : "Couldn't send the picture to ComfyUI";
    return Response.json({ error: msg, code: e instanceof LiveRenderError ? e.code : "failed" }, { status: 502 });
  }
}
