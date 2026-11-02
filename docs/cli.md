# The `fuobe` command line

`fuobe` makes images, video, audio, 3D and text with a Fuobe server from a terminal, a script or a
coding agent. It talks to the server's REST API (and its MCP endpoint for the studio tools), so
everything it starts shows up in the Library like any other job, on the cloud or the open-source
engine. It is plain Node (20 or later) with no dependencies: `bin/fuobe.mjs` and `bin/lib/`.

```bash
fuobe generate "a red fox in fresh snow, golden hour" --out renders/
```

## Install

In a Fuobe checkout (the folder you run the server from):

```bash
npm link                 # puts `fuobe` on your PATH; it links bin/fuobe.mjs, nothing is installed
fuobe --version
```

`ln -s "$PWD/bin/fuobe.mjs" ~/.local/bin/fuobe` does the same by hand. On another machine you only
need the `bin` folder and `package.json`:

```bash
git clone --depth 1 --sparse https://github.com/workingprototype/Fuobe fuobe-cli
cd fuobe-cli && git sparse-checkout set bin && npm link
```

Or run it in place with `node bin/fuobe.mjs …`.

## Connect to a server

The CLI finds its server and token in this order:

| | server | token |
|---|---|---|
| 1 | `--url` | `--token` |
| 2 | `FUOBE_URL` | `FUOBE_TOKEN` |
| 3 | the file `fuobe login` saved | the same file, for that server only |
| 4 | `http://localhost:3000` | none |

The saved token goes only to the server it was saved with. A `--url` or `FUOBE_URL` that names
another server gets no token unless you pass `--token` or set `FUOBE_TOKEN` (those two go to
whichever server the command talks to); `fuobe status` says when the saved token was left out.

A Fuobe without a password (the default for local use) needs no token. Once a password is set, the
CLI needs an **API token**: open **Settings → Security → API tokens** in the browser
(`http://localhost:3000/settings#security`), create one and copy it. It starts with `fuobe_` and is
shown once.

```bash
fuobe login
# Fuobe server [http://localhost:3000]: studio.lan:3000
# This Fuobe has a password. Create an API token in Settings → Security → API tokens … and paste it here.
# API token: ········
# Signed in to http://studio.lan:3000 with an API token.

fuobe login --url https://studio.example.com --token fuobe_…   # without questions (scripts, CI)
fuobe status                                                   # where it points, and whether the token works
fuobe logout                                                   # forget the saved address and token
```

`fuobe login` checks the address and the token before saving them to
`~/.config/fuobe/config.json` (`$XDG_CONFIG_HOME/fuobe/config.json` when that is set, or
`FUOBE_CONFIG`). The folder is created readable by you only (0700) and the file is written 0600.

## Commands

Every command takes `--json` (machine-readable output on stdout; errors as `{"error": …, "status": …}`
on stderr), `--url`, `--token` and `--help`. `fuobe <command> --help` lists its options.

### `fuobe models` — what you can run

```bash
fuobe models --kind video --engine open        # open-source video models (ComfyUI)
fuobe models --search kling                    # every word must match the name, vendor, what it does or the id
fuobe models --op tts --json                   # models that run one operation, with voices, sizes and lengths
fuobe models --hidden                          # also the helper models studios use behind the scenes
```

`--kind` is `image`, `video`, `audio`, `text` or `model3d`; `--engine` is `open` or `cloud`. The
price says how a run goes today, following Settings → Placeholder results: "(demo)" runs but returns placeholder
media for free (placeholder results are on); "(not set up)" won't run until its
provider is set up. `--json` gives the same as `runs` (`real`, `demo` or
`refused`) per model. An install set to one engine only (Settings → Engine mode) lists that
engine's models only.

### `fuobe estimate` — price a run first

Takes the same options as `generate` and starts nothing. Local files aren't uploaded to price a run.

