# Fuobe research #2: open-weight ComfyUI approaches for the parity studio's remaining gaps

_As of 2026-10-16. Machine-readable companion: [`comfyui-oss-2.json`](comfyui-oss-2.json), which has the full API-format graphs, bindings, live `/object_info` node specs, model URLs and sizes, and validation results. This file builds on [`comfyui-oss.md`](comfyui-oss.md) (capability rankings) and [`comfyui-workflow-library.md`](comfyui-workflow-library.md) (the existing workflow library)._

## How this was produced and what "verified" means

* **Source read, pinned commits:** ComfyUI core `fc04da91` (v0.41.0-7, the same commit as the library), Comfy-Org/workflow_templates `04a508b` (2026-10-16, 707 templates), and these packs: ComfyUI-KJNodes `17195fcf`, ComfyUI-WanVideoWrapper `088128b2`, ComfyUI_Fill-ChatterBox `f7d7a161`, ComfyUI-IndexTTS2 `5b33e02b`, TTS-Audio-Suite `3f3832a0` (v5.10.3), ComfyUI-VibeVoice (wildminder) `de6ee6bf`, SeedVC-ComfyUI `10731e18`, ComfyUI-LTXVideo `44c8a36b`, ai-toolkit `dcebc744`, ComfyUI-FluxTrainer `09fef403`, ComfyUI-Video-Depth-Anything `a0db08e6`. Every pack's `ref` is listed in the JSON.
* **Live validation:** a CPU ComfyUI at `fc04da91` was started in a scratch directory with KJNodes, Fill-ChatterBox, VibeVoice and Video-Depth-Anything installed. Every graph that has `validation.postPrompt: true` was accepted by `POST /prompt` (HTTP 200, a `prompt_id`, no `node_errors`) with zero-byte placeholder weights and uploaded fixtures. A KJNodes `Sleep` blocker held the worker, so nothing ran. This is the same method as `scripts/comfy/validate-workflows.mjs`. A negative test (a renamed input, and a STRING wired into TRACKS) was rejected, which shows the check is real. The `nodes` arrays in the JSON were dumped from that server's `/object_info`, so input names, types, defaults and options match what the server accepts.
* **Validation does not prove quality.** No model was run. Settings, VRAM and quality notes come from the templates, model cards and source. Anything that could only be inferred is listed under `inferred` on each option and marked _(inferred)_ below.
* **Not validated live:** IndexTTS-2 and Seed-VC. Their dependencies (pynini/WeTextProcessing, and an old pinned stack) could not be installed on the CPU box. Their graphs were transcribed from `INPUT_TYPES` in their source.

**Result: the JSON has 24 graphs. 22 passed live `/prompt` validation; the other 2 (IndexTTS-2, Seed-VC) were checked against source only.**

## Summary: recommendation per gap

| Gap | Capability id | Recommended | Nodes | License | VRAM | Download | Live-validated |
|---|---|---|---|---|---|---|---|
| 1 TTS clone | `tts-clone` | **Chatterbox Multilingual** (`FL_ChatterboxMultilingualTTS`, 23 languages); #2 **IndexTTS-2** | Fill-ChatterBox | MIT weights | ~6 GB | 3.2 GB (auto) | yes / source-only |
| 1 Dialogue | `tts-dialogue` | **Chatterbox Dialog** (`FL_ChatterboxDialogTTS`, up to 4 speakers); quality option **VibeVoice** | Fill-ChatterBox / VibeVoice | MIT / MIT, card says research use only | ~6 / ~10 GB | 3.2 / 5.4 GB | yes / yes |
| 2 Voice change | `voice-change` | **Chatterbox VC** (`FL_ChatterboxVC`) | Fill-ChatterBox | MIT weights | ~3 GB | 1.1 GB | yes |
| 3 Extend | `video-extend` | **Wan 2.2 Fun VACE A14B** context-frame continuation + `ImageBatchExtendWithOverlap` | core + KJNodes | Apache-2.0 | 24 GB | 44 GB (35 GB new) | yes |
| 4 Reframe | `video-reframe` | **Wan 2.2 Fun VACE A14B outpainting** (`ImagePadForOutpaint` mask on every frame) | core | Apache-2.0 | 24 GB | 44 GB (shared with 3) | yes |
| 5 Relight (image) | `relight` | **Qwen-Image-Edit-2509 + Relight LoRA** (library `qwen-image-edit-2509` + 1 node) | core | Apache-2.0 | 24 GB | +0.24 GB | yes |
| 5 Relight (video) | `video-relight` | **Bernini-R** video edit (`BerniniConditioning`, Wan 2.2 A14B fine-tune) | core | Apache-2.0 | 24 GB | 38.8 GB | yes |
| 6 Draw-to-video | `draw-to-video` | **Wan-Move 14B** (`WanMoveTracksFromCoords` → `WanMoveTrackToVideo`) | core | Apache-2.0 | 24 GB | 25.4 GB (16.4 GB new) | yes |
| 7 Multi-shot | `multi-shot` | **LTX-2.5 native multishot** through the existing `ltx25-t2v`/`ltx25-i2v`; commercially clean fallback: storyboard → Wan per shot → concat graph | core | LTX-2 Community (< US$10M) / Apache | 24 GB | 0 | concat graph yes; prompt syntax _(inferred)_ |
| 8 Soul ID | `character-lora` | **ai-toolkit** headless (YAML job / UI job API), Z-Image Turbo + training adapter | ai-toolkit | MIT tool; LoRA inherits the base model license | 16–24 GB | base models | job schema from source; `TrainLoraNode` alternative yes |
| 9 Storyboard | `storyboard` | **Qwen-Image-Edit-2509 + next-scene LoRA v2**, chained, with the character reference as image2 | core | Apache + MIT | 24 GB | +0.3 GB | yes |
| 10 Video alpha | `video-bg-remove` | **BiRefNet** on every frame (`RemoveBackground`) → RGBA **VP9 WebM** (`SaveWEBM`); SAM 3.1 video tracking for "keep only X" | core | MIT | 4 GB | 0.44 GB | yes |
| 10 Video depth | `video-depth` | **Depth Anything 3 mono-large** (core); temporally stable option: Video Depth Anything Small | core / VDA pack | Apache-2.0 | 4 GB | 1.3 GB | yes / yes |
| 11 Soul HEX | `palette` | **Core `ColorTransfer`** against a palette swatch the app renders, plus **FLUX.2 hex codes** in prompts | core | none (no model) | CPU | 0 | yes |

