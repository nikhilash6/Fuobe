# Paid model APIs, part 2: editing, audio, training and control endpoints

As of **2026-10-16**. This extends [`paid-model-apis.md`](./paid-model-apis.md). It covers the parity studio's features that part 1 left open: multi-shot, draft mode, extend, reframe, relight, inpaint and erase, voice tools, dubbing, LoRA (Soul ID) training, draw-to-video and storyboards.
The machine-readable companion is [`paid-model-apis-2.json`](./paid-model-apis-2.json). It holds **202 endpoint records**: 184 fal and 18 Replicate. The JSON also holds the recommendations, the gaps and the ElevenLabs premade voice list.
## How this was verified

- **fal schemas** come from each endpoint's OpenAPI document, `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`, which was parsed by a script. So field names, enums, defaults and limits were not retyped by hand. Nested objects and arrays keep their full sub-schema, as `itemSchema` and `fields`.
- **fal prices** come from `https://fal.ai/models/<id>/llms.txt`. **fal status** comes from the catalog at `https://api.fal.ai/v1/models` (1,516 active endpoints).
- **Unlisted endpoints** were found by guessing ids and probing the OpenAPI URL. A `null` body means the endpoint does not exist.
- **Replicate schemas** come from the `dereferenced_openapi_schema` and `billingConfig` embedded in each model page.
- **ElevenLabs voices** come from `https://api.elevenlabs.io/v1/voices`, which is public and needs no key.
- **No paid inference calls were made.** Runtime behaviour that the schemas do not state is marked *unverified*.
## 1. Recommended default per the parity studio's feature

