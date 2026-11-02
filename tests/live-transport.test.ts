import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerTransport, type RenderReq } from "@/components/live/live-transport";
import { imageFrame } from "@/lib/live/frames";

/*
 * The server transport asks again when the server says "too many renders" (a cold GPU's first frames are slow and the
 * next ones queue up), and lets go of a render that is no longer wanted while it waits.
 */

const req: RenderReq = { seq: 1, slot: "live", text: "evening makeup", seed: 7, size: 512, keepRes: 1024, aspect: "1:1", method: "compose" };
const busy = () => new Response(JSON.stringify({ error: "Too many renders at once" }), { status: 429, headers: { "Retry-After": "0.01" } });
const picture = () => new Response(imageFrame({ seq: 1, slot: "live", key: "k", w: 2, h: 2, type: "image/webp", ms: 900, sha256: "ab" }, new Uint8Array([1, 2, 3])) as BodyInit, { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("the server transport", () => {
  it("asks again after 429 until the picture comes", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(picture());
    vi.stubGlobal("fetch", fetch);
    const r = await new ServerTransport().render(req, () => {});
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(r.ok && r.out.ms).toBe(900);
  });

  it("drops a render cancelled while it waits to ask again", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "1" } }));
    vi.stubGlobal("fetch", fetch);
    const t = new ServerTransport();
    const p = t.render(req, () => {});
    await new Promise((r) => setTimeout(r, 30));
    t.cancel(() => true);
    expect(await p).toEqual({ ok: false, dropped: "cancelled" });
    expect(fetch.mock.calls.filter((c) => String(c[0]).includes("/api/live/render"))).toHaveLength(1);
  });
});