```bash
fuobe estimate "a fox in the snow" --model nano-banana-pro --count 4
# Nano Banana Pro (cloud) · Text to image · 4 images · about $0.60
fuobe estimate "slow push-in" --model kling-3 --image still.png --duration 10
```

### `fuobe generate` — make something

```bash
fuobe generate "a red fox in fresh snow, golden hour" --wait                 # the Image studio's model; prints the URLs
fuobe generate "make it blue" --image photo.jpg --engine open --out .        # an edit on the open engine, saved here
fuobe generate "she turns and smiles" --model kling-3 --image portrait.jpg \
  --aspect 9:16 --duration 5 --out renders/                                  # image to video
fuobe generate "Welcome to the studio." --kind audio --out audio/            # speech (ElevenLabs v4)
fuobe generate "Hello there." --kind audio --voice-audio me.wav --wait       # in your voice (Chatterbox; --engine open runs it on ComfyUI)
fuobe generate --model oss-join-clips --video a.mp4 --video b.mp4 --out .    # join two clips
fuobe generate "make it rain" --model kling-o3 --video clip.mp4 --wait       # edit a video
echo "a long prompt…" | fuobe generate - --model seedance-2-5 --wait         # the prompt from stdin
```

With no `--model`, the studio's own pick is used and named on stderr: `--kind image` (the default;
the Edit studio's model when you pass `--image`), `video` or `audio`, on `--engine` (else the cloud,
unless the install runs open source only). With `--kind audio`, a `--voice-audio` sample picks a
model that clones it (`chatterbox-cloud`, or `oss-chatterbox` on the open engine), and two samples
pick the open dialogue model (`oss-chatterbox-dialogue`; no cloud dialogue model clones voices). A
model named with `--model` that would ignore a sample (premade voices only, or one speaker for two
samples) is refused with a sentence instead. Any other video or audio input needs `--model`,
because many kinds of model take one (edit, extend, lip-sync, transcribe…).

