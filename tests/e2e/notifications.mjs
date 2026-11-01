// Browser notifications and the running-jobs count in the tab title (src/components/job-notifications.tsx),
// in a real browser against the live stream. The app must be running; demo mode is fine.
// Usage: node tests/e2e/notifications.mjs [appUrl]. Exits 1 on the first failure.
//
// The Notification API is replaced by a recorder (headless Chromium shows nothing) and the page can be
// "hidden" on demand (document.visibilityState), so the checks don't depend on window focus.
//
// 1. The title shows "(1) …" while a job runs and drops it when it's done.
// 2. A job finishing while the tab is hidden → one notification ("Your image is ready" + its prompt);
//    clicking it opens the result in the viewer. Also when it finishes just before the hidden tab's
//    30 s grace runs out (the clock held there): the tab keeps its stream until the job has settled.
// 3. A job finishing while you look at the tab → no notification.
// 4. The leader tab hidden while another tab is on screen → none; two hidden tabs → one (only the
//    stream's leader notifies).
// 5. The one-time offer appears once a job has run ~20 s (clock fast-forwarded) and "Notify me" turns them on.
// 6. Settings → Notifications: the switch and "Send a test".
import assert from "node:assert/strict";
import { DESKTOP, launch, openRoute } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const browser = await launch();
const step = (name) => console.log(`- ${name}`);

/** Record notifications, allow them (or not yet), and let the test hide the page. */
function fakes({ permission = "granted", on = true } = {}) {
  return [
    ({ permission, on }) => {
      window.__shown = [];
      class FakeNotification {
        static permission = permission;
        static async requestPermission() {
          FakeNotification.permission = "granted";
          return "granted";
        }
        constructor(title, opts = {}) {
          Object.assign(this, { title, ...opts, closed: false });
          window.__shown.push(this);
        }
        close() {
          this.closed = true;
        }
      }
      window.Notification = FakeNotification;
      let hidden = false;
      Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => hidden });
      window.__setHidden = (v) => {
        hidden = v;
        document.dispatchEvent(new Event("visibilitychange"));
      };
      try {
        if (on) localStorage.setItem("fuobe.notifications", "on");
        else localStorage.removeItem("fuobe.notifications");
        localStorage.removeItem("fuobe.notifications.asked");
      } catch {}
    },
    { permission, on },
  ];
}

/** Start a demo image job from the page (same origin, like the composer). */
const start = (page, prompt) =>
  page.evaluate(async (prompt) => {
    const res = await fetch("/api/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "nano-banana-pro", prompt }) });
    return (await res.json()).items[0].id;
  }, prompt);

const shown = (page) => page.evaluate(() => window.__shown.map((n) => ({ title: n.title, body: n.body, tag: n.tag })));

/** Poll in real time (the page's own clock may be held). */
async function until(check, what, ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) if (await check()) return;
  throw new Error(`timed out waiting for ${what}`);
}

