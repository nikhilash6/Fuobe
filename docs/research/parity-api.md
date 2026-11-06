# The studio's public API (pay-per-use) — adapter research

_In this file, "the studio" means the closed AI image and video studio that this research measures Fuobe against._

As of **2026-10-16**. Companion machine-readable file: [`parity-api.json`](./parity-api.json) — 101 endpoint records (84 catalog generation endpoints + 2 console-only models + 11 auxiliary routes + 4 legacy v1 routes), each with method, path, `operation`, full `inputs` (type / required / default / enum / min / max / lengths / item shapes / desc), `output` path, `priceUsd` and `verified`.

## How this was verified

| Source | Status | Used for |
|---|---|---|
| `{studio-docs}/llms-full.txt` (Mintlify dump of the whole docs site) | **200, primary, canonical** | Every concept page + all 84 model pages with their "Complete JSON schema" blocks. Parsed programmatically — field names/enums/defaults were not retyped. |
| `{studio-docs}/docs/openapi.json` (OpenAPI 3.1, `info.version` 2.0.0) | 200, primary but **partial & partly stale** | Only 9 operations (Soul standard, status, cancel, 3× Kling 2.5, 2× Hailuo 2.3) + `RequestStatus`/`MediaOutput`/`ErrorResponse` components. Its Soul-standard schema contradicts the model page (see Discrepancies). |
| `{studio-dashboard}/api/v2/pricing/models/?page=1..4` (backs {studio-service}/pricing) | 200, primary | Per-mode USD list + current (discounted) prices for 83 modes. |
| `{studio-dashboard}/models/{endpoint_id}/llms.txt` | 200 for 85 slugs, primary | Pricing formulas, formal output schema, and the schemas of two models not in the docs catalog (`soul/v2/image-to-image`, `{studio}/ai-influencer`). |
| npm `{studio-npm}/client@0.2.6`, PyPI `studio-client@0.2.0` (tarballs inspected, not executed) | secondary | Confirms lifecycle and URL building; only source for legacy v1 DoP / Speak / Soul-v1 / motions / Soul-ID list shapes (→ `verified:false`). |
| Unauthenticated probes of `{studio-api}` | supporting | Any **GET** to an unknown path → `405`; a real GET route → `401`. So `GET /v1/motions`, `/v1/text2image/soul-styles(/v2)`, `/v1/custom-references/list`, both presets routes and `/models` exist. **POST probes prove nothing** (every POST path returns 401, including bogus ones). |

Not reachable: `{studio-docs}/openapi.json` (404), `{studio-api}/{docs/,}openapi.json` (405), `{studio-service}/docs/openapi.json` (404), `{studio-docs}/llms.txt` (404). No API key was available, so **no live generation call was made**. Every request/response shape comes from documentation, not from observed traffic.

`verified:true` = read today from one of the studio's official docs, schemas or pricing API. `verified:false` = SDK-source or inference only (6 records: the 4 legacy v1 routes, `GET /v1/custom-references/list`, `GET /models`).

---

## 1. Adapter cheat-sheet (all verified from primary docs)

**Base URL** `{studio-api}` · **Auth** `Authorization: Key {API_KEY_ID}:{API_KEY_SECRET}` (not Bearer). The legacy `hf-api-key` / `hf-secret` headers are still accepted. Keys come from {studio-console} and must be used server-side only. A `401` returns `{"detail":"Invalid credentials"}`.

### Submit
`POST /{endpoint_id}` with a **flat JSON body** that matches the model schema. Unlike the legacy v1 API, it is **not** wrapped in `{"params":…}`. Most schemas set `additionalProperties:false`, so unknown fields are rejected. The endpoint id is the path without its leading slash, e.g. `bytedance/seedance-2.5/video-extend`.
- Optional header `Idempotency-Key`: 1–255 visible ASCII characters, no whitespace; a UUID is recommended. A replay with the same key, endpoint, body and webhook returns the original `request_id` and is not charged again, though the replay receipt may still say `queued`. A replay with a different body returns `422 "Idempotency-Key was already used with different request parameters"`. Key order in objects is ignored, but array order, omitted fields, explicit `null`s and URLs all count. A request rejected before acceptance (401/422) does not use up the key.
- Optional query `?hf_webhook=<urlencoded https url>`.
- Response `200`:
  ```json
  {"status":"queued","request_id":"<uuid>","status_url":"{studio-api}/requests/<id>/status","cancel_url":"{studio-api}/requests/<id>/cancel"}
  ```
  The docs say to use the returned URLs rather than build them yourself.

