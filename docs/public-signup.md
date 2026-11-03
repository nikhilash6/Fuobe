# Public sign-up and guest browsing

A Fuobe studio with a password can open itself a little to the public: signed-out visitors (guests)
browse it read-only, and anyone can make a free account. It is off by default, so a self-hosted
studio behaves as before: every page and API call needs the install password or an API token.

## Turning it on

Public sign-up works only on a studio that has a password (`FUOBE_PASSWORD` or **Settings →
Security**). Then it is on when one of these is true:

- `FUOBE_PUBLIC_SIGNUP=1` is set on the server. `FUOBE_PUBLIC_SIGNUP=0` keeps it off, whatever
  Settings says. While the variable is set, the Settings switch can't change it.
- The owner turns on **Settings → Security → Public sign-up**.
- The request is for `fuobe.com` or `www.fuobe.com` (the public demo), the server lists that name in
  `FUOBE_ALLOWED_ORIGINS`, and `FUOBE_PUBLIC_SIGNUP` is not `0`. The `Host` header comes from the
  client, so a self-hosted studio that someone reaches by its IP address can't be opened with
  `Host: fuobe.com`.

Turning it off signs out every account at once, and guests are sent to sign in again.

## Guests

A guest can open every page: galleries, presets, the studios, Layers, Cinema, Image to 3D and
Settings, read-only. The pages get the catalog and status reads they need (`/api/status`,
`/api/models`, `/api/search-index`, `/api/comfyui`, `/api/settings/models`, curated moodboards,
built-in skills). The owner's library stays private: the lists come back empty, and other reads of
it (files, uploads, projects, settings values, tokens) answer 401 "Sign up to see your library".

Every change a guest sends (generate, upload, save a setting, create a project…) answers 401. The
studio shows a "Create a free account to run this" card with **Sign up** and **Log in**. Where
signing up wouldn't help, a guest gets an account's answer instead: 403 `assist-owner` for Assist,
and 403 `own-gpu-tool` for a tool an account's own GPU or key doesn't run (Shorts, Katana,
Marketing…). The pages of those tools say so up front and turn off their upload and Generate.
What is drawn in the browser itself is open to try: Click to Ad's animated end card and Marketing
Studio's code-drawn templates (Kinetic Motion) take a guest's words and play live (a code-drawn
template shows no "isn't available" note, as nothing is generated); their Save opens the sign-up card before anything renders. Price
checks (the estimate routes, and `?preview=1` on the run routes that support it) stay open, so the
studios can show prices. A guest may send 120 price checks a minute (per visitor behind a trusted
reverse proxy; see below), and so may each account. A price check reads only the header of a file
it names, and only of the asker's own files (a guest owns none) or of Fuobe's published example files. Nor does a price check reveal the
owner's library: the turnaround video's price check (`/api/turnaround/estimate`, or
`/api/turnaround?preview=1`) answers 404 "Character not found" for any character a visitor names,
whether it exists or not. A price check never calls a GPU either: Split soundtrack's price check
takes an account's GPU type from the status strip's last check and asks the GPU nothing.

## Accounts

- Sign up at `/login?signup=1` (`POST /api/auth/signup` with `{ "email", "password" }`). The
  password needs at least 8 characters. There is no email verification.
- Log in at `/login` (`POST /api/auth/login` with `{ "email", "password" }`). The install password
  still works as before: `POST /api/auth/login` with `{ "password" }`, or the owner's sign-in at
  `/login?owner=1`. The login page links to it only in development, so a public site doesn't
  advertise it.
- Accounts are stored in `auth.json` in the data folder: the email in lower case, a salted scrypt
  hash of the password (the same scheme as the install password), and the creation time.
- Sign-up and log-in attempts are rate limited per visitor (set `FUOBE_TRUST_PROXY=1` behind a
  reverse proxy, so that each visitor gets their own limit; an IPv6 address counts by its /64).
  A visitor gets 30 account log-ins a minute, right or wrong, and 10 a minute for one email. After
  5 wrong passwords for one email, that visitor is locked out of it for 15 minutes. After 10 wrong
  passwords for one email from any number of addresses, the email is locked for 15 minutes, but
  only for the addresses that got it wrong twice or more. The person whose account it is still
  gets in from anywhere else, so nobody can lock a chosen account out. Account log-ins and the
  install password have separate limits, so guessing at one never slows down the other.

