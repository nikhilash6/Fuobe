import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discardBody, fetchPublic } from "@/server/remote-fetch";

// An error answer the caller lets go of unread (discardBody): its body is often already buffered, and Node 22's
// Readable.toWeb would still put it into the cancelled web stream, an uncaught "Controller is already closed".
describe("fetchPublic: an answer let go of unread", () => {
  const body = JSON.stringify({ error: "not here", detail: "x".repeat(200) });
  let server: http.Server;
  let url = "";
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/history/x`;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("throws nothing where nobody catches it, and a body read to its end still arrives whole", async () => {
    const thrown: unknown[] = [];
    const onError = (e: unknown) => thrown.push(e);
    process.on("uncaughtException", onError);
    try {
      for (let i = 0; i < 20; i++) {
        const res = await fetchPublic(url, {}, { blocked: () => false });
        expect(res.status).toBe(404);
        discardBody(res);
      }
      await new Promise((r) => setTimeout(r, 200));
      expect(thrown.map(String)).toEqual([]);
      const res = await fetchPublic(url, {}, { blocked: () => false });
      expect(await res.text()).toBe(body);
    } finally {
      process.off("uncaughtException", onError);
    }
  });
});
