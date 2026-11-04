// Shared by the Playwright scripts in tests/e2e (not a test itself).
//
// Playwright: the `playwright` (or `playwright-core`) package if it resolves from the repo, else the
// global install at /opt/node22/lib/node_modules. Chromium: $CHROMIUM_PATH, else the newest
// /opt/pw-browsers/chromium-*/chrome-linux/chrome, else Playwright's own.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadPlaywright() {
  for (const from of [path.join(root, "package.json"), "/opt/node22/lib/node_modules/"]) {
    const req = createRequire(from);
    for (const name of ["playwright", "playwright-core"]) {
      try {
        return req(name);
      } catch {}
    }
  }
  throw new Error("Playwright not found: install playwright-core or run where the global install exists");
}

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const dir = "/opt/pw-browsers";
  if (!fs.existsSync(dir)) return undefined;
  const newest = fs
    .readdirSync(dir)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  const exe = newest && path.join(dir, newest, "chrome-linux/chrome");
  return exe && fs.existsSync(exe) ? exe : undefined;
}

/**
 * The browser engine the checks run in: E2E_BROWSER=webkit (Safari's) or firefox, else Chromium. Checks that read
 * Chromium-only data (its DevTools protocol, layout-shift entries) skip themselves elsewhere.
 */
export const ENGINE = ["webkit", "firefox"].includes(process.env.E2E_BROWSER ?? "") ? process.env.E2E_BROWSER : "chromium";

/** `opts`: more launch options (`args`: Chromium flags, such as a host name mapped to this machine; Chromium only). */
export async function launch(opts = {}) {
  const pw = loadPlaywright();
  if (ENGINE !== "chromium") return pw[ENGINE].launch({ ...opts, args: undefined });
  return pw.chromium.launch({ executablePath: chromiumPath(), ...opts });
}

export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1440, height: 900 } };

/**
 * Open a route and wait until it has rendered: the `load` event, then the page's first heading (or
 * a short timeout for pages without one), then a moment for late layout. Never waits for network
 * idle: pages that stream live updates (the generations feed) keep a connection open for good.
 */
export async function openRoute(page, url, { settleMs = 700, timeout = 60_000 } = {}) {
  await page.goto(url, { waitUntil: "load", timeout });
  await page
    .locator("h1")
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(settleMs);
}

/** POST JSON to the app; resolves to the parsed body or null. */
export async function post(app, route, body) {
  try {
    const res = await fetch(app + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