| option | goes to |
|---|---|
| `-m, --model <id>` | the model (`fuobe models`) |
| `--op <op>` | the operation when the inputs leave it open (`t2i`, `edit`, `i2v`, `t2v`, `flf2v`, `ref2v`, `extend`, `tts`, `transcribe`, `translate`, `trim`, `mux`…) |
| `-i, --image <file\|url>` | the image to edit, the start frame, or references (repeat, up to 14) |
| `--end-image`, `--mask` | the end frame; an inpaint mask |
| `--video <file\|url>` | the video to edit, extend, trim or lip-sync; two or more are clips to join |
| `--ref-video`, `--ref-audio` | reference clips (reference to video) |
| `--audio`, `--background-audio` | a voice track, a soundtrack, a recording to transcribe; a second track mixed under it |
| `--voice-audio <file>` | a voice to clone or change into (twice for a dialogue's two speakers) |
| `-a, --aspect`, `-r, --resolution`, `-d, --duration` | `16:9`, `1080p`, seconds |
| `-n, --count <n>` | takes (1–8) |
| `--seed`, `--negative`, `--sound` / `--no-sound`, `--enhance` | seed, negative prompt, native sound, prompt rewriting |
| `--voice <id>`, `--language`, `--source-language` | a premade voice; the language to translate or dub into; the spoken one |
| `--start`, `--end` | trim points in seconds |
| `-p, --param key=value` | any other model setting (numbers, booleans and JSON are read as such; unknown keys go to `params.extra`) |
| `-w, --wait` / `-o, --out <dir>` | wait and print the results / wait and save the files |
| `--timeout`, `--interval` | how long to wait (default 1800 s, 0 = no limit) and how often to check (default 2 s) |

Inputs can be local files, `https://` links or `/api/files/…` URLs from earlier results. Local files
are uploaded through `/api/uploads` first (up to 200 MB each; a file named twice is uploaded once),
after every file has been found and the request has been checked, so a missing input fails before
a big upload. Downloads are named `<id>.<ext>` (`<id>-<n>.<ext>` for several outputs) and always
land in `--out`. When the server can't run a request it says what's missing, and the CLI names the
option: `Add a portrait and a voice track (use --image <file|url> and --audio <file|url>)`.

Without `--wait` or `--out`, `generate` prints the job ids and returns at once.

### `fuobe status`, `fuobe wait`, `fuobe download`, `fuobe cancel`

```bash
fuobe status                         # the server: engine mode, placeholder results, providers, the local LLM, the token
fuobe status V1StGXR8_Z5j            # one or more generations
fuobe wait V1StGXR8_Z5j 3Kp9x2LmQa7c # until each is done; prints the output URLs (text results inline)
fuobe wait V1StGXR8_Z5j --out renders/
fuobe download V1StGXR8_Z5j --out renders/    # waits first; --no-wait fails if it isn't finished
fuobe cancel V1StGXR8_Z5j
```

Files are saved as `<id>.<ext>` (`<id>-1.png`, `<id>-2.png`… when a job has several outputs). On a
terminal, waiting shows one progress line; Ctrl+C stops waiting, not the job.

### `fuobe list` — your recent generations

```bash
fuobe list --kind video --limit 5
fuobe list --status failed --json
fuobe list --search "red fox" --model nano-banana-pro
```

### `fuobe upload` — files to pass by URL

```bash
fuobe upload product.png        # prints /api/files/uploads/…/….png
```

Useful for MCP tools and `fuobe tool`, which take URLs.

### `fuobe skills` — Assist skills

```bash
fuobe skills list                                   # built-in and yours, on or off
fuobe skills show katana                            # the SKILL.md
fuobe skills disable katana                         # Assist and MCP clients stop offering it
fuobe skills enable katana
fuobe skills add ./my-skill                         # a folder with a SKILL.md (and its text files)
fuobe skills add launch-video.zip                   # a .zip or .skill archive, or a SKILL.md
fuobe skills add owner/repo --skill launch-video    # one skill from a GitHub repository
fuobe skills add https://github.com/owner/repo/tree/main/skills/launch-video
fuobe skills add ./my-skills --replace              # overwrite your own skills of the same names
```

`add` finds skills the way the open `skills` CLI does: the folder itself when it holds a `SKILL.md`,
else `skills/`, `.agents/skills/`, `.claude/skills/` and the folders right under it (up to three
levels), else any `SKILL.md` a few levels down; skills marked `metadata.internal: true` are left out
unless named with `--skill`. Each skill is uploaded as a zip with its text files (binaries and
dot-files are left out, and listed). Git sources need `git`. A skill's `recipe.json` (a skill that runs
by itself; see `skills/README.md`) goes up with it but starts unchecked: `skills run` checks it for free
before its first run, or check it in **Assist → Skills**.

#### Running a skill that runs by itself

A skill with a recipe runs its saved steps with new inputs, with no AI model planning them: priced
first, the same steps every time.

```bash
fuobe skills params weekly-promo                    # its inputs: id, type, needed or default, what it takes
fuobe skills estimate weekly-promo -p product=lamp.png -p name="Lumen desk lamp"
fuobe skills run weekly-promo -p product=lamp.png -p name="Lumen desk lamp" --wait
fuobe skills run weekly-promo --rows products.csv --engine cloud --out renders/
fuobe skills export weekly-promo --out weekly-promo.zip   # SKILL.md and its files, to add elsewhere
```

- `-p input=value` gives one input (repeat it; `fuobe skills params` lists the ids). A file input takes a
  local file, an `https://` link or a `/api/files/…` URL. Local files are uploaded only when it runs:
  `estimate` prices with stand-ins, as `fuobe estimate` does.
- `--rows rows.csv` runs it once per row (up to 50; `-` reads the table from stdin). The first row names
  the inputs by id or label, as the **Many** tab of the Run dialog reads it; a spreadsheet's paste (tabs)
  works too. A file path in a cell is read from the table's folder, and each file goes up once. `-p` fills
  what the rows leave empty. A row that doesn't fit is named by its line, and then nothing starts.
