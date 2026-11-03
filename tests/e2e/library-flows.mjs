// Library flows (round 4): helper steps hidden by default, pins, review status, nested folders with
// drag and drop and breadcrumbs, folder zips, deleting uploads, and the phone layout of all that.
// Usage: node tests/e2e/library-flows.mjs [appUrl] [--keep]   (the app must be running; demo mode is fine)
//
// It makes its own results, folders and uploads, all named with a run tag, and searches for that tag,
// so a library that's already in use doesn't confuse it. At the end (also after a crash) it deletes
// everything with the tag for good: the results, their files, the folders and the uploads. --keep
// leaves them, to look at. Exits 1 when a check fails.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DESKTOP, launch, openRoute, PHONE } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const keep = process.argv.includes("--keep");
const tag = `lf${Date.now().toString(36)}`;
let failed = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

async function call(route, method = "GET", body) {
  const res = await fetch(app + route, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const gen = (id) => call(`/api/generations/${id}`);
const folders = async () => (await call("/api/folders")).items;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
async function upload(name) {
  const form = new FormData();
  form.append("file", new File([PNG], name, { type: "image/png" }));
  return (await fetch(`${app}/api/uploads`, { method: "POST", body: form })).json();
}

/** Delete everything this run made (by its tag), for good: results (Trash included) with their files, folders, uploads. */
async function cleanup() {
  if (keep) return console.log(`kept this run's data: search the Library for ${tag}`);
  try {
    for (const f of (await folders()).filter((f) => f.name.startsWith(tag))) await fetch(`${app}/api/folders/${f.id}`, { method: "DELETE" });
    const ids = new Set();
    for (const list of ["/api/generations", "/api/generations/trash"]) for (const g of (await call(`${list}?q=${tag}&steps=1&limit=200`)).items) ids.add(g.id);
    if (ids.size) await call("/api/generations/bulk", "POST", { action: "delete", ids: [...ids] });
    // With the results gone, nothing uses the uploads any more.
    for (const a of (await call("/api/assets?source=upload&limit=200")).items.filter((a) => a.name?.startsWith(tag))) await fetch(`${app}/api/assets/${a.id}`, { method: "DELETE" });
    console.log(`cleaned up: ${ids.size} results and this run's folders and uploads`);
  } catch (e) {
    console.log(`cleanup failed (search the Library for ${tag}): ${e.message}`);
  }
}

let crashed = null;
let browser = null;
const errors = [];
try {
  // --- What the checks work on -------------------------------------------------------------------
  const words = ["fox in snow", "koi pond", "lighthouse keeper", "paper boats", "sleeping cat"];
  const made = [];
  for (const w of words) made.push((await call("/api/generations", "POST", { feature: "image", modelId: "nano-banana-pro", prompt: `${tag} ${w}` })).items[0]);
  await call("/api/generations", "POST", { feature: "shorts-step", modelId: "nano-banana-pro", prompt: `${tag} helper step` });
  const used = await upload(`${tag}-used.png`);
  const free = await upload(`${tag}-free.png`);
  await call("/api/generations", "POST", { feature: "edit", modelId: "nano-banana-pro", op: "edit", prompt: `${tag} edit of the upload`, inputs: { images: [used.url] } });
  const A = await call("/api/folders", "POST", { name: `${tag} A` });
  const B = await call("/api/folders", "POST", { name: `${tag} B`, parentId: A.id });
  const C = await call("/api/folders", "POST", { name: `${tag} C`, parentId: B.id });
  const D = await call("/api/folders", "POST", { name: `${tag} D` });
  await call("/api/generations/bulk", "POST", { action: "move", ids: [made[0].id], folderId: A.id });
  await call("/api/generations/bulk", "POST", { action: "move", ids: [made[2].id], folderId: B.id });
  await call("/api/generations/bulk", "POST", { action: "move", ids: [made[3].id], folderId: C.id });
  // Demo results take a few seconds.
  for (let i = 0; i < 60; i++) {
    const items = (await call(`/api/generations?q=${tag}&steps=1&limit=50`)).items;
    if (items.length >= 7 && items.every((g) => g.status === "succeeded")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  browser = await launch();
  const ctx = await browser.newContext({ ...DESKTOP, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const card = (name) => page.locator("div.group\\/card", { has: page.getByRole("button", { name: new RegExp(`Open “${tag} ${name}`) }) });
  const folderCard = (f) => page.getByRole("listitem").filter({ hasText: f.name }).locator("div.group\\/folder");
  const openCards = () => page.getByRole("button", { name: new RegExp(`^Open “${tag}`) }).count();
  async function library(route = "/library") {
    await openRoute(page, app + route, { settleMs: 1500 });
    await page.getByRole("textbox", { name: "Search prompts" }).fill(tag);
    await page.waitForTimeout(1500);
  }
  async function tileMenu(name, item) {
    await card(name).hover();
    await card(name).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: item }).click();
  }

  // --- Helper steps, review status, pins ----------------------------------------------------------
  await library();
  check("helper steps are hidden", (await page.getByRole("button", { name: new RegExp(`Open “${tag} helper step`) }).count()) === 0);
  await page.getByRole("button", { name: /Show steps/ }).click();
  await page.waitForTimeout(1500);
  check("Show steps reveals them", (await page.getByRole("button", { name: new RegExp(`Open “${tag} helper step`) }).count()) === 1);
  await page.getByRole("button", { name: /Showing steps/ }).click();

  await tileMenu("lighthouse keeper", "Review status");
  await page.getByRole("menuitemradio", { name: /Needs review/ }).click();
  await page.waitForTimeout(800);
  check("the tile menu sets a review status", (await gen(made[2].id)).review === "needs-review");
  check("…shown as a badge", (await card("lighthouse keeper").getByLabel("Review: Needs review").count()) === 1);

  await tileMenu("koi pond", "Pin to top");
  await page.waitForTimeout(1200);
  const pinned = page.locator("section", { has: page.getByRole("heading", { name: /^Pinned/ }) });
  check("Pin to top puts it in the Pinned section", (await pinned.getByRole("button", { name: new RegExp(`Open “${tag} koi pond`) }).count()) === 1);
  await pinned.getByRole("button", { name: new RegExp(`Open “${tag} koi pond`) }).click({ force: true });
  await page.getByRole("combobox", { name: "Review status" }).click();
  await page.getByRole("option", { name: "Approved" }).click();
  await page.waitForTimeout(600);
  check("the viewer's Review picker sets it", (await gen(made[1].id)).review === "approved");
  // Focus is back on the picker: what you type goes to it (R jumps to Rejected), not to the viewer's shortcuts.
  await page.keyboard.press("p");
  await page.waitForTimeout(800);
  check("keys typed in the Review picker aren't viewer shortcuts", !!(await gen(made[1].id)).pinnedAt);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("p");
  await page.waitForTimeout(800);
  check("P in the viewer unpins", (await gen(made[1].id)).pinnedAt === null);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Select", exact: true }).click();
  for (const w of ["paper boats", "sleeping cat"]) await page.getByRole("button", { name: new RegExp(`Select “${tag} ${w}`) }).first().click({ force: true });
  const bar = page.getByRole("toolbar", { name: "Selection" });
  await bar.getByRole("button", { name: "Pin" }).click();
  await page.waitForTimeout(800);
  await bar.getByRole("button", { name: "Review status" }).click();
  await page.getByRole("menuitemradio", { name: /Rejected/ }).click();
  await page.waitForTimeout(800);
  const [g3, g4] = [await gen(made[3].id), await gen(made[4].id)];
  check("the bulk bar pins and reviews several", !!g3.pinnedAt && !!g4.pinnedAt && g3.review === "rejected" && g4.review === "rejected");
  await page.getByRole("button", { name: "Unselect all" }).click();

  // --- Select all (N), a date's Select, Ctrl/⌘+A, Esc ---------------------------------------------
  {
    await library();
    const shown = await openCards();
    const picked = () => page.getByRole("button", { name: new RegExp(`^Select “${tag}`), pressed: true }).count();
    const selectAll = bar.getByRole("button", { name: /^Select all \d+$/ });
    await page.getByRole("button", { name: "Select", exact: true }).click();
    check("Select all names how many are shown", (await selectAll.getAttribute("aria-label")) === `Select all ${shown}`, await selectAll.getAttribute("aria-label"));
    await selectAll.click();
    check("Select all (N) selects every result shown", (await picked()) === shown && (await selectAll.count()) === 0, `${await picked()} of ${shown}`);
    await page.keyboard.press("Escape");
    check("Esc unselects and leaves selection mode", (await bar.count()) === 0);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const pinnedSection = page.locator("section", { has: page.getByRole("heading", { name: /^Pinned/ }) });
    await pinnedSection.getByRole("button", { name: /^Select Pinned, 2$/ }).click();
    check("a section's Select takes that section", (await picked()) === 2 && (await pinnedSection.getByRole("button", { name: /^Unselect Pinned/ }).count()) === 1, `${await picked()} picked`);
    await pinnedSection.getByRole("button", { name: /^Unselect Pinned/ }).click();
    check("…and Unselect gives it back", (await picked()) === 0);
    await page.keyboard.press("ControlOrMeta+a");
    check("Ctrl/⌘+A in selection mode selects everything shown", (await picked()) === shown, `${await picked()} of ${shown}`);
    // A search that hides the selection: Select all is back for the results left, and the count is what's shown.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    for (const w of ["paper boats", "sleeping cat"]) await page.getByRole("button", { name: new RegExp(`Select “${tag} ${w}`) }).first().click({ force: true });
    await page.getByRole("textbox", { name: "Search prompts" }).fill(`${tag} fox`);
    await page.waitForTimeout(1500);
    check("a selection hidden by a search: Select all is offered for what's shown", (await selectAll.count()) === 1 && /^Select\b/.test((await bar.innerText()).trim()), (await bar.innerText()).replace(/\s+/g, " "));
    await page.getByRole("button", { name: "Unselect all" }).click();
    await page.getByRole("textbox", { name: "Search prompts" }).fill(tag);
    await page.waitForTimeout(1500);
  }

  await page.getByRole("button", { name: /Any status/ }).click();
  await page.getByRole("radio", { name: /^Rejected/ }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  check("the review filter", (await openCards()) === 2, `${await openCards()} shown`);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: /^Pinned/ }).click();
  await page.waitForTimeout(1200);
  check("the Pinned filter", (await openCards()) === 2, `${await openCards()} shown`);
  await page.getByRole("button", { name: /^Pinned/ }).click();
  await page.waitForTimeout(800);

  // --- Nested folders: drag and drop, breadcrumbs, moves, zip, delete -----------------------------
  await card("fox in snow").locator("[draggable=true]").first().dragTo(folderCard(D));
  await page.waitForTimeout(1200);
  check("a card dropped on a folder moves into it", (await gen(made[0].id)).folderId === D.id);
  await folderCard(D).dragTo(folderCard(A));
  await page.waitForTimeout(1500);
  check("a folder dropped on another nests in it", (await folders()).find((f) => f.id === D.id)?.parentId === A.id);
  await openRoute(page, `${app}/library?folder=${A.id}`, { settleMs: 1500 });
  await folderCard(D).dragTo(page.getByRole("navigation", { name: "Folder path" }).getByRole("button", { name: /Library/ }));
  await page.waitForTimeout(1500);
  check("a folder dropped on the Library crumb goes to the top", (await folders()).find((f) => f.id === D.id)?.parentId === null);
  const loop = await fetch(`${app}/api/folders/${A.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId: C.id }) });
  check("moving a folder into its own subfolder is refused", loop.status === 409);
  await openRoute(page, `${app}/library?folder=${C.id}`, { settleMs: 1500 });
  const crumbs = await page.getByRole("navigation", { name: "Folder path" }).innerText();
  check("breadcrumbs name the path", crumbs.includes(A.name) && crumbs.includes(B.name), crumbs.replace(/\s+/g, " "));

  await openRoute(page, `${app}/library?folder=${A.id}`, { settleMs: 1500 });
  await page.getByRole("button", { name: `Actions for ${A.name}` }).click();
  await page.getByRole("menuitem", { name: "Move to" }).click();
  const sub = page.getByRole("menuitem", { name: B.name });
  check("Move to: its own subfolder is disabled", (await sub.getAttribute("data-disabled")) !== null || (await sub.getAttribute("aria-disabled")) === "true");
  await openRoute(page, `${app}/library?folder=${A.id}`, { settleMs: 1000 });
  await page.getByRole("button", { name: `Actions for ${A.name}` }).click();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20_000 }).catch(() => null), page.getByRole("menuitem", { name: "Download (.zip)" }).click()]);
  if (download) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-zip-")), "folder.zip");
    await download.saveAs(file);
    const names = execFileSync("python3", ["-I", "-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print('|'.join(sorted(z.namelist())))", file]).toString().trim();
    check("the folder zip keeps subfolders as paths", names.includes(`${B.name}/`) && names.includes(`${B.name}/${C.name}/`), names);
  } else check("the folder zip downloads", false);

  await openRoute(page, `${app}/library?folder=${B.id}`, { settleMs: 1500 });
  await page.getByRole("button", { name: `Actions for ${B.name}` }).last().click();
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await page.getByRole("button", { name: "Delete folder" }).click();
  await page.waitForTimeout(1500);
  const after = await folders();
  check("deleting a folder moves its subfolders up", after.find((f) => f.id === C.id)?.parentId === A.id && !after.some((f) => f.id === B.id));
  check("…and its results", (await gen(made[2].id)).folderId === A.id);
  check("…and opens its parent", new URL(page.url()).searchParams.get("folder") === A.id);

  // --- The Trash shows everything in it, helper steps too ------------------------------------------
  const helper = (await call(`/api/generations?q=${encodeURIComponent(`${tag} helper`)}&steps=1`)).items[0];
  await call("/api/generations/bulk", "POST", { action: "trash", ids: [helper.id] });
  // Pinned on in All, then the Trash tab: it has no pins, so the filter is off there (no Clear filters for a chip it doesn't show).
  await library();
  await page.getByRole("button", { name: /^Pinned/ }).click();
  await page.waitForTimeout(800);
  await page.getByRole("tab", { name: /^Trash/ }).click();
  await page.waitForTimeout(1500);
  check("the Trash lists a trashed helper step", (await page.getByRole("button", { name: new RegExp(`Open “${tag} helper step`) }).count()) === 1);
  check("…and a Pinned filter chosen in All doesn't apply there", (await page.getByRole("button", { name: "Clear filters" }).count()) === 0);
  await page.getByRole("tab", { name: /^All/ }).click();
  await page.waitForTimeout(800);
  check("…but is still on back in All", (await page.getByRole("button", { name: /^Pinned/ }).getAttribute("aria-pressed")) === "true");

  // --- Uploads ------------------------------------------------------------------------------------
  await openRoute(page, `${app}/library?tab=uploads`, { settleMs: 1500 });
  await page.getByRole("textbox", { name: "Search prompts" }).fill(tag);
  await page.waitForTimeout(800);
  const uploadCard = (n) => page.locator("div.group\\/card", { has: page.getByRole("button", { name: new RegExp(`Open “${tag}-${n}`) }) });
  await page.getByRole("button", { name: new RegExp(`Open “${tag}-used`) }).click({ force: true });
  // An upload's details are its own (source, type, added): a file has no review status.
  await page.getByRole("dialog").getByText("Added", { exact: true }).waitFor({ timeout: 10_000 }).catch(() => {});
  check("an upload's viewer has no Review picker", (await page.getByRole("dialog").getByText("Added", { exact: true }).count()) > 0 && (await page.getByRole("combobox", { name: "Review status" }).count()) === 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await uploadCard("used").hover();
  await uploadCard("used").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete for good…" }).click();
  await page.getByText(/still in use/).waitFor({ timeout: 20_000 }).catch(() => {});
  const said = (await page.getByRole("alertdialog").innerText()).replace(/\s+/g, " ");
  check("an upload in use says where", /still in use/.test(said) && /1 result/.test(said), said);
  await page.getByRole("button", { name: "OK" }).click();
  await uploadCard("free").hover();
  await uploadCard("free").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete for good…" }).click();
  await page.getByRole("button", { name: "Delete upload" }).click({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  const left = (await call("/api/assets?source=upload&limit=200")).items.map((a) => a.id);
  check("a free upload is deleted", !left.includes(free.id) && left.includes(used.id));
  await ctx.close();

  // --- Phones: nothing scrolls sideways, the bulk bar fits ------------------------------------------
  for (const scheme of ["light", "dark"]) {
    const phone = await (await browser.newContext({ ...PHONE, colorScheme: scheme })).newPage();
    for (const route of ["/library", `/library?folder=${C.id}`, "/library?tab=uploads"]) {
      await openRoute(phone, app + route, { settleMs: 1200 });
      const fits = await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      check(`390 px, ${scheme}: ${route.replace(C.id, "<folder>")} fits`, fits);
    }
    await openRoute(phone, `${app}/library`, { settleMs: 1200 });
    await phone.getByRole("button", { name: "Select", exact: true }).click();
    await phone.getByRole("button", { name: /^Select “/ }).first().click({ force: true });
    const bar = await phone.getByRole("toolbar", { name: "Selection" }).evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    check(`390 px, ${scheme}: every bulk action fits`, bar);
    await phone.context().close();
  }

} catch (e) {
  crashed = e;
  console.log(`FAIL the script stopped: ${e.stack ?? e}`);
} finally {
  await browser?.close().catch(() => {});
  await cleanup();
}
if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
console.log(crashed ? "The run stopped early" : failed ? `${failed} check(s) failed` : "All library checks passed");
process.exit(crashed || failed || errors.length ? 1 : 0);
