import http from "node:http";
import os from "node:os";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

process.env.FUOBE_SELF_ADDRESSES = "93.184.216.99";
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
const { blockedForAccounts, fetchPublic, isPrivateAddress, loopbackGpuPort } = await import("@/server/remote-fetch");

// A server on this machine: what an account's ComfyUI could answer.
let port = 0;
const server = http.createServer((req, res) => {
  if (req.url === "/big") {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    const block = Buffer.alloc(256 * 1024, 1);
    let sent = 0;
    const pump = () => {
      while (sent < 4 * 2 ** 20 && res.write(block)) sent += block.length;
      if (sent >= 4 * 2 ** 20) res.end();
    };
    res.on("drain", pump);
    pump();
    return;
  }
  if (req.url === "/declared") {
    res.writeHead(200, { "content-length": String(10 * 2 ** 20) });
    res.write("x");
    return;
  }
  if (req.url === "/drip") {
    res.writeHead(200, { "content-type": "application/json" });
    const t = setInterval(() => res.write(" "), 200);
    res.on("close", () => clearInterval(t));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end('{"ok":true}');
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
  globalThis.__fuobeTestGpuPort = port;
});
afterAll(async () => {
  globalThis.__fuobeTestGpuPort = undefined;
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});
afterEach(() => {
  delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
});

const base = () => `http://127.0.0.1:${port}`;

describe("fetchPublic: an account's ComfyUI can't freeze or fill the server", () => {
  it("answers within the caps", async () => {
    const res = await fetchPublic(`${base()}/ok`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("fails an answer over maxBytes, read as it streams or declared up front", async () => {
    const res = await fetchPublic(`${base()}/big`, {}, { maxBytes: 2 ** 20 });
    await expect(res.arrayBuffer()).rejects.toThrow(/over/);
    await expect(fetchPublic(`${base()}/declared`, {}, { maxBytes: 2 ** 20 })).rejects.toThrow(/over 1 MB/);
  });

  it("fails an answer that drips past the deadline", async () => {
    const t = Date.now();
    const res = await fetchPublic(`${base()}/drip`, {}, { deadlineMs: 1000 });
    await expect(res.text()).rejects.toThrow(/took over 1 s/);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

describe("blockedForAccounts: never this machine", () => {
  it("refuses this machine's own addresses", () => {
    const own = Object.values(os.networkInterfaces())
      .flatMap((l) => l ?? [])
      .map((a) => a.address);
    expect(own.length).toBeGreaterThan(0);
    for (const ip of own) expect(blockedForAccounts(ip), ip).toBe(true);
    expect(blockedForAccounts("93.184.216.99")).toBe(true); // FUOBE_SELF_ADDRESSES
    expect(blockedForAccounts("93.184.216.34")).toBe(false);
  });

  it("refuses IPv6 forms that carry an IPv4 address", () => {
    for (const ip of ["::ffff:127.0.0.1", "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b:1::a00:1", "2002:7f00:1::1", "2001:0:4136:e378:8000:63bf:80ff:fffe", "::ffff:93.184.216.99"]) {
      expect(blockedForAccounts(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("::127.0.0.1")).toBe(true);
    expect(blockedForAccounts("2606:4700::6810:84e5")).toBe(false);
  });

  it("refuses loopback even with FUOBE_ALLOW_PRIVATE_URLS=1, which still allows the LAN", async () => {
    process.env.FUOBE_ALLOW_PRIVATE_URLS = "1";
    expect(blockedForAccounts("127.0.0.1")).toBe(true);
    expect(blockedForAccounts("::1")).toBe(true);
    expect(blockedForAccounts("192.168.1.5")).toBe(false);
    await expect(fetchPublic("http://127.0.0.1:9/x")).rejects.toThrow(/won't fetch/);
  });
});

describe("the stand-in ComfyUI on this machine (tests and next dev only)", () => {
  it("is reached at the one port the test names, never another", async () => {
    expect(loopbackGpuPort()).toBe(port);
    await expect(fetchPublic(`http://127.0.0.1:${port + 1}/x`)).rejects.toThrow(/won't fetch/);
    await expect(fetchPublic(`http://localhost:${port}/ok`).then((r) => r.json())).resolves.toEqual({ ok: true });
  });

  it("is never the real ComfyUI's port, and is off in production", () => {
    globalThis.__fuobeTestGpuPort = 8188;
    expect(loopbackGpuPort()).toBeNull();
    globalThis.__fuobeTestGpuPort = port;
    const env = process.env as Record<string, string | undefined>;
    const was = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(loopbackGpuPort()).toBeNull();
    } finally {
      env.NODE_ENV = was;
    }
  });
});
