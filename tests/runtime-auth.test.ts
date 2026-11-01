import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-auth-rt-"));
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
const auth = await import("@/server/auth");
const { proxy, config } = await import("@/proxy");
const { safeNext } = await import("@/lib/safe-redirect");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const post = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { method: "POST", headers, body: "{}" });

describe("cross-site requests (S8)", () => {
  it("blocks state changes from other websites, password or not", async () => {
    expect(auth.authEnabled()).toBe(false);
    const evil = proxy(post("http://localhost:3000/api/auth/password", { origin: "http://evil.example", "content-type": "text/plain" }));
    expect(evil.status).toBe(403);
    expect((await evil.json()).error).toMatch(/another website/);
    expect(proxy(post("http://localhost:3000/api/generations", { origin: "null" })).status).toBe(403);
    expect(proxy(post("http://localhost:3000/api/generations", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    // Another port on localhost is another origin.
    expect(proxy(post("http://localhost:3000/api/generations", { origin: "http://localhost:5173" })).status).toBe(403);
  });

  it("lets the studio's own pages, non-browser clients and reads through", () => {
    const ok = (r: Response) => r.headers.get("x-middleware-next") === "1";
    expect(ok(proxy(post("http://localhost:3000/api/generations", { origin: "http://localhost:3000" })))).toBe(true);
    expect(ok(proxy(post("http://localhost:3000/api/mcp")))).toBe(true);
    expect(ok(proxy(new NextRequest("http://localhost:3000/api/generations", { headers: { origin: "http://evil.example" } })))).toBe(true);
    // Behind a reverse proxy that forwards the public host.
    expect(ok(proxy(post("http://127.0.0.1:3000/api/generations", { origin: "https://fuobe.example.com", "x-forwarded-host": "fuobe.example.com" })))).toBe(true);
    process.env.FUOBE_ALLOWED_ORIGINS = "https://studio.example.org";
    try {
      expect(ok(proxy(post("http://127.0.0.1:3000/api/generations", { origin: "https://studio.example.org" })))).toBe(true);
    } finally {
      delete process.env.FUOBE_ALLOWED_ORIGINS;
    }
  });
});

describe("DNS rebinding", () => {
  const ok = (r: Response) => r.headers.get("x-middleware-next") === "1";
  const at = (host: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    proxy(new NextRequest(`http://${host}/api/generations`, { method: init.method ?? "GET", headers: { host, ...init.headers }, ...(init.method === "POST" && { body: "{}" }) }));

  it("refuses a name that was re-pointed at this machine, reads included, while no password is set", async () => {
    expect(auth.authEnabled()).toBe(false);
    // The attacker's page and its requests share one origin, so the Origin check alone lets them through.
    const read = at("rebind.attacker.example:3000");
    expect(read.status).toBe(403);
    expect((await read.json()).error).toMatch(/FUOBE_ALLOWED_ORIGINS/);
    expect(at("rebind.attacker.example:3000", { method: "POST", headers: { origin: "http://rebind.attacker.example:3000" } }).status).toBe(403);
    // A forwarded host is no way around it (the page can set that header itself).
    expect(at("rebind.attacker.example", { headers: { "x-forwarded-host": "localhost:3000" } }).status).toBe(403);
  });

  it("lets local addresses, LAN names, this machine and allow-listed names through", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "192.168.1.5:3000", "studio.localhost", "nas:3000", "studio.local", "box.lan:3000", "fuobe.home.arpa", `${os.hostname()}:3000`]) {
      expect(ok(at(host)), host).toBe(true);
    }
    process.env.FUOBE_ALLOWED_ORIGINS = "https://fuobe.example.com,studio.example.org:8443";
    try {
      expect(ok(at("fuobe.example.com"))).toBe(true);
      expect(ok(at("studio.example.org:8443"))).toBe(true);
      expect(at("studio.example.org:9999").status).toBe(403);
      expect(at("rebind.attacker.example").status).toBe(403);
    } finally {
      delete process.env.FUOBE_ALLOWED_ORIGINS;
    }
    expect(auth.hostAllowed(null)).toBe(true);
  });

  it("leaves it to the sign-in check once a password is set", () => {
    auth.setPassword("correct horse battery");
    try {
      // Signed out: sent to sign in (the rebound page has no session cookie for its name).
      expect(at("fuobe.example.com").status).toBe(401);
    } finally {
      auth.setPassword(null);
    }
  });
});

describe("sign-in lockout (S10)", () => {
  it("ignores spoofed X-Forwarded-For unless a trusted proxy sets it", () => {
    const h = (xff: string) => new Headers({ "x-forwarded-for": xff });
    expect(auth.LoginGuard.clientKey(h("1.2.3.4"), false)).toBe("direct");
    expect(auth.LoginGuard.clientKey(h("6.6.6.6, 1.2.3.4"), true)).toBe("1.2.3.4");
  });

  const limits = { perClient: 5, global: 20, windowMs: 60_000, lockMs: 60_000, throttleMs: 4_000, maxClients: 5000 };

  it("locks a client of its own after 5 misses, and slows everyone down after too many misses overall", () => {
    const g = new auth.LoginGuard(limits);
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) g.fail("a", t + i);
    expect(g.blockedFor("a", t + 5)).toBe(0);
    g.fail("a", t + 5);
    expect(g.blockedFor("a", t + 6)).toBeGreaterThan(50_000);
    expect(g.blockedFor("b", t + 6)).toBe(0);
    // Rotating the key doesn't help: past the global budget everyone gets one try every few seconds.
    for (let i = 0; i < 15; i++) g.fail(`spoof-${i}`, t + 10 + i);
    expect(g.blockedFor("fresh", t + 30)).toBeGreaterThan(0);
    expect(g.blockedFor("fresh", t + 30)).toBeLessThanOrEqual(4_000);
    expect(g.blockedFor("fresh", t + 24 + 4_000)).toBe(0);
    expect(g.blockedFor("fresh", t + 120_000)).toBe(0);
  });

  it("never locks the shared key: the owner still gets in within seconds while guesses stay capped", () => {
    const g = new auth.LoginGuard(limits);
    const key = auth.LoginGuard.DIRECT;
    const t = 2_000_000;
    // An attacker hammering the login page for a minute, as fast as it's allowed.
    let tries = 0;
    for (let now = t; now < t + 60_000; now += 100) {
      if (g.blockedFor(key, now) > 0) continue;
      g.fail(key, now);
      tries++;
    }
    expect(tries).toBeLessThanOrEqual(20);
    // The owner waits at most one throttle step, never a full lock.
    const wait = g.blockedFor(key, t + 60_000);
    expect(wait).toBeLessThanOrEqual(4_000);
    expect(g.blockedFor(key, t + 60_000 + wait)).toBe(0);
  });

  it("keeps its memory bounded", () => {
    const g = new auth.LoginGuard({ ...limits, global: 1e9, maxClients: 100 });
    for (let i = 0; i < 5000; i++) g.fail(`k${i}`, 1_000_000 + i);
    expect(g.size).toBeLessThanOrEqual(101);
  });
});

