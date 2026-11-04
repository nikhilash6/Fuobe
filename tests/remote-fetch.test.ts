import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

const dir = tempDir("fuobe-ssrf-");
process.env.FUOBE_DATA_DIR = dir;
const { fetchRemote, fetchRemoteToFile, isPrivateAddress } = await import("@/server/remote-fetch");
const { readRef } = await import("@/server/storage");

let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/fox.png") {
      res.setHeader("content-type", "image/png");
      return res.end(Buffer.from("89504e470d0a1a0a", "hex"));
    }
    if (req.url === "/to-metadata") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      return res.end();
    }
    if (req.url === "/to-internal") {
      res.writeHead(301, { location: "http://internal.test/admin" });
      return res.end();
    }
    if (req.url === "/to-fox") {
      res.writeHead(307, { location: "/fox.png" });
      return res.end();
    }
    if (req.url === "/big") {
      res.setHeader("content-length", String(10_000));
      return res.end(Buffer.alloc(10_000));
    }
    if (req.url === "/slow") return void setTimeout(() => res.end("late"), 2000);
    if (req.url === "/frames.zip") {
      // Sent in pieces, with no length up front (a provider's stream).
      res.setHeader("content-type", "application/zip");
      let i = 0;
      const next = () => (i++ < 50 ? res.write(Buffer.alloc(64 * 1024, i), () => setImmediate(next)) : res.end());
      return next();
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => {
  server.close();
});

// The test server is on loopback: pretend "public.test" is a public host that resolves to it.
const resolve = async (host: string) => (host === "public.test" ? ["127.0.0.1"] : host === "internal.test" ? ["10.0.0.7"] : ["93.184.216.34"]);
const blocked = (ip: string) => ip !== "127.0.0.1" && isPrivateAddress(ip);

describe("remote inputs (S14)", () => {
  it("knows which addresses are private", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.10", "169.254.169.254", "100.100.100.200", "0.0.0.0", "::1", "::", "fe80::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "172.32.0.1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses loopback, private and metadata addresses, by IP or by name", async () => {
    await expect(readRef("http://127.0.0.1:1/x.png")).rejects.toThrow(/won't fetch/);
    await expect(readRef("http://169.254.169.254/latest/meta-data/iam/security-credentials/role")).rejects.toThrow(/won't fetch/);
    await expect(readRef("http://[::1]/x.png")).rejects.toThrow(/won't fetch/);
    await expect(readRef("http://localhost:1/x.png")).rejects.toThrow(/won't fetch/);
    await expect(readRef("file:///etc/passwd")).rejects.toThrow();
    await expect(fetchRemote("http://internal.test/x", { resolve })).rejects.toThrow(/won't fetch internal\.test/);
  });

  it("fetches public links, following redirects and checking each hop", async () => {
    const ok = await fetchRemote(`http://public.test:${port}/to-fox`, { resolve, blocked });
    expect(ok.contentType).toBe("image/png");
    expect(ok.data.subarray(0, 4).toString("hex")).toBe("89504e47");
    await expect(fetchRemote(`http://public.test:${port}/to-metadata`, { resolve, blocked })).rejects.toThrow(/won't fetch 169\.254\.169\.254/);
    await expect(fetchRemote(`http://public.test:${port}/to-internal`, { resolve, blocked })).rejects.toThrow(/won't fetch internal\.test/);
  });

  it("caps size and time", async () => {
    await expect(fetchRemote(`http://public.test:${port}/big`, { resolve, blocked, maxBytes: 1000 })).rejects.toThrow(/over/);
    await expect(fetchRemote(`http://public.test:${port}/slow`, { resolve, blocked, timeoutMs: 300 })).rejects.toThrow(/Timed out/);
    await expect(fetchRemote(`http://public.test:${port}/missing`, { resolve, blocked })).rejects.toThrow(/404/);
  });

  it("streams a big result straight to disk, with the same checks, and leaves nothing behind when it fails", async () => {
    const dest = path.join(dir, "frames.zip");
    const res = await fetchRemoteToFile(`http://public.test:${port}/frames.zip`, dest, { resolve, blocked });
    expect(res).toMatchObject({ bytes: 50 * 64 * 1024, contentType: "application/zip" });
    expect(fs.statSync(dest).size).toBe(50 * 64 * 1024);
    expect(fs.readFileSync(dest).subarray(-1)[0]).toBe(50);
    const capped = path.join(dir, "capped.zip");
    await expect(fetchRemoteToFile(`http://public.test:${port}/frames.zip`, capped, { resolve, blocked, maxBytes: 100_000 })).rejects.toThrow(/over/);
    expect(fs.existsSync(capped)).toBe(false);
    await expect(fetchRemoteToFile(`http://public.test:${port}/to-metadata`, capped, { resolve, blocked })).rejects.toThrow(/won't fetch 169\.254\.169\.254/);
    await expect(fetchRemoteToFile(`http://public.test:${port}/missing`, capped, { resolve, blocked })).rejects.toThrow(/404/);
    expect(fs.existsSync(capped)).toBe(false);
  });

  it("allows private addresses only when the install opts in", async () => {
    process.env.FUOBE_ALLOW_PRIVATE_URLS = "1";
    try {
      const f = await readRef(`http://127.0.0.1:${port}/fox.png`);
      expect(f.contentType).toBe("image/png");
      expect(f.name).toBe("fox.png");
    } finally {
      delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
    }
  });
});