try {
  {
    const ctx = await browser.newContext(DESKTOP);
    await ctx.addInitScript(...fakes());
    const page = await ctx.newPage();
    await openRoute(page, `${app}/library`);
    // Let the live stream connect first (a job created before it would only be seen by polling).
    await page.waitForTimeout(1500);

    step("the title counts the running job, then drops the count");
    await start(page, "a red kite over the dunes");
    await page.waitForFunction(() => document.title.startsWith("(1) "), null, { timeout: 15_000 });
    await page.waitForFunction(() => !/^\(\d+\) /.test(document.title), null, { timeout: 30_000 });

    step("finished while you look at it: no notification");
    await page.waitForTimeout(7_000);
    assert.deepEqual(await shown(page), []);

    step("finished while the tab is hidden: one notification, and clicking it opens the result");
    await start(page, "a paper boat in the rain");
    await page.evaluate(() => window.__setHidden(true));
    await page.waitForFunction(() => window.__shown.length > 0, null, { timeout: 30_000 });
    await page.waitForTimeout(1_000);
    const list = await shown(page);
    assert.equal(list.length, 1, JSON.stringify(list));
    assert.equal(list[0].title, "Your image is ready");
    assert.equal(list[0].body, "a paper boat in the rain");
    await page.evaluate(() => {
      window.__setHidden(false);
      window.__shown[0].onclick();
    });
    await page.getByRole("dialog").first().waitFor({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await ctx.close();
  }
  {
    step("finished 3 s before the hidden tab's 30 s grace ends: the tab keeps the stream until it settles, then notifies");
    const ctx = await browser.newContext(DESKTOP);
    await ctx.addInitScript(...fakes());
    const page = await ctx.newPage();
    await page.clock.install();
    await openRoute(page, `${app}/library`);
    await page.clock.runFor(1500);
    await page.evaluate(() => window.__setHidden(true));
    const hiddenAt = await page.evaluate(() => Date.now());
    // 27 s into the grace, with the clock held there while the job runs (in real time): it goes quiet
    // 3 s before the grace ends and is due (settled) 3 s after.
    await page.clock.pauseAt(hiddenAt + 27_000);
    const id = await start(page, "just before the grace runs out");
    await until(() => page.evaluate((id) => fetch(`/api/generations/${id}`).then((r) => r.json()).then((g) => g.status === "succeeded"), id), "the job to finish");
    await until(() => page.evaluate(() => !/^\(\d+\) /.test(document.title)), "the tab to hear it finish");
    await page.clock.runFor(3_500);
    assert.deepEqual(await shown(page), [], "nothing before the job has settled");
    await page.clock.runFor(4_000);
    await until(() => shown(page).then((l) => l.length > 0), "the notification", 5_000);
    const list = await shown(page);
    assert.equal(list.length, 1, JSON.stringify(list));
    assert.deepEqual([list[0].title, list[0].body], ["Your image is ready", "just before the grace runs out"]);
    await ctx.close();
  }
  {
    step("the leader tab hidden but another Fuobe tab on screen: no notification");
    const ctx = await browser.newContext(DESKTOP);
    await ctx.addInitScript(...fakes());
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await openRoute(a, `${app}/library`);
    await openRoute(b, `${app}/settings`);
    await a.waitForTimeout(1500);
    await a.evaluate(() => window.__setHidden(true));
    await start(b, "you're looking at the other tab");
    await a.waitForTimeout(16_000);
    assert.equal((await shown(a)).length + (await shown(b)).length, 0);

    step("two hidden tabs: only the stream's leader notifies");
    await b.evaluate(() => window.__setHidden(true));
    await start(b, "two tabs, one ping");
    await a.waitForTimeout(16_000);
    const total = (await shown(a)).length + (await shown(b)).length;
    assert.equal(total, 1, `notifications across both tabs: ${total}`);
    await ctx.close();
  }
  {
    step("a job running ~20 s offers notifications once; Notify me turns them on");
    const ctx = await browser.newContext(DESKTOP);
    await ctx.addInitScript(...fakes({ permission: "default", on: false }));
    const page = await ctx.newPage();
    await page.clock.install();
    await openRoute(page, `${app}/library`);
    await page.clock.runFor(1500);
    await start(page, "a slow one");
    await page.waitForFunction(() => document.title.startsWith("(1) "), null, { timeout: 15_000 });
    await page.clock.runFor(21_000);
    const offer = page.getByText("Want a heads-up when it’s done?");
    await offer.waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Notify me" }).click();
    await page.waitForFunction(() => localStorage.getItem("fuobe.notifications") === "on", null, { timeout: 5_000 });
    await ctx.close();
  }
  {
    step("Settings → Notifications: the switch and Send a test");
    const ctx = await browser.newContext(DESKTOP);
    await ctx.addInitScript(...fakes({ permission: "default", on: false }));
    const page = await ctx.newPage();
    await openRoute(page, `${app}/settings#notifications`);
    const toggle = page.getByRole("switch", { name: /Tell me when a job is done/ });
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
    await toggle.click();
    await page.waitForFunction(() => localStorage.getItem("fuobe.notifications") === "on");
    // Exact: a local LLM server's "Send a test message" (AI helper · Claude or a local model) is on the same page too.
    await page.getByRole("button", { name: "Send a test", exact: true }).click();
    assert.equal((await shown(page)).at(-1)?.title, "Notifications are on");
    await toggle.click();
    await page.waitForFunction(() => localStorage.getItem("fuobe.notifications") === "off");
    await ctx.close();
  }
  console.log("\nnotifications: all checks passed");
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
