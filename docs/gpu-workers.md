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
2. On the GPU's PC, you need Node 22 or later and a Fuobe checkout (or a copy of `bin/`, `package.json` and
   `workflows/comfyui/requirements.json`). Run `node scripts/build-worker.mjs`, then run `node bin/fuobe.mjs worker setup`.
   Setup asks for the studio's address, the token (as hidden input), ComfyUI's folder, the model folders, a worker
   folder and a port for the worker's own ComfyUI (default 8190). It refuses these:
   - a folder that a cloud drive syncs;
   - a port that another program is using;
   - port 8188.

   On Windows it marks the worker folder as "not content indexed". The settings go to `worker.json`, and only you can
   read that file. Setup also pauses the worker on the PC.
3. In Settings → Workers, set the worker's hours and the lanes it may run (with a delay for each lane), then press
   **Resume**. On the PC, run `fuobe worker resume`, then `fuobe worker run`. On Windows, `fuobe worker install` shows a
   sign-in task and pause and resume shortcuts (Ctrl+Alt+P). It adds them only when you run it again with `--yes`.
4. To send the studio's own ComfyUI jobs to the workers, select **Run this studio's ComfyUI jobs on the workers** in
   Settings → Workers (the setting is `comfyWhere=workers`).

On a machine with no keyboard, set `FUOBE_WORKER_TOKEN` and `FUOBE_WORKER_SITE` so that the token stays out of files.

### The worker's own ComfyUI

The worker always starts and stops its own ComfyUI process. It never uses a ComfyUI that it did not start. Its ComfyUI:

- listens on `127.0.0.1` only, on the worker's own port;
- uses its own `user`, `input`, `output` and `temp` folders in the worker folder;
- gets the model folders through `extra_model_paths.yaml`;
- starts with `--disable-metadata` and `--disable-auto-launch`;
- loads only the custom node packs that the worker found (`--disable-all-custom-nodes --whitelist-custom-nodes …`).

**The port guard.** Before each start, the worker binds the port itself and releases it at once. If the bind fails,
another program is using the port. The worker then does not start ComfyUI, pauses itself (its state says "port-busy")
and never connects to that port. The worker also talks to its ComfyUI only while the process that it started is
running.

If its ComfyUI stops by itself, the worker starts it again, at most 3 times in one hour. After that, it pauses itself
("ComfyUI keeps stopping").

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

### The queue

A job for the workers belongs to the owner. It names the pools that may take it (`pool` by default). It also keeps:

- its lane: the first 12 hex digits of the SHA-256 of the sorted names of the workflow's files over 2 GB. A workflow
  with no big file is in the lane `small`.
- what it needs: the workflow, its files (folder, name, exact size, and SHA-256 where it is pinned), its node packs
  and its VRAM;
- `rank_at`: `created_at` minus a boost. The owner's jobs get a one-day boost. A job that goes back in line keeps
  its `rank_at`, so it keeps its place.
