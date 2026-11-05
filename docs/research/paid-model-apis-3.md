# Paid model APIs, part 3: layers, styles, video restyle, captions, audio, ads and Cinema Studio helpers

As of **2026-10-17**. This extends [`paid-model-apis.md`](./paid-model-apis.md) and [`paid-model-apis-2.md`](./paid-model-apis-2.md). It covers the paid endpoints behind this round's missing the parity studio's features: Layers, Moodboards and Soul HEX, Photodump and Fashion Factory, Shorts Studio and Mixed Media, Cinema Studio's image grid, Soul Cast and Soul Location, Ads Studio, Ad Multiplier, Marketing Studio, Click to Ad, Faceless Studio / Explainer, captions, dubbing, sound effects and music.

The machine-readable companion is [`paid-model-apis-3.json`](./paid-model-apis-3.json). It holds **206 endpoint records**: 165 fal and 41 Replicate. 9 of them re-verify endpoints that parts 1 and 2 already had, to add palette and style fields; the other 197 are new. The JSON also holds the per-feature recommendations, the gaps and the conventions.

## How this was verified

- **fal schemas** come from each endpoint's OpenAPI document, `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`, parsed by a script. Field names, enums, defaults and limits were not retyped by hand. Nested objects and arrays keep their full sub-schema (`itemSchema`, `fields`). New in part 3: the **output** schema is kept too, as `outputFields`, because several features depend on structured results (Seedream layer boxes, Ideogram text containers, transcript words).
- **fal prices** come from `https://fal.ai/models/<id>/llms.txt`. For unlisted apps without an `llms.txt` (Beatoven) the price comes from the `Billing` block embedded in the model page. **fal status** comes from the full catalog at `https://api.fal.ai/v1/models` (1,516 active endpoints on 2026-10-17) and `?endpoint_id=` lookups for ids outside it.
- **Candidates** came from searching the whole fal catalog (every category) and Replicate's search API (`https://replicate.com/api/search`), plus 110 guessed fal ids probed by OpenAPI. A `null` body means the endpoint does not exist; those misses are listed in the gaps.
- **Replicate schemas** come from the `dereferenced_openapi_schema`, `billingConfig` and latest `version` embedded in each model page.
- **The parity studio**: `{studio-docs}/llms-full.txt`, `docs/openapi.json`, the public pricing API and 30 guessed per-model `llms.txt` ids. Nothing new beyond [`parity-api.json`](./parity-api.json) (section 2).
- **Skipped**: every endpoint already recorded in parts 1 and 2, unless a field was missing.
- **No paid inference calls were made.** Behaviour the schemas do not state is marked *unverified*.

### Loading it into the catalog

`scripts/gen-cloud-models.py` loads parts 1 and 2. Part 3 merges the same way, with four lines after the part 2 loop:

```python
RESEARCH_3 = json.loads((ROOT / "docs/research/paid-model-apis-3.json").read_text())
for e in RESEARCH_3["endpoints"]:
    prev = EPS.get((e["provider"], e["endpoint"]))
    EPS[(e["provider"], e["endpoint"])] = {**e, "keyFields": {**((prev or {}).get("keyFields") or {}), **(e.get("keyFields") or {})}}
```

This was checked on a scratch copy of the script:

- With part 3 merged, `cloud-models.generated.ts` comes out **byte-identical** for the 86 existing models. The re-verified endpoints keep every field they had and only gain new key-field slots.
- Probe models on 12 new endpoints all built routes without warnings: Seedream layerize, HappyHorse edit, Lucy Edit 2 and WhisperX on Replicate, Mirelo, CassetteAI, Sonilo, MiniMax Music 2.5, Recraft V4.1 and V4 Styles, LTX reference v2v, and Kling O3 4K reference.
- The new slots (`palette`, `styleId`, `numLayers`, `tracks`, `startTime` and others) are not read by `build_route` yet. The studio code that needs them should read them from the route's research record.

## 1. Recommended default per Fuobe feature

