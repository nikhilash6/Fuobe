# The studio's in-house products: what they are made of (round 5)

_In this file, "the studio" means the closed AI image and video studio that this research measures Fuobe against._

_As of 2026-10-23. Machine-readable twin: [`parity-originals-5.json`](parity-originals-5.json) (22 product records, 101 evidence items, each with claim, source, date and confidence). This file answers one question for the "Fuobe Originals" decision: for each product the studio sells as its own, what is underneath it? It builds on [`parity-inventory.md`](parity-inventory.md), [`parity-image-studios.md`](parity-image-studios.md), [`parity-studios.md`](parity-studios.md), [`parity-api.md`](parity-api.md), [`parity-delta-4.md`](parity-delta-4.md) and [`parity-marketing-agents.md`](parity-marketing-agents.md), and only repeats their behaviour details where the Original needs them. The open and hosted recipes are designed in a separate file; the notes here only point the direction._

## How this was researched

All of it was read on 2026-10-23 unless a source has its own date. No account was used and nothing was generated.

1. **The studio's own words.** The help center (18 articles), the blog (287 posts in the sitemap, about 60 read), the changelog RSS (133 entries) and the public API docs recorded in round 3.
2. **The production web client.** Build `1a2c0e3d`: 8,510 JavaScript chunks crawled from `{studio-assets}/tanstack/assets/`. They contain every form's default values, every request payload, the staff-only "dev" panels, and the map from internal job type to the product name shown to users. Code shows what the browser sends and what staff can toggle. It does not show the weights on the server.
3. **Public endpoints.** `{studio-service}/job-sets/costs` (62 credit-cost rows), the server-rendered `/effects`, `/effects/use/<slug>` and `/motion/<uuid>` pages.
4. **Fingerprints.** Credit ladders and API price formulas compared with known vendor prices (the studio's own resale prices and fal's OpenAPI files). Parameter names and defaults compared with open repositories (Wan 2.1 / 2.2, InfiniteTalk, the Qwen "Angles" Space).
5. **Context.** The studio's job board (96 open roles), its 2023 GitHub and Hugging Face history, and community posts. Community claims were hard to find; the few found are marked speculative.

**Confidence scale.** **confirmed**: the studio says it, or its API docs, price API or client code name it explicitly. **likely**: two or more independent fingerprints agree and nothing contradicts them. **speculative**: one fingerprint, a price coincidence or a community claim. **unknown**: no public evidence. A "confirmed" code fact is a fact about the client (for example "the style record has a `lora` field"); what it implies about the server is rated separately.

**A rule for Fuobe that came out of this.** The studio's Terms of Use ({studio-site}/terms-of-use-agreement, "Last updated: October 23, 2026", read 2026-10-23) forbid this in two places. Section 5.1(iii) bars using the Service or any Outputs "to develop, modify, fine‑tune, distill, or improve any products or services that compete with the Service, including any artificial intelligence or machine‑learning algorithms or models of any kind". Section 5.2(iv) bars using "the Service, any Outputs, or any data derived therefrom to train, fine-tune, distill, or otherwise transfer knowledge to any machine-learning model, neural network, or artificial intelligence system, whether or not such system competes with the Service"; the only exceptions are models trained on your own Inputs, or written permission. Section 5.2(v) also bars any attempt to "decompile, distill, reverse compile, or reverse engineer any part of the Service". So Fuobe must not train preset LoRAs or style LoRAs on the studio's preset previews, example videos or generations, and preset look-alikes need Fuobe's own or openly licensed data. The client-code facts in this file come from public JavaScript read without an account. Fuobe uses them only as facts (parameter names, frame counts, which open model a product runs) and does not copy the studio's code, prompt text or preview media. *(Wording corrected by the critic pass on 2026-10-23: the earlier text paraphrased the clause.)*

---

## 1. The short answer

The user's hypothesis is **partly right**. The studio's "own" products fall into three groups.

| Group | What it is | Products | How sure |
|---|---|---|---|
| **A. Partner model + the studio's prompts and UI** | A closed third-party model does the generation; the studio adds presets, prompt compilers, chains and the interface | Cinema Studio 4.0 (Seedance 2.5) and 3.x (Seedance 2.0) · Shorts Studio (Gemini Omni Flash) · Marketing Studio Image and Ads Studio (GPT Image 2.5) · Fashion Factory outfit and photoset steps (Nano Banana) · Upscale (Topaz, ByteDance, FLUX.3) · Genjutsu (Seedance 2.5 edit) · Genjutsu Lite (Wan 3.0 reference-to-video) · Effects 2.0 chains · Evolution · Mirelo and Sonilo audio (labelled as vendors) | Cinema Studio 4.0, Shorts, Marketing Image, Ads Studio, Upscale and Fashion Factory are **confirmed**. Genjutsu and Genjutsu Lite are **likely**. Effects 2.0 and Evolution engines are **speculative** |
| **B. Open model + public LoRAs under a studio name** | Exactly the user's hypothesis | Angles (Qwen-Image-Edit 2509 + Multiple-angles LoRA + Lightning LoRA) · Animate and Recast (Wan 2.2 Animate) · Infinite Talk in Lipsync Studio (MeiGen InfiniteTalk + FusioniX LoRA) · Depth Map (Video Depth Anything) · Remove Background (SAM 3) | **confirmed** from the client's own labels, parameter names and defaults |
| **C. Self-hosted diffusion models with LoRA presets and per-user fine-tunes** | The studio runs these models on its own GPUs. Presets are LoRA files, and characters and moodboards are short training runs. The base checkpoints are not public | Soul v1 · Soul 2.0 · Soul Cinema · Soul ID · Moodboards · DoP (and Mix, Speak v1) · Popcorn / Instadump | The **LoRA mechanism is confirmed in code** (Soul 2.0 styles carry `lora` and `lora_2`; DoP accepts `loras/<name>.safetensors` as a motion; Soul ID posts `training_args` with learning rate, steps and a face-loss weight). The **base model is unknown**. Fingerprints point to the Wan family for DoP (**likely**), for Soul v1's current backend (**likely** shared pipeline, **speculative** weights) and for Popcorn (**speculative**) |

What this means for Fuobe Originals:

- **Group B** can be copied exactly. The open weights and LoRAs are public, and the client gives the studio's default settings.
- **Group C** can be copied in mechanism: an open base, a LoRA per preset, a LoRA per character, and the same strength knobs and frame counts. The look of each preset has to be rebuilt from Fuobe's own data, so the results will be similar, not identical.
- **Group A** is not open underneath. A Fuobe Original there is a substitute (Wan 2.2, LTX-2.5, HunyuanVideo 1.5, Qwen-Image-Edit) carrying the studio's exact UI, limits and prompt compiler. Its quality will not equal Seedance 2.5 or GPT Image 2.5. The studio itself says Cinema Studio is "built on top of interchangeable video models".

The studio's own framing is mixed. On 2026-08-12 it wrote that it "builds its own tools, Cinema Studio among them and its own models, such as Soul, on top of interchangeable, best-in-class generation models". On 2026-09-08 it called Soul 2.0 "the studio's own foundation image model, built in-house". The help center lists DoP, Soul, Popcorn **and Cinema Studio** as its "own proprietary" models, and in another article says "Cinema Studio 4.0 runs on Seedance 2.5". So "proprietary" on the studio's covers products that run on a partner model.

---

## 2. Evidence that applies to many products

### 2.1 Credit ladders (credits per second, `{studio-service}/job-sets/costs`, 2026-10-23)

| Job type (product) | 480p | 720p | 1080p | 4K | Matches |
|---|---|---|---|---|---|
| `seedance_2_5` (Seedance 2.5) | 3 | 7 | 16 (edit 20) | 26 (edit 34) | reference ladder |
| `cinematic_studio_video_4_0` (Cinema Studio 4.0) | 3 | 7 | 16 | 26–27 | Seedance 2.5, exactly |
| `ad_multiplier`, `ad_multiplier_v2`, `video_character_asset` | 3 | 7 | 16 | 26–27 | Seedance 2.5, exactly |
| `hf_mult_motion_control`, `hf_mult_replace_object` (Genjutsu), `cinematic_video_relight`, `cinematic_video_inpaint` | 3 | 7 | 20 | 26 (relight) | Seedance 2.5 with the edit price at 1080p |
| `hf_evolution` (Evolution) | — | 7 | — | — | Seedance 2.5 at 720p |
| `seedance_2_0` (Seedance 2.0) | 3 | 4.5 | 12 | 22 | reference ladder |
| `remove_object`, `swap_object`, `draw_to_video`, `reframe` | 3 | 4.5 | 12 | — | Seedance 2.0, exactly (+3.5 credits for one edited frame, or +3 images at 1 credit for reframe) |
| `cinematic_studio_3_0`, `cinematic_studio_video_3_5` | 3.5 (list 6) | 5 (list 6) | 13 | 24 (list 26) | close to Seedance 2.0 (list 6 / 6 / 12 / 26) |
| `hf_mult_*_flash` (Genjutsu Lite) | 1 (list 3) | 2 (list 6) | 4 (list 12) | — | see the API price below |
| `gemini_omni` (Shorts Studio engine) | — | 3 | 3 | 3 | Shorts Studio estimate of 3 credits per input second |

### 2.2 API price formulas that are a vendor's price

- **Cinema Studio 4.0** (API): billable tokens = ceil((input + generated seconds) × width × height × 24 / 1024), **$0.0214 per 1,000 tokens**, 0.6× with video input. This is Seedance 2.5's token price as fal lists it ("$0.0214 per 1000 tokens for 480p and 720p").
- **Genjutsu Lite** (API): "480p $0.05, 720p $0.10, or 1080p $0.20 per second. Billable seconds = output duration + the sum of input reference video durations." The studio sells Alibaba **Wan 3.0 reference-to-video** with the same three prices and the same billing rule. fal's Wan 3.0 reference-to-video also caps reference video at 15 s and 10 images and bills the input video. Genjutsu Lite trims to 15 s and takes up to 10 images on the web.
- **Marketing Studio Image** and **Ads Studio** (API): OpenAI-style token rates (text in $5, image in $8, image out $30 per 1M). The docs name the renderer: GPT Image 2.5 Flare.

### 2.3 What the client code shows