Adding every recommended option costs **about 85 GB of new non-TTS weights** (Fun VACE 34.7 GB, Bernini-R 31.1 GB, Wan-Move 16.4 GB, DA3 1.3 GB, LoRAs about 1.2 GB), plus about 7.5 GB of TTS weights that the packs auto-download. The UMT5, Wan VAE, CLIP-vision, Qwen-Edit and Wan 2.2 I2V files are already in the library.

### What Fuobe has to add

* **Node packs** (add to `scripts/comfy/install-comfyui.sh` at the commits above): `filliptm/ComfyUI_Fill-ChatterBox` (TTS, dialogue, VC) and optionally `wildminder/ComfyUI-VibeVoice` (also needs `pip install gguf`, which its `requirements.txt` leaves out; without it the pack fails to import) and `yuvraj108c/ComfyUI-Video-Depth-Anything`. KJNodes is already pinned and is used by `video-extend`. Everything else is core ComfyUI.
* **New binding keys.** These are passed through `ProviderInput.extra` and are not yet in `BindingKey`:
  * Audio: `text` (TTS script), `voiceAudio`, `voiceAudio2` (reference clips), `language`, `exaggeration`, `cfgWeight`, `temperature`
  * Video: `tracks` (JSON), `motionStrength`, `contextFrames`, `contextFramesNegative`, `newFrames`, `sourceWidth`, `sourceHeight`, `video2`, `video3`
  * Image/palette: `loraStrength` (already present), `objectIndices`, `resolution`, `method`, `strength`
  * Training: `datasetFolder`, `learningRate`, `rank`

  The existing `pad*` keys are reused by reframe.
* **Upload kinds.** `voiceAudio*` are audio uploads, just like `audio`. `SaveWEBM` reports its file under `ui.images` with `animated: true` (verified in `comfy_api/latest/_ui.py`), so `collectFiles` has to classify `.webm` by extension.

---

## 1. Text-to-speech with voice cloning (`tts-clone`) and dialogue (`tts-dialogue`)

Core ComfyUI still has no local TTS node; the official TTS templates are API partner nodes, except the four **Chatter Box** community templates, which use the Fill-ChatterBox pack.

**Recommendation 1: Chatterbox Multilingual.** Graph: `LoadAudio(voice) → FL_ChatterboxMultilingualTTS(audio_prompt) → SaveAudioMP3`. This matches the official template `audio-chatterbox_tts_multilingual`.

* Inputs (from `/object_info`):
  * `text` STRING
  * `language`: a combo of `"Name (code)"` strings, 23 languages, default `"English (en)"`
  * `exaggeration` 0.5, `cfg_weight` 0.5, `temperature` 0.8, `repetition_penalty` 2.0, `min_p` 0.05, `top_p` 1.0, `seed`
  * Optional: `audio_prompt` AUDIO, `use_cpu`, `keep_model_loaded`
  * Outputs: `(AUDIO, STRING)`
