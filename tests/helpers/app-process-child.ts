/**
 * A second app process on the same data folder (tests/helpers/app-process.ts starts it): the studio's own server code,
 * with its own memory and its own database connection, as the second server of a deploy has. It answers on a random
 * high port:
 *
 * - /api/gpu/computer/*: the worker routes, as the studio serves them.
 * - GET /__app/generation/<id>: a run as GET /api/generations/<id> answers it.
 * - POST /__app/tick: one turn of its runner (it never turns on its own), and every run that turn polls.
 * - POST /__app/billing: one sweep of its billing reports.
 * - POST /__app/pause { marker, release }: the next result it moves into the files folder waits there, with `marker`
 *   written, until the file `release` exists (a test acts while this process is in the middle of saving a result).
 *
 * Run with: node --import tests/helpers/ts-register.mjs tests/helpers/app-process-child.ts
 * Requests to anything but the addresses in FUOBE_TEST_ALLOW (comma-separated) answer 599: no real network.
 */
import fs from "node:fs";
import http from "node:http";
import { register } from "node:module";
import type net from "node:net";

// next/server as the tests mock it (connection() has no request to wait for here).
register("./app-process-hooks.mjs", import.meta.url);

declare global {
  var __fuobeTestDiskFree: number | undefined;
}
globalThis.__fuobeTestDiskFree = 1e13;

const allow = (process.env.FUOBE_TEST_ALLOW ?? "").split(",").filter(Boolean);
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (allow.some((a) => url.startsWith(a))) return realFetch(input, init);
  return new Response("not reachable in this test", { status: 599 });
}) as typeof fetch;

// The pause point: a result's move out of the worker's upload folder.
let pause: { marker: string; release: string } | null = null;
const realRename = fs.renameSync;
fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
  const p = pause;
  if (p && /[\\/]relay[\\/]tasks[\\/][^\\/]+[\\/]out-\d+$/.test(String(from))) {
    pause = null;
    fs.writeFileSync(p.marker, "");
    const wait = new Int32Array(new SharedArrayBuffer(4));
    const until = Date.now() + 60_000;
    while (!fs.existsSync(p.release) && Date.now() < until) Atomics.wait(wait, 0, 0, 10);
  }
  return realRename(from, to);
}) as typeof fs.renameSync;

const { ensureRunner } = await import("@/server/generations");
const { sweepBilling } = await import("@/server/billing-outbox");
const { loadRoutes, apiAs } = await import("./computer-tab");
const one = await import("@/app/api/generations/[id]/route");
const routes = await loadRoutes();

// Its runner turns only when asked (reading a run starts no timer of its own again: the cleared ones stay in place).
ensureRunner();
const state = globalThis.__fuobeRunner!;
clearInterval(state.timer);
if (state.fastTimer) clearInterval(state.fastTimer);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const read = (req: http.IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

const server = http.createServer(async (req, res) => {
  const body = await read(req);
  const url = new URL(req.url ?? "/", "http://app");
  const send = async (r: Response) => {
    const data = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(data);
  };
  try {
    if (url.pathname.startsWith("/api/gpu/computer/")) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && k !== "host" && k !== "content-length") headers[k] = v;
      const api = apiAs(routes, null, headers);
      return await send(await api(url.pathname + url.search, { method: req.method, headers, ...(body.length && { body: new Uint8Array(body) }) }));
    }
    const g = /^\/__app\/generation\/([^/]+)$/.exec(url.pathname);
    if (g && req.method === "GET") {
      return await send(await one.GET(new Request(`http://localhost:3000/api/generations/${g[1]}`), { params: Promise.resolve({ id: g[1] }) } as never));
    }
    if (url.pathname === "/__app/tick") {
      await state.tick();
      for (let i = 0; i < 2000 && state.polling?.size; i++) await sleep(5);
      return await send(Response.json({ ok: true }));
    }
    if (url.pathname === "/__app/billing") {
      await sweepBilling();
      return await send(Response.json({ ok: true }));
    }
    if (url.pathname === "/__app/pause") {
      pause = JSON.parse(body.toString("utf8")) as { marker: string; release: string };
      return await send(Response.json({ ok: true }));
    }
    if (url.pathname === "/__app/exit") {
      res.writeHead(200).end();
      setTimeout(() => process.exit(0), 10);
      return;
    }
    res.writeHead(404).end();
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String((e as Error).stack ?? e));
  }
});

server.listen(0, "127.0.0.1", () => {
  console.log(`READY ${(server.address() as net.AddressInfo).port}`);
});
