# Fuobe research #6: Openjutsu and Akatz Labs' H3 Character Swap

_As of 2026-10-27. Machine-readable twin: [`openjutsu-6.json`](openjutsu-6.json) (`openjutsu`, `workflow`, `akatz`, `nodePack`, `h3Relay`, `gpu`, `models`, `licences`, `hosted`, `comfyPlatform`, `anchor`, `plan`, `risks`, `sources`). It builds on [`comfyui-oss-4.md`](comfyui-oss-4.md) §c (the round-4 Genjutsu routes), [`fuobe-originals-recipes-5.md`](fuobe-originals-recipes-5.md) §8 and package O5 (Fuobe Genjutsu), and [`paid-model-apis.md`](paid-model-apis.md) parts 1–4 (the hosted `minimax/h3*` endpoints on fal)._

**What was asked.** The owner wants (1) Comfy Org's **Openjutsu** — swap the person in a 5–15 s part of a clip for the character in one image, keeping the performance, the scene and the clip's own sound — and (2) everything in **Akatz Labs' H3 Character Swap tool**, which Openjutsu is built on, inside Fuobe's Genjutsu on both engines. Licences are information for Settings → Models & licences, never a reason to leave something out (the owner's decision of 10-27).

**How this was produced.** Read-only. Openjutsu from the clone at `/home/user/comfy-org/comfy-openjutsu` (commit `70ec62df0eda7c58697ea3ac2050588513651583`, 2026-10-26, the only commit). Akatz's tool cloned with `--filter=blob:none` and read at two commits: `0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b` (2026-10-16, the one Openjutsu pins, the last with the `h3_character_swap` node pack) and `5f83374bc4f6fbc458f369f5bbe058c4a65816dc` (2026-10-17, latest, which replaced the pack with H3 Relay). The vendored H3 Relay archive (`vendor/h3-relay-8c313cc6bd23.tar.gz`, SHA-256 `e61e0a8a…7d38`) and the public `akatz-ai/h3-relay` repository (main `e2a7665b`, 2.0.1) were unpacked or cloned into their own folders and read; `@comfyorg/sdk` 0.5.0 was unpacked from the npm tarball and read. No code from any of them was run or installed. Node classes were checked with read-only `GET /object_info/<class>` on the library's CPU ComfyUI (`fc04da91`, v0.41.0-7, Python 3.13.16, torch 2.14.1+cpu, comfy-kitchen 0.2.37). File sizes and hashes are from the Hugging Face tree API at the pinned revisions; hosted fields and prices are from fal's queue OpenAPI files and `llms.txt` pages, MiniMax's API reference and pricing page, Replicate's model page and docs.comfy.org. **Nothing ran on a GPU or a paid API.**

## 1. The short version

- **Openjutsu is a thin app over one ComfyUI graph.** A Next.js page uploads the clip and the character image to a Comfy Developer Platform deployment with `@comfyorg/sdk`, writes the clip, the character, the part, the quality, the prompt, the seed and the optional anchor into `workflows/swap.api.json` (32 nodes) and polls the job. The graph is Akatz's `H3 Character Swap.api.json` at `0670e4f` with five changes (§3). Optional first step: GPT Image 2.5 Sunburst through Comfy Router makes an "anchor" first frame; if that fails the swap runs without it.
- **The recipe:** MiniMax H3 Ref2VA (pruned INT8 ConvRot) + lightx2v FL2V Turbo 8-step LoRA + Akatz's Character Swap LoRA V1.5, Qwen3-VL 32B NVFP4 text encoder, SAM 3.1 finds the largest person on the part's first frame and tracks them, the mask is grown 64 px, H3 regenerates only the masked region in 124-frame windows with 18 frames of history, 8 steps, CFG 1, `er_sde`/`normal`, and the clip's own audio is put back. Files: **46.33 GB** (§6).
- **22 of the graph's 32 nodes are core ComfyUI 0.41** (all present on the live server); 10 come from the `h3_character_swap` pack (GPL-3.0). The pack is not installed here and was not installed, so `/prompt` validation of the full graph is not possible on this machine; a static check of the 22 core nodes against `/object_info` passed except for model and upload file names (expected with no weights) (§3.3).
- **Openjutsu's graph only runs on the patched pack.** Its patch turns `H3CharacterSwapPrepareVideo.resolution` into integers 480/768 and swaps ffprobe for PyAV. The **unpatched** pack works on a normal ComfyUI with system FFmpeg and FFprobe, but then the graph must send the strings `"480"`/`"768"` — ComfyUI's combo check rejects the integer (`value_not_in_list`, `execution.py` lines 1060–1071) (§4.3).
- **Akatz's tool is much more than a swap**: batches, shot-cut detection with Replace / Keep original per shot, Whisper transcription feeding a dialogue-aware performance prompt, scene anchors (import or a local Codex image tool), SAM masks with point corrections, editable 5/10/15 s segments with continuation history, takes, comparisons and review, and a "Finish" stage (clean backplate + alpha compositing) that is present in the code but not runnable from the public release (§4).
- **Hosted routes exist.** fal hosts MiniMax H3 with a LoRA field — `minimax/h3/reference-to-video/lora` ($0.0625/s 480p, $0.075/s 768p) — which can load Akatz's swap LoRA by Hugging Face repo id; and MiniMax's own hosted person swap, `minimax/h3-max/recast` (5–30 s sources, 1–4 people, $0.30/s 768p, $0.45/s 1080p). Plain H3 reference-to-video is also on Replicate (`minimax/h3`), MiniMax's API and Comfy Router (`minimax/minimax-h3`). None of them takes a SAM mask, so none is the exact Akatz recipe (§7).
- **A Comfy deployment is not a plain ComfyUI server.** `https://{deployment}.run.comfy.app` serves the Comfy API v2 (`/api/v2/assets`, `/api/v2/jobs`) with `Authorization: Bearer`; the docs never list `/prompt`, `/history` or `/view` there. Fuobe's ComfyUI provider (which speaks `/prompt`, `/history`, `/view`, `/upload/image`, `/ws`) would need a v2 client to drive one (§8).
- **Plan:** a **Character swap** mode in `/genjutsu` on both engines — open: the H3 graph (pack pinned, string resolutions), the H3 Relay 2.0 variant and H3 Person Removal for Remove object; cloud: the fal H3 + Akatz-LoRA route as the Fuobe Original, H3 Max Recast, and the existing Kling O3 / P-Video / Wan routes; the anchor on GPT Image 2.5 Sunburst, Nano Banana Pro or Qwen-Image-Edit 2511; plus who-to-swap, masks, audio guide, longer clips and dialogue-aware prompts from Akatz's app (§10).

## 2. Openjutsu's flow and limits

Sources: [`README.md`](https://github.com/Comfy-Org/comfy-openjutsu/blob/70ec62df0eda7c58697ea3ac2050588513651583/README.md), `lib/swap.ts`, `lib/anchor.ts`, `lib/frame.ts`, `lib/uploads.ts`, `lib/job-error.ts`, `lib/comfy.ts`, `components/app-runner.tsx`, `app/api/*`, all at `70ec62d`. Openjutsu is Comfy's reference app for its "Open Source the parity studio" competition (["Openjutsu — Swap a character in a video"](https://comfy.org/open-source-{studio}/), entries due 2026-10-30) and runs at [comfy.org/hub/apps/openjutsu](https://comfy.org/hub/apps/openjutsu/). Licence MIT (Comfy Org 2026).

| Step | What happens | Where |
|---|---|---|
| Pick the clip | MP4 or MOV (`video/mp4`, `video/quicktime`), ≤ 100 MB; the browser reads its duration; a clip under 5 s is refused ("Choose a clip at least 5 seconds long.") | `lib/uploads.ts` L1–10, `app-runner.tsx` L118–129 |
| Pick the part | **Start** slider 0 … duration − 5 s, step 0.1; **Length** slider 5 … min(15, duration − start), step 0.1; moving Start shortens Length if needed; values rounded to 0.01 s on the server | `app-runner.tsx` L150–153, L220–225; `lib/swap.ts` L3–4, L56–76 |
| Character image | PNG, JPEG or WebP, ≤ 20 MB | `lib/uploads.ts` |
| Direction | Optional text, ≤ 500 chars ("add character details or fix the last take, e.g. darker jacket, keep the glasses, less smiling") | `lib/swap.ts` L9, `app-runner.tsx` L231 |
| Quality | `480p` → 480, `768p` → 768 (sent as **numbers**); UI default `768p` | `lib/swap.ts` L5, `app-runner.tsx` L74 |
| Seed | Blank = random uint32 (`crypto.getRandomValues`); else a whole number 0 … 2³²−1 | `lib/swap.ts` L8, L31–33, L67–68 |
| First frame | Checkbox "First frame with GPT Image", **on** by default (§9) | `app-runner.tsx` L77, L155–175 |
| Run | Uploads with `client.assets.fromBytes`, fills the graph, `client.submit(client.workflows.fromJson(graph))`; polls `/api/jobs/<id>` every 3 s (5 s after an error); active states `queued`, `running`, `pending`; the result is the output whose name matches `/result/i` | `lib/comfy.ts` L106–121, `app-runner.tsx` L13, L91–116 |

**The prompt.** Every prompt starts with the workflow's instruction in H3's reference tags, then the optional anchor sentence, then the direction:

```
Replace the selected person in <Video 1> with the character in <Picture 1>. Preserve the source performance, scene and audio timing.[ Start from the first frame in <Picture 2>.][ <direction>]
```
(`swapPrompt`, `lib/swap.ts` L22–29.) `<Video 1>` is the source performance, `<Picture 1>` the character, `<Picture 2>` the optional anchor (Akatz's `workflows/README.md` at `0670e4f`, "Run the canvas workflow" step 5).

**Graph filling** (`swapWorkflow`, `lib/swap.ts` L35–54): `30.file` ← clip; `9.image` ← character; `trim.start_time`/`trim.duration` ← part; `31.resolution` ← 480|768 and `31.duration_seconds` ← length; `801.prompt`, `801.seed`; with an anchor `anchor_image.image` ← anchor; without one the nodes `anchor_image` and `anchor_fit` are deleted, `803.anchor` is removed and `803.use_anchor` = false.

**Error cases.**

| Where | Message or behaviour |
|---|---|
| Upload checks (400) | "Choose a video clip.", "Upload an MP4 or MOV video.", "Keep clips under 100 MB.", "Choose a character image.", "Use a PNG, JPEG or WebP for …", "Keep … under 20 MB." |
| Settings (400) | "Choose where the part starts.", "Choose a part between 5 and 15 seconds long.", "Choose 480p or 768p.", "Use a whole-number seed, or leave it blank." |
| Missing key (503) | "COMFY_API_KEY is not configured." (`app/api/jobs/route.ts` L26–29); other submit errors → 502 |
| Anchor (400/502) | Any failure is shown as "<error> Swapping without it…" and the swap is submitted **without** the anchor (`app-runner.tsx` L171–174) |
| Job failed | `jobErrorMessage`: "Node 'X' not found" → "This Comfy deployment is missing the “X” node. Add the custom nodes listed in build/model-files.md, publish a Build release, and redeploy."; anything else → the error text or "Comfy could not run this workflow. Check the deployment logs and try again." plus the job id |
| Inside the graph (pack) | "SAM found no subject. Adjust the subject text and inspect the mask preview." (no person on the part's first frame); "SAM lost the selected person at frames […]" after per-frame recovery; "The upload does not contain a video stream."; "Could not prepare the uploaded video: …"; "Video must contain 1–3592 frames at 24 fps"; "Completed video does not cover the exact source timeline" (`nodes.py`, `video.py`, `relay/runner.py` at `0670e4f`) |

**Limits** (README "Limits"): clips ≤ 100 MB, MP4/MOV, part 5–15 s; one continuous shot ("A hard cut breaks the swap at the cut"); a person must be visible in the part's first frame; with several people the largest is swapped; a silent clip gives a silent result; reloading clears the job. Speed: "a 5 second part at 480p took about two minutes on a warm worker"; the first job can take minutes while the deployment starts. **Hardware:** "run on a 96 GB GPU (RTX PRO 6000); smaller configurations have not been tested."

**Examples** (`lib/examples.ts`): four clip/character pairs served from `media.comfy.org/website/workshop/openjutsu/examples` (singer/diva, boxer/comfy-tee, painter/ronin, cowboy/chrome-robot). Their licence is not stated; Fuobe should not copy them.

## 3. `workflows/swap.api.json`

### 3.1 Every node

`core` = present on the live ComfyUI v0.41 (`GET /object_info/<class>` answered with an `input` spec); `pack` = `h3_character_swap` (absent here: `{}`).

| id | class | origin | inputs (literals; links as `[node, slot]`) |
|---|---|---|---|
| 1 | `UNETLoader` | core | `unet_name` minimax_h3_ref2va_pruned_int8_convrot.safetensors, `weight_dtype` default |
| 2 | `MiniMaxH3SigmaShift` | core | `shift_video` 12, `shift_audio` 3, model [1,0] |
| 3 | `ModelAttentionBackend` | core | `attention` "comfy kitchen attention", model [2,0] |
| 4 | `LoraLoaderModelOnly` | core | FL2V Turbo 8-step LoRA, strength 1, model [3,0] |
| 850 | `LoraLoaderModelOnly` | core | `h3_character_swap_v1.5.safetensors`, strength 1, model [4,0] |
| 6 | `CLIPLoader` | core | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`, `type` minimax, `device` default |
| 58 | `SelectCLIPDevice` | core | `device` "gpu:0", clip [6,0] |
| 7 / 8 | `VAELoader` | core | video VAE fp16 / audio VAE fp32 |
| 9 | `LoadImage` | core | `image` reference.png — **the character** |
| 30 | `LoadVideo` | core | `file` source.mp4 — **the clip** |
| trim | `Video Slice` | core | `start_time` 0, `duration` 5.0, `strict_duration` false, video [30,0] |
| 31 | `H3CharacterSwapPrepareVideo` | pack | `resolution` 768, `duration_seconds` 5.0, video [trim,0] |
| 100 | `CheckpointLoaderSimple` | core | `sam3.1_multiplex_fp16.safetensors` |
| 101 | `CLIPTextEncode` | core | `text` "person", clip [100,1] |
| 102 | `ImageFromBatch` | core | `batch_index` 0, `length` 1, image [31,0] (the part's first frame) |
| 103 | `SAM3_Detect` | core | `threshold` 0.35, `refine_iterations` 2, `individual_masks` true |
| 104 | `H3CharacterSwapSelectSubject` | pack | `selection` largest, `index` 0, masks [103,0] |
| 105 | `SAM3_VideoTrack` | core | `detection_threshold` 0.5, `max_objects` 1, `detect_interval` 1, initial_mask [104,0] |
| 106 | `SAM3_TrackToMask` | core | `object_indices` "" |
| 107 | `H3CharacterSwapRecoverMasks` | pack | `recover_empty_frames` true, selection [104,1], source_frames [31,5] |
| 110 | `H3CharacterSwapExpandMask` | pack | `expansion_px` 64 |
| 800 | `H3CharacterSwapModels` | pack | model [850,0], clip [58,0], video_vae [7,0], audio_vae [8,0] |
| 801 | `H3CharacterSwapSettings` | pack | `prompt`, `seed` 904239, `audio_guide` true, `steps` 8, `cfg` 1, `sampler_name` er_sde, `scheduler` normal, `activation_memory_gib` 17 |
| anchor_image | `LoadImage` | core | `image` anchor.png — **the anchor** (optional) |
| anchor_fit | `ImageScale` | core | `upscale_method` lanczos, width [31,2], height [31,3], `crop` center |
| 803 | `H3CharacterSwapShot` | pack | `use_anchor` true, `use_mask` true, `shot_id` character-swap; source_video [trim,0], source [31,0], source_audio [31,1], source_frames [31,5], fps [31,6], reference [9,0], anchor [anchor_fit,0], body_mask [110,0] |
| 805 | `H3CharacterSwapWindowPlan` | pack | `window_frames` "124", `history_frames` "18" (string combos) |
| 806 | `H3CharacterSwapController` | pack | models [800,0], shot [803,0], plan [805,0] |
| 807 | `H3CharacterSwapAssemble` | pack | `filename_prefix` character-swap; state [806,0], shot [806,1] |
| 808 | `CreateVideo` | core | images [807,0], audio [807,1], `fps` 24, `bit_depth` 8, `color_space` sRGB, `codec` none |
| 809 | `SaveVideo` | core | `filename_prefix` openjutsu/result, `format` mp4, `format.codec` h264 — **the output** |

`H3CharacterSwapPrepareVideo` outputs (slot): 0 frames, 1 source audio, 2 width, 3 height, 4 H3 length, 5 source frames, 6 fps, 7 summary, 8 prepared video (`video.py` L91–92).

### 3.2 Changes from Akatz's graph (README "Changes from Akatz's workflow", checked by diffing the two API files)

| Change | Why (Openjutsu's words) |
|---|---|
| Swap LoRA V1 (`h3-character-swap-v1/h3_character_swap_pro4500_1000.safetensors`) → `h3_character_swap_v1.5.safetensors` | "Akatz's recommended release" |
| `Video Slice` (`trim`) in front of 31 and 803 | the app chooses where the part starts |
| `H3CharacterSwapOptionalAnchor` (309, `(none)` or an upload) → core `LoadImage` + `ImageScale` | "Uploaded files fail node 309's own validation on a deployment"; `ImageScale` centre-crops the anchor to the prepared size |
| `CreateVideo` + `SaveVideo` after 807 | "A deployment reports only standard outputs" (807 reports its file only under `ui.h3_character_swap`) |
| Mask preview (111, 112) removed | not needed |
| `resolution` 768 (integer) instead of "768"; `duration_seconds` 5.0 instead of 0 | the patched pack (§4.3) |

### 3.3 What this machine checked

All 22 core classes answer on the live server, including `MiniMaxH3SigmaShift`, `SAM3_Detect`, `SAM3_VideoTrack`, `SAM3_TrackToMask`, `Video Slice`, `CreateVideo`, `SaveVideo` and, for the H3 Relay variant, `MiniMaxH3ReferenceToVideo`, `MiniMaxH3AddGuide`, `LTXVSeparateAVLatent`, `VAEEncode`, `GetImageSize`, `StartLoop`, `EndLoop`. A static comparison of every literal input of the 22 core nodes against `/object_info` (combo lists, min/max, required inputs) passed except for the file names (no weights or uploads here). Two values look wrong on CPU but are accepted: `ModelAttentionBackend.attention` lists only "pytorch attention" without a CUDA comfy-kitchen backend, and `SelectCLIPDevice.device` lists only default/cpu, but both nodes define `validate_inputs` taking that input, so ComfyUI skips the combo check (`execution.py` L1032); at run time the first falls back to PyTorch attention with a warning (`nodes_model_advanced.py` L374–410) and the second passes the CLIP through (`nodes_multigpu.py` L234–274). The pack's imports also exist in this ComfyUI (`comfy_extras.nodes_minimax_h3` `_empty_av_latent`, `_resize`, `_encode_ref_audio`, `adapt_canvas`, `CANVAS_MULTIPLE`, `REF_IMAGE_SHORT_EDGE`, `FPS`; `comfy.nested_tensor.NestedTensor`; `comfy_api.latest._input_impl.video_types`; `minimax_ref_items` in `comfy/text_encoders/minimax.py`). **Not checked:** `/prompt` validation of the whole graph (needs the pack's nodes, which must not be installed here) and any run (46 GB of weights, GPU).

### 3.4 Bindings Fuobe needs and the defaults

| Fuobe binding | Node.input | Default | Notes |
|---|---|---|---|
| `video` | `30.file` | — | uploaded clip |
| `image` | `9.image` | — | character |
| `startTime` | `trim.start_time` | 0 | seconds |
| `duration` | `trim.duration` **and** `31.duration_seconds` | 5 | 5–15 s; both must match |
| `resolution` | `31.resolution` | `"768"` | **strings `"480"`/`"768"` on the unpatched pack**, integers on the patched one |
| `prompt` | `801.prompt` | Openjutsu's instruction | `<Video 1>`/`<Picture 1>`/`<Picture 2>` tags |
| `seed` | `801.seed` | random | pack allows 0 … 2⁶⁴−1; Openjutsu 0 … 2³²−1 |
| `anchorImage` | `anchor_image.image` | — | absent: delete `anchor_image`, `anchor_fit`, `803.anchor`; `803.use_anchor` = false |
| `maskPrompt` | `101.text` | "person" | SAM text |
| `selection` / `subjectIndex` | `104.selection` / `104.index` | largest / 0 | largest, leftmost, rightmost, index |
| `maskGrow` | `110.expansion_px` | 64 | 0–256, Euclidean radius in prepared pixels |
| `audioGuide` | `801.audio_guide` | true | output keeps the source audio either way |
| `useMask` | `803.use_mask` | true | false = whole-frame regeneration |
| `steps` / `cfg` | `801.steps` / `801.cfg` | 8 / 1 | sampler `er_sde`, scheduler `normal` for the Turbo LoRA |
| `windowFrames` / `historyFrames` | `805.window_frames` / `805.history_frames` | "124" / "18" | 17n+5 (22…362) / 0, 1, 17n+1 (18…341) |
| `lora` / `loraStrength` | `850.lora_name` / `850.strength_model` | V1.5 / 1 | "none": delete 850, wire `800.model` to [4,0] |
| `filenamePrefix` | `809.filename_prefix` | fuobe | output node **809** (video) |

Window plan for the part (Fuobe's own reimplementation of `planning.plan_windows`, 124/18): 5 s = 120 frames, 1 window; 7.5 s = 180 frames, 2 windows; 10 s = 240 frames, 2 windows; 12.5 s and 15 s (360 frames) = 3 windows. `PrepareVideo` pads to the H3 grid (`window_length`: 120 → 124, 360 → 362) and the output is trimmed back. The pack accepts up to 3,592 frames (149.67 s) per prompt; frames beyond 362 print "Long clip: beyond H3's documented ~5–15s trained range".

## 4. Akatz Labs' H3 Character Swap tool

Repository [akatz-labs/h3-character-swap-tool](https://github.com/akatz-labs/h3-character-swap-tool); 24 commits, first public source 2026-10-15. App and Akatz App Kit **MIT** (Akatz Labs 2026); the node code **GPL-3.0** (`worker_nodes/h3_character_swap/LICENSE`, with `LICENSE-Apache-2.0` for a modified NVIDIA INT8 Triton kernel) at `0670e4f`; at the latest commit the GPL code is the vendored H3 Relay archive instead (README "License", `THIRD_PARTY_NOTICES.md`).

### 4.1 Two generations of the tool

| | `0670e4f` (2026-10-16, Openjutsu's pin) | `5f83374` (2026-10-17, latest) |
|---|---|---|
| Generation code | `worker_nodes/h3_character_swap` (25 registered classes) | H3 Relay 2.0 (`vendor/h3-relay-8c313cc6bd23.tar.gz`, pinned in `runtime/relay-lock.json` to `akatz-ai/h3-relay@8c313cc6bd23298be3b475d95a3af4cde6e7f10b`) |
| ComfyUI workflow | `workflows/H3 Character Swap.json` (canvas, 36 nodes incl. 6 notes) / `.api.json` (30 nodes, custom controller loop) | same file names: 43 executable nodes + 5 notes, native `StartLoop`/`EndLoop`; the API file is byte-identical in content to H3 Relay's `example_workflows/toolkit/H3-Character-Swap.api.json` |
| App render template | `templates/render.json` (19 nodes; a reviewed NPZ mask via `H3CharacterSwapLoadMask` instead of SAM) | built from H3 Relay's `h3_relay/workflows.py` |
| Default swap LoRA | V1 in the workflow; V1.5 for new shots in the app | V1.5 |
| Qualified ComfyUI | `79be670e2d9be63e238785af307369d2b9039ed1`, Python 3.12, PyTorch 2.11.0 + CUDA 12.8, comfy-kitchen 0.2.35, frontend 1.53.6 | same (`workflows/README.md`) |

Both are ancestors of this machine's ComfyUI (`git merge-base --is-ancestor` on `/home/user/ComfyUI`), as is Openjutsu's `98cc0bf8` (v0.41.0).

### 4.2 Every mode and option of the app

From `h3workbench/app.py`, `pipeline.py`, `media.py`, `segments.py`, `anchors.py`, `masks.py`, `render_models.py`, `refinement.py`, `refine_jobs.py` and `static/*.js` at `5f83374` (the `0670e4f` app is the same feature set without the Relay migration). Job kinds: `cuts`, `transcribe`, `anchor`, `mask`, `mask_edit`, `render`, `segment_assemble`, `assemble`, `prompts`, plus the refinement kinds `refine_plate`, `refine_extract`, `refine_mask`, `refine_face`, `refine_compose`, `backplate_anchor`, `backplate` (`pipeline.py` L7–18, `refinement.py` L22–30).

| Area | What it offers | Defaults and limits |
|---|---|---|
| Batches and import | Batches with rename; import videos (`.mp4 .mov .mkv .webm .avi`) by upload or from a server folder | every clip normalized to 24 fps (FFV1 master + H.264 preview); "Trim this clip to 149.66 seconds or less" (`media.py` `normalize`) |
| Shots | **Detect edits** (ffmpeg `select='gt(scene,0.32)'`), edit cut frames, per shot **Replace character** (`generate`) or **Keep original** (`preserve`); layout history | — |
| Transcription | Install Whisper as a resource, **Transcribe clip**; words feed each shot's or segment's dialogue | — |
| Character | One reference image and a written **character description** per clip | changing the reference un-approves anchors |
| Performance prompt | **Build shot prompts**: built from the description, dialogue and a **speaker** choice — the selected character speaks / another person speaks / offscreen voice / no dialogue; editable per shot and per segment ("Exact prompt for this segment") | `media.prompt`, `segments.build_prompt` |
| Scene anchor | **Shot anchor · optional**: import an image, or **Generate anchor** with the local Codex image tool (`codex exec`, image-only brief); anchor variants, approval, extra **anchor instructions** and a **custom anchor base prompt** (≤ 20,000 chars) | providers `manual` (import), `codex-local` (`anchors.py`) |
| Who to swap | SAM text (`mask_text`, default "person"), **largest / leftmost / rightmost / index** (`subject_index` 0–100) | `SelectSubject` |
| Masks | **Track masks**, per-frame recovery of empty frames, **point corrections** (include/exclude points; **Update frame** or **Track shot**), mask versions, mask playback, approval; empty frames block rendering | expansion 0–256 px, default 64 |
| Generation | LoRA **V1.5** (default for new shots) / **V1** / **none**; anchor on/off; masked generation on/off; render size **0.1–1.0 MP** (0.5 = "480", 1.0 = "768"); seed (randomize); **Diffusion window** 22…362 and **Continuation history** 0, 1, 18, 35…341; **Retry with model offloading** after a measured GPU OOM | seed 194729 for new shots; 124/18 |
| Segments | Each shot holds editable **generation segments**: 5-, 10- or 15-second segments, split at the playhead, move a boundary, merge; preview a layout; per segment: dialogue, speaker, performance prompt, seed, **Starts fresh / Continues previous segment** with a chosen history, and an anchor mode **Scene anchor / segment reference (Additional reference) / No anchor**; **Queue segment**, **Queue all segments**, **Queue from here**; a failed predecessor stops dependants; 16-bit FFV1 **continuation masters** survive restarts | "A segment must fit one diffusion pass (at most 362 frames, including its continuation boundary)" (`segments.py` L46–96) |
| Takes and review | Several takes per shot or segment, favourites (browser), **Use this take**, side-by-side **comparisons**, clip review decisions keep / maybe / skip with notes, **Export decisions** | — |
| Assembly | **segment_assemble** (a shot from its segment takes) and **assemble** (the clip with every generated shot's selected take and the original audio) | every generated shot needs a selected take |
| Finish ("refine") | Clean **backplate** (person removal with `H3RelayPersonRemover` and the LoRA `h3-removal-continuation/B-step2000.safetensors`, 12 steps, strength 2.0, seed 904234, 22-frame windows, from a clean first frame made by Codex or imported), **alpha extraction** of the source and character foregrounds (`templates/alpha.json`, ≤ 145 frames), mask corrections, **face protection** (`H3WorkbenchTrackFace` keyframes), **compose** | **Not runnable from the public release**: `templates/alpha.json` is not in the repository, the removal-continuation LoRA is not published, and the UI says "This clip has a legacy refined selection. Raw assembly migration is pending." (`app.js` L919–921) |
| Workers | Local or SSH GPU workers, a shared executor with auto placement, release idle worker, pause/resume the queue, cancel or stop jobs | the app is "intended for a trusted local machine or private network" |

**No "performance transfer" or outfit-only mode.** The swap itself keeps the source performance; there is no separate motion-transfer, face-only or outfit mode in the public tool. Automatic face tracking needs a registered `H3PerformanceFacePrepare` provider (`worker_nodes/h3_workbench_masks/tracking_provider.py`) from **H3 Performance**, a private Akatz codebase that the pack's provenance names (`h3-performance/core/video_prep.py`, `h3-performance/staging.py`) and that is not public (`git ls-remote https://github.com/akatz-ai/h3-performance.git` asks for credentials). Manual face regions use OpenCV optical flow and work without it.

**Longer clips.** Two ways: the pack's controller plans source-aligned windows for a whole shot (up to 3,592 frames) in one prompt; the app's segments run one diffusion pass each and continue from the previous take's lossless master (`H3RelaySaveHistory` / `H3RelayLoadHistory` at the latest commit).

### 4.3 Node classes

**`worker_nodes/h3_character_swap` at `0670e4f` registers 25 classes** (`__init__.py`): `H3CharacterSwapPrepareVideo`, `SelectSubject`, `ExpandMask`, `RecoverMasks`, `OptionalAnchor`, `Shot`, `Trim`, `MaskedRegeneration`, `Reference` (a subclass of core `MiniMaxH3ReferenceToVideo` that unloads models between stages), `Workspace`, `LoadMask`, `SaveMask`, `RefineMask`, and, from `relay/`, `WindowInputs`, `Models`, `Settings`, `WindowPlan`, `History`, `BodyWindow`, `Checkpoint`, `Restore`, `Append`, `Run`, `Controller`, `Assemble` (all prefixed `H3CharacterSwap`). The controller expands at run time into `Run` → `BodyWindow` → `WindowInputs`, `Reference`, `History`, `MaskedRegeneration`, core `MiniMaxH3AddGuide`, `Workspace`, `RandomNoise`, `CFGGuider`, `KSamplerSelect`, `BasicScheduler`, `SamplerCustomAdvanced`, `LTXVSeparateAVLatent`, `VAEDecode`, `Trim` (`relay/passes.py`, `relay/runner.py`). Outputs go to `output/H3-Character-Swap/` with a JSON timeline report; `Assemble` encodes with an `ffmpeg` subprocess (libx264 CRF 16, AAC 192k).

**Classes the registration leaves out:** `relay/inputs.Shot` (called directly by `H3CharacterSwapShot`); `video.py`'s own mapping `LabsH3PrepareVideo` / `LabsH3TrimOutput` (exposed only as the subclass and the `Trim` alias); the vendored context-loop module's `MiniMaxH3MotionContext`, `MiniMaxH3LoopTrim`, `MiniMaxH3MotionContextSaveLatent`, `MiniMaxH3MotionContextLoadLatent` (its own mapping exports only `MiniMaxH3LoopTrim`, and the pack never imports it; only `sliding_context.apply_sliding_history` is used); and the second package **`worker_nodes/h3_workbench_masks`** (app-only, not copied by Openjutsu): `H3WorkbenchRefineMask`, `H3WorkbenchTrackFace`, `H3WorkbenchGenerationShot`, `…BodyWindow`, `…Run`, `…Controller` (the last four bypass anchor/mask nodes of the older `H3RelayPerformance*` graph). The latest commit adds `worker_nodes/h3_workbench_runtime` (no nodes; session cache hook only).

**Origins.** `SOURCE_PROVENANCE.json` maps each file to its source and SHA-256: `video.py` ← `h3-performance/core/video_prep.py`; `sampling.py` ← `h3-performance/staging.py`; `mask_geometry.py`, `masked_latent.py` ← `h3-performance/core/vendor/…`; `identity.py`, `planning.py`, `relay/*` ← `h3-relay/h3_relay/…` (removal cache, windowed edit, performance inputs/passes/records/runner); `masks.py` ← `h3_saved_masks`; `correction.py`, `session*.py` ← `h3_workbench_masks`; `triton_int8_large.py` ← `h3_1mp_pilots`; `vendor/context_loop/*` ← H3 Relay's vendored ComfyUI-MiniMaxH3-Contex-Loop (GPL-3.0, NikoDemon80 and ethanfel). Pack `README.md`: "a modified GPL-3.0 derivative of H3 Relay and H3 Performance. Changes remove unused face/pose/backplate passes".

**H3 Relay 2.0** (`akatz-ai/h3-relay`, GPL-3.0, "Sendy Software LLC and contributors", pyproject 2.0.0; main `e2a7665b` is 2.0.1, 2026-10-21) registers **69 classes**: the toolkit (`H3RelayPrepareSource`, `WindowPlan`, `WindowInputs`, `ApplyHistory`, `ApplyEditMask`, `AppendWindow`, `FinishWindows`, `ReviewWindows`, `SelectMask`, `ExpandMask`, `RecoverMasks`, `LoadMask`, `SaveMask`, `RefineMask`, `LoadHistory`, `SaveHistory`, `TextMemory`, `SamplingMemory`, plus `LabsH3PrepareVideo`/`LabsH3TrimOutput`), **Person Remover** (`H3RelayGreenMask`, `SourceHistory`, `RemovalWindow`, `RemovalAppend`, `RemovalRestore`, `PersonRemover`), **Windowed Edit · Character Swap** (`H3RelayEditWindow`, `EditHistory`, `EditAppend`, `WindowedEdit`), and the long-form shot pipeline (`H3RelaySequenceStart`, `GenerateShot`, `H3ModelLoader`, `H3HybridModelLoader`, `FastH3VSAModelLoader`, `LTXModelLoader`, `LTXModelAdapter`, `InterpolationModelLoader`, `CacheManager`, `ModelLoRA`, `Attention`, `AcceptedRawLatent`, `EnhanceShot` (LTX 2×), `UltimateEnhanceShot` (needs the external MMH3 Ultimate pack), `InterpolateShot`, `AssembleRaw`, `Assemble`) and 22 `H3RelayInternal*` classes. It registers server routes on import and installs an in-memory compatibility layer for older ComfyUI H3 layouts (`__init__.py`; README "never edits ComfyUI source files"). Its README requires ComfyUI ≥ 0.37.0 and FFmpeg + FFprobe on PATH.

### 4.4 Workflows and what each needs

| Workflow | Where | Nodes | Needs |
|---|---|---|---|
| H3 Character Swap (pack) | `workflows/H3 Character Swap.json` / `.api.json` @ `0670e4f` | 30 (API) | the pack, FFmpeg + FFprobe, the 7 model files (V1 LoRA path) |
| App render template | `templates/render.json` @ `0670e4f` | 19 | the pack; an NPZ person mask in ComfyUI's input folder |
| H3 Character Swap (Relay 2.0) | `workflows/…` @ `5f83374` = `example_workflows/toolkit/H3-Character-Swap.api.json` @ h3-relay | 45 (API) | H3 Relay, FFmpeg + FFprobe, 7 files (V1.5 at `loras/h3-v2-challenge-eval-20261013/v2-1000.safetensors`) |
| H3 Person Removal V1 | `example_workflows/toolkit/H3-Person-Removal.api.json` @ h3-relay | 44 (API) | H3 Relay, the Person Remover V1 LoRA, a **clean first frame** at the same size, 24 fps source with sides divisible by 32; LoRA 1.0, 22-frame windows, 18 history, 12 steps, `er_sde`/`simple`, CFG 1, seed 904234, mask grow 5 px, output silent by default |
| H3 Relay long-form / FastH3 / Ultimate 2× | `example_workflows/*.json` @ h3-relay | — | LTX 2.5, RIFE, MMH3 Ultimate pack, FastH3 VSA checkpoint (not part of the swap) |

### 4.5 Openjutsu's patch (`build/h3_character_swap.patch`, 175 lines, GPL-3.0)

Applied with `git apply -p1` inside the copied pack (`build/model-files.md`):

- **New `ffmpeg_tools.py`**: `ensure_ffmpeg_on_path()` symlinks the `imageio-ffmpeg` binary as `ffmpeg` into a temp dir on PATH when none is installed; `probe_video_stream()` reads width, height, sample aspect ratio and rotation with PyAV in ffprobe's JSON shape. `__init__.py` calls it before importing the nodes.
- **`video.py`**: the `ffprobe` subprocess is replaced by `probe_video_stream()`; `LabsH3PrepareVideo.resolution` choices become the integers `[480, 768]` (default 480) "so the Comfy app proxy can price on it as a numeric tier"; `prepare()` converts back to a string.
- `requirements.txt` and `pyproject.toml` add `imageio-ffmpeg`; `SOURCE_PROVENANCE.json` gains a `comfyDeploymentPatch` record (2026-10-16, upstream commit, per-file SHA-256s).

**Does the unpatched pack work on a normal ComfyUI with FFmpeg?** Yes by design — Akatz qualified it that way (`workflows/README.md`: "FFmpeg and FFprobe must be available on PATH"; `workflows/VALIDATION.md`: the API graph ran SAM detection, tracking, recovery, expansion and generation on the pinned runtime). It needs **both** `ffmpeg` and `ffprobe` (PrepareVideo uses ffprobe and ffmpeg with `ffv1` / `pcm_s16le`; Assemble uses libx264/AAC). This machine has `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` 6.1.1. The only incompatibility with Openjutsu's graph is the resolution type: unpatched, send `"480"`/`"768"`. The pack applies its INT8 64-bit-offset kernel fix only when comfy-kitchen is exactly 0.2.35 (`__init__.py` L55–62); this machine has 0.2.37.

## 5. GPU and memory

| File set | Bytes |
|---|---|
| Swap graph (diffusion + text encoder + 2 VAEs + SAM + Turbo + V1.5) | **46,327,436,111** (46.33 GB, 43.15 GiB) |
| Person Removal (same minus Turbo and swap LoRA, plus Remover V1) | 44,371,242,903 |

- **Tested hardware.** Openjutsu: only a 96 GB RTX PRO 6000. Akatz: a 24 GB RTX 4090 with 128 GB RAM — full residency ran out of memory while applying the LoRAs ("22.05 GiB allocated, 18.5 MiB free"), and normal ComfyUI model offloading completed the same settings (`workflows/VALIDATION.md` @ `0670e4f`); Akatz recommends `--reserve-vram 0 --disable-dynamic-vram --enable-triton-backend --cache-classic` (+ `--highvram` only for full residency). `activation_memory_gib` 17 is "Estimated sampling workspace … not a VRAM limit".
- **INT8 ConvRot diffusion model (20.97 GB).** ComfyUI runs `int8_tensorwise`/`convrot` matmuls everywhere except MPS, Intel XPU, DirectML and ixuca (`supports_int8_compute`, `comfy/model_management.py` L2082–2098), so any recent NVIDIA (and AMD) GPU uses it natively; `comfy kitchen attention` (INT8 attention) is offered only when comfy-kitchen's CUDA backend is available.
- **NVFP4 text encoder (15.69 GB).** Native NVFP4 matmul needs NVIDIA compute capability **10 or higher** (`supports_nvfp4_compute`, `model_management.py` L2044–2052: Blackwell — B200, RTX 50-series, RTX PRO 6000). On older GPUs ComfyUI marks the format disabled and runs those layers at full precision (`get_disabled_quant_formats` → `_full_precision_mm = True`, `comfy/ops.py` L1247–1248, L1819–1832): it still loads and runs, slower. Alternatives in the same repository: `qwen3vl_32b_minimax_h3_int8_convrot` (27,141,342,152 B) or bf16 (51,506,295,256 B).
- **Fuobe guidance:** open engine needs ≥ 24 GB VRAM with offloading and ~64–128 GB system RAM (inferred from Akatz's host); recommend 48 GB+ for 768p; Blackwell for the NVFP4 encoder at full speed.

## 6. Model files

| File | Folder | Bytes | SHA-256 | Repository @ revision (Openjutsu's pin) | Licence |
|---|---|---|---|---|---|
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `diffusion_models` | 20,970,379,616 | `9255f52b…5779` | Comfy-Org/MiniMax-H3 @ `1c41cfca8ebba91d0af792a05c5761fb2c3a7975` (Akatz: `e5eb578a…`, same bytes) | MiniMax H3 Community License |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `text_encoders` | 15,687,142,551 | `35a88d51…f2c6` | same | MiniMax H3 Community (H3 packaging); base Qwen3-VL-32B Apache-2.0 per the licence's "Additional Note" |
| `minimax_h3_video_vae_fp16.safetensors` | `vae` | 5,207,808,496 | `7c1f1314…e522` | same | MiniMax H3 Community |
| `minimax_h3_audio_vae_fp32.safetensors` | `vae` | 605,254,808 | `8e505d95…db48` | same | MiniMax H3 Community |
| `sam3.1_multiplex_fp16.safetensors` | `checkpoints` | 1,745,546,848 | `9ba99c92…eb03` | Comfy-Org/sam3.1 @ `7bb8374780a725b4353ed31f3a9395c9742b5621` | SAM License |
| `h3_character_swap_v1.5.safetensors` | `loras` | 155,110,792 | `8f2c3c3e…218f` | akatz-ai/MiniMax-H3-Character-Swap-LoRA @ `d06323b7c8e70e97cdab48b78a1e05f786c8cba9` (Akatz: `0f409f0c…`) | MiniMax H3 Community (repo `LICENSE` byte-identical to MiniMax's, SHA-256 `59b99642…`) |
| `minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` | `loras` | 1,956,193,000 | `08cfe946…9980` | lightx2v/Minimax-h3-Turbo @ `3ec17a324ced54151364f24f8b5fb6bf7e26414f` | Apache-2.0 (model card at that revision) |
| _Alternatives_ | | | | | |
| `h3_character_swap_pro4500_1000.safetensors` (V1) | `loras` | 155,110,320 | `4b2a3f42…4e79` | akatz-ai/…-LoRA @ `a665bb7e…` | MiniMax H3 Community |
| `H3-Person-Remover-V1.safetensors` | `loras` | 155,110,584 | `b01dc9fe…93ba5` | akatz-ai/MiniMax-H3-Person-Remover-LoRA @ `fe136b3dc93aea993b9f194d48ea9859fdc2de14` | MiniMax H3 Community |
| `minimax_h3_ref2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors` | `loras` | 1,956,193,000 | `e56863a7…1e81` | lightx2v/Minimax-h3-Turbo @ main `30f485ed…` (2026-10-20) | not stated at main (see §7) |
| `minimax_h3_character_swap_v1.1_ref2va_fro.safetensors` (another author's swap LoRA, 2026-10-18) | `loras` | 80,673,112 | `ab21167b…b9c3` | Alissonerdx/Minimax-H3-ComfyUI @ `f7910496…` | BFS Character Swap Community License 1.1 |

None of the repositories is gated (`gated: false` on the HF API; facebook/sam3.1 itself is `manual`, the Comfy-Org repack is not). The Character Swap LoRA card: "V1.5 … continued from V1 for 1,000 additional optimizer updates … development checkpoint V2-1000" (`NOTICE`, `versions.json`); recipe "Ref2VA INT8 base, this character adapter at strength 1.0, and the separate `minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` at strength 1.0: 8 steps, CFG 1, `er_sde`, `normal`".

## 7. Licences, as written (for Settings → Models & licences)

Recorded as information; nothing is excluded or kept from being a default because of them.

| Item | Licence | What it says (quoted or close paraphrase) | Source |
|---|---|---|---|
| MiniMax H3 (diffusion, VAEs, packaged encoder), Character Swap LoRA V1/V1.5, Person Remover V1 | **MiniMax H3 Community License Agreement** (release/licence date August 2, 2026; licensor Nanonoble Pte. Ltd.) | Grant "Solely within the Applicable Territory" = worldwide **excluding the European Union, the United Kingdom, the Republic of Korea and the United States of America**; MiniMax invites people in those territories to ask for a licence. Redistribution: give a copy of the Agreement, mark modified files, ship a `NOTICE` with "MiniMax H3 is licensed under the MiniMax H3 Community License Agreement, Copyright © 2026 MiniMax. All Rights Reserved." Encouraged: "Powered by MiniMax H3", an AI-generation identifier, a public post. **Commercial:** written authorization if "your commercial products and services generate more than 20 million US dollars … in yearly revenue"; "You shall prominently display "MiniMax H3" on the user interface of commercial product or service that uses MiniMax H3". Use restrictions: bind recipients/users to terms at least as protective as §V and the AUP; **no using the works or their Outputs to improve any other AI model**; no use outside the territory; providers of generation services to third parties must keep safeguards and a way to report violations. Hong Kong law. AUP Exhibit A (20 items, incl. no impersonation without consent, disclose machine-generated content in public). "MiniMax claims no rights over the Outputs." | [LICENSE @ MiniMaxAI/MiniMax-H3 `42ed227e`](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/42ed227ee7df40d41602854ae760620d6eb651fe/LICENSE) (17,604 B, SHA-256 `59b99642…`) |
| MiniMax commercial licences | Sold by Comfy ("the only official reseller") | **Professional** from **$5,000/month** (~46,250 video-seconds, $0.108/s in bundle, $0.036/s overage, up to 10 users, 1 domain, distilled open-weight versions); **Enterprise** custom; "You need to explicitly acquire a MiniMax H3 commercial license if you want to use MiniMax H3 in the United States, European Union, United Kingdom, or South Korea"; also at platform.minimax.io/h3-license; Comfy Cloud subscriptions "already include commercial rights to what you generate"; not covered: reselling, model marketplaces, API aggregators, inference-as-a-service | [comfy.org/minimax/license](https://comfy.org/minimax/license/) (updated August 2026) |
| SAM 3.1 | **SAM License** (Last Updated November 19, 2025) | "non-exclusive, worldwide, non-transferable and royalty-free limited license … to use, reproduce, distribute, copy, create derivative works of, and make modifications"; give a copy of the Agreement when distributing; acknowledge SAM in publications; comply with trade controls; no ITAR / military, nuclear, espionage, weapons uses; California law | [LICENSE @ Comfy-Org/sam3.1 `7bb83747`](https://huggingface.co/Comfy-Org/sam3.1/blob/7bb8374780a725b4353ed31f3a9395c9742b5621/LICENSE) (7,352 B) |
| FL2V Turbo 8-step LoRA | **Apache-2.0** at the pinned revision | front matter `license: apache-2.0` @ `3ec17a32`; the current card (`30f485ed`, 2026-10-20) drops the tag and says "Model assets are governed by the repository license", and the repository has no LICENSE file | [README @ 3ec17a32](https://huggingface.co/lightx2v/Minimax-h3-Turbo/blob/3ec17a324ced54151364f24f8b5fb6bf7e26414f/README.md) |
| `h3_character_swap` node pack, Openjutsu's patch, H3 Relay | **GPL-3.0** (`GPL-3.0-only` in pyproject); NVIDIA INT8 kernel derivative Apache-2.0 | pack README; patch "modifications under the same licence"; H3 Relay `LICENSE`, `NOTICE.md` (vendored Context Loop and Spectrum GPL-3.0, Hybrid Loader MIT) | Akatz repo @ `0670e4f`, Openjutsu `THIRD_PARTY_NOTICES/` |
| Akatz app, App Kit, workflows | **MIT** (Akatz Labs 2026) | "Third-party components and models retain their own terms" | `LICENSE`, `THIRD_PARTY_NOTICES.md` |
| Openjutsu | **MIT** (Comfy Org 2026) | workflow derived from Akatz's MIT workflow; patch GPL-3.0 | `LICENSE`, README "License" |
| BFS Character Swap LoRA (alternative) | BFS Character Swap Community License 1.1 | commercial use allowed; attribution required above US$1M revenue; "You may not offer the covered weights or their functionality as a hosted API, SaaS product, or other remote inference service" | `LICENSE_CHARACTER_SWAP.md` @ Alissonerdx/Minimax-H3-ComfyUI |
| Hosted routes | Paid API under the provider's and MiniMax's terms | fal, Replicate, MiniMax API, Comfy Router (§8) | provider pages |

For `src/lib/licences.ts` (model-access branch): add a `KNOWN` entry for "MiniMax H3 Community License" with class `regions`, `excludes` "the US, the EU, the UK and South Korea", notice `show "MiniMax H3"` (the §IV.2 display condition) and the `NOTICE` text; a `NODE_PACKS` row `h3_character_swap` (GPL-3.0, `https://github.com/akatz-labs/h3-character-swap-tool/tree/0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b/worker_nodes/h3_character_swap`) and one for `h3-relay` (GPL-3.0); the Turbo LoRA as Apache-2.0 with the "dropped at main" note.

## 8. Hosted routes

**Yes — several, none with SAM masking.**

| Route | Provider / id | What it does | Input fields (exact) | Output | Price |
|---|---|---|---|---|---|
| **H3 + Akatz LoRA** (the Fuobe Original's cloud half) | fal `minimax/h3/reference-to-video/lora` | MiniMax H3 reference-to-video with up to 3 LoRAs | `prompt`* (≤ 50,000; refer to "Image 1", "Video 1", "Audio 1"), `loras`* (1–3 × {`path`: URL or HF `owner/repo`, `weight_name`, `scale` 0–4, default 1}), `reference_image_urls` (≤ 9), `reference_video_urls` (≤ 3, 2–15 s each, ≤ 15 s total), `reference_audio_urls` (≤ 3), ≤ 12 references in all, `duration` integer 5–15 (default 5), `resolution` 480P \| 768P \| 2K \| 4K (default 2K; 2K/4K upscale a 768P result), `aspect_ratio` adaptive \| 21:9 \| 16:9 \| 4:3 \| 1:1 \| 3:4 \| 9:16, `seed`, `prompt_expansion_mode` (disabled/fast/balanced/quality), `enable_safety_checker`, `sync_mode` | `video`, `expanded_prompt` | **$0.0625/s 480p, $0.075/s 768p, $0.1625/s 2K, $0.20/s 4K** |
| H3 Max Recast (MiniMax's own person swap) | fal `minimax/h3-max/recast` | "replaces the main people in a source video with people from reference photos, tracking each person across shots … preserve the original motion, gestures, camera, shot timing, and soundtrack" | `video_url`* (5–30 s, no shot > 15 s), `reference_image_urls`* (1–4, one per new person; left to right by default), `prompt` (≤ 2,000: who becomes whom), `resolution` 768P \| 1080P (default 1080P), `enhance_realism` (default false), `seed`, `enable_safety_checker` | `video`, `seed` | **$0.30/s 768p, $0.45/s 1080p**, references free |
| H3 reference-to-video | fal `minimax/h3/reference-to-video` | same as the LoRA route without `loras` | as above | `video` | $0.05/s 480p, $0.06/s 768p, $0.13/s 2K, $0.16/s 4K; first 5 images free, then $0.08 each |
| H3 Max reference-to-video | fal `minimax/h3-max/reference-to-video` | hosted H3 Max | references + first/middle/end frame | `video` | $0.05 (480p) / $0.08 (768p) / $0.16 (1080p) per s + reference tokens over 4,096 at $0.02/1,000 |
| H3 on Replicate | `minimax/h3` | t2v, first/last frame, references | `prompt`, `first_frame_image`, `last_frame_image`, `reference_image_urls`, `reference_video_urls`, `reference_audio_urls`, `duration` 4–15, `resolution` 768P \| 2K, `ratio` | video | $0.08/s 768P, $0.13/s 2K (model page; schema not read from the API) |
| MiniMax API | `POST https://api.minimax.io/v2/video_generation` (V2 create), models `MiniMax-H3`, `MiniMax-H3-Highspeed`, `MiniMax-H3-Lite`, `MiniMax-H3-Max` | `content[]` items with `role` first_frame / last_frame / reference_image / reference_video / reference_audio; reference clips 2–15 s, ≤ 15 s total | — | task → video URL | H3 768P $0.08/s out + $0.08/s input video; 2K $0.13; Highspeed 768P $0.06; Lite 768P $0.04, 480P $0.025; H3-Max 768P $0.08 out + $0.143/s input video, 480P $0.05 + $0.0553 |
| Comfy Router | `minimax/minimax-h3` (`POST https://api.comfy.org/v2/models/minimax/minimax-h3`, `X-API-Key`) | MiniMax's API through Comfy | `content[]` (roles incl. `reference_video`, `base_video`), `duration` 4–15, `resolution` 2K \| 768P, `ratio`, `seed`, `aigc_watermark`, `callback_url` | `task.content.url` (Comfy re-hosts for 12 h) | not published per model; "You are billed when the provider bills Comfy" (`X-Comfy-Credits-Used` on some models) |
| Comfy Router | `fal/h3-max`, `fal/h3-max-turbo` | listed "Text, Image, Video, Audio" | documented schema has only prompt, duration, resolution 480P/768P, aspect_ratio, seed, `prompt_expansion_mode`* | `video` | not published |

No provider offers "H3 + SAM mask + masked regeneration" as an endpoint; MiniMax's API has no swap task (its "video regeneration" task upscales an H3 768P video to 2K, $0.05/s). Comfy's own route for the exact recipe is a **Developer Platform deployment** of Openjutsu's Build (§9).

Existing Fuobe cloud swap routes stay as partner choices: Kling O3 edit ($0.168/s), P-Video Replace (`prunaai/p-video-replace`, $0.03/s), hosted Wan 2.2 VACE, `fal-ai/wan/v2.2-14b/animate/replace` ($0.04–0.08/s), SCAIL-2 replacement ($0.20/s) (`paid-model-apis-4.md` §4, `fuobe-originals-recipes-5.md` §8).

## 9. Comfy Developer Platform

- **Deployments.** A Build (ComfyUI version, custom nodes, models, Python deps; `comfy-build.yaml`) is released per target (`linux/nvidia`) and deployed with a GPU, region and `--min`/`--max` workers. Active workers bill per second while running; flex workers from start-up through a 30 s idle window; `--min 0` scales to zero with a cold start. Builds are stored free; models staged for a deployment bill as network storage (docs: [serverless overview](https://docs.comfy.org/development/serverless/overview.md)). Openjutsu's README walks `comfy build init … push --release --target linux/nvidia`, then `comfy deploy refs compute`.
- **Prices** ([comfy.org/pricing](https://comfy.org/pricing), read 2026-10-27, "billed by the GPU second"): RTX PRO 6000 96 GB **$3.49/h** (736.39 credits/h), RTX PRO 6000 MIG 48 GB $1.75/h ("about half the speed"), H100 SXM 80 GB $6.23/h, H200 SXM 141 GB $7.71/h, B200 180 GB $11.23/h; network storage **$0.20/GB/month**; "All available models can be used for commercial purposes". Plans: Standard ($20/month, 5 builds, 2 deployments, ≤ 2 workers each), Creator ($35), Pro ($100, 10 builds, 5 deployments, ≤ 10 workers), Team ($700, 40 builds, 20 deployments, ≤ 20 workers). For this Build: storage 46.33 GB ≈ **$9.27/month**; Openjutsu's "about two minutes" for 5 s at 480p on a warm RTX PRO 6000 ≈ **$0.12** of GPU time (cold starts and model loading extra).
- **`@comfyorg/sdk` 0.5.0** (npm, MIT, published 2026-10-10, deps zod, hash-wasm, eventsource-parser): `new Comfy({ apiKey, clientInfo })` reads `COMFY_BASE_URL` (`https://{deployment}.run.comfy.app`, `https://cloud.comfy.org`, or `http://127.0.0.1:8189` for a self-hosted `comfy-api-proxy`) and talks **Comfy API v2**: `assets.fromBytes/fromFile` (blake3 hash → `GET /api/v2/assets/by-hash/{hash}` → `POST /api/v2/assets/from-hash` or a multipart `POST /api/v2/assets`; the handle becomes `{ __type: "core/ASSET", info: { id, hash, file_path } }` in a loader's file widget), `workflows.fromJson(graph)`, `submit`/`run` (`POST /api/v2/jobs`; partner-node key as `extra_data.api_key_comfy_org`), `jobs.get` (`GET /api/v2/jobs/{id}`), events (SSE `/api/v2/jobs/{id}/events`), `cancel`, outputs' `getDownloadUrl()` (`/api/v2/assets/{id}/content` → 302 to a signed URL, ~6 h). Separately, `comfy.models.run(model, input)` posts to **Comfy Router** at `https://api.comfy.org/v2/models/{provider}/{model}` (20-minute default deadline, idempotency keys, binary or JSON results); Openjutsu's `makeAnchor` uses it (`lib/comfy.ts` L98–104).
- **Is a deployment a plain ComfyUI server?** **No, as documented.** The v2 overview lists one contract served at the deployment URL with `Authorization: Bearer <api-key>`; `/prompt`, `/history`, `/ws` are described as "existing APIs" of ComfyUI and the v1 Cloud API, not of deployments ([API v2 overview](https://docs.comfy.org/api-reference/v2/overview.md), [design notes](https://docs.comfy.org/development/api-development/sdks-design.md)). Untested here (no deployment). Fuobe's ComfyUI provider sends `Authorization: Bearer <comfyToken>` (`src/server/providers/comfyui.ts` L100–108) but calls `/prompt`, `/history`, `/view`, `/upload/image` and `/ws`, so it cannot drive a deployment as is. **Option:** a small `comfyapi` provider that speaks v2 (upload → submit → poll → signed URL) — it would also run Fuobe's graphs on Comfy Cloud and on any self-hosted ComfyUI behind `comfy-api-proxy`.

## 10. The anchor first frame

- **Openjutsu:** model `openai/gpt-image-2.5-sunburst` through Comfy Router, body `{ prompt, image: [frame data URL, character data URL], quality: "low", size: "auto", n: 1, moderation: "auto" }`; the image comes back as `b64_json`, a URL or binary (`lib/anchor.ts`). The frame is grabbed in the browser at the part's start (`lib/frame.ts`, canvas → PNG). Prompt:

  > Replace the person in image 1 with the character from image 2, including their face, hair, body and complete outfit exactly as shown in image 2. Do not keep any of the original person's clothing. Keep image 1's pose, framing, background and lighting.

  In the graph the anchor is centre-cropped to the prepared size (`ImageScale … crop center`) and becomes `<Picture 2>` plus the frame-zero guide ("Start from the first frame in <Picture 2>."). **Fallback:** any anchor failure → swap without it (the two nodes are deleted, `use_anchor` false). Router price: not published per model.
- **Akatz:** `anchors.anchor_brief` (MIT) — "Image 1 is the source frame to edit. Image 2 is character identity only: <description>. Replace ONLY <the selected person (largest person)> with that single character. Match the exact source pose, face angle, gaze, mouth opening, expression, limb placement, scale and occlusions. Preserve all other people, the entire original scene, camera framing, lighting and aspect ratio. Keep the reference identity and costume; do not copy the reference pose or background. One full-aspect edited source frame." plus optional per-shot instructions; generated by the local Codex CLI or imported. Akatz's validation: "An anchor improved the opening frame but did not ensure sustained identity."
- **Fuobe equivalents** (both prompts are MIT and may be reused with their notices):
  - **cloud:** `gpt-image-2-5-sunburst` (already in `cloud-models.generated.ts`, edit route `openai/gpt-image-2.5/sunburst/edit`, `quality` low; fal bills tokens: image $8/M input, $30/M output) — the closest to Openjutsu; **Nano Banana Pro** edit (`fal-ai/nano-banana-pro/edit`, $0.15/image) as the second choice; Comfy Router `openai/gpt-image-2.5-sunburst` when a Comfy key is set.
  - **open:** **Qwen-Image-Edit 2511** with two images (the library's `qwen-image-edit-2511-multi`, `src/lib/catalog/models.ts` L175), Apache-2.0.
- **Genjutsu today** (`src/lib/catalog/genjutsu.ts`, `src/server/genjutsu.ts`, `/genjutsu`): four modes (Motion transfer, Object swap, Restyle, Insert), 4–30 s sources, pieces/windows joined with the clip's own sound put back (`joinWithSound`), prices from `MAKER_USD` and the catalog, setup codes. Its people-swap makers are cloud-only (Genjutsu, Kling O3 edit, P-Video Replace, hosted VACE) plus the open `oss-vace-swap` (SAM 3.1 + Wan 2.1 VACE, 81-frame windows). The H3 route is the first open maker that keeps the source audio *as conditioning* and regenerates only the masked person in long windows. The parity studio's makers (`genjutsu-*`) are being replaced in O5; nothing here depends on them.

## 11. Integration plan for Fuobe

### 11.1 What to build (package "O5b · Character swap")

1. **Mode.** Add `character` to `GENJUTSU_MODES`: "Character swap — The person in your clip becomes your character; the performance, the scene and the clip's sound stay." Limits: part **5–15 s** (start/length on the existing range picker, step 0.1), source ≤ 30 s (Genjutsu's), clip ≤ 200 MB (Genjutsu's), one character image (PNG/JPEG/WebP), direction ≤ 500 chars, seed 0…2³²−1 or random, quality **480p / 768p** (Genjutsu's 720p maps to 768p).
2. **Who to swap** (Akatz): Largest (default) / Leftmost / Rightmost / Person #n, with the SAM words ("person", editable) — `104.selection`, `104.index`, `101.text`. **Click it** on the first frame → `SAM3_Detect.positive_coords`/`negative_coords` (core inputs, verified in `/object_info`). Mask grow 0–256 px (64).
3. **First frame** toggle, on by default: cloud GPT Image 2.5 Sunburst (low) → Nano Banana Pro → off; open Qwen-Image-Edit 2511. Prompt = Openjutsu's (or Akatz's brief when a description exists). Shown with its own price line; on failure the plan continues without it and says so ("Couldn't make the first frame — swapping without it").
4. **Character description** (Akatz found generic prompts weak): optional text; a "Describe my character" button fills it with the text model (Claude/Ollama). Prompt = Openjutsu's instruction + description + direction.
5. **Speech** (Akatz's speaker choice): Selected character speaks / Someone else speaks / Offscreen voice / No dialogue; with transcription on (Fuobe's ASR), the part's words go into the prompt as Akatz's builder does ("Current segment dialogue: … Do not repeat earlier dialogue").
6. **Advanced:** LoRA V1.5 / V1 / none; audio guide on/off; masked generation on/off; steps 8, CFG 1; window 124 / history 18.
7. **Longer parts** (Akatz's continuation): open engine — one prompt up to Genjutsu's 30 s (the pack plans 5 windows; Akatz labels > 362 frames "quality unverified"); cloud — 15 s pieces joined with the clip's sound (existing remove-object plumbing).
8. **Cuts:** before running, detect hard cuts in the part (ffmpeg `select='gt(scene,0.32)'`, Akatz's threshold) and warn "Your part has a cut at 7.2 s — the swap breaks at a cut. Split it or move the part." Optionally Akatz's Replace / Keep original per shot.
9. **Remove object → "Remove a person (H3)":** H3 Relay Person Removal V1 with a clean first frame made by the same anchor models ("Remove the selected person … reconstruct the background", Akatz's clean brief).

### 11.2 Open engine (ComfyUI)

| Workflow id (new, hand-built) | Graph | Pack |
|---|---|---|
| `video-character-swap-h3` | Openjutsu's `swap.api.json` with `31.resolution` as `"768"` (string) and output 809; bindings §3.4 | `h3_character_swap` @ `0670e4f`, **unpatched** |
| `video-character-swap-h3-noanchor` | same without `anchor_image`/`anchor_fit` (`803.use_anchor` false) — or a provider hook that drops nodes whose binding is empty | same |
| `video-character-swap-h3-relay` | H3 Relay toolkit `H3-Character-Swap.api.json` (45 nodes, native loops); bindings: `source.file`, `reference.image`, `reference_conditioning.prompt`, `plan.seed`, `prepare.resolution` "480"/"768", `prepare.duration_seconds`, `subject.text`, `select.selection`/`index`, `expand_mask.expansion_px`, `adapter.lora_name`, `save.filename_prefix` | `akatz-ai/h3-relay` @ `e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220` (2.0.1) — or Akatz's pin `8c313cc6…` |
| `video-person-remove-h3-relay` | H3 Relay `H3-Person-Removal.api.json` (44 nodes); bindings video, clean first frame, SAM words, seed, window | same |

- **Pin in `scripts/comfy/install-comfyui.sh`:** H3 Relay fits the `NODES` table (`[h3-relay]="https://github.com/akatz-ai/h3-relay e2a7665b…"`). The pack lives in a subfolder, so add a block: sparse-clone `akatz-labs/h3-character-swap-tool` at `0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b`, copy `worker_nodes/h3_character_swap` to `custom_nodes/h3_character_swap` (Openjutsu's `build/model-files.md` commands). Its requirements (numpy, scipy, Pillow, opencv-python-headless) are already in the union line. Optionally apply Openjutsu's patch when the server has no system FFmpeg — then send integers.
- **Manifest entries** (`workflows/comfyui/manifest.json`): `capability` `video-character-swap` (and `video-person-remove`), the 7 models with URLs at the pinned revisions and sizes from §6, `customNodes` with the pin, `vramGb` 24 (with offloading) and a note, licence text "MiniMax H3 Community License: territory EXCLUDES the US, EU, UK and South Korea; commercial use over US$20M revenue needs MiniMax's authorization; show "MiniMax H3" … · SAM License · Turbo LoRA Apache-2.0 · nodes GPL-3.0" (the manifest's licence convention).
- **ModelDefs** (`src/lib/catalog/models.ts`): `oss-h3-character-swap` (route `comfy("video-character-swap", "video-character-swap-h3")`), `oss-h3-character-swap-relay`, `oss-h3-person-remove`; the Original `fuobe-character-swap` on both engines (open → `oss-h3-character-swap`; cloud → fal H3 LoRA).
- **Provider work** (`src/server/providers/comfyui.ts`): string resolution mapping; optional-node dropping for the anchor and for LoRA "none" (rewire 800.model to [4,0]); `SAM3_Detect` points; prefetch of the swap LoRA through `src/server/loras.ts` (HF pinned URL).

### 11.3 Cloud engine

| Maker | Endpoint | Payload | Price shown before running |
|---|---|---|---|
| **Fuobe Character swap** (Original, hosted open weights + Akatz LoRA) | fal `minimax/h3/reference-to-video/lora` | `prompt` with "Video 1"/"Image 1"/"Image 2" (fal's tag names), `reference_video_urls` [the part, trimmed by ffmpeg, 5–15 s], `reference_image_urls` [character, anchor], `loras` [{`path` "akatz-ai/MiniMax-H3-Character-Swap-LoRA", `weight_name` "h3_character_swap_v1.5.safetensors", `scale` 1}], `duration` ⌈part⌉ (5–15), `resolution` 480P/768P, `aspect_ratio` adaptive, `prompt_expansion_mode` "disabled", `seed` | $0.0625/s × ⌈seconds⌉ at 480p, $0.075/s at 768p (5 s 768p = $0.375; 15 s = $1.125); the clip's own sound muxed back |
| **H3 Max Recast** (partner) | fal `minimax/h3-max/recast` | `video_url` (5–30 s), `reference_image_urls` (1–4; who-to-swap order left to right), `prompt` (≤ 2,000), `resolution` 768P/1080P, `enhance_realism` | $0.30/s 768p, $0.45/s 1080p (10 s 768p = $3.00) |
| Existing | Kling O3 edit, P-Video Replace, hosted Wan VACE, Wan 2.2 Animate replace, SCAIL-2 | unchanged | unchanged |
| Optional | Comfy deployment of the open graph through a v2 `comfyapi` provider | the open workflow + v2 asset refs | RTX PRO 6000 $3.49/h per GPU-second (≈ $0.12 for a warm 5 s 480p part) + $9.27/month storage; shown as an estimate |

Caveat for the fal route: its quality without a mask is unverified — the LoRA was trained for the masked recipe, and fal's H3 runs its own steps. The evaluation harness decides whether it becomes the default.

### 11.4 Copy (examples)

- Mode hint: "Your character takes over the person in the clip — same moves, same scene, same sound. Pick 5–15 seconds of one continuous shot with the person in the first frame."
- Blockers: "Pick a part of 5–15 seconds." · "The part must start on a frame with the person in it." · "Your ComfyUI is missing the H3 Character Swap nodes — run scripts/comfy/install-comfyui.sh (see Settings → Models & licences)."
- Licence line (info): "MiniMax H3 Community License — not licensed in the US, EU, UK or South Korea; commercial use over US$20M revenue needs MiniMax's OK; show "MiniMax H3". Your admin decides in Settings → Models & licences."

### 11.5 What this machine can verify

- **Yes:** unit tests; the static check of the 22 core nodes against `/object_info` (done, §3.3); manifest/bindings shape; prices; the fal payload against the stored OpenAPI.
- **No:** `/prompt` validation of the full graphs (the pack's / H3 Relay's nodes are not installed and must not be installed on this server); any run (46 GB of weights, GPU). Validate on a disposable ComfyUI or the user's GPU box with `node validate-workflows.mjs video-character-swap-h3 …` after installing the pin there.

### 11.6 Tests to write

| Test file | Checks |
|---|---|
| `tests/character-swap.test.ts` | prompt builder (instruction with `<Video 1>`/`<Picture 1>`, anchor sentence only with an anchor, description, direction trimmed and ≤ 500, dialogue line per speaker); part limits (5–15 s, start ≥ 0, clip < 5 s refused, part inside the clip); seed range; quality → `"480"`/`"768"` (unpatched) or 480/768 (patched); window counts 5 s → 1, 10 s → 2, 15 s → 3; cut warning |
| `tests/genjutsu-comfy.test.ts` (extend) | `video-character-swap-h3` bindings: 30.file, 9.image, trim + 31 duration both set, 801 prompt/seed, 104 selection/index, 110 expansion, anchor present → `anchor_image.image`; absent → nodes deleted, `803.use_anchor` false, `803.anchor` removed; LoRA none → 850 removed and 800.model = [4,0]; output node 809 kind video |
| `tests/genjutsu.test.ts` (extend) | `character` mode makers per engine; `chooseMaker` picks the Original; plan steps: anchor (optional) → swap → mux; anchor failure path leaves a plan without the anchor and a note; prices per maker (fal LoRA ceil seconds, Recast per resolution, open free) |
| `tests/cloud-catalog-*.test.ts` | fal `minimax/h3/reference-to-video/lora` and `minimax/h3-max/recast` payloads match the OpenAPI (`loras` path/weight_name, integer duration, enums) |
| `tests/comfy-library-6.test.ts` | manifest entries: models with the §6 sizes and pinned URLs, `customNodes` pins, licence text; `install-comfyui.sh` pins (`0670e4f`, `e2a7665b`) |
| `tests/licences.test.ts` | "MiniMax H3 Community License" → class `regions`, excludes US/EU/UK/South Korea, notice "MiniMax H3"; GPL-3.0 node packs; Turbo LoRA Apache-2.0 |
| `scripts/eval/cases/genjutsu.json` | `genjutsu/character-swap` cases: open `fuobe-character-swap`/`oss-h3-character-swap`, cloud `fuobe-character-swap`, partner `h3-max-recast`, `kling-o3`, `p-video-replace`; metrics identity (face similarity to the character), source-motion agreement, audio = source |

## 12. Risks and unverified points

- **Nothing ran.** No GPU run, no paid call, no `/prompt` validation of the H3 graphs on this machine. Quality is Akatz's own word: "visual quality remains experimental … identity drift"; "A generic “replace the person” prompt performed poorly".
- **Pack churn.** Akatz removed `h3_character_swap` a day after `0670e4f` in favour of H3 Relay; fixes will land in H3 Relay only. Openjutsu pins the old pack.
- **Resolution type.** Openjutsu's graph needs the patched pack (integers); the unpatched pack needs strings. Mixing them fails validation.
- **FFmpeg.** The unpatched pack needs system `ffmpeg` *and* `ffprobe`; `Assemble` also writes its own MP4 into `output/H3-Character-Swap/` (a second encode beside `SaveVideo`).
- **Memory.** 46 GB of weights; 24 GB GPUs need offloading and lots of RAM; NVFP4 runs natively only on compute capability ≥ 10. The INT8 kernel fix is applied only for comfy-kitchen 0.2.35 (this install has 0.2.37; whether 0.2.37 includes the upstream fix, comfy-kitchen PR #172, is unverified).
- **Round-4 note.** `comfyui-oss-4.md` says single-head H3 LoRAs need core PR #17239 (after v0.42); Openjutsu (v0.41.0) and Akatz (`79be670e`) both report the swap LoRA working, so that note does not seem to apply to these files — unverified here.
- **H3 Relay side effects.** It registers HTTP routes and installs an in-memory H3 layout compatibility layer on import; consider the isolated worker (`install-isolated-worker.sh`).
- **Licences (information).** MiniMax H3's territory exclusion (US, EU, UK, South Korea), the US$20M revenue condition, the "display MiniMax H3" condition, the "no Outputs to improve other models" clause (H3 outputs must not train Fuobe's other-base LoRAs in O12), and operator duties (safeguards, reporting) for anyone hosting Fuobe for others. Turbo LoRA's licence tag disappeared at main. The BFS alternative forbids hosted inference.
- **Hosted routes.** fal's H3 LoRA route has no mask and no Turbo/steps control and takes integer durations; Recast is a closed MiniMax model; Comfy Router publishes no per-model prices; a Comfy deployment needs a v2 client.
- **Examples.** Openjutsu's example media on `media.comfy.org` have no stated licence; not for Fuobe.

## Sources (read 2026-10-27)

- Openjutsu: `/home/user/comfy-org/comfy-openjutsu` @ `70ec62df0eda7c58697ea3ac2050588513651583` — https://github.com/Comfy-Org/comfy-openjutsu ; https://comfy.org/hub/apps/openjutsu/ ; https://comfy.org/open-source-{studio}/
- Akatz: https://github.com/akatz-labs/h3-character-swap-tool @ `0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b` and `5f83374bc4f6fbc458f369f5bbe058c4a65816dc` (README, `workflows/`, `worker_nodes/`, `templates/render.json`, `h3workbench/*.py`, `static/*.js`, `docker/resource-catalog.json`, `docker/MODEL_TERMS.md`, `runtime/relay-lock.json`, `runtime/allowed_nodes.json`)
- H3 Relay: `vendor/h3-relay-8c313cc6bd23.tar.gz` (SHA-256 `e61e0a8a582ae4fe9c4bd9c96e406838f84a55b455ea46977bc70f99a9ba7d38`); https://github.com/akatz-ai/h3-relay @ `e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220` (README, UPSTREAMS.md, MODELS.md, `example_workflows/toolkit/*`)
- Hugging Face API: `/api/models/{repo}/tree/{rev}` and `/api/models/{repo}` for Comfy-Org/MiniMax-H3, Comfy-Org/sam3.1, akatz-ai/MiniMax-H3-Character-Swap-LoRA, akatz-ai/MiniMax-H3-Person-Remover-LoRA, lightx2v/Minimax-h3-Turbo, MiniMaxAI/MiniMax-H3, Alissonerdx/Minimax-H3-ComfyUI; model cards, LICENSE and NOTICE files at the revisions above
- Live ComfyUI: `http://127.0.0.1:8188/object_info/<class>`, `/system_stats` (v0.41.0); source `/home/user/ComfyUI` @ `fc04da91` (`execution.py`, `comfy/model_management.py`, `comfy/ops.py`, `comfy_extras/nodes_model_advanced.py`, `nodes_multigpu.py`, `nodes_minimax_h3.py`, `nodes_video.py`)
- fal: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3/reference-to-video/lora (and `minimax/h3-max/recast`, `minimax/h3/reference-to-video`, `minimax/h3-max/reference-to-video`, `minimax/h3-max/insert-video`); https://fal.ai/models/minimax/h3/reference-to-video/lora/llms.txt ; https://fal.ai/models/minimax/h3-max/recast/llms.txt
- Replicate: https://replicate.com/minimax/h3
- MiniMax: https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md ; https://platform.minimax.io/docs/pricing/overview.md
- Comfy: https://comfy.org/platform.md ; https://comfy.org/pricing.md ; https://comfy.org/minimax/license/ ; https://comfy.org/llms.txt ; https://docs.comfy.org/development/comfy-router/models.md ; https://docs.comfy.org/development/comfy-router/models/minimax/minimax-h3/code.md ; …/fal/h3-max/code.md ; …/openai/gpt-image-2-5-sunburst/code.md ; https://docs.comfy.org/development/comfy-router/billing.md ; https://docs.comfy.org/development/serverless/overview.md ; https://docs.comfy.org/api-reference/v2/overview.md ; https://docs.comfy.org/development/api-development/sdks-design.md ; https://platform.comfy.org/llms.txt
- npm: https://registry.npmjs.org/@comfyorg/sdk (0.5.0 tarball, SHA-1 `20afbb1d143b8d4e35cb16b4a695bb8dfb19a341`)
- Fuobe: `src/lib/catalog/genjutsu.ts`, `src/server/genjutsu.ts`, `src/server/providers/comfyui.ts`, `src/lib/catalog/models.ts`, `src/lib/catalog/cloud-models.generated.ts`, `scripts/comfy/install-comfyui.sh`, `workflows/comfyui/manifest.json`, `docs/research/*` (claude/fuobe-parity-4 @ `946f621`); `src/lib/licences.ts` on `r4/model-access`