- **LoRAs on Soul.** Every Soul 2.0 and Soul Cinema style record has `lora` and `lora_2`. A staff panel prints them as "LoRA 1: …" and "LoRA 2: …" beside "(Dev) Preset Strength" and "(Dev) Character Strength" sliders.
- **LoRAs on DoP.** The motion picker accepts a motion id ending in `.safetensors` (`loras/<name>.safetensors`) and shows it under the model label "Canary". A staff "canary" channel lists such motions for `image2video` (DoP) and `avatar` (Speak).
- **Training runs.** Soul ID and moodboards post `training_args: [{learning_rate, face_loss_weight, warmup_steps, total_steps, target_area}]` (staff can override; normal users send `null`) to `/custom-references`, `/custom-references/soul-v2`, `/custom-references/soul-v2-preset` or `/custom-references/soul-cinematic`.
- **Self-hosted samplers.** Soul v1: steps, shift, guide scale, negative prompt, APG (adaptive projected guidance), `compile` (torch.compile). Popcorn and Instadump: `checkpoint: "350000"` / `"260000"` and `sample_solver: "unipc"`. InfiniteTalk: TeaCache and APG switches (both off by default: `use_teacache:!1`, `use_apg:!1`) and a FusioniX LoRA at rank 32. DoP: 49 or 81 frames, steps, guide scale, shift.
- **Staff-named experiments.** `use_green_aidar`, `use_olzhas`, `use_sultan` and `soul-cinema-1-5-serega` are switches or model variants named after people. They show in-house iteration on these models.
- **Product names over job types.** `QWEN_CAMERA_CONTROL` is shown as "Angles". `WAN2_2_ANIMATE_V3` and `WAN2_2_ANIMATE_REVOICE` are "Recast". `WAN2_2_ANIMATE` and `_V2` are "Animate" in one label function (`1a2c0e3d-XQvVauJI5fIVvC8i.js`) but "Wan 2.2 Animate" and "Wan 2.2 Animate V2" in the main label map (`1a2c0e3d-j-8rpwEzEMqpgGav.js`, which also has `WAN2_2_ANIMATE_FACESWAP` = "Wan 2.2 Faceswap"), so the open name still shows in places (re-checked 2026-10-23). `IMAGE2VIDEO_EXTEND` is "Speak", `IMAGE2VIDEO_MIX` is "Mix Motion", `NANO_BANANA_OUTFIT_COLLAGE` is "Outfit Collage" and `TEXT2KEYFRAMES` is "Popcorn".

### 2.4 Company context

- **Jobs.** The Prompt Engineer role (2026-07-20) is to "develop product use cases and one-click presets for generative image/video models" and asks for "general knowledge of ComfyUI pipelines". A Data Scientist post (2026-09-07) says "train or fine-tune generative video models — that's what our R&D ML Engineer roles do". Security roles describe GPU clusters "supporting distributed training and production inference". None of the 96 public roles on 2026-10-23 is a research role for pre-training foundation models.
- **History.** The studio's first open-source project (GitHub `{studio}/{studio}`) is a distributed fine-tuning framework for LLMs. Its 2023 Hugging Face org holds dozens of Mistral-7B and Llama-2 fine-tunes. Fine-tuning open weights is where the company started.
- **Launch timing.** DoP launched on 2025-03-31, five weeks after Wan 2.1's open weights (2025-02-25). Soul launched on 2025-06-25, a month before Wan 2.2 (2025-07-28). Both Wan dates are from the news lists in https://github.com/Wan-Video/Wan2.1 and https://github.com/Wan-Video/Wan2.2 (read 2026-10-23). Wan2.2's shared config has `sample_fps = 16` and `frame_num = 81`.

---

## 3. Product by product

Each section has the evidence table (also in the JSON), then the behaviour the Original must match. The behaviour lists new or exact details; the full option lists stay in the round-3 and round-4 files they point to. A short note on the Fuobe direction ends each section.


### 3.1 Soul (v1)

| Claim | Confidence | Source | Date |
|---|---|---|---|
| The studio calls Soul its 'native model for cinematic and fashion looks' and launched it on 2025-06-25 as a 'high-aesthetic photo model' with 50+ presets. | **confirmed** | {studio-site}/creator-hub/help-center/ai-models/which-ai-model-should-i-use ; {studio-site}/blog/{studio}-SOUL-Turns-Prompts-Into-Fashion-Ready-Shots | 2025-06-25 |
| Soul v1 is a diffusion sampler the studio runs itself: the form 'hf:soul-form-09-13' carries steps 50, sampleShift 3, sampleGuideScale 4, an empty negativePrompt, version 3, apg_eta 0 (Adaptive Projected Guidance), compile true (torch.compile) and a staff flag use_green; the staff-only key list is soul: [sampleGuideScale, sampleShift, use_apg, compile, apg_eta, use_green]. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-T9xctyEJxpuOr_cw.js ; {studio-assets}/tanstack/assets/1a2c0e3d-HtLX1-VrFGqZts-S.js | 2026-10-23 |
| Those defaults are identical to the studio's own 'Wan 2.2' image form (hf:wan2.2-image-form: steps 50, sampleShift 3, sampleGuideScale 4, negativePrompt '', version 3, apg_eta 0), and both forms size images with the same shared function. The Wan 2.2 image grid is 1536x1536 at the '720p' tier, which is the size the legacy Soul API example uses ('1536x1536'). The current Soul v1 backend (version 3) shares the Wan 2.2 image pipeline. | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-KUiNKl77EPPShy_-.js ; {studio-assets}/tanstack/assets/1a2c0e3d-TdHwWn7lmpxFnflF.js (wan2_2_image resolution table) ; docs/research/parity-api.json legacy/soul | 2026-10-23 |
| Soul v1's weights are a Wan 2.2 fine-tune. Only fingerprints point that way (shared defaults, Wan CLI names sample_shift / sample_guide_scale). Soul v1 launched 2025-06-25, before Wan 2.2 (released 2025-07-28), so the launch model was something else and the backend has been swapped since ('version 3'). | **speculative** | https://github.com/Wan-Video/Wan2.1/blob/main/generate.py (flags --sample_shift, --sample_guide_scale, --sample_solver) | 2026-10-23 |
| Presets behave like stacked adapters: each request has style_id + style_strength 0-1 and custom_reference_id + custom_reference_strength 0-1; strength 0 'uses the selected style's default character strength'; behind a client flag, picking a character sends preset strength 0.6 and character strength 0.9. | **likely** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) ; {studio-assets}/tanstack/assets/1a2c0e3d-T9xctyEJxpuOr_cw.js | 2026-10-16 / 2026-10-23 |
| Community: a July 2025 Habr review describes Soul's character training as LoRA training on the studio's own dataset and notes it needs 20+ photos where Flux LoRAs work with 3-4. | **speculative** | https://habr.com/en/articles/930074 | 2025-07-22 |

**Behaviour to match**

- **inputs:** prompt (optional), one preset (style_id), optional Soul ID character, optional image reference (guides prompt enhancement)
- **options:** 106 presets in 8 categories (parity-image-studios.json); aspect 9:16, 16:9, 4:3, 3:4, 1:1, 2:3, 3:2; quality 720p / 1080p; batch 1 or 4; seed 1-1,000,000; enhance prompt
- **defaults:** web: 1080p, batch 4, portrait aspect, preset General 464ea177-8d40-4940-8d9d-b438bab269c7, preset strength 1, character strength 1 (0.6 / 0.9 when a character is selected and a client flag is on); API: 4:3, 720p, batch 1
- **limits:** short prompts with the General preset are enhanced automatically even when enhance is off
- **cost:** API list $0.0938 (720p) / $0.1875 (1080p) per image
- **hidden params:** steps 50, shift 3, guide scale 4, negative prompt, APG, torch.compile (staff only)

**Fuobe note.** Fuobe Original: base text-to-image model with a style LoRA per preset and an optional character LoRA, preset strength and character strength as LoRA scales. The defaults (50 steps, shift 3, CFG 4, APG) are a usable starting point for Wan 2.2 T2I or Qwen-Image. Do not train preset LoRAs on the studio's previews (ToS).


### 3.2 Soul 2.0