describe("after sign-in (C5)", () => {
  const origin = "http://localhost:3000";
  it("only goes to pages on this site", () => {
    expect(safeNext("/video?model=kling-3#x", origin)).toBe("/video?model=kling-3#x");
    expect(safeNext(null, origin)).toBe("/");
    for (const bad of ["//evil.example", "/\\evil.example", "/\t/evil.example", "https://evil.example/", "javascript:alert(1)", "\\\\evil.example"]) {
      expect(safeNext(bad, origin), bad).toBe("/");
    }
  });
});

describe("proxy matcher (C13)", () => {
  // path-to-regexp turns "/(…)" into this group.
  const matches = (p: string) => new RegExp(`^${config.matcher[0]}$`).test(p);
  it("gates generated SVGs but not the public folder's files", () => {
    expect(matches("/api/files/outputs/2026-10-17/abc.svg")).toBe(true);
    expect(matches("/api/generations")).toBe(true);
    expect(matches("/library")).toBe(true);
    expect(matches("/next.svg")).toBe(false);
    expect(matches("/samples/demo-model.glb")).toBe(false);
    expect(matches("/vendor/meshopt_decoder.js")).toBe(false);
    expect(matches("/previews/presets/effect-set-on-fire.jpg")).toBe(false);
    expect(matches("/previews/presets/motion-fpv-drone.mp4")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
    expect(matches("/icon.svg")).toBe(false);
    expect(matches("/apple-icon.png")).toBe(false);
    expect(matches("/_next/static/chunks/a.js")).toBe(false);
  });
  it("skips only a real dot: a path with 'svg', 'ico' or 'png' after another character still runs the proxy", () => {
    expect(matches("/api/svg")).toBe(true);
    expect(matches("/x/svg")).toBe(true);
    expect(matches("/aXsvg")).toBe(true);
    expect(matches("/faviconXico")).toBe(true);
    expect(matches("/apple-iconXpng")).toBe(true);
  });
});
