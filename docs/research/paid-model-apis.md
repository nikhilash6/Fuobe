# Paid / closed generative-model APIs for Fuobe

As of **2026-10-16**. This report covers the third-party models that parity-studio offers, as they can be called through **fal.ai** (primary), **Replicate** (secondary) and vendor-native APIs where neither aggregator has them.

The machine-readable companion is [`paid-model-apis.json`](./paid-model-apis.json). It holds 517 endpoint records: 398 fal, 106 Replicate and 13 vendor. Each record has the full input schema (exact field names, types, enums, defaults, ranges), the output path, a `keyFields` map from Fuobe's canonical slots to that endpoint's field names, the price text, the status, and the Replicate equivalent.

## How this was verified

- **fal schemas** come from fal's own per-endpoint OpenAPI documents, `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`. These are the schemas that the `/api` tab of each model page renders. Each was parsed programmatically, so field names, enums and defaults were not retyped by hand.
- **fal prices** come from the `## Pricing` section of `https://fal.ai/models/<id>/llms.txt`.
- **fal status** comes from fal's public catalog, `https://api.fal.ai/v1/models`, which returned 1,516 active endpoints on 2026-10-16. Deprecation dates come from the endpoint warning banners on fal.ai model pages.
- **Replicate schemas and prices** come from the OpenAPI schema and `billingConfig` embedded in each `https://replicate.com/<owner>/<name>` page.
- **The parity studio, Hedra and Runway** schemas come from their official docs. **Reve** and **DoP** could not be verified, so they are `verified:false`.
- In the JSON, `verified:true` means the schema was read from an official page or schema file today. `verified:false` covers 18 records: models that were removed or retired, and vendor APIs whose docs could not be fetched.

---

## 1. Headline findings (what changed vs. 2025-era knowledge)

| Topic | Finding (2026-10-16) |
|---|---|
| **Sora 2 / Sora 2 Pro** | **Dead.** fal marked `fal-ai/sora-2/*` deprecated on 2026-07-08 and no longer serves the schemas (404). Secondary sources say OpenAI deprecated the Videos API and `sora-2`/`sora-2-pro` on 2026-03-24 and shut them down on **2026-09-24**. Replicate still renders `openai/sora-2` pages, but the model should be treated as unavailable. Do not build a Sora integration. |
| **Veo** | `fal-ai/veo3`, `veo3/fast` and their image-to-video variants are **deprecated**. `fal-ai/veo3.1/*` still works (t2v, i2v, first-last-frame, reference-to-video, extend, fast, lite), but fal hides it from the catalog and shows *"This endpoint will be deprecated on November 17, 2026"*. Google's newer video model on fal is **`google/gemini-omni-flash` (+ `/v1.1`)**. Replicate `google/veo-3.1`, `veo-3.1-fast` and `veo-3.1-lite` are active and are the fallback for Veo after Nov 17. |
| **Imagen 4** | `fal-ai/imagen4/preview*` is deprecated on fal and its schema returns 404. Use Replicate `google/imagen-4`, `imagen-4-fast` or `imagen-4-ultra`. |
| **Reve** | Removed from fal (404) and not on Replicate. Only the native `api.reve.com` API remains (unverified). |
| **Nano Banana** | Nano Banana (`fal-ai/nano-banana`) and Nano Banana Pro (`fal-ai/nano-banana-pro`) are still active. **Newer:** `fal-ai/nano-banana-2` (Gemini 3.1 Flash Image), `google/nano-banana-2.1` (2026-10-06), and `google/nano-banana-2-lite` / `google/nano-banana-lite`. |
| **GPT Image** | GPT Image 1, 1-mini and 1.5 remain. **Newer:** `openai/gpt-image-2(/edit)` and `openai/gpt-image-2.5/{flare,sunburst}/{text-to-image,edit}`. Flare is the default fast model; sunburst is the slower precision model. |
| **Seedream** | v4 and v4.5 remain. **Newer:** `bytedance/seedream/v5/{pro,lite,flash}/{text-to-image,edit}` (+ `layerize`). |
| **Seedance** | 1.0 Lite is **deprecated**: requests are re-routed to 1.0 Pro Fast, or to Grok Imagine for ref2v. 1.0 Pro, Pro Fast and 1.5 Pro are active. **Newer:** `bytedance/seedance-2.0/*` (+ `fast`, `mini`, `us`) and `bytedance/seedance-2.5/*` (durations up to 30 s, `draft` mode). |
| **Kling** | 2.1 (std/pro/master) is **deprecated**. 2.5 Turbo (pro t2v/i2v, std i2v) and 2.6 Pro (t2v/i2v/motion-control) are active. There is no fal 2.6 Standard t2v/i2v (404). **Newer:** Kling **v3** (std/pro/4k/turbo, motion-control), **O1** and **O3** (i2v/FLF, ref2v, v2v edit, v2v reference; std/pro/4k), and Kling Image v3, O1 and O3. |
| **MiniMax** | Hailuo 02 and 2.3 (+ fast) are active. **Newer:** `minimax/h3`, `h3-max`, `h3-max-turbo` (t2v, i2v, ref2v, extend, lip-sync, styles…). H3-Max and H3-Max-Turbo prices are promotional until Oct 31. |
| **Wan** | 2.2, 2.5-preview and 2.6 remain. **Newer:** `fal-ai/wan/v2.7/*` and `alibaba/wan-3.0(-prime)/*`, with up to 30 s and native audio. |
| **FLUX** | Kontext pro/max, 1.1 pro/ultra and FLUX.2 pro/flex/max/dev remain. **Newer:** `blackforestlabs/flux-3/*`, which covers image, edit and video (t2v, i2v, FLF, keyframes, extend, edit-video). |
| **Luma** | Ray 2 and Ray 2 Flash on fal are being **deprecated on 2026-10-25** ("Migrate to Ray v3.2"). The successor is `luma/agent/ray/v3.2/*`. No "Ray 3" endpoint exists on fal; on Replicate the slug is `luma/ray-3.2`. |
| **Runway** | Not on fal. On Replicate: `runwayml/gen-4.5`, `gen4-turbo`, `gen4-aleph`, `gen4-image`. Native API: `api.dev.runwayml.com`, where the current editing model is `aleph2`. |
| **Hedra Character-3** | Not on fal or Replicate. Native `api.hedra.com/v3` only. |
| **SOUL** | Only available through the parity studio's own API: `{studio-api}/{studio}/soul/{standard,v2/standard,cinema}`. **DoP is not in the parity studio's API catalog** (84 entries checked). |
| **Lipsync / avatars** | New: `fal-ai/sync-lipsync/v3` (+ `/image-to-video`), `bytedance/omnihuman/v2`, `veed/lipsync/v2`, `fal-ai/heygen/v3/lipsync/*`, `minimax/h3-max/lip-sync/image-to-video`. |
| **Topaz** | Moved to the `topaz/upscale/{image,video}/{precision,creative,generative}` endpoints. The older `fal-ai/topaz/upscale/*` is unlisted but still has a schema. |

---

## 2. Quick reference: the most-used the parity studio's models on fal

Required fields are marked `*`. Duration and other enum values are shown with their exact JSON types: `"5"` is a string, `5` is a number.

| Model | Operation | fal endpoint | Image / end-frame fields | Duration | Aspect / size | Resolution | Audio | Price |
|---|---|---|---|---|---|---|---|---|
| Nano Banana Pro | t2i | `fal-ai/nano-banana-pro` | – | – | `aspect_ratio` auto,21:9,16:9,3:2,4:3,5:4,1:1,4:5,3:4,2:3,9:16 (def "1:1") | `resolution` "1K","2K","4K" | – | $0.15/img (4K ×2; web search +$0.015) |
| Nano Banana Pro | edit / multi-ref | `fal-ai/nano-banana-pro/edit` | `image_urls`* (array) | – | same, default "auto" | same | – | $0.15/img |
| Nano Banana 2 | t2i / edit | `fal-ai/nano-banana-2`, `/edit` | `image_urls` (optional on edit) | – | adds 4:1,1:4,8:1,1:8 | "0.5K","1K","2K","4K" | – | $0.08/img (2K ×1.5, 4K ×2) |
| Seedream 4.5 | t2i / edit | `fal-ai/bytedance/seedream/v4.5/text-to-image`, `/edit` | `image_urls`* | – | `image_size` preset or `{width,height}` (def 2048×2048; presets incl. auto_2K, auto_4K) | – | – | $0.04/img |
| Seedream 5 Pro | t2i / edit | `bytedance/seedream/v5/pro/text-to-image`, `/edit` | `image_urls`* | – | `image_size` (def "auto_2K") | – | – | $0.0675/img ≤1536², $0.135 ≤2048² |
| GPT Image 1.5 | t2i / edit | `fal-ai/gpt-image-1.5`, `/edit` | `image_urls`*, `mask_image_url` | – | `image_size` "1024x1024","1536x1024","1024x1536" (edit adds "auto") | `quality` low/medium/high (def high) | – | token-based (see JSON) |
| GPT Image 2 | t2i / edit | `openai/gpt-image-2`, `/edit` | `image_urls`* (max 16), `mask_url` | – | `image_size` preset or `{width,height}` | `quality` auto/low/medium/high | – | tokens: $8/M in, $30/M out (image) |
| FLUX.1 Kontext pro / max | edit | `fal-ai/flux-pro/kontext`, `fal-ai/flux-pro/kontext/max` | `image_url`* (single) | – | `aspect_ratio` 21:9…9:21 | – | – | $0.04 / $0.08 per image |
| FLUX.1 Kontext multi | multi-ref | `fal-ai/flux-pro/kontext/multi`, `/max/multi` | `image_urls`* | – | same | – | – | $0.04 / $0.08 |
| Kling 2.5 Turbo Pro | t2v | `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` | – | `duration` "5","10" | `aspect_ratio` "16:9","9:16","1:1" | – | – | $0.35/5 s + $0.07/s |
| Kling 2.5 Turbo Pro | i2v + end frame | `…/v2.5-turbo/pro/image-to-video` | `image_url`*, **`tail_image_url`** | "5","10" | (from image) | – | – | $0.35/5 s |
| Kling 2.6 Pro | t2v | `fal-ai/kling-video/v2.6/pro/text-to-video` | – | "5","10" | "16:9","9:16","1:1" | – | `generate_audio` (def **true**) | $0.07/s, $0.14/s with audio |
| Kling 2.6 Pro | i2v + end frame | `…/v2.6/pro/image-to-video` | **`start_image_url`***, `end_image_url` | "5","10" | – | – | `generate_audio` (def true), `voice_ids` | $0.07 / $0.14 / $0.168 per s |
| Kling 3 Pro | t2v / i2v | `fal-ai/kling-video/v3/pro/{text,image}-to-video` | `start_image_url`*, `end_image_url`, `elements` | "3"…"15" | "16:9","9:16","1:1" (t2v) | – | `generate_audio` (def true) | $0.112/s, $0.168/s with audio |
| Kling O3 Pro | i2v / ref2v / v2v | `fal-ai/kling-video/o3/pro/*` | i2v: **`image_url`***, `end_image_url`; ref2v: `image_urls`, `elements`, `start_image_url`; v2v: `video_url`* | "3"…"15" | "16:9","9:16","1:1" | – | `generate_audio` (def **false**) | $0.112/s, $0.14/s with audio |
| Veo 3.1 | t2v | `fal-ai/veo3.1` *(sunset 2026-11-17)* | – | `duration` **"4s","6s","8s"** | "16:9","9:16" | "720p","1080p","4k" | `generate_audio` (def **true**) | $0.20/s, $0.40/s with audio (4k: $0.40/$0.60) |
| Veo 3.1 | i2v | `fal-ai/veo3.1/image-to-video` | `image_url`* | same | "auto","16:9","9:16" | same | same | same |
| Veo 3.1 | first+last frame | `fal-ai/veo3.1/first-last-frame-to-video` | **`first_frame_url`***, **`last_frame_url`*** | same | same | same | same | same |
| Veo 3.1 | reference-to-video | `fal-ai/veo3.1/reference-to-video` | `image_urls`* | "8s" | "16:9","9:16" | same | same | same |
| Veo 3.1 Fast | all of the above | `fal-ai/veo3.1/fast[/image-to-video,/first-last-frame-to-video,/extend-video]` | same | same | same | same | same | $0.10/s, $0.15/s with audio |
| Seedance 1.0 Pro | t2v / i2v | `fal-ai/bytedance/seedance/v1/pro/{text,image}-to-video` | `image_url`*, `end_image_url` | **"2"…"12"** | "21:9","16:9","4:3","1:1","3:4","9:16" (+"auto" on i2v) | "480p","720p","1080p" (def 1080p) | – | ≈$0.62 per 1080p 5 s (token-based) |
| Seedance 2.0 | t2v / i2v / ref2v | `bytedance/seedance-2.0/{text,image,reference}-to-video` | `image_url`*, `end_image_url`; ref: `image_urls` (≤9), `video_urls` (≤3), `audio_urls` (≤3) | "auto","4"…"15" | "auto", 21:9…9:16 | "480p","720p","1080p","4k" | `generate_audio` (def true) | $0.3034/s at 720p, $0.682/s at 1080p |
| Hailuo 02 Standard | i2v + end frame | `fal-ai/minimax/hailuo-02/standard/image-to-video` | `image_url`*, `end_image_url` | "6","10" | – | **"512P","768P"** | – | $0.045/s at 768P |
| Hailuo 2.3 Pro | t2v / i2v | `fal-ai/minimax/hailuo-2.3/pro/{text,image}-to-video` | `image_url`* | (none, fixed) | – | – | – | $0.49/video |
| Hailuo 2.3 Standard | t2v / i2v | `…/hailuo-2.3/standard/*` | `image_url`* | "6","10" | – | – | – | $0.28 / $0.56 |
| Wan 2.5 | t2v / i2v | `fal-ai/wan-25-preview/{text,image}-to-video` | `image_url`*, `audio_url` (lipsync to supplied audio) | "5","10" | "16:9","9:16","1:1" (t2v) | "480p","720p","1080p" | – | $0.05/$0.10/$0.15 per s |
| Wan 2.6 | t2v / i2v / ref2v | `wan/v2.6/{text,image,reference}-to-video` (**no `fal-ai/` prefix**) | `image_url`*, `audio_url`; ref2v: `video_urls`* | "5","10","15" | t2v: 16:9,9:16,1:1,4:3,3:4 | "720p","1080p" | – (flash i2v: `generate_audio`) | $0.10/s at 720p, $0.15/s at 1080p |

---

## 3. Cross-model field-name gotchas

These are why Fuobe needs a per-endpoint `keyFields` map instead of one shared request shape.

1. **The start-image field name differs by model.**
   - `image_url`: most models, including Kling 2.5 Turbo, Kling O3 i2v, Kling 3 Turbo, Veo i2v, Seedance, Hailuo, Wan ≤2.7, Vidu, LTX, PixVerse.
   - `start_image_url`: Kling 2.6 Pro i2v, Kling v3 std/pro/4k i2v, Kling O1 i2v, Wan 3.0, FLUX 3 FLF, Vidu Q1 start-end.
   - `first_frame_url`: Veo 3.1 FLF.
   - `first_image_url`: PixVerse transition.
   - `base_image_url` + `swap_image_url`: fal face-swap.
   - `source_video_url`: MuseTalk.
2. **The end-frame field name differs too.**
   - `tail_image_url`: Kling 2.1 Pro, Kling 2.5 Turbo Pro.
   - `end_image_url`: Kling 2.6, v3, O1, O3, Seedance, Hailuo 02, Wan 2.2, 2.7 and 3.0, Luma, Vidu Q2/Q3, LTX 2.3/2.5, MiniMax H3, Gemini Omni 1.1, PixVerse transition.
   - `last_frame_url`: Veo 3.1 FLF only, where it is required.
   - Hailuo 2.3 and Kling 2.5 Turbo **Standard** have **no** end-frame field.
3. **Duration types are inconsistent.**
   - Strings: Kling (`"5"`), Seedance (`"5"`, `"auto"`), Hailuo (`"6"`), Wan 2.5/2.6 (`"5"`), PixVerse ≤v5.6 (`"5"`).
   - Strings with an `s` suffix: Veo (`"8s"`), Luma (`"5s"`).
   - Integer enums: Pika (`5`), LTX (`6`), Wan 2.7 (`2`…`15`).
   - Integer ranges: Wan 3.0 (2–30), PixVerse v6/C1 (1–15), Vidu Q3/Q4, MiniMax H3.
   - Floats: MiniMax H3-Max (`0.92`–`15`).
   - Mixed: FLUX 3 (`"auto"` or `5`–`20`), LTX-2.5 (`6` or `"auto"`).
4. **The audio switch has four names and different defaults.**
   - `generate_audio`: Veo (def **true**, which doubles the price), Kling 2.6/3 (def true), Kling O3 (def **false**), Seedance 1.5/2.x (def true), LTX, FLUX 3.
   - `generate_audio_switch`: PixVerse (def false).
   - `audio`: Wan 3.0 (def true), Vidu Q3 (def true), Vidu Q4 ref2v (def false).
   - `bgm`: Vidu Q1/Q2.
5. **Image size is either `aspect_ratio` or `image_size`.**
   - `image_size` (Seedream, FLUX.2, Qwen, GPT Image 2/2.5, Recraft, Wan image, Z-Image, Hunyuan) takes either a preset string (`square_hd`, `landscape_16_9`, `auto_2K`…) or an object `{"width":W,"height":H}`.
   - GPT Image 1/1.5 `image_size` is a strict enum of pixel strings (`"1536x1024"`).
6. **Resolution casing:** MiniMax uses `"768P"` and `"512P"` (upper case) on fal, while Replicate uses `"768p"`.
7. **Prompt is not always required.**
   - Kling v3, v3-turbo and O3 accept `multi_prompt` instead of `prompt`.
   - Wan 2.7 i2v requires nothing.
   - Seedance 2.5 i2v and ref2v make `prompt` optional.
   - Kling AI Avatar uses `prompt` default `"."`.
   - ElevenLabs uses `text`, and Hunyuan foley uses `text_prompt`.
8. **Multi-image arrays:**
   - `image_urls`: Nano Banana, Seedream, GPT Image, FLUX.2, Qwen Plus/2509/2511, Kontext multi.
   - `reference_image_urls`: Vidu, MiniMax H3, Wan 2.7/3.0, Ideogram character.
   - Kling `elements[]` is an array of objects `{frontal_image_url, reference_image_urls[]}`, plus `video_url`/`voice_id` on v3/O3.
   - Pika `pikaframes` uses `image_urls` plus `transitions[]` `{duration,prompt}`.
   - FLUX 3 `keyframes[]` is an array of `{image_url, frame_index}`.
   - PixVerse C1 `image_references[]` is an array of `{ref_name,type,image_url}`.
9. **Output shapes:**
   - Images: almost always `images[].url`.
   - Single images: `image.url` for upscalers, bg-removal, face-swap and Vidu Q2 t2i.
   - Video: `video.url`. Exception: `veed/video-background-removal` returns `video[]` (array).
   - Audio: `audio.url`. Exception: `mirelo-ai/sfx2.0/video-to-audio` returns `audio[]`.
   - Several models add `seed`, `actual_prompt`, `description` or `timings` alongside the media.
10. **Endpoint prefixes are not always `fal-ai/`.** For example: `wan/v2.6/...`, `bytedance/seedance-2.0/...`, `openai/gpt-image-2`, `google/nano-banana-2.1`, `blackforestlabs/flux-3/...`, `alibaba/wan-3.0/...`, `minimax/h3/...`, `topaz/upscale/...`, `veed/fabric-1.0`, `luma/agent/ray/v3.2/...`. Always use the exact id.

---

## 4. Protocols

### 4.1 fal.ai queue REST API (primary)

Source: <https://fal.ai/docs/documentation/model-apis/inference/queue.md>, cross-checked against `@fal-ai/client@1.10.1` `src/queue.js`, `src/utils.js` and `src/storage.js`.