An account is signed in, but it sees the owner's studio as a guest does:

- **The owner's library stays the owner's.** An account opens every page and the catalog, but the
  owner's results, files, uploads, folders, shares, projects (Layers, Cinema, Canvas, storyboards,
  elements…) and Assist threads are hidden: the lists come back empty, and other reads answer 403.
  Every change to them (create, rename, move, share, delete) answers 403 with `code: "library"`.
  So does Split soundtrack's **Export mix** (`POST /api/audio-tools/export`), which saves into the
  owner's Library, with or without a GPU. Accounts have their own uploads and runs (below), but no
  projects yet.
  Canvas shows its ready boards to guests and accounts as read-only pages (`/canvas/start/<id>`):
  what goes in, the steps and what comes out. Only the owner makes boards. Assist, Cinema Studio,
  Storyboard, Elements, Faceless Studio, Content Factory, Explainer, Ads Studio, Click to Ad and
  Marketing Studio show their ready-made starters the same way (`<studio>/start/<id>`); making one
  (`POST /api/starters/<id>`) is the owner's, and an account gets 403 `library`. A starter without its
  cover yet is the owner's only: its card, its words and its page (404 for anyone else). Storyboard's
  ready stories with a cover also fill its composer for anyone (`/storyboard?starter=<id>`), and the
  Library's "Make your first" row links to pages everyone can open.
- **Settings, keys and tokens are the owner's.** Changing settings or model switches, the password,
  API tokens, Public sign-up, LoRA downloads, Assist connectors and the MCP endpoint answer 403 for
  an account.
