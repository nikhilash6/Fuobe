// Assist flows in a real browser (demo mode is fine: the offline planner answers without an LLM).
// Usage: node tests/e2e/assist-flows.mjs [appUrl] [--shots=<dir>] [--dark]
//
// 1. `/` opens the skill menu; picking Product Photographer shows its chip; sending starts a chat
//    with the skill loaded and an approval card that runs demo generations.
// 2. "Remember that …" asks first (the card doesn't say it's saved until Remember), then the card and the
//    assistant say it's saved, and the memory is on the Memory page.
// 3. A project with instructions and a note source; a chat started there carries the project.
// 4. A skill uploaded as a .zip shows up in My skills, opens, and can be deleted.
// 5. Free / Smart / Manual: the mode picker offers Manual's models and effort.
// 6. At 390 px the Assist sidebar opens as a sheet and the page doesn't scroll sideways.
// 7. Save as skill (W3): a chat whose plan ran (a picture from an attached photo) is saved from the header with the
//    photo as the input that varies; then `/name` plus a new photo in a new chat shows one card that runs it. At 390 px
//    the header keeps Save as skill and its review fits the screen.
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, launch, openRoute, PHONE, root } from "./_browser.mjs";

const args = process.argv.slice(2);
const app = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const shots = args.find((a) => a.startsWith("--shots="))?.slice(8);
const scheme = args.includes("--dark") ? "dark" : "light";

const failures = [];
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message.split("\n")[0]}`);
    failures.push(name);
  }
};
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}-${scheme}.png` });

/** A stored ZIP with one skill folder (no compression, so no dependency). */
function skillZip(name) {
  const md = Buffer.from(`---\nname: ${name}\ntitle: E2E Recipe Reels\ndescription: Turns a recipe into a short vertical cooking reel.\nwhen_to_use: The user shares a recipe.\n---\n\n# Recipe reels\n\n1. Write a 30-second script.\n2. Make 3 vertical shots.\n`);
  const notes = Buffer.from("Keep it under 30 seconds.\n");
  const files = [
    { name: `${name}/SKILL.md`, data: md },
    { name: `${name}/notes.md`, data: notes },
  ];
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const parts = [];
  const dir = [];
  let off = 0;
  for (const f of files) {
    const n = Buffer.from(f.name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc(f.data), 14);
    h.writeUInt32LE(f.data.length, 18);
    h.writeUInt32LE(f.data.length, 22);
    h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc(f.data), 16);
    c.writeUInt32LE(f.data.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    parts.push(h, n, f.data);
    dir.push(c, n);
    off += 30 + n.length + f.data.length;
  }
  const d = Buffer.concat(dir);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(files.length, 8);
  e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(d.length, 12);
  e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, d, e]);
}

const browser = await launch();
const errors = [];
const ctx = await browser.newContext({ ...DESKTOP, colorScheme: scheme });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));

await step("skill menu, chip and a chat with the skill loaded", async () => {
  await openRoute(page, `${app}/assist`);
  const box = page.getByRole("textbox", { name: "Message" });
  await box.click();
  await box.type("/prod");
  await page.getByRole("option", { name: /Product Photographer/ }).waitFor({ timeout: 10_000 });
  await shot(page, "flow-skill-menu");
  await box.press("Enter");
  await page.getByText("Product Photographer", { exact: true }).first().waitFor();
  await box.type("a matte black perfume bottle on travertine");
  await box.press("Enter");
  await page.waitForURL(/\/assist\?c=/, { timeout: 20_000 });
  await page.getByRole("button", { name: /^Run/ }).waitFor({ timeout: 30_000 });
  await shot(page, "flow-approval");
  await page.getByRole("button", { name: /^Run/ }).click();
  await page.getByText(/On it — the results will appear here/).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Open / }).first().waitFor({ timeout: 60_000 });
  await shot(page, "flow-results");
});

