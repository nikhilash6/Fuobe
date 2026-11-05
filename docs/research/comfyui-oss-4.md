# Fuobe research #4: open-weight ComfyUI routes for round 4

_As of 2026-10-22. Machine-readable companion: [`comfyui-oss-4.json`](comfyui-oss-4.json). It holds the 14 full API-format graphs, their bindings, outputs, model files with URLs and byte sizes, the validation and CPU-run results, and the new-model survey. This file builds on [`comfyui-oss.md`](comfyui-oss.md), [`comfyui-oss-2.md`](comfyui-oss-2.md) and [`comfyui-oss-3.md`](comfyui-oss-3.md). The gaps it answers are the open-engine items in [`../STATUS.md`](../STATUS.md) §3 and §4: open OCR for Layers, Remove object, Genjutsu on the open engine, Frame by frame pans, music beds over 240 s, FPS boost and pro codecs, and a logo end card._

## How this was produced and what "verified" means

* **Server.** The library's CPU ComfyUI: core `fc04da91` (v0.41.0-7, 2026-10-16), Python 3.13.16, torch 2.14.1+cpu, comfyui-workflow-templates 0.11.86, 4 CPU cores, 14.3 GB RAM. The 14 custom node packs are at the commits `install-comfyui.sh` pins. `ComfyUI-SeedVR2_VideoUpscaler` still fails to import on CPU (known, see `scripts/comfy/README.md`); every other pack imports.
* **No new node packs were needed.** Every route below uses core nodes, plus `GrowMaskWithBlur` from the installed KJNodes and two nodes from the installed VideoHelperSuite. Florence-2, GIMM-VFI and MiniMax-Remover packs were read at their source and rejected (reasons in each section), so nothing was installed and nothing in the shared install changed.
* **Official templates** were exported to API format inside the real ComfyUI frontend (`app.loadGraphData` → `app.graphToPrompt`, the method of `scripts/comfy/export-templates.mjs`, run from a scratch copy): `utility_void_video_inpainting`, `video_wan_vace_inpainting`, `utility_video_frame_interpolation`, `video_wan21_scail2_character_replacement`, `video_wan_animate2`, `llm_qwen3vl_text_gen`, `image_qwen_image_2_1_background_removal`. The new graphs were then written by hand from the live `/object_info`.
* **Validation.** The method is the same as `scripts/comfy/validate-workflows.mjs`:
  * zero-byte placeholder files for missing weights, created under `/home/user/ComfyUI/models/<folder>/`
  * a KJNodes `Sleep` blocker holds the worker
  * `POST /prompt` must return HTTP 200, a `prompt_id` and no `node_errors`
  * the prompt is deleted from the queue at once; only this run's prompt ids were touched
  * every placeholder was deleted afterwards
* **Negative tests.** `video-inpaint-wan-vace` with a missing `unet_name` was rejected (`value_not_in_list`). `video-erase-void` with an `IMAGE` linked into `quadmask` was rejected (`return_type_mismatch`).
* **Real CPU runs.** Eight of the 14 graphs need no weights and ran for real; every output was checked with ffprobe, ffmpeg or numpy. The OCR graph also ran for real, with two small downloaded checkpoints (OvisOCR3 1.71 GB, Qwen3.5-0.8B 1.75 GB). The existing `interpolate-rife` and `interpolate-film` graphs ran with their real weights (22.7 MB and 68.9 MB). All downloaded weights and test outputs were deleted afterwards.
* **Not proven.** Nothing that needs a GPU-sized model ran: VACE, VOID and the other model outputs are checked by `/prompt` validation only. Anything inferred is marked _(inferred)_.

**Result: 14 new graphs, all accepted by `/prompt`; 9 ran for real on CPU (the 8 model-free graphs and the OCR graph). No new packs and no new weights are needed for the default video routes: they reuse the library's Wan 2.1 VACE 14B, SAM 3.1, umT5 and lightx2v files. The only new default download is OvisOCR3, 1.71 GB.**

## Summary: recommendation per capability

| Need (STATUS gap) | Workflow id (new) | Model | Licence | VRAM | New download | `/prompt` | Ran on CPU |
|---|---|---|---|---|---|---|---|
| a. Layers text detection (lines + boxes) | `ocr-lines-qwen35` | **OvisOCR3** 0.8B (or Qwen3.5 0.8B / 2B / 4B) via core `TextGenerate` | Apache-2.0 | ~3 GB _(inferred)_ | 1.71 GB | yes | **yes, 3 runs** |
| b. Remove object (named) | `video-inpaint-wan-vace` | **Wan 2.1 VACE 14B** + lightx2v 4-step, SAM 3.1 tracking | Apache-2.0 (+ SAM License) | 24 GB | 0 | yes | no |
| b. Remove object (painted on frame 1) | `video-inpaint-wan-vace-painted` | same | same | 24 GB | 0 | yes | no |
| b. Remove object + its shadows / effects | `video-erase-void` | Netflix **VOID** (2 passes) | Apache-2.0 on a CogVideoX-5B base (CogVideoX License) | unverified, 24–40 GB | 32.5 GB | yes | no |
| c. Object / character swap | `video-swap-wan-vace` | Wan 2.1 VACE 14B with a reference image | Apache-2.0 | 24 GB | 0 | yes | no |
| c. Insert into a region | `video-insert-wan-vace` | same | Apache-2.0 | 24 GB | 0 | yes | no |
| d. Ken Burns / Frame by frame | `kenburns-still` | none (core loops) | n/a | 0 | 0 | yes | **yes** |
| e. Music bed > 240 s | `audio-loop-crossfade` | none (core audio + loop) | n/a | 0 | 0 | yes | **yes** |
| e. Join clips' audio | `audio-join-crossfade` | none | n/a | 0 | 0 | yes | **yes** |
| f. ProRes / H.265 10-bit / FFV1 export | `video-export-pro` | none (VHS) | n/a | 0 | 0 | yes | **yes** |
| f. SDR → HDR | `video-sdr-to-hdr` | none (core `ImageSDRToHDR`) | n/a | 0 | 0 | yes | **yes** |
| f. EXR frames | `video-export-exr` | none (core) | n/a | 0 | 0 | yes | **yes** |
| f. FPS boost | existing `interpolate-rife` (default), `interpolate-film` | RIFE 4.26 / FILM | MIT / Apache-2.0 | 2–4 GB | 0 (library) | yes (library) | **yes** |
| g. Still → N-second clip | `still-to-clip` | none (core) | n/a | 0 | 0 | yes | **yes** |
| g. Ad + logo end card, keeping the ad's sound | `video-append-endcard` | none (core, picture stream-copied) | n/a | 0 | 0 | yes | **yes** (see the limit) |