* Bindings: `text → 2.text`, `voiceAudio → 1.audio`, `language`, `seed`, `exaggeration`, `cfgWeight`, `temperature`.
* Models: auto-downloaded from `ResembleAI/chatterbox` into `models/chatterbox/chatterbox_multilingual/` (`t3_mtl23ls_v2.safetensors` 2.14 GB, `s3gen.pt` 1.06 GB, `ve.pt`, tokenizer JSONs, `conds.pt`). The HF repo already has a `t3_mtl23ls_v3` checkpoint that this pack does not use yet; TTS-Audio-Suite exposes v1, v2 and v3.
* About 6 GB VRAM _(inferred)_. Fast: a 0.5B Llama-style T3 plus the S3Gen vocoder.
* English-only variants: `FL_ChatterboxTTS` and `FL_ChatterboxTurboTTS`. Turbo supports paralinguistic tags such as `[laugh]` and `[sigh]` and takes top_k, top_p and repetition_penalty instead of exaggeration and cfg.
* License: weights MIT. The pack repo has no LICENSE file.

**Recommendation 2: IndexTTS-2** (best emotion and timing control, for example when dubbing to an existing lip track). Graph: `LoadAudio → IndexTTS2Simple(audio, text, emotion_control_weight=1.0, [emotion_audio], [emotion_vector], use_fp16, output_gain) → SaveAudioMP3`.

* `IndexTTS2EmotionVector` and `IndexTTS2EmotionFromText` (a Qwen 0.6B emotion model) feed `emotion_vector`.
* TTS-Audio-Suite wraps the same weights (and IndexTTS-2.5) as `IndexTTSEngineNode` → `UnifiedTTSTextNode`, adding `duration_factor` and `language`.
* Models: `IndexTeam/IndexTTS-2` (gpt.pth 3.48 GB, s2mel.pth 1.2 GB, qwen0.6bemo4 1.19 GB, plus w2v-bert, MaskGCT and BigVGAN fetched on first run) go in `custom_nodes/ComfyUI-IndexTTS2/checkpoints`.
* About 8 GB VRAM.
* License: the bilibili Model Use License allows commercial use **unless** you exceed 100M MAU or RMB 1B revenue; it also forbids using the model to improve other models.
* Validated against source only. Its deps (pynini, WeTextProcessing, modelscope) suggest running it in an isolated worker.

**Dialogue: Chatterbox Dialog** (official template `audio-chatterbox_tts_dialog`). Graph: `FL_ChatterboxDialogTTS(dialog_text, speaker_A_Audio, speaker_B_Audio, [speaker_C_Audio, speaker_D_Audio], exaggeration, cfg_weight, temperature, seed)`.

* The script uses `SPEAKER A: …` lines, parsed with `startswith` in `chatterbox_dialog_node.py`.
* Outputs: the mixed `dialog_audio` plus four per-speaker stems. The stems are handy for multi-person InfiniteTalk.
* Uses the English model.

**Dialogue, quality option: VibeVoice** 1.5B (5.4 GB) or 7B (18.7 GB; `quantize_llm_4bit` makes it fit in about 10 GB). Graph: `VibeVoiceTTS(model_name, text "[1] … / [2] …", speaker_1..4_voice, cfg_scale 1.3, inference_steps 10, …)`.

* Validated live after installing `gguf`.
* Most natural long-form turn-taking (up to 90 min, 4 speakers).
* License: weights MIT, but Microsoft's card limits use to **research only**, so it is not a safe commercial default.
* Commercially clean long-dialogue alternative: **MOSS-TTSD 8B** (Apache) through TTS-Audio-Suite.

**Others considered:**

| Model | How to run it | License | Verdict |
|---|---|---|---|
| Qwen3-TTS 1.7B | TTS-Audio-Suite | Apache | Clean clone plus voice design; best #3 |
| Higgs Audio v2 3B | TTS-Audio-Suite `HiggsAudioEngineNode` | Boson community license (free up to 100k annual active users) | Very expressive |
| Higgs Audio v3 | TTS-Audio-Suite | research / non-commercial | Skip |
| F5-TTS | — | CC-BY-NC | Skip |

TTS-Audio-Suite (19 engines, actively maintained) uses an engine-node → `UnifiedTTSTextNode(TTS_engine, text, narrator_voice, seed, opt_narrator)` pattern. If Fuobe wants many engines behind one graph shape, it is the right pack. The trade-off is a heavy install with isolated runtimes.