| Fuobe feature | Default | Exact key fields | Alternatives |
|---|---|---|---|
| **Layers: decompose an image** | `bytedance/seedream/v5/pro/layerize` | image_url, prompt (optional; &lt;bbox>l t r b&lt;/bbox> targets a region), image_size auto\|auto_1K\|auto_1.5K\|auto_2K -> layers[{image.url, z_index, bounding_box{absolute,normalized}, name, description}] (base + <=16). Qwen: num_layers 1-10 -> images[] full-canvas RGBA (compute bbox from alpha). | bytedance/seedream/v5/flash/layerize; fal-ai/qwen-image-layered; fal-ai/qwen-image-layered/lora; replicate:qwen/qwen-image-layered; replicate:bytedance/seedream-5-pro (part 1, layer_decomposition:true) |
| **Layers: edit text** | `fal-ai/ideogram/v3/layerize-text` | image_url (+font_name_h1/h2/body/small) -> image (text removed) + text_containers (container->items->spans) + text_html; rewrite_text: image_url + new_text; OCR boxes: results.quad_boxes[{x,y,w,h,label}] | bria/fibo-edit/rewrite_text; fal-ai/florence-2-large/ocr-with-region + fal-ai/nano-banana-pro/edit (instruction 'change "X" to "Y"'); replicate:ideogram-ai/ideogram-4-5-precise-edit (mask black = edit); fal-ai/image-editing/text-removal (then browser text); replicate:flux-kontext-apps/text-removal |
| **Layers: remove background / cut out object** | `fal-ai/ideogram/remove-background` | image_url -> image.url (RGBA); extract-object: image_url + prompt -> image + mask | fal-ai/birefnet/v2 (part 1); bria/guided-remove-background (plain-language fix-ups); bria/extract-object (by name, returns mask); replicate:recraft-ai/recraft-remove-background; replicate:bria/product-cutout |
| **Layers: add element (generate a transparent layer)** | `fal-ai/ideogram/v3/generate-transparent` | prompt, aspect_ratio (ratio enum), rendering_speed, num_images -> images[] PNG with alpha | any t2i + fal-ai/ideogram/remove-background |
| **Vectorize / SVG export** | `fal-ai/recraft/vectorize` | image_url -> image.url (.svg) | fal-ai/image2svg (VTracer, $0.005); replicate:recraft-ai/recraft-vectorize; text-to-SVG: fal-ai/recraft/v4.1/text-to-vector (colors palette), replicate:recraft-ai/recraft-v4.1-svg |
| **Moodboards (style from reference images)** | `recraft/v4/create-style + recraft/v4/style/text-to-image` | create-style: image_urls (1-10) [+image_weights], base_style any\|vector_illustration, match precise\|flexible -> style_id; then style_id (or image_urls inline) + prompt + colors on recraft/v4/style/* | fal-ai/krea-2/turbo/style (1-3 refs, zero-shot); fal-ai/ideogram/v3 (image_urls style refs); fal-ai/flux-pro/v1.1-ultra/redux (one image prompt); fal-ai/nano-banana-pro/edit / bytedance/seedream/v5/pro/edit / fal-ai/flux-2-pro/edit with the board as references (part 1); {studio}:{studio}/soul/v2/standard style_id (the parity studio's curated moodboards only); LoRA training on the board (part 2 trainers) |
| **Soul HEX: palette-conditioned generation** | `fal-ai/recraft/v4.1/text-to-image` | Recraft: colors [{r,g,b}] + background_color {r,g,b}; Ideogram 3: color_palette {members:[{rgb:{r,g,b}, color_weight 0.05-1}]} or {name: EMBER\|FRESH\|JUNGLE\|MAGIC\|MELON\|MOSAIC\|PASTEL\|ULTRAMARINE} | fal-ai/ideogram/v3 color_palette.members; recraft/v4.1/flash/text-to-image ($0.007 preview); recraft/v4/style/text-to-image (style + palette); {studio}:recraft/v4.1/text-to-image colors[{rgb:[r,g,b]}]; {studio}:{studio}/cinema-studio/4.0 color_palette (slug of the parity studio's 50 palettes); other models: hex list in the prompt + palette transfer (open graph) |
| **Color transfer (apply a palette to an existing image/video)** | `(no cloud palette-transfer endpoint) fal-ai/telestyle-v2 with a palette swatch as style_image_url` | content_image_url + style_image_url (+lora_scale) | fal-ai/image-editing/color-correction (part 2); fal-ai/post-processing/color-tint; browser WebGL grade (Fuobe Color Grading); open: palette-transfer-image/video ComfyUI graphs |
| **Photodump Studio** | `{studio}:{studio}/soul/v2/standard (custom_reference_id = Soul ID)` | one job per pack photo/style; prompt from the pack, the character reference as image_urls / custom_reference_id | fal-ai/nano-banana-pro/edit (selfie + pack photo per output); bytedance/seedream/v5/pro/edit; fal-ai/instant-character (one photo, no training) |
| **Fashion Factory (outfit on a character)** | `fal-ai/fashn/tryon/v1.6` | model_image + garment_image, category auto\|tops\|bottoms\|one-pieces, mode performance\|balanced\|quality, garment_photo_type auto\|flat-lay\|model, num_samples | google/virtual-try-on; bria/fibo-edit-1.5/virtual-try-on (several garments); replicate:prunaai/p-image-try-on (up to 6-11 garments); fal-ai/image-apps-v2/virtual-try-on; fal-ai/leffa/virtual-tryon; fal-ai/nano-banana-pro/edit (person + garment); fal-ai/kling/v1-5/kolors-virtual-try-on (deprecated) |
| **Cinema Studio: image grid (2x2/3x3/4x4; freeform, zooms, shots, next/prev shots)** | `fal-ai/nano-banana-pro (one N x N contact-sheet image, cropped client-side; part 1)` | multiple-angles: image_urls, horizontal_angle 0-360, vertical_angle -30..90, zoom 0-10, additional_prompt; next-scene: image_urls + 'Next Scene: ...' prompt | fal-ai/qwen-image-edit-2511-multiple-angles (zooms/shots: one tile per angle/zoom); fal-ai/qwen-image-edit-plus-lora-gallery/next-scene (next_shots/prev_shots); fal-ai/flux-2-lora-gallery/multiple-angles; fal-ai/nano-banana-2 (cheaper sheet) |
| **Cinema Studio: Soul Cast (AI actors)** | `{studio}:{studio}/soul/v2/standard (cast prompt compiled from the 17 fields)` | prompt from the Soul Cast form; batch up to 10 | {studio}:{studio}/ai-influencer (character sheet); fal-ai/instant-character (keep a cast member consistent from one photo); fal-ai/nano-banana-pro |
| **Cinema Studio: Soul Location** | `bytedance/seedream/v5/pro/text-to-image (16:9 empty set; part 1)` | prompt <=2,500 chars; another view = horizontal_angle/vertical_angle/zoom on the set image | fal-ai/qwen-image-edit-2511-multiple-angles ('another view'); fal-ai/image-editing/scene-composition (place the cast in the set); {studio}:{studio}/soul/cinema |
| **Cinema Studio: 3D scene blocking -> shot** | `minimax/h3-max/3d-to-video` | video_url (Blender proxy <=15 s), prompt, reference_image_urls, resolution 480P\|768P\|1080P | fal-ai/qwen-image-edit-2511-multiple-angles (re-render a still from the chosen camera); image-to-3d: fal-ai/hunyuan-3d/v3.1/pro/image-to-3d |
| **Shorts Studio (restyle your footage: <=2 min in, <=10 s segments out)** | `google/gemini-omni-flash/v1.1/edit (part 1; the model the parity studio's Shorts Studio runs on)` | pipeline: fal-ai/ffmpeg-api/metadata (validate 4-120 s, <=200 MB) -> fal-ai/workflow-utilities/trim-video (start_time,end_time per <=10 s segment) -> edit model (video_url, prompt = preset text, style reference images) -> fal-ai/workflow-utilities/scale-video (9:16 or 16:9) -> fal-ai/ffmpeg-api/merge-videos ('stitch') -> fal-ai/workflow-utilities/auto-subtitle (type presets) | alibaba/happy-horse/video-edit (3-60 s sources, but at most 15 s out: split longer clips; corrected 2026-10-29); decart/lucy-edit/pro; replicate:decart/lucy-edit-2 ($0.04/s); fal-ai/kling-video/o3/pro/video-to-video/edit (part 1) / fal-ai/kling-video/o3/4k/video-to-video/edit; luma/agent/ray/v3.2/video-to-video (part 2); replicate:runwayml/aleph-2; replicate:wan-video/wan-2.7-videoedit; xai/grok-imagine-video/edit-video (<=8 s); fal-ai/bernini-r/reference-edit-video; {studio}:{studio}/genjutsu/restyle/v1.0 (the parity studio's own preset restyle) |
| **Mixed Media (stylized VFX looks on video)** | `fal-ai/workflow-utilities/extract-nth-frame -> fal-ai/telestyle-v2 (per frame, fixed seed) -> fal-ai/ffmpeg-api/images-to-video -> fal-ai/ffmpeg-api/merge-audio-video` | extract-nth-frame: video_url, frame_interval (source fps / target fps), max_frames <=500; images-to-video: images[{url, frames}] (<=200) + fps | fal-ai/ltx-2.3-22b/reference-video-to-video (preprocessor depth\|canny\|pose + restyled first frame image_url); fal-ai/ltx-2.3-quality/reference-video-to-video; decart/lucy-edit/pro; fal-ai/ltx-2.3-quality/render-to-real; fal-ai/workflow-utilities/blend-video (grain/light-leak overlays); per-frame editor alternatives: fal-ai/nano-banana-2/edit, fal-ai/flux-pro/kontext (part 1); minimax/h3-max/styles/* (generation in VHS/16-bit/hand-drawn/low-poly/retro-toon looks) |
| **Video trimming / splitting / assembly utilities** | `fal-ai/workflow-utilities/trim-video` | trim: video_url, start_time, end_time (or duration); compose: tracks[{id,type,keyframes[{url,timestamp ms,duration ms}]}] -> video_url | fal-ai/ffmpeg-api/merge-videos; fal-ai/ffmpeg-api/compose (timeline with audio tracks); fal-ai/workflow-utilities/scale-video; fal-ai/workflow-utilities/reverse-video; fal-ai/workflow-utilities/extract-audio; fal-ai/ffmpeg-api/extract-frame; fal-ai/ffmpeg-api/metadata; fal-ai/ffmpeg-api/loudnorm |
| **Transcription** | `fal-ai/elevenlabs/speech-to-text/scribe-v2` | audio_url, language_code, diarize, keyterms -> text + words[{text,start,end,type,speaker_id}] | fal-ai/whisper (word chunks, diarize); fal-ai/wizper; replicate:elevenlabs/scribe-v2; replicate:victor-upmeet/whisperx; replicate:xai/grok-speech-to-text; fal-ai/elevenlabs/forced-alignment (known script -> word timings) |
| **Captions / burned-in subtitles** | `fal-ai/workflow-utilities/auto-subtitle` | video_url, language, font_name (Google font), font_size, font_color, highlight_color, stroke_*, position, words_per_subtitle, enable_animation | veed/subtitles (30 presets, SRT burn-in, translation); fal-ai/auto-caption; replicate:fictions-ai/autocaption |
| **Translate & dub (cloud)** | `fal-ai/elevenlabs/dubbing (part 2)` | dubbing: video_url\|audio_url, target_lang, source_lang, num_speakers; re-sync: video + audio | fal-ai/heygen/v2/translate/precision (lip-synced; part 2); replicate:elevenlabs/dubbing (part 2); replicate:heygen/video-translate (part 2); pipeline: fal-ai/workflow-utilities/extract-audio -> fal-ai/elevenlabs/speech-to-text/scribe-v2 -> LLM translation -> fal-ai/elevenlabs/tts/eleven-v3 -> fal-ai/demucs (keep the music/effects bed) -> fal-ai/ffmpeg-api/compose -> fal-ai/sync-lipsync/v2 or replicate:heygen/lipsync-precision |
| **Sound effects (text to SFX)** | `mirelo-ai/sfx2.0/text-to-audio` | prompt, negative_prompt, duration 0.1-600, num_samples 1-4 -> audio[] | fal-ai/elevenlabs/sound-effects/v2 (part 1); sonilo/v1.1/text-to-sound-effects; fal-ai/stable-audio-3/small/sfx/text-to-audio; cassetteai/sound-effects-generator ($0.01); beatoven/sound-effect-generation; bytedance/seed-audio-1.0; fal-ai/mmaudio-v2/text-to-audio (part 1) |
| **Sound for a video (video to SFX)** | `mirelo-ai/sfx2.0/video-to-video` | video_url, text_prompt, preserve_speech (true), duration, num_samples -> video[] | sonilo/v1.1/video-to-sound-effects; fal-ai/thinksound/audio; mirelo-ai/sfx2.0/video-to-audio (part 1); replicate:mirelo/video-to-sfx-v1.5; cassetteai/video-sound-effects-generator; replicate:tencent/hunyuanvideo-foley |
| **Music** | `sonilo/v1.1/text-to-music` | prompt, duration 1-600, num_samples 1-3 | elevenlabs/music/v2.5 (part 1); fal-ai/lyria3/pro; fal-ai/minimax-music/v2.5; beatoven/music-generation; fal-ai/stable-audio-25/text-to-audio; mureka/api/generate/song; replicate:google/lyria-3-pro; music for a video: sonilo/v1.1/video-to-music |
| **Ads Studio (URL -> brand kit -> batch static ads)** | `{studio}:{studio}/ads-studio/v1.0` | brand kit = server-side fetch of the URL + LLM extraction (no model endpoint); per ad: product image_urls, prompt with headline/CTA, aspect 1:1\|4:5\|9:16, batch <=20 | fal-ai/nano-banana-pro/edit or openai/gpt-image-2.5/sunburst/edit with product + logo refs and the brand palette in the prompt (part 1); fal-ai/ideogram/v3 (color_palette + exact headline text); bria/embed-product (fixed template layout); fal-ai/bria/product-shot; fal-ai/ideogram/remove-background (logo/product cut-outs) |
| **Ad Multiplier (reference ad -> new product/cast/location/hook)** | `{studio}:bytedance/seedance-2.5/video-edit (the model the parity studio's Ad Multiplier runs on)` | The parity studio: video_url (4-30 s) + image_urls (<=20 @-mentions) + prompt (or hook/CTA text) + resolution 480p\|720p\|1080p; Kling: video_url (3-15 s) + prompt (@Video1, @Image1..) + image_urls/elements + keep_audio; recast: video_url + reference_image_urls (1-4 people) | fal-ai/kling-video/o3/pro/video-to-video/edit (part 1); google/gemini-omni-flash/v1.1/edit (part 1); fal-ai/kling-video/o3/4k/video-to-video/reference; minimax/h3-max/recast (swap the cast); alibaba/happy-horse/video-edit (swap product via reference_image_urls); replicate:runwayml/aleph-2 (edit keyframes); replicate:kwaivgi/kling-v3-omni-video (video_reference_type base\|feature); bytedance/seedance-2.5/reference-to-video (part 2, video_urls + image_urls) |
| **Marketing Studio / product photography** | `fal-ai/bria/product-shot` | image_url + scene_description \| ref_image_url, placement_type, shot_size, num_results | fal-ai/image-apps-v2/product-photography; pixelcut/product-photo; fal-ai/qwen-image-edit-plus-lora-gallery/integrate-product; bria/fibo-edit-1.5/product-holding (UGC still); replicate:bria/product-packshot; replicate:bria/product-shadow; fal-ai/bria/background/replace; {studio}:marketing-studio/image (templates; part HF) |
| **Click to Ad (product URL -> video ad)** | `{studio}:marketing-studio/image + Fuobe chain: fal-ai/bria/product-shot -> kling/seedance i2v (part 1) -> fal-ai/workflow-utilities/auto-subtitle -> sonilo/v1.1/text-to-music -> fal-ai/ffmpeg-api/compose` | scraped product images + LLM script; per shot i2v; narration TTS; compose tracks | argil/avatars/text-to-video (UGC presenter); fal-ai/heygen/v3/video-agent (one-shot ad from prompt + product files); fal-ai/vidu/template-to-video (templated product effects); bria/fibo-edit-1.5/product-holding (UGC stills) |
| **Product spin / image-to-3D** | `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` | input_image_url (+back/left/right views), enable_pbr, face_count -> model_glb.url; spin rendered in the browser (three.js turntable) or a rendered frame -> i2v | fal-ai/trellis-2 (open MIT weights); fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d; tripo3d/h3.1/image-to-3d; meshy/v7.1/image-to-3d (rigging); fal-ai/hyper3d/rodin/v2.5; replicate:tencent/hunyuan-3d-3.1 |
| **Faceless Studio / Explainer (script -> scenes -> narrated video)** | `Fuobe chain: LLM script -> google/gemini-omni-flash/image-to-video per 10 s block (part 1; what the parity studio's Faceless/Explainer skills use) -> fal-ai/elevenlabs/tts/eleven-v3 (part 1) or fal-ai/inworld-tts -> fal-ai/elevenlabs/forced-alignment -> fal-ai/ffmpeg-api/compose (+ sonilo/v1.1/text-to-music bed) -> fal-ai/workflow-utilities/auto-subtitle` | compose tracks: one image/video track with keyframes per scene (timestamp/duration ms from the alignment), audio tracks for narration + music | fal-ai/heygen/v3/video-agent (one call); fal-ai/sensenova-u1-infographic (diagram scenes); argil/avatars/text-to-video (presenter); pixverse/music-video/vibemv (song -> music video) |
| **Katana (rebuild a reference edit with <=5 photos)** | `fal-ai/kling-video/o3/4k/video-to-video/reference` | video_url (reference edit 3-15 s) + image_urls (the user's photos as @Image1..) + prompt | fal-ai/kling-video/o3/pro/video-to-video/reference (part 1); bytedance/seedance-2.5/reference-to-video (part 2); replicate:kwaivgi/kling-v3-omni-video (feature reference) |

## 2. The parity studio's own API for this round

The parity studio has no public endpoint for most of this round's features. Its public API was re-checked: the docs dump, the OpenAPI file, the pricing API (the same 31 model families and 83 modes as on 2026-10-16) and 30 guessed per-model docs. None of these exist:

- Cinema Studio image or grid
- Soul Cast or Soul Location
- Layers
- Shorts Studio or Mixed Media
- Photodump or Fashion Factory
- Moodboard training
- Soul HEX
- Click to Ad

Every guessed id returned 404 at `{studio-dashboard}/models/<id>/llms.txt`. The guesses included `{studio}/cinema-studio/image`, `{studio}/cinematic-studio-image-grid`, `{studio}/soul-cast`, `{studio}/soul-location`, `{studio}/layers`, `{studio}/shorts-studio/v1.0`, `{studio}/mixed-media/v1.0`, `{studio}/photodump/v1.0`, `{studio}/fashion-factory/v1.0`, `{studio}/soul/hex`, `{studio}/soul/moodboard` and `{studio}/click-to-ad`.

These are the parts of the already-recorded the parity studio's endpoints that serve this round's features. Their inputs are in `parity-api.json`.

| Fuobe use | The parity studio's endpoint | Field |
|---|---|---|
| Curated moodboards (Soul 2.0 styles) | `{studio}/soul/v2/standard`, `{studio}/soul/v2/image-to-image` | `style_id`, `style_strength` (the 33 Soul 2.0 preset ids in `parity-image-studios.json`) |
| Soul HEX palette | `recraft/v4.1/text-to-image` (and `/pro`, `/utility`) | `colors: [{rgb:[R,G,B]}]`, `background_color: {rgb:[R,G,B]}` |
| Cinema Studio palette and light | `{studio}/cinema-studio/4.0` | `color_palette` (50 slugs, e.g. `neon-rain-at-midnight`), `light`, `genre`, `era`, `camera_*` |
| Shorts Studio-style preset restyle | `{studio}/genjutsu/restyle/v1.0` | `video_url`, `preset_id`, `image_urls` |
| Ad Multiplier / video edit | `bytedance/seedance-2.5/video-edit`, `video-extend` | `video_url(s)`, `image_urls`, `audio_urls` |
| Ads Studio | `{studio}/ads-studio/v1.0` | `niche`, `prompt`, `language`, `batch_size`, `image_urls`, `aspect_ratio`, `target_audience` |
| Marketing Studio product shots | `marketing-studio/image` (+ `flare`, `sunburst`) | `preset_id` (from `/marketing-studio/image/presets`) |
| Soul Cast / character sheet | `{studio}/ai-influencer`, `{studio}/soul/v2/standard` + Soul ID | `custom_reference_id` |

Fuobe therefore builds the grid, Soul Cast, Soul Location, Layers, Shorts Studio and Mixed Media from the third-party endpoints below, even on a parity-studio key.

## 3. Layers: decomposition, text, background and vector

| Endpoint | Provider / status | Op | Key fields (* = required) | Output | Price | Notes |
|---|---|---|---|---|---|---|
| `bytedance/seedream/v5/pro/layerize` | fal | layer-decompose | `image_url`*, `prompt`, `image_size` | `layers[].image.url` | $0.03375/layer | The same model Layers runs on (Seedream 5.0 layer decomposition). Returns layers[] = base image (z_index 0) + up to 16 transparent PNG layers ordered by z_index, each with bounding_box {absolute:[l,t,r,b] px, normalized:[l,t,r,b] 0-1000}, name and d... |
| `bytedance/seedream/v5/flash/layerize` | fal | layer-decompose | `image_url`*, `prompt`, `image_size` | `layers[].image.url` | $0.027/image | Cheaper/faster Seedream 5.0 Flash variant of layerize; same output shape (layers[] with z_index, bounding_box, name, description). No enhance_prompt_mode. Priced per generated image (layer). |
| `fal-ai/qwen-image-layered` | fal | layer-decompose | `image_url`*, `prompt`, `num_layers`, `negative_prompt`, `seed` | `images[].url` | $0.05/image | Open-weight model (Apache-2.0), the same one the ComfyUI route runs. Returns num_layers (1-10, default 4) full-canvas RGBA PNGs in images[]: no names, z-order = array order (index 0 = bottom/background), no boxes: compute each bbox from alpha in the browser. |
| `fal-ai/qwen-image-layered/lora` | fal | layer-decompose | `image_url`*, `prompt`, `num_layers`, `negative_prompt`, `seed`, `loras` | `images[].url` | $0.06/image | Same as fal-ai/qwen-image-layered plus loras[{path,scale}] (max 3), e.g. the DiffSynth Layered-Control LoRA for prompt-guided splits. |
| `fal-ai/ideogram/v3/layerize-text` | fal | text-layerize | `image_url`*, `prompt`, `seed`, `font_name_h1`, `font_name_h2`, `font_name_body`, `font_name_small` | `image.url` | $0.09/image | For Layers 'Edit text' on posters/ads: returns image = the background with all text removed, text_containers = structured text (container -> items -> spans, with positions/typography), text_html = an overlay that re-renders the text over the background, image_... |
| `bria/ad-delayer` | fal | layer-decompose | `image_url` | `(free-form JSON, unpublished)` | $0.3/request | Flat ad -> editable layers: background, product and logo cutouts, live text with typography and vector shapes, as structured JSON (fal category image-to-json). |
| `fal-ai/ideogram/v3/generate-transparent` | fal | t2i-transparent | `prompt`*, `aspect_ratio`, `num_images`, `negative_prompt`, `seed`, `rendering_speed` | `images[].url` | $0.03/image (TURBO) | Text -> PNG with alpha. Use for Layers 'Add element' (generate a new layer to place on the canvas) and for ad stickers/badges. aspect_ratio is a ratio enum (1:3..3:1); rendering_speed TURBO\|BALANCED\|QUALITY sets the price. |
| `bria/extract-object` | fal | segment | `image_url`, `prompt` | `image.url` | $0.02/image | Cut one object out by name ('the red car'): returns image (RGBA cut-out) and mask. autocrop tightens the canvas; remove_background:true refines alpha with RMBG. Useful for Layers 'Select object' and product cut-outs. |
| `fal-ai/ideogram/remove-background` | fal | bg-remove | `image_url`* | `image.url` | $0.01/image | Foreground on transparent PNG; $0.01, cheapest commercial remover found this round. |
| `bria/guided-remove-background` | fal | bg-remove | `image_url`, `prompt` | `image.url` | $0.03/image | Background removal with an optional plain-language correction of what to keep/drop ('keep the shadow', 'remove the hand'). autocrop optional. |
| `bria/fibo-edit/rewrite_text` | fal | text-edit | `image_url`*, `new_text`* | `images[].url` | $0.04/image | Replaces the text in an image with new_text while keeping typography/placement. Takes only the replacement string (no 'find' field), so for a single text block. |
| `fal-ai/image-editing/text-removal` | fal | text-remove | `image_url`*, `aspect_ratio`, `seed` | `images[].url` | $0.04/image | Removes all text from an image (FLUX Kontext based app). Step 1 of 'Edit text' when the new text is laid out by the browser. |
| `fal-ai/florence-2-large/ocr-with-region` | fal | ocr | `image_url`* | `results.quad_boxes[]` | $0/compute-second | Returns results.quad_boxes[{x,y,w,h,label}] (label = the text) plus an annotated image. Gives the text boxes Layers 'Edit text' needs to offer each string for editing. Listed at $0 per compute second (compute-billed; real cost unverified without a key). |
| `fal-ai/florence-2-large/ocr` | fal | ocr | `image_url`* | `results` | $0/compute-second | Plain text only (results string), no boxes. |
| `fal-ai/got-ocr/v2` | fal | ocr | `input_image_urls` | `outputs[]` | $0.05/image | Batch OCR; do_format returns formatted (markdown/LaTeX) text; multi_page joins images into one output. No boxes. |
| `fal-ai/recraft/vectorize` | fal | vectorize | `image_url`* | `image.url` | $0.01/image | Raster -> SVG (image.url is the .svg). PNG/JPG/WEBP <5 MB. Best quality for logos/illustrations; Layers 'Export SVG' and ad assets. |
| `fal-ai/image2svg` | fal | vectorize | `image_url`* | `images[].url` | $0.005/image | Deterministic VTracer tracing (no model; VTracer is MIT-licensed): colormode color\|binary, hierarchical stacked\|cutout, mode spline\|polygon, plus filter_speckle/color_precision/layer_difference/corner/length/splice thresholds. $0.005; |
| `fal-ai/vecglypher/image-to-svg` | fal | t2svg | `prompt`*, `reference_image_urls`* | `image.url` | $0.005/image | Text -> vector glyphs styled like 1-8 reference glyph images (returns svg_content + image). For logo/wordmark lettering in a given style, not general vectorization. |
| `fal-ai/recraft/v4.1/text-to-vector` | fal | t2svg | `prompt`*, `image_size`, `colors`, `background_color` | `images[].url` | $0.08/image | Text -> SVG. colors = [{r,g,b}] preferred palette, background_color = {r,g,b}: the Soul HEX palette maps straight onto these (hex -> rgb). |
| `fal-ai/recraft/v4.1/pro/text-to-vector` | fal | t2svg | `prompt`*, `image_size`, `colors`, `background_color` | `images[].url` | $0.3/image | Pro (detailed) SVG; same fields as V4.1 Vector. |
| `qwen/qwen-image-layered` | replicate | layer-decompose | `image`*, `num_layers`, `description` | `output` | $0.03/request | Official. num_layers 2-8 (default 4); description = caption ('auto' = auto-caption). output = array of layer image URIs (full-canvas RGBA). go_fast=true: $0.03/run + $0.01/image. |
| `ideogram-ai/layerize` | replicate | text-layerize | `flat_graphic_image`*, `prompt`, `font_name_h1`, `font_name_h2`, `font_name_body`, `font_name_small` | `output` | $0.09/image | Official. Replicate returns only an array of URIs (no structured text_containers / text_html like fal), so prefer fal-ai/ideogram/v3/layerize-text for Edit text. $0.09. |
| `recraft-ai/recraft-vectorize` | replicate | vectorize | `image`* | `output` | $0.01/image | Official. Output = SVG URI. $0.01. |
| `recraft-ai/recraft-v4.1-svg` | replicate | t2svg | `prompt`*, `aspect_ratio`, `size` | `output` | $0.04/image | Official. No colors/background_color on Replicate (palette only via fal/{studio} Recraft). $0.04. |
| `recraft-ai/recraft-remove-background` | replicate | bg-remove | `image`* | `output` | $0.01/image | Official. $0.01. |
| `flux-kontext-apps/text-removal` | replicate | text-remove | `input_image`*, `aspect_ratio` | `output` | $0.04/image | Official app. $0.04. |
| `datalab-to/ocr` | replicate | ocr | `file`* | `output` | $0.002/page | Official. Text lines with bounding boxes/polygons and reading order (return_pages:true for per-line boxes); images or documents. $2 per 1000 pages. |
| `ideogram-ai/ideogram-4-5-precise-edit` | replicate | edit | `prompt`*, `image`*, `mask`, `reference_images`, `num_images`, `quality` | `output` | $0.008/image | Official. Mask is BLACK = edit, WHITE = keep (Ideogram convention); <=4 references (3 with mask). Strong text rendering: 'Edit text' via masked text box + new wording. quality very_low\|low\|medium\|high ($0.008/$0.03/$0.06/$0.22). |

**What Layers actually returns, and how to map it.** `bytedance/seedream/v5/pro/layerize` is the Seedream 5.0 decomposition that the parity studio's Layers is built on. Its output maps straight onto Fuobe's layer model:

```json
{"layers": [
  {"image": {"url": "...base.png"}, "z_index": 0},
  {"image": {"url": "...l1.png"}, "z_index": 1, "name": "red sneaker", "description": "...",
   "bounding_box": {"absolute": [412, 220, 980, 760], "normalized": [322, 172, 766, 594]}}
], "images": [{"url": "...base.png"}, {"url": "...l1.png"}]}
```

- `z_index` maps to the layer order.
- `bounding_box.absolute` maps to the crop and offset of the "cropped/positioned layers" zip export.
- `name` maps to the layer label.
- `prompt` takes `<bbox>l t r b</bbox>` tags (0-1000 coordinates), which is how "Separate this region" works.

Qwen-Image-Layered (fal or Replicate) returns plain full-canvas RGBA layers. Compute each box from alpha in the browser, which also covers the open (ComfyUI) route. The zip itself is client-side work and needs no endpoint.

**Edit text, three ways:**
1. **Structured (default).** `fal-ai/ideogram/v3/layerize-text` returns the background with the text removed, `text_containers` (container → items → spans) and `text_html`. The editor lets the user change the spans and re-renders them in the browser, or bakes the new text with an instruction edit.
2. **One block.** `bria/fibo-edit/rewrite_text` (`image_url` + `new_text`).
3. **Find and replace.** `fal-ai/florence-2-large/ocr-with-region` gives `quad_boxes[{x,y,w,h,label}]`. The user picks a string, and Fuobe sends a masked edit (Replicate `ideogram-ai/ideogram-4-5-precise-edit`: mask **black = edit**) or an instruction edit on Nano Banana Pro / Seedream 5 ("change the text 'SALE' to 'NEW'").

## 4. Style references, moodboards and palettes

| Endpoint | Provider / status | Op | Key fields (* = required) | Output | Price | Notes |
|---|---|---|---|---|---|---|
| `recraft/v4/create-style` | fal | style-create | `image_urls`*, `image_weights`, `base_style`, `match` | `style_id` | $0.005/request | Moodboard -> reusable style_id from 1-10 reference images (optional per-image weights). base_style any\|vector_illustration, match precise\|flexible. Use the returned style_id with recraft/v4/style/* (and parity-studio-like 'Moodboards' that are reused). |
| `recraft/v4/pro/create-style` | fal | style-create | `image_urls`*, `image_weights`, `base_style`, `match` | `style_id` | $0.005/request | Same inputs and price as V4 create-style. Both recraft/v4/style/* and recraft/v4/style/pro/* take 'the ID of an existing V4 custom style' (uuid4); whether ids from the two create endpoints are interchangeable is not documented. |
| `fal-ai/recraft/v3/create-style` | fal | style-create | `images_data_url`*, `base_style` | `style_id` | $0.04/request | Legacy V3: a .zip URL of <=5 PNGs -> style_id for fal-ai/recraft/v3/text-to-image style_id. Prefer the V4 create-style. |
| `recraft/v4/style/text-to-image` | fal | t2i-style | `prompt`*, `image_size`, `colors`, `background_color`, `style_id`, `image_urls`, `style_match` | `images[].url` | $0.035/image | Text -> image in a custom style: pass style_id, or 1-10 image_urls to create one on the fly (+$0.005; the new style_id is returned so the next call can reuse it). Also takes the colors palette, so Moodboard + Soul HEX combine in one call. |
| `recraft/v4/style/pro/text-to-image` | fal | t2i-style | `prompt`*, `image_size`, `colors`, `background_color`, `style_id`, `image_urls`, `style_match` | `images[].url` | $0.1/image | Pro tier of Recraft V4 Styles ($0.10/image). |
| `recraft/v4/style/text-to-vector` | fal | t2svg | `prompt`*, `image_size`, `colors`, `background_color`, `style_id`, `image_urls`, `style_match` | `images[].url` | $0.05/image | SVG output in a custom style. |
| `recraft/v4.1/flash/text-to-image` | fal | t2i | `prompt`*, `image_size`, `colors`, `background_color` | `images[].url` | $0.007/image | Fast, $0.007/image Recraft with the colors/background_color palette fields: a cheap palette preview for Soul HEX. |
| `fal-ai/flux-pro/v1.1-ultra/redux` | fal | style-ref | `prompt`, `image_url`*, `image_prompt_strength`, `aspect_ratio`, `num_images`, `seed` | `images[].url` | $0.05/megapixel | Image prompt (one reference) + text. image_prompt_strength 0-1 (default 0.1) blends the reference look in; aspect_ratio is a ratio string. One reference only: for a moodboard pick the cover image or composite a grid. |
| `fal-ai/flux-pro/v1.1/redux` | fal | style-ref | `prompt`, `image_url`*, `image_size`, `num_images`, `seed` | `images[].url` | $0.05/megapixel | Redux variation on FLUX1.1 pro; no strength control (prompt steers). |
| `fal-ai/flux/dev/redux` | fal | style-ref | `image_url`*, `image_size`, `num_images`, `seed` | `images[].url` | $0.025/megapixel | Variation only (no prompt field). Open FLUX.1-dev weights are non-commercial; fal's catalog lists the endpoint's outputs as commercial-use. |
| `fal-ai/krea-2/turbo/style` | fal | t2i-style | `prompt`*, `reference_image_urls`*, `style_scale`, `image_size`, `num_images`, `seed` | `images[].url` | $0.01/megapixel | Text -> image in the style of 1-3 reference images (style adapter, style_scale 0-4). $0.01/MP: the cheapest zero-shot moodboard route. |
| `fal-ai/telestyle-v2` | fal | style-transfer | `content_image_url`*, `style_image_url`*, `lora_scale`, `image_size`, `negative_prompt`, `num_images`, `seed` | `images[].url` | $0.035/megapixel | Content image + one style image -> restyled image (VLM-described content and style are added to the prompt by default). Good for Mixed Media per-frame looks and 'apply moodboard to my photo'. |
| `fal-ai/image-apps-v2/style-transfer` | fal | style-transfer | `image_url`*, `style_reference_image_url`, `target_style`, `aspect_ratio` | `images[].url` | $0.04/image | Preset styles (anime_character, cartoon_3d, hand_drawn_animation, cyberpunk_future, comic_book_animation, ...) or a reference image. aspect_ratio is an object {ratio}. |
| `fal-ai/image-editing/style-transfer` | fal | style-transfer | `image_url`*, `prompt`, `aspect_ratio`, `seed` | `images[].url` | $0.04/image | Style named in text ('Van Gogh's Starry Night'); FLUX Kontext app. |
| `bria/fibo-edit/restyle` | fal | style-transfer | `image_url`*, `style`* | `images[].url` | $0.04/image | Commercial-safe restyle into a fixed style enum (3D Render, Cubism, Oil Painting, Anime, Cartoon, Coloring Book, Retro Ad, Pop Art Halftone, Vector Art, ...). |
| `fal-ai/post-processing/color-tint` | fal | color-grade | `image_url`*, `tint_strength`, `tint_mode` | `images[].url` | $0.001/image | Deterministic tint (sepia/red/.../warm/cool/vintage) at $0.001. Not a palette transfer; Fuobe's browser grade and the palette-transfer graphs cover palettes. |
| `ideogram/v4/image-to-image` | fal | i2i | `prompt`*, `image_url`*, `strength`, `image_size`, `num_images`, `seed`, `rendering_speed` | `images[].url` | $0.0075/megapixel | Ideogram 4 img2img (strength 0-1). Ideogram 4/4.5 have no style-reference or color-palette fields on fal; those live on Ideogram 3 (fal-ai/ideogram/v3, /remix). |
| `fal-ai/ideogram/v3` | fal | t2i | `prompt`*, `image_urls`, `color_palette`, `style_codes`, `style_preset`, `style`, `image_size`, `num_images`, `negative_prompt`, `seed`, `rendering_speed` | `images[].url` | $0.03/image (TURBO) | Re-verified for palettes/styles. color_palette = {name: EMBER\|FRESH\|JUNGLE\|MAGIC\|MELON\|MOSAIC\|PASTEL\|ULTRAMARINE} OR {members:[{rgb:{r,g,b}, color_weight 0.05-1 (default 0.5)}]}: Soul HEX palettes go in as members. |
| `fal-ai/ideogram/v3/remix` | fal | i2i | `prompt`*, `image_url`*, `image_urls`, `color_palette`, `style_codes`, `style`, `strength`, `image_size`, `num_images`, `negative_prompt`, `seed`, `rendering_speed` | `images[].url` | $0.03/image (TURBO) | Re-verified: remix an image with style references and a color_palette (same palette shape as fal-ai/ideogram/v3). strength 0.01-1 (default 0.8). |
| `fal-ai/recraft/v4.1/text-to-image` | fal | t2i | `prompt`*, `image_size`, `colors`, `background_color` | `images[].url` | $0.035/image | Re-verified: colors [{r,g,b}] + background_color {r,g,b} are the palette fields (Soul HEX). |
| `fal-ai/recraft/v4.1/pro/text-to-image` | fal | t2i | `prompt`*, `image_size`, `colors`, `background_color` | `images[].url` | $0.21/image | Re-verified: same palette fields as V4.1. |
| `fal-ai/recraft/v4/text-to-image` | fal | t2i | `prompt`*, `image_size`, `colors`, `background_color` | `images[].url` | $0.04/image | Re-verified: same palette fields as V4.1. |
| `fal-ai/recraft/v3/text-to-image` | fal | t2i | `prompt`*, `image_size`, `colors`, `style_id`, `style` | `images[].url` | $0.04/image | Re-verified: colors [{r,g,b}] (no background_color on V3) and style_id from fal-ai/recraft/v3/create-style. Vector styles cost 2x. |
| `black-forest-labs/flux-redux-dev` | replicate | style-ref | `redux_image`*, `aspect_ratio`, `num_outputs`, `seed` | `output` | $0.025/image | Official. Variation only (no prompt). $0.025. |
| `black-forest-labs/flux-redux-schnell` | replicate | style-ref | `redux_image`*, `aspect_ratio`, `num_outputs`, `seed` | `output` | $0.003/image | Official. $0.003/image. |
| `recraft-ai/recraft-v4-styles-pro-svg` | replicate | t2svg | `prompt`*, `aspect_ratio`, `size`, `style_id`, `style_reference_images`*, `style_match` | `output` | $0.12/image | Official. style_id OR 1-10 style_reference_images (schema marks style_reference_images required; send [] with style_id). Output object {image}. $0.12. |
| `recraft-ai/recraft-v4.1` | replicate | t2i | `prompt`*, `aspect_ratio`, `size` | `output` | $0.04/image | Official. Re-checked for palette support: Replicate's Recraft V4.1 has NO colors/background_color fields. |
| `ideogram-ai/ideogram-v4-quality` | replicate | t2i | `prompt`, `resolution` | `output` | $0.1/image | Official. Checked for style refs/palette: none (prompt or json_prompt + resolution only). $0.10. |

**Moodboards.** The parity studio trains personal moodboards from 5-80 images, and its API exposes only the curated ones (`style_id`). The hosted equivalents are:

- **Recraft V4 Styles** (default). `recraft/v4/create-style` takes 1-10 images (optional weights; `match` precise|flexible) and returns a `style_id` (uuid4). Store it on the style element and pass it to `recraft/v4/style/text-to-image` or `/text-to-vector`. Those calls also accept `image_urls` inline, which creates a style for $0.005 extra and returns its id.
- **Zero-shot.** `fal-ai/krea-2/turbo/style` (1-3 references, `style_scale` 0-4), `fal-ai/ideogram/v3` `image_urls`, or the FLUX Redux image prompt.
- **Multi-reference editors from part 1.** Nano Banana Pro, Seedream 5 and FLUX.2 edit with the board as references.
- **Training** for 20-80 image boards: the LoRA trainers in part 2.

**Soul HEX → API palette formats** (all from the schemas):

| Endpoint family | Field | Shape | From a Fuobe palette `{colors:["#E63946",...], background:"#F1FAEE"}` |
|---|---|---|---|
| fal Recraft V3/V4/V4.1 (+ Styles, Vector, Flash) | `colors`, `background_color` | `[{r,g,b}]`, `{r,g,b}` (0-255 ints) | hex → `{r,g,b}`; background → `background_color` (not on V3) |
| fal Ideogram 3 (`/v3`, `/remix`) | `color_palette` | `{members:[{rgb:{r,g,b}, color_weight 0.05-1}]}` or `{name: EMBER\|FRESH\|JUNGLE\|MAGIC\|MELON\|MOSAIC\|PASTEL\|ULTRAMARINE}` | weight = share of the palette (default 0.5) |
| Recraft 4.1 | `colors`, `background_color` | `[{rgb:[R,G,B]}]`, `{rgb:[R,G,B]}` | hex → `[R,G,B]` |
| Cinema Studio 4.0 | `color_palette` | slug string (one of 50) | only the built-in palettes |
| Bria packshot/shadow (Replicate) | `background_color` | hex string or `transparent` | as is |
| Everything else (Nano Banana, Seedream, GPT Image, FLUX.2, Soul) | (none) | add "Color palette: #E63946 #457B9D ... (background #F1FAEE)" to the prompt | then optionally lock with palette transfer |

Replicate's Recraft V4.1 and the Ideogram 4/4.5 endpoints (fal and Replicate) have **no** palette or style-reference fields; both were checked. There is no hosted "apply this palette to an existing picture" endpoint. Keep the browser grade and the open `palette-transfer-*` graphs for colour transfer.

## 5. Video restyle and edit (Shorts Studio, Mixed Media, Ad Multiplier)

| Endpoint | Provider / status | Op | Key fields (* = required) | Output | Price | Notes |
|---|---|---|---|---|---|---|
| `decart/lucy-edit/pro` | fal / **unlisted** | restyle | `prompt`*, `video_url`*, `seed`, `resolution` | `video.url` | $0.15/second | Instruction video edit/restyle that keeps motion ('make it anime', 'change the jacket to red'). Unlisted on fal's catalog (schema served). 720p only. Prompt <=1500 chars, enhance_prompt default true. |
| `decart/lucy-edit/fast` | fal / **deprecated** | restyle | `prompt`*, `video_url`*, `seed` | `video.url` | $0.04/second | Catalog status deprecated (still served). $0.04/s. Prefer decart/lucy-edit/pro or Replicate decart/lucy-edit-2. |
| `decart/lucy-edit/dev` | fal / **deprecated** | restyle | `prompt`*, `video_url`*, `seed` | `video.url` | $0.03/second | Catalog status deprecated (still served). Weights are public as decart-ai/Lucy-Edit-Dev on Hugging Face (custom license), so the open route can run the same model. |
| `fal-ai/kling-video/o3/4k/video-to-video/edit` | fal | restyle | `prompt`*, `video_url`*, `image_urls`, `elements`, `keep_audio` | `video.url` | $0.42/second | 4K output of Kling O3 edit (the pro/standard edit endpoints are in part 1). Reference the source as @Video1, images as @Image1.. (max 4 images+elements). Source .mp4/.mov 3-15 s, 720-3840 px, <=200 MB. $0.42/s. |
| `fal-ai/kling-video/o3/4k/video-to-video/reference` | fal | ref2v | `prompt`*, `video_url`*, `image_urls`, `elements`, `keep_audio`, `aspect_ratio`, `duration` | `video.url` | $0.42/second | New video that takes camera/motion/style from the reference video (Ad Multiplier 'same ad, new product'). duration is a STRING enum '3'..'15'. |
| `xai/grok-imagine-video/edit-video` | fal | restyle | `prompt`*, `video_url`*, `resolution` | `video.url` | $0.05/second of output (+$0.01 per second of input, 480p) | Text-instructed edit. The source is resized to <=854x480 area and TRUNCATED TO 8 s, so split Shorts Studio clips first. $0.05/s output + $0.01/s input at 480p. |
| `alibaba/happy-horse/video-edit` | fal | restyle | `prompt`*, `video_url`*, `reference_image_urls`, `resolution`, `audio_setting`, `seed` | `video.url` | $0.28/second of the clip (720p; $0.14 per input second + $0.14 per output second, already summed) | Takes 3-60 s sources, but the output is capped at 15 s (longer inputs are cut to their first 15 s), <=5 reference images (@Image1..), audio_setting auto\|origin (keep the original track). $0.28/s at 720p, $0.56/s at 1080p, per second of the clip. *Corrected 2026-10-29: the input seconds are not billed again on top, and the 15 s output cap was missed.* |
| `fal-ai/bernini-r/edit-video` | fal | restyle | `prompt`*, `video_url`*, `negative_prompt`, `seed` | `video.url` | $0.08/second | Instruction edit on open Bernini-R weights (also in Fuobe's ComfyUI library for relight). num_frames 5-121 (4k+1), fps 4-30, max_image_size 256-1280 (848 default). $0.08/s at 848 px, x0.5 <=576, x2 at 1280. |
| `fal-ai/bernini-r/reference-edit-video` | fal | restyle | `prompt`*, `video_url`*, `reference_image_urls`*, `negative_prompt`, `seed` | `video.url` | $0.08/second | Edit guided by 1-5 reference images (e.g. a style frame or a product). Same pricing as edit-video. |
| `minimax/h3-max/recast` | fal | character-swap | `video_url`*, `reference_image_urls`*, `prompt`, `resolution`, `seed` | `video.url` | $0.3/second | Replace the people in a 5-30 s video (no shot >15 s) with 1-4 new people (one photo each, left-to-right by default; prompt says who becomes whom). For Ad Multiplier 'change cast'. $0.30/s 768P, $0.45/s 1080P. |
| `fal-ai/ltx-2.3-22b/video-to-video` | fal | restyle | `prompt`*, `video_url`*, `negative_prompt`, `seed`, `generate_audio`, `video_strength`, `video_size` | `video.url` | $0.001605/megapixel | Open-weight LTX-2.3 v2v (same weights as the ComfyUI LTX route). video_strength 0-1 (default 0.01 = very free; raise to keep structure). match_video_length/match_input_fps default true; num_frames 9-481. Billed per megapixel-frame ($0.001605). |
| `fal-ai/ltx-2.3-22b/distilled/video-to-video` | fal | restyle | `prompt`*, `video_url`*, `negative_prompt`, `seed`, `generate_audio`, `video_strength`, `video_size` | `video.url` | $0.001205/megapixel | Distilled (fewer steps, $0.001205/MP-frame) variant. |
| `fal-ai/ltx-2.3-22b/reference-video-to-video` | fal | restyle | `prompt`*, `video_url`*, `audio_url`, `image_url`, `end_image_url`, `negative_prompt`, `seed`, `generate_audio`, `video_strength`, `preprocessor` | `video.url` | $0.001605/megapixel | IC-LoRA control video-to-video: preprocessor depth\|canny\|pose\|none extracts structure from the source, ic_lora_type union\|match_preprocessor\|detailer. |
| `fal-ai/ltx-2.3-quality/reference-video-to-video` | fal | restyle | `prompt`*, `video_url`*, `image_url`, `end_image_url`, `strength`, `generate_audio`, `resolution`, `negative_prompt`, `seed` | `video.url` | $0.0024075/megapixel | Quality tier: first/mid/last keyframe images anchor the look (image_url, mid_image_url, end_image_url); video_strength (0.6) controls how much motion/structure is kept; preserve_original_video:true = true v2v from the source; |
| `fal-ai/ltx-2.3-quality/render-to-real` | fal | restyle | `video_url`*, `image_url`, `prompt`, `resolution`, `generate_audio`, `seed` | `video.url` | $0.0024075/megapixel | IC-LoRA: CG/3D/game render -> photoreal ('3DREAL.' trigger is pre-filled). intensity light\|strong\|strong-v2. Mixed Media 'reverse' look. |
| `fal-ai/wan-vace-apps/video-edit` | fal | restyle | `prompt`*, `video_url`*, `image_urls`, `resolution`, `aspect_ratio` | `video.url` | $0.1/second | Open Wan VACE instruction edit with reference images; video_type auto\|general\|human; auto-downsamples long/high-fps input. $0.10/s 720p, $0.075 580p, $0.05 480p (seconds at 16 fps). |
| `fal-ai/krea-wan-14b/video-to-video` | fal | restyle | `prompt`*, `video_url`*, `strength`, `seed` | `video.url` | $0.025/request | SDEdit-style v2v with denoise strength (0.85 default). Output limited to 16:9 480p. $0.025/s. |
| `fal-ai/editto` | fal | restyle | `prompt`*, `video_url`*, `negative_prompt`, `resolution`, `aspect_ratio`, `seed` | `video.url` | $0.08/second | Instruction video editing (Wan based). num_frames 17-241; match_input_num_frames / match_input_frames_per_second to keep timing. $0.08/s 720p. |
| `minimax/h3-max/styles/vhs` | fal | t2v-style | `prompt`*, `image_url`, `duration`, `aspect_ratio`, `seed` | `video.url` | $0.08/second | Styled generation (text or first frame -> 5-15 s clip in the VHS look, audio included). Not video-to-video: for Mixed Media use it on a restyled first frame, or use a v2v model for real footage. damage_level light\|medium\|heavy |
| `minimax/h3-max/styles/16bit-pixel` | fal | t2v-style | `prompt`*, `image_url`, `duration`, `aspect_ratio`, `seed` | `video.url` | $0.08/second | Styled generation (text or first frame -> 5-15 s clip in the 16-bit Pixel look, audio included). Not video-to-video: for Mixed Media use it on a restyled first frame, or use a v2v model for real footage. |
| `minimax/h3-max/styles/hand-drawn` | fal | t2v-style | `prompt`*, `image_url`, `duration`, `aspect_ratio`, `seed` | `video.url` | $0.08/second | Styled generation (text or first frame -> 5-15 s clip in the Hand Drawn look, audio included). Not video-to-video: for Mixed Media use it on a restyled first frame, or use a v2v model for real footage. |
| `minimax/h3-max/styles/low-poly` | fal | t2v-style | `prompt`*, `image_url`, `duration`, `aspect_ratio`, `seed` | `video.url` | $0.08/second | Styled generation (text or first frame -> 5-15 s clip in the Low Poly look, audio included). Not video-to-video: for Mixed Media use it on a restyled first frame, or use a v2v model for real footage. |
| `minimax/h3-max/styles/retro-toon-70s` | fal | t2v-style | `prompt`*, `image_url`, `duration`, `aspect_ratio`, `seed` | `video.url` | $0.08/second | Styled generation (text or first frame -> 5-15 s clip in the Retro Toon 70s look, audio included). Not video-to-video: for Mixed Media use it on a restyled first frame, or use a v2v model for real footage. |
| `minimax/h3-max/3d-to-video` | fal | v2v | `video_url`*, `prompt`, `reference_image_urls`, `resolution` | `video.url` | $0.05/second (480p, min 5 s) | Blender/3D proxy animation (<=15 s, <=32 shots) -> finished video; references or auto-generated ones define the look. For Cinema Studio '3D scene' blocking -> shot. |
| `fal-ai/pixverse/v5.5/effects` | fal | effect | `image_url`*, `effect`*, `resolution`, `duration`, `negative_prompt` | `video.url` | $0.15/request (5 s, 360p/540p, no audio) | Image -> templated effect clip (Kiss, Hug, Muscle Surge, Holy Wings, ...); duration string '5'\|'8'\|'10'. PixVerse has no restyle/video-to-video endpoint on fal (probed v5/v5.5/v6 restyle/modify: 404). |
| `runwayml/aleph-2` | replicate | restyle | `prompt`*, `video`*, `keyframe_images`, `keyframe_positions` | `output` | $0.336/second | Official. 'Edit one frame to update the whole video': up to 5 edited keyframes positioned first\|last\|&lt;seconds>. 2-30 s, <16 MB input. $0.336/s. Runway Aleph is not on fal (probed). |
| `decart/lucy-edit-2` | replicate | restyle | `video`*, `prompt`, `reference_image` | `output` | $0.04/second | Official. Text and/or one reference image (e.g. the garment or style frame); 16:9 or 9:16 mp4, <=200 MB. $0.04/s: cheapest commercial restyle found. |
| `wan-video/wan-2.7-videoedit` | replicate | restyle | `video`*, `prompt`*, `reference_image`, `resolution`, `aspect_ratio`, `duration`, `audio_setting` | `output` | $0.1/second | Official. 2-10 s input; style transfer or instruction edit; audio_setting auto\|origin. $0.10/s. |
| `prunaai/p-video-edit` | replicate | restyle | `video`*, `prompt`*, `images`, `draft` | `output` | $0.045/second | Official. <=15 s, <=4 refs, draft mode. $0.045/s ($0.025/s draft). |
| `kwaivgi/kling-v3-omni-video` | replicate | restyle | `prompt`*, `start_image`, `end_image`, `reference_images`, `reference_video`, `video_reference_type`, `keep_original_sound`, `generate_audio`, `mode`, `aspect_ratio`, `duration`, `multi_prompt` | `output` | $0.168/second | Official. One model for t2v/i2v/ref2v/edit: video_reference_type 'base' = edit the reference video, 'feature' = use it as style/camera reference. Template refs <<&lt;image_1>>>, <<&lt;video_1>>>. multi_prompt is a JSON STRING. |

**Like-for-like engines.** The parity studio's Shorts Studio runs on Gemini Omni Flash, Ad Multiplier on Seedance 2.5 edit, and Faceless Studio on Gemini Omni Flash video ([`parity-studios.md`](./parity-studios.md), [`parity-marketing-agents.md`](./parity-marketing-agents.md)). So the defaults in section 1 are `google/gemini-omni-flash/v1.1/edit` (part 1) and the parity studio's `bytedance/seedance-2.5/video-edit`; the endpoints above are the alternatives and fallbacks.

**Input windows decide the Shorts Studio pipeline.** The parity studio takes ≤2 min of footage and outputs ≤10 s segments. Most edit models take short clips, so Fuobe splits the upload with `trim-video` (section 6) unless the model takes the whole window.

| Model | Source length | Refs | Keeps audio | $/s (default res) |
|---|---|---|---|---|
| `alibaba/happy-horse/video-edit` | **3-60 s** in, at most 15 s out (corrected 2026-10-29) | ≤5 images | `audio_setting: origin` | 0.28 (720p; input and output halves together) |
| Replicate `runwayml/aleph-2` | 2-30 s (<16 MB) | ≤5 edited keyframes | (unspecified) | 0.336 |
| `minimax/h3-max/recast` (cast swap) | 5-30 s | 1-4 people | yes | 0.30 (768P) |
| `fal-ai/kling-video/o3/{pro,4k}/video-to-video/edit` | 3-15 s | ≤4 images/elements | `keep_audio` | 0.42 (4K); pro/std in part 1 |
| Replicate `wan-video/wan-2.7-videoedit` | 2-10 s | 1 image | `audio_setting: origin` | 0.10 |
| Replicate `prunaai/p-video-edit` | ≤15 s | ≤4 images | `save_audio` | 0.045 (0.025 draft) |
| `xai/grok-imagine-video/edit-video` | **truncated to 8 s**, ≤854x480 | none | (unspecified) | 0.05 + 0.01 input |
| `decart/lucy-edit/pro` / Replicate `decart/lucy-edit-2` | (not stated; 16:9 or 9:16, ≤200 MB) | 1 image (Replicate) | (unspecified) | 0.15 / 0.04 |
| `fal-ai/bernini-r/*edit-video` | 5-121 frames at 4-30 fps | ≤5 images | no | 0.08 (848 px) |
| `google/gemini-omni-flash/v1.1/edit` (part 1; the parity studio's Shorts Studio engine) | not stated in the schema (the parity studio feeds it ≤10 s segments) | none (prompt only) | (unspecified) | 0.10 (720p), 0.03 (360p), 0.15 (1080p) |
| `luma/agent/ray/v3.2/video-to-video` (part 2) | output 5 s or 10 s | restyled first frame or ≤64 keyframes | (unspecified) | 0.216 (720p, 5 s = $1.08) |

**Mixed Media, cloud recipe.** The parity studio samples frames at 4-24 fps, stylises each one and reassembles them:

1. `fal-ai/workflow-utilities/extract-nth-frame` with `frame_interval` = source fps / target fps and `max_frames` ≤500.
2. Stylise each frame with `fal-ai/telestyle-v2` (content + style image) or an instruction editor (Nano Banana 2, FLUX Kontext), with a fixed seed.
3. `fal-ai/ffmpeg-api/images-to-video` with `images[{url, frames}]` (≤200 per call; chain calls for longer clips) at the target fps.
4. `fal-ai/ffmpeg-api/merge-audio-video` with the original audio.

For a smoother result, use `fal-ai/ltx-2.3-22b/reference-video-to-video` with `preprocessor: depth|pose` and a restyled first frame as `image_url`. Add film grain or light leaks with `blend-video`. The five `minimax/h3-max/styles/*` endpoints generate in a look; they do not restyle footage.

## 6. Video utilities: trim, split, frames, compose

| Endpoint | Provider / status | Op | Key fields (* = required) | Output | Price | Notes |
|---|---|---|---|---|---|---|
| `fal-ai/ffmpeg-api/compose` | fal | utility | `tracks`* | `video_url` | $0.0002/second | Timeline render: tracks[{id, type 'video'\|'image'\|'audio', keyframes[{url, timestamp ms, duration ms}]}]. Exactly one visual track; any number of audio tracks (voice-over + music + SFX). Returns video_url + thumbnail_url (strings, not File objects). |
| `fal-ai/ffmpeg-api/images-to-video` | fal | utility | `images`*, `fps` | `video.url` | $0/compute-second | images[{url, frames}] (1-200, each held for N frames) at fps 1-120 -> mp4. Reassembles Mixed Media per-frame stylizations (or a slideshow). |
| `fal-ai/ffmpeg-api/merge-audios` | fal | utility | `audio_urls`* | `audio.url` | $0.00017/compute-second | Concatenates 2-5 audio files in order (not a mix; use compose with several audio tracks to layer music under narration). |
| `fal-ai/ffmpeg-api/metadata` | fal | utility | `media_url`* | `media` | $0/compute-second | Duration, fps, resolution, codec, frame_count, audio info (+ start/end frame URLs with extract_frames). Used to validate Shorts Studio uploads (<=2 min) and plan segments. |
| `fal-ai/ffmpeg-api/waveform` | fal | utility | `media_url`* | `waveform` | $0/compute-second | Waveform samples (1-10 points/s) for the timeline UI; can be computed in the browser instead. |
| `fal-ai/ffmpeg-api/loudnorm` | fal | utility | `audio_url`* | `audio.url` | $0/compute-second | EBU R128 loudness normalisation (target -18 LUFS default); level narration/music before compose. |
| `fal-ai/workflow-utilities/trim-video` | fal | utility | `video_url`*, `start_time`, `end_time`, `duration` | `video.url` | $0.001/compute-second | Cut [start_time, end_time] (or start_time + duration; defaults start 1 s, duration 2 s, so always send both). Shorts Studio splits the <=2 min upload into <=10 s segments with repeated calls. |
| `fal-ai/workflow-utilities/reverse-video` | fal | utility | `video_url`* | `video.url` | $0.001/compute-second | Reverse playback: backward extend = reverse -> extend forward -> reverse. |
| `fal-ai/workflow-utilities/scale-video` | fal | utility | `video_url`*, `width`, `height`, `mode` | `video.url` | $0.001/compute-second | Resize with mode stretch\|pad\|crop (pad_color). Normalise clips before merge (merge-videos requires 512-2048 px). |
| `fal-ai/workflow-utilities/blend-video` | fal | utility | `top_video_url`*, `bottom_video_url`*, `blend_mode`, `opacity` | `video.url` | $0.001/compute-second | Layer two videos with an FFmpeg blend mode (overlay, screen, multiply, ...). For Mixed Media overlays (grain, light leaks). |
| `fal-ai/workflow-utilities/extract-nth-frame` | fal | utility | `video_url`*, `frame_interval`, `max_frames` | `images[].url` | $0.001/compute-second | Every Nth frame (1-300) up to max_frames (<=500) as images[]. With images-to-video this is the cloud Mixed Media pipeline (sample at 4-24 fps -> stylize each frame -> reassemble). |
| `fal-ai/workflow-utilities/interleave-video` | fal | utility | `video_urls`*, `frames_per_second` | `video.url` | $0/compute-second | Interleave frames of several videos (stop-motion/strobe looks). |
| `fal-ai/workflow-utilities/extract-audio` | fal / **unlisted** | utility | `video_url`* | `audio.url` | $0/compute-second | Video -> mp3/wav/aac/flac. Unlisted (schema served). First step of transcription/dubbing on video input. |
| `fal-ai/ffmpeg-api/extract-frame` | fal | utility | `video_url`* | `images[].url` | $0.0002/second | Re-verified (part 2): frame_type first\|middle\|last only. |
| `fal-ai/ffmpeg-api/merge-videos` | fal | utility | `video_urls`*, `target_fps`, `resolution` | `video.url` | $0/compute-second | Re-verified (part 2): video_urls >=2 in order; target_fps; resolution 512-2048 or resolution_aspect_ratio_video_index (new field) to pick whose aspect ratio wins. |
| `fal-ai/ffmpeg-api/merge-audio-video` | fal | utility | `video_url`*, `audio_url`*, `start_offset` | `video.url` | $0.0002/second | Re-verified (part 2): replace the soundtrack (dub track, music) with an offset. |

**Shorts Studio pipeline:**

1. `ffmpeg-api/metadata` reads `duration` and `fps`. Reject anything over 120 s, as the parity studio does.
2. `trim-video` cuts each segment with `start_time` + `end_time`. Always send both: the defaults are start 1 s and duration 2 s. fal has no split endpoint.
3. Edit each segment.
4. `scale-video` normalises the segments to one size.
5. `ffmpeg-api/merge-videos` joins them, or `ffmpeg-api/compose` when narration or music tracks are added:

```json
{"tracks": [
  {"id": "v", "type": "video", "keyframes": [{"url": "seg1.mp4", "timestamp": 0, "duration": 10000}, {"url": "seg2.mp4", "timestamp": 10000, "duration": 8000}]},
  {"id": "vo", "type": "audio", "keyframes": [{"url": "voice.mp3", "timestamp": 0, "duration": 18000}]},
  {"id": "music", "type": "audio", "keyframes": [{"url": "bed.mp3", "timestamp": 0, "duration": 18000}]}
]}
```

`compose` returns `video_url` and `thumbnail_url` as plain strings. Exactly one visual track is allowed, with any number of audio tracks. Timestamps are in milliseconds.

## 7. Transcription and captions

| Endpoint | Provider / status | Op | Key fields (* = required) | Output | Price | Notes |
|---|---|---|---|---|---|---|
| `fal-ai/workflow-utilities/auto-subtitle` | fal | captions | `video_url`*, `language`, `font_name`, `font_size`, `font_weight`, `font_color`, `highlight_color`, `stroke_color`, `stroke_width`, `background_color`, `position`, `y_offset`, `words_per_subtitle`, `enable_animation` | `video.url` | $0.03/minute | Transcribe + burn TikTok-style karaoke captions in one call: any Google Font, color enums (white/black/red/.../magenta), position top\|center\|bottom, 1-12 words per subtitle, bounce animation. Also returns transcription, words[] and subtitle_count. |
| `veed/subtitles` | fal | captions | `video_url`*, `preset`*, `language`, `translation_language`, `srt_file_url`, `srt_content` | `video.url` | $0.1/minute | 30 designed presets (dynamic x2 price: glass, whisper, glide2, fusion, glide, terminal, handwritten, backdrop, backdrop2; |
| `fal-ai/auto-caption` | fal | captions | `video_url`*, `txt_color`, `txt_font`, `font_size`, `stroke_width` | `video_url` | $0.1/request | Older burn-in captioner: left_align/top_align (string or 0-1 float), refresh_interval 0.5-3 s, text_case. Returns video_url (string). $0.10/video (<400 MB). |
| `fal-ai/elevenlabs/speech-to-text/scribe-v2` | fal | transcribe | `audio_url`*, `language_code`, `diarize`, `keyterms` | `text` | $0.008/minute | Best transcript for captions and dubbing scripts: words[{text,start,end,type,speaker_id}] with diarization and audio-event tags; up to 100 keyterms (+30%). $0.008 per input minute. |
| `fal-ai/elevenlabs/speech-to-text` | fal | transcribe | `audio_url`*, `language_code`, `diarize` | `text` | $0.03/minute | Scribe v1, $0.03/min; prefer scribe-v2. |
| `fal-ai/wizper` | fal | transcribe | `audio_url`*, `task`, `language` | `text` | $0/compute-second | Whisper large-v3 optimised by fal: task transcribe\|translate (to English), language enum (default 'en': set it or detection is skipped), segment chunks[{text,timestamp:[start,end]}]. Listed $0 per compute second (GPU-time billed; cost unverified). |
| `fal-ai/whisper` | fal / **unlisted** | transcribe | `audio_url`*, `task`, `language`, `diarize`, `chunk_level`, `prompt` | `text` | $0/compute-second | Unlisted (schema served). Adds word-level chunks (chunk_level none\|segment\|word), diarization (diarize, num_speakers) and auto language detection (language null). |
| `fal-ai/speech-to-text` | fal | transcribe | `audio_url`* | `output` | $0.0008/second | Text only (no timestamps), $0.0008/s. Not suitable for captions. |
| `fal-ai/speech-to-text/turbo` | fal | transcribe | `audio_url`* | `output` | $0.0008/second | Faster Canary; text only. |
| `fal-ai/cohere-transcribe` | fal | transcribe | `audio_url`*, `language` | `text` | $0.0000694/second | 14 languages, text only (no timestamps); very cheap ($0.0000694/s). |
| `nvidia/nemotron-asr-multilingual/asr` | fal | transcribe | `audio_url`*, `language` | `output` | $0.008/minute | Language auto-ID; text only. $0.008/min. |
| `fal-ai/elevenlabs/forced-alignment` | fal | align | `audio_url`*, `text`* | `words[]` | $0.22/hour | Known script + audio -> word and character timings. Faceless/Explainer already has the narration text, so this gives exact caption timing without transcription. $0.22/hour (rounded up). |
| `elevenlabs/scribe-v2` | replicate | transcribe | `audio`*, `language_code`, `diarize`, `timestamps_granularity`, `keyterms` | `output` | $0.003667/output | Official. Accepts video files directly; keyterms is a comma-separated STRING here (array on fal); no_verbatim strips fillers. Billing shown as '$3.667 per thousand outputs' (unit unclear; fal lists $0.008/min). |
| `openai/gpt-4o-transcribe` | replicate | transcribe | `audio_file`*, `language`, `prompt` | `output` | $0.00001/tokens | Official. Text only (streamed array of strings), no timestamps. $6/M input tokens. |
| `xai/grok-speech-to-text` | replicate | transcribe | `audio`*, `language`, `diarize`, `timestamps` | `output` | $0.001667/output | Official. 25 languages, word timestamps + diarization. '$1.667 per thousand outputs'. |
| `victor-upmeet/whisperx:655845d6190e...` | replicate (community) | transcribe | `audio_file`*, `language`, `task`, `diarization`, `align_output` | `output` | Billed by GPU time (community model; no fixed price published) | Community model: needs the version id. Word-level alignment (align_output) and diarization (needs your HuggingFace token in huggingface_access_token). Billed by GPU time (A100 80GB). |
| `fictions-ai/autocaption:18a45ff0d95f...` | replicate (community) | captions | `video_file_input`*, `transcript_file_input`, `subs_position`, `color`, `highlight_color`, `fontsize`, `font`, `stroke_color`, `stroke_width` | `output` | Billed by GPU time (community model; no fixed price published) | Community model (version id required). Burned karaoke captions + an editable transcript JSON (re-run with transcript_file_input after edits). GPU-time billed (L40S). |

**Captions recipe:**
- When the narration text is known (Faceless/Explainer), `fal-ai/elevenlabs/forced-alignment` gives exact word timings for $0.22 per hour of audio.
- For any other video, `fal-ai/workflow-utilities/auto-subtitle` transcribes and burns TikTok-style karaoke captions in one call for $0.03/min. It takes any Google Font, colour enums, position and 1-12 words per subtitle.
- For designed presets or SRT burn-in, use `veed/subtitles` (30 presets, `srt_content`, translation +$0.20/min).
- For editable captions in Fuobe's own timeline, transcribe with Scribe v2. Its `words[]` carry start, end and speaker. Render the captions in the browser, then burn them with `veed/subtitles` `srt_content`.

Translation is an LLM step (Claude or Ollama), as the task states. Only `veed/subtitles` (`translation_language`) and Whisper's `task: translate` (to English only) translate on their own.

## 8. Sound effects and music

| Endpoint | Provider / status | Op | Key fields (* = required) | Output | Price | Notes |
|---|---|---|---|---|---|---|
| `mirelo-ai/sfx2.0/text-to-audio` | fal | sfx | `prompt`*, `negative_prompt`, `duration`, `seed`, `num_samples` | `audio[].url` | $0.01/second | The parity studio's 'mirelo_text_to_audio' job. duration 0.1-600 s, 1-4 samples per call (audio[] array). Billed per output second per sample: $0.010/s promo until 2026-12-13, $0.015/s from 2026-12-14. |
| `mirelo-ai/sfx2.0/video-to-video` | fal | v2a | `video_url`*, `text_prompt`, `negative_prompt`, `preserve_speech`, `duration`, `num_samples`, `seed` | `video[].url` | $0.01/second | Adds a full soundtrack to a video and returns the video(s). preserve_speech (default true) keeps dialogue and builds the rest around it; >10 s is generated in 10 s windows. Same per-second pricing as text-to-audio. |
| `fal-ai/stable-audio-25/text-to-audio` | fal | sfx | `prompt`*, `seconds_total`, `seed` | `audio.url` | $0.2/request | SFX or music up to 190 s; 4-8 steps. $0.20/audio. |
| `fal-ai/stable-audio-3/small/sfx/text-to-audio` | fal | sfx | `prompt`*, `negative_prompt`, `duration`, `seed` | `audio.url` | $0.0206/request | SFX-tuned Stable Audio 3 small, 1-120 s, $0.0206/audio. The weights are on Hugging Face (stabilityai/stable-audio-3-small-sfx, gated, Stability AI Community License), so the open SFX route can run the same model. |
| `fal-ai/stable-audio-3/medium/text-to-audio` | fal | sfx | `prompt`*, `negative_prompt`, `duration`, `seed` | `audio.url` | $0.0376/request | General audio/music up to 380 s; $0.0376/audio. |
| `fal-ai/stable-audio-3/small/music/text-to-audio` | fal | music | `prompt`*, `negative_prompt`, `duration`, `seed` | `audio.url` | $0.0217/request | Music-tuned small model, 1-120 s, $0.0217/audio. |
| `cassetteai/sound-effects-generator` | fal | sfx | `prompt`*, `duration`* | `audio_file.url` | $0.01/request | duration REQUIRED integer 1-30 s. $0.01/generation: cheapest SFX. |
| `cassetteai/video-sound-effects-generator` | fal | v2a | `video_url`* | `video.url` | $0.2/minute | video_url is a File OBJECT here ({url, content_type?, file_name?, file_size?}), not a string. Returns the re-sounded video. $0.20/min. |
| `sonilo/v1.1/text-to-sound-effects` | fal | sfx | `prompt`*, `duration` | `audio.url` | $0.0018/second | 0.5-180 s; $0.0018 per output second per sample. |
| `sonilo/v1.1/video-to-sound-effects` | fal | v2a | `video_url`*, `prompt`, `segments`, `keep_speech_vocal` | `audio.url` | $0.009/second | Audio track for a video, optionally per time range segments[{start,end,prompt}]; returns audio + detected scene segments. $0.009/s. |
| `sonilo/v1.1/video-to-video-sound-effects` | fal | v2a | `video_url`*, `prompt`, `segments`, `keep_speech_vocal` | `video.url` | $0.009/second | Same as video-to-sound-effects but returns the muxed video. |
| `beatoven/sound-effect-generation` | fal / **unlisted** | sfx | `prompt`*, `negative_prompt`, `duration`, `seed` | `audio.url` | $0.1/request | Unlisted on fal (schema served, model page live). 1-35 s; refinement 10-200, creativity 1-20. $0.10/request (model page billing block). |
| `beatoven/music-generation` | fal / **unlisted** | music | `prompt`*, `negative_prompt`, `duration`, `seed` | `audio.url` | $0.1/request | Unlisted. Royalty-free background music 5-150 s; $0.10/request. |
| `bytedance/seed-audio-1.0` | fal | sfx | `prompt`*, `voice`, `audio_urls`, `image_url`, `speed` | `audio.url` | $0.1875/minute | The parity studio's 'seed_audio' job: one prompt-driven audio model for speech, SFX and music beds; up to 3 reference clips (@Audio1..) or one reference image; preset voice or cloned voice id. $0.1875 per output minute. |
| `fal-ai/thinksound/audio` | fal | v2a | `video_url`*, `prompt`, `seed` | `audio.url` | $0.001/compute-second | Returns only the audio file (fal-ai/thinksound in part 1 returns the muxed video). $0.001 per compute second. |
| `sonilo/v1.1/text-to-music` | fal | music | `prompt`*, `duration`, `num_samples` | `audio.url` | $0.0025/second | The parity studio's 'sonilo_music' job. 1-600 s, 1-3 samples; $0.0025 per second per sample. |
| `sonilo/v1.1/video-to-music` | fal | v2m | `video_url`*, `prompt`, `num_samples`, `duration`, `start_offset` | `audio.url` | $0.009/second | Scores a video (music matched to cuts/mood); prompt optional (auto-generated from the video). $0.009/s. |
| `sonilo/v1.1/video-to-video-music` | fal | v2m | `video_url`*, `prompt`, `num_samples`, `keep_speech_vocal`, `duration`, `start_offset` | `video.url` | $0.009/second | Same, returns the scored video; keep_speech_vocal keeps dialogue. |
| `fal-ai/lyria2` | fal | music | `prompt`*, `negative_prompt`, `seed` | `audio.url` | $0.1/30-seconds | 30 s instrumental clips, 48 kHz. $0.10 per 30 s. |
| `fal-ai/lyria3` | fal | music | `prompt`*, `image_url` | `audio.url` | $0.04/request | 30 s clips with vocals/lyrics (returns lyrics); optional inspiration image. negative_prompt is accepted but unsupported. $0.04. |
| `fal-ai/lyria3/pro` | fal | music | `prompt`*, `image_url` | `audio.url` | $0.08/request | Full songs up to ~3 min (per Replicate's description). $0.08. |
| `fal-ai/minimax-music/v2` | fal | music | `prompt`*, `lyrics_prompt`* | `audio.url` | $0.03/request | lyrics_prompt is REQUIRED (structure tags [Verse] [Chorus]...); prompt 10-300 chars. $0.03. |
| `fal-ai/minimax-music/v2.5` | fal | music | `prompt`*, `lyrics`, `is_instrumental`, `lyrics_optimizer` | `audio.url` | $0.15/request | Instrumental mode and auto-lyrics; $0.15. (v2.6 and Music 3 are in parts 1/2.) |
| `cassetteai/music-generator` | fal | music | `prompt`*, `duration`* | `audio_file.url` | $0.02/minute | duration REQUIRED 10-180 s; $0.02 per output minute. |
| `mureka/api/generate/song` | fal | music | `prompt`, `lyrics`, `model`, `styles`, `gender` | `audio.url` | $0.225/request (lyrics-to-song, mureka-9.5) | Lyrics-to-song or prompt-to-song (prompt required when no lyrics; styles cannot be combined with lyrics); returns lyrics_sections timing. $0.225 (lyrics) / $0.75 (prompt) per request on mureka-9.5. |
| `mureka/api/generate/instrumental` | fal | music | `prompt`, `model` | `audio.url` | $0.225/request | Instrumental only; $0.225/request on mureka-9.5. |
| `fal-ai/demucs` | fal | stem-split | `audio_url`*, `stems`, `model` | `vocals.url` | $0.0007/second | Stem separation: vocals, drums, bass, other (+guitar, piano with htdemucs_6s). Dubbing: keep the music/effects bed (everything but vocals) under the new voice. $0.0007/s. |
| `fal-ai/sam-audio/separate` | fal | stem-split | `audio_url`*, `prompt`* | `target.url` | $0.05/30-seconds | Prompted isolation ('the dog barking'): target + residual. $0.05 per 30 s. |
| `veed/clean-audio` | fal | audio-clean | `audio_url`*, `strength` | `audio.url` | $0.0125/minute | Speech denoise + loudness to -19 LUFS; takes video files too. $0.0125/min (1 min minimum). |
| `stability-ai/stable-audio-2.5` | replicate | sfx | `prompt`*, `duration`, `steps` | `output` | $0.2/request | Official. Up to 190 s. $0.20/file. |
| `mirelo/video-to-sfx-v1.5` | replicate | v2a | `video_path`*, `text_prompt`, `num_samples`, `duration`, `start_offset` | `output` | $0.01/request | Official. <=10 s window per call (start_offset to pick it); returns sample URIs. $0.01 per unit. |
| `google/lyria-2` | replicate | music | `prompt`*, `negative_prompt` | `output` | $0.002/second | Official. $2 per 1000 s of output. |
| `google/lyria-3` | replicate | music | `prompt`*, `images` | `output` | $0.04/request | Official. 30 s clips; up to 10 inspiration images. $0.04. |
| `google/lyria-3-pro` | replicate | music | `prompt`*, `images` | `output` | $0.08/request | Official. Songs up to 3 min. $0.08. |
| `minimax/music-2.6` | replicate | music | `prompt`, `lyrics`, `is_instrumental`, `lyrics_optimizer` | `output` | $0.15/request | Official. $0.15/file. |
| `tencent/hunyuanvideo-foley:88045928bb97...` | replicate (community) | v2a | `video`*, `prompt`, `neg_prompt` | `output` | Billed by GPU time (community model; no fixed price published) | Community-tagged (version id required). return_audio:true for audio only. GPU-time billed. |

**Already recorded in parts 1 and 2** (not repeated here):

- Sound effects: `fal-ai/elevenlabs/sound-effects/v2`, `fal-ai/mmaudio-v2/text-to-audio` and Replicate `zsxkib/mmaudio`.
- Sound for a video: `mirelo-ai/sfx2.0/video-to-audio`, `fal-ai/thinksound` (returns the muxed video), `fal-ai/kling-video/video-to-audio`, `fal-ai/hunyuan-video-foley` and `fal-ai/pixverse/sound-effects`.
- Music: `fal-ai/elevenlabs/music`, `elevenlabs/music/v2`, `elevenlabs/music/v2.5`, `fal-ai/minimax-music/v2.6`, `minimax/music-3`, `google/lyria-3.5`, and on Replicate `elevenlabs/music` and `minimax/music-1.5`.

The parity studio's own audio jobs map as follows:

| The parity studio's job | Endpoint |
|---|---|
| `mirelo_text_to_audio` | `mirelo-ai/sfx2.0/text-to-audio` |
| `seed_audio` | `bytedance/seed-audio-1.0` |
| `sonilo_music` | `sonilo/v1.1/text-to-music` |
| `inworld_text_to_speech` | `fal-ai/inworld-tts` |

## 9. Dubbing and lipsync

The dubbing endpoints recorded in part 2 are still present in the catalog: `fal-ai/elevenlabs/dubbing`, `fal-ai/heygen/v2/translate/precision` and `/speed`, Replicate `elevenlabs/dubbing` and Replicate `heygen/video-translate`. So are the lipsync endpoints from part 1: `fal-ai/sync-lipsync/v2`, `/v2/pro`, `/v3`, `fal-ai/latentsync`, `fal-ai/kling-video/lipsync/*`, `fal-ai/musetalk`, `veed/lipsync`, Replicate `sync/lipsync-2` and `sync/lipsync-2-pro`.

These are new:

| Endpoint | Provider / status | Op | Key fields (* = required) | Output | Price | Notes |
|---|---|---|---|---|---|---|
| `fal-ai/sync-lipsync` | fal | lipsync | `video_url`*, `audio_url`*, `model` | `video.url` | $0.7/minute | Older sync.so models (1.7.1/1.8.0/1.9.0-beta) at $0.70/min; v2/v2-pro/v3 are in part 1 and preferred. |
| `heygen/lipsync-precision` | replicate | lipsync | `video`*, `audio`* | `output` | $0.0667/second | Official. Re-sync a dubbed track to the speaker; enable_dynamic_duration lets the video stretch to the new audio. $0.0667/s. |
| `pixverse/lipsync` | replicate | lipsync | `video`*, `audio`* | `output` | $0.04/second | Official. $0.04/s. |
| `bytedance/latentsync:637ce1919f80...` | replicate (community) | lipsync | `video`, `audio` | `output` | Billed by GPU time (community model; no fixed price published) | Community-tagged (version id required). Open weights (ByteDance/LatentSync-1.6 on Hugging Face, OpenRAIL++): also the open dubbing route's lipsync step. |

**A step-by-step dub** that gives full control (voice choice, glossary, caption output) and also defines the open route:

1. `workflow-utilities/extract-audio`
2. Scribe v2 (with diarisation)
3. LLM translation of each segment
4. TTS per speaker (ElevenLabs v3, or a cloned voice from part 2)
5. `fal-ai/demucs`, keeping `drums`, `bass` and `other` as the background bed
6. `ffmpeg-api/compose` on the original timeline
7. Lipsync with `fal-ai/sync-lipsync/v2`, Replicate `heygen/lipsync-precision` (`enable_dynamic_duration`) or `fal-ai/latentsync`

No newer Kling lipsync or HeyGen v3 translate endpoint exists on fal (probed).

## 10. Ads: product photography, 3D and try-on

| Endpoint | Provider / status | Op | Key fields (* = required) | Output | Price | Notes |
|---|---|---|---|---|---|---|
| `fal-ai/bria/product-shot` | fal | product-shot | `image_url`*, `scene_description`, `ref_image_url`, `num_results`, `placement_type`, `shot_size` | `images[].url` | $0.04/request | Product packshot -> lifestyle shot from a scene description OR a reference scene image (one of the two). placement_type original\|automatic\|manual_placement\|manual_padding (+manual_placement_selection, padding_values); shot_size [w,h] (~1MP). |
| `fal-ai/bria/background/replace` | fal | bg-replace | `image_url`*, `prompt`, `negative_prompt`, `ref_image_url`, `num_images`, `seed` | `images[].url` | $0.04/request | Keeps the subject, generates a new background from prompt or reference image. $0.04. |
| `bria/replace-background` | fal | bg-replace | `image_url`, `prompt`, `negative_prompt` | `image.url` | $0.04/image | Newer Bria background replacement (image + images[] out). The schema defaults image_url to a sample: always send it. $0.04. |
| `bria/embed-product` | fal | product-shot | `image_source`*, `products` | `image.url` | $0.04/image | Place 1-10 product cut-outs into a scene at given boxes: products[{image_source, coordinates{x,y,width,height}}]. For templated static ads where the layout is fixed. |
| `bria/product-dimensions` | fal | product-annotate | `image`*, `dimensions`*, `style`*, `title` | `image.url` | $0.04/image | Adds dimension callouts (height/width_bottom/width_top with units) to a product image; style default\|childlike\|elegant; also returns a transparent overlay. Marketplace listing images. |
| `bria/fibo-edit-1.5/product-holding` | fal | product-holding | `person_image_url`*, `product_image_urls`*, `instruction`, `aspect_ratio` | `images[].url` | $0.04/image | Person + product photos -> the person holding the product (UGC stills). $0.04. |
| `fal-ai/image-apps-v2/product-photography` | fal | product-shot | `product_image_url`*, `aspect_ratio` | `images[].url` | $0.04/image | One-click studio product photo; aspect_ratio object {ratio}. $0.04. |
| `fal-ai/image-apps-v2/product-holding` | fal | product-holding | `person_image_url`*, `product_image_url`*, `aspect_ratio` | `images[].url` | $0.04/image | $0.04. |
| `pixelcut/product-photo` | fal | product-shot | `image_url`*, `image_size` | `image.url` | $0.024/image | Background/margin/shadow objects for marketplace-ready packshots. $0.024. |
| `fal-ai/qwen-image-edit-plus-lora-gallery/integrate-product` | fal | product-shot | `image_urls`*, `prompt`, `image_size`, `num_images`, `negative_prompt`, `seed` | `images[].url` | $0.035/megapixel | Scene image + product image -> product blended into the scene with matched light/perspective (open LoRA: the same LoRA runs on the ComfyUI route). |
| `fal-ai/image-editing/youtube-thumbnails` | fal | ad-static | `image_url`*, `prompt` | `images[].url` | $0.04/image | Thumbnail-style rework of an image with a headline in the prompt (LoRA app). For Faceless channel covers. |
| `fal-ai/vidu/template-to-video` | fal | effect | `input_image_urls`*, `template`, `aspect_ratio` | `video.url` | $0.2/request (standard template) | Templated product/viral effect clips from images; $0.20 standard / $0.30 premium / $0.50 advanced templates. |
| `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` | fal | image-to-3d | `input_image_url`*, `enable_pbr`, `face_count` | `model_glb.url` | $0.375/request | Product photo (+ optional back/left/right/top/bottom/left_front/right_front views) -> textured GLB (model_glb + model_urls glb/obj/fbx/...). generate_type controls geometry-only vs textured. $0.375 (+$0.15 PBR, +$0.15 multi-view, +$0.15 custom faces). |
| `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d` | fal | image-to-3d | `input_image_url`*, `enable_pbr` | `model_glb.url` | $0.225/request | Faster/cheaper ($0.225) single-view variant. |
| `fal-ai/trellis-2` | fal | image-to-3d | `image_url`*, `resolution` | `model_glb.url` | $0.25/request (512p) | Open-weight (MIT) image -> GLB; resolution 512/1024/1536 = $0.25/$0.30/$0.35; texture_size, decimation and remesh controls. Same model can run locally for the open route. |
| `tripo3d/h3.1/image-to-3d` | fal | image-to-3d | `image_url`*, `texture`, `pbr`, `face_limit`, `model_seed` | `model_mesh.url` | $0.2/request (untextured) | $0.20 untextured / $0.30 standard / $0.40 HD textures (+$0.20 detailed geometry, +$0.05 quad). Returns model_mesh + rendered_image + model_urls. |
| `tripo3d/p2/image-to-3d` | fal | image-to-3d | `image_url`*, `texture`, `pbr`, `face_limit`, `model_seed` | `model_mesh.url` | $1/request (untextured) | Production tier, $1.00-1.30. |
| `meshy/v7.1/image-to-3d` | fal | image-to-3d | `image_url`*, `should_texture`, `enable_pbr`, `target_polycount`, `texture_prompt` | `model_glb.url` | $0.8/request (untextured) | $0.80 base, $1.20 textured, +$0.20 auto-rig, +$0.12 animation. Rigging/animation are useful for character mascots. |
| `fal-ai/hyper3d/rodin/v2.5` | fal | image-to-3d | `image_urls`, `prompt`, `tier` | `model_mesh.url` | $0.4/request | 1+ images or prompt; $0.40 (+$0.80 HighPack). |
| `fal-ai/fashn/tryon/v1.6` | fal | try-on | `model_image`*, `garment_image`*, `category`, `num_samples`, `seed`, `mode` | `images[].url` | $0.075/request | Best dedicated try-on: category auto\|tops\|bottoms\|one-pieces, mode performance\|balanced\|quality, garment_photo_type auto\|flat-lay\|model, segmentation_free. $0.075. Fashion Factory step 4 (cloud). |
| `google/virtual-try-on` | fal | try-on | `person_image_url`*, `product_image_url`*, `num_images` | `images[].url` | $0.075/image | $0.075 per image. |
| `fal-ai/image-apps-v2/virtual-try-on` | fal | try-on | `person_image_url`*, `clothing_image_url`*, `aspect_ratio` | `images[].url` | $0.04/image | preserve_pose option; $0.04. |
| `bria/fibo-edit-1.5/virtual-try-on` | fal | try-on | `person_image_url`*, `garment_image_urls`*, `instruction`, `aspect_ratio` | `images[].url` | $0.04/image | Several garments at once; commercial-safe; $0.04. |
| `fal-ai/leffa/virtual-tryon` | fal | try-on | `human_image_url`*, `garment_image_url`*, `garment_type`* | `image.url` | $0.1/request | garment_type required (upper_body\|lower_body\|dresses). $0.10. |
| `fal-ai/cat-vton` | fal | try-on | `human_image_url`*, `garment_image_url`*, `cloth_type`*, `image_size` | `image.url` | $0/compute-second | cloth_type required; compute-billed; fal lists the license as research-only. |
| `fal-ai/flux-pro/v1/vto` | fal | try-on | `prompt`*, `human_image_url`*, `garment_image_url`* | `images[].url` | $0.0375/first input megapixel | prompt required; $0.0375 first input MP + $0.005/extra MP. |
| `fal-ai/flux-2-lora-gallery/virtual-tryon` | fal | try-on | `image_urls`*, `prompt`*, `image_size`, `num_images` | `images[].url` | $0.021/megapixel | Person + garment in image_urls; $0.021/MP. |
| `fal-ai/idm-vton` | fal / **unlisted** | try-on | `human_image_url`*, `garment_image_url`*, `description`* | `image.url` | $0/compute-second | Unlisted; description (garment text) required; weights are CC BY-NC. |
| `fal-ai/kling/v1-5/kolors-virtual-try-on` | fal / **deprecated** | try-on | `human_image_url`*, `garment_image_url`* | `image.url` | $0.07/request | Catalog status DEPRECATED (2026-09-15) but still served. $0.07. Prefer FASHN 1.6. |
| `bria/product-packshot` | replicate | packshot | `image`*, `background_color` | `output` | $0.04/image | Official. 2000x2000 centered packshot on a hex color or transparent. $0.04. |
| `bria/product-shadow` | replicate | product-shot | `image`*, `background_color` | `output` | $0.04/image | Official. regular\|float shadow with color/offset/intensity/blur/size. $0.04. |
| `bria/product-cutout` | replicate | bg-remove | `image`* | `output` | $0.04/image | Official. 256-level alpha cut-out. $0.04. |
| `bria/generate-background` | replicate | bg-replace | `image_url`, `bg_prompt`, `ref_image_url`, `negative_prompt` | `output` | $0.04/image | Official. bg_prompt or ref_image_url required. $0.04. |
| `prunaai/p-image-try-on` | replicate | try-on | `person_image`*, `garment_images`*, `prompt` | `output` | $0.007/request | Official. Up to 6 (max 11) garments in one pass; optional reference_pose. $0.007/run + $0.008 per input MP. |
| `cuuupid/idm-vton:0513734a4521...` | replicate (community) | try-on | `human_img`*, `garm_img`*, `garment_des`, `category`, `mask_img` | `output` | Billed by GPU time (community model; no fixed price published) | Community; non-commercial weights. Version id required. |
| `tencent/hunyuan-3d-3.1` | replicate | image-to-3d | `image`, `prompt`, `enable_pbr`, `face_count` | `output` | $0.5/request | Official. prompt OR image (not both). Output GLB URI. $0.50. |
| `firtoz/trellis:e8f6c4520699...` | replicate (community) | image-to-3d | `images`* | `output` | Billed by GPU time (community model; no fixed price published) | Community (version id required). Set generate_model:true to get a GLB (default only renders preview videos). Output {model_file, color_video, ...}. |

**Ads Studio.** The brand kit (logo, colours, fonts, imagery, tone) comes from a server-side fetch of the URL plus an LLM extraction; no model endpoint is needed.

Static ads then use the parity studio `ads-studio/v1.0` on a parity-studio key. Elsewhere, they use Nano Banana Pro or GPT Image 2.5 edit with the product and logo as references and the palette and headline in the prompt, or Ideogram 3 with `color_palette` when exact text matters. A fixed template layout comes from `bria/embed-product` plus browser text.

**Product spin.** Image to GLB (`fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`, or `fal-ai/trellis-2` on open weights). Render the turntable in the browser with three.js and export it as WebM. Alternatively, feed a rendered frame to image-to-video with an orbit camera motion.

## 11. Cinema Studio helpers: grid, angles, Soul Cast and Soul Location

| Endpoint | Provider / status | Op | Key fields (* = required) | Output | Price | Notes |
|---|---|---|---|---|---|---|
| `fal-ai/qwen-image-edit-2511-multiple-angles` | fal | angles | `image_urls`*, `horizontal_angle`, `vertical_angle`, `zoom`, `additional_prompt`, `image_size`, `num_images`, `negative_prompt`, `seed` | `images[].url` | $0.035/megapixel | Camera re-render of a still: horizontal 0-360 deg (0 front, 90 right, 180 back), vertical -30..90, zoom 0 (wide)..10 (close-up). Drives Cinema Studio image-grid 'zooms/shots' tiles, the 3D-scene recompose and Soul Location 'another view'; |
| `fal-ai/flux-2-lora-gallery/multiple-angles` | fal | angles | `image_urls`*, `horizontal_angle`, `vertical_angle`, `zoom`, `image_size`, `num_images` | `images[].url` | $0.021/megapixel | Same controls on FLUX.2 (vertical 0-60). $0.021/MP. |
| `fal-ai/qwen-image-edit-plus-lora-gallery/next-scene` | fal | storyboard | `image_urls`*, `prompt`, `image_size`, `num_images`, `negative_prompt` | `images[].url` | $0.035/megapixel | Next-scene LoRA (prompt starts with 'Next Scene:'): Cinema Studio grid type next_shots/prev_shots, one tile per call. Hosted version of the open storyboard LoRA already in the ComfyUI library. |
| `fal-ai/image-editing/scene-composition` | fal | edit | `image_url`*, `prompt`, `aspect_ratio` | `images[].url` | $0.04/image | Places the subject of an image into a described scene (Soul Location 'put my cast here'). |
| `fal-ai/instant-character` | fal | character | `prompt`*, `image_url`*, `image_size`, `scale`, `num_images`, `negative_prompt`, `seed` | `images[].url` | $0.1/megapixel | One reference photo -> the same character in new prompts (no training). For Soul Cast previews without a Soul ID. $0.10/MP. |

**Image grid.** The parity studio's `cinematic_studio_image_grid` costs the same as one image and shares context across tiles.

- **Freeform:** one Nano Banana Pro (or Nano Banana 2) call with an "N×N contact sheet, consistent characters, thin white gutters" prompt, cropped client-side.
- **zooms / shots:** `qwen-image-edit-2511-multiple-angles` on the chosen frame, one tile per `zoom` or `horizontal_angle` / `vertical_angle`.
- **next_shots / prev_shots:** the `next-scene` LoRA, one tile per call.

## 12. Faceless Studio, Explainer, UGC and Click to Ad

| Endpoint | Provider / status | Op | Key fields (* = required) | Output | Price | Notes |
|---|---|---|---|---|---|---|
| `fal-ai/heygen/v3/video-agent` | fal | explainer | `prompt`*, `avatar`, `voice`, `style_id`, `orientation`, `file_urls` | `video.url` | $0.034/second | One prompt -> finished presenter/explainer video (script, avatar, voice, B-roll, captions chosen by the agent; up to 20 asset files). The closest single-call match to Faceless/Explainer; |
| `fal-ai/inworld-tts` | fal | tts | `text`*, `voice` | `audio.url` | $0.01/1000-characters | The parity studio's 'inworld_text_to_speech' job. <=2000 chars per call (split long narration), preset voices '&lt;Name> (&lt;lang>)'. $0.01 per 1000 characters: cheapest narration. |
| `argil/avatars/text-to-video` | fal | avatar | `text`*, `avatar`*, `voice`* | `video.url` | $0.0225/second | Script -> UGC/masterclass talking-avatar clip from a fixed avatar list (Mia outdoor (UGC), Lara (Masterclass), ...); remove_background +50%. $0.0225 per second. For Click to Ad UGC presenters. |
| `fal-ai/sensenova-u1-infographic` | fal | t2i | `prompt`*, `aspect_ratio` | `images[].url` | $0.05/image | Dense text/diagram infographics for Explainer scenes; use_thinking 1.2x. $0.05/image. |
| `pixverse/music-video/vibemv` | fal | music-video | `audio_url`*, `image_url`, `style_image_url`, `style`, `aspect_ratio`, `resolution`, `lyrics` | `video.url` | $0.06/second | Song (10 s - 6 min) -> beat-cut music video in a style (Cinematic, Lo-fi, Claymation, ... or Custom with style_image_url), optional character image and lip_sync_switch. The parity studio 'beat_fit'-like. $0.06/s 720p, $0.09/s 1080p. |

**Faceless / Explainer chain:**

1. An LLM writes the script and scene list.
2. Each scene gets an image (part 1 models, or the SenseNova infographic model for diagrams), animated with image-to-video when wanted.
3. Narration: ElevenLabs v3 / v4, or `fal-ai/inworld-tts` at $0.01 per 1,000 characters.
4. `forced-alignment` turns the narration into scene and word timings.
5. `ffmpeg-api/compose` assembles the visual track, narration and a `sonilo/v1.1/text-to-music` bed.
6. `auto-subtitle` burns the captions.

`fal-ai/heygen/v3/video-agent` is a single-call alternative with less style control.

**Click to Ad** chains: scraped product images → `bria/product-shot` → i2v (Kling 3 / Seedance 2.5), with an `argil/avatars/text-to-video` UGC presenter or a HeyGen agent, then captions, music and compose.

## 13. Quirks to encode in the adapter

- **Palettes:** fal Recraft uses `colors: [{r,g,b}]` objects, Recraft uses `[{rgb:[R,G,B]}]`, and Ideogram 3 uses `color_palette.members[{rgb:{r,g,b}, color_weight}]`.
- **Recraft Styles:** pass `style_id` *or* `image_urls`. Without an id, every call creates and bills a new style, so save the returned `style_id`. Replicate `recraft-v4-styles-pro-svg` marks `style_reference_images` required: send `[]` with a `style_id`.
- **Bria sample defaults:** several Bria endpoints default `image_url` (and `prompt`) to sample URLs in their schema (`extract-object`, `guided-remove-background`, `replace-background`, `ad-delayer`). Always send them, or the sample is processed.
- **trim-video** defaults to `start_time: 1, duration: 2`. Always send `start_time` and `end_time`.
- **CassetteAI video SFX** takes `video_url` as a **File object** (`{url}`), not a string. CassetteAI's `duration` is required.
- **Mirelo SFX 2.0** returns arrays (`audio[]`, `video[]`), one per sample. Most others return a single object.
- **ffmpeg compose** returns plain strings (`video_url`, `thumbnail_url`). Its keyframe times are in milliseconds.
- **Kling O3 4K reference** `duration` is a **string** enum `"3"`..`"15"`. Replicate `kwaivgi/kling-v3-omni-video` `multi_prompt` is a **JSON string**, and `video_reference_type: base` means edit while `feature` means style/camera reference.
- **Grok video edit** truncates the source to 8 s and ≤854×480.
- **LTX-2.3 v2v** `video_strength` defaults to 0.01, which leaves the model almost free. Raise it to keep the source structure. Reference v2v defaults to 1.
- **Wizper** `language` defaults to `en`, which skips detection. `fal-ai/whisper` (unlisted) accepts a null language for auto-detection and word-level `chunk_level`.
- **Scribe v2** `keyterms` is an array on fal and a comma-separated string on Replicate.
- **Ideogram 4.5 precise edit** (Replicate): mask black = edit, white = keep.
- **Seedream layerize** is billed per generated layer, and the count is not set by the caller. Show the estimate as "up to 17 layers × price".
- **Replicate community models** are recorded as `owner/name:<version>`, so Fuobe's provider posts `/v1/predictions`. They bill by GPU time.
- **Catalog status:** `decart/lucy-edit/fast` and `/dev` and `fal-ai/kling/v1-5/kolors-virtual-try-on` are *deprecated* in fal's catalog (still served). `decart/lucy-edit/pro`, `beatoven/*`, `fal-ai/whisper`, `fal-ai/idm-vton` and `workflow-utilities/extract-audio` are *unlisted*. Prefer the active alternatives in section 1.

## 14. Gaps and blockers

- The parity studio's public API ({studio-docs} llms-full.txt, OpenAPI and the pricing API with the same 31 model families as 2026-10-16) has no endpoint for Cinema Studio image/grid, Soul Cast, Soul Location, Layers, Shorts Studio, Mixed Media, Photodump, Fashion Factory, Moodboard training, Soul HEX or Click to Ad. 30 guessed ids probed at {studio-dashboard}/models/&lt;id>/llms.txt (e.g. {studio}/cinema-studio/image, {studio}/soul-cast, {studio}/soul-location, {studio}/layers, {studio}/shorts-studio/v1.0, {studio}/soul/hex, {studio}/click-to-ad): all 404. Only Soul 2.0 style_id (curated moodboards), Cinema Studio 4.0 color_palette/light and Recraft 4.1 colors exist.
- No split / subtitle-burn ffmpeg endpoint on fal (fal-ai/ffmpeg-api/{trim,trim-video,split,split-video,add-subtitles,burn-subtitles,subtitles,speed,concat,crop,resize,extract-audio}: 404). Split = repeated fal-ai/workflow-utilities/trim-video; SRT burn-in only via veed/subtitles (srt_file_url / srt_content).
- No PixVerse restyle/modify endpoint on fal (fal-ai/pixverse/{restyle,v5/restyle,v5.5/restyle,v6/restyle,v6/modify}: 404); PixVerse effects are image-to-video only.
- Runway Aleph is Replicate-only (runwayml/gen4-aleph in part 1, runwayml/aleph-2 here); fal-ai/runway/aleph etc. 404. Seedance 2.5 video-edit exists only on the parity studio (bytedance/seedance-2.5/video-edit on fal: 404).
- Decart: only queue endpoints decart/lucy-restyle (part 2) and decart/lucy-edit/{pro (unlisted), fast, dev (deprecated)}; decart/lucy-2-5/realtime and decart/lucy2-vton/realtime are realtime (WebSocket) apps that do not fit Fuobe's queue flow; no Decart 'Mirage' endpoint (mirage-api/* on fal are unrelated avatar models).
- Palette inputs exist only on Recraft (fal colors/background_color, the parity studio's colors{rgb}) and Ideogram 3 (color_palette). Replicate's Recraft V4.1 and Ideogram 4 have no palette or style-reference fields; Ideogram 4/4.5 on fal have none either. There is no cloud palette-transfer endpoint (apply palette to an existing image/video); use the browser grade or the open palette-transfer graphs.
- Personal moodboard training like the parity studio's: no public endpoint; Recraft V4 create-style (1-10 images) is the closest hosted equivalent; for 20-80 images train a style LoRA (part 2 trainers).
- bria/ad-delayer publishes no output schema (free-form object); capture the JSON from the first live run before building the Ads Layers import.
- No templated static-ad endpoint on fal or Replicate; Ads Studio is the only one. Build templates with bria/embed-product (boxes) + Ideogram/Recraft text + palette.
- fal-ai/controlfoley is listed in the fal catalog but its OpenAPI 404s (not recorded).
- No newer Kling lipsync on fal (fal-ai/kling-video/{lipsync/v2, v2.6/lipsync, v3/lipsync, o3/lipsync}: 404); no HeyGen v3 translate (fal-ai/heygen/v3/translate*: 404). Dubbing endpoints from part 2 (fal-ai/elevenlabs/dubbing, fal-ai/heygen/v2/translate/*, replicate elevenlabs/dubbing, heygen/video-translate) were re-checked as present in the catalog.
- Kling Kolors try-on is deprecated in fal's catalog (still served); IDM-VTON (fal unlisted, Replicate cuuupid/idm-vton) has non-commercial weights.
- Several fal utilities (ffmpeg metadata/waveform/loudnorm/images-to-video/merge-videos, wizper, whisper, florence-2, cat-vton, idm-vton, extract-audio) are listed at '$0 per compute second'; their real GPU-time billing cannot be checked without a key. Beatoven endpoints are unlisted (no llms.txt); $0.10/request comes from the model page billing block.
- Replicate community models (victor-upmeet/whisperx, fictions-ai/autocaption, tencent/hunyuanvideo-foley, bytedance/latentsync, cuuupid/idm-vton, firtoz/trellis) need a version id (recorded in endpoint as owner/name:version) and bill by GPU time.
- fal-ai/gemini-omni-flash/edit resolves (unlisted alias of google/gemini-omni-flash/edit from part 1); not recorded separately.

## 15. Sources

- fal catalog: `https://api.fal.ai/v1/models` (paged, 1,516 active) and `?endpoint_id=<id>`
- fal OpenAPI per endpoint: `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` (the exact URL is in each record's `schemaUrl`)
- fal pricing and docs: `https://fal.ai/models/<id>/llms.txt`; model page `https://fal.ai/models/<id>` (billing block for unlisted apps)
- Replicate model pages `https://replicate.com/<owner>/<name>` (embedded schema, billing, version); search `https://replicate.com/api/search?query=`
- The parity studio: `{studio-docs}/llms-full.txt`, `{studio-docs}/docs/llms.txt`, `{studio-docs}/docs/openapi.json`, `{studio-dashboard}/api/v2/pricing/models/?page=1..4`, `{studio-dashboard}/models/<id>/llms.txt`
- Feature context: [`parity-studios.md`](./parity-studios.md), [`parity-image-studios.md`](./parity-image-studios.md), [`parity-inventory.md`](./parity-inventory.md)
