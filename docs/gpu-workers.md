# Workers: share your GPUs with other machines

A Fuobe studio can run its ComfyUI jobs on GPUs in other places:

- **Fuobe Connect** connects a person's own ComfyUI to their account. Each person installs it once in ComfyUI. Their
  runs then go to their own GPU.
- **Workers** are the owner's GPUs on other PCs, for example a team's machines or a spare PC. Each PC runs
  `fuobe worker`. The worker takes the studio's ComfyUI jobs and runs them on its own ComfyUI.

Both use the same job routes as the browser's "Use the ComfyUI on this computer" (`/api/gpu/computer/*`). Both call
the studio over HTTPS, and neither opens a port. With no worker added and nothing paired, the studio works as before.

## Fuobe Connect (a person's own ComfyUI)

Fuobe Connect is a ComfyUI custom node pack. Its code is in `integrations/fuobe-connect`, and its own README tells you
how to install it. It adds no nodes.

**Direct mode.** ComfyUI turns away every other website. Fuobe Connect lets in only the studios that you trust. Each
studio is an exact origin, and the default is `https://fuobe.com`. You can add your own studio in ComfyUI's settings,
or with `FUOBE_CONNECT_ORIGINS`. A trusted studio can use only what a run needs: ComfyUI's facts, model lists, queue
and history, the run's results, uploads of its inputs, and its prompt. It cannot reach the Manager's install calls,
your user files or your settings. Fuobe Connect answers the CORS and Private Network Access preflights for the trusted
origins only. Every other website still meets ComfyUI's own check.

You do not need a start flag or a guard file. In the studio, **Connect your GPU** finds ComfyUI after one browser
"Allow" prompt, and then connects.

**Pairing mode.** Use pairing with Safari, phones, a blocked browser or a PC with no screen:

1. In ComfyUI, open **Extensions → Connect to Fuobe**. On a PC with no screen, start ComfyUI with
   `FUOBE_CONNECT_PAIR=1`. Fuobe Connect asks the studio for a short code: `POST /api/gpu/pair/start`.
2. The person opens `/connect?code=…`, signs in, checks the computer's name and GPU, and approves the code:
   `POST /api/gpu/pair`. A code is valid for 10 minutes and works only once.
3. Fuobe Connect polls with a secret that only it knows: `POST /api/gpu/pair/poll`. After the approval, its next poll
   gets a worker token (`fuobe_wkr_…`). The studio makes the token at that moment and keeps only its SHA-256 hash.

The token acts only as that person's own computer. The ComfyUI gets that person's jobs, and nobody else's. The jobs
run with no Fuobe tab open. The person can disconnect the ComfyUI in Settings → Your GPU (`DELETE /api/gpu/paired/<id>`)
or press Disconnect in ComfyUI (`POST /api/gpu/computer/unpair`). A disconnected token gets 401 at its next call.

## Workers (the owner's shared GPUs)

### Add a worker

1. In **Settings → Workers**, press **Add a worker** and give it a name. The page shows the worker's token only once.
   The worker starts paused, with no hours and no lanes.
2. On the GPU's PC, you need Node 22 or later and git. Install the worker from a git checkout of Fuobe at a release tag
   that you have verified (see "Install and update"). Run `node scripts/build-worker.mjs`, then run
   `node bin/fuobe.mjs worker setup`.
   Setup asks for the studio's address, the token (as hidden input), ComfyUI's folder, the model folders, a worker
   folder and the path of ffmpeg (see "Clips and sound"). It refuses these:
   - a studio address that does not start with `https://` (only `http://127.0.0.1` and `http://localhost` are allowed,
     for tests);
   - a folder that a cloud drive syncs;
   - an ffmpeg path where no ffmpeg runs.

   On Windows it marks the worker folder as "not content indexed". The settings go to `worker.json`, and only you can
   read that file. Setup also pauses the worker on the PC.
3. In Settings → Workers, set the worker's hours and the lanes it may run (with a delay for each lane), then press
   **Resume**. On the PC, run `fuobe worker resume`, then `fuobe worker run`. On Windows, `fuobe worker install` shows a
   sign-in task and pause and resume shortcuts (Ctrl+Alt+P). It adds them only when you run it again with `--yes`.