The only new default weight is OvisOCR3 (1.71 GB). Optional extras:

| Option | Size |
|---|---|
| VOID | 2 × 11.14 GB passes, 9.79 GB T5-XXL, 0.43 GB VAE, 0.02 GB RAFT |
| Wan 2.1 VACE 1.3B (8 GB cards) | 4.31 GB |
| Qwen3.5 2B instead of OvisOCR3 | 4.55 GB |

---

## a. Text detection for Layers: `ocr-lines-qwen35`

The parity studio's Layers "Edit text" first finds the text lines, then lets the user retype them. Fuobe's open engine had no OCR, so the user typed the lines. The route must return lines and boxes as JSON text.

**Candidates compared**

| Candidate | Licence | Size | ComfyUI path | Output | Verdict |
|---|---|---|---|---|---|
| **OvisOCR3** (ATH-MaaS, 2026-10-21) | Apache-2.0 | 0.8B, 1.71 GB | **core** `CLIPLoader` + `TextGenerate` (it is a Qwen3.5-0.8B fine-tune; core detects it by its `model.language_model.*` keys) | JSON `[{"bbox":[0-1000],"text"}]`, no fences | **Pick.** OCR-specialised; ran here |
| Qwen3.5 0.8B / 2B / 4B (2026-03) | Apache-2.0 | 1.75 / 4.55 / 9.32 GB | core `TextGenerate` (4B is already in the library for `translate-qwen35-textgen`) | JSON in ```json fences; `bbox_2d`/`text_content` keys | Fallback, same graph (`checkpoint`); 0.8B ran here |
| Qwen3-VL 4B / 8B | Apache-2.0 | 5.24 GB fp8 / 10.6 GB fp8 | core (template `llm_qwen3vl_text_gen`, 2026-06-23) | grounding JSON | Not needed; larger than the Qwen3.5 checkpoints |
| Florence-2 base / large (`OCR_WITH_REGION`) | MIT | 0.23B 0.46 GB / 0.77B 1.55 GB | **custom pack** kijai/ComfyUI-Florence2 `9ece3de9` (2026-05-06), deps `tokenizers matplotlib pillow>=10.2.0` | `data: [{label, box:[8 quad coords normalised 0-1]}]` (read from `nodes.py` at that commit) | Rejected: needs a pack, weaker on stylised text _(inferred)_; its RMBG copy (`AILab_Florence2`) has no OCR task |
| PaddleOCR-VL (0.9B) | Apache-2.0 | 1.92 GB | custom packs only (unverified) | document parsing | Rejected: document-oriented; OCRBench 55.9 for v1.6 (OvisOCR3's table, vendor numbers) |
| DeepSeek-OCR (3B) | MIT | 6.67 GB | custom packs only (unverified) | grounding boxes | Rejected: 4× larger, needs a pack |
| GOT-OCR 2.0 | Apache-2.0 | ~1.4 GB _(unverified)_ | custom packs | region OCR, no line detection | Rejected |

**Graph (core only)**

```
LoadImage → ImageScaleToMaxDimension(maxSize 1280) ─┬→ TextGenerate(clip = CLIPLoader(ovisocr3_0.8b_bf16), image, instruction,
                                                    │                sampling off (greedy), max_length 2048) → SaveText(.json)
                                                    └→ GetImageSize → StringFormat → PreviewAny  ("size the model saw")
```

* **Instruction.** OvisOCR3's own `prompts/word_spotting.txt`, changed from word level to line level, asking for strict JSON with integer boxes scaled to [0, 1000).
* **For word boxes,** bind `instruction` to the original word-spotting prompt.
* **Bindings:** `image`, `maxSize`, `checkpoint`, `instruction`, `maxTokens`.
* **Outputs:**
  * node 5 `text` (role `lines`): the JSON file
  * node 8 `text` (role `frame`): the scaled size

**Real CPU runs (4 cores, no GPU)**

| Checkpoint | Image | Time | Result |
|---|---|---|---|
| Qwen3.5-0.8B | 1024×768 poster, 5 lines, scaled to 1280 | 395.8 s | 5/5 lines, text exact, mean IoU 0.817 against the rendered boxes; wrapped in ```json fences, keys `bbox_2d`/`text_content` |
| OvisOCR3 | same poster at 1024 | 193.8 s | 5/5 lines, text exact, mean IoU 0.822; bare JSON |
| OvisOCR3 | 1024×1024 busy colour-bar background, outlined text, a sticker rotated 12° | 160.9 s | 5/5 lines incl. the rotated "SAVE 30%" (IoU 0.76–0.92 on the straight lines); skipped a tiny `00:00:00.000` timecode |
| Qwen3.5-0.8B | same busy poster, same line-level instruction | 645.3 s (server shared with other jobs) | 4/5: "Limited stock" split into two items with wrong boxes; IoU 0.58–0.91; found the timecode; ignored the requested keys and added fences |

The second poster is why OvisOCR3 is the default and the general Qwen3.5 checkpoints are only fallbacks.