- **Auth header:** `Authorization: Key $FAL_KEY`. The scheme word is `Key`, not `Bearer`. Also send `Content-Type: application/json`.
- **Submit:** `POST https://queue.fal.run/{endpoint_id}`. The body is the model input JSON itself, with no `{"input":…}` wrapper. Use the **full** endpoint id, for example `https://queue.fal.run/fal-ai/kling-video/v2.6/pro/image-to-video`.
  - The response is `{"request_id","response_url","status_url","cancel_url","queue_position"}`.
- **Status:** `GET {status_url}?logs=1`.
  - The response is `{"status":"IN_QUEUE"|"IN_PROGRESS"|"COMPLETED","request_id","response_url","queue_position"?,"logs"?:[{"message","timestamp"}],"metrics"?:{"inference_time"},"error"?,"error_type"?}`.
  - When a request fails, the status is still `COMPLETED`, with `error` and `error_type` set.
  - **SSE variant:** `GET {status_url}/stream?logs=1` (`text/event-stream`).
- **Result:** `GET {response_url}`. It returns the model output JSON. A failed request returns 4xx/5xx with `{"detail":[{"loc","msg","type",…}]}`.
- **Cancel:** `PUT {cancel_url}`. Possible responses:
  - `202 {"status":"CANCELLATION_REQUESTED"}`
  - `400 {"status":"ALREADY_COMPLETED"}`
  - `404 {"status":"NOT_FOUND"}`
- **Sub-path mapping (important):**
  - You submit to the full id, but status, result and cancel live under the **app root** (`owner/alias`): `https://queue.fal.run/{owner}/{alias}/requests/{request_id}[/status|/status/stream|/cancel]`.
  - For example, after submitting `fal-ai/kling-video/v3/pro/text-to-video`, you poll `https://queue.fal.run/fal-ai/kling-video/requests/{id}/status`.
  - For `bytedance/seedance-2.0/fast/text-to-video` the root is `bytedance/seedance-2.0`.
  - This is exactly what the official JS client does: `parseEndpointId` returns owner, alias and path, and only the `workflows/` and `comfy/` namespaces add a third prefix segment.
  - The per-endpoint OpenAPI files also list full-path `/…/requests/{id}` routes. The simplest correct approach is to store and use the `status_url`, `response_url` and `cancel_url` returned by submit.
- **Synchronous alternative:** `POST https://fal.run/{endpoint_id}` blocks until done. Do not use it for video.
- **Webhooks:**
  - Submit to `POST https://queue.fal.run/{id}?fal_webhook={https-url}`.
  - The delivery body is `{"request_id","gateway_request_id","status":"OK"|"ERROR","payload","error"?,"payload_error"?}`.
  - Verify the ED25519 signature over the headers `X-Fal-Webhook-Request-Id`, `X-Fal-Webhook-User-Id`, `X-Fal-Webhook-Timestamp` and `X-Fal-Webhook-Signature` (hex) plus the body. The keys are at `https://rest.fal.ai/.well-known/jwks.json`.
  - Return 2xx quickly. Deliveries are retried up to 31 times. A 3xx response is a permanent failure, and private or loopback targets are dropped.
- **Useful request headers:**
  - `X-Fal-Request-Start-Timeout` (seconds before 504).
  - `X-Fal-Queue-Priority: normal|low`.
  - `X-Fal-No-Retry: 1`. By default fal retries up to 10 times on 503, 504 or connection errors.
  - `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds":N}` sets output media retention.
  - `X-Fal-Store-IO: 0`.
- **Response headers:** `X-Fal-Billable-Units`, `X-Fal-Error-Type`.
- **Errors:** a 422 returns `{"detail":[{"loc":["body","field"],"msg","type","url","ctx"}]}`. Branch on `type` and never on `msg`. Check `X-Fal-Needs-Retry`.
- **File inputs:**
  - Every `*_url` / `*_urls` field accepts any public HTTPS URL. Presigned S3/GCS/R2 URLs work; URLs that need auth headers do not.
  - fal states that models "also accept base64-encoded **data URIs**" (`data:image/png;base64,…`). It warns that data URIs inflate the request and are not recommended above a few KB.
- **Upload to the fal CDN:**
  1. `POST https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3`, with `Authorization: Key …` and body `{"content_type":"image/png","file_name":"x.png"}`. The response is `{"upload_url","file_url"}`.
  2. `PUT <upload_url>` with the raw bytes and `Content-Type`.
  3. Pass `file_url` (`https://v3b.fal.media/files/b/…`) as the model input.
  - Files over 90 MB use multipart:
    1. `POST …/storage/upload/initiate-multipart?storage_type=fal-cdn-v3`.
    2. `PUT` 10 MB chunks to `{upload_url origin+path}/{partNumber}{query}`.
    3. `POST {origin+path}/complete{query}` with `{"parts":[{"partNumber","etag"}]}`.
  - Optional header `X-Fal-Object-Lifecycle` (JSON) on initiate.
  - Delete with `POST https://rest.fal.ai/storage/files/delete {"file_url"}`, which needs `assets:write`.
  - Uploaded and generated files are public by default and are kept per the account retention setting (forever if not configured).
- **Catalog and pricing discovery (no key needed):**
  - `GET https://api.fal.ai/v1/models?limit=100&cursor=…`. Active endpoints only; add `q=` or a repeated `endpoint_id=` to see deprecated ones. `expand=openapi-3.0` inlines the schema.
  - Per-endpoint OpenAPI: `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`.
  - Pricing text: `https://fal.ai/models/{id}/llms.txt`.

### 4.2 Replicate predictions API (secondary)

Source: <https://api.replicate.com/openapi.json> and the Replicate docs topics *create-a-prediction*, *input-files* and *lifecycle*.

- **Auth header:** `Authorization: Bearer $REPLICATE_API_TOKEN`. The Files API example uses `Token`. Also send `Content-Type: application/json`.
- **Official models** (every model listed here): `POST https://api.replicate.com/v1/models/{owner}/{name}/predictions` with body `{"input":{…},"webhook"?,"webhook_events_filter"?:["start","output","logs","completed"]}`.
- **Community or versioned models:** `POST https://api.replicate.com/v1/predictions` with `{"version":"<id>","input":{…}}`.
- **Sync mode:**
  - `Prefer: wait` holds the request for up to 60 s. `Prefer: wait=n` sets the hold, with n in 1–60.
  - On timeout you get the unfinished prediction (`starting`/`processing`), and you then poll `urls.get`.
  - File outputs can appear before `status` becomes `succeeded`.
- **Auto-cancel:** `Cancel-After: 90s|5m|1h30m` (minimum 5 s). A prediction cancelled before it starts ends as `aborted` and is not billed.
- **Prediction object:** `{"id","model","version","input","output","logs","error","status","created_at","started_at","completed_at","data_removed","deadline","metrics":{"predict_time","total_time"},"urls":{"get","cancel","stream"?,"web"}}`.
  - `status` is one of `starting | processing | succeeded | failed | canceled | aborted`.
- **Poll:** `GET https://api.replicate.com/v1/predictions/{id}`.
- **Cancel:** `POST https://api.replicate.com/v1/predictions/{id}/cancel`.
- **Outputs:**
  - Most image and video models return a single URL string. Seedream, GPT Image, Qwen, Hunyuan and Clarity return an array of URLs.
  - For API-created predictions, inputs, outputs and logs are deleted after **1 hour** (`data_removed:true`, `output:null`). Copy files out immediately.
- **File inputs:**
  - HTTPS URL, or a data URI. The API spec recommends data URIs for files ≤256 KB; the guide says <1 MB.
  - For larger files use the Files API: `POST https://api.replicate.com/v1/files` as multipart, with part `content` (required) and optional `filename`, `type` and `metadata`. The response is a file object `{id, urls.get, expires_at, checksums…}`; pass `urls.get` as the input.
- **Webhooks:** the body is the prediction object. Redirects are not followed. `output` and `logs` events are throttled to every 500 ms.
- **Timeout:** predictions stop after 30 minutes of run time.
- **Field-name differences from fal:**
  - Replicate uses `image` / `image_input` / `input_images` / `start_image` / `first_frame_image` / `last_frame` / `last_frame_image` / `end_image` instead of `*_url`.
  - Veo `duration` and Kling `duration` are **integers** (`8`, `5`).
  - Sora used `seconds`.
  - `openai/gpt-image-1` and `-mini` require `openai_api_key` (bring your own key).

### 4.3 The parity studio's API (only route to SOUL)

Source: <{studio-docs}/docs/llms.txt>.

- **Auth header:** `Authorization: Key {api_key_id}:{api_key_secret}`, with keys from {studio-console}. Add an optional `Idempotency-Key` header.
- **Submit:** `POST {studio-api}/{model_id}` with the raw input JSON. The response is `{"status":"queued","request_id","status_url","cancel_url"}`.
- **Status:** `GET {studio-api}/requests/{id}/status`.
  - `status` is `queued | in_progress | completed | failed | nsfw | canceled`.
  - Outputs appear as `images[].url`, `video.url`, `audio.url` or `audios[]`.
  - Poll every 2 s, backing off to 10 s, with jitter.
- **Cancel:** `POST {studio-api}/requests/{id}/cancel`. This only works while the request is queued.
- **Upload:**
  1. `POST {studio-api}/files/generate-upload-url {"content_type":"image/jpeg"}`. The response is `{public_url, upload_url, upload_headers}`.
  2. `PUT` the bytes to `upload_url` with every header in `upload_headers`. Do not send the parity studio's credentials to that URL.
  3. Use `public_url` as the input.
  - Supported types: jpeg, png, webp, gif, wav and mp4.
  - Outputs are kept for at least 7 days.

### 4.4 Other vendor-native APIs referenced

- **Hedra:**
  - Submit with `POST https://api.hedra.com/v3/models/hedra-character-3` and `Authorization: Key <id>:<secret>`. The body is `{"input":{…},"webhook","idempotency_key"}`; media references are objects (`{"source":"url","url":…}`).
  - The response is 202 with `{job_id,status_url,result_url}`.
  - Get the result with `GET /v3/jobs/{job_id}` (field `outputs[]`).
- **Runway:**
  - Base URL `https://api.dev.runwayml.com/v1/{image_to_video|video_to_video|text_to_image|character_performance}`, with `Authorization: Bearer …` and `X-Runway-Version: 2024-11-06`.
  - The `ratio` field is a pixel string such as `"1280:720"`.
  - Poll `GET /v1/tasks/{id}` until `SUCCEEDED`, `FAILED` or `CANCELED` (`THROTTLED` behaves like `PENDING`). The result is in `output[]`.
  - 1 credit = $0.01.
- **Reve (unverified):** `POST https://api.reve.com/v1/image/{create,edit,remix}` with `Authorization: Bearer`.

---

## 5. Per-family endpoint tables (fal.ai)

Every table below was generated from the JSON.

- "Media fields" lists the exact input names; `*` means required.
- Enum lists longer than ~100 characters are truncated here. The JSON has them in full.
- Prices are fal's own wording, shortened.
- Rows tagged **[deprecated]**, **[unlisted]** or **[removed]** should not be the default route.

### Google Nano Banana family (Gemini image)

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/nano-banana` | t2i |  | `aspect_ratio` ["21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16"] (def "1:1") |  |  |  | Your request will cost $0.039 per image.  |
| `fal-ai/nano-banana/edit` | edit | `image_urls`* | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16"] (def "auto") |  |  |  | Your request will cost $0.039 per image.  |
| `fal-ai/gemini-25-flash-image` | t2i |  | `aspect_ratio` ["21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16"] (def "1:1") |  |  |  | Your request will cost $0.039 per image.  |
| `fal-ai/gemini-25-flash-image/edit` | edit | `image_urls`* | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16"] (def "auto") |  |  |  | Your request will cost $0.039 per image.  |
| `fal-ai/nano-banana-pro` | t2i |  | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16"] (def "1:1") |  | `resolution` ["1K","2K","4K"] (def "1K") |  | Your request will cost $0.15 per image.  4K outputs will be charged at double the standard rate. If web search is used, an additional $0.015 will be c… |
| `fal-ai/nano-banana-pro/edit` | edit | `image_urls`* | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16"] (def "auto") |  | `resolution` ["1K","2K","4K"] (def "1K") |  | Your request will cost $0.15 per image.  4K outputs will be charged at double the standard rate. If web search is used, an additional $0.015 will be c… |
| `fal-ai/gemini-3-pro-image-preview` | t2i |  | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16"] (def "1:1") |  | `resolution` ["1K","2K","4K"] (def "1K") |  | Your request will cost $0.15 per image.  4K outputs will be charged at double the standard rate. Note: Pricing may change in the future. |
| `fal-ai/gemini-3-pro-image-preview/edit` | edit | `image_urls`* | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16"] (def "auto") |  | `resolution` ["1K","2K","4K"] (def "1K") |  | Your request will cost $0.15 per image.  4K outputs will be charged at double the standard rate. Note: Pricing may change in the future. |
| `fal-ai/nano-banana-2` | t2i |  | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16","4:1","1:4","8:1","1:8"] (def "auto") |  | `resolution` ["0.5K","1K","2K","4K"] (def "1K") |  | Your request will cost $0.08 per image.  2K and 4K outputs will be charged at 1.5 times and 2 times the standard rate, respectively. 0.5K (512px) reso… |
| `fal-ai/nano-banana-2/edit` | edit | `image_urls` `video_url` `audio_url` | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16","4:1","1:4","8:1","1:8"] (def "auto") |  | `resolution` ["0.5K","1K","2K","4K"] (def "1K") |  | Your request will cost $0.08 per image.  2K and 4K outputs will be charged at 1.5 times and 2 times the standard rate, respectively. 0.5K (512px) reso… |
| `fal-ai/gemini-3.1-flash-image-preview` | t2i |  | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16","4:1","1:4","8:1","1:8"] (def "auto") |  | `resolution` ["0.5K","1K","2K","4K"] (def "1K") |  | Your request will cost $0.08 per image.  2K and 4K outputs will be charged at 1.5 times and 2 times the standard rate, respectively. 512x512 resolutio… |
| `fal-ai/gemini-3.1-flash-image-preview/edit` | edit | `image_urls` `video_url` `audio_url` | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16","4:1","1:4","8:1","1:8"] (def "auto") |  | `resolution` ["0.5K","1K","2K","4K"] (def "1K") |  | Your request will cost $0.08 per image.  2K and 4K outputs will be charged at 1.5 times and 2 times the standard rate, respectively. 512x512 resolutio… |
| `google/nano-banana-2.1` | t2i |  | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16","4:1","1:4","8:1","1:8"] (def "auto") |  | `resolution` ["1K","2K","4K"] (def "1K") |  | Text/thinking tokens (per 1M): $1.764 input, $8.823 output. Image tokens (per 1M): $1.764 input, $35.294 output. Changing the resolution parameter sig… |
| `google/nano-banana-2.1/edit` | edit | `image_urls` `video_url` | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16","4:1","1:4","8:1","1:8"] (def "auto") |  | `resolution` ["1K","2K","4K"] (def "1K") |  | Text/thinking tokens (per 1M): $1.764 input, $8.823 output. Image tokens (per 1M): $1.764 input, $35.294 output. Changing the resolution parameter sig… |
| `google/nano-banana-2-lite` | t2i |  | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16","4:1","1:4","8:1","1:8"] (def "auto") |  |  |  | Text tokens (per 1M): $0.3125 input, $1.875 output. Image tokens (per 1M): $0.3125 input, $37.50 output. Output images are generated at a fixed 1K (10… |
| `google/nano-banana-lite` | t2i |  | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16","4:1","1:4","8:1","1:8"] (def "auto") |  |  |  | Text tokens (per 1M): $0.3125 input, $1.875 output. Image tokens (per 1M): $0.3125 input, $37.50 output. Output images are generated at a fixed 1K (10… |
| `google/nano-banana-lite/edit` | edit | `image_urls` | `aspect_ratio` ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16","4:1","1:4","8:1","1:8"] (def "auto") |  |  |  | Text tokens (per 1M): $0.3125 input, $1.875 output. Image tokens (per 1M): $0.3125 input, $37.50 output. Output images are generated at a fixed 1K (10… |

### Google Imagen 4

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/imagen4/preview` **[removed]** | t2i |  |  |  |  |  |  |
| `fal-ai/imagen4/preview/fast` **[removed]** | t2i |  |  |  |  |  |  |
| `fal-ai/imagen4/preview/ultra` **[removed]** | t2i |  |  |  |  |  |  |

> Status note (fal-ai/imagen4/preview and siblings): fal catalog status = deprecated; fal no longer serves the schema or llms.txt (404). Use the Replicate google/imagen-4* models instead.

### Google Veo

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/veo3.1` **[unlisted]** | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p","4k"] (def "720p") | `generate_audio` (def true) | For every second of video you generate you will be charged $0.20 without audio or $0.40 with audio for 720p or 1080p. At 4k, you will be charged $0.40… |
| `fal-ai/veo3.1/fast` **[unlisted]** | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p","4k"] (def "720p") | `generate_audio` (def true) | For every second of video you generate you will be charged $0.10 without audio or $0.15 with audio for 720p or 1080p. At 4k, you will be charged $0.30… |
| `fal-ai/veo3.1/image-to-video` **[unlisted]** | i2v | `image_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p","4k"] (def "720p") | `generate_audio` (def true) | For every second of video you generate you will be charged $0.20 without audio or $0.40 with audio for 720p or 1080p. At 4k, you will be charged $0.40… |
| `fal-ai/veo3.1/fast/image-to-video` **[unlisted]** | i2v | `image_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p","4k"] (def "720p") | `generate_audio` (def true) | For every second of video you generate you will be charged $0.10 without audio or $0.15 with audio for 720p or 1080p. At 4k, you will be charged $0.30… |
| `fal-ai/veo3.1/first-last-frame-to-video` **[unlisted]** | flf2v | `first_frame_url`* `last_frame_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p","4k"] (def "720p") | `generate_audio` (def true) | For every second of video you generate you will be charged $0.20 without audio or $0.40 with audio for 720p or 1080p. At 4k, you will be charged $0.40… |
| `fal-ai/veo3.1/fast/first-last-frame-to-video` **[unlisted]** | flf2v | `first_frame_url`* `last_frame_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p","4k"] (def "720p") | `generate_audio` (def true) | For every second of video you generate you will be charged $0.10 without audio or $0.15 with audio for 720p or 1080p. At 4k, you will be charged $0.30… |
| `fal-ai/veo3.1/reference-to-video` **[unlisted]** | ref2v | `image_urls`* | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` string (def "8s") | `resolution` ["720p","1080p","4k"] (def "720p") | `generate_audio` (def true) | For every second of video you generate you will be charged $0.20 without audio or $0.40 with audio for 720p or 1080p. At 4k, you will be charged $0.40… |
| `fal-ai/veo3.1/extend-video` **[unlisted]** | v2v | `video_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` string (def "7s") | `resolution` string (def "720p") | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.20 (audio off) or $0.40 (audio on). For example, a 5s video with audio on will cost $2… |
| `fal-ai/veo3.1/fast/extend-video` **[unlisted]** | v2v | `video_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` string (def "7s") | `resolution` string (def "720p") | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.10 (audio off) or $0.15 (audio on). For example, a 5s video with audio on will cost $0… |
| `fal-ai/veo3.1/lite` **[unlisted]** | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p"] (def "720p") | `generate_audio` (def true) | For every second of video you generate you will be charged $0.05 for 720p with audio, $0.03 for 720p without audio, $0.08 for 1080p with audio or $0.0… |
| `fal-ai/veo3.1/lite/image-to-video` **[unlisted]** | i2v | `image_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p"] (def "720p") | `generate_audio` (def true) | For every second of video you generate you will be charged $0.05 for 720p with audio, $0.03 for 720p without audio, $0.08 for 1080p with audio or $0.0… |
| `fal-ai/veo3` **[deprecated]** | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p"] (def "720p") | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.20 (audio off) or $0.40 (audio on). For example, a 5s video with audio on will cost $2… |
| `fal-ai/veo3/fast` **[deprecated]** | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p"] (def "720p") | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.10 (audio off) or $0.15 (audio on). For example, a 5s video with audio on will cost $0… |
| `fal-ai/veo3/image-to-video` **[deprecated]** | i2v | `image_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p"] (def "720p") | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.20 (audio off) or $0.40 (audio on). For example, a 5s video with audio on will cost $2… |
| `fal-ai/veo3/fast/image-to-video` **[deprecated]** | i2v | `image_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` ["4s","6s","8s"] (def "8s") | `resolution` ["720p","1080p"] (def "720p") | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.10 (audio off) or $0.15 (audio on). For example, a 5s video with audio on will cost $0… |