| Claim | Confidence | Source | Date |
|---|---|---|---|
| The studio calls Soul 2.0 'the studio's own foundation image model, built in-house for fashion-aware, culture-native image generation', and admits a weakness: 'the trained face can end up cloned onto background people in a scene'. | **confirmed** | {studio-site}/blog/soul-2-vs-nano-banana-pro | 2026-09-08 |
| Every Soul 2.0 and Soul Cinema style record carries 'lora' and 'lora_2' fields. A staff-only panel lists them as 'LoRA 1: <name>' and 'LoRA 2: <name>' next to '(Dev) Preset Strength' and '(Dev) Character Strength' sliders (0-1). | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-OWMkRGYJAoV9LLH0.js | 2026-10-23 |
| So each Soul 2.0 preset is one or two LoRAs applied to a shared base model, with preset strength and character strength as LoRA scales. | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-OWMkRGYJAoV9LLH0.js | 2026-10-23 |
| The Soul 2.0 request (form hf:soul-v2-form-01-dev-upd) sends model soul_v2, width/height (longest side capped at 2048, rounded to 16), aspect_ratio, prompt, negative_prompt, enhance_prompt, style_id, style_strength, custom_reference_id + strength, colour signature, use_refiner (off), use_green (on), use_green_aidar (off), lora, chain_enhancer, time_denoise_from (0.83 per image in one path) and model_version 'fast'. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-oxiisOFH5LKersmF.js ; {studio-assets}/tanstack/assets/1a2c0e3d-zZrfcbsREGSHtTWD.js | 2026-10-23 |
| Reading of those fields: a negative prompt means a CFG model; 'time_denoise_from 0.83' and 'use_refiner' mean a second pass that re-noises the first result; 'model_version fast' means a distilled variant; 'use_green_aidar' names a staff member, so these are in-house experiment switches. | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-oxiisOFH5LKersmF.js | 2026-10-23 |
| Soul 2.0 requests can also carry use_olzhas, use_sultan or use_aidar (one per request, chosen by a staff selector), and time_denoise_from is filled with 0.83 for every image in the batch. These are model variants named after staff members. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-TdHwWn7lmpxFnflF.js ; {studio-assets}/tanstack/assets/1a2c0e3d-0blEp5LFilNYgohY.js ; {studio-assets}/tanstack/assets/1a2c0e3d-mmG45x-JfVHU3YSS.js | 2026-10-23 |
| Moodboards are trained the same way presets are stored: POST /custom-references/soul-v2-preset {name, input_images} with states In queue, In progress, Preparing cover, Complete. Curated moodboards are the same kind of trained style artifact (a style LoRA). | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-zZrfcbsREGSHtTWD.js (y1 map: soul-v2-preset) ; docs/research/parity-image-studios.md section 4 | 2026-10-23 |
| Price: 0.125 credits (about $0.006) per image on the web; API $0.0032 (720p) / $0.0057 (1080p). That is cheaper than the studio's own resale of Z-Image Turbo ($0.015). The base is a small or distilled model that studio serves itself. | **speculative** | {studio-site}/blog/soul-2-vs-nano-banana-pro ; {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-09-08 |
| The base checkpoint of Soul 2.0 is not named anywhere public. | **unknown** | all sources above | 2026-10-23 |
| API quirks: style_strength is accepted but has no effect; custom_reference_strength 0 fails at runtime; short General prompts are auto-enhanced; with an image reference the prompt field is disabled on the web. | **confirmed** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) ; {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-soul-to-generate-images | 2026-10-16 |

**Behaviour to match**

- **inputs:** prompt, one preset or moodboard (style_id), optional Soul ID, optional Soul HEX palette, optional reference image (disables the prompt on the web)
- **options:** 33 presets/moodboards (21 in Mood / Styles / Camera groups + 12 uncategorised); aspect 9:16, 3:4, 2:3, 1:1, 4:3, 16:9, 3:2; web quality 1.5K / 2K (API 720p / 1080p); batch 1-4 (API 1 or 4); seed
- **defaults:** web: 3:4, 1080p tier, preset General 3db34ab5-3439-4317-9e03-08dc30852e69, preset strength 1, character strength 1, enhance off
- **limits:** longest side 2048 px, sizes rounded to 16; moodboards 5-80 images >=256 px, no faces
- **cost:** 0.125 credits per image (web); API $0.0032 / $0.0057

**Fuobe note.** Fuobe Original: base model + up to two style LoRAs (lora, lora_2) + character LoRA, an optional refiner pass (img2img from about 0.83 of the schedule), negative prompt. Personal moodboards = train a style LoRA from 5-80 user images.


### 3.3 Soul Cinema

| Claim | Confidence | Source | Date |
|---|---|---|---|
| Help center: Soul Cinema is 'a separate model in the Soul family', 'the cinematic aesthetic is built into the model itself', no presets or moodboards, Soul HEX and Soul ID supported. | **confirmed** | {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-soul-cinema | 2026-08-01 |
| The Soul Cinema form (hf:soul-v2-cinematic-form-01-dev) has the same switches as Soul 2.0 (use_refiner, use_green, use_green_aidar, lora, chain_enhancer, time_denoise_from, model_version 'fast') plus cinematic_variant 'default', a fixed default style 5fbabfac-d27b-4751-b550-fea356ed55ac, camera_model_id and camera_lens_id. The 'built-in' look is a fixed style slot on the Soul 2.0 pipeline. | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-zZrfcbsREGSHtTWD.js | 2026-10-23 |
| Several Soul Cinema builds exist side by side: soul_cinematic (preview, 2026-03-04), soul_cinema_1_5 and soul_cinema_1_5_serega (named after a staff member). These are in-house fine-tune iterations. | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-o7a2AEODUzAhb9dz.js (job-type enum) ; {studio-site}/blog/soul-cinema-preview | 2026-03-04 / 2026-10-23 |
| A character moves to Soul Cinema by retraining: the client calls a free retrain with the same photos for 'soul_cinematic', and Soul ID has its own endpoint /custom-references/soul-cinematic. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-9FGSk7QYv-N6eo4s.js (onFreeRetrain) ; {studio-assets}/tanstack/assets/1a2c0e3d-zZrfcbsREGSHtTWD.js (y1 map) | 2026-10-23 |
| API: style_id is ignored; a custom_reference_id turns prompt enhancement on even when enhance_prompt is false; no published price; 'may be absent from model discovery'. | **confirmed** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-10-16 |

**Behaviour to match**

- **inputs:** prompt, optional Soul ID, optional Soul HEX palette, optional camera body and lens (Cinema Studio image mode), one input image
- **options:** aspect 9:16, 16:9, 4:3, 3:4, 1:1, 2:3, 3:2; web 1.5K / 2K (API 720p / 1080p); batch 1-4
- **defaults:** 16:9, 1080p tier, enhance on, batch 1
- **cost:** 0.125 credits per image in Cinema Studio (soul_cinema_studio); API price not published

**Fuobe note.** Fuobe Original: the Soul 2.0 recipe with one fixed 'cinematic' style LoRA always on, camera and lens words from the Cinema Studio camera tables, palette from Soul HEX.


### 3.4 Soul ID (character training)

| Claim | Confidence | Source | Date |
|---|---|---|---|
| Help center: 'Train it once on 20 or more photos of one person (up to 80)', 'Training takes a few minutes', 'not exportable as a standalone file'. Blog: 'a ~3 to 5 minute train'. | **confirmed** | {studio-site}/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character ; {studio-site}/blog/Why-Does-Your-AI-Characters-Face-Keep-Changing | 2026-08-01 / 2026-06-09 |
| Creating a character posts {name, input_images, training_args:[{learning_rate, face_loss_weight, warmup_steps, total_steps, target_area}]} to /custom-references (Soul v1), /custom-references/soul-v2 or /custom-references/soul-cinematic (training_args is null for normal users). Soul ID is a short gradient fine-tune per person with a face-identity loss. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-zZrfcbsREGSHtTWD.js (functions a1 and y1) | 2026-10-23 |
| The trained artifact is a LoRA-style adapter per person and per model family: separate endpoints per family, /custom-references/retrain {custom_reference_id, input_images, target_type} and 'Upgrade Character', a 3-5 minute train, and the admitted background face cloning (identity bleed) all fit a LoRA. | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-zZrfcbsREGSHtTWD.js ; {studio-site}/blog/soul-2-vs-nano-banana-pro | 2026-10-23 |
| API: POST /v1/custom-references {name <=100, model_version v1\|v2\|cinema, input_images 1-100}; states not_ready, queued, in_progress, completed, failed; use with custom_reference_id + custom_reference_strength 0-1; no published price; no delete/update in the public API. | **confirmed** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-10-16 |
| Community calls Soul ID 'LoRA training' (Habr, July 2025). | **speculative** | https://habr.com/en/articles/930074 | 2025-07-22 |

**Behaviour to match**

- **inputs:** 20+ photos of one person (web max 80; API 1-100), a name, consent checkbox
- **options:** target family v1 / v2 / cinema; strength 0-1 at generation time
- **limits:** one person per Soul ID; no sunglasses, group shots, filters, heavy shadows, cropped faces; one full-body photo recommended; recent photos
- **outputs:** a character usable in every Soul model and as an Element in Seedance
- **time:** a few minutes (3-5 min per the blog)

**Fuobe note.** Fuobe Original: AI-Toolkit (open) or a hosted LoRA trainer per base model; keep the photo rules, consent, the 3-5 minute target and per-family retrain. A face-identity loss is not standard in AI-Toolkit; a face crop or face-weighted sampling is the nearest open option.


### 3.5 Soul HEX / Color Transfer

| Claim | Confidence | Source | Date |
|---|---|---|---|
| Soul HEX extracts the dominant colours of an uploaded image and applies them to a generation; on Soul 2.0 and Soul Cinema. | **confirmed** | {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-soul-to-generate-images | 2026-08-01 |
| The palette library is the 50 Cinema Studio 4.0 palettes (12 hex colours each); manual palettes go to POST /color-presets/manual {hex_colors, background_color}; the Soul request carries the palette id (color_preset_id / color_palette {id, type}). | **confirmed** | docs/research/parity-image-studios.md section 5 ; {studio-assets}/tanstack/assets/1a2c0e3d-oxiisOFH5LKersmF.js | 2026-10-17 / 2026-10-23 |
| How the model consumes the palette (prompt text written by the 'chain enhancer', a conditioning image, or a palette LoRA) is not visible from the client. | **unknown** | {studio-assets}/tanstack/assets/1a2c0e3d-oxiisOFH5LKersmF.js | 2026-10-23 |
| HEX for video ('Color Palette', 50+ grades) became a standalone video tool on 2026-08-21. Its credit ladder is not public; the Cinema Studio relight/inpaint jobs it sits beside cost 3 / 7 / 20 credits per second (the Seedance 2.5 edit ladder). | **speculative** | {studio-site}/creator-hub/changelog/rss.xml ; {studio-service}/job-sets/costs | 2026-08-21 / 2026-10-23 |

**Behaviour to match**

- **inputs:** an image (or up to 20 images) to extract from, a built-in palette, or a manual palette
- **options:** manual editor 1-12 colours (10 on Recraft), one marked as background, eyedropper, 4 random palettes; saved 'color signatures' shared with Cinema Studio
- **defaults:** manual editor starts with #FFFFFF #D1FE17 #1C1E20 on #53C546

**Fuobe note.** Fuobe already has this (palettes.ts, palette-transfer graphs). The Original keeps the hex list in the prompt plus an optional palette-lock pass after generation.


### 3.6 Soul Cast / Soul Location

| Claim | Confidence | Source | Date |
|---|---|---|---|
| In Cinema Studio image mode the client maps 'cinematic-studio-soul-location' to the job type text2image_soul_v2: Soul Location runs on Soul 2.0. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-rtPQH-IoMEs0TwgC.js (map Cn) | 2026-10-23 |
| Soul Cast (job soul_cast / cinematic_studio_soul_cast) sends character_params + preset_id + optional prompt and writes choices into the prompt as <<<cast_{field}_{value}>>> tokens; 2048x1152 output, batch 1-10, 0.125 credits per image (the Soul 2.0 price). It is a casting-prompt compiler on Soul 2.0. | **likely** | docs/research/parity-studios.md section 1.7 ; {studio-assets}/tanstack/assets/1a2c0e3d-zZrfcbsREGSHtTWD.js | 2026-10-17 |
| Soul Location: prompt <=2,500 chars, batch 1-10, 16:9 at 1696x960, palette, camera body, lens, seed; 0.125 credits per image; saved as a Location element. | **confirmed** | docs/research/parity-studios.md section 1.8 ; docs/research/parity-image-studios.md section 8 | 2026-10-17 |

**Behaviour to match**

- **inputs:** Cast: 17 fields (genre, budget, era, archetype, gender, race, age, build, height, eye colour, hair style/texture/colour, facial hair + colour, details, outfit) + optional description <=300 chars; Location: description <=2,500 chars or upload
- **options:** Randomize, Reset, pick one variant, Save as Element, Upgrade Character (Soul 2.0 / Soul Cinema)
- **cost:** 0.125 credits per image

**Fuobe note.** Fuobe Original: the Soul 2.0 Original with the field-to-phrase compiler already in cinema.ts; Location = the same with an empty-set prompt and a 'another view' edit (Qwen-Image-Edit + Multiple-angles LoRA).


### 3.7 DoP camera motions (113) and Mix

| Claim | Confidence | Source | Date |
|---|---|---|---|
| Help center: 'the studio's own proprietary model', 'trained to understand and control motion, lighting, lens behavior, framing'; the model appears as 'Standard'; advanced settings are duration 3 or 5 s, seed and steps. | **confirmed** | {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-dop | 2026-08-02 |
| Launched 2025-03-31 as 'DoP I2V-01-preview' with thanks to Nebius and TensorWave (AMD MI300X); the studio's launch blog (now 404) said it 'blends diffusion models with reinforcement learning' with RL applied after diffusion. Wan 2.1 open weights had been released five weeks earlier (2025-02-25). | **likely** | https://x.com/studio_ai/status/1906783445998576078 ; {studio-site}/blog/Introducing-studio-DoP-preview (404 on 2026-10-23, text via search index) ; https://github.com/Wan-Video/Wan2.1 (README news: 'Feb 25, 2025: We've released the inference code and weights of Wan2.1', read 2026-10-23) | 2025-03-31 |
| DoP form 'hf:create:video:hf': frames 49 ('3s') or 81 ('5s'), steps 30, motionIds + motionStrengths, strength 1, guideScale, sampleShift. Preset pages carry settings {steps:20, frames:81, strength:1, guide_scale:6} and presetFamily '{studio}'. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-zZrfcbsREGSHtTWD.js ; {studio-site}/motion/70e490b9-26b7-4572-8d9c-2ac8dcc9adc0 | 2026-10-23 |
| 49 frames = 3 s and 81 frames = 5 s means 16 fps, the native output of Wan 2.1 / 2.2 14B (Wan configs: frame_num 81, sample_fps 16), and the knobs use Wan's names (sample shift, guide scale). DoP is a Wan-14B-lineage image-to-video model. | **likely** | https://github.com/Wan-Video/Wan2.2/blob/main/wan/configs/shared_config.py ; https://github.com/Wan-Video/Wan2.1/blob/main/generate.py | 2026-10-23 |
| The motion picker treats any motion id ending in '.safetensors' as a raw LoRA file ('loras/<name>.safetensors', shown under the model label 'Canary'), and a staff 'canary' channel lists such motions for image2video and avatar. Such an id is sent as `reference` (type 'reference') instead of `motion_id`. DoP motions and LoRA files are interchangeable in the client. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-ggrIiLPSJckmqaiD.js ('Canary') ; {studio-assets}/tanstack/assets/1a2c0e3d-Iy-LDiMETMj_D3ZQ.js (.safetensors check) ; {studio-assets}/tanstack/assets/1a2c0e3d-AsZenCDJK_UeuEwV.js (canaryType motions -> image2video, else avatar) | 2026-10-23 |
| Every public DoP preset is a motion LoRA on the DoP base (per-preset strength 0-1, Mix stacks two presets each with its own strength). | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-ggrIiLPSJckmqaiD.js ; docs/research/parity-inventory.md section 5 | 2026-10-23 |
| Mix is its own job (IMAGE2VIDEO_MIX, label 'Mix Motion'); URL form presetMotionId=a,b&presetMotionStrengths=0.85,0.5; 16 published mixes. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-j-8rpwEzEMqpgGav.js ; docs/research/parity-inventory.md section 5 | 2026-10-23 |
| Variants Lite / Turbo / Standard; Turbo (April 2025) was '1.5x faster, 30% cheaper', which fits a step-distilled variant. | **speculative** | {studio-site}/blog/{studio}-Fastest-Model-Yet-Introducing-Turbo (via search index) | 2025-04 |
| No public v2 API endpoint for DoP; only the legacy SDK route /v1/image2video/dop with motions [{id, strength}]. | **confirmed** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-10-16 |

**Behaviour to match**

- **inputs:** one start image (some presets also need an end frame), optional prompt with Enhance
- **options:** 113 camera motions + VFX presets in categories Effects, Basic Camera Control, Epic Camera Control, Catch the Pulse, New, Trending, Top Choice, Start & End, Mixed; Mix = 2 presets with strengths
- **defaults:** duration 3 s (49 frames) or 5 s (81 frames) at 16 fps; steps 20 on preset pages (30 in the form default); preset strength 1; guide scale 6
- **limits:** image-to-video only

**Fuobe note.** Fuobe Original: Wan 2.2 A14B image-to-video at 16 fps, 49 / 81 frames, with a camera or VFX LoRA per preset (comfyui-oss LoRA map), strength = LoRA scale, Mix = two LoRAs. Hosted: fal-ai/wan/v2.2-a14b/image-to-video/lora with loras[] URLs.


### 3.8 Visual Effects (274) and Effects 2.0

| Claim | Confidence | Source | Date |
|---|---|---|---|
| The older effect presets are bound to model families: '{studio}' (DoP), 'minimax' (Hailuo camera presets), 'kling', 'seedance' and 'wan2_5_video'. Effects in the non-DoP families are vendor templates and prompts on partner models. | **confirmed** | docs/research/parity-inventory.md section 5 (SSR of 229 /motion pages) | 2026-10-16 |
| Effects 2.0 (/effects, job viral_hub_video): all 50 presets in the server-rendered first page (of 94) are kind 'chain', i.e. node graphs whose inputs bind to node ports (Agamemnon: 1 image -> node 8033d592 port input_images). 38 of the 50 carry the CMS type 'Prompt based'; the other CMS types are 'Code based (CMS)' and 'Effect based'. | **confirmed** | {studio-site}/effects ; {studio-assets}/tanstack/assets/1a2c0e3d-8aFpO6t7Cp0SWUOD.js | 2026-10-23 |
| Agamemnon (15 s) costs 45 / 67.5 / 135 / 330 credits at 480p / 720p / 1080p / 4K = 3 / 4.5 / 9 / 22 credits per second; Seedance 2.0 is 3 / 4.5 / 12 / 22 and the aspect list (auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16) matches. Many Effects 2.0 chains end in a Seedance 2.0 reference-to-video node. | **speculative** | {studio-site}/effects/use/agamemnon ; {studio-service}/job-sets/costs | 2026-10-23 |
| Mixed Media looks inside Effects 2.0 are chains that start with a 'split' node and are priced per frame. | **confirmed** | {studio-site}/effects | 2026-10-23 |

**Behaviour to match**

- **inputs:** per effect: 0-10 images, 0-10 videos, text slots, choice slots (slot_values, slot_selections, choice_values)
- **options:** resolution 480p / 720p / 1080p / 4K and aspect auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 where the chain exposes them
- **cost:** fixed price matrix per effect and setting (Agamemnon 720p = 67.5 credits)
- **duration:** fixed by the effect (Agamemnon 15 s)

**Fuobe note.** Fuobe Original: LoRA effects on Wan 2.2 i2v where an open LoRA exists (35 in the LoRA map); the rest as Fuobe chains (image edit -> image-to-video with the effect prompt), which is what the studio's 'Prompt based' chains are.


### 3.9 Genjutsu (motion transfer, object swap, restyle) and Genjutsu Lite

| Claim | Confidence | Source | Date |
|---|---|---|---|
| Launch blog: 1 clip 4-30 s, up to 30 reference images, 30+ presets, up to 1080p, prompt optional. The web code allows 1-10 images and the API 1-8 (sources disagree). | **confirmed** | {studio-site}/blog/{studio}-genjutsu ; docs/research/parity-delta-4.md section 4.2 ; {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-08-31 |
| Web credits 3 / 7 / 20 per second (480p / 720p / 1080p) for motion transfer and object swap. The same ladder is used by Cinema Studio's relight and inpaint jobs; 480p and 720p equal Seedance 2.5 (3 / 7) and 1080p equals Seedance 2.5 video_edit (20). | **likely** | {studio-service}/job-sets/costs | 2026-10-23 |
| Genjutsu's job type hf_mult_motion_control belongs to the 'Multiplier' family (labels AD_MULTIPLIER and STUDIO_MULTIPLIER_MOTION_CONTROL = 'Multiplier'; deep link studio-multiplier -> hf-mult-motion-control). Ad Multiplier is documented as 'Editing variations with Seedance 2.5'. Genjutsu runs on Seedance 2.5 edit / reference mode with the studio's prompts. | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-j-8rpwEzEMqpgGav.js (labels) ; {studio-assets}/tanstack/assets/1a2c0e3d-rkhNhSYh0YPf_F6q.js (studio-multiplier deep link) ; docs/research/parity-marketing-agents.md section 3 | 2026-10-23 |
| The API object swap needs >=409,600 pixels per frame, which is exactly 640x640, Seedance 2.0's documented minimum for reference videos ('between ~480p (640x640) and ~720p (834x1112)'). | **likely** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) ; https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedance-2.0/reference-to-video | 2026-10-23 |
| The API price ($0.318 / $0.681 / $1.632 per input second, now 50% off) does not map cleanly onto Seedance 2.5's token price; the pipeline may add steps (masking, a frame edit) that are not visible. | **unknown** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-10-16 |
| Genjutsu Lite (API genjutsu-light): '480p $0.05, 720p $0.10, 1080p $0.20 per second; billable = output + input reference video durations; trims the source to 15 s'. The studio resells Alibaba Wan 3.0 reference-to-video with the same numbers and the same billing rule, and fal's Wan 3.0 r2v also caps reference video at 15 s and 10 images and bills input video. Genjutsu Lite runs on Wan 3.0 reference-to-video. | **likely** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) (alibaba/wan-3.0/reference-to-video, {studio}/genjutsu-light/*) ; https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=alibaba/wan-3.0/reference-to-video | 2026-10-23 |
| Web form (hf:video-hf-mult-motion-control:v1): sceneMode video \| location \| character, a location image + reference index, a character media id, applyStyle + presetId (style preset), prompt, resolution (default 720p), aspect 'auto', preserveAudio (default on), batch size. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-aKulRVo_05vtPxuq.js | 2026-10-23 |
| Restyle (API): preset_id required (one per request), <=5 character images, source 4-30 s and <=200 MiB, audio kept, 'animation cadence can depend on the selected style'; 20+ styles (changelog 2026-09-30); custom look from <=8 images (web). | **confirmed** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) ; {studio-site}/creator-hub/changelog/rss.xml | 2026-09-30 |

**Behaviour to match**

- **inputs:** one source video 4-30 s (Lite 4-15 s), 1-10 reference images or @Elements (custom Restyle look <=8), optional prompt or preset
- **options:** modes Motion transfer / Objects swap / Restyle (Lite: no Restyle); scene mode video / location / character; style preset; keep audio; resolution 480p / 720p / 1080p (Lite 720p / 1080p on the web); batch
- **defaults:** 720p, aspect auto, keep audio on
- **limits:** source trimmed to 30 s (Lite 15 s), extended to 4 s if shorter; object swap source >=409,600 px per frame; <=200 MiB
- **cost:** web 3 / 7 / 20 credits per s; Lite 1 / 2 / 4 now (list 3 / 6 / 12)

**Fuobe note.** The studio does not appear to own a Genjutsu model; it is prompts and presets on partner video models. Fuobe Original: Wan 2.2 Animate (motion transfer), SAM 3 mask + Wan VACE (object swap), Wan VACE restyle with a first-frame style edit; hosted fal-ai/wan/v2.2-14b/animate/move and /replace, fal-ai/wan-22-vace-fun-a14b/inpainting.


### 3.10 Cinema Studio 4.0

| Claim | Confidence | Source | Date |
|---|---|---|---|
| Help center: 'Cinema Studio 4.0 runs on Seedance 2.5'. | **confirmed** | {studio-site}/creator-hub/help-center/tools/how-do-i-use-cinema-studio | 2026-08-01 |
| Credits 3 / 7 / 16 / 26-27 per second equal the seedance_2_5 row; the API formula (tokens = (input + generated seconds) x width x height x 24 / 1024, $0.0214 per 1k tokens, 0.6x with video input) is Seedance 2.5's token price as fal lists it. | **confirmed** | {studio-service}/job-sets/costs ; {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) ; fal bytedance/seedance-2.5 pricing in docs/research/paid-model-apis-2.json | 2026-10-23 |
| 'Built on top of interchangeable video models'; lenses that 'looked the same in generation' had their character 'amplified ... a lens was tuned by hand'; at 3.0 'the core model underneath changed' and 'none of it was welded to a particular model'. The Director fields are prompt engineering curated by a former DP, not a trained model. | **confirmed** | {studio-site}/blog/how-we-built-cinema-studio | 2026-08-12 |
| Director controls go to the model as slugs (genre, era, pacing, light, camera_model, camera_lens, camera_aperture, camera_movement, color_palette) and as prompt tokens <<<movement:{id}>>>; omitting a field lets 'the director' choose; Prompt Language en / zh. | **confirmed** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) ; docs/research/parity-studios.md section 1 | 2026-10-17 |
| Cinema Studio 3.0 / 3.5 cost 3.5 / 5 / 13 / 24 (list 6 / 6 / 13 / 26) against Seedance 2.0's 3 / 4.5 / 12 / 22 (list 6 / 6 / 12 / 26), and the 3.0 release followed 'a new state-of-the-art video model' in spring 2026. 3.x ran on Seedance 2.0. | **likely** | {studio-service}/job-sets/costs ; {studio-site}/blog/how-we-built-cinema-studio ; {studio-site}/blog/cinema-studio-3 | 2026-03-30 |
| Version 1 (2025-12-18) grew out of 'an image model [that] came out in November 2025' (not named); Nano Banana Pro is the obvious candidate. | **speculative** | {studio-site}/blog/how-we-built-cinema-studio | 2026-08-12 |

**Behaviour to match**

- **inputs:** prompt <=60,000 chars with @ elements and # camera moves, up to 50 references (<=30 images, <=10 videos, <=10 audio; video and audio each <=30 s total, each clip 2-30 s)
- **options:** Director panel: genre 7, era 6, tempo 5, camera body 5, lens 6, aperture 4, 33 moves, 50 palettes, 7 lighting presets + 2-light rig, Emotion Wheel; modes References / Extend forward-backward / Edit; 4-30 s; 21:9-9:16; 480p / 720p / 1080p (API 720p max); bitrate High / Standard; audio; batch 1-4
- **defaults:** every Director control Auto (omitted); 5 s; 16:9; 1080p on the web; High bitrate; audio on
- **cost:** 3 / 7 / 16 credits per second

**Fuobe note.** No studio model here: Seedance 2.5 plus a prompt compiler. Fuobe Original: the existing Director compiler on Wan 2.2 / LTX-2.5 / HunyuanVideo 1.5 with camera LoRAs; hosted Wan 2.2 LoRA or LTX endpoints. Quality will differ from Seedance 2.5. Licence flag: HunyuanVideo 1.5 is under the Tencent Hunyuan Community licence (huggingface.co/tencent/HunyuanVideo-1.5, 2026-10-23), which excludes the EU, UK and South Korea, so it is an option and not the default; LTX-2.x is free only below US$10M annual revenue.


### 3.11 Mixed Media

| Claim | Confidence | Source | Date |
|---|---|---|---|
| The Mixed Media chains start with a 'split' node (input video -> node 'split', port input_videos) and are priced per output frame: per_frame_by_resolution 1k 2, 2k 2, 4k 4 credits; limits 1-10 s and 4-24 fps. It is per-frame image stylisation and reassembly, not a video model. | **confirmed** | {studio-site}/effects (SSR of the Mixed Media presets) | 2026-10-23 |
| 2 credits per frame at 1K/2K and 4 at 4K is exactly the studio's per-image price for Nano Banana Pro (2 credits at 2K, 4 at 4K). Frames are edited by Nano Banana Pro or a model priced the same. | **speculative** | {studio-site}/blog/soul-2-vs-nano-banana-pro (price table) | 2026-09-08 |
| API: POST /chains/mixed-media and /chains/mixed-media-preview {preset_id, config, input_video, start_seconds, end_seconds, target_fps, resolution, width, height}; each preset has its own param_configs (colour pickers, dropdowns, 'Write settings as prompt'). | **confirmed** | docs/research/parity-studios.md section 3 | 2026-10-17 |

**Behaviour to match**

- **inputs:** MP4/MOV 1-10 s, <=50 MB, <=4000 px, aspect 1:3-3:1, >=4 fps; preset; optional image
- **options:** 4 / 8 / 10 / 12 / 24 fps or manual 4-24 (never above the source fps); 1K / 2K / 4K; per-preset colours and dropdowns; preview one frame first
- **defaults:** 8 fps, 1K
- **cost:** floor(seconds x fps) x 2 credits (x2 again at 4K)

**Fuobe note.** Fuobe Original: split -> per-frame edit with a style LoRA or style prompt (Qwen-Image-Edit 2511 / FLUX.2 [klein] 4B, both Apache-2.0; not klein 9B, which is non-commercial) at a fixed seed with the previous styled frame as a reference -> reassemble -> mux audio. Already planned in round 4 (G09).


### 3.12 Shorts Studio restyle

| Claim | Confidence | Source | Date |
|---|---|---|---|
| Changelog: 'Shorts Studio restyles your footage into a new look with 44 presets or a custom moodboard, powered by Gemini Omni Flash'. | **confirmed** | {studio-site}/creator-hub/changelog/rss.xml | 2026-06-30 |
| Estimate 3 credits per input second; the gemini_omni cost row is a flat 3 credits per second. | **confirmed** | {studio-service}/job-sets/costs ; docs/research/parity-studios.md section 2 | 2026-10-23 |
| A custom preset is built from <=10 reference images or videos ('The preset learns the style from them'); with Gemini Omni these are most likely passed as style references, not trained. | **speculative** | docs/research/parity-studios.md section 2 | 2026-10-17 |

**Behaviour to match**

- **inputs:** MP4/MOV 4 s-2 min, <=200 MB, <=4000 px, aspect 1:3-3:1; a preset or custom preset
- **options:** 44 presets; output 9:16 (default) or 16:9; caption language auto or 33 languages; 720p only
- **limits:** output <=10 s per clip; longer sources become a session of segments that are stitched
- **cost:** about 3 credits per input second

**Fuobe note.** No studio model: Gemini Omni Flash plus preset prompts. Fuobe Original: segment -> Wan 2.2 Fun VACE restyle with a style reference -> stitch (already the open Shorts chain).


### 3.13 Speak / UGC / Lipsync Studio / AI Avatars

| Claim | Confidence | Source | Date |
|---|---|---|---|
| The job image2video_extend is labelled 'Speak': Speak (v1) is a DoP-family image-to-video job driven by audio. Speak v2 is a separate model id (studio_speak_v2, 'Speak v2'). | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-j-8rpwEzEMqpgGav.js (IMAGE2VIDEO_EXTEND = 'Speak') ; {studio-assets}/tanstack/assets/1a2c0e3d-zZrfcbsREGSHtTWD.js (studio_speak_v2 = 'Speak v2') | 2026-10-23 |
| Speak v2 price: quality mid = max(14, 2.8 x seconds) credits, high = max(22, 4.4 x seconds). Legacy Speak v1 API: input image + audio, quality mid / high, duration 5 / 10 / 15 s. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-6T_vfMDa9Z2_t1du.js ; {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-10-23 |
| Avatar presets can be raw LoRA files through the staff 'canary' channel (canaryType 'avatar'), as DoP motions can. | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-AsZenCDJK_UeuEwV.js | 2026-10-23 |
| 'Infinite Talk' in Lipsync Studio is MeiGen's open InfiniteTalk (Apache-2.0, on Wan 2.1 I2V 14B): the form sends motion_frame 15, sample_steps 25, sample_shift 10, sample_text_guide_scale 5, sample_audio_guide_scale 5, color_correction_strength 1, use_teacache false / teacache_thresh 0.2, use_apg false / apg_momentum -0.75 / apg_norm_threshold 55, scene_seg false, and lora 'fusex' at scale 1, rank 32. These are InfiniteTalk's own CLI flags, and its README recommends the FusioniX LoRA. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-WdalZTpoZ_pO7J7g.js ; https://github.com/MeiGen-AI/InfiniteTalk/blob/main/generate_infinitetalk.py ; https://github.com/MeiGen-AI/InfiniteTalk | 2026-10-23 |
| The other Lipsync Studio engines are partner models and are labelled as such: Google Veo 3 / 3.1 Speak, Kling Avatars 2.0, Kling Lipsync, Kling 2.6 Lipsync, Wan 2.5 Speak, Sync Lipsync 3, plus an unlabelled 'hummingbird' engine (vendor unverified). | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-j-8rpwEzEMqpgGav.js ; {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-lipsync-voiceover-and-aspect-ratios | 2026-10-23 |
| One creator test reports Speak output at 16 fps (consistent with a Wan-lineage DoP base). Not verified. | **speculative** | search summary of third-party comparison (source page unreachable) | 2026-10-23 |
| Marketing Studio UGC videos run on Seedance 2 (inferred from the UGC skill page); avatars are a library of 100+ preset people. | **likely** | docs/research/parity-marketing-agents.md section 1.1, 1.9 | 2026-10-17 |

**Behaviour to match**

- **inputs:** character image or video (or an avatar preset), audio: typed text (TTS), upload MP3/WAV/MP4 <=100 MB, or a recording
- **options:** model per engine; scene templates (General, Selfie, Podcast, Car Talking...); emotion prompt; Speak v2 quality mid / high
- **cost:** Speak v2: max(14, 2.8/s) or max(22, 4.4/s) credits; InfiniteTalk and others per their own rows

**Fuobe note.** Fuobe Original: InfiniteTalk + FusioniX LoRA with the studio's exact defaults (motion_frame 15, 25 steps, shift 10, text/audio guidance 5/5) is a like-for-like copy of one Lipsync Studio engine; hosted fal-ai/infinitalk. Speak v1 = the DoP Original with audio-driven avatar LoRAs (speculative).


### 3.14 Upscale (and FLUX 3 Video Upscaler)

| Claim | Confidence | Source | Date |
|---|---|---|---|
| In October 2025 'Upscale' was sold as an 'all-in-one model' running 'a sophisticated AI pipeline'; no engine was named. | **confirmed** | {studio-site}/blog/Upgrade-the-Quality-of-Old-Videos-using-Upscale ; {studio-site}/blog/Restore-Your-Old-Video-With-studio-Upscale | 2025-10-14 |
| Today every upscale engine is labelled by vendor: Topaz Upscale / Topaz Video Upscale, ByteDance (Video) Upscale, FLUX.3 Upscale, Sora 2 Upscale, SDR to HDR (Topaz Hyperion 2.5), FPS Boost (Topaz). The restoration guide names ByteDance Upscale and FLUX.3 Upscale. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-j-8rpwEzEMqpgGav.js ; {studio-site}/blog/ai-video-restoration-high-quality | 2026-09-03 |
| A legacy form 'hf:upscale-studio-form-v1' (input video, scale factor 'Original' or explicit output width / height) is still in the client; its engine is not visible. | **unknown** | {studio-assets}/tanstack/assets/1a2c0e3d-fnzoVYJgG1sOh-KU.js | 2026-10-23 |
| The image 'generative upscale' form (creativity 1, texture 1, detail 1, enhance on, prompt, 2K / 4K) maps to TOPAZ_IMAGE_GENERATIVE, labelled 'Topaz Upscale'. | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-XNsL4PPW2QRnPYVs.js ; {studio-assets}/tanstack/assets/1a2c0e3d-j-8rpwEzEMqpgGav.js | 2026-10-23 |
| FLUX 3 Video Upscaler is Black Forest Labs' model; the 2026-10-15 build is 'Currently available only on the studio'; fal lists blackforestlabs/flux-video-upscale. | **confirmed** | {studio-site}/creator-hub/changelog/rss.xml ; docs/research/parity-delta-4.md section 4.3 | 2026-10-15 |

**Behaviour to match**

- **inputs:** video (FLUX.3 <=20 s, <=50 MB; ByteDance <=600 s; Topaz <=50 MB) or image
- **options:** see parity-delta-4.md section 4.3 (all four engines, FPS Boost, SDR to HDR, codecs)
- **cost:** FLUX.3 Precise 0.5-8 credits/s, Creative about 1.4x; ByteDance 2-30 credits/s by target

**Fuobe note.** Not a studio model. Fuobe Original: SeedVR2 3B/7B (Apache-2.0) for video, Real-ESRGAN / SeedVR2 image, RIFE (MIT) for FPS (GIMM-VFI's licence was not checked), LTX-2.5 HDR IC-LoRA (LTX-2.x Community, gated); hosted fal-ai/seedvr/upscale/video.


### 3.15 Marketing Studio Image

| Claim | Confidence | Source | Date |
|---|---|---|---|
| API docs: /marketing-studio/image/flare is 'GPT Image 2.5 Flare' and /sunburst is GPT Image 2.5 Sunburst; billing uses OpenAI-style token rates (text in $5, image in $8, image out $30 per 1M). | **confirmed** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-10-16 |
| '2.0 Alpha' (/marketing-studio/image, job marketing_studio_2_image) is GPT Image 2: the client maps imagegen_2_0 to [IMAGEGEN_2_0, GPT_IMAGE_2_UNLIMITED] and 'OpenAI Hazel' is the internal job family behind GPT Image 2 / 2.5. | **likely** | {studio-assets}/tanstack/assets/1a2c0e3d-bVAKjTf4sPsChx8C.js ; docs/research/parity-delta-4.md section 2.3 | 2026-10-23 |
| Presets (preset_id) work only with enhance_prompt, product image first and an optional model image second: presets are prompt templates over GPT Image. | **confirmed** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-10-16 |

**Behaviour to match**

- **inputs:** prompt <=5,000 chars, <=16 images (edit) or 1-2 with a preset
- **options:** quality low / medium / high (Alpha) or + xhigh / max (Flare, Sunburst); 1K / 2K / 4K; aspect auto + list; moderation auto / low
- **defaults:** 2K; auto aspect uses the preset ratio when enhancing, square otherwise
- **cost:** Flare / Sunburst $0.0126 (1K) - $0.7219 (4K) list

**Fuobe note.** Not a studio model. Fuobe Original: Qwen-Image-Edit 2511 (product + person) with template prompts; hosted fal Qwen edit endpoints with LoRA. Licence flag: FLUX.2 [dev] weights are non-commercial, so FLUX.2 [dev] edit is only a hosted alternative on fal (whose output terms cover it), never the self-hosted default; FLUX.2 [klein] 4B (Apache-2.0) is the commercial-safe FLUX option.


### 3.16 Ads Studio

| Claim | Confidence | Source | Date |
|---|---|---|---|
| API docs: 'Ad concepts are prepared automatically, then rendered as images', 'Rendering uses GPT Image 2.5 Flare with fixed 2k resolution and high quality'; token rates include LLM text output. | **confirmed** | {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) ({studio}/ads-studio/v1.0) | 2026-10-16 |
| Web flow: website -> brand research agent (service fnf-ai-cmo, inferred) -> brand kit -> products -> up to 20 ads per product at 4 credits each. | **confirmed** | docs/research/parity-marketing-agents.md section 2 | 2026-10-17 |

**Behaviour to match**

- **inputs:** brief <=8,000 chars, <=10 product images, target_audience <=2,000, niche <=1,000, language
- **options:** aspect 1:1, 4:5, 5:4, 16:9, 9:16, 4:3, 3:4, 21:9, 3:2, 2:3, 2:1, 1:2, 3:1, 1:3 (no auto); batch 1-8 concepts
- **cost:** about $0.084 per image (API); 4 credits per ad (web)

**Fuobe note.** Not a studio model: an LLM concept step + GPT Image 2.5. Fuobe Original: local or Claude LLM writes N concepts -> open image edit model renders each with headline/CTA text (Qwen-Image handles text well).


### 3.17 AI Influencer

| Claim | Confidence | Source | Date |
|---|---|---|---|
| The builder (19 categories, tiers Average / Bold / Extreme, 6 creature types, Shuffle weights) sends structured choices (selection, trait_variants, body_color, pinned_species, variation_index) to /{studio}/ai-influencer; it is a prompt compiler on an image model. | **confirmed** | docs/research/parity-delta-4.md section 4.5 ; {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-10-22 |
| A banner in the AI Influencer UI strings reads 'Seedream 5 is Rolling out': the sheet renderer is Seedream 5.0. | **speculative** | docs/research/parity-delta-4.md section 4.5 | 2026-10-22 |
| Price: 1.12 credits (about $0.06) per character on the web; API $0.05 per sheet. | **confirmed** | {studio-site}/blog/new-ai-influencer ; {studio-docs}/llms-full.txt and {studio-dashboard}/api/v2/pricing/models/ (as recorded in docs/research/parity-api.json, read 2026-10-16) | 2026-10-03 |
| 'Add motion' runs Genjutsu: ai_influencer_motion_control / _replace_object / _restyle are labelled 'Genjutsu - ...', same 3 / 7 / 20 ladder; the _flash variants are Genjutsu Lite. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-j-8rpwEzEMqpgGav.js ; {studio-service}/job-sets/costs | 2026-10-23 |

**Behaviour to match**

- **inputs:** start from scratch, a reference, or your photo ('Add your face'); <=3 clothing references; style reference; direction text <=4,000
- **options:** see parity-delta-4.md section 4.5 (all options, conflicts, Shuffle weights)
- **outputs:** a 16:9 character sheet (portrait + full body on white)
- **cost:** 1.12 credits per character; 5 free generations

**Fuobe note.** Fuobe Original: the builder as a phrase compiler -> Z-Image / Qwen-Image sheet; 'Add your face' with Qwen-Image-Edit 2511; motion via the Genjutsu Original.


### 3.18 Photodump / Instadump

| Claim | Confidence | Source | Date |
|---|---|---|---|
| Legacy Photodump Studio (2025-09-18) runs Soul v1 (text2image_soul), one fixed 26-shot set. | **confirmed** | docs/research/parity-image-studios.md section 2 | 2026-10-17 |
| Soul 2.0 Photodump calls POST /custom-references/photo-dump {name, input_images, pack_id, version v2} for a new character or /custom-references/retrain-with-photo-dump {custom_reference_id, pack_id} for an existing one, then /jobs/text2image-soul/batch {custom_reference_id, pack_id, version v2}. The character is (re)trained together with the pack. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-qBCUG-sJSKad0znr.js ; {studio-assets}/tanstack/assets/1a2c0e3d-zZrfcbsREGSHtTWD.js | 2026-10-23 |
| Instadump runs Popcorn keyframes 'photo-dump-pack' with checkpoint '260000', sample_solver 'unipc', quality 1600p, portrait, preset bc8c784e-dfab-4255-9952-e1a947a94983; Popcorn itself defaults to checkpoint '350000'. These are training-step numbers of a diffusion model the studio trains and serves itself. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-f02VGrdS0nW5DnKA.js ; {studio-assets}/tanstack/assets/1a2c0e3d-mkFMhLoVRn0KoWSv.js | 2026-10-23 |
| 'sample_solver' with value 'unipc' is Wan's own CLI flag and default (Wan2.1/2.2 generate.py), and Popcorn makes up to 8 frames as one consistent sequence. Popcorn is a Wan-lineage model fine-tuned to emit frame sequences. | **speculative** | https://github.com/Wan-Video/Wan2.1/blob/main/generate.py ; {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-popcorn | 2026-10-23 |

**Behaviour to match**

- **inputs:** Photodump: a Soul ID character (or create one: 20+ photos, consent); Instadump: one selfie <20 MB or a saved character, plus a pack (or create a pack from <=15 photos)
- **options:** 9 Soul 2.0 packs (10-17 shots), 5 public Instadump packs; Instadump aspect Auto, 9:16, 3:4, 2:3, 1:1, 4:3, 16:9, 3:2
- **cost:** Instadump 10 credits per run

**Fuobe note.** Fuobe Original: character LoRA + one prompt per pack shot (Photodump); zero-shot identity with Qwen-Image-Edit 2511 multi-reference over pack prompts (Instadump). Pack prompts are Fuobe's own.


### 3.19 Fashion Factory

| Claim | Confidence | Source | Date |
|---|---|---|---|
| Step 2 (4 base shots) is a Soul v1 job with fashion_factory_id, custom_reference_id, 1080p, 3:4, enhance on, empty prompt; step 4 (outfit) and step 5 (photoset, product-placement batch) run on Nano Banana (client keys fashionsFactorySoul, fashionFactoryNanoBanana). | **confirmed** | docs/research/parity-image-studios.md section 3 | 2026-10-17 |

**Behaviour to match**

- **inputs:** template (6), Soul ID character, one outfit / product image
- **options:** pick 1 of 4 base shots; pick an outfit result; photoset batch
- **steps:** template -> character -> base shot -> outfit -> photoset

**Fuobe note.** Half the studio (Soul), half Google (Nano Banana). Fuobe Original: Soul Original base shots + Qwen-Image-Edit 2511 / FLUX.2 [klein] try-on + per-template shot prompts.


### 3.20 Evolution

| Claim | Confidence | Source | Date |
|---|---|---|---|
| Gated test model ('TEST MODEL; VISIBLE ONLY FOR USERS WITH STUDIO AI/COM EMAIL'); copy 'Upload a video and let Evolution take it further'. | **confirmed** | docs/research/parity-delta-4.md section 4.11 | 2026-10-22 |
| Request schema: model hf_evolution, resolution 480p / 720p / 1080p (default 720p), change_intensity low \| medium \| high, medias = exactly 1 video + images (<=41 items), reference_element_ids <=40 unique, creative_direction <=10,000 chars. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-5CNwuroBqZ9M11C7.js | 2026-10-23 |
| 7 credits per second at 720p, the Seedance 2.5 720p price (generate 7, edit 7.5): Evolution is a Seedance 2.5 edit with an LLM-written creative direction. | **speculative** | {studio-service}/job-sets/costs | 2026-10-23 |

**Behaviour to match**

- **inputs:** one video 4-30 s, optional images and elements, optional creative direction
- **options:** change intensity Low / Mid / High; resolution 480p / 720p / 1080p
- **cost:** 7 credits per second at 720p (only row published)

**Fuobe note.** Fuobe Original: Wan VACE or LTX video-to-video with denoise by intensity (0.45 / 0.65 / 0.85 proposed in round 4) and an LLM-written direction.


### 3.21 Mirelo / Sonilo audio

| Claim | Confidence | Source | Date |
|---|---|---|---|
| The client labels mirelo_text_to_audio 'Mirelo' and sonilo_music 'Sonilo' (vendor names, not the studio's products); costs 0.25 and 0.0625 credits per second. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-hhRopV6TrM_NdTk7.js ; {studio-assets}/tanstack/assets/1a2c0e3d-zT1lJEtxIyoxCB37.js | 2026-10-23 |
| Both vendors sell their own APIs on fal (mirelo-ai/sfx2.0/*, sonilo/v1.1/*) and Replicate (mirelo/video-to-sfx-v1.5). | **confirmed** | docs/research/paid-model-apis-3.json | 2026-10 |
| The studio does not call them its own; the Audio post lists third-party engines (Seed Audio, Qwen Audio, MiniMax Speech, VibeVoice, ElevenLabs). | **confirmed** | {studio-site}/blog/{studio}-audio | 2026-07-31 |

**Behaviour to match**

- **inputs:** prompt and duration (SFX); prompt (music)

**Fuobe note.** Partner models, not Originals. Open alternatives: ThinkSound (Apache-2.0) or Stable Audio 3 Small (Stability Community licence, free under US$1M revenue) for SFX, ACE-Step 1.5 (Apache-2.0) for music. Licence flags: MMAudio weights are CC-BY-NC-4.0 (huggingface.co/hkchengrex/MMAudio, 2026-10-23), so it is not a commercial default when self-hosted; HunyuanVideo-Foley excludes the EU, UK and South Korea.


### 3.22 Rebranded open models (Angles, Recast / Animate, Infinite Talk, Depth Map, Remove Background)

| Claim | Confidence | Source | Date |
|---|---|---|---|
| 'Angles' is job QWEN_CAMERA_CONTROL and sends rotate_degree, move_forward_level, vertical_angle, sample_steps and loras [{name:'lightx', strength}, {name:'camera_angle', strength}]. The open recipe is Qwen-Image-Edit-2509 + dx8152 Multiple-angles LoRA (Apache-2.0, 2025-10-31) + a Lightning LoRA; the public HF Space uses rotate_deg, move_forward and vertical_tilt. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-rSfLYhMkPbN1soeD.js ; {studio-assets}/tanstack/assets/1a2c0e3d-j-8rpwEzEMqpgGav.js ; https://huggingface.co/dx8152/Qwen-Edit-2509-Multiple-angles ; https://huggingface.co/spaces/linoyts/Qwen-Image-Edit-Angles | 2026-10-23 |
| Wan 2.2 Animate (Apache-2.0) is shown as 'Animate' (WAN2_2_ANIMATE, _V2) and 'Recast' (WAN2_2_ANIMATE_V3, WAN2_2_ANIMATE_REVOICE); the 'fans-studio' app and 'Video Face Swap' also run on Wan 2.2 Animate jobs. The main label map (j-8rpwEzEMqpgGav.js) still calls WAN2_2_ANIMATE / _V2 'Wan 2.2 Animate' / 'Wan 2.2 Animate V2' and WAN2_2_ANIMATE_FACESWAP 'Wan 2.2 Faceswap'; only XQvVauJI5fIVvC8i.js says 'Animate'. | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-XQvVauJI5fIVvC8i.js ; {studio-assets}/tanstack/assets/1a2c0e3d-j-8rpwEzEMqpgGav.js | 2026-10-23 |
| Infinite Talk = MeiGen InfiniteTalk + FusioniX LoRA (see the Speak entry); Depth Map = Video Depth Anything (VDA-Large); Remove Background = SAM 3 video. Licence flag: VDA-Large weights are CC-BY-NC-4.0 (huggingface.co/api/models/depth-anything/Video-Depth-Anything-Large, 2026-10-23), so the open Original uses VDA-Small (Apache-2.0) or Depth Anything 3 Mono-Large (Apache-2.0, Fuobe's video-depth-da3). | **confirmed** | {studio-assets}/tanstack/assets/1a2c0e3d-WdalZTpoZ_pO7J7g.js ; docs/research/parity-delta-4.md section 4.3 | 2026-10-23 |

**Behaviour to match**

- **angles:** rotate degree, move forward level, vertical angle; LoRA strengths are staff-only

**Fuobe note.** These are the cases where the hypothesis is literally true: an open model plus public LoRAs under a studio name. Fuobe can match them exactly, with one licence exception: Depth Map's VDA-Large is non-commercial, so Fuobe's Depth Map uses VDA-Small or Depth Anything 3 Mono-Large instead. The others are commercial-safe: Qwen-Image-Edit 2509, the Multiple-angles LoRA, Qwen-Image-Lightning, Wan 2.2 Animate, InfiniteTalk and the FusioniX repo are Apache-2.0, and SAM 3 is under Meta's SAM License, which is royalty-free and allows commercial use apart from trade-control and military use limits.


---

## 4. Conflicts and open questions

- **"Own foundation model" against "on top of interchangeable models".** Both are the studio's statements about Soul, a month apart (2026-08-12 and 2026-09-08). The code supports a self-hosted base with LoRA presets. Neither statement names the base.
- **Genjutsu reference counts.** The launch blog says up to 30 reference images, the web code allows 1–10 and the API 1–8. Lite's source length is 4–15 s in the changelog and API, but the code constant allows 30 s.
- **Genjutsu API price.** The web credits match Seedance 2.5, but the API's $0.318 / $0.681 / $1.632 per input second does not fit Seedance 2.5's token price for equal input and output. The pipeline may include extra steps.
- **Mixed Media engine.** The per-frame price equals Nano Banana Pro's per-image credits, but nothing names the model.
- **Soul v1 base.** The current backend ("version 3") shares its exact defaults and resolution function with the studio's Wan 2.2 image form. The June 2025 launch model cannot have been Wan 2.2.
- **Speak v2 base.** It has its own model id and price formula; nothing public names its engine.
- **"Upscale" (2025).** The old branded upscaler's engine was never named. The legacy form still exists, but every current engine is a named partner.
- **DoP and reinforcement learning.** The claim that DoP "blends diffusion with reinforcement learning" comes from a launch post that now returns 404. It survives only in search indexes and press copies.

### 4.1 Critic re-check (2026-10-23)

A second pass re-fetched the sources behind the facts marked **confirmed** that the build plan depends on. Results:

| fact | re-checked against | result |
|---|---|---|
| Soul 2.0 / Soul Cinema styles carry `lora` and `lora_2`; staff panel "LoRA 1/2" and "(Dev) Preset Strength" | `1a2c0e3d-OWMkRGYJAoV9LLH0.js` | holds. Picking a style also copies its `lora_2` into the request's `lora` field |
| Infinite Talk = InfiniteTalk + `fusex` LoRA, motion_frame 15, 25 steps, shift 10, guidance 5/5 | `1a2c0e3d-WdalZTpoZ_pO7J7g.js` | holds. Corrected: `use_teacache` and `use_apg` default to false |
| Angles sends `loras [{lightx}, {camera_angle}]`, rotate_degree, move_forward_level, vertical_angle | `1a2c0e3d-rSfLYhMkPbN1soeD.js` | holds |
| `.safetensors` motion ids ("Canary", `loras/` prefix) | `1a2c0e3d-ggrIiLPSJckmqaiD.js`, `-Iy-LDiMETMj_D3ZQ.js`, `-zZrfcbsREGSHtTWD.js` | holds. Added: such an id is sent as `reference`, not `motion_id` |
| WAN2_2_ANIMATE = "Animate" | `-XQvVauJI5fIVvC8i.js`, `-j-8rpwEzEMqpgGav.js` | partly. One label function says "Animate", the main label map says "Wan 2.2 Animate". Corrected in §2.3 and §3.22 |
| Popcorn / Instadump `checkpoint` and `sample_solver` | `1a2c0e3d-f02VGrdS0nW5DnKA.js` | holds |
| "Cinema Studio 4.0 runs on Seedance 2.5" | help-center article (WebFetch) | holds, verbatim |
| Terms forbid training on outputs | {studio-site}/terms-of-use-agreement (last updated 2026-10-23) | holds. The quotation was a paraphrase and is replaced with the exact wording; §5.2(v) (no reverse engineering) is added |
| Wan 2.1 / 2.2 release dates, 16 fps / 81 frames | Wan2.1 and Wan2.2 READMEs, `wan/configs/shared_config.py` | holds (2025-02-25, 2025-07-28) |
| Open-model licences named here | Hugging Face model API | Z-Image Turbo, Qwen-Edit 2509 Multiple-angles, Qwen-Image-Lightning, Wan 2.2 Animate, InfiniteTalk, FusioniX repo, SeedVR2 3B/7B, FLUX.2 klein 4B, ThinkSound: Apache-2.0. Flagged: Video-Depth-Anything-Large, DA3 Large/Giant and MMAudio are CC-BY-NC-4.0; FLUX.2 klein 9B is FLUX Non-Commercial; HunyuanVideo 1.5 is Tencent Hunyuan Community (territory-restricted); LTX-2.x is free under US$10M revenue |

## 5. Sources

Bundle chunks are under `{studio-assets}/tanstack/assets/` and named `1a2c0e3d-<id>.js` (build 1a2c0e3d, read 2026-10-23). The other sources are listed below with the date they carry, or the read date.

- https://api.ashbyhq.com/posting-api/job-board/{studio}
- {studio-dashboard}/api/v2/pricing/models/
- {studio-docs}/llms-full.txt
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=alibaba/wan-3.0/reference-to-video
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedance-2.0/reference-to-video
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedance-2.5/reference-to-video
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/infinitalk
- {studio-service}/job-sets/costs
- https://github.com/MeiGen-AI/InfiniteTalk
- https://github.com/MeiGen-AI/InfiniteTalk/blob/main/generate_infinitetalk.py
- https://github.com/Wan-Video/Wan2.1/blob/main/generate.py
- https://github.com/Wan-Video/Wan2.2/blob/main/wan/configs/shared_config.py
- https://github.com/Wan-Video/Wan2.2/blob/main/wan/configs/wan_i2v_A14B.py
- {studio-github}/{studio}
- https://habr.com/en/articles/930074
- {studio-site}/blog/{studio}-Fastest-Model-Yet-Introducing-Turbo
- {studio-site}/blog/{studio}-SOUL-Turns-Prompts-Into-Fashion-Ready-Shots
- {studio-site}/blog/Introducing-studio-DoP-preview
- {studio-site}/blog/Restore-Your-Old-Video-With-studio-Upscale
- {studio-site}/blog/Upgrade-the-Quality-of-Old-Videos-using-Upscale
- {studio-site}/blog/Why-Does-Your-AI-Characters-Face-Keep-Changing
- {studio-site}/blog/ai-video-restoration-high-quality
- {studio-site}/blog/cinema-studio-3
- {studio-site}/blog/{studio}-audio
- {studio-site}/blog/{studio}-genjutsu
- {studio-site}/blog/{studio}-series-b-extension-tcv-nvidia
- {studio-site}/blog/how-we-built-cinema-studio
- {studio-site}/blog/new-ai-influencer
- {studio-site}/blog/sitemap.xml
- {studio-site}/blog/soul-2-vs-nano-banana-pro
- {studio-site}/blog/soul-cinema-preview
- {studio-site}/creator-hub/changelog/rss.xml
- {studio-site}/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially
- {studio-site}/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character
- {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-dop
- {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-lipsync-voiceover-and-aspect-ratios
- {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-popcorn
- {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-soul-cinema
- {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-soul-to-generate-images
- {studio-site}/creator-hub/help-center/ai-models/which-ai-model-should-i-use
- {studio-site}/creator-hub/help-center/tools/how-do-i-use-cinema-studio
- {studio-site}/creator-hub/sitemap.xml
- {studio-site}/effects
- {studio-site}/effects/use/agamemnon
- {studio-site}/motion/70e490b9-26b7-4572-8d9c-2ac8dcc9adc0
- {studio-site}/terms-of-use-agreement (Terms of Use, last updated 2026-10-23; sections 5.1(iii), 5.2(iv), 5.2(v))
- {studio-site}/blog/terms-of-use-privacy-policy-update (terms effective 2026-08-27)
- https://github.com/Wan-Video/Wan2.1 and https://github.com/Wan-Video/Wan2.2 (README news dates)
- https://huggingface.co/api/models/depth-anything/Video-Depth-Anything-Large (cc-by-nc-4.0), .../Video-Depth-Anything-Small (apache-2.0), .../DA3MONO-LARGE (apache-2.0), hkchengrex/MMAudio (cc-by-nc-4.0), tencent/HunyuanVideo-1.5 (tencent-hunyuan-community), black-forest-labs/FLUX.2-klein-9B (flux-non-commercial-license); all read 2026-10-23
- https://raw.githubusercontent.com/facebookresearch/sam3/main/LICENSE (SAM License, 2025-11-19)
- https://huggingface.co/api/models?author={studio}
- https://huggingface.co/dx8152/Qwen-Edit-2509-Multiple-angles
- https://huggingface.co/lightx2v/Qwen-Image-Lightning
- https://huggingface.co/spaces/linoyts/Qwen-Image-Edit-Angles
- https://jobs.ashbyhq.com/{studio}/85b5edb9-953c-4070-86d9-435b503e7fdd
- https://jobs.ashbyhq.com/{studio}/a1c3bffb-7243-45f8-ace6-ceb89239c475
- https://x.com/studio_ai/status/1906783445998576078

Bundle chunks cited: `1a2c0e3d-0blEp5LFilNYgohY.js`, `1a2c0e3d-5CNwuroBqZ9M11C7.js`, `1a2c0e3d-6T_vfMDa9Z2_t1du.js`, `1a2c0e3d-8aFpO6t7Cp0SWUOD.js`, `1a2c0e3d-9FGSk7QYv-N6eo4s.js`, `1a2c0e3d-AsZenCDJK_UeuEwV.js`, `1a2c0e3d-HtLX1-VrFGqZts-S.js`, `1a2c0e3d-Iy-LDiMETMj_D3ZQ.js`, `1a2c0e3d-KUiNKl77EPPShy_-.js`, `1a2c0e3d-OWMkRGYJAoV9LLH0.js`, `1a2c0e3d-T9xctyEJxpuOr_cw.js`, `1a2c0e3d-TdHwWn7lmpxFnflF.js`, `1a2c0e3d-WdalZTpoZ_pO7J7g.js`, `1a2c0e3d-XNsL4PPW2QRnPYVs.js`, `1a2c0e3d-XQvVauJI5fIVvC8i.js`, `1a2c0e3d-aKulRVo_05vtPxuq.js`, `1a2c0e3d-bVAKjTf4sPsChx8C.js`, `1a2c0e3d-f02VGrdS0nW5DnKA.js`, `1a2c0e3d-fnzoVYJgG1sOh-KU.js`, `1a2c0e3d-ggrIiLPSJckmqaiD.js`, `1a2c0e3d-hhRopV6TrM_NdTk7.js`, `1a2c0e3d-j-8rpwEzEMqpgGav.js`, `1a2c0e3d-mkFMhLoVRn0KoWSv.js`, `1a2c0e3d-mmG45x-JfVHU3YSS.js`, `1a2c0e3d-o7a2AEODUzAhb9dz.js`, `1a2c0e3d-oxiisOFH5LKersmF.js`, `1a2c0e3d-qBCUG-sJSKad0znr.js`, `1a2c0e3d-rSfLYhMkPbN1soeD.js`, `1a2c0e3d-rkhNhSYh0YPf_F6q.js`, `1a2c0e3d-rtPQH-IoMEs0TwgC.js`, `1a2c0e3d-zT1lJEtxIyoxCB37.js`, `1a2c0e3d-zZrfcbsREGSHtTWD.js`.


Repo files cited: `docs/research/parity-api.json` (API docs and pricing API, read 2026-10-16), `parity-studios.md`, `parity-image-studios.md`, `parity-inventory.md`, `parity-delta-4.md`, `parity-marketing-agents.md`, `paid-model-apis-2.json`, `paid-model-apis-3.json`.