### Poll
`GET /requests/{request_id}/status` → `RequestStatus`:

| status | terminal | notes |
|---|---|---|
| `queued` | no | still cancelable |
| `in_progress` | no | can no longer be canceled |
| `completed` | yes | outputs present |
| `failed` | yes | `error` string; not charged |
| `nsfw` | yes | moderation (input or output); not charged |
| `canceled` | yes | refunded |

Output location: **images → `images[].url`**, **video → `video.url`**, audio → `audio.url` and `audios[].url`. Some video/3D operations also return `zip|mov|jsx|fbx|ply: {url}`. Ads Studio additionally returns `images[].index` and `errors[]` for partial batches. Recommended polling: start at 2 s, multiply by 1.5 up to 10 s, add jitter; retry on 5xx or network errors; stop on 401/404. Outputs are kept for **at least 7 days**, so copy them to our own storage.

### Cancel
`POST /requests/{id}/cancel` → `202` with an empty body. Returns `400` if processing has started and `404` for an unknown request or one belonging to another account. Only works while every job in the request is still `queued`.

### Upload (there are no file ids — every model takes URLs)
1. `POST /files/generate-upload-url` `{"content_type":"image/png"}` → `{public_url, upload_url, content_type, upload_headers:{"Content-Type":…, "x-amz-tagging":"retention=temporary"}}` (the upload URL expires in 1 h).
2. `PUT upload_url` with the raw bytes and **every** header from `upload_headers`. Do not send the studio's credentials here.
3. Pass `public_url` as `image_url` / `image_urls[]` / `video_url` / `audio_url(s)`.
Supported types: `image/jpeg|jpg|png|webp|gif`, `audio/wav|x-wav`, `video/mp4`. Any directly downloadable public or signed HTTPS URL also works; `asset://` refs are rejected.

### Estimate
`POST /estimate/{endpoint_id}` with the same body → `{"credits":"1.500","usd":"0.094"}` (decimal **strings**). This is the authoritative per-account price.

### Webhook
Delivered after `completed | failed | nsfw` (not after `canceled`). The envelope is **different from the status payload**: outputs are nested under `payload`:
```json
{"request_id":"…","status":"completed","error":null,"payload":{"images":[{"url":"…","content_type":"image/jpeg"}]}}
```
`payload` is `null` on failed or nsfw. Respond `2xx` within 10 s. 5xx and network errors are retried for up to 2 h; a 4xx is treated as permanent. Deliveries can repeat, so dedupe on `(request_id, status)`. **No signature or secret is documented for v2 webhooks** (legacy v1 had `{url, secret}`). Fall back to authenticated polling to confirm.

### Errors, limits, billing
`400` invalid params or concurrency reached (`"Maximum number of concurrent requests (N) has been reached"`) · `401` · `403` insufficient credits · `404` · `422` validation (`detail` may be a list) · `423` model temporarily blocked · `500` retry · `503` model disabled. Every response carries an `X-Correlation-ID` header; log it. There are no rate-limit headers or `Retry-After`. Concurrency tiers: 2 by default, 10 at ≥$25 added in the last 28 days, 20 at ≥$100, 40 at ≥$1,000. The balance is a prepaid USD credit that expires after 1 year. Failed, nsfw and canceled-while-queued requests are refunded.

---

## 2. How references, Soul IDs and styles are passed

- **Reference media = URLs only.** Field names vary per model: `image_url`, `end_image_url`, `last_image_url`, `first_frame_url`/`last_frame_url` (Kling O3/Omni), `image_urls[]`, `video_url`, `video_urls[]`, `audio_url`, `audio_urls[]`, `item_image_urls[]` (AI Influencer), `file_url`/`link_url` (Wan 3.0 ref2v documents and web pages). Prompt tokens `<<<image_1>>>`, `<<<video_1>>>`, `<<<audio_1>>>` (1-based) refer to attached media in Cinema Studio 4.0 and Seedance 2.5 reference modes.
- **Soul ID (character training)** — `POST /v1/custom-references` with
  `{"name":"…(≤100)","model_version":"v1|v2|cinema"(default v1),"input_images":[{"type":"image_url","image_url":"https://…"}] (1–100)}`.
  The response is a reference object `{id, name, model_version, status, thumbnail_url, created_at, in_progress_at, fail_reason}`. Poll `GET /v1/custom-references/{id}`; states are `not_ready → queued → in_progress → completed | failed`. Training does **not** use `request_id`, `/requests/*` or webhooks. List with `GET /v1/custom-references/list?page=&page_size=` → `{total,page,page_size,total_pages,items[]}` *(SDK-only, verified:false; the route exists)*. **Delete and update are not documented.** Training cost is not published.
  Use: pass `custom_reference_id` (uuid) plus `custom_reference_strength` (0–1, default 1) to the Soul endpoint whose family matches `model_version`: v1 → `soul/standard`, v2 → `soul/v2/standard` and `soul/v2/image-to-image`, cinema → `soul/cinema`. References are scoped to the creating account. On Soul v2, a strength of `0` breaks at runtime, so use a value > 0. On Soul v1, `0` means "use the style's default character strength".
