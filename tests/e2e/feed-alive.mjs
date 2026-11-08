// The studio feed stays alive: a press of Run shows its card at once, a run's card keeps its shape in every state, and
// a run that finishes while the live stream is cut (an update of the site switching over) or silent (a proxy holding a
// stream whose server went away) still shows done within seconds, without a reload.
//
// The app must be running with placeholder results (`FUOBE_DEMO_MODE=on`, ComfyUI unreachable: COMFYUI_URL=http://127.0.0.1:1).
// Usage: node tests/e2e/feed-alive.mjs [appUrl]. Exits 1 on a failure.
//
// 1. Send: within 300 ms the newest card is on screen, at its run's shape (a 1:1 run: as wide as it is tall).
// 2. Every crafted state (in line, warming up, creating, failed, canceled) at 1440 and 390 px: each card's width is its
//    shape times the row height (never a blank or a thin strip), and a failed one has Retry.
// 3. Cut: from 1 s after Send, the stream answers 503 and every list read 503 for 8 s (the run finishes meanwhile); the
//    card shows the result within 4 s of the gap's end.
// 4. Silent: the stream connects and then says nothing; the card shows the result within 6 s of the run finishing.
import { DESKTOP, launch, PHONE } from "./_browser.mjs";

const app = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const browser = await launch();
const failures = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures.push(msg);
};

/** The newest card in the feed: its state, and its tile's size. */
const newest = (page) =>
  page.evaluate(() => {
    const s = document.querySelector("[data-making],[data-gen-id]");
    const tile = s?.querySelector("[data-stage]") ?? s?.querySelector(":scope > div.flex.flex-wrap > *");
    const r = tile?.getBoundingClientRect();
    const done = !!s?.querySelector("img:not([data-run-preview]),video") && !s?.querySelector("[data-stage]");
    return { making: !!s?.hasAttribute("data-making"), stage: tile?.getAttribute("data-stage") ?? null, done, w: Math.round(r?.width ?? 0), h: Math.round(r?.height ?? 0), visible: !!r && r.bottom > 0 && r.top < innerHeight };
  });

async function send(page, words) {
  const ta = page.locator("[data-composer] textarea").first();
  await ta.fill(words);
  await ta.press("Enter");
}

async function waitDone(page, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await newest(page)).done) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

/** A page whose stream and list reads this script can cut or silence (window.__mode: "live" | "cut" | "silent"). */
async function openStudio(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(() => {
    const real = window.fetch;
    window.__mode = sessionStorage.getItem("e2e-stream") || "live";
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const down = () => Promise.resolve(new Response("<html>updating</html>", { status: 503, headers: { "Content-Type": "text/html" } }));
      if (url.includes("/api/generations/stream")) {
        if (window.__mode === "cut") return down();
        if (window.__mode === "silent") return Promise.resolve(new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode(": connected\n\n")) }), { headers: { "Content-Type": "text/event-stream" } }));
        // A live stream that ends as soon as the gap begins (the server stopping), as an update does.
        return real(input, init).then((res) => {
          if (!res.body) return res;
          const reader = res.body.getReader();
          let timer;
          const body = new ReadableStream({
            start(c) {
              timer = setInterval(() => {
                if (window.__mode !== "live") {
                  clearInterval(timer);
                  reader.cancel().catch(() => {});
                  try {
                    c.close();
                  } catch {}
                }
              }, 100);
            },
            async pull(c) {
              const r = await reader.read().catch(() => ({ done: true }));
              if (r.done) {
                clearInterval(timer);
                try {
                  c.close();
                } catch {}
              } else c.enqueue(r.value);
            },
            cancel() {
              clearInterval(timer);
              reader.cancel().catch(() => {});
            },
          });
          return new Response(body, { status: res.status, headers: res.headers });
        });
      }
      if (window.__mode === "cut" && url.includes("/api/generations")) return down();
      return real(input, init);
    };
  });
  const page = await ctx.newPage();
  await page.goto(app + "/image", { waitUntil: "load", timeout: 120_000 });
  await page.locator("[data-composer] textarea").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  return { ctx, page };
}

