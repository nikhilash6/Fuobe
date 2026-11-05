# UX and speed audit, round 4

_As of 2026-10-22. Branch `claude/fuobe-parity-4` at commit `d781de1`. The yardstick is the user's bar ("fast, friendly and amazing to use", shadcn UI, Liner as the design inspiration), Liner's design language as recorded in [`liner-ui.md`](liner-ui.md), and the parity studio's flows as recorded in [`parity-inventory.md`](parity-inventory.md) §1.3 and §8, [`parity-studios.md`](parity-studios.md) and [`parity-marketing-agents.md`](parity-marketing-agents.md). No code was changed for this audit._

## 1. The short version

- **Speed is good on a desktop.** Cold loads paint in 128–284 ms (FCP) and are interactive by 287–592 ms. Total blocking time is 81 ms or less. Sidebar clicks paint the next page in 55–156 ms (one outlier: 403 ms for the first visit to Marketing Studio). With the CPU slowed 4x, phone-sized loads paint in 336–1,140 ms. Every interaction measured stayed at or under 208 ms.
- **The first run is where Fuobe loses people.** With nothing connected, Home shows one grey sentence about demo mode. Settings → "Test connection" tests the *saved* value, not the one you just typed: a fresh fal key reports "No key set", and a new ComfyUI URL is tested against the old one. Pressing Start on Home does not start anything. It opens Image with the prompt filled in and asks a second hero question.
- **Assist's no-key planner gets its own suggestion wrong.** "Four moody portraits of a lighthouse keeper, 35mm film, then pick the best and animate it" becomes one text-to-video job with 4 takes, and the whole sentence is the prompt. The cause is a regex that only knows singular nouns (`portrait`, not `portraits`).
- **Accessibility:** there is no skip link, and the sidebar is not a `<nav>` landmark (axe flags its 49 nodes on every desktop page), so a keyboard user tabs through 46 links on every page. Most studio pages have two `<main>` landmarks. `text-subtle-foreground` (#bdbdc0, 1.87:1 on white) is used 79 times outside placeholders, about 70 of them on text.
- **Layout shift:** Assist on a phone shifts by CLS 0.142 ("poor" is over 0.1). Cinema projects shifts by 0.048, and Home and Library by about 0.037 once they have results.
- **Weight:** the shared JavaScript is 223 KB compressed per page, and pages add 57–153 KB of their own. After the page loads, Next prefetches every one of the 46 sidebar links: another 349–584 KB of JS and 34–47 RSC requests per desktop cold visit.
- **What already feels right** (keep it): the Liner-style frame and sheet, the pill composer with typing before hydration, the cmdk model picker, the viewer with keyboard hints, the narrated progress tiles, the 404 pages, the empty-state copy, and no horizontal scroll on any phone screen.

The findings in §5 are ranked P0 (blocks or misleads a first-time user) to P3 (polish). Each one names the route, the component, what is wrong, the evidence, and the exact fix.

## 2. How this audit was run

- **Build:** `pnpm build` (Next.js 16.4.2, Turbopack, `cacheComponents` and `partialPrefetching` on), 274 static pages in 1 min 19 s, log in `/tmp/claude-0/r4-ux-build.log`.
- **Server:** `pnpm start` on port 3311.
  - `FUOBE_DATA_DIR=/tmp/claude-0/r4-ux-data` was an empty data folder, so the app started in its first-run state.
  - `COMFYUI_URL` and `OLLAMA_URL` pointed at a closed port, and there were no paid keys. Demo mode was on "Automatic".
  - `/api/status` reported every provider as unconfigured except Demo and "In your browser".
  - The server was stopped at the end of the audit.
- **Browser:** Playwright with headless Chromium 1194 (`/opt/pw-browsers/chromium-1194`).
  - Desktop: 1440x900.
  - Phone: 390x844 with `isMobile`, touch and DPR 2.
  - Light and dark themes were set through `colorScheme`. The app uses next-themes with `defaultTheme="system"`.
- **Machine:** a shared 4-core container with 15 GB RAM. Other agents were building and testing in other worktrees at the same time, and the load average was 2 to 7 during the runs. Absolute times are pessimistic for a dev laptop and optimistic for a real phone, so compare routes with each other.
- **Scripts** (scratch only, not committed):
  - `measure.mjs`: cold loads. Each sample used a new browser context, so nothing was cached. Desktop is the median of 2 runs; the phone pass is 1 run with the CPU slowed 4x.
  - `transitions.mjs`: sidebar clicks, timed inside the page from the click to the new `h1` painted (two `requestAnimationFrame`s).
  - `flows.mjs`: the user flows with screenshots and Event Timing capture.
  - `axe.mjs`: axe-core 4.14.0 (from `node_modules/.pnpm/axe-core@4.14.0`), WCAG 2.0, 2.1 and 2.2 A/AA plus best-practice rules.
- **Screenshots:** in `/tmp/claude-0/r4-ux-shots/`, named `<width>-<theme>-<step>.png` (e.g. `desktop-light-05c-cinema-noname.png`). They are not in the repo.
- **Headless Chromium has no H.264.** Demo MP4 tiles render blank in these screenshots, as STATUS §3 already notes. That alone is not counted as a bug (see UX-26).

## 3. Measurements

### 3.1 Cold load, desktop 1440x900, empty library (median of 2 runs)

Times are in ms. "JS before load" and "JS after load" are compressed bytes (Resource Timing `encodedBodySize`), split at the `load` event. "RSC prefetches" are `?_rsc=` requests. TTI\* is a simplified time to interactive: the end of the last long task (over 50 ms), or DOMContentLoaded or FCP if later, after waiting for a 5.5 s quiet window. TBT is the sum of (long task − 50 ms) after FCP.

| route | TTFB | FCP | LCP | TTI* | CLS | long tasks (longest) | TBT | JS before load (files) | JS after load | RSC prefetches | HTML | DOM nodes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` | 11 | 176 | 176 | 443 | 0.010 | 1 (66 ms) | 16 | 270 KB (20) | 474 KB | 47 (122 KB) | 24 KB | 1478 |
| `/image` | 8 | 172 | 172 | 364 | 0.001 | 1 (72 ms) | 18 | 367 KB (29) | 369 KB | 34 (90 KB) | 27 KB | 633 |
| `/video` | 10 | 176 | 176 | 340 | 0.001 | 2 (63 ms) | 10 | 356 KB (28) | 349 KB | 34 (91 KB) | 26 KB | 623 |
| `/edit` | 10 | 176 | 252 | 394 | 0.001 | 1 (85 ms) | 35 | 331 KB (26) | 369 KB | 34 (91 KB) | 25 KB | 643 |
| `/apps` | 13 | 184 | 496 | 358 | 0.001 | 1 (66 ms) | 9 | 262 KB (18) | 438 KB | 38 (100 KB) | 31 KB | 1879 |
| `/apps/app-packshot` | 12 | 148 | 148 | 325 | 0.002 | 2 (56 ms) | 6 | 340 KB (27) | 369 KB | 35 (99 KB) | 26 KB | 650 |
| `/motions` | 12 | 192 | 500 | 365 | 0.001 | 2 (73 ms) | 23 | 262 KB (18) | 438 KB | 34 (90 KB) | 33 KB | 1802 |
| `/effects` | 13 | 176 | 512 | 363 | 0.001 | 1 (79 ms) | 29 | 262 KB (18) | 438 KB | 34 (80 KB) | 42 KB | 1908 |
| `/library` | 8 | 172 | 476 | 428 | 0.004 | 2 (84 ms) | 23 | 275 KB (22) | 424 KB | 34 (96 KB) | 17 KB | 613 |
| `/cinema` | 12 | 188 | 316 | 365 | 0.049 | 1 (76 ms) | 26 | 250 KB (19) | 449 KB | 34 (97 KB) | 18 KB | 550 |
| `/assist` | 7 | 144 | 352 | 287 | 0.018 | 2 (55 ms) | 5 | 286 KB (24) | 468 KB | 38 (102 KB) | 17 KB | 718 |
| `/marketing` | 9 | 128 | 244 | 314 | 0.001 | 1 (66 ms) | 16 | 319 KB (25) | 553 KB | 42 (112 KB) | 31 KB | 1488 |
| `/faceless` | 12 | 152 | 152 | 326 | 0.002 | 3 (61 ms) | 11 | 274 KB (22) | 447 KB | 35 (99 KB) | 20 KB | 639 |
| `/settings` | 8 | 152 | 424 | 316 | 0.001 | 1 (70 ms) | 16 | 244 KB (18) | 456 KB | 34 (96 KB) | 18 KB | 735 |
| `/canvas` | 8 | 168 | 492 | 376 | 0.001 | 2 (68 ms) | 10 | 336 KB (20) | 364 KB | 34 (96 KB) | 18 KB | 564 |
| `/layers` | 13 | 208 | 536 | 475 | 0.001 | 2 (120 ms) | 70 | 258 KB (19) | 441 KB | 34 (97 KB) | 16 KB | 625 |
| `/audio` | 13 | 220 | 220 | 414 | 0.001 | 2 (83 ms) | 33 | 354 KB (27) | 370 KB | 41 (104 KB) | 24 KB | 621 |
| `/models` | 17 | 192 | 456 | 388 | 0.001 | 2 (79 ms) | 29 | 230 KB (17) | 474 KB | 35 (99 KB) | 38 KB | 1432 |
| `/elements` | 9 | 284 | 496 | 471 | 0.001 | 2 (71 ms) | 21 | 246 KB (18) | 474 KB | 35 (99 KB) | 17 KB | 558 |
| `/storyboard` | 8 | 244 | 244 | 440 | 0.001 | 2 (74 ms) | 24 | 268 KB (21) | 431 KB | 34 (97 KB) | 19 KB | 615 |
| `/shorts` | 15 | 280 | 700 | 592 | 0.001 | 2 (103 ms) | 81 | 282 KB (21) | 417 KB | 34 (96 KB) | 29 KB | 1732 |
| `/ads` | 8 | 276 | 356 | 494 | 0.001 | 2 (107 ms) | 21 | 287 KB (22) | 584 KB | 41 (115 KB) | 19 KB | 650 |
| `/this-page-does-not-exist` (404) | 11 | 244 | 244 | 437 | 0.001 | 2 (85 ms) | 35 | 223 KB (14) | 487 KB | 35 (99 KB) | 16 KB | 539 |

### 3.2 Cold load, phone 390x844, CPU slowed 4x, empty library (1 run, load average 4.5–7.3)

| route | FCP | LCP | TTI* | CLS | long tasks (longest) | TBT | JS before load | JS after load | RSC prefetches |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` | 784 | 784 | 1139 | 0.029 | 6 (127 ms) | 87 | 270 KB | 313 KB | 22 |
| `/image` | 612 | 612 | 1348 | 0.000 | 4 (315 ms) | 322 | 367 KB | 0 KB | 0 |
| `/video` | 1028 | 1028 | 1511 | 0.000 | 5 (396 ms) | 346 | 356 KB | 0 KB | 0 |
| `/apps` | 984 | 984 | 1616 | 0.002 | 7 (210 ms) | 273 | 262 KB | 106 KB | 5 |
| `/library` | 1024 | 1024 | 1024 | 0.008 | 2 (306 ms) | 0 | 275 KB | 78 KB | 2 |
| `/cinema` | 392 | 392 | 1095 | 0.000 | 4 (203 ms) | 300 | 250 KB | 0 KB | 0 |
| `/assist` | 1140 | 1140 | 1140 | **0.142** | 2 (220 ms) | 0 | 286 KB | 50 KB | 2 |
| `/marketing` | 980 | 980 | 1325 | 0.000 | 4 (266 ms) | 216 | 319 KB | 94 KB | 7 |
| `/faceless` | 928 | 928 | 1284 | 0.000 | 3 (302 ms) | 126 | 274 KB | 0 KB | 0 |
| `/settings` | 708 | 708 | 1163 | 0.000 | 5 (177 ms) | 108 | 244 KB | 0 KB | 0 |
| 404 | 336 | 336 | 632 | 0.000 | 2 (138 ms) | 3 | 223 KB | 57 KB | 2 |

On phones the sidebar is a closed drawer, so its links are off-screen and are not prefetched. Home still prefetches 22 routes from its tool tiles and gallery cards.

### 3.3 Cold load with results (desktop, 19 generations in the library, 1 run)

| route | FCP | LCP | TTI* | CLS | TBT |
|---|---:|---:|---:|---:|---:|
| `/` | 172 | 172 | 474 | **0.038** | 25 |
| `/image` | 212 | 212 | 355 | 0.001 | 20 |
| `/video` | 340 | 340 | 605 | 0.001 | 53 |
| `/library` | 204 | 740 | 398 | **0.037** | 28 |

Where the layout shifts come from (layout-shift `sources`):

| route | CLS | the element that moved | why |
|---|---|---|---|
| `/` | 0.010 → 0.038 | `.mt-14 grid` (tool tiles), then `section.space-y-3` | The demo notice is inserted after `/api/status` answers, then the "Recent" row is inserted after `/api/generations` |
| `/cinema` | 0.048 | the empty state `.pt-[8vh]` | The skeleton grid is swapped for an empty state of a different height |
| `/assist` | 0.018 desktop, **0.142** phone | the mode chip, the engine switch, the suggestion row | The mode chip's label changes width when `availability` loads; on a phone the footer row wraps and pushes the suggestions down |
| `/library` | 0.037 | the toolbar row and the grid | Tab counts and folders arrive after first paint |
| every page | 0.0005 | the sidebar footer | The status rows appear after `/api/status` |

### 3.4 JavaScript per route (from the build)

Next 16's build output no longer prints first-load sizes, so these were read from the prerendered HTML (script tags plus client references in the flight data). Sizes are gzip level 6, in `/tmp/claude-0/r4-ux-shots/js-per-route.json`.

- **Shared by every page:** 223 KB compressed (15 chunks). This is the Next runtime and React DOM, Sonner, React Query, Radix and the sidebar.
  - A 38 KB polyfill chunk is marked `noModule`, so modern browsers never download it.
  - The heaviest single chunk (three.js, 297 KB compressed) is lazy and in no route's initial set. That is correct.
- **Page-specific code before load:** `/` 57 KB, `/marketing` 105 KB, `/image` 153 KB.
- **Heaviest routes overall:** `/canvas/[id]` 501 KB and `/cinema/[id]` 464 KB, including the 38 KB polyfill.
- **The network matches the build.** `/image` loads 367 KB before the load event.

### 3.5 Route transitions (sidebar click → new page's `h1` painted)

| sidebar click → | URL changes | painted (1st visit) | painted (2nd visit) | 4x CPU: URL | 4x CPU: painted |
|---|---:|---:|---:|---:|---:|
| Image | 104 | 131 | 94 | 356 | 459 |
| Video | 37 | 63 | 76 | 209 | 232 |
| All creations (`/library`) | 65 | 78 | 95 | 372 | 460 |
| Apps | 87 | 109 | 106 | 516 | 606 |
| Cinema Studio | 40 | 83 | 74 | 231 | 300 |
| Assist | 51 | 99 | 63 | 245 | 287 |
| Marketing Studio | 33 | **403** | 134 | 604 | **718** |
| Faceless Studio | 75 | 112 | 114 | 230 | 246 |
| Settings | 51 | 72 | 96 | 186 | 314 |
| Camera motions | 99 | 125 | 101 | 406 | 494 |
| Effects | 67 | 91 | 91 | 255 | 313 |
| Canvas | 51 | 78 | 55 | 184 | 241 |
| Edit | 66 | 92 | 68 | 190 | 219 |
| Audio | 44 | 71 | 81 | 127 | 173 |
| Home | 93 | 133 | 156 | 293 | 378 |

All times are ms. The first DOM change happened at the same moment as the URL change. Nothing on screen reacts to the click before the route commits (see UX-14).

### 3.6 Flow timings and interactions

Fixed pauses in the script have been subtracted, and each figure includes Playwright overhead, so these are upper bounds.

| step | desktop | phone (no throttle) |
|---|---|---|
| Home: type, Enter → Image painted with the prompt | 90–190 ms (no generation starts, see UX-04) | 100–190 ms |
| Open the model picker | 120–226 ms | 190–226 ms |
| Generate → first finished image tile (demo) | 3.6–4.0 s (the demo provider simulates about 3.5 s) | 3.8–4.0 s |
| Generate → first finished video tile (demo, camera motion + start frame) | 7.1–7.3 s (demo) | 7.1–7.3 s |
| Click a result → viewer open | 125–170 ms | 105–132 ms |
| Assist suggestion chip → plan card | about 320 ms | not measured |

Event Timing measures each interaction from input to the next paint. The slowest interactions were:

- 208 ms: a phone tap on "All creations" in the drawer.
- 192 ms: a click on a result tile, which loads the viewer chunk.
- 176 ms: opening the model picker on a phone (115 ms of handler work).
- 160 ms: the Cinema "New project" and "Create project" clicks.

Everything else was under 150 ms. 200 ms is the usual "good" limit for INP.

## 4. What already works (keep it)

- **Liner's frame and sheet.** The pale frame, the inset sheet with a 12 px corner, 13 px sidebar rows, serif heroes and the pill composer with a brand border and halo on focus are all in place, in light and dark (screenshots `desktop-light-01-home.png`, `phone-dark-01-home.png`).
- **The composer is ready before the page hydrates.** It keeps its state when the first result docks it. The cost is shown live ("Demo · free"). The model picker groups models into "Best for this studio", Recent and Starred, searches both engines and shows the price on each row (`desktop-light-02c-image-model-picker.png`).
- **Progress is narrated** on the tile itself ("Queued (demo)" → "Generating demo output 51% · 4s") with Cancel. Failed tiles say "Couldn't generate this one" with Retry.
- **The viewer** has the main action first ("Animate"), every hand-off, and keyboard hints (← → browse, F, D, R) (`desktop-dark-02e-image-viewer.png`).
- **Empty states follow Liner's two-line form:** "Your first shot / Start by describing a scene…", "No channels yet", "Nothing here". Not-found pages offer a way back to the right section (`desktop-light-11b-404-cinema.png`).
- **Phones:** no page scrolls sideways at 390 px in either theme. The model picker becomes a bottom sheet. Marketing Studio shows its blocker as a line of text under the composer ("Attach a product to generate"), which is the pattern UX-08 asks for elsewhere.
- **Speed.** Every desktop route paints within 290 ms and has under 100 ms of TBT, and every sidebar transition but one paints within 160 ms.

## 5. Findings, ranked

The format for each finding: **Route · component**, then what is wrong, the evidence, and the fix. File paths are relative to the repo root.

### P0: blocks or misleads a first-time user

**UX-01 · Settings "Test connection" tests the saved value, not the one you typed.** `/settings` · `src/components/settings-form.tsx` (`TestButton`, `Field`), `src/app/api/providers/test/route.ts`.

- **Evidence:**
  - I typed a fal key and pressed Test. It answered "No key set" (`desktop-light-10d-settings-fal-test-unsaved.png`).
  - I typed `http://127.0.0.1:8188` as the ComfyUI URL and pressed Test. It answered "Can't reach ComfyUI at http://127.0.0.1:9" (the old URL; `desktop-light-10c-settings-comfy-test.png`).
  - Each provider takes three separate steps: type, Save (a pale, disabled-looking button until you type), then Test. The Test button sits on its own row under the field.
  - Connecting is the only way to real output, so a new user who pastes a key and tests it is told it failed.
- **Fix:**
  - Merge Save and Test into one "Save & test" button per provider. On click: `PUT /api/settings` with the typed value, then `POST /api/providers/test`, then show the result inline next to the field ("Connected · fal.ai" in green, or the error).
  - Have `POST /api/providers/test` accept an optional `{provider, value}` and test the candidate without saving. That lets a "Test" before saving work too.
  - Have `TestButton` take the field's draft value as a prop and disable itself while the field is empty and nothing is saved.

**UX-02 · There is no first-run guide.** `/` · `src/components/home-view.tsx` (the `nothingConnected` paragraph, line 213).

- **Evidence:**
  - On first visit the only hint is a grey sentence under the composer: "You're in demo mode — outputs are placeholders. Add a fal.ai key or connect ComfyUI to generate for real." (`desktop-light-01-home.png`). axe also flags its link (UX-06).
  - Nothing explains the three ways to use Fuobe or what each costs. Nothing lets you connect without leaving Home.
  - Settings opens on three large engine cards; on a phone, the first key field is three screens down (`phone-dark-10-settings.png`).
  - The parity studio is hosted, so its first run is a sign-up. Liner's first run asks "What do you want to do?" with chips ([`liner-ui.md`](liner-ui.md) §3.15). Fuobe's self-hosted equivalent is "connect something, or try the demo".
- **Fix:** when `nothingConnected` and `localStorage["fuobe:onboarded"]` is unset, replace the sentence with a dismissible "Get started" card under the composer, made of shadcn `Card`s in a 3-column grid that becomes 1 column on phones:
  1. **"Use paid models"**: an inline fal.ai key field with "Save & test" (UX-01), a "Get a key" link to `https://fal.ai/dashboard/keys`, and "about $0.03–0.15 per image".
  2. **"Use your GPU"**: the ComfyUI URL prefilled with `http://127.0.0.1:8188`, "Save & test", and a link to `/workflows` for the models each workflow needs.
  3. **"Just try it"**: sets the flag, focuses the composer and keeps the "Demo · free" label.
  - Put the same card at the top of `/settings` while nothing is connected, and move Engine mode below the providers there.
  - Set the flag once any provider tests green.

**UX-03 · Assist's no-key planner turns its own suggestion into the wrong plan.** `/assist` · `src/server/assist/agent.ts:738` (`offlinePlan`), and the suggestions in `src/components/assist-view.tsx:26`.

- **Evidence:**
  - The suggestion chip "Four moody portraits of a lighthouse keeper, 35mm film, then pick the best and animate it" produced "I'll make the video with the default video model" and one Seedance 2.5 **text-to-video** job with 4 takes. The prompt was the whole sentence (`desktop-light-06d-assist-suggestion-plan.png`).
  - "Make 3 portraits of a fox in a trench coat, then animate the best one into a 5 s video" did the same (`desktop-dark-06c-assist-plan.png`, `phone-dark-06c-assist-plan.png`).
  - The still-then-animate branch only matches `\b(still|photo|picture|image|portrait|poster|frame|shot|render|key ?visual)\b`, so plural nouns fail.
  - This is the default Assist (Free mode, no Claude or Ollama), and one of its four suggestion chips hits the bug.
- **Fix:**
  - Change the regex to `\b(stills?|photos?|pictures?|images?|portraits?|posters?|frames?|shots?|renders?|key ?visuals?)\b`.
  - Pass the parsed `count` as `num_outputs` on the still job.
  - For "pick the best", say so in the reply and make the animate step take the first still. Better: add an approval step "Pick one to animate" that the transcript renders as a choice.
  - Add a Vitest case that runs every `SUGGESTIONS` string through `offlinePlan` and checks the tool and the job kinds.

### P1: friction on a core flow, accessibility failures

**UX-04 · Start on Home does not start.** `/` → `/image` · `src/components/home-view.tsx` (`go()`), `src/components/studio/studio-page.tsx` (`HandoffSync`).

- **Evidence:**
  - Typing on Home and pressing Enter lands on `/image?prompt=…` with the prompt in the composer, no generation, and a second hero question ("What should we make today?" after "What will you create today?") (`desktop-light-01d-home-to-image.png`; the flow log shows `feedItems: 0`).
  - Liner's home composer answers straight away.
  - The parity studio's home entry `/start/agent?model=wan3_0&mode=video` opens the agent with the request (inventory §1.1).
- **Fix:**
  - Push `${mode.href}?prompt=…&go=1`.
  - In `HandoffSync`, once the catalog is ready and `go=1`, call the composer's `submit()` once if `blockerFor()` returns nothing, then `router.replace()` the URL without `go`.
  - For Video and Edit, which need an image, keep the prefill and open the missing slot instead, as the blocker toast already does.

**UX-05 · No skip link, no navigation landmark, two `main` landmarks.** Every route · `src/components/app-sidebar.tsx` (`StudioChrome`, `AppSidebar`), `src/components/ui/sidebar.tsx:306`, and 20 files that render their own `<main>`.

- **Evidence:**
  - axe "region" flags 49 nodes outside any landmark on every desktop page: the whole sidebar (on phones the drawer is closed, so axe does not see it). `landmark-no-duplicate-main` and `landmark-main-is-top-level` fire on `/image`, `/video`, `/apps/*`, `/assist`, `/marketing` and `/faceless`.
  - A keyboard user must tab through 46 sidebar links to reach the page.
- **Fix:**
  - Make the first child of `StudioChrome` `<a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 rounded-md bg-background px-3 py-2 shadow-strong">Skip to content</a>`, and give `SidebarInset` `id="content" tabIndex={-1}`.
  - Wrap the `NAV.map(…)` in `SidebarContent` with `<nav aria-label="Main">`.
  - Keep the `<main>` from `SidebarInset`. Change the inner `<main>`s to `<div>`. They are in:
    - `studio/studio-page.tsx:246`, `assist-view.tsx:177` and `:208`, `cinema/workspace.tsx:417`
    - `marketing/marketing-studio.tsx:360`, `marketing/click-to-ad.tsx:209`, `mixed-media/mixed-studio.tsx:94`, `shorts/shorts-studio.tsx:95`, `shorts/session-view.tsx:89`
    - `faceless/{faceless-home,channel-view,episode-wizard,episode-view}.tsx`, `explainer/explainer-studio.tsx:227`
    - `layers/{layers-editor,mobile-view}.tsx`, `assist/{project-view,memory-view,skills-view}.tsx`

**UX-06 · Text below 3:1 contrast, and a link marked by color alone.** Many routes · `src/app/globals.css` (`--subtle-foreground`) and 79 uses of `text-subtle-foreground` outside placeholders, about 70 of them on text.

- **Evidence:**
  - `--subtle-foreground` is #bdbdc0, which is 1.87:1 on white. In dark mode #5c5c5f on #121213 is about 2.8:1.
  - axe "color-contrast" (serious) finds it in these places:
    - `/settings` "Needs: …" lines (1.67:1 on the selected card).
    - `/library` "That's everything".
    - `/assist` rail headings "Projects" and "Chats" (1.84:1).
    - `/models`: 40 nodes.
    - The model picker's per-row prices.
  - axe "link-in-text-block" (serious) on `/`: "Add a fal.ai key or connect ComfyUI" is #513dc5 inside #6e6e71 text, a 1.46:1 difference, with no underline.
- **Fix:**
  - Keep `--subtle-foreground` for placeholders, disabled controls and icons only. On any text, replace `text-subtle-foreground` with `text-muted-foreground` (#6e6e71, 5.1:1 light; #a9a9ab, about 8:1 dark).
  - The fastest pass is `rg -l "text-subtle-foreground" src | xargs sed -i 's/\btext-subtle-foreground\b/text-muted-foreground/g'`. Then restore it where it styles an icon or a placeholder.
  - Give the Home link `underline underline-offset-2`.

**UX-07 · The navigation is long and has no search.** Every route · `src/components/app-sidebar.tsx` (`NAV`), `src/components/global-shortcuts.tsx`, `src/lib/nav.ts`.

- **Evidence:**
  - The sidebar shows 46 links, and every group starts open. Its content is 1,434 px tall on a 900 px screen, and only "Cinema Studio" of the 23 Studios is visible without scrolling (`desktop-light-01-home.png`, `phone-dark-01c-home-drawer.png`).
  - "Library" sits above "Create".
  - ⌘K only goes Home.
  - 123 apps, 108 motions and 255 effects can only be found on their gallery pages.
  - Liner's sidebar has a handful of rows. The parity studio has about 10 top-level items with menus (inventory §1.1).
- **Fix:**
  - Default `closed` to `["studios", "engine"]` when `localStorage["fuobe:nav-closed"]` is absent (`readClosed()` and `SIDEBAR_STATE_SCRIPT`). Move the Library group below Create.
  - Add a command palette on ⌘K / Ctrl+K: `CommandDialog` from `src/components/ui/command.tsx`, already used by the model picker. It should search:
    - destinations (`NAV`)
    - apps, motions and effects (the slim `toPresetCard` data, loaded on first open)
    - models, and recent creations (`/api/generations?q=`)
  - Pressing Enter on an empty query keeps today's "New creation".
  - Show "Search ⌘K" as the first sidebar row instead of the keycaps on "New creation".

**UX-08 · On a phone, a blocked Generate gives no visible reason.** `/apps/*`, `/video` and every studio once results exist · `src/components/studio/composer.tsx` (send button around line 655).

- **Evidence:**
  - Once the feed has results, the docked composer folds its input slots away. The send button turns grey (`bg-muted text-subtle-foreground`) and looks disabled.
  - The reason ("Add a target photo") is only in a tooltip and the `aria-label`, and tooltips don't open on touch (`phone-light-04b-app.png`).
  - Pressing the grey button does toast the reason and open the slot, but nothing invites the press.
  - Marketing Studio already prints its blocker as text under the composer (`phone-light-07-marketing.png`).
  - The parity studio states validation in words (inventory §8.2).
- **Fix:** when `blocker && (collapsed || !canHover)`, render `<p className="px-2 pt-1 text-[12px] text-muted-foreground">{blocker.message}</p>` under the toolbar, and make tapping the text open the slot (`firstMissingSlot`). Give the button the brand color with lower opacity instead of the "disabled" grey, so it still reads as pressable.

**UX-09 · Layout shifts on Assist (phone), Cinema, Home and Library.** The components:

- `src/components/assist-view.tsx` (`NewChatControls`) and `src/components/assist/mode-picker.tsx`
- `src/components/cinema/projects-view.tsx`
- `src/components/home-view.tsx`
- `src/components/library-view.tsx`

- **Evidence:** CLS 0.142 on `/assist` on a phone (over the 0.1 "poor" line); 0.048 on `/cinema`; 0.038 on `/` and 0.037 on `/library` with results. The sources are in §3.3.
- **Fix:**
  - **Assist:** render the mode chip at a fixed `min-w-[7.5rem]` with the default label until `availability` loads. Make the footer row `flex-nowrap overflow-x-auto scrollbar-none` on phones.
  - **Cinema:** while loading, render the empty-state block with a skeleton of the same size (or show the grid skeleton only when `data` was non-empty last time). The `pt-[8vh]` block must not replace a block of a different height.
  - **Home:** reserve one line for the demo notice in the static shell (`min-h-5`). While `recent.isLoading`, render the "Recent" row with 6 `Skeleton` squares; hide it only when the request settles empty.
  - **Library:** reserve the tab counts (`tabular-nums`, `min-w-4`) and the folder row before facets load.

### P2: slower or clumsier than it should be

**UX-10 · Settings is one long page with no status, truncated menus and a wrong key hint.** `/settings` · `src/components/settings-form.tsx`.

- **Evidence:**
  - There is no summary of what is connected; the page runs 2,400 px.
  - Three select values are cut off: "Automatic (fal.ai, then Replicate, then Higg…", "Automatic (Claude → Ollama → offlin…" and "Automatic — demo only when a model isn…" (`SelectTrigger` `max-w-80` and `max-w-72`; `desktop-light-10-settings-full.png`).
  - The fal.ai placeholder is "fal_…", but fal keys have the form `key_id:key_secret` (fal.ai API reference, `POST /v1/keys`, fetched 2026-10-22).
  - There is no Test for the Anthropic key or Ollama.
- **Fix:**
  - Add a sticky status strip at the top: "fal.ai · not set — Replicate · not set — the parity studio · not set — ComfyUI · offline — Claude/Ollama · off". Each item is an anchor to its section and goes green when connected.
  - Shorten the select labels to "Automatic", with the order in the hint line below, or use `w-full sm:w-auto sm:min-w-80`.
  - Set the placeholder to `key_id:key_secret` and warn when there is no `:`.
  - Add `<TestButton provider="llm" />` under the Prompt enhancement fields.

**UX-11 · A Cinema project needs a name before it can start, and the error appears only in a toast.** `/cinema` · `src/components/cinema/project-settings.tsx` (`submit`), `src/components/ui/dialog.tsx:133`.

- **Evidence:**
  - "Create project" with an empty name shows a toast at the top of the screen ("Give the project a name"). The field is not marked invalid (`desktop-light-05c-cinema-noname.png`).
  - On a phone the toast still covers the new workspace's header (`phone-dark-05d-cinema-workspace.png`).
  - The dialog title is 16 px serif and reads small next to the 14 px labels.
- **Fix:**
  - Prefill the name with "Untitled project" (or "Project N"), selected, so Enter creates it.
  - If it is cleared, show the error inline (`aria-invalid` plus a `<p className="text-[12px] text-destructive">` under the field) and drop the toast.
  - Set `DialogTitle` to `font-heading text-[22px] leading-tight font-normal`.

**UX-12 · Full-screen studios keep the app sidebar open.** `/cinema/[id]`, `/assist`, `/canvas/[id]`, `/layers/[id]` · `src/components/app-sidebar.tsx` (`StudioChrome`), `src/components/ui/sidebar.tsx` (`useSidebar().setOpen`).

- **Evidence:**
  - At 1440 px, Cinema has three columns: the 248 px app sidebar, the 240 px scenes sidebar, and a 950 px feed. Assist has the same layout with its 256 px chat rail, leaving a 935 px conversation (`desktop-light-05g-cinema-shot.png`, `desktop-dark-06c-assist-plan.png`).
  - The parity studio's Cinema Studio has its own single-sidebar shell (inventory §1.3).
- **Fix:** on those routes, collapse the app sidebar to its 52 px rail on mount (`setOpen(false)` without writing the cookie) and restore it on leave. Add a "Hide app sidebar" toggle to the workspace's ⋯ menu.

**UX-13 · Marketing Studio's composer covers the template gallery.** `/marketing` · `src/components/marketing/marketing-studio.tsx` (the composer around line 360), `template-gallery.tsx`.

- **Evidence:**
  - At 1440x900 the floating composer sits over the first row of templates and hides 4 of the 5 template names.
  - On a phone it takes about 210 of 844 CSS px (`desktop-light-07-marketing.png`, `phone-light-07-marketing.png`).
- **Fix:**
  - Until a template is picked or the composer is focused, collapse it to its one-row docked form (as `Composer docked` does in studios).
  - Give the gallery bottom padding equal to the composer height.
  - Cut the hero's top padding while the Templates tab is open.

**UX-14 · Sidebar clicks show nothing until the route commits.** Every route · `src/components/app-sidebar.tsx` (`Items`).

- **Evidence:** with the CPU slowed 4x, the first DOM change after a click happens at the URL change: 604 ms for Marketing Studio, 516 ms for Apps, 406 ms for Camera motions (§3.5). Until then the clicked row does not change.
- **Fix:** add a child of each sidebar `Link` that calls `useLinkStatus()` (Next 16, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-link-status.md`). While `pending`, it sets `data-pending` on the row: `bg-sidebar-accent` plus a `shimmer-text` label. Give `/marketing` a `loading.tsx` like `/apps` has.

**UX-15 · Every cold desktop visit prefetches all 46 sidebar routes.** Every route · `src/components/app-sidebar.tsx`, `src/components/preset-gallery.tsx` (`PresetCard`), `src/components/home-view.tsx` (tool tiles).

- **Evidence:** after `load`, desktop pages fetch another 349–584 KB of JS and make 34–47 RSC requests (80–122 KB) (§3.1). On a phone the home page alone still prefetches 22 routes (313 KB).
- **Fix:**
  - Keep the default prefetch for the always-visible rows: Home, Assist, Image, Video and Library.
  - Use hover-intent prefetch for the Studios and Engine groups and for gallery cards: `prefetch={active ? true : false}` set on `onMouseEnter` / `onTouchStart`, per the "Hover-triggered prefetch" section of `node_modules/next/dist/docs/01-app/02-guides/prefetching.md`. This app runs with `partialPrefetching: true`.
  - Re-measure §3.5 afterwards. Transitions are 55–156 ms today, so check that they stay under 200 ms.

**UX-16 · The elapsed time on a running tile moves only when the job reports.** Every studio feed · `src/components/studio/feed.tsx` (`PendingTile`, line 35).

- **Evidence:**
  - The tile shows `elapsed(g.createdAt)`, which re-renders only when the generation changes. In a demo run it held "2s" for 1.5 s between progress events (the timer check in the scratch scripts).
  - With a provider that reports rarely (a fal queue position, a parity-studio status), the clock will stand still for long stretches. This is inferred, since no real provider ran here.
  - The parity studio shows "{m}m {s}s left" and the elapsed time (inventory §8.3).
- **Fix:** add a shared 1 s ticker (`useNow(1000)`, one `setInterval` per page while at least one `PendingTile` is mounted) and render `elapsed(g.createdAt, now)`.

**UX-17 · Filled slots lose their role label.** `/apps/*`, `/video` · `src/components/studio/media-slot.tsx`, `src/components/studio/composer.tsx` (the attachment row).

- **Evidence:** Face Swap starts with "Target photo" and "Face" slots. After an upload, the filled tile is a bare thumbnail with ×, so you can't tell which photo is the target. The same happens to Video's "Start frame" (`desktop-light-04c-app-ready.png`, `desktop-light-03c-video-ready.png`).
- **Fix:** keep the label as a caption on the filled tile: `absolute inset-x-0 bottom-0 bg-black/50 text-[10px] text-white text-center`, with the slot's own words ("Target", "Face", "Start").

**UX-18 · There are no next steps under a fresh result.** `/image`, `/video` · `src/components/studio/feed.tsx` (`GenerationGroup`).

- **Evidence:**
  - Once a result lands, the only visible actions are "Reuse" and ⋯ on the group. Animate, Upscale and Edit appear only on hover or in the viewer (`desktop-light-02d-image-result.png`).
  - Liner shows refine chips and follow-ups after an answer ([`liner-ui.md`](liner-ui.md) §3.13, §5.6).
  - The parity studio puts Animate and Use in video one click away (inventory §8.5).
- **Fix:** under the newest succeeded group only, render 3 secondary chips (`h-8 rounded-full bg-secondary text-[13px]`) from `outputActions()`: Animate (images) or Extend (videos), Upscale, and "More like this" (Reuse with a new seed).

**UX-19 · The Library has no "Select all".** `/library` · `src/components/library-view.tsx` (bulk bar, line 636).

- **Evidence:** selection works by clicking tiles or Shift-clicking a range. There is no select-all, no per-day select and no ⌘A. The parity studio has bulk actions plus "Unselect All (Esc)" (inventory §8.7).
- **Fix:**
  - Add "Select all (N)" to the bulk bar, covering everything loaded under the current filters.
  - Add a "Select" link on each date header (`Today 13`).
  - Make Ctrl/⌘+A select all while selection mode is on.

**UX-20 · Cinema's prompt bar takes four rows on a phone.** `/cinema/[id]` · `src/components/cinema/prompt-bar.tsx`.

- **Evidence:** the Director chips, the Video/Image switch, the model and the settings stack into 4 rows, about 240 of 844 CSS px, before you type (`phone-dark-05d-cinema-workspace.png`).
- **Fix:** below `sm`, fold the Director's Panel chips into one "Director" chip that opens them in the existing `ResponsivePanel` sheet, and put Video/Image, the model and settings on one scrollable row. This matches what the studio composer already does on phones.

### P3: polish and consistency with Liner

**UX-21 · The engine switch has three names.** `src/components/studio/engine-switch.tsx:85` and `:89`.

- **Evidence:**
  - The switch says "Cloud | Open" on Home and in the model picker, but "Cloud | Open source" in studio headers. Phones show only a cloud icon and a CPU icon.
  - Next to Home's arrow button, "Open" reads like a verb.
  - The tooltip lays "Cloud" and its sentence out as two columns.
- **Fix:**
  - Use "Open source" at every size, or "Local" if space is short. On phones keep the icons, add `aria-label`s, and show the label of the selected half.
  - Wrap the tooltip text in one `<span>`.

**UX-22 · The ⌘K keycaps assume a Mac and show on phones.** `src/components/app-sidebar.tsx:352`, `src/components/canvas/canvas-editor.tsx:1061`.

- **Evidence:** the sidebar always shows ⌘ K, including in the phone drawer, which has no keyboard (`phone-dark-01c-home-drawer.png`). The Mac check is copied three times (`attach-menu.tsx:34`, `cinema/prompt-bar.tsx:212`, `layers/top-bar.tsx:176`).
- **Fix:** add one `modKey()` in `src/lib/keys.ts` and render it after hydration. Hide keycaps on touch with `[@media(hover:none)]:hidden`.

**UX-23 · Dialogs differ from Liner's.** `src/components/ui/dialog.tsx:42,133`, `alert-dialog.tsx:39,126`, `sheet.tsx:40,117`.

- **Evidence:** the title is 16 px serif with `font-medium`, but Instrument Serif has only weight 400. The overlay is `bg-black/10` plus `backdrop-blur-xs`. Liner uses a 48% dim (64% in dark) with no blur and 20–30 px serif titles ([`liner-ui.md`](liner-ui.md) §3.10).
- **Fix:** titles `font-heading text-[22px] leading-tight font-normal`; overlay `bg-overlay` with no blur. The `--overlay` token already exists. Dropping the blur also saves GPU work on low-end phones.

**UX-24 · Home's tool tiles use ten rainbow gradients.** `/` · `src/components/home-view.tsx` (`tools()`).

- **Evidence:** each tile has its own gradient square, and the icon scales on hover. Liner's rule is neutral chrome with color only in content ([`liner-ui.md`](liner-ui.md) §5.1), and no lift or scale on hover (§5.5).
- **Fix:** use `bg-muted text-foreground` squares with `group-hover:bg-brand-faint group-hover:text-brand-text`. Remove `group-hover:scale-110`.

**UX-25 · Heading order and accessible names.** `src/components/studio/feed.tsx:226`, `src/components/cinema/projects-view.tsx:57`, `src/components/marketing/template-gallery.tsx:20`, `/models` (`src/components/models-table.tsx`), the app header's "About" button (`src/components/preset-header.tsx`).

- **Evidence:**
  - axe "heading-order": feed group titles are `h3` directly under the page `h1`.
  - axe "label-content-name-mismatch" (serious): 30 Marketing template buttons are labelled "Sunlit Plinth — Product shot template" while their visible text starts with the "Product shot" chip. /models has 40 "Where X runs" buttons, and Packshot has "About Packshot". Speech users say what they see, so those commands miss.
- **Fix:**
  - Change the feed group titles and Cinema project card titles to `h2`.
  - Drop the `aria-label` where the button's own text is enough, or start it with the visible text, e.g. `${f.cardLabel} · ${t.name}`.

**UX-26 · Video tiles have no poster and no duration.** `src/components/studio/result-media.tsx:28`.

- **Evidence:**
  - Video tiles are `<video src="…#t=0.1" preload="metadata">` with no `poster`. Each tile fetches metadata, and a browser that can't decode the codec shows an empty grey box (`desktop-light-03e-video-result.png`, `desktop-dark-09-library.png`).
  - There is no duration badge. [`liner-ui.md`](liner-ui.md) §5.5 specifies `bg-black/60 text-white text-[11px] rounded-[4px] px-1`.
- **Fix:**
  - Store a first-frame JPEG as `meta.poster` when a video output is saved, and use the request's start frame as a fallback.
  - Render `poster={…}` and `preload="none"` in grids, plus the duration badge.

**UX-27 · The phone header has only a panel icon.** `src/components/page-shell.tsx:8`, `src/components/ui/sidebar.tsx` (`SidebarTrigger`).

- **Evidence:** on gallery and settings pages the phone bar is a lone "panel" icon with no title (`phone-dark-10-settings.png`). The drawer's close control is the same panel icon. Liner shows a 3-bar menu and the page title on mobile (§3.16).
- **Fix:** below `md`, use lucide `Menu` in `SidebarTrigger`, show the page title (or "Fuobe") next to it, and use `X` to close the drawer.

**UX-28 · The GitHub link uses the CPU icon.** `src/components/app-sidebar.tsx:418`.

- **Evidence:** everywhere else, the `Cpu` glyph means "open-source engine" (the engine switch, preset cards).
- **Fix:** use an inline GitHub mark SVG (`currentColor`), or lucide `BookOpen` labelled "Source code".

**UX-29 · Faceless "Next" looks ready before a topic is picked.** `/faceless/[id]/new` · `src/components/faceless/episode-wizard.tsx` (bottom bar, around line 358).

- **Evidence:** the bar says "Pick a topic to continue", yet Next is solid brand color (`desktop-light-08c-faceless-channel.png`).
- **Fix:** `disabled={!topic}` on Next. Keep the hint, and make tapping it focus the first topic.

**UX-30 · Small accessibility leftovers.**

- **Settings:** the MCP command box `src/components/security-settings.tsx:106` scrolls sideways but can't be focused (axe "scrollable-region-focusable"). Fix: `tabIndex={0}` and `aria-label="MCP command"`.
- **Assist:** the composer textarea has `role="combobox"`, which axe flags as not allowed on a textarea (`src/components/assist/composer.tsx`). Fix: move the combobox role to a wrapper, or use `aria-haspopup="listbox"` with `aria-controls`.
- **Unknown project ids** still return HTTP 200 (`/cinema/does-not-exist` → 200, as STATUS §3 notes). Fix: call `notFound()` in the server page when the id doesn't exist.

## 6. Liner token check

| Liner token ([`liner-ui.md`](liner-ui.md)) | Fuobe today | Verdict |
|---|---|---|
| Frame `#fafafb` with an inset white sheet, 12 px corner, 0.5 px border | `bg-sidebar` frame, `SidebarInset` `rounded-tl-xl` with a 0.5 px border | Match |
| Sidebar rows 32 px / 13 px, active row `#f1f1f2` and semibold | `h-8 text-[13px] data-[active=true]:font-semibold` | Match |
| Composer 28 px radius (20 px below 600 px), brand border plus 4 px halo | `rounded-[20px] sm:rounded-composer focus-within:ring-4 ring-brand-faint` | Match |
| Hero serif 34 px at about 26vh | 34–44 px serif at 8vh (Home), 16vh (studios), 10–14vh (Assist) | Close. The top offset differs per page |
| Secondary label 5.1:1 (Fuobe's stated departure) | `--muted-foreground` #6e6e71 is correct, but `--subtle-foreground` (1.87:1) is used on text | Fix (UX-06) |
| Dialog: 48% overlay, 20–30 px serif title, actions stacked on phones | 10% overlay plus blur, 16 px title | Fix (UX-23) |
| Tooltip: inverse chip `#39393b` | `bg-tooltip` token | Match |
| Toasts: top-center, gap 8, offset 29 | `<Toaster position="top-center" gap={8} offset={29} />` | Match |
| Hover: an 8% gray wash, no lift | Wash everywhere except the scaling icons on Home's tiles | Fix (UX-24) |
| Focus: 1 px crisp, or a 4 px brand halo on fields | 2 px `ring-ring` on cards, brand halo on composers | Fine |
| Neutral chrome, colorful content | Ten gradient icon squares on Home; Marketing's black "All" chip vs brand-faint selected chips elsewhere | Minor (UX-24) |

## 7. Not verified here

- **Real provider latency and progress cadence.** With no paid keys or GPU, every generation ran on the demo provider. UX-16 is inferred from the code and the demo cadence.
- **Video decoding.** Headless Chromium can't play the demo H.264 clips, so video tiles look empty in these screenshots. Real Chrome and Safari play them.
- **Absolute times.** They come from a shared, loaded container (load average 2–7) and CPU throttling, not a real phone. Use §3 to compare routes, not as field data.
- **The parity studio's logged-in screens** were not observed in this audit. The parity studio's behaviour is quoted from the earlier research files.

## 8. Sources

- fal.ai API key format: "Full API key in the format 'key_id:key_secret'". https://fal.ai/docs/platform-apis/v1/keys/create (fetched 2026-10-22). The authentication page https://fal.ai/docs/model-apis/authentication gives only `FAL_KEY="your-api-key-here"`.
- Next.js 16.4.2 docs in the repo:
  - `node_modules/next/dist/docs/01-app/02-guides/prefetching.md` (Hover-triggered prefetch, Partial Prefetching)
  - `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md` (`prefetch`)
  - `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-link-status.md`
- axe-core 4.14.0 rules: `node_modules/.pnpm/axe-core@4.14.0/node_modules/axe-core/axe.min.js`. Rule help is at https://dequeuniversity.com/rules/axe/4.14/.
- Liner's design language: [`liner-ui.md`](liner-ui.md) (researched 2026-10-16).
- The parity studio's flows: [`parity-inventory.md`](parity-inventory.md) §1.1, §1.3 and §8; [`parity-studios.md`](parity-studios.md) §1; [`parity-marketing-agents.md`](parity-marketing-agents.md).
- The raw data from this audit is in `/tmp/claude-0/r4-ux-shots/`:
  - `metrics-*.json`, `transitions-*.json`, `axe-*.json`, `notes-*.json` (flow notes, console errors and Event Timing)
  - `js-per-route.json`, `flows.log`, and 168 screenshots.

## 9. Critic check (round 4, 2026-10-22)

The round-4 completeness critic re-read three claims in the code at `d781de1`, and all three hold:
- **UX-03:** `src/server/assist/agent.ts:738` tests `beforeThen` against `\b(still|photo|picture|image|portrait|poster|frame|shot|render|key ?visual)\b`, which has singular nouns only.
- **UX-01:** `TestButton` posts `JSON.stringify({ provider })` (`src/components/settings-form.tsx:122`), and `src/app/api/providers/test/route.ts` reads only `provider`.
- **UX-10:** the fal key field's placeholder is `"fal_…"` (`settings-form.tsx:263`).

No corrections were needed in this file.