await step("remember asks first, then shows on the Memory page", async () => {
  await openRoute(page, `${app}/assist`);
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill("Remember that I always want vertical 9:16 videos");
  await box.press("Enter");
  await page.getByText("Remember this?").waitFor({ timeout: 30_000 });
  // Asked first: before the yes, the card says what Remember does, not that it's done.
  await page.getByText("Saves to memory for future chats", { exact: true }).waitFor({ timeout: 10_000 });
  await shot(page, "flow-remember");
  await page.getByRole("button", { name: "Remember", exact: true }).click();
  // Then the card says it's saved and the assistant says so too: two lines that both start "Saved to memory", so each
  // is waited for by its own words (one pattern for both matches one or two of them, depending on how fast the reply is).
  await page.getByText("Saved to memory for future chats", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText(/^Saved to memory — every chat will follow it/).waitFor({ timeout: 30_000 });
  await openRoute(page, `${app}/assist/memory`);
  await page.getByText("I always want vertical 9:16 videos.").waitFor({ timeout: 15_000 });
  await shot(page, "flow-memory");
});

await step("a project with instructions and a note; its chats carry it", async () => {
  await openRoute(page, `${app}/assist/skills`);
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name").fill("E2E Spring campaign");
  await page.getByLabel("Instructions").fill("Everything is for a spring sneaker drop: pastel palette, 9:16.");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/assist\/projects\//, { timeout: 15_000 });
  await page.getByRole("heading", { name: /What are we creating in E2E Spring campaign/ }).waitFor();
  await page.getByRole("tab", { name: /Sources/ }).click();
  await page.getByRole("button", { name: "Note" }).click();
  await page.getByLabel("Title").fill("Brand voice");
  await page.getByLabel("Text").fill("Playful, short sentences, no jargon.");
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByText("Brand voice").first().waitFor({ timeout: 10_000 });
  await shot(page, "flow-project");
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill("Three sneaker stills on pastel backdrops");
  await box.press("Enter");
  await page.waitForURL(/\/assist\?c=/, { timeout: 20_000 });
  await page.getByRole("link", { name: /E2E Spring campaign/ }).first().waitFor({ timeout: 15_000 });
});

await step("upload a .zip skill, open it, delete it", async () => {
  const name = `e2e-recipe-${Date.now().toString(36)}`;
  await openRoute(page, `${app}/assist/skills`);
  await page.locator('input[type="file"]').setInputFiles({ name: `${name}.zip`, mimeType: "application/zip", buffer: skillZip(name) });
  await page.getByRole("tab", { name: /My skills/ }).waitFor();
  await page.getByText("E2E Recipe Reels").first().waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "E2E Recipe Reels" }).click();
  await page.getByRole("dialog").getByText("notes.md").waitFor();
  await shot(page, "flow-skill-detail");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await page.getByText("No skills of your own yet").waitFor({ timeout: 10_000 });
});

await step("mode picker offers Manual with models and effort", async () => {
  await openRoute(page, `${app}/assist`);
  await page.getByRole("button", { name: /^Mode:/ }).click();
  await page.getByRole("radio", { name: "Manual" }).click();
  await page.getByRole("radio", { name: /Offline planner/ }).waitFor();
  await shot(page, "flow-mode");
  await page.keyboard.press("Escape");
});

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, file))], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}

