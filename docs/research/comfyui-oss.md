# Fuobe research: open-weight + ComfyUI equivalents of the parity studio capabilities

_As of 2026-10-16. Companion machine-readable file: `comfyui-oss.json` (same data: options, model files with URLs/sizes/folders, settings, LoRA catalog, ComfyUI API reference)._

**How this was produced.** Model lists, folders, URLs and sampler settings were extracted from the 302 open-source templates in [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates) (`templates/index.json` + each `templates/<name>.json`: node `properties.models`, KSampler/scheduler widget values), file sizes and licenses from the Hugging Face model API, settings/VRAM statements from the matching [docs.comfy.org](https://docs.comfy.org) tutorials, and API behaviour from ComfyUI `server.py`/`execution.py`/`comfy_api` source. Where a value is an estimate it is labelled as such.

## 1. Executive summary

* **2026 landscape changes vs. 2025:** ComfyUI core now natively runs almost everything Fuobe needs: Wan 2.2 (all variants incl. Animate, S2V, Fun Camera/Control/VACE), **Wan Animate 2** and **SCAIL-2** (motion transfer / character replacement), **InfiniteTalk** and HuMo (lipsync), **LTX-2.3/2.5** (open 22B audio+video, multishot, 4K), **MiniMax H3** (33B audio+video, restrictive license), HunyuanVideo 1.5, **Z-Image**, **Qwen-Image-2512 / Edit-2511 / Qwen Image 2.1**, **FLUX.2 / FLUX.2 klein / FLUX 3 Image Klein (released 2026-10-15)**, **Krea 2**, HiDream-O1, **BiRefNet** background removal, **SAM 3.1**, **SeedVR2** upscaling, **RIFE/FILM** interpolation, ACE-Step 1.5/XL, MiniMax Music 3, YuE2, Stable Audio 3 and an LLM `TextGenerate` node (Qwen3.5 / Qwen3-VL / Gemma 4) for prompt enhancement.
* **Still custom-node territory:** TTS (Chatterbox, Qwen3-TTS, IndexTTS-2, VibeVoice, Kokoro), video-to-audio foley (MMAudio, HunyuanVideo-Foley), LatentSync re-dubbing, ReActor face swap, Uni3C/ReCamMaster/Phantom/MultiTalk/FantasyTalking (kijai WanVideoWrapper), LTX IC-LoRA dub/outpaint workflows (ComfyUI-LTXVideo), Wan 2.2 Animate preprocessing, Ollama, FlashVSR, GIMM-VFI.
* **Not available as open weights:** Wan 2.5/2.6/2.7/3.0, Kling, Veo, Seedance, Nano Banana, the parity studio's own DoP/Soul models (the parity studio ships "Genjutsu Motion Transfer" only as a paid ComfyUI partner node).
* **Licensing is the main product constraint.** Commercially clean core stack: Z-Image (Apache), Qwen-Image-2512 / Edit-2509/2511 (Apache), FLUX.2 klein 4B (Apache), Wan 2.1/2.2/Animate 2 (Apache), SCAIL-2 (MIT), HiDream-O1 (MIT), BiRefNet (MIT), SeedVR2 (Apache), ACE-Step 1.5 (Apache), MiniMax Music 3 (Apache), Chatterbox (MIT), Qwen3-TTS (Apache). Revenue-gated: FLUX 3 Klein (< US$5M), LTX-2.x (< US$10M), Krea 2 (community tiers), Stable Audio 3 (< US$1M). Non-commercial: Qwen Image 2.1, FLUX.1/2 [dev] + Kontext + Krea-dev + klein 9B, YuE2, MMAudio, F5-TTS, SUPIR, 4x-UltraSharp, InsightFace swappers. Territory-restricted: MiniMax H3 (excludes US/EU/UK/KR), Tencent Hunyuan (excludes EU/UK/KR).
* **Hardware baseline:** a 24 GB GPU (RTX 4090/3090) runs every rank-1 option with fp8/int8 weights and ComfyUI offloading (LTX-2.5 only with heavy offload); 32 GB (RTX 5090) is comfortable for LTX-2.5 and FLUX.2 dev; MiniMax H3 wants 32-48 GB. 12-16 GB cards can serve Z-Image-Turbo, FLUX.2 klein 4B, Wan 2.2 5B, SeedVR2 3B, BiRefNet and audio.

### Recommended default per capability (rank 1)

| Capability | Rank-1 option | Template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| `t2i` | Z-Image-Turbo (6B, 8-step) + UltraReal/realism LoRA | image_z_image_turbo | core | Apache-2.0 | ~16 GB bf16 (docs: "fits within 16GB VRAM"); ~10-12 GB with int8/fp8 TE |
| `edit` | Qwen-Image-Edit-2511 + Lightning 4-step LoRA | image_qwen_image_edit_2511 (int8: image_qwen_image_edit_2511_int8) | core | Apache-2.0 | ~24 GB with offload (fp8mixed DiT 20.5 GB + TE 9.4 GB); 16 GB possible with int8/GGUF + offload |
| `inpaint` | Qwen-Image + InstantX Inpainting ControlNet (+ Lightning) | image_qwen_image_instantx_inpainting_controlnet | core | Apache-2.0 | ~24 GB |
| `bg-remove` | BiRefNet (native RemoveBackground node) | utility_birefnet_remove_background | core | MIT | <2 GB |
| `relight` | Qwen-Image-Edit-2509 + Relight LoRA | image_qwen_image_edit_2509_relight | core | Apache-2.0 | ~24 GB |
| `angles` | Qwen-Image-Edit-2511 + fal Multiple-Angles LoRA + QwenMultiangleCameraNode | template_qwen_multiangle.app / templates-1_click_multiple_character_angles-v1.0 | custom: [ComfyUI-qwenmultiangle](https://github.com/jtydhr88/ComfyUI-qwenmultiangle) | Apache-2.0 | ~24 GB |
| `face-swap` | BFS "Best Face Swap" head-swap LoRA on Qwen-Image-Edit-2511 | image_qwen_image_edit_2511 (+ LoRA) | core | LoRA MIT; base Apache-2.0 | ~24 GB |
| `character-lora` | Train identity LoRA with ai-toolkit on Z-Image (De-Turbo) / Krea 2 RAW / FLUX 3 Klein base; infer on the turbo model | - | core + [ai-toolkit](https://github.com/ostris/ai-toolkit) | ai-toolkit MIT; LoRA inherits base model license | training 24 GB (16 GB with quantization/low-VRAM presets); inference as base model |
| `t2v` | Wan 2.2 14B T2V (MoE high/low noise) + Lightx2v 4-step | video_wan2_2_14B_t2v | core | Apache-2.0 | 24 GB (RTX 4090D: 84-89% VRAM at 640x640x81, ~70-110 s with 4-step LoRA) |
| `i2v` | Wan 2.2 14B I2V + Lightx2v 4-step | video_wan2_2_14B_i2v | core | Apache-2.0 | 24 GB (fp8); 12-16 GB possible with community GGUF quants via city96/ComfyUI-GGUF + offload (slower, estimate) |
| `flf2v` | Wan 2.2 14B FLF2V (I2V experts) + Lightx2v | video_wan2_2_14B_flf2v | core | Apache-2.0 | 24 GB |
| `ref2v` | Wan 2.1 VACE 14B reference-to-video (+ CausVid / Lightx2v) | video_wan_vace_14B_ref2v | core | Apache-2.0 | 24 GB+ (fp16 32.8 GB offloaded; use fp8 for 24 GB) |
| `camera-motion` | Wan 2.2 14B Fun Camera Control (native WanCameraEmbedding presets) + Lightx2v | video_wan2_2_14B_fun_camera | core | Apache-2.0 | 24 GB (4090D: 89% with LoRA, ~71-108 s) |
| `vfx` | Wan 2.1 I2V 14B 480p + Remade-AI effect LoRAs (+ Lightx2v) | image_to_video_wan (+ LoraLoaderModelOnly) | core | Apache-2.0 | 24 GB (16 GB with fp8/GGUF) |
| `lipsync` | InfiniteTalk (Wan 2.1 I2V 14B + InfiniteTalk patch) - native | video_wan2_1_infinitetalk / templates-wan2_1_infinitetalk_music | core | Apache-2.0 | 24 GB |
| `tts` | Chatterbox / Chatterbox Multilingual (23 languages, zero-shot clone, dialog) | audio-chatterbox_tts / audio-chatterbox_tts_multilingual / audio-chatterbox_tts_dialog / audio-chatterbox_vc | custom: [ComfyUI_Fill-ChatterBox](https://github.com/filliptm/ComfyUI_Fill-ChatterBox) | MIT | ~4-6 GB |
| `motion-transfer` | Wan Animate 2 (14B) - native, no pose extraction | video_wan_animate2 / video_wan_animate2_distilled | core | Apache-2.0 | 24 GB (int8 DiT 16.7 GB) |
| `upscale-image` | SeedVR2 7B (int8) one-step diffusion upscaler - native | utility_seedvr2_7b_int8_upscale_image / utility_seedvr2_3b_int8_upscale_image | core | Apache-2.0 | 12-24 GB depending on target size |
| `upscale-video` | SeedVR2 3B/7B video upscale - native (temporal chunks) | utility_seedvr2_3b_int8_upscale_video | core | Apache-2.0 | 12-24 GB (docs benchmark: 1080p on RTX 5090 ~312 s) |
| `interpolate` | Native FrameInterpolate (RIFE v4.26 / FILM) | utility_video_frame_interpolation | core | MIT / Apache-2.0 | <4 GB |
| `v2a` | Joint audio generation in the video model (LTX-2.5 / LTX-2.3 / MiniMax H3) | video_ltx2_5_t2v / video_minimax_h3_t2v | core | LTX-2.x Community (<$10M rev.) | see t2v |
| `music` | ACE-Step 1.5 XL Turbo (core) | audio_ace_step1_5_xl_turbo / audio_ace_step1_5_xl_sft / audio_ace_step1_5_xl_base / audio_ace_step_1_5_checkpoint (AIO) | core | Apache-2.0 | <4 GB (DiT only) to ~16-20 GB (XL + 4B planner) |
| `prompt-enhance` | Core TextGenerate node + Qwen3.5 4B/9B or Qwen3-VL 8B (image-aware) / Gemma 4 | llm_qwen3_5_text_gen / llm_qwen3vl_text_gen / llm_gemma4_text_gen | core | Apache-2.0 | ~5-20 GB (unloaded before diffusion) |

### The parity studio's feature -> Fuobe capability map

| The parity studio's feature (approx.) | Fuobe capability ids |
|---|---|
| Soul / Soul 2 text-to-image, "Popcorn" storyboards | `t2i` |
| Edit / Nano Banana / Seedream edit, Product placement, Draw-to-edit, Sketch-to-real | `edit` |
| Inpaint, Expand/Outpaint, Remove object | `inpaint` |
| The parity studio's background remover, product cut-outs | `bg-remove` |
| Relight / lighting presets | `relight` |
| The parity studio "Angles" / multi-shot from one photo | `angles` |
| Face Swap, Character Swap, Recast | `face-swap` |
| Soul ID (train a recurring character from ~20 photos) | `character-lora` |
| Create Video (Kling 3, Veo 3.1, Seedance 2.x, Wan 2.6/3.0 backends) | `t2v` |
| DoP / Image-to-Video | `i2v` |
| Start/End frame, transitions | `flf2v` |
| The parity studio "Ingredients"/references, Soul ID in video, product-to-video | `ref2v` |
| DoP camera motions (113 entries in the companion parity-inventory.json): Crash Zoom In/Out, Dolly In/Out/Left/Right, Dolly Zoom In/Out, Super Dolly In/Out, 360 Orbit, Arc Left/Right, Crane Up/Down/Over The Head, Jib up/down, Bullet Time, FPV Drone, Whip Pan, Snorricam, Handheld, Lazy Susan, 3D Rotation, Earth Zoom Out, Eyes In, Fisheye, Car Chasing, Action Run, Hyperlapse/Timelapse, Dutch Angle, Robo Arm ... | `camera-motion` |
| DoP VFX presets (274 entries in the companion inventory): Disintegration, Melting, Levitation, Set on Fire, Thunder God, Explosion / Head Explosion / Building Explosion, Turning Metal, Freezing, Balloon, Morphskin, Cyborg, Fire Breathe, Garden Bloom, transitions, outfit switch, emotions ... | `vfx` |
| Lipsync Studio, Talking Avatar, UGC Factory/Builder, Speak | `lipsync` |
| The parity studio's voice / UGC voiceover (backed by ElevenLabs-style TTS) | `tts` |
| Motion Control / Recast / Character Swap / "Genjutsu" (now a ComfyUI partner node) | `motion-transfer` |
| Upscale (image) | `upscale-image` |
| Upscale (video), 4K export | `upscale-video` |
| The parity studio smooth motion / frame rate boost | `interpolate` |
| The parity studio's audio/sound for videos | `v2a` |
| The parity studio's music for videos | `music` |
| The parity studio "Enhance prompt" toggle | `prompt-enhance` |

The parity studio's preset names used below are approximations of its public vocabulary (Dolly In, Crane Up/Down, Tracking, Whip Pan, Snorricam, Bullet Time, Boom, FPV, Dolly Zoom, crash zoom, etc.); its catalogue changes often and is not published in full.

## 2. Capabilities

Ranking = recommended default for Fuobe, weighing output quality, license (commercial use), native ComfyUI support and VRAM. Where the quality leader is ranked lower for licensing reasons the capability summary says so. Settings come from the official template JSON unless marked otherwise; `turbo`/`withoutLora` keys give the alternate recipe.

### `t2i` - Text-to-image (the parity studio "Soul" photoreal look + fast/turbo)

*The parity studio's equivalent:* Soul / Soul 2 text-to-image, "Popcorn" storyboards

Soul is a fashion/UGC-photoreal aesthetic model. In 2026 the open-weight frontier for that look is Z-Image-Turbo (Apache-2.0, 6B, 8 steps) with "UltraReal"-style LoRAs, the brand-new FLUX 3 Image Klein (released 2026-10-15, FLUX Kommunity license), Krea 2 Turbo (aesthetics-first, 8 steps) and Qwen-Image-2512 (Apache-2.0, best prompt adherence/text among commercially clean models). Qwen Image 2.1 (2026-09-20) is the strongest all-rounder (native 2K, RGBA, up to 10 references) but is research/non-commercial only. Everything below runs on ComfyUI core nodes; most new templates are subgraphs.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Z-Image-Turbo (6B, 8-step) + UltraReal/realism LoRA | image_z_image_turbo | core | Apache-2.0 | ~16 GB bf16 (docs: "fits within 16GB VRAM"); ~10-12 GB with int8/fp8 TE |
| 2 | FLUX 3 Image Klein (5.6B) + Qwen3.5-9B prompt upsampler | image_flux3_klein_t2i (full) / image_flux3_klein_distilled_t2i | core | FLUX Kommunity (<$5M rev.) | 24 GB class (BFL: "fits consumer GPUs down to an RTX 3090"); int8 DiT 5.8 GB + TE 4.9 GB + upsampler 6.7 GB (w4a8), offloaded between stages |
| 3 | Krea 2 Turbo (8-step) + realism/style LoRAs | image_krea2_turbo_t2i (int8: image_krea2_turbo_t2i_int8) | core | Krea 2 Community | ~16-24 GB (fp8 DiT 13.1 GB + TE 5.2 GB); nvfp4 fits 12-16 GB |
| 4 | Qwen-Image-2512 (20B) + Lightning 4-step / Wuli 2-step LoRA | image_qwen_Image_2512 / image_qwen_image_2512_with_2steps_lora | core | Apache-2.0 | ~24 GB with offload (fp8 DiT 20.4 GB + TE 9.4 GB); nvfp4 DiT 19.8 GB |
| 5 | FLUX.2 [klein] 4B distilled (4-step, Apache) | image_flux2_klein_text_to_image | core | Apache-2.0 | ~8.4 GB (docs: distilled ~1.2 s on RTX 5090, 8.4 GB VRAM) |
| 6 | Qwen Image 2.1 (7B, native 2K, RGBA) / 2.1 Turbo | image_qwen_image_2_1_t2i / image_qwen_image_2_1_turbo_t2i | core | Qwen Research (non-commercial) | ~16-24 GB (int8 DiT 7.3 GB + Qwen3-VL-8B int8 9.4 GB; enhancer 6.7-9.5 GB loaded separately) |
| 7 | FLUX.2 [dev] 32B (+ Turbo LoRA) | image_flux2_text_to_image / image_flux2 | core | FLUX NC | >=32 GB recommended; 24 GB only with aggressive offload (fp8 DiT 35.5 GB + Mistral fp8 18 GB) |
| 8 | HiDream-O1-Image (unified pixel-space, MIT) | image_hidream_o1 / image_hidream_o1_dev | core | MIT | ~16-24 GB (dev fp8) |
| 9 | FLUX.1 Krea [dev] | flux1_krea_dev | core | FLUX.1 dev NC | ~16-24 GB (fp8) |
| 10 | Chroma1-HD (FLUX.1-schnell-derived, Apache) | image_chroma_text_to_image | core | Apache-2.0 | ~12-16 GB (fp8mixed 9.2 GB) |
| 11 | SDXL (Juggernaut XL v9 / Lightning) low-VRAM fallback | image_sdxl_simple | core | OpenRAIL++-M | 6-8 GB |

**1. Z-Image-Turbo (6B, 8-step) + UltraReal/realism LoRA** ([docs](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo))

- License: Apache-2.0 (commercial OK)
- Settings: steps=8; cfg=1; sampler=res_multistep; scheduler=simple; shift=3; shiftNode=ModelSamplingAuraFlow; resolution=1024x1024 default; ~1-2 MP any aspect (multiples of 16/32); latentNode=EmptySD3LatentImage
- Notes: Best default for a commercially clean, fast "Soul-like" photoreal generator. Bilingual text rendering. Use Z-Image (non-turbo base, template image_z_image: 25 steps, cfg 4) or ostris Z-Image-De-Turbo for LoRA training. Fun Union ControlNet (canny/HED/depth/pose/MLSD) template image_z_image_turbo_fun_union_controlnet; 2K upscaler app template utility_z_image_turbo_2k_upscaler.app; "Skin Enhancer + Upscaler" template templates_hellorob_facegen_skindetail_upscale.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [z_image_turbo_bf16.safetensors](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors) | `diffusion_models` | 12.31 | int8: z_image_turbo_int8_convrot.safetensors (6.2 GB, template image_z_image_turbo_int8); nvfp4 4.5 GB for RTX 50xx |
  | [qwen_3_4b.safetensors](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors) | `text_encoders` | 8.04 | fp8: qwen_3_4b_fp8_mixed.safetensors |
  | [ae.safetensors](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors) | `vae` | 0.34 |  |
  | [lenovo_z.safetensors](https://huggingface.co/Danrisi/Lenovo_UltraReal_Z_Image/resolve/main/lenovo_z.safetensors) | `loras` | 0.09 | optional "phone-photo" realism LoRA (Apache-2.0), strength ~0.6-1.0 |

**2. FLUX 3 Image Klein (5.6B) + Qwen3.5-9B prompt upsampler** ([docs](https://docs.comfy.org/tutorials/flux/flux-3-klein))

- License: FLUX Kommunity License v1.0: free commercial use only for "Qualifying Users" (< US$5M gross annual revenue incl. affiliates) who implement content filters; otherwise non-commercial
- Settings: steps=16; cfg=1; sampler=euler (edit) / er_sde (t2i template); scheduler=simple; resolution=up to 4K (BFL); templates default 1024x1024 via ResolutionSelector; baseCheckpoint=50 steps, cfg 3.5
- Notes: Brand-new (weights 2026-10-15, ComfyUI >= 0.41.0). Unified T2I + edit with <ref_image_N> references; BFL claims it beats larger open models. Repo is gated (accept license on HF). Template ships a Create Bounding Boxes helper for regional prompting.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [flux3_image_klein_sd_int8_convrot.safetensors](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/main/diffusion_models/flux3_image_klein_sd_int8_convrot.safetensors) | `diffusion_models` | 5.83 | **gated (accept license + HF token)** step-distilled (4-16 steps, cfg 1). Full/base checkpoint: flux3_image_klein_base_int8_convrot.safetensors (50 steps, cfg 3.5). bf16 and nvfp4 variants in the same repo |
  | [qwen3vl_4b_int8_convrot.safetensors](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/main/text_encoders/qwen3vl_4b_int8_convrot.safetensors) | `text_encoders` | 4.86 | **gated (accept license + HF token)** load with CLIPLoader type "flux3" |
  | [qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/main/text_encoders/qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors) | `text_encoders` | 6.72 | **gated (accept license + HF token)** prompt upsampler ("PUP"); BFL: do not run Klein without it unless you write full captions |
  | [flux2-vae.safetensors](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/main/vae/flux2-vae.safetensors) | `vae` | 0.34 | **gated (accept license + HF token)**  |

**3. Krea 2 Turbo (8-step) + realism/style LoRAs** ([docs](https://docs.comfy.org/tutorials/image/krea/krea-2))

- License: Krea 2 Community License (gated; free for individuals/small teams, enterprise tier above thresholds - read https://www.krea.ai/krea-2-licensing)
- Settings: steps=8; cfg=1; sampler=euler; scheduler=simple; resolution=1K-2K (ResolutionSelector megapixels 1.0-2.0)
- Notes: Aesthetics-first model with a built-in LLM prompt_enhance toggle and 9 official style LoRAs (trigger words in LoRA catalog). Style-reference LoRA template image_krea2_turbo_int8_image_style_reference. Released 2026-06-22.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [krea2_turbo_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors) | `diffusion_models` | 13.14 | int8 13.5 GB, nvfp4 7.7 GB, bf16 26.3 GB; Krea-2 RAW (52 steps) for LoRA training |
  | [qwen3vl_4b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors) | `text_encoders` | 5.24 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Krea2-realism-V2.safetensors](https://huggingface.co/RudySen/Krea2-realism-V2/resolve/main/Krea2-realism-V2.safetensors) | `loras` | 1.56 | optional photoreal LoRA (MIT), no trigger |

**4. Qwen-Image-2512 (20B) + Lightning 4-step / Wuli 2-step LoRA** ([docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2512))

- License: Apache-2.0 (commercial OK)
- Settings: steps=50; cfg=4; sampler=euler; scheduler=simple; shift=3.1; shiftNode=ModelSamplingAuraFlow; resolution=1328x1328 (native ~1.6 MP, any aspect); turbo=4 steps cfg 1 (Lightning) or 2 steps cfg 1 (Wuli)
- Notes: Commercially clean, best long-prompt adherence + typography; strong for ads/posters. ControlNets: InstantX Union / Fun-Controlnet-Union-2512 (template image_qwen_Image_2512_controlnet). 360 panorama LoRA template.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_2512_fp8_e4m3fn.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors) | `diffusion_models` | 20.43 |  |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors](https://huggingface.co/lightx2v/Qwen-Image-2512-Lightning/resolve/main/Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors) | `loras` | 1.7 | 4 steps, cfg 1 |
  | [Wuli-Qwen-Image-2512-Turbo-LoRA-2steps-V1.0-bf16.safetensors](https://huggingface.co/Wuli-art/Qwen-Image-2512-Turbo-LoRA-2-Steps/resolve/main/Wuli-Qwen-Image-2512-Turbo-LoRA-2steps-V1.0-bf16.safetensors) | `loras` | 2.36 | 2 steps, cfg 1 |
  | [Samsung.safetensors](https://huggingface.co/Danrisi/Qwen-image_SamsungCam_UltraReal/resolve/main/Samsung.safetensors) | `loras` | 0.05 | optional phone-camera realism LoRA (Apache-2.0) |

**5. FLUX.2 [klein] 4B distilled (4-step, Apache)** ([docs](https://docs.comfy.org/tutorials/flux/flux-2-klein))

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=Flux2Scheduler; resolution=1024x1024 default (EmptyFlux2LatentImage)
- Notes: Cheapest/fastest preview tier and a good "draft" model; also does edit/multi-reference. The 9B Klein variants are non-commercial.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [flux-2-klein-4b.safetensors](https://huggingface.co/Comfy-Org/flux2-klein/resolve/main/split_files/diffusion_models/flux-2-klein-4b.safetensors) | `diffusion_models` | 7.75 | base (undistilled, 20 steps cfg 5): flux-2-klein-base-4b.safetensors |
  | [qwen_3_4b.safetensors](https://huggingface.co/Comfy-Org/flux2-klein/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors) | `text_encoders` | 8.04 |  |
  | [flux2-vae.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors) | `vae` | 0.34 |  |

**6. Qwen Image 2.1 (7B, native 2K, RGBA) / 2.1 Turbo** ([docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1))

- License: Qwen Research License: NON-COMMERCIAL (research/evaluation only)
- Settings: steps=25; cfg=1; sampler=euler; scheduler=simple; resolution=1 MP default, native 2048x2048 (multiples of 32); turbo=8 steps, ManualSigmas "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0", CFGGuider 1; officialSteps=40-50 (template starts at 25)
- Notes: Best quality/feature set (RGBA transparency via prompt wrapper, 2K, unified edit) but NON-COMMERCIAL - fine for research/self-hosted personal use, not for a commercial Fuobe deployment.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_2.1_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_int8_convrot.safetensors) | `diffusion_models` | 7.26 | Turbo: qwen_image_2.1_turbo_int8_convrot.safetensors (8 steps) |
  | [qwen3vl_8b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors) | `text_encoders` | 9.35 |  |
  | [qwen3.5_9b_qwen_image_2.1_pe_t2i_w4a8.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3.5_9b_qwen_image_2.1_pe_t2i_w4a8.safetensors) | `text_encoders` | 6.72 | optional prompt enhancer (thinking mode) |
  | [qwen_image_2.1_vae_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors) | `vae` | 0.68 |  |

**7. FLUX.2 [dev] 32B (+ Turbo LoRA)** ([docs](https://docs.comfy.org/tutorials/flux/flux-2-dev))

- License: FLUX Non-Commercial License (FLUX.2 [klein] 9B / [dev])
- Settings: steps=20; cfg=1; guidance=4; sampler=euler; scheduler=Flux2Scheduler; resolution=up to 4 MP (template 1248x832)
- Notes: Top-tier photorealism and up to 10 reference images, but heavy and non-commercial.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [flux2_dev_fp8mixed.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/diffusion_models/flux2_dev_fp8mixed.safetensors) | `diffusion_models` | 35.46 |  |
  | [mistral_3_small_flux2_fp8.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors) | `text_encoders` | 18.03 | fp4_mixed 12.3 GB, bf16 35.6 GB |
  | [flux2-vae.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors) | `vae` | 0.34 |  |
  | [Flux2TurboComfyv2.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/loras/Flux2TurboComfyv2.safetensors) | `loras` | 2.76 | optional Turbo LoRA (fewer steps) |

**8. HiDream-O1-Image (unified pixel-space, MIT)** ([docs](https://docs.comfy.org/tutorials/image/hidream/hidream-o1))

- License: MIT (commercial OK)
- Settings: steps=28; sampler=dpmpp_2m_sde_gpu (full template); scheduler=normal; resolution=up to 2048x2048
- Notes: Released 2026-05-08, MIT. Also does instruction editing and subject-driven personalization from reference images.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [hidream_o1_image_dev_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/HiDream-O1-Image/resolve/main/checkpoints/hidream_o1_image_dev_fp8_scaled.safetensors) | `checkpoints` | 8.07 | Full: hidream_o1_image_bf16.safetensors (50 steps) |
  | [gemma4_e4b_it_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/gemma-4/resolve/main/text_encoders/gemma4_e4b_it_fp8_scaled.safetensors) | `text_encoders` | 9.06 |  |

**9. FLUX.1 Krea [dev]** ([docs](https://docs.comfy.org/tutorials/flux/flux1-krea-dev))

- License: FLUX.1 [dev] Non-Commercial License (outputs may be used commercially per BFL terms; model use in production needs a BFL commercial license)
- Settings: steps=20; cfg=1; sampler=euler; scheduler=simple; resolution=1024x1024
- Notes: Classic "non-AI-look" photoreal model of 2025 with the largest Flux LoRA ecosystem; superseded by Krea 2, non-commercial.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [flux1-krea-dev_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/FLUX.1-Krea-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-krea-dev_fp8_scaled.safetensors) | `diffusion_models` | 11.9 |  |
  | [clip_l.safetensors](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors) | `text_encoders` | 0.25 |  |
  | [t5xxl_fp16.safetensors](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors) | `text_encoders` | 9.79 |  |
  | [ae.safetensors](https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors) | `vae` | 0.34 |  |

**10. Chroma1-HD (FLUX.1-schnell-derived, Apache)**

- License: Apache-2.0 (commercial OK)
- Settings: steps=26; cfg=3.5; sampler=euler; scheduler=beta; shift=1; resolution=1024x1024
- Notes: Apache-2.0, strong for stylized/creative work and fine-tunes; realism LoRA e.g. Danrisi/Lenovo_UltraReal_Chroma.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [Chroma1-HD-fp8mixed.safetensors](https://huggingface.co/Comfy-Org/Chroma1-HD_repackaged/resolve/main/split_files/diffusion_models/Chroma1-HD-fp8mixed.safetensors) | `diffusion_models` | 9.19 |  |
  | [t5xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 5.16 |  |
  | [ae.safetensors](https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors) | `vae` | 0.34 |  |

**11. SDXL (Juggernaut XL v9 / Lightning) low-VRAM fallback**

- License: CreativeML OpenRAIL++-M
- Settings: steps=25; cfg=5; sampler=dpmpp_2m; scheduler=karras; resolution=1024x1024 (SDXL buckets); lightning=4-6 steps, cfg 1-2
- Notes: Only for very low VRAM / huge ecosystem of SDXL LoRAs + InstantID/IP-Adapter. Settings are common SDXL defaults, not from an official template.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors](https://huggingface.co/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors) | `checkpoints` | 7.11 |  |
  | [juggernautXL_v9Rdphoto2Lightning.safetensors](https://huggingface.co/AiWise/Juggernaut-XL-V9-GE-RDPhoto2-Lightning_4S/resolve/main/juggernautXL_v9Rdphoto2Lightning.safetensors) | `checkpoints` | 7.11 | 4-step Lightning merge |

### `edit` - Image edit / multi-reference edit (Nano Banana / Seedream-edit equivalent), product packshot, sketch-to-real

*The parity studio's equivalent:* Edit / Nano Banana / Seedream edit, Product placement, Draw-to-edit, Sketch-to-real

Instruction editing is solved natively in ComfyUI. Qwen-Image-Edit-2511 (Apache-2.0) is the commercially clean default with the biggest LoRA ecosystem (angles, relight, face swap, inflate...). FLUX 3 Image Klein (new) and Qwen Image 2.1 (non-commercial, 10 references) are the quality leaders. Product packshots and sketch-to-photo are Qwen-Edit LoRA presets.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Qwen-Image-Edit-2511 + Lightning 4-step LoRA | image_qwen_image_edit_2511 (int8: image_qwen_image_edit_2511_int8) | core | Apache-2.0 | ~24 GB with offload (fp8mixed DiT 20.5 GB + TE 9.4 GB); 16 GB possible with int8/GGUF + offload |
| 2 | FLUX 3 Image Klein edit (multi-reference) | image_flux3_klein_image_edit / image_flux3_klein_distilled_image_edit | core | FLUX Kommunity (<$5M rev.) | 24 GB class |
| 3 | Qwen Image 2.1 edit (up to 10 references, RGBA) | image_qwen_image_2_1_image_edit / image_qwen_image_2_1_turbo_image_edit | core | Qwen Research (non-commercial) | ~16-24 GB |
| 4 | FLUX.2 [klein] 4B edit (Apache, 4-step) | image_flux2_klein_image_edit_4b_distilled / image_flux2_klein_image_edit_4b_base | core | Apache-2.0 | ~8-10 GB |
| 5 | FLUX.2 [dev] multi-reference (up to 10 images) | image_flux2 / image_flux2_fp8 (product mockup) | core | FLUX NC | >=32 GB recommended |
| 6 | FLUX.1 Kontext [dev] | flux_kontext_dev_basic | core | FLUX.1 dev NC | ~16-20 GB (fp8) |
| 7 | HiDream-O1-Image edit / subject-driven (MIT) | image_hidream_o1 | core | MIT | ~24 GB |
| 8 | OmniGen2 | image_omnigen2_image_edit | core | Apache-2.0 | ~16-20 GB |
| 9 | Product packshot / scene placement: Qwen-Edit-2509 White_to_Scene + Fusion LoRAs | templates-qwen_image_edit-crop_and_stitch-fusion (Relight Composited Product) | core | Apache-2.0 | ~24 GB |
| 10 | Sketch / illustration -> photoreal: Qwen-Edit-2509 Anything2RealAlpha LoRA | templates-image_to_real / templates_rob_image_to_real.app | core | Apache-2.0 | ~24 GB |

**1. Qwen-Image-Edit-2511 + Lightning 4-step LoRA** ([docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511))

- License: Apache-2.0 (commercial OK)
- Settings: steps=40; cfg=3; sampler=euler; scheduler=simple; shift=3.1; shiftNode=ModelSamplingAuraFlow; resolution=~1 MP (FluxKontextImageScale / ImageScaleToTotalPixels); turbo=4 steps, cfg 1 with Lightning LoRA; references=up to 3 images (TextEncodeQwenImageEditPlus image1..image3)
- Notes: Multi-person consistency, material replacement, text editing, built-in popular LoRA abilities. Uses CFGNorm + TextEncodeQwenImageEditPlus nodes. Most the parity studio "app" presets map to 2509/2511 LoRAs (see angles/relight/face-swap/vfx).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_edit_2511_fp8mixed.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors) | `diffusion_models` | 20.53 | int8 alternative: qwen_image_edit_2511_int8_convrot.safetensors (template image_qwen_image_edit_2511_int8) |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors) | `loras` | 0.85 |  |

**2. FLUX 3 Image Klein edit (multi-reference)** ([docs](https://docs.comfy.org/tutorials/flux/flux-3-klein))

- License: FLUX Kommunity License v1.0: free commercial use only for "Qualifying Users" (< US$5M gross annual revenue incl. affiliates) who implement content filters; otherwise non-commercial
- Settings: steps=50; cfg=1; sampler=euler; scheduler=simple; resolution=output = Empty Flux 2 Latent size (template 1024x1024); refs resized to ~1 MP; distilled=4-16 steps, cfg 1; references=multiple via Set Reference Multi Latent; address as <ref_image_0>, <ref_image_1>...
- Notes: Write the RESULT caption, not the change ("In <ref_image_0>, change the dress color to red"). Add each reference to both positive and negative conditioning.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [flux3_image_klein_base_int8_convrot.safetensors](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/main/diffusion_models/flux3_image_klein_base_int8_convrot.safetensors) | `diffusion_models` | 5.81 | **gated (accept license + HF token)** distilled: flux3_image_klein_sd_int8_convrot.safetensors (16 steps) |
  | [qwen3vl_4b_int8_convrot.safetensors](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/main/text_encoders/qwen3vl_4b_int8_convrot.safetensors) | `text_encoders` | 4.86 | **gated (accept license + HF token)**  |
  | [flux2-vae.safetensors](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/main/vae/flux2-vae.safetensors) | `vae` | 0.34 | **gated (accept license + HF token)**  |

**3. Qwen Image 2.1 edit (up to 10 references, RGBA)** ([docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1))

- License: Qwen Research License: NON-COMMERCIAL (research/evaluation only)
- Settings: steps=25; cfg=1; sampler=euler; scheduler=simple; resolution=`resolution` input (1024 = ~1 MP; 0 = native ref size, up to 2K); references=image_1..image_10 on Text Encode Qwen Image 2.1
- Notes: Strongest open editor for compositing many references, but NON-COMMERCIAL. Also: background removal with alpha (template image_qwen_image_2_1_background_removal).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_2.1_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_int8_convrot.safetensors) | `diffusion_models` | 7.26 |  |
  | [qwen3vl_8b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors) | `text_encoders` | 9.35 |  |
  | [qwen3.5_9b_qwen_image_2.1_pe_i2i_w4a8.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3.5_9b_qwen_image_2.1_pe_i2i_w4a8.safetensors) | `text_encoders` | 6.72 | optional edit prompt enhancer |
  | [qwen_image_2.1_vae_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors) | `vae` | 0.68 |  |

**4. FLUX.2 [klein] 4B edit (Apache, 4-step)** ([docs](https://docs.comfy.org/tutorials/flux/flux-2-klein))

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=Flux2Scheduler; resolution=1024x1024; base=20 steps, CFGGuider 5
- Notes: Fast, commercially clean editor for lightweight deployments; multi-reference supported. 9B variants (better) are non-commercial; 9B KV-cache edit template image_flux2_klein_9b_kv_image_edit.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [flux-2-klein-4b-fp8.safetensors](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/resolve/main/flux-2-klein-4b-fp8.safetensors) | `diffusion_models` | 4.07 |  |
  | [qwen_3_4b.safetensors](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors) | `text_encoders` | 8.04 |  |
  | [flux2-vae.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors) | `vae` | 0.34 |  |

**5. FLUX.2 [dev] multi-reference (up to 10 images)** ([docs](https://docs.comfy.org/tutorials/flux/flux-2-dev))

- License: FLUX Non-Commercial License (FLUX.2 [klein] 9B / [dev])
- Settings: steps=20; cfg=1; guidance=4; sampler=euler; scheduler=Flux2Scheduler; resolution=up to 4 MP
- Notes: Excellent identity/product consistency across refs; non-commercial; "Product Mockup" template applies designs to packaging.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [flux2_dev_fp8mixed.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/diffusion_models/flux2_dev_fp8mixed.safetensors) | `diffusion_models` | 35.46 |  |
  | [mistral_3_small_flux2_fp8.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors) | `text_encoders` | 18.03 |  |
  | [flux2-vae.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors) | `vae` | 0.34 |  |

**6. FLUX.1 Kontext [dev]** ([docs](https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev))

- License: FLUX.1 [dev] Non-Commercial License (outputs may be used commercially per BFL terms; model use in production needs a BFL commercial license)
- Settings: steps=20; cfg=1; guidance=2.5; sampler=euler; scheduler=simple; resolution=~1 MP (FluxKontextImageScale)
- Notes: Mature 2025 editor with many community LoRAs (relight, face swap); single image + stitched multi-ref. Superseded.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [flux1-dev-kontext_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/flux1-kontext-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors) | `diffusion_models` | 11.9 |  |
  | [clip_l.safetensors](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors) | `text_encoders` | 0.25 |  |
  | [t5xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 5.16 |  |
  | [ae.safetensors](https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors) | `vae` | 0.34 |  |

**7. HiDream-O1-Image edit / subject-driven (MIT)** ([docs](https://docs.comfy.org/tutorials/image/hidream/hidream-o1))

- License: MIT (commercial OK)
- Settings: steps=40; sampler=dpmpp_2m_sde_gpu; scheduler=normal; resolution=up to 2048x2048
- Notes: Permissive alternative with optional reference images.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [hidream_o1_image_bf16.safetensors](https://huggingface.co/Comfy-Org/HiDream-O1-Image/resolve/main/checkpoints/hidream_o1_image_bf16.safetensors) | `checkpoints` | 16.37 |  |
  | [gemma4_e4b_it_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/gemma-4/resolve/main/text_encoders/gemma4_e4b_it_fp8_scaled.safetensors) | `text_encoders` | 9.06 |  |

**8. OmniGen2** ([docs](https://docs.comfy.org/tutorials/image/omnigen/omnigen2))

- License: Apache-2.0 (commercial OK)
- Settings: steps=20; sampler=euler; scheduler=simple; resolution=~1 MP
- Notes: Older (2025) unified model; listed for completeness. Other 2026 native editors: FireRed-Image-Edit 1.1 (Apache), LongCat-Image-Edit (Apache), JoyAI-Image-Edit (Apache), Mage-Flow-Edit (MIT), Boogu-Image-Edit (Apache).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [omnigen2_fp16.safetensors](https://huggingface.co/Comfy-Org/Omnigen2_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/omnigen2_fp16.safetensors) | `diffusion_models` | 7.93 |  |
  | [qwen_2.5_vl_fp16.safetensors](https://huggingface.co/Comfy-Org/Omnigen2_ComfyUI_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_fp16.safetensors) | `text_encoders` | 7.51 |  |
  | [ae.safetensors](https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors) | `vae` | 0.34 |  |

**9. Product packshot / scene placement: Qwen-Edit-2509 White_to_Scene + Fusion LoRAs**

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=3; resolution=~1 MP
- Notes: Packshot pipeline: BiRefNet cut-out -> paste on background -> Fusion LoRA to fix lighting/perspective; or White_to_Scene directly. For transparent product renders use Qwen Image 2.1 RGBA (non-commercial) or BiRefNet.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_edit_2509_fp8_e4m3fn.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors) | `diffusion_models` | 20.43 |  |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors) | `loras` | 0.85 |  |
  | [Qwen-Image-Edit-2509-White_to_Scene.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-White_to_Scene.safetensors) | `loras` | 0.24 | white-background product -> styled scene |
  | [Qwen-Image-Edit-2509-Fusion.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Fusion.safetensors) | `loras` | 0.24 | trigger: 溶图,纠正产品透视角度和光影并使产品融入背景 (fix perspective/lighting and blend product into background) |

**10. Sketch / illustration -> photoreal: Qwen-Edit-2509 Anything2RealAlpha LoRA**

- License: Apache-2.0 (commercial OK)
- Settings: steps=8; cfg=1; sampler=euler; scheduler=simple; shift=3; resolution=~1 MP
- Notes: Alternatives: ControlNet-guided regeneration (Z-Image-Turbo Fun Union ControlNet, Qwen-Image InstantX/DiffSynth union, Qwen Image 2.1 Fun ControlNet union model patch). The parity studio "Draw-to-Video" = this step + I2V (or Wan-Move/ATI trajectory drawing).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_edit_2509_fp8_e4m3fn.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors) | `diffusion_models` | 20.43 |  |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-Edit-2509-Anything2RealAlpha.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Anything2RealAlpha.safetensors) | `loras` | 0.61 |  |
  | [Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16.safetensors) | `loras` | 0.85 |  |

### `inpaint` - Inpaint / outpaint / object removal (image and video)

*The parity studio's equivalent:* Inpaint, Expand/Outpaint, Remove object

Mask-based inpainting is native (InpaintModelConditioning / ControlNet inpaint / SetLatentNoiseMask). Instruction editors (Qwen-Edit) handle mask-free removal. Video inpainting is native via VOID, Wan VACE and LTX-2.3 IC-LoRAs.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Qwen-Image + InstantX Inpainting ControlNet (+ Lightning) | image_qwen_image_instantx_inpainting_controlnet | core | Apache-2.0 | ~24 GB |
| 2 | Qwen-Image-Edit-2511 instruction inpaint/removal (mask-free) | image_qwen_image_edit_2511 | core | Apache-2.0 | ~24 GB |
| 3 | FLUX.1 Fill [dev] (+ OneReward / object-removal LoRA) | flux_fill_inpaint_example / flux_fill_outpaint_example / image_flux.1_fill_dev_OneReward | core | FLUX.1 dev NC | ~24 GB (fp16 23.8 GB) |
| 4 | FLUX.2 [klein] 9B image extend (outpaint) | templates_doc_workbox_klein_9b_image_extend | core | FLUX NC | ~12-16 GB |
| 5 | Video inpainting: VOID (CogVideoX-based, 2-pass) / Wan VACE inpaint+outpaint / LTX-2.3 IC-LoRA In-Outpainting | utility_void_video_inpainting / video_wan_vace_inpainting / video_wan_vace_outpainting / template_ltx2_3_lora_video_outpainting | core + [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite), [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes), [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) | Apache-2.0 | 24 GB+ |
| 6 | Z-Image-Turbo Fun Union ControlNet (control-guided regeneration) | image_z_image_turbo_fun_union_controlnet | core | Apache-2.0 | ~16 GB |

**1. Qwen-Image + InstantX Inpainting ControlNet (+ Lightning)** ([docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image))

- License: Apache-2.0 (commercial OK)
- Settings: steps=20; cfg=2.5; sampler=euler; scheduler=simple; shift=3.1; resolution=~1 MP; turbo=4 steps cfg 1
- Notes: Commercially clean masked inpaint/outpaint (pad canvas + mask for outpaint).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_fp8_e4m3fn.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors) | `diffusion_models` | 20.43 |  |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-InstantX-ControlNet-Inpainting.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-InstantX-ControlNets/resolve/main/split_files/controlnet/Qwen-Image-InstantX-ControlNet-Inpainting.safetensors) | `controlnet` | 4.23 |  |
  | [Qwen-Image-Lightning-4steps-V1.0.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Lightning-4steps-V1.0.safetensors) | `loras` | 1.7 |  |

**2. Qwen-Image-Edit-2511 instruction inpaint/removal (mask-free)**

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=3.1; resolution=~1 MP
- Notes: "Remove the person on the left", "replace the sky with sunset". Combine with a mask + ImageCompositeMasked to protect untouched pixels.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_edit_2511_fp8mixed.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors) | `diffusion_models` | 20.53 | int8 alternative: qwen_image_edit_2511_int8_convrot.safetensors (template image_qwen_image_edit_2511_int8) |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors) | `loras` | 0.85 |  |

**3. FLUX.1 Fill [dev] (+ OneReward / object-removal LoRA)** ([docs](https://docs.comfy.org/tutorials/flux/flux-1-fill-dev))

- License: FLUX.1 [dev] Non-Commercial License (outputs may be used commercially per BFL terms; model use in production needs a BFL commercial license)
- Settings: steps=20; cfg=1; guidance=30; sampler=euler; scheduler=normal; resolution=~1 MP
- Notes: Highest-quality classic fill; non-commercial base.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [flux1-fill-dev.safetensors](https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/split_files/diffusion_models/flux1-fill-dev.safetensors) | `diffusion_models` | 23.8 |  |
  | [clip_l.safetensors](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors) | `text_encoders` | 0.25 |  |
  | [t5xxl_fp16.safetensors](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors) | `text_encoders` | 9.79 |  |
  | [ae.safetensors](https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors) | `vae` | 0.34 |  |
  | [removal_timestep_alpha-2-1740.safetensors](https://huggingface.co/lrzjason/ObjectRemovalFluxFill/resolve/main/removal_timestep_alpha-2-1740.safetensors) | `loras` | 0.09 | object removal LoRA (MIT); OneReward weights are CC-BY-NC |

**4. FLUX.2 [klein] 9B image extend (outpaint)** ([docs](https://docs.comfy.org/tutorials/flux/flux-2-klein))

- License: FLUX Non-Commercial License (FLUX.2 [klein] 9B / [dev])
- Settings: steps=4; cfg=1; sampler=euler; scheduler=Flux2Scheduler; resolution=source scaled ~1.5x canvas
- Notes: Fast outpaint ("Expand"); 9B is non-commercial - swap to Klein 4B for commercial.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [flux-2-klein-9b-fp8.safetensors](https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors) | `diffusion_models` | 9.43 | **gated (accept license + HF token)**  |
  | [qwen_3_8b_fp8mixed.safetensors](https://huggingface.co/Comfy-Org/flux2-klein-9B/resolve/main/split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors) | `text_encoders` | 8.66 |  |
  | [flux2-vae.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors) | `vae` | 0.34 |  |

**5. Video inpainting: VOID (CogVideoX-based, 2-pass) / Wan VACE inpaint+outpaint / LTX-2.3 IC-LoRA In-Outpainting** ([docs](https://docs.comfy.org/tutorials/utility/void-video-inpainting))

- License: Apache-2.0 (commercial OK)
- Settings: sampler=see template; resolution=source video
- Notes: VOID = native object removal from video with SAM3 masks (Apache). VACE templates are native; the LTX-2.3 outpaint/remove-object/remove-watermark templates use ComfyUI-LTXVideo + KJNodes + VHS. MiniMax H3 Fun ControlNet Union also does masked video inpainting.
- Custom nodes: https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite, https://github.com/kijai/ComfyUI-KJNodes, https://github.com/Lightricks/ComfyUI-LTXVideo
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [void_pass1.safetensors](https://huggingface.co/Comfy-Org/void-model/resolve/main/diffusion_models/void_pass1.safetensors) | `diffusion_models` | 11.14 |  |
  | [void_pass2.safetensors](https://huggingface.co/Comfy-Org/void-model/resolve/main/diffusion_models/void_pass2.safetensors) | `diffusion_models` | 11.14 |  |
  | [cogvideox_vae.safetensors](https://huggingface.co/Comfy-Org/void-model/resolve/main/vae/cogvideox_vae.safetensors) | `vae` | 0.43 |  |
  | [raft_large_C_T_SKHT_V2-ff5fadd5.safetensors](https://huggingface.co/Comfy-Org/void-model/resolve/main/optical_flow/raft_large_C_T_SKHT_V2-ff5fadd5.safetensors) | `optical_flow` | 0.02 |  |
  | [t5xxl_fp16.safetensors](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors) | `text_encoders` | 9.79 |  |
  | [sam3.1_multiplex_fp16.safetensors](https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors) | `checkpoints` | 1.75 | SAM 3.1 text/point tracking for masks |
  | [wan2.1_vace_14B_fp16.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_vace_14B_fp16.safetensors) | `diffusion_models` | 34.68 | VACE alternative |

**6. Z-Image-Turbo Fun Union ControlNet (control-guided regeneration)** ([docs](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo))

- License: Apache-2.0 (commercial OK)
- Settings: steps=8; cfg=1; sampler=res_multistep; scheduler=simple; shift=3; resolution=1024x1024
- Notes: Canny/HED/depth/pose/MLSD union; use with a mask for structure-preserving fills.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [Z-Image-Turbo-Fun-Controlnet-Union.safetensors](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union/resolve/main/Z-Image-Turbo-Fun-Controlnet-Union.safetensors) | `model_patches` | 3.1 |  |
  | [z_image_turbo_bf16.safetensors](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors) | `diffusion_models` | 12.31 |  |
  | [qwen_3_4b.safetensors](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors) | `text_encoders` | 8.04 |  |
  | [ae.safetensors](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors) | `vae` | 0.34 |  |

### `bg-remove` - Background removal / matting

*The parity studio's equivalent:* the parity studio's background remover, product cut-outs

BiRefNet is now a CORE ComfyUI node (LoadBackgroundRemovalModel + RemoveBackground, models/background_removal). SAM 3.1 is native for video segmentation.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | BiRefNet (native RemoveBackground node) | utility_birefnet_remove_background | core | MIT | <2 GB |
| 2 | SAM 3.1 segmentation (image + video, text/point prompts) | utility_image_segment_sam3 / utility_video_segment_sam3 | core | SAM License (Meta) | ~4-8 GB |
| 3 | Qwen Image 2.1 native RGBA background removal | image_qwen_image_2_1_background_removal | core | Qwen Research (non-commercial) | ~16-24 GB |
| 4 | ComfyUI-RMBG (RMBG-2.0, BiRefNet variants, BEN2, SAM...) | - | custom: [ComfyUI-RMBG](https://github.com/1038lab/ComfyUI-RMBG) | pack GPL-3.0; per-model licenses vary | 2-4 GB |

**1. BiRefNet (native RemoveBackground node)** ([docs](https://docs.comfy.org/tutorials/utility/remove-background-birefnet))

- License: MIT (commercial OK)
- Settings: resolution=any (internally 1024)
- Notes: Outputs RGBA + mask (JoinImageWithAlpha). MIT. Folder must be models/background_removal (not checkpoints).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [birefnet.safetensors](https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors) | `background_removal` | 0.44 |  |
  | [lucida.safetensors](https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/lucida.safetensors) | `background_removal` | 0.88 | alternative matting model shipped in the same repo |

**2. SAM 3.1 segmentation (image + video, text/point prompts)** ([docs](https://docs.comfy.org/tutorials/utility/video-segment-sam3))

- License: SAM License (Meta)
- Settings: resolution=any
- Notes: Use for video background removal/rotoscoping masks and for driving inpaint/replacement workflows.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [sam3.1_multiplex_fp16.safetensors](https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors) | `checkpoints` | 1.75 |  |

**3. Qwen Image 2.1 native RGBA background removal** ([docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1))

- License: Qwen Research License: NON-COMMERCIAL (research/evaluation only)
- Settings: steps=25; cfg=1; sampler=euler; scheduler=simple; resolution=1 MP
- Notes: Generative cut-out with true alpha (hair, glass); non-commercial.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_2.1_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_int8_convrot.safetensors) | `diffusion_models` | 7.26 |  |
  | [qwen3vl_8b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors) | `text_encoders` | 9.35 |  |
  | [qwen_image_2.1_vae_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors) | `vae` | 0.68 |  |

**4. ComfyUI-RMBG (RMBG-2.0, BiRefNet variants, BEN2, SAM...)**

- License: pack GPL-3.0; per-model licenses vary
- Settings: resolution=any
- Notes: Custom pack with many matting models (auto-download). Note: BRIA RMBG-2.0 weights are non-commercial.
- Custom nodes: https://github.com/1038lab/ComfyUI-RMBG

### `relight` - Relight

*The parity studio's equivalent:* Relight / lighting presets

Qwen-Image-Edit LoRAs give the most robust relighting in 2026 and have official templates; IC-Light (SD1.5) remains as a lightweight custom-node option.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Qwen-Image-Edit-2509 + Relight LoRA | image_qwen_image_edit_2509_relight | core | Apache-2.0 | ~24 GB |
| 2 | Qwen-Image-Edit-2509 + Light-Migration LoRA (copy light from a reference) | templates-portrait_light_migration / templates_rob_portrait_light_migration.app | core | Apache-2.0 | ~24 GB |
| 3 | IC-Light (SD1.5) via ComfyUI-IC-Light | - | custom: [ComfyUI-IC-Light](https://github.com/kijai/ComfyUI-IC-Light) | IC-Light weights: license not stated on HF card (check repo) | ~6 GB |
| 4 | Video relight: Wan Animate relight LoRA / SCAIL-2 relight LoRA | video_wan2_2_14B_animate / video_wan21_scail2_character_replacement | core | Apache-2.0 | 24 GB |

**1. Qwen-Image-Edit-2509 + Relight LoRA** ([docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit))

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=3; resolution=~1 MP
- Notes: Prompt-described lighting (golden hour, neon, softbox...). Works on 2511 as well.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_edit_2509_fp8_e4m3fn.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors) | `diffusion_models` | 20.43 |  |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors) | `loras` | 0.85 |  |
  | [Qwen-Image-Edit-2509-Relight.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Relight.safetensors) | `loras` | 0.24 | trigger 重新照明 ("relight"), e.g. "重新照明,使用窗帘透光（柔和漫射）的光线对图片进行重新照明" |

**2. Qwen-Image-Edit-2509 + Light-Migration LoRA (copy light from a reference)**

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=3; resolution=~1 MP
- Notes: Two inputs: subject + lighting reference image.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_edit_2509_fp8_e4m3fn.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors) | `diffusion_models` | 20.43 |  |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors) | `loras` | 0.85 |  |
  | [Qwen-Image-Edit-2509-Light-Migration.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Light-Migration.safetensors) | `loras` | 0.24 |  |

**3. IC-Light (SD1.5) via ComfyUI-IC-Light**

- License: IC-Light weights: license not stated on HF card (check repo)
- Settings: steps=25; cfg=2; sampler=dpmpp_2m; scheduler=karras; resolution=512-1024
- Notes: Legacy but cheap; needs an SD1.5 checkpoint. Settings are typical community values.
- Custom nodes: https://github.com/kijai/ComfyUI-IC-Light
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [iclight_sd15_fc.safetensors](https://huggingface.co/lllyasviel/ic-light/resolve/main/iclight_sd15_fc.safetensors) | `diffusion_models` | 1.72 | load into models/unet (diffusion_models); fbc variant for background-conditioned |

**4. Video relight: Wan Animate relight LoRA / SCAIL-2 relight LoRA**

- License: Apache-2.0 (commercial OK)
- Settings: steps=6; cfg=1; sampler=euler; scheduler=simple; shift=5; resolution=video
- Notes: Matches a replaced character to scene lighting during character swap.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_animate_14B_relight_lora_bf16.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_animate_14B_relight_lora_bf16.safetensors) | `loras` | 1.44 |  |
  | [wan2.1_SCAIL_2_relight_lora_bf16.safetensors](https://huggingface.co/Comfy-Org/SCAIL-2/resolve/main/loras/wan2.1_SCAIL_2_relight_lora_bf16.safetensors) | `loras` | 1.23 |  |

### `angles` - Multiple camera angles from one image

*The parity studio's equivalent:* the parity studio "Angles" / multi-shot from one photo

Qwen-Image-Edit-2511 + fal Multiple-Angles LoRA (96 camera poses) with a 3D camera picker node is the 2026 reference workflow (official app template).

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Qwen-Image-Edit-2511 + fal Multiple-Angles LoRA + QwenMultiangleCameraNode | template_qwen_multiangle.app / templates-1_click_multiple_character_angles-v1.0 | custom: [ComfyUI-qwenmultiangle](https://github.com/jtydhr88/ComfyUI-qwenmultiangle) | Apache-2.0 | ~24 GB |
| 2 | Qwen-Image-Edit-2509 + dx8152 Multiple-angles LoRA (scene camera moves) | templates-1_click_multiple_scene_angles-v1.0 | core | Apache-2.0 | ~24 GB |

**1. Qwen-Image-Edit-2511 + fal Multiple-Angles LoRA + QwenMultiangleCameraNode**

- License: Apache-2.0 (commercial OK)
- Settings: steps=40; cfg=3; sampler=euler; scheduler=simple; shift=3.1; resolution=~1 MP; turbo=4 steps cfg 1 with Lightning; prompt=<sks> [azimuth] [elevation] [distance], e.g. "<sks> front-left quarter view elevated shot medium shot"
- Notes: 96 poses = 8 azimuths x 4 elevations (incl. -30 deg low angle) x 3 distances. The one-click character template runs without the custom camera node; the 3D-camera app template needs jtydhr88/ComfyUI-qwenmultiangle. Pair with Wan 2.2 FLF2V to animate between angles (template template_rob_split_stack_qwen_multi_wan22).
- Custom nodes: https://github.com/jtydhr88/ComfyUI-qwenmultiangle
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_edit_2511_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors) | `diffusion_models` | 20.5 |  |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors) | `loras` | 0.85 |  |
  | [qwen-image-edit-2511-multiple-angles-lora.safetensors](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA/resolve/main/qwen-image-edit-2511-multiple-angles-lora.safetensors) | `loras` | 0.3 |  |

**2. Qwen-Image-Edit-2509 + dx8152 Multiple-angles LoRA (scene camera moves)**

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=3; resolution=~1 MP; prompt=no trigger; "Move the camera forward/left/right/down", "Rotate the camera 45 degrees to the left", "Turn the camera to a top-down view", wide-angle/close-up
- Notes: Better for environments/scenes.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_edit_2509_fp8_e4m3fn.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors) | `diffusion_models` | 20.43 |  |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors) | `loras` | 0.85 |  |
  | [Qwen-Edit-2509-Multiple-angles.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Edit-2509-Multiple-angles.safetensors) | `loras` | 0.24 |  |

### `face-swap` - Face / head / character swap

*The parity studio's equivalent:* Face Swap, Character Swap, Recast

Diffusion-based head swap LoRAs (BFS for Qwen-Edit 2511 / Qwen 2.1 / Klein / Krea 2 / LTX / H3) now beat inswapper-style swaps on realism; ReActor stays the fast frame-by-frame option. Full-body/video character swap is covered under motion-transfer (Wan Animate 2, SCAIL-2).

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | BFS "Best Face Swap" head-swap LoRA on Qwen-Image-Edit-2511 | image_qwen_image_edit_2511 (+ LoRA) | core | LoRA MIT; base Apache-2.0 | ~24 GB |
| 2 | ReActor (inswapper_128 / hyperswap_1x_256 / reswapper) + face restore | - | custom: [ComfyUI-ReActor](https://github.com/Gourieff/ComfyUI-ReActor) | node MIT; inswapper weights non-commercial (InsightFace) | 2-4 GB |
| 3 | Video head swap: BFS-Best-Face-Swap-Video (LTX-2.3 / LTX-2.5 / MiniMax H3 LoRAs) | - | custom: [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo), [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes), [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | LTX-2.x Community (<$10M rev.) | 24-32 GB |
| 4 | FLUX.2 [klein] 9B face-swap LoRA (ilkerzgi) / ACE++ portrait LoRA (Flux Fill) | - | core + [ACE_plus](https://github.com/ali-vilab/ACE_plus) | non-commercial bases | 12-24 GB |

**1. BFS "Best Face Swap" head-swap LoRA on Qwen-Image-Edit-2511**

- License: LoRA MIT; base Apache-2.0
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=3.1; resolution=~1 MP; loraStrength=1.0; prompt=V3-V5 use body-first order: "head_swap: start with Picture 1 as the base image ... replace it with the head from Picture 2 ..." (see BFS docs/qwen-image-edit.md)
- Notes: Respect each version's input order (V3+ is inverted: Image 1 = target body, Image 2 = face). MIT-licensed LoRA on an Apache base = commercially clean. Consent/abuse policy required in Fuobe.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen_image_edit_2511_fp8mixed.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors) | `diffusion_models` | 20.53 | int8 alternative: qwen_image_edit_2511_int8_convrot.safetensors (template image_qwen_image_edit_2511_int8) |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `vae` | 0.25 |  |
  | [Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors) | `loras` | 0.85 |  |
  | [bfs_head_v5_2511_merged_version_rank_16_fp16.safetensors](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/resolve/main/bfs_head_v5_2511_merged_version_rank_16_fp16.safetensors) | `loras` | 0.31 | other variants: bfs_head_v1.1_qwen_2.1, bfs_head_v1_flux-klein_4b/9b, bfs_head_swap_v1.1_krea2, body swap for Qwen 2.1 |

**2. ReActor (inswapper_128 / hyperswap_1x_256 / reswapper) + face restore**

- License: node MIT; inswapper weights non-commercial (InsightFace)
- Settings: resolution=face crop 128/256 px, pasted back; faceRestoreVisibility=0.5-1.0
- Notes: Fast image AND video (per-frame) swap; SFW-only fork; insightface needs Python <= 3.12 builds. InsightFace swapper weights are research/non-commercial.
- Custom nodes: https://github.com/Gourieff/ComfyUI-ReActor
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [inswapper_128.onnx](https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/inswapper_128.onnx) | `insightface` | 0.55 |  |
  | [hyperswap_1a_256.onnx](https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/hyperswap_1a_256.onnx) | `insightface` | 0.4 | 256px swapper (sharper) |
  | [codeformer-v0.1.0.pth](https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/facerestore_models/codeformer-v0.1.0.pth) | `facerestore_models` | 0.38 |  |

**3. Video head swap: BFS-Best-Face-Swap-Video (LTX-2.3 / LTX-2.5 / MiniMax H3 LoRAs)**

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: cfg=1; sampler=per LTX template; resolution=video
- Notes: IC-LoRA style video-to-video head replacement; follow the repo workflows.
- Custom nodes: https://github.com/Lightricks/ComfyUI-LTXVideo, https://github.com/kijai/ComfyUI-KJNodes, https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [head_swap_v3_rank_64.safetensors](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap-Video/resolve/main/ltx-2.3/head_swap_v3_rank_64.safetensors) | `loras` | 0.65 |  |
  | [head_swap_ltx25_r64_v1.1.safetensors](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap-Video/resolve/main/ltx-2.5/head_swap_ltx25_r64_v1.1.safetensors) | `loras` | 1.23 |  |
  | [minimax_h3_head_swap_v1.0_r32.safetensors](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap-Video/resolve/main/h3/minimax_h3_head_swap_v1.0_r32.safetensors) | `loras` | 0.31 |  |

**4. FLUX.2 [klein] 9B face-swap LoRA (ilkerzgi) / ACE++ portrait LoRA (Flux Fill)**

- License: non-commercial bases
- Settings: steps=4; cfg=1; sampler=euler; scheduler=Flux2Scheduler; resolution=1 MP
- Notes: Both rely on non-commercial FLUX bases.
- Custom nodes: https://github.com/ali-vilab/ACE_plus
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [FS2_V5_r64_800_pytorch_lora_weights.safetensors](https://huggingface.co/ilkerzgi/face-swap/resolve/main/FS2_V5_r64_800_pytorch_lora_weights.safetensors) | `loras` | 0.13 | prompt: "face_swap: take the face from Picture 1 and swap it onto the person in Picture 2." |
  | [comfyui_portrait_lora64.safetensors](https://huggingface.co/ali-vilab/ACE_Plus/resolve/main/portrait/comfyui_portrait_lora64.safetensors) | `loras` | 0.61 | ACE++ portrait consistency LoRA for FLUX.1 Fill |

### `character-lora` - Character consistency / "Soul ID" (trained LoRA + zero-shot identity)

*The parity studio's equivalent:* Soul ID (train a recurring character from ~20 photos)

Soul ID = a per-user identity LoRA. Train with ostris/ai-toolkit (UI + YAML; supports Z-Image, FLUX 3 Klein base, Krea 2, Qwen-Image/2512/2.1, Qwen-Edit, Wan 2.1/2.2, LTX-2.x, MiniMax H3) or kohya musubi-tuner, then load with LoraLoaderModelOnly. For zero-shot consistency use multi-reference editors and reference-to-video models.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Train identity LoRA with ai-toolkit on Z-Image (De-Turbo) / Krea 2 RAW / FLUX 3 Klein base; infer on the turbo model | - | core + [ai-toolkit](https://github.com/ostris/ai-toolkit) | ai-toolkit MIT; LoRA inherits base model license | training 24 GB (16 GB with quantization/low-VRAM presets); inference as base model |
| 2 | kohya musubi-tuner (Wan 2.1/2.2, HunyuanVideo 1.5, Qwen-Image, Z-Image, FLUX.2, FLUX.1 Kontext, Kandinsky 5, MiniMax-H3) | - | core + [musubi-tuner](https://github.com/kohya-ss/musubi-tuner) | Apache-2.0 | 16-24 GB+ |
| 3 | Zero-shot identity: Qwen-Image-Edit-2511 / FLUX 3 Klein / Qwen 2.1 multi-reference; LTX-2.3 ID-LoRA; MiniMax H3 R2V; Wan VACE / Phantom / Stand-In / Lynx | video_ltx2_3_id_lora / video_minimax_h3_r2v / video_wan_vace_14B_ref2v | core + [ComfyUI-WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) | per model | 24 GB+ |
| 4 | Adapter-based (legacy): USO (native template), PuLID-Flux, InfiniteYou, InstantID (SDXL) | flux1_dev_uso_reference_image_gen | custom: [ComfyUI_PuLID_Flux_ll](https://github.com/lldacing/ComfyUI_PuLID_Flux_ll), [ComfyUI_InfiniteYou](https://github.com/bytedance/ComfyUI_InfiniteYou), [ComfyUI_InstantID](https://github.com/cubiq/ComfyUI_InstantID) | FLUX.1 dev NC | ~16-24 GB |

**1. Train identity LoRA with ai-toolkit on Z-Image (De-Turbo) / Krea 2 RAW / FLUX 3 Klein base; infer on the turbo model**

- License: ai-toolkit MIT; LoRA inherits base model license
- Settings: steps=8; cfg=1; sampler=res_multistep; scheduler=simple; shift=3; resolution=1024; training=starting point: 15-30 curated photos, rank 16-32, ~2000-3000 steps, unique trigger token; tune with ai-toolkit example configs
- Notes: Fuobe can run ai-toolkit headless as a job runner (YAML config per user), store the LoRA in models/loras/<user>/ and inject a LoraLoaderModelOnly node into any workflow. Same LoRA idea for video: train on Wan 2.2 / LTX-2.3 for consistent characters in video.
- Custom nodes: https://github.com/ostris/ai-toolkit
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [z_image_bf16.safetensors](https://huggingface.co/Comfy-Org/z_image/resolve/main/split_files/diffusion_models/z_image_bf16.safetensors) | `diffusion_models` | 12.31 | training base for Z-Image (or ostris/Z-Image-De-Turbo); the LoRA is applied to z_image_turbo at inference |

**2. kohya musubi-tuner (Wan 2.1/2.2, HunyuanVideo 1.5, Qwen-Image, Z-Image, FLUX.2, FLUX.1 Kontext, Kandinsky 5, MiniMax-H3)**

- License: Apache-2.0
- Settings: -
- Notes: Scriptable trainer, good for video LoRAs and single-frame (1f) Wan LoRAs.
- Custom nodes: https://github.com/kohya-ss/musubi-tuner

**3. Zero-shot identity: Qwen-Image-Edit-2511 / FLUX 3 Klein / Qwen 2.1 multi-reference; LTX-2.3 ID-LoRA; MiniMax H3 R2V; Wan VACE / Phantom / Stand-In / Lynx**

- License: per model
- Settings: sampler=per template
- Notes: No training needed; weaker identity lock than a trained LoRA but instant.
- Custom nodes: https://github.com/kijai/ComfyUI-WanVideoWrapper
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.3-id-lora-talkvid-3k.safetensors](https://huggingface.co/Comfy-Org/ltx-2.3/resolve/main/split_files/loras/ltx-2.3-id-lora-talkvid-3k.safetensors) | `loras` | 1.16 | LTX-2.3 ID-LoRA: face + voice from a reference image + audio clip |

**4. Adapter-based (legacy): USO (native template), PuLID-Flux, InfiniteYou, InstantID (SDXL)**

- License: FLUX.1 [dev] Non-Commercial License (outputs may be used commercially per BFL terms; model use in production needs a BFL commercial license)
- Settings: steps=20; cfg=1; guidance=3.5; sampler=euler; scheduler=simple; resolution=1024x1024
- Notes: All Flux.1-dev based (non-commercial) or SDXL; kept for compatibility.
- Custom nodes: https://github.com/lldacing/ComfyUI_PuLID_Flux_ll, https://github.com/bytedance/ComfyUI_InfiniteYou, https://github.com/cubiq/ComfyUI_InstantID
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [uso-flux1-projector-v1.safetensors](https://huggingface.co/Comfy-Org/USO_1.0_Repackaged/resolve/main/split_files/model_patches/uso-flux1-projector-v1.safetensors) | `model_patches` | 0.02 |  |
  | [uso-flux1-dit-lora-v1.safetensors](https://huggingface.co/Comfy-Org/USO_1.0_Repackaged/resolve/main/split_files/loras/uso-flux1-dit-lora-v1.safetensors) | `loras` | 0.48 |  |
  | [sigclip_vision_patch14_384.safetensors](https://huggingface.co/Comfy-Org/sigclip_vision_384/resolve/main/sigclip_vision_patch14_384.safetensors) | `clip_vision` | 0.86 |  |
  | [flux1-dev-fp8.safetensors](https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors) | `checkpoints` | 17.25 |  |

### `t2v` - Text-to-video (Kling / Veo / Seedance-like)

*The parity studio's equivalent:* Create Video (Kling 3, Veo 3.1, Seedance 2.x, Wan 2.6/3.0 backends)

Wan 3.0 and Wan 2.5-2.7 are API-only; the last open Wan flagship is still Wan 2.2 (Apache-2.0). 2026 adds open joint audio+video models: LTX-2.3/2.5 (22B, synchronized audio, native multishot, up to 4K/50 fps) and MiniMax H3 (33B, stereo audio, 768p, ~15 s; restrictive territory license). All of these are native in ComfyUI core.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Wan 2.2 14B T2V (MoE high/low noise) + Lightx2v 4-step | video_wan2_2_14B_t2v | core | Apache-2.0 | 24 GB (RTX 4090D: 84-89% VRAM at 640x640x81, ~70-110 s with 4-step LoRA) |
| 2 | LTX-2.5 (22B distilled, synchronized audio, multishot) | video_ltx2_5_t2v | core | LTX-2.x Community (<$10M rev.) | ~32 GB+ comfortable (int8 transformer 21.5 GB + int8 Gemma-4 12B 15.4 GB, offloaded); 24 GB with offload/nvfp4 |
| 3 | MiniMax H3 (33B, native stereo audio) | video_minimax_h3_t2v / video_fastvideo_fasth3_t2v | core | MiniMax H3 (no US/EU/UK/KR; commercial license) | ~32-48 GB (pruned int8 DiT 21 GB + Qwen3-VL-32B nvfp4 TE 15.7 GB); Sage/sparse attention recommended |
| 4 | HunyuanVideo 1.5 (8.3B) 720p T2V + 1080p SR | video_hunyuan_video_1.5_720p_t2v | core | Tencent Hunyuan (no EU/UK/KR) | 24 GB (docs) |
| 5 | LTX-2.3 (22B) T2V with audio | video_ltx2_3_t2v | core | LTX-2.x Community (<$10M rev.) | ~24-32 GB (fp8 checkpoint 29 GB, offloaded) |
| 6 | Wan 2.2 TI2V 5B (hybrid T2V/I2V, 720p 24 fps) | video_wan2_2_5B_ti2v | core | Apache-2.0 | ~8 GB with native offloading (docs) |

**1. Wan 2.2 14B T2V (MoE high/low noise) + Lightx2v 4-step** ([docs](https://docs.comfy.org/tutorials/video/wan/wan2_2))

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=5; split=KSamplerAdvanced high-noise steps 0-2 (add noise, return leftover noise) -> low-noise steps 2-4; withoutLora=20 steps, cfg 3.5, shift 8, switch experts at step 10 (recipe of the Wan 2.2 Fun templates; FLF2V template uses cfg 4); resolution=640x640 template; 480p-720p (1280x720) supported; frames=81; fps=16
- Notes: Commercially clean workhorse; best open motion/prompt following in its class, no audio. 81 frames = ~5 s at 16 fps (interpolate to 32 fps). Camera language in prompt works well.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 14.29 |  |
  | [wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 14.29 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |
  | [wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors) | `loras` | 1.23 |  |
  | [wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors) | `loras` | 1.23 |  |

**2. LTX-2.5 (22B distilled, synchronized audio, multishot)** ([docs](https://docs.comfy.org/tutorials/video/ltx/ltx-2-5))

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=8 (stage 1) + 3 (refine after 2x latent upscale); cfg=1; sampler=euler_ancestral; scheduler=ManualSigmas; sigmasStage1=1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0; sigmasStage2=0.85, 0.7250, 0.4219, 0.0; resolution=template 768x512 -> 1536x1024 after x2 upscaler; up to native 4K; frames=97; fps=24
- Notes: Released 2026-08-11. Audio (dialogue/SFX/music) generated jointly; auto-duration; optional prompt enhancer; DFR production pipeline template video_ltx2_5_dfr_i2v. Repo is gated (accept license).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors) | `diffusion_models` | 21.5 | **gated (accept license + HF token)** dev (non-distilled) and nvfp4 variants in the same repo |
  | [gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors) | `text_encoders` | 15.37 | **gated (accept license + HF token)**  |
  | [ltx-2.5-video-vae-bf16.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-video-vae-bf16.safetensors) | `vae` | 1.47 | **gated (accept license + HF token)**  |
  | [ltx-2.5-audio-vae-bf16.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-audio-vae-bf16.safetensors) | `vae` | 0.36 | **gated (accept license + HF token)**  |
  | [ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors) | `latent_upscale_models` | 1.0 | **gated (accept license + HF token)**  |
  | [gemma4_e2b_it_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/gemma-4/resolve/main/text_encoders/gemma4_e2b_it_int8_convrot.safetensors) | `text_encoders` | 5.2 | only for optional prompt_enhance |

**3. MiniMax H3 (33B, native stereo audio)** ([docs](https://docs.comfy.org/tutorials/video/minimax/minimax-h3))

- License: MiniMax H3 Community License: territory EXCLUDES the United States, EU, UK and South Korea; Comfy docs state commercial use of locally generated outputs needs a MiniMax commercial license (resold by Comfy)
- Settings: steps=20; sampler=res_multistep; scheduler=simple; resolution=native 1344x768 (768 px short edge, multiples of 32); frames=124 default (~5 s); length snaps to 17k+5; fps=24; turbo=8 steps (T2V/I2V LoRA) or 4 steps (R2V LoRA); maxDuration=~15 s
- Notes: Highest-fidelity open audio-video model in 2026, but the license excludes US/EU/UK/KR and local commercial output needs a MiniMax license. FastH3 (FastVideo) checkpoints use sparse attention for speed. 10 community style embeddings (bullet_time, art_is_explosion ...).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [minimax_h3_fl2va_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors) | `diffusion_models` | 20.97 | w6a8 (16 GB) / fp8 / bf16 variants available |
  | [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | `text_encoders` | 15.69 |  |
  | [minimax_h3_video_vae_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors) | `vae` | 2.81 |  |
  | [minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) | `vae` | 0.61 |  |
  | [minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors) | `loras` | 1.96 | optional turbo LoRA |

**4. HunyuanVideo 1.5 (8.3B) 720p T2V + 1080p SR** ([docs](https://docs.comfy.org/tutorials/video/hunyuan/hunyuan-video-1-5))

- License: Tencent Hunyuan Community License (territory excludes EU, UK and South Korea)
- Settings: steps=20; cfg=6; sampler=euler; scheduler=simple; shift=7; resolution=1280x720 (720p native; optional SR to 1080p: 8 steps, cfg 1, shift 2); frames=121; fps=24
- Notes: Good lightweight alternative with strong camera/physics instruction following and in-video text; 5-10 s clips.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [hunyuanvideo1.5_720p_t2v_fp16.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_720p_t2v_fp16.safetensors) | `diffusion_models` | 16.65 | 480p cfg-distilled / step-distilled fp8 variants for speed |
  | [hunyuanvideo1.5_t2v_480p_lightx2v_4step_lora_rank_32_bf16.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/loras/hunyuanvideo1.5_t2v_480p_lightx2v_4step_lora_rank_32_bf16.safetensors) | `loras` | 0.34 | 4-step LoRA for 480p T2V |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [byt5_small_glyphxl_fp16.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/byt5_small_glyphxl_fp16.safetensors) | `text_encoders` | 0.44 |  |
  | [hunyuanvideo15_vae_fp16.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/vae/hunyuanvideo15_vae_fp16.safetensors) | `vae` | 2.52 |  |
  | [hunyuanvideo1.5_1080p_sr_distilled_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_1080p_sr_distilled_fp8_scaled.safetensors) | `diffusion_models` | 8.34 | optional 1080p super-resolution pass (template uses the fp16 file) |
  | [hunyuanvideo15_latent_upsampler_1080p.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/latent_upscale_models/hunyuanvideo15_latent_upsampler_1080p.safetensors) | `latent_upscale_models` | 0.2 |  |

**5. LTX-2.3 (22B) T2V with audio** ([docs](https://docs.comfy.org/tutorials/video/ltx/ltx-2-3))

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=8 + 3; cfg=1; sampler=euler; scheduler=ManualSigmas (same schedule as LTX-2.5); resolution=768x512 -> x2; frames=97; fps=24
- Notes: Previous LTX generation; huge IC-LoRA/LoRA ecosystem (camera, union control, DubIt, outpaint...).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.3-22b-dev-fp8.safetensors](https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/main/ltx-2.3-22b-dev-fp8.safetensors) | `checkpoints` | 29.15 |  |
  | [ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors](https://huggingface.co/Comfy-Org/ltx-2.3/resolve/main/split_files/loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors) | `loras` | 2.74 | distill LoRA at 0.5 in templates |
  | [gemma_3_12B_it_fp4_mixed.safetensors](https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors) | `text_encoders` | 9.45 |  |
  | [ltx-2.3-spatial-upscaler-x2-1.1.safetensors](https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-spatial-upscaler-x2-1.1.safetensors) | `latent_upscale_models` | 1.0 |  |

**6. Wan 2.2 TI2V 5B (hybrid T2V/I2V, 720p 24 fps)** ([docs](https://docs.comfy.org/tutorials/video/wan/wan2_2))

- License: Apache-2.0 (commercial OK)
- Settings: steps=20; cfg=5; sampler=uni_pc; scheduler=simple; shift=8; resolution=1280x704; frames=121; fps=24
- Notes: Budget tier for low-VRAM workers / previews.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_ti2v_5B_fp16.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors) | `diffusion_models` | 10.0 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan2.2_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors) | `vae` | 1.41 |  |

### `i2v` - Image-to-video

*The parity studio's equivalent:* DoP / Image-to-Video

Same model families as T2V; I2V is the most-used the parity studio's path (Soul image -> animate).

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Wan 2.2 14B I2V + Lightx2v 4-step | video_wan2_2_14B_i2v | core | Apache-2.0 | 24 GB (fp8); 12-16 GB possible with community GGUF quants via city96/ComfyUI-GGUF + offload (slower, estimate) |
| 2 | LTX-2.5 I2V (with audio) | video_ltx2_5_i2v / video_ltx2_5_dfr_i2v | core | LTX-2.x Community (<$10M rev.) | ~32 GB+ |
| 3 | MiniMax H3 I2V (+ first/last frame, continuation) | video_minimax_h3_i2v / video_minimax_h3_i2v_continuation | core | MiniMax H3 (no US/EU/UK/KR; commercial license) | ~32-48 GB |
| 4 | HunyuanVideo 1.5 720p I2V | video_hunyuan_video_1.5_720p_i2v | core | Tencent Hunyuan (no EU/UK/KR) | 24 GB |
| 5 | Wan 2.2 TI2V 5B | video_wan2_2_5B_ti2v | core | Apache-2.0 | ~8 GB |
| 6 | LTX-2.3 I2V | video_ltx2_3_i2v | core | LTX-2.x Community (<$10M rev.) | ~24-32 GB |

**1. Wan 2.2 14B I2V + Lightx2v 4-step** ([docs](https://docs.comfy.org/tutorials/video/wan/wan2_2))

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=5; split=KSamplerAdvanced high-noise steps 0-2 (add noise, return leftover noise) -> low-noise steps 2-4; withoutLora=20 steps, cfg 3.5, shift 8, switch experts at step 10 (recipe of the Wan 2.2 Fun templates; FLF2V template uses cfg 4); resolution=640x640 template; up to 1280x720; frames=81; fps=16
- Notes: Native WanImageToVideo node; base for effect/camera LoRAs (community practice: Wan 2.1 I2V LoRAs are applied to the 2.2 low-noise expert; Wan 2.2-trained high/low LoRA pairs work best). Multi-keyframe stitching template templates-6-key-frames.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 14.29 |  |
  | [wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 14.29 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |
  | [wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors) | `loras` | 1.23 |  |
  | [wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors) | `loras` | 1.23 |  |
  | [wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022.safetensors](https://huggingface.co/lightx2v/Wan2.2-Distill-Loras/resolve/main/wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022.safetensors) | `loras` | 0.63 | newer lightx2v distill release ("1022"); pair with wan2.2_i2v_A14b_low_noise_lora_rank64_lightx2v_4step_1022.safetensors |

**2. LTX-2.5 I2V (with audio)** ([docs](https://docs.comfy.org/tutorials/video/ltx/ltx-2-5))

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=8 (stage 1) + 3 (refine after 2x latent upscale); cfg=1; sampler=euler_ancestral; scheduler=ManualSigmas; sigmasStage1=1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0; sigmasStage2=0.85, 0.7250, 0.4219, 0.0; resolution=template 768x512 -> 1536x1024 after x2 upscaler; up to native 4K; frames=97; fps=24
- Notes: Use DFR template for production quality (keyframe-first + detailing IC-LoRA, needs ComfyUI-LTXVideo nodes for some steps).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors) | `diffusion_models` | 21.5 | **gated (accept license + HF token)** dev (non-distilled) and nvfp4 variants in the same repo |
  | [gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors) | `text_encoders` | 15.37 | **gated (accept license + HF token)**  |
  | [ltx-2.5-video-vae-bf16.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-video-vae-bf16.safetensors) | `vae` | 1.47 | **gated (accept license + HF token)**  |
  | [ltx-2.5-audio-vae-bf16.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-audio-vae-bf16.safetensors) | `vae` | 0.36 | **gated (accept license + HF token)**  |
  | [ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors) | `latent_upscale_models` | 1.0 | **gated (accept license + HF token)**  |
  | [gemma4_e2b_it_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/gemma-4/resolve/main/text_encoders/gemma4_e2b_it_int8_convrot.safetensors) | `text_encoders` | 5.2 | only for optional prompt_enhance |

**3. MiniMax H3 I2V (+ first/last frame, continuation)** ([docs](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native))

- License: MiniMax H3 Community License: territory EXCLUDES the United States, EU, UK and South Korea; Comfy docs state commercial use of locally generated outputs needs a MiniMax commercial license (resold by Comfy)
- Settings: steps=20; sampler=res_multistep; scheduler=simple; resolution=native 1344x768 (768 px short edge, multiples of 32); frames=124 default (~5 s); length snaps to 17k+5; fps=24; turbo=8 steps (T2V/I2V LoRA) or 4 steps (R2V LoRA); maxDuration=~15 s
- Notes: MiniMaxH3AddGuide anchors images/audio at any frame.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [minimax_h3_fl2va_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors) | `diffusion_models` | 20.97 | w6a8 (16 GB) / fp8 / bf16 variants available |
  | [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | `text_encoders` | 15.69 |  |
  | [minimax_h3_video_vae_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors) | `vae` | 2.81 |  |
  | [minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) | `vae` | 0.61 |  |
  | [minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors) | `loras` | 1.96 | optional turbo LoRA |

**4. HunyuanVideo 1.5 720p I2V** ([docs](https://docs.comfy.org/tutorials/video/hunyuan/hunyuan-video-1-5))

- License: Tencent Hunyuan Community License (territory excludes EU, UK and South Korea)
- Settings: steps=20; cfg=6; sampler=euler; scheduler=simple; shift=7; resolution=1280x720 (720p native; optional SR to 1080p: 8 steps, cfg 1, shift 2); frames=121; fps=24
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [hunyuanvideo1.5_720p_i2v_fp16.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_720p_i2v_fp16.safetensors) | `diffusion_models` | 16.65 | cfg-distilled fp8: hunyuanvideo1.5_720p_i2v_cfg_distilled_fp8_scaled.safetensors |
  | [sigclip_vision_patch14_384.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/clip_vision/sigclip_vision_patch14_384.safetensors) | `clip_vision` | 0.86 |  |
  | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `text_encoders` | 9.38 |  |
  | [byt5_small_glyphxl_fp16.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/byt5_small_glyphxl_fp16.safetensors) | `text_encoders` | 0.44 |  |
  | [hunyuanvideo15_vae_fp16.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/vae/hunyuanvideo15_vae_fp16.safetensors) | `vae` | 2.52 |  |
  | [hunyuanvideo1.5_1080p_sr_distilled_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_1080p_sr_distilled_fp8_scaled.safetensors) | `diffusion_models` | 8.34 | optional 1080p super-resolution pass (template uses the fp16 file) |
  | [hunyuanvideo15_latent_upsampler_1080p.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/latent_upscale_models/hunyuanvideo15_latent_upsampler_1080p.safetensors) | `latent_upscale_models` | 0.2 |  |

**5. Wan 2.2 TI2V 5B**

- License: Apache-2.0 (commercial OK)
- Settings: steps=20; cfg=5; sampler=uni_pc; scheduler=simple; shift=8; resolution=1280x704; frames=121; fps=24
- Notes: Wan22ImageToVideoLatent with start_image.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_ti2v_5B_fp16.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors) | `diffusion_models` | 10.0 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan2.2_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors) | `vae` | 1.41 |  |

**6. LTX-2.3 I2V** ([docs](https://docs.comfy.org/tutorials/video/ltx/ltx-2-3))

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=8 + 3; cfg=1; sampler=euler; scheduler=ManualSigmas (same schedule as LTX-2.5); resolution=768x512 -> x2; frames=97; fps=24
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.3-22b-dev-fp8.safetensors](https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/main/ltx-2.3-22b-dev-fp8.safetensors) | `checkpoints` | 29.15 |  |
  | [ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors](https://huggingface.co/Comfy-Org/ltx-2.3/resolve/main/split_files/loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors) | `loras` | 2.74 | distill LoRA at 0.5 in templates |
  | [gemma_3_12B_it_fp4_mixed.safetensors](https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors) | `text_encoders` | 9.45 |  |
  | [ltx-2.3-spatial-upscaler-x2-1.1.safetensors](https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-spatial-upscaler-x2-1.1.safetensors) | `latent_upscale_models` | 1.0 |  |

### `flf2v` - Start + end frame (first-last-frame) video

*The parity studio's equivalent:* Start/End frame, transitions

Native in Wan 2.2 (WanFirstLastFrameToVideo), LTX-2.3/2.5 and MiniMax H3.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Wan 2.2 14B FLF2V (I2V experts) + Lightx2v | video_wan2_2_14B_flf2v | core | Apache-2.0 | 24 GB |
| 2 | LTX-2.5 FLF2V (with audio) | video_ltx2_5_flf2v | core | LTX-2.x Community (<$10M rev.) | ~32 GB |
| 3 | MiniMax H3 first/last frame (and arbitrary-frame guides) | video_minimax_h3_i2v | core | MiniMax H3 (no US/EU/UK/KR; commercial license) | ~32-48 GB |
| 4 | LTX-2.3 FLF2V (distilled) | video_ltx2_3_flf2v | core | LTX-2.x Community (<$10M rev.) | ~24-32 GB |
| 5 | Wan 2.1 FLF2V 720p / Wan 2.1 VACE first-last frame | wan2.1_flf2v_720_f16 / video_wan_vace_flf2v | core | Apache-2.0 | 24 GB+ (fp16 32.8 GB offloaded) |

**1. Wan 2.2 14B FLF2V (I2V experts) + Lightx2v** ([docs](https://docs.comfy.org/tutorials/video/wan/wan2_2))

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=5; split=KSamplerAdvanced high-noise steps 0-2 (add noise, return leftover noise) -> low-noise steps 2-4; withoutLora=20 steps, cfg 4, shift 8, switch at step 10; resolution=640x640 template; up to 720p; frames=81; fps=16
- Notes: Chain clips for long sequences (Qwen multi-angle stills -> FLF2V template template_rob_split_stack_qwen_multi_wan22).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 14.29 |  |
  | [wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 14.29 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |
  | [wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors) | `loras` | 1.23 |  |
  | [wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors) | `loras` | 1.23 |  |

**2. LTX-2.5 FLF2V (with audio)** ([docs](https://docs.comfy.org/tutorials/video/ltx/ltx-2-5))

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=8 (stage 1) + 3 (refine after 2x latent upscale); cfg=1; sampler=euler_ancestral; scheduler=ManualSigmas; sigmasStage1=1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0; sigmasStage2=0.85, 0.7250, 0.4219, 0.0; resolution=template 768x512 -> 1536x1024 after x2 upscaler; up to native 4K; frames=97; fps=24
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors) | `diffusion_models` | 21.5 | **gated (accept license + HF token)** dev (non-distilled) and nvfp4 variants in the same repo |
  | [gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors) | `text_encoders` | 15.37 | **gated (accept license + HF token)**  |
  | [ltx-2.5-video-vae-bf16.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-video-vae-bf16.safetensors) | `vae` | 1.47 | **gated (accept license + HF token)**  |
  | [ltx-2.5-audio-vae-bf16.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-audio-vae-bf16.safetensors) | `vae` | 0.36 | **gated (accept license + HF token)**  |
  | [ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors) | `latent_upscale_models` | 1.0 | **gated (accept license + HF token)**  |
  | [gemma4_e2b_it_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/gemma-4/resolve/main/text_encoders/gemma4_e2b_it_int8_convrot.safetensors) | `text_encoders` | 5.2 | only for optional prompt_enhance |

**3. MiniMax H3 first/last frame (and arbitrary-frame guides)**

- License: MiniMax H3 Community License: territory EXCLUDES the United States, EU, UK and South Korea; Comfy docs state commercial use of locally generated outputs needs a MiniMax commercial license (resold by Comfy)
- Settings: steps=20; sampler=res_multistep; scheduler=simple; resolution=native 1344x768 (768 px short edge, multiples of 32); frames=124 default (~5 s); length snaps to 17k+5; fps=24; turbo=8 steps (T2V/I2V LoRA) or 4 steps (R2V LoRA); maxDuration=~15 s
- Notes: Connect first_frame/last_frame on MiniMaxH3ImageToVideo; MiniMaxH3AddGuide for mid-clip anchors.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [minimax_h3_fl2va_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors) | `diffusion_models` | 20.97 | w6a8 (16 GB) / fp8 / bf16 variants available |
  | [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | `text_encoders` | 15.69 |  |
  | [minimax_h3_video_vae_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors) | `vae` | 2.81 |  |
  | [minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) | `vae` | 0.61 |  |
  | [minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors) | `loras` | 1.96 | optional turbo LoRA |

**4. LTX-2.3 FLF2V (distilled)**

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=8; cfg=1; sampler=euler; scheduler=ManualSigmas; resolution=768x512; frames=97; fps=24
- Notes: Style-transition LoRA template template_ltx2_3_style_transition (trigger "zhuanchang").
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.3-22b-distilled-fp8.safetensors](https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/main/ltx-2.3-22b-distilled-fp8.safetensors) | `checkpoints` | 29.53 |  |
  | [gemma_3_12B_it_fp4_mixed.safetensors](https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors) | `text_encoders` | 9.45 |  |

**5. Wan 2.1 FLF2V 720p / Wan 2.1 VACE first-last frame** ([docs](https://docs.comfy.org/tutorials/video/wan/wan-flf))

- License: Apache-2.0 (commercial OK)
- Settings: steps=20; cfg=3; sampler=uni_pc; scheduler=simple; shift=8; resolution=720x1280 (template); frames=33 template (up to 81); fps=16
- Notes: Legacy 2025 model; superseded by Wan 2.2 FLF2V.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.1_flf2v_720p_14B_fp16.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_flf2v_720p_14B_fp16.safetensors) | `diffusion_models` | 32.79 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |
  | [clip_vision_h.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors) | `clip_vision` | 1.26 |  |

### `ref2v` - Reference-to-video (subject/character/product references)

*The parity studio's equivalent:* the parity studio "Ingredients"/references, Soul ID in video, product-to-video

Quality leader is MiniMax H3 R2V (9 images, 3 videos, 3 audio refs) but its license excludes US/EU/UK/KR, so the Fuobe default is Wan 2.1 VACE 14B (Apache, native); LTX-2.3 IC-LoRA/ID-LoRA (revenue-gated) and Phantom (wrapper) are alternatives. For still images, do multi-reference composition with Qwen-Image-Edit-2511 / FLUX 3 Klein first and then I2V.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Wan 2.1 VACE 14B reference-to-video (+ CausVid / Lightx2v) | video_wan_vace_14B_ref2v | core | Apache-2.0 | 24 GB+ (fp16 32.8 GB offloaded; use fp8 for 24 GB) |
| 2 | MiniMax H3 Reference-to-Video (ref2va) | video_minimax_h3_r2v / video_minimax_h3_multiframe_reference | core | MiniMax H3 (no US/EU/UK/KR; commercial license) | ~32-48 GB |
| 3 | LTX-2.3 IC-LoRA "Ingredients" reference sheet / ID-LoRA | template_ltx2_3_ic_lora_ingredients / video_ltx2_3_id_lora | core | LTX-2.x Community (<$10M rev.) | ~24-32 GB |
| 4 | Wan 2.2 Fun VACE A14B (high/low noise) | - | core | Apache-2.0 | 24 GB |
| 5 | Phantom-Wan 14B (multi-subject consistency) via WanVideoWrapper | - | custom: [ComfyUI-WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) | Apache-2.0 | 24 GB |

**1. Wan 2.1 VACE 14B reference-to-video (+ CausVid / Lightx2v)** ([docs](https://docs.comfy.org/tutorials/video/wan/vace))

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=uni_pc; scheduler=simple; shift=8; resolution=768x768 template; frames=81; fps=16
- Notes: WanVaceToVideo reference_image input; same model also does pose/depth control, inpaint, outpaint, FLF.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.1_vace_14B_fp16.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_vace_14B_fp16.safetensors) | `diffusion_models` | 34.68 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |
  | [Wan21_CausVid_14B_T2V_lora_rank32.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan21_CausVid_14B_T2V_lora_rank32.safetensors) | `loras` | 0.32 |  |

**2. MiniMax H3 Reference-to-Video (ref2va)** ([docs](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native))

- License: MiniMax H3 Community License: territory EXCLUDES the United States, EU, UK and South Korea; Comfy docs state commercial use of locally generated outputs needs a MiniMax commercial license (resold by Comfy)
- Settings: steps=20; sampler=res_multistep; scheduler=simple; resolution=native 1344x768 (768 px short edge, multiples of 32); frames=124 default (~5 s); length snaps to 17k+5; fps=24; turbo=4 steps with ref2v turbo LoRA (references may under-apply); maxDuration=~15 s; references=up to 9 images, 3 videos, 3 audio; tag as <Picture 1>, <Video 1>, <Audio 1>
- Notes: Can lock identity, style, motion, camera move and voice from references.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [minimax_h3_ref2va_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors) | `diffusion_models` | 20.97 | w6a8 (16 GB) / fp8 / bf16 variants available |
  | [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | `text_encoders` | 15.69 |  |
  | [minimax_h3_video_vae_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors) | `vae` | 2.81 |  |
  | [minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) | `vae` | 0.61 |  |
  | [minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors) | `loras` | 1.96 | optional turbo LoRA |

**3. LTX-2.3 IC-LoRA "Ingredients" reference sheet / ID-LoRA**

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=8 + 3; cfg=1; sampler=euler; scheduler=ManualSigmas (same schedule as LTX-2.5); resolution=768x512 -> x2; frames=97; fps=24
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors](https://huggingface.co/Comfy-Org/ltx-2.3/resolve/main/split_files/loras/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors) | `loras` | 1.31 |  |
  | [ltx-2.3-22b-distilled-fp8.safetensors](https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/main/ltx-2.3-22b-distilled-fp8.safetensors) | `checkpoints` | 29.53 |  |

**4. Wan 2.2 Fun VACE A14B (high/low noise)**

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=5; split=KSamplerAdvanced high-noise steps 0-2 (add noise, return leftover noise) -> low-noise steps 2-4; withoutLora=20 steps, cfg 3.5, shift 8, switch experts at step 10 (recipe of the Wan 2.2 Fun templates; FLF2V template uses cfg 4); resolution=480p-720p; frames=81; fps=16
- Notes: Repackaged by Comfy-Org (no dedicated template); wire like the Wan 2.2 two-sampler template with WanVaceToVideo.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_fun_vace_high_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_vace_high_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 17.35 |  |
  | [wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 17.35 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |

**5. Phantom-Wan 14B (multi-subject consistency) via WanVideoWrapper**

- License: Apache-2.0 (commercial OK)
- Settings: sampler=wrapper defaults; resolution=480p-720p; frames=81; fps=16
- Notes: Wrapper also offers MAGREF, Stand-In, Lynx, BindWeave identity models.
- Custom nodes: https://github.com/kijai/ComfyUI-WanVideoWrapper
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [Phantom-Wan-14B_fp8_e4m3fn.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Phantom-Wan-14B_fp8_e4m3fn.safetensors) | `diffusion_models` | 15.0 |  |

### `camera-motion` - Camera motions (DoP presets)

*The parity studio's equivalent:* DoP camera motions (113 entries in the companion parity-inventory.json): Crash Zoom In/Out, Dolly In/Out/Left/Right, Dolly Zoom In/Out, Super Dolly In/Out, 360 Orbit, Arc Left/Right, Crane Up/Down/Over The Head, Jib up/down, Bullet Time, FPV Drone, Whip Pan, Snorricam, Handheld, Lazy Susan, 3D Rotation, Earth Zoom Out, Eyes In, Fisheye, Car Chasing, Action Run, Hyperlapse/Timelapse, Dutch Angle, Robo Arm ...

Three complementary mechanisms: (1) explicit camera-path conditioning (Wan 2.2 Fun Camera native presets, Uni3C, ReCamMaster, LTX IC-LoRA Cameraman copying a reference clip), (2) motion LoRAs per preset (Remade-AI Wan 2.1 I2V set, ostris orbit, Lightricks LTX-2 dolly/jib, MiniMax H3 orbit/FPV/handheld), and (3) prompt-only camera language for Wan 2.2/LTX-2.5/H3. Fuobe should expose a preset table where each preset maps to {model, LoRA file, trigger phrase, strength, prompt template}; see the LoRA catalog.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Wan 2.2 14B Fun Camera Control (native WanCameraEmbedding presets) + Lightx2v | video_wan2_2_14B_fun_camera | core | Apache-2.0 | 24 GB (4090D: 89% with LoRA, ~71-108 s) |
| 2 | Wan I2V + camera-motion LoRAs (Remade-AI set, ostris orbit/dolly-zoom, lovis93 push-in, bullet-time) | video_wan2_2_14B_i2v (+ LoraLoaderModelOnly) | core | Apache-2.0 | 24 GB |
| 3 | LTX-2 / LTX-2.3 camera LoRAs + IC-LoRA "Cameraman" (copy camera move from a reference video) | video_ltx2_i2v / video_ltx2_t2v (dolly-left LoRA pre-wired) | core + [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) | LTX-2.x Community (<$10M rev.) | 24-32 GB |
| 4 | Uni3C camera ControlNet / ReCamMaster (re-shoot a video from a new trajectory) via WanVideoWrapper | - | custom: [ComfyUI-WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) | Apache-2.0 | 24 GB |
| 5 | Trajectory/drag control: Wan-Move, Wan ATI (draw motion paths) | video_wanmove_480p / video_wan_ati | core + [ComfyUI_Fill-Nodes](https://github.com/filliptm/ComfyUI_Fill-Nodes), [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) | Apache-2.0 | 24 GB |
| 6 | Prompt-only camera language (Wan 2.2 / LTX-2.5 / HunyuanVideo 1.5 / MiniMax H3) | - | core | n/a | n/a |
| 7 | MiniMax H3 camera LoRAs + embeddings (360 orbit, FPV head-bob, handheld, bullet_time, spiral_ascent) | video_minimax_h3_i2v | core | MiniMax H3 (no US/EU/UK/KR; commercial license) | ~32-48 GB |

**1. Wan 2.2 14B Fun Camera Control (native WanCameraEmbedding presets) + Lightx2v** ([docs](https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-camera))

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=8; resolution=832x480 template (640x640 benchmarked); frames=81; fps=16; presets=WanCameraEmbedding: Static, Pan Up/Down/Left/Right (camera translation = pedestal/truck), Zoom In/Out (forward/back translation = dolly), Anti Clockwise (ACW) / ClockWise (CW) (roll); several can be chained; inputs speed, fx, fy, cx, cy; withoutLora=20 steps, cfg 3.5, shift 8
- Notes: Deterministic, preset-driven translations/roll (no orbit/arc) - combine with LoRAs or Uni3C for orbit, crane arcs and bullet time.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 15.3 |  |
  | [wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 15.3 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |
  | [wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors) | `loras` | 1.23 |  |
  | [wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors) | `loras` | 1.23 |  |

**2. Wan I2V + camera-motion LoRAs (Remade-AI set, ostris orbit/dolly-zoom, lovis93 push-in, bullet-time)**

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=5; resolution=480p (LoRAs trained on Wan 2.1 I2V 480p); frames=81; fps=16; loraStrength=0.8-1.0
- Notes: Remade LoRAs are Wan 2.1 I2V-480p LoRAs: run them on Wan 2.1 I2V 14B 480p (best fidelity) or load on the Wan 2.2 low-noise expert. Full list with triggers in the LoRA catalog (30+ camera presets).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [crash_zoom_in.safetensors](https://huggingface.co/Remade-AI/Crash-zoom-in/resolve/main/crash_zoom_in.safetensors) | `loras` | 0.36 | trigger "cr34sh crash zoom in effect" |
  | [360_Orbit.safetensors](https://huggingface.co/Remade-AI/360-Orbit/resolve/main/360_Orbit.safetensors) | `loras` | 0.36 | trigger "0rb4it 360 degree orbit" |
  | [wan22_14b_i2v_orbit_high_noise.safetensors](https://huggingface.co/ostris/wan22_i2v_14b_orbit_shot_lora/resolve/main/wan22_14b_i2v_orbit_high_noise.safetensors) | `loras` | 0.15 | Wan 2.2 native, trigger "orbit 360" (+ _low_noise file) |
  | [matrix_shot.safetensors](https://huggingface.co/Remade-AI/matrix-shot/resolve/main/matrix_shot.safetensors) | `loras` | 0.36 | bullet time, trigger "b4ll3t t1m3 bullet time shot" |

**3. LTX-2 / LTX-2.3 camera LoRAs + IC-LoRA "Cameraman" (copy camera move from a reference video)**

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=20 (LTXVScheduler) + refine; cfg=4; sampler=euler / gradient_estimation; scheduler=LTXVScheduler; resolution=768x512 -> x2; frames=97; fps=25
- Notes: Official Lightricks LoRAs: dolly in/out/left/right, jib up/down, static (no trigger; describe the destination of the move). Cameraman IC-LoRA reproduces any reference camera path = closest to a generic "copy this DoP move" feature.
- Custom nodes: https://github.com/Lightricks/ComfyUI-LTXVideo
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2-19b-lora-camera-control-dolly-in.safetensors](https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-In/resolve/main/ltx-2-19b-lora-camera-control-dolly-in.safetensors) | `loras` | 0.33 |  |
  | [LTX2.3-22B_IC-LoRA-Cameraman_v1_10500.safetensors](https://huggingface.co/Cseti/LTX2.3-22B_IC-LoRA-Cameraman_v1/resolve/main/LTX2.3-22B_IC-LoRA-Cameraman_v1_10500.safetensors) | `loras` | 0.33 |  |
  | [ltx-2-19b-dev-fp8.safetensors](https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-dev-fp8.safetensors) | `checkpoints` | 27.08 |  |

**4. Uni3C camera ControlNet / ReCamMaster (re-shoot a video from a new trajectory) via WanVideoWrapper**

- License: Apache-2.0 (commercial OK)
- Settings: sampler=wrapper; resolution=480p-720p; frames=81; fps=16
- Notes: Uni3C: render-guided arbitrary camera trajectories (orbit, crane) for Wan 2.1 14B. ReCamMaster (1.3B): change camera of an existing clip. Custom-node only.
- Custom nodes: https://github.com/kijai/ComfyUI-WanVideoWrapper
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [Wan21_Uni3C_controlnet_fp16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan21_Uni3C_controlnet_fp16.safetensors) | `controlnet` | 2.0 |  |
  | [Wan2_1_kwai_recammaster_1_3B_step20000_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_kwai_recammaster_1_3B_step20000_bf16.safetensors) | `diffusion_models` | 2.98 |  |

**5. Trajectory/drag control: Wan-Move, Wan ATI (draw motion paths)**

- License: Apache-2.0 (commercial OK)
- Settings: steps=6; cfg=1; sampler=er_sde; scheduler=simple; shift=8; resolution=480p; frames=81; fps=16; ati=20 steps, cfg 3, uni_pc, shift 8 (no LoRA)
- Notes: Native loaders; path editor via FL_PathAnimator (ComfyUI_Fill-Nodes) or KJNodes spline editor. Basis for "draw-to-video".
- Custom nodes: https://github.com/filliptm/ComfyUI_Fill-Nodes, https://github.com/kijai/ComfyUI-KJNodes
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [Wan21-WanMove_fp8_scaled_e4m3fn_KJ.safetensors](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/WanMove/Wan21-WanMove_fp8_scaled_e4m3fn_KJ.safetensors) | `diffusion_models` | 16.4 |  |
  | [Wan2_1-I2V-ATI-14B_fp8_e4m3fn.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1-I2V-ATI-14B_fp8_e4m3fn.safetensors) | `diffusion_models` | 17.14 |  |
  | [lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors) | `loras` | 0.74 |  |

**6. Prompt-only camera language (Wan 2.2 / LTX-2.5 / HunyuanVideo 1.5 / MiniMax H3)**

- License: n/a
- Settings: promptHints=Wan 2.2 responds to cinematography terms: "camera slowly dollies in", "orbiting shot around the subject", "crane shot rising", "handheld tracking shot", "whip pan to the right", "FPV drone shot diving", "low-angle", "rack focus". H3: describe camera per timed [Shot n].
- Notes: Zero-cost presets: keep a prompt-template table per the parity studio's preset; fall back to LoRAs where prompts fail (orbit 360, bullet time, crash zoom).

**7. MiniMax H3 camera LoRAs + embeddings (360 orbit, FPV head-bob, handheld, bullet_time, spiral_ascent)**

- License: MiniMax H3 Community License: territory EXCLUDES the United States, EU, UK and South Korea; Comfy docs state commercial use of locally generated outputs needs a MiniMax commercial license (resold by Comfy)
- Settings: steps=20; sampler=res_multistep; scheduler=simple; resolution=native 1344x768 (768 px short edge, multiples of 32); frames=124 default (~5 s); length snaps to 17k+5; fps=24; turbo=8 steps (T2V/I2V LoRA) or 4 steps (R2V LoRA); maxDuration=~15 s
- Notes: Highest quality camera moves but H3 license restrictions apply.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [minimax_h3_flf2v_lora_v1.safetensors](https://huggingface.co/pablodawson/MiniMax-H3-360-Orbit-LoRA/resolve/main/minimax_h3_flf2v_lora_v1.safetensors) | `loras` | 0.16 |  |
  | [camera_motion_h3_lora_v1_3000_pruned.safetensors](https://huggingface.co/Jojocodex/minimax-h3-Camera-Motion-lora/resolve/main/camera_motion_h3_lora_v1_3000_pruned.safetensors) | `loras` | 0.16 |  |
  | [minimaxh3_bullet_time.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_bullet_time.safetensors) | `embeddings` | 0.0 | use as embedding:minimaxh3_bullet_time in the prompt |

### `vfx` - VFX / effect presets (explode, melt, inflate, squish, cakeify, levitate, disintegrate ...)

*The parity studio's equivalent:* DoP VFX presets (274 entries in the companion inventory): Disintegration, Melting, Levitation, Set on Fire, Thunder God, Explosion / Head Explosion / Building Explosion, Turning Metal, Freezing, Balloon, Morphskin, Cyborg, Fire Breathe, Garden Bloom, transitions, outfit switch, emotions ...

The parity studio's effects are essentially per-effect motion LoRAs on an I2V model. The open catalogue: Remade-AI Wan 2.1 I2V LoRAs (squish, cakeify, inflate, deflate, crush, explode, electrify, super-saiyan, hulk, robot reveal ...), LTX-2 effect LoRAs (squish template, inflate, cakeify), Wan 2.2 disintegration/skin-morph LoRAs, Qwen-Edit INFL8/ACTION image LoRAs (first frame) + I2V, and MiniMax H3 style embeddings.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Wan 2.1 I2V 14B 480p + Remade-AI effect LoRAs (+ Lightx2v) | image_to_video_wan (+ LoraLoaderModelOnly) | core | Apache-2.0 | 24 GB (16 GB with fp8/GGUF) |
| 2 | LTX-2 I2V + effect LoRA (Squish template; Inflate/Cakeify by kabachuha) | video_ltx2_i2v_lora | core | LTX-2.x Community (<$10M rev.) | ~32 GB+ (template uses bf16 19B) |
| 3 | Qwen-Image-Edit-2511 effect LoRA on the still (INFL8, ACTION) -> I2V | image-qwen_image_edit_2511_lora_inflation / templates_ingi_infl8 / template_qwen_image_edit_2511_systms_action | core | Apache-2.0 | ~24 GB |
| 4 | Wan 2.2 I2V effect LoRAs (Disintegration, SkinMorph - artificialguybr, CC0) | video_wan2_2_14B_i2v | core | CC0-1.0 | 24 GB |
| 5 | MiniMax H3 style embeddings (art_is_explosion, fire_breath, dark_magic, storm_magic, four_seasons, blooming_flowers, truman_show) | video_minimax_h3_i2v | core | MiniMax H3 (no US/EU/UK/KR; commercial license) | ~32-48 GB |
| 6 | Wan 2.1 Alpha (RGBA video) for compositable VFX elements | video_wan2.1_alpha_t2v_14B | core | Apache-2.0 | 24 GB |

**1. Wan 2.1 I2V 14B 480p + Remade-AI effect LoRAs (+ Lightx2v)**

- License: Apache-2.0 (commercial OK)
- Settings: steps=6; cfg=1; sampler=uni_pc; scheduler=simple; shift=8; resolution=832x480 / 480x832; frames=81; fps=16; loraStrength=1.0 effect + 1.0 lightx2v; withoutLightx2v=20 steps, cfg 6, uni_pc, simple, shift 8 (template image_to_video_wan)
- Notes: Each Remade card gives a prompt template, e.g. "In the video, a miniature [object] is presented ... causing a sq41sh squish effect". The 6-step lightx2v recipe mirrors the native Wan-Move/InfiniteTalk templates; verify per LoRA.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.1_i2v_480p_14B_fp16.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_480p_14B_fp16.safetensors) | `diffusion_models` | 32.79 | or Kijai fp8_scaled I2V 480p |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |
  | [clip_vision_h.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors) | `clip_vision` | 1.26 |  |
  | [lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors) | `loras` | 0.74 |  |
  | [squish_18.safetensors](https://huggingface.co/Remade-AI/Squish/resolve/main/squish_18.safetensors) | `loras` | 0.36 | trigger "sq41sh squish effect" |

**2. LTX-2 I2V + effect LoRA (Squish template; Inflate/Cakeify by kabachuha)**

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=20 + refine; cfg=4; sampler=euler; scheduler=LTXVScheduler; resolution=768x512 -> x2; frames=97; fps=25
- Notes: Effects come with synchronized sound. LTX-2.3 templates: googly eyes (trigger "googlyeyes"), style transition ("zhuanchang").
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx2-squish.safetensors](https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/loras/ltx2-squish.safetensors) | `loras` | 0.43 | trigger "squish it" |
  | [ltx2-inflate.safetensors](https://huggingface.co/kabachuha/ltx2-inflate-it/resolve/main/ltx2-inflate.safetensors) | `loras` | 1.11 | trigger "infl4t3 it" |
  | [ltx2-cakeify-v2.safetensors](https://huggingface.co/kabachuha/ltx2-cakeify/resolve/main/ltx2-cakeify-v2.safetensors) | `loras` | 0.83 | trigger "c4k3 cakeify it" |
  | [ltx-2-19b-dev.safetensors](https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-dev.safetensors) | `checkpoints` | 43.29 |  |
  | [ltx-2-19b-distilled-lora-384.safetensors](https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-distilled-lora-384.safetensors) | `loras` | 7.67 |  |

**3. Qwen-Image-Edit-2511 effect LoRA on the still (INFL8, ACTION) -> I2V**

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=3.1; resolution=~1 MP
- Notes: Generate the end state as an image, then Wan 2.2 FLF2V (start = original, end = effect) for controllable effects with any I2V model.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [SYSTMS_INFL8_LoRA_Qwen_Image_Edit_2511.safetensors](https://huggingface.co/systms/SYSTMS-INFL8-LoRA-Qwen-Image-Edit-2511/resolve/main/SYSTMS_INFL8_LoRA_Qwen_Image_Edit_2511.safetensors) | `loras` | 0.3 | prompt "Inflate the [subject]" |
  | [QWEN_EDIT_ACTION_V1.safetensors](https://huggingface.co/systms/SYSTMS-ACTION-LoRA-Qwen-Image-Edit-2511/resolve/main/QWEN_EDIT_ACTION_V1.safetensors) | `loras` | 0.3 |  |

**4. Wan 2.2 I2V effect LoRAs (Disintegration, SkinMorph - artificialguybr, CC0)**

- License: CC0-1.0
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=5; split=KSamplerAdvanced high-noise steps 0-2 (add noise, return leftover noise) -> low-noise steps 2-4; withoutLora=20 steps, cfg 3.5, shift 8, switch experts at step 10 (recipe of the Wan 2.2 Fun templates; FLF2V template uses cfg 4); resolution=480p-720p; frames=81; fps=16
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [\[Wan2.2\]Disintegration_Redmond_high_noise.safetensors](https://huggingface.co/artificialguybr/Disintegration-Redmond-WAN2-I2V-14B/resolve/main/%5BWan2.2%5DDisintegration_Redmond_high_noise.safetensors) | `loras` | 0.08 | trigger "Disintegration"; pair with _low_noise file |

**5. MiniMax H3 style embeddings (art_is_explosion, fire_breath, dark_magic, storm_magic, four_seasons, blooming_flowers, truman_show)**

- License: MiniMax H3 Community License: territory EXCLUDES the United States, EU, UK and South Korea; Comfy docs state commercial use of locally generated outputs needs a MiniMax commercial license (resold by Comfy)
- Settings: steps=20; sampler=res_multistep; scheduler=simple; resolution=native 1344x768 (768 px short edge, multiples of 32); frames=124 default (~5 s); length snaps to 17k+5; fps=24; turbo=8 steps (T2V/I2V LoRA) or 4 steps (R2V LoRA); maxDuration=~15 s
- Notes: Unofficial community embeddings (silveroxides); reference with embedding:<name>.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [minimaxh3_art_is_explosion.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_art_is_explosion.safetensors) | `embeddings` | 0.0 |  |
  | [minimaxh3_fire_breath.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_fire_breath.safetensors) | `embeddings` | 0.0 |  |

**6. Wan 2.1 Alpha (RGBA video) for compositable VFX elements**

- License: Apache-2.0 (commercial OK)
- Settings: steps=20; cfg=6; sampler=uni_pc; scheduler=simple; shift=5; resolution=832x480; frames=33 template; fps=16; turbo=lightx2v T2V v2 LoRA wired in template (fewer steps, cfg 1)
- Notes: Generate fire/smoke/particles with transparency to overlay on footage.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan_alpha_2.1_rgba_lora.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/loras/wan_alpha_2.1_rgba_lora.safetensors) | `loras` | 0.31 |  |
  | [wan_alpha_2.1_vae_rgb_channel.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_alpha_2.1_vae_rgb_channel.safetensors) | `vae` | 0.25 |  |
  | [wan_alpha_2.1_vae_alpha_channel.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_alpha_2.1_vae_alpha_channel.safetensors) | `vae` | 0.25 |  |

### `lipsync` - Lipsync / talking avatar / UGC

*The parity studio's equivalent:* Lipsync Studio, Talking Avatar, UGC Factory/Builder, Speak

Native options now cover the whole space: InfiniteTalk (WanInfiniteTalkToVideo, unlimited length, multi-speaker), Wan 2.2 S2V, HuMo, LTX-2.3 image+audio-to-video and ID-LoRA, LTX-2.3 DubIt IC-LoRA for re-dubbing existing video, and MiniMax H3 which generates speech + lips jointly. LatentSync 1.6 remains the best mouth-only re-sync for real footage.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | InfiniteTalk (Wan 2.1 I2V 14B + InfiniteTalk patch) - native | video_wan2_1_infinitetalk / templates-wan2_1_infinitetalk_music | core | Apache-2.0 | 24 GB |
| 2 | LTX-2.3 Image+Audio-to-Video (IA2V) / ID-LoRA (face + voice) | video_ltx2_3_ia2v / video_ltx2_3_id_lora | core | LTX-2.x Community (<$10M rev.) | ~24-32 GB |
| 3 | Wan 2.2 S2V 14B (audio-driven, minute-level via extend) | video_wan2_2_14B_s2v | core | Apache-2.0 | 24 GB |
| 4 | HuMo 17B (text + image + audio human video) | video_humo | core | Apache-2.0 | 24 GB |
| 5 | LTX-2.3 DubIt IC-LoRA (re-dub existing video to new audio) | - | custom: [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) | LTX-2.x Community (<$10M rev.) | ~32 GB |
| 6 | LatentSync 1.6 (mouth-region re-sync of real footage) | - | custom: [ComfyUI-LatentSyncWrapper](https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper), [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | OpenRAIL++-M | ~20 GB (RTX 3090 class) |
| 7 | MiniMax H3 joint speech + lipsync (dialogue in <d> tags) / LongCat-Avatar 1.5, MultiTalk, FantasyTalking (WanVideoWrapper) / HunyuanVideo-Avatar, EchoMimic, Sonic (custom) | video_minimax_h3_t2v | custom: [ComfyUI-WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper), [ComfyUI-HunyuanVideo-Avatar](https://github.com/Yuan-ManX/ComfyUI-HunyuanVideo-Avatar), [ComfyUI_HunyuanAvatar_Sm](https://github.com/smthemex/ComfyUI_HunyuanAvatar_Sm), [ComfyUI_EchoMimic](https://github.com/smthemex/ComfyUI_EchoMimic), [ComfyUI_Sonic](https://github.com/smthemex/ComfyUI_Sonic), [ComfyUI-LivePortraitKJ](https://github.com/kijai/ComfyUI-LivePortraitKJ) | mixed (MIT/Apache/Tencent) | 24-48 GB |

**1. InfiniteTalk (Wan 2.1 I2V 14B + InfiniteTalk patch) - native** ([docs](https://docs.comfy.org/tutorials/video/wan/wan-infinitetalk))

- License: Apache-2.0 (commercial OK)
- Settings: steps=6; cfg=1; sampler=euler; scheduler=normal; resolution=480p (e.g. 832x480 / 480x832); frames=81 per segment (~3.24 s), chain Video Extend groups; fps=25
- Notes: Full-body talking/singing from one image + audio (core WanInfiniteTalkToVideo, ModelPatchLoader). The music variant template (templates-wan2_1_infinitetalk_music) is NOT core: it uses WanVideoWrapper MultiTalk nodes + an audio-separation custom node to isolate vocals.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/I2V/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors) | `diffusion_models` | 16.64 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan2.1_infiniteTalk_single_fp16.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/model_patches/wan2.1_infiniteTalk_single_fp16.safetensors) | `model_patches` | 5.13 | multi-speaker: wan2.1_infiniteTalk_multi_fp16.safetensors (+ per-speaker masks) |
  | [wav2vec2-chinese-base_fp16.safetensors](https://huggingface.co/Kijai/wav2vec2_safetensors/resolve/main/wav2vec2-chinese-base_fp16.safetensors) | `audio_encoders` | 0.19 |  |
  | [Wan2_1_VAE_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_bf16.safetensors) | `vae` | 0.25 |  |
  | [lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors) | `loras` | 0.74 |  |

**2. LTX-2.3 Image+Audio-to-Video (IA2V) / ID-LoRA (face + voice)** ([docs](https://docs.comfy.org/tutorials/video/ltx/ltx-2-3))

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=8 + 3; cfg=1; sampler=euler; scheduler=ManualSigmas (same schedule as LTX-2.5); resolution=768x512 -> x2; frames=97; fps=24
- Notes: Lip-synced video from image + audio with full scene; ID-LoRA also clones the voice for new speech.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.3-22b-dev-fp8.safetensors](https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/main/ltx-2.3-22b-dev-fp8.safetensors) | `checkpoints` | 29.15 |  |
  | [ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors](https://huggingface.co/Comfy-Org/ltx-2.3/resolve/main/split_files/loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors) | `loras` | 2.74 | distill LoRA at 0.5 in templates |
  | [gemma_3_12B_it_fp4_mixed.safetensors](https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors) | `text_encoders` | 9.45 |  |
  | [ltx-2.3-spatial-upscaler-x2-1.1.safetensors](https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-spatial-upscaler-x2-1.1.safetensors) | `latent_upscale_models` | 1.0 |  |

**3. Wan 2.2 S2V 14B (audio-driven, minute-level via extend)** ([docs](https://docs.comfy.org/tutorials/video/wan/wan2-2-s2v))

- License: Apache-2.0 (commercial OK)
- Settings: steps=10; cfg=6; sampler=uni_pc; scheduler=simple; shift=8; resolution=640x640 template; frames=77 per chunk (WanSoundImageToVideoExtend); fps=16
- Notes: Settings as shipped in the template (lightning LoRA path uses fewer steps/cfg 1).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_s2v_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_s2v_14B_fp8_scaled.safetensors) | `diffusion_models` | 16.39 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |
  | [wav2vec2_large_english_fp16.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/audio_encoders/wav2vec2_large_english_fp16.safetensors) | `audio_encoders` | 0.63 |  |
  | [wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors) | `loras` | 1.23 |  |

**4. HuMo 17B (text + image + audio human video)**

- License: Apache-2.0 (commercial OK)
- Settings: steps=6; cfg=1; sampler=uni_pc; scheduler=simple; shift=8; resolution=480p-720p; fps=25
- Notes: Native WanHuMoImageToVideo.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [humo_17B_fp8_e4m3fn.safetensors](https://huggingface.co/Comfy-Org/HuMo_ComfyUI/resolve/main/split_files/diffusion_models/humo_17B_fp8_e4m3fn.safetensors) | `diffusion_models` | 17.06 |  |
  | [whisper_large_v3_fp16.safetensors](https://huggingface.co/Comfy-Org/HuMo_ComfyUI/resolve/main/split_files/audio_encoders/whisper_large_v3_fp16.safetensors) | `audio_encoders` | 3.09 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |
  | [lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors) | `loras` | 0.74 |  |

**5. LTX-2.3 DubIt IC-LoRA (re-dub existing video to new audio)**

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=8 + 3; cfg=1; sampler=euler; scheduler=ManualSigmas (same schedule as LTX-2.5); resolution=768x512 -> x2; frames=97; fps=24
- Notes: Gated; use the dub-it workflow from ComfyUI-LTXVideo. Closest OSS equivalent to the parity studio "lipsync existing video".
- Custom nodes: https://github.com/Lightricks/ComfyUI-LTXVideo
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.3-22b-ic-lora-dubit-0.9.safetensors](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-DubIt/resolve/main/ltx-2.3-22b-ic-lora-dubit-0.9.safetensors) | `loras` | 2.47 | **gated (accept license + HF token)**  |

**6. LatentSync 1.6 (mouth-region re-sync of real footage)**

- License: CreativeML OpenRAIL++-M
- Settings: steps=20; lipsExpression=1.5; sampler=internal; resolution=512x512 face region (model trained at 512); fps=25
- Notes: Preserves the original video and only re-renders the mouth; needs a frontal, visible face. Node defaults: inference_steps 20, lips_expression 1.5.
- Custom nodes: https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper, https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [latentsync_unet.pt](https://huggingface.co/ByteDance/LatentSync-1.6/resolve/main/latentsync_unet.pt) | `custom (auto-download)` | 5.07 |  |
  | [tiny.pt](https://huggingface.co/ByteDance/LatentSync-1.6/resolve/main/whisper/tiny.pt) | `custom (auto-download)` | 0.08 |  |

**7. MiniMax H3 joint speech + lipsync (dialogue in <d> tags) / LongCat-Avatar 1.5, MultiTalk, FantasyTalking (WanVideoWrapper) / HunyuanVideo-Avatar, EchoMimic, Sonic (custom)**

- License: mixed (MIT/Apache/Tencent)
- Settings: sampler=per wrapper
- Notes: Secondary options. OmniAvatar has only a low-maintenance community node (CallMe1101/ComfyUI_OmniAvatar); EchoMimicV3 support in smthemex pack unverified. LivePortrait template (templates_liveportrait.app) for expression retargeting.
- Custom nodes: https://github.com/kijai/ComfyUI-WanVideoWrapper, https://github.com/Yuan-ManX/ComfyUI-HunyuanVideo-Avatar, https://github.com/smthemex/ComfyUI_HunyuanAvatar_Sm, https://github.com/smthemex/ComfyUI_EchoMimic, https://github.com/smthemex/ComfyUI_Sonic, https://github.com/kijai/ComfyUI-LivePortraitKJ
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [LongCat-Avatar-single_fp8_e4m3fn_scaled_mixed_KJ.safetensors](https://huggingface.co/Kijai/LongCat-Video_comfy/resolve/main/Avatar/LongCat-Avatar-single_fp8_e4m3fn_scaled_mixed_KJ.safetensors) | `diffusion_models` | 16.9 |  |
  | [WanVideo_2_1_Multitalk_14B_fp8_e4m3fn.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/WanVideo_2_1_Multitalk_14B_fp8_e4m3fn.safetensors) | `diffusion_models` | 2.71 |  |
  | [fantasytalking_fp16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/fantasytalking_fp16.safetensors) | `diffusion_models` | 1.68 |  |

### `tts` - Text-to-speech / voice cloning (for lipsync & UGC)

*The parity studio's equivalent:* the parity studio's voice / UGC voiceover (backed by ElevenLabs-style TTS)

ComfyUI core has no TTS node in 2026 (official TTS templates are API partner nodes, except the Chatter Box templates which use the filliptm custom pack). Best OSS stack: Chatterbox / Chatterbox Multilingual (MIT, official community templates), Qwen3-TTS (Apache, Jan 2026, clone + voice design), IndexTTS-2 (emotion + duration control), VibeVoice (long multi-speaker), Kokoro (tiny, fast, preset voices). Output AUDIO feeds InfiniteTalk / S2V / LTX IA2V directly.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Chatterbox / Chatterbox Multilingual (23 languages, zero-shot clone, dialog) | audio-chatterbox_tts / audio-chatterbox_tts_multilingual / audio-chatterbox_tts_dialog / audio-chatterbox_vc | custom: [ComfyUI_Fill-ChatterBox](https://github.com/filliptm/ComfyUI_Fill-ChatterBox) | MIT | ~4-6 GB |
| 2 | Qwen3-TTS 1.7B (12 Hz) - clone, custom voice, voice design | - | custom: [ComfyUI-QwenTTS](https://github.com/1038lab/ComfyUI-QwenTTS), [ComfyUI-Qwen-TTS](https://github.com/flybirdxx/ComfyUI-Qwen-TTS), [ComfyUI-Qwen3-TTS](https://github.com/DarioFT/ComfyUI-Qwen3-TTS) | Apache-2.0 | ~6-8 GB |
| 3 | IndexTTS-2 (emotion control, precise duration for dubbing) | - | custom: [ComfyUI-IndexTTS2](https://github.com/snicolast/ComfyUI-IndexTTS2), [TTS-Audio-Suite](https://github.com/diodiogod/TTS-Audio-Suite) | bilibili Model Use License (check commercial terms) | ~8 GB |
| 4 | VibeVoice 1.5B (up to 90 min, up to 4 speakers, podcast style) | - | custom: [ComfyUI-VibeVoice](https://github.com/wildminder/ComfyUI-VibeVoice), [VibeVoice-ComfyUI](https://github.com/Enemyx-net/VibeVoice-ComfyUI) | MIT | ~8-12 GB |
| 5 | Kokoro-82M (fast, preset voices, no cloning) | - | custom: [comfyui-kokoro](https://github.com/stavsap/comfyui-kokoro), [TTS-Audio-Suite](https://github.com/diodiogod/TTS-Audio-Suite) | Apache-2.0 | <2 GB / CPU OK |
| 6 | F5-TTS (flow-matching clone) | - | custom: [ComfyUI-F5-TTS](https://github.com/niknah/ComfyUI-F5-TTS), [TTS-Audio-Suite](https://github.com/diodiogod/TTS-Audio-Suite) | CC-BY-NC-4.0 | ~4 GB |

**1. Chatterbox / Chatterbox Multilingual (23 languages, zero-shot clone, dialog)**

- License: MIT
- Settings: params=exaggeration ~0.5, cfg_weight ~0.5, temperature ~0.8 (node defaults)
- Notes: Nodes FL_ChatterboxTTS / FL_ChatterboxMultilingualTTS / FL_ChatterboxDialogTTS / voice conversion. Built-in Perth watermark.
- Custom nodes: https://github.com/filliptm/ComfyUI_Fill-ChatterBox
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [t3_cfg.safetensors](https://huggingface.co/ResembleAI/chatterbox/resolve/main/t3_cfg.safetensors) | `custom (auto-download)` | 2.13 |  |
  | [s3gen.safetensors](https://huggingface.co/ResembleAI/chatterbox/resolve/main/s3gen.safetensors) | `custom (auto-download)` | 1.06 |  |
  | [t3_mtl23ls_v2.safetensors](https://huggingface.co/ResembleAI/chatterbox/resolve/main/t3_mtl23ls_v2.safetensors) | `custom (auto-download)` | 2.14 | multilingual |

**2. Qwen3-TTS 1.7B (12 Hz) - clone, custom voice, voice design**

- License: Apache-2.0
- Settings: -
- Notes: Apache-2.0, very popular (3M+ downloads); clone from short reference + transcript. Some packs pin transformers versions - isolate in a separate venv/worker if conflicts arise.
- Custom nodes: https://github.com/1038lab/ComfyUI-QwenTTS, https://github.com/flybirdxx/ComfyUI-Qwen-TTS, https://github.com/DarioFT/ComfyUI-Qwen3-TTS
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [model.safetensors](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base/resolve/main/model.safetensors) | `custom (auto-download)` | 3.86 |  |
  | [model.safetensors](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base/resolve/main/speech_tokenizer/model.safetensors) | `custom (auto-download)` | 0.68 |  |

**3. IndexTTS-2 (emotion control, precise duration for dubbing)**

- License: bilibili Model Use License (check commercial terms)
- Settings: -
- Notes: Best for lip-dub timing (target duration) and emotional delivery.
- Custom nodes: https://github.com/snicolast/ComfyUI-IndexTTS2, https://github.com/diodiogod/TTS-Audio-Suite
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [gpt.pth](https://huggingface.co/IndexTeam/IndexTTS-2/resolve/main/gpt.pth) | `custom (auto-download)` | 3.48 |  |
  | [s2mel.pth](https://huggingface.co/IndexTeam/IndexTTS-2/resolve/main/s2mel.pth) | `custom (auto-download)` | 1.2 |  |

**4. VibeVoice 1.5B (up to 90 min, up to 4 speakers, podcast style)**

- License: MIT
- Settings: -
- Notes: Long UGC/podcast voiceovers with multiple speakers.
- Custom nodes: https://github.com/wildminder/ComfyUI-VibeVoice, https://github.com/Enemyx-net/VibeVoice-ComfyUI
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [model-00001-of-00003.safetensors](https://huggingface.co/microsoft/VibeVoice-1.5B/resolve/main/model-00001-of-00003.safetensors) | `custom (auto-download)` | 1.98 | 3 shards ~5.4 GB total |

**5. Kokoro-82M (fast, preset voices, no cloning)**

- License: Apache-2.0
- Settings: -
- Notes: Cheap default narrator voices.
- Custom nodes: https://github.com/stavsap/comfyui-kokoro, https://github.com/diodiogod/TTS-Audio-Suite
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [kokoro-v1_0.pth](https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1_0.pth) | `custom (auto-download)` | 0.33 |  |

**6. F5-TTS (flow-matching clone)**

- License: CC-BY-NC-4.0 (NON-COMMERCIAL)
- Settings: -
- Notes: Weights are CC-BY-NC.
- Custom nodes: https://github.com/niknah/ComfyUI-F5-TTS, https://github.com/diodiogod/TTS-Audio-Suite

### `motion-transfer` - Motion transfer / character swap in video

*The parity studio's equivalent:* Motion Control / Recast / Character Swap / "Genjutsu" (now a ComfyUI partner node)

Wan Animate 2 (2026-08-07, Apache) removes pose extraction and loops natively over long driving videos; SCAIL-2 (MIT) does replacement or animation with SAM3 tracking - both core-native. Wan 2.2 Animate (2025) needs preprocessing custom nodes. The parity studio itself ships "Genjutsu Motion Transfer" as a paid ComfyUI partner node (not OSS).

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Wan Animate 2 (14B) - native, no pose extraction | video_wan_animate2 / video_wan_animate2_distilled | core | Apache-2.0 | 24 GB (int8 DiT 16.7 GB) |
| 2 | SCAIL-2 (Wan 2.1 14B) character replacement / animation - native | video_wan21_scail2_character_replacement (int8 variant available) | core | MIT | 24 GB |
| 3 | Wan 2.2 Animate 14B (animate + replace mode) | video_wan2_2_14B_animate / template_purz_wan22_animate_auto_character_replace | custom: [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes), [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux), [ComfyUI-segment-anything-2](https://github.com/kijai/ComfyUI-segment-anything-2), [ComfyUI-WanAnimatePreprocess](https://github.com/kijai/ComfyUI-WanAnimatePreprocess) | Apache-2.0 | 24 GB |
| 4 | Wan VACE / Wan 2.2 Fun Control pose-depth-canny control (v2v) | video_wan_vace_14B_v2v / video_wan2_2_14B_fun_control | core + [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux) | Apache-2.0 | 24 GB (4090D 83-89%) |
| 5 | LTX-2 pose-to-video / LTX-2.3 IC-LoRA Union Control / MiniMax H3 Fun ControlNet Union | video_ltx2_pose_to_video / video_ltx2_3_ic_lora / video_minimax_h3_fun_controlnet_union | core + [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux) | LTX-2.x Community (<$10M rev.) | 24-48 GB |
| 6 | Wan Dancer (music-to-dance) / UniAnimate / MimicMotion / SteadyDancer / One-to-All (legacy or wrapper) | video_wan_dancer | custom: [ComfyUI-WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper), [ComfyUI-UniAnimate-W](https://github.com/Isi-dev/ComfyUI-UniAnimate-W), [ComfyUI-MimicMotionWrapper](https://github.com/kijai/ComfyUI-MimicMotionWrapper) | Apache-2.0 | 24 GB |

**1. Wan Animate 2 (14B) - native, no pose extraction** ([docs](https://docs.comfy.org/tutorials/video/wan/wan-animate-2))

- License: Apache-2.0 (commercial OK)
- Settings: steps=6; cfg=1; sampler=lcm; scheduler=simple; shift=5; resolution=follows driving video (multiples of 16); frames=81 per loop iteration (4n+1), loops to cover the whole driving video; fps=driving video fps (template output 30); distilled=10 steps, no LoRA
- Notes: Prompt text_1 = character + background looks, text_2 = motion. Background and camera follow the prompt (decoupled from the driving video). Requires ComfyUI >= 0.36.0 (core loop nodes).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan_animate_2_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/diffusion_models/wan_animate_2_int8_convrot.safetensors) | `diffusion_models` | 16.65 | distilled: wan_animate_2_distill_int8_convrot.safetensors (10 steps, no LoRA) |
  | [lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors](https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors) | `loras` | 0.74 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [clip_vision_h.safetensors](https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/clip_vision/clip_vision_h.safetensors) | `clip_vision` | 1.26 |  |
  | [Wan2_1_VAE_bf16.safetensors](https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/vae/Wan2_1_VAE_bf16.safetensors) | `vae` | 0.25 |  |

**2. SCAIL-2 (Wan 2.1 14B) character replacement / animation - native** ([docs](https://docs.comfy.org/tutorials/video/zai/scail2))

- License: MIT
- Settings: steps=6; cfg=1; sampler=euler; scheduler=simple; shift=5; resolution=e.g. 896x512 (divisible by 16); frames=81 per segment; next segments offset 76 frames; fps=template 30; loraStrength=lightx2v 0.8, DPO 1.0
- Notes: replace_mode=true swaps the tracked person; false animates the reference. Segments are run manually (Base + Extend subgraphs).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.1_14B_SCAIL_2_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/SCAIL-2/resolve/main/diffusion_models/wan2.1_14B_SCAIL_2_int8_convrot.safetensors) | `diffusion_models` | 16.65 |  |
  | [wan2.1_SCAIL_2_DPO_lora_bf16.safetensors](https://huggingface.co/Comfy-Org/SCAIL-2/resolve/main/loras/wan2.1_SCAIL_2_DPO_lora_bf16.safetensors) | `loras` | 1.23 |  |
  | [lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors) | `loras` | 0.74 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [clip_vision_h.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors) | `clip_vision` | 1.26 |  |
  | [Wan2_1_VAE_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_bf16.safetensors) | `vae` | 0.25 |  |
  | [sam3.1_multiplex_fp16.safetensors](https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors) | `checkpoints` | 1.75 |  |

**3. Wan 2.2 Animate 14B (animate + replace mode)** ([docs](https://docs.comfy.org/tutorials/video/wan/wan2-2-animate))

- License: Apache-2.0 (commercial OK)
- Settings: steps=6; cfg=1; sampler=euler; scheduler=simple; shift=8; resolution=640x640 template (multiples of 16); frames=77; fps=16
- Notes: Core WanAnimateToVideo node, but pose/face/mask preprocessing uses DWPose (controlnet_aux), SAM2 points and KJNodes (or kijai/ComfyUI-WanAnimatePreprocess).
- Custom nodes: https://github.com/kijai/ComfyUI-KJNodes, https://github.com/Fannovel16/comfyui_controlnet_aux, https://github.com/kijai/ComfyUI-segment-anything-2, https://github.com/kijai/ComfyUI-WanAnimatePreprocess
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ.safetensors](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/Wan22Animate/Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ.safetensors) | `diffusion_models` | 18.4 | or Comfy-Org wan2.2_animate_14B_int8_convrot.safetensors |
  | [WanAnimate_relight_lora_fp16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/LoRAs/Wan22_relight/WanAnimate_relight_lora_fp16.safetensors) | `loras` | 1.44 |  |
  | [lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors) | `loras` | 0.74 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |
  | [clip_vision_h.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors) | `clip_vision` | 1.26 |  |

**4. Wan VACE / Wan 2.2 Fun Control pose-depth-canny control (v2v)** ([docs](https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-control))

- License: Apache-2.0 (commercial OK)
- Settings: steps=4; cfg=1; sampler=euler; scheduler=simple; shift=8; resolution=640x640; frames=81; fps=16; withoutLora=20 steps, cfg 3.5
- Notes: Control maps from native preprocessor templates (DWPose/SDPose, Depth Anything 3, lineart) or controlnet_aux.
- Custom nodes: https://github.com/Fannovel16/comfyui_controlnet_aux
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_fun_control_high_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_control_high_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 14.3 |  |
  | [wan2.2_fun_control_low_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_control_low_noise_14B_fp8_scaled.safetensors) | `diffusion_models` | 14.3 |  |
  | [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `text_encoders` | 6.74 |  |
  | [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae` | 0.25 |  |

**5. LTX-2 pose-to-video / LTX-2.3 IC-LoRA Union Control / MiniMax H3 Fun ControlNet Union**

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: steps=8 + 3; cfg=1; sampler=euler; scheduler=ManualSigmas (same schedule as LTX-2.5); resolution=768x512 -> x2; frames=97; fps=24
- Notes: Audio-capable control alternatives.
- Custom nodes: https://github.com/Fannovel16/comfyui_controlnet_aux
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control/resolve/main/ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors) | `loras` | 0.65 |  |

**6. Wan Dancer (music-to-dance) / UniAnimate / MimicMotion / SteadyDancer / One-to-All (legacy or wrapper)**

- License: Apache-2.0 (commercial OK)
- Settings: sampler=per template
- Notes: Wan Dancer is native (Apache). Others are superseded by Wan Animate 2 / SCAIL-2.
- Custom nodes: https://github.com/kijai/ComfyUI-WanVideoWrapper, https://github.com/Isi-dev/ComfyUI-UniAnimate-W, https://github.com/kijai/ComfyUI-MimicMotionWrapper
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [wan2.2_dancer_14b_global_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan-Dancer/resolve/main/diffusion_models/wan2.2_dancer_14b_global_fp8_scaled.safetensors) | `diffusion_models` | 18.34 |  |
  | [UniAnimate-Wan2.1-14B-Lora-12000-fp16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/UniAnimate-Wan2.1-14B-Lora-12000-fp16.safetensors) | `loras` | 1.23 |  |

### `upscale-image` - Image upscale / restoration

*The parity studio's equivalent:* Upscale (image)

SeedVR2 is now CORE in ComfyUI (SeedVR2Preprocess/Conditioning/PostProcessing nodes, one-step). GAN upscalers via core UpscaleModelLoader + ImageUpscaleWithModel. SUPIR also has a core template.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | SeedVR2 7B (int8) one-step diffusion upscaler - native | utility_seedvr2_7b_int8_upscale_image / utility_seedvr2_3b_int8_upscale_image | core | Apache-2.0 | 12-24 GB depending on target size |
| 2 | Real-ESRGAN x4plus / 4x-UltraSharp (core UpscaleModelLoader) | utility-gan_upscaler (video) / utility_interpolation_image_upscale | core | BSD-3-Clause (RealESRGAN) | <4 GB |
| 3 | Generative "creative" upscale: Z-Image-Turbo 2K tiled refine / Ultimate SD Upscale | utility_z_image_turbo_2k_upscaler.app | core + [ComfyUI_UltimateSDUpscale](https://github.com/ssitu/ComfyUI_UltimateSDUpscale) | Apache-2.0 | ~16 GB |
| 4 | SUPIR (SDXL-based restoration) - core template | utility_image_upscale_supir | core | SUPIR: non-commercial | ~12-16 GB |

**1. SeedVR2 7B (int8) one-step diffusion upscaler - native** ([docs](https://docs.comfy.org/tutorials/utility/seedvr2))

- License: Apache-2.0
- Settings: steps=1; cfg=1; sampler=euler; scheduler=simple; resolution=target short side e.g. 2048-4096 (ResizeImageMaskNode); tiled VAE encode/decode
- Notes: Conservative, faithful restoration (no hallucinated new details). Disable FlashAttention if outputs turn black (docs).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [seedvr2_7b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/diffusion_models/seedvr2_7b_int8_convrot.safetensors) | `diffusion_models` | 8.33 | 3B int8 3.5 GB; 7B "sharp" variant; fp8/nvfp4/mxfp8 also available |
  | [seedvr2_ema_vae_fp16.safetensors](https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/vae/seedvr2_ema_vae_fp16.safetensors) | `vae` | 0.5 |  |

**2. Real-ESRGAN x4plus / 4x-UltraSharp (core UpscaleModelLoader)**

- License: BSD-3-Clause (RealESRGAN)
- Settings: resolution=x4 (then ImageScaleBy to target)
- Notes: Instant; RealESRGAN is BSD-3 (commercial OK).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [RealESRGAN_x4plus.safetensors](https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged/resolve/main/RealESRGAN_x4plus.safetensors) | `upscale_models` | 0.07 |  |
  | [4x-UltraSharp.safetensors](https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.safetensors) | `upscale_models` | 0.07 | CC-BY-NC-SA (non-commercial) |

**3. Generative "creative" upscale: Z-Image-Turbo 2K tiled refine / Ultimate SD Upscale**

- License: Apache-2.0
- Settings: steps=8; cfg=1; sampler=res_multistep; scheduler=simple; shift=3; resolution=2K+ (tiles 1024); denoise=0.2-0.4
- Notes: Adds skin/texture detail (the parity studio "enhance"). USDU custom node tiles any model.
- Custom nodes: https://github.com/ssitu/ComfyUI_UltimateSDUpscale
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [z_image_turbo_bf16.safetensors](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors) | `diffusion_models` | 12.31 |  |
  | [RealESRGAN_x4plus.safetensors](https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged/resolve/main/RealESRGAN_x4plus.safetensors) | `upscale_models` | 0.07 |  |

**4. SUPIR (SDXL-based restoration) - core template**

- License: SUPIR: non-commercial
- Settings: resolution=up to 4K
- Notes: Strong for degraded photos. SUPIR weights carry a non-commercial license.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [SUPIR-v0Q_fp16.safetensors](https://huggingface.co/Kijai/SUPIR_pruned/resolve/main/SUPIR-v0Q_fp16.safetensors) | `model_patches` | 2.66 |  |
  | [juggernautXL_v9Rdphoto2Lightning.safetensors](https://huggingface.co/AiWise/Juggernaut-XL-V9-GE-RDPhoto2-Lightning_4S/resolve/main/juggernautXL_v9Rdphoto2Lightning.safetensors) | `checkpoints` | 7.11 |  |
  | [qwen3.5_4b_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen3.5/resolve/main/text_encoders/qwen3.5_4b_bf16.safetensors) | `text_encoders` | 9.32 | captioning LLM in the template |

### `upscale-video` - Video upscale / restoration

*The parity studio's equivalent:* Upscale (video), 4K export

SeedVR2 3B/7B (native, temporal chunking) is the quality leader; FlashVSR is the fast 4x option; model-native latent upscalers (LTX x2, HunyuanVideo 1.5 SR) are cheapest when generating.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | SeedVR2 3B/7B video upscale - native (temporal chunks) | utility_seedvr2_3b_int8_upscale_video | core | Apache-2.0 | 12-24 GB (docs benchmark: 1080p on RTX 5090 ~312 s) |
| 2 | numz ComfyUI-SeedVR2_VideoUpscaler (custom; block swap, BlockSwap/tiled VAE for low VRAM) | utility_seedvr2_video_upscale | custom: [ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | Apache-2.0 | 8-24 GB |
| 3 | FlashVSR (Wan 2.1 1.3B based, streaming 4x) | - | custom: [ComfyUI_FlashVSR](https://github.com/smthemex/ComfyUI_FlashVSR), [ComfyUI-WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) | Apache-2.0 | ~12-16 GB |
| 4 | Wan 2.2 "creative" video upscale (WanVideoWrapper) / Real-ESRGAN per frame | utility_video_upscale / utility-gan_upscaler | custom: [ComfyUI-WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) | mixed | 4-24 GB |
| 5 | Model-native upscalers: LTX-2.5 latent spatial x2 / temporal x2, HunyuanVideo 1.5 1080p SR | video_ltx2_5_t2v / video_hunyuan_video_1.5_720p_t2v | core | LTX-2.x Community (<$10M rev.) | included in generation |

**1. SeedVR2 3B/7B video upscale - native (temporal chunks)** ([docs](https://docs.comfy.org/tutorials/utility/seedvr2))

- License: Apache-2.0
- Settings: steps=1; cfg=1; sampler=euler; scheduler=simple; resolution=720p/1080p/2K targets; chunking=SeedVR2TemporalChunk -> merge
- Notes: Older template utility_seedvr2_video_upscale uses the numz custom node (SeedVR2VideoUpscaler with block-swap/tiling options).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [seedvr2_3b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/diffusion_models/seedvr2_3b_int8_convrot.safetensors) | `diffusion_models` | 3.46 |  |
  | [seedvr2_ema_vae_fp16.safetensors](https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/vae/seedvr2_ema_vae_fp16.safetensors) | `vae` | 0.5 |  |

**2. numz ComfyUI-SeedVR2_VideoUpscaler (custom; block swap, BlockSwap/tiled VAE for low VRAM)**

- License: Apache-2.0
- Settings: resolution=target resolution input
- Notes: Use when the native node is too memory hungry.
- Custom nodes: https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [seedvr2_ema_7b_fp8_e4m3fn.safetensors](https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/seedvr2_ema_7b_fp8_e4m3fn.safetensors) | `custom (models/SEEDVR2)` | 8.24 |  |
  | [ema_vae_fp16.safetensors](https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/ema_vae_fp16.safetensors) | `custom (models/SEEDVR2)` | 0.5 |  |

**3. FlashVSR (Wan 2.1 1.3B based, streaming 4x)**

- License: Apache-2.0
- Settings: resolution=x4
- Notes: Much faster than SeedVR2, slightly lower fidelity.
- Custom nodes: https://github.com/smthemex/ComfyUI_FlashVSR, https://github.com/kijai/ComfyUI-WanVideoWrapper
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [Wan2_1-T2V-1_3B_FlashVSR_fp32.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/FlashVSR/Wan2_1-T2V-1_3B_FlashVSR_fp32.safetensors) | `diffusion_models` | 5.68 |  |
  | [Wan2_1_FlashVSR_LQ_proj_model_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/FlashVSR/Wan2_1_FlashVSR_LQ_proj_model_bf16.safetensors) | `custom` | 0.58 |  |
  | [Wan2_1_FlashVSR_TCDecoder_fp32.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/FlashVSR/Wan2_1_FlashVSR_TCDecoder_fp32.safetensors) | `vae` | 0.18 |  |

**4. Wan 2.2 "creative" video upscale (WanVideoWrapper) / Real-ESRGAN per frame**

- License: mixed
- Settings: resolution=x2-x4
- Notes: GAN path is fully native (LoadVideo -> GetVideoComponents -> ImageUpscaleWithModel -> CreateVideo -> SaveVideo).
- Custom nodes: https://github.com/kijai/ComfyUI-WanVideoWrapper
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [RealESRGAN_x4plus.safetensors](https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged/resolve/main/RealESRGAN_x4plus.safetensors) | `upscale_models` | 0.07 |  |

**5. Model-native upscalers: LTX-2.5 latent spatial x2 / temporal x2, HunyuanVideo 1.5 1080p SR**

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: resolution=x2
- Notes: Cheapest path when Fuobe generated the clip itself.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [ltx-2.5-latent-temporal-upscaler-x2-bf16-1.0.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/latent_upscale_models/ltx-2.5-latent-temporal-upscaler-x2-bf16-1.0.safetensors) | `latent_upscale_models` | 0.26 | **gated (accept license + HF token)**  |

### `interpolate` - Frame interpolation (16 fps -> 32/48/60 fps)

*The parity studio's equivalent:* the parity studio smooth motion / frame rate boost

ComfyUI core now ships FrameInterpolationModelLoader + FrameInterpolate with RIFE 4.25/4.26 and FILM weights (models/frame_interpolation).

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Native FrameInterpolate (RIFE v4.26 / FILM) | utility_video_frame_interpolation | core | MIT / Apache-2.0 | <4 GB |
| 2 | GIMM-VFI (kijai/ComfyUI-GIMM-VFI) | utility_gimm_frame_interpolation | custom: [ComfyUI-GIMM-VFI](https://github.com/kijai/ComfyUI-GIMM-VFI), [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | see repo | ~6-8 GB |
| 3 | ComfyUI-Frame-Interpolation (RIFE VFI, FILM, AMT ...) | - | custom: [ComfyUI-Frame-Interpolation](https://github.com/Fannovel16/ComfyUI-Frame-Interpolation) | MIT | <4 GB |

**1. Native FrameInterpolate (RIFE v4.26 / FILM)** ([docs](https://docs.comfy.org/tutorials/utility/frame-interpolation))

- License: MIT / Apache-2.0
- Settings: resolution=any; multiplier=2x-4x
- Notes: Wan 16 fps x2 -> 32 fps; set CreateVideo fps accordingly. (The docs page still says custom nodes are needed; the current template JSON uses only core nodes.)
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [rife_v4.26.safetensors](https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/rife_v4.26.safetensors) | `frame_interpolation` | 0.02 |  |
  | [film_net_fp16.safetensors](https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/film_net_fp16.safetensors) | `frame_interpolation` | 0.07 |  |

**2. GIMM-VFI (kijai/ComfyUI-GIMM-VFI)**

- License: see repo
- Settings: multiplier=2x+
- Notes: Higher quality on large motion; slower.
- Custom nodes: https://github.com/kijai/ComfyUI-GIMM-VFI, https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite

**3. ComfyUI-Frame-Interpolation (RIFE VFI, FILM, AMT ...)**

- License: MIT
- Settings: multiplier=2x-8x
- Notes: Long-standing pack; used by template_rob_split_stack_qwen_multi_wan22.
- Custom nodes: https://github.com/Fannovel16/ComfyUI-Frame-Interpolation

### `v2a` - Video-to-audio / foley / sound effects

*The parity studio's equivalent:* the parity studio's audio/sound for videos

No core foley node; MMAudio and HunyuanVideo-Foley via custom nodes (both non-permissive weights). Joint audio-video models (LTX-2.x, MiniMax H3) avoid a separate foley pass. Stable Audio 3.0 (core templates) covers text-to-SFX.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Joint audio generation in the video model (LTX-2.5 / LTX-2.3 / MiniMax H3) | video_ltx2_5_t2v / video_minimax_h3_t2v | core | LTX-2.x Community (<$10M rev.) | see t2v |
| 2 | MMAudio large 44k v2 (video -> synchronized audio) | - | custom: [ComfyUI-MMAudio](https://github.com/kijai/ComfyUI-MMAudio), [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | CC-BY-NC-4.0 | ~6-10 GB |
| 3 | HunyuanVideo-Foley (XL) - text + video -> 48 kHz foley | - | custom: [ComfyUI-HunyuanVideo-Foley](https://github.com/phazei/ComfyUI-HunyuanVideo-Foley), [ComfyUI_HunyuanVideoFoley](https://github.com/if-ai/ComfyUI_HunyuanVideoFoley) | Tencent Hunyuan (no EU/UK/KR) | ~12-20 GB (FP8/offload options in wrappers) |
| 4 | Stable Audio 3.0 Small SFX / Medium (text-to-SFX & ambience) - core | audio_stable_audio_3_medium / audio_stable_audio_3_medium_base | core | Stability Community (<$1M rev.) | ~6-12 GB |

**1. Joint audio generation in the video model (LTX-2.5 / LTX-2.3 / MiniMax H3)**

- License: LTX-2.x Community License (free incl. commercial below US$10M annual revenue; paid Commercial Use Agreement above)
- Settings: -
- Notes: Describe SFX/dialogue/music in the prompt; audio VAE decodes a synchronized track.

**2. MMAudio large 44k v2 (video -> synchronized audio)**

- License: CC-BY-NC-4.0 (NON-COMMERCIAL)
- Settings: steps=25; cfg=4.5; sampler=internal (flow); resolution=video frames; duration=~8 s per pass (trained length)
- Notes: Original MMAudio weights are CC-BY-NC-4.0; steps/cfg are the MMAudio defaults exposed by the node.
- Custom nodes: https://github.com/kijai/ComfyUI-MMAudio, https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [mmaudio_large_44k_v2_fp16.safetensors](https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_large_44k_v2_fp16.safetensors) | `mmaudio` | 2.06 |  |
  | [mmaudio_vae_44k_fp16.safetensors](https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_vae_44k_fp16.safetensors) | `mmaudio` | 0.61 |  |
  | [mmaudio_synchformer_fp16.safetensors](https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_synchformer_fp16.safetensors) | `mmaudio` | 0.47 |  |
  | [apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors](https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors) | `mmaudio` | 1.97 |  |

**3. HunyuanVideo-Foley (XL) - text + video -> 48 kHz foley**

- License: Tencent Hunyuan Community License (territory excludes EU, UK and South Korea)
- Settings: resolution=video
- Notes: Set fps in the foley sampler equal to the video combine fps.
- Custom nodes: https://github.com/phazei/ComfyUI-HunyuanVideo-Foley, https://github.com/if-ai/ComfyUI_HunyuanVideoFoley
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [hunyuanvideo_foley_xl.pth](https://huggingface.co/tencent/HunyuanVideo-Foley/resolve/main/hunyuanvideo_foley_xl.pth) | `foley` | 5.85 |  |
  | [synchformer_state_dict.pth](https://huggingface.co/tencent/HunyuanVideo-Foley/resolve/main/synchformer_state_dict.pth) | `foley` | 0.95 |  |
  | [vae_128d_48k.pth](https://huggingface.co/tencent/HunyuanVideo-Foley/resolve/main/vae_128d_48k.pth) | `foley` | 1.49 |  |

**4. Stable Audio 3.0 Small SFX / Medium (text-to-SFX & ambience) - core**

- License: Stability AI Community License (free < US$1M revenue)
- Settings: steps=8; cfg=1; sampler=lcm; scheduler=simple; resolution=n/a; duration=EmptyLatentAudio seconds (template 60)
- Notes: Not video-synchronized; place SFX on the timeline in Fuobe.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [stable_audio_3_small_sfx.safetensors](https://huggingface.co/Comfy-Org/stable-audio-3/resolve/main/checkpoints/stable_audio_3_small_sfx.safetensors) | `checkpoints` | 2.27 |  |
  | [stable_audio_3_medium.safetensors](https://huggingface.co/Comfy-Org/stable-audio-3/resolve/main/checkpoints/stable_audio_3_medium.safetensors) | `checkpoints` | 9.22 |  |
  | [t5gemma_b_b_ul2.safetensors](https://huggingface.co/Comfy-Org/stable-audio-3/resolve/main/text_encoders/t5gemma_b_b_ul2.safetensors) | `text_encoders` | 1.19 |  |

### `music` - Music generation

*The parity studio's equivalent:* the parity studio's music for videos

ACE-Step 1.5 / 1.5 XL (Apache, core nodes) is the default; MiniMax Music 3 (Apache, core) for long songs with vocals; YuE2 (CC-BY-NC) for lyrics-to-song and covers.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | ACE-Step 1.5 XL Turbo (core) | audio_ace_step1_5_xl_turbo / audio_ace_step1_5_xl_sft / audio_ace_step1_5_xl_base / audio_ace_step_1_5_checkpoint (AIO) | core | Apache-2.0 | <4 GB (DiT only) to ~16-20 GB (XL + 4B planner) |
| 2 | MiniMax Music 3 (core) | audio_minimax_music_3 | core | Apache-2.0 | ~12-16 GB (tiled decode for long songs) |
| 3 | Stable Audio 3.0 Medium / Small Music (core) | audio_stable_audio_3_medium | core | Stability Community (<$1M rev.) | ~6-12 GB |
| 4 | YuE2 3B (lyrics-to-song, music cover) - core | audio_yue2_text2music / audio_yue2_music_cover | core | CC-BY-NC-4.0 | ~8 GB |

**1. ACE-Step 1.5 XL Turbo (core)** ([docs](https://docs.comfy.org/tutorials/audio/ace-step/ace-step-v1-5))

- License: Apache-2.0
- Settings: steps=8; cfg=1; sampler=euler; scheduler=simple; shift=3; resolution=n/a; duration=10 s - 10 min; sft=50 steps, cfg 7
- Notes: Tags + lyrics (50+ languages); <10 s per song on RTX 3090 (docs). LoRA-trainable.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [acestep_v1.5_xl_turbo_bf16.safetensors](https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/diffusion_models/acestep_v1.5_xl_turbo_bf16.safetensors) | `diffusion_models` | 9.97 |  |
  | [qwen_0.6b_ace15.safetensors](https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/text_encoders/qwen_0.6b_ace15.safetensors) | `text_encoders` | 1.19 |  |
  | [qwen_4b_ace15.safetensors](https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/text_encoders/qwen_4b_ace15.safetensors) | `text_encoders` | 8.38 | LM planner (1.7B variant for less VRAM) |
  | [ace_1.5_vae.safetensors](https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/vae/ace_1.5_vae.safetensors) | `vae` | 0.34 |  |

**2. MiniMax Music 3 (core)** ([docs](https://docs.comfy.org/tutorials/audio/minimax/minimax-music-3))

- License: Apache-2.0
- Settings: steps=30; cfg=1.7; sampler=euler; scheduler=simple; resolution=n/a; duration=template 60-120 s, up to ~300 s
- Notes: Apache-2.0 per HF repo tag (unlike MiniMax H3).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [minimax_music3_dit_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main/diffusion_models/minimax_music3_dit_int8_convrot.safetensors) | `diffusion_models` | 2.5 |  |
  | [minimax_music3_text_encoder_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main/text_encoders/minimax_music3_text_encoder_pruned_int8_convrot.safetensors) | `text_encoders` | 9.2 |  |
  | [minimax_music3_dav.safetensors](https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main/vae/minimax_music3_dav.safetensors) | `vae` | 0.22 |  |

**3. Stable Audio 3.0 Medium / Small Music (core)** ([docs](https://docs.comfy.org/tutorials/audio/stable-audio/stable-audio-3))

- License: Stability AI Community License (free < US$1M revenue)
- Settings: steps=8; cfg=1; sampler=lcm; scheduler=simple; resolution=n/a
- Notes: Instrumentals/loops/beds.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [stable_audio_3_small_music.safetensors](https://huggingface.co/Comfy-Org/stable-audio-3/resolve/main/checkpoints/stable_audio_3_small_music.safetensors) | `checkpoints` | 2.27 |  |

**4. YuE2 3B (lyrics-to-song, music cover) - core** ([docs](https://docs.comfy.org/tutorials/audio/yue2/yue2))

- License: CC-BY-NC-4.0 (NON-COMMERCIAL)
- Settings: steps=32; cfg=1; sampler=dpm_2; scheduler=sgm_uniform; resolution=n/a
- Notes: Non-commercial weights.
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [yue2_3b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/YuE2/resolve/main/checkpoints/yue2_3b_int8_convrot.safetensors) | `checkpoints` | 3.96 |  |
  | [sheetsage2_bf16.safetensors](https://huggingface.co/Comfy-Org/YuE2/resolve/main/audio_encoders/sheetsage2_bf16.safetensors) | `audio_encoders` | 1.39 |  |

### `prompt-enhance` - Prompt enhancement ("Enhance prompt") and captioning with local LLMs

*The parity studio's equivalent:* the parity studio "Enhance prompt" toggle

ComfyUI core has a TextGenerate node that runs LLM/VLMs stored in models/text_encoders (Qwen3, Qwen3.5, Qwen3-VL, Gemma 4). Several 2026 models ship their own trained enhancers (FLUX 3 Klein PUP, Qwen Image 2.1 PE, LTX-2.5 prompt_enhance, Krea 2, ERNIE-Image). Alternatively Fuobe can call Ollama/llama.cpp outside ComfyUI and inject the text.

| # | Option | Official template | Nodes | License | VRAM |
|---|---|---|---|---|---|
| 1 | Core TextGenerate node + Qwen3.5 4B/9B or Qwen3-VL 8B (image-aware) / Gemma 4 | llm_qwen3_5_text_gen / llm_qwen3vl_text_gen / llm_gemma4_text_gen | core | Apache-2.0 | ~5-20 GB (unloaded before diffusion) |
| 2 | Model-specific trained enhancers (FLUX 3 Klein PUP, Qwen Image 2.1 PE, LTX-2.5 prompt_enhance, Krea 2, ERNIE-Image) | image_flux3_klein_t2i / image_qwen_image_2_1_t2i / video_ltx2_5_t2v / image_krea2_turbo_t2i / image_ernie_image | core | per model | +5-10 GB |
| 3 | Ollama / llama.cpp via comfyui-ollama (or directly from the Fuobe backend) | - | custom: [comfyui-ollama](https://github.com/stavsap/comfyui-ollama), [ComfyUI-QwenVL](https://github.com/1038lab/ComfyUI-QwenVL), [ComfyUI-IF_LLM](https://github.com/if-ai/ComfyUI-IF_LLM) | MIT (node) | separate process |

**1. Core TextGenerate node + Qwen3.5 4B/9B or Qwen3-VL 8B (image-aware) / Gemma 4** ([docs](https://docs.comfy.org/tutorials/llm/qwen/qwen3_5))

- License: Apache-2.0
- Settings: sampler=sampling_mode on (temperature 0.7, top_k 64, top_p 0.95 in template); maxTokens=256
- Notes: Load with CLIPLoader, feed a system prompt per Fuobe preset (Soul style guide, camera vocabulary, Wan/LTX prompt structure).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen3.5_4b_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen3.5/resolve/main/text_encoders/qwen3.5_4b_bf16.safetensors) | `text_encoders` | 9.32 | 2B (4.6 GB) / 9B (19.3 GB) also available |
  | [qwen3vl_8b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen3-VL/resolve/main/text_encoders/qwen3vl_8b_fp8_scaled.safetensors) | `text_encoders` | 10.59 | use for image->prompt (I2V motion prompt from the start frame) |
  | [gemma4_e4b_it_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/gemma-4/resolve/main/text_encoders/gemma4_e4b_it_fp8_scaled.safetensors) | `text_encoders` | 9.06 |  |

**2. Model-specific trained enhancers (FLUX 3 Klein PUP, Qwen Image 2.1 PE, LTX-2.5 prompt_enhance, Krea 2, ERNIE-Image)**

- License: per model
- Settings: -
- Notes: Use the matching enhancer when the model was trained on its captions (FLUX 3 Klein: strongly recommended).
- Model files:

  | File | Folder | Size (GB) | Notes |
  |---|---|---|---|
  | [qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/main/text_encoders/qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors) | `text_encoders` | 6.72 | **gated (accept license + HF token)**  |
  | [qwen3.5_9b_qwen_image_2.1_pe_t2i_w4a8.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3.5_9b_qwen_image_2.1_pe_t2i_w4a8.safetensors) | `text_encoders` | 6.72 |  |
  | [ernie-image-prompt-enhancer.safetensors](https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/text_encoders/ernie-image-prompt-enhancer.safetensors) | `text_encoders` | 6.88 |  |

**3. Ollama / llama.cpp via comfyui-ollama (or directly from the Fuobe backend)**

- License: MIT (node)
- Settings: -
- Notes: Keeps the LLM out of ComfyUI VRAM scheduling; easiest to swap models.
- Custom nodes: https://github.com/stavsap/comfyui-ollama, https://github.com/1038lab/ComfyUI-QwenVL, https://github.com/if-ai/ComfyUI-IF_LLM

## 3. The parity studio's preset coverage (camera motions and VFX)

Preset names below are the parity studio names from the companion inventory (`parity-inventory.json`). "Best open implementation" lists what Fuobe can run today; "weak" = only prompt-level control, no dedicated open LoRA/model found.

| The parity studio's camera preset | Best open implementation (ComfyUI) | Strength |
|---|---|---|
| Crash Zoom In / Crash Zoom Out | Remade-AI Crash-zoom-in / Crash-zoom-out LoRA on Wan 2.1 I2V 480p ("cr34sh crash zoom in effect") | good |
| Dolly In / Dolly Out / Dolly Left / Dolly Right (also dolly_in ... in the parity studio's LTX presets) | Lightricks LTX-2 Camera-Control Dolly LoRAs (exact match); Wan 2.2 prompt "camera dollies in"; lovis93 Push-in (Wan 2.1 720p) | good |
| Jib up / Jib down / Crane Up / Crane Down / Crane Over The Head | LTX-2 Jib-Up/Down LoRAs; Remade Crane_up / Crane-down / Crane_over_the_head (Wan 2.1 I2V) | good |
| Static | LTX-2 Static LoRA; Wan 2.2 Fun Camera "Static" | good |
| Pan Left / Pan Right / Pedestal Down / Zoom In / Zoom Out / Roll Transition | Wan 2.2 Fun Camera presets (Pan Left/Right/Up/Down = translations, Zoom In/Out = dolly, ACW/CW = roll) - deterministic; true tilts/pans (rotation) via prompt | good |
| Dolly Zoom In / Dolly Zoom Out | ostris Wan2.1 I2V dolly zoom LoRA ("dolly zoom"); Remade Dolly-Effect | good |
| 360 Orbit / Arc Left / Arc Right | ostris Wan2.2 I2V orbit LoRA ("orbit 360"); Remade 360-Orbit / Arc_shot; MiniMax H3 360-Orbit LoRA | good |
| Bullet Time | Remade matrix-shot; joyfox Wan2.1 bullet time; MiniMax H3 bullet_time embedding | good |
| 3D Rotation / Lazy Susan | Remade Rotate ("r0t4tion 360 degrees rotation"); MATLOWAI H3 ORB360 | good |
| Super Dolly In / Super Dolly Out / Earth Zoom Out | lovis93 Push-in; TheBurgstall EarthZoomOut (LTX-2, "EARTHZO") | medium |
| FPV Drone / Road Rush / POV / Downhill POV | chsengni LTX-2.3 FPV LoRA; Remade POV-Driving (T2V); neph1 H3 FPV head-bob; prompt "FPV drone shot" | medium |
| Handheld / Snorricam | neph1 MiniMax H3 handheld LoRA; prompt "handheld camera"; Snorricam: H3 head-mounted LoRA (closest) | medium |
| Eyes In / Mouth In / Through Object In | Remade Eye-Close-Up (T2V); otherwise prompt + Wan FLF2V to a macro end frame | medium |
| Fisheye | Remade Tiny-Planet-Fisheye (T2V) | medium |
| Car Chasing / Car Grip / Action Run / Hero Cam | Remade Car-chase / Hero-run (Wan 2.1 I2V) | medium |
| Any preset copied from a reference clip ("Robo Arm", "Impossible Camera", "One Take" ...) | Cseti LTX-2.3 IC-LoRA Cameraman (reference video -> same camera path); Uni3C / ReCamMaster (WanVideoWrapper) | medium |
| Whip Pan / Dutch Angle / Focus Change / Low Shutter / Wiggle / YoYo Zoom / Hyperlapse / Timelapse | prompt-only on Wan 2.2 / LTX-2.5 / H3 (no dedicated open LoRA found) | weak |
| Kiss / Face Punch / Boxing / sport presets (Skate, Ski, Moonwalk ...) | Remade kissing / Boxing (T2V); H3 kiss_camera embedding; others prompt-only or train a LoRA | weak-medium |

| The parity studio's VFX preset | Best open implementation (ComfyUI) | Strength |
|---|---|---|
| Disintegration | artificialguybr Disintegration LoRA (Wan 2.2 I2V high+low, CC0) | good |
| Set on Fire / Flame On / Fire Breathe | Remade Fire (T2V); MiniMax H3 fire_breath embedding; prompt | medium |
| Thunder God | Remade Electrify ("e13c7r1c electricity effect") | good |
| Explosion / Head Explosion / Building Explosion / Car Explosion | Remade Explode ("3xp105ion huge explosion"); H3 art_is_explosion | medium |
| Balloon | Remade Inflate; kabachuha LTX-2 inflate; SYSTMS INFL8 (Qwen-Edit end frame) + Wan FLF2V | good |
| Melting / Turning Metal / Freezing / Diamond / Morphskin / Skin Surge | Qwen-Image-Edit-2511 material change for the end frame + Wan 2.2 FLF2V; artificialguybr SkinMorph (Wan 2.2) | medium |
| Levitation / Floating fall / I Can Fly / Hero Flight | prompt-only (Wan 2.2 / LTX-2.5) or Qwen-Edit end frame + FLF2V; no dedicated open LoRA found | weak |
| Cyborg / Horror Face / Beast Appearance / Monstrosity | Remade Robot-Face-Reveal / Jumpscare / Hulk-Transformation | good |
| Crying / Angry Mode / Happy Mode / Shocked | Remade crying / angry-face / Laughing / Cartoon_Jaw_Drop | good |
| Kiss / Red Carpet / Selfception | Remade kissing / VIP / Selfie-With-Younger-Self | good |
| Outfit Switch / Agent Reveal / transformations | Remade transformation LoRAs (Bride, Princess, Samurai, Pirate, Warrior, Assassin ...) or Qwen-Edit outfit change + FLF2V | medium |
| Garden Bloom / Nature Bloom | MiniMax H3 blooming_flowers embedding; prompt | medium |
| Flood / Sand Storm / Tornado | Remade Tsunami / Tornado (T2V LoRAs) | medium |
| Transitions (Seamless, Melt, Smoke, Flame ...) | LTX-2.3 transition LoRA ("zhuanchang"); Wan 2.2 FLF2V between two stills | medium |
| Squish / Cakeify (Pika-style) | Remade Squish / Cakeify; LTX-2 squish template (video_ltx2_i2v_lora) | good (no parity-studio preset) |
| Color grades / film looks (Bleach Bypass, Teal Orange Epic, Noir, Vintage ...) | prompt + post-grade (LUT) in Fuobe; Remade Film-Noir / Vintage-VHS; Krea 2 style LoRAs for stills | medium |

## 4. LoRA / embedding catalogue (camera, VFX, style, speed)

170 entries: 40 camera, 26 speed, 47 style, 57 vfx. Remade-AI entries (69, Apache-2.0) are Wan 2.1 14B LoRAs (I2V-480p or T2V) trained for ~81-frame clips; load with `LoraLoaderModelOnly` (strength ~1.0) and put the trigger phrase in the prompt following each card's template (e.g. "The camera performs a cr34sh crash zoom in effect, rapidly zooming closer to ..."). They run best on Wan 2.1 I2V 14B 480p; on Wan 2.2 apply them to the low-noise expert. All `url`s are direct `resolve/main` downloads; place files in `models/loras` unless noted (embeddings -> `models/embeddings`, referenced as `embedding:<name>`).

#### camera

| Name | Base model | Trigger | parity-studio-style preset | License | File |
|---|---|---|---|---|---|
| Remade-AI Rotate | wan2.1-i2v-14b-480p | r0t4tion 360 degrees rotation | 3D Rotation / Lazy Susan | Apache-2.0 | [rotate_20_epochs.safetensors](https://huggingface.co/Remade-AI/Rotate/resolve/main/rotate_20_epochs.safetensors) |
| Remade-AI Ultra-Wide | wan2.1-t2v-14b | u1tr4_w1d3, ultra wide angle shot | - (lens look) | Apache-2.0 | [ultra_wide_5_epochs.safetensors](https://huggingface.co/Remade-AI/Ultra-Wide/resolve/main/ultra_wide_5_epochs.safetensors) |
| Remade-AI POV-Driving | wan2.1-t2v-14b | p0v_dr1v1n6 | Road Rush / POV | Apache-2.0 | [pov_driving_5_epochs.safetensors](https://huggingface.co/Remade-AI/POV-Driving/resolve/main/pov_driving_5_epochs.safetensors) |
| Remade-AI Eye-Close-Up | wan2.1-t2v-14b | 3y3_cl053 eye extreme close up | Eyes In | Apache-2.0 | [eye_10_epochs.safetensors](https://huggingface.co/Remade-AI/Eye-Close-Up/resolve/main/eye_10_epochs.safetensors) |
| Remade-AI Tiny-Planet-Fisheye | wan2.1-t2v-14b | Little planet view fisheye lens | Fisheye | Apache-2.0 | [fisheye_15_epochs.safetensors](https://huggingface.co/Remade-AI/Tiny-Planet-Fisheye/resolve/main/fisheye_15_epochs.safetensors) |
| Remade-AI Dolly-Effect | wan2.1-i2v-14b-480p | d011Ye33ect dolly effect | Dolly Zoom In / Dolly Zoom Out | Apache-2.0 | [dolly_25_epochs.safetensors](https://huggingface.co/Remade-AI/Dolly-Effect/resolve/main/dolly_25_epochs.safetensors) |
| Remade-AI Hero-run | wan2.1-i2v-14b-480p | 4ct3ion Action Run | Action Run | Apache-2.0 | [Hero_run.safetensors](https://huggingface.co/Remade-AI/Hero-run/resolve/main/Hero_run.safetensors) |
| Remade-AI 360-Orbit | wan2.1-i2v-14b-480p | 0rb4it 360 degree orbit | 360 Orbit | Apache-2.0 | [360_Orbit.safetensors](https://huggingface.co/Remade-AI/360-Orbit/resolve/main/360_Orbit.safetensors) |
| Remade-AI Arc_shot | wan2.1-i2v-14b-480p | 34Ar2c arc the camera moves in a smooth curve around | Arc Left / Arc Right | Apache-2.0 | [Arc_shot.safetensors](https://huggingface.co/Remade-AI/Arc_shot/resolve/main/Arc_shot.safetensors) |
| Remade-AI Crane_up | wan2.1-i2v-14b-480p | cr4n3 crane up effect | Crane Up | Apache-2.0 | [crane_up.safetensors](https://huggingface.co/Remade-AI/Crane_up/resolve/main/crane_up.safetensors) |
| Remade-AI Crane_over_the_head | wan2.1-i2v-14b-480p | cr4n3 crane over the head movement | Crane Over The Head | Apache-2.0 | [crane_overhead.safetensors](https://huggingface.co/Remade-AI/Crane_over_the_head/resolve/main/crane_overhead.safetensors) |
| Remade-AI Crane-down | wan2.1-i2v-14b-480p | cr4n3 crane down camera motion | Crane Down | Apache-2.0 | [crane_down.safetensors](https://huggingface.co/Remade-AI/Crane-down/resolve/main/crane_down.safetensors) |
| Remade-AI matrix-shot | wan2.1-i2v-14b-480p | b4ll3t t1m3 bullet time shot | Bullet Time | Apache-2.0 | [matrix_shot.safetensors](https://huggingface.co/Remade-AI/matrix-shot/resolve/main/matrix_shot.safetensors) |
| Remade-AI Car-chase | wan2.1-i2v-14b-480p | c4r ch4s3 car chase | Car Chasing | Apache-2.0 | [car_chase.safetensors](https://huggingface.co/Remade-AI/Car-chase/resolve/main/car_chase.safetensors) |
| Remade-AI Crash-zoom-in | wan2.1-i2v-14b-480p | cr34sh crash zoom in effect | Crash Zoom In | Apache-2.0 | [crash_zoom_in.safetensors](https://huggingface.co/Remade-AI/Crash-zoom-in/resolve/main/crash_zoom_in.safetensors) |
| Remade-AI Crash-zoom-out | wan2.1-i2v-14b-480p | cr34sh crash zoom out effect | Crash Zoom Out | Apache-2.0 | [crash_zoom_out.safetensors](https://huggingface.co/Remade-AI/Crash-zoom-out/resolve/main/crash_zoom_out.safetensors) |
| ostris Wan2.2 I2V Orbit Shot (high noise) | wan2.2-i2v-a14b | orbit 360 (also "orbit 180 around ...") | 360 Orbit / Arc Left / Arc Right | Apache-2.0 | [wan22_14b_i2v_orbit_high_noise.safetensors](https://huggingface.co/ostris/wan22_i2v_14b_orbit_shot_lora/resolve/main/wan22_14b_i2v_orbit_high_noise.safetensors) |
| ostris Wan2.2 I2V Orbit Shot (low noise) | wan2.2-i2v-a14b | orbit 360 | 360 Orbit / Arc Left / Arc Right | Apache-2.0 | [wan22_14b_i2v_orbit_low_noise.safetensors](https://huggingface.co/ostris/wan22_i2v_14b_orbit_shot_lora/resolve/main/wan22_14b_i2v_orbit_low_noise.safetensors) |
| ostris Wan2.1 I2V Dolly Zoom | wan2.1-i2v-14b-480p | dolly zoom | Dolly Zoom In / Dolly Zoom Out | Apache-2.0 | [wan_21_i2v_dolly_zoom.safetensors](https://huggingface.co/ostris/wan21_i2v_dolly_zoom_lora/resolve/main/wan_21_i2v_dolly_zoom.safetensors) |
| lovis93 Motion LoRA Push-In camera | wan2.1-i2v-14b-720p | Push-in camera | Dolly In / Super Dolly In | Apache-2.0 | [motionpushin-v5-wan-i2v-14b-720p-400.safetensors](https://huggingface.co/lovis93/Motion-Lora-Camera-Push-In-Wan-14B-720p-I2V/resolve/main/motionpushin-v5-wan-i2v-14b-720p-400.safetensors) |
| joyfox Wan2.1 Bullet Time | wan2.1-i2v-14b-480p | rw360xz (+ "人物定在空中，相机视角围绕人物向一个方向旋转") | Bullet Time | Apache-2.0 | [Wan21_I2V_rotation_000003750.safetensors](https://huggingface.co/joyfox/Wan2.1-BulletTime-LoRA/resolve/main/Wan21_I2V_rotation_000003750.safetensors) |
| wolfer45 Wan2.2 Bullet Time (high noise) | wan2.2-i2v-a14b | bullettimehigh-wan22-i2v | Bullet Time | unspecified (check card) | [wan2.2bullet_time_high_noise.safetensors](https://huggingface.co/wolfer45/bullettimehigh-wan22-i2v/resolve/main/wan2.2bullet_time_high_noise.safetensors) |
| Lightricks LTX-2 Camera Control Dolly In | ltx-2-19b | none (describe the destination of the move and what gets revealed) | Dolly In / dolly_in | LTX-2 Community License | [ltx-2-19b-lora-camera-control-dolly-in.safetensors](https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-In/resolve/main/ltx-2-19b-lora-camera-control-dolly-in.safetensors) |
| Lightricks LTX-2 Camera Control Dolly Out | ltx-2-19b | none (describe the destination of the move and what gets revealed) | Dolly Out / dolly_out | LTX-2 Community License | [ltx-2-19b-lora-camera-control-dolly-out.safetensors](https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Out/resolve/main/ltx-2-19b-lora-camera-control-dolly-out.safetensors) |
| Lightricks LTX-2 Camera Control Dolly Left | ltx-2-19b | none (describe the destination of the move and what gets revealed) | Dolly Left / dolly_left | LTX-2 Community License | [ltx-2-19b-lora-camera-control-dolly-left.safetensors](https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Left/resolve/main/ltx-2-19b-lora-camera-control-dolly-left.safetensors) |
| Lightricks LTX-2 Camera Control Dolly Right | ltx-2-19b | none (describe the destination of the move and what gets revealed) | Dolly Right / dolly_right | LTX-2 Community License | [ltx-2-19b-lora-camera-control-dolly-right.safetensors](https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Right/resolve/main/ltx-2-19b-lora-camera-control-dolly-right.safetensors) |
| Lightricks LTX-2 Camera Control Jib Up | ltx-2-19b | none (describe the destination of the move and what gets revealed) | Jib up / jib_up | LTX-2 Community License | [ltx-2-19b-lora-camera-control-jib-up.safetensors](https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Jib-Up/resolve/main/ltx-2-19b-lora-camera-control-jib-up.safetensors) |
| Lightricks LTX-2 Camera Control Jib Down | ltx-2-19b | none (describe the destination of the move and what gets revealed) | Jib down / jib_down | LTX-2 Community License | [ltx-2-19b-lora-camera-control-jib-down.safetensors](https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Jib-Down/resolve/main/ltx-2-19b-lora-camera-control-jib-down.safetensors) |
| Lightricks LTX-2 Camera Control Static | ltx-2-19b | none (describe the destination of the move and what gets revealed) | Static / static | LTX-2 Community License | [ltx-2-19b-lora-camera-control-static.safetensors](https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Static/resolve/main/ltx-2-19b-lora-camera-control-static.safetensors) |
| Cseti LTX-2.3 IC-LoRA Cameraman v1 (copy camera move from reference video) | ltx-2.3-22b | none (IC-LoRA: feed a reference clip as guide) | any preset (camera path copied from a reference clip) | Apache-2.0 | [LTX2.3-22B_IC-LoRA-Cameraman_v1_10500.safetensors](https://huggingface.co/Cseti/LTX2.3-22B_IC-LoRA-Cameraman_v1/resolve/main/LTX2.3-22B_IC-LoRA-Cameraman_v1_10500.safetensors) |
| chsengni LTX-2.3 FPV motion | ltx-2.3-22b | fpv (Chinese card: "更平稳fpv镜头，低速飞行") | FPV Drone | Apache-2.0 | [ltx2.3_fpv_motion.safetensors](https://huggingface.co/chsengni/ltx2.3-fpv-motion/resolve/main/ltx2.3_fpv_motion.safetensors) |
| TheBurgstall EarthZoomOut (LTX-2) | ltx-2-19b | EARTHZO (e.g. "EARTHZO the camera zooms out from ... to the outer space") | Earth Zoom Out | LTX-2 Community License | [lora_weights_step_02000.safetensors](https://huggingface.co/TheBurgstall/EarthZoomOut-LoRA-LTX-2-19b/resolve/main/lora_weights_step_02000.safetensors) |
| pablodawson MiniMax-H3 360 Orbit (FL2VA) | minimax-h3-fl2va | One frozen instant. Only the camera moves. In a continuous 360 orbit. ... | 360 Orbit / Bullet Time | MiniMax H3 Community (territory-restricted) | [minimax_h3_flf2v_lora_v1.safetensors](https://huggingface.co/pablodawson/MiniMax-H3-360-Orbit-LoRA/resolve/main/minimax_h3_flf2v_lora_v1.safetensors) |
| MATLOWAI MiniMax-H3 ORB360 (Ref2VA) | minimax-h3-ref2va | orbit prompt per card | 360 Orbit / Lazy Susan | MiniMax H3 Community (territory-restricted) | [minimax_h3_orb360_step1500.safetensors](https://huggingface.co/MATLOWAI/MiniMax-H3-ORB360-CardSpin/resolve/main/minimax_h3_orb360_step1500.safetensors) |
| Jojocodex MiniMax-H3 Camera Motion | minimax-h3 | camera motion (must start the prompt), e.g. "camera motion, [subject], [scene], slow push-in with subtle lateral tracking, ..." | Dolly In / Tracking (general) | Apache-2.0 | [camera_motion_h3_lora_v1_3000_pruned.safetensors](https://huggingface.co/Jojocodex/minimax-h3-Camera-Motion-lora/resolve/main/camera_motion_h3_lora_v1_3000_pruned.safetensors) |
| neph1 MiniMax-H3 handheld shaky camera | minimax-h3 | none | Handheld | MiniMax H3 Community (territory-restricted) | [handheld_h3_100.safetensors](https://huggingface.co/neph1/minimax_h3_handheld_shaky_camera/resolve/main/handheld_h3_100.safetensors) |
| neph1 MiniMax-H3 head-mounted FPV head-bob | minimax-h3 | none | POV / Snorricam (closest) | MiniMax H3 Community (territory-restricted) | [fpv_headbob_h3_50.safetensors](https://huggingface.co/neph1/minimax_h3_headmounted_fpv_cam/resolve/main/fpv_headbob_h3_50.safetensors) |
| MiniMax H3 embedding bullet_time | minimax-h3 | embedding:minimaxh3_bullet_time | Bullet Time | MiniMax H3 Community (territory-restricted) | [minimaxh3_bullet_time.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_bullet_time.safetensors) |
| MiniMax H3 embedding spiral_ascent | minimax-h3 | embedding:minimaxh3_spiral_ascent | Helicopter Shot / Crane Up (closest) | MiniMax H3 Community (territory-restricted) | [minimaxh3_spiral_ascent.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_spiral_ascent.safetensors) |
| MiniMax H3 embedding kiss_camera | minimax-h3 | embedding:minimaxh3_kiss_camera | Kiss | MiniMax H3 Community (territory-restricted) | [minimaxh3_kiss_camera.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_kiss_camera.safetensors) |

#### vfx

| Name | Base model | Trigger | parity-studio-style preset | License | File |
|---|---|---|---|---|---|
| Remade-AI Squish | wan2.1-i2v-14b-480p | sq41sh squish effect | - (no direct preset) | Apache-2.0 | [squish_18.safetensors](https://huggingface.co/Remade-AI/Squish/resolve/main/squish_18.safetensors) |
| Remade-AI Cakeify | wan2.1-i2v-14b-480p | c4k3 cakeify it | - (no direct preset) | Apache-2.0 | [cakeify_16_epochs.safetensors](https://huggingface.co/Remade-AI/Cakeify/resolve/main/cakeify_16_epochs.safetensors) |
| Remade-AI Inflate | wan2.1-i2v-14b-480p | infl4t3 inflates it | Balloon (closest) | Apache-2.0 | [inflate_20_epochs.safetensors](https://huggingface.co/Remade-AI/Inflate/resolve/main/inflate_20_epochs.safetensors) |
| Remade-AI Deflate | wan2.1-i2v-14b-480p | d3d1at3 deflate it | - | Apache-2.0 | [deflate_20_epochs.safetensors](https://huggingface.co/Remade-AI/Deflate/resolve/main/deflate_20_epochs.safetensors) |
| Remade-AI Crush | wan2.1-i2v-14b-480p | c5us4 crushes it | - | Apache-2.0 | [crush_20_epochs.safetensors](https://huggingface.co/Remade-AI/Crush/resolve/main/crush_20_epochs.safetensors) |
| Remade-AI Gun-Shooting | wan2.1-i2v-14b-480p | p5lls g4un pulls a gun and starts shooting. | - | Apache-2.0 | [gun_20_epochs.safetensors](https://huggingface.co/Remade-AI/Gun-Shooting/resolve/main/gun_20_epochs.safetensors) |
| Remade-AI Muscle | wan2.1-i2v-14b-480p | t2k1s takes off clothes revealing a lean muscular body and shows off muscles | - | Apache-2.0 | [muscle_18_epochs.safetensors](https://huggingface.co/Remade-AI/Muscle/resolve/main/muscle_18_epochs.safetensors) |
| Remade-AI Bride | wan2.1-i2v-14b-480p | 8r1d3 bride effect. | Outfit Switch (closest) | Apache-2.0 | [bride_50_epochs.safetensors](https://huggingface.co/Remade-AI/Bride/resolve/main/bride_50_epochs.safetensors) |
| Remade-AI Baby | wan2.1-i2v-14b-480p | 848y baby effect | - | Apache-2.0 | [baby_50_epochs.safetensors](https://huggingface.co/Remade-AI/Baby/resolve/main/baby_50_epochs.safetensors) |
| Remade-AI Puppy | wan2.1-i2v-14b-480p | pu11y puppy effect | Animalization (closest) | Apache-2.0 | [puppy_50_epochs.safetensors](https://huggingface.co/Remade-AI/Puppy/resolve/main/puppy_50_epochs.safetensors) |
| Remade-AI Classy | wan2.1-i2v-14b-480p | c1455y classy transformation | Outfit Switch (closest) | Apache-2.0 | [classy_45_epochs.safetensors](https://huggingface.co/Remade-AI/Classy/resolve/main/classy_45_epochs.safetensors) |
| Remade-AI Snow-White | wan2.1-i2v-14b-480p | sn0w_wh1t3 Snow White transformation | Outfit Switch (closest) | Apache-2.0 | [snow_white_50_epochs.safetensors](https://huggingface.co/Remade-AI/Snow-White/resolve/main/snow_white_50_epochs.safetensors) |
| Remade-AI Disney-Princess | wan2.1-i2v-14b-480p | d15n3y Disney princess transformation | Outfit Switch (closest) | Apache-2.0 | [disney_princess_45_epochs.safetensors](https://huggingface.co/Remade-AI/Disney-Princess/resolve/main/disney_princess_45_epochs.safetensors) |
| Remade-AI VIP | wan2.1-i2v-14b-480p | v1p red carpet transformation | Red Carpet | Apache-2.0 | [vip_50_epochs.safetensors](https://huggingface.co/Remade-AI/VIP/resolve/main/vip_50_epochs.safetensors) |
| Remade-AI Mona-Lisa | wan2.1-i2v-14b-480p | m0n4 Mona Lisa transformation | Pearl earring / Monet Muse (closest) | Apache-2.0 | [mona_lisa_45_epochs.safetensors](https://huggingface.co/Remade-AI/Mona-Lisa/resolve/main/mona_lisa_45_epochs.safetensors) |
| Remade-AI Princess | wan2.1-i2v-14b-480p | pr1nc355 princess transformation | Outfit Switch (closest) | Apache-2.0 | [princess_45_epochs.safetensors](https://huggingface.co/Remade-AI/Princess/resolve/main/princess_45_epochs.safetensors) |
| Remade-AI Jungle | wan2.1-i2v-14b-480p | 1ung13 jungle transformation | Nature Bloom (closest) | Apache-2.0 | [jungle_50_epochs.safetensors](https://huggingface.co/Remade-AI/Jungle/resolve/main/jungle_50_epochs.safetensors) |
| Remade-AI Pirate-Captain | wan2.1-i2v-14b-480p | p1r4t3 pirate captain transformation | Outfit Switch (closest) | Apache-2.0 | [pirate_captain_50_epochs.safetensors](https://huggingface.co/Remade-AI/Pirate-Captain/resolve/main/pirate_captain_50_epochs.safetensors) |
| Remade-AI Samurai | wan2.1-i2v-14b-480p | 54mur41 samurai transformation | Outfit Switch (closest) | Apache-2.0 | [samurai_50_epochs.safetensors](https://huggingface.co/Remade-AI/Samurai/resolve/main/samurai_50_epochs.safetensors) |
| Remade-AI Zen | wan2.1-i2v-14b-480p | z3n1fy zen transformation | - | Apache-2.0 | [zen_50_epochs.safetensors](https://huggingface.co/Remade-AI/Zen/resolve/main/zen_50_epochs.safetensors) |
| Remade-AI Assassin | wan2.1-i2v-14b-480p | 3p1c epic transformation | Agent Reveal (closest) | Apache-2.0 | [assassin_45_epochs.safetensors](https://huggingface.co/Remade-AI/Assassin/resolve/main/assassin_45_epochs.safetensors) |
| Remade-AI Warrior | wan2.1-i2v-14b-480p | warr10r warrior it | Mighty fighter (closest) | Apache-2.0 | [warrior_45_epochs.safetensors](https://huggingface.co/Remade-AI/Warrior/resolve/main/warrior_45_epochs.safetensors) |
| Remade-AI Painting | wan2.1-i2v-14b-480p | p41nt1ng painting frame it | Monet Muse / Canvas (closest) | Apache-2.0 | [painting_50_epochs.safetensors](https://huggingface.co/Remade-AI/Painting/resolve/main/painting_50_epochs.safetensors) |
| Remade-AI Fire | wan2.1-t2v-14b | [r3al_f1re] | Set on Fire / Flame On | Apache-2.0 | [fire_12_epochs.safetensors](https://huggingface.co/Remade-AI/Fire/resolve/main/fire_12_epochs.safetensors) |
| Remade-AI Tsunami | wan2.1-t2v-14b | t5un@m1 realistic tsunami | Flood | Apache-2.0 | [tsunami_4_epochs.safetensors](https://huggingface.co/Remade-AI/Tsunami/resolve/main/tsunami_4_epochs.safetensors) |
| Remade-AI Fus-Ro-Dah | wan2.1-i2v-14b-480p | fus_r0_d4h force push effect | Air Bending (closest) | Apache-2.0 | [fus_ro_dah_20_epochs.safetensors](https://huggingface.co/Remade-AI/Fus-Ro-Dah/resolve/main/fus_ro_dah_20_epochs.safetensors) |
| Remade-AI Hug-Jesus | wan2.1-i2v-14b-480p | h54g hugs jesus | Buddy (closest) | Apache-2.0 | [hug_jesus_20_epochs.safetensors](https://huggingface.co/Remade-AI/Hug-Jesus/resolve/main/hug_jesus_20_epochs.safetensors) |
| Remade-AI Super-Saiyan | wan2.1-i2v-14b-480p | 5up3r super saiyan transformation | Innerlight / Saint Glow (closest) | Apache-2.0 | [super_saiyan_35_epochs.safetensors](https://huggingface.co/Remade-AI/Super-Saiyan/resolve/main/super_saiyan_35_epochs.safetensors) |
| Remade-AI Robot-Face-Reveal | wan2.1-i2v-14b-480p | r8b8t1c robotic face reveal | Cyborg | Apache-2.0 | [robot_face_reveal_35_epochs.safetensors](https://huggingface.co/Remade-AI/Robot-Face-Reveal/resolve/main/robot_face_reveal_35_epochs.safetensors) |
| Remade-AI Explode | wan2.1-i2v-14b-480p | 3xp105ion huge explosion | Explosion / Head Explosion | Apache-2.0 | [explode_30_epochs.safetensors](https://huggingface.co/Remade-AI/Explode/resolve/main/explode_30_epochs.safetensors) |
| Remade-AI Electrify | wan2.1-i2v-14b-480p | e13c7r1c electricity effect | Thunder God | Apache-2.0 | [electrify_50_epochs.safetensors](https://huggingface.co/Remade-AI/Electrify/resolve/main/electrify_50_epochs.safetensors) |
| Remade-AI Tornado | wan2.1-t2v-14b | t0r54d0 tornado | Sand Storm (closest) | Apache-2.0 | [tornado_10_epochs.safetensors](https://huggingface.co/Remade-AI/Tornado/resolve/main/tornado_10_epochs.safetensors) |
| Remade-AI Hulk-Transformation | wan2.1-i2v-14b-480p | h01k green hulk transformation | Beast Appearance / Monstrosity | Apache-2.0 | [hulk_35_epochs.safetensors](https://huggingface.co/Remade-AI/Hulk-Transformation/resolve/main/hulk_35_epochs.safetensors) |
| Remade-AI Selfie-With-Younger-Self | wan2.1-i2v-14b-480p | s31lf13 taking a selfie with their younger self | Selfception | Apache-2.0 | [selfie_younger_self_15_epochs.safetensors](https://huggingface.co/Remade-AI/Selfie-With-Younger-Self/resolve/main/selfie_younger_self_15_epochs.safetensors) |
| Remade-AI angry-face | wan2.1-i2v-14b-480p | 4ngr23 angry face | Angry Mode | Apache-2.0 | [angry_face_5_epochs.safetensors](https://huggingface.co/Remade-AI/angry-face/resolve/main/angry_face_5_epochs.safetensors) |
| Remade-AI kissing | wan2.1-i2v-14b-480p | k144ing kissing | Kiss | Apache-2.0 | [kissing_30_epochs.safetensors](https://huggingface.co/Remade-AI/kissing/resolve/main/kissing_30_epochs.safetensors) |
| Remade-AI crying | wan2.1-i2v-14b-480p | cr471ng crying | Crying | Apache-2.0 | [crying_20_epochs.safetensors](https://huggingface.co/Remade-AI/crying/resolve/main/crying_20_epochs.safetensors) |
| Remade-AI Laughing | wan2.1-i2v-14b-480p | l4a6ing laughing | Happy Mode | Apache-2.0 | [laughing_15_epochs.safetensors](https://huggingface.co/Remade-AI/Laughing/resolve/main/laughing_15_epochs.safetensors) |
| Remade-AI Cartoon_Jaw_Drop | wan2.1-i2v-14b-480p | dr0p_j88 comical jaw drop | Shocked | Apache-2.0 | [cartoon_jaw_drop_50_epochs.safetensors](https://huggingface.co/Remade-AI/Cartoon_Jaw_Drop/resolve/main/cartoon_jaw_drop_50_epochs.safetensors) |
| Remade-AI Jumpscare | wan2.1-i2v-14b-480p | j432mpscare jumpscare | Horror Face | Apache-2.0 | [jumpscare_35_epochs.safetensors](https://huggingface.co/Remade-AI/Jumpscare/resolve/main/jumpscare_35_epochs.safetensors) |
| artificialguybr Disintegration (Wan2.2 high noise) | wan2.2-i2v-a14b | Disintegration | Disintegration | CC0-1.0 | [\[Wan2.2\]Disintegration_Redmond_high_noise.safetensors](https://huggingface.co/artificialguybr/Disintegration-Redmond-WAN2-I2V-14B/resolve/main/%5BWan2.2%5DDisintegration_Redmond_high_noise.safetensors) |
| artificialguybr SkinMorph (Wan2.2 high noise) | wan2.2-i2v-a14b | see card | Morphskin / Skin Surge | CC0-1.0 | [\[WAN2.2\]SkinMorph_Redmond_high_noise.safetensors](https://huggingface.co/artificialguybr/SkinMorph-Redmond-WAN2-I2V-14B/resolve/main/%5BWAN2.2%5DSkinMorph_Redmond_high_noise.safetensors) |
| LTX-2 Squish (Comfy-Org template LoRA) | ltx-2-19b | squish it | - (no direct preset) | LTX-2 Community License | [ltx2-squish.safetensors](https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/loras/ltx2-squish.safetensors) |
| ovi054 LTX-2 Squish | ltx-2-19b | squish it | - (no direct preset) | other (see card) | [ltx-2-19b-squish-lora.safetensors](https://huggingface.co/ovi054/LTX-2-19b-Squish-LoRA/resolve/main/ltx-2-19b-squish-lora.safetensors) |
| kabachuha LTX-2 Inflate it | ltx-2-19b | infl4t3 it | Balloon (closest) | LTX-2 Community License | [ltx2-inflate.safetensors](https://huggingface.co/kabachuha/ltx2-inflate-it/resolve/main/ltx2-inflate.safetensors) |
| kabachuha LTX-2 Cakeify | ltx-2-19b | c4k3 cakeify it | - (no direct preset) | LTX-2 Community License | [ltx2-cakeify-v2.safetensors](https://huggingface.co/kabachuha/ltx2-cakeify/resolve/main/ltx2-cakeify-v2.safetensors) |
| TheBurgstall LTX-2.3 Googly Eyes | ltx-2.3-22b | googlyeyes | - | LTX-2 Community License | [googlyeyes-ltx-2.3-rank32-step03000.safetensors](https://huggingface.co/TheBurgstall/ltx-2.3-googlyeyes-lora/resolve/main/googlyeyes-ltx-2.3-rank32-step03000.safetensors) |
| LTX-2.3 Style Transition (joyfox, formerly valiantcat) | ltx-2.3-22b | zhuanchang (place near the end of the prompt) | Seamless Transition / Melt Transition (closest) | Apache-2.0 | [ltx2.3-transition.safetensors](https://huggingface.co/joyfox/LTX-2.3-Transition-LORA/resolve/main/ltx2.3-transition.safetensors) |
| SYSTMS INFL8 (Qwen-Image-Edit-2511, image) | qwen-image-edit-2511 | "Inflate the [subject]" | Balloon (closest; end frame for FLF2V) | Apache-2.0 | [SYSTMS_INFL8_LoRA_Qwen_Image_Edit_2511.safetensors](https://huggingface.co/systms/SYSTMS-INFL8-LoRA-Qwen-Image-Edit-2511/resolve/main/SYSTMS_INFL8_LoRA_Qwen_Image_Edit_2511.safetensors) |
| SYSTMS ACTION (Qwen-Image-Edit-2511, image) | qwen-image-edit-2511 | see card | - | Apache-2.0 | [QWEN_EDIT_ACTION_V1.safetensors](https://huggingface.co/systms/SYSTMS-ACTION-LoRA-Qwen-Image-Edit-2511/resolve/main/QWEN_EDIT_ACTION_V1.safetensors) |
| MiniMax H3 embedding art_is_explosion | minimax-h3 | embedding:minimaxh3_art_is_explosion | Explosion (closest) | MiniMax H3 Community (territory-restricted) | [minimaxh3_art_is_explosion.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_art_is_explosion.safetensors) |
| MiniMax H3 embedding fire_breath | minimax-h3 | embedding:minimaxh3_fire_breath | Fire Breathe | MiniMax H3 Community (territory-restricted) | [minimaxh3_fire_breath.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_fire_breath.safetensors) |
| MiniMax H3 embedding dark_magic | minimax-h3 | embedding:minimaxh3_dark_magic | Shadow Smoke (closest) | MiniMax H3 Community (territory-restricted) | [minimaxh3_dark_magic.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_dark_magic.safetensors) |
| MiniMax H3 embedding storm_magic | minimax-h3 | embedding:minimaxh3_storm_magic | Thunder God (closest) | MiniMax H3 Community (territory-restricted) | [minimaxh3_storm_magic.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_storm_magic.safetensors) |
| MiniMax H3 embedding blooming_flowers | minimax-h3 | embedding:minimaxh3_blooming_flowers | Garden Bloom / Nature Bloom | MiniMax H3 Community (territory-restricted) | [minimaxh3_blooming_flowers.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_blooming_flowers.safetensors) |
| MiniMax H3 embedding four_seasons | minimax-h3 | embedding:minimaxh3_four_seasons | World morphing (closest) | MiniMax H3 Community (territory-restricted) | [minimaxh3_four_seasons.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_four_seasons.safetensors) |
| MiniMax H3 embedding truman_show | minimax-h3 | embedding:minimaxh3_truman_show | - | MiniMax H3 Community (territory-restricted) | [minimaxh3_truman_show.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/embeddings/minimaxh3_truman_show.safetensors) |

#### style

| Name | Base model | Trigger | parity-studio-style preset | License | File |
|---|---|---|---|---|---|
| Remade-AI Vintage-VHS | wan2.1-t2v-14b | vh5_c4m3r4 old VHS style | Vintage | Apache-2.0 | [vhs_20_epochs.safetensors](https://huggingface.co/Remade-AI/Vintage-VHS/resolve/main/vhs_20_epochs.safetensors) |
| Remade-AI Zoom-Call | wan2.1-t2v-14b | [z00m_ca11] | - | Apache-2.0 | [zoom_call_10_epochs.safetensors](https://huggingface.co/Remade-AI/Zoom-Call/resolve/main/zoom_call_10_epochs.safetensors) |
| Remade-AI Doom-FPS | wan2.1-t2v-14b | [d00m doom first person gameplay] | - | Apache-2.0 | [doom_8_epochs.safetensors](https://huggingface.co/Remade-AI/Doom-FPS/resolve/main/doom_8_epochs.safetensors) |
| Remade-AI Pixar | wan2.1-t2v-14b | p1x4r_5ty13 Pixar animation style | - | Apache-2.0 | [pixar_10_epochs.safetensors](https://huggingface.co/Remade-AI/Pixar/resolve/main/pixar_10_epochs.safetensors) |
| Remade-AI Boxing | wan2.1-t2v-14b | B0x13ng Boxing Video | Boxing (camera motion) | Apache-2.0 | [boxing_10_epochs.safetensors](https://huggingface.co/Remade-AI/Boxing/resolve/main/boxing_10_epochs.safetensors) |
| Remade-AI Animal-Documentary | wan2.1-t2v-14b | 4n1m4l animal documentary | Documentary Snap (closest) | Apache-2.0 | [animal_doc_5_epochs.safetensors](https://huggingface.co/Remade-AI/Animal-Documentary/resolve/main/animal_doc_5_epochs.safetensors) |
| Remade-AI Cats | wan2.1-t2v-14b | ca45t cat video | - | Apache-2.0 | [cats_10_epochs.safetensors](https://huggingface.co/Remade-AI/Cats/resolve/main/cats_10_epochs.safetensors) |
| Remade-AI Dogs | wan2.1-t2v-14b | d48g dog video | - | Apache-2.0 | [dogs_5_epochs.safetensors](https://huggingface.co/Remade-AI/Dogs/resolve/main/dogs_5_epochs.safetensors) |
| Remade-AI Abandoned-Places | wan2.1-t2v-14b | abandoned places | - | Apache-2.0 | [abandoned_50_epochs.safetensors](https://huggingface.co/Remade-AI/Abandoned-Places/resolve/main/abandoned_50_epochs.safetensors) |
| Remade-AI Cyberpunk | wan2.1-t2v-14b | C783rpu5k Cyberpunk 2077 style | Hyper Neon (closest) | Apache-2.0 | [cyberpunk_20_epochs.safetensors](https://huggingface.co/Remade-AI/Cyberpunk/resolve/main/cyberpunk_20_epochs.safetensors) |
| Remade-AI Fantasy-Landscapes | wan2.1-t2v-14b | f4nt4sy_sc3n3 fantasy landscape | Wonderland (closest) | Apache-2.0 | [fantasy_50_epochs.safetensors](https://huggingface.co/Remade-AI/Fantasy-Landscapes/resolve/main/fantasy_50_epochs.safetensors) |
| Remade-AI Film-Noir | wan2.1-t2v-14b | f11m_n01r film noir, black and white video | Noir / Classic BW | Apache-2.0 | [film_noir_10_epochs.safetensors](https://huggingface.co/Remade-AI/Film-Noir/resolve/main/film_noir_10_epochs.safetensors) |
| Remade-AI Lego | wan2.1-t2v-14b | l3g0_5ty13 Lego animation style | - | Apache-2.0 | [lego_35_epochs.safetensors](https://huggingface.co/Remade-AI/Lego/resolve/main/lego_35_epochs.safetensors) |
| fal Qwen-Image-Edit-2511 Multiple Angles (96 poses) | qwen-image-edit-2511 | <sks> [azimuth] [elevation] [distance], e.g. "<sks> front view eye-level shot medium shot" | Angles | Apache-2.0 | [qwen-image-edit-2511-multiple-angles-lora.safetensors](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA/resolve/main/qwen-image-edit-2511-multiple-angles-lora.safetensors) |
| dx8152 Qwen-Edit-2509 Multiple-angles (Comfy-Org repack) | qwen-image-edit-2509 | none; "Move the camera left/right/forward", "Rotate the camera 45 degrees to the left", "Turn the camera to a top-down view" | Angles | Apache-2.0 | [Qwen-Edit-2509-Multiple-angles.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Edit-2509-Multiple-angles.safetensors) |
| Qwen-Image-Edit-2509 Relight (dx8152, Comfy-Org repack) | qwen-image-edit-2509 | 重新照明 (relight) + lighting description | Relight | Apache-2.0 | [Qwen-Image-Edit-2509-Relight.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Relight.safetensors) |
| Qwen-Image-Edit-2509 Light-Migration | qwen-image-edit-2509 | see template prompt (reference light transfer) | Relight from reference | Apache-2.0 | [Qwen-Image-Edit-2509-Light-Migration.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Light-Migration.safetensors) |
| Qwen-Image-Edit-2509 Fusion | qwen-image-edit-2509 | 溶图,纠正产品透视角度和光影并使产品融入背景 | Product placement / composite blend | Apache-2.0 | [Qwen-Image-Edit-2509-Fusion.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Fusion.safetensors) |
| Qwen-Image-Edit-2509 White_to_Scene | qwen-image-edit-2509 | see card (white-background product -> scene) | Product packshot to lifestyle scene | Apache-2.0 | [Qwen-Image-Edit-2509-White_to_Scene.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-White_to_Scene.safetensors) |
| Qwen-Image-Edit-2509 Anything2RealAlpha | qwen-image-edit-2509 | see template prompt (convert illustration/sketch to photo) | Sketch/Drawing to real | Apache-2.0 | [Qwen-Image-Edit-2509-Anything2RealAlpha.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Anything2RealAlpha.safetensors) |
| Hyperccino Qwen-Edit-2511 Anime-to-Photoreal v1.1 | qwen-image-edit-2511 | Kigurumi of the anime character, realistic details | Anime to real | Apache-2.0 | [qwen-image-edit-2511-anime-to-photoreal-v1.1.safetensors](https://huggingface.co/Hyperccino/Qwen-Edit-2511-Anime-to-Photoreal-v1.1/resolve/main/qwen-image-edit-2511-anime-to-photoreal-v1.1.safetensors) |
| tlennon qwen-edit-skin (skin detail enhancer) | qwen-image-edit-2509 | make the subjects skin details more prominent and natural | Skin enhancer | Apache-2.0 | [qwen-edit-skin.safetensors](https://huggingface.co/tlennon-ie/qwen-edit-skin/resolve/main/qwen-edit-skin.safetensors) |
| BFS head swap V5 (Qwen-Image-Edit-2511) | qwen-image-edit-2511 | head_swap prompt from BFS docs (V3+ body-first order) | Face swap | MIT | [bfs_head_v5_2511_merged_version_rank_16_fp16.safetensors](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/resolve/main/bfs_head_v5_2511_merged_version_rank_16_fp16.safetensors) |
| BFS head swap V1.1 (Qwen Image 2.1) | qwen-image-2.1 | see docs/qwen-image-2.1.md (<image1>/<image2>) | Face swap | MIT (base is non-commercial) | [bfs_head_v1.1_qwen_2.1.safetensors](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/resolve/main/bfs_head_v1.1_qwen_2.1.safetensors) |
| BFS head swap (FLUX.2 klein 4B) | flux2-klein-4b | see docs/flux-2-klein.md (Image 1 = target body, Image 2 = face) | Face swap | MIT | [bfs_head_v1_flux-klein_4b.safetensors](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/resolve/main/bfs_head_v1_flux-klein_4b.safetensors) |
| BFS head swap video (LTX-2.3) | ltx-2.3-22b | see repo workflow | Video face swap | LTX-2 Community License | [head_swap_v3_rank_64.safetensors](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap-Video/resolve/main/ltx-2.3/head_swap_v3_rank_64.safetensors) |
| ilkerzgi face-swap (FLUX.2 klein 9B) | flux2-klein-9b | face_swap: take the face from Picture 1 and swap it onto the person in Picture 2. | Face swap | FLUX Non-Commercial | [FS2_V5_r64_800_pytorch_lora_weights.safetensors](https://huggingface.co/ilkerzgi/face-swap/resolve/main/FS2_V5_r64_800_pytorch_lora_weights.safetensors) |
| ACE++ portrait LoRA (FLUX.1 Fill) | flux1-fill-dev | ACE++ instruction format (see repo) | Face swap / portrait consistency | see repo (base non-commercial) | [comfyui_portrait_lora64.safetensors](https://huggingface.co/ali-vilab/ACE_Plus/resolve/main/portrait/comfyui_portrait_lora64.safetensors) |
| Danrisi Lenovo UltraReal (Z-Image Turbo) | z-image-turbo | none | Soul photoreal look | Apache-2.0 | [lenovo_z.safetensors](https://huggingface.co/Danrisi/Lenovo_UltraReal_Z_Image/resolve/main/lenovo_z.safetensors) |
| Danrisi GrainScape UltraReal (Z-Image Turbo) | z-image-turbo | none | Film grain photoreal | Apache-2.0 | [grainscape_zimage.safetensors](https://huggingface.co/Danrisi/GrainScape_UltraReal_ZImage/resolve/main/grainscape_zimage.safetensors) |
| suayptalha Z-Image-Turbo Realism | z-image-turbo | Realism | Soul photoreal look | Apache-2.0 | [pytorch_lora_weights.safetensors](https://huggingface.co/suayptalha/Z-Image-Turbo-Realism-LoRA/resolve/main/pytorch_lora_weights.safetensors) |
| Danrisi Samsung UltraReal (Qwen-Image) | qwen-image | none | Phone-camera UGC look | Apache-2.0 | [Samsung.safetensors](https://huggingface.co/Danrisi/Qwen-image_SamsungCam_UltraReal/resolve/main/Samsung.safetensors) |
| flymy-ai Qwen-Image realism | qwen-image | none required (card prompts start with "Super Realism ...") | Photoreal | Apache-2.0 | [flymy_realism.safetensors](https://huggingface.co/flymy-ai/qwen-image-realism-lora/resolve/main/flymy_realism.safetensors) |
| RudySen Krea2 realism V2 | krea-2-turbo | none | Soul photoreal look | MIT | [Krea2-realism-V2.safetensors](https://huggingface.co/RudySen/Krea2-realism-V2/resolve/main/Krea2-realism-V2.safetensors) |
| gokaygokay Krea-2 Realism | krea-2 | none | Photoreal | Krea 2 Community | [krea2_realism_lora.safetensors](https://huggingface.co/gokaygokay/Krea-2-Realism-LoRA/resolve/main/krea2_realism_lora.safetensors) |
| Danrisi Canon UltraReal (Krea 2 RAW/Turbo) | krea-2 | none | DSLR photoreal | Apache-2.0 | [canon_krea2.safetensors](https://huggingface.co/Danrisi/Canon_UltraReal/resolve/main/canon_krea2.safetensors) |
| Krea 2 official style: darkbrush | krea-2-turbo | monochrome ink wash style | Style preset | Krea 2 Community | [krea2_darkbrush.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_darkbrush.safetensors) |
| Krea 2 official style: dotmatrix | krea-2-turbo | monochrome stippling style | Style preset | Krea 2 Community | [krea2_dotmatrix.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_dotmatrix.safetensors) |
| Krea 2 official style: kidsdrawing | krea-2-turbo | naive expressive sketch style | Style preset | Krea 2 Community | [krea2_kidsdrawing.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_kidsdrawing.safetensors) |
| Krea 2 official style: neondrip | krea-2-turbo | textured abstract style | Style preset | Krea 2 Community | [krea2_neondrip.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_neondrip.safetensors) |
| Krea 2 official style: rainywindow | krea-2-turbo | rainy window style | Style preset | Krea 2 Community | [krea2_rainywindow.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_rainywindow.safetensors) |
| Krea 2 official style: retroanime | krea-2-turbo | purple retro anime style | Style preset | Krea 2 Community | [krea2_retroanime.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_retroanime.safetensors) |
| Krea 2 official style: softwatercolor | krea-2-turbo | art deco watercolor style | Style preset | Krea 2 Community | [krea2_softwatercolor.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_softwatercolor.safetensors) |
| Krea 2 official style: sunsetblur | krea-2-turbo | ethereal motion blur style | Style preset | Krea 2 Community | [krea2_sunsetblur.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_sunsetblur.safetensors) |
| Krea 2 official style: vintagetarot | krea-2-turbo | vintage tarot style | Style preset | Krea 2 Community | [krea2_vintagetarot.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_vintagetarot.safetensors) |
| alvdansen illustration-1.0 (Qwen-Image) | qwen-image | see card | Illustration style | other (see card) | [illustration-1.0-qwen-image.safetensors](https://huggingface.co/alvdansen/illustration-1.0-qwen-image/resolve/main/illustration-1.0-qwen-image.safetensors) |
| tarn59 pixel art (Z-Image Turbo) | z-image-turbo | see card | Pixel art style | Apache-2.0 | [pixel_art_style_z_image_turbo.safetensors](https://huggingface.co/tarn59/pixel_art_style_lora_z_image_turbo/resolve/main/pixel_art_style_z_image_turbo.safetensors) |

#### speed

| Name | Base model | Trigger | parity-studio-style preset | License | File |
|---|---|---|---|---|---|
| Wan2.2 I2V Lightx2v 4-step v1 (high noise) | wan2.2-i2v-a14b | none (cfg 1, 4 steps) | Fast mode | Apache-2.0 | [wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors) |
| Wan2.2 I2V Lightx2v 4-step v1 (low noise) | wan2.2-i2v-a14b | none | Fast mode | Apache-2.0 | [wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors) |
| Wan2.2 I2V Lightx2v 4-step 1022 (high noise) | wan2.2-i2v-a14b | none | Fast mode | Apache-2.0 | [wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022.safetensors](https://huggingface.co/lightx2v/Wan2.2-Distill-Loras/resolve/main/wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022.safetensors) |
| Wan2.2 I2V Lightx2v 4-step 1022 (low noise) | wan2.2-i2v-a14b | none | Fast mode | Apache-2.0 | [wan2.2_i2v_A14b_low_noise_lora_rank64_lightx2v_4step_1022.safetensors](https://huggingface.co/lightx2v/Wan2.2-Distill-Loras/resolve/main/wan2.2_i2v_A14b_low_noise_lora_rank64_lightx2v_4step_1022.safetensors) |
| Wan2.2 T2V Lightx2v 4-step v1.1 (high noise) | wan2.2-t2v-a14b | none | Fast mode | Apache-2.0 | [wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors) |
| Wan2.2 T2V Lightx2v 4-step v1.1 (low noise) | wan2.2-t2v-a14b | none | Fast mode | Apache-2.0 | [wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors) |
| Wan2.2 T2V Lightx2v 4-step 1217 (high noise) | wan2.2-t2v-a14b | none | Fast mode | Apache-2.0 | [wan2.2_t2v_A14b_high_noise_lora_rank64_lightx2v_4step_1217.safetensors](https://huggingface.co/lightx2v/Wan2.2-Distill-Loras/resolve/main/wan2.2_t2v_A14b_high_noise_lora_rank64_lightx2v_4step_1217.safetensors) |
| Wan2.1 I2V 480p Lightx2v cfg-step distill rank64 | wan2.1-i2v-14b-480p | none (4-8 steps, cfg 1) | Fast mode (InfiniteTalk, Animate, SCAIL, VACE) | Apache-2.0 | [lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors) |
| Wan2.1 T2V Lightx2v cfg-step distill v2 rank64 | wan2.1-t2v-14b | none | Fast mode | Apache-2.0 | [lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors) |
| Wan2.1 CausVid 14B T2V rank32 | wan2.1-t2v-14b | none | Fast mode (VACE) | see repo | [Wan21_CausVid_14B_T2V_lora_rank32.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan21_CausVid_14B_T2V_lora_rank32.safetensors) |
| Qwen-Image Lightning 4-step | qwen-image | none | Fast mode | Apache-2.0 | [Qwen-Image-Lightning-4steps-V1.0.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Lightning-4steps-V1.0.safetensors) |
| Qwen-Image-2512 Lightning 4-step | qwen-image-2512 | none | Fast mode | Apache-2.0 | [Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors](https://huggingface.co/lightx2v/Qwen-Image-2512-Lightning/resolve/main/Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors) |
| Wuli Qwen-Image-2512 Turbo 2-step | qwen-image-2512 | none | Fast mode | Apache-2.0 | [Wuli-Qwen-Image-2512-Turbo-LoRA-2steps-V1.0-bf16.safetensors](https://huggingface.co/Wuli-art/Qwen-Image-2512-Turbo-LoRA-2-Steps/resolve/main/Wuli-Qwen-Image-2512-Turbo-LoRA-2steps-V1.0-bf16.safetensors) |
| Qwen-Image-Edit-2509 Lightning 4-step | qwen-image-edit-2509 | none | Fast mode | Apache-2.0 | [Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors) |
| Qwen-Image-Edit-2511 Lightning 4-step | qwen-image-edit-2511 | none | Fast mode | Apache-2.0 | [Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors) |
| Qwen Image 2.1 Turbo LoRA | qwen-image-2.1 | none | Fast mode | Qwen Research (non-commercial) | [qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/loras/qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors) |
| FLUX.2 [dev] Turbo LoRA (Comfy v2) | flux2-dev | none | Fast mode | see card | [Flux2TurboComfyv2.safetensors](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/loras/Flux2TurboComfyv2.safetensors) |
| Z-Image-Turbo distill patch LoRA | z-image-turbo | none | Fast mode | Apache-2.0 | [z_image_turbo_distill_patch_lora_bf16.safetensors](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/loras/z_image_turbo_distill_patch_lora_bf16.safetensors) |
| Krea 2 Turbo LoRA (rank 64) | krea-2-raw | none | Fast mode | Krea 2 Community | [krea2_turbo_lora_rank_64_bf16.safetensors](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_turbo_lora_rank_64_bf16.safetensors) |
| LTX-2 distilled LoRA 384 | ltx-2-19b | none | Fast mode | LTX-2 Community License | [ltx-2-19b-distilled-lora-384.safetensors](https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-distilled-lora-384.safetensors) |
| LTX-2.3 distilled 1.1 LoRA (dynamic rank) | ltx-2.3-22b | none (strength 0.5 in templates) | Fast mode | LTX-2 Community License | [ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors](https://huggingface.co/Comfy-Org/ltx-2.3/resolve/main/split_files/loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors) |
| LTX-2.5 distilled LoRA 450 | ltx-2.5-22b | none | Fast mode | LTX-2.x Community | [ltx-2.5-22b-distilled-lora-450-bf16.safetensors](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/loras/ltx-2.5-22b-distilled-lora-450-bf16.safetensors) (gated) |
| HunyuanVideo 1.5 T2V 480p Lightx2v 4-step | hunyuanvideo-1.5-480p | none | Fast mode | Tencent Hunyuan Community | [hunyuanvideo1.5_t2v_480p_lightx2v_4step_lora_rank_32_bf16.safetensors](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/loras/hunyuanvideo1.5_t2v_480p_lightx2v_4step_lora_rank_32_bf16.safetensors) |
| MiniMax H3 FL2V turbo 8-step | minimax-h3-fl2va | none | Fast mode | Apache-2.0 (LoRA) / H3 base restricted | [minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors) |
| MiniMax H3 FL2V turbo 4-step 768p | minimax-h3-fl2va | none | Fast mode | Apache-2.0 (LoRA) / H3 base restricted | [minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors) |
| MiniMax H3 Ref2V turbo 4-step | minimax-h3-ref2va | none | Fast mode | Apache-2.0 (LoRA) / H3 base restricted | [minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors) |

## 5. ComfyUI HTTP / WebSocket API (for the Fuobe backend)

Source of truth: `server.py` routes, `execution.py` messages and `comfy_api/latest/_ui.py` output shapes in [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI) (the old `comfyanonymous/ComfyUI` URL still serves the same repository), plus [Server Routes](https://docs.comfy.org/development/comfyui-server/comms_routes), [Server Messages](https://docs.comfy.org/development/comfyui-server/comms_messages), [API examples](https://docs.comfy.org/development/comfyui-server/api-examples) and [Workflow API format](https://docs.comfy.org/development/api-development/workflow-api-format).

### Endpoints

| Method | Path | Purpose / payload |
|---|---|---|
| POST | `/prompt` | Queue an API-format workflow Body: `{"prompt": {<api graph>}, "client_id": "<uuid used for /ws>", "prompt_id": "<optional client-chosen lowercase UUID>", "extra_data": {...}, "front": false, "number": <optional priority>, "partial_execution_targets": ["<output node id>", ...]}`. Response: 200 {"prompt_id", "number", "node_errors": {}}; 400 {"error": {type, message, details, extra_info}, "node_errors": {node_id: {...}}} on validation failure. |
| GET | `/prompt` | Queue summary {"exec_info": {"queue_remaining": n}} |
| GET | `/queue` | Running and pending items {"queue_running": [...], "queue_pending": [...]} (item = [number, prompt_id, prompt, extra_data, outputs_to_execute]) |
| POST | `/queue` | Manage queue: {"clear": true} or {"delete": ["<prompt_id>", ...]} (pending items only) |
| POST | `/interrupt` | Stop execution. Body {"prompt_id": "..."} interrupts only if that prompt is the one running; empty body = global interrupt |
| GET | `/history` | All history (query: max_items, offset) |
| GET | `/history/{prompt_id}` | One result: {prompt_id: {"prompt": [...], "outputs": {node_id: <ui dict>}, "status": {"status_str": "success"\|"error", "completed": bool, "messages": [[event, data], ...]}, "meta": {...}}} |
| POST | `/history` | Housekeeping: {"clear": true} or {"delete": ["<prompt_id>"]} |
| GET | `/api/jobs` | Newer normalized job list (status filter pending,in_progress,completed,failed; sort_by created_at\|execution_duration; limit/offset) incl. outputs_count and preview_output |
| GET | `/api/jobs/{job_id}` | Normalized job detail (job_id == prompt_id) |
| POST | `/api/jobs/{job_id}/cancel` | Cancel a pending or running job (also POST /api/jobs/cancel for several) |
| GET | `/view` | Download an output/input/temp file: ?filename=<name>&subfolder=<sub>&type=output\|input\|temp (also accepts filename=blake3:<hash> when the asset manager is enabled; preview/channel options) |
| POST | `/upload/image` | multipart/form-data: image=<file>, type=input\|temp\|output (default input), subfolder=<opt>, overwrite=true\|1. Returns {"name", "subfolder", "type"} - put "name" (with subfolder prefix if any) into LoadImage/LoadVideo/LoadAudio inputs. Works for any file type (videos/audio too). |
| POST | `/upload/mask` | multipart: image=<mask png>, original_ref=<json {filename, subfolder, type}> - writes alpha into the referenced image |
| GET | `/object_info` | Schema of every node class (inputs required/optional with types, defaults, combo values such as model filenames, outputs, output_node). /object_info/{node_class} for one node. Use it to validate/patch graphs and to list installed models. |
| GET | `/models` | Model folder types; GET /models/{folder} lists filenames (e.g. /models/loras) |
| GET | `/system_stats` | Python/ComfyUI version, devices, VRAM total/free - use for worker health and scheduling |
| POST | `/free` | {"unload_models": true, "free_memory": true} - unload models between heavy jobs |
| GET | `/embeddings, /extensions, /features, /workflow_templates, /view_metadata/{folder}` | Misc discovery |
| WS | `/ws?clientId=<client_id>` | Progress stream for prompts queued with the same client_id. JSON text frames {"type", "data"}; binary frames = previews (first 4 bytes big-endian event type: 1 PREVIEW_IMAGE, 2 UNENCODED_PREVIEW_IMAGE, 3 TEXT, 4 PREVIEW_IMAGE_WITH_METADATA). Optional first client message {"type":"feature_flags","data":{"supports_preview_metadata":true}}. |

### WebSocket messages (`ws://host:8188/ws?clientId=<client_id>`)

| type | when | data |
|---|---|---|
| `status` | on connect and whenever the queue changes | {"status": {"exec_info": {"queue_remaining": n}}, "sid": "<client id>"} (sid only on connect) |
| `execution_start` | prompt begins | {"prompt_id", "timestamp"} |
| `execution_cached` | start of execution | {"prompt_id", "nodes": [ids reused from cache], "timestamp"} |
| `executing` | a node starts; node=null means the prompt finished (legacy completion signal) | {"node": "<id>"\|null, "display_node": "<id>", "prompt_id"} |
| `progress` | sampler/step hooks (KSampler steps, etc.) | {"value", "max", "prompt_id", "node"} |
| `progress_state` | per-node state changes (new, preferred for multi-node/subgraph UIs) | {"prompt_id", "nodes": {node_id: {"value", "max", "state": "running"\|"finished"\|..., "node_id", "display_node_id", "parent_node_id", "real_node_id", "prompt_id"}}} |
| `executed` | an OUTPUT node returned a UI payload | {"node", "display_node", "prompt_id", "output": {"images": [...]} \| {"gifs": [...]} \| {"audio": [...]} \| {"text": [...]}} |
| `execution_success` | all nodes finished | {"prompt_id", "timestamp"} |
| `execution_error` | exception in a node | {"prompt_id", "node_id", "node_type", "executed", "exception_message", "exception_type", "traceback", "current_inputs", "current_outputs", "timestamp"} |
| `execution_interrupted` | after /interrupt | {"prompt_id", "node_id", "node_type", "executed", "timestamp"} |
| `feature_flags` | reply to client feature_flags handshake | server feature dict |
| `<custom>` | custom nodes may emit their own types via PromptServer.instance.send_sync | free-form |

### Notes

UI-format vs API-format: the frontend "Save" JSON is a LiteGraph document (nodes[] with id/type/pos/size/widgets_values, links[], groups, definitions.subgraphs, extra.ds, properties.models download hints). /prompt only accepts the API format exported via File -> Export (API): an object keyed by node id {"<id>": {"class_type": "...", "inputs": {name: value | ["<src id>", <output index>]}, "_meta": {"title": "..."}}}. Widget values become named inputs, links become [node_id, slot] pairs, and UI-only nodes (Note, MarkdownNote, Reroute, PrimitiveNode) disappear. Subgraphs (used by most 2026 templates) are flattened with composite ids such as "75:12". Converting UI->API needs /object_info to map widgets_values to input names (comfy-cli `comfy run` and the frontend do this); for Fuobe, keep exported API JSON per workflow and patch inputs by _meta.title or class_type. Video outputs in history: core SaveVideo/SaveWEBM report {"images": [{"filename", "subfolder", "type": "output"}], "animated": [true]} (ui.PreviewVideo); SaveAnimatedWEBP/PNG also use "images" + "animated"; VHS_VideoCombine (VideoHelperSuite) reports {"gifs": [{"filename", "subfolder", "type", "format": "video/h264-mp4", "frame_rate", "workflow", "fullpath"}]}; audio nodes report {"audio": [...]}; text/LLM preview nodes report {"text": [...]}. There is no "videos" key in core; treat any of images(animated)/gifs/videos defensively and download each via /view. Completion: wait for execution_success (or executing with node=null and matching prompt_id), then GET /history/{prompt_id}. Previews arrive as binary WS frames. Hosted alternatives: Comfy API v2 (jobs/assets/SSE) and an API proxy exist for running the same API-format graphs against Comfy Cloud or self-hosted servers with official Python/TypeScript SDKs.

### Minimal Fuobe job lifecycle

```text
1. (once) GET /object_info  -> cache node schemas & installed model names (combo values)
2. POST /upload/image (multipart image=@start.png, type=input, overwrite=true) -> {"name":"start.png","subfolder":"","type":"input"}
3. Load the stored API-format graph (exported via File -> Export (API)), patch inputs by node id or _meta.title:
     graph["97"]["inputs"]["image"] = "start.png"; graph["93"]["inputs"]["text"] = prompt; seeds, width/height/length, LoRA names...
4. Open ws://host:8188/ws?clientId=<uuid>   (same uuid as client_id below)
5. POST /prompt {"prompt": graph, "client_id": "<uuid>", "prompt_id": "<uuid4>"}  -> 400 + node_errors on validation failure
6. Stream: execution_start -> execution_cached -> executing/progress/progress_state (+ binary previews) -> executed (per output node) -> execution_success | execution_error | execution_interrupted
7. GET /history/<prompt_id> -> outputs[node_id]: {"images":[...], "animated":[true]} (SaveVideo) | {"gifs":[...]} (VHS_VideoCombine) | {"audio":[...]}
8. GET /view?filename=<f>&subfolder=<s>&type=output  -> bytes; then POST /history {"delete":[prompt_id]} and optionally POST /free
Cancel: POST /interrupt {"prompt_id": ...} (running) or POST /queue {"delete": [prompt_id]} (pending) or POST /api/jobs/<id>/cancel
```

Example `/history` entry for a Wan video job (core SaveVideo):

```json
{"<prompt_id>": {"prompt": [3, "<prompt_id>", {"...": "graph"}, {"client_id": "..."}, ["108"]],
  "outputs": {"108": {"images": [{"filename": "ComfyUI_00001_.mp4", "subfolder": "video", "type": "output"}], "animated": [true]}},
  "status": {"status_str": "success", "completed": true, "messages": [["execution_start", {"prompt_id": "...", "timestamp": 0}], ["execution_success", {"prompt_id": "...", "timestamp": 0}]]},
  "meta": {"108": {"...": "per-output-node metadata (node_id, display_node, ...)"}}}}
```
(A `filename_prefix` such as `"video/ComfyUI"` (the Wan templates' SaveVideo default) is split into `subfolder: "video"` and `filename`; always pass both back to `/view`.)


### Installing custom nodes and models

**ComfyUI-Manager** (now `Comfy-Org/ComfyUI-Manager`; Desktop starts ComfyUI with `--enable-manager`; manual installs: `pip install -r manager_requirements.txt` then `python main.py --enable-manager`) installs registry/Git nodes, detects missing nodes in a loaded workflow ("Install Missing Custom Nodes"), and downloads models listed in a workflow's `properties.models`. Headless: `cm-cli` (`python cm-cli.py install <pack>`, `save-snapshot`, `restore-snapshot`, `install-deps`, `deps-in-workflow --workflow wf.json --output deps.json`).

**comfy-cli** (`pip install comfy-cli`):

```bash
comfy install --nvidia                 # ComfyUI + matching PyTorch (unattended)
comfy launch --background -- --listen 0.0.0.0 --port 8188
comfy node install comfyui-wanvideowrapper          # registry id; uses cm-cli underneath
comfy node install-deps --workflow my_workflow.json  # install everything a workflow needs
comfy node save-snapshot / restore-snapshot <file>
comfy model download --url https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors \
  --relative-path models/diffusion_models
comfy model list --relative-path models/loras
comfy --json run --workflow wf_api.json --wait | comfy download   # submit + fetch outputs (local or cloud)
```

`comfy model download` options (comfy-cli source, newer than the docs reference page): `--url` (required), `--relative-path` (default `models/checkpoints`), `--filename`, `--set-hf-api-token` / env `HF_API_TOKEN`, `--set-civitai-api-token` / env `CIVITAI_API_TOKEN`, `--downloader httpx|aria2`, `--background`. Gated Hugging Face repos (FLUX 3 Klein, LTX-2.5, Krea 2, several Lightricks IC-LoRAs) need the license accepted on the model page plus an HF token. Plain `git clone <repo> custom_nodes/<name> && pip install -r requirements.txt` still works for any node pack.

**Model folders** (ComfyUI/models/...): `diffusion_models` (alias `unet`), `checkpoints`, `text_encoders` (alias `clip`), `vae`, `loras`, `clip_vision`, `controlnet`, `model_patches` (USO projector, InfiniteTalk, Z-Image/Qwen Fun ControlNets, SUPIR), `audio_encoders` (wav2vec2, whisper), `latent_upscale_models` (LTX, HunyuanVideo SR), `upscale_models` (ESRGAN family), `background_removal` (BiRefNet), `frame_interpolation` (RIFE/FILM), `geometry_estimation` (MoGe, Depth Anything 3), `detection`, `embeddings`, `optical_flow`. Use `extra_model_paths.yaml` to share a model store across workers.


## 6. Gaps, weak spots and risks

* **No open model matches Kling 3 / Veo 3.1 / Seedance 2.x end-to-end.** Closest: LTX-2.5 (audio, multishot, 4K) and MiniMax H3 (best fidelity, but license excludes US/EU/UK/KR and needs a commercial license for outputs). Wan 2.2 remains the most permissive high-quality video base but has no audio and 16 fps/5 s clips.
* **Camera presets** need a per-preset LoRA/prompt table; only pan/zoom are deterministic in Wan 2.2 Fun Camera. Orbit/bullet time/crash zoom rely on Wan 2.1-era Remade LoRAs (480p) or H3/LTX LoRAs. Uni3C/ReCamMaster are wrapper-only.
* **Foley (video-to-audio)** has no core node and the two good models are non-commercial (MMAudio) or territory-restricted (HunyuanVideo-Foley); prefer joint audio models (LTX-2.x) for commercial use.
* **TTS** is entirely custom-node based in ComfyUI; consider running TTS as a separate Fuobe microservice (Chatterbox/Qwen3-TTS) and passing audio files into ComfyUI.
* **Face swap** realism is now LoRA-based (BFS) and good, but needs consent/abuse safeguards; InsightFace swapper weights are non-commercial.
* **Very new releases** (FLUX 3 Image Klein 2026-10-15, Qwen Image 2.1 Turbo 2026-10-09/13, LTX-2.5, H3) may change templates/settings quickly; pin ComfyUI versions (`minComfyUIVersion` in index.json: e.g. 0.41.0 for FLUX 3 Klein, 0.37.2 for Qwen Image 2.1, 0.36.0 for Wan Animate 2, 0.32.0 for LTX-2.5) and template revisions per Fuobe release.
* **Many new templates are subgraphs**: export each to API format once and keep a mapping of user-facing parameters to flattened node ids.

## 7. Sources

- [Companion the parity studio's inventory (camera motion / effect names)](parity-inventory.json)
- [Comfy-Org/workflow_templates (templates/index.json and template JSONs)](https://github.com/Comfy-Org/workflow_templates/tree/main/templates)
- [ComfyUI source (server.py, execution.py, comfy_api/latest/_ui.py, comfy_extras/nodes_video.py, comfy_execution/progress.py, protocol.py)](https://github.com/Comfy-Org/ComfyUI)
- [docs.comfy.org index (llms.txt)](https://docs.comfy.org/llms.txt)
- [Server routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [Server messages](https://docs.comfy.org/development/comfyui-server/comms_messages)
- [API examples](https://docs.comfy.org/development/comfyui-server/api-examples)
- [Workflow API format](https://docs.comfy.org/development/api-development/workflow-api-format)
- [ComfyUI-Manager install](https://docs.comfy.org/manager/install)
- [comfy-cli getting started / reference](https://docs.comfy.org/comfy-cli/getting-started)
- [comfy-cli source (model download options)](https://github.com/Comfy-Org/comfy-cli/blob/main/comfy_cli/command/models/models.py)
- [Z-Image-Turbo tutorial](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo)
- [FLUX 3 Image Klein tutorial](https://docs.comfy.org/tutorials/flux/flux-3-klein)
- [BFL FLUX 3 Image Klein docs](https://docs.bfl.ml/flux_3/flux3_image_klein)
- [FLUX.2 dev tutorial](https://docs.comfy.org/tutorials/flux/flux-2-dev)
- [FLUX.2 klein tutorial](https://docs.comfy.org/tutorials/flux/flux-2-klein)
- [FLUX.1 Kontext dev tutorial](https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev)
- [Krea 2 tutorial](https://docs.comfy.org/tutorials/image/krea/krea-2)
- [Qwen Image 2.1 tutorial](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1)
- [Qwen Image 2.1 ComfyUI blog](https://blog.comfy.org/p/qwen-image-21-in-comfyui-open-weight)
- [Qwen-Image-Edit-2511 tutorial](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511)
- [Qwen-Image-2512 tutorial](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2512)
- [HiDream-O1 tutorial](https://docs.comfy.org/tutorials/image/hidream/hidream-o1)
- [OmniGen2 tutorial](https://docs.comfy.org/tutorials/image/omnigen/omnigen2)
- [Wan 2.2 tutorial](https://docs.comfy.org/tutorials/video/wan/wan2_2)
- [Wan 2.2 Fun Camera](https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-camera)
- [Wan 2.2 Fun Control](https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-control)
- [Wan 2.2 S2V](https://docs.comfy.org/tutorials/video/wan/wan2-2-s2v)
- [Wan 2.2 Animate](https://docs.comfy.org/tutorials/video/wan/wan2-2-animate)
- [Wan Animate 2](https://docs.comfy.org/tutorials/video/wan/wan-animate-2)
- [Wan-Animate-2 model card](https://huggingface.co/Wan-AI/Wan-Animate-2-14B)
- [SCAIL-2](https://docs.comfy.org/tutorials/video/zai/scail2)
- [InfiniteTalk](https://docs.comfy.org/tutorials/video/wan/wan-infinitetalk)
- [Wan VACE](https://docs.comfy.org/tutorials/video/wan/vace)
- [Wan FLF2V](https://docs.comfy.org/tutorials/video/wan/wan-flf)
- [HunyuanVideo 1.5](https://docs.comfy.org/tutorials/video/hunyuan/hunyuan-video-1-5)
- [LTX-2.3](https://docs.comfy.org/tutorials/video/ltx/ltx-2-3)
- [LTX-2.5](https://docs.comfy.org/tutorials/video/ltx/ltx-2-5)
- [LTX-2.5 day-0 blog](https://blog.comfy.org/p/ltx-25-day-0-support-in-comfyui)
- [LTX-2.x license](https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x)
- [MiniMax H3 overview / native / prompt guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)
- [MiniMax H3 license](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)
- [Genjutsu partner node](https://docs.comfy.org/tutorials/partner-nodes/{studio}/genjutsu-motion-transfer)
- [SeedVR2 native](https://docs.comfy.org/tutorials/utility/seedvr2)
- [Image / video upscale](https://docs.comfy.org/tutorials/utility/image-upscale)
- [Frame interpolation](https://docs.comfy.org/tutorials/utility/frame-interpolation)
- [BiRefNet background removal](https://docs.comfy.org/tutorials/utility/remove-background-birefnet)
- [SAM 3 video segmentation](https://docs.comfy.org/tutorials/utility/video-segment-sam3)
- [VOID video inpainting](https://docs.comfy.org/tutorials/utility/void-video-inpainting)
- [ACE-Step 1.5](https://docs.comfy.org/tutorials/audio/ace-step/ace-step-v1-5)
- [MiniMax Music 3](https://docs.comfy.org/tutorials/audio/minimax/minimax-music-3)
- [Stable Audio 3](https://docs.comfy.org/tutorials/audio/stable-audio/stable-audio-3)
- [YuE2](https://docs.comfy.org/tutorials/audio/yue2/yue2)
- [Qwen3.5 / Gemma 4 text generation](https://docs.comfy.org/tutorials/llm/qwen/qwen3_5)
- [kijai ComfyUI-WanVideoWrapper (supported extra models)](https://github.com/kijai/ComfyUI-WanVideoWrapper)
- [ostris ai-toolkit (supported models)](https://github.com/ostris/ai-toolkit)
- [kohya musubi-tuner](https://github.com/kohya-ss/musubi-tuner)
- [Remade-AI LoRAs (69 models)](https://huggingface.co/Remade-AI)
- [BFS Best Face Swap](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap)
- [fal Qwen-Image-Edit-2511 Multiple Angles LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA)
- [Lightricks LTX-2.3 DubIt IC-LoRA](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-DubIt)
- [FLUX Kommunity License (gated repo)](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy)
- [Qwen-Image-2.1 license (Qwen Research)](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)
- [HunyuanVideo 1.5 license](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5/blob/master/LICENSE)
- [Hugging Face model API (sizes, licenses)](https://huggingface.co/api/models)
- [Wan 3.0 / 2.x open-weights status (secondary)](https://www.atlascloud.ai/blog/tips/is-wan-3.0-open-source)
- [MiniMax H3 open weights coverage (secondary)](https://comfyui-wiki.com/en/news/2026-08-03-minimax-h3-open-weights-comfyui)
- [Krea 2 open weights coverage (secondary)](https://dev.to/damogallagher/krea-releases-krea-2-as-open-weights-for-image-generation-13pe)
- [Qwen-Image-2.1 coverage (secondary)](https://aiweekly.co/alerts/alibaba-ships-qwen-image-21-7b-dit-with-native-2048x2048-and-rgba-drops-apache)
- [the parity studio's camera presets (secondary)](https://bibigpt.co/en/features/{studio}-ai-video-generator-explained)
- [the parity studio's features overview (secondary)]({studio-service}/{studio}-ai-features-full-guide-2026)
- [ComfyUI-LatentSyncWrapper](https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper)
- [kijai ComfyUI-MMAudio](https://github.com/kijai/ComfyUI-MMAudio)
- [Chatterbox ComfyUI nodes](https://github.com/filliptm/ComfyUI_Fill-ChatterBox)
- [Qwen3-TTS ComfyUI nodes](https://github.com/1038lab/ComfyUI-QwenTTS)
- [VideoHelperSuite (VHS_VideoCombine output format)](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)
