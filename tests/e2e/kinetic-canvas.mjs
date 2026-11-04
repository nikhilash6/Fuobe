// The Canvas "Kinetic" node, end to end (owner). Starts `next dev` on 3542 with a throwaway data folder and Demo mode,
// and uses the system Chrome (WebCodecs H.264). Everything it starts is stopped at the end.
//
//   node tests/e2e/kinetic-canvas.mjs [evidence folder]
//
// KINETIC_CANVAS_PORT moves the app.
//
// A Table of 3 rows feeds a Kinetic node (Big Number: column 1 is the number, column 2 the caption), which feeds an
// Output node. Run all renders the 3 rows in the tab and keeps the run on the board (3 Kinetic results, each with its
// row's words); the Output node shows the clip. A second Run all keeps all three unchanged. Editing row 2 renders only
// row 2 again.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DESKTOP, launch, root } from "./_browser.mjs";

const PORT = Number(process.env.KINETIC_CANVAS_PORT ?? 3542);
const APP = `http://127.0.0.1:${PORT}`;
const out = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-kinetic-canvas-")));
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-kinetic-canvas-data-"));
const PASSWORD = "owner password for the kinetic canvas";

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const log = fs.openSync(path.join(out, "server.log"), "w");
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "development", FUOBE_DATA_DIR: data, FUOBE_PASSWORD: PASSWORD, FUOBE_DEMO_MODE: "on", COMFYUI_URL: "http://127.0.0.1:9", OLLAMA_URL: "http://127.0.0.1:9", LMSTUDIO_URL: "http://127.0.0.1:9", UNSLOTH_URL: "http://127.0.0.1:9", FUOBE_ACCOUNT_DISK_FREE_GB: "0.5" },
  stdio: ["ignore", log, log],
});
const stop = () => {
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    else server.kill("SIGTERM");
  } catch {}
};

const api = async (route, { method = "GET", body, cookie } = {}) => {
  const res = await fetch(APP + route, { method, headers: { Origin: APP, "Content-Type": "application/json", ...(cookie && { cookie }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};

const node = (id, type, data, x, y) => ({ id, type, position: { x, y }, data });
const edge = (source, target, targetHandle) => ({ id: `e-${source}-${target}`, source, target, sourceHandle: "out", targetHandle });

let browser;
try {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`${APP}/login`)).status < 500) break;
    } catch {}
    await wait(1000);
  }
  const owner = /fuobe_session=[^;]+/.exec((await api("/api/auth/login", { method: "POST", body: { password: PASSWORD } })).headers.get("set-cookie") ?? "")?.[0];
  check(!!owner, "owner signs in");
  const graph = {
    nodes: [
      node("tb", "table", { columns: ["Number", "Caption"], rows: [["3×", "faster month-end close"], ["98%", "invoices paid on time"], ["2 days", "back every month"]] }, 0, 0),
      node("k", "kinetic", {}, 420, 0),
      node("o", "output", {}, 820, 0),
    ],
    edges: [edge("tb", "k", "prompt"), edge("k", "o", "in")],
  };
  const made = await api("/api/canvases", { method: "POST", cookie: owner, body: { name: "Launch stats", graph } });
  const id = made.json?.id;
  check(made.status < 300 && !!id, `the canvas is made (${made.status})`);
  browser = await launch({ channel: "chrome" });
  const ctx = await browser.newContext({ ...DESKTOP, baseURL: APP });
  const [n, v] = owner.split("=");
  await ctx.addCookies([{ name: n, value: v, url: APP }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/canvas/${id}`, { waitUntil: "load", timeout: 240_000 });
  await page.locator("[data-kinetic-node-run]").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, "board-before.png") });

  const runAll = async () => {
    const kept = page.waitForResponse((r) => /\/api\/canvases\/[^/]+\/runs\/k$/.test(r.url()) && r.request().method() === "PUT", { timeout: 300_000 });
    await page.getByRole("button", { name: "Run all", exact: true }).first().click();
    const r = await kept;
    check(r.status() === 200, `the run is kept on the board (${r.status()})`);
    await page.waitForTimeout(1500);
    return (await api(`/api/canvases/${id}`, { cookie: owner })).json;
  };

  const first = await runAll();
  const run1 = first?.canvas?.runs?.k;
  check(run1?.ids?.length === 3 && new Set(run1.ids).size === 3, `Run all renders 3 rows (${JSON.stringify(run1?.ids)})`);
  const gens = new Map((first?.generations ?? []).map((g) => [g.id, g]));
  check(
    run1?.ids?.every((g, i) => gens.get(g)?.modelId === "local-motion" && gens.get(g)?.feature === "kinetic-canvas" && gens.get(g)?.request?.params?.extra?.motion?.fields?.stat === graph.nodes[0].data.rows[i][0]),
    "each row is a Kinetic result with its row's number",
  );
  check(await page.locator('[data-testid="canvas-node-o"] video, [data-testid="canvas-node-o"] img').first().waitFor({ timeout: 30_000 }).then(() => true, () => false), "the Output node shows the clip");
  const poster = await page.locator('[data-testid="canvas-node-o"] video').first().getAttribute("poster").catch(() => null);
  check(!!poster && poster.startsWith("/api/files/"), `the Output node's clip shows its poster, not an empty first frame (${poster})`);
  await page.screenshot({ path: path.join(out, "board-after-run.png") });

  const second = await runAll();
  check(JSON.stringify(second?.canvas?.runs?.k?.ids) === JSON.stringify(run1?.ids), "a second Run all keeps all three");

  const cell = page.getByRole("textbox", { name: "Row 2, Number" });
  await cell.fill("99%");
  await page.waitForTimeout(1200);
  const third = await runAll();
  const ids3 = third?.canvas?.runs?.k?.ids ?? [];
  check(ids3[0] === run1?.ids?.[0] && ids3[2] === run1?.ids?.[2] && ids3[1] !== run1?.ids?.[1], `editing row 2 renders only row 2 (${JSON.stringify(ids3)})`);
  check(errors.length === 0, `no page errors (${JSON.stringify(errors.slice(0, 3))})`);
} catch (e) {
  failures.push(`crashed: ${e?.stack ?? e}`);
  console.error(e);
} finally {
  await browser?.close().catch(() => {});
  stop();
}
fs.writeFileSync(path.join(out, "e2e-result.json"), JSON.stringify({ failures }, null, 2));
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
