// A refused change shows one card, in the browser. A guest presses Face Swap's Target photo: no file chooser opens (the
// upload could only be refused), and "Create a free account to add your own files" opens alone (no error toast, no trip
// to the sign-in page). Its Log in and Sign up free open the sign-in page with the card closed, Back closes it too, and
// a wrong password on the sign-in page is the form's own error. An upload sent anyway is refused with the same card.
// Color Grading runs in the browser: a guest grades a picture of its own there, with no card and no upload.
// A run keeps the run's words: a guest presses Generate in the Image studio ("Create a free account to run this"). A
// guest's message in Assist opens no card (it's the owner's: "Assist runs on the studio owner's AI…" is its toast, as
// an account's).
// Then an account with neither a GPU nor a key: Target photo opens "Connect your GPU or add a key to add your own files"
// instead of the file chooser, its form inside it, closed when the page changes; an upload sent anyway is refused (403)
// with the same card; Color Grading still grades its own picture. None on a message in Assist (it's the owner's, the
// same toast), and its Generate in the Image studio opens "Connect your GPU to run this".
// Usage: node tests/e2e/guest-prompt.mjs [appUrl] [--shots <dir>]   (the app with a password and FUOBE_PUBLIC_SIGNUP=1).
// Signs up one throwaway account. Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, openRoute, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const shot = (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });

const picture = path.join(root, "public/samples/grade-sample.jpg");
const FACE_SWAP = "/apps/app-face-swap";
const TARGET = /^Target photo \(required\): upload$/;
const GUEST_CARD = "Create a free account to add your own files";
const GUEST_RUN_CARD = "Create a free account to run this";
const GPU_CARD = "Connect your GPU or add a key to add your own files";
const GPU_RUN_CARD = "Connect your GPU to run this";

const browser = await launch();
const contextFor = async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { context, page };
};

/** The open dialogs' titles, the error toasts, and the path: what the visitor sees. */
const seen = async (page) => ({
  cards: await page.getByRole("dialog").locator("h2").allTextContents(),
  errors: await page.locator("[data-sonner-toast][data-type=error]").allTextContents(),
  path: new URL(page.url()).pathname,
});
const settled = (page) => page.waitForTimeout(1500);

/** Press a tile: whether the file chooser opened (it gets the picture), and how many uploads the page sent. */
async function press(page, name) {
  let uploads = 0;
  const count = (r) => new URL(r.url()).pathname === "/api/uploads" && r.method() === "POST" && uploads++;
  page.on("request", count);
  const chooser = page.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null);
  await page.getByRole("button", { name }).first().click();
  const opened = await chooser;
  if (opened) await opened.setFiles(picture);
  await page.waitForTimeout(1000);
  page.off("request", count);
  return { chooser: !!opened, uploads };
}

/** An upload sent anyway (as a script would): the server's answer. The page's own fetch, so its card opens. */
const uploadAnyway = (page) =>
  page.evaluate(async () => {
    const r = await fetch("/api/uploads", {
      method: "POST",
      body: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
      headers: { "Content-Type": "image/png", "X-File-Name": "photo.png" },
    });
    return { status: r.status, guest: r.headers.get("x-fuobe-guest"), gpu: r.headers.get("x-fuobe-connect-gpu") };
  });

/** Grade a picture of one's own in Color Grading: it opens in the grader, with no card and no upload. */
async function gradeOwnPicture(page, who) {
  await openRoute(page, `${app}/color-grade`);
  const pressed = await press(page, "Image: upload");
  await page.locator("canvas").first().waitFor({ timeout: 15_000 }).catch(() => {});
  await settled(page);
  const s = await seen(page);
  check(`${who}: Color Grading opens the file chooser`, pressed.chooser, JSON.stringify(pressed));
  check(`${who}: and grades the picture in the browser (no card, no upload)`, (await page.locator("canvas").count()) > 0 && s.cards.length === 0 && s.errors.length === 0 && pressed.uploads === 0, JSON.stringify({ ...s, ...pressed }));
}

/** Write a prompt in the Image studio and press Generate, once the composer is live, and wait for the run's answer. */
async function generateImage(page) {
  await openRoute(page, `${app}/image`);
  await page.waitForSelector("[data-composer-toolbar]", { timeout: 60_000 });
  await page.waitForFunction(() => Object.keys(document.querySelector("[data-composer-toolbar]") ?? {}).some((k) => k.startsWith("__react")), null, { timeout: 60_000 });
  await page.locator("[data-composer] textarea").fill("A red wool coat on a model, studio light");
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/generations" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  return answered;
}

