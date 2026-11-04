import { connection } from "next/server";
import { liveWho } from "@/server/live/access";
import { onLiveStatus, type LiveStatus } from "@/server/live/comfy-live";
import { sessionOf } from "@/server/live/sessions";
import { onShutdown } from "@/server/shutdown";

/**
 * Live edit's status for this tab (server-sent events): `status` (online, who runs on ComfyUI, the queue, whether
 * another job ran since our last render) whenever it changes, and a ping every 15 s. On a linked GPU there is no socket:
 * one status, then pings.
 */
export async function GET(request: Request) {
  await connection();
  const who = liveWho(request, { server: true });
  if (who instanceof Response) return who;
  const s = sessionOf(who.principal, new URL(request.url).searchParams.get("session"));
  if (!s) return Response.json({ error: "This live session ended", code: "session" }, { status: 410 });
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const send = (text: string) => {
        try {
          c.enqueue(enc.encode(text));
        } catch {
          stop();
        }
      };
      const status = (st: LiveStatus) => send(`event: status\ndata: ${JSON.stringify(st)}\n\n`);
      const off = s.gpu ? (status({ online: true, running: null, queue: 0, otherRan: false }), () => {}) : onLiveStatus(status);
      const ping = setInterval(() => send(": ping\n\n"), 15_000);
      let unhook = () => {};
      stop = () => {
        unhook();
        clearInterval(ping);
        off();
        try {
          c.close();
        } catch {}
      };
      request.signal.addEventListener("abort", () => stop(), { once: true });
      // Ends when the server starts stopping, so an update's old instance stops at once (src/server/shutdown.ts).
      unhook = onShutdown(() => stop());
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