- **Soul styles** — `GET /v1/text2image/soul-styles` (Soul v1) and `GET /v1/text2image/soul-styles/v2` (Soul v2) → `[{id,name,description,preview_url}]`. Send the id as `style_id`. Defaults are v1 `464ea177-8d40-4940-8d9d-b438bab269c7` and v2 `3db34ab5-3439-4317-9e03-08dc30852e69`. Soul Cinema ignores `style_id`. `style_strength` is accepted on v2 but has no effect.
- **Genjutsu Restyle presets** — `GET /models/{studio}/genjutsu/restyle/v1.0/presets` (note the `/models/` prefix) → `{model, items:[{id, name, preview_url}]}`. Send `items[].id` as `preset_id`. The preset is required, and only one is allowed per request.
- **Marketing Studio presets** — `GET /marketing-studio/image/presets?search=&size=50&cursor=0` → `{total, cursor|null, items:[{id, type, name, cover_image, metadata:{aspect_ratio, group_name}, format_slugs[]}]}`. `preset_id` is required when `enhance_prompt=true`, together with 1–2 images (product first, then an optional model).
- **Kling `elements[]`** — Kling element IDs as decimal strings that must belong to the calling account. **No endpoint to create elements is documented**, so treat this field as unusable for now.

---

## 3. Priority endpoints → the studio's UI feature

Prices are **list USD** from the pricing API. Most modes currently carry a launch discount of 15–60%, shown in the JSON as `currentUsd`. Per-second prices are per output second unless noted. The pricing API lists only sample configurations (usually the cheapest and the most expensive), so for an exact quote call `/estimate`.

