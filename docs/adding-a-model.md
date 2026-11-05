# Adding a model, a workflow or a node pack

[← Development](DEVELOPMENT.md) · [Workers](gpu-workers.md) · [Workflow library](../scripts/comfy/README.md)

Every new model, ComfyUI workflow or node pack goes through these steps before it is merged. `pnpm test` checks most of
them (`tests/adding-a-model.test.ts` and `tests/worker-input-rules.test.ts`), and the worker build stops when a
required rule is missing.

- [1. The catalog entry](#1-the-catalog-entry)
- [2. Every file pinned](#2-every-file-pinned)
- [3. No downloads while a job runs](#3-no-downloads-while-a-job-runs)
- [4. The node allowlist and the input rules](#4-the-node-allowlist-and-the-input-rules)
- [5. Inputs and outputs](#5-inputs-and-outputs)
- [6. VRAM, lanes and CPU work](#6-vram-lanes-and-cpu-work)
- [7. The rest of the studio](#7-the-rest-of-the-studio)
- [8. Tests](#8-tests)
- [Known gaps](#known-gaps)

## 1. The catalog entry

- Write the graph: a hand-built file in `scripts/comfy/hand-built/`, or a template that `export-templates.mjs` exports.
- Add its entry to `scripts/comfy/library.spec.mjs`: its id, capability, bindings, outputs, defaults, limits,
  `vramGb` and `license`. Name in `packs` a node pack that the build's ComfyUI doesn't have, and name in
  `requiredModels` or `optionalModels` a file that no loader input shows, with its download link in `KNOWN_MODELS`.
- Build it against a ComfyUI that has its node packs: `cd scripts/comfy && npm run build -- <ids>`, then
  `node validate-workflows.mjs <ids> --shared`. The build writes the graph, `manifest.json` and `requirements.json` in
  `workflows/comfyui/`. The ComfyUI is `COMFYUI_URL` (`http://127.0.0.1:8188` by default). See
  [`scripts/comfy/README.md`](../scripts/comfy/README.md).
- Give the model its entry in `src/lib/catalog/models.ts`: its id, name, vendor, kind (image, video, audio, 3D or
  text) and a route to the workflow (`comfy(op, "<workflow id>")`).
- Record its licence as information: the entry's `license` (read by Settings → Models & licences and `CREDITS.md`). A
  licence is never a gate.

## 2. Every file pinned

- Pin each node pack in `workflows/comfyui/packs.json`: its repository and its commit.
- Pin each model file in `workflows/comfyui/model-pins.json`, under its download link: the revision, the exact size
  (`sizeBytes`) and the **SHA-256**. `node scripts/comfy/build-requirements.mjs --refresh-pins` reads them from
  Hugging Face (it needs the network; a repository that asks you to sign in needs `HF_TOKEN`). For a file hosted
  anywhere else, hash the exact file and write its pin by hand.
- Run `node scripts/comfy/build-requirements.mjs`. It rewrites `workflows/comfyui/requirements.json`, the index that
  the `/connect` board, the queue and the worker build read.
- A worker reports a model file only when the file's SHA-256 matches its pin. A file with no pin is never reported, so
  no job that needs it goes to a worker.
- The test fails when a file that a catalog workflow names has no pin: every file in the index (required or optional),
  and every model file a graph names that the index doesn't know. A LoRA or an upscaler that the run picks is the
  person's own file, so it needs no pin.

## 3. No downloads while a job runs

- A worker starts its ComfyUI with `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE`, `HF_DATASETS_OFFLINE` and `PIP_NO_INDEX`
  set to `1` (`bin/lib/worker/comfy.mjs`). It sets them whatever its own environment says.
- These switches stop downloads from Hugging Face and pip only. A node that downloads with its own code (from a
  GitHub release, say) is not stopped by them. Prefer a loader that reads its file from a model folder.
- If a node fetches files the first time it runs, describe them in the entry's `autoDownloads`. Then list each file,
  with its pin, in `workflows/comfyui/first-run-files.json`:

  ```json
  "workflows": {
    "<workflow id>": [
      { "path": "models/<folder>/<file>", "url": "https://huggingface.co/<org>/<repo>/resolve/<commit>/<file>", "sizeBytes": 123, "sha256": "<64 hex digits>" }
    ]
  }
  ```

  `path` is where the node looks, under the ComfyUI folder: a model folder (`models/…`) or a folder inside the node pack
  (`custom_nodes/<pack>/<folder>/…`), never the pack's own top level or anywhere else. A first-run file is data: the
  test refuses code (`.py`, `.dll`, `.exe`, `.js` and the like) and Windows device names (`CON`, `NUL`…). A Hugging
  Face link (`huggingface.co`, `hf.co` or a host under them) names a commit, never `main`. Put the files in place on a
  worker before the workflow runs there.
- A model file that a graph names and that a node fetches on its first run needs no entry in `model-pins.json` when
  `first-run-files.json` lists it for that workflow, under the same file name. Naming it in `autoDownloads` is not
  enough: the test counts it as a file with no pin.

## 4. The node allowlist and the input rules

- Run `node scripts/build-worker.mjs` (`pnpm build` runs it first). It rebuilds `bin/lib/worker/dist/allowed-nodes.json`,
  `input-rules.json` and `file-pins.json` from the catalog. Two builds of the same commit write the same files. It also
  writes `build-stamp.json`, a hash of every file that it read. A worker starts only when the stamp matches its
  checkout.
- Every node input that could name a file, a folder, a download or code gets a rule, from the catalog's own values:
  a fixed value, one of a list, a number range, a file that the job sent, a save name that the studio makes, or a
  model file that the worker verified in its loader's folder.
- A worker refuses a graph that links another node into an input with a rule, or that holds a value outside its
  rule. An input with no rule that takes no free text may hold no path. Other text that isn't a prompt (settings
  written as text or JSON, values the studio fills per run) may hold no path either.
- A model input takes only a file that the worker verified, whatever its extension, or one of the catalog's own values
  for that input that names no file.
- The build stops, and writes nothing, when:
  - an input that writes or reads a file, or formats with code, has no rule (`REQUIRED_RULES` in
    `scripts/lib/worker-catalog.mjs`);
  - any catalog value that names a path, a download or code has no rule (`scripts/lib/catalog-checks.mjs`);
  - the catalog links another node into any input that has a rule: a model file, a file that the job sends, a save
    name or a fixed value. A worker would refuse every such graph.
- Write a path, a download id or a format string in the graph as a fixed value. Never build one from other nodes.
- A node that reads or writes a path it is given: add the input to `REQUIRED_RULES`, and give it a fixed value in the
  catalog (empty when the node allows "no file"). If the build reports a missing rule, add the rule. Never widen the
  path check.
- Bind a person's text only to inputs that take free text (prompts, captions, lyrics: `TEXT_NAME` in
  `bin/lib/worker/rules.mjs`). An input named for a file or a folder keeps the catalog's values, so a run that sends
  other text there is refused.
- An input that the run fills with text that isn't a prompt (typed `STRING` in `object_info.subset.json`, or text in
  the catalog when that file doesn't name the input) gets no rule. The test lists every such input, and the list must
  match `FREE_TEXT_INPUTS` (`scripts/lib/worker-catalog.mjs`). Add an input there only after you read its node's code
  and see that it never uses the value as a path. Otherwise give the input a fixed value, or bind it to nothing.

## 5. Inputs and outputs

- Read every input file through a loader (`LoadImage`, `LoadVideo`, `LoadAudio` and the like), and bind it in the
  manifest as an image, a video or an audio input. A worker takes only files that the job sent.
- Pictures for workers are made again from their pixels on the studio: no EXIF, no GPS. Clips and sound are made again
  with ffmpeg on the worker before its ComfyUI reads them ([Clips and sound](gpu-workers.md#clips-and-sound)). The
  worker knows a clip or a sound by its type, its name or the loader that reads it.
- Save results under the save name that the studio makes: bind `filename_prefix` to `filenamePrefix`.
- The worker's ComfyUI starts with `--disable-metadata`. That flag covers only ComfyUI's own save nodes.
- VideoHelperSuite's save node (`VHS_VideoCombine`) writes the run's graph and the local time into a clip unless
  `save_metadata` is `false`, whatever `--disable-metadata` says. Set `"save_metadata": false` in every new graph. A
  worker sets `save_metadata` to `false` on every such node of each graph before its ComfyUI gets it, so this matters
  for runs on a person's own GPU.
- ComfyUI's SVG save node (`SaveSVGNode`) writes the run's graph into every SVG, whatever `--disable-metadata` says. A
  worker takes that `<metadata>` element out of each SVG result. Prefer a save node that writes none. The test counts
  every graph with such a node as one that keeps metadata.

## 6. VRAM, lanes and CPU work

- Set `vramGb` in the entry: the most graphics memory the workflow needs, in whole GB.
- A workflow's lane comes from its files over 2 GB (`src/lib/lanes.ts`). Workflows that load the same big files share a
  lane, so a worker runs them one after another with no reload.
- A worker takes a job when its card has the workflow's VRAM, less 3%, because a card reports a little less than its
  size.
- NVFP4 files need a Blackwell card. The queue doesn't read a card's generation, so leave lanes with NVFP4 files off an
  older card's allowed lanes. Give smaller and older cards an fp8 or GGUF workflow where one exists.
- A workflow that loads no model file, fetches none on its first run, has `vramGb: 0` (the number 0, written in the
  entry) and names no card in `gpu` is CPU work: joins, trims, adding sound, Ken Burns, still to clip. The index marks
  it `"cpu": true`. The studio reads the marker: a run of CPU work only is free and never counted on this install's
  GPUs, and its jobs go to a worker's CPU slot. The index build stops when an entry has no `vramGb` number, so a
  workflow never becomes CPU work by mistake. Set `vramGb` above 0 when any node of the workflow loads something into
  graphics memory.
- Some nodes need a particular card but no graphics memory of their own (the NVIDIA RTX Video nodes). Set `gpu` for
  such a workflow (for example `"gpu": "nvidia-rtx"`), so it is never CPU work.

## 7. The rest of the studio

- Give each new studio or tool a row on the `/connect` board (`STUDIO_ROWS` in `src/server/gpu/tools.ts`).
- New routes follow public sign-up ([`docs/public-signup.md`](public-signup.md)): price checks go in `ESTIMATES` or
  `PREVIEWS` (`src/lib/guest-access.ts`) and run through `priceAs` (`src/server/visitor.ts`); an account's run reads only
  its own files (`src/server/tenant.ts`, `src/server/account-inputs.ts`); a route that takes a large file takes an
  uploaded file's reference.

## 8. Tests

- `pnpm test` runs every workflow through the worker's checks, as the catalog has it and as the studio prepares it for
  a run (`tests/worker-input-rules.test.ts`). A new workflow must pass both.
- `tests/adding-a-model.test.ts` checks the pins, the first-run files, the rules, the worker build, the CPU marker and
  the save nodes, as these steps describe.
- When a new node can read or write a path, add an attack case: a graph that tries to read or write outside the job
  is refused.
- Tests use stand-ins, such as a fake ComfyUI on a random port (`tests/helpers/fake-local-comfy.ts`). They never reach
  a real ComfyUI or a GPU.

## Known gaps

These lists hold what isn't done yet. Each list may only shrink: `tests/adding-a-model.test.ts` fails when something
new joins it, and when something on it is fixed but still listed.

- `UNPINNED_FILES` (`scripts/lib/worker-catalog.mjs`, the one list of them): model files with no SHA-256 pin yet. A
  file of the index is listed as `folder/file`. A file that only a graph names (a node fetches it on its first run) is
  listed by its name, until `first-run-files.json` pins it. No worker runs the workflows that need them.
- `FIRST_RUN_GAPS` (`tests/adding-a-model.test.ts`): workflows whose first-run files aren't in
  `first-run-files.json` yet.
- `KEEPS_METADATA` (`tests/adding-a-model.test.ts`): workflows whose save node still writes metadata into a result.
  A worker takes it out of its own results (section 5), so the list matters for runs on a person's own GPU.

Never add to these lists. Pin the file, list the first-run files, or set `save_metadata` to `false` instead.