/** Send a message in Assist, and wait for the server's answer. */
async function sendInAssist(page) {
  await openRoute(page, `${app}/chat/make`);
  const box = page.locator("textarea").first();
  await box.fill("Plan a three-shot teaser for a summer coat");
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/assist" && r.request().method() === "POST");
  await box.press("Enter");
  return answered;
}

try {
  // ---------------------------------------------------------------------------
  // A guest in Face Swap.
  {
    const { context, page } = await contextFor();
    await openRoute(page, `${app}${FACE_SWAP}`);
    const pressed = await press(page, TARGET);
    check("the guest's Target photo opens no file chooser, and uploads nothing", !pressed.chooser && pressed.uploads === 0, JSON.stringify(pressed));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    let s = await seen(page);
    await shot(page, "1-guest-upload");
    check("one card opens: Create a free account to add your own files", s.cards.length === 1 && s.cards[0] === GUEST_CARD, JSON.stringify(s.cards));
    check("no error toast on top of it", s.errors.length === 0, JSON.stringify(s.errors));
    check("and no trip to the sign-in page", s.path === FACE_SWAP, s.path);

    await page.getByRole("dialog").getByRole("link", { name: "Log in" }).click();
    await page.waitForURL((u) => u.pathname === "/login");
    await page.getByRole("heading", { name: "Welcome back" }).waitFor();
    await settled(page);
    s = await seen(page);
    await shot(page, "2-log-in");
    check("Log in opens the sign-in page, coming back to Face Swap", new URL(page.url()).searchParams.get("next") === FACE_SWAP, page.url());
    check("with the card closed", s.cards.length === 0, JSON.stringify(s.cards));

    // A wrong password: the form's own error, no card.
    await page.getByPlaceholder("Email").fill("nobody@example.com");
    await page.getByPlaceholder("Password").fill("not the password");
    const login = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    const refused = await login;
    await settled(page);
    s = await seen(page);
    await shot(page, "3-wrong-password");
    check("a wrong password is refused", refused.status() === 401, String(refused.status()));
    check("and is the form's own error, with no card", s.cards.length === 0 && (await page.locator("form .text-destructive").count()) === 1, JSON.stringify(s.cards));

    // Keep browsing, press Target photo again, then Back: the card closes with the page.
    await page.getByRole("link", { name: "Keep browsing as a guest" }).click();
    await page.waitForURL((u) => u.pathname === FACE_SWAP);
    await page.getByRole("button", { name: TARGET }).waitFor();
    await press(page, TARGET);
    await page.getByRole("dialog").waitFor();
    await page.goBack();
    await page.waitForURL((u) => u.pathname === "/login");
    await settled(page);
    s = await seen(page);
    check("Back closes the card (no card over the sign-in page)", s.cards.length === 0, JSON.stringify(s.cards));

    // Sign up free: the sign-up form, the card closed.
    await page.goForward();
    await page.waitForURL((u) => u.pathname === FACE_SWAP);
    await page.getByRole("button", { name: TARGET }).waitFor();
    await press(page, TARGET);
    await page.getByRole("dialog").getByRole("link", { name: "Sign up free" }).click();
    await page.getByRole("heading", { name: "Create your free account" }).waitFor();
    await settled(page);
    s = await seen(page);
    await shot(page, "4-sign-up");
    check("Sign up free opens the sign-up form with the card closed", s.path === "/login" && s.cards.length === 0, JSON.stringify(s));

    // An upload sent anyway: the server refuses it, and its card says the same.
    await openRoute(page, `${app}${FACE_SWAP}`);
    const res = await uploadAnyway(page);
    check("the guest's upload is refused (401, marked for the card)", res.status === 401 && res.guest === "1", JSON.stringify(res));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    s = await seen(page);
    check("its card: Create a free account to add your own files, alone", s.cards.length === 1 && s.cards[0] === GUEST_CARD && s.errors.length === 0, JSON.stringify(s));
    await page.keyboard.press("Escape");

    // Color Grading runs in the browser: the guest's own picture, no card.
    await gradeOwnPicture(page, "the guest");
    await shot(page, "5-guest-color-grade");
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // A guest's run and Assist: a run keeps the run's words; Assist opens no card.
  {
    const { context, page } = await contextFor();
    const res = await generateImage(page);
    check("the guest's Generate is refused (401, marked for the card)", res.status() === 401 && res.headers()["x-fuobe-guest"] === "1", String(res.status()));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    let s = await seen(page);
    await shot(page, "6-guest-generate");
    check("Image: one card opens: Create a free account to run this", s.cards.length === 1 && s.cards[0] === GUEST_RUN_CARD, JSON.stringify(s.cards));
    check("Image: no error toast on top of it", s.errors.length === 0, JSON.stringify(s.errors));

    // Assist is the owner's: signing up wouldn't let the guest use it, so it gets the account's answer, not the card.
    const sent = await sendInAssist(page);
    check("the guest's message in Assist is refused (403, Assist is the owner's)", sent.status() === 403 && !sent.headers()["x-fuobe-guest"], String(sent.status()));
    await page.locator("[data-sonner-toast][data-type=error]").first().waitFor();
    await settled(page);
    s = await seen(page);
    await shot(page, "7-guest-assist-send");
    check("Assist: its own error toast, with no card", s.cards.length === 0 && s.errors.length === 1 && /owner/.test(s.errors[0]), JSON.stringify(s));
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // An account with neither a GPU nor a key: "Connect your GPU or add a key", alone, closed when the page changes.
  {
    const { context, page } = await contextFor();
    await openRoute(page, `${app}/login?signup=1`);
    await page.getByPlaceholder("Email").fill(`e2e-${Date.now()}@example.com`);
    await page.getByPlaceholder("Password (at least 8 characters)").fill("long enough password");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/connect");
    await openRoute(page, `${app}${FACE_SWAP}`);
    const pressed = await press(page, TARGET);
    check("the account's Target photo opens no file chooser until it has a GPU or a key", !pressed.chooser && pressed.uploads === 0, JSON.stringify(pressed));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    let s = await seen(page);
    await shot(page, "8-connect-gpu");
    check("one card opens: Connect your GPU or add a key to add your own files", s.cards.length === 1 && s.cards[0] === GPU_CARD, JSON.stringify(s.cards));
    check("no error toast on top of it", s.errors.length === 0, JSON.stringify(s.errors));
    const sideways = await page.getByRole("dialog").evaluate((d) => d.scrollWidth - d.clientWidth);
    check("its form fits inside it (nothing cut off at the right)", sideways <= 0, `${sideways}px`);
    await page.goBack();
    await page.waitForURL((u) => u.pathname === "/connect");
    await settled(page);
    s = await seen(page);
    check("Back closes it", s.cards.length === 0, JSON.stringify(s.cards));

    // An upload sent anyway: refused until it connects a GPU or adds a key, with the same card.
    await openRoute(page, `${app}${FACE_SWAP}`);
    const res = await uploadAnyway(page);
    check("the account's upload is refused until it has a GPU or a key (403)", res.status === 403 && res.gpu === "1", JSON.stringify(res));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    s = await seen(page);
    check("its card: Connect your GPU or add a key, alone", s.cards.length === 1 && s.cards[0] === GPU_CARD && s.errors.length === 0, JSON.stringify(s));
    await page.keyboard.press("Escape");

    // Color Grading runs in the browser: no GPU or key needed for its own picture.
    await gradeOwnPicture(page, "the account");
    await shot(page, "9-account-color-grade");

    // A message in Assist (its own fetch helper): Assist is the owner's, and a GPU wouldn't change that, so no card.
    const sent = await sendInAssist(page);
    check("the account's message in Assist is refused (403, Assist is the owner's)", sent.status() === 403 && !sent.headers()["x-fuobe-connect-gpu"], String(sent.status()));
    await page.locator("[data-sonner-toast][data-type=error]").first().waitFor();
    await settled(page);
    s = await seen(page);
    await shot(page, "10-account-assist-send");
    check("Assist: its own error toast, with no card", s.cards.length === 0 && s.errors.length === 1 && /owner/.test(s.errors[0]), JSON.stringify(s));
    // Gone before Generate, so nothing else is counted with its card.
    await page.locator("[data-sonner-toast][data-type=error]").first().waitFor({ state: "detached", timeout: 20_000 });

    // A run keeps the run's words: "Connect your GPU to run this".
    const made = await generateImage(page);
    check("the account's Generate is refused until it has a GPU or a key (403)", made.status() === 403 && made.headers()["x-fuobe-connect-gpu"] === "1", String(made.status()));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    s = await seen(page);
    await shot(page, "11-account-generate");
    check("Image: one card opens: Connect your GPU to run this", s.cards.length === 1 && s.cards[0] === GPU_RUN_CARD && s.errors.length === 0, JSON.stringify(s));
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