Risks: consent and watermarking for cloned voices (install `resemble-perth` so Chatterbox's Perth watermark is active), and auto-downloads on first execution (pre-seed `models/chatterbox`).

## 2. Voice conversion (`voice-change`)

**Recommendation: Chatterbox VC** (official template `audio-chatterbox_vc`). Graph: `LoadAudio(source) + LoadAudio(target) → FL_ChatterboxVC(input_audio, target_voice, seed) → SaveAudioMP3`.

* It is zero-shot and keeps the source timing and performance.
* Model: `s3gen.pt` (1.06 GB) + `conds.pt`, about 3 GB VRAM, MIT.
* To re-voice a video in one graph: `GetVideoComponents.audio → FL_ChatterboxVC → CreateVideo(audio=…)`.

**Alternatives:**

* **Seed-VC.** Best timbre similarity and a 44 kHz singing model. GPL-3.0 code and weights; the AIFSH pack has not been updated since 2024-11-14.
  * `SeedVCNode(source, target, diffusion_steps=10 (50–100 best), length_adjust, inference_cfg_rate=0.7)`
  * `SeedVC4SingNode` adds `pitch_shift` and `auto_f0_adjust`.
* **RVC** through TTS-Audio-Suite: `LoadRVCModelNode` + `RVCEngineNode` → `UnifiedVoiceChangerNode`. It needs a trained `.pth` per voice, which the suite can also train. Use it for "my persistent voice".
* **CosyVoice3 VC** (Apache) through TTS-Audio-Suite.

## 3. Video extend (`video-extend`)

**Recommendation: Wan 2.2 Fun VACE A14B context-frame continuation.** Everything is core plus one KJNodes node.

```
LoadVideo → GetVideoComponents → ImageScale(W×H)
  ├─ ImageFromBatch(batch_index=-16, length=16)      # last 16 frames = known context
  │    + EmptyImage(gray 0x7F7F7F, newFrames) → BatchImagesNode → control_video
  ├─ EmptyImage(black,16)+EmptyImage(white,newFrames) → BatchImagesNode → ImageToMask(red) → control_masks
  └─ WanVaceToVideo(W,H,length=81) → KSamplerAdvanced high(0→2) → low(2→4) [Fun VACE high/low + T2V lightx2v]
       → TrimVideoLatent(trim_latent) → VAEDecode
       → ImageBatchExtendWithOverlap(source=resized clip, overlap=16, linear_blend) → CreateVideo → SaveVideo
```

* **Verified in source:**
  * `WanVaceToVideo` encodes `inactive = video·(1-mask)` and `reactive = video·mask`, and pads missing frames with gray and mask 1 (`nodes_wan.py`). So mask 0 means "keep" and mask 1 means "generate".
  * `ImageFromBatch` accepts a negative `batch_index`, counted from the end (`nodes_images.py`).
  * `ImageBatchExtendWithOverlap` returns `source[:-n] + blend(source[-n:], new[:n]) + new[n:]` and requires the same H×W (`KJNodes image_nodes.py`).
* **Bindings.** The app computes the derived values: `newFrames = frames − contextFrames` and `contextFramesNegative = −contextFrames`. Each run adds 65 frames (about 4 s at 16 fps). Loop the job to extend further.
* **Models:** Fun VACE high and low fp8 (17.35 GB each), T2V lightx2v LoRAs (1.23 GB each); UMT5 and VAE are shared. 24 GB VRAM, Apache-2.0.
* _(inferred)_ The Wan 2.2 T2V lightx2v LoRAs work with Fun VACE (same A14B T2V base); shift 5, 4 steps and split 2 are copied from the library's wan22 workflows. Resample input clips to 16 fps first.

**Alternatives:**

* **SVI 2.0 Pro (Stable Video Infinity).** Best for very long, many-chunk videos. Graph: `VAEEncode(first frame) → anchor`, `VAEEncode(last 5 frames) → prev_samples`, then `WanImageToVideoSVIPro(positive, negative, length, anchor_samples, prev_samples, motion_latent_count=1)` (KJNodes) feeding Wan 2.2 I2V high/low + the `SVI_v2_PRO_Wan2.2-I2V-A14B_{HIGH,LOW}` LoRAs (1.23 GB each, MIT) + I2V lightx2v. Validated.
  * Verified in source: only latent 0 is masked as known; the motion latent is appended after the anchor.
  * _(inferred)_ Frame bookkeeping: drop the decoded anchor frame, then blend a 4-frame overlap. In real chaining, pass the previous chunk's **sampler latent** as `prev_samples`; the VAE round trip used for the first extension is an approximation.
* **Wan 2.2 I2V with a multi-frame start_image** (library `wan22-i2v-14b-lightx2v`, with LoadImage replaced by the last 5 frames). Validated. `WanImageToVideo` copies `start_image[:length]` into the first frames and masks `((n−1)//4)+1` latents. It is the simplest option but has the weakest continuity.
* **LTX-2.x `LTXVExtendSampler`** (ComfyUI-LTXVideo): `num_new_frames=80`, `frame_overlap=16`, `strength=0.5`. It extends with synchronized audio and is best when the source came from LTX. LTX license applies.
* **MiniMax H3 continuation** (core template). Territory-restricted license, so it does not fit Fuobe.

## 4. Video reframe / outpaint (`video-reframe`)

**Recommendation: Wan 2.2 Fun VACE A14B outpainting.** This is the official `video_wan_vace_outpainting` template re-targeted to Wan 2.2 Fun VACE.

```
LoadVideo → GetVideoComponents → ImageScale(sourceW×sourceH) → ImagePadForOutpaint(l,t,r,b, feathering 0)
   image → control_video ; mask → MaskToImage → RepeatImageBatch(frames) → ImageToMask(red) → control_masks
   → WanVaceToVideo(W=sourceW+l+r, H=sourceH+t+b) → 2-stage Fun VACE sampler → TrimVideoLatent → VAEDecode → SaveVideo
```

* The app picks `sourceWidth` and `sourceHeight` so the padded size hits the target aspect ratio: multiples of 16, with pads in steps of 8 (`ImagePadForOutpaint` step). Example: 9:16 368×640 → 16:9 1136×640 with 384 px left and right.
* Verified: `ImagePadForOutpaint` fills the padding with 0.5 gray and sets mask = 1 there (`nodes.py`).
* `frames` must be ≤ the source frame count. Longer clips need windowing, reusing the video-extend known-frame trick.
* Alternatives:
  * Template-exact **Wan 2.1 VACE 14B + CausVid** (single KSampler, uni_pc, 4 steps, shift 8). Validated; uses the library's VACE files.
  * **LTX-2.3/2.5 Video Outpainting IC-LoRA** (`template_ltx2_3_lora_video_outpainting`, needs LTXVideo, KJNodes, VHS and ComfyMath). Higher resolution and keeps the audio; revenue-gated.

## 5. Relight: image (`relight`) and video (`video-relight`)

**Image: Qwen-Image-Edit-2509 + Relight LoRA** (official template `image_qwen_image_edit_2509_relight`). It is the library's `qwen-image-edit-2509.json` with two added nodes:

* Node `1001` is a `LoraLoaderModelOnly` inserted between `433:89` (the Lightning LoRA) and `433:66`.
* Node `1002` is a `StringConcatenate` that prefixes the trigger `重新照明,` ("relight,") to the user prompt.

Settings and license: 4 steps, cfg 1, the LoRA is 0.24 GB, Apache-2.0. Validated.

**Light from a reference image: Light-Migration LoRA** (template `templates-portrait_light_migration`). The reference image is wired as `image2` of both `TextEncodeQwenImageEditPlus` nodes, and the template's instruction prefix tells the model to use image 2's lighting and tone to relight image 1. Validated.

* IC-Light v2 (FLUX) weights were never released. IC-Light v1 (SD1.5, kijai pack) is legacy and its license is unclear.
* FLUX Kontext relight LoRAs sit on a non-commercial base.
* Bernini-R image editing (core) is another Apache option.

**Video: Bernini-R** (ByteDance, Apache-2.0, a Wan 2.2 A14B fine-tune; core node `BerniniConditioning`; official template `video_bernini_r_video_editing`).

```
LoadVideo → GetVideoComponents.images → BerniniConditioning(source_video, W,H,length)
StringConcatenate(system prompt "…adjust the video's style, lighting, colors…", user prompt) → CLIPTextEncode
UNET high/low (+ lightx2v T2V v2 rank64 @3.0 / @1.5) ; BasicScheduler(6) → SplitSigmas(3) ; SamplerCustom ×2 (res_multistep, cfg 1)
→ VAEDecode → CreateVideo → SaveVideo
```

* This is the template subgraph with its turbo switch on, flattened. With turbo off: 40 steps split at 20, cfg 5, no LoRA.
* Models: 15.6 GB per expert in fp8 (int8_convrot and mxfp8 variants also exist). 24 GB VRAM. Validated.
* This is the only open, native, prompt-driven **video** relight. Wan Animate and SCAIL-2 relight LoRAs only apply inside character replacement.
* _(inferred)_ Relight quality.

## 6. Draw-to-video / trajectory control (`draw-to-video`)

**Recommendation: Wan-Move 14B 480p.** Core nodes since 0.5.0, official template `video_wanmove_480p`, Apache-2.0.

```
LoadImage → ImageScale(832×480) ; PrimitiveStringMultiline(tracks JSON) → WanMoveTracksFromCoords
CLIPVisionEncode(clip_vision_h) ; WanMoveTrackToVideo(tracks, strength, W,H,length, start_image, clip_vision_output)
UNET Wan21-WanMove fp8 (16.4 GB) + lightx2v I2V 480p → ModelSamplingSD3(8) → KSampler(6 steps, cfg 1, er_sde) → VAEDecode → SaveVideo
```

* **Track format, verified in `nodes_wanmove.py`.** `tracks` is a JSON list of tracks. Each track is a list of `{"x": px, "y": px}` with **one point per output frame**, in the pixel space of the resized image, and all tracks have the same length.
* The client resamples each stroke to `frames` points and adds a few parallel tracks per object; `GenerateTracks` shows the spreading pattern. A constant-position track pins the background.
* `track_coords` is `forceInput`, so the binding targets a `PrimitiveStringMultiline` node.
* Without the LoRA: 20 steps, cfg 6. `WanMoveVisualizeTracks` previews the paths.

**Alternatives:**

* **ATI** (native `WanTrackToVideo`, template `video_wan_ati`). `tracks` is a plain STRING widget of tracks with **121 points** each (24 fps samples over 5 s); 20 steps, cfg 3, uni_pc. Validated.
* **Wan 2.2 Time-to-Move** (WanVideoWrapper `WanVideoAddTTMLatents`, example workflow in the pack). Cut-and-drag: the app renders a crude animation of the object moving along the drawn path and TTM makes it realistic at Wan 2.2 quality. Wrapper-only.
* **LTX-2.5 Motion-Track IC-LoRA.** Revenue-gated.

## 7. Multi-shot / multi-scene (`multi-shot`)

**Recommendation: LTX-2.5 native multishot**, using the **existing** `ltx25-t2v` and `ltx25-i2v` workflows, so no new graph is needed.

* The Lightricks model card and the template notes confirm "one generation yields multiple connected shots holding character, environment, lighting, voice, and style across cuts".
* Prompts are written as an ordered shot list with explicit cut cues. Keep 8–20 s at 24 fps (frameStep 8).
* _(inferred)_ The exact prompt syntax: Lightricks' prompting guide at docs.ltx.video returned 403 from this box.
* License: LTX-2 Community, free below US$10M entity revenue.

**Commercially clean alternative: chain the shots.**

1. Make storyboard panels (gap 9).
2. Run one `wan22-i2v-14b-lightx2v` job per shot, or `wan22-flf2v-14b` between panel N and N+1 for match cuts.
3. Join the shots with the validated concat graph `LoadVideo×N → ImageScale → BatchImagesNode(images.image0..N) → CreateVideo → SaveVideo`.

Add sound afterwards with v2a or music.

**Other options:**

| Option | License | Status |
|---|---|---|
| **HoloCine** | **CC-BY-NC-SA-4.0** | No ComfyUI node found; WanVideoWrapper@088128b has no HoloCine code. Skip. |
| **SVI-shot / film-transition LoRAs** | MIT | Wan 2.1 I2V |
| **EchoShot** | — | Wan 2.1 1.3B, portrait only |

`verified: false` because the recommendation depends on prompt syntax that could only be inferred.

## 8. Character LoRA training, Soul ID parity (`character-lora`)

**Recommendation: ostris/ai-toolkit as a headless training worker** (MIT). The JSON's `jobConfigs` has five ready job objects. They are the same structure as the UI's `defaultJobConfig` and the `config/examples` YAMLs; serialize them as YAML for the CLI or send them as JSON to the UI API.

| Job | `model.arch` | Base | Key settings |
|---|---|---|---|
| `zimage-turbo-character` | `zimage:turbo` | `Tongyi-MAI/Z-Image-Turbo` | `assistant_lora_path: ostris/zimage_turbo_training_adapter/zimage_turbo_training_adapter_v2.safetensors` (de-distill adapter, training only); qfloat8; low_vram; rank 16; 2500 steps; samples at 9 steps, cfg 1 |
| `flux3-klein-base-character` | `flux3` | `black-forest-labs/flux-3-image-klein-base` (gated) | convrot8; timestep shift; 28-step samples |
| `flux1-dev-character` | `is_flux: true` | `black-forest-labs/FLUX.1-dev` (NC, gated) | quantize; 2000 steps |
| `qwen-image-2512-character` | `qwen_image:2512` | `Qwen/Qwen-Image-2512` | uint3 + accuracy-recovery adapter; 24 GB |
| `wan22-14b-t2v-character` | `wan22_14b` | `ai-toolkit/Wan2.2-T2V-A14B-Diffusers-bf16` | uint4 + ARA; trains both experts; `switch_boundary_every: 10`; num_frames 1 on stills |

**Verified from source:**

* `model.arch` values like `zimage:turbo` are split at `:` (`toolkit/config_modules.py:775`). The suffix only selects UI defaults (`extensions_built_in/diffusion_models/ui.tsx`).
* CLI: `python run.py <config.yaml> [-n name] [-l log] [-r]`.
* UI on port 8675:
  * Auth: `Authorization: Bearer $AI_TOOLKIT_AUTH`, required only when that env var is set (`ui/src/middleware.ts`).
  * `POST /api/jobs {name, gpu_ids, job_config}` creates a job (409 if the name exists).
  * `GET /api/jobs/<id>/start` queues it.
  * `GET /api/jobs?id=<id>` returns `status`, `step`, `total_steps` and `info`.
  * Also: `GET /api/jobs/<id>/log`, `/files` (lists `.safetensors`), `/stop`, `/samples`.

**Dataset layout:** a folder of jpg/jpeg/png files with same-name `.txt` captions (webp is unsupported). Images are aspect-bucketed and never upscaled. Use `[trigger]` in captions together with `trigger_word`.

Typical values _(inferred)_: 15–30 varied photos, rank 16–32, lr 1e-4, 2000–3000 steps, a save every 500 steps, and a pick by sample review. VRAM is about 16–24 GB with low_vram and quantization (preset targets, not measured).

Output: copy `<training_folder>/<name>/<name>.safetensors` to `models/loras/fuobe/<user>/` and inject it with Fuobe's `injectLoras`. Run training on a separate GPU or worker, because jobs hold the GPU for 20–90 min.

**ComfyUI-native alternative (validated): core `TrainLoraNode`.** Graph: `LoadImageTextDataSetFromFolder(input/<folder>) → MakeTrainingDataset(images, vae, clip, texts) → TrainLoraNode → SaveLoRA`.

* Verified `TrainLoraNode` inputs:
  * Data and model: `model`, `latents`, `positive`
  * Optimisation: `batch_size`, `grad_accumulation_steps`, `steps` 16, `learning_rate` 5e-4, `rank` 8, `optimizer` AdamW/Adam/SGD/RMSprop, `loss_function` MSE/L1/Huber/SmoothL1, `seed`
  * Precision and algorithm: `training_dtype`, `lora_dtype`, `quantized_backward`, `algorithm` LoRA/LoHa/LoKr/OFT
  * Memory and resume: `gradient_checkpointing`, `checkpoint_depth`, `offloading`, `existing_lora`, `bucket_mode`, `bypass_mode`
  * Outputs: `(LORA_MODEL, LOSS_MAP, steps)`
* It is experimental and has no captioning or sampling tooling.
* `SaveLoRA` writes `output/<prefix>_<steps>_steps_<counter>_.safetensors`, so the app must move the file into `models/loras`.
* Training the distilled Turbo model directly, without the adapter, degrades it.

**Other trainers:**

* `kohya-ss/musubi-tuner`: scriptable, strongest for video.
* `kijai/ComfyUI-FluxTrainer`: FLUX.1 only and stale since 2025-04. Nodes: `InitFluxLoRATraining`, `FluxTrainModelSelect`, `TrainDatasetGeneralConfig`, `TrainDatasetAdd`, `OptimizerConfig*`, `FluxTrainLoop`, `FluxTrainAndValidateLoop`, `FluxTrainSave`, `FluxTrainEnd`, `VisualizeLoss`, `ExtractFluxLoRA`.

## 9. Storyboard / consistent sequence, Popcorn parity (`storyboard`)

**Recommendation: chain Qwen-Image-Edit-2509 with the next-scene LoRA v2** (`lovis93/next-scene-qwen-image-lora-2509`, MIT, 0.3 GB, strength 0.7–0.8 per the model card, prompt prefix `Next Scene:`).

* It is the library's `qwen-image-edit-2509` plus three nodes: `LoraLoaderModelOnly` 1001, a `StringConcatenate` prefix (1002), and a second `LoadImage` (1003) wired as `image2` of both text encoders.
* For each panel: `image` = the previous panel, `image2` = the character or product reference (re-injected every panel to stop drift), and the prompt = camera move plus story beat. Validated.
* Start panel 1 from `z-image-turbo-t2i` with the user's character LoRA.

**Alternatives:**

* The library's **`qwen-image-edit-2511-multi`** (3 references; each panel generated independently from the same references, so no drift but less continuity). The next-scene LoRA loads on 2511 (same architecture) but that is untested.
* **`flux2-dev-multiref`**: the strongest multi-reference consistency, but non-commercial.
* Qwen Image 2.1 Next-Scene LoRA (Apache) on a non-commercial base.

## 10. Video background removal / alpha (`video-bg-remove`) and video depth (`video-depth`)

**Alpha: BiRefNet on every frame.**

```
LoadVideo → GetVideoComponents.images → RemoveBackground(LoadBackgroundRemovalModel birefnet)
→ InvertMask → JoinImageWithAlpha → SaveWEBM(codec vp9)      # real transparency (yuva420p)
        └→ MaskToImage → CreateVideo → SaveVideo                # matte MP4 for compositing
```

* Verified:
  * `comfy/bg_removal_model.py` loops over the image batch.
  * `SaveWEBM` writes alpha when the images are RGBA and the codec is vp9.
  * `JoinImageWithAlpha` stores `1 − mask`, which is why `InvertMask` is needed; the library's `bg-remove-birefnet` does the same.
* MIT, 0.44 GB, about 4 GB VRAM. Validated.
* Per-frame, so hair edges may flicker _(inferred)_. Comfy-Org/BiRefNet also ships `lucida.safetensors` (0.88 GB). The core loader only recognises BiRefNet-architecture keys (`comfy/bg_removal_model.py`), so lucida works only if it is a BiRefNet variant _(unverified)_.

**"Keep only X": SAM 3.1 video tracking** (core, template `utility_video_segment_sam3`).

* Graph: `CheckpointLoaderSimple(sam3.1_multiplex_fp16, 1.75 GB) → CLIPTextEncode("person") → SAM3_VideoTrack(images, model, conditioning, detection_threshold 0.5, max_objects 4, detect_interval 1) → SAM3_TrackToMask(object_indices) → InvertMask → JoinImageWithAlpha → SaveWEBM`. Validated.
* License: the Meta SAM License, royalty-free and commercial use allowed.
* Hard edges; multiply with the BiRefNet matte for hair.

**Depth: Depth Anything 3 mono-large** (core, template `utility_depth_anything3_video_depth_estimation`, Apache; the DA3 Large and Giant variants are NC).

* Graph: `LoadDA3Model → DA3Inference(resolution 504 step 14, mode="mono") → DA3Render(output="depth", "output.normalization"="v2_style") → CreateVideo → SaveVideo`.
* `mode` and `output` are DynamicCombo inputs, written as dotted keys in API format. Validated.
* It is per-frame.

**Temporally stable alternative: Video Depth Anything Small** (Apache; Base and Large are CC-BY-NC) through `yuvraj108c/ComfyUI-Video-Depth-Anything`: `LoadVideoDepthAnythingModel → VideoDepthAnythingProcess(input_size 518, max_res 1280, fp16) → VideoDepthAnythingOutput(gray)`. Validated.

> **Bug found via `/object_info`:** the loader's declared default `video_depth_anything_vits.safetensors` is not in its own option list. Always pass `model` explicitly.

## 11. Color palette control, Soul HEX parity (`palette`)

There is no open "palette-conditioned" diffusion adapter worth adopting. Use two layers instead:

1. **Generation:** FLUX.2 understands hex codes. This is verified in BFL's FLUX.2 prompting guide ("FLUX.2 supports precise color matching using hex codes"; syntax such as `Walls: #C4725A`, and gradients "starting with color #02eb3c and finishing with color #edfa3c"). Palette presets become prompt text on `flux2-dev-t2i` or `flux2-dev-edit` (NC). FLUX.2 klein 4B is Apache, and hex support there is _(inferred)_.
2. **Deterministic lock (recommended graph):** core **`ColorTransfer`**`(image_target, image_ref, method reinhard_lab|mkl_lab|histogram, source_stats per_frame|uniform|target_frame (+target_index), strength)`.
   * `image_ref` is a swatch PNG the app renders from the HEX list, with bands weighted by intended coverage.
   * For video, use `source_stats="uniform"` to avoid flicker.
   * Validated; no model; runs on CPU.
   * A fully client-side equivalent: k-means palette extraction plus LAB histogram matching in WebGL or canvas.

**Alternatives:**

* KJNodes `ColorMatch` (mkl, hm, reinhard, mvgd, hm-mvgd-hm, hm-mkl-hm).
* Qwen-Edit-2511 with the swatch as `image2` (semantic recolor).
* Recraft color control (paid API, the closest closed equivalent).

Risk: histogram matching shifts skin tones. Mask faces with SAM3 or keep strength ≤ 0.8.

---

## Cross-cutting risks

* **Licenses that disqualify options for commercial Fuobe defaults:**

  | Option | License |
  |---|---|
  | HoloCine | CC-BY-NC-SA |
  | F5-TTS | CC-BY-NC |
  | Higgs Audio v3 | research / non-commercial |
  | VibeVoice | card restricts use to research |
  | FLUX.1 / FLUX.2 [dev], Qwen Image 2.1 | non-commercial |
  | Video Depth Anything Large, DA3 Large / Giant | CC-BY-NC |
  | Seed-VC | GPL-3.0 (copyleft weights) |
  | LTX-2.x | revenue-gated |
  | MiniMax H3 | territory-gated |

* **Very new weights:** Bernini-R (2026-06), Wan 2.2 Fun VACE and SVI 2.0 Pro. The graphs are structurally validated but their settings come from templates and community practice, so run a GPU smoke test (one real render per workflow) before exposing them.
* **Auto-downloading packs:** Chatterbox, VibeVoice, IndexTTS-2 and Video-Depth-Anything download weights at execution time. Pre-seed them, otherwise the first job stalls or fails offline.
* **GPU contention:** training and the 24 GB video workflows should not share one GPU queue with interactive image jobs.
