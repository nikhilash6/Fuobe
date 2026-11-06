# Workers: share your GPUs with other machines

A Fuobe studio can run its ComfyUI jobs on GPUs in other places:

- **Fuobe Connect** ([ComfyUI-Fuobe-Connect](https://github.com/workingprototype/ComfyUI-Fuobe-Connect)) connects a
  person's own ComfyUI to their account. It is optional. Each person installs it once in ComfyUI. Their runs then go to
  their own GPU.
- **Workers** are the owner's GPUs on other PCs, for example a team's machines or a spare PC. Each PC runs
  `fuobe worker`. The worker takes the studio's ComfyUI jobs and runs them on its own ComfyUI.

Both use the same job routes as the browser's "Use the ComfyUI on this computer" (`/api/gpu/computer/*`). Both call
the studio over HTTPS, and neither opens a port. With no worker added and nothing paired, the studio works as before.

## Fuobe Connect (a person's own ComfyUI)

Fuobe Connect is an optional ComfyUI custom node pack. Its source is in `integrations/fuobe-connect`, and the
[ComfyUI-Fuobe-Connect](https://github.com/workingprototype/ComfyUI-Fuobe-Connect) repository is published from that
folder. People install it from that repository: with `git clone` in ComfyUI's `custom_nodes` folder, or with
ComfyUI-Manager's **Install via Git URL**. Each version is also published to the
[Comfy Registry](https://registry.comfy.org), which ComfyUI-Manager's search (`Fuobe Connect`) reads. When the
Manager shows no version to install, the git clone and Install via Git URL still work. Its own README says how to
install it and what a trusted studio can do. It adds no nodes.

Fuobe Connect is one of three ways to connect a person's own ComfyUI. None of them is required: a fal.ai or Replicate
key also works, and so do the studio's own GPUs where it offers them.

1. Fuobe's setting with Fuobe's guard, with no install. ComfyUI starts with
   `--enable-cors-header <the studio's address>`, and `fuobe_guard.py` in `custom_nodes` keeps every other website
   out. It works in Chrome, Edge and Firefox on the computer that runs ComfyUI.
2. Fuobe Connect. The person installs it once. It works from any browser, Safari and phones included, and it pairs
   with the person's account for a computer with no screen.
3. A web address. A cloudflared quick tunnel gives ComfyUI an address, with no Cloudflare account. The address changes
   each time the tunnel starts.

While `FUOBE_CONNECT_PUBLISHED` (`src/lib/fuobe-connect.ts`) is true, **Connect your GPU** and Settings → Your GPU
offer Fuobe Connect as the one step, with the setting under Advanced. **Set it up with my AI** offers it first, and
its steps (`/api/setup/guide/connect/<windows|mac|linux>`) install it for ComfyUI Desktop, the portable build and a
git install. Fuobe Connect trusts `https://fuobe.com` by default. A self-hosted studio is added in ComfyUI under
**Settings → Fuobe Connect**, or with `FUOBE_CONNECT_ORIGINS`.

**Direct mode.** ComfyUI turns away every other website. Fuobe Connect lets in only the studios that you trust. Each
studio is an exact https origin, and the default is `https://fuobe.com` with `https://www.fuobe.com`. You can name your
own studios, or `none`, in ComfyUI's settings or with `FUOBE_CONNECT_ORIGINS`. A trusted studio reaches the ComfyUI
only at `127.0.0.1`, `::1` or `localhost` (a network address too with `FUOBE_CONNECT_LAN=1`). Fuobe Connect turns
away every other request of a trusted studio itself, even when ComfyUI runs with `--enable-cors-header` naming that
studio, so with the pack the studio doesn't need that setting. Fuobe Connect checks each request it lets through in
Python, whatever the studio's page checked:

- a workflow runs only when every node type is on the list the pack ships (`fuobe_connect/allowed_nodes.json`, written
  by `node scripts/connect-nodes.mjs` from the same sources as the worker's list) or on the person's own list, and:
  - no text names a place on a disk or on the network: a path, a `..` step, a home folder, an environment variable, a
    URL or a folder tag;
  - an input that a listed node reads as a file or a folder, or a name that it downloads, holds the one value or form
    the studio's own graphs use, written in the graph, never a link (`PATH_INPUTS` in `fuobe_connect/graph.py`);
  - a link into a dropdown, or from a loosely typed output (such as `GetItemFromList`, `CreateList`, `VRAM_Debug` or
    `ComfySwitchNode`), feeds only what the studio's own graphs feed that way (`loose` and `links` in
    `allowed_nodes.json`). Inside ComfyUI the pack also reads these kinds from every node class;
  - a link has the form the studio's graphs write: a node id and an output number from 0;
  - `VHS_VideoCombine` takes only a plain format name and plain-word settings, and a link only for its pictures, sound,
    batch, VAE and frame rate;
  - every loader reads a Fuobe input (`fuobe_<id>.<ext>`). A written value is a text, a number, `true`, `false` or
    `null`, except a 3D view's entries in the form of ComfyUI's 3D nodes, and a node holds only `class_type`,
    `inputs` and `_meta`;
  - inside ComfyUI, every node that ComfyUI runs is one it checks first. A 3D node's camera and placements in a run's
    history never count as one of its files;
- an upload goes only into the input folder, under a Fuobe input name, as a picture, clip, sound, 3D scene, array or
  subtitle file;
- the studio sees, cancels, stops and downloads only its own prompts and their results; the queue shows other prompts
  only as places in the line, the node list hides the names of the person's input files, and the model lists leave
  out `custom_nodes` and `configs`.

When a graph builder starts giving one of those inputs a new value, add its form to `PATH_INPUTS` and ship it with the
next Fuobe Connect release (the pack's `tests/test_graph.py` runs every workflow in `workflows/comfyui` through the
checks). When a graph starts linking from an untyped output into a new input, or into a dropdown, run
`node scripts/connect-nodes.mjs` too: until the pack ships the new link, people's ComfyUI refuses that graph.

It cannot reach the Manager's install calls, the person's user files or settings, a file of the person's in the input
folder, or the person's own results, and its workflows cannot name a file of the person's by its path. Fuobe Connect
answers the CORS and Private Network Access preflights for the trusted origins only. Every other website still meets
ComfyUI's own check.

You do not need a start flag or a guard file. In the studio, **Connect your GPU** finds ComfyUI after one browser
"Allow" prompt, and then connects.

When a workflow or graph builder starts using a new node type, run `node scripts/connect-nodes.mjs` and ship the list
with the next Fuobe Connect release (`tests/fuobe-connect-nodes.test.ts` fails until then). People with an older Fuobe
Connect get a refusal that asks them to update it.

**Pairing mode.** Use pairing with Safari, phones, a blocked browser or a PC with no screen:

1. In ComfyUI, open **Extensions → Connect to Fuobe**. On a PC with no screen, start ComfyUI with
   `FUOBE_CONNECT_PAIR=1`. Fuobe Connect asks the studio for a short code: `POST /api/gpu/pair/start`.
2. The person opens `/connect?pair=1`, signs in, types the code that their own ComfyUI shows, checks the computer's
   name and GPU, and approves the code: `POST /api/gpu/pair`. A code is valid for 10 minutes and works only once. The
   page never fills in a code from its link: the person types it.
3. Fuobe Connect polls with a secret that only it knows: `POST /api/gpu/pair/poll`. After the approval, its next poll
   gets a worker token (`fuobe_wkr_…`). The studio makes the token at that moment and keeps only its SHA-256 hash.

The token acts only as that person's own computer. The ComfyUI gets that person's jobs, and nobody else's. The jobs
run with no Fuobe tab open. Fuobe Connect pairs only with a studio the person trusts (or `https://fuobe.com`), and
checks every job as in direct mode before ComfyUI sees it. The approved poll answer names the approving account,
masked (`a•••@example.com`, or "the studio's owner"), and ComfyUI shows it. The person can pause jobs in ComfyUI. When
the owner pairs a ComfyUI, the studio's ComfyUI jobs move to the owner's computer, as before, unless they run on workers
or hosted runs are on (`FUOBE_HOSTED_RUNS=1`). Then the pairing changes nothing of where they run: the paired ComfyUI
takes the owner's jobs once the owner chooses the computer in Settings → ComfyUI. Every change of that setting is in
the admin log (`settings.comfy_where`, with the value before and after). The person can disconnect the ComfyUI in
Settings → Your GPU (`DELETE /api/gpu/paired/<id>`)
or press Disconnect in ComfyUI (`POST /api/gpu/computer/unpair`). A disconnected token gets 401 at its next call.

## Workers (the owner's shared GPUs)

### Add a worker

1. In **Settings → Workers**, press **Add a worker** and give it a name. The page shows the worker's token only once.
   The worker starts paused, with no hours and no lanes.
2. On the GPU's PC, you need Node 22 or later, git and pnpm (`corepack enable` installs pnpm). Install the worker from
   a git checkout of Fuobe that you have verified (see "Install and update"). Run `node scripts/build-worker.mjs`, then
   run `node bin/fuobe.mjs worker setup`.
   Setup asks for the studio's address, the token (as hidden input), ComfyUI's folder, the model folders, a worker
   folder and the path of ffmpeg (see "Clips and sound"). It refuses these:
   - a studio address that does not start with `https://` (only `http://127.0.0.1` and `http://localhost` are allowed,
     for tests). A studio on your own network (`http://10.x`, `http://172.16.x` to `172.31.x`, `http://192.168.x` or
     an IPv6 address from `fc00::/7`) may use `http://` only when you set `"allowHttpSite": true` in `worker.json`
     yourself. The studio can never set it. The worker's token and people's files then cross your network
     unencrypted, and the worker says so in its log at each start;
   - a folder that a cloud drive syncs;
   - an ffmpeg path where no ffmpeg runs.

   Setup then asks what this PC may ever run, its ceiling (see "Job tickets and the PC's ceiling"): the lanes or
   workflows (`all`, or their names), the largest picture in megapixels, the longest clip in seconds and the most
   results one run may ask for (0 for no limit). It also asks whether the PC runs the studio owner's own jobs, which
   come as whole graphs. A name that isn't in the studio's catalog is refused. Run setup again to change any answer.

   On Windows it marks the worker folder as "not content indexed". The settings go to `worker.json`, and only you can
   read that file. Setup also pauses the worker on the PC.
3. In Settings → Workers, set the worker's hours and the lanes it may run (with a delay for each lane), then press
   **Resume**. On the PC, run `fuobe worker resume`, then `fuobe worker run`. On Windows, `fuobe worker install` shows a
   sign-in task and pause and resume shortcuts (Ctrl+Alt+P). It adds them only when you run it again with `--yes`.
4. To send the studio's own ComfyUI jobs to the workers, select **Run this studio's ComfyUI jobs on the workers** in
   Settings → Workers (the setting is `comfyWhere=workers`).

On a machine with no keyboard, set `FUOBE_WORKER_TOKEN` and `FUOBE_WORKER_SITE` so that the token stays out of files.
The worker never rotates a token from the environment: with a token lifetime set, replace it there before it ends (see
"A token's lifetime" below).

### Install and update

The worker runs other people's jobs on your PC, so install it only from code that you can check. The studio does not
offer the worker as a download. Use a git checkout at a signed release tag:

1. Clone the repository once: `git clone https://github.com/workingprototype/Fuobe.git`.
2. Fetch the tags: `git fetch --tags`.
3. Verify the tag that you want: `git verify-tag <tag>`. Go on only when git says that the signature is good and the
   key is one that you trust.
4. Check it out: `git checkout <tag>`.
5. Install the build's tools: `pnpm install --frozen-lockfile`. The build needs TypeScript, which is a development
   dependency.
6. Build the worker's parts: `node scripts/build-worker.mjs`. The build stamps the parts with the files that it read.
   The worker starts only when that stamp matches its checkout. After an update, it asks for this step until you run
   it.

**Release tags.** A maintainer makes each release tag with `git tag -s <version>` (a signed, annotated tag) and pushes
it. Get the maintainer's public key from a source that you trust, and import it before step 3. Until the repository
has a release tag, check out a commit instead, and verify it with `git verify-commit <commit>` in step 3.

To update, do steps 2 to 6 with the new tag. A running worker then restarts on the new code by itself (see "New code
while the worker runs"). You can also stop the worker first and start it again after step 6. If the worker was set up by
an older version, run `fuobe worker setup` again after the update. That clears the fixed port that older setups saved
(8190), so its ComfyUI takes a free port at each start, and it asks for ffmpeg (without ffmpeg the worker takes no
clips or sound). Until then, the worker treats a saved 8190 as no fixed port, and says when no ffmpeg is set. Do not
install the worker from a zip file, from a copy that someone sends you, or from a branch.

**New code while the worker runs.** At its start, the worker notes three things: the commit of its checkout, the build
stamp of its parts (`dist/build-stamp.json`), and the file `update-ready.json` in its home folder. It looks at them
again every 15 seconds. When one of them changes and the parts match the checkout, the worker takes no new job. It
finishes the job that it has, writes "New worker code is installed: restarting after this job." in its log, and ends
with exit code 75. Kept results that are not sent yet stay for its next start. Whatever starts the worker can start it
again at once on exit code 75. An update that is only half done (a new checkout whose build has not run yet) does not
end the worker: it works on until the parts match, and checks the stamp once a minute meanwhile. A program that
installs updates writes `update-ready.json` last, after it has checked the new build.

### The worker's own ComfyUI

The worker always starts and stops its own ComfyUI process. It never uses a ComfyUI that it did not start. Its ComfyUI:

- listens on `127.0.0.1` only, on a free port that the worker picks at random (20000 to 59999) at each start. Port
  8188 is never used. To fix one port instead, set `port` in `worker.json` (8190, which older setups saved for every
  worker, counts as no fixed port);
- starts through the worker's guard (see below), with the worker folder as its working folder. A node that writes to
  a relative path writes into the worker folder, not into ComfyUI's folder;
- uses its own `user`, `input`, `output` and `temp` folders in the worker folder;
- gets the model folders through `extra_model_paths.yaml`;
- starts with `--disable-metadata` and `--disable-auto-launch`, and with `--disable-partner-nodes` when that ComfyUI
  has the flag (the worker reads ComfyUI's `comfy/cli_args.py` to find out). That flag covers only ComfyUI's own save
  nodes. Two save nodes write the run's graph all the same, so the worker takes care of them: it sets `save_metadata`
  to `false` on every VideoHelperSuite save node (`VHS_VideoCombine`) of each graph before its ComfyUI gets it (else
  the node writes the graph and the PC's local time into each clip), and it takes the `<metadata>` element out of each
  SVG result from ComfyUI's SVG save node before it keeps or sends the result;
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
running. When that process stops, the worker forgets its port, so nothing (not even the cleanup after a job) goes to
whatever listens there later.

A request to its ComfyUI waits at most 15 seconds for the answer to begin (2 minutes for a request that sends a file,
and 5 seconds for the look at its memory that the worker takes every 5 seconds). A long download of a result is not
cut short. So a ComfyUI that takes the connection but never answers holds nothing up: the worker goes on beating, and
after `hungMin` minutes it starts that ComfyUI again.

**The guard.** The worker makes a new random key at each start. It starts ComfyUI through
`bin/lib/worker/comfy_guard.py`. At each start, it empties the worker folder's `guard/` folder and copies the guard
into it, and it runs the guard in Python's isolated mode (`-I`). So no other file in that folder, and no `PYTHON*`
variable, can change what the guard imports. (The guard applies `PYTHONIOENCODING` to its own output, and the worker
passes `PYTHONUTF8` on as `-X utf8`. ComfyUI's own child processes still get every variable of its environment.) The
guard reads the key from the environment, removes it from there, and puts a check in front of every request to
ComfyUI:

- The `Host` header must be exactly `127.0.0.1:<port>`. A web page that points its own name at 127.0.0.1 (DNS
  rebinding) sends its own name, so it is refused.
- The request must carry the key in `X-Fuobe-Worker-Key`. The worker sends it with every request and with the live
  socket. Without it, the answer is 403.

Before the worker sends the key, the process on the port must prove two things. It signs a random challenge with the
key (`GET /fuobe-worker/hello`, HMAC-SHA-256), and it names its process id and its parent's. One of them must be the
process that the worker started. (On Windows, a venv's `python.exe` starts the real Python as a process of its own, so
there the parent is the one that the worker started.) A program that took the port first learns nothing. When ComfyUI
is ready, the worker also checks that a request without the key is refused. If it is not refused, the guard is
missing. The worker then stops that ComfyUI, does not use it, and pauses itself for an hour ("comfy-crashes").

**A ComfyUI left running.** The worker writes its ComfyUI's process id to `comfyui.pid` in the worker folder, with
its own process id. If the worker stops without stopping ComfyUI (a crash), the next start finds that file. It stops
that process, but only when the worker that started it no longer runs, and only when the process's command line still
names the guard in this worker folder, so a reused process id is never stopped.

**One worker on a worker folder.** At each start, the worker makes `worker.lock` in the worker folder, with its process
id. A second worker with the same worker folder (for example `fuobe worker run` by hand while the sign-in task's worker
runs) does not start: it says that another worker runs, and it touches nothing (exit code 4). A lock whose worker has
stopped is taken over. The worker counts a lock as stopped when its process is gone, or when that process id now
belongs to a program that is not a Fuobe worker. If the command line of that process can't be read, the lock counts
as held.

**Its log.** ComfyUI's output goes to `comfyui.log` in the worker folder. Each start begins a new file, and so does a
file that passes 20 MB. The worker keeps the two files before it (`comfyui.1.log`, `comfyui.2.log`).

**When its ComfyUI stops by itself.** The worker starts it again after a short wait: 5 seconds, then twice as long each
time in a row, at most 2 minutes. If ComfyUI stops twice while it runs the same job, that job fails with plain words
("This run couldn't finish with these files or settings"), and the worker goes on with the next job. If ComfyUI
stops more than 3 times in one hour with no job running, the worker pauses itself ("ComfyUI keeps stopping").

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

To tell local ComfyUI work apart, the worker never connects to your other ComfyUIs (the only exception is for the
owner's own jobs, below). It reads three things only:

1. **Windows' table of listening ports** (`Get-NetTCPConnection -State Listen`). Reading the table connects to
   nothing. A python process that listens on a port in `localComfyPorts` (8188 to 8199) is local ComfyUI work. The
   worker's own ComfyUI (by its process id and its port) never counts. Neither do the ports and process ids in
   `localComfyExcludePorts` and `localComfyExcludePids`. The worker reads the table every 30 seconds, and sooner when
   a process that it doesn't know holds GPU memory.
2. **Windows' GPU counters** (`\GPU Process Memory(pid_<n>_*)\Dedicated Usage`, read with `typeperf`). These are the
   numbers that Task Manager shows for each process. `nvidia-smi` gives the total only, because its per-process memory
   reads `[N/A]` on Windows. The worker reads the graphics card whose processes hold the most memory. On a PC with
   more than one card, set `gpuLuid` to the card's part of the counter name (for example
   `0x00000000_0x0000d1b5_0`, the luid and the phys number).
3. **A GPU lock file** (`gpuLockFile`), only when the counters or the port table can't be read. If the first word of
   the lock names an owner in `gpuLockComfyOwners`, the GPU's memory counts as local ComfyUI work. Any other owner
   counts as another program, and so does no lock at all.

Every 5 seconds, the worker splits the GPU's used memory three ways. **Others** are the total, minus its own ComfyUI,
minus local ComfyUI work, minus the desktop's usual share (`desktopBaselineMb`). Run `fuobe worker baseline` once,
with no game open, to measure that share. Local ComfyUI work may stay open while you measure, and the worker may keep
running: its own ComfyUI is not counted (the process in `comfyui.pid` in the worker folder, and the process that
listens on its port). The command shows what it counted, with the biggest programs by name. It saves at most 4096 MB.
More than that means that another GPU program was open: it says so, and you can close that program and measure again.

- If others are above `busyVramMb` in two readings in a row, the worker pauses as before ("Your GPU is busy"). After
  one such reading, it starts no new job, and a turn stays as it is: it doesn't begin, and it doesn't end.
- If only local ComfyUI work holds more than `busyVramMb`, the worker asks for a turn and waits. While it waits, its
  jobs keep their place in the line. This is not a pause: there is no cool-down, and the studio does not send its jobs
  back.

**The turn files.** Set `yieldFolder` in `worker.json` to a folder for two small files. The PC's setup makes the
folder. The worker never makes it, so the folder keeps the rights that the setup gave it. If the folder isn't there,
local ComfyUI work counts as another program.

- `site.json` is written by the worker on every beat, and at least every 5 seconds:
  `{ siteWaiting, oldestWaitS, interrupt, interruptAt, at }`. `siteWaiting` is the number of studio jobs that this
  worker may take now (from the beat's `claimableNow`), plus the job that it runs. During a turn it is at least 1. It
  goes to 0 when no studio job has come for a minute, when the worker is paused, or when a local cap is reached. When
  the worker stops, it writes 0. `oldestWaitS` is how long the worker has seen people's jobs waiting for it, by its
  own clock.
- `yielded.json` is written by a helper on the PC's side: `{ state, at, startsAt }`. The state `"yielding"` can carry
  the helper's estimate of the start time (`startsAt`, in ms). The worker passes it on in its beat. The state
  `"yielded"` means that local ComfyUI work has made room. A "yielded" counts when it was written after the turn began,
  or in the last 15 seconds. The worker then starts at once.

When no studio job has come for a minute, the worker frees its own ComfyUI's memory (`/free`) and writes
`siteWaiting: 0`, so your local work can go on. A fresh "yielding" (written in the last 15 seconds) counts as an
answer: the helper is making room while local work finishes its job, however long that job takes. If 3 minutes go by
with no "yielded" and no fresh "yielding", the worker says so in its log and in its beat
(`waiting-for-yield:no-answer`). It goes on waiting, with the jobs kept in line. While it waits,
Settings → Workers shows "Waiting for local ComfyUI work to make room", with the helper's estimate of the start when
there is one, never "Ready".

**The owner's own jobs.** They ask for no turn, and `siteWaiting` does not count them. While one of them waits for
this worker (the beat's `ownerWaitingNow`) and only local ComfyUI work holds the GPU, the worker reads that work's
`/queue` on its port (at most once in 10 seconds). It never does anything else to it:

- If it runs a job or has one queued, the worker leaves it alone, and the owner's job keeps its place in line.
- If it runs nothing and has nothing queued, it only keeps its models loaded. The worker asks it to free its memory
  (`POST /free` with `unload_models` and `free_memory`; nothing stops, and it loads its models again for its next
  job), and then takes the owner's job.
- With no port to ask (the GPU lock decided, because the counters can't be read), the owner's job waits.

**Limits that only the PC sets.** The studio can never change these:

- `yieldMaxHoursPerDay` (20): the most hours of turns in one day, on the PC's clock. After that, local ComfyUI work
  counts as another program until the next day. A restart doesn't reset the count.
- `interruptGapMin` (30): a request to stop your current local job instead of letting it finish passes on at most
  once in this many minutes, as one interrupt: `interrupt: true` with `interruptAt`, the time the worker allowed it.
  The helper stops at most one local job for each `interruptAt` value. Both go back to `false` and `null` as soon as
  the helper writes `yielded.json` after that time. The beat's answer has no such request yet, so today `interrupt`
  is always false and the helper lets your local job finish.
- `neverInterrupt` (false): when it is true, `interrupt` is always false.

**You first.** A pause by hand always wins. While the worker is paused, `siteWaiting` is 0. With a plain
`fuobe worker pause`, a job that is still finishing keeps `siteWaiting` at 1 until it ends. The shortcut's choice
(`--choose`) and `--now` give the GPU back at once.

Turns need the studio to send `claimableNow` in the beat's answer. A studio that doesn't send it gets today's
behaviour: local ComfyUI work pauses the worker like any other program. With no `yieldFolder`, nothing changes.

### The queue

A job for the workers belongs to the owner or, with hosted runs on ([public-signup.md](public-signup.md#hosted-runs)),
to an account. An account's job is the account's task (`acct:<id>`): only a worker of its pool takes it, and the
account's own session never reaches it through the computer routes. It names the pools that may take it (`pool` by
default). It also keeps:

- its lane: the first 12 hex digits of the SHA-256 of the sorted names of the workflow's files over 2 GB. A workflow
  with no big file is in the lane `small`.
- what it needs: the workflow, its files (folder, name, exact size, and SHA-256 where it is pinned), its node packs
  and its VRAM;
- its class: `paid` or `free` for an account's run (the billing service says which; `free` without one), `owner` for
  the owner's own jobs. People's runs always go first: the owner's jobs wait until no person's run waits that the
  same worker could take.
- `rank_at`: `created_at`, minus the head start the billing service gave the run inside its class (at most a day). A
  job that goes back in line keeps its `rank_at`, so it keeps its place.
- a wait limit: for an account's run, `FUOBE_POOL_WAIT_MIN` (30 minutes) or what the billing service set; for the
  owner's own jobs, the owner's wait limit (none by default; see the queue's settings below). It applies only until a
  worker first takes the job: past it, a job that no worker took fails with "The GPUs were busy".
- how many results its workflow makes. An owner's job keeps no more than that (and at least 16), as an account's job
  keeps at most 16. Results are never saved past the disk's free floor.

A worker gets a job only when all of these are true, all in one SQLite transaction:

- it is paused in neither place, it is not draining, it is inside its hours, and the studio heard from it in the last
  30 seconds;
- its worker program speaks protocol 2 or later (an older one takes nothing until it is updated);
- the job is in its pool, in a lane that the owner allows for it, after the lane's delay and `claim_after_ms`;
- it has the workflow's files and packs (from its inventory) and enough VRAM. A workflow's need is its whole GB less
  3%, because a card reports a little less than its size (a 32 GB card shows about 31.8 GiB);
- it verified every run-time file the job loads (see "Run-time files" below);
- the retry rule allows it: a worker that lost or failed the job gets it again only when no other worker that can run
  the job was heard from in the last 10 minutes;
- near the end of its hours, the job's estimate fits before the window closes;
- it holds no other job. A worker runs one job at a time: while it holds one, a claim gives it that job again when
  it lost track of it, and nothing new.

Jobs go by class (`paid`, then `free`, then `owner`), then by the lowest `rank_at` (then the oldest). With the
pick allowance at 0 (the default), that is the whole rule. Above 0, a worker may take a job in its warm lane (the
models it has loaded) ahead of the best job, in the same class, while the best job has waited less than the pick
allowance (or the worker's own `switch_after_ms`, if that is lower). With fair share on, each class goes round its
accounts: an account's next run goes after every other account's run that is an earlier turn of its own. An account's
turns count the runs a worker holds for it now and those a worker finished for it since the oldest run still waiting
in that class came.

**The queue's settings.** The owner sets these with `GET` and `PATCH /api/admin/queue/settings`
([admin-api.md](admin-api.md)). They apply at once, with no restart:

| Setting | What it does | Default |
|---|---|---|
| `runCeilingS` | `{ default, lanes }`: the longest one attempt at a job may run, in seconds, with a value per lane that overrides the default. A worker's run limit is never longer, and the run's own clock is set from it (below) | `{ "default": 2700, "lanes": {} }` (45 minutes) |
| `ownerWaitLimitS` | How long the owner's own jobs may wait before a worker first takes them, in seconds. `null`: no limit | `null` |
| `fairShare` | Each class goes round its accounts (above). Off: strict order | `false` |
| `pickAllowanceMs` | How long a job in a worker's warm lane may go ahead of an older one (above). 0: strict order | `0` |
| `pausedBudgetS` | How long, in all, a run that has started may spend back in line while its worker steps aside, and still be inside the deadline its hold asks for ([billing-hook.md](billing-hook.md)). A run past it still delivers its result | `7200` (2 hours) |

A worker's run limit for one attempt is 3 times the lane's 90th percentile on that worker plus its model load, at
least 10 minutes and never past the lane's run ceiling. With no measured run in the lane yet, it is the ceiling.

If a worker stops answering for 2 minutes, its ComfyUI is down for 2 minutes, or the job is still sending its files
15 minutes after the worker claimed it (or after its ComfyUI lost the job and the worker sent it again), its job goes
back to the queue. The worker is added to the job's
`tried_json` list, and the input reads start again. The old worker's late calls get 409, and it deletes that prompt.
If the worker's ComfyUI loses the job (it restarted), the worker sends it again once on the same claim. If ComfyUI loses
it a second time on that claim, the job goes back to the queue as a lost attempt. Results the worker kept from an
earlier try count as one send of the claim too. After the third lost attempt, the job fails. A job that is put back
because of a pause does not count as an attempt, and neither does one lost while the worker's PC slept, once the
worker says so (`slept` in its next beat).

The run's own clocks follow the queue's, even when a check of the run fails. No wait limit of the run's own ends a job
for the workers, and each attempt gets its own time from its claim: 15 minutes to send the files, the lane's run
ceiling twice (one more try after running out of memory) and 15 minutes to send the results. Sending the files again
on the same claim starts the 15-minute sending clock again, but never moves the attempt's own deadline. The worker's
run limit and stall limit, and the sending clock, end an attempt long before that. While a job is back in the queue,
it shows no progress from the attempt before.

A job of the owner's that no worker can run is refused when it is sent, as an account's run is. Allow its lane for a
worker that has its model files first. A job larger than every worker's PC may ever run (its ceiling's largest
picture, longest clip or most results) is refused when it is sent too, the owner's and an account's alike. The same check keeps an account's run out of the line when no worker could ever
take it: a worker must be allowed the lane, its last list of files must have the workflow's files and node packs, and
it must have the VRAM.

When every worker that could run an account's run is away right now (paused on the website or on its PC, draining,
outside its hours, silent for over 2 minutes, or never connected), the price check says "Starting soon" and Run is
off. When those workers go away between the price check and a press of Run, the press makes no run. Its answer is
"Try again in a moment." (503, code `busy`), with no billing card, and the page asks the price check again, which now
says "Starting soon". The price check asks again by itself, and Run comes back on once one of those workers is back.
A worker that waits for local ComfyUI work to make room is not away: runs go in line for it. An account with its own
GPU gets its run there instead, unless it asked for this install's GPUs.

**The place in line.** A waiting job's place counts every job that a worker able to run it would serve first, whatever
its lane: one GPU serves every lane it has in this order. The wait adds the rest of the jobs those workers run now,
the lane's load time when none has it warm, and the job's own run (the lane's median on the quickest worker, else the
median of the workers' measured runs). The billing service's line facts (`QueueFacts`) read the same line.

**The workers' log.** `worker_jobs` keeps which worker took which job, when, and how it ended (`claimed`,
`finished` with the measured run, `requeued`, `done`, `failed`, `canceled`). It holds ids, times and those facts
only. Rows are only added, and each is kept a year, like the admin API's log. The owner reads it at
`GET /api/admin/workers/jobs` ([admin-api.md](admin-api.md)).

### Job tickets and the PC's ceiling

An account's run reaches a worker as a job ticket, never as a graph. The ticket names a workflow of the catalog, the
catalog version it was made for, the run's settings, each input file (its slot, its name, its kind and its SHA-256),
how many results it makes and how big it is, and the job's run and stall limits. The worker composes the graph itself,
with the studio's own composer (`src/lib/ticket-compose.ts` and `src/lib/comfy-compose.ts`, built into
`bin/lib/worker/dist/compose/`) and its own copy of the catalog (`workflows/comfyui` in its checkout). Every check in
"What the worker checks itself" then runs on the graph it composed. The studio owner's own jobs still come as whole
graphs, and so do a person's own computer's jobs (Fuobe Connect and the browser).

- **Settings.** Each setting has a type and a rule: a choice from a list, a number in a range, true or false, or a list
  of these. A person's words reach only the prompt fields (prompt, negative prompt, dialogue, shots and the voice's
  words). No setting may hold a path: a drive, a share, a rooted or home path, a `..` step, a file address or, in a
  setting that isn't free text, a slash, a file name, a web address or a variable. A file goes only in its slot. The
  studio checks the ticket when it makes it, and the worker checks it again before it composes.
- **Files the graph makes.** A few graphs read a small file that the composer makes (a palette swatch, a fade curve).
  The worker makes it again, checks it against the SHA-256 in the ticket, and sends its own copy to its ComfyUI. It
  never reads the studio's copy.
- **The catalog version.** One SHA-256 over what can change a composed graph: the composer's code and the catalog's
  workflows. Comments, a model's one-line description, tile covers and cards, the counts, prices and licence words the
  pages quote, the cloud models and the record of real renders are left out, so an update that changes only what people
  read or see keeps the version, and the workers keep taking accounts' runs. The worker's build writes it
  (`dist/catalog-version.json`), and the studio computes the same from its own files (or reads `FUOBE_CATALOG_VERSION`).
  Each beat says the worker's version. A ticket goes only to a worker with the same version.
  A worker built from another catalog takes the owner's own jobs, and its state in Settings → Workers reads **Update
  the worker** while accounts' runs may come to the install's GPUs. Update it (see "Install and update").
- **The PC is the ceiling.** `ceiling` in `worker.json` (setup asks for it) is the most the PC ever runs:
  `{ "lanes": [...], "workflows": [...], "maxMegapixels": 4, "maxSeconds": 10, "maxOutputs": 4 }`. Leave out a field
  for no limit of its own. Each beat says the ceiling. The lanes that the owner allows in Settings → Workers only
  narrow inside it, and the studio never hands the worker a job outside it: not a lane or a workflow it doesn't list,
  and not a bigger picture, a longer clip or more results. The worker checks each ticket against its ceiling again,
  before and after it composes, and gives back a job outside it.
- **Whole graphs.** Set `"acceptGraphs": false` in `worker.json` (setup asks) and the worker takes job tickets only,
  so not even the owner's own jobs reach it as graphs. A graph for an account's job is refused in any case.
- **Choices that depend on the PC.** The worker makes them from its own ComfyUI's answers (its GPU's memory, its RAM,
  its device, the model files and node packs it has), never from the studio's.

A ticket that the worker refuses before it runs (another catalog, or more than its PC allows) goes back in line at no
cost to the run. That worker is not offered it again until its build or its ceiling changes. A ticket that the worker
can't use at all fails the run, and the person who started it sees one plain sentence.

After an update of the studio that changes the catalog version, each job still waiting in line gets its ticket made
again for the new catalog before the next claim, with its place kept. The studio composes the same request again, so
its settings and files are checked again. The files the graph makes itself (a palette swatch, say) are made again too,
and staged in place of the old ones when they come out different. The job's lane and what it needs come from the new
catalog. A job whose workflow is no longer in the catalog, or whose settings are no longer allowed, ends with one
plain sentence. A job that a worker already holds finishes with the ticket it has.

Tickets only move forward. While a deploy's old and new app processes share the database, only the process that
started last makes tickets again, and only it ever ends a run for this. The other process leaves every ticket as it
is. A process that has said nothing for 5 minutes no longer counts.

An account's run needs a worker that takes this studio's job tickets now: protocol 3 or newer, built for this studio's
catalog. While every worker that could run it is built from the catalog before the studio's update, Run is off and
says the studio is busy, and the place in line counts no workers. The owner's own jobs still go to those workers.

### What the worker checks itself

Before its ComfyUI gets a graph, the worker checks all of these. The studio cannot change these checks. To add a model,
a workflow or a node pack that workers run, follow [Adding a model, a workflow or a node pack](adding-a-model.md).

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
   Prompts, lyrics and captions keep any text. Other text (a size, a colour, settings written as text or as JSON) is
   read only for the shape of a path, in each key and string of its JSON too. A drive path, a share, a rooted or home
   path, a `..` step, an address or a variable is refused. `16:9` and `Scene 2: 50% faster` stay as they are.
5. Every model file that the graph names is one that the worker verified, by its exact name, whatever the name ends
   with. A file with the same name in another folder does not count. A model input takes no other value, except the
   catalog's own values for that input that name no file.

The worker reports a model file only when its SHA-256 matches the hash that the catalog pins for it
(`bin/lib/worker/dist/file-pins.json`, from `requirements.json` and `model-pins.json`). A file that has no pinned hash
is not reported, so no job that needs it comes to the worker. The worker keeps the hashes it computed, so a restart
does not read the files again. The catalog's files that still have no pin are listed in `UNPINNED_FILES`
(`scripts/lib/worker-catalog.mjs`), the one list of them. A test fails when a catalog file has no pin and is not on
that list, and when a file on the list gets a pin, so the list only gets shorter.

#### Run-time files

Some runs load model files that are not among their workflow's own files: a Soul look's LoRAs, Soul Cinema's, a DoP
motion's or effect's, a model recipe's, and a LoRA that a graph picks by an option. These are run-time files
(`src/lib/runtime-files.ts`). A worker verifies them the same way, and reports them in its inventory with the catalog's
files:

- Its build writes `bin/lib/worker/dist/runtime-files.json`: every LoRA library entry
  (`src/lib/catalog/lora-library.generated.ts`) that has a pinned size and SHA-256, in the `loras` folder. A LoRA
  with no pin (a person's own trained LoRA, or a map LoRA with no pin) is never verified.
- The studio keeps these files from an inventory too, and they decide which runs go to the workers. The price check and
  the run plan every row of the run with the LoRA files it loads (`runLoraFiles`). A run goes to the workers only when
  a worker that may run its workflow verified each run-time file (`poolHasFiles`). Otherwise the price check says
  "This style runs on your own GPU", and Run opens the visitor's own GPU, as for a workflow that no worker runs. The
  LoRAs are never left out to make the run fit. Preset cards say the same before the press.
- A task stores its run-time files (`needs.runtime`, read from its graph's LoRA loaders), and only a worker that
  verified each one claims it. A job that no worker could take is refused before it waits in line. The owner's error
  names the files.

A worker program from before run-time files reports none, so runs that add them do not go to it.

The worker checks the copy that its ComfyUI loads:

- Its ComfyUI looks in the worker's model folders first, in the order that `worker.json` gives (`is_default` in the
  worker's `extra_model_paths.yaml`), and takes the first folder that has the file. So the worker checks only that
  first copy. If that copy has the wrong size or hash, the file is not reported, even when a later folder has a good
  copy.
- ComfyUI reads an older folder name as the same folder: `clip` for `text_encoders`, and `unet` for
  `diffusion_models`. In each model folder, the worker looks under the folder's own name first and then under its older
  name, and its `extra_model_paths.yaml` lists both in that order. So a text encoder in `models/clip` is found.
- Some node packs read ComfyUI's own `models` folder directly. And an older ComfyUI that does not know `is_default`
  looks in its own folders first. So a copy with the same name in ComfyUI's own `models` folder (`unet` and `clip`
  count for `diffusion_models` and `text_encoders`), or in a folder that ComfyUI's own `extra_model_paths.yaml` adds,
  must be the same file too. If it is not, the file is not reported.

After each job, however it ended, nothing of it stays in its ComfyUI: the worker empties the queue, stops a prompt that
still runs, and clears the whole history (a meta-batch's passes too). It also deletes the job's inputs and results from
its folders, and its copies of the inputs. At start, and whenever it stops, it empties these folders too. Before it
starts a job that its ComfyUI did not have last, it clears its ComfyUI the same way.

The owner's pictures for workers are made again from their pixels on the studio (no EXIF, no GPS). An account's
pictures go to the worker without being decoded, and the worker makes each one again from its pixels before its
ComfyUI or a finishing job reads it (see "Pictures of an account's run"). Before they leave, the studio sends only the
picture itself: it blanks what a picture carries besides its pixels, in place (EXIF and GPS, XMP, comments,
thumbnails, a JPEG's other application segments before and between its scans, every PNG chunk but its pixels' and
colours', a WebP's EXIF and XMP), and cuts off anything after the picture's end (a second picture, a phone's
motion-photo clip and its sound). A JPEG keeps only its orientation. A kind of picture that the studio can't clean
that way (a GIF, an SVG, an animated WebP, say) is made again from its pixels on the studio instead. Clips and sound go to workers only when `FUOBE_POOL_MEDIA_INPUTS` allows them (`image` by default;
`image,video,audio` for all); an account's run with a kind it doesn't allow is refused before it is queued. The worker
then makes each one again before its ComfyUI reads it (see "Clips and sound"). Every VideoHelperSuite save node of a
graph for the workers is sent with `save_metadata` off, so no prompt rides inside a result. An account's run is shaped
by the worker that takes it (see "Job tickets and the PC's ceiling"), never by the account's own computer.

### Clips and sound

Set `ffmpeg` in `worker.json` to the path of ffmpeg (setup asks for it). The worker then makes every clip and every
sound that a job sends again, into a fresh file, before its ComfyUI sees it:

- a clip keeps its first picture stream and its first sound stream, encoded again in the format that its name says
  (H.264 and AAC in MP4 for most names, VP9 and Opus for WebM);
- a sound keeps its first sound stream, in the format that its name says (WAV for any other name);
- nothing else of the file is kept: no metadata, chapters, subtitles, attachments or data streams.

The worker knows a clip or a sound by its type, by its name, or by the loader that reads it in the graph. ffmpeg runs
in its own process, at low priority, for at most 20 minutes. It reads the file only as a local file
(`-protocol_whitelist file`), and only as one of these container formats (`-format_whitelist`): MP4 and MOV (with M4A
and 3GP), Matroska and WebM, AVI, GIF, MPEG-TS, MPEG-PS, FLV, ASF, WAV, MP3, FLAC, Ogg, AAC and AIFF. A playlist, a
list or any other format that would make ffmpeg open other files or addresses is refused.

What ffmpeg writes has limits too: at most one hour, at most 4096 pixels on the long side (a bigger picture is made
smaller, in the same shape), and at most 8 times the input's size (at least 256 MB, at most 2 GB). A result that
reaches the size cap is refused before the worker reads it. If ffmpeg cannot read a file, or its result is too big,
the job fails with plain words ("A clip or sound in this run couldn't be read.").

Without `ffmpeg`, the worker takes pictures only. Its inventory says so (`media: ["image"]`), and the studio sends it no
workflow that reads a clip or a sound. If such a job comes anyway, the worker gives it back to the line.

### Pictures of an account's run

A worker (protocol 3) makes every picture of an account's job ticket, and of a finishing job, again from its pixels
before anything on the PC reads it. A short-lived process at low priority reads the picture as it came (with sharp, at
most 64 megapixels, for at most 2 minutes), turns it upright by its EXIF orientation and writes a fresh PNG. Nothing
else of the file stays: no EXIF, no GPS, no XMP, no comment. If the picture can't be read, the job fails with plain
words. The studio sizes the picture as it shows (turned by its orientation), so a clip in the picture's own shape keeps
that shape.

The worker needs sharp for this, which `pnpm install` puts in its checkout. Without it, the worker logs so and says
protocol 2 in its beat, so the studio sends it only the owner's own jobs. Only a worker of protocol 3 or newer takes an
account's job ticket or a finishing job. While accounts' runs may come to the install's GPUs, an older one reads **Update the worker**.

### The CPU slot

Set `"cpuSlot": true` in `worker.json` (setup asks) and the worker runs one CPU task at a time beside its GPU's job:

- **Light CPU work.** Catalog workflows that the requirements index marks `cpu` (no model file, no graphics memory, no
  particular card): joins, trims, adding sound, loops, Ken Burns moves and filters. They run on a second ComfyUI of the
  worker's own, started with `--cpu` and with no GPU visible to it. It has its own folders, port and key, behind the
  same guard and the same checks as the GPU's ComfyUI. `cpuComfyCommand` in `worker.json` starts it another way, as
  `comfyCommand` does for the GPU's.
- **Finishing jobs.** The CPU work that follows an account's run on the install's GPUs runs here, never on the studio's
  server. The worker runs them with its own code, in a process of its own at low priority, in an emptied folder that it
  deletes after the job, with a short environment (never its token):
  - `model3d`, the finish of an image-to-3D model. The worker first checks that the GLB is self-contained: every buffer
    and picture is inside the file. A GLB that names any other file is refused and never read further, and the run
    keeps its model as it is. Then it writes the web GLB and renders the turntable and its poster on the CPU. With no
    browser or ffmpeg for the turntable, the model comes back without one. This needs `pnpm install` in its checkout.
  - `path`, a camera path drawn through a still and its depth picture (the guide of a camera move), encoded by ffmpeg.
    This needs ffmpeg.

  A finishing job comes as a finish ticket (`src/lib/finish-ticket.ts`): its kind, typed settings, and its input
  files by slot, name and SHA-256. The worker checks it the same way the studio does, and sends back only the files its
  kind makes (`web`, `turntable` and `poster`; or `path`). The studio stores them, and checks the web GLB is
  self-contained again before it keeps it. The owner's own runs, and runs on an account's own GPU or keys, keep the
  studio's own finish, as before.

On the studio, a worker holds at most one GPU job and one CPU task. Each slot claims for itself (`slot: "cpu"` in the
claim), so a CPU task never waits for the GPU's job, nor holds it up. The line counts each slot apart: a CPU task never
stands ahead of a GPU job on a worker with a CPU slot, and the place and the wait say so. A worker with no CPU slot takes
light CPU work in its GPU's slot, as before, and no finishing job. A finishing job goes only to a CPU slot that runs its
kind, in the run's class and at the run's place in line. Light CPU work has its lane's run limits in either slot. A
finishing job's run limit is its lane's run ceiling, which the owner sets in the queue settings. Another program on the
GPU stops only the GPU's job; a pause now by hand stops both. A 3D run of an account on the install's GPUs is taken
only while a worker heard from in the last few minutes, built for this studio's catalog, has a CPU slot that runs the
3D finish, and only for a model whose GLB gets that finish (an image-to-3D model, or Hi3D's refine of one). Then the
billing policy's `kinds.model3d` says, as for any other kind.

A finishing job is queued once for its run (and step), even when two app processes ask at the same time, and its
results are stored once. It waits for a CPU slot as long as its run may wait in line. If no CPU slot takes it by then,
a 3D model keeps its raw GLB and a camera path's step ends with one plain sentence. While it waits, the run's place in
line is the finishing job's. A camera path for a run on the workers is always queued for a CPU slot, even while no
worker with one is about, and is never drawn on the studio's server. (A run on the install's own ComfyUI, on the
studio's machine, has its path drawn there, as the install's own runs do.)

A chain's later step (sent once the steps before it are done) keeps its run's class and place in line: the place of
the first job a step of the same run had on the workers, or else the time the run was made. Once a worker took any of
the run's jobs, the step has no wait limit, since the wait limit applies only before the run's first start. Only steps
of the same press of Run count (the same billing hold; with none, the same batch). A result kept from an earlier run
gives a new step neither that run's place nor its start. When two app processes run on one database (a deploy's
overlap), only the one that takes a step's turn sends it, so each step is sent once. A step is marked just before its
job is made; when the process that was sending it stopped part way, the next one looks for the step's job: none
made, and the step is sent now (in its run's place); one made, and the step ends in the one plain sentence and that
job stops, so it is never run twice. That look is for steps on the workers, whose jobs are tasks in the studio's
database. A step sent to the install's own ComfyUI (on the studio's machine) may be in its queue already, so when its
send was cut off it ends in the plain sentence instead of being sent again. A run's first job is the same: a run whose
first send was cut off (a restart or a deploy) before its job was made on the workers is sent again by one app process,
in the place it had (a run's first job waits from the time the run was made), instead of failing; one whose job was
made, or that went to the install's own ComfyUI, ends in the plain sentence. When the run is canceled or deleted, its finishing jobs end too: one in line at once,
with its files, and one that a CPU slot runs at its next progress report (the worker sends one at least every 10
seconds). A 3D model finished this way waits for the output check when the run asked for one, as any run's outputs do.
The time a CPU task runs is never counted as GPU time.

Each slot claims on its own count (60 claims a minute each). After a claim that found nothing, a slot asks again 3
seconds later, or 1.5 seconds later while the beat says that a person's job waits for it.

### Live previews

When a job's run shows live previews (never one whose results are checked before anyone sees them), the claim says
`reportPreview: true`. The worker then sends its ComfyUI's latest preview with its progress: a JPEG of at most 64 KB,
at most one every 2 seconds. A JPEG preview of 64 KB or less goes as it is. A PNG preview, or a larger JPEG, is made
again with ffmpeg first: at most 512 pixels on its long side, from a local PNG or JPEG file only, with no metadata.
Without ffmpeg, only small JPEG previews go; a picture that still doesn't fit in 64 KB is not sent. The studio keeps a
preview only from the attempt that holds the job, and drops a larger one (the progress stays).

### When something goes wrong

The worker keeps its jobs going by itself:

- **Results are kept until the studio has them.** When its ComfyUI finishes a job, the worker copies every result into
  `hold/<job>/` in the worker folder before it tells the studio. The copy stays until the studio has every file. If
  the worker or its ComfyUI stops in between, the next claim gives the job back to this worker, and it uploads the
  kept files from where the studio's copy got to. The job never runs twice. Kept results go up even while the worker
  is paused, because they need no GPU. Each beat names the jobs whose results the worker keeps (`held`), so a pause,
  even a pause now, leaves those jobs with this worker instead of sending them back in line. Kept results are deleted
  when the studio has them all, when the worker takes another job, when the studio no longer has the job, or after a
  day. A claim that finds nothing for the worker keeps them: their job may still come back to it.
- **One retry policy for the studio.** A studio that restarts, a proxy that answers 502, 503 or 52x, a network that
  drops, or a busy studio that says when to come back is waited out. The pause grows from 1 second to at most 30
  seconds. The worker waits up to 2 minutes for a call, and up to an hour for a part of a result. It sends a call
  again only when that is safe: a read, a part of a result, or a claim (a job that the studio gave out on a claim
  whose answer was lost comes back on the next claim). A proxy's page in place of the studio's answer (a 403 that is
  not JSON) never stops the worker.
- **Its log shows trouble that lasts.** A call that gets through on its second try (a second without the studio while
  it deploys, one dropped connection) writes nothing in the log. One missed beat writes nothing either, because the
  next beat comes a few seconds later. Two missed beats in a row write "Can't reach the studio" with the network's
  reason (for example `fetch failed (ECONNRESET)`), and the next beat that gets through writes "The studio answers
  again". A claim that the studio never answered had no job, so the log says that the worker can't ask for a job,
  not that a job stopped.
- **A job that stalls goes back to the line.** If a job makes no progress for its stall limit, or runs past the run
  limit that the claim gives, the worker takes its prompt off its ComfyUI and gives the job back. The job keeps its
  place in the line. If its ComfyUI does not let go of the prompt within 15 seconds, the worker stops ComfyUI and
  starts it again. A job that is given back counts as an attempt; the third time, it fails.
- **The stall limit** comes with each claim (`stallMs`). The studio gives 10 minutes for every lane now, never more
  than the lane's run ceiling. `stallMin` in `worker.json` has no default; when you set it, its minutes win over the
  claim's limit on that PC.
- **The run limit** counts from when its ComfyUI starts running the job (the model load included), not while the job
  waits. The studio gives 3 times the lane's 90th-percentile time on that worker plus the lane's model load, at least
  10 minutes and at most the lane's run ceiling (the queue's `runCeilingS`, 45 minutes unless the owner sets another).
  For a lane with no times on that worker yet, it gives the run ceiling, so a first long job can finish. A job given
  back once for running past its limit gets the whole run ceiling on its next try; past that, it fails. The worker
  ignores a run limit under 10 minutes.
- **A ComfyUI that stops answering** for `hungMin` minutes (3) is stopped and started again.
- **A job that the studio took back** (its token for the job no longer works, for example after the worker was out of
  touch) is stopped in its ComfyUI at once, so it never keeps the GPU busy for nothing.
- **Out of memory.** The worker frees its ComfyUI's memory (`/free`) and sends the job once more. Only a second time
  fails the job. The execution time that it reports is the retry's only.
- **Inputs are read once.** The worker keeps a copy of each input (by its SHA-256) while its job runs, so a job that
  is sent again reads nothing from the studio twice. If the studio will not send an input again (429 with no
  `Retry-After`), the job fails at once instead of looping. The copies go when the job ends, and also when a claim
  brings another job or none, however the last job ended.
- **The PC stays awake** while the worker holds a job, has results to send, or waits for work. A small helper asks the
  system to stay awake (`SetThreadExecutionState` on Windows, `caffeinate` on macOS, `systemd-inhibit` on Linux). The
  screen may still turn off. While the worker is paused or outside its hours, the PC sleeps as usual.
- **A PC that slept anyway** (a lid closed, the power button) is noticed when it wakes: a one-second wait in the
  worker's loop took over a minute. The next beat says how long the PC slept (`slept`, in ms). A job that the studio
  took back from the worker for going quiet during that sleep then counts no attempt, and the worker may take it again
  at once. This happens once per job at most.
- **Its model folders are read again** every 10 minutes, and whenever a job needs a model file that the worker has not
  found yet. A drive that comes back after a restart is noticed, and the studio gets the new list.
- **A model folder that isn't there yet** (a drive that is still locked or not connected after a restart) pauses the
  worker by itself (`local.why: "models-not-ready"`). Settings → Workers shows "Waiting for its model folders", and
  the worker's lanes stay as they were: the studio asks for no list of files meanwhile, and refuses one with 409. The
  worker checks its folders every minute. Once they are all there, it reads them again, sends the new list, and takes
  jobs again. A job already running goes on.
- **When the studio stops the worker.** If the studio no longer knows the worker's token, `fuobe worker run` ends with
  exit code 3; after new code is installed, it ends with exit code 75 (see "Install and update"); any other stop that
  you did not ask for ends with exit code 1. The sign-in task that
  `fuobe worker install` adds then starts the worker again after a minute. Ctrl+C ends with 0. On Ctrl+C, and on a
  stop from the system (SIGTERM), the worker stops its ComfyUI and empties its folders before it ends. Kept results
  stay for its next start.

### The protocol

Every worker call carries `Authorization: Bearer fuobe_wkr_…`. A worker token works only on `/api/gpu/computer/*` and
gets 403 everywhere else. It is never the owner, and an owner API token can never act as a worker. The studio reads the
token on every call, so a revoked token stops at once. **Settings → Security → Sign everyone out** with **Also revoke
every API token** revokes every worker's token too. Their jobs go back to the queue with their places kept, and the
admin log gets one `worker.revoke_all` row. Add each worker again to give it a new token. People's own paired
ComfyUIs keep theirs.

**A token's lifetime.** With `FUOBE_WORKER_TOKEN_DAYS` set (unset or 0: a token never expires, as before), a pool
worker's token lasts that many days. A worker added before the lifetime was set gets it from its first call after. Once
half of it is gone, the beat answer of a worker that says it saves tokens (`canRotateToken: true` in its beat) gives it
the next token (`worker.token: { value, expiresAt }`). The worker saves it and uses it from its next call on. The old
token stops at the new one's first use. A next token that is never used is given again, as a new one, after 10
minutes. A paired ComfyUI's token keeps no lifetime. The worker program sends `canRotateToken: true`: it saves the
next token in `worker.json` first, then uses it. If it can't save it, it keeps the token it has and gets the next one
again later. An older worker program doesn't rotate its token: update every worker before you set the lifetime, or
its token expires at the end of its lifetime and the worker stops until you rotate its token in Settings → Workers.
Every beat answer for a token with a lifetime also says when it ends (`worker.tokenExpiresAt`).

A worker whose token comes from `FUOBE_WORKER_TOKEN` never rotates it. That token stays out of files, and every start
uses the environment's token, so a next token saved in `worker.json` would not survive a restart. Such a worker sends
`canRotateToken: false` and writes the token's end date to its log once. Before that date, press **New token** in
Settings → Workers and put the new token in `FUOBE_WORKER_TOKEN`.

**Where a token is used from.** For a pool worker, the studio remembers the countries (Cloudflare's `cf-ipcountry`)
and the networks (an IPv4 address's /24 or an IPv6 address's /64, read only with `FUOBE_TRUST_PROXY=1`) its token was
used from, as short hashes, never as addresses. A call from a new country or a new network, and calls from two networks
within 10 minutes of each other, each write an alert to the admin log (`worker.alert`, actor `system`, the worker as
its target), at most once an hour each.

- `POST /api/gpu/computer/beat`: the browser's beat plus `{ protocol, version, canRotateToken?, local: { paused, why,
  until }, gpu: { otherApps, tempC }, inventoryHash, warmLane, held, slept?, catalogVersion?, ceiling? }`. The answer
  adds `worker: { paused, pauseNow, drain, autoResume, insideHours, nextChangeAt, lanes, lanesInside, minProtocol,
  sendInventory, token?, tokenExpiresAt?, catalogVersion? }` (`token`: the next token, above; `tokenExpiresAt`: when
  the token ends, for a token with a lifetime; `lanesInside`: the allowed lanes inside the PC's ceiling;
  `catalogVersion`: the studio's).
  - `catalogVersion` and `ceiling` say the catalog its build composes job tickets for and what its PC may ever run
    (see "Job tickets and the PC's ceiling"). The facts it sends with its ComfyUI's add `gpuGen`, its GPU's
    generation (compute capability), when nvidia-smi can say.
  - `protocol` is 2 for a worker that says which inputs it takes, makes clips and sound again, and keeps its ComfyUI
    behind the guard. It is 3 for a worker that also makes an account's pictures again (see "Pictures of an account's
    run") and may have a CPU slot.
  - `cpuSlot` (optional) says its CPU slot and the finishing jobs it runs (`{ finishes: ["model3d", "path"] }`), and
    `cpuRunning` the task that slot works on, as `running` does for its GPU's. With no `cpuSlot`, it has none.
  - `held` (optional) names the jobs whose finished results the worker keeps on its disk. A pause now sends those
    jobs back in line only when the worker doesn't name them.
  - While the worker waits for its turn (see "Studio jobs first"), `local` is `{ paused: false, why:
    "waiting-for-yield", until }`, where `until` is the helper's estimate of the start time, or null. After 3 minutes
    with no answer, `why` is `"waiting-for-yield:no-answer"`. The worker may still take jobs, and its jobs keep their
    place.
  - The answer also carries `claimableNow`, for studio jobs first: the number of people's jobs (never the owner's own)
    that this worker may take now. `ownerWaitingNow` is the same count for the owner's own jobs: they ask for no turn,
    but idle local ComfyUI work is asked to free its memory for them. It counts the jobs in the worker's pool that it can run (its lanes, files and VRAM)
    and that end before its hours do. It is 0 while the worker is paused on the website, drains, is outside its hours
    or runs an older worker program. The worker's own pause on the PC does not change it. The answer has no wait time
    and no request to interrupt local work: the worker measures `oldestWaitS` itself.
- `PUT /api/gpu/computer/inventory`: `{ files: [{ folder, name, size, sha256 }], nodePacks: [{ name, commit }], media }`
  → `{ lanes, workflows, missing }`. `media` lists the kinds of input that the worker takes (`image`, `video`,
  `audio`). With no `media` (a worker from before it was added, which doesn't make clips and sound again), the studio
  counts pictures only. A file's `name` is the requirements index's name for it inside its folder, subfolders and all
  (`bigvgan_vocoder/config.json`). The studio keeps only the files the index names and the run-time files (the LoRA
  library's pinned files, as `loras/<file>`), and hashes the list as it was sent, so its hash equals the worker's
  `inventoryHash`.
- `POST /api/gpu/computer/claim`: the browser's claimed task plus
  `{ lane, estMs, runLimitMs, stallMs, notAfter, attempt, models, class, workflowId }`. An account's job carries
  `ticket` in place of `graph`, with its run and stall limits in it too. `class` is `owner` for the owner's own job,
  the only kind that comes with a graph. See "The run limit" above for `runLimitMs`. A worker treats a graph that
  names no class as the owner's own job only while the studio's beat answer names no catalog version (a studio older
  than job tickets, which sends no account's run to workers).
  `stallMs` is how long the job may go with no progress before the worker gives it back (see "The stall limit"). A
  worker ignores a `stallMs` under one minute, and uses its own 10 minutes then.
  A worker's CPU slot sends `slot: "cpu"` and gets only work for that slot, with `slot: "cpu"` on the task. A
  finishing job carries `finish` (a finish ticket) in place of `graph` or `ticket`. `reportPreview: true` asks for live
  previews (see "Live previews").
- `POST /api/gpu/computer/bench`: bench jobs for this worker only (none are defined yet). The times of every finished
  job also count: the last 20 jobs in each lane give the median and the 90th percentile.
- Reports, inputs and results work as they do for the browser, with these additions:
  - `finished`, and the last `passes` report, carry `execMs` (the time that its ComfyUI spent executing the job, from
    ComfyUI's own timestamps: no waits, no uploads) and `device` (the GPU's name). The workers' log keeps both
    (`GET /api/admin/workers/jobs`), and the billing service gets them as `gpuMs` and `device`. For a CPU task
    (light CPU work, a finishing job), neither is kept: its time never counts as the run's GPU time, nor in a lane's
    typical time. A job that ran more
    than once counts once: the attempt whose result was kept. The studio keeps at most the run ceiling of the job's lane,
    and at most the time since the job was sent to its ComfyUI (plus a minute, because ComfyUI starts a job a moment
    before the studio hears that it was sent).
  - `running` can carry `preview`: the latest preview picture of the job, a JPEG of at most 64 KB as base64, at most
    one every 2 seconds (see "Live previews"). A progress report with a preview may weigh up to about 91 KB (the
    preview as base64 and a few KB more); any other stays under the small limit. A claim says `reportPreview: true` when the run shows one: only with hosted runs on
    (`FUOBE_HOSTED_RUNS=1`; without them, no job shows one, as before). The worker keeps the latest
    preview its ComfyUI sends on its socket and adds it to a `running` report. A PNG preview, or a JPEG over 64 KB, is
    made a smaller JPEG with ffmpeg first (at most 512 pixels on its long side); a worker without ffmpeg sends only
    ComfyUI's own small JPEGs. The studio keeps only the latest one for the job, shows it in the run's tile while the
    run works, and serves it only to the run's own account (`GET /api/generations/<id>/preview`, never cached). It
    drops the picture when the job ends, goes back in line or is claimed again. A picture that is not a JPEG, is too
    big, comes too soon or comes from an attempt that no longer holds the job is dropped, and the rest of the report
    still counts. A picture that the studio cannot keep (a full disk, a file open elsewhere) is dropped too. A run
    whose outputs the moderation service checks first shows no preview ([moderation-hook.md](moderation-hook.md)).
    Progress from reports and beats is kept in the database, so every app process sees the same step.
  - `give-back` with `why` (`stalled`, `run-limit` or `media`) puts the job back in line. The job keeps its place and
    counts as an attempt. Only a worker's job can be given back. With `update-worker` (a ticket for another catalog)
    or `outside-ceiling` (more than its PC allows), that worker is not offered the job again until its build or its
    ceiling changes. Refused on the claim that took it from the line, before anything was sent, it costs no attempt
    and waits as a job no worker took (its wait limit holds, unless a worker ran it before). Refused later on (a worker
    that started again after an update and took its own job back), it counts as an attempt, and the job keeps its
    claim's time.
  - `failed` can also give `unknown-node`, `unsafe-path` (a path, or an input outside its rule), `model-unverified`,
    `input-crashed` (its ComfyUI stopped twice on the job), `input-unreadable` (ffmpeg could not read a clip or a
    sound), `bad-ticket` (a ticket it can't use, or a graph where a ticket belongs), `unsafe-model` (a 3D model that
    isn't self-contained) or `finish-failed` (a finishing job that couldn't be made) as the reason. The worker's own log
    names the node and the input, never the value. For
    `input-crashed` and `input-unreadable`, and for a job that a worker gave back for the last time, the person who
    started the run sees one plain sentence with no technical detail.

Each worker counts against its own rate limits, so three workers that beat every 5 seconds never hold each other up.

### For the owner

- `GET /api/admin/workers` and `POST /api/admin/workers` (`{ name, pool? }`; the answer shows the token once). Each
  worker shows its PC's `ceiling`, the allowed lanes inside it (`lanesInside`), its `catalogVersion` and whether that
  is the studio's (`catalogCurrent`). Its state is `update-worker` while it is built from another catalog and accounts'
  runs may come to the install's GPUs.
- `PATCH /api/admin/workers/<id>`: `{ paused, pauseNow, drain, autoResume, hours, allow, claimAfterMs, switchAfterMs,
  rotate, revoke }`. Hours are `{ "always": true }` or `{ "tz": "Asia/Kolkata", "days": { "mon": [["01:00", "09:00"]] } }`.
  A window can go past midnight.
- `GET /api/admin/queue`: the jobs that wait in each lane, the oldest job, the estimate, and which workers have the
  lane warm.
- `GET` and `PATCH /api/admin/queue/settings`: the queue's settings (above).

### Behind Cloudflare

Worker calls come from programs, not browsers. If a bot check or a challenge is in front of your studio, add a rule
that skips it for requests to `/api/gpu/computer/*` and `/api/gpu/pair/*`. The worker tokens still protect these
routes.

## Tests

- `pnpm test` (`tests/workers-pool.test.ts`, `tests/workers-pairing.test.ts`, `tests/worker-program.test.ts`,
  `tests/worker-queue.test.ts`, `tests/worker-tokens.test.ts`, `tests/pool-account-runs.test.ts`,
  `tests/pool-line-order.test.ts`, `tests/pool-limits.test.ts`,
  `tests/worker-input-rules.test.ts`, `tests/worker-environment.test.ts`, `tests/worker-guard.test.ts`,
  `tests/worker-runner.test.ts`, `tests/worker-recovery.test.ts`, `tests/worker-parts.test.ts`,
  `tests/worker-turns.test.ts`, `tests/worker-turns-run.test.ts`, `tests/worker-update.test.ts`, `tests/cpu-slot.test.ts`,
  `tests/worker-cpu-slot.test.ts`, `tests/fuobe-connect-nodes.test.ts`). The CPU slot tests run a CPU task while a GPU job runs, refuse a GLB that names
  an outside file on the worker, bring a turntable back with its GLB, check that an account's picture reaches its
  ComfyUI with no EXIF, and drop a preview over 64 KB. The turn tests use a fake port table, fake GPU
  counters and a fake lock file. With only local ComfyUI work on the GPU, the worker writes `siteWaiting` and claims
  within 5 seconds of the answer; with a game, it pauses and asks for no turn. The input-rule tests
  send graphs that try to write or read files outside the worker's folders, and check that the worker refuses them.
  They also prepare every catalog workflow the way the studio does, and check that the worker accepts each one. The
  recovery tests run the worker against the studio's routes and a stand-in ComfyUI that the worker starts: they kill
  its ComfyUI halfway, stop the worker before an upload, make its ComfyUI hang, and check that the output arrives
  each time, once. The guard tests run the real guard in front of a stand-in ComfyUI when a Python with aiohttp is
  there (`FUOBE_TEST_PYTHON`, else `python3` or `python`), also through a venv's Python (that Python itself when it is
  a venv's, else a venv made from it); the clip tests need `ffmpeg` on the `PATH`.
- `node tests/e2e/worker.mjs` and `node tests/e2e/fuobe-connect.mjs` (after `pnpm build`, or with `E2E_DEV=1`). These
  use a stand-in ComfyUI and a stand-in `nvidia-smi` on ports 3361 and 3362. They never touch a real GPU or ComfyUI.
- `python -m unittest discover -s tests` in `integrations/fuobe-connect`