* **Coordinates are relative 0–1000.** This was checked against the ground truth: (60, 81) px in a 1024×768 image came back as (62, 96). The app scales the boxes by the image size.
* **What the app must do:**
  * strip ``` fences
  * accept both `bbox`/`text` and `bbox_2d`/`text_content`
  * map each box to a Layers text item, then run the existing edit path (Qwen-Image-Edit 2511 text template)

**Risks**

* OvisOCR3 is one day old. Its benchmark claims are vendor numbers: OCRBench 88.8 vs 79.1 for Qwen3.5-0.8B, and OCRBench v2 EN 65.9 vs 41.5. It was tested here on two synthetic posters only.
* CPU time is minutes; on a GPU it is expected in seconds _(inferred)_.
* ComfyUI v0.42 (#17121, 2026-10-17) changes the empty think block to exactly Qwen3.5's template (`<think>\n\n</think>\n\n`). v0.41's `<think>\n</think>\n` worked here.

---

## b. Video object removal

**Candidates compared**

| Candidate | Licence | Weights | ComfyUI | Notes | Verdict |
|---|---|---|---|---|---|
| **Wan 2.1 VACE 14B** inpainting | Apache-2.0 | 34.7 GB fp16 (cast to fp8), already in the library | core `WanVaceToVideo` (`control_masks`); official template `video_wan_vace_inpainting` ("object removal or replacement") | general masked video-to-video; the prompt describes the clean scene | **Default** |
| Wan 2.2 Fun VACE (library) | Apache-2.0 | 2 × 17 GB, in the library | core | used for extend / reframe / restyle; masks work the same way | Alternative; the official removal template uses 2.1 VACE |
| Wan 2.1 VACE 1.3B | Apache-2.0 | 4.31 GB | core | 8 GB cards; no 4-step LoRA for it | Low-VRAM option (`checkpoint`) |
| **Netflix VOID** (2026-04, ECCV 2026) | weights Apache-2.0, base CogVideoX-Fun-V1.5-5b-InP (CogVideoX License: commercial use after registration, ≤1M monthly visits) | 2 × 11.14 GB + T5 9.79 GB | **core** nodes `VOIDInpaintConditioning`, `VOIDWarpedNoise`, `VOIDSampler`; template `utility_void_video_inpainting` (2026-05-14) | removes the object **and what it causes** (shadows, reflections, objects it holds falling); 384×672, up to 197 frames; reference code needs 40 GB+ | Premium option, licence caveat |
| MiniMax-Remover (1.3B) | **CC-BY-NC-4.0** (zibojia/minimax-remover) | 2.25 GB (Kijai repack) | installed WanVideoWrapper `WanVideoMiniMaxRemoverEmbeds` | 6–12 steps, no CFG | Rejected: non-commercial |
| DiffuEraser | weights Apache-2.0, but it relies on ProPainter priors (S-Lab licence, non-commercial, _unverified here_) and SD 1.5 | — | custom packs | | Rejected |
| MiniMax H3 Person-Remover LoRA (2026-10-08) | MiniMax H3 Community | 0.16 GB LoRA on a 40–66 GB base | core + #17239 (after v0.42) | persons only | Too heavy |

**Pick: `video-inpaint-wan-vace`** (and `-painted`).

```
LoadVideo → GetVideoComponents → ImageFromBatch(startFrame, frames ≤81, 4n+1) → ImageScale(832×480)
mask: CheckpointLoaderSimple(sam3.1) + CLIPTextEncode(maskPrompt) → SAM3_VideoTrack → SAM3_TrackToMask → GrowMask(maskGrow 16)
      [-painted: LoadImageMask(first-frame mask) → SAM3_VideoTrack(initial_mask) instead]
control = ImageCompositeMasked(frames, black, mask)        (masked area blanked, as the official template)
WanVaceToVideo(control_video, control_masks = mask)  → UNET wan2.1_vace_14B (fp8_e4m3fn_fast) + lightx2v T2V 4-step LoRA
  → ModelSamplingSD3(5) → KSampler(4 steps, cfg 1, euler) → TrimVideoLatent → VAEDecode