let savedChat = null;
const savedSkill = `e2e-chat-skill-${scheme}-${Date.now().toString(36)}`;
await step("save a chat as a skill, then /skill plus an attachment runs it on one card", async () => {
  const photo = await upload("public/samples/grade-sample.jpg", "image/jpeg", "lamp.jpg");
  // A chat whose plan ran: a picture made from the attached photo, approved on its card.
  const res = await fetch(`${app}/api/assist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Put this desk lamp on a travertine plinth, soft window light", attachments: [photo], engine: "cloud", autoApprove: false }),
  });
  savedChat = (await res.json()).id;
  await openRoute(page, `${app}/assist?c=${savedChat}`);
  await page.getByRole("button", { name: /^Run/ }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Open / }).first().waitFor({ timeout: 60_000 });
  // Every take finished (a step still running can't be saved yet).
  for (const until = Date.now() + 60_000; Date.now() < until; await page.waitForTimeout(500)) {
    const v = await (await fetch(`${app}/api/assist/${savedChat}`)).json();
    if (v.generations?.length && v.generations.every((g) => ["succeeded", "failed", "canceled"].includes(g.status))) break;
  }
  // Save as skill from the header: the steps that ran, the photo switched to Varies, checked for free, saved.
  await page.getByRole("button", { name: "Save as skill" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Save as skill" }).waitFor({ timeout: 15_000 });
  await dialog.getByText("What changes next time").waitFor({ timeout: 30_000 });
  await dialog.getByRole("radiogroup", { name: /^Image: fixed or varies/ }).getByRole("radio", { name: "Varies" }).click();
  await page.locator("#sb-name").fill(savedSkill);
  await shot(page, "flow-save-skill");
  await dialog.getByRole("button", { name: "Test run (free)" }).click();
  await dialog.getByText(/^It runs on /).waitFor({ timeout: 60_000 });
  await dialog.getByRole("button", { name: "Save skill" }).click();
  await page.getByRole("dialog").getByText(/Try it with new inputs/).waitFor({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  const view = await (await fetch(`${app}/api/assist/skills/${savedSkill}/recipe`)).json();
  if (view?.recipe?.source?.from !== "assist" || view.recipe.params.length !== 1) throw new Error(`saved recipe: ${JSON.stringify(view?.recipe?.source)} ${view?.recipe?.params?.length} inputs`);
  // A new chat: /name and a new photo → one card titled by the skill → Run.
  await openRoute(page, `${app}/assist`, { settleMs: 2000 });
  const box = page.getByRole("textbox", { name: "Message" });
  await box.click();
  // The whole name typed: the skill's chip shows above the words (its menu has nothing left to offer).
  await box.type(`/${savedSkill} `);
  await page.getByRole("button", { name: `Don't use ${view.title}` }).waitFor({ timeout: 10_000 });
  await page.locator('input[type="file"][accept^="image/"]').setInputFiles(path.join(root, "public/samples/grade-sample.jpg"));
  // Sent once the photo has uploaded (its preview switches to the stored file).
  await page.locator('img[src^="/api/files/"]').first().waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForURL(/\/assist\?c=/, { timeout: 20_000 });
  await page.getByText(/^I'll run your .+ skill with your image/).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Run/ }).waitFor({ timeout: 30_000 });
  await shot(page, "flow-run-skill-card");
  await page.getByRole("button", { name: /^Run/ }).click();
  await page.getByText(/On it — the results will appear here/).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Open / }).first().waitFor({ timeout: 60_000 });
  await shot(page, "flow-run-skill-results");
});

await ctx.close();

await step("phone: Save as skill stays in the header and its review fits", async () => {
  if (!savedChat) throw new Error("no chat to save");
  const phone = await browser.newContext({ ...PHONE, colorScheme: scheme });
  const p = await phone.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await openRoute(p, `${app}/assist?c=${savedChat}`);
  await p.getByRole("button", { name: "Save as skill" }).click();
  await p.getByRole("dialog").getByText("What changes next time").waitFor({ timeout: 30_000 });
  await p.waitForTimeout(400);
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (wide > 0) throw new Error(`the review is ${wide}px too wide`);
  await shot(p, "flow-phone-save-skill");
  await phone.close();
  await fetch(`${app}/api/assist/skills/${savedSkill}`, { method: "DELETE" });
});

await step("phone: the sidebar opens as a sheet; no sideways scroll", async () => {
  const phone = await browser.newContext({ ...PHONE, colorScheme: scheme });
  const p = await phone.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  for (const r of ["/assist", "/assist/skills", "/assist/memory", "/assist/scheduled"]) {
    await openRoute(p, app + r);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (wide > 0) throw new Error(`${r} is ${wide}px too wide`);
  }
  await openRoute(p, `${app}/assist`);
  await p.getByRole("button", { name: "Chats, projects, skills, memory and scheduled tasks" }).click();
  await p.getByRole("dialog").getByRole("link", { name: "Skills" }).waitFor();
  await p.getByRole("dialog").getByRole("link", { name: "Scheduled" }).waitFor();
  await shot(p, "flow-phone-rail");
  await phone.close();
});

await browser.close();
if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
console.log(failures.length ? `${failures.length} failed: ${failures.join("; ")}` : "All Assist flows passed.");
process.exit(failures.length || errors.length ? 1 : 0);