- **Accounts never run on the owner's keys or GPU.** An account runs on its own ComfyUI (see
  [Your GPU](#your-gpu)) or its own fal.ai or Replicate key (see [Your keys](#your-keys)). With
  neither, anything that would reach a model (a generation, an AI helper, a retry) answers 403
  with `code: "connect-gpu"`, and the studio shows a "Connect your GPU to run this" card.
- **Its own runs are its own.** The runs an account starts on its GPU appear in its own lists
  (`GET /api/generations`), and it can open, cancel and delete them and download their files. They
  stay out of the owner's Library and live feed, and no other account can open them. The studio's
  owner can see them, open their files and delete them ([Managing accounts](#managing-accounts));
  the sign-up form says so. An account's delete is for good (it has no Trash), so its space comes
  back at once. The live-updates stream isn't sent to accounts: their studios poll instead.
- **Its own uploads are its own.** Only the account that uploaded a file can use it in a run, and
  no other account can open it. See [Uploads](#uploads).
- **Results made in the browser (Kinetic Motion) are its own runs too.** A motion clip rendered in
  the page (an animated end card, a text template) is saved with an upload and
  `POST /api/generations/local` (`op: "motion"`, model `local-motion`). It needs the same own GPU or
  own key as any upload, and counts as the account's own runs and files: the clip and every file it
  names (its pictures, and the recipe's logo, product and pictures) must be the account's own (403
  otherwise), a clip is never made from a video (400), the stored file must be the MP4 or WebM it
  claims to be (400), and it shares the account's hourly run budget (60 an hour with its other runs,
  429). The words drawn on the clip (the recipe's fields and brand name) and its title go through the
  studio's checks when they are on, whatever the page sends as the prompt, and are what the run keeps
  (a refusal answers 422; a result the checks want to see waits for them). It shows in the account's
  own runs, never the owner's Library. Nothing
  is downloaded straight from the page: the clip is downloaded from the saved result. A guest's
  call answers 401 with the sign-up card. Colour grades and Relight blends stay the owner's
  (403, `code: "library"`).

## Managing accounts

The owner sees everyone who signed up in **Settings → Accounts**, the last section of Settings (the
**Accounts** chip at the top of Settings and the link under Public sign-up lead there): email,
whether its own GPU is connected, its runs (all time, in the last 7 days, running now, failed in the
last 7 days), when it last ran, and the space its files take against its limit (1 GB in its first 7
days, then 3 GB). On wide screens the list also shows when the account was created and its last
log-in (the CSV always has them). Running now counts as the run limit does: a batch or a chain
going is one run. A line above the list gives the runs of every account in the last 24 hours and 7
days, the runs going now, and the space all accounts' files take against their share of the disk.
The owner can switch an account off (it is signed out at once and can't log in) or delete it, and
export the list as CSV.

**Accounts' runs** (`/settings/runs`, from the list) shows what accounts made, newest first: one
account's or every account's, each labelled with its email, filtered by account, status (finished,
running, failed) and kind. The filters are in the address (`?account=<id>&status=failed&kind=video`),
so a reload or a shared link keeps them. Each run shows its result (a clip plays on hover, a tap, or
Enter; the count on a run with several files steps through them, and its menu opens each one), the
app, preset or studio and the model, the prompt, its status with the error of a failed run, and when
it ran. The owner can delete a run with its files, which gives the account its space back at once, or
switch the account off from there. The owner's own runs are never listed there, and accounts' runs
never appear in the owner's Library, its counts or the live feed.

The API, for the owner only (guests get 401, accounts 403): `GET /api/admin/accounts` (each account
with `runs`, `runsDay`, `runsWeek`, `running`, `failedWeek`, `lastRunAt`, `bytes` and `capBytes`,
and `totals`; `?format=csv` for the file), `PATCH /api/admin/accounts/<id>` with
`{ "disabled": true | false }`, `DELETE /api/admin/accounts/<id>`, `GET /api/admin/generations`
(`?account=<id>`, `status=finished|running|failed`, `kind=image|video|audio|model3d|text`,
`before=<createdAt>:<id>` from the last page's `next`, `limit` up to 100) and
`DELETE /api/admin/generations/<id>` (an account's run only).

An account can delete itself: `DELETE /api/auth/me` with `{ "password" }`. When an account is
deleted (by itself or by the owner), its runs are stopped and removed, and its uploads and results
are deleted with it.

An account changes its password in **Settings → Account**: `PATCH /api/auth/me` with
`{ "current", "next" }` (at least 8 characters, and not the current one). Every other browser signed in to the account is
signed out; the browser that changed it gets a new session. Changing the password and deleting the
account share one limit: 5 password checks a minute per account. A browser that was signed out gets
401 from both, so the page can offer Log in; the owner gets 403.

## Your GPU

An account connects its own ComfyUI in **Settings → Your GPU**, or from the "Connect your GPU" card,
in one of two ways.

### The ComfyUI on this computer

The first choice: the account's open Fuobe tab runs its jobs on the ComfyUI on the same computer.
The server still plans every run (templates, inputs, checks, limits, history). Each ComfyUI call
becomes a job that the tab takes (`/api/gpu/computer/*`), sends to `http://127.0.0.1:<port>`,
follows, and whose results it uploads back; results are checked like uploads, and a job takes only
its own results, once. The server never calls the person's computer. Runs wait while no tab is open
("Open Fuobe on the computer with your ComfyUI to run this") and stop cleanly after a while.

- **Finding ComfyUI.** The card looks on ports 8188, 8000 (ComfyUI Desktop), 8189, 8190, 8288, 8001
  and 7821, or one the person types. While the browser would still ask to let the site reach apps
  on this device, it looks only after a click, and explains that question first. A tab never
  reaches the computer's apps by itself before that.
- **Fuobe Connect (the one step).** A page can read a ComfyUI on the computer only when ComfyUI lets
  that site in. Fuobe Connect (`integrations/fuobe-connect`, from ComfyUI-Manager or a git clone)
  lets in only the studios that the person trusts (`https://fuobe.com` unless they name others), and
  only for what a run needs. Every other website still meets ComfyUI's own check. The card asks for
  this one install and connects by itself when ComfyUI is back with it. The setting and the guard
  below are under "Advanced". See [gpu-workers.md](gpu-workers.md).
- **Pairing** (Safari, phones, a blocked browser, a PC with no screen): Fuobe Connect shows a code,
  and the person approves it while signed in (`/connect?code=…`). That ComfyUI then runs this
  person's jobs, and only theirs, with no tab open. Settings → Your GPU lists it, with Disconnect.
- **Fuobe's setting (Advanced).** Without Fuobe Connect, ComfyUI must run with
  `--enable-cors-header <the site's address>`. The card gives the fix for the install it finds: a
  start file for Windows portable or Easy-Install (it restarts ComfyUI with the setting and leaves a
  start file with it for next time; it never changes the person's own start files), the place in
  ComfyUI Desktop's Server-Config, Stability Matrix's launch options, or the flag for a terminal.
  It notices by itself when ComfyUI is back with it.
- **Fuobe's guard.** With that setting, ComfyUI stops turning away other websites' requests.
  `fuobe_guard.py` (src/lib/comfy-guard.ts), a custom node that the start file puts in
  `custom_nodes` and that the other installs download from the card, puts the check back: a request
  from a web page gets in only from ComfyUI's own page or the site the setting names, the live
  socket included. It answers `GET /fuobe/guard`, and the card warns while it's missing.
- **Phones and Safari** can't reach a ComfyUI on the device: they get pairing and the link instead, with why.

The owner can do the same on a deployed studio: **Settings → Where ComfyUI runs → On the computer
you're using**. A studio with ComfyUI on its own machine keeps calling it from the server.

### A link

For runs that go on with the tab closed. The studio's server calls that ComfyUI, so it must be
reachable from the internet. Put a tunnel in front of a local ComfyUI and paste the https address
it prints:

```bash
cloudflared tunnel --url http://localhost:8188   # or: ngrok http 8188
```

- **Saving.** `PUT /api/account/gpu` with `{ "url", "token"? }` checks the address and asks that
  ComfyUI for `/system_stats` (`?test=1` checks without saving). `DELETE` disconnects. The address
  and the optional token (sent as `Authorization: Bearer`) are stored with the account in
  `auth.json`, never as the studio's ComfyUI setting.
- **Server-side requests.** Addresses on the server itself, on private networks or link-local
  addresses are refused. The check runs again on the address each connection actually uses, so a
  name that is later pointed at the server can't reach the studio's own ComfyUI. The studio's own
  ComfyUI address is refused too, and so are IPv6 addresses that wrap an IPv4 address.
  `FUOBE_ALLOW_PRIVATE_URLS=1` allows private addresses, for a LAN install, but never the server's
  own addresses. Address checks are limited to 10 a minute.
- **Runs.** Everything that runs through `POST /api/generations` runs on the account's ComfyUI
  with the open-source engine: the Image, Video and Audio studios (their input modes too: edit,
  inpaint, extend, lipsync, reframe, upscale, image to video…), every camera motion and effect,
  and the apps that take a picture, a clip or a sound. Their chained steps (multi-shot films,
  Frames mode, Extend, relit effects) run there too, as the account's own. Polls,
  uploads, outputs and cancels go there, and nothing falls back to the studio's own providers. If
  the account's ComfyUI can't be reached, the run fails and says so. A cloud model, an AI helper or
  the studio's local LLM is refused; "Enhance prompt" uses Fuobe's offline wording. Other tools
  (Canvas, Cinema, Shorts, Assist, Marketing…) answer 403 with `code: "own-gpu-tool"`, because they
  plan with the studio's own AI helpers or keep projects of their own. Image to 3D and text to 3D
  answer the same for now: a 3D model is finished on the server. So do the Audio hub's Split
  soundtrack and Video tools → Remove dialogue (both `POST /api/audio-tools`) and the turnaround
  video (`POST /api/turnaround`), though their price checks work, priced for the account's own
  GPU. Split soundtrack's and Remove dialogue's pages say so up front ("Split soundtrack isn't
  available here", "Remove dialogue isn't available here"), with their upload and run off. Result
  menus don't offer Remove dialogue or Clean up dialogue to a guest or an account. Restore & colourise
  and Remove a person (its mask preview and "Redo from here", `POST /api/remove-object/preview` and
  `/reroll`, answer `own-gpu-tool` too) are left out of the Video tools tabs and the result menus for them.
  A hosted model whose calls haven't yet passed a live run with a real key (`src/lib/catalog/hosted-untested.ts`:
  MiniMax H3 Max's lip sync, relight, insert, looks and Turbo, H3 Lite and HighSpeed, Vidu Q4, the Mureka songs and
  song tools, MiniMax Music 3, ElevenLabs Music, Lyria 3.5, the hosted voice cleaners, Meshy retexture, Tripo P2 and
  Fuobe Animation's cloud half) answers `own-gpu-tool` for a guest or an account, even on its own key, and is left out
  of its pickers; Audio → Extend & remix is left out of the Audio tabs. Each opens once a live call passes.
  "Write the lyrics" and "Rewrite my prompt now" use the studio's AI helper and are hidden from guests and accounts.
  A song's stems come back as one zip: for an account it is fetched from public addresses only, within what its files
  have room for (128 MB at most, 256 MB unpacked), and each stem is saved to disk as it is unpacked.
- **Files a run takes.** A run on your GPU takes only files you uploaded here, or your own results.
  A link or a `data:` URI answers 400 with `code: "input-not-allowed"`, someone else's file 403
  (`input-not-yours`), and a file that has expired 404 (`input-gone`, "That file has expired.
  Upload it again."). A file bigger than an upload of its kind may be (one of your own results,
  too) answers 413 (`input-too-big`). The server never fetches a link for an account. The one
  exception is Fuobe's published example files ("Start from an example" on a page): a run may read
  them by their exact path, the same for everyone, from the server's own disk, with no upload and no
  space used. Nothing else outside your own files. A published example file is never removed or renamed.
- **LoRAs and model files.** The server never downloads anything onto your machine. A LoRA a run
  adds (a camera motion's, an effect's, a look's) must already be in your ComfyUI's `models/loras`
  folder. When one is missing, the run answers 409 with `code: "comfy_missing_model"` and a `fix`
  that lists each file, the folder it goes in and where to download it ("Your ComfyUI doesn't have
  2 LoRA files this needs. Download each one into ComfyUI/models/loras, keep the file name, then
  press Generate again."). The same check runs again when the run is handed to your ComfyUI. A
  checkpoint or encoder your ComfyUI lacks is named by ComfyUI's own answer.
- **Limits.** Up to 4 runs at once and 60 an hour; a run makes up to 4 results. A run waits up to
  30 minutes in your ComfyUI's queue and may run for 45. Your ComfyUI's answers have a deadline and
  a size cap (a result up to 1 GB in 15 minutes, and no more than your files have room for; 16
  results a job at most). Each account sends one file to its ComfyUI at a time, and the accounts
  take turns. The clip check (`POST /api/media/probe`) allows 60 a minute and 2 at once.
- **Disk space.** Accounts can't upload or run when the server's data disk is short of space
  (503): it keeps 20 GB free, or a tenth of a smaller disk, and at least 2 GB.
  `FUOBE_ACCOUNT_DISK_FREE_GB` sets another amount, and the server log says when accounts are
  refused for space.
- **What a visitor sees.** For a guest or an account, `GET /api/status` describes its own GPU
  (`viewer`), with the open engine and no Demo mode. It says nothing about the studio's own
  ComfyUI, providers, keys or local AI servers. The account menu (the top bar's right end; the You
  tab on a phone) shows **Your GPU · Connect** (a guest signs up first), or the account's ComfyUI as
  online or offline with its GPU and VRAM, then Settings and the light or dark switch. An
  account's menu also shows its email, Your GPU (`/connect`) and Sign out. Thanks & licences and
  the source on GitHub are in Settings → About, for guests and accounts too.
  `GET /api/models` lists the open-source models for a visitor, and the studios price a visitor's
  run as it would go on its own GPU. The studio's own settings page isn't shown to visitors.

## Your keys

An account can add its own fal.ai key or Replicate token in **Settings → Your keys** (below Your
GPU), or from the "Add your key" card that opens when it picks a paid model it has no key for (a
search in a model picker lists them, dimmed, and a link to one keeps it, with a note), from the
locked engine switch, or from "No GPU?" on the welcome page and the Connect your GPU card. With
a key it runs that provider's paid models (Nano Banana, Seedream, Kling, Veo…), billed to its own
account with that provider. The studio's own keys are never used for an account's run.

- **Checked first.** `PUT /api/account/keys/fal` (or `/replicate`) with `{ key }` checks the key
  with the provider before it is saved: a free call that runs nothing (fal.ai: the status of a
  request that doesn't exist; Replicate: `GET /v1/account`). A refused key answers 422, a provider
  out of reach 503, and nothing is saved. A key that works on a provider account with no balance
  left is saved, with a `note` that says to top it up. `?test=1` only checks. Only a check that
  reaches the provider counts: 10 a minute per account, 20 per address (behind a trusted proxy),
  120 for all accounts together.
- **Stored encrypted.** The key is sealed with AES-256-GCM under a server key in
  `data/secrets.key`, made the first time a key is saved, and kept on the account's record in
  `auth.json`. The server key isn't derived from the sign-in secret, so a new password or "Sign
  everyone out" leaves saved keys working. Without `secrets.key` (lost, or restored from another
  server), saved keys can't be opened: accounts are asked to add them again, and the studio's keys
  are never used instead.
- **Never shown.** `GET /api/account/keys` gives each key's last 4 characters, when it was added,
  whether this server can still open it, and whether the provider refused it in a run. No answer,
  log or error holds a key: a provider's error that echoes the request has it replaced with "••••".
  The owner's **Settings → Accounts** shows which providers an account has a key for (the CSV has
  `fal_key` and `replicate_key`), never the key.
- **Removed with the account.** Deleting an account (by itself or by the owner) switches it off,
  stops its running jobs at the provider with its own key, then removes its runs, files and record,
  keys included. Removing or replacing a key that runs are going on answers 409 `runs-going` first;
  with `{ stopRuns: true }` those runs are stopped with the old key before it changes. A run still
  being handed to the provider is stopped there when its submit lands: the key (or the deleted
  account's record) waits for that, up to a minute.
- **What it changes in the studios.** `GET /api/status` lists the account's keys
  (`viewer.keys`) and its engine mode: `both` while it has a key and the studio isn't open-source
  only, else `open`. The model pickers dim the paid models it has no key for ("Add your Replicate
  key"), and prices say who pays ("≈ $0.15 · your fal.ai account"). A paid run without the key
  answers 403 with `code: "add-key"` and an `x-fuobe-add-key` header naming the provider.
- **Limits.** Every account limit applies to paid runs too (4 at once, 60 an hour, 4 outputs a run,
  its space), checked before anything reaches the provider. Runs with a key send the prompt and the
  attached files to that provider. civitai LoRAs are left out of runs on an account's key (copying
  them would use the studio's civitai key). Assist, text steps, 3D and the other tools stay closed.
- An account on a studio set to **Open source only** keeps its keys, but they aren't used.

## Hosted runs

By default an account runs only on its own GPU or its own key. An owner who wants accounts to run on the studio's own
ComfyUI instead sets `FUOBE_HOSTED_RUNS=1`. It is off unless set, and with it off nothing below changes.

With it on:

- An account with no GPU of its own can run in the studios (generations, camera motions, effects, apps). The run goes
  to this install's ComfyUI server (the address in Settings). An install whose ComfyUI runs on the owner's computer
  doesn't offer hosted runs.
- An account whose own GPU is online runs there by default. The composer shows where a run goes ("Your GPU" or "This
  studio's GPUs"), and the person can pick either.
- Every other tool still needs the account's own GPU ("This tool doesn't run on your own GPU yet" stays as it is).
  Image to 3D, extra LoRAs added to a request, and clips and sound as inputs stay on the account's own GPU.
- An account can upload pictures for these runs. Clips and sound still need its own GPU or key.
- A new account goes back to where it was after sign-up, not to "Connect your GPU". Connecting a GPU stays in
  Settings → Your GPU and at `/connect`; the account menu says "Your GPU · Optional".
- A run waiting for the studio's GPUs shows its place in line ("In line · 3rd · about 40 s"). A run may wait
  `FUOBE_POOL_WAIT_MIN` minutes (30 by default); past that it fails.
- The account's usual limits apply: runs at once, runs per hour, outputs per run, and its space.

Two optional services can go with it:

- a **billing service** ([billing-hook.md](billing-hook.md)): prices runs on this install's GPUs, sets the price aside
  before a run starts, and shows the person a balance. Without one, these runs are free.
- a **moderation service** ([moderation-hook.md](moderation-hook.md)): checks a run before it starts and, when it asks
  to, its outputs before they show. Without one, nothing is checked.

The code is `src/server/hosted.ts` (the switch, the place, the line), `src/server/hosted-run.ts` (the run route's side),
`src/server/run-stamp.ts` (what every row of a run carries) and `src/lib/hosted.ts` (the browser's side). The tests are
`tests/hosted-runs.test.ts`, `tests/billing-hook.test.ts`, `tests/billing-release.test.ts` and
`tests/moderation-hook.test.ts`.

## Uploads

An account with its own ComfyUI connected, or its own key, can upload files (`POST /api/uploads`,
the file as the request body with its type in `Content-Type` and its name in `X-File-Name`; an
older page's multipart form works up to 26 MB). With neither it answers 403 with
`code: "connect-gpu"`, and a guest gets 401 with the sign-up card.

| What | Types | Largest |
|---|---|---|
| Pictures | PNG, JPEG, WebP | 25 MB and 40 megapixels |
| Sound | MP3, WAV, OGG, FLAC, M4A, WebM | 50 MB |
| Clips | MP4, MOV, WebM, MKV, AVI | 95 MB (ComfyUI takes up to 100 MB unless started with more) |

- The type is read from the file's first bytes. A file that isn't one of these answers 415.
- `Content-Length` is required (411), and a file over its size answers 413 before it is read.
- An account keeps up to 1 GB of uploads and 3 GB of files in all (uploads and results); in its
  first 7 days, 1 GB in all. Past that, uploads and runs answer 413: delete some runs to make room.
- All accounts together keep at most a quarter of the data disk (`FUOBE_ACCOUNTS_DISK_GB` sets
  it), and the disk always keeps its free floor (`FUOBE_ACCOUNT_DISK_FREE_GB`). Past either,
  account uploads and runs answer 503 "short of space"; the owner's work is not affected.
- Up to 60 uploads an hour, 300 a day and 2 at once (429 with `Retry-After`). An upload sent as a
  form (older pages, held in memory) also waits for a place among 8 from every account together.
  An upload ends with 408 when nothing arrives for a minute, or when it takes over 30 minutes.
  One address (one network) makes at most 20 accounts a day.
- **How long files stay.** Uploads are removed after 14 days, even when a run still uses them.
  Runs and their results are removed after 30 days. Everything goes at once when the account is
  deleted.

`GET /api/auth/me` (open to everyone) says who is looking: `{ signedIn, owner, publicSignup,
account? }`.

The rules are in `src/lib/guest-access.ts` (which paths guests and accounts may use) and
`src/proxy.ts` (where they are applied). Your GPU is `src/server/account-gpu.ts`, `onOwnGpu` in
`src/server/providers/comfyui.ts` and `accountRun` in `src/server/generations.ts`; what an account's
work may read is `src/server/tenant.ts`. Your keys are `src/server/account-keys.ts` (storage),
`src/server/secret-box.ts` (encryption), `src/server/provider-keys.ts` (`cloudKey`, the one place a
fal.ai or Replicate key is read) and `src/app/api/account/keys`; their tests are the
`tests/account-keys*.test.ts` files, `tests/secret-box.test.ts`, `tests/byo-keys-static.test.ts` and
`tests/e2e/byo-keys.mjs` (against stand-in providers). Uploads are `src/app/api/uploads/route.ts` (which makes the
proxy's checks itself, `src/server/direct-gate.ts`), the limits are in `src/server/account-files.ts`
and the clean-up in `src/server/account-sweep.ts`. The owner's view of what accounts make is
`src/server/account-admin.ts`. The tests are in `tests/public-signup.test.ts`,
`tests/accounts-admin.test.ts`, `tests/account-runs-admin.test.ts`, `tests/account-gpu.test.ts` and
the `tests/account-*.test.ts` files.
