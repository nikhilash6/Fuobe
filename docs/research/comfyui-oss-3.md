# Fuobe research #3: open-weight ComfyUI routes for the round-3 features

_As of 2026-10-17. Machine-readable companion: [`comfyui-oss-3.json`](comfyui-oss-3.json). It holds the full API-format graphs, bindings, live `/object_info` node specs, model URLs and sizes, and the validation results. This file builds on [`comfyui-oss.md`](comfyui-oss.md) (capability rankings), [`comfyui-oss-2.md`](comfyui-oss-2.md) (round 2) and [`comfyui-workflow-library.md`](comfyui-workflow-library.md) (the 73-workflow library). The parity studio's behaviour each route copies is in [`parity-studios.md`](parity-studios.md) and [`parity-image-studios.md`](parity-image-studios.md)._

## How this was produced and what "verified" means

* **Server.** The ComfyUI under test is the library's CPU ComfyUI: core `fc04da91` (v0.41.0-7), Python 3.13.16, torch 2.14.1+cpu, transformers 5.20.1 and comfyui-workflow-templates 0.11.86. Templates that aren't packaged yet came from Comfy-Org/workflow_templates `main` (2026-10-17).
* **Template export.** Official templates and custom-node example workflows were converted to API format inside the real ComfyUI frontend (`app.loadGraphData` → `app.graphToPrompt`), the same method as `scripts/comfy/export-templates.mjs`. A small builder then edited them, for example dropping LLM prompt-expansion branches, resolving switches and adding inputs. The builder also checks that every binding targets a literal input, never a link.
* **New node packs.** Four packs were installed in `/home/user/ComfyUI/custom_nodes` at pinned commits and ComfyUI was restarted:
  * MelBand RoFormer
  * ComfyUI-QwenASR
  * HunyuanVideo-Foley
  * ComfyUI-Whisper

  Two more packs change global process state or pin old dependencies: LatentSync and ThinkSound. They were validated on a **second, isolated ComfyUI** on port 8189. It runs the same commit and venv, but has its own base directory and `HOME`, so the main install was never exposed to them. The exact lines to add to `install-comfyui.sh` are [below](#what-fuobe-has-to-add).
* **Live validation.** The method is the same as `scripts/comfy/validate-workflows.mjs`, run from a scratch copy so that `workflows/` and `scripts/` stay untouched:
  * zero-byte placeholder model files and uploaded fixtures
  * `POST /prompt` must return HTTP 200, a `prompt_id` and no `node_errors`
  * the prompt is deleted from the queue straight away, while a KJNodes `Sleep` blocker holds the worker, so nothing executes
  * only this run's own prompt ids were touched (no global queue clear), and every placeholder was deleted afterwards
* **Negative tests.** All 29 graphs were posted again with their first bound input removed, and all 29 were rejected. Three graphs were posted without the placeholder weights, and every loader failed with "Value not in list". The acceptance is real.
* **Real runs.** Four things needed no weights and actually ran on the CPU ComfyUI or host; every output was checked with ffprobe:
  * `video-trim`
  * `video-segment-resample`
  * `video-mux-audio`
  * the ffmpeg/libass caption burn-in
* **Validation does not prove quality.** No model ran. Settings come from the templates, model cards and source. Anything that could only be inferred is listed under `inferred` and marked _(inferred)_ here.

**Result: 29 new graphs. 27 passed `/prompt` validation on the main server and 2 on the isolated server (LatentSync, ThinkSound). 4 no-weight steps ran for real.** All recommended routes use permissively licensed weights (Apache-2.0, MIT or OpenRAIL++), except sound effects, where the best-supported models carry Stability's Community License.

## Summary: recommendation per feature

| Feature | Capability id | Recommended open route (workflow id) | Packs | Licence | VRAM | New download | Validated |
|---|---|---|---|---|---|---|---|
| Layers: decomposition | `layer-decompose` | **Qwen-Image-Layered** fp8mixed (`layers-qwen-image-layered`); prompt-guided **Layered-Control** (`layers-qwen-image-layered-control`) | core | Apache-2.0 | 24 GB | 20.8 GB (+40.9 control) | yes |
| Layers: edit text, remove bg | `layer-edit-text` | library `qwen-image-edit-2511` (prompt template) + `bg-remove-birefnet` | core | Apache / MIT | 24 GB | 0 | library |
| Moodboards | `style-reference` | instant: **Qwen-Image-Edit-2511 + Lightning** from 1–2 board collages (`style-ref-qwen-edit-2511`); persistent: **AI-Toolkit style LoRA** on Z-Image Turbo | core | Apache-2.0 | 24 GB | 0.85 GB | yes |
| Soul HEX | `palette` | **Z-Image Turbo + hex prompt + ColorTransfer lock** in one job (`palette-zimage-hex`) | core | Apache-2.0 | 12 GB | 0 | yes |
| Shorts / Mixed Media segments | `video-segment` | `video-segment-resample` (VHS, fps + size + first frame); `video-trim` (seconds, keeps audio) | VHS / core | n/a | CPU | 0 | yes + **real run** |
| Shorts Studio restyle | `video-restyle` | segment → restyle frame 0 with Qwen-Edit-2511 → **Wan 2.2 Fun VACE**, depth control + restyled reference (`video-restyle-wan22-fun-vace`) → concat | core | Apache-2.0 | 24 GB | 0 (shares Fun VACE) | yes (chain inferred) |
| Mixed Media | `video-stylize-frames` | **Z-Image Turbo img2img + Fun Union ControlNet** per frame, VHS meta-batch (`mixed-media-zimage-frames`) | core + VHS | Apache-2.0 | 16 GB | 3.1 GB | yes |
| Sound effects | `sfx` | **Stable Audio 3.0 Small SFX** (`sfx-stable-audio-3-small`); permissive: ThinkSound | core | Stability Community (< US$1M) | 6 GB | 3.5 GB | yes |
| Translate & dub | `dubbing` | **MelBand RoFormer + Qwen3-ASR/ForcedAligner** (`dub-prepare-separate-transcribe`) → LLM translation → Chatterbox clone → **InfiniteTalk V2V** (`lipsync-v2v-infinitetalk`) or LatentSync 1.6 → `video-mux-audio` | MelBand, QwenASR, WanVideoWrapper | MIT / Apache | 8 / 24 GB | 6.8 GB | yes (5 steps) |
| Captions | `captions` | **Qwen3-ASR 0.6B + ForcedAligner** cues (`captions-qwen3-asr`) + **ffmpeg/libass ASS burn-in** | QwenASR | Apache-2.0 | 4 GB | 1.6 GB | yes + **real burn-in** |
| Product spins (3D) | `image-to-3d` | **TRELLIS.2** PBR GLB + 36-view turntable MP4 (`image-to-3d-trellis2`) | core | MIT | 16 GB | 8.5 GB | yes |
| Try-on / product shots | `try-on` | **FLUX.2 [klein] 4B + try-on LoRA**, ClothesSegment agnostic person (`tryon-flux2-klein-4b`); zero-shot `qwen-image-edit-2511-multi` | core + RMBG | Apache-2.0 | 10 GB | 4.6 GB | yes |
| Cinema Studio grid | `image-grid` | **Z-Image Turbo contact sheet** + KJNodes `ImageGridtoBatch` tiles (`grid-zimage-contact-sheet`) | core + KJNodes | Apache-2.0 | 14 GB | 0 | yes |
| Soul Cast | `character-sheet` | **Z-Image Turbo turnaround sheet**, 4 views (`soul-cast-sheet-zimage`) | core + KJNodes | Apache-2.0 | 14 GB | 0 | yes |
| Faceless / Explainer | `faceless-explainer` | chain of existing graphs + `captions-qwen3-asr` + `video-mux-audio` | — | Apache / MIT | — | 0 | parts yes |

Adding every recommended route costs about **50 GB of new weights**:

| Route | New weights |
|---|---|
| Qwen-Image-Layered | 20.8 GB |
| TRELLIS.2 + VAEs + DINOv3 | 8.5 GB |
| ASR 1.7B + 0.6B + aligner + MelBand | 7.9 GB |
| Try-on (klein 4B + LoRA) | 4.6 GB |
| Stable Audio 3 small + T5Gemma | 3.5 GB |
| Z-Image Fun ControlNet | 3.1 GB |
| Qwen-Edit-2511 Lightning | 0.85 GB |

Everything else reuses library weights: Fun VACE, Z-Image Turbo, Qwen-Edit-2511, InfiniteTalk GGUF, Chatterbox and DA3. All 29 graphs together add about 179 GB, most of it in licence-gated or non-commercial alternatives: Layered-Control (41 GB), Krea-2, USO/FLUX.1 dev and Gemma 4.

### What Fuobe has to add

* **Node packs.** Add these to the `NODES` array in `scripts/comfy/install-comfyui.sh`. They are the commits this was validated with.

  ```bash
    # round-3 packs (2026-10-17): voice separation, ASR/subtitles, foley, whisper captions
    [ComfyUI-MelBandRoFormer]="https://github.com/kijai/ComfyUI-MelBandRoFormer 92c86854e6654f4aacc97484471af95c98ea16d4"
    [ComfyUI-QwenASR]="https://github.com/1038lab/ComfyUI-QwenASR 3f9a652a617e578e4e3bd090e3dbc75274bf4775"
    [ComfyUI-HunyuanVideo-Foley]="https://github.com/phazei/ComfyUI-HunyuanVideo-Foley afd2960b8ad9036a9f55a15daf514112ff68e010"
    [ComfyUI-Whisper]="https://github.com/yuvraj108c/ComfyUI-Whisper 006a709848259ed3d69e2f9fcfd7a75f6c860ddd"
  ```

  Then add these after the existing `uv pip install` block:

  ```bash
  # ComfyUI-HunyuanVideo-Foley needs loguru; ComfyUI-Whisper needs openai-whisper (built from sdist).
  # ComfyUI-QwenASR: do NOT install its requirements.txt (nagisa/DyNet38 have no cp313 wheels and are unused on the HF path).
  uv pip install --python "$PY" loguru "openai-whisper==20250625"
  ```

  The installed versions were loguru 0.7.3, openai-whisper 20250625, tiktoken 0.14.0 and more-itertools 11.2.1. Nothing that was already installed changed.
  * MelBand RoFormer needs `rotary_embedding_torch` and `einops`, both already present.
  * QwenASR needs only `transformers>=5.13`; 5.20.1 is installed.
  * All four packs load in about 0.0–0.2 s.
* **Isolated-worker packs, kept out of the shared install:**
  * **ShmuelRonen/ComfyUI-LatentSyncWrapper `360d5283`.** At import it does the following:
    * overrides `TMPDIR`/`TEMP`/`TMP` and `tempfile.tempdir` for the whole process
    * monkey-patches `folder_paths.get_temp_directory`
    * `rmtree`s `<parent of the ComfyUI dir>/temp`; it computes the ComfyUI directory one level too high, which would be `/home/user/temp` on this box (absent)

    When its node is created it pip-installs missing packages and `snapshot_download`s ByteDance/LatentSync-1.6. Its runtime needs `mediapipe>=0.10.8 face-alignment decord DeepCache ffmpeg-python pytorch_lightning`; registration needs none of them.
  * **ShmuelRonen/ComfyUI-ThinkSound_Wrapper `9a2fb40a`** (2025-07). It registered with the existing venv ("All ThinkSound modules available"). Its `requirements.txt` pins `einops==0.7.0`, `PyWavelets==1.4.1` and more, which would downgrade the shared venv.
  * Run them in a second ComfyUI with its own `--base-directory`, `--port` and `HOME`, exactly as validated here.
* **New binding keys.** They go through `ProviderInput.extra`:
  * Layers: `layers`, `resolution`
  * Palette: `paletteText`, `method`, `strength`
  * Video: `start`, `duration` (seconds), `startFrame`, `controlStrength`, `framesPerBatch`, `denoise`
  * Audio: `checkpoint`, `description`, `audio2`, `backgroundVolumeDb`
  * Dubbing and captions: `instruction`, `text`, `maxTokens`, `language`, `asrModel`, `hints`, `maxChars`, `startStep`, `audioScale`, `lengthMode`, `lipsExpression`, `whisperModel`, `fontSize`, `fontColor`
  * 3D: `textureSize`, `turntableFps`, `octreeResolution`
  * Grids: `columns`, `rows`, `gridPrompt`, `sheetPrompt`
  * References: `image4`
* **New output kinds.**
  * `text`: `SaveText` reports `ui.text: [string]` and `ui.files: [{filename, subfolder, type:"output"}]`, a `.txt` file in `output/`. `PreviewAny` reports only `ui.text`.
  * `3d`: `Save3DAdvanced` reports `ui["3d"]: [{filename, subfolder, type}]`, a `.glb`.
  * `collectFiles` in `src/server/providers/comfyui.ts` already walks every ui array of `{filename, subfolder, type}`. It needs `MediaKind` `"text"` and `"3d"`, and `guessKind` for `.txt`/`.srt`/`.glb`.
  * VHS outputs stay under `.gifs[]`, as before.
* **Chained jobs**, using the existing `dependsOn`/`chain`:
  * Shorts Studio: segment → restyle frame → VACE → concat
  * Dubbing: separate+transcribe → translate → TTS → lipsync → mux
  * Faceless: scenes → i2v → TTS → captions → concat → mux
  * The new graphs are designed as those steps.

---

## 1. Layers: decomposition (`layer-decompose`) and text edit (`layer-edit-text`)

**Recommendation: Qwen-Image-Layered** (Qwen, Apache-2.0, Dec 2025). It runs on core nodes (present in the pinned ComfyUI 0.41) and has an official template, `image_qwen_image_layered` (2025-12-22).

```
LoadImage → ImageScaleToMaxDimension(resolution=640) ─┬→ VAEEncode(layered VAE) → ReferenceLatent (pos + neg)
                                                      └→ GetImageSize → EmptyQwenImageLayeredLatentImage(W,H,layers)
UNETLoader(qwen_image_layered_fp8mixed) → ModelSamplingAuraFlow(1) → KSampler(20 steps, cfg 2.5, euler/simple)
→ LatentCut(t, index 1) → LatentCutToBatch(t, 1) → VAEDecode(layered VAE, 4 ch) → SaveImage (RGBA PNG × layers)
```

* **Verified in the export.** The latent holds `layers + 1` time slices. Slice 0, the reconstructed composite, is cut off, so the output is a batch of exactly `layers` full-canvas RGBA images, back to front.
  * The 4-channel layered VAE decodes alpha, and SaveImage writes it as RGBA.
  * `prompt` is an optional caption of the whole image. The template ships a full description; an empty string is accepted.
* **Bindings:** `image`, `prompt`, `layers` (default 4), `resolution` (longest side, 640 = trained bucket), `seed`, `steps`, `cfg`.
* **Models:**
  * `qwen_image_layered_fp8mixed.safetensors`: 20.53 GB. The template uses the bf16 file at 40.86 GB.
  * `qwen_image_layered_vae.safetensors`: 0.25 GB
  * `qwen_2.5_vl_7b_fp8_scaled.safetensors`: 9.38 GB, already in the library
  * Hardware: 24 GB VRAM class.
* **Matching the parity studio's zip export** ("cropped/positioned layers"): the app computes each layer's bounding box from its alpha, crops it, and writes `{name, x, y, w, h, z}` into the zip manifest.
  * "Separate layer" means running the graph again on one layer.
  * Layer names don't come from the model. Caption each layer with Qwen3-VL or Claude to get Seedream-style named layers.
* **Prompt-guided variant (validated): Qwen-Image-Layered-Control** (DiffSynth-Studio, Apache, template `image_qwen_image_layered_control`).
  * `prompt` names the element to pull out ("guitar", "the headline text"), and `layers=2` returns [element, rest].
  * Use it for click- or describe-to-separate.
  * There is only a bf16 file (40.86 GB), cast to fp8 at load.
* **Edit text** needs no new graph. Use the library's `qwen-image-edit-2511` with this template:

  > Replace the text "{old}" with "{new}". Keep the exact font style, weight, colour, size, perspective and position; change nothing else.

  To edit one RGBA layer, composite it on mid-grey, edit, then run `bg-remove-birefnet` to get the alpha back.
* **Remove background** is the library's `bg-remove-birefnet` (MIT).
* _(inferred)_ Quality and VRAM at 1024 px with fp8mixed. The template recommends 640.

## 2. Moodboards: "make an image in the style of these 4–20 images" (`style-reference`)

The parity studio's moodboards take 5–80 images and are built asynchronously ("Building your moodboard…"); in other words, they are **trained**. The 1:1 open route is therefore two-tier.

**Instant preview (recommended graph): Qwen-Image-Edit-2511 + Lightning, generating from board collages** (`style-ref-qwen-edit-2511`, Apache, no new base weights).

```
LoadImage(board collage 1) + LoadImage(board collage 2) → ImageScaleToTotalPixels(1 MP)
TextEncodeQwenImageEditPlus(prompt = "Create a new image of: {subject}. Render it in the exact visual style of the reference
  moodboard images: same colour palette, lighting, contrast, grain, lens look, texture and mood. Do not copy their subjects…",
  image1, image2) → FluxKontextMultiReferenceLatentMethod(index_timestep_zero)   [positive and empty negative]
UNET qwen_image_edit_2511_fp8mixed + Lightning 4-step LoRA → AuraFlow(3.1) → CFGNorm
EmptySD3LatentImage(W,H) → KSampler(4 steps, cfg 1) → VAEDecode → SaveImage
```

* **How the board becomes references.** The app lays out the 4–20 board images as one or two contact sheets of about 1 MP each, for example a 3×3 or 4×4 grid, so no single image dominates.
  * The output size comes from the empty latent, so any aspect ratio works.
  * `loraStrength 0`, `steps 40`, `cfg 4` gives the slow full-quality path.
* **Persistent moodboard: AI-Toolkit style LoRA on Z-Image Turbo.** This reuses round 2's `aiToolkitJob` (`zimage-turbo-character`) with these overrides, stored in the JSON under `trainedPath`:
  * name `fuobe_zimage_style`, trigger `fuobestyle`
  * rank 32, 2000 steps, lr 1e-4, caption dropout 0.1
  * style sample prompts
  * Caption each image with its **content** only, so the LoRA learns the look rather than the subjects. No face crop.
  * Then run `z-image-turbo-t2i` with the LoRA (the existing `injectLoras`). The board becomes a `style` element with `loras_json`.
* **Alternatives, all validated:**

  | Option | Workflow | Licence | Notes |
  |---|---|---|---|
  | FLUX.2 [klein] 4B, 4 references | `style-ref-flux2-klein-4b` | Apache | 4 steps, ~10 GB; weaker on complex prompts |
  | Krea-2 Turbo + Ostris `krea2_style_reference` LoRA | `style-ref-krea2` | Krea 2 Community (thresholds) | The only open model **trained for style reference** (1–2 refs). The template's LLM prompt expansion and ResolutionSelector were replaced by explicit width/height |
  | USO, style-only, 2 stacked style images | `style-ref-uso-flux1` | FLUX.1 [dev] **non-commercial** | Purpose-built style reference. Both of the template's style subgraphs are enabled and the content reference is dropped |
  | FLUX.2 [dev] multi-reference | library `flux2-dev-multiref` | non-commercial | Strongest multi-reference, 71 GB |

* _(inferred)_ How much board **content** leaks into the zero-shot outputs. Qwen-Edit is an edit model. Check on a GPU.

## 3. Soul HEX palettes (`palette`)

There is still no maintained palette ControlNet for current open models; the colour T2I-Adapter dates from SD1.5. The recommended route generates with the palette **and** locks it in one job (`palette-zimage-hex`):

```
StringConcatenate(prompt, paletteText = "Color palette: #0F0C0B, #65370D, … dominant #865517.") → CLIPTextEncode (Qwen3-4B)
Z-Image Turbo (8 steps, res_multistep, cfg 1) → VAEDecode → ColorTransfer(image_ref = swatch PNG, mkl_lab, strength 0.7) → SaveImage
```

* **Inputs from the app.** The app writes `paletteText` from the HEX signature and renders `image` as a swatch.
  * The swatch uses the same colours in bands sized by intended coverage, with the background colour largest.
  * `strength 0` means prompt only, 0.5–0.8 locks the palette, 1.0 is a full statistics transfer.
* The library's `palette-transfer-image` and `palette-transfer-video` (real CPU runs in round 2) stay the post-step for **any** model, including cloud outputs.
* FLUX.2 hex prompting is documented by BFL. Qwen-Edit-2511 with the swatch as image 2 gives a semantic recolour.
* _(inferred)_ How closely Z-Image follows hex codes. The ColorTransfer lock makes the result deterministic either way.

## 4. Shorts Studio and Mixed Media

### 4a. Segments (`video-segment`): real runs

* **`video-segment-resample`** (VHS):
  * `VHS_LoadVideo(force_rate=fps, skip_first_frames=startFrame, frame_load_cap=frames)` resamples first, then skips and caps.
  * `ImageScale(W×H, center)` follows, then `CreateVideo(fps, segment audio)` → `SaveVideo`.
  * The **first frame** is saved as a PNG for restyling.
  * **Real run:** 8 fps, skip 1, 5 frames, 64×48 gave a 5-frame 8 fps MP4 with 0.625 s of AAC, plus the PNG.
* **`video-trim`** (core):
  * `LoadVideo → "Video Slice"(start_time, duration) → SaveVideo` keeps the source fps and audio.
  * **Real run:** start 0.25 s, duration 0.5 s gave 8 frames at 16 fps with 0.5 s of audio.
* 81 frames at 16 fps (5.06 s) is the Wan 2.2 window. Shorts Studio segment *i* uses `startFrame = i·80`.

### 4b. Shorts Studio restyle (`video-restyle`)

A chained open route, with each step a validated graph:

1. `video-segment-resample` cuts a window of up to 81 frames at 16 fps and saves its first frame.
2. `qwen-image-edit-2511` restyles that frame with the preset prompt. For custom presets, use `qwen-image-edit-2511-multi` with up to two of the user's reference stills.
3. **`video-restyle-wan22-fun-vace`** (below).
4. `video-concat-N` joins the segments, folded four at a time. `video-mux-audio` restores a continuous soundtrack if needed.

```
LoadVideo(segment) → ImageScale(W×H) → LoadDA3Model + DA3Inference(504, mono) → DA3Render(depth) → ImageScale
control_video = [restyled frame 0] + depth[1 … frames-1]        control_masks = [0] + [1 × (frames-1)]
WanVaceToVideo(length=frames, strength=controlStrength, control_video, control_masks, reference_image = restyled frame)
Fun VACE high/low fp8 + T2V lightx2v 4-step (shift 5, split 2/2, cfg 1) → TrimVideoLatent → VAEDecode → CreateVideo(16 fps, segment audio)
```

* **Why this works (verified in `nodes_wan.py`, round 2).** Mask 0 means "keep" and mask 1 means "generate". Frame 0 is pinned to the restyled frame, while depth guides the motion and structure of the rest. The restyled frame is also the VACE reference image.
  * Swap DA3 for core `Canny` to keep more structure, such as logos and on-screen text.
* **Models:** the library's Fun VACE pair and lightx2v, plus DA3 mono-large, so no new downloads. 24 GB VRAM.
* **Other options:**
  * Grade-type presets (Warm Glow, Monochrome Vibes, Green Contrast…) are cheaper with the library's `video-relight-bernini-r`, a prompt-driven video edit, or `palette-transfer-video`.
  * Caption presets add the captions route.
  * Library `wan22-fun-control-14b` (Canny) also fits.
  * Ditto (Wan VACE stylisation module) is **CC-BY-NC-SA**, so it was not added.
  * LTX-2.3 Style Transition is revenue-gated.
* _(inferred)_ Not GPU-tested:
  * mixing a kept first frame with depth control frames in one VACE control video
  * continuity at segment boundaries (reuse the seed, and pass the previous segment's restyled frame as image 2)

### 4c. Mixed Media (`video-stylize-frames`)

The parity studio prices Mixed Media per output frame (4/8/10/12/24 fps, 1–10 s), which means per-frame stylisation. The open route is `mixed-media-zimage-frames`:

```
VHS_BatchManager(framesPerBatch 8) → VHS_LoadVideo(force_rate = fps, frame_load_cap, meta_batch) → ImageScale(W×H)
  ├→ Canny → QwenImageDiffsynthControlnet(Z-Image-Turbo-Fun-Controlnet-Union, strength 0.8)
  └→ VAEEncode → LatentBatchSeedBehavior(fixed)
Z-Image Turbo → AuraFlow(3) → KSampler(8 steps, cfg 1, denoise 0.7) → VAEDecode → VHS_VideoCombine(frame_rate = fps, audio, meta_batch)
```

* **How it runs.** VHS meta-batching re-queues the prompt every `framesPerBatch` frames, so VRAM stays flat however long the clip is.
  * Fixed batch noise reduces flicker.
  * Preview mode is `frames 1`.
  * The preset prompt plus the preset's `param_configs` (colours, dropdown values) become the prompt text.
* **Models:** the library's Z-Image Turbo plus the Fun Union ControlNet (3.10 GB, Apache). 16 GB VRAM.
* **Alternatives:** per-frame Qwen-Edit-2511 or FLUX.2 klein 4B edits, which follow instructions better but are about 10× slower, so best for the preview. For smooth motion instead of the collage look, use the video-model restyle in 4b.
* _(inferred)_ Not GPU-tested:
  * one control frame per latent when the control batch matches the latent batch
  * flicker above denoise 0.7

## 5. Sound effects (`sfx`)

| Option | Workflow | Licence | Size | Notes |
|---|---|---|---|---|
| **Stable Audio 3.0 Small SFX** (recommended) | `sfx-stable-audio-3-small` | Stability Community (free < US$1M revenue) | 2.27 + 1.19 GB | Core nodes; official template `audio_stable_audio_3_medium` with its Qwen3.5 prompt-expansion branch removed and the checkpoint switched to `small_sfx`. lcm, 8 steps, cfg 1, stereo. The same graph takes `stable_audio_3_medium` (9.2 GB, music + SFX) via `checkpoint` |
| Stable Audio Open 1.0 | `sfx-stable-audio-open` | Stability Community | 4.85 + 0.89 GB | Template `audio_stable_audio_example`, 50 steps dpmpp_3m_sde, up to 47.6 s; output switched to MP3 |
| ThinkSound (light) | `sfx-thinksound` (isolated) | **Apache-2.0 weights** | 5.73 + 2.52 + 0.95 GB (+T5/MetaCLIP) | The only permissive SFX model found. `caption` + chain-of-thought `cot_description`; video optional, max 30 s. The wrapper is stale |
| HunyuanVideo-Foley XL fp8 | `sfx-hunyuan-foley` | Tencent Hunyuan (excludes EU/UK/KR) | 3.75 + 0.74 + 0.47 GB | `image` optional, so text-only works; add frames for synced foley. 48 kHz |
| MMAudio text mode | `sfx-mmaudio-t2a` | CC-BY-NC-4.0 | library files | `MMAudioSampler.images` is optional; trained on 8 s |

_(inferred)_ That `small_sfx` takes the same 8-step lcm settings as the distilled medium checkpoint in the same repo.

## 6. Translate & dub (`dubbing`)

Five chained jobs. Every ComfyUI step is validated.

1. **`dub-prepare-separate-transcribe`**:

   ```
   LoadVideo → GetVideoComponents.audio → MelBandRoFormerSampler (MelBandRoformer_fp16, 0.46 GB, MIT)
     ├→ vocals → SaveAudioMP3        ├→ instruments (background) → SaveAudioMP3
     └→ vocals → AILab_Qwen3ASRSubtitle (Qwen3-ASR-1.7B-hf + Qwen3-ForcedAligner-0.6B-hf, Apache)
          → SaveText(segments "start-end: text")  SaveText(transcript)  PreviewAny(detected language)
   ```

   * Qwen3-ASR covers 52 languages and dialects. 30 are selectable in the node; the rest are auto-detected.
   * The aligner gives word timestamps, which the node groups into cues (`split_by_punctuation_or_pause`, `max_chars`).
   * Running ASR on the separated vocals is more robust under music. The models auto-download into `models/Qwen3-ASR` on first run.
   * MelBand separation comes from the template `audio_melbandroformer_audio_separation` (workflow_templates main, 2026-03-30).
2. **Translate.** By default this is Fuobe's LLM (Claude or Ollama), which keeps the timestamps and fits a length budget.
   * All-ComfyUI option: `translate-qwen35-textgen` (core `TextGenerate`, Qwen3.5 4B, Apache).
   * One-step speech → translated text: `speech-translate-gemma4` (core `TextGenerate` with **audio input**, Gemma 4 E4B, Apache). It returns no timestamps, so it suits voice-over dubs.
3. **Voice.** The library's `tts-chatterbox-multilingual`, with `voiceAudio` = the separated vocals to clone the speaker and `language` = the target (23 languages).
   * Synthesise per cue and concatenate with silences to keep the timing, or synthesise the whole script and let the lipsync step re-time the picture.
   * IndexTTS-2 (`duration_factor` in TTS-Audio-Suite) is the duration-controlled alternative.
4. **Lip re-sync**, either of:
   * **`lipsync-v2v-infinitetalk`** (default, Apache, the library's InfiniteTalk GGUF files, so no new weights). Adapted from WanVideoWrapper's `wanvideo_2_1_14B_V2V_InfiniteTalk_example_02`:
     * the source frames are VAE-encoded and only the last 2 of 4 steps are re-denoised (`startStep 2`), so camera, background and body stay
     * it works in 81-frame windows until the audio ends
     * the side-by-side output and the MelBand stage were removed, attention set to `sdpa`, and Windows paths flattened
   * **`lipsync-latentsync16`** (isolated worker, OpenRAIL++). It re-renders **only the mouth** (512² face crop), so identity is preserved best.
     * `VideoLengthAdjuster(loop_to_audio)` extends the picture when the dub is longer.
     * 5.07 GB UNet plus auxiliaries, auto-downloaded.
   * MuseTalk 1.5 (MIT) is another mouth-only option, but no pack installed cleanly on ComfyUI 0.41, so it wasn't validated.
5. **`video-mux-audio`**: `GetVideoComponents` + voice + background (`AudioAdjustVolume`, `AudioMerge add`) → `CreateVideo` → `SaveVideo`.
   * It is also the "voice-over dub" when lipsync is off, and the narration+music mux for Faceless.
   * **Real run:** 1 s, 16 fps video + 2 s voice + 2 s background at −12 dB gave a 1 s MP4 with AAC. CreateVideo trims the audio to the picture.

Risks:

* Translated speech is usually longer than the original.
* Voice-cloning consent: install `resemble-perth` for the Chatterbox watermark.
* The LatentSync wrapper has import-time side effects (above).

## 7. Captions (`captions`)

* **Recommended: `captions-qwen3-asr`.**
  * `LoadVideo` → `GetVideoComponents.audio` → `AILab_Qwen3ASRSubtitle` (0.6B + aligner, `max_chars 32`, `split_by_punctuation_or_pause_or_length`) → `SaveText` cue lines + `PreviewAny` language.
  * The node also writes an `.srt` under `output/fuobe/captions`, but returns only its path, so build SRT/ASS in the app from the cue lines.
  * Render captions with **ffmpeg + libass** on the server. This was verified here with ffmpeg 6.1.1:

    ```
    ffmpeg -i in.mp4 -vf "ass=captions.ass" -c:v libx264 -crf 18 -preset veryfast -c:a copy out.mp4
    Style: BoldCaption,DejaVu Sans,96,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,8,0,2,60,60,320,1
    ```

    The style above uses PlayRes 1080×1920. `{\k25}` karaoke tags per word give the TikTok-style highlight. The fixture clip was scaled to 1080×1920 and two events were burned in; the extracted frame shows the caption and the audio was copied.
  * Each Shorts caption preset becomes an ASS style.
* **Alternative: `captions-whisper-burnin`** (ComfyUI-Whisper): Whisper large-v3-turbo word alignment → `Add Subtitles To Frames` → `VHS_VideoCombine` with audio, + `Save SRT` + `SaveText`.
  * It is all in ComfyUI, but its **code licence is CC-BY-NC-SA**, so it stays opt-in.

## 8. Product spins (`image-to-3d`) and try-on / product shots (`try-on`)

### Image to 3D: `image-to-3d-trellis2`

**TRELLIS.2** (MIT) runs on core nodes in the pinned ComfyUI 0.41, with the official template `3d_pixal3d_trellis2_image_to_model` (2026-08-25). This graph keeps the template's TRELLIS.2 branch:

```
LoadImage → RemoveBackground(BiRefNet) → ImageCropToMask(1024, pad 1.1) → Trellis2Conditioning(DINOv3)
structure (12 steps) → shape (20) → Trellis2UpsampleStage(1536, 12) → Trellis2TextureStage(12)
→ VaeDecodeShape/Texture → RemeshMesh(768) → MeshSmoothNormals → UnwrapMesh → BakeTextureFromVoxel(textureSize)
  + BakeNormalMapFromMesh + BakeAmbientOcclusion → ApplyTextureToMesh(base colour, metallic, roughness, AO, normal)
→ MeshToFile3D → Save3DAdvanced (.glb)
turntable: RotateMesh(mode euler_xyz, angle_y = 0,10,…,350) ×36 → RenderMesh(auto = texture, 768², white)
→ BatchImagesNode(36) → CreateVideo(12 fps) → SaveVideo
```

* **Changes from the template.**
  * The TRELLIS.2 switch is on, with switches resolved.
  * Removed: the Pixal3D/MoGe branch, decimation, the vertex-paint path and preview-only nodes.
  * Added: the turntable section (all core).
* One job yields the **GLB**, for `<model-viewer>`/three.js in the app, and a **3 s spin MP4** for ads.
* **Models:**
  * `trellis_2_int8_convrot`: 5.25 GB
  * shape and texture VAEs: 1.10 + 0.95 GB
  * DINOv3-NAF: 1.22 GB
  * BiRefNet: already in the library
  * 16 GB VRAM class.
* **Alternatives:**
  * **Pixal3D** (MIT, pixel-aligned via MoGe) is one switch away in the template.
  * `image-to-3d-hunyuan3d-21` is native but **shape only** (no Paint stage in core) and covered by the Tencent licence (excludes EU/UK/KR).
  * For a photoreal spin without 3D, use Wan 2.2 i2v with an orbit LoRA or Fun Camera.
* _(inferred)_ RenderMesh auto-framing per rotation.

### Try-on: `tryon-flux2-klein-4b`

FLUX.2 [klein] 4B (Apache) plus the xocialize **try-on LoRA** (Apache, 92 MB, trained with ai-toolkit on klein base 4B):

* **References (order matters):** person, top, bottom. For a dress, pass it as both garments.
* **Clothing-agnostic person, as the LoRA was trained:** ComfyUI-RMBG `ClothesSegment` masks the upper clothes, skirt, dress, pants, belt and scarf (+8 px). `ImageCompositeMasked` then greys that region out.
* **Trigger and settings:** trigger `TRYON`, 4 steps.

Other options:

* **Zero-shot fallback, no new weights:** `qwen-image-edit-2511-multi` with "the person in image 1 wearing the top from image 2 and the trousers from image 3; keep face, pose, body and background". The same graph is the **product-shot / Click-to-Ad** route: product, scene or reference ad, logo. Combine it with the library's `relight-qwen-edit-2509-reference` and `bg-remove-birefnet`.
* FoxBaze Try-On Qwen-Edit LoRA (Apache, original Qwen-Image-Edit, 30 steps): 2511 compatibility unverified.
* fal klein-9B try-on LoRA: the base model is non-commercial.
* CatVTON: CC-BY-NC-SA.

_(inferred)_ That the LoRA, trained on the base checkpoint, works on the 4-step distilled one. Fall back to base, 20 steps, cfg 5.

## 9. Cinema Studio grid (`image-grid`) and Soul Cast (`character-sheet`)

* **`grid-zimage-contact-sheet`** makes one Z-Image Turbo generation of an N×N contact sheet, which matches the parity studio's "same context, same cost".
  * Default: 2048×1152, `gridPrompt` + `prompt`.
  * KJNodes `ImageGridtoBatch(columns, rows)` cuts the sheet into tiles. Both the sheet and the tiles are saved.
  * `gridPrompt` per type:
    * freeform
    * zooms: "the same frame at 9 increasing zoom levels"
    * shots: "nine different shot sizes of the same moment"
  * next_shots and prev_shots continue from a picked tile with the library's `storyboard-qwen-edit-2509-next-scene`.
  * _(inferred)_ Exact equal cells. The app should detect gutters and crop tiles to the requested ratio. Qwen-Image 2512 is the stronger layout follower.
* **`soul-cast-sheet-zimage`** uses the same graph with different settings:
  * 2048×1024, 4×1
  * turnaround prompt: front, three-quarter, profile, back
  * the 17 Soul Cast fields compiled into `prompt`; a batch of 10 means 10 seeds
  * Save the pick as a character element, and optionally train an AI-Toolkit LoRA.
  * For stronger identity across views, use one portrait plus Qwen-Edit-2511 with the Multiple-Angles LoRA (template `templates-1_click_multiple_character_angles-v1.0`).
* **Soul Location** reuses `z-image-turbo-t2i` / `qwen-image-2512-t2i` at 16:9 ("empty …, no people") plus the multi-angle edit.

## 10. Faceless / Explainer (`faceless-explainer`)

No new model. Each step is an existing graph:

1. The script and the scene list come from the LLM.
2. Each scene gets `z-image-turbo-t2i` (or a storyboard) → `wan22-i2v-14b-lightx2v` (frames = narration seconds × 16 + 1).
3. `tts-chatterbox-multilingual` reads the narration, one take per scene.
4. `captions-qwen3-asr` runs on the narration, then the ASS burn-in is applied.
5. `video-concat-N` joins the scenes.
6. `video-mux-audio` adds the narration and a music bed (`music-ace-step-15`, −12 dB).

---

## Cross-cutting risks

* **Licences that keep options out of commercial defaults.** Each of these is offered as an opt-in alternative only.

  | Option | Licence |
  |---|---|
  | Krea-2 (style reference) | Krea 2 Community, thresholds |
  | USO | FLUX.1 [dev] non-commercial |
  | FLUX.2 [dev] multi-reference | FLUX.2 [dev] non-commercial |
  | Ditto | CC-BY-NC-SA |
  | MMAudio | CC-BY-NC |
  | CatVTON | CC-BY-NC-SA |
  | ComfyUI-Whisper code | CC-BY-NC-SA |
  | fal klein-9B try-on (base model) | FLUX.2 klein 9B non-commercial |
  | HunyuanVideo-Foley | Tencent, excludes EU/UK/KR |
  | Hunyuan3D 2.1 | Tencent, excludes EU/UK/KR |
  | Stable Audio | Stability Community, free below US$1M revenue |
  | LTX style LoRAs | LTX, free below US$10M revenue |
* **Auto-downloads at execution.** These download weights the first time they run; pre-seed them on offline servers:
  * Qwen3-ASR and the aligner (`models/Qwen3-ASR`)
  * openai-whisper (`models/stt/whisper`)
  * HunyuanVideo-Foley text encoders (SigLIP2, CLAP)
  * InfiniteTalk wav2vec
  * LatentSync (`snapshot_download` at node init)
  * ThinkSound T5/MetaCLIP
  * ComfyUI-RMBG segformer (try-on)
* **Very new weights:** Stable Audio 3 (2026-05), TRELLIS.2/Pixal3D native (2026-08), the klein try-on LoRA (2026-07), Qwen3-ASR -hf (2026-07). Run one real render per workflow on a GPU before exposing them.
* **GPU budget.** Layered (20.5 GB), Fun VACE restyle (2 × 17 GB) and InfiniteTalk (18 GB) are 24 GB jobs; Mixed Media and SFX are not. Keep separate queues.
* **Chains.** A failed step fails its dependants, per the existing chained-jobs behaviour. Shorts Studio and dubbing are 4–5 jobs deep.

## Sources

- https://huggingface.co/Comfy-Org/Qwen-Image-Layered_ComfyUI — Qwen-Image-Layered repack (bf16 40.86 GB, fp8mixed 20.53 GB, VAE 0.25 GB), Apache-2.0
- https://huggingface.co/DiffSynth-Studio/Qwen-Image-Layered-Control — prompt-guided layer control, Apache-2.0
- https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning — 4-step LoRA (0.85 GB), Apache-2.0
- https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8 — klein 4B (4.07 GB), Apache-2.0
- https://huggingface.co/xocialize/tryon-FLUX.2-klein-4B-lora — try-on LoRA card (inputs, trigger, training)
- https://huggingface.co/FoxBaze/Try_On_Qwen_Edit_Lora_Alpha , https://huggingface.co/fal/flux-klein-9b-virtual-tryon-lora , https://huggingface.co/zhengchong/CatVTON — try-on alternatives
- https://huggingface.co/Comfy-Org/Krea-2 — Krea-2 repack incl. `krea2_style_reference` (Ostris), Krea 2 Community licence
- https://huggingface.co/Comfy-Org/USO_1.0_Repackaged , https://huggingface.co/Comfy-Org/flux1-dev , https://huggingface.co/Comfy-Org/sigclip_vision_384 — USO files
- https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union — Z-Image Fun Union ControlNet (3.10 GB), Apache-2.0
- https://huggingface.co/Comfy-Org/stable-audio-3 , https://huggingface.co/Comfy-Org/stable-audio-open-1.0_repackaged — Stable Audio checkpoints, Stability Community licence
- https://huggingface.co/FunAudioLLM/ThinkSound — ThinkSound weights, Apache-2.0
- https://huggingface.co/phazei/HunyuanVideo-Foley , https://huggingface.co/tencent/HunyuanVideo-Foley — Foley weights, Tencent Hunyuan Community licence
- https://huggingface.co/KimberleyJSN/melbandroformer (MIT), https://huggingface.co/Kijai/MelBandRoFormer_comfy — vocal separation
- https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf , https://huggingface.co/Qwen/Qwen3-ASR-0.6B-hf , https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf — ASR + aligner, Apache-2.0
- https://huggingface.co/Comfy-Org/gemma-4 , https://huggingface.co/google/gemma-4-E4B-it — Gemma 4 (audio input), Apache-2.0
- https://huggingface.co/Comfy-Org/Qwen3.5 — Qwen3.5 text models, Apache-2.0
- https://huggingface.co/ByteDance/LatentSync-1.6 — LatentSync 1.6, OpenRAIL++
- https://huggingface.co/TMElyralab/MuseTalk — MuseTalk, MIT
- https://huggingface.co/QingyanBai/Ditto_models — Ditto stylisation (CC-BY-NC-SA-4.0)
- https://huggingface.co/Comfy-Org/TRELLIS.2 , https://huggingface.co/Comfy-Org/Pixal3D , https://huggingface.co/microsoft/TRELLIS.2-4B — TRELLIS.2 / Pixal3D, MIT
- https://huggingface.co/Comfy-Org/hunyuan3D_2.1_repackaged — Hunyuan3D 2.1, Tencent Hunyuan Community licence
- https://github.com/Comfy-Org/workflow_templates (main, 2026-10-17) — `audio_melbandroformer_audio_separation`, `templates_shane_video_restyle`, `templates-wan2_1_infinitetalk_music`; packaged templates 0.11.86 for the rest
- https://github.com/kijai/ComfyUI-MelBandRoFormer , https://github.com/1038lab/ComfyUI-QwenASR , https://github.com/phazei/ComfyUI-HunyuanVideo-Foley , https://github.com/yuvraj108c/ComfyUI-Whisper , https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper , https://github.com/ShmuelRonen/ComfyUI-ThinkSound_Wrapper , https://github.com/kijai/ComfyUI-WanVideoWrapper (example `wanvideo_2_1_14B_V2V_InfiniteTalk_example_02.json`) — node packs, read at the pinned commits
- https://github.com/jhj0517/ComfyUI-faster-whisper , https://github.com/AIFSH/ComfyUI-WhisperX , https://github.com/kaushiknishchay/ComfyUI-Qwen3-ASR — STT packs considered and not used: FILEPATH-only input and no ui outputs; stale with heavy pyannote; `qwen-asr` pins transformers 4.57.6