4. To send the studio's own ComfyUI jobs to the workers, select **Run this studio's ComfyUI jobs on the workers** in
   Settings → Workers (the setting is `comfyWhere=workers`).

On a machine with no keyboard, set `FUOBE_WORKER_TOKEN` and `FUOBE_WORKER_SITE` so that the token stays out of files.

### Install and update

The worker runs other people's jobs on your PC, so install it only from code that you can check. The studio does not
offer the worker as a download. Use a git checkout at a signed release tag:

1. Clone the repository once: `git clone https://github.com/workingprototype/Fuobe.git`.
2. Fetch the tags: `git fetch --tags`.
3. Verify the tag that you want: `git verify-tag <tag>`. Go on only when git says that the signature is good and the
   key is one that you trust.
4. Check it out: `git checkout <tag>`.
5. Build the worker's parts: `node scripts/build-worker.mjs`.

To update, stop the worker, do steps 2 to 5 with the new tag, and start the worker again. Do not install the worker
from a zip file, from a copy that someone sends you, or from a branch.

### The worker's own ComfyUI

The worker always starts and stops its own ComfyUI process. It never uses a ComfyUI that it did not start. Its ComfyUI:

- listens on `127.0.0.1` only, on a free port that the worker picks at random (20000 to 59999) at each start. Port
  8188 is never used. To fix one port instead, set `port` in `worker.json`;
- starts through the worker's guard (see below), with the worker folder as its working folder. A node that writes to
  a relative path writes into the worker folder, not into ComfyUI's folder;