console.log("1. a press of Run shows its card at once");
{
  const { ctx, page } = await openStudio(DESKTOP);
  await send(page, "a flying cat, instant card");
  await page.waitForTimeout(300);
  const n = await newest(page);
  check(n.visible && n.w > 100 && Math.abs(n.w - n.h) <= 2, `the newest card is on screen at 1:1 (${n.w}×${n.h}, ${n.making ? "being made" : n.stage})`);
  check(await waitDone(page, 15_000), "and its result arrives");
  await ctx.close();
}

console.log("2. every state keeps its card's shape");
{
  const now = Date.now();
  const req = (prompt, ar, n = 1) => ({ feature: "image", modelId: "moss-image", op: "t2i", prompt, inputs: {}, params: { aspectRatio: ar, resolution: "1K", numOutputs: n } });
  const run = (id, ar, o) => ({ id, batchId: null, feature: "image", presetId: null, modelId: "moss-image", engine: "open", provider: "comfyui", op: "t2i", kind: "image", status: "queued", progress: null, message: null, prompt: id, request: req(id, ar), outputs: [], error: null, costUsd: 0, favorite: false, createdAt: now - 5000, updatedAt: now - 5000, completedAt: null, modelName: "MOSS-Image", presetName: null, aspectRatio: ar, deletedAt: null, folderId: null, pinnedAt: null, review: null, place: "pool", ...o });
  const items = [
    run("line", "1:1", { queue: { place: 1, etaSeconds: 40 } }),
    run("warm", "3:4", { status: "running" }),
    run("make", "16:9", { status: "running", progress: 0.4 }),
    run("fail", "1:1", { status: "failed", error: "That one didn't come out right — try again, or try a similar model." }),
    run("stop", "9:16", { place: undefined, status: "canceled" }),
  ];
  const want = { line: 1, warm: 0.75, make: 16 / 9, fail: 1, stop: 0.8 };
  for (const [name, opts] of [["1440", DESKTOP], ["390", PHONE]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await page.route(/\/api\/generations\?/, (r) => r.fulfill({ json: { items } }));
    await page.goto(app + "/image", { waitUntil: "load", timeout: 120_000 });
    await page.waitForSelector('[data-gen-id="stop"] [data-stage]', { timeout: 60_000 });
    const sizes = await page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll("[data-gen-id]")].map((s) => {
        const t = s.querySelector("[data-stage]");
        const r = t.getBoundingClientRect();
        return [s.getAttribute("data-gen-id"), { w: r.width, h: r.height, stage: t.getAttribute("data-stage"), retry: /Retry/.test(s.textContent) }];
      })),
    );
    const colW = await page.evaluate(() => document.querySelector("[data-gen-id] > div.flex.flex-wrap").getBoundingClientRect().width);
    for (const [id, ratio] of Object.entries(want)) {
      const s = sizes[id];
      const expectW = Math.min(s.h * ratio, colW);
      check(s.h >= 200 && Math.abs(s.w - expectW) <= 2, `${name}: ${id} (${s.stage}) is ${Math.round(s.w)}×${Math.round(s.h)}, its shape`);
    }
    check(sizes.fail.retry && sizes.stop.retry, `${name}: failed and canceled cards offer Retry`);
    await ctx.close();
  }
}

console.log("3. a run that finishes while the stream is cut shows done soon after");
{
  const { ctx, page } = await openStudio(DESKTOP);
  await send(page, "a flying cat, through an update");
  await page.waitForTimeout(1000);
  await page.evaluate(() => (window.__mode = "cut"));
  await page.waitForTimeout(8000);
  const before = await newest(page);
  check(!before.done, "during the gap the card still shows the run on its way (nothing to read)");
  await page.evaluate(() => (window.__mode = "live"));
  check(await waitDone(page, 4000), "within 4 s of the gap's end, the result shows");
  await ctx.close();
}

console.log("4. a run that finishes while the stream is silent shows done within seconds");
{
  const { ctx, page } = await openStudio(DESKTOP);
  // Silent from the page's first stream on.
  await page.evaluate(() => sessionStorage.setItem("e2e-stream", "silent"));
  await page.reload({ waitUntil: "load" });
  await page.locator("[data-composer] textarea").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await send(page, "a flying cat, silent stream");
  // The placeholder run takes about 3.5 s.
  check(await waitDone(page, 3500 + 6000), "the result shows within 6 s of the run finishing");
  await ctx.close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