- a wait limit (`FUOBE_POOL_WAIT_MIN`, 30 minutes, or what the billing service set for an account's run). It applies
  only until a worker first takes the job: past it, a job that no worker took fails with "The GPUs were busy".
- how many results its workflow makes. An owner's job keeps no more than that (and at least 16), as an account's job
  keeps at most 16. Results are never saved past the disk's free floor.

A worker gets a job only when all of these are true, all in one SQLite transaction:

- it is paused in neither place, it is not draining, it is inside its hours, and the studio heard from it in the last
  30 seconds;
- the job is in its pool, in a lane that the owner allows for it, after the lane's delay and `claim_after_ms`;
- it has the workflow's files and packs (from its inventory) and enough VRAM;
- the retry rule allows it: a worker that lost or failed the job gets it again only when no other worker that can run
  the job was heard from in the last 10 minutes;
- near the end of its hours, the job's estimate fits before the window closes;
- it holds no other job. A worker runs one job at a time: while it holds one, a claim gives it that job again when
  it lost track of it, and nothing new.

The lowest `rank_at` goes first (then the oldest). A worker keeps to its warm lane (the models that it has loaded)
until another lane's best job has waited longer than `switch_after_ms` (30 minutes) and is older.

If a worker stops answering for 2 minutes, its ComfyUI is down for 2 minutes, or the job is still sending its files
15 minutes after the worker claimed it (or after its ComfyUI lost the job and the worker sent it again), its job goes
back to the queue. The worker is added to the job's
`tried_json` list, and the input reads start again. The old worker's late calls get 409, and it deletes that prompt.
After the third lost attempt, the job fails. A job that is put back because of a pause does not count as an attempt.
The run's own clocks follow the queue's: each attempt gets its own running time.

**The place in line.** A waiting job's place counts every job that a worker able to run it would serve first, whatever
its lane: one GPU serves every lane it has in this order. The wait adds the rest of the jobs those workers run now,
the lane's load time when none has it warm, and the job's own run (the lane's median on the quickest worker, else the
median of the workers' measured runs). The billing service's line facts (`QueueFacts`) read the same line.

**The workers' log.** `worker_jobs` keeps which worker took which job, when, and how it ended (`claimed`,
`finished` with the measured run, `requeued`, `done`, `failed`, `canceled`). It holds ids, times and those facts
only. Rows are only added, and each is kept a year, like the admin API's log. The owner reads it at
`GET /api/admin/workers/jobs` ([admin-api.md](admin-api.md)).

### What the worker checks itself

Before its ComfyUI gets a graph, the worker checks all of these. The studio cannot change these checks:

1. Every node type is on the allowlist that is built into the worker (`bin/lib/worker/dist/allowed-nodes.json`, made
   by `scripts/build-worker.mjs` from the catalog's workflows and the graph builders). For your own workflows, pass
   a file with `allowNodesFile` in `worker.json`. The studio can never send a file like that.
2. Every file that the graph reads was sent with the job.
3. No string input names a path (an absolute path, a drive letter, a network share or a `..` step).
4. Every model file that the graph names is one that the worker verified.

After each job, the worker deletes the job's inputs and results from its folders and deletes the prompt from its
ComfyUI's history. At start, it empties its folders.

Pictures for workers are made again from their pixels on the studio (no EXIF, no GPS). Clips and sound go to workers
only when `FUOBE_POOL_MEDIA_INPUTS` allows them (`image` by default; `image,video,audio` for all).

### The protocol

Every worker call carries `Authorization: Bearer fuobe_wkr_…`. A worker token works only on `/api/gpu/computer/*` and
gets 403 everywhere else. It is never the owner, and an owner API token can never act as a worker. The studio reads the
token on every call, so a revoked token stops at once.

- `POST /api/gpu/computer/beat`: the browser's beat plus `{ protocol, version, local: { paused, why, until }, gpu: {
  otherApps, tempC }, inventoryHash, warmLane }`. The answer adds `worker: { paused, pauseNow, drain, autoResume,
  insideHours, nextChangeAt, lanes, minProtocol, sendInventory }` and `claimableNow`: how many people's jobs (an
  account's, never the owner's) this worker may claim right now by its lanes, files, VRAM and hours, its own pause aside.
- `PUT /api/gpu/computer/inventory`: `{ files: [{ folder, name, size, sha256 }], nodePacks: [{ name, commit }] }` →
  `{ lanes, workflows, missing }`.
- `POST /api/gpu/computer/claim`: the browser's claimed task plus `{ lane, estMs, runLimitMs, notAfter, attempt,
  models }`.
- `POST /api/gpu/computer/bench`: bench jobs for this worker only (none are defined yet). The times of every finished
  job also count: the last 20 jobs in each lane give the median and the 90th percentile.
- Reports, inputs and results work as they do for the browser. `failed` can also give `unknown-node`, `unsafe-path`
  or `model-unverified` as the reason. `finished` (and the last `passes`) can add `execMs`, the time its ComfyUI
  spent running the job (not waits, files or the upload), and `device`, its GPU's name. The billing service gets
  them as `gpuMs` and `device`. A job that ran more than once counts once: the attempt whose result was kept.

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

- `pnpm test` (`tests/workers-pool.test.ts`, `tests/workers-pairing.test.ts`, `tests/worker-program.test.ts`)
- `node tests/e2e/worker.mjs` and `node tests/e2e/fuobe-connect.mjs` (after `pnpm build`, or with `E2E_DEV=1`). These
  use a stand-in ComfyUI and a stand-in `nvidia-smi` on ports 3361 and 3362. They never touch a real GPU or ComfyUI.
- `python -m unittest discover -s tests` in `integrations/fuobe-connect`