| The parity studio's feature | Default endpoint(s) | Exact key fields | Price | Alternatives |
|---|---|---|---|---|
| **Multi-shot** | `fal-ai/kling-video/v3/pro/text-to-video` | multi_prompt:[{prompt, duration:'1'..'15'}] (1-6 shots, sum<=duration<=15s), shot_type:'customize'\|'intelligent'; prompt XOR multi_prompt | $0.112/s (audio off), $0.168/s (audio on) | fal-ai/kling-video/o3/pro/reference-to-video; wan/v2.6/text-to-video; bytedance/seedance-2.5/text-to-video (prompt-driven) |
| **Draft mode** | `bytedance/seedance-2.5/{text,image,reference}-to-video + bytedance/seedance-2.5/draft/complete` | draft:true -> output.draft_id (7 days, same account) -> draft/complete {draft_id} -> 1080p | 480p draft ≈ $0.22/s, then 1080p completion ≈ $1.164/s | blackforestlabs/flux-3/*/draft + blackforestlabs/flux-3/draft-enhance |
| **Extend** | `minimax/h3-max-turbo/extend-video` | video_url, prompt, duration (number 0.71-15), resolution '768P', output 'extended'\|'continuation' | $0.04/s at 768P | bytedance/seedance-2.5/reference-to-video task:'extension'; fal-ai/veo3.1/fast/extend-video (until 2026-11-17); fal-ai/ltx-2.3/extend-video; blackforestlabs/flux-3/extend-video; fal-ai/pixverse/v6/extend; xai/grok-imagine-video/extend-video; Kling: ffmpeg-api/extract-frame(last) -> kling i2v -> ffmpeg-api/merge-videos |
| **Reframe** | `luma/agent/ray/v3.2/reframe` | video_url (<=10s), prompt, aspect_ratio (required), resolution 540p\|720p\|1080p, source_position{x_norm,y_norm,w_norm,h_norm} | $0.06/s at 540p, $0.12/s at 720p, $0.36/s at 1080p (per source second) | fal-ai/ltx-2.3/reframe (cheaper, no prompt); fal-ai/wan-vace-14b/reframe |
| **Relight video** | `minimax/h3-max/relight` | video_url (<=15s), reference_image_url (sphere render of target lighting), resolution '768P' | $0.08/s at 768P | fal-ai/lightx/relight (ic + relight_prompt + bg_source); fal-ai/id-v2v/relight (relit first frame) |
| **Inpaint / Draw to Edit** | `fal-ai/flux-pro/v1/fill` | image_url, mask_url (white = fill, same size), prompt | $0.05/MP | ideogram/v4.5/edit (mask inverted); fal-ai/z-image/turbo/inpaint (mask_image_url); fal-ai/flux-lora-fill (with Soul ID LoRA); fal-ai/chrono-edit-lora-gallery/paintbrush (sketch); fal-ai/nano-banana-pro/edit (no mask: composite strokes) |
| **Erase / remove object** | `fal-ai/flux-pro/v1/erase` | image_url, mask_url (white = erase), dilate_pixels | $0.03 for the first MP | fal-ai/object-removal/mask; fal-ai/bria/eraser; fal-ai/finegrain-eraser/mask; video: bria/video/erase/mask, fal-ai/void-video-inpainting |
| **TTS voice picker** | `elevenlabs/tts/eleven-v4` | text, voice (premade name or voice_id), stability 0-1 (0.5), similarity_boost 0-1 (0.75); speed only on multilingual-v2/turbo-v2.5 (0.7-1.2) | $0.08 per 1k characters | fal-ai/elevenlabs/tts/eleven-v3; fal-ai/elevenlabs/tts/multilingual-v2 (speed/style); fal-ai/minimax/speech-2.8-hd |
| **Voice change** | `fal-ai/elevenlabs/voice-changer` | audio_url, voice, remove_background_noise; for video: elevenlabs/audio-isolation(video_url) -> voice-changer -> ffmpeg-api/merge-audio-video | $0.30/min | fal-ai/chatterbox/speech-to-speech (any target voice from a sample); resemble-ai/chatterboxhd/speech-to-speech |
| **Voice clone** | `fal-ai/minimax/voice-clone -> fal-ai/minimax/speech-2.8-hd` | audio_url (>=10s) -> custom_voice_id -> voice_setting.voice_id (use within 7 days) | $1.50 per clone, then $0.10 per 1k characters | fal-ai/qwen-3-tts/clone-voice/1.7b -> qwen-3-tts/text-to-speech/1.7b; fal-ai/chatterbox/text-to-speech (zero-shot audio_url); fal-ai/index-tts-2/text-to-speech; fal-ai/kling-video/create-voice (for Kling elements) |
| **Translate / dub** | `fal-ai/heygen/v2/translate/precision` | video_url (<=8 min), output_language (display-name enum e.g. 'Spanish'), translate_audio_only, enable_caption | $0.10/s | fal-ai/heygen/v2/translate/speed; fal-ai/elevenlabs/dubbing (+ sync lipsync); replicate heygen/video-translate (cheaper) |
| **Soul ID training** | `fal-ai/z-image-turbo-trainer-v2 -> fal-ai/z-image/turbo/lora` | image_data_url (zip, ROOT.txt captions), steps, learning_rate, default_caption -> diffusers_lora_file.url -> loras:[{path,scale}] | $0.85 per 1,000 steps (500-step floor), then $0.0085/MP | fal-ai/flux-lora-fast-training -> fal-ai/flux-lora; fal-ai/flux-2-trainer -> fal-ai/flux-2/lora; fal-ai/qwen-image-2512-trainer -> fal-ai/qwen-image-2512/lora; fal-ai/wan-22-image-trainer -> fal-ai/wan/v2.2-a14b/text-to-image/lora |
| **Draw to video** | Client-side composite of arrows/notes onto the frame -> image-to-video (bytedance/seedance-2.5/image-to-video or fal-ai/kling-video/o3/pro/image-to-video) with an instruction to follow and then remove the annotations | image_url = annotated frame, prompt ('follow the drawn arrows, then remove all annotations'); trajectory alt: track / trajectories = [[{x,y},...]] pixel coords (<=121 pts per track) | model price | fal-ai/wan-ati (deprecated; track); fal-ai/wan-move (deprecated; trajectories); minimax/h3-max/camera-controls (camera path) |
| **Storyboard** | `blackforestlabs/flux-3/keyframes-to-video` | keyframes:[{image_url,frame_index}] (1-10), duration (required) | $0.17/s at 720p | fal-ai/kling-image/o3/text-to-image result_type:'series'; fal-ai/ltx-2.3-quality/ingredient |

## 2. Multi-shot and draft mode

**Kling 3.0 and Kling O3** use the field `multi_prompt`, an array of `{prompt, duration}`.
- `duration` is a **string** enum, `"1"` to `"15"`. It defaults to `"5"`, and `prompt` is required in each item.
- `prompt` and `multi_prompt` are mutually exclusive.
- The Turbo schema states the limits: 1 to 6 shots, with a total of 15 s or less. Replicate's `kwaivgi/kling-v3-video` states that the shot durations must add up exactly to `duration`.
- `shot_type` takes `customize` (the default, which uses your shots) or `intelligent` (the model splits one prompt into shots). Turbo has no `shot_type`.
- On Replicate, `multi_prompt` is a **JSON string**, not an array.

**Seedance 2.5 and 2.0** have **no multi-shot field**. Multi-shot is driven by the prompt: describe the shots and cuts in the text.

**Wan 2.6** uses `multi_shots`, a boolean.
- It defaults to true on t2v and r2v and to false on i2v.
- It works only when `enable_prompt_expansion` is true.
- For explicit shots, write them in the prompt as `Shot 1 [0-3s] ... Shot 2 [3-6s] ...`.
- Wan 2.7 r2v also has `multi_shots`, defaulting to false. Wan 2.7 t2v/i2v and Wan 3.0 do not.

**PixVerse V6** has `generate_multi_clip_switch`. It cuts automatically and takes no per-shot prompts.

**Seedance 2.5 draft mode** works in two steps:
1. Send `draft: true` to `bytedance/seedance-2.5/{text,image,reference}-to-video`. The model renders at 480p and the output gains a `draft_id`.
2. POST `{draft_id}` to `bytedance/seedance-2.5/draft/complete` to get the 1080p render. Only 1080p is allowed.

The `draft_id` is valid for 7 days and only for the account that created it.

**FLUX 3** has its own draft flow. Each `*/draft` endpoint returns `draft_cache`. Pass its URL as `draft_cache_url` to `blackforestlabs/flux-3/draft-enhance`, which renders 1080p at $0.29/s.

| Endpoint | Provider / status | Key fields (* = required) | Notes | Price |
|---|---|---|---|---|
| `fal-ai/kling-video/v3/pro/text-to-video` | fal / active | `prompt`, `aspect_ratio`, `duration`, `generate_audio`, `negative_prompt`, `multi_prompt`, `shot_type` | multi_prompt[{prompt,duration}] 1-6 shots; duration per shot is a STRING enum '1'..'15'; total must not exceed top-level duration (<=15s). prompt and multi_prompt are mutually exclusive. shot_type 'intelligent' lets model split a single prompt. | For every second of video you generated, you will be charged $0.112 (audio off) or $0.168 (audio on), if voice control … |
| `fal-ai/kling-video/v3/pro/image-to-video` | fal / active | `prompt`, `start_image_url`*, `end_image_url`, `duration`, `generate_audio`, `negative_prompt`, `multi_prompt`, `shot_type`, `elements`, `elements[].voice_id` | Image field is start_image_url (not image_url). Also takes elements[] with voice_id from fal-ai/kling-video/create-voice. | For every second of video you generated, you will be charged $0.112 (audio off) or $0.168 (audio on), if voice control … |
| `fal-ai/kling-video/v3/standard/text-to-video` | fal / active | `prompt`, `aspect_ratio`, `duration`, `generate_audio`, `negative_prompt`, `multi_prompt`, `shot_type` | Same multi_prompt/shot_type schema as Pro; cheaper ($0.084/s audio off). | For every second of video you generated, you will be charged $0.084 (audio off) or $0.126 (audio on), if voice control … |
| `fal-ai/kling-video/v3/turbo/pro/text-to-video` | fal / active | `prompt`, `aspect_ratio`, `duration`, `multi_prompt` | Schema states the limits explicitly: 1-6 shots, total <=15s, mutually exclusive with prompt. No shot_type field. | For every second of video you generate, you will be charged $0.14 . For example, a 5s video will cost $0.70. |
| `fal-ai/kling-video/o3/pro/text-to-video` | fal / active | `prompt`, `aspect_ratio`, `duration`, `generate_audio`, `multi_prompt`, `shot_type` | multi_prompt + shot_type like v3. | For every second of video you generated, you will be charged $0.112 (audio off) or $0.14 (audio on). For example, a 5s … |
| `fal-ai/kling-video/o3/pro/image-to-video` | fal / active | `prompt`, `image_url`*, `end_image_url`, `duration`, `generate_audio`, `multi_prompt`, `shot_type` | Image field is image_url (v3 uses start_image_url). | For every second of video you generated, you will be charged $0.112 (audio off) or $0.14 (audio on). For example, a 5s … |
| `fal-ai/kling-video/o3/pro/reference-to-video` | fal / active | `prompt`, `start_image_url`, `image_urls`, `end_image_url`, `aspect_ratio`, `duration`, `generate_audio`, `multi_prompt`, `shot_type`, `elements`, `elements[].voice_id` | multi_prompt + elements (@Element1) + image_urls (@Image1); max 4 elements+refs when a video element is used. | For every second of video you generated, you will be charged $0.112 (audio off) or $0.14 (audio on). For example, a 5s … |
| `bytedance/seedance-2.5/text-to-video` | fal / active | `prompt`*, `aspect_ratio`, `resolution`, `duration`, `generate_audio`, `draft` | No multi-shot field: multi-shot is prompt-driven (describe shots/cuts in prompt). draft:true -> 480p preview + draft_id. | For 480p, your request will cost roughly $0.2205 per second of generated video, for 720p, you will be charged roughly … |
| `bytedance/seedance-2.5/image-to-video` | fal / active | `prompt`, `image_url`*, `end_image_url`, `aspect_ratio`, `resolution`, `duration`, `generate_audio`, `draft` | Prompt-driven multi-shot; draft:true supported. | For 480p, your request will cost roughly $0.2205 per second of generated video, for 720p, you will be charged roughly … |
| `bytedance/seedance-2.5/draft/complete` | fal / active | `resolution`, `draft_id`* | Draft mode step 2: send draft_id (from a draft:true run, valid 7 days, same account) -> 1080p render. Only 1080p. | Your request will cost roughly $1.164 per second of generated video. Your request will cost roughly $0.0234 per 1000 … |
| `bytedance/seedance-2.0/text-to-video` | fal / active | `prompt`*, `aspect_ratio`, `resolution`, `duration`, `generate_audio` | Prompt-driven multi-shot ('multi-shot editing' per fal description); no draft field; 4-15s; 4k resolution option. | For every second of 720p video you generated, you will be charged $0.3034/second and for 1080p you will be charged … |
| `bytedance/seedance-2.0/image-to-video` | fal / active | `prompt`*, `image_url`*, `end_image_url`, `aspect_ratio`, `resolution`, `duration`, `generate_audio` | Prompt-driven multi-shot; no draft. | For every second of 720p video you generated, you will be charged $0.3034/second and for 1080p you will be charged … |
| `bytedance/seedance-2.0/reference-to-video` | fal / active | `prompt`*, `image_urls`, `video_urls`, `aspect_ratio`, `resolution`, `duration`, `generate_audio` | No task field (no extension mode on 2.0). <=9 images, <=3 videos (2-15s combined), <=3 audios; total <=12 files. | For every second of 720p video you generated, you will be charged $0.3034/second and for 1080p you will be charged … |
| `wan/v2.6/text-to-video` | fal / active | `prompt`*, `audio_url`, `aspect_ratio`, `resolution`, `duration`, `seed`, `negative_prompt`, `multi_shots` | multi_shots boolean (default true) only works with enable_prompt_expansion=true. Explicit shots via prompt syntax 'Shot 1 [0-3s] ... Shot 2 [3-6s] ...'. duration 5\|10\|15 (string enum). | Your request will cost $0.10 per second for 720p, $0.15 per second for 1080p. |
| `wan/v2.6/image-to-video` | fal / active | `prompt`*, `image_url`*, `audio_url`, `resolution`, `duration`, `seed`, `negative_prompt`, `multi_shots` | multi_shots default FALSE on i2v. | Your request will cost $0.10 per second for 720p, $0.15 per second for 1080p. |
| `wan/v2.6/reference-to-video` | fal / active | `prompt`*, `video_urls`*, `aspect_ratio`, `resolution`, `duration`, `seed`, `negative_prompt`, `multi_shots` | video_urls (1-3, @Video1..3, >=16fps); duration 5\|10; multi_shots default true; prompt '[0-3s] Shot 1. [3-6s] Shot 2.' | Your request will cost $0.10 per second for 720p, $0.15 per second for 1080p. |
| `fal-ai/wan/v2.7/text-to-video` | fal / active | `prompt`*, `audio_url`, `aspect_ratio`, `resolution`, `duration`, `seed`, `negative_prompt` | No multi_shots field on 2.7 t2v (duration is an integer enum 2..15). | Your request will cost $0.1 per second for 720p resolution. For 1080p your request will cost $0.15 per second. |
| `fal-ai/wan/v2.7/image-to-video` | fal / active | `prompt`, `image_url`, `end_image_url`, `video_url`, `audio_url`, `resolution`, `duration`, `seed`, `negative_prompt` | No multi_shots field; takes video_url too (continuation). | Your request will cost $0.1 per second for 720p resolution. For 1080p your request will cost $0.15 per second. |
| `fal-ai/wan/v2.7/reference-to-video` | fal / active | `prompt`*, `reference_image_urls`, `aspect_ratio`, `resolution`, `duration`, `seed`, `negative_prompt`, `multi_shots` | multi_shots default false; reference_image_urls / reference_video_urls; duration integer 2..10; billed input+output seconds when videos given. | Your request will cost $0.10 per second. When video inputs are provided, billing duration is calculated as input video … |
| `alibaba/wan-3.0/text-to-video` | fal / active | `prompt`*, `audio`, `aspect_ratio`, `resolution`, `duration`, `seed` | No multi-shot field; duration integer 2..30 (null = smart); audio boolean (not generate_audio). | For every second of video you generate, you will be charged $0.05 480p, $0.10 720p, or $0.20 1080p. For example, a 5s … |
| `alibaba/wan-3.0/image-to-video` | fal / active | `prompt`, `start_image_url`*, `end_image_url`, `audio`, `aspect_ratio`, `resolution`, `duration`, `seed` | start_image_url required; audio boolean. | For every second of video you generate, you will be charged $0.05 480p, $0.10 720p, or $0.20 1080p. For example, a 5s … |
| `fal-ai/pixverse/v6/text-to-video` | fal / active | `prompt`*, `aspect_ratio`, `resolution`, `duration`, `generate_audio_switch`, `seed`, `negative_prompt`, `generate_multi_clip_switch` | generate_multi_clip_switch boolean = automatic multi-clip with camera changes (no per-shot prompts). | Billing is calculated per second of video generated. For 360p, your request will cost $0.025 per second without audio … |
| `blackforestlabs/flux-3/text-to-video/draft` | fal / active | `prompt`*, `aspect_ratio`, `duration`, `generate_audio` | FLUX 3 draft mode: $0.06/s 720p preview; returns draft_cache (file) -> pass its url as draft_cache_url to blackforestlabs/flux-3/draft-enhance for 1080p. | Your request will be charged at 0.06 $ per second of generated draft video (720p). |
| `blackforestlabs/flux-3/draft-enhance` | fal / active | `draft_cache_url`* | draft_cache_url from any flux-3 */draft endpoint; $0.29/s 1080p. | Your request will be charged at 0.29 $ per second of the enhanced video (full-quality 1080p render). Synchronized audio … |
| `kwaivgi/kling-v3-video` | replicate | `prompt`*, `start_image`, `end_image`, `aspect_ratio`, `duration`, `generate_audio`, `negative_prompt`, `multi_prompt` | multi_prompt is a JSON STRING here: '[{"prompt":...,"duration":N}]', max 6 shots, >=1s each, total must EQUAL duration. | $0.168 per second of output video (standard [{"description": "no", "subtype": "boolean", "title": "with audio", "type": … |

## 3. Extend

**Seedance 2.5 has no extend endpoint.** Every id guessed for one returned 404. The extend path is `bytedance/seedance-2.5/reference-to-video` with `task: "extension"` and `video_urls: [source]`. The same `task` field also takes `editing` and `reference`.

**Kling has no extend endpoint on fal.** Fuobe can build one from three calls: `fal-ai/ffmpeg-api/extract-frame` with `frame_type: "last"`, then a Kling i2v call, then `fal-ai/ffmpeg-api/merge-videos`.

| Endpoint | Provider / status | Key fields (* = required) | Notes | Price |
|---|---|---|---|---|
| `bytedance/seedance-2.5/reference-to-video` | fal / active | `prompt`, `image_urls`, `video_urls`, `aspect_ratio`, `resolution`, `duration`, `generate_audio`, `seed`, `draft`, `task` | THIS is Seedance 2.5 extend/edit: task enum reference\|editing\|extension with video_urls (@Video1). extension coerces aspect_ratio=auto. Up to 30 images, 10 videos (1.8-30.2s each, combined <=30.2s), 10 audios; total files <=50. Also draft:true. | For 480p, your request will cost roughly $0.2205 per second of generated video, for 720p, you will be charged roughly … |
| `fal-ai/veo3.1/extend-video` | fal / unlisted | `prompt`*, `video_url`*, `aspect_ratio`, `resolution`, `duration`, `generate_audio`, `seed`, `negative_prompt` | Unlisted; fal banner: deprecated Nov 17 2026. video_url must be 720p/1080p 16:9 or 9:16. duration string default '7s'. | For every second of video you generated, you will be charged $0.20 (audio off) or $0.40 (audio on). For example, a 5s … |
| `fal-ai/veo3.1/fast/extend-video` | fal / unlisted | `prompt`*, `video_url`*, `aspect_ratio`, `resolution`, `duration`, `generate_audio`, `seed`, `negative_prompt` | Unlisted; deprecated Nov 17 2026. | For every second of video you generated, you will be charged $0.10 (audio off) or $0.15 (audio on). For example, a 5s … |
| `minimax/h3-max/extend-video` | fal / active | `prompt`*, `video_url`*, `aspect_ratio`, `resolution`, `duration`, `seed`, `reference_audio_urls`, `output` | duration is a NUMBER 0.71-15 (s of new footage). output 'extended' (source+new) or 'continuation'. resolution enum is UPPERCASE '768P'. Source 1.625-60s, <=50MB. | Billing is calculated per second of generated video, plus reference input charges beyond the included allowance. Video … |
| `minimax/h3-max-turbo/extend-video` | fal / active | `prompt`*, `video_url`*, `aspect_ratio`, `resolution`, `duration`, `seed`, `reference_audio_urls`, `output` | Same schema as H3 Max extend at half price. | Billing is calculated per second of newly generated video. Your request will cost $0.025 per second at 480p, $0.04 per … |
| `fal-ai/pixverse/v6/extend` | fal / active | `prompt`*, `video_url`*, `resolution`, `duration`, `generate_audio_switch`, `seed`, `negative_prompt` | duration integer 1-15. | Billing is calculated per second of video generated. For 360p, your request will cost $0.025 per second without audio … |
| `fal-ai/pixverse/extend` | fal / active | `prompt`*, `video_url`*, `resolution`, `duration`, `generate_audio_switch`, `seed`, `negative_prompt` | model enum v3.5..v6 (default v4.5); duration string enum 5\|8. | For 5s video your request will cost $0.15 for 360p and 540p, $0.2 for 720p and $0.4 for 1080p. For $1 you can run this … |
| `fal-ai/pixverse/extend/fast` | fal / active | `prompt`*, `video_url`*, `resolution`, `generate_audio_switch`, `seed`, `negative_prompt` | Fast variant; no duration field. | For 5s video your request will cost 0.3$ for 360p and 540p, 0.4$ for 720p and 0.8$ for 1080p. For $1 you can run this … |
| `fal-ai/ltx-2.3/extend-video` | fal / active | `prompt`, `video_url`*, `duration`, `mode` | mode 'start'\|'end' (extend backwards or forwards); duration 2-20 s number; context 1-20 s. | Your request will cost $0.10 per second. |
| `fal-ai/ltx-2.3-quality/extend-video` | fal / active | `prompt`*, `end_image_url`, `video_url`*, `resolution`, `generate_audio`, `seed`, `negative_prompt`, `extend_direction` | extend_direction forward\|backward; num_frames 9-481 incl. num_context_frames overlap; end_image_url keyframe; billed per MP of new frames only. | Your request will cost $0.0024075 per megapixel of generated video data (width × height × num_frames), rounded up. Only … |
| `fal-ai/ltx-2.3-22b/extend-video` | fal / active | `prompt`*, `end_image_url`, `video_url`*, `generate_audio`, `seed`, `negative_prompt`, `extend_direction` | extend_direction, num_context_frames, end_image_url; many sampler knobs. | Your request will cost $0.001605 per megapixel of generated video data (width × height × frames), rounded up. For … |
| `blackforestlabs/flux-3/extend-video` | fal / active | `prompt`*, `video_url`*, `aspect_ratio`, `resolution`, `duration`, `generate_audio` | video_url MP4 <50MB, <15s; duration auto\|5..20 (string enum); resolution up to 2160p. | Your request will be charged at 0.41 $ per second of generated video at 720p, and 0.53 $ per second at 1080p. |
| `blackforestlabs/flux-3/extend-video/draft` | fal / active | `prompt`*, `video_url`*, `aspect_ratio`, `duration`, `generate_audio` | Draft extend ($0.12/s) -> draft_cache -> flux-3/draft-enhance. | Your request will be charged at 0.12 $ per second of generated draft video (720p). |
| `xai/grok-imagine-video/extend-video` | fal / active | `prompt`*, `video_url`*, `duration` | duration integer 2-10; source MP4 2-15s. | For a 6s 480p video your request will cost $0.36 ($0.05 per second of video output + $0.01 per second of video input). … |
| `fal-ai/magi-distilled/extend-video` | fal / active | `prompt`*, `video_url`*, `aspect_ratio`, `resolution`, `seed` | start_frame + num_frames. | Your request will cost $0.32 to generate one four-second video. For $1 you can run this model approximately 3 times. … |
| `fal-ai/ffmpeg-api/extract-frame` | fal / active | `video_url`* | frame_type 'last' -> feed to any i2v model as a fallback 'extend' for models with no extend endpoint (Kling). | $0.0002 per seconds |
| `fal-ai/ffmpeg-api/merge-videos` | fal / active | `video_urls`*, `resolution` | Stitch source + continuation clips (Kling fallback extend, client-side multi-shot). | $0 per compute seconds |
| `fal-ai/ffmpeg-api/merge-audio-video` | fal / active | `video_url`*, `audio_url`* | Remux changed/dubbed audio back onto a video (Voice Change for video inputs). | $0.0002 per seconds |
| `minimax/h3-max/insert-video` | fal / active | `prompt`, `reference_image_urls`, `video_url`*, `resolution`, `duration`, `seed`, `start_time`*, `resume_time`* | Inserts a generated scene between start_time and resume_time (mid-clip extend). | Your request will cost $0.05 per second of generated scene at 480p or $0.06 per second at 768p. Only the newly … |
| `fal-ai/elevenlabs/audio-isolation` | fal / active | `video_url`, `audio_url` | Accepts video_url -> clean voice audio. | $0.1 per minutes |

## 4. Reframe, relight, restyle and colour

**parity-studio-style relight presets.** `minimax/h3-max/relight` takes `reference_image_url`, which must be a **sphere render** that shows the target lighting. Fuobe can render a lit sphere on the client, for example with three.js, from preset lights or from up to 2 custom lights (colour, angle, brightness), then upload that image.

`fal-ai/lightx/relight` is controlled by text instead. Use `relit_cond_type: "ic"` with `relight_parameters: {relight_prompt, bg_source: Left|Right|Top|Bottom}`.

**There is no video colour-grade endpoint.**

| Endpoint | Provider / status | Key fields (* = required) | Notes | Price |
|---|---|---|---|---|
| `luma/agent/ray/v3.2/reframe` | fal / active | `prompt`*, `video_url`*, `aspect_ratio`*, `resolution`, `duration`, `source_position` | Source <=10s; aspect_ratio required; resolution 540p\|720p\|1080p; source_position {x_norm,y_norm,w_norm,h_norm}. Billed per source second. | Reframe is billed per started source second: $0.06/s at 540p, $0.12/s at 720p and $0.36/s at 1080p. A 5s source will … |
| `fal-ai/luma-dream-machine/ray-2/reframe` | fal / unlisted | `prompt`, `image_url`, `video_url`*, `aspect_ratio`* | Unlisted; Ray 2 family deprecated 2026-10-25. Pixel coords x_start/x_end/y_start/y_end, grid_position_x/y. | $0.2 per seconds |
| `fal-ai/ltx-2.3/reframe` | fal / active | `video_url`*, `aspect_ratio`, `resolution` | Simplest reframe: video_url + aspect_ratio (1:1,4:5,5:4,9:16,16:9) + resolution 720p\|1080p. No prompt. | Your request will cost $0.10 per second for 720p output or $0.20 per second for 1080p output, billed on the duration of … |
| `fal-ai/ltx-2.3-quality/outpaint` | fal / active | `prompt`*, `video_url`*, `aspect_ratio`, `resolution`, `generate_audio`, `seed`, `negative_prompt` | Video outpaint with prompt + aspect_ratio + source_scale. | Your request will cost $0.0024075 per megapixel of generated video data (width × height × frames), rounded up. For … |
| `fal-ai/wan-vace-14b/reframe` | fal / active | `prompt`, `first_frame_url`, `last_frame_url`, `video_url`*, `aspect_ratio`, `resolution`, `seed`, `negative_prompt` | Open-weights reframe; aspect_ratio only auto\|16:9\|1:1\|9:16; <=241 frames. | Your request will cost $0.08 per video second for 720p, $0.06 per video second for 580p, $0.04 per video second for … |
| `fal-ai/wan-vace-apps/long-reframe` | fal / active | `prompt`, `video_url`*, `aspect_ratio`, `resolution`, `seed`, `negative_prompt` | Scene-split long-video reframe; paste_back. | Your request will cost $0.08 per 2 seconds of output video for 720p, $0.06 per 2 seconds of output video for 580p, abd … |
| `fal-ai/wan-22-vace-fun-a14b/reframe` | fal / active | `prompt`, `first_frame_url`, `last_frame_url`, `video_url`*, `aspect_ratio`, `resolution`, `seed`, `negative_prompt` | Reframe via Wan 2.2 VACE Fun. | Your request will cost $0.10 per video second for 720p, $0.075 per video second for 580p, $0.05 per video second for … |
| `minimax/h3-max/relight` | fal / active | `video_url`*, `aspect_ratio`, `resolution`, `seed`, `reference_image_url`* | reference_image_url = a SPHERE RENDER of the target lighting (Fuobe can render a lit sphere client-side from parity-studio-style light presets). Source <=15s, resampled to 24fps. | Billing is calculated per second of generated video, which matches the source video length. Video costs $0.05 per … |
| `fal-ai/lightx/relight` | fal / active | `prompt`, `video_url`*, `seed`, `relight_parameters.relight_prompt`, `relight_parameters.bg_source`, `relit_cond_img_url` | relit_cond_type ic\|ref\|hdr\|bg. ic: relight_parameters{relight_prompt,bg_source Left\|Right\|Top\|Bottom,cfg,use_sky_mask}. ref/hdr/bg: relit_cond_img_url. ~49 frames. | Your request will cost 0.1$ per output video second. |
| `fal-ai/lightx/recamera` | fal / active | `prompt`, `video_url`*, `seed` | Camera re-render (not lighting): camera traj\|target, trajectory{theta[],phi[],radius[]}. | Your request will cost 0.1$ per output video second. |
| `fal-ai/id-v2v/relight` | fal / active | `prompt`*, `image_url`*, `video_url`*, `resolution`, `seed`, `keyframes` | Restyle driven by an edited FIRST FRAME (image_url) + keyframes[{frame_index,image_url}] <=5. Pair with an image relight/edit model on frame 1. | $0.2 per seconds |
| `decart/lucy-restyle` | fal / active | `prompt`*, `video_url`*, `resolution`, `seed` | Cheapest restyle ($0.01/s); prompt-only. | $0.01 per seconds |
| `luma/agent/ray/v3.2/video-to-video` | fal / active | `prompt`*, `start_image_url`, `video_url`*, `resolution`, `duration`, `keyframes` | Prompt edit with edit_strength adhere_1..reimagine_3, start_image_url or keyframes[]+keyframe_indexes[] (<=64), controls{trajectory,normals,pose,face,depth}, hdr/exr_export. | For 5s video your request will cost $0.72 for 540p, $1.08 for 720p and $2.16 for 1080p. For 10s, $1.44 at 540p, $2.16 … |
| `fal-ai/ltx-2.3-quality/day-to-night` | fal / active | `prompt`, `video_url`*, `resolution`, `generate_audio`, `seed`, `negative_prompt` | Fixed effect: day->night. | Your request will cost $0.0024075 per megapixel of generated video data (width × height × frames), rounded up. For … |
| `fal-ai/ltx-2.3-quality/colorization` | fal / active | `prompt`, `video_url`*, `resolution`, `generate_audio`, `seed`, `negative_prompt` | Colorize B&W video. | $0.0024075 per megapixels |
| `fal-ai/ltx-2.3-quality/hdr` | fal / active | `prompt`*, `video_url`*, `resolution`, `generate_audio`, `seed`, `negative_prompt` | SDR->HDR; outputs preview_video + exr_frames_url (not video). | Your request will cost $0.0027075 per megapixel of generated HDR video data (width × height × frames), rounded up. For … |
| `fal-ai/post-processing/color-correction` | fal / active | `image_url`* | IMAGE only: temperature/brightness/contrast/saturation/gamma. No video color-grade endpoint exists on fal; grade video client-side (WebGL/ffmpeg LUT) or per-frame. | $0.001 per images |
| `fal-ai/image-editing/color-correction` | fal / active | `image_url`*, `aspect_ratio`, `seed` | IMAGE only, generative. | $0.04 per images |
| `luma/reframe-video` | replicate | `prompt`, `video_url`, `aspect_ratio` | aspect_ratio + video/video_url + x/y start/end, grid_position_x/y. | $0.06 per second of output video |
| `luma/modify-video` | replicate | `prompt`, `first_frame_url`, `video_url` | mode (adhere/flex/reimagine) + prompt + first_frame. | $0.019 per million output video pixels (total) |

## 5. Video background removal, segmentation, depth and object removal

| Endpoint | Provider / status | Key fields (* = required) | Notes | Price |
|---|---|---|---|---|
| `fal-ai/ben/v2/video` | fal / active | `video_url`*, `seed` | Cheapest ($0.001/MP); background_color [r,g,b] else transparent. | $0.001 per megapixels |
| `fal-ai/birefnet/v2/video` | fal / active | `video_url`* | video_output_type 'VP9 (.webm)' or 'PRORES4444 (.mov)' for alpha; output_mask -> mask_video. | $0 per compute seconds |
| `bria/video/background-removal/v3` | fal / active | `video_url`* | $0.05/s; background_color enum incl. Transparent; output_container_and_codec default webm_vp9; auto_zoom. | Your request will cost $0.05 per second. |
| `bria/video/background-removal` | fal / active | `video_url`* | $0.14/s; <30s, <4000x4000. | Your request will cost $0.14 per second. |
| `veed/video-background-removal` | fal / active | `video_url`* | Output is an ARRAY video[] (vp9 alpha = 1 file; h264 = rgb + alpha files). | Your request will cost $0.0225 per 30 frames (Refine Foreground Edges: ON) / $0.015 (Refine: OFF). |
| `veed/video-background-removal/fast` | fal / active | `video_url`* | Same as VEED, cheaper. | Your request will cost $0.012 per 30 frames (Refine Foreground Edges: ON) / $0.008 cents (Refine: OFF). |
| `veed/video-background-removal/green-screen` | fal / active | `video_url`* | Chroma key with spill_suppression_strength. | Your request will cost $0.025 per 30 frames. |
| `pixelcut/video-background-removal` | fal / active | `video_url`* | background transparent\|black\|white\|green\|blue\|magenta\|custom + background_color{r,g,b}. | Your request will cost $0.022 per 30 frames. |
| `fal-ai/sam-3/video` | fal / active | `prompt`, `video_url`*, `point_prompts`, `box_prompts` | Text prompt ('person, cloth'), point_prompts[{x,y,label,object_id}], box_prompts[]; apply_mask overlays; use for masks feeding erase/inpaint. | Your request will cost $0.005 per 16 frames of video input. |
| `fal-ai/sam-3-1/video` | fal / active | `prompt`, `video_url`*, `point_prompts`, `box_prompts` | Adds max_num_objects (<=128). | Your request will cost $0.01 per 16 frames of video input. |
| `fal-ai/depth-anything-video` | fal / active | `video_url`*, `resolution` | model VDA-Small\|Base\|Large; colormap; side_by_side; include_raw_depths .npz; max_frames <=2400. | Your request will cost $0.04 per second of video. |
| `fal-ai/wan-vace-14b/depth` | fal / active | `prompt`*, `first_frame_url`, `last_frame_url`, `video_url`*, `aspect_ratio`, `resolution`, `seed`, `negative_prompt` | Depth-CONDITIONED generation (not depth estimation). | Your request will cost $0.08 per video second for 720p, $0.06 per video second for 580p, $0.04 per video second for … |
| `bria/video/erase/mask` | fal / active | `video_url`*, `mask_video_url`* | mask_video_url; source must be <5s (auto_trim). | $0.14 per seconds |
| `bria/video/erase/prompt` | fal / active | `prompt`*, `video_url`* | prompt names object; <5s. | $0.14 per seconds |
| `bria/video/erase/keypoints` | fal / active | `video_url`*, `keypoints`* | keypoints array of strings like {'x':100,'y':100,'type':'positive'}; <5s. | $0.14 per seconds |
| `fal-ai/void-video-inpainting` | fal / active | `prompt`*, `video_url`*, `quad_mask_video_url`, `seed`, `negative_prompt` | $0.05/video; quad_mask_video_url or mask_prompt (auto SAM-3 mask +$0.05); prompt = desired background. | Your request will cost $0.05 per video. With Pass2 enabled it will cost $0.1 per video. Sam3 quad mask generation will … |
| `fal-ai/ltx-2.3-quality/clean-plate` | fal / active | `prompt`, `video_url`*, `resolution`, `generate_audio`, `seed`, `negative_prompt` | Removes foreground subjects to produce a clean plate. | Your request will cost $0.0024075 per megapixel of generated video data (width × height × frames), rounded up. For … |
| `fal-ai/ltx-2.3-quality/inpaint` | fal / active | `prompt`*, `video_url`*, `mask_video_url`*, `generate_audio`, `seed`, `negative_prompt` | mask_video_url: WHITE regenerated, black preserved. | $0.0024075 per megapixels |
| `fal-ai/wan-vace-14b/inpainting` | fal / active | `prompt`*, `first_frame_url`, `last_frame_url`, `video_url`*, `mask_image_url`, `aspect_ratio`, `resolution`, `seed`, `negative_prompt` | mask_video_url or mask_image_url. | Your request will cost $0.08 per video second for 720p, $0.06 per video second for 580p, $0.04 per video second for … |
| `fal-ai/wan-vace-14b` | fal / active | `prompt`*, `first_frame_url`, `last_frame_url`, `video_url`, `mask_image_url`, `aspect_ratio`, `resolution`, `seed`, `negative_prompt`, `task` | task enum selects depth\|inpainting\|pose\|... | Your request will cost $0.08 per video second for 720p, $0.06 per video second for 580p, $0.04 per video second for … |

## 6. Image inpaint, erase and Draw to Edit

**Mask polarity varies by endpoint.** Normalise it in the adapter.

| Endpoint | Mask field | Area that changes |
|---|---|---|
| FLUX fill/erase, `fal-ai/object-removal/mask`, Finegrain, `fal-ai/ideogram/object-removal`, LTX video inpaint | `mask_url` (LTX: `mask_video_url`) | **white** |
| `ideogram/v4.5/edit` | `mask_url` | **black** (white is preserved) |
| `fal-ai/chrono-edit-lora-gallery/paintbrush` | `mask_url` | **black** (the sketched region) |
| `openai/gpt-image-2/edit` | `mask_url` | transparent pixels (OpenAI convention) |
| `fal-ai/z-image/turbo/inpaint` | `mask_image_url` | — |
| Nano Banana, FLUX.2, FLUX 3, Recraft | no mask field | — |

For a mask-free edit model, composite the brush strokes onto the image and describe the region in the prompt.

| Endpoint | Provider / status | Key fields (* = required) | Notes | Price |
|---|---|---|---|---|
| `fal-ai/flux-pro/v1/fill` | fal / active | `prompt`*, `image_url`*, `mask_url`*, `seed`, `num_images` | mask_url same dims as image; white = fill (BFL convention). $0.05/MP. | $0.05 per megapixels |
| `fal-ai/flux-pro/v1/erase` | fal / active | `image_url`*, `mask_url`* | No prompt. mask white(255)=erase; dilate_pixels 0-100 (default 10). | Your request will cost $0.03 for the first megapixel generated, then $0.004 for each subsequent megapixel. Each … |
| `fal-ai/flux-lora-fill` | fal / active | `prompt`, `image_url`*, `mask_url`*, `seed`, `num_images`, `loras` | Accepts loras[] (Soul ID inpaint); fill_image for in-context fill; paste_back. | $0.035 per megapixels |
| `fal-ai/flux-kontext-lora/inpaint` | fal / active | `prompt`*, `image_url`*, `mask_url`*, `seed`, `num_images`, `loras`, `reference_image_url`* | Requires reference_image_url + mask_url; loras[]. | $0.035 per megapixels |
| `fal-ai/flux-kontext/inpaint` | fal / active | `prompt`*, `image_url`*, `mask_url`*, `seed`, `num_images`, `loras`, `reference_image_url`* | Same as flux-kontext-lora/inpaint. | $0 per compute seconds |
| `fal-ai/flux-general/inpainting` | fal / active | `prompt`*, `image_url`*, `mask_url`*, `seed`, `num_images`, `negative_prompt`, `loras` | Kitchen-sink FLUX dev inpaint (loras, controlnets, ip_adapters). | $0.075 per megapixels |
| `fal-ai/qwen-image-edit/inpaint` | fal / active | `prompt`*, `image_url`*, `mask_url`*, `seed`, `num_images`, `negative_prompt` | mask_url; strength 0.93. | $0.03 per megapixels |
| `fal-ai/z-image/turbo/inpaint` | fal / active | `prompt`*, `image_url`*, `mask_image_url`*, `seed`, `num_images` | Field is mask_image_url (not mask_url). $0.01/MP - cheapest. | $0.01 per megapixels |
| `fal-ai/ideogram/v3/edit` | fal / active | `prompt`*, `image_url`*, `image_urls`, `mask_url`*, `seed`, `num_images` | mask_url REQUIRED, exact same dims as image_url. | Your request will cost $0.03 with TURBO, $0.06 with BALANCED, and $0.09 with QUALITY. |
| `ideogram/v4.5/edit` | fal / active | `prompt`*, `image_url`*, `reference_image_urls`, `mask_url`, `seed`, `num_images` | mask_url OPTIONAL and INVERTED: BLACK = edit, white = preserve. edit_precision regular\|high. | Your request will cost $0.008 per image with Very Low, $0.03 with Low, $0.06 with Medium, and $0.22 with High quality. … |
| `openai/gpt-image-2/edit` | fal / active | `prompt`*, `image_urls`*, `mask_url`, `num_images` | mask_url optional (OpenAI convention: transparent pixels = edit area); image_urls[]. | Text tokens (per 1M): $5.00 input, $1.25 cached, $10.00 output. Image tokens (per 1M): $8.00 input, $2.00 cached, … |
| `fal-ai/nano-banana-pro/edit` | fal / active | `prompt`*, `image_urls`*, `aspect_ratio`, `resolution`, `seed`, `num_images` | NO mask field. 'Draw to Edit' with Nano Banana = composite the brush strokes onto the image (or pass as 2nd image) and describe the region in the prompt. | Your request will cost $0.15 per image. For $1.00, you can run this model 7 times. 4K outputs will be charged at double … |
| `fal-ai/nano-banana-2/edit` | fal / active | `prompt`*, `image_urls`, `video_url`, `audio_url`, `aspect_ratio`, `resolution`, `seed`, `num_images` | NO mask field (same as Pro). | Your request will cost $0.08 per image. For $1.00, you can run this model 12 times. 2K and 4K outputs will be charged … |
| `blackforestlabs/flux-3/edit-image` | fal / active | `prompt`*, `image_urls`*, `aspect_ratio`, `resolution` | NO mask field; image_urls 1-10. | Image pricing varies by resolution. A 1K (1 MP) image costs $0.048. |
| `fal-ai/flux-2-pro/edit` | fal / active | `prompt`*, `image_urls`*, `seed` | NO mask field; there is no FLUX.2 fill endpoint on fal (flux-2*/fill all 404). | Your request will cost $0.03 for the first megapixel of output, plus $0.015 per extra megapixel of input and output, … |
| `fal-ai/flux-2/edit` | fal / active | `prompt`*, `image_urls`*, `seed`, `num_images` | NO mask field. | Requests cost $0.012 per megapixel of input and output. Input images will be resized to 1MP. For example, a 1024x1024 … |
| `fal-ai/flux-2-pro/outpaint` | fal / active | `image_url`* | expand_top/bottom/left/right px. | Your request will cost $0.03 for the first megapixel of output, plus $0.015 per extra megapixel of input and output, … |
| `fal-ai/recraft/v3/image-to-image` | fal / active | `prompt`*, `image_url`*, `negative_prompt` | NO mask; Recraft inpaint/erase is NOT on fal (all guesses 404). Recraft native API has /images/inpaint. | Your request will cost $0.04 per image (or $0.08 if you are using a vector style). For $1 you can run this model … |
| `fal-ai/bria/eraser` | fal / active | `image_url`*, `mask_url`* | mask_type manual (brush) \| automatic (SAM); preserve_alpha. Output image (singular). | $0.04 per generations |
| `fal-ai/bria/genfill` | fal / active | `prompt`*, `image_url`*, `mask_url`*, `seed`, `num_images`, `negative_prompt` | mask_url + prompt; output images[]. | $0.04 per generations |
| `bria/genfill/v2` | fal / active | `instruction`*, `image_url`*, `mask_url`*, `seed` | Prompt field is 'instruction'; steps_num. | $0.04 per megapixels |
| `bria/fibo-edit/erase_by_text` | fal / active | `object_name`*, `image_url`* | object_name only (no mask). | $0.04 per images |
| `fal-ai/object-removal` | fal / active | `prompt`*, `image_url`* | prompt names object; model low_quality..best_quality; mask_expansion. | Your request will cost $0.006 with Low Quality, $0.012 with Medium Quality, $0.018 with High Quality, and $0.024 with … |
| `fal-ai/object-removal/mask` | fal / active | `image_url`*, `mask_url`* | mask_url white=remove; $0.006-$0.024. | Your request will cost $0.006 with Low Quality, $0.012 with Medium Quality, $0.018 with High Quality, and $0.024 with … |
| `fal-ai/object-removal/bbox` | fal / active | `image_url`*, `box_prompts` | box_prompts normalised 0-1. | Your request will cost $0.006 with Low Quality, $0.012 with Medium Quality, $0.018 with High Quality, and $0.024 with … |
| `fal-ai/finegrain-eraser` | fal / active | `prompt`*, `image_url`*, `seed` | mode express\|standard\|premium; removes shadows/reflections too. | Your request will cost $0.18 with Express, $0.27 with Standard, and $0.36 with Premium. |
| `fal-ai/finegrain-eraser/mask` | fal / active | `image_url`*, `mask_url`*, `seed` | mask white=erase. | Your request will cost $0.04 with Express, $0.13 with Standard, and $0.22 with Premium. |
| `fal-ai/ideogram/object-removal` | fal / active | `image_url`*, `mask_url`* | mask white=remove; $0.03. | Your request will cost $0.03 per generation. |
| `fal-ai/image-editing/object-removal` | fal / active | `prompt`, `image_url`*, `aspect_ratio`, `seed` | prompt default 'background people'. | $0.04 per images |
| `fal-ai/chrono-edit-lora-gallery/paintbrush` | fal / active | `prompt`*, `image_url`*, `mask_url`, `resolution`, `seed`, `loras` | Closest to the parity studio 'Draw to Edit': user sketches on the image; optional mask_url (BLACK = sketched region). | Your request will cost $0.02 per image for 480p or $0.03 per image for 720p. |
| `black-forest-labs/flux-fill-pro` | replicate | `prompt`*, `image`*, `mask`, `seed`, `steps` | image + mask (white = fill) + outpaint preset. | $0.05 per output image |
| `bria/eraser` | replicate | `image_url`, `mask_url` | image/mask or image_url/mask_url; mask_type. | $0.04 per output image |
| `bria/genfill` | replicate | `prompt`*, `image`, `mask`, `seed`, `negative_prompt` | image + mask + prompt. | $0.04 per output image |

## 7. Audio: TTS, voice change, voice clone and dubbing

### 7.1 ElevenLabs `voice` field

On every fal ElevenLabs endpoint, `voice` is a **free string**, not an enum. Its default is `"Rachel"`. The dialogue schema describes it as *"the name or the ID of the voice"*. The schema's own example list is:

`Aria, Roger, Sarah, Laura, Charlie, George, Callum, River, Liam, Charlotte, Alice, Matilda, Will, Jessica, Eric, Chris, Brian, Daniel, Lily, Bill`

ElevenLabs' current public list has 21 premade voices. Fuobe can use this list for its voice picker, sending either the name or the `voice_id`:

| Name | voice_id | Gender | Accent | Age | Use case |
|---|---|---|---|---|---|
| Roger | `CwhRBWXzGAHq8TQ4Fs17` | male | american | middle_aged | conversational |
| Sarah | `EXAVITQu4vr4xnSDxMaL` | female | american | young | entertainment_tv |
| Laura | `FGY2WhTYpPnrIDTdsKH5` | female | american | young | social_media |
| Charlie | `IKne3meq5aSn9XLyUdCD` | male | australian | young | conversational |
| George | `JBFqnCBsd6RMkjVDRZzb` | male | british | middle_aged | narrative_story |
| Callum | `N2lVS1w4EtoT3dr4eOWO` | male | american | middle_aged | characters_animation |
| River | `SAz9YHcvj6GT2YYXdXww` | neutral | american | middle_aged | conversational |
| Harry | `SOYHLrjzK2X1ezoPC6cr` | male | american | young | characters_animation |
| Liam | `TX3LPaxmHKxFdv7VOQHJ` | male | american | young | social_media |
| Alice | `Xb7hH8MSUJpSbSDYk0k2` | female | british | middle_aged | informative_educational |
| Matilda | `XrExE9yKIg1WjnnlVkGX` | female | american | middle_aged | informative_educational |
| Will | `bIHbv24MWmeRgasZH58o` | male | american | young | conversational |
| Jessica | `cgSgspJ2msm6clMCkdW9` | female | american | young | conversational |
| Eric | `cjVigY5qzO86Huf0OWal` | male | american | middle_aged | conversational |
| Bella | `hpp4J3VqNfWAUOO0d1Us` | female | american | middle_aged | informative_educational |
| Chris | `iP95p4xoKVk53GoZ742B` | male | american | middle_aged | conversational |
| Brian | `nPczCjzI2devNBz1zQrb` | male | american | middle_aged | social_media |
| Daniel | `onwK4e9ZLuTAKqWW03F9` | male | british | middle_aged | informative_educational |
| Lily | `pFZP5JQG7iQjIQuC4Bku` | female | british | middle_aged | informative_educational |
| Adam | `pNInz6obpgDQGcFmaJgB` | male | american | middle_aged | social_media |
| Bill | `pqHfZKP75CvOlQylNhV4` | male | american | old | advertisement |

**Quirks:**
- Aria, Charlotte and Rachel are in fal's examples and default but are no longer in ElevenLabs' public list. Whether fal still accepts them is *unverified*.
- Harry, Bella and Adam are in the current list but not in fal's examples.
- Prefer the `voice_id`.

**Settings by model:**

| Model | stability | similarity_boost | style | speed | Other |
|---|---|---|---|---|---|
| eleven-v3 | 0–1 (0.5) | — | — | — | |
| multilingual-v2, turbo-v2.5 | 0–1 (0.5) | 0–1 (0.75) | 0–1 (0) | 0.7–1.2 (1) | `previous_text`, `next_text` |
| eleven-v4, v4-turbo | 0–1 (0.5) | 0–1 (0.75) | — | — | `seed`, `output_format` |
| text-to-dialogue/eleven-v3 | yes | — | — | — | `inputs:[{text, voice}]`, `use_speaker_boost` |

### 7.2 Voice change, clone, design and dub

**Voice Change on a video.** `fal-ai/elevenlabs/voice-changer` takes `audio_url` only. For a video:
1. Send the video to `fal-ai/elevenlabs/audio-isolation` as `video_url`.
2. Send the isolated audio to `fal-ai/elevenlabs/voice-changer` as `audio_url`.
3. Put the new audio back on the video with `fal-ai/ffmpeg-api/merge-audio-video`.

Isolation drops the music and ambience. To keep them, use `fal-ai/chatterbox/speech-to-speech`, which takes any `target_voice_audio_url`.

**MiniMax voice clone.** `fal-ai/minimax/voice-clone` takes `audio_url` (at least 10 s) and returns `custom_voice_id`. Pass it as `voice_setting.voice_id` to `fal-ai/minimax/speech-2.8-hd` **within 7 days**, or MiniMax deletes the voice. Also set `output_format: "url"`, because the default is `hex`.

**Qwen3-TTS clone** is a two-step flow that returns a file, not an id. `fal-ai/qwen-3-tts/clone-voice/1.7b` returns `speaker_embedding.url`, which goes into `speaker_voice_embedding_file_url`.

**Kling voices.** `fal-ai/kling-video/create-voice` takes a 5–30 s `voice_url` and returns a `voice_id` for Kling's `elements[].voice_id`.

**ElevenLabs Instant Voice Clone is not on fal or Replicate.**

| Endpoint | Provider / status | Key fields (* = required) | Notes | Price |
|---|---|---|---|---|
| `fal-ai/elevenlabs/tts/eleven-v3` | fal / active | `text`*, `voice`, `stability` | voice = name or voice_id (free string, default 'Rachel'); only stability (no similarity/speed/style). text <=5000. Audio tags like [whispers]. | $0.1 per 1000 characters |
| `fal-ai/elevenlabs/tts/multilingual-v2` | fal / active | `text`*, `voice`, `stability`, `similarity_boost`, `speed` | stability, similarity_boost, style, speed 0.7-1.2, previous_text/next_text. | $0.1 per 1000 characters |
| `fal-ai/elevenlabs/tts/turbo-v2.5` | fal / active | `text`*, `voice`, `stability`, `similarity_boost`, `speed` | Same knobs as multilingual-v2; half price. | $0.05 per 1000 characters |
| `elevenlabs/tts/eleven-v4` | fal / active | `text`*, `seed`, `voice`, `stability`, `similarity_boost` | stability + similarity_boost (no speed/style); seed; output_format codec_rate_bitrate. | $0.08 per 1000 characters |
| `elevenlabs/tts/eleven-v4-turbo` | fal / active | `text`*, `seed`, `voice`, `stability`, `similarity_boost` | Same as v4; $0.04/1k chars. | $0.04 per 1000 characters |
| `fal-ai/elevenlabs/text-to-dialogue/eleven-v3` | fal / active | `seed`, `stability`, `inputs`*, `inputs[].voice` | inputs[{text,voice}] (both required); stability; use_speaker_boost. | $0.1 per 1000 characters |
| `fal-ai/elevenlabs/voice-changer` | fal / active | `audio_url`*, `seed`, `voice` | audio_url (audio only) + voice (premade name/id); remove_background_noise. $0.3/min. For video: audio-isolation(video_url) -> voice-changer -> ffmpeg merge-audio-video. | $0.3 per minutes |
| `fal-ai/elevenlabs/dubbing` | fal / active | `video_url`, `audio_url`, `target_lang`*, `source_lang` | video_url or audio_url + target_lang (ISO 639-1, free string); returns video + audio. No lip-sync. $0.6/min rounded up. | Your request will cost $0.6 per minute. The calculation will be based on the closest minute after rounding upwards. |
| `fal-ai/minimax/voice-clone` | fal / active | `text`, `audio_url`* | audio_url >=10s -> custom_voice_id (+preview audio). Use as voice_setting.voice_id in fal-ai/minimax/speech-2.8-hd within 7 days or it is deleted. $1.50/clone. | Each voice clone request will cost $1.5, with preview inputs costing $0.3 per 1000 characters. |
| `fal-ai/minimax/voice-design` | fal / active | `prompt`*, `preview_text`* | prompt (voice description) + preview_text -> custom_voice_id. $3/voice. | Designing a voice will cost $3 per created voice, with 0.03 per 1000 preview characters |
| `fal-ai/minimax/speech-2.8-hd` | fal / active | `prompt`*, `voice_setting.voice_id`, `voice_setting.speed` | voice_setting{voice_id,speed 0.5-2,vol,pitch -12..12,emotion}; voice_id accepts preset ids or custom_voice_id from voice-clone/voice-design. output_format default 'hex' -> set 'url'. | $0.1 per 1000 characters |
| `fal-ai/chatterbox/text-to-speech` | fal / active | `text`*, `audio_url`, `seed` | Zero-shot clone: audio_url reference (defaults to a demo voice!). exaggeration, temperature, cfg. $0.025/1k chars. | Your request will cost $0.025 per 1000 characters. |
| `fal-ai/chatterbox/text-to-speech/multilingual` | fal / active | `text`*, `seed`, `voice` | text <=300 chars; 'voice' = language code or a custom audio URL + custom_audio_language. | $0.025 per 1000 characters |
| `fal-ai/chatterbox/speech-to-speech` | fal / active | `source_audio_url`*, `target_voice_audio_url` | source_audio_url + target_voice_audio_url: zero-shot voice conversion to ANY voice. $0.015/min. | $0.015 per minutes |
| `resemble-ai/chatterboxhd/text-to-speech` | fal / active | `text`, `audio_url`, `seed`, `voice` | voice enum Aurora\|Blade\|Britney\|Carl\|Cliff\|Richard\|Rico\|Siobhan\|Vicky or audio_url clone; output audio is typed 'any'. | Your request will cost $0.04 per 1000 characters. |
| `resemble-ai/chatterboxhd/speech-to-speech` | fal / active | `source_audio_url`*, `target_voice`, `target_voice_audio_url` | target_voice enum or target_voice_audio_url. | $0.02 per minutes |
| `fal-ai/index-tts-2/text-to-speech` | fal / active | `audio_url`*, `prompt`* | Field names: audio_url (speaker ref, required) + prompt (the text). Emotion via emotional_audio_url / emotional_strengths{...} / emotion_prompt. | Your request will cost 0.002 per generated audio seconds. |
| `fal-ai/vibevoice` | fal / active | `script`*, `seed`, `speakers`*, `speakers[].audio_url` | script 'Speaker 0: ...' + speakers[{preset\|audio_url}] (zero-shot clone per speaker); up to ~90k chars. | Your request will cost $0.04 per generated minute, rounded to the nearest 15 seconds. For $1.00 you can generate up to … |
| `fal-ai/vibevoice/7b` | fal / active | `script`*, `seed`, `speakers`*, `speakers[].audio_url` | Same as 1.5B; script <=30k chars. | Your request will cost $0.04 per generated minute, rounded to the nearest 15 seconds. For $1.00 you can generate up to … |
| `fal-ai/dia-tts/voice-clone` | fal / active | `text`* | BROKEN SCHEMA: fal exposes only 'text' (no reference audio field) - cannot actually clone via fal today. Use Replicate zsxkib/dia (audio_prompt) instead. | $0.04 per 1000 characters |
| `fal-ai/qwen-3-tts/clone-voice/1.7b` | fal / active | `audio_url`* | Step 1: audio_url (<=5 min) -> speaker_embedding (safetensors file). Step 2: qwen-3-tts/text-to-speech/1.7b with speaker_voice_embedding_file_url. Very cheap. | $0.0008 per minutes |
| `fal-ai/qwen-3-tts/text-to-speech/1.7b` | fal / active | `prompt`, `voice`, `speaker_voice_embedding_file_url`, `text`* | voice enum Vivian\|Serena\|Uncle_Fu\|Dylan\|Eric\|Ryan\|Aiden\|Ono_Anna\|Sohee, or speaker_voice_embedding_file_url. | $0.09 per 1000 characters |
| `fal-ai/qwen-3-tts/voice-design/1.7b` | fal / active | `prompt`*, `text`* | prompt describes the voice; returns audio only (no reusable id) - clone the result to reuse. | $0.09 per 1000 characters |
| `fal-ai/zonos2` | fal / active | `text`, `reference_audio_url`*, `seed` | reference_audio_url + text; accurate_mode; $0.01/min. | $0.01 per minutes |
| `fal-ai/f5-tts` | fal / active | `gen_text`*, `ref_audio_url`*, `model_type`* | gen_text + ref_audio_url (+ref_text); model_type F5-TTS\|E2-TTS required; output key is audio_url{url}. | $0.05 per 1000 characters |
| `fal-ai/kling-video/create-voice` | fal / active | `voice_url`* | voice_url 5-30s (audio or video) -> voice_id for Kling elements[].voice_id / voice_ids. | $0.007 per generations |
| `fal-ai/heygen/v2/translate/precision` | fal / active | `video_url`*, `output_language`*, `translate_audio_only` | Lip-synced translation; output_language is a display-name enum (e.g. 'Spanish', 'Japanese (Japan)'); <=8 min; $0.1/s. | Your request will cost $0.1 per output video second. |
| `fal-ai/heygen/v2/translate/speed` | fal / active | `video_url`*, `output_language`*, `translate_audio_only` | $0.05/s; same schema. | Your request will cost $0.05 per output video second. |
| `minimax/voice-cloning` | replicate | `voice_file`* | voice_file -> output {voice_id, preview, model}; use voice_id with minimax/speech-02-hd / speech-2.8-hd. | $3 per output |
| `resemble-ai/chatterbox` | replicate | `prompt`*, `audio_prompt`, `seed` | prompt (text) + audio_prompt (reference) zero-shot clone; cfg_weight. | $0.025 per thousand input characters |
| `resemble-ai/chatterbox-pro` | replicate | `prompt`*, `custom_voice`, `seed`, `voice` | voice preset or custom_voice (reference audio). | $0.04 per thousand input characters |
| `resemble-ai/chatterbox-multilingual` | replicate | `text`*, `reference_audio`, `seed` | language + reference_audio. | — |
| `zsxkib/dia` | replicate | `text`*, `audio_prompt`, `seed` | Working Dia clone: audio_prompt + audio_prompt_text; text with [S1]/[S2] tags. | — |
| `lucataco/xtts-v2` | replicate | `text`, `speaker`* | speaker (reference audio) + language; community model (needs version hash). | — |
| `elevenlabs/dubbing` | replicate | `audio_or_video_file`, `target_language`*, `source_language` | target_language BCP-47 enum incl. dialects; audio_or_video_file or source_url (YouTube/TikTok OK); cloning_strength. | $0.0366667 per second of output audio |
| `heygen/video-translate` | replicate | `video`*, `output_language` | video + output_language + mode speed\|precision; cheaper than fal ($0.0333/$0.0667 per s). | $0.0333 per second of output video (Speed [{"description": "speed", "subtype": "string", "title": "model variant", … |
| `minimax/speech-2.8-hd` | replicate | `text`*, `voice_id`, `speed` | Flat fields: voice_id, speed, volume, pitch, emotion (no voice_setting wrapper). | $0.10 per thousand input tokens |
| `sync/lipsync-2-pro` | replicate | `video`*, `audio`* | Use after a non-lip-synced dub (ElevenLabs dubbing) to re-sync lips: video + audio. | $0.08325 per second of output video |

## 8. Soul ID: LoRA training and inference

**Flow:**
1. Zip the photos, with an optional `ROOT.txt` caption beside each image.
2. Upload the zip to the fal CDN.
3. Call the trainer. It returns `diffusers_lora_file.url` (some trainers say `lora_file.url`).
4. Pass that URL as `loras: [{path: <url>, scale: 1}]` to the matching inference endpoint. Most take at most 3 LoRAs, each with `scale` from 0 to 4.

| Base | Trainer (data field / trigger field) | Price | Output key | Inference endpoint |
|---|---|---|---|---|
| Z-Image Turbo | `fal-ai/z-image-turbo-trainer-v2` (`image_data_url` / `default_caption`, no trigger field) | $0.85 per 1,000 steps, 500-step floor | `diffusers_lora_file` | `fal-ai/z-image/turbo/lora` |
| Z-Image base | `fal-ai/z-image-trainer` (`image_data_url` / `default_caption`; `training_type`) | $2.26 per 1,000 steps | `diffusers_lora_file` | `fal-ai/z-image/base/lora` |
| FLUX.1 dev | `fal-ai/flux-lora-fast-training` (**`images_data_url`** / `trigger_word`; `create_masks`, `is_style`) | $2 per run | `diffusers_lora_file` | `fal-ai/flux-lora`, `fal-ai/flux-lora-fill` |
| FLUX.1 portrait | `fal-ai/flux-lora-portrait-trainer` (`images_data_url` / `trigger_phrase`) | $0.0024/step, 1,000-step minimum | `diffusers_lora_file` | `fal-ai/flux-lora` |
| FLUX.2 dev | `fal-ai/flux-2-trainer(-v2)` (`image_data_url` / `default_caption`) | $0.0064/step | `diffusers_lora_file` | `fal-ai/flux-2/lora`, `fal-ai/flux-2/lora/edit` |
| FLUX.2 Klein 9B | `fal-ai/flux-2-klein-9b-base-trainer` | $0.0043/step | `diffusers_lora_file` | `fal-ai/flux-2/klein/9b/base/lora` |
| Qwen-Image 2512 | `fal-ai/qwen-image-2512-trainer` (`image_data_url` / `default_caption`) | $0.0015/step, 500-step minimum | `diffusers_lora_file` | `fal-ai/qwen-image-2512/lora` |
| Wan 2.2 image | `fal-ai/wan-22-image-trainer` (**`training_data_url`** / **`trigger_phrase` required**) | $0.0045/step | `diffusers_lora_file` + `high_noise_lora` | `fal-ai/wan/v2.2-a14b/text-to-image/lora`, loading both files with `transformer: "low"` and `"high"` |
| Wan 2.2 video | `fal-ai/wan-22-trainer/{t2v,i2v}-a14b` (`training_data_url` / `trigger_phrase`; **`number_of_steps`**) | $0.004 or $0.005 per step | `lora_file` | `fal-ai/wan/v2.2-a14b/{text,image}-to-video/lora` |
| Ideogram V4 | `ideogram/v4/trainer` (`images_data_url`) | $0.00675/step | `diffusers_lora_file` | `ideogram/v4/lora` |
| Krea 2 | `fal-ai/krea-2-trainer` (`images_data_url` / `trigger_phrase`; `auto_captioning`) | $0.003/step | `lora_file` | `fal-ai/krea-2/turbo/lora` |
| MiniMax H3 (video) | `minimax/h3/i2v/trainer` (`training_data_url` of clips) | $0.01/step | `lora_file` | `minimax/h3/image-to-video/lora` |

| Endpoint | Provider / status | Key fields (* = required) | Notes | Price |
|---|---|---|---|---|
| `fal-ai/z-image-trainer` | fal / active | `image_data_url`*, `default_caption`, `steps` | image_data_url zip (ROOT.txt captions); NO trigger field -> put trigger in captions or default_caption; training_type content\|style\|balanced; $2.26/1000 steps. | Your request will cost $2.26 per 1000-step training run. It scales per step, so a 2000-step training run costs $4.52. … |
| `fal-ai/z-image-turbo-trainer-v2` | fal / active | `image_data_url`*, `default_caption`, `steps` | Cheapest image LoRA trainer: $0.85/1000 steps (500-step billing floor); steps default 2000; lr 5e-4; no trigger field (use default_caption). | Your request will cost $0.85 per 1000-step training run. It scales per step, so a 2000-step training run will cost … |
| `fal-ai/flux-lora-fast-training` | fal / active | `images_data_url`*, `trigger_word`, `steps` | images_data_url (note plural 'images_'); trigger_word; create_masks (face masks); is_style. $2/run. | Your request will cost $2 per training run (scales linearly with steps). For $2 you can run this model with … |
| `fal-ai/flux-lora-portrait-trainer` | fal / active | `images_data_url`*, `trigger_phrase`, `steps` | images_data_url; trigger_phrase; subject_crop; 2500 steps default; $0.0024/step, min 1000 billed. | Your request will cost $0.0024 cents per step. A minimum of 1000 steps will be billed. |
| `fal-ai/flux-2-trainer` | fal / active | `image_data_url`*, `default_caption`, `steps` | image_data_url; default_caption (no trigger); output_lora_format fal\|comfy; $0.0064/step. | The cost of training depends on the number of steps. The formula is: 0.0064 * steps. With 1000 steps, your request will … |
| `fal-ai/flux-2-trainer-v2` | fal / active | `image_data_url`*, `default_caption`, `steps` | steps up to 20000; same price. | The cost of training depends on the number of steps. The formula is: 0.0064 * steps. With 1000 steps, your request will … |
| `fal-ai/flux-2-klein-9b-base-trainer` | fal / active | `image_data_url`*, `default_caption`, `steps` | $0.0043/step; inference via fal-ai/flux-2/klein/9b/base/lora. | The cost of training depends on the number of steps. The formula is: 0.0043 * steps. With 1000 steps, your request will … |
| `fal-ai/qwen-image-trainer` | fal / deprecated | `image_data_url`*, `trigger_phrase`, `steps` | DEPRECATED in catalog; output key lora_file (not diffusers_lora_file). | Your request will cost $0.002 per step (minimum of 250 steps is charged). For $2 you can fine-tune a LoRA for 1000 … |
| `fal-ai/qwen-image-2512-trainer` | fal / active | `image_data_url`*, `default_caption`, `steps` | image_data_url; default_caption; $0.0015/step (min 500). | Your request will cost $0.0015 per step (minimum of 500 steps is charged). For $1.5 you can fine-tune a LoRA for 1000 … |
| `fal-ai/qwen-image-edit-2509-trainer` | fal / active | `image_data_url`*, `default_caption`, `steps` | Edit-pair LoRA trainer; $4/1000 steps. | Your request will cost $4.0 per 1000-step training run. It scales per step, so a 2000-step training run costs $8. Note: … |
| `fal-ai/wan-22-image-trainer` | fal / active | `training_data_url`*, `trigger_phrase`*, `steps` | Field is training_data_url; trigger_phrase REQUIRED; face detection/cropping/masks; outputs diffusers_lora_file (low-noise) + high_noise_lora -> load both with transformer 'low'/'high'. | Your request will cost $0.0045 per step (minimum of 100 steps is charged). For $4.5 you can fine-tune a LoRA for 1000 … |
| `fal-ai/wan-22-trainer/t2v-a14b` | fal / active | `training_data_url`*, `trigger_phrase`, `number_of_steps` | training_data_url (images and/or videos); number_of_steps (not steps); output lora_file. | Your request will cost $0.004 per step (minimum of 100 steps is charged). For $4 you can fine-tune a LoRA for 1000 … |
| `fal-ai/wan-22-trainer/i2v-a14b` | fal / active | `training_data_url`*, `trigger_phrase`, `number_of_steps` | Same fields as t2v trainer; $0.005/step. | Your request will cost $0.005 per step (minimum of 100 steps is charged). For $5 you can fine-tune a LoRA for 1000 … |
| `ideogram/v4/trainer` | fal / active | `resolution`, `images_data_url`*, `default_caption`, `steps` | images_data_url; $0.00675/step. | The cost of training depends on the number of steps. The formula is: 0.00675 * steps. With 1000 steps, your request … |
| `fal-ai/krea-2-trainer` | fal / active | `resolution`, `images_data_url`*, `trigger_phrase`, `steps` | images_data_url; trigger_phrase; auto_captioning Off\|Object/Character\|Style\|Custom; output lora_file. | Your request will cost $0.003 per step (minimum of 100 steps is charged). For $3.00 you can fine-tune a LoRA for 1000 … |
| `minimax/h3/i2v/trainer` | fal / active | `aspect_ratio`, `resolution`, `training_data_url`*, `trigger_phrase`, `number_of_steps` | Video LoRA (motion/character); training_data_url of clips; number_of_frames %17==5; $0.01/step. | The cost of training depends on the number of steps. The formula is: 0.01 * steps. With 1000 steps, your request will … |
| `fal-ai/z-image/turbo/lora` | fal / active | `prompt`*, `seed`, `num_images`, `loras` | loras[{path,scale 0-4}] max 3; $0.0085/MP. | $0.0085 per megapixels |
| `fal-ai/z-image/base/lora` | fal / active | `prompt`*, `seed`, `num_images`, `negative_prompt`, `loras` | loras max 3; negative_prompt. | $0.012 per megapixels |
| `fal-ai/flux-lora` | fal / active | `prompt`*, `seed`, `num_images`, `loras` | loras unlimited (merged). | $0.035 per megapixels |
| `fal-ai/flux-2/lora` | fal / active | `prompt`*, `seed`, `num_images`, `loras` | loras max 3 (URL, HF repo id); >2GB loras cost more. | Your request will cost $0.021 per megapixel. LoRAs over 2GB in size will accrue an extra 50% charge per GB (2-3GB total … |
| `fal-ai/flux-2/lora/edit` | fal / active | `prompt`*, `image_urls`*, `seed`, `num_images`, `loras` | Soul-ID-style edit with a character LoRA. | Requests cost $0.021 per megapixel of input and output. Input images will be resized to 1MP. For example, a 1024x1024 … |
| `fal-ai/flux-2/klein/9b/base/lora` | fal / active | `prompt`*, `seed`, `num_images`, `negative_prompt`, `loras` | loras max 3. | $0.02 per megapixels |
| `fal-ai/qwen-image-2512/lora` | fal / active | `prompt`*, `seed`, `num_images`, `negative_prompt`, `loras` | loras max 3. | $0.035 per megapixels |
| `fal-ai/wan/v2.2-a14b/text-to-image/lora` | fal / active | `prompt`*, `seed`, `negative_prompt`, `loras` | loras[{path,scale,transformer high\|low\|both,weight_name}]. | $0.05 per images |
| `fal-ai/wan/v2.2-a14b/text-to-video/lora` | fal / active | `prompt`*, `aspect_ratio`, `resolution`, `seed`, `negative_prompt`, `loras` | loras with transformer high\|low\|both. | $0.1 per seconds |
| `fal-ai/wan/v2.2-a14b/image-to-video/lora` | fal / active | `prompt`*, `image_url`*, `end_image_url`, `aspect_ratio`, `resolution`, `seed`, `negative_prompt`, `loras` | loras with transformer; end_image_url. | $0.1 per seconds |
| `ideogram/v4/lora` | fal / active | `prompt`*, `seed`, `num_images`, `loras` | loras maxItems 3. | Your request will cost $0.01125 per megapixel in TURBO mode, $0.0225 per megapixel in BALANCED mode, or $0.0375 per … |
| `minimax/h3/image-to-video/lora` | fal / active | `prompt`*, `image_url`, `end_image_url`, `resolution`, `duration`, `seed`, `loras`* | loras REQUIRED (1-3) with weight_name. | Video costs $0.0625 per second at 480p, $0.075 per second at 768p, $0.1625 per second at 2K and $0.20 per second at 4K. |
| `fal-ai/krea-2/turbo/lora` | fal / active | `prompt`*, `seed`, `num_images`, `loras` | loras max 3. | $0.01 per megapixels |
| `replicate/fast-flux-trainer` | replicate | `seed`, `input_images`, `trigger_word`, `training_steps` | input_images zip + trigger_word + lora_type subject\|style + training_steps. Training API: POST /v1/models/replicate/fast-flux-trainer/versions/{id}/trainings with destination. | — |
| `ostris/flux-dev-lora-trainer` | replicate | `resolution`, `input_images`, `trigger_word`, `steps` | input_images + trigger_word + steps + lora_rank; trainings API. | — |

## 9. Draw to video, trajectory and motion

The parity studio's *Draw to Video* lets the user draw arrows and notes on the frame and then sends that image to a normal i2v model; the inventory lists Hailuo, Seedance, Veo and 'Banana' draw variants. On fal, this means compositing the drawing on the client and calling an i2v endpoint, with an instruction to follow the annotations and then remove them.

True trajectory control exists only in `fal-ai/wan-ati` (`track`) and `fal-ai/wan-move` (`trajectories`). Both take `[[{x, y}, ...], ...]` in pixel coordinates, and both are **deprecated** in fal's catalog although their schemas are still served. `minimax/h3-max/camera-controls` controls the camera path only.

| Endpoint | Provider / status | Key fields (* = required) | Notes | Price |
|---|---|---|---|---|
| `fal-ai/wan-vace-14b/pose` | fal / active | `prompt`*, `first_frame_url`, `last_frame_url`, `video_url`*, `aspect_ratio`, `resolution`, `seed`, `negative_prompt` | Pose-video conditioned generation. | Your request will cost $0.08 per video second for 720p, $0.06 per video second for 580p, $0.04 per video second for … |
| `fal-ai/wan-ati` | fal / deprecated | `prompt`*, `image_url`*, `resolution`, `seed`, `track`* | DEPRECATED in catalog (schema still served). track = [[{x,y},...],...] pixel coords, <=121 points per track (auto-padded). $0.15/video. | $0.15 per videos |
| `fal-ai/wan-move` | fal / deprecated | `prompt`*, `image_url`*, `seed`, `negative_prompt`, `trajectories`* | DEPRECATED in catalog. trajectories = [[{x,y},...],...] one list per object; 480p; $0.2/video. | $0.2 per videos |
| `minimax/h3-max/camera-controls` | fal / active | `prompt`, `image_url`*, `resolution`, `duration`, `seed`, `camera_trajectory`, `prompt_expansion_mode`* | Camera path only: camera_trajectory[{time 0-1,azimuth,elevation -90..90,distance}] 2-12 keyframes; prompt_expansion_mode is REQUIRED (disabled\|balanced\|quality). | Video costs $0.0325 per second at 480p, $0.052 per second at 768p, and $0.104 per second at 1080p. Note: these are … |
| `fal-ai/wan-motion` | fal / active | `prompt`, `image_url`*, `video_url`*, `seed` | Driving video_url + character image_url. | Your request will cost $0.06 per video second for 720p. Video seconds are calculated at 24 frames per second. When … |
| `fal-ai/kling-video/v3/pro/motion-control` | fal / active | `prompt`, `image_url`*, `video_url`*, `elements`, `character_orientation`* | character_orientation image\|video REQUIRED; elements (1) for face binding. | $0.168 per seconds |
| `fal-ai/kling-video/v2.6/pro/motion-control` | fal / active | `prompt`, `image_url`*, `video_url`*, `character_orientation`* | Older motion transfer. | $0.112 per seconds |

## 10. Storyboard and consistent multi-image

| Endpoint | Provider / status | Key fields (* = required) | Notes | Price |
|---|---|---|---|---|
| `blackforestlabs/flux-3/keyframes-to-video` | fal / active | `prompt`*, `aspect_ratio`, `resolution`, `duration`, `generate_audio`, `keyframes`* | keyframes[{image_url,frame_index}] 1-10, unique frame_index; explicit duration required. Best fit for a storyboard -> video feature. | Your request will be charged at 0.17 $ per second of generated video at 720p, and 0.29 $ per second at 1080p. |
| `fal-ai/ltx-2.3-quality/ingredient` | fal / active | `prompt`*, `image_url`*, `resolution`, `generate_audio`, `seed`, `negative_prompt` | image_url = a reference/character sheet or storyboard image; prompt 'Reference sheet: ... Generated video: ...'. | Your request will cost $0.0024075 per megapixel of generated video data (width × height × frames), rounded up. For … |
| `fal-ai/kling-image/o3/text-to-image` | fal / active | `prompt`*, `aspect_ratio`, `resolution`, `num_images`, `elements`, `result_type`, `series_amount` | result_type 'series' + series_amount 2-9 = consistent multi-image set; elements for face control. | Your request will cost $0.028 per image for 1K/2K, price will be double for 4K |
| `fal-ai/kling-image/o3/image-to-image` | fal / active | `prompt`*, `image_urls`*, `aspect_ratio`, `resolution`, `num_images`, `elements`, `result_type`, `series_amount` | Series from reference images (@Image1). | Your request will cost $0.028 per image for 1K/2K, price will be double for 4K |
| `fal-ai/bytedance/seedream/v4.5/text-to-image` | fal / active | `prompt`*, `seed`, `num_images`, `max_images` | max_images 1-6 = multi-image sequential set per generation. | $0.04 per images |
| `fal-ai/flux-pro/kontext/max/multi` | fal / active | `prompt`*, `image_urls`*, `aspect_ratio`, `seed`, `num_images` | Multi-reference image composition. | $0.08 per images |
| `fal-ai/ideogram/character` | fal / active | `prompt`*, `image_urls`, `seed`, `num_images`, `negative_prompt`, `reference_image_urls`* | reference_image_urls (+reference_mask_urls) consistent character. | Your request will cost $0.1 with TURBO, $0.15 with BALANCED, and $0.20 with QUALITY. |
| `fal-ai/minimax/image-01/subject-reference` | fal / active | `prompt`*, `image_url`*, `aspect_ratio`, `num_images` | Single subject image_url; $0.01/image. | $0.01 per images |

## 11. Quirks to encode in the adapter

- Kling i2v image field: v3 uses `start_image_url`, O3 uses `image_url`, and Replicate uses `start_image`.
- Kling `multi_prompt[].duration` is a string enum. The top-level `duration` is a string enum as well.
- MiniMax H3 extend and relight use upper-case resolutions (`480P`, `768P`, `1080P`, `2K`), and `duration` is a float. Insert-video uses lower-case `480p` and `768p`.
- MiniMax H3 extend returns source plus continuation with `output: "extended"`, the default. With `output: "continuation"` the clip starts with a 1.625 s repeat of the source.
- Veo 3.1 extend: `duration` is a string such as `"7s"`, and the source must be 720p or 1080p at 16:9 or 9:16. fal shows *deprecated on 2026-11-17*.
- LTX-2.3 extend uses `mode: start|end`. LTX-2.3 Quality and 22B use `extend_direction: forward|backward`.
- Luma Ray 3.2 reframe accepts sources of 10 s or less and requires `aspect_ratio`. Ray 2 reframe is unlisted and the Ray 2 family is deprecated on 2026-10-25.
- Seedance 2.5 `task: "extension"` forces `aspect_ratio` to auto, and `editing` forces both aspect ratio and duration to auto. Video references must be 1.8–30.2 s each, with a combined total of 30.2 s or less.
- Mask polarity differs by endpoint; see section 6. `fal-ai/z-image/turbo/inpaint` names its field `mask_image_url`.
- `veed/video-background-removal*` returns `video` as an **array**: one VP9 file with alpha, or separate RGB and alpha H.264 files.
- Alpha output: BiRefNet needs `video_output_type` VP9 or ProRes 4444, Bria needs `background_color: "Transparent"` with webm_vp9 or mov_proresks, and BEN v2 is transparent unless `background_color` is set.
- Bria video erase only works on clips under 5 s, and `auto_trim` trims to 5 s.
- `fal-ai/minimax/speech-2.8-hd` defaults to `output_format: "hex"`, so set it to `"url"`.
- Chatterbox `audio_url` defaults to a demo voice. Always set it.
- `fal-ai/dia-tts/voice-clone` exposes only `text`, so it cannot clone. Use Replicate `zsxkib/dia` (`audio_prompt`).
- `fal-ai/f5-tts` returns `audio_url.url`, not `audio.url`, and `model_type` is required.
- Trainer field names vary: `image_data_url`, `images_data_url` or `training_data_url`; `steps` or `number_of_steps`; `trigger_word`, `trigger_phrase` or `default_caption`. Output is `diffusers_lora_file` or `lora_file`.
- `minimax/h3/image-to-video/lora` requires `loras` (1–3).
- HeyGen translate `output_language` is a display-name enum such as `"Spanish"` or `"Japanese (Japan)"`. ElevenLabs dubbing `target_lang` is a free ISO 639-1 string on fal and a BCP-47 enum on Replicate.
- `minimax/h3-max/camera-controls` requires `prompt_expansion_mode`, which takes `disabled`, `balanced` or `quality`.

## 12. Gaps and blockers

- No dedicated Seedance extend endpoint (bytedance/seedance-2.5/extend*, /video-extend, seedance-2.0/extend-video all 404). Extend = bytedance/seedance-2.5/reference-to-video with task:'extension' and video_urls:[source]. Seedance 2.0 r2v has no task field.
- No Kling extend on fal (all fal-ai/kling-video/*extend* guesses 404). Kling extend exists only in Kling's native API. Fallback: extract last frame + i2v + merge.
- No Luma Ray 3.2 extend and no Wan 2.7 / Gemini Omni extend endpoint on fal.
- No FLUX.2 fill/inpaint endpoint (fal-ai/flux-2*/fill 404). Use FLUX.1 fill (fal-ai/flux-pro/v1/fill) or FLUX.2 edit without mask.
- Nano Banana / Gemini edit endpoints have no mask field; Recraft inpaint/erase is not on fal (Recraft native API only).
- ElevenLabs Instant Voice Cloning is not on fal or Replicate; fal ElevenLabs endpoints accept premade voice names/ids only (a voice_id from your own ElevenLabs account cannot be used because fal uses its own key - unverified, no test call made).
- No Sync Labs or Kling video-translate endpoint on fal. Lip-synced translation = HeyGen translate; or ElevenLabs dubbing + a lipsync model.
- fal-ai/dia-tts/voice-clone schema exposes only 'text' (no reference audio) - not usable for cloning; use Replicate zsxkib/dia.
- Trajectory draw-to-video endpoints on fal (fal-ai/wan-ati, fal-ai/wan-move) are marked deprecated in the catalog; no Kling motion-brush endpoint was found on fal or Replicate (probed fal-ai/kling-video/v1*/motion-brush and Replicate bytedance/ati, zsxkib/ati: all 404).
- No video color-grade endpoint; only image color correction (fal-ai/post-processing/color-correction) and LTX IC-LoRA effects (colorization, day-to-night, hdr).
- No test calls were made because no FAL_KEY was used, so runtime-only behaviour is *unverified*. That covers voice-name resolution and whether deprecated endpoints still run.

## 13. Sources

- fal OpenAPI: `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` (the `schemaUrl` of each record)
- fal pricing and docs: `https://fal.ai/models/<id>/llms.txt`
- fal catalog: `https://api.fal.ai/v1/models` and `?endpoint_id=`
- Replicate model pages: `https://replicate.com/<owner>/<name>`
- ElevenLabs premade voices: `https://api.elevenlabs.io/v1/voices`
- The parity studio's feature definitions: [`parity-inventory.md`](./parity-inventory.md)