| UI feature ({studio-site}) | Endpoint | Op | Key inputs | List price | Conf. |
|---|---|---|---|---|---|
| **Soul (v1)** image + styles | `POST /{studio}/soul/standard` | t2i | `prompt`*; `aspect_ratio` (9:16,16:9,4:3*,3:4,1:1,2:3,3:2), `resolution` 720p\*/1080p, `batch_size` 1\|4, `style_id`, `style_strength`, `custom_reference_id`, `custom_reference_strength`, `image_reference_url`, `seed`, `enhance_prompt` | $0.0938 (720p) / $0.1875 (1080p) per image | high (see discrepancy) |
| **Soul 2.0** | `POST /{studio}/soul/v2/standard` | t2i | `prompt`*; same aspect set (default 1:1), 720p/1080p, `batch_size` 1\|4, `style_id`, `custom_reference_id`(+strength >0), `seed` 1–1e6 | $0.0032 / $0.0057 per image | high |
| Soul 2.0 with reference image | `POST /{studio}/soul/v2/image-to-image` | edit | `prompt`*, `image_url`*; aspect (default 4:3), res, `batch_size`, `style_id`, `custom_reference_id` (v2), `enhance_prompt` (default **true**) | $0.0032 / $0.0057 | medium — schema from console per-model doc and pricing API only; **not in the docs catalog** |
| **Soul Cinema** | `POST /{studio}/soul/cinema` | t2i | `prompt`*; aspect (default 1:1), 720p/1080p, `batch_size`, `custom_reference_id` (cinema), `seed`; fixed style | **not published** | high (schema); price unknown; "may be absent from model discovery" |
| **Soul ID** (create character) | `POST /v1/custom-references` / `GET /v1/custom-references/{id}` / `GET …/list` | train | see §2 | not published | high (create/get); list = SDK only |
| **Marketing Studio — Image** | `POST /marketing-studio/image` (2.0 Alpha), `/image/flare` (GPT Image 2.5 Flare), `/image/sunburst` | t2i+edit | `prompt`* (≤5000), `image_urls[]` ≤16, `preset_id`, `enhance_prompt`, `quality` (Alpha: low/medium/high; Flare/Sunburst: +xhigh/max), `resolution` 1k/2k\*/4k, `aspect_ratio` auto\*/…, `moderation` auto/low | Flare/Sunburst $0.0126 (1k) – $0.7219 (4k); Alpha $0.0162 – $0.7219; token-metered | high |
| **Ads Studio** (brief → ad concepts) | `POST /{studio}/ads-studio/v1.0` | t2i | `prompt`* (brief ≤8000), `image_urls[]` ≤10 (product), `target_audience`, `niche`, `language`, `aspect_ratio` (14 values, default 1:1, no auto), `batch_size` 1–8 | ≈$0.084 per image (token-metered: text in $5 / out $10, image in $8 / out $30 per 1M) | high |
| **AI Influencer** (Apps) | `POST /{studio}/ai-influencer` | avatar | `tier` (normal\*/freak/total/insects/frogs/cats/dogs/capybaras/birds), `brief` ≤4000, `image_url`, `item_image_urls[]` ≤3, `selection{}`, `trait_variants`, `body_color` #hex, `pinned_species`, `variation_index`, `seed` | $0.05 per sheet | medium — console-only schema; complex `allOf`/`if` rules, so copy the full schema from the source |
| **Genjutsu — Motion transfer** | `POST /{studio}/genjutsu/motion-transfer/v1.0` | motion-transfer | `video_url`* (≥4 s, trimmed to 30 s), `image_urls[]`* 1–8, `prompt`, `resolution` 480p/720p\*/1080p | $0.318 / $0.681 / $1.632 per **input-video** second (rounded up); now 50% off | high |
| **Genjutsu — Object swap** | `POST /{studio}/genjutsu/object-swap/v1.0` | v2v | same as motion transfer; source ≥409,600 px per frame | same | high |
| **Genjutsu — Restyle** | `POST /{studio}/genjutsu/restyle/v1.0` | v2v | `video_url`* (4–30 s, ≤200 MiB, audio kept), `preset_id`* (uuid from presets), `image_urls[]` ≤5 character refs, `prompt`, `resolution`; `null` not accepted | ≈ same per-second tiers | high |
| **Cinema Studio 4.0** | `POST /{studio}/cinema-studio/4.0` | t2v / ref2v | `prompt`*, `duration` 4–30 (5), `resolution` 480p/720p\*, `aspect_ratio`, `generate_audio` (true), `image_urls` ≤30, `video_urls` ≤10, `audio_urls` ≤10 (≤50 total), director controls: `genre`, `era`, `light`, `pacing`, `camera_model`, `camera_lens`, `camera_aperture`, `camera_movement` (33 values), `color_palette` (50 named grades). Omit a control to let the director choose ("auto" is rejected). | $0.2057/s (480p) – $0.4623/s (720p); token-metered | high |
| **Seedance 2.5** t2v / i2v / ref2v | `POST /bytedance/seedance-2.5/{text-to-video,image-to-video,reference-to-video}` | t2v / i2v(+flf2v) / ref2v | `prompt`, `duration` 4–30 (5), `resolution` 480p/720p\*/1080p, `aspect_ratio` (t2v/ref2v), `bitrate_mode` standard/high\*, `generate_audio` (true), `output_format` mp4/mov (t2v only), i2v: `image_url`*, `end_image_url`; ref2v: `image_urls` ≤30, `video_urls` ≤10, `audio_urls` ≤10 | ≈$0.2057/s 480p · $0.4622 720p · $1.1372 1080p (16:9) | high |
| **Seedance 2.5 video edit** | `POST /bytedance/seedance-2.5/video-edit` | v2v | `prompt`*, `video_url`*, refs; **no `duration`** (taken from the source) | 0.6× token rate on input + output seconds (≈$0.1234/s 480p…$0.6823/s 1080p combined) | high |
| **Seedance 2.5 video extend** | `POST /bytedance/seedance-2.5/video-extend` | v2v | `prompt`*, `video_url`*, `duration` 4–30 (5), `resolution`, `bitrate_mode`, `generate_audio`, refs (`video_urls` ≤9 extra) | same as edit; input seconds are billed too | high |
| Seedance 2.5 **draft** mode | — | — | **not exposed** (fal has `draft`; the studio's schema is `additionalProperties:false`) | — | high (absence) |
| **Kling 3.0** std / pro / 4k | `POST /kling-video/v3.0/{std,pro,4k}/{text-to-video,image-to-video}` | t2v / i2v(+flf2v) | `prompt`, `duration` 3–15 (5), `sound` on\*/off, `cfg_scale` 0–1, `aspect_ratio` 16:9/9:16/1:1 (t2v), `image_url`* + `last_image_url` (i2v), `multi_shots` + `multi_prompt[{prompt≤512,duration 1–15}]` ≤6, `elements[]` | std $0.084/s, pro $0.112/s, 4k $0.42/s (rising to $0.126 / $0.168 at 15 s per the pricing configs) | high |
| Kling 3.0 Turbo | `POST /kling-video/v3.0-turbo/{text-to-video,image-to-video}` | t2v/i2v | `prompt`*, `duration` 3–15, `resolution` 720p/1080p (+`image_url`) | $0.112 (720p) / $0.14 (1080p) per s | high |
| **Kling 3.0 Motion Control** | `POST /kling-video/v3/motion-control/{std,pro}` | motion-transfer | `image_url` (character), `video_url` (3–30 s motion source), `character_orientation` image/video, `keep_original_sound` yes\*/no, `prompt` | std $0.126/s, pro $0.168/s | high |
| Kling O3 / Omni (O1) | `/kling-video/{o3,omni}/{first-last-frame,image-reference,video-reference,video-edit}` | flf2v / ref2v / v2v | `first_frame_url`/`last_frame_url`, `image_urls`, `video_url`, `elements`, multi-shot | $0.084–0.168/s | high |
| **DoP** (image-to-video with motion presets) | *legacy* `POST /v1/image2video/dop`, `GET /v1/motions` | i2v | `{"params":{model: dop-lite\|dop-turbo\|dop-standard, prompt, input_images:[{type:"image_url",image_url}], motions:[{id,strength}], seed, enhance_prompt}}` → job-set polled at `/v1/job-sets/{id}` | not published | **low** — SDK only; not in the v2 catalog or pricing; may be retired. The current product's closest v2 equivalent is Cinema Studio 4.0 `camera_movement`, or any i2v model. |
| **Speak / Lipsync** | *legacy* `POST /v1/speak/{studio}` | lipsync | `{"params":{input_image:{type:"image_url",image_url}, input_audio:{type:"audio_url",audio_url}, prompt, quality: mid\|high, duration: 5\|10\|15, seed}}` | not published | **low** — SDK only. No v2 lipsync endpoint exists. Driving audio is available on Wan 2.7 i2v/t2v (`audio_url`) and as audio refs on Seedance 2.5, Cinema Studio and Grok Video. |
| **Popcorn** | — | — | **not found** in the docs, pricing API (31 families) or SDKs | — | high (absence) |

\* = required, or the default value.

Other catalog families (all verified, see the full table below): Seedance 2.0, Kling 2.5 Turbo / 2.6 (+ 2.6 motion control), Wan 2.6 / 2.7 / 3.0 / 3.0 Prime, Happy Horse 1.0 / 1.1, MiniMax H3, Hailuo 2.3, LTX-2.5, PixVerse V6, Grok Imagine Video 1.5, Grok Image 2.0, Ideogram 4.0, Recraft V4.1 (4 variants), Qwen Image 3 (t2i/edit), Z-Image Turbo.

---

## 4. Discrepancies and gotchas

1. **The OpenAPI file is stale for Soul standard.** `/docs/openapi.json` gives `num_images` 1–4, `resolution` 2K/4K and a 10-value aspect list. The model page gives `batch_size` 1|4, `resolution` 720p/1080p, 7 aspects, plus `style_id`, Soul ID and `image_reference_url`. The console per-model doc for the same slug omits the three Soul ID / reference fields. The JSON follows the docs model page. Validate with `/estimate` (free) before you ship Soul-ID-on-v1.
2. **Paths that differ from the inventory summary.** The Restyle presets route is `/models/{studio}/genjutsu/restyle/v1.0/presets`. Soul ID list is `/v1/custom-references/list`; a bare `GET /v1/custom-references` returns 405.
3. Legacy misspelled aliases `{studio-misspelled}/genjutsu/{motion-transfer,object-swap}/v1.0` still work but are hidden. Use the `{studio}/…` spelling.
4. Field names are **not uniform**: Kling 3.0 uses `image_url`+`last_image_url`; Kling O3/Omni use `first_frame_url`+`last_frame_url`; Seedance/Wan 3.0/LTX/PixVerse/MiniMax use `end_image_url`. Kling uses `sound: "on"|"off"`, motion control uses `keep_original_sound: "yes"|"no"`, and others use `generate_audio: bool`. The adapter needs a per-endpoint field map; the JSON has every name.
5. Schemas vs runtime: several pages flag limits enforced only at submission (Happy Horse ref2v 1–9 images, Wan 2.7 ref ≤5 total refs, Grok video 1080p rejected in reference mode, Soul v2 `custom_reference_strength=0` fails, Wan 3.0 `seed=0` is ignored). These are recorded in each record's `notes`.
6. Webhook payloads nest outputs under `payload`, while the status endpoint puts them at the top level.
7. The pricing API's `amount` is the **current discounted** price and `original_amount` is the list price (`null` means there is no discount). The inventory's figures match `original_amount`.
8. Seedance 2.5 edit/extend bill **input + generated** seconds at 0.6× the token rate. The pricing-API "from $0.2468/s" assumes equal input and output length.

## 5. Not found / blockers

- **No v2 endpoints exist** for DoP, Speak/Lipsync, Popcorn, Seedance draft mode, Soul ID delete/update, or Kling element creation. Soul Cinema and Soul ID training have no published price.
- No API credentials, so nothing was called live. Output examples are the documented ones.
- The two console-only models (`soul/v2/image-to-image`, `{studio}/ai-influencer`) are priced and have schemas, but they are absent from the 84-entry docs catalog. They may be gated per account.

---

## 6. Full endpoint table (generation endpoints, all `verified:true`)

| Path | Operation | Required | Optional media / ID fields | Output | List price from |
|---|---|---|---|---|---|
| `/{studio}/ads-studio/v1.0` | t2i | prompt | image_urls | images[].url | $0.084/img |
| `/{studio}/cinema-studio/4.0` | t2v+ref2v | prompt | audio_urls, image_urls, video_urls | video.url | $0.2057/s |
| `/{studio}/genjutsu/motion-transfer/v1.0` | motion-transfer | video_url, image_urls | — | video.url | $0.318/s (now $0.159) |
| `/{studio}/genjutsu/object-swap/v1.0` | v2v | video_url, image_urls | — | video.url | $0.318/s (now $0.159) |
| `/{studio}/genjutsu/restyle/v1.0` | v2v | preset_id, video_url | image_urls | video.url | formula |
| `/xai/grok-imagine-image-2.0` | t2i+edit | prompt | image_urls | images[].url | $0.04/img |
| `/xai/grok-imagine-video/v1.5/reference-to-video` | ref2v+t2v/i2v | prompt | audio_url, image_url, image_urls | video.url | $0.08/s |
| `/minimax/hailuo-2.3/standard/image-to-video` | i2v | prompt, image_url | — | video.url | $0.0467/s (now $0.0117) |
| `/minimax/hailuo-2.3/standard/text-to-video` | t2v | prompt | — | video.url | $0.0467/s (now $0.0117) |
| `/alibaba/happy-horse/v1.1/image-to-video` | i2v | image_url | — | video.url | $0.14/s (now $0.07) |
| `/alibaba/happy-horse/v1.1/reference-to-video` | ref2v | prompt, image_urls | — | video.url | $0.14/s (now $0.07) |
| `/alibaba/happy-horse/v1.1/text-to-video` | t2v | prompt | — | video.url | $0.14/s (now $0.07) |
| `/alibaba/happy-horse/image-to-video` | i2v | image_url | — | video.url | $0.14/s (now $0.07) |
| `/alibaba/happy-horse/reference-to-video` | ref2v | prompt, image_urls | — | video.url | $0.14/s (now $0.07) |
| `/alibaba/happy-horse/text-to-video` | t2v | prompt | — | video.url | $0.14/s (now $0.07) |
| `/ideogram/v4.0` | t2i+edit | prompt | image_url | images[].url | $0.03/img |
| `/kling-video/v2.5-turbo/pro/image-to-video` | i2v | prompt, image_url | — | video.url | $0.07/s (now $0.035) |
| `/kling-video/v2.5-turbo/pro/text-to-video` | t2v | prompt | — | video.url | $0.07/s (now $0.035) |
| `/kling-video/v2.5-turbo/standard/image-to-video` | i2v | prompt, image_url | — | video.url | $0.042/s (now $0.021) |
| `/kling-video/motion-control/pro` | motion-transfer | image_url, video_url | — | video.url | $0.112/s (now $0.056) |
| `/kling-video/motion-control/std` | motion-transfer | image_url, video_url | — | video.url | $0.07/s (now $0.035) |
| `/kling-video/v2.6/pro/image-to-video` | i2v | prompt, image_url | — | video.url | $0.07/s (now $0.035) |
| `/kling-video/v2.6/pro/text-to-video` | t2v | prompt | — | video.url | $0.07/s (now $0.035) |
| `/kling-video/v3/motion-control/pro` | motion-transfer | image_url, video_url | — | video.url | $0.168/s (now $0.084) |
| `/kling-video/v3/motion-control/std` | motion-transfer | image_url, video_url | — | video.url | $0.126/s (now $0.063) |
| `/kling-video/v3.0/4k/image-to-video` | i2v+flf2v | image_url | elements, last_image_url | video.url | $0.42/s (now $0.21) |
| `/kling-video/v3.0/4k/text-to-video` | t2v | — | elements | video.url | $0.42/s (now $0.21) |
| `/kling-video/v3.0/pro/image-to-video` | i2v+flf2v | image_url | elements, last_image_url | video.url | $0.112/s (now $0.056) |
| `/kling-video/v3.0/pro/text-to-video` | t2v | — | elements | video.url | $0.112/s (now $0.056) |
| `/kling-video/v3.0/std/image-to-video` | i2v+flf2v | image_url | elements, last_image_url | video.url | $0.084/s (now $0.042) |
| `/kling-video/v3.0/std/text-to-video` | t2v | — | elements | video.url | $0.084/s (now $0.042) |
| `/kling-video/v3.0-turbo/image-to-video` | i2v | prompt, image_url | — | video.url | $0.112/s (now $0.056) |
| `/kling-video/v3.0-turbo/text-to-video` | t2v | prompt | — | video.url | $0.112/s (now $0.056) |
| `/kling-video/o3/first-last-frame` | flf2v | — | last_frame_url, first_frame_url | video.url | $0.084/s (now $0.042) |
| `/kling-video/o3/image-reference` | ref2v | — | elements, image_urls, last_frame_url, first_frame_url | video.url | $0.084/s (now $0.042) |
| `/kling-video/o3/video-edit` | v2v | prompt, video_urls | elements, image_urls | video.url | $0.126/s (now $0.063) |
| `/kling-video/o3/video-reference` | ref2v | prompt, video_urls | elements, image_urls | video.url | $0.126/s (now $0.063) |
| `/kling-video/omni/first-last-frame` | flf2v | prompt, first_frame_url | last_frame_url | video.url | $0.084/s (now $0.042) |
| `/kling-video/omni/image-reference` | ref2v | prompt | elements, image_urls | video.url | $0.084/s (now $0.042) |
| `/kling-video/omni/video-edit` | v2v | prompt, video_urls | elements, image_urls | video.url | $0.126/s (now $0.063) |
| `/kling-video/omni/video-reference` | ref2v | prompt, video_urls | elements, image_urls | video.url | $0.126/s (now $0.063) |
| `/lightricks/ltx-2.5/image-to-video/fast` | i2v+flf2v | prompt, duration, image_url | end_image_url | video.url | $0.09/s |
| `/lightricks/ltx-2.5/image-to-video/pro` | i2v+flf2v | prompt, duration, image_url | end_image_url | video.url | $0.12/s |
| `/lightricks/ltx-2.5/text-to-video/fast` | t2v | prompt, duration | — | video.url | $0.09/s |
| `/lightricks/ltx-2.5/text-to-video/pro` | t2v | prompt, duration | — | video.url | $0.12/s |
| `/marketing-studio/image/flare` | t2i+edit | prompt | preset_id, image_urls | images[].url | $0.0126/img (now $0.0107) |
| `/marketing-studio/image` | t2i+edit | prompt | preset_id, image_urls | images[].url | $0.0162/img (now $0.0138) |
| `/marketing-studio/image/sunburst` | t2i+edit | prompt | preset_id, image_urls | images[].url | $0.0126/img (now $0.0107) |
| `/minimax/h3/image-to-video` | i2v+flf2v | prompt, image_url | end_image_url | video.url | $0.13/s (now $0.065) |
| `/minimax/h3/reference-to-video` | ref2v | prompt | audio_urls, image_urls, video_urls | video.url | $0.13/s (now $0.065) |
| `/minimax/h3/text-to-video` | t2v | prompt | — | video.url | $0.13/s (now $0.065) |
| `/pixverse/v6/image-to-video` | i2v+flf2v | prompt, image_url | end_image_url | video.url | $0.115/s (now $0.0978) |
| `/pixverse/v6/text-to-video` | t2v | prompt | — | video.url | $0.115/s (now $0.0978) |
| `/alibaba/qwen-image-3/edit` | edit | prompt, image_urls | — | images[].url | $0.04/img |
| `/alibaba/qwen-image-3/text-to-image` | t2i | prompt | — | images[].url | $0.04/img |
| `/recraft/v4.1/pro/text-to-image` | t2i | prompt | — | images[].url | $0.21/img |
| `/recraft/v4.1/utility/pro/text-to-image` | t2i | prompt | — | images[].url | $0.21/img |
| `/recraft/v4.1/utility/text-to-image` | t2i | prompt | — | images[].url | $0.035/img |
| `/recraft/v4.1/text-to-image` | t2i | prompt | — | images[].url | $0.035/img |
| `/bytedance/seedance-2.5/image-to-video` | i2v+flf2v | image_url | end_image_url | video.url | $0.2057/s (now $0.144) |
| `/bytedance/seedance-2.5/reference-to-video` | ref2v | — | audio_urls, image_urls, video_urls | video.url | $0.2468/s (now $0.1728) |
| `/bytedance/seedance-2.5/text-to-video` | t2v | prompt | — | video.url | $0.2057/s (now $0.144) |
| `/bytedance/seedance-2.5/video-edit` | v2v | prompt, video_url | audio_urls, image_urls, video_urls | video.url | $0.2468/s (now $0.1728) |
| `/bytedance/seedance-2.5/video-extend` | v2v | prompt, video_url | audio_urls, image_urls, video_urls | video.url | $0.2468/s (now $0.1728) |
| `/bytedance/seedance-2.0/image-to-video` | i2v+flf2v | image_url | end_image_url | video.url | $0.1407/s (now $0.0985) |
| `/bytedance/seedance-2.0/reference-to-video` | ref2v | — | audio_urls, image_urls, video_urls | video.url | $0.1688/s (now $0.1182) |
| `/bytedance/seedance-2.0/text-to-video` | t2v | prompt | — | video.url | $0.1407/s (now $0.0985) |
| `/{studio}/soul/v2/standard` | t2i | prompt | custom_reference_id, style_id | images[].url | $0.0032/img |
| `/{studio}/soul/cinema` | t2i | prompt | custom_reference_id | images[].url | — |
| `/v1/custom-references` | train | name, input_images | — | custom_reference | — |
| `/{studio}/soul/standard` | t2i | prompt | style_id, custom_reference_id, image_reference_url | images[].url | $0.0938/img |
| `/wan/v2.6/image-to-video` | i2v | prompt, image_url | audio_url | video.url | $0.1/s (now $0.05) |
| `/wan/v2.6/reference-to-video` | ref2v | prompt, video_urls | — | video.url | $0.1/s (now $0.05) |
| `/wan/v2.6/text-to-video` | t2v | prompt | audio_url | video.url | $0.1/s (now $0.05) |
| `/wan/v2.7/image-to-video` | i2v+flf2v | image_url | audio_url, end_image_url | video.url | $0.1/s (now $0.05) |
| `/wan/v2.7/reference-to-video` | ref2v | prompt | image_urls, video_urls | video.url | $0.1/s (now $0.05) |
| `/wan/v2.7/text-to-video` | t2v | prompt | audio_url | video.url | $0.1/s (now $0.05) |
| `/alibaba/wan-3.0-prime/image-to-video` | i2v+flf2v | prompt, image_url | end_image_url | video.url | $0.068/s (now $0.0272) |
| `/alibaba/wan-3.0-prime/reference-to-video` | ref2v | prompt | file_url, link_url, audio_urls, image_urls, video_urls | video.url | $0.068/s (now $0.0272) |
| `/alibaba/wan-3.0-prime/text-to-video` | t2v | prompt | — | video.url | $0.068/s (now $0.0272) |
| `/alibaba/wan-3.0/image-to-video` | i2v+flf2v | prompt, image_url | end_image_url | video.url | $0.05/s (now $0.02) |
| `/alibaba/wan-3.0/reference-to-video` | ref2v | prompt | file_url, link_url, audio_urls, image_urls, video_urls | video.url | $0.05/s (now $0.02) |
| `/alibaba/wan-3.0/text-to-video` | t2v | prompt | — | video.url | $0.05/s (now $0.02) |
| `/z-image/turbo` | t2i | prompt | — | images[].url | $0.015/img |
| `/{studio}/soul/v2/image-to-image` | edit | prompt, image_url | style_id, custom_reference_id | images[].url | $0.0032/img |
| `/{studio}/ai-influencer` | avatar+edit | — | image_url, item_image_urls | images[].url | $0.05/img |

Auxiliary routes (status, cancel, upload, estimate, Soul ID get/list, style and preset lists, `/models`) and the 4 legacy v1 routes appear in the JSON with their own `verified` flags.