> Status note (fal-ai/veo3.1 and siblings): fal shows "This endpoint will be deprecated on November 17, 2026" for fal-ai/veo3.1 and every fal-ai/veo3.1/* path

> Status note (fal-ai/veo3 and siblings): fal catalog status = deprecated (still callable at time of check, may be rerouted).

### Google Gemini Omni Flash (video)

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `google/gemini-omni-flash` | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` integer 3..10 (def 8) |  |  | Billing is based on total token consumption. Tokens cost $21.875 per 1 million tokens. For 720p video this costs approximately $0.125 per second of vi… |
| `google/gemini-omni-flash/image-to-video` | i2v | `image_url`* | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` integer 3..10 (def 8) |  |  | Billing is based on total token consumption. Input tokens (text/audio/video) cost $1.875 per 1 million tokens. Output tokens cost $21.875 per 1 millio… |
| `google/gemini-omni-flash/reference-to-video` | ref2v | `image_urls`* | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` integer 3..10 (def 8) |  |  | Billing is based on total token consumption. Input tokens (text/audio/video) cost $1.875 per 1 million tokens. Output tokens cost $21.875 per 1 millio… |
| `google/gemini-omni-flash/edit` | v2v | `video_url`* |  |  |  |  | Billing is based on total token consumption. Input tokens (text/audio/video) cost $1.875 per 1 million tokens. Output tokens cost $21.875 per 1 millio… |
| `google/gemini-omni-flash/v1.1/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` integer 3..10 (def 8) | `resolution` ["360p","720p","1080p","4k"] (def "720p") |  | Billing is calculated per second of output video, by resolution. For 360p, your request will cost $0.03 per second; for 720p, $0.10 per second; for 10… |
| `google/gemini-omni-flash/v1.1/image-to-video` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` integer 3..10 (def 8) | `resolution` ["360p","720p","1080p","4k"] (def "720p") |  | Billing is calculated per second of output video, by resolution. For 360p, your request will cost $0.03 per second; for 720p, $0.10 per second; for 10… |
| `google/gemini-omni-flash/v1.1/reference-to-video` | ref2v | `image_urls` `reference_video_urls` | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` integer 3..10 (def 8) | `resolution` ["360p","720p","1080p","4k"] (def "720p") |  | Billing is calculated per second of output video, by resolution. For 360p, your request will cost $0.03 per second; for 720p, $0.10 per second; for 10… |
| `google/gemini-omni-flash/v1.1/edit` | v2v | `video_url`* |  |  | `resolution` ["360p","720p","1080p","4k"] (def "720p") |  | Billing is calculated per second of output video, by resolution. For 360p, your request will cost $0.03 per second; for 720p, $0.10 per second; for 10… |

### ByteDance Seedream

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/bytedance/seedream/v4/text-to-image` | t2i |  | `image_size` preset|{width,height} (def {"width": 2048, "height": 2048}) |  |  |  | $0.03 per images |
| `fal-ai/bytedance/seedream/v4/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def {"width": 2048, "height": 2048}) |  |  |  | $0.03 per images |
| `fal-ai/bytedance/seedream/v4.5/text-to-image` | t2i |  | `image_size` preset|{width,height} (def {"width": 2048, "height": 2048}) |  |  |  | $0.04 per images |
| `fal-ai/bytedance/seedream/v4.5/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def {"width": 2048, "height": 2048}) |  |  |  | $0.04 per images |
| `bytedance/seedream/v5/pro/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "auto_2K") |  |  |  | Tentative pricing is $0.0675 per image for images of total area less than or equal to 1536x1536 pixels. For images with area in between 1536x1536 and … |
| `bytedance/seedream/v5/pro/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "auto_2K") |  |  |  | You will be charged for both input and output images. The first input image is not charged, and every additional input image will cost $0.0045. Tentat… |
| `bytedance/seedream/v5/lite/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "auto_2K") |  |  |  | $0.035 per images |
| `bytedance/seedream/v5/lite/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "auto_2K") |  |  |  | $0.035 per images |
| `bytedance/seedream/v5/flash/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "auto_2K") |  |  |  | $0.027 per images |
| `bytedance/seedream/v5/flash/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "auto_2K") |  |  |  | $0.027 per images |

### ByteDance Seedance

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/bytedance/seedance/v1/pro/text-to-video` | t2v |  | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16"] (def "16:9") | `duration` ["2","3","4","5","6","7","8","9","10","11","12"] (def "5") | `resolution` ["480p","720p","1080p"] (def "1080p") |  | Each 1080p 5 second video costs roughly $0.62. For other resolutions, 1 million video tokens costs $2.5. tokens(video) = (height x width x FPS x durat… |
| `fal-ai/bytedance/seedance/v1/pro/image-to-video` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16","auto"] (def "auto") | `duration` ["2","3","4","5","6","7","8","9","10","11","12"] (def "5") | `resolution` ["480p","720p","1080p"] (def "1080p") |  | Each 1080p 5 second video costs roughly $0.62. For other resolutions, 1 million video tokens costs $2.5. tokens(video) = (height x width x FPS x durat… |
| `fal-ai/bytedance/seedance/v1/pro/fast/text-to-video` | t2v |  | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16"] (def "16:9") | `duration` ["2","3","4","5","6","7","8","9","10","11","12"] (def "5") | `resolution` ["480p","720p","1080p"] (def "1080p") |  | Each 1080p 5 second video costs roughly $0.245. For other resolutions, 1 million video tokens costs $1. tokens(video) = (height x width x FPS x durati… |
| `fal-ai/bytedance/seedance/v1/pro/fast/image-to-video` | i2v | `image_url`* | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16","auto"] (def "auto") | `duration` ["2","3","4","5","6","7","8","9","10","11","12"] (def "5") | `resolution` ["480p","720p","1080p"] (def "1080p") |  | Each 1080p 5 second video costs roughly $0.243. For other resolutions, 1 million video tokens costs $1.0. tokens(video) = (height x width x FPS x dura… |
| `fal-ai/bytedance/seedance/v1/lite/text-to-video` **[deprecated]** | t2v |  | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16","9:21"] (def "16:9") | `duration` ["2","3","4","5","6","7","8","9","10","11","12"] (def "5") | `resolution` ["480p","720p","1080p"] (def "720p") |  | This model has been deprecated, and further requests are being re-routed to Seedance 1.0 Pro Fast. |
| `fal-ai/bytedance/seedance/v1/lite/image-to-video` **[deprecated]** | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16","auto"] (def "auto") | `duration` ["2","3","4","5","6","7","8","9","10","11","12"] (def "5") | `resolution` ["480p","720p","1080p"] (def "720p") |  | This model has been deprecated, and further requests are being re-routed to Seedance 1.0 Pro Fast. |
| `fal-ai/bytedance/seedance/v1/lite/reference-to-video` **[deprecated]** | ref2v | `reference_image_urls`* | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16","auto"] (def "auto") | `duration` ["2","3","4","5","6","7","8","9","10","11","12"] (def "5") | `resolution` ["480p","720p"] (def "720p") |  | This model has been deprecated, and further requests are being re-routed to Grok Imagine Video. |
| `fal-ai/bytedance/seedance/v1.5/pro/text-to-video` | t2v |  | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16","auto"] (def "16:9") | `duration` ["4","5","6","7","8","9","10","11","12"] (def "5") | `resolution` ["480p","720p","1080p"] (def "720p") | `generate_audio` (def true) | Each 720p 5 second video with audio costs roughly $0.26. For other resolutions, 1 million video tokens with audio costs $2.4. Without audio, the price… |
| `fal-ai/bytedance/seedance/v1.5/pro/image-to-video` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16","auto"] (def "16:9") | `duration` ["4","5","6","7","8","9","10","11","12"] (def "5") | `resolution` ["480p","720p","1080p"] (def "720p") | `generate_audio` (def true) | Each 720p 5 second video with audio costs roughly $0.26. For other resolutions, 1 million video tokens with audio costs $2.4. Without audio, the price… |
| `bytedance/seedance-2.0/text-to-video` | t2v |  | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15"] (def "auto") | `resolution` ["480p","720p","1080p","4k"] (def "720p") | `generate_audio` (def true) | For every second of 720p video you generated, you will be charged $0.3034/second and for 1080p you will be charged $0.682/second. Your request will co… |
| `bytedance/seedance-2.0/image-to-video` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15"] (def "auto") | `resolution` ["480p","720p","1080p","4k"] (def "720p") | `generate_audio` (def true) | For every second of 720p video you generated, you will be charged $0.3034/second and for 1080p you will be charged $0.682/second. Your request will co… |
| `bytedance/seedance-2.0/reference-to-video` | ref2v | `image_urls` `video_urls` `audio_urls` | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15"] (def "auto") | `resolution` ["480p","720p","1080p","4k"] (def "720p") | `generate_audio` (def true) | For every second of 720p video you generated, you will be charged $0.3034/second and for 1080p you will be charged $0.682/second. Your request will co… |
| `bytedance/seedance-2.0/fast/text-to-video` | t2v |  | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15"] (def "auto") | `resolution` ["480p","720p"] (def "720p") | `generate_audio` (def true) | For every second of 720p video you generated, you will be charged $0.2419/second. Your request will cost $0.0112 per 1000 tokens. The number of tokens… |
| `bytedance/seedance-2.0/fast/image-to-video` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15"] (def "auto") | `resolution` ["480p","720p"] (def "720p") | `generate_audio` (def true) | For every second of 720p video you generated, you will be charged $0.2419/second. Your request will cost $0.0112 per 1000 tokens. The number of tokens… |
| `bytedance/seedance-2.0/fast/reference-to-video` | ref2v | `image_urls` `video_urls` `audio_urls` | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15"] (def "auto") | `resolution` ["480p","720p"] (def "720p") | `generate_audio` (def true) | For every second of 720p video you generated, you will be charged $0.2419/second. Your request will cost $0.0112 per 1000 tokens. The number of tokens… |
| `bytedance/seedance-2.0/mini/text-to-video` | t2v |  | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15"] (def "auto") | `resolution` ["480p","720p"] (def "720p") | `generate_audio` (def true) | For every second of video generated, you will be charged roughly $0.0721/second for 480p and $0.1547/second for 720p. Actual cost calculations are bas… |
| `bytedance/seedance-2.0/mini/image-to-video` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15"] (def "auto") | `resolution` ["480p","720p"] (def "720p") | `generate_audio` (def true) | For every second of video generated, you will be charged roughly $0.0721/second for 480p and $0.1547/second for 720p. Actual cost calculations are bas… |
| `bytedance/seedance-2.0/mini/reference-to-video` | ref2v | `image_urls` `video_urls` `audio_urls` | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15"] (def "auto") | `resolution` ["480p","720p"] (def "720p") | `generate_audio` (def true) | For every second of video generated, you will be charged roughly $0.0721/second for 480p and $0.1547/second for 720p. If a video input is provided, th… |
| `bytedance/seedance-2.5/text-to-video` | t2v |  | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24",...] (def "auto") | `resolution` ["480p","720p","1080p"] (def "720p") | `generate_audio` (def true) | For 480p, your request will cost roughly $0.2205 per second of generated video, for 720p, you will be charged roughly $0.4730 per second of generated … |
| `bytedance/seedance-2.5/image-to-video` | i2v | `image_url`* `end_image_url` | `aspect_ratio` string (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24",...] (def "auto") | `resolution` ["480p","720p","1080p"] (def "720p") | `generate_audio` (def true) | For 480p, your request will cost roughly $0.2205 per second of generated video, for 720p, you will be charged roughly $0.4730 per second of generated … |
| `bytedance/seedance-2.5/reference-to-video` | ref2v | `image_urls` `video_urls` `audio_urls` | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24",...] (def "auto") | `resolution` ["480p","720p","1080p"] (def "720p") | `generate_audio` (def true) | For 480p, your request will cost roughly $0.2205 per second of generated video, for 720p, you will be charged roughly $0.4730 per second of generated … |

> Status note (fal-ai/bytedance/seedance/v1/lite/text-to-video and siblings): fal catalog status = deprecated (still callable at time of check, may be rerouted). fal pricing page says requests are re-routed (t2v/i2v -> Seedance 1.0 Pro Fast; ref2v -> Grok Imagine Video).

### ByteDance OmniHuman

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/bytedance/omnihuman` | avatar | `image_url`* `audio_url`* |  |  |  |  | $0.14 per seconds |
| `fal-ai/bytedance/omnihuman/v1.5` | avatar | `image_url`* `audio_url`* |  |  | `resolution` ["720p","1080p"] (def "1080p") |  | $0.16 per seconds |
| `bytedance/omnihuman/v2` | avatar | `image_url`* `audio_url`* |  |  |  |  | $0.105 per seconds |

### ByteDance DreamActor

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/bytedance/dreamactor/v2` | v2v | `image_url`* `video_url`* |  |  |  |  | $0.05 per seconds |

### OpenAI GPT Image

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/gpt-image-1/text-to-image` | t2i |  | `image_size` ["auto","1024x1024","1536x1024","1024x1536"] (def "auto") |  | `quality` ["auto","low","medium","high"] (def "auto") |  | Your request will cost different amounts based on the input and output. - You will be charged $0.002 per 1,000 input text tokens. One word is roughly … |
| `fal-ai/gpt-image-1/edit-image` | edit | `image_urls`* | `image_size` ["auto","1024x1024","1536x1024","1024x1536"] (def "auto") |  | `quality` ["auto","low","medium","high"] (def "auto") |  | Your request will cost different amounts based on the input and output. - You will be charged $0.002 per 1,000 input text tokens. One word is roughly … |
| `fal-ai/gpt-image-1-mini` | t2i |  | `image_size` ["auto","1024x1024","1536x1024","1024x1536"] (def "auto") |  | `quality` ["auto","low","medium","high"] (def "auto") |  | Your request will cost different amounts based on the input and output. - You will be charged $0.002 per 1,000 input text tokens. One word is roughly … |
| `fal-ai/gpt-image-1-mini/edit` | edit | `image_urls`* | `image_size` ["auto","1024x1024","1536x1024","1024x1536"] (def "auto") |  | `quality` ["auto","low","medium","high"] (def "auto") |  | Your request will cost different amounts based on the input and output. - You will be charged $0.002 per 1,000 input text tokens. One word is roughly … |
| `fal-ai/gpt-image-1.5` | t2i |  | `image_size` ["1024x1024","1536x1024","1024x1536"] (def "1024x1024") |  | `quality` ["low","medium","high"] (def "high") |  | Your request will cost different amounts based on the number of images, quality, and size. - You will be charged $0.005 per 1,000 input text tokens. O… |
| `fal-ai/gpt-image-1.5/edit` | edit | `image_urls`* | `image_size` ["auto","1024x1024","1536x1024","1024x1536"] (def "auto") |  | `quality` ["low","medium","high"] (def "high") |  | Your request will cost different amounts based on the number of images, quality, and size. - You will be charged $0.005 per 1,000 input text tokens. O… |
| `openai/gpt-image-2` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  | `quality` ["auto","low","medium","high"] (def "high") |  | Text tokens (per 1M): $5.00 input, $1.25 cached, $10.00 output. Image tokens (per 1M): $8.00 input, $2.00 cached, $30.00 output. Changing the quality … |
| `openai/gpt-image-2/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "auto") |  | `quality` ["auto","low","medium","high"] (def "high") |  | Text tokens (per 1M): $5.00 input, $1.25 cached, $10.00 output. Image tokens (per 1M): $8.00 input, $2.00 cached, $30.00 output. Changing the quality … |
| `openai/gpt-image-2.5/flare/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  | `quality` ["auto","low","medium","high","xhigh","max"] (def "high") |  | Text tokens (per 1M): $5.00 input, $1.25 cached, $10.00 output. Image tokens (per 1M): $8.00 input, $2.00 cached, $30.00 output. Changing the quality … |
| `openai/gpt-image-2.5/flare/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "auto") |  | `quality` ["auto","low","medium","high","xhigh","max"] (def "high") |  | Text tokens (per 1M): $5.00 input, $1.25 cached, $10.00 output. Image tokens (per 1M): $8.00 input, $2.00 cached, $30.00 output. Changing the quality … |
| `openai/gpt-image-2.5/sunburst/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  | `quality` ["auto","low","medium","high","xhigh","max"] (def "high") |  | Text tokens (per 1M): $5.00 input, $1.25 cached, $10.00 output. Image tokens (per 1M): $8.00 input, $2.00 cached, $30.00 output. Changing the quality … |
| `openai/gpt-image-2.5/sunburst/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "auto") |  | `quality` ["auto","low","medium","high","xhigh","max"] (def "high") |  | Text tokens (per 1M): $5.00 input, $1.25 cached, $10.00 output. Image tokens (per 1M): $8.00 input, $2.00 cached, $30.00 output. Changing the quality … |

### OpenAI Sora 2

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/sora-2/text-to-video` **[removed]** | t2v |  |  |  |  |  |  |
| `fal-ai/sora-2/text-to-video/pro` **[removed]** | t2v |  |  |  |  |  |  |
| `fal-ai/sora-2/image-to-video` **[removed]** | i2v |  |  |  |  |  |  |
| `fal-ai/sora-2/image-to-video/pro` **[removed]** | i2v |  |  |  |  |  |  |
| `fal-ai/sora-2/video-to-video/remix` **[removed]** | v2v |  |  |  |  |  |  |

> Status note (fal-ai/sora-2/text-to-video and siblings): fal catalog status = deprecated (since 2026-07-08); OpenAI retired the Sora 2 API / Videos API on 2026-09-24. fal no longer serves the schema (404). Do not build on it.

### Black Forest Labs FLUX (Kontext, 1.1, FLUX.2, FLUX 3)

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/flux-pro/kontext` | edit | `image_url`* | `aspect_ratio` ["21:9","16:9","4:3","3:2","1:1","2:3","3:4","9:16","9:21"] |  |  |  | $0.04 per images |
| `fal-ai/flux-pro/kontext/max` | edit | `image_url`* | `aspect_ratio` ["21:9","16:9","4:3","3:2","1:1","2:3","3:4","9:16","9:21"] |  |  |  | $0.08 per images |
| `fal-ai/flux-pro/kontext/text-to-image` | t2i |  | `aspect_ratio` ["21:9","16:9","4:3","3:2","1:1","2:3","3:4","9:16","9:21"] (def "1:1") |  |  |  | $0.04 per images |
| `fal-ai/flux-pro/kontext/max/text-to-image` | t2i |  | `aspect_ratio` ["21:9","16:9","4:3","3:2","1:1","2:3","3:4","9:16","9:21"] (def "1:1") |  |  |  | $0.08 per images |
| `fal-ai/flux-pro/kontext/multi` | edit | `image_urls`* | `aspect_ratio` ["21:9","16:9","4:3","3:2","1:1","2:3","3:4","9:16","9:21"] |  |  |  | $0.04 per images |
| `fal-ai/flux-pro/kontext/max/multi` | edit | `image_urls`* | `aspect_ratio` ["21:9","16:9","4:3","3:2","1:1","2:3","3:4","9:16","9:21"] |  |  |  | $0.08 per images |
| `fal-ai/flux-kontext/dev` | edit | `image_url`* |  |  |  |  | $0.025 per megapixels |
| `fal-ai/flux-pro/v1.1-ultra` | t2i | `image_url` | `aspect_ratio` preset|{width,height} (def "16:9") |  |  |  | $0.06 per images |
| `fal-ai/flux-pro/v1.1` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  |  |  | $0.04 per megapixels |
| `fal-ai/flux-2-pro` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  |  |  | Your request will cost $0.03 for the first megapixel of output, plus $0.015 per extra megapixel of input and output, rounded up to the nearest megapix… |
| `fal-ai/flux-2-pro/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "auto") |  |  |  | Your request will cost $0.03 for the first megapixel of output, plus $0.015 per extra megapixel of input and output, rounded up to the nearest megapix… |
| `fal-ai/flux-2-flex` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  |  |  | Your request will cost $0.05 per megapixel on both input and output side, rounded up to the nearest megapixel. For example, a 1024x1024 image will cos… |
| `fal-ai/flux-2-flex/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "auto") |  |  |  | Your request will cost $0.05 per megapixel on both input and output side, rounded up to the nearest megapixel. For example, a 1024x1024 image will cos… |
| `fal-ai/flux-2-max` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  |  |  | The first processed megapixel will cost $0.07. Each additional megapixel will cost 0.03 |
| `fal-ai/flux-2-max/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "auto") |  |  |  | The first processed megapixel will cost $0.07. Each additional megapixel will cost 0.03. Input images counted as processed megapixel. |
| `fal-ai/flux-2` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  |  |  | $0.012 per megapixels |
| `fal-ai/flux-2/edit` | edit | `image_urls`* | `image_size` preset|{width,height} |  |  |  | Requests cost $0.012 per megapixel of input and output. Input images will be resized to 1MP. For example, a 1024x1024 generation with 512*512 size ima… |
| `fal-ai/flux-2/klein/9b` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  |  |  | $0.006 per megapixels |
| `fal-ai/flux-2/klein/9b/edit` | edit | `image_urls`* | `image_size` preset|{width,height} |  |  |  | Requests cost $0.011 per megapixel of input and output. Input images will be resized to 1MP. For example, a 1024×1024 generation with a 512×512 input … |
| `blackforestlabs/flux-3/text-to-image` | t2i |  | `aspect_ratio` ["auto","21:9","2:1","16:9","3:2","7:5","4:3","5:4","1:1","4:5","3:4","5:7","2:3","9:16","1:2"] (def "auto") |  | `resolution` ["512sq","768sq","1k","2k","4k"] (def "1k") |  | Image pricing varies by resolution. A 1K (1 MP) image costs $0.048. |
| `blackforestlabs/flux-3/edit-image` | edit | `image_urls`* | `aspect_ratio` ["auto","21:9","2:1","16:9","3:2","7:5","4:3","5:4","1:1","4:5","3:4","5:7","2:3","9:16","1:2"] (def "auto") |  | `resolution` ["512sq","768sq","1k","2k","4k"] (def "1k") |  | Image pricing varies by resolution. A 1K (1 MP) image costs $0.048. |
| `blackforestlabs/flux-3/klein/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | Planned per-image pricing by output resolution: 768×768: $0.008, 1K: $0.009, 1.5K: $0.011, 2K: $0.014, and 4K: $0.036. The same schedule is planned fo… |
| `blackforestlabs/flux-3/klein/edit-image` | edit | `image_urls`* | `image_size` preset|{width,height} |  |  |  | Planned per-image pricing by output resolution: 768×768: $0.008, 1K: $0.009, 1.5K: $0.011, 2K: $0.014, and 4K: $0.036. The same schedule is planned fo… |
| `blackforestlabs/flux-3/text-to-video` | t2v |  | `aspect_ratio` ["auto","21:9","2:1","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto",5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20] (def "auto") | `resolution` ["720p","1080p","1440p","2160p"] (def "720p") | `generate_audio` (def true) | Your request will be charged at 0.17 $ per second of generated video at 720p, 0.29 $ per second at 1080p, 0.32 $ per second at 2K (1440p), and 0.47 $ … |
| `blackforestlabs/flux-3/image-to-video` | i2v | `image_url`* | `aspect_ratio` ["auto","21:9","2:1","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto",5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20] (def "auto") | `resolution` ["720p","1080p","1440p","2160p"] (def "720p") | `generate_audio` (def true) | Your request will be charged at 0.17 $ per second of generated video at 720p, 0.29 $ per second at 1080p, 0.32 $ per second at 2K (1440p), and 0.47 $ … |
| `blackforestlabs/flux-3/first-last-frame-to-video` | flf2v | `start_image_url`* `end_image_url`* | `aspect_ratio` ["auto","21:9","2:1","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` [5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20] (def 5) | `resolution` ["720p","1080p","1440p","2160p"] (def "720p") | `generate_audio` (def true) | Your request will be charged at 0.17 $ per second of generated video at 720p, and 0.29 $ per second at 1080p. |
| `blackforestlabs/flux-3/keyframes-to-video` | flf2v |  | `aspect_ratio` ["auto","21:9","2:1","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` [5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20] (def 5) | `resolution` ["720p","1080p","1440p","2160p"] (def "720p") | `generate_audio` (def true) | Your request will be charged at 0.17 $ per second of generated video at 720p, and 0.29 $ per second at 1080p. |
| `blackforestlabs/flux-3/edit-video` | v2v | `video_url`* |  |  |  |  | Your request will be charged at $0.03 per second of generated video (720p). |
| `blackforestlabs/flux-3/extend-video` | v2v | `video_url`* | `aspect_ratio` ["auto","21:9","2:1","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` ["auto",5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20] (def "auto") | `resolution` ["720p","1080p","1440p","2160p"] (def "720p") | `generate_audio` (def true) | Your request will be charged at 0.41 $ per second of generated video at 720p, and 0.53 $ per second at 1080p. |
| `blackforestlabs/flux-video-upscale` | upscale-video | `video_url`* |  |  |  |  | Billing is calculated per second of output video, by resolution and mode. In precise mode, 1080p costs $0.084 per second, 2K costs $0.15 per second, a… |

### Qwen Image

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/qwen-image` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  |  |  | $0.02 per megapixels |
| `fal-ai/qwen-image-2512` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  |  |  | 0.02 per megapixel (rounded up to the nearest megapixel) |
| `fal-ai/qwen-image-edit` | edit | `image_url`* | `image_size` preset|{width,height} |  |  |  | $0.03 per megapixels |
| `fal-ai/qwen-image-edit-plus` | edit | `image_urls`* | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.03 per megapixels |
| `fal-ai/qwen-image-edit-2509` | edit | `image_urls`* | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.03 per megapixels |
| `fal-ai/qwen-image-edit-2511` | edit | `image_urls`* | `image_size` preset|{width,height} |  |  |  | $0.03 per megapixels |
| `fal-ai/qwen-image-max/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.075 per images |
| `fal-ai/qwen-image-max/edit` | edit | `image_urls`* | `image_size` preset|{width,height} |  |  |  | $0.075 per images |
| `alibaba/qwen-image-3/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | Your request will cost $0.04 per generated image at 1K resolution, and $0.075 per generated image at 2K resolution. |
| `alibaba/qwen-image-3/edit` | edit | `image_urls`* | `image_size` preset|{width,height} |  |  |  | Your request will cost $0.04 per generated image at 1K resolution, and $0.075 per generated image at 2K resolution. |

### Ideogram

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/ideogram/v3` | t2i | `image_urls` | `image_size` preset|{width,height} (def "square_hd") |  |  |  | Your request will cost $0.03 with TURBO, $0.06 with BALANCED, and $0.09 with QUALITY. |
| `fal-ai/ideogram/v3/edit` | edit | `image_url`* `image_urls` |  |  |  |  | Your request will cost $0.03 with TURBO, $0.06 with BALANCED, and $0.09 with QUALITY. |
| `fal-ai/ideogram/v3/remix` | i2i | `image_url`* `image_urls` | `image_size` preset|{width,height} (def "square_hd") |  |  |  | Your request will cost $0.03 with TURBO, $0.06 with BALANCED, and $0.09 with QUALITY. |
| `fal-ai/ideogram/v3/reframe` | i2i | `image_url`* `image_urls` | `image_size` preset|{width,height} |  |  |  | Your request will cost $0.03 with TURBO, $0.06 with BALANCED, and $0.09 with QUALITY. |
| `fal-ai/ideogram/v3/replace-background` | edit | `image_url`* `image_urls` |  |  |  |  | Your request will cost $0.03 with TURBO, $0.06 with BALANCED, and $0.09 with QUALITY. |
| `fal-ai/ideogram/character` | edit | `image_urls` | `image_size` preset|{width,height} (def "square_hd") |  |  |  | Your request will cost $0.1 with TURBO, $0.15 with BALANCED, and $0.20 with QUALITY. |
| `ideogram/v4` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | Your request will cost $0.0075 per megapixel in TURBO mode, $0.015 per megapixel in BALANCED mode, or $0.025 per megapixel in QUALITY mode. For exampl… |
| `ideogram/v4.5` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  | `quality` ["low","medium","high"] (def "medium") |  | Your request will cost $0.03 per image with Low, $0.06 with Medium, and $0.22 with High quality. The image size does not change the price. |
| `ideogram/v4.5/edit` | edit | `image_url`* `reference_image_urls` | `image_size` preset|{width,height} (def "auto") |  | `quality` ["very_low","low","medium","high"] (def "medium") |  | Your request will cost $0.008 per image with Very Low, $0.03 with Low, $0.06 with Medium, and $0.22 with High quality. The image size does not change … |

### Recraft

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/recraft/v3/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | Your request will cost $0.04 per image (or $0.08 if you are using a vector style).  |
| `fal-ai/recraft/v3/image-to-image` | i2i | `image_url`* |  |  |  |  | Your request will cost $0.04 per image (or $0.08 if you are using a vector style).  |
| `fal-ai/recraft/v4/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.04 per images |
| `fal-ai/recraft/v4/pro/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.25 per images |
| `fal-ai/recraft/v4.1/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.035 per images |
| `fal-ai/recraft/v4.1/pro/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.21 per images |
| `fal-ai/recraft/upscale/crisp` | upscale-image | `image_url`* |  |  |  |  | $0.004 per images |

### Alibaba Wan (image + video)

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/wan-25-preview/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square") |  |  |  | Your request will cost $0.05 per image. |
| `fal-ai/wan-25-preview/image-to-image` | edit | `image_urls`* | `image_size` preset|{width,height} (def "square") |  |  |  | Your request will cost $0.05 per image. |
| `wan/v2.6/text-to-image` | t2i | `image_url` | `image_size` preset|{width,height} |  |  |  | $0.03 per images |
| `wan/v2.6/image-to-image` | edit | `image_urls`* | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.03 per images |
| `fal-ai/wan/v2.7/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.03 per images |
| `fal-ai/wan/v2.7/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.03 per images |
| `fal-ai/wan/v2.7/pro/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.075 per images |
| `fal-ai/wan/v2.7/pro/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.075 per images |
| `fal-ai/wan/v2.2-a14b/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `num_frames` integer 17..161 (def 81) | `resolution` ["480p","580p","720p"] (def "720p") |  | Your request will cost $0.08 per video second for 720p, $0.06 per video second for 580p, $0.04 per video second for 480p. Video seconds are calculated… |
| `fal-ai/wan/v2.2-a14b/image-to-video` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["auto","16:9","9:16","1:1"] (def "auto") | `num_frames` integer 17..161 (def 81) | `resolution` ["480p","580p","720p"] (def "720p") |  | Your request will cost $0.08 per video second for 720p, $0.06 per video second for 580p, $0.04 per video second for 480p. Video seconds are calculated… |
| `fal-ai/wan/v2.2-a14b/video-to-video` | v2v | `video_url`* | `aspect_ratio` ["auto","16:9","9:16","1:1"] (def "auto") | `num_frames` integer 17..161 (def 81) | `resolution` ["480p","580p","720p"] (def "720p") |  | Your request will cost $0.08 per video second for 720p, $0.06 per video second for 580p, $0.04 per video second for 480p. Video seconds are calculated… |
| `fal-ai/wan/v2.2-14b/speech-to-video` | avatar | `image_url`* `audio_url`* |  | `num_frames` integer 40..120 (def 80) | `resolution` ["480p","580p","720p"] (def "480p") |  | Your request will cost $0.20 per video second for 720p, $0.15 per video second for 580p, $0.10 per video second for 480p. Video seconds are calculated… |
| `fal-ai/wan-25-preview/text-to-video` | t2v | `audio_url` | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["5","10"] (def "5") | `resolution` ["480p","720p","1080p"] (def "1080p") |  | Your request will cost $0.05 per second for 480p, $0.10 per second for 720p, $0.15 per second for 1080p. |
| `fal-ai/wan-25-preview/image-to-video` | i2v | `image_url`* `audio_url` |  | `duration` ["5","10"] (def "5") | `resolution` ["480p","720p","1080p"] (def "1080p") |  | Your request will cost $0.05 per second for 480p, $0.10 per second for 720p, $0.15 per second for 1080p. |
| `wan/v2.6/text-to-video` | t2v | `audio_url` | `aspect_ratio` ["16:9","9:16","1:1","4:3","3:4"] (def "16:9") | `duration` ["5","10","15"] (def "5") | `resolution` ["720p","1080p"] (def "1080p") |  | Your request will cost $0.10 per second for 720p, $0.15 per second for 1080p. |
| `wan/v2.6/image-to-video` | i2v | `image_url`* `audio_url` |  | `duration` ["5","10","15"] (def "5") | `resolution` ["720p","1080p"] (def "1080p") |  | Your request will cost $0.10 per second for 720p, $0.15 per second for 1080p. |
| `wan/v2.6/image-to-video/flash` | i2v | `image_url`* `audio_url` |  | `duration` ["5","10","15"] (def "5") | `resolution` ["720p","1080p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.05 per second for 720p, $0.075 per second for 1080p. |
| `wan/v2.6/reference-to-video` | ref2v | `video_urls`* | `aspect_ratio` ["16:9","9:16","1:1","4:3","3:4"] (def "16:9") | `duration` ["5","10"] (def "5") | `resolution` ["720p","1080p"] (def "1080p") |  | Your request will cost $0.10 per second for 720p, $0.15 per second for 1080p. |
| `wan/v2.6/reference-to-video/flash` | ref2v | `image_urls` `video_urls` | `aspect_ratio` ["16:9","9:16","1:1","4:3","3:4"] (def "16:9") | `duration` ["5","10"] (def "5") | `resolution` ["720p","1080p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.10 per second for 720p, $0.15 per second for 1080p. |
| `fal-ai/wan/v2.7/text-to-video` | t2v | `audio_url` | `aspect_ratio` ["16:9","9:16","1:1","4:3","3:4"] (def "16:9") | `duration` [2,3,4,5,6,7,8,9,10,11,12,13,14,15] (def 5) | `resolution` ["720p","1080p"] (def "1080p") |  | Your request will cost $0.1 per second for 720p resolution. For 1080p your request will cost $0.15 per second. |
| `fal-ai/wan/v2.7/image-to-video` | i2v | `image_url` `end_image_url` `video_url` `audio_url` |  | `duration` [2,3,4,5,6,7,8,9,10,11,12,13,14,15] (def 5) | `resolution` ["720p","1080p"] (def "1080p") |  | Your request will cost $0.1 per second for 720p resolution. For 1080p your request will cost $0.15 per second. |
| `fal-ai/wan/v2.7/reference-to-video` | ref2v | `reference_image_urls` `reference_video_urls` | `aspect_ratio` ["16:9","9:16","1:1","4:3","3:4"] (def "16:9") | `duration` [2,3,4,5,6,7,8,9,10] (def 5) | `resolution` ["720p","1080p"] (def "1080p") |  | Your request will cost $0.10 per second. When video inputs are provided, billing duration is calculated as input video duration + output video duratio… |
| `fal-ai/wan/v2.7/edit-video` | v2v | `video_url`* | `aspect_ratio` ["16:9","9:16","1:1","4:3","3:4"] | `duration` [0,2,3,4,5,6,7,8,9,10] (def 0) | `resolution` ["720p","1080p"] (def "1080p") |  | Your request will cost $0.1 for 720p and $0.15 for 1080p per second of output video. |
| `alibaba/wan-3.0/text-to-video` | t2v |  | `aspect_ratio` ["adaptive","16:9","4:3","1:1","3:4","9:16"] (def "adaptive") | `duration` integer 2..30 (def 5) | `resolution` ["480p","720p","1080p"] (def "1080p") | `audio` (def true) | For every second of video you generate, you will be charged $0.05 480p, $0.10 720p, or $0.20 1080p. For example, a 5s video at 720p will cost $0.50. P… |
| `alibaba/wan-3.0/image-to-video` | i2v | `start_image_url`* `end_image_url` | `aspect_ratio` ["adaptive","16:9","4:3","1:1","3:4","9:16"] (def "adaptive") | `duration` integer 2..30 (def 5) | `resolution` ["480p","720p","1080p"] (def "1080p") | `audio` (def true) | For every second of video you generate, you will be charged $0.05 480p, $0.10 720p, or $0.20 1080p. For example, a 5s video at 720p will cost $0.50. P… |
| `alibaba/wan-3.0/reference-to-video` | ref2v | `reference_image_urls` `reference_video_urls` `reference_audio_urls` | `aspect_ratio` ["adaptive","16:9","4:3","1:1","3:4","9:16"] (def "adaptive") | `duration` integer 2..30 (def 5) | `resolution` ["480p","720p","1080p"] (def "1080p") | `audio` (def true) | For every second of video you generate, you will be charged $0.05 480p, $0.10 720p, or $0.20 1080p. For example, a 5s video at 720p will cost $0.50. P… |
| `alibaba/wan-3.0-prime/text-to-video` | t2v |  | `aspect_ratio` ["adaptive","16:9","4:3","1:1","3:4","9:16"] (def "adaptive") | `duration` integer 2..30 (def 5) | `resolution` ["480p","720p","1080p"] (def "1080p") | `audio` (def true) | For every second of video you generate, you will be charged $0.068 at 480p, $0.14 at 720p, or $0.28 at 1080p. For example, a 5s video at 720p will cos… |
| `alibaba/wan-3.0-prime/image-to-video` | i2v | `start_image_url`* `end_image_url` | `aspect_ratio` ["adaptive","16:9","4:3","1:1","3:4","9:16"] (def "adaptive") | `duration` integer 2..30 (def 5) | `resolution` ["480p","720p","1080p"] (def "1080p") | `audio` (def true) | For every second of video you generate, you will be charged $0.068 at 480p, $0.14 at 720p, or $0.28 at 1080p. For example, a 5s video at 720p will cos… |
| `alibaba/wan-3.0-prime/reference-to-video` | ref2v | `reference_image_urls` `reference_video_urls` `reference_audio_urls` | `aspect_ratio` ["adaptive","16:9","4:3","1:1","3:4","9:16"] (def "adaptive") | `duration` integer 2..30 (def 5) | `resolution` ["480p","720p","1080p"] (def "1080p") | `audio` (def true) | For every second of video you generate, you will be charged $0.068 at 480p, $0.14 at 720p, or $0.28 at 1080p. For example, a 5s video at 720p will cos… |

### Tencent Hunyuan Image 3

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/hunyuan-image/v3/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "square_hd") |  |  |  | $0.1 per megapixels |
| `fal-ai/hunyuan-image/v3/instruct/text-to-image` | t2i |  | `image_size` preset|{width,height} (def "auto") |  |  |  | $0.09 per megapixels |
| `fal-ai/hunyuan-image/v3/instruct/edit` | edit | `image_urls`* | `image_size` preset|{width,height} (def "auto") |  |  |  | $0.09 per megapixels |

### Z-Image

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/z-image/turbo` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  |  |  | $0.005 per megapixels |
| `fal-ai/z-image/turbo/image-to-image` | i2i | `image_url`* | `image_size` preset|{width,height} (def "auto") |  |  |  | $0.005 per megapixels |
| `fal-ai/z-image/base` | t2i |  | `image_size` preset|{width,height} (def "landscape_4_3") |  |  |  | $0.01 per megapixels |

### Reve

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/reve/text-to-image` **[removed]** | t2i |  |  |  |  |  |  |
| `fal-ai/reve/edit` **[removed]** | edit |  |  |  |  |  |  |
| `fal-ai/reve/remix` **[removed]** | edit |  |  |  |  |  |  |

> Status note (fal-ai/reve/text-to-image and siblings): No longer present in the fal catalog (schema and llms.txt 404). Use Reve native API (api.reve.com) instead.

### Kling (Kuaishou)

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/kling-video/v2.1/standard/image-to-video` **[deprecated]** | i2v | `image_url`* |  | `duration` ["5","10"] (def "5") |  |  | For 5s video your request will cost $0.28. For every additional second you will be charged $0.056. |
| `fal-ai/kling-video/v2.1/pro/image-to-video` **[deprecated]** | i2v | `image_url`* `tail_image_url` |  | `duration` ["5","10"] (def "5") |  |  | For 5s video your request will cost $0.49. For every additional second you will be charged $0.098. |
| `fal-ai/kling-video/v2.1/master/image-to-video` **[deprecated]** | i2v | `image_url`* |  | `duration` ["5","10"] (def "5") |  |  | For 5s video your request will cost $1.40. For every additional second you will be charged $0.28. |
| `fal-ai/kling-video/v2.1/master/text-to-video` **[deprecated]** | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["5","10"] (def "5") |  |  | For 5s video your request will cost $1.40. For every aditional second you will be charged $0.28. |
| `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["5","10"] (def "5") |  |  | For 5s video your request will cost $0.35. For every aditional second you will be charged $0.07. |
| `fal-ai/kling-video/v2.5-turbo/pro/image-to-video` | i2v | `image_url`* `tail_image_url` |  | `duration` ["5","10"] (def "5") |  |  | For 5s video your request will cost $0.35. For every additional second you will be charged $0.07. |
| `fal-ai/kling-video/v2.5-turbo/standard/image-to-video` | i2v | `image_url`* |  | `duration` ["5","10"] (def "5") |  |  | For 5s video your request will cost $0.21. For every additional second you will be charged $0.042. |
| `fal-ai/kling-video/v2.6/pro/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["5","10"] (def "5") |  | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.07 (audio off) or $0.14 (audio on). For example, a 5s video with audio on will cost $0… |
| `fal-ai/kling-video/v2.6/pro/image-to-video` | i2v | `start_image_url`* `end_image_url` |  | `duration` ["5","10"] (def "5") |  | `generate_audio` (def true) | Videos generated without audio cost $0.07 per second. Videos with native audio cost $0.14 per second, and videos with native audio and voice control c… |
| `fal-ai/kling-video/v2.6/pro/motion-control` | v2v | `image_url`* `video_url`* |  |  |  |  | $0.112 per seconds |
| `fal-ai/kling-video/v2.6/standard/motion-control` | v2v | `image_url`* `video_url`* |  |  |  |  | $0.07 per seconds |
| `fal-ai/kling-video/o1/image-to-video` | i2v | `start_image_url`* `end_image_url` |  | `duration` ["3","4","5","6","7","8","9","10"] (def "5") |  |  | $0.112 per seconds |
| `fal-ai/kling-video/o1/reference-to-video` | ref2v | `image_urls` | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10"] (def "5") |  |  | $0.112 per seconds |
| `fal-ai/kling-video/o1/video-to-video/edit` | v2v | `image_urls` `video_url`* |  |  |  |  | $0.168 per seconds |
| `fal-ai/kling-video/o1/video-to-video/reference` | v2v | `image_urls` `video_url`* | `aspect_ratio` ["auto","16:9","9:16","1:1"] (def "auto") | `duration` ["3","4","5","6","7","8","9","10"] (def "5") |  |  | $0.168 per seconds |
| `fal-ai/kling-video/o1/standard/image-to-video` | i2v | `start_image_url`* `end_image_url` |  | `duration` ["3","4","5","6","7","8","9","10"] (def "5") |  |  | $0.084 per seconds |
| `fal-ai/kling-video/o1/standard/reference-to-video` | ref2v | `image_urls` | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10"] (def "5") |  |  | $0.084 per seconds |
| `fal-ai/kling-video/o1/standard/video-to-video/edit` | v2v | `image_urls` `video_url`* |  |  |  |  | $0.126 per seconds |
| `fal-ai/kling-video/o1/standard/video-to-video/reference` | v2v | `image_urls` `video_url`* | `aspect_ratio` ["auto","16:9","9:16","1:1"] (def "auto") | `duration` ["3","4","5","6","7","8","9","10"] (def "5") |  |  | $0.126 per seconds |
| `fal-ai/kling-video/v3/standard/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.084 (audio off) or $0.126 (audio on), if voice control is used while generating audio … |
| `fal-ai/kling-video/v3/standard/image-to-video` | i2v | `start_image_url`* `end_image_url` |  | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.084 (audio off) or $0.126 (audio on), if voice control is used while generating audio … |
| `fal-ai/kling-video/v3/pro/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.112 (audio off) or $0.168 (audio on), if voice control is used while generating audio … |
| `fal-ai/kling-video/v3/pro/image-to-video` | i2v | `start_image_url`* `end_image_url` |  | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.112 (audio off) or $0.168 (audio on), if voice control is used while generating audio … |
| `fal-ai/kling-video/v3/4k/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.42 regardless of whether audio is on or off. For example, a 5s video will cost $2.10. |
| `fal-ai/kling-video/v3/4k/image-to-video` | i2v | `start_image_url`* `end_image_url` |  | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def true) | For every second of video you generated, you will be charged $0.42 regardless of whether audio is on or off. For example, a 5s video will cost $2.10. |
| `fal-ai/kling-video/v3/turbo/pro/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  |  | For every second of video you generate, you will be charged $0.14 . For example, a 5s video will cost $0.70. |
| `fal-ai/kling-video/v3/turbo/pro/image-to-video` | i2v | `image_url`* |  | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  |  | For every second of video you generate, you will be charged $0.14. For example, a 5s video will cost $0.70. |
| `fal-ai/kling-video/v3/turbo/standard/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  |  | For every second of video you generate, you will be charged $0.112 . For example, a 5s video will cost $0.56. |
| `fal-ai/kling-video/v3/turbo/standard/image-to-video` | i2v | `image_url`* |  | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  |  | For every second of video you generate, you will be charged $0.112. For example, a 5s video will cost $0.56 |
| `fal-ai/kling-video/v3/pro/motion-control` | v2v | `image_url`* `video_url`* |  |  |  |  | $0.168 per seconds |
| `fal-ai/kling-video/v3/standard/motion-control` | v2v | `image_url`* `video_url`* |  |  |  |  | $0.126 per seconds |
| `fal-ai/kling-video/o3/standard/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def false) | For every second of video you generated, you will be charged $0.084 (audio off) or $0.112 (audio on). For example, a 5s video with audio on will cost … |
| `fal-ai/kling-video/o3/standard/image-to-video` | i2v | `image_url`* `end_image_url` |  | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def false) | For every second of video you generated, you will be charged $0.084 (audio off) or $0.112 (audio on). For example, a 5s video with audio on will cost … |
| `fal-ai/kling-video/o3/standard/reference-to-video` | ref2v | `start_image_url` `image_urls` `end_image_url` | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def false) | For every second of video you generated, you will be charged $0.084 (audio off) or $0.112 (audio on). For example, a 5s video with audio on will cost … |
| `fal-ai/kling-video/o3/standard/video-to-video/edit` | v2v | `image_urls` `video_url`* |  |  |  |  | For every second of video you generated, you will be charged $0.126. For example, a 5s video with will cost $0.63 |
| `fal-ai/kling-video/o3/standard/video-to-video/reference` | v2v | `image_urls` `video_url`* | `aspect_ratio` ["auto","16:9","9:16","1:1"] (def "auto") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] |  |  | For every second of video you generated, you will be charged $0.126. For example, a 5s video will cost $0.63. |
| `fal-ai/kling-video/o3/pro/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def false) | For every second of video you generated, you will be charged $0.112 (audio off) or $0.14 (audio on). For example, a 5s video with audio on will cost $… |
| `fal-ai/kling-video/o3/pro/image-to-video` | i2v | `image_url`* `end_image_url` |  | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def false) | For every second of video you generated, you will be charged $0.112 (audio off) or $0.14 (audio on). For example, a 5s video with audio on will cost $… |
| `fal-ai/kling-video/o3/pro/reference-to-video` | ref2v | `start_image_url` `image_urls` `end_image_url` | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def false) | For every second of video you generated, you will be charged $0.112 (audio off) or $0.14 (audio on). For example, a 5s video with audio on will cost $… |
| `fal-ai/kling-video/o3/pro/video-to-video/edit` | v2v | `image_urls` `video_url`* |  |  |  |  | For every second of video you generated you will be charged $0.168 For example, a 5s video will cost $0.84. |
| `fal-ai/kling-video/o3/pro/video-to-video/reference` | v2v | `image_urls` `video_url`* | `aspect_ratio` ["auto","16:9","9:16","1:1"] (def "auto") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] |  |  | For every second of video you generated you will be charged $0.168 For example, a 5s video will cost $0.84. |
| `fal-ai/kling-video/o3/4k/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def false) | For every second of video you generated, you will be charged $0.42 regardless of whether audio is on or off. For example, a 5s video will cost $2.10. |
| `fal-ai/kling-video/o3/4k/image-to-video` | i2v | `image_url`* `end_image_url` |  | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def false) | For every second of video you generated, you will be charged $0.42 regardless of whether audio is on or off. For example, a 5s video will cost $2.10. |
| `fal-ai/kling-video/o3/4k/reference-to-video` | ref2v | `start_image_url` `image_urls` `end_image_url` | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` ["3","4","5","6","7","8","9","10","11","12","13","14","15"] (def "5") |  | `generate_audio` (def false) | For every second of video you generated, you will be charged $0.42 regardless of whether audio is on or off. For example, a 5s video will cost $2.10. |
| `fal-ai/kling-image/o1` | edit | `image_urls`* | `aspect_ratio` ["auto","16:9","9:16","1:1","4:3","3:4","3:2","2:3","21:9"] (def "auto") |  | `resolution` ["1K","2K"] (def "1K") |  | $0.028 per images |
| `fal-ai/kling-image/o3/text-to-image` | t2i |  | `aspect_ratio` ["16:9","9:16","1:1","4:3","3:4","3:2","2:3","21:9"] (def "16:9") |  | `resolution` ["1K","2K","4K"] (def "1K") |  | Your request will cost $0.028 per image for 1K/2K, price will be double for 4K |
| `fal-ai/kling-image/o3/image-to-image` | edit | `image_urls`* | `aspect_ratio` ["16:9","9:16","1:1","4:3","3:4","3:2","2:3","21:9","auto"] (def "auto") |  | `resolution` ["1K","2K","4K"] (def "1K") |  | Your request will cost $0.028 per image for 1K/2K, price will be double for 4K |
| `fal-ai/kling-image/v3/text-to-image` | t2i |  | `aspect_ratio` ["16:9","9:16","1:1","4:3","3:4","3:2","2:3","21:9"] (def "16:9") |  | `resolution` ["1K","2K"] (def "1K") |  | $0.028 per images |
| `fal-ai/kling-image/v3/image-to-image` | edit | `image_url`* | `aspect_ratio` ["16:9","9:16","1:1","4:3","3:4","3:2","2:3","21:9"] (def "16:9") |  | `resolution` ["1K","2K"] (def "1K") |  | $0.028 per images |
| `fal-ai/kling-video/v1/standard/ai-avatar` | avatar | `image_url`* `audio_url`* |  |  |  |  | $0.0562 per seconds |
| `fal-ai/kling-video/v1/pro/ai-avatar` | avatar | `image_url`* `audio_url`* |  |  |  |  | $0.115 per seconds |
| `fal-ai/kling-video/ai-avatar/v2/standard` | avatar | `image_url`* `audio_url`* |  |  |  |  | $0.0562 per seconds |
| `fal-ai/kling-video/ai-avatar/v2/pro` | avatar | `image_url`* `audio_url`* |  |  |  |  | $0.115 per seconds |
| `fal-ai/kling-video/lipsync/audio-to-video` | lipsync | `video_url`* `audio_url`* |  |  |  |  | Your request will be priced $0.014 per input video seconds, rolling up to closest 5 second increment. For example, if your video's duration is 3 secon… |
| `fal-ai/kling-video/lipsync/text-to-video` | lipsync | `video_url`* |  |  |  |  | Your request will be priced $0.014 per input video seconds, rolling up to closest 5 second increment. For example, if your video's duration is 3 secon… |
| `fal-ai/kling-video/video-to-audio` | v2a | `video_url`* |  |  |  |  | Your video request will cost $0.035 per video. |
| `fal-ai/kling-video/v1/tts` | tts |  |  |  |  |  | $0.007 per generations |

> Status note (fal-ai/kling-video/v2.1/standard/image-to-video and siblings): fal catalog status = deprecated (still callable at time of check, may be rerouted).

### MiniMax (Hailuo, H3, Speech, Music)

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/minimax/hailuo-02/standard/text-to-video` | t2v |  |  | `duration` ["6","10"] (def "6") |  |  | For each second of video generated, it will cost $0.045/sec. A single 6 second video will cost $0.27/video. |
| `fal-ai/minimax/hailuo-02/standard/image-to-video` | i2v | `image_url`* `end_image_url` |  | `duration` ["6","10"] (def "6") | `resolution` ["512P","768P"] (def "768P") |  | For each second of video generated at 768P, it will cost $0.045/sec. For each second of video generated at 512P, it will cost roughly $0.017/sec. A si… |
| `fal-ai/minimax/hailuo-02/pro/text-to-video` | t2v |  |  |  |  |  | For each second of video generated, it will cost $0.08/sec. A single 6 second video will cost $0.48/video. |
| `fal-ai/minimax/hailuo-02/pro/image-to-video` | i2v | `image_url`* `end_image_url` |  |  |  |  | For each second of video generated, it will cost $0.08/sec. A single 6 second video will cost $0.48/video. |
| `fal-ai/minimax/hailuo-02-fast/image-to-video` | i2v | `image_url`* |  | `duration` ["6","10"] (def "6") |  |  | For each second of video generated at 512P, it will cost roughly $0.017/sec |
| `fal-ai/minimax/hailuo-2.3/standard/text-to-video` | t2v |  |  | `duration` ["6","10"] (def "6") |  |  | Your request will cost $0.28 per 6 second video generation, and a $0.56 per 10 second video generation. |
| `fal-ai/minimax/hailuo-2.3/standard/image-to-video` | i2v | `image_url`* |  | `duration` ["6","10"] (def "6") |  |  | Your request will cost $0.28 per 6 second video generation, and a $0.56 per 10 second video generation. |
| `fal-ai/minimax/hailuo-2.3/pro/text-to-video` | t2v |  |  |  |  |  | Your request will cost $0.49 per video generation. |
| `fal-ai/minimax/hailuo-2.3/pro/image-to-video` | i2v | `image_url`* |  |  |  |  | Your request will cost $0.49 per video generation. |
| `fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video` | i2v | `image_url`* |  | `duration` ["6","10"] (def "6") |  |  | Your request will cost $0.19 per 6 second video generation, and a $0.32 per 10 second video generation. |
| `fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video` | i2v | `image_url`* |  |  |  |  | $0.33 per videos |
| `minimax/h3/text-to-video` | t2v |  | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16"] (def "16:9") | `duration` integer 5..15 (def 5) | `resolution` ["480P","768P","2K","4K"] (def "2K") |  | Video costs $0.05 per second at 480p, $0.06 per second at 768p, $0.13 per second at 2K and $0.16 per second at 4K. |
| `minimax/h3/image-to-video` | i2v | `image_url` `end_image_url` |  | `duration` integer 5..15 (def 5) | `resolution` ["480P","768P","2K","4K"] (def "2K") |  | Video costs $0.05 per second at 480p, $0.06 per second at 768p, $0.13 per second at 2K and $0.16 per second at 4K. |
| `minimax/h3/reference-to-video` | ref2v | `reference_image_urls` `reference_video_urls` `reference_audio_urls` | `aspect_ratio` ["adaptive","21:9","16:9","4:3","1:1","3:4","9:16"] (def "adaptive") | `duration` integer 5..15 (def 5) | `resolution` ["480P","768P","2K","4K"] (def "2K") |  | Video costs $0.05 per second at 480p, $0.06 per second at 768p, $0.13 per second at 2K and $0.16 per second at 4K; the first 5 reference images are fr… |
| `minimax/h3-max/text-to-video` | t2v |  | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16"] (def "16:9") | `duration` number 0.92..15 (def 5) | `resolution` ["480P","768P","1080P"] (def "768P") |  | Video costs $0.0325 per second at 480p, $0.052 per second at 768p, and $0.104 per second at 1080p. Note: these are promotional rates, 35% off for a li… |
| `minimax/h3-max/image-to-video` | i2v | `image_url` `end_image_url` |  | `duration` number 0.92..15 (def 5) | `resolution` ["480P","768P","1080P"] (def "768P") |  | Video costs $0.0325 per second at 480p, $0.052 per second at 768p, and $0.104 per second at 1080p. Note: these are promotional rates, 35% off for a li… |
| `minimax/h3-max/reference-to-video` | ref2v | `image_url` `reference_image_urls` `end_image_url` `reference_video_urls` `reference_audio_urls` | `aspect_ratio` ["adaptive","21:9","16:9","4:3","1:1","3:4","9:16"] (def "adaptive") | `duration` number 0.92..15 (def 5) | `resolution` ["480P","768P","1080P"] (def "768P") |  | Billing uses the requested output duration at $0.05 per second for 480p, $0.08 for 768p, and $0.16 for 1080p. Each request includes 4,096 reference to… |
| `minimax/h3-max/extend-video` | v2v | `video_url`* `reference_audio_urls` | `aspect_ratio` ["auto","21:9","16:9","4:3","1:1","3:4","9:16"] (def "auto") | `duration` number 0.71..15 (def 5) | `resolution` ["480P","768P","1080P","2K"] (def "768P") |  | Billing is calculated per second of generated video, plus reference input charges beyond the included allowance. Video costs $0.05 per second at 480p,… |
| `minimax/h3-max-turbo/text-to-video` | t2v |  | `aspect_ratio` ["21:9","16:9","4:3","1:1","3:4","9:16"] (def "16:9") | `duration` number 0.92..15 (def 5) | `resolution` ["480P","768P","1080P"] (def "768P") |  | Video costs $0.01625 per second at 480p, $0.026 per second at 768p, and $0.052 per second at 1080p. Note: these are promotional rates, 35% off for a l… |
| `minimax/h3-max-turbo/image-to-video` | i2v | `image_url` `end_image_url` |  | `duration` number 0.92..15 (def 5) | `resolution` ["480P","768P","1080P"] (def "768P") |  | Video costs $0.01625 per second at 480p, $0.026 per second at 768p, and $0.052 per second at 1080p. Note: these are promotional rates, 35% off for a l… |
| `minimax/h3-max/lip-sync/image-to-video` | avatar | `image_url`* `audio_url`* |  |  | `resolution` ["480P","768P","1080P","2K"] (def "768P") |  | Billing is calculated per second of generated video. Video costs $0.05 per second at 480p, $0.08 per second at 768p, $0.16 per second at 1080p, and $0… |
| `fal-ai/minimax-music/v2.6` | music |  |  |  |  |  | $0.15 per audios |
| `minimax/music-3` | music |  |  | `duration` number 1..300 (def 60) |  |  | $0.002 per seconds |
| `fal-ai/minimax/speech-2.8-hd` | tts |  |  |  |  |  | $0.1 per 1000 characters |
| `fal-ai/minimax/speech-2.8-turbo` | tts |  |  |  |  |  | $0.06 per 1000 characters |

### Luma Ray

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/luma-dream-machine/ray-2` **[unlisted]** | t2v |  | `aspect_ratio` ["16:9","9:16","4:3","3:4","21:9","9:21"] (def "16:9") | `duration` ["5s","9s"] (def "5s") | `resolution` ["540p","720p","1080p"] (def "540p") |  | $0.5 per 5 seconds |
| `fal-ai/luma-dream-machine/ray-2/image-to-video` **[unlisted]** | i2v | `image_url` `end_image_url` | `aspect_ratio` ["16:9","9:16","4:3","3:4","21:9","9:21"] (def "16:9") | `duration` ["5s","9s"] (def "5s") | `resolution` ["540p","720p","1080p"] (def "540p") |  | $0.5 per 5 seconds |
| `fal-ai/luma-dream-machine/ray-2-flash` **[unlisted]** | t2v |  | `aspect_ratio` ["16:9","9:16","4:3","3:4","21:9","9:21"] (def "16:9") | `duration` ["5s","9s"] (def "5s") | `resolution` ["540p","720p","1080p"] (def "540p") |  | $0.2 per 5 seconds |
| `fal-ai/luma-dream-machine/ray-2-flash/image-to-video` **[unlisted]** | i2v | `image_url` `end_image_url` | `aspect_ratio` ["16:9","9:16","4:3","3:4","21:9","9:21"] (def "16:9") | `duration` ["5s","9s"] (def "5s") | `resolution` ["540p","720p","1080p"] (def "540p") |  | $0.2 per 5 seconds |
| `fal-ai/luma-dream-machine/ray-2/modify` **[unlisted]** | v2v | `image_url` `video_url`* |  |  |  |  | $0.35 per seconds |
| `luma/agent/ray/v3.2/text-to-video` | t2v |  | `aspect_ratio` ["3:4","4:3","1:1","9:16","16:9","21:9"] (def "16:9") | `duration` ["5s","10s"] (def "5s") | `resolution` ["540p","720p","1080p"] (def "540p") |  | For 5s video your request will cost $0.50 for 540p, $1 for 720p and $2 for 1080p. For 10s, $1 at 540p, $2 at 720p and $4 at 1080p.  |
| `luma/agent/ray/v3.2/image-to-video` | i2v | `image_url` `end_image_url` | `aspect_ratio` ["3:4","4:3","1:1","9:16","16:9","21:9"] (def "16:9") | `duration` ["5s","10s"] (def "5s") | `resolution` ["540p","720p","1080p"] (def "540p") |  | For 5s video your request will cost $0.15 for 540p, $0.30 for 720p and $1.20 for 1080p. 10s is not available for image-to-video (start-frame requireme… |
| `luma/agent/ray/v3.2/video-to-video` | v2v | `start_image_url` `video_url`* |  | `duration` ["5s","10s"] (def "5s") | `resolution` ["540p","720p","1080p"] (def "540p") |  | For 5s video your request will cost $0.72 for 540p, $1.08 for 720p and $2.16 for 1080p. For 10s, $1.44 at 540p, $2.16 at 720p and $4.32 at 1080p. HDR … |
| `luma/agent/ray/v3.2/reframe` | v2v | `video_url`* | `aspect_ratio` ["3:4","4:3","1:1","9:16","16:9","21:9"] | `duration` ["5s","10s"] | `resolution` ["540p","720p","1080p"] (def "540p") |  | Reframe is billed per started source second: $0.06/s at 540p, $0.12/s at 720p and $0.36/s at 1080p. A 5s source will cost $0.30 for 540p, $0.60 for 72… |

> Status note (fal-ai/luma-dream-machine/ray-2 and siblings): fal shows "This endpoint will be deprecated on October 25, 2026. Migrate to Ray v3.2."

> Status note (fal-ai/luma-dream-machine/ray-2-flash and siblings): Schema is still served by fal but the endpoint is hidden from the public catalog (no metadata/pricing page); treat as legacy.

### Pika

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/pika/v2.2/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1","4:5","5:4","3:2","2:3"] (def "16:9") | `duration` [5,10] (def 5) | `resolution` ["1080p","720p"] (def "720p") |  | 5 second video at 720p costs $0.20. 5 second video at 1080p costs $0.45. |
| `fal-ai/pika/v2.2/image-to-video` | i2v | `image_url`* |  | `duration` [5,10] (def 5) | `resolution` ["720p","1080p"] (def "720p") |  | 5 second video at 720p costs $0.20. 5 second video at 1080p costs $0.45. |
| `fal-ai/pika/v2.2/pikaframes` | flf2v | `image_urls`* |  |  | `resolution` ["720p","1080p"] (def "720p") |  | Your request will cost $0.04 per second for 720p or $0.06 per second for 1080p, with a minimum of 5 billable seconds - $0.20 for 720p and $0.30 for 10… |
| `fal-ai/pika/v2.2/pikascenes` | ref2v | `image_urls`* | `aspect_ratio` ["16:9","9:16","1:1","4:5","5:4","3:2","2:3"] (def "16:9") | `duration` [5,10] (def 5) | `resolution` ["720p","1080p"] (def "1080p") |  | 5 second video at 720p costs $0.20. 5 second video at 1080p costs $0.45. |

### PixVerse

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/pixverse/v5/text-to-video` | t2v |  | `aspect_ratio` ["16:9","4:3","1:1","3:4","9:16"] (def "16:9") | `duration` ["5","8"] (def "5") | `resolution` ["360p","540p","720p","1080p"] (def "720p") |  | For 5s video your request will cost $0.15 for 360p and 540p, $0.2 for 720p and $0.4 for 1080p.  |
| `fal-ai/pixverse/v5/image-to-video` | i2v | `image_url`* |  | `duration` ["5","8"] (def "5") | `resolution` ["360p","540p","720p","1080p"] (def "720p") |  | For 5s video your request will cost $0.15 for 360p and 540p, $0.2 for 720p and $0.4 for 1080p.  |
| `fal-ai/pixverse/v5/transition` | flf2v | `first_image_url`* `end_image_url`* | `aspect_ratio` ["16:9","4:3","1:1","3:4","9:16"] (def "16:9") | `duration` ["5","8"] (def "5") | `resolution` ["360p","540p","720p","1080p"] (def "720p") |  | For 5s video your request will cost $0.15 for 360p and 540p, $0.2 for 720p and $0.4 for 1080p.  |
| `fal-ai/pixverse/v5.5/text-to-video` | t2v |  | `aspect_ratio` ["16:9","4:3","1:1","3:4","9:16"] (def "16:9") | `duration` ["5","8","10"] (def "5") | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | For a 5s video in single-clip mode without audio, your request will cost $0.15 for 360p and 540p, $0.2 for 720p, and $0.4 for 1080p. Enabling audio ad… |
| `fal-ai/pixverse/v5.5/image-to-video` | i2v | `image_url`* |  | `duration` ["5","8","10"] (def "5") | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | For a 5s video in single-clip mode without audio, your request will cost $0.15 for 360p and 540p, $0.2 for 720p, and $0.4 for 1080p. Enabling audio ad… |
| `fal-ai/pixverse/v5.6/text-to-video` | t2v |  | `aspect_ratio` ["16:9","4:3","1:1","3:4","9:16"] (def "16:9") | `duration` ["5","8","10"] (def "5") | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | For a 5s video without audio, your request will cost $0.35 for 360p and 540p, $0.45 for 720p, and $0.75 for 1080p. Enabling audio adds $0.45 for 360p/… |
| `fal-ai/pixverse/v5.6/image-to-video` | i2v | `image_url`* |  | `duration` ["5","8","10"] (def "5") | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | For a 5s video without audio, your request will cost $0.35 for 360p and 540p, $0.45 for 720p, and $0.75 for 1080p. Enabling audio adds $0.45 for 360p/… |
| `fal-ai/pixverse/v5.6/transition` | flf2v | `first_image_url`* `end_image_url`* | `aspect_ratio` ["16:9","4:3","1:1","3:4","9:16"] (def "16:9") | `duration` ["5","8","10"] (def "5") | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | For a 5s video without audio, your request will cost $0.35 for 360p and 540p, $0.45 for 720p, and $0.75 for 1080p. Enabling audio adds $0.45 for 360p/… |
| `fal-ai/pixverse/v6/text-to-video` | t2v |  | `aspect_ratio` ["16:9","4:3","1:1","3:4","9:16","2:3","3:2","21:9"] (def "16:9") | `duration` integer 1..15 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | Billing is calculated per second of video generated. For 360p, your request will cost $0.025 per second without audio and $0.035 per second with audio… |
| `fal-ai/pixverse/v6/image-to-video` | i2v | `image_url`* |  | `duration` integer 1..15 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | Billing is calculated per second of video generated. For 360p, your request will cost $0.025 per second without audio and $0.035 per second with audio… |
| `fal-ai/pixverse/v6/transition` | flf2v | `first_image_url`* `end_image_url`* | `aspect_ratio` ["16:9","4:3","1:1","3:4","9:16","2:3","3:2","21:9"] (def "16:9") | `duration` integer 1..15 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | Billing is calculated per second of video generated. For 360p, your request will cost $0.025 per second without audio and $0.035 per second with audio… |
| `fal-ai/pixverse/v6/extend` | v2v | `video_url`* |  | `duration` integer 1..15 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | Billing is calculated per second of video generated. For 360p, your request will cost $0.025 per second without audio and $0.035 per second with audio… |
| `fal-ai/pixverse/c1/text-to-video` | t2v |  | `aspect_ratio` ["16:9","4:3","1:1","3:4","9:16","2:3","3:2","21:9"] (def "16:9") | `duration` integer 1..15 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | Billing is calculated per second of video generated. For 360p, your request will cost $0.030 per second without audio and $0.040 per second with audio… |
| `fal-ai/pixverse/c1/image-to-video` | i2v | `image_url`* |  | `duration` integer 1..15 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | Billing is calculated per second of video generated. For 360p, your request will cost $0.030 per second without audio and $0.040 per second with audio… |
| `fal-ai/pixverse/c1/reference-to-video` | ref2v | `image_references`* | `aspect_ratio` ["16:9","4:3","1:1","3:4","9:16","2:3","3:2","21:9"] (def "16:9") | `duration` integer 1..15 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | Billing is calculated per second of video generated. For 360p, your request will cost $0.030 per second without audio and $0.040 per second with audio… |
| `fal-ai/pixverse/c1/transition` | flf2v | `first_image_url`* `end_image_url`* | `aspect_ratio` ["16:9","4:3","1:1","3:4","9:16","2:3","3:2","21:9"] (def "16:9") | `duration` integer 1..15 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `generate_audio_switch` (def false) | Billing is calculated per second of video generated. For 360p, your request will cost $0.030 per second without audio and $0.040 per second with audio… |
| `fal-ai/pixverse/lipsync` | lipsync | `video_url`* `audio_url` |  |  |  |  | For every second of output videos your request will cost $0.04. If audio is not provided for every 100 characters your request will cost $0.24. |
| `fal-ai/pixverse/sound-effects` | v2a | `video_url`* |  |  |  |  | $0.1 per 5 seconds |
| `fal-ai/pixverse/swap` | v2v | `image_url`* `video_url`* |  |  | `resolution` ["360p","540p","720p"] (def "720p") |  | For 5s video your request will cost $0.15 for 360p and 540p, $0.2 for 720p and $0.4 for 1080p. If input video duration is greater than 5 s the cost wi… |

### Lightricks LTX

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/ltx-2/text-to-video` **[unlisted]** | t2v |  |  | `duration` [6,8,10] (def 6) | `resolution` ["1080p","1440p","2160p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.06 per second for 1080p, $0.12 per second for 1440p or $0.24 per second for 2160p. |
| `fal-ai/ltx-2/image-to-video` **[unlisted]** | i2v | `image_url`* |  | `duration` [6,8,10] (def 6) | `resolution` ["1080p","1440p","2160p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.06 per second for 1080p, $0.12 per second for 1440p or $0.24 per second for 2160p. |
| `fal-ai/ltx-2/text-to-video/fast` **[unlisted]** | t2v |  |  | `duration` [6,8,10,12,14,16,18,20] (def 6) | `resolution` ["1080p","1440p","2160p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.04 per second for 1080p, $0.08 per second for 1440p or $0.16 per second for 2160p. |
| `fal-ai/ltx-2/image-to-video/fast` **[unlisted]** | i2v | `image_url`* |  | `duration` [6,8,10,12,14,16,18,20] (def 6) | `resolution` ["1080p","1440p","2160p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.04 per second for 1080p, $0.08 per second for 1440p or $0.16 per second for 2160p. |
| `fal-ai/ltx-2.3/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` [6,8,10] (def 6) | `resolution` ["1080p","1440p","2160p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.08 per second for 1080p, $0.16 per second for 1440p or $0.32 per second for 2160p. |
| `fal-ai/ltx-2.3/image-to-video` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` [6,8,10] (def 6) | `resolution` ["1080p","1440p","2160p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.08 per second for 1080p, $0.16 per second for 1440p or $0.32 per second for 2160p. |
| `fal-ai/ltx-2.3/text-to-video/fast` | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` [6,8,10,12,14,16,18,20] (def 6) | `resolution` ["1080p","1440p","2160p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.06 per second for 1080p, $0.12 per second for 1440p or $0.24 per second for 2160p. |
| `fal-ai/ltx-2.3/image-to-video/fast` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` [6,8,10,12,14,16,18,20] (def 6) | `resolution` ["1080p","1440p","2160p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.06 per second for 1080p, $0.12 per second for 1440p or $0.24 per second for 2160p. |
| `fal-ai/ltx-2.3/audio-to-video` | avatar | `image_url` `audio_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") |  |  |  | Your request will cost $0.10 per second. |
| `fal-ai/ltx-2.3/extend-video` | v2v | `video_url`* |  | `duration` number 2..20 (def 5) |  |  | Your request will cost $0.10 per second. |
| `fal-ai/ltx-2.3/retake-video` | v2v | `video_url`* |  | `duration` number 2..20 (def 5) |  |  | Your request will cost $0.10 per second. |
| `lightricks/ltx-2.5/text-to-video/pro` | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` [6,8,10,"auto"] (def "auto") | `resolution` ["720p","1080p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.12 per second for 720p or $0.17 per second for 1080p. |
| `lightricks/ltx-2.5/image-to-video/pro` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` [6,8,10,"auto"] (def "auto") | `resolution` ["720p","1080p"] (def "1080p") | `generate_audio` (def true) | Your request will cost $0.12 per second for 720p or $0.17 per second for 1080p. |
| `lightricks/ltx-2.5/text-to-video/fast` | t2v |  | `aspect_ratio` ["16:9","9:16"] (def "16:9") | `duration` [6,8,10,12,14,16,18,20,"auto"] (def "auto") | `resolution` ["720p","1080p","1440p","2160p"] (def "1080p") | `generate_audio` (def true) | Billing is calculated per second of video generated. For 720p, your request will cost $0.09 per second; for 1080p, $0.13 per second; for 1440p, $0.19 … |
| `lightricks/ltx-2.5/image-to-video/fast` | i2v | `image_url`* `end_image_url` | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") | `duration` [6,8,10,12,14,16,18,20,"auto"] (def "auto") | `resolution` ["720p","1080p","1440p","2160p"] (def "1080p") | `generate_audio` (def true) | Billing is calculated per second of video generated. For 720p, your request will cost $0.09 per second; for 1080p, $0.13 per second; for 1440p, $0.19 … |
| `lightricks/ltx-2.5/audio-to-video/pro` | avatar | `image_url` `audio_url`* | `aspect_ratio` ["auto","16:9","9:16"] (def "auto") |  |  |  | Billing is calculated per second of the input audio. At 1080p, your request will cost $0.17 per second. Native audio is included.  |

> Status note (fal-ai/ltx-2/text-to-video and siblings): Schema is still served by fal but the endpoint is hidden from the public catalog (no metadata/pricing page); treat as legacy.

### Vidu

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/vidu/q1/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") |  |  |  | For 5s video your request will cost $0.40. |
| `fal-ai/vidu/q1/image-to-video` | i2v | `image_url`* |  |  |  |  | For 5s video your request will cost $0.40. |
| `fal-ai/vidu/q1/start-end-to-video` | flf2v | `start_image_url`* `end_image_url`* |  |  |  |  | For 4s video your request will cost $0.40. |
| `fal-ai/vidu/q1/reference-to-video` | ref2v | `reference_image_urls`* | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") |  |  | `bgm` (def false) | For 5s video your request will cost $0.40. |
| `fal-ai/vidu/q2/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") | `duration` [2,3,4,5,6,7,8] (def 4) | `resolution` ["360p","520p","720p","1080p"] (def "720p") | `bgm` (def false) | The model will cost 0.1 $ for every 360p video, 0.2 $ for every 520p video, 0.3 $ for 720 p video. For 1080 p the cost would be 0.2 $ along with 0.1 $… |
| `fal-ai/vidu/q2/image-to-video/pro` | i2v | `image_url`* `end_image_url` |  | `duration` [2,3,4,5,6,7,8] (def 4) | `resolution` ["720p","1080p"] (def "720p") | `bgm` (def false) | For 720 p your video request would cost 0.1 $ along with a 0.05 $ for every video second. For 1080 p each request will cost 0.3 $ along with 0.1 $ for… |
| `fal-ai/vidu/q2/image-to-video/turbo` | i2v | `image_url`* `end_image_url` |  | `duration` [2,3,4,5,6,7,8] (def 4) | `resolution` ["720p","1080p"] (def "720p") | `bgm` (def false) | For 720 p each video second will cost 0.05 $. For 1080 p each request will cost 0.2 $ along with 0.05 $ for every video second. |
| `fal-ai/vidu/q2/reference-to-video/pro` | ref2v | `reference_image_urls` `reference_video_urls` | `aspect_ratio` string (def "16:9") | `duration` integer 1..8 (def 4) | `resolution` ["540p","720p","1080p"] (def "720p") | `bgm` (def false) | The model will cost 0.1 $ for every 360p video, 0.2 $ for every 520p video, 0.3 $ for 720 p video. For 1080 p the cost would be 0.2 $ along with 0.1 $… |
| `fal-ai/vidu/q2/text-to-image` | t2i |  | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") |  |  |  | Your request will cost $0.1 per image. |
| `fal-ai/vidu/q2/reference-to-image` | edit | `reference_image_urls`* | `aspect_ratio` ["16:9","9:16","1:1"] (def "16:9") |  |  |  | Your request will cost $0.1 per image. |
| `fal-ai/vidu/q3/text-to-video` | t2v |  | `aspect_ratio` ["16:9","9:16","4:3","3:4","1:1"] (def "16:9") | `duration` integer 1..16 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `audio` (def true) | Your request will cost 0.07 $ per video second for 360p and 540 p, cost will be 2.2x for 720p and 1080p resolution. |
| `fal-ai/vidu/q3/image-to-video` | i2v | `image_url`* `end_image_url` |  | `duration` integer 1..16 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `audio` (def true) | Your request will cost 0.07 $ per video second for 360p and 540 p, cost will be 2.2x for 720p and 1080p resolution. |
| `fal-ai/vidu/q3/text-to-video/turbo` | t2v |  | `aspect_ratio` ["16:9","9:16","4:3","3:4","1:1"] (def "16:9") | `duration` integer 1..16 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `audio` (def true) | Your request will cost 0.035 $ per video second for 360p and 540 p, cost will be 2.2x for 720p and 1080p resolution. |
| `fal-ai/vidu/q3/image-to-video/turbo` | i2v | `image_url`* `end_image_url` |  | `duration` integer 1..16 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `audio` (def true) | Your request will cost 0.035 $ per video second for 360p and 540 p, cost will be 2.2x for 720p and 1080p resolution. |
| `fal-ai/vidu/q3/reference-to-video/mix` | ref2v | `reference_image_urls`* | `aspect_ratio` ["16:9","9:16","4:3","3:4","1:1"] (def "16:9") | `duration` integer 1..16 (def 5) | `resolution` ["360p","540p","720p","1080p"] (def "720p") | `audio` (def true) | Your request will cost 0.07 $ per video second for 360p and 540 p, cost will be 2.2x for 720p and 1080p resolution. |
| `fal-ai/vidu/q4/image-to-video` | i2v | `image_url`* |  | `duration` integer 3..16 (def 5) | `resolution` ["540p","720p","1080p","2K","4K"] (def "720p") |  | For every second of video you generate, you will be charged $0.0315 at 540p, $0.0665 at 720p, $0.084 at 1080p, $0.133 at 2K or $0.273 at 4K. For examp… |
| `fal-ai/vidu/q4/reference-to-video` | ref2v | `reference_image_urls` `reference_audio_urls` | `aspect_ratio` ["16:9","9:16","4:3","3:4","1:1"] (def "16:9") | `duration` integer 3..16 (def 5) | `resolution` ["540p","720p","1080p","2K","4K"] (def "720p") | `audio` (def false) | For every second of video you generate, you will be charged $0.0315 at 540p, $0.0665 at 720p, $0.084 at 1080p, $0.133 at 2K or $0.273 at 4K. Turning o… |

### InfiniTalk

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/infinitalk` | avatar | `image_url`* `audio_url`* |  | `num_frames` integer 41..721 (def 145) | `resolution` ["480p","720p"] (def "480p") |  | $0.2 per seconds |
| `fal-ai/infinitalk/single-text` | avatar | `image_url`* |  | `num_frames` integer 41..721 (def 145) | `resolution` ["480p","720p"] (def "480p") |  | $0.2 per seconds |
| `fal-ai/infinitalk/video-to-video` | lipsync | `video_url`* `audio_url`* |  | `num_frames` integer 41..241 (def 145) | `resolution` ["480p","720p"] (def "480p") |  | $0.3 per seconds |

### Sync Labs lipsync

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/sync-lipsync/v2` | lipsync | `video_url`* `audio_url`* |  |  |  |  | Your request will cost $3 per minute of video. |
| `fal-ai/sync-lipsync/v2/pro` | lipsync | `video_url`* `audio_url`* |  |  |  |  | $5 per minutes |
| `fal-ai/sync-lipsync/v3` | lipsync | `video_url`* `audio_url`* |  |  |  |  | $8 per minutes |
| `fal-ai/sync-lipsync/v3/image-to-video` | avatar | `image_url`* `audio_url`* |  |  |  |  | Your request will cost $0.1333 per output second. |
| `fal-ai/sync-lipsync/react-1` | lipsync | `video_url`* `audio_url`* |  |  |  |  | $10 per minutes |

### VEED (Fabric, lipsync, bg removal)

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `veed/fabric-1.0` | avatar | `image_url`* `audio_url`* |  |  | `resolution` ["720p","480p"] |  | 480p - $0.08 per second, 720p - $0.15 per second |
| `veed/fabric-1.0/fast` | avatar | `image_url`* `audio_url`* |  |  | `resolution` ["720p","480p"] |  | 480p - $0.10 per second, 720p - $0.20 per second |
| `veed/fabric-1.0/text` | avatar | `image_url`* |  |  | `resolution` ["720p","480p"] |  | 480p - $0.08 per second, 720p - $0.15 per second |
| `veed/lipsync` | lipsync | `video_url`* `audio_url`* |  |  |  |  | $0.4 per minutes |
| `veed/lipsync/v2` | lipsync | `video_url`* `audio_url`* |  |  |  |  | Your request will cost $0.07 for every second of output video. |
| `veed/video-background-removal` | bg-remove | `video_url`* |  |  |  |  | Your request will cost $0.0225 per 30 frames (Refine Foreground Edges: ON) / $0.015 (Refine: OFF). |

### HeyGen

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/heygen/avatar4/image-to-video` | avatar | `image_url`* `audio_url` | `aspect_ratio` ["16:9","9:16","4:5","5:4","1:1","auto"] (def "16:9") |  | `resolution` ["360p","480p","540p","720p","1080p"] (def "720p") |  | Your request will cost $0.1 per output video second. |
| `fal-ai/heygen/v3/lipsync/speed` | lipsync | `video_url`* `audio_url`* |  |  |  |  | $0.05 per seconds |
| `fal-ai/heygen/v3/lipsync/precision` | lipsync | `video_url`* `audio_url`* |  |  |  |  | $0.1 per seconds |

### Creatify

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/creatify/aurora` | avatar | `image_url`* `audio_url`* |  |  | `resolution` ["480p","720p"] (def "720p") |  | Your request will cost $0.07 per video second for 480p, $0.14 per video second for 720p generation. Video seconds will be rounded upwards, meaning tha… |

### fal AI Avatar

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/ai-avatar/single-text` | avatar | `image_url`* |  | `num_frames` integer 41..721 (def 145) | `resolution` ["480p","720p"] (def "480p") |  | $0.2 per seconds |
| `fal-ai/ai-avatar/multi` | avatar | `image_url`* `first_audio_url`* |  | `num_frames` integer 41..241 (def 181) | `resolution` ["480p","720p"] (def "480p") |  | $0.2 per seconds |

### LatentSync

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/latentsync` | lipsync | `video_url`* `audio_url`* |  |  |  |  | Your request will cost $0.2 for videos up to 40 seconds. For longer videos, you will be charged $0.005 per second of output video. |

### MuseTalk

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/musetalk` | lipsync | `source_video_url`* `audio_url`* |  |  |  |  | $0 per compute seconds |

### Topaz upscalers

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `topaz/upscale/image/precision` | upscale-image | `image_url`* |  |  |  |  | Your request will cost $0.08 per started 24 megapixels of output for every precision model. For example, an output up to 24 MP costs $0.08, over 24 MP… |
| `topaz/upscale/image/creative` | upscale-image | `image_url`* |  |  |  |  | Your request will cost $0.08 per started 2 megapixels of output with Bloom 2, Bloom, or Bloom Realism. For example, a 24 MP output costs $0.96. |
| `topaz/upscale/image/generative` | upscale-image | `image_url`* |  |  |  |  | Your request will cost $0.08 per started 8 megapixels of output with Wonder 3 or Wonder 3.5, and $0.08 per started 4 megapixels with Wonder, Wonder 2,… |
| `topaz/upscale/video/precision` | upscale-video | `video_url`* |  |  |  |  | Your request will cost $0.10 per 10 seconds of output at 720p, $0.20 at 1080p, and $0.60 at 4K with the precision models (Proteus, Artemis, Iris, Dion… |
| `topaz/upscale/video/creative` | upscale-video | `video_url`* |  |  |  |  | Pricing uses the output resolution, frame rate, and duration. With Astra 2 at 30 fps, 10 seconds costs $3.00 up to 1080p or $5.00 at 4K. At 60 fps, th… |
| `topaz/upscale/video/generative` | upscale-video | `video_url`* |  |  |  |  | Pricing uses the selected model, output resolution, frame rate, and duration. At 30 fps, 10 seconds costs $1.20 up to 1080p or $2.60 at 4K with Starli… |
| `fal-ai/topaz/upscale/image` **[unlisted]** | upscale-image | `image_url`* |  |  |  |  | For a single image, your request will cost $0.08 for up to 24MP, $0.16 for up to 48MP, $0.32 for up to 96MP, and up to $1.36 for 512MP output resoluti… |
| `fal-ai/topaz/upscale/video` **[unlisted]** | upscale-video | `video_url`* |  |  |  |  | For every second a video your request will cost $0.01 for up to 720p, $0.02 for 720p to 1080p, and $0.08 for above 1080p output. Price doubles for 60f… |

> Status note (fal-ai/topaz/upscale/image and siblings): Schema is still served by fal but the endpoint is hidden from the public catalog (no metadata/pricing page); treat as legacy.

### SeedVR2 upscaler

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/seedvr/upscale/image` | upscale-image | `image_url`* |  |  | `target_resolution` ["720p","1080p","1440p","2160p"] (def "1080p") |  | $0.001 per megapixels |
| `fal-ai/seedvr/upscale/video` | upscale-video | `video_url`* |  |  | `target_resolution` ["720p","1080p","1440p","2160p"] (def "1080p") |  | Your request will cost $0.001 per megapixel of video data (width × height × frames). For example, if your upscaled video is 1920×1080 with 121 frames,… |

### ByteDance video upscaler

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/bytedance-upscaler/upscale/video` | upscale-video | `video_url`* |  |  | `target_resolution` ["1080p","2k","4k","6k","8k"] (def "1080p") |  | Upscaling to 1080p costs $0.0072/s, 2K costs $0.0144/s, and 4K costs $0.0288/s, at a 30fps rate. Processing at 60fps doubles the cost for any resoluti… |

### Clarity / Crystal upscalers

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/clarity-upscaler` | upscale-image | `image_url`* |  |  |  |  | $0.03 per megapixels |
| `clarityai/crystal-upscaler` | upscale-image | `image_url`* |  |  |  |  | $0.016 per megapixels |
| `clarityai/crystal-video-upscaler` | upscale-video | `video_url`* |  |  |  |  | Pricing is $0.10 per megapixel per second. The total cost is multiplied based on the video’s frame rate (FPS), using 30-FPS increments: - Up to 30 FPS… |

### BiRefNet background removal

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/birefnet` | bg-remove | `image_url`* |  |  |  |  | $0 per compute seconds |
| `fal-ai/birefnet/v2` | bg-remove | `image_url`* |  |  |  |  | $0 per compute seconds |
| `fal-ai/birefnet/v2/video` | bg-remove | `video_url`* |  |  |  |  | $0 per compute seconds |

### Bria background removal

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/bria/background/remove` | bg-remove | `image_url`* |  |  |  |  | Your request will cost $0.018 per image without a prompt and $0.03 per image with a prompt. |
| `bria/video/background-removal` | bg-remove | `video_url`* |  |  |  |  | Your request will cost $0.14 per second. |
| `bria/video/background-removal/v3` | bg-remove | `video_url`* |  |  |  |  | Your request will cost $0.05 per second. |

### Pixelcut background removal

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `pixelcut/background-removal` | bg-remove | `image_url`* |  |  |  |  | $0.016 per images |

### Face swap

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/face-swap` **[unlisted]** | face-swap | `base_image_url`* |  |  |  |  |  |
| `easel-ai/advanced-face-swap` **[unlisted]** | face-swap |  |  |  |  |  | $0.05 per generations |
| `easel-ai/fashion-tryon` **[unlisted]** | edit |  |  |  |  |  | $0.05 per images |

> Status note (fal-ai/face-swap and siblings): Schema is still served by fal but the endpoint is hidden from the public catalog (no metadata/pricing page); treat as legacy.

### ElevenLabs (TTS, SFX, music)

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/elevenlabs/tts/eleven-v3` | tts |  |  |  |  |  | $0.1 per 1000 characters |
| `fal-ai/elevenlabs/tts/multilingual-v2` | tts |  |  |  |  |  | $0.1 per 1000 characters |
| `fal-ai/elevenlabs/tts/turbo-v2.5` | tts |  |  |  |  |  | $0.05 per 1000 characters |
| `elevenlabs/tts/eleven-v4` | tts |  |  |  |  |  | $0.08 per 1000 characters |
| `elevenlabs/tts/eleven-v4-turbo` | tts |  |  |  |  |  | $0.04 per 1000 characters |
| `fal-ai/elevenlabs/text-to-dialogue/eleven-v3` | tts |  |  |  |  |  | $0.1 per 1000 characters |
| `fal-ai/elevenlabs/sound-effects/v2` | sfx |  |  | `duration_seconds` number 0.5..22 |  |  | $0.002 per seconds |
| `fal-ai/elevenlabs/music` | music |  |  | `music_length_ms` integer 3000..600000 |  |  | Your request will cost $0.6 per output audio minute. The audio will be rounded up to the closest minute. For instance, a generation with 30 seconds ou… |
| `elevenlabs/music/v2` | music |  |  | `music_length_ms` integer 3000..600000 |  |  | Your request will cost $0.6 per output audio minute. The audio will be rounded up to the closest minute. For instance, a generation with 30 seconds ou… |
| `elevenlabs/music/v2.5` | music |  |  | `music_length_ms` integer 3000..600000 |  |  | Your request will cost $0.6 per output audio minute. The audio will be rounded up to the closest minute. For instance, a generation with 30 seconds ou… |

### MMAudio

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/mmaudio-v2` | v2a | `video_url`* |  | `duration` number 1..30 (def 8) |  |  | $0.001 per seconds |
| `fal-ai/mmaudio-v2/text-to-audio` | sfx |  |  | `duration` number 1..30 (def 8) |  |  | $0.001 per seconds |

### Mirelo SFX

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `mirelo-ai/sfx2.0/video-to-audio` | v2a | `video_url`* |  | `duration` number 1..600 (def 10) |  |  | Billing is calculated per second of output and per sample. From October 14 through December 13, 2026, the introductory price is $0.010 per second, red… |

### ThinkSound

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/thinksound` | v2a | `video_url`* |  |  |  |  | Your request will cost $0.001 per compute second. |

### Hunyuan Video Foley

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `fal-ai/hunyuan-video-foley` | v2a | `video_url`* |  |  |  |  | $0.1 per 10 seconds |

### Google Lyria

| fal endpoint | op | media fields (* = required) | aspect / size | duration | resolution | audio toggle | price (fal page) |
|---|---|---|---|---|---|---|---|
| `google/lyria-3.5` | music | `image_url` |  |  |  |  | $0.1 per generations |

---

## 6. Replicate equivalents (secondary aggregator)

All of these are **official models**: call them with `POST /v1/models/{owner}/{name}/predictions`. The full input schemas (enums, defaults, ranges) are in the JSON under `provider:"replicate"`. Each fal record's `replicateEquivalent` field points to the matching row here.

These were not found on Replicate (404 on 2026-10-16): `reve/*`, `hedra/character-3`, `{studio}/*`, `kwaivgi/kling-v3`, `luma/ray-3`, `ideogram-ai/ideogram-v4`, `sync/lipsync-3`, `vidu/*`, and the `wan-3.0` slugs.

| Replicate model | ops | media fields | output | price (replicate page) | note |
|---|---|---|---|---|---|
| `851-labs/background-remover` | bg-remove | `image`* | url |  |  |
| `black-forest-labs/flux-1.1-pro` | t2i |  | url | $0.04 per output image |  |
| `black-forest-labs/flux-1.1-pro-ultra` | t2i |  | url | $0.06 per output image |  |
| `black-forest-labs/flux-2-dev` | t2i+edit | `input_images` | url | model variant=go_fast: $0.012 per input image megapixel; $0.012 per output image megapixel / model variant=regular: $0.014 per input image megapixel; … |  |
| `black-forest-labs/flux-2-flex` | t2i+edit | `input_images` | url | $0.06 per input image megapixel; $0.06 per output image megapixel |  |
| `black-forest-labs/flux-2-max` | t2i+edit | `input_images` | url | $0.04 per run; $0.03 per input image megapixel; $0.03 per output image megapixel |  |
| `black-forest-labs/flux-2-pro` | t2i+edit | `input_images` | url | $0.015 per run; $0.015 per input image megapixel; $0.015 per output image megapixel |  |
| `black-forest-labs/flux-3` | t2v+i2v+v2v | `images` | url | model variant=t2v_i2v, target resolution=720p: $0.17 per second of output video / model variant=t2v_i2v, target resolution=1080p: $0.29 per second of … |  |
| `black-forest-labs/flux-kontext-max` | edit | `input_image` | url | $0.08 per output image |  |
| `black-forest-labs/flux-kontext-pro` | edit | `input_image` | url | $0.04 per output image |  |
| `bria/remove-background` | bg-remove | `image_url` | url | $0.018 per output image |  |
| `bytedance/omni-human` | avatar | `image`* `audio`* | url | $0.14 per second of output video |  |
| `bytedance/omni-human-1.5` | avatar | `image`* `audio`* | url | $0.16 per second of output video |  |
| `bytedance/seedance-1-lite` | t2v+i2v+flf2v+ref2v | `image` `reference_images` `last_frame_image` | url | target resolution=480p: $0.018 per second of output video / target resolution=720p: $0.036 per second of output video / target resolution=1080p: $0.07… |  |
| `bytedance/seedance-1-pro` | t2v+i2v+flf2v | `image` `last_frame_image` | url | target resolution=480p: $0.03 per second of output video / target resolution=720p: $0.06 per second of output video / target resolution=1080p: $0.15 p… |  |
| `bytedance/seedance-1-pro-fast` | t2v+i2v | `image` | url | target resolution=480p: $0.015 per second of output video / target resolution=720p: $0.025 per second of output video / target resolution=1080p: $0.06… |  |
| `bytedance/seedance-1.5-pro` | t2v+i2v+flf2v | `image` `last_frame_image` | url | model variant=with_audio, target resolution=480p: $0.025 per second of output video / model variant=without_audio, target resolution=480p: $0.013 per … |  |
| `bytedance/seedance-2.0` | t2v+i2v+flf2v+ref2v | `image` `reference_images` `last_frame_image` `reference_videos` `reference_audios` | url | model variant=video_in, target resolution=480p: $0.10 per second of output video / model variant=non_video_in, target resolution=480p: $0.08 per secon… |  |
| `bytedance/seedance-2.5` | t2v+i2v+flf2v+ref2v | `image` `reference_images` `last_frame_image` `reference_videos` `reference_audios` | url | model variant=non_video_in, target resolution=480p: $0.1028 per second of output video / model variant=video_in, target resolution=480p: $0.4304 per s… |  |
| `bytedance/seedream-4` | t2i+edit | `image_input` | array | $0.03 per output image |  |
| `bytedance/seedream-4.5` | t2i+edit | `image_input` | array | $0.04 per output image |  |
| `bytedance/seedream-5-lite` | t2i+edit | `image_input` | array | $0.035 per output image |  |
| `bytedance/seedream-5-pro` | t2i+edit | `image_input` | array | model variant=None, target resolution=1K: $0.045 per output image / model variant=None, target resolution=2K: $0.09 per output image / model variant=l… |  |
| `cdingram/face-swap` | face-swap | `input_image`* | url |  |  |
| `codeplugtech/face-swap` | face-swap | `input_image`* | url |  |  |
| `elevenlabs/music` | music |  | url | $8.30 per thousand seconds of output audio |  |
| `elevenlabs/turbo-v2.5` | tts |  | url | $0.05 per thousand input characters |  |
| `elevenlabs/v3` | tts |  | url | $0.10 per thousand input characters |  |
| `google/imagen-4` | t2i |  | url | $0.04 per output image |  |
| `google/imagen-4-fast` | t2i |  | url | $0.02 per output image |  |
| `google/imagen-4-ultra` | t2i |  | url | $0.06 per output image |  |
| `google/nano-banana` | t2i+edit | `image_input` | url | $0.039 per output image |  |
| `google/nano-banana-2` | t2i+edit | `image_input` | url | target resolution=1K: $0.067 per output image / target resolution=2K: $0.101 per output image / target resolution=4K: $0.151 per output image |  |
| `google/nano-banana-2.1` | t2i+edit | `image_input` | url | target resolution=1K: $0.0336 per output image / target resolution=2K: $0.0504 per output image / target resolution=4K: $0.1134 per output image |  |
| `google/nano-banana-pro` | t2i+edit | `image_input` | url | target resolution=1K: $0.15 per output image / target resolution=2K: $0.15 per output image / target resolution=4K: $0.30 per output image / target re… | allow_fallback_model routes to bytedance/seedream-5 when at capacity (billed at fallback price). |
| `google/veo-3` | t2v+i2v | `image` | url | model variant=with_audio: $0.40 per second of output video / model variant=without_audio: $0.20 per second of output video |  |
| `google/veo-3-fast` | t2v+i2v | `image` | url | model variant=with_audio: $0.15 per second of output video / model variant=without_audio: $0.10 per second of output video |  |
| `google/veo-3.1` | t2v+i2v+flf2v+ref2v | `image` `reference_images` `last_frame` | url | model variant=with_audio: $0.40 per second of output video / model variant=without_audio: $0.20 per second of output video |  |
| `google/veo-3.1-fast` | t2v+i2v+flf2v | `image` `last_frame` | url | model variant=with_audio: $0.15 per second of output video / model variant=without_audio: $0.10 per second of output video |  |
| `google/veo-3.1-lite` | t2v+i2v+flf2v | `image` `last_frame` | url | target resolution=720p: $0.05 per second of output video / target resolution=1080p: $0.08 per second of output video |  |
| `heygen/avatar-iv` | avatar |  | url | $0.075 per second of output video | Uses HeyGen avatar_id/voice_id catalog, not an arbitrary photo. |
| `ideogram-ai/ideogram-character` | edit | `image` | url | model variant=TURBO: $0.10 per output image / model variant=DEFAULT: $0.15 per output image / model variant=QUALITY: $0.20 per output image |  |
| `ideogram-ai/ideogram-v3-balanced` | t2i | `image` | url | $0.06 per output image |  |
| `ideogram-ai/ideogram-v3-quality` | t2i | `image` | url | $0.09 per output image |  |
| `ideogram-ai/ideogram-v3-turbo` | t2i | `image` | url | $0.03 per output image |  |
| `kwaivgi/kling-avatar` | avatar | `image`* `audio`* | url | model variant=std: $0.056 per second of output video / model variant=pro: $0.11 per second of output video |  |
| `kwaivgi/kling-lip-sync` | lipsync | `video_url` | url | $0.014 per second of output video |  |
| `kwaivgi/kling-o1` | flf2v+ref2v+v2v | `start_image` `reference_images` `end_image` `reference_video` | url | model variant=std: $0.084 per second of output video / model variant=std-with-video-input: $0.126 per second of output video / model variant=pro: $0.1… |  |
| `kwaivgi/kling-v2.1` | i2v+flf2v | `start_image`* `end_image` | url | model variant=standard: $0.05 per second of output video / model variant=pro: $0.09 per second of output video |  |
| `kwaivgi/kling-v2.1-master` | t2v+i2v | `start_image` | url | $0.28 per second of output video |  |
| `kwaivgi/kling-v2.5-turbo-pro` | t2v+i2v+flf2v | `image` `end_image` | url | $0.07 per second of output video |  |
| `kwaivgi/kling-v2.6` | t2v+i2v | `start_image` | url | with audio=False: $0.07 per second of output video / with audio=True: $0.14 per second of output video |  |
| `kwaivgi/kling-v2.6-motion-control` | v2v | `image`* `video`* | url | model variant=std: $0.07 per second of output video / model variant=pro: $0.12 per second of output video |  |
| `lightricks/ltx-2-fast` | t2v+i2v | `image` | url | target resolution=1080p: $0.04 per second of output video / target resolution=2k: $0.08 per second of output video / target resolution=4k: $0.16 per s… |  |
| `lightricks/ltx-2-pro` | t2v+i2v | `image` | url | target resolution=1080p: $0.06 per second of output video / target resolution=2k: $0.12 per second of output video / target resolution=4k: $0.24 per s… |  |
| `lightricks/ltx-2.3-pro` | t2v+i2v+flf2v+v2v+avatar | `image` `last_frame_image` `video` `audio` | url | target resolution=1080p: $0.08 per second of output video / target resolution=2k: $0.16 per second of output video / target resolution=4k: $0.32 per s… |  |
| `luma/ray-2-720p` | t2v+i2v+flf2v | `start_image_url` `end_image_url` | url | $0.18 per second of output video |  |
| `luma/ray-3.2` | t2v+i2v+flf2v | `start_image` `end_image` | url | model variant=sdr, target resolution=540p, second of output video=5: $0.15 per output video / model variant=sdr, target resolution=540p, second of out… |  |
| `luma/ray-flash-2-720p` | t2v+i2v+flf2v | `start_image_url` `end_image_url` | url | $0.06 per second of output video |  |
| `men1scus/birefnet` | bg-remove | `image`* | url |  |  |
| `minimax/hailuo-02` | t2v+i2v+flf2v | `first_frame_image` `last_frame_image` | url | target resolution=512P, second of output video=6: $0.10 per output video / target resolution=512P, second of output video=10: $0.15 per output video /… |  |
| `minimax/hailuo-02-fast` | i2v+flf2v | `first_frame_image`* `last_frame_image` | url | target resolution=512P, second of output video=6: $0.10 per output video / target resolution=512P, second of output video=10: $0.15 per output video |  |
| `minimax/hailuo-2.3` | t2v+i2v | `first_frame_image` | url | target resolution=768P, second of output video=6: $0.28 per output video / target resolution=768P, second of output video=10: $0.56 per output video /… |  |
| `minimax/hailuo-2.3-fast` | i2v | `first_frame_image`* | url | target resolution=768P, second of output video=6: $0.19 per output video / target resolution=768P, second of output video=10: $0.32 per output video /… |  |
| `minimax/music-1.5` | music |  | url | $0.03 per output audio file |  |
| `minimax/speech-02-hd` | tts |  | url | $0.10 per thousand input tokens |  |
| `minimax/video-01` | t2v+i2v+ref2v | `first_frame_image` | url | model variant=t2v: $0.50 per output video / model variant=s2v: $0.50 per output video |  |
| `openai/gpt-image-1` | t2i+edit | `input_images` | array |  | BYOK: openai_api_key is REQUIRED on Replicate. |
| `openai/gpt-image-1-mini` | t2i+edit | `input_images` | array |  | BYOK: openai_api_key is REQUIRED on Replicate. |
| `openai/gpt-image-1.5` | t2i+edit | `input_images` | array | model variant=auto: $0.136 per output image / model variant=low: $0.013 per output image / model variant=medium: $0.05 per output image / model varian… |  |
| `openai/gpt-image-2` | t2i+edit | `input_images` | array | model variant=auto: $0.128 per output image / model variant=low: $0.012 per output image / model variant=medium: $0.047 per output image / model varia… |  |
| `openai/sora-2` | t2v+i2v |  | url | model variant=sora-2-own-key:  / model variant=sora-2: $0.10 per second of output video | OpenAI retired the Sora 2 API on 2026-09-24; the Replicate page still renders but the model should be treated as unavailable. |
| `openai/sora-2-pro` | t2v+i2v |  | url | model variant=sora-2-pro-own-key:  / model variant=sora-2-pro-standard: $0.30 per second of output video / model variant=sora-2-pro-high: $0.50 per se… | OpenAI retired the Sora 2 API on 2026-09-24; treat as unavailable. |
| `philz1337x/clarity-upscaler` | upscale-image | `image`* | array |  |  |
| `philz1337x/crystal-upscaler` | upscale-image | `image`* | url | output image pixel=[None, 4400000]: $0.05 per output image / output image pixel=[4400000, 8800000]: $0.10 per output image / output image pixel=[88000… |  |
| `pixverse/pixverse-v5` | t2v+i2v+flf2v | `image` `last_frame_image` | url | $0.01 per unit |  |
| `pixverse/pixverse-v6` | t2v+i2v+flf2v | `image` `last_frame_image` | url | with audio=False, target resolution=360p: $0.05 per second of output video / with audio=True, target resolution=360p: $0.07 per second of output video… |  |
| `prunaai/z-image-turbo` | t2i |  | url | target resolution=0.5: $2.50 per thousand output image megapixels / target resolution=1: $5 per thousand output image megapixels / target resolution=2… |  |
| `qwen/qwen-image` | t2i+i2i | `image` | array | $0.025 per output image |  |
| `qwen/qwen-image-edit` | edit | `image`* | array | $0.03 per output image |  |
| `qwen/qwen-image-edit-2511` | edit | `image`* | array | $0.03 per output image |  |
| `qwen/qwen-image-edit-plus` | edit | `image`* | array | $0.03 per output image |  |
| `recraft-ai/recraft-v3` | t2i |  | url | $0.04 per output image |  |
| `recraft-ai/recraft-v4` | t2i |  | url | $0.04 per output image |  |
| `recraft-ai/recraft-v4-pro` | t2i |  | url | $0.25 per output image |  |
| `runwayml/gen-4.5` | t2v+i2v | `image` | url | $0.12 per second of output video |  |
| `runwayml/gen4-aleph` | v2v | `video`* | url | $0.18 per second of output video |  |
| `runwayml/gen4-image` | t2i+edit | `reference_images` | url | target resolution=720p: $0.05 per output image / target resolution=1080p: $0.08 per output image |  |
| `runwayml/gen4-turbo` | i2v | `image`* | url | $0.05 per second of output video |  |
| `sync/lipsync-2` | lipsync | `video`* `audio`* | url | $0.05 per second of output video |  |
| `sync/lipsync-2-pro` | lipsync | `video`* `audio`* | url | $0.08325 per second of output video |  |
| `tencent/hunyuan-image-3` | t2i |  | array | $0.08 per output image |  |
| `topazlabs/image-upscale` | upscale-image | `image`* | url | $0.08 per unit |  |
| `topazlabs/video-upscale` | upscale-video | `video`* | url | $0.08 per unit |  |
| `veed/fabric-1.0` | avatar | `image`* `audio`* | url | target resolution=480p: $0.08 per second of output video / target resolution=720p: $0.15 per second of output video |  |
| `wan-video/wan-2.2-i2v-fast` | i2v+flf2v | `image`* `last_image` | url | model variant=base, target resolution=480p: $0.05 per output video / model variant=interpolate, target resolution=480p: $0.065 per output video / mode… |  |
| `wan-video/wan-2.2-s2v` | avatar | `image`* `audio`* | url | $0.02 per second of output video |  |
| `wan-video/wan-2.2-t2v-fast` | t2v |  | url | target resolution=480p: $0.05 per output video / target resolution=720p: $0.10 per output video |  |
| `wan-video/wan-2.5-i2v` | i2v | `image`* `audio` | url | target resolution=480p: $0.05 per second of output video / target resolution=720p: $0.10 per second of output video / target resolution=1080p: $0.15 p… |  |
| `wan-video/wan-2.5-i2v-fast` | i2v | `image`* `audio` | url | target resolution=720p: $0.068 per second of output video / target resolution=1080p: $0.102 per second of output video |  |
| `wan-video/wan-2.5-t2v` | t2v | `audio` | url | target resolution=480p: $0.05 per second of output video / target resolution=720p: $0.10 per second of output video / target resolution=1080p: $0.15 p… |  |
| `wan-video/wan-2.5-t2v-fast` | t2v | `audio` | url | target resolution=720p: $0.068 per second of output video / target resolution=1080p: $0.102 per second of output video |  |
| `wan-video/wan-2.6-i2v` | i2v | `image`* `audio` | url | target resolution=720p: $0.10 per second of output video / target resolution=1080p: $0.15 per second of output video |  |
| `wan-video/wan-2.6-t2v` | t2v | `audio` | url | target resolution=720p: $0.10 per second of output video / target resolution=1080p: $0.15 per second of output video |  |
| `wan-video/wan-2.7-t2v` | t2v | `audio` | url | $0.10 per second of output video |  |
| `zsxkib/mmaudio` | v2a+sfx | `image` `video` | url |  |  |

---

## 7. Vendor-native endpoints (for models fal and Replicate lack)

### SOUL (verified on {studio-docs})

| Endpoint | Inputs (exact names) | Output |
|---|---|---|
| `POST {studio-api}/{studio}/soul/standard` | `prompt`*; `aspect_ratio` "9:16","16:9","4:3","3:4","1:1","2:3","3:2" (def "4:3"); `resolution` "720p","1080p" (def "720p"); `enhance_prompt` bool (def false); `style_id` uuid (def `464ea177-8d40-4940-8d9d-b438bab269c7`); `style_strength` 0–1 (def 1.0); `seed` int 1–1000000 or null; `custom_reference_id` uuid (Soul ID character) or null; `custom_reference_strength` 0–1 (def 1.0); `image_reference_url` uri or null; `batch_size` 1 or 4 (def 1) | `images[].url` |
| `POST {studio-api}/{studio}/soul/v2/standard` | Same fields except no `image_reference_url`; `aspect_ratio` def "1:1"; `style_id` def `3db34ab5-3439-4317-9e03-08dc30852e69` | `images[].url` |
| `POST {studio-api}/{studio}/soul/cinema` | `prompt`*, `aspect_ratio` (def "1:1"), `resolution` 720p/1080p, `enhance_prompt`, `custom_reference_id`, `custom_reference_strength`, `seed`, `batch_size` 1/4 | `images[].url` |
| `POST {studio-api}/{studio}/cinema-studio/4.0` | `prompt`*, `duration` 4–30 (def 5), `resolution` "480p","720p", `aspect_ratio` 16:9/4:3/1:1/3:4/9:16/21:9, `image_urls[]`, `video_urls[]`, `audio_urls[]`, `generate_audio` (def true), plus look controls: `era`, `genre`, `light`, `pacing`, `camera_lens`, `camera_model`, `camera_aperture`, `camera_movement` (33 moves), `color_palette` (50 named) | `video.url` |

- The parity studio's supplementary `/docs/openapi.json` still shows an older SOUL shape (`num_images`, `resolution` "2K"/"4K"). The parity studio's docs say the model page is authoritative, so the shape above is the one to use.
- **DoP** has no first-party API: it is absent from the 84-entry catalog. A third-party copy exists on WaveSpeed (`/api/v3/{studio}/dop/image-to-video`) but is not verified.
- The parity studio's API also re-sells third-party models: Seedance 2/2.5, Kling 2.5/2.6/3/O3/Omni, Wan 2.6/2.7/3/3-Prime, MiniMax H3, Hailuo 2.3, LTX-2.5, PixVerse V6, Grok, Recraft 4.1, Qwen Image 3, Ideogram 4 and Z-Image Turbo. It is useful as a parity reference but not needed by Fuobe.

### Hedra Character-3 (verified on hedra.com docs)

- **Submit:** `POST https://api.hedra.com/v3/models/hedra-character-3` with `Authorization: Key <key_id>:<secret>`. The body is `{"input":{…},"webhook":null,"idempotency_key":null}`.
- **`input` fields:**
  - `prompt`* (string)
  - `aspect_ratio`*: "1:1","4:3","3:4","16:9","9:16","9:21","21:9"
  - `resolution`*: "540p","720p","1080p"
  - `start_image`*: `{"source":"url","url":…}` or `{"source":"asset","asset_id":…}`, max 10 MB
  - `audio`*: one media reference, or an array of 1–4 (one per speaker); each 0.5–600 s
  - `duration_ms`: ≤600000
  - `num_outputs`: 1
  - `bounding_box_target`: `[x,y]`, required per speaker for multi-speaker
- **Response:** 202 `{job_id, model, status: IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED, status_url, result_url}`.
- **Result:** `GET https://api.hedra.com/v3/jobs/{job_id}` returns `outputs[]`.
- **Billing:** from a prepaid USD API wallet. A 402 response with `INSUFFICIENT_BALANCE` means the wallet is empty.

### Runway (native; fields partially verified)

- **Image to video:** `POST https://api.dev.runwayml.com/v1/image_to_video` with headers `Authorization: Bearer $RUNWAYML_API_SECRET` and `X-Runway-Version: 2024-11-06`.
  - Body: `{"model":"gen4.5"|"gen4_turbo"|"veo3.1"|"veo3.1_fast"|"seedance2_5","promptImage":<url or data URI; omit for text-to-video on gen4.5>,"promptText":…,"ratio":"1280:720","duration":5}`.
- **Video to video:** `/v1/video_to_video` with model `aleph2` (Aleph 2.0, 28 credits/s, 56-credit minimum). Body field names are not verified.
- **Images:** `/v1/text_to_image` with model `gen4_image` or `gen4_image_turbo`.
- **Polling:** `GET /v1/tasks/{id}` until `SUCCEEDED`, `FAILED` or `CANCELED`. `THROTTLED` behaves like `PENDING`. The result is in `output[]`.
- **Pricing:** 1 credit = $0.01.
  - gen4.5: 12 credits/s
  - gen4_turbo: 5 credits/s
  - veo3.1: 40 credits/s with audio, 20 without
  - veo3.1_fast: 15 credits/s with audio, 10 without

### Reve (NOT verified)

`POST https://api.reve.com/v1/image/create` (`prompt` ≤2560 chars, `aspect_ratio`, `version`), `/v1/image/edit` (`edit_instruction`, base64 `reference_image`) and `/v1/image/remix` (`prompt` with `<img>N</img>` tags, `reference_images[]` 1–6 base64), all with `Authorization: Bearer`. These come from secondary sources; confirm them against `api.reve.com/console/docs` before shipping.

### OpenAI Sora 2 (retired)

`POST https://api.openai.com/v1/videos` with `sora-2` or `sora-2-pro`. The API was shut down on 2026-09-24 according to secondary sources (announced 2026-03-24). No replacement.

---

## 8. Recommendations for Fuobe's adapter layer

1. **Drive requests from the JSON, not hand-written code.** For each (model, operation), read the endpoint, map Fuobe's canonical slots through `keyFields`, and cast values using the enum `valueType` (string vs number).
2. **Treat fal as primary, with Replicate fallbacks.** Use Replicate for: Veo 3.1 after 2026-11-17 (`google/veo-3.1*`), Imagen 4, Runway (Gen-4.5, Aleph, Gen-4 Image), and as a second source for Kling, Seedance, Hailuo, Wan, Nano Banana and Seedream.
3. **parity-studio-only features:** SOUL, Soul ID and Cinema Studio need a parity-studio API key (`{studio-api}`). If Fuobe wants Soul-like output without the parity studio, the closest open alternatives are FLUX.2 or Seedream 5 with LoRA or reference images. That is out of scope here.
4. **Set sane defaults to avoid surprise costs:** `generate_audio:false` on Veo and Kling 2.6/3 unless the user asks for audio (it doubles the price), `resolution` 720p, and `num_images` 1.
5. **Files:** upload user files to the fal CDN once with the two-step `initiate` + `PUT`, then reuse the URL. Avoid data URIs above a few KB on fal and above 256 KB on Replicate. Replicate outputs vanish after 1 hour, so mirror them to Fuobe storage.
6. **Polling:** poll the `status_url` that fal returns, which is under the app root. Back off 1–2 s for images and 3–5 s for video. Prefer webhooks in production.

---

## 9. Sources

fal.ai:

- Queue API: <https://fal.ai/docs/documentation/model-apis/inference/queue.md>
- CDN uploads and data URIs: <https://fal.ai/docs/documentation/model-apis/fal-cdn.md>
- Platform headers: <https://fal.ai/docs/documentation/model-apis/common-parameters.md>
- Webhooks: <https://fal.ai/docs/documentation/model-apis/inference/webhooks.md>
- Errors: <https://fal.ai/docs/documentation/model-apis/errors.md>
- JS client source (sub-path handling, storage upload): <https://unpkg.com/@fal-ai/client@1.10.1/src/queue.js>, <https://unpkg.com/@fal-ai/client@1.10.1/src/utils.js>, <https://unpkg.com/@fal-ai/client@1.10.1/src/storage.js>, <https://unpkg.com/@fal-ai/client@1.10.1/src/config.js>
- Model catalog: <https://api.fal.ai/v1/models>
- Per-endpoint schema (one per endpoint in the JSON, see `schemaUrl`): `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`, for example <https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/v2.1/master/text-to-video>
- Per-endpoint docs and pricing (see `sourceUrl`): `https://fal.ai/models/<id>/api` and `https://fal.ai/models/<id>/llms.txt`, for example <https://fal.ai/models/fal-ai/veo3.1/llms.txt> and <https://fal.ai/models/fal-ai/nano-banana-pro/edit/llms.txt>
- Deprecation banners (`endpoint_messages`) as rendered on <https://fal.ai/models/fal-ai/veo3.1>

Replicate:

- OpenAPI: <https://api.replicate.com/openapi.json>
- Docs: <https://replicate.com/docs/topics/predictions/create-a-prediction>, <https://replicate.com/docs/topics/predictions/input-files>, <https://replicate.com/docs/topics/predictions/lifecycle>
- Model pages `https://replicate.com/<owner>/<name>` (embedded schema and billing), for example <https://replicate.com/google/nano-banana-pro> and <https://replicate.com/google/veo-3.1>

The parity studio:

- <{studio-docs}/docs/llms.txt>
- <{studio-docs}/docs/models/soul-standard/generate.md>
- <{studio-docs}/docs/models/soul-2/generate.md>
- <{studio-docs}/docs/models/soul-cinema/generate.md>
- <{studio-docs}/docs/models/cinema-studio-4/generate.md>
- <{studio-docs}/docs/concepts/requests.md>
- <{studio-docs}/docs/concepts/file-uploads.md>
- <{studio-docs}/docs/concepts/polling.md>
- <{studio-docs}/docs/openapi.json>

Other vendors:

- Hedra: <https://www.hedra.com/docs/api-reference/v3/run-a-model/run-hedra-character-3-hedra-character-3.md>
- Runway: <https://docs.dev.runwayml.com/llms-full.txt>
- Reve (secondary): <https://docs.pixeltable.com/sdk/latest/reve.md>, <https://runtimewire.com/article/reve-details-image-api-for-create-edit-and-remix-after-2-0-launch>
- DoP on WaveSpeed (secondary, unverified): <https://wavespeed.ai/models/{studio}/dop/image-to-video>

Sora 2 retirement (secondary):

- <https://techjacksolutions.com/ai-brief/openai-videos-api-sora-2-deprecated-september-2026/>
- <https://invideo.io/blog/sora-ai-video-generator/>
- <https://zilliz.com/ai-faq/what-is-the-sora-shutdown-timeline>
- <https://blog.fal.ai/sora-2-gpt-image-1-are-now-available-on-fal/> (2025 launch)