- `run` prices the whole batch first and asks `Run 20 for $12.40? [y/N]` when it costs money. `--yes`
  starts it without asking; `--json` alone doesn't (a script adds `--yes`). Without a terminal to ask
  on, it stops and says to add `--yes`. Free runs (your GPU, or a demo) start without asking. Once
  your files are uploaded it prices them again (a clip is priced by its length): when that's more, it
  asks again with the new price, or stops without a terminal.
- `--engine open|cloud` picks where it runs, among the engines its steps run on (by default: where it
  was checked). A skill not yet checked on that engine gets its free plan check first.
- `--wait` and `--out <dir>` wait for the results and save them, as `fuobe generate` does; without them,
  `run` prints the ids to pass to `fuobe wait` or `fuobe download`. When a row didn't start (a studio
  tool's run can refuse one row and start the rest), it says which by its line in your file and exits 1;
  `--json` lists every run under `runs`, each with its `error` and, for `--rows`, its `line`.
- `export` saves the skill as a zip (`SKILL.md`, `recipe.json` and its other files); `--examples` keeps
  the values it was made with, which are left out by default.

### `fuobe tools`, `fuobe tool` — the MCP tools

The studio jobs (Katana, dubbing, Faceless episodes, Layers, ads, captions…) are MCP tools. The CLI
can call them without an MCP client:

```bash
fuobe tools                                           # the list
fuobe tool katana --schema                            # what it takes
fuobe tool search_models --arg kind=video --arg query=kling
fuobe tool estimate_job '{"tool": "katana", "arguments": {"reference": "/api/files/…", "photos": ["/api/files/…"]}}'
echo '{"ids": ["V1StGXR8_Z5j"], "wait_seconds": 60}' | fuobe tool check_generations -
```

### `fuobe mcp` — connect an agent

```bash
fuobe mcp
# claude mcp add --transport http fuobe http://localhost:3000/api/mcp
```

Run the printed line to add Fuobe to Claude Code. With a token, the line carries
`--header "Authorization: Bearer fuobe_…"`; keep it out of shared places. Other MCP clients (Claude
Desktop, Cursor, Codex…) take the server entry it prints on stderr (`fuobe mcp --json` gives both):

```json
{ "mcpServers": { "fuobe": { "type": "http", "url": "http://localhost:3000/api/mcp", "headers": { "Authorization": "Bearer fuobe_…" } } } }
```

The agent then has `search_models`, `estimate_cost`, `generate`, `check_generations`, the studio
tools and Fuobe's skills as prompts.

### `fuobe eval` — measure the Fuobe Originals

From a Fuobe checkout, `fuobe eval <command>` is the evaluation harness (`pnpm eval:<command>`). It
finds the server and token as the other commands do, so the saved token goes only to the server it was
saved for, even when `--url` names another:

```bash
fuobe eval run --suite selftest --engine demo        # a free self-test of the harness
fuobe eval run --suite soul --engine open --looks v1-general --variants recipe,prompt-only
fuobe eval compare latest~1 latest --fail-on clip --threshold 1   # exit 1 on a regression
fuobe eval trash latest                              # the run's generations to that Fuobe's Trash
```

See [`scripts/eval/README.md`](../scripts/eval/README.md) for the suites, metrics, blind review and
the promote rule.

### `fuobe worker`

Runs this PC's GPU as a worker for a studio: it takes the studio's ComfyUI jobs over HTTPS and runs them on its own
ComfyUI, and it opens no port. See [gpu-workers.md](gpu-workers.md).

```bash
node scripts/build-worker.mjs     # once, in the checkout: the worker's shared parts
fuobe worker setup                # the studio's address, the token from Settings → Workers, ComfyUI's folder, a port
fuobe worker run                  # until Ctrl+C
fuobe worker pause                # finish the job, then stop its ComfyUI;  --now: stop now;  --for 2h: back by itself
fuobe worker resume
fuobe worker status
fuobe worker install              # Windows: shows a sign-in task and pause/resume shortcuts; --yes adds them
```