paste-back: result scaled to the source size, ImageCompositeMasked into the ORIGINAL frames through GrowMaskWithBlur(6 px)
CreateVideo(source fps, the window's sound via TrimAudioDuration) → SaveVideo
```

* **Masks.** `maskPrompt` names what to remove. `SAM3_VideoTrack` follows it through the window; this is more stable than the template's per-frame `SAM3_Detect` _(inferred)_. `-painted` takes a PNG painted on the first frame (alpha = selected) and tracks it with `initial_mask`.
* **Only the masked area changes.** Everything outside the soft mask stays the source's own pixels at full resolution, not a 832×480 re-render.
* **Speed LoRA.** The official template uses the CausVid LoRA, which is **CC-BY-NC-4.0** (`tianweiy/CausVid`). It was replaced by the Apache-2.0 `lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64` (630.7 MB, already a library `KNOWN_MODELS` entry): 4 steps, cfg 1. _(inferred: lightx2v T2V + VACE 14B pairing, not GPU-tested.)_ `loraStrength 0, steps 20, cfg 6` is the slow full-quality path.
* **Licence flag on the existing library.** The library's `wan21-vace-14b-ref2v` also carries the CausVid LoRA from its template. Its notes do not say it is non-commercial.
* **Long clips.** These graphs process one window of ≤81 frames (`startFrame`). The provider runs windows and joins them with the existing concat graphs. Seams between windows are untested _(inferred)_.
* **Bindings:** `video`, `startFrame`, `frames`, `width`, `height`, `maskPrompt` | `mask`, `maskGrow`, `prompt` (the clean scene), `negativePrompt`, `checkpoint`, `loraStrength`, `shift`, `seed`, `steps`, `cfg`.

**`video-erase-void`** is the official VOID template, flattened, with these changes:

* `SAM3_VideoTrack` replaces per-frame detection.
* A `skipPass2` switch is added (pass 1 "is sufficient for most videos" per Netflix's card).
* The binary SAM mask goes straight into `VOIDInpaintConditioning` (1 = remove), as the template does. `VOIDQuadmaskPreprocess` is only for VOID's own 4-level quadmasks (0 remove / 63 overlap / 127 affected / 255 keep).
* `frames` is rounded down by the node so the latent length is even (45, 53 … 197).

---

## c. Swap, insert and the Genjutsu equivalents

* **`video-swap-wan-vace`**: the removal graph plus `LoadImage(reference)` → `WanVaceToVideo.reference_image`.
  * The reference becomes one extra latent frame, which `TrimVideoLatent` drops.
  * `maskPrompt` = what to replace; `image` = the new object, product or character (best cut out on white with `bg-remove-birefnet`); `prompt` describes the result.
* **`video-insert-wan-vace`**: a painted region held for every frame (`RepeatImageBatch` of the mask) with a reference image. It suits a static or slow camera. Without SAM, `WanVaceToVideo` would pad a one-frame mask with 1 = generate for the other frames, which would regenerate the whole clip. The repeat prevents that.

| Genjutsu mode | Open workflow id | Status |
|---|---|---|
| Motion Transfer | `wan-animate2` (Wan Animate 2, template `video_wan_animate2` 2026-08-07, Apache-2.0) | exists, validated |
| Object Swap | **`video-swap-wan-vace`** (new) | validated |
| Character swap (whole person) | SCAIL-2 Character Replacement (template `video_wan21_scail2_character_replacement` 2026-06-15, MIT, `WanSCAILToVideo replacement_mode`, two 81-frame segments, `wan2.1_14B_SCAIL_2_fp16` + DPO LoRA) | template exported, **not built** (94 nodes); recommended next |
| Restyle | `video-restyle-wan22-fun-vace` (first frame restyled by `qwen-image-edit-2511`, then Fun VACE with depth) | exists, validated |
| Remove / insert (Edit video) | **`video-inpaint-wan-vace`**, **`video-insert-wan-vace`**, `video-erase-void` | new, validated |

---

## d. Ken Burns over a still: `kenburns-still`

**What exists.** No installed node varies a crop per frame from parameters:

* VHS has no zoom or pan.
* KJNodes' `ImageTransformByNormalizedAmplitude` needs an audio amplitude input.
* KJNodes' `ImageTransformKJ` crops one region per entry of a `bboxes` JSON and returns a **list** (`is_output_list`). It could take one box per frame, but the provider would compute every box, and all frames are held at once.
* Core `GLSLShader` (EGL/ANGLE) gets the same uniforms for every batch item, so it cannot vary per frame without a loop.

**Design.** The route uses the new **core loop nodes** `StartLoop`/`EndLoop` (ComfyUI #16227, #16345, #16347, merged 2026-09-15/16):

```
LoadImage → ImageScaleBy(supersample 2) → GetImageSize
frames = round(duration × fps); widest crop with the output's aspect ratio = min(W_src, H_src·W/H) × min(H_src, W_src·H/W)
outer StartLoop(For chunk c < ceil(frames/chunkFrames))
  inner StartLoop(For i in [c·K, min(c·K+K, frames)), parent_iteration)
    e = (1 − cos(π·i/(frames−1)))/2 ; zoom = zoomStart + (zoomEnd−zoomStart)·e
    crop = widest/zoom ; centre = panStart + (panEnd − panStart)·e   (0–1 of the source, clamped inside)
    ImageCrop(x, y, w, h) → ImageScale(width × height, lanczos)
  inner EndLoop(accumulate) → RebatchImages(4096) → CreateVideo(fps, codec h264)   ← each chunk encoded at once
outer EndLoop(accumulate) → ConcatenateVideo(list) → SaveVideo
```

**Real CPU runs**

| Settings | Time | Result |
|---|---|---|
| 2 s, 25 fps, 640×360, single loop (first version) | 33.3 s | 50 frames, 2.000 s; zoom 1 → 1.25 and the pan visible in frames 0/25/49 |
| 5 s, 30 fps, 1280×720, single loop, default cache | — | **OOM-killed at 10.0 GB RSS**: each iteration's outputs stay cached (~41 MB/frame). This is why the final graph encodes chunks |
| 2 s, 25 fps, 640×360, chunks of 20 (final) | 17.9 s | 50 frames, 2.000 s; matches the single-loop output (mean abs diff 0.56/255, codec noise); smooth across chunk joins |
| 5 s, 30 fps, 1280×720, chunks of 30, `--cache-ram 13` | 75.6 s | 150 frames, 4.999 s, peak RSS +2.6 GB |
| 10 s, 30 fps, 1280×720, zoom 1 → 1.5, `--cache-ram 13` | 142.1 s | 300 frames, 9.999 s, peak RSS +3.7 GB |

* **Memory.** Under RAM pressure, ComfyUI's default cache evicts finished chunks. RAM still grows by roughly one output frame per frame, about 11 MB at 720p. Keep Faceless scenes ≤ 10 s per job, or split longer scenes.
* **Measuring in this sandbox.** The cgroup limit is invisible to the cache's free-RAM check, so the pressure runs used a second ComfyUI on port 8190 with `--cache-ram 13`. That instance has been stopped.
* **Bindings:** `image`, `supersample`, `width`, `height`, `duration`, `fps`, `zoomStart`, `zoomEnd`, `panStartX/Y`, `panEndX/Y`, `chunkFrames`.
* **Presets** (app side):

  | Preset | Settings |
  |---|---|
  | Push in | zoom 1 → 1.2 |
  | Pull out | zoom 1.2 → 1 |
  | Pan left | zoom 1.15, x 0.6 → 0.4 |
  | Pan up | zoom 1.15, y 0.6 → 0.4 |

---

## e. Audio loop, join and crossfade (core)

Core has `AudioConcat`, `AudioMerge` (add / mean / subtract / multiply; it pads or cuts audio2 to audio1 and **normalises when the sum peaks over 1**), `TrimAudioDuration` (negative start counts from the end), `AudioAdjustVolume` (integer dB), `EmptyAudio` and `SplitAudioChannels`. Core has **no gain-ramp node**. So the crossfade curve is a tiny WAV the provider writes and uploads:

* stereo, exactly `crossfade` seconds long
* left channel = sin(π/2·t) fade-in, right channel = cos(π/2·t) fade-out
* written at 8 kHz, so `AudioMerge` resamples the curve up and never the music down

**`audio-loop-crossfade`**

```
VHS_LoadAudioUpload(clip) → (audio, duration L) → AudioAdjustVolume(headroomDb −3)
head = Trim(0, X); tail = Trim(−X, X); body = Trim(X, L−2X); seam = tail×fadeOut + head×fadeIn (AudioMerge multiply, add)
repeat = body + seam ; N = ceil((duration − X)/(L − X))
StartLoop(simple, N, initial = head) → AudioConcat(current, repeat) → EndLoop
→ Trim(0, duration) → last X seconds × fadeOut → SaveAudio (FLAC)
```

* **Real run.** A 6 s stereo 44.1 kHz clip became a 20 s bed in 2.2 s: FLAC 20.000 s at 44.1 kHz (not resampled), seams at 5, 10 and 15 s, a one-second fade-out, and no clicks (the largest sample-to-sample step equals the signal's normal step).
* **The seam bump.** A pure tone shows +3 dB at each seam. That is what equal power does on correlated sound. For loops of near-identical material, write a linear curve instead.
* **Headroom.** `headroomDb` exists because `AudioMerge` would otherwise normalise a whole seam segment when the sum peaks over 1.
* **Use.** It turns ACE-Step's ≤ 240 s beds into 10-minute beds.
* **Memory.** Each loop pass caches its output, so memory is O(N²·L) without RAM pressure. Prefer clips ≥ 60 s (N ≤ 10).
* **The model alternative** is ACE-Step's own repaint / extend, which continues the music instead of repeating it. It is not built.

**`audio-join-crossfade`** joins clip A and clip B with an overlap (the first clip's length comes from the VHS loader):

* **Real run:** 6 s at 44.1 kHz + 6 s of 48 kHz pink noise gave 11.000 s at 48 kHz (`AudioConcat` resamples to the higher rate), with the level continuous through the overlap.
* **More clips:** fold for more clips.
* **Click-free hard join:** set `crossfade` to 0.02.
* **Lines at exact times:** use the existing `audio-timeline`.

---

## f. FPS boost and pro output formats

**FPS boost: the existing `interpolate-rife` stays the default.** It uses the native `FrameInterpolate` node and needs no pack. Both native graphs ran for real on CPU, on a 2 s 320×180 25 fps clip, ×2:

| Workflow | Weights | Time | Output |
|---|---|---|---|
| `interpolate-rife` | `rife_v4.26.safetensors` 22.7 MB (Comfy-Org/frame_interpolation, "MIT and Apache-2.0") | **4.0 s** | 99 frames at 50 fps, 1.98 s, sound kept |
| `interpolate-film` | `film_net_fp16.safetensors` 68.9 MB | 124.0 s (31× slower) | same frame count |

* N frames become 2N−1, so the clip is one source frame shorter. Note it in the UI or pad the last frame.
* FILM is the better pick for large motion (it was built for large motion, per its paper). The quality gap was not measured here.
* **GIMM-VFI** (kijai/ComfyUI-GIMM-VFI, NeurIPS 2024) handles arbitrary timesteps but is slower. Its licence could not be confirmed (Kijai's repack says "other"). Not added.
* **Next step for the app:** offer RIFE ×2/×4 in Upscale video ("FPS boost") through the existing `interpolate-rife`, instead of a Canvas-only node.

**Pro formats** (all ran for real on CPU):

| Workflow | What it writes | Checked with ffprobe |
|---|---|---|
| `video-export-pro` (VHS `VHS_VideoCombine`) | `format` video/ProRes (`profile` lt / standard / hq / 4444 / 4444xq), video/h265-mp4 (10-bit), video/ffv1-mkv, video/16bit-png, video/av1-webm | `.mov` ProRes **HQ**, yuv444p10le, bt709, 50 frames, pcm_s16le sound (1.2 s). VHS writes `-audio.mov` when there is sound |
| `video-sdr-to-hdr` (core `ImageSDRToHDR` → `CreateVideo(HDR, 10-bit, h264)`) | Rec.2020 HLG, 10-bit | H.264 **High 10**, yuv420p10le, bt2020 / arib-std-b67 (11.2 s) |
| `video-export-exr` (core `SaveImageAdvanced` exr, 16-bit float) | one scene-linear EXR per frame | 50 `.exr` files, linear transfer (1.0 s) |

* The installed ffmpeg has `prores_ks`, `ffv1`, `libx265` and `dnxhd`. VHS falls back to each format widget's default when an input is missing.
* `ImageSDRToHDR` is an algorithmic curve (Lottes), not a learned model. The learned option is the LTX-2.5 SDR-To-HDR IC-LoRA (below).
* All three decode the whole clip (`GetVideoComponents`), so RAM grows with length.

---

## g. Still → clip and the logo end card

* **`still-to-clip`** chains `ImageScale(centre crop)` → `RepeatImageBatch(duration·fps)` → `CreateVideo(h264, EmptyAudio silence)`.
  * **Real run:** logo PNG → 3 s, 25 fps, 640×360: 75 frames and stereo AAC silence, 3.000 s (1.3 s).
  * The app renders the card (logo on the brand colour) at the clip size.
  * For a slow push-in, use `kenburns-still` with zoom 1 → 1.05.
* **`video-append-endcard`**: the ad passes through `LoadVideo` without decoding. The card is `RepeatImageBatch` → `CreateVideo(h264)`. Then `ConcatenateVideo(ad, card, complete_audio = AudioConcat(ad's sound from LoadAudio(same file), EmptyAudio(card seconds)))`.
  * **Real run** on a ComfyUI-encoded 2 s clip + a 2 s card: 4.000 s and 100 frames. The ad's 50 frames decode **bit-identical** to the source (stream copy). silencedetect finds silence from exactly 2.00 s.
  * **Limit found: it fails for clips from other encoders.** An ffmpeg/libx264 clip, both untagged and bt709-tagged, failed in core v0.41 with "Video chunk 1 could not be encoded compatibly: extradata … color space". `ConcatenateVideo` cannot normalise foreign H.264 parameter sets.
  * So: use this graph for clips Fuobe's open engine made (all are ComfyUI-encoded, sRGB-tagged H.264). For cloud clips and uploads, fall back to `still-to-clip` + the existing `video-concat-sound1-2`, which decodes everything and keeps clip 1's sound.
  * Silent ads: drop node 2. _Correction (comfy-graphs-4): drop nodes 2, 12 and 13 and node 14's `complete_audio`; that output has no sound track. Dropping only node 2 leaves node 13 unlinked, and linking node 12 alone gives a sound track only as long as the card (checked on CPU)._

---

## h. New open-weight models, 2026-09-15 … 2026-10-22

Found from the Hugging Face API (trending per pipeline, Comfy-Org's new repacks, publishers' new repos), Comfy-Org/workflow_templates `main`, and ComfyUI `master` (fetched 2026-10-22).

| Model (date) | Kind | Licence | Size | ComfyUI | Beats a current pick? |
|---|---|---|---|---|---|
| **OvisOCR3** (2026-10-21) | OCR 0.8B | Apache-2.0 | 1.71 GB | native (Qwen3.5) | **Yes**: no open OCR before; adopted |
| **MOSS-Image** Base/SFT (2026-10-11; Comfy-Org 10-16) | text-to-image 5B + Qwen3.5-9B encoder; layout boxes with per-box captions and rendered text | **Apache-2.0** | 10.16 GB DiT + 9.75–19.31 GB encoder | native in the installed core (#17095); templates 2026-10-17 only in templates `main` | Unproven vs Z-Image Turbo / Qwen-Image 2512 (no published comparison; 50 steps). Add as opt-in after a GPU test |
| FLUX 3 Image Klein (2026-10-13) | text-to-image + edit + multi-reference, 5.6B | FLUX Kommunity License (gated; terms **unverified**; BFL says a commercial licence is needed in products) | 11.1 GB bf16, 6.27 GB fp8 | native (templates 2026-10-15) | Opt-in only (licence) |
| Qwen-Image-2.1 / Turbo (2026-09-14 / 10-09) | unified gen + edit + **native RGBA** | **Qwen Research = non-commercial** (2026-09-20) | 14.23 GB DiT + 17.53 GB encoder | native | No (licence), though RGBA would suit Layers |
| Fibo 2.0 dev / edit-turbo (Bria, 2026-10-18/19) | image + edit | bria-fibo; Comfy repack **cc-by-nc-4.0** | 16.45 GB | core #17240 (after v0.42) | No (non-commercial) |
| Ming-Image-0.1-Design / -Design-Layer (2026-09-17) | design images; **layer decomposition into RGBA layers** | MIT | 6B; Comfy-Org repack 162 GB with a 36.7 GB text model; validated on an 80 GB GPU | Design native; Layer variant unverified | Watch for Layers (vs Qwen-Image-Layered 20.5 GB fp8) |
| Kandinsky 6.0 Lite / Pro (HF repos 2026-09-09; public date unverified) | image-to-video 5 s | MIT | 27.7 / 90.0 GB | **not native** (community wrappers) | Unproven vs Wan 2.2 |
| MiniMax H3: FastH3 8-step, FastH3 OmniRef (templates 09-15, 10-20); H3 Person-Remover LoRA (10-08), Character-Swap LoRA (09-25) | video + audio, removal, swap | MiniMax H3 Community | base 40–66 GB + 51.5 GB encoder | native; single-head LoRAs need #17239 | Too heavy for defaults |
| LTX-2.5 IC-LoRAs: Alpha-Gen, SDR-To-HDR, Restore, Refine-Details, Layout-To-Render (09-22..28) | video tools on LTX-2.5 22B | LTX-2.x community (revenue-gated) | ~1.31 GB each | LTX-2.5 native | Learned SDR→HDR and RGBA video; later round |
| Drama-3 TTS (Fish Audio, 10-01) | TTS 35B MoE / 3B active | Fish Audio research licence (terms unverified) | 41.5 GB | community node only | No |
| Ming-3.0-tts-0.5B (09-22) | TTS, 7 languages | MIT | 0.5B | none | No (Chatterbox: 23 languages) |
| YuE2 (Comfy-Org 09-11, templates 09-14) | song / cover | CC-BY-NC-4.0 | — | native | No (ACE-Step stays) |
| Lip-sync, 3D | — | — | — | — | Lip-sync: nothing new with ComfyUI support; InfiniteTalk / LatentSync stay. 3D: TRELLIS.2 stays for assets. *Critic correction:* MoGe 2 / 3 (MoGe 3 template 2026-09-18, MIT) **do** make a textured whole-scene GLB through core `MoGePointMapToMesh` + `SaveGLB`, and core has native TripoSplat nodes. Both are added in §i for Cinema Studio's 3D scene |

**Engine.** ComfyUI `master` is at v0.42.0 (2026-10-18) plus commits to `1a82e6d0` (2026-10-22). They add Fibo 2.0, MOSS-image fixes, the TextGenerate think-block fix (#17121), the TextGenerate cleanup fix (#17169), a CPU fp8/int8 guard (#17170), Pad Image with mirror padding (#17224) and templates 0.11.94. Bump the pin in a later round and re-validate the whole library.

---

## i. Critic additions: Cinema 3D scene, subject splats, reference-video briefs (2026-10-22)

_Added by the round-4 completeness critic. Same server and method as above. The 14 graphs above were also re-validated independently: 14/14 accepted by `POST /prompt` with no `node_errors`. A static check of all 315 nodes against `/object_info` found no unknown class or input (VHS adds `profile` at run time)._

No round-4 file had an open graph for **Cinema Studio's "Create 3D scene"** (STATUS ⬜, delta G05) or for reading a **reference video** (Content Factory, delta G07). ComfyUI v0.41 core already covers both:

| Workflow id (new) | What it does | Nodes | Weights (licence) | `/prompt` | Ran on CPU |
|---|---|---|---|---|---|
| `scene-mesh-moge` | photo → textured GLB of the **whole scene** + depth PNG | core `LoadMoGeModel`, `MoGeInference`, `MoGePointMapToMesh`, `SaveGLB`, `MoGeRender` | MoGe 2 ViT-L 0.66 GB (MIT); MoGe 3 ViT-L 0.74 GB / ViT-G 2.50 GB optional | yes | **yes** |
| `image-to-splat-triposplat` | photo → Gaussian splat of the **subject** (`.spz`) + 3 s orbit MP4 | core `TripoSplatPreprocessImage`, `TripoSplatConditioning`, `KSampler`, `VAEDecodeTripoSplat`, `SplatToFile3D`, `RenderSplat`, `CreateCameraInfo`, BiRefNet `RemoveBackground` | 3.78 GB: TripoSplat (MIT), DINOv3 ViT-H (DINOv3 License: royalty-free, commercial use allowed, "Built with DINOv3" notice), FLUX.2 VAE (Apache-2.0), BiRefNet (MIT) | yes | no |
| `reference-brief-gemma4` | reference clip (frames at 1 fps + its sound) → JSON style brief | `VHS_LoadVideo` (24 fps, ≤ 720 frames, 384 px wide) → core `TextGenerate` with `video` and `audio` → `SaveText` | Gemma 4 E4B fp8 9.06 GB, already in the library (Apache-2.0) | yes | no |

**`scene-mesh-moge`** comes from the official template `3d_moge_perspective_to_mesh` (2026-05-15), exported with `scripts/comfy/export-templates.mjs`; the normal-map previews were dropped and a depth PNG added.
- **Real CPU run:** the template's own input photo (a living room) at 768×768 became a 25.2 MB textured GLB in **42 s**: 555,959 vertices, 1,083,964 triangles, one texture, scene depth 0.35–6.58 m. ComfyUI's RSS peaked 1.6 GB above its idle level. The weights and outputs were deleted afterwards.
- **Use:** "Create 3D scene" → this graph → the browser orbits the GLB with WASD (Fuobe already loads GLB with `@google/model-viewer`; a fly camera needs three.js) → Capture → recomposition with the existing `qwen-image-edit-2511` multiple-angles route, sending the original photo and the capture.
- **Why not TripoSplat for this:** it removes the background first (the template runs BiRefNet; fal's schema calls its input "the background-removed RGB composite"), so it rebuilds the subject only.
- **Bindings:** `image`, `checkpoint`, `resolutionLevel`, `fovX`, `decimation`, `filenamePrefix`. Bind `decimation` 2 for phones (about 4× fewer triangles, *inferred*).

**`image-to-splat-triposplat`** is the official template `3d_triposplat_image_to_gaussian_splat` (2026-06-02) with the UI-only live-preview patch removed and an H.264 orbit video.
- **Use:** subject or product splats for the parity studio's 3D Angles and 3D Jutsu props, and a splat alternative to TRELLIS.2 product spins.
- **Server-side views:** `RenderSplat` takes a `CreateCameraInfo` camera (`orbit` yaw / pitch / distance, or `look_at` position and target, plus `fov`), so a view chosen in the browser can also be rendered on the server.
- **Bindings:** `image`, `cutout` (false = use the image's alpha), `numGaussians` (core allows up to 1,048,576), `steps`, `cfg`, `seed`, `splatFormat` (ply / ksplat / spz), `orbitFrames`, `filenamePrefix`.

**`reference-brief-gemma4`** reads a reference clip for Content Factory's "Use as reference".
- **Why Gemma 4:** in ComfyUI v0.41 only the Gemma 4 and MiniMax text encoders read `TextGenerate`'s `video` input. `qwen35.py` (OvisOCR3, `translate-qwen35-textgen`) never looks at it.
- **Frame sampling:** `gemma4.py` keeps every 24th frame, assuming 24 fps. So the loader forces 24 fps, and each frame is capped at 70 soft tokens.
- **Sound:** the clip's audio goes in on the same call.
- **Output:** a JSON style brief with format, hook, pacing, shots, visual and animation style, narration, music, captions and 5 topic ideas. The instruction forbids copying the reference's people, logos or exact words.
- **Unverified:** whether Gemma 4 E4B takes 30 s of audio in one call.

**FPS Boost to the parity studio's exact targets** (24 / 30 / 60 / 90 / 120 fps). Core `FrameInterpolate` takes an integer `multiplier` from 2 to 16. Interpolate by *m*, then keep every *n*-th frame (`VHS_SelectEveryNthImage`), so that source × *m* / *n* = target:

| From → to | 30 | 60 | 90 | 120 |
|---|---|---|---|---|
| 24 | m 5, n 4 | m 5, n 2 | m 15, n 4 | m 5 |
| 30 | — | m 2 | m 3 | m 4 |
| 60 | — | — | m 3, n 2 | m 2 |

This is not built or timed. RIFE runs once per in-between frame, so m 15 costs about 7× m 2 *(inferred)*.

**Depth colour maps (G14).** The installed `VideoDepthAnythingOutput` offers only `gray` and `inferno`, and `MoGeRender` offers `depth` and `depth_colored`. The parity studio's Turbo, Magma and Viridis need a LUT step, which was not researched.

**Sources (2026-10-22):**
- live `/object_info` (ComfyUI `fc04da91`) and `comfy_extras/nodes_textgen.py`, `comfy/text_encoders/gemma4.py`
- the installed `comfyui_workflow_templates_json` index: `3d_moge_perspective_to_mesh`, `utility_moge3_geometry_estimation`, `3d_triposplat_image_to_gaussian_splat`, `templates-6-key-frames`, `template_qwen_multiangle.app` (2026-10-13, "Generate Multiple Angles with 3D Camera Node")
- https://huggingface.co/api/models/Comfy-Org/MoGe , https://huggingface.co/api/models/VAST-AI/TripoSplat , https://huggingface.co/api/models/Comfy-Org/gemma-4 (file sizes, licences)
- https://ai.meta.com/resources/models-and-libraries/dinov3-license/ (DINOv3 License)
- the FLUX.2 autoencoder's Apache-2.0 terms as quoted on https://huggingface.co/unsloth/FLUX.2-VAE (BFL's own repo statement; secondary page)

---

## What Fuobe has to add

* **Library entries.** The 14 ids (17 with the critic's §i additions) go in `scripts/comfy/library.spec.mjs` as `handBuilt` graphs, copied from `comfyui-oss-4.json`.
* **New `KNOWN_MODELS` entries:**
  * `ovisocr3_0.8b_bf16.safetensors`. The upstream file is `model.safetensors`, so the installer must save it under the new name, like `qwen3.5_0.8b_bf16.safetensors`.
  * The VOID set.
  * `wan2.1_vace_1.3B_fp16.safetensors`.
* **New binding keys:**

  | Workflows | Keys |
  |---|---|
  | VACE / VOID | `maskPrompt`, `maskGrow`, `skipPass2` |
  | Ken Burns | `supersample`, `zoomStart`, `zoomEnd`, `panStartX`, `panStartY`, `panEndX`, `panEndY`, `chunkFrames` |
  | Audio | `crossfade`, `headroomDb`, `audio3` |
  | Exports | `format`, `profile`, `peakNits` |

  These already exist: `checkpoint`, `instruction`, `maxSize`, `maxTokens`, `startFrame`, `mask`.
* **Provider work:**
  * Write the crossfade curve WAV (about 20 lines of TypeScript).
  * OCR JSON parsing: fences, key variants, 0–1000 → pixels.
  * VACE windows of ≤81 frames for long clips, joined afterwards.
  * Ken Burns presets.
  * The end-card fallback for foreign clips.
* **New output roles:**
  * `lines` and `frame` (OCR text)
  * `frames` (EXR sequence, zip it)
  * the `-audio.mov` of VHS ProRes
* **Licence follow-up.** Mark `wan21-vace-14b-ref2v` as non-commercial (CausVid LoRA), or switch it to the lightx2v T2V LoRA as done here.
* **For the §i additions (critic):**
  * New `KNOWN_MODELS`: `moge_2_vitl_normal_fp16`, `moge_3_vitl_fp16` and `moge_3_vitg_fp16` (folder `geometry_estimation`); `triposplat_fp16` (`diffusion_models`); `triposplat_vae_decoder_fp16` (`vae`); `dino_v3_vit_h` (`clip_vision`). _Correction (comfy-graphs-4): `flux2-vae` and `birefnet` were already library entries; VAST-AI/TripoSplat's `flux2-vae.safetensors` is byte-identical to Comfy-Org/flux2-dev's (same sha256 etag)._
  * New binding keys: `resolutionLevel`, `fovX`, `decimation`, `cutout`, `numGaussians`, `splatFormat`, `orbitFrames`, `frameCap`, `skipFrames`.
  * New output roles: `scene` (GLB), `splat` (.spz), `turntable`, `brief`.
  * Attribution: TripoSplat's DINOv3 encoder needs a "Built with DINOv3" notice in the app's about or licences page.

## Risks and unverified points

* No GPU here: VACE removal / swap / insert and VOID are validated graphs, not tested outputs. The lightx2v + VACE 14B pairing and the black-fill convention (copied from the official template) are _(inferred)_.
* VOID's licence chain: Apache-2.0 weights fine-tuned from a CogVideoX-5B transformer under the CogVideoX License (registration, ≤1M monthly visits). Its VRAM in ComfyUI is unknown.
* Core loop nodes are five weeks old (2026-09-15). The Ken Burns and audio loop graphs depend on them.
* `ConcatenateVideo` stream copy works only for compatible H.264 (see g).
* OvisOCR3 is one day old, and its benchmarks are the vendor's.
* FLUX 3 Klein's licence terms, Drama-3's licence and Kandinsky 6's public release date are unverified.

## Sources (all read 2026-10-22)

**Models and licences**
- https://huggingface.co/ATH-MaaS/OvisOCR3 and `prompts/word_spotting.txt`: OvisOCR3 card, prompts, benchmark tables, Apache-2.0
- https://huggingface.co/Qwen/Qwen3.5-0.8B , https://huggingface.co/Comfy-Org/Qwen3.5 : Qwen3.5 checkpoints and sizes
- https://huggingface.co/microsoft/Florence-2-base , https://huggingface.co/microsoft/Florence-2-large : MIT, sizes
- https://github.com/kijai/ComfyUI-Florence2 (`nodes.py`, `requirements.txt`, `LICENSE` at `9ece3de9`): OCR_WITH_REGION output
- https://huggingface.co/PaddlePaddle/PaddleOCR-VL , https://huggingface.co/deepseek-ai/DeepSeek-OCR , https://huggingface.co/stepfun-ai/GOT-OCR-2.0-hf : licences and sizes
- https://huggingface.co/netflix/void-model (card: base model, 40 GB+, 197 frames, quadmask) and https://huggingface.co/Comfy-Org/void-model (repack sizes)
- https://huggingface.co/alibaba-pai/CogVideoX-Fun-V1.5-5b-InP (README licence section) and https://huggingface.co/THUDM/CogVideoX-5b/blob/main/LICENSE : CogVideoX License terms
- https://huggingface.co/zibojia/minimax-remover (cc-by-nc-4.0) and https://huggingface.co/Kijai/WanVideo_comfy : MiniMax-Remover and CausVid / lightx2v LoRA files and sizes
- https://huggingface.co/tianweiy/CausVid (cc-by-nc-4.0) and https://huggingface.co/lightx2v/Wan2.1-T2V-14B-StepDistill-CfgDistill-Lightx2v (apache-2.0): LoRA licences
- https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged , https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged , https://huggingface.co/Comfy-Org/sam3.1 , https://huggingface.co/Comfy-Org/SCAIL-2 , https://huggingface.co/Comfy-Org/Wan-Animate-2 , https://huggingface.co/Comfy-Org/frame_interpolation : file sizes and licences
- https://huggingface.co/lixiaowen/diffuEraser : DiffuEraser licence
- https://huggingface.co/Kijai/GIMM-VFI_safetensors : GIMM-VFI repack (licence "other")

**New-model survey**
- https://huggingface.co/api/models (author=Comfy-Org, author=kandinskylab, and trending per pipeline tag)
- https://huggingface.co/OpenMOSS-Team/MOSS-Image-SFT
- https://huggingface.co/black-forest-labs/flux-3-image-klein and https://bfl.ai/models/flux-3-image-klein
- https://huggingface.co/Qwen/Qwen-Image-2.1 and its `LICENSE`
- https://huggingface.co/briaai/Fibo-2.0-dev , https://huggingface.co/Comfy-Org/Fibo-2.0
- https://huggingface.co/inclusionAI/Ming-Image-0.1-Design-Layer , https://huggingface.co/Comfy-Org/Ming-Image
- https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA , https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA , https://huggingface.co/Comfy-Org/MiniMax-H3
- https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-SDR-To-HDR , https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Alpha-Gen
- https://huggingface.co/fishaudio/drama-3 , https://huggingface.co/inclusionAI/Ming-3.0-tts-0.5B , https://huggingface.co/KittenML/kitten-tts-2 , https://huggingface.co/Comfy-Org/YuE2

**ComfyUI**
- https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/index.json : templates after 2026-10-14
- ComfyUI `git fetch origin master` in `/home/user/ComfyUI` (`fc04da91..1a82e6d0`): v0.42.0 and later commits
- Live `/object_info` of the installed server: every node input name and type used in the graphs
- ComfyUI source at `fc04da91`: `comfy_extras/nodes_loop.py`, `nodes_audio.py`, `nodes_void.py`, `nodes_wan.py` (`WanVaceToVideo`), `nodes_glsl.py`, `nodes_math.py`, `comfy_api/latest/_input_impl/video_types.py` (`ConcatenateVideo` signature check), `comfy/sd.py` (Qwen3.5 detection)

**Secondary**
- https://www.digitalapplied.com/blog/flux-3-image-klein-open-weights-8gb-gpu : the unconfirmed $5M FLUX threshold