- uses its own `user`, `input`, `output` and `temp` folders in the worker folder;
- gets the model folders through `extra_model_paths.yaml`;
- starts with `--disable-metadata` and `--disable-auto-launch`, and with `--disable-partner-nodes` when that ComfyUI
  has the flag (the worker reads ComfyUI's `comfy/cli_args.py` to find out);
- loads only the custom node packs that the worker found (`--disable-all-custom-nodes --whitelist-custom-nodes …`).
  The worker finds a pack whatever the case of its folder name, and gives ComfyUI the folder name as it is on disk;
- gets only the environment variables that it needs: the system's own, `PATH`, the temp folder, the user folders
  (for model caches) and the graphics card's settings. Your keys, tokens and other settings do not reach it. To add a
  variable, put it in `comfyEnv` in `worker.json` (for example `{ "comfyEnv": { "MY_SETTING": "1" } }`);
- loads models only from this PC: `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `HF_DATASETS_OFFLINE=1` and
  `PIP_NO_INDEX=1` are always set. A node that downloads its model on its first run needs that model on the PC first.

**The port guard.** Before each start, the worker binds the port itself and releases it at once. If the bind fails,
another program is using the port. The worker then does not start ComfyUI, pauses itself (its state says "port-busy")
and never connects to that port. The worker also talks to its ComfyUI only while the process that it started is
running.

**The guard.** The worker makes a new random key at each start. It starts ComfyUI through
`bin/lib/worker/comfy_guard.py`, which it copies into the worker folder (`guard/`) first. The guard reads the key from
the environment, removes it from there, and puts a check in front of every request to ComfyUI:

- The `Host` header must be exactly `127.0.0.1:<port>`. A web page that points its own name at 127.0.0.1 (DNS
  rebinding) sends its own name, so it is refused.
- The request must carry the key in `X-Fuobe-Worker-Key`. The worker sends it with every request and with the live
  socket. Without it, the answer is 403.

Before the worker sends the key, the process on the port must prove two things. It signs a random challenge with the
key (`GET /fuobe-worker/hello`, HMAC-SHA-256), and it names its process id, which must be the one that the worker
started. A program that took the port first learns nothing. When ComfyUI is ready, the worker also checks that a
request without the key is refused. If it is not refused, the guard is missing. The worker then stops that ComfyUI,
does not use it, and pauses itself for an hour ("comfy-crashes").

**A ComfyUI left running.** The worker writes its ComfyUI's process id to `comfyui.pid` in the worker folder. If the
worker stops without stopping ComfyUI (a crash), the next start finds that file. It stops that process, but only when
the process's command line still names the guard in this worker folder, so a reused process id is never stopped.

**Its log.** ComfyUI's output goes to `comfyui.log` in the worker folder. Each start begins a new file, and so does a
file that passes 20 MB. The worker keeps the two files before it (`comfyui.1.log`, `comfyui.2.log`).

**When its ComfyUI stops by itself.** The worker starts it again after a short wait: 5 seconds, then twice as long each
time in a row, at most 2 minutes. If ComfyUI stops twice while it runs the same job, that job fails with plain words
("This run stopped twice at the same point"), and the worker goes on with the next job. If ComfyUI stops more than 3
times in one hour with no job running, the worker pauses itself ("ComfyUI keeps stopping").

### Pauses

The worker obeys any one of these pauses. One pause never ends another pause.

- **On the PC:** `fuobe worker pause` lets the current job finish. `--now` sends the job back to the queue at no cost.
  `--for 2h` resumes the worker by itself after 2 hours. The worker then stops its ComfyUI, so the VRAM and the RAM go
  back to you.
- **On the website:** Settings → Workers has **Pause**, **Pause now** and **Finish, then pause**. Each one reaches the
  worker within one beat.
- **The GPU is busy.** Every 5 seconds, the worker reads `nvidia-smi`. It reads nothing else and contacts no other
  port. Other programs' VRAM is the GPU's used memory minus what the worker's own ComfyUI holds. If that is above
  1,024 MB (`busyVramMb`), or if another process shows more than that of its own, the worker pauses at once. Its job
  goes back to the queue and its ComfyUI stops. This works also when the per-process memory reads `[N/A]`, as it often
  does on Windows. The state says "Your GPU is busy (blender.exe)".
- **Automatic resume** (off by default): after a busy pause, the worker resumes only after the GPU stayed free for
  `resumeAfterMin` minutes in a row (10) and is cooler than `resumeBelowC` (75 °C). Any busy reading restarts the
  cool-down. A pause by hand is never ended by the automatic resume. Turn it on with `autoResume` in `worker.json`, or
  with **Resume by itself after another program used the GPU** in Settings → Workers. The website's switch wins over
  `worker.json`. With it on, a PC can serve whenever its owner isn't using the GPU.
- **Hours:** outside its hours, the worker takes nothing new. Near the end of a window, it takes only a job that its
  estimate says will finish in time.

On Windows, the pause shortcut (Ctrl+Alt+P, from `fuobe worker install`) runs `fuobe worker pause --choose`. It asks
for 1, 2 or 4 hours, or until you resume, and then pauses at once: the job goes back to the queue at no cost, and its
ComfyUI stops.

### Studio jobs first

A PC can also run ComfyUI work of its own: a ComfyUI that you use by hand, or a queue of your own renders. With
**studio jobs first**, the studio's jobs go before that local ComfyUI work, in the order they were sent. Your local
ComfyUI work runs whenever no studio job waits. Any other program (a game, Blender, a video editor) still pauses the
worker, as above.

The worker never connects to your other ComfyUIs. It reads three things only:

1. **Windows' table of listening ports** (`Get-NetTCPConnection -State Listen`). Reading the table connects to
   nothing. A python process that listens on a port in `localComfyPorts` (8188 to 8199) is local ComfyUI work. The
   worker's own ComfyUI (by its process id and its port) never counts. Neither do the ports and process ids in
   `localComfyExcludePorts` and `localComfyExcludePids`. The worker reads the table every 30 seconds, and sooner when
   a process that it doesn't know holds GPU memory.
2. **Windows' GPU counters** (`\GPU Process Memory(pid_<n>_*)\Dedicated Usage`, read with `typeperf`). These are the
   numbers that Task Manager shows for each process. `nvidia-smi` gives the total only, because its per-process memory
   reads `[N/A]` on Windows.
3. **A GPU lock file** (`gpuLockFile`), only when the counters or the port table can't be read. If the first word of
   the lock names an owner in `gpuLockComfyOwners`, the GPU's memory counts as local ComfyUI work. Any other owner
   counts as another program, and so does no lock at all.

Every 5 seconds, the worker splits the GPU's used memory three ways. **Others** are the total, minus its own ComfyUI,
minus local ComfyUI work, minus the desktop's usual share (`desktopBaselineMb`). Run `fuobe worker baseline` once,
with no game open, to measure that share. Local ComfyUI work may stay open while you measure.

- If others are above `busyVramMb` in two readings in a row, the worker pauses as before ("Your GPU is busy").
- If only local ComfyUI work holds more than `busyVramMb`, the worker asks for a turn and waits. While it waits, its
  jobs keep their place in the line. This is not a pause: there is no cool-down, and the studio does not send its jobs
  back.

**The turn files.** Set `yieldFolder` in `worker.json` to a folder for two small files. The PC's setup makes the
folder. The worker never makes it, so the folder keeps the rights that the setup gave it. If the folder isn't there,
local ComfyUI work counts as another program.

- `site.json` is written by the worker on every beat, and at least every 5 seconds:
  `{ siteWaiting, oldestWaitS, interrupt, at }`. `siteWaiting` is the number of studio jobs that this worker may take
  now (from the beat's `claimableNow`), plus the job that it runs. During a turn it is at least 1. It goes to 0 when no
  studio job has come for a minute, when the worker is paused, or when a local cap is reached. When the worker stops,
  it writes 0.
- `yielded.json` is written by a helper on the PC's side: `{ state, at, startsAt }`. The state `"yielding"` can carry
  the helper's estimate of the start time (`startsAt`, in ms). The worker passes it on in its beat. The state
  `"yielded"` means that local ComfyUI work has made room. A "yielded" counts when it was written after the turn began,
  or in the last 15 seconds. The worker then starts at once.

When no studio job has come for a minute, the worker frees its own ComfyUI's memory (`/free`) and writes
`siteWaiting: 0`, so your local work can go on. If no "yielded" comes within 3 minutes, the worker says so in its log
and in its beat (`waiting-for-yield:no-answer`). It goes on waiting, with the jobs kept in line.

**Limits that only the PC sets.** The studio can never change these:

- `yieldMaxHoursPerDay` (20): the most hours of turns in one day, on the PC's clock. After that, local ComfyUI work
  counts as another program until the next day. A restart doesn't reset the count.
- `interruptGapMin` (30): the studio can ask the helper to stop your current local job instead of letting it finish
  (`interrupt: true`). The worker passes that request on at most once in this many minutes.
- `neverInterrupt` (false): when it is true, `interrupt` is always false.

**You first.** A pause by hand always wins. While the worker is paused, `siteWaiting` is 0. With a plain
`fuobe worker pause`, a job that is still finishing keeps `siteWaiting` at 1 until it ends. The shortcut's choice
(`--choose`) and `--now` give the GPU back at once.

Turns need the studio to send `claimableNow` in the beat's answer. A studio that doesn't send it gets today's
behaviour: local ComfyUI work pauses the worker like any other program. With no `yieldFolder`, nothing changes.

### The queue

A job for the workers belongs to the owner. It names the pools that may take it (`pool` by default). It also keeps:

- its lane: the first 12 hex digits of the SHA-256 of the sorted names of the workflow's files over 2 GB. A workflow
  with no big file is in the lane `small`.
- what it needs: the workflow, its files (folder, name, exact size, and SHA-256 where it is pinned), its node packs
  and its VRAM;
- `rank_at`: `created_at` minus a boost. The owner's jobs get a one-day boost.
- a wait limit (`FUOBE_POOL_WAIT_MIN`, 30 minutes). Past it, the job fails with "The GPUs were busy".

A worker gets a job only when all of these are true, all in one SQLite transaction:

- it is paused in neither place, it is not draining, it is inside its hours, and the studio heard from it in the last
  30 seconds;
- the job is in its pool, in a lane that the owner allows for it, after the lane's delay and `claim_after_ms`;
- it has the workflow's files and packs (from its inventory) and enough VRAM. A workflow's need is its whole GB less
  3%, because a card reports a little less than its size (a 32 GB card shows about 31.8 GiB);
- the retry rule allows it: a worker that lost or failed the job gets it again only when no other worker that can run
  the job was heard from in the last 10 minutes;
- near the end of its hours, the job's estimate fits before the window closes.

The lowest `rank_at` goes first. A worker keeps to its warm lane (the models that it has loaded) until another lane's
best job has waited longer than `switch_after_ms` (30 minutes) and is older.

If a worker stops answering for 2 minutes, or its ComfyUI is down for 2 minutes, its job goes back to the queue. The
worker is added to the job's `tried_json` list, and the input reads start again. The old worker's late calls get 409,
and it deletes that prompt. After the third lost attempt, the job fails. A job that is put back because of a pause
does not count as an attempt.

### What the worker checks itself

Before its ComfyUI gets a graph, the worker checks all of these. The studio cannot change these checks:

1. Every node type is on the allowlist that is built into the worker (`bin/lib/worker/dist/allowed-nodes.json`, made
   by `scripts/build-worker.mjs` from the catalog's workflows and the graph builders). For your own workflows, pass
   a file with `allowNodesFile` in `worker.json`. The studio can never send a file like that.
2. Every file that the graph reads was sent with the job, under the name the studio gave it.
3. Every input keeps to its rule (`bin/lib/worker/dist/input-rules.json`). The build gives a rule to each input that
   could name a file, a folder, a download or code, from the values in the catalog's own workflows:
   - a fixed value, or one of a list (a subtitle node writes no file; a timeline node reads no clip by path; a format
     string, a download name and a save folder stay the catalog's);
   - a number range;
   - a file that this job sent;
   - a save name that the studio makes (plain name parts, no path);
   - a model file that the worker verified, in the model folder that its loader reads.

   No link from another node may reach an input that has a rule, so a value cannot be built from pieces. A node that
   has such an input takes only the inputs that the catalog gives it.
4. Inputs with no rule that do not take free text hold no path. A name is refused if it has a `:`, `%`, `~` or `..`.
   Any value is refused if it starts with `/`, `\`, `~` or a drive (`C:`), or if it holds an address (`://`), an
   encoded or variable part (`%2e`, `%TEMP%`), a `..` step or a Windows device name (`CON`, `NUL`, `COM1`…).
   Prompts, lyrics and captions keep any text.
5. Every model file that the graph names is one that the worker verified, by its exact name. A file with the same
   name in another folder does not count.

The worker reports a model file only when its SHA-256 matches the hash that the catalog pins for it
(`bin/lib/worker/dist/file-pins.json`, from `requirements.json` and `model-pins.json`). A file that has no pinned hash
is not reported, so no job that needs it comes to the worker. The worker keeps the hashes it computed, so a restart
does not read the files again.

After each job, however it ended, nothing of it stays in its ComfyUI: the worker empties the queue, stops a prompt that
still runs, and clears the whole history (a meta-batch's passes too). It also deletes the job's inputs and results from
its folders, and its copies of the inputs. At start, and whenever it stops, it empties these folders too. Before it
starts a job that its ComfyUI did not have last, it clears its ComfyUI the same way.

Pictures for workers are made again from their pixels on the studio (no EXIF, no GPS). Clips and sound go to workers
only when `FUOBE_POOL_MEDIA_INPUTS` allows them (`image` by default; `image,video,audio` for all). The worker then makes
each one again before its ComfyUI reads it (see "Clips and sound").

### Clips and sound

Set `ffmpeg` in `worker.json` to the path of ffmpeg (setup asks for it). The worker then makes every clip and every
sound that a job sends again, into a fresh file, before its ComfyUI sees it:

- a clip keeps its first picture stream and its first sound stream, encoded again in the format that its name says
  (H.264 and AAC in MP4 for most names, VP9 and Opus for WebM);
- a sound keeps its first sound stream, in the format that its name says (WAV for any other name);
- nothing else of the file is kept: no metadata, chapters, subtitles, attachments or data streams.

The worker knows a clip or a sound by its type, by its name, or by the loader that reads it in the graph. ffmpeg runs
in its own process, at low priority, for at most 20 minutes. If ffmpeg cannot read a file, the job fails with plain
words ("A clip or a sound in this run couldn't be read").

Without `ffmpeg`, the worker takes pictures only. Its inventory says so (`media: ["image"]`), and the studio sends it no
workflow that reads a clip or a sound. If such a job comes anyway, the worker gives it back to the line.

### When something goes wrong

The worker keeps its jobs going by itself:

- **Results are kept until the studio has them.** When its ComfyUI finishes a job, the worker copies every result into
  `hold/<job>/` in the worker folder before it tells the studio. The copy stays until the studio has every file. If
  the worker or its ComfyUI stops in between, the next claim gives the job back to this worker, and it uploads the
  kept files from where the studio's copy got to. The job never runs twice. Kept results go up even while the worker
  is paused, because they need no GPU. Kept results of a job that is no longer this worker's are deleted.
- **One retry policy for the studio.** A studio that restarts, a proxy that answers 502, 503 or 52x, a network that
  drops, or a busy studio that says when to come back is waited out. The pause grows from 1 second to at most 30
  seconds. The worker waits up to 2 minutes for a call, and up to an hour for a part of a result. It sends a call
  again only when that is safe. A proxy's page in place of the studio's answer (a 403 that is not JSON) never stops
  the worker.
- **A job that stalls goes back to the line.** If a job makes no progress for `stallMin` minutes (10), or runs past the
  run limit that the claim gives, the worker takes its prompt off its ComfyUI and gives the job back. The job keeps
  its place in the line. If its ComfyUI does not let go of the prompt within 15 seconds, the worker stops ComfyUI and
  starts it again. A job that is given back counts as an attempt; the third time, it fails.
- **A ComfyUI that stops answering** for `hungMin` minutes (3) is stopped and started again.
- **A job that the studio took back** (its token for the job no longer works, for example after the worker was out of
  touch) is stopped in its ComfyUI at once, so it never keeps the GPU busy for nothing.
- **Out of memory.** The worker frees its ComfyUI's memory (`/free`) and sends the job once more. Only a second time
  fails the job.
- **Inputs are read once.** The worker keeps a copy of each input (by its SHA-256) while its job runs, so a job that
  is sent again reads nothing from the studio twice. If the studio will not send an input again (429 with no
  `Retry-After`), the job fails at once instead of looping.
- **The PC stays awake** while the worker holds a job, has results to send, or waits for work. A small helper asks the
  system to stay awake (`SetThreadExecutionState` on Windows, `caffeinate` on macOS, `systemd-inhibit` on Linux). The
  screen may still turn off. While the worker is paused or outside its hours, the PC sleeps as usual.
- **Its model folders are read again** every 10 minutes, and whenever a job needs a model file that the worker has not
  found yet. A drive that comes back after a restart is noticed, and the studio gets the new list.
- **When the studio stops the worker.** If the studio no longer knows the worker's token, `fuobe worker run` ends with
  exit code 3; any other stop that you did not ask for ends with exit code 1. The sign-in task that
  `fuobe worker install` adds then starts the worker again after a minute. Ctrl+C ends with 0. On Ctrl+C, and on a
  stop from the system (SIGTERM), the worker stops its ComfyUI and empties its folders before it ends. Kept results
  stay for its next start.

### The protocol

Every worker call carries `Authorization: Bearer fuobe_wkr_…`. A worker token works only on `/api/gpu/computer/*` and
gets 403 everywhere else. It is never the owner, and an owner API token can never act as a worker. The studio reads the
token on every call, so a revoked token stops at once.

- `POST /api/gpu/computer/beat`: the browser's beat plus `{ protocol, version, local: { paused, why, until }, gpu: {
  otherApps, tempC }, inventoryHash, warmLane }`. The answer adds `worker: { paused, pauseNow, drain, autoResume,
  insideHours, nextChangeAt, lanes, minProtocol, sendInventory }`.
  - While the worker waits for its turn (see "Studio jobs first"), `local` is `{ paused: false, why:
    "waiting-for-yield", until }`, where `until` is the helper's estimate of the start time, or null. After 3 minutes
    with no answer, `why` is `"waiting-for-yield:no-answer"`. The worker may still take jobs, and its jobs keep their
    place.
  - For studio jobs first, the answer may also carry `claimableNow` (the jobs that this worker may take now: its
    lanes, files, VRAM and hours), `oldestWaitS`, and `worker.yieldInterrupt` (true: the studio asks for local
    ComfyUI work to be stopped instead of finished, within the PC's own limits). Each one is optional.
- `PUT /api/gpu/computer/inventory`: `{ files: [{ folder, name, size, sha256 }], nodePacks: [{ name, commit }], media }`
  → `{ lanes, workflows, missing }`. `media` lists the kinds of input that the worker takes (`image`, `video`,
  `audio`). With no `media`, the studio counts every kind.
- `POST /api/gpu/computer/claim`: the browser's claimed task plus `{ lane, estMs, runLimitMs, notAfter, attempt,
  models }`.
- `POST /api/gpu/computer/bench`: bench jobs for this worker only (none are defined yet). The times of every finished
  job also count: the last 20 jobs in each lane give the median and the 90th percentile.
- Reports, inputs and results work as they do for the browser, with these additions:
  - `finished`, and the last `passes` report, carry `execMs` (the time that its ComfyUI spent executing the job, from
    ComfyUI's own timestamps: no waits, no uploads) and `device` (the GPU's name). The studio keeps both with the job.
  - `give-back` with `why` (`stalled`, `run-limit` or `media`) puts the job back in line. The job keeps its place and
    counts as an attempt. Only a worker's job can be given back.
  - `failed` can also give `unknown-node`, `unsafe-path` (a path, or an input outside its rule), `model-unverified`,
    `input-crashed` (its ComfyUI stopped twice on the job) or `input-unreadable` (ffmpeg could not read a clip or a
    sound) as the reason. The worker's own log names the node and the input, never the value.

Each worker counts against its own rate limits, so three workers that beat every 5 seconds never hold each other up.

### For the owner

- `GET /api/admin/workers` and `POST /api/admin/workers` (`{ name, pool? }`; the answer shows the token once).
- `PATCH /api/admin/workers/<id>`: `{ paused, pauseNow, drain, autoResume, hours, allow, claimAfterMs, switchAfterMs,
  rotate, revoke }`. Hours are `{ "always": true }` or `{ "tz": "Asia/Kolkata", "days": { "mon": [["01:00", "09:00"]] } }`.
  A window can go past midnight.
- `GET /api/admin/queue`: the jobs that wait in each lane, the oldest job, the estimate, and which workers have the
  lane warm.

### Behind Cloudflare

Worker calls come from programs, not browsers. If a bot check or a challenge is in front of your studio, add a rule
that skips it for requests to `/api/gpu/computer/*` and `/api/gpu/pair/*`. The worker tokens still protect these
routes.

## Tests

- `pnpm test` (`tests/workers-pool.test.ts`, `tests/workers-pairing.test.ts`, `tests/worker-program.test.ts`,
  `tests/worker-input-rules.test.ts`, `tests/worker-environment.test.ts`, `tests/worker-guard.test.ts`,
  `tests/worker-runner.test.ts`, `tests/worker-recovery.test.ts`, `tests/worker-parts.test.ts`,
  `tests/worker-turns.test.ts`, `tests/worker-turns-run.test.ts`). The turn tests use a fake port table, fake GPU
  counters and a fake lock file. With only local ComfyUI work on the GPU, the worker writes `siteWaiting` and claims
  within 5 seconds of the answer; with a game, it pauses and asks for no turn. The input-rule tests
  send graphs that try to write or read files outside the worker's folders, and check that the worker refuses them.
  They also prepare every catalog workflow the way the studio does, and check that the worker accepts each one. The
  recovery tests run the worker against the studio's routes and a stand-in ComfyUI that the worker starts: they kill
  its ComfyUI halfway, stop the worker before an upload, make its ComfyUI hang, and check that the output arrives
  each time, once. The guard tests run the real guard in front of a stand-in ComfyUI when a Python with aiohttp is
  there (`FUOBE_TEST_PYTHON`, else `python3` or `python`); the clip tests need `ffmpeg` on the `PATH`.
- `node tests/e2e/worker.mjs` and `node tests/e2e/fuobe-connect.mjs` (after `pnpm build`, or with `E2E_DEV=1`). These
  use a stand-in ComfyUI and a stand-in `nvidia-smi` on ports 3361 and 3362. They never touch a real GPU or ComfyUI.
- `python -m unittest discover -s tests` in `integrations/fuobe-connect`