## Skills for other agents

Fuobe's skills are [Agent Skills](https://agentskills.io/specification), so the open `skills` CLI
installs them into Claude Code, Codex, Cursor, OpenCode, Copilot and others:

```bash
npx skills add workingprototype/Fuobe --skill fuobe   # how to drive Fuobe (MCP first, then this CLI)
npx skills add workingprototype/Fuobe --list          # the 20 playbooks (UGC videos, product photos, dubs…)
npx skills add workingprototype/Fuobe -a claude-code  # all of them, for Claude Code
```

`fuobe` lives in `.agents/skills/fuobe/`; the playbooks in `skills/` (see `skills/README.md`). Each
playbook ends with "Using Fuobe from an agent", naming the MCP tools to call, so connect the MCP
server too (`fuobe mcp`).

## Exit codes and environment

| code | means |
|---|---|
| 0 | done |
| 1 | failed: a generation failed or was canceled, or the server refused the request |
| 2 | the command was mistyped (the message says what to type instead) |
| 3 | still running when `--timeout` ran out (`fuobe wait <id>` picks it up again) |
| 130 | stopped waiting with Ctrl+C (the job keeps running) |

| variable | |
|---|---|
| `FUOBE_URL`, `FUOBE_TOKEN` | the server and the API token |
| `FUOBE_CONFIG` | another config file than `~/.config/fuobe/config.json` |
| `FUOBE_DEBUG=1` | print the stack of an unexpected error |

## When something goes wrong

- **"Can't reach Fuobe at http://localhost:3000 (connection refused). Is the server running?"** —
  start it (`pnpm dev`, or `pnpm build && pnpm start`) or point `FUOBE_URL` / `fuobe login` at it.
- **"… has a password, so the CLI needs an API token"** — create one in Settings → Security → API
  tokens, then `fuobe login` (or set `FUOBE_TOKEN`).
- **"… refused the API token"** — it was revoked, or belongs to another server: create a new one.
- **"The token "fuobe login" saved is for …, so it isn't sent here"** — `--url` or `FUOBE_URL` names
  another server than the one you signed in to: pass `--token`, or `fuobe login --url <that server>`.
- **"(demo)" results** — Settings → Placeholder results is on (for a tour): turn it off, and add a
  key in Settings (cloud), or start ComfyUI (open source). Demo results cost nothing and are
  labelled in the Library.
- **"(not set up)" in `fuobe models`, or "Connect … in Settings to run this model"** — the
  model's provider isn't set up yet.
- **"… is a cloud model, but you asked for --engine open"** — pick a model of that engine
  (`fuobe models --engine open`) or leave out `--engine`.

## What it calls

For script writers who'd rather call the API directly: `GET /api/models` (`kind`, `engine`, `op`,
`q`, `hidden=1`; it answers with the studios' `defaults` per engine, `demoMode`, and per model
`connected` and `runs`), `POST /api/generations` (with `?preview=1` to price; a model id Fuobe has
retired runs on the model that replaced it, and the answer gives that `modelId` with `notes` saying so),
`GET /api/generations[/<id>]`,
`POST /api/generations/<id>/cancel`, `POST /api/uploads` (multipart `file`), `GET /api/files/…`,
`GET /api/status`, `GET|PATCH /api/assist/skills[/<name>]`, `POST /api/assist/skills/upload`
(`?replace=1`), a skill's `GET …/recipe`, `POST …/estimate`, `…/run` and `…/verify` (`{level: "plan"}`)
and `GET …/download?format=zip` under `/api/assist/skills/<name>` (estimate and run take `values`, or
`csv`, and `engine`), and `POST /api/mcp` (JSON-RPC). Every call carries `Authorization: Bearer <token>`
when there is one, and only to the Fuobe server (never to a link elsewhere, and the saved token only
to the server it was saved for).
