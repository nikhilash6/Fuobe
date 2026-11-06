# The studio's delta, round 4 (since the round-3 inventory)

_In this file, "the studio" means the closed AI image and video studio that this research measures Fuobe against._

_As of 2026-10-22. Machine-readable twin: [`parity-delta-4.json`](parity-delta-4.json). This updates [`parity-inventory.md`](parity-inventory.md) (as of 2026-10-16), [`parity-studios.md`](parity-studios.md), [`parity-image-studios.md`](parity-image-studios.md) and [`parity-marketing-agents.md`](parity-marketing-agents.md), and is measured against [`../STATUS.md`](../STATUS.md) §2 (round 3)._

**How this was researched (all on 2026-10-22).** Logged-in screens were not observed. The findings come from:

1. The changelog RSS (`/creator-hub/changelog/rss.xml`, 131 entries, last build 2026-10-21 23:14 UTC) and the blog, creator-hub and apps sitemaps.
2. The production web bundle: build `1a2c0e3d`, 8,521 JS chunks crawled from `{studio-assets}/tanstack/assets/` (round 3 read build `868a8dba`). Option lists, defaults, validators and job payloads are read straight from code.
3. The per-route i18n catalogs (`/_i18n/routes/en/delta.<hash>.json`). Each current catalog was diffed against the round-3 hash of the same route to find new UI copy.
4. Public endpoints that answer without a login: `{studio-service}/job-sets/costs` (61 credit-cost rows), `{studio-service}/subscriptions/plans` (41 plan rows), `{studio-service}/api/templates`, `{studio-service}/pricing`.
5. The studio's open-source CLI and skills repos on GitHub (`{studio}/cli` at `fd21e7c`, 2026-10-17; `{studio}/skills` at `f83af0b`, v0.13.0), the CLI blog post (2026-10-19), four Community help articles, the PR Newswire release of 2026-10-19.
6. For the Fuobe routes: fal's model search and OpenAPI files, and Hugging Face model cards.

Anything reasoned from code rather than seen in the app is marked *(inferred)*. Anything not confirmed is marked **unverified**. Every source is listed at the end with its URL.

---

## 1. The short version

- **Eight changelog entries are newer than the inventory:** Kling 4.0 (Oct 21), Chinese UI (Oct 20), Genjutsu Lite (Oct 19), 3D Angles in the ChatGPT plugin (Oct 19), an Iman Gadzhi Discord contest and an Academy course (Oct 16), a new FLUX 3 Video Upscaler build and the public Community page (Oct 15).
- **New in the top navigation: "Content Factory" (`/content-factory`, internal name "What If").** It makes faceless short-video series from a trending reference. It runs in Claude through the MCP, or "here".
- **Unannounced studios are in the bundle.** These are **3D Jutsu** as a desktop web studio (live at `/3d-jutsu`), **Evolution** (a gated test model), **Tube / Reels Studio** (avatar reels), **AI Host** (YouTube avatar channels, returns 404) and a standalone **Video Editor** (404).
- **Video remove-object is real and priced, but on the web it is prompt editing.** The "Remove Object from Video" page sends users to Edit Video with **Kling 3.0 Omni Edit**. Separately, `remove_object` / `swap_object` jobs exist server-side at 3 / 4.5 / 12 credits per second plus 3.5 credits per frame edit. No web screen uses them, so they serve agents *(inferred)*.
- **The whole Upscale / video-tools menu is now readable from code.** It has 8 tools: Edit Video, Extend, Reframe, Upscale (4 models), Remove Background, SDR to HDR, FPS Boost and Depth Map, with every option, default and limit. That closes most of STATUS's 🟡 "Upscale video" row.
- **Cinema Studio's 3D scene is a Gaussian splat.** The image becomes a splat (3 credits), shown in a WebGL splat viewer with WASD fly controls and a focal-length / aperture / aspect panel. A **Capture** of the current view is then re-rendered by an image model (recomposition, 2 credits). The same tech now powers **3D Angles** in ChatGPT and **3D Jutsu**.
- **AI Influencer's builder is fully specified in code.** There are 19 categories and 3 human tiers (Average / Bold / Extreme). There are 6 creature types (insect, frog, cat, dog, rodent, bird) with 5–10 species each. The code also gives every option with its swatch hex, the slot rules, two conflict rules and the exact Shuffle weights.
- **The studio has an open-source CLI (MIT) and an 8-skill repo.** The CLI's model catalog adds 3D jobs (text-to-3D, multi-image-to-3D, rigging with animation presets, SAM 3D objects), "OpenAI Hazel" (the internal job family behind GPT Image 2 / 2.5) and TTS engines (`cozy_voice`, `vibe_voice`, `seed_speech`).
- **Community is now public.** It has Shots, Open Projects (With prompts or Prompts hidden), Blog posts, rating points and achievements, and Grants of up to 200,000 credits. Sharing has project-level "comment" and "reuse/duplicate" access, and Genjutsu setups can be shared by code.
- **Plan prices are now verified** from the public plans endpoint (Starter $15 / 200 credits, Pro $29 / 600, Plus $49 / 1,000, Ultra $129 / 3,000 and more). They are recorded in §5.
- **New paid routes for Fuobe's ⬜ rows exist on fal.** These are `topaz/interpolate/video`, `topaz/sdr-to-hdr/video`, `tripo3d/triposplat`, `fal-ai/sam-3/3d-objects`, `fal-ai/meshy/rigging` and `tripo3d/h3.1/text-to-3d`. `kling/v4/*` (Kling 4.0) is listed (2026-10-16), but it is **not callable yet**: every page says "Kling 4.0 is available in the playground and fal Agent. API access is coming soon." *(critic check 2026-10-22, see §8)*. **New open routes:** TripoSplat (MIT; native ComfyUI core nodes since template 2026-06-02), MoGe 2 / 3 whole-scene meshes (MIT, core nodes), UniRig (MIT), and the LTX-2.5 IC-LoRA SDR-to-HDR (LTX community licence). DiffuEraser is not a clean open route: its default pipeline needs ProPainter weights (S-Lab licence, non-commercial).

---

## 2. What changed since the round-3 inventory

### 2.1 Changelog (newest first)

| Date (UTC) | Entry | What it adds | In inventory? |
|---|---|---|---|
| 2026-10-21 | **Kling 4.0** | 3–30 s, 720p or 1080p, ARs 21:9 to 9:16, up to **10 keyframes**, up to **15 references** (images, up to 5 videos, a voice reference, Elements), "Creative Recreation" from an existing video, **Video Editing** (swap character, product, background, camera angle or style), stereo sound, voiceover in 9 languages. Launch discount. Route `/ai/video?model=kling4_0` → References, Frames or Edit video | no |
| 2026-10-20 | **Chinese language support** | Whole UI in Chinese. Switch from the profile menu or Supercomputer; signed-out users use the footer selector. Locales are now en, es, ja, ko, de, zh | no (zh missing) |
| 2026-10-19 | **Genjutsu Lite** | "A lighter version of Genjutsu for short clips, with a lower credit cost." Motion transfer and Objects swap only (no Restyle). Video 4–15 s per the changelog (the code says 4–30 s, see §4.2), up to 10 reference images, 720p or 1080p. Route `/ai/video?model=genjutsu-lite` | no |
| 2026-10-19 | **3D Angles** (ChatGPT plugin) | A photo, video or text becomes a 3D scene you reshoot. Lenses 24–300 mm, apertures f/1.4–f/16, 8 frame formats from 1:1 to 21:9. WASD to move, drag to rotate, scroll to zoom. Output is a photo or a video up to 30 s, and "draft videos let you check the camera move". Pick GPT-6 Astra first | no |
| 2026-10-16 | Iman Gadzhi Discord contest | $50,000 in 10 × $5,000 prizes; entries close 2026-10-24 | n/a (marketing) |
| 2026-10-16 | Academy course "AI Creation: First Steps" | Intro plus 7 lessons (1 h 42 min) with PDFs. Homework uses your generations from the last 3 days. LinkedIn certificate | n/a |
| 2026-10-15 | **FLUX 3 Video Upscaler update** | A new build replaced the old one in Upscale: sharper, faster and fewer credits. "Currently available only on the studio" | no |
| 2026-10-15 | **The studio's Community** | Public page with no login: Discovery (Featured Creators), Projects, Shots, Creators, Contests, Originals. Featured after 30 likes or via Grants. Grants of up to 200,000 credits for an Open Project with a video ≥ 1 min | partly (Community existed; public page, Grants terms, ratings are new) |
| 2026-10-13 | Unlimited Wan 3.0 for 7 days, 60% off on the API | Until 2026-10-31; plans from Pro up | yes |
| 2026-10-08 | Katana | — | yes |

### 2.2 Found in the site and bundle but not in the changelog

| Item | Evidence | Status |
|---|---|---|
| **Content Factory** (`/content-factory`, nav label "Content Factory · New", nav id "What If") | Header nav on every page; i18n delta `1a03ac397b`; chunks `x-gpkaootj6Z-tim.js` (`POST /what-if/compose`), `IAi1M8IkobQfft7U.js` | Live (§4.9) |
| **3D Jutsu web studio** (`/3d-jutsu`, `/3d-jutsu/$projectId`) | Page title "3D Jutsu • the studio"; delta `7dcfabc5a5` | Live, desktop only (§4.10) |
| **Evolution** (`hf_evolution`) | Video strings ("Upload a video and let Evolution take it further…"); cost row 7 credits/s at 720p; payload in `Np-SNe-7mCPEWBa9.js` | Gated: "TEST MODEL; VISIBLE ONLY FOR USERS WITH STUDIO AI/COM EMAIL" and "not available for this account" (§4.11) |
| **Tube / Reels Studio** (`/tube`) | Title "Tube \| The studio"; delta `be14edcb07`: "Create reels starring your avatar", "Write what the presenter says", "Use an uploaded audio as the voice", source video 10–120 s; job constant `TUBE_FACELESS_VIDEO = youtube_faceless_video` | Route renders. Not linked from nav **(unverified whether usable)** |
| **AI Host** (`/ai-host`, `/ai-host_/channels`, `/ai-host_/channel/$id`) | Delta `f60d5e91ef`: "Create your video host", "Set up avatar, voice & location", "Connect to YouTube", "Up to 20 minutes", topic genres, "Adjust in built-in editor & publish". Cost row `ai_host_video` 3.3 / 7.7 / 17.6 credits/s | Returns HTTP 404: unreleased |
| **Video Editor** (`/video-editor`) | Delta `ce33b42258`: "Use a remote project as this editor's storage?" (an editor that an agent session can attach to) | Returns 404: unreleased |
| **Seedance 2.0 4K free gens** (`/seedance-4k`) | Title "Seedance 2.0 in 4K free gens" | Promo page |
| **ElevenLabs Video to Music** (`elevenlabs_video_to_music`) | Cost row: `music_v1`, `music_v2` at 4 credits/min, `music_v2_5` at 9 credits/min | Priced. The screen was not found **(unverified)** |
| **Supercomputer Scheduled Tasks** | PR Newswire 2026-10-19: "Scheduled Tasks: automated runs, such as daily ad variations, weekly competitor scans, and recurring content calendars." Also "up to 100 UGC and ad variants per product in minutes", new AI Employees (Product Photographer, Motion Designer, Cartoon Animator, Podcast Producer) | Announced. UI strings not found in the web bundle **(unverified)** |
| **Custom MCP connector** in Supercomputer | Strings "Custom MCP connector (HTTP header)", "Custom MCP connector added" | Live *(inferred)* |
| **Telegram bot** | `/{studio}-telegram-intro`: "Your AI team for research, creative production, and recurring tasks - right inside Telegram". The MCP page now has tabs ChatGPT, Claude, Claude Code, Telegram, CLI, Other and names OpenClaw, Hermes Agent, NemoClaw | Live |
| **The studio's CLI** (MIT) | `{studio-github}/cli`; blog 2026-10-19 | Live (§4.12) |
| **Cinema Studio picks up Kling 4.0 and Genjutsu** | Cinema delta adds the Kling 4.0 limits, "Motion video", "Background control / Background source", "Scene reference", Genjutsu Lite strings, and contest-project lock copy ("Contest projects are read-only while the jury is reviewing") | Live |
| **Creator profile upgrades** | Profile delta: "Member since", "Creators' rating points", "Copy Discord username", "Add your location", "credits spent" counter, "Selected", "No weekly challenge right now" | Live |
| **Credit-pack promos in Supercomputer** | "+N% bonus credits", "This is the lowest price this offer will ever be", "With limited-offer promocode" | Monetisation only |
| **Pricing perks** | "Genjutsu Lite" free-generation row; "Nano Banana Pro, Nano Banana 2 & Kling 3.0 Unlimited"; "Unlimited until November 30"; "SOC 2-aligned controls"; "Unlimited members & Dedicated capacity" | Live |

**No new Apps:** the apps sitemap has 100 URLs. The 8 not in the inventory's 94 are category pages (`video-editing`, `trending-templates`, `games-characters`, `face-identity`, `extras`, `enhance-style`, `camera-motion`, `ads-products`). **No new camera motions, effects or Mixed Media presets:** the sitemaps still list 229 motion pages and 33 Mixed Media presets. **No new Canvas templates:** the same 5 still come from `{studio-service}/api/templates`.

### 2.3 New or newly named models

| Model | Vendor | Kind | Where on the studio | fal | Replicate |
|---|---|---|---|---|---|
| **Kling 4.0** (`kling4_0`) | Kuaishou | video: text, image/keyframes, references, edit | `/ai/video?model=kling4_0`, `/kling-4-0-intro`, Cinema Studio | **listed, playground-only**: `kling/v4/text-to-video`, `kling/v4/image-to-video`, `kling/v4/reference-to-video`, `kling/v4/video-to-video/edit` (listed 2026-10-16; "API access is coming soon" on 2026-10-22) | no (2026-10-22: `kwaivgi` lists up to v3) |
| Kling 4.0 Flash | Kuaishou | video drafts, 720p, ≤ 20 s | landing page only; no `kling4_0_flash` id in the bundle | not found | no |
| **Genjutsu Lite** (`hf_mult_motion_control_flash`, `hf_mult_replace_object_flash`) | The studio | video-to-video | `/ai/video?model=genjutsu-lite`; API `genjutsu-light/{motion-transfer,object-swap}/v1.0` | no | no |
| **Evolution** (`hf_evolution`) | The studio | video-to-video ("evolve" a clip) | gated test model | no | no |
| FLUX 3 Video Upscaler (new build, Oct 15) | Black Forest Labs | video upscale | Upscale → FLUX.3 Upscale | `blackforestlabs/flux-video-upscale` (listed 2026-08-20; whether it serves the new build is **unverified**) | no |
| "OpenAI Hazel" (`openai_hazel`, `openai_hazel_mini`) | OpenAI | image | internal job family behind GPT Image 2 / 2.5 / `imagegen_2_0`; listed as its own id in the CLI (AR 1:1, 3:2, 2:3, auto; quality low/medium/high; ≤ 16 refs) | n/a | n/a |
| Text to 3D (`tripo_3d`) | Tripo *(inferred from name and params)* | 3D | CLI only | `tripo3d/h3.1/text-to-3d` | — |
| Image / Multi-Image to 3D (`image_to_3d`, `multi_image_to_3d`) with rigging and animation presets | **unverified** (the params match Meshy: `enable_rigging`, `animation_action_id`, `pose_mode`, `topology`, `symmetry_mode`) | 3D | CLI; 3D Jutsu | `meshy/v7.1/multi-image-to-3d`, `fal-ai/meshy/rigging` | — |
| 3D Objects (`sam_3_3d`) | Meta (SAM 3D) | 3D from an image | CLI | `fal-ai/sam-3/3d-objects` (GLB plus Gaussian splat) | — |
| 3D Rigging (`3d_rigging`) | **unverified** (Meshy-like) | 3D | CLI | `fal-ai/meshy/rigging` | — |
| ElevenLabs Video to Music | ElevenLabs | audio | cost table only | `elevenlabs/music/v2`, `v2.5` exist; video input **unverified** | — |
| CosyVoice TTS engine (`text2speech_v2 --variant cozy_voice`) | Alibaba FunAudioLLM *(inferred)* | TTS | Audio / CLI | — | — |
| `p_image_ideogram` | Ideogram *(inferred)* | image, "thinking" levels very-low…high, 1K/2K, 0.1–1.0 credits | cost table only; no screen found **(unverified)** | — | — |

---

## 3. Prioritized gap table

P0 = a core creative feature a studio user would miss at once; P3 = nice to have. Effort: S ≤ 2 days, M ≤ 1 week, L ≤ 3 weeks, XL more. "STATUS" is `docs/STATUS.md` §2 (round 3).

| ID | Pri | Effort | Area | Gap | Fuobe now (STATUS) | Cloud route | Open route |
|---|---|---|---|---|---|---|---|
| G01 | **P0** | M | Video tools | **Remove object / erase from video** (prompt-driven, plus a mask option) | ⬜ "Remove object ⬜ (Edit video with a prompt is the closest)" | Kling O3 edit with the removal prompt (the studio's own route, already in the catalog; 3–15 s); `bria/video/erase/prompt` (≤ 5 s per call, `auto_trim`) and `bria/video/erase/mask`; `fal-ai/ltx-2.3-quality/clean-plate` (people only) | SAM 3.1 text mask → Wan 2.1 VACE inpaint (`video-inpaint-wan-vace` in comfyui-oss-4, with the Apache lightx2v LoRA, not the template's CC-BY-NC CausVid) or VOID (`video-erase-void`). Not DiffuEraser: its default pipeline needs ProPainter weights (S-Lab, non-commercial) |
| G02 | **P0** | S (when the API opens) | Models | **Kling 4.0**: references (≤ 10 img, ≤ 5 video, ≤ 7 elements, ≤ 15 total), up to 10 keyframes, edit, 3–30 s | not in catalog | **Blocked:** fal `kling/v4/*` is playground-only ("API access is coming soon", 2026-10-22); not on Replicate or the studio's API. Callable now for the keyframes mode: `blackforestlabs/flux-3-max/keyframes-to-video` (1–10 keyframes) | LTX-2.5 with core `LTXVAddGuide` (one per keyframe, `frame_idx`); Wan 2.2 FLF chained per keyframe pair (template `templates-6-key-frames`) |
| G03 | P1 | M | Upscale | **FPS Boost, SDR→HDR, pro codecs, and the full upscaler option sets** | 🟡 "Upscaling only. FPS boost, SDR→HDR and ProRes / EXR output ⬜" | `topaz/interpolate/video`; `topaz/sdr-to-hdr/video` (HDR10 H.265 or ProRes 422); `blackforestlabs/flux-video-upscale`; `topaz/upscale/video/*`; codecs through the fal FFmpeg tools | RIFE / GIMM-VFI / FILM; LTX-2.5 IC-LoRA SDR-to-HDR; VHS Video Combine ProRes / H.265 10-bit; EXR frame sequence |
| G04 | P1 | M | Genjutsu | **Genjutsu as a user flow on the open engine, plus Genjutsu Lite** | 🟢 cloud · ⬜ open | The studio `genjutsu/*` and `genjutsu-light/*`; fallbacks Kling 4.0 edit, Kling 3.0 Motion Control | Wan Animate 2 (motion transfer / recast); SAM 3.1 mask + Wan 2.2 Fun VACE (object swap); the Shorts restyle chain (restyle) |
| G05 | P1 | L | Cinema Studio | **3D scene + recomposition** (and 3D Angles camera reshoot) | ⬜ | Whole scene: `fal-ai/marigold-v2` depth → browser point cloud, or World Labs Marble (separate key) → capture → Nano Banana Pro / Qwen 2511 multiple-angles re-render. `tripo3d/triposplat` and `fal-ai/sam-3/3d-objects` rebuild the subject / objects only (background removed). Video: camera path → keyframes → FLUX 3 Max keyframes / Seedance 2.5 | Whole scene: `scene-mesh-moge` (core MoGe 2 → textured GLB; **ran on CPU**, see comfyui-oss-4 §i) → browser viewer → Qwen-Image-Edit 2511 (+ Multiple-Angles LoRA) re-render. Subject: `image-to-splat-triposplat` (core TripoSplat nodes, validated) |
| G06 | P1 | M | Characters | **AI Influencer game-style builder** (19 categories, 3 tiers, 6 creature types) | 🟡 "game-style builder … is not reproduced" | The studio `ai_influencer` sheet (key), else Nano Banana Pro / Seedream 5.0 with the compiled prompt | Soul Cast sheet workflow (Z-Image Turbo) with the compiled prompt; Qwen-Image-Edit 2511 for "Add your face" |
| G07 | P1 | M | Studios | **Content Factory** (faceless series from a trending reference, run here or in Claude) | Faceless Studio 🟢 has no trend reference, link import or series | Fuobe Faceless pipeline; Claude reads the reference's frames and transcript | Same pipeline; the reference is read by Gemma 4 E4B (frames + sound in one core `TextGenerate` call, `reference-brief-gemma4`, validated) or Ollama Qwen3-VL. Core ComfyUI's Qwen3.5 encoder ignores a `video` input in v0.41 |
| G08 | P1 | L | Canvas | **Canvas extras**: pages, tables, comments, drawing and shapes, groups, folder node, Change Voice, Translate and Clone Voice nodes, the Video Concatenator editor | 🟡 "pages, tables, comments, drawing and shapes, Change Voice / Translate nodes and multiplayer aren't built" | Change Voice → ElevenLabs Voice Changer; Translate → the dub chain; Concatenator → fal FFmpeg compose | Chatterbox VC; the open dub chain; ComfyUI concat |
| G09 | P2 | M | Mixed Media | **Per-frame cloud pipeline** (the studio charges 2 credits per output frame) | 🟡 cloud ("a video-to-video restyle, not … per-frame") | Extract frames at the target fps → per-frame Nano Banana 2 / Seedream 5.0 Flash edit → `fal-ai/ffmpeg-api/images-to-video` → mux audio | Existing Z-Image per-frame route (🟢) |
| G10 | P2 | M | Library | **Assets library**: nested folders, pins, review status, projects, share access | ✅ base; "Missing: nested folders, pins, review status, projects" | n/a | n/a |
| G11 | P2 | L | Platform | **Share links and Community feed** (Shots, Open Projects, profiles, recreate) | ⬜ | n/a | n/a |
| G12 | P2 | S | Platform | **Browser notifications when a job finishes** | ⬜ | n/a | n/a |
| G13 | P2 | M | Platform | **CLI + skills repo + agent plugin manifests** | ⬜ "no Fuobe CLI or ChatGPT app"; MCP ✅ | n/a | n/a |
| G14 | P2 | S | Video tools | **Depth Map and Remove Background option parity** (colour maps, side by side, max frames; cutout vs alpha mask with a prompt) | 🟢, but with fixed options | Video Depth Anything; BiRefNet / SAM 3 video | Depth Anything 3 / VDA (the installed `VideoDepthAnythingOutput` offers only `gray` and `inferno`; Turbo / Magma / Viridis need a LUT step, unverified); SAM 3.1 + BiRefNet |
| G15 | P2 | M | 3D | **Text-to-3D, multi-image-to-3D, rigging + animation presets, SAM 3D objects** | 🟢 image-to-3D only | `tripo3d/h3.1/text-to-3d`, `meshy/v7.1/multi-image-to-3d`, `fal-ai/meshy/rigging` (+ `multi-animation`), `fal-ai/sam-3/3d-objects` | UniRig (MIT) for rigging; TRELLIS.2 for multi-view; text-to-3D as image then TRELLIS.2 |
| G16 | P2 | XL | Studios | **3D Jutsu** (agent-built 3D set → cameras, lights, motion → "Export to Seedance") | ⬜ (STATUS lists 3D Jutsu under Platform ⬜) | Claude writes a scene JSON → three.js editor → depth / pose / first-frame render → Seedance 2.5 or Kling 4.0 | Ollama scene JSON → same editor → Wan 2.2 Fun Control (depth) / VACE |
| G17 | P2 | M | Agents | **Scheduled tasks** in the agent (daily ad variations, weekly scans) | ⬜ | Claude via Assist plus a server scheduler | Ollama via Assist plus the scheduler |
| G18 | P3 | M | Platform | **Content checks**: face/IP eligibility, NSFW flags, rights confirmation, biometric consent | ⬜ | provider NSFW flags; optional cloud moderation | browser face detector; an open NSFW classifier |
| G19 | P3 | S | Video | **Evolution** (gated test model) | ⬜ | Kling 4.0 edit / Gemini Omni Flash edit with an intensity-scaled prompt | Wan 2.2 Fun VACE restyle, denoise from the intensity |
| G20 | P3 | M | Agents | **Telegram bot** and other agent surfaces (OpenClaw, Hermes, NemoClaw) | MCP ✅ | Assist on Claude behind a Telegram webhook | Assist on Ollama behind the same webhook |
| G21 | P3 | L | Platform | **Chinese (and es / ja / ko / de) UI** | English only *(inferred; no i18n layer found in `src/`)* | n/a | n/a |
| G22 | P3 | — | Studios | **Tube / Reels Studio, AI Host, standalone Video Editor** (all unreleased) | ⬜ | track only | track only |

---

## 4. Per-gap UX detail

### 4.1 G01 · Remove object from video

**Where the studio puts it.** The landing page `/remove-object-from-video` (title "Remove Object from Video - Erase People & Clutter with AI") shows a mock composer: **Prompt · Kling 3.0 Omni Edit · 1:1 · Remove Object**. Its buttons open `{studio-site}/ai/video/edit`. So on the web, erase is **Edit Video with a removal prompt**. The page also covers person, watermark, text, logo, vehicle, wire and crew removal.

**Copy worth reusing:**
- "Describe what to erase and AI Video Object Remover wipes people, wires, your own watermarks, and distractions from your footage, then fills the gap frame by frame."
- "For best results, keep the object clearly visible and the clip short. Need more detail? Run Kling 3.0 Omni Edit in 4K mode."

**Example prompts (verbatim):**
- "Remove the coffee cup from her hands and fix her fingers so they're just resting naturally, keep everything else the same."
- "Remove the pogo stick the guy is bouncing on, including the black handle grips in his hands and the platform under his feet, plus its shadow on the ground — make him just jump in the air, and fill in the patio behind it."

**Backend jobs.** The cost table has `remove_object` and `swap_object` at **480p 3 · 720p 4.5 · 1080p 12 credits/s**, each with `frame_credits: 3.5`. `draw_to_video` has the same shape. That suggests a first-frame image edit (3.5 credits) followed by video propagation *(inferred)*. Neither job type appears in the web client, so they serve agents (Supercomputer, MCP) *(inferred)*.

**Edit Video screen copy** (video delta):
- "Edit videos with text prompts", "Edit videos with images and prompts", "Add a video to edit", "Upload an MP4 video to edit"
- "This video uses an unsupported codec, such as ProRes. Convert it to H.264 and try again."
- "Elements in the prompt are only used in References and Edit video."

**Fuobe build.**
- Add a **Video tools → Remove object** tab with a prompt box ("Describe what to remove") and an optional brush or click mask on the first frame.
- Use the 3 example prompts as chips.
- Show a price per second.

**Routes:**
- **Cloud, prompt mode (default):** `bria/video/erase/prompt`.
  - Inputs: `video_url`, `prompt`, `auto_trim` (default true; trims to the 5 s working length), `preserve_audio` (default true), `output_container_and_codec` (mp4_h264 default; also mp4_h265, mov_proresks, webm_vp9 and others).
  - For clips over 5 s, cut segments with the existing segment tool, erase each, then join.
- **Cloud, mask mode:** `bria/video/erase/mask`.
- **Cloud, long clips (≤ 481 frames at 1–60 fps, 480p or 720p):** `fal-ai/ltx-2.3-quality/clean-plate`.
- **Cloud, fallback:** Kling O3 / 4.0 edit with the template "Remove {X} … keep everything else the same".
- **Open:** SAM 3.1 video mask from the text → Wan 2.1 VACE inpaint (`video_wan_vace_inpainting`, in round-1 research) or VOID (CogVideoX two-pass, core template `utility_void_video_inpainting`). Both are built and validated as `video-inpaint-wan-vace` and `video-erase-void` in [`comfyui-oss-4.md`](comfyui-oss-4.md) §b.
- **Not DiffuEraser** *(corrected by the round-4 critic)*. The HF weights (`lixiaowen/diffuEraser`) are tagged Apache-2.0, but the repo README says "This repository uses Propainter as the prior model" and lists the ProPainter weights (`ProPainter.pth`, `raft-things.pth`, `recurrent_flow_completion.pth`) in the download set "subject to ProPainter's license" (S-Lab License 1.0, non-commercial). Source: https://github.com/lixiaowen-xw/DiffuEraser (read 2026-10-22).
- **Avoid:** MiniMax-Remover (CC BY-NC 4.0) and the MiniMax H3 person-remover LoRA (H3's licence excludes US/EU/UK/KR).

### 4.2 G04 · Genjutsu as a user flow, and Genjutsu Lite

**Modes.** Motion transfer, Objects swap and Restyle. Mode copy from the video strings:
- Motion transfer: "The movement and camera stay exactly as filmed. Swap in your character."
- Objects swap: "Object swap accepts image references only"; "Precise Object Swap".
- Restyle: "Pick a style or bring your own image. Every frame takes the look — motion, camera, and framing stay as filmed. Add your characters if you want them in it."

**Limits from code:**

| | Genjutsu | Genjutsu Lite (`*_flash`) |
|---|---|---|
| Source video | 4–30 s ("Choose a source video between 4 and 30 seconds"; "The source video will be trimmed to 30 seconds"; under 4 s "will be extended to 4 seconds") | Code `GENJUTSU_FLASH_VIDEO_DURATION_MIN = 4`, `MAX = 30`. The changelog and API page say 4–15 s; the landing says "Up to 30s" (see §6) |
| References | "Transfer motion or swap objects with up to 10 reference images" ("Add between 1 and 10 reference images"). Restyle custom preset: up to `RESTYLE_CUSTOM_PRESET_IMAGE_LIMIT = 8` images | up to 10 images |
| Resolution | 480p / 720p / 1080p | 720p or 1080p ("Choose 720p or 1080p"). Object swap Lite has no 480p row in the cost table |
| Credits per second (web) | 3 / 7 / 20 (480p / 720p / 1080p) for both motion control and replace object | **1 / 2 / 4** now (list price 3 / 6 / 12) |
| API (USD) | `genjutsu/{motion-transfer,object-swap}/v1.0` from $0.318/s (promo $0.159) | `genjutsu-light/{motion-transfer,object-swap}/v1.0` from **$0.050/s** (promo $0.025), "4–15s · Up to 1080p" |
| Free generations | "Genjutsu free generations are in a shared queue and may take longer than usual. Use credits for faster results." | "Genjutsu Lite free generations" row on Pricing |

**Flow details:**
- **Pick a mode:** Motion transfer, Objects swap or Restyle (Restyle is not offered on Lite).
- **Add the source video** ("Show / Replace / Remove source video", "Crop it and choose the segment you want to use").
- **Add references:** images, or `@Elements` in the prompt.
- **Optional prompt.**
- **Pick a resolution and batch size:** "Generation started. Batch of {n} with no extra cost" appears on promos.
- **Generate.**

**Extras around the flow:**
- **Recreate** an example ("Recreate this example", "Genjutsu example video").
- Browse **Genjutsu presets** in "Community trending" and "Community new". The list comes from a login-gated endpoint (`/restyle-presets`, `/restyle/presets/custom`, 401 without a token), so preset names were not captured.
- **Share a setup by code:** routes `/genjutsu/shared/$code`.
- Hand-offs into Genjutsu: "Turn to motion with Genjutsu", "Add motion with Genjutsu" (AI Influencer) and "Use in Genjutsu".

**Fuobe build:**
- Make `/genjutsu` a studio with the three mode tabs, the 4–30 s trimmer, ≤ 10 reference slots (≤ 8 for a custom Restyle look), 480/720/1080p, and batch 1–4.
- Add "Lite" as a cheaper model choice inside motion transfer and object swap.
- **Cloud:** the Genjutsu and Genjutsu Light endpoints with a key. Without a key, use Kling 4.0 edit (swap character, product or background), Kling 3.0 Motion Control (motion transfer), and the Shorts restyle models (restyle).
- **Open:**
  - Motion transfer: Wan Animate 2 (already in Motion Control).
  - Object swap: SAM 3.1 mask of the named object → Wan 2.2 Fun VACE inpaint with the reference image.
  - Restyle: first-frame restyle with Qwen-Image-Edit 2511 → Wan 2.2 Fun VACE restyle (the Shorts chain).

### 4.3 G03 · Upscale video, FPS Boost, SDR→HDR and codecs

**The video tools menu.** The Video tools menu (`oa` in chunk `9V5-hD4mNN4X33gE.js`), in order:

| Tool | Description (copy) | Fields (options, **default**) | Model | Limits | Credits |
|---|---|---|---|---|---|
| Edit Video | "Make targeted changes" | opens the video edit mode | current edit model | — | per model |
| Extend | — | — | — | — | per model |
| Reframe | "Resize and reposition for any format" | Aspect ratio 9:16 (**default**), 3:4, 1:1, 4:3, 16:9, 21:9 · Quality 480p, **720p**, 1080p | Reframe | "Video is too long. Please upload a video up to 5 minutes." (300 s) | 3 / 4.5 / 12 per s + 3 images × 1 credit |
| Upscale | "Increase resolution and sharpen details" | four models, below | — | — | — |
| Remove Background | "Remove background or make a mask from video" | **Prompt** (required): "Describe which elements should be removed or saved" · Output format: **Cutout video** / Alpha mask | SAM 3 video (`sam_3_video`) | ≤ 200 MB, MP4/MOV | 0.225 credits/s at 24 fps reference |
| SDR to HDR (New) | "Convert SDR footage to HDR" | Output format: **H.265 10-bit** ("Higher fidelity at a similar size, with less playback support than H.264."), ProRes 10-bit ("Editing friendly intermediate codec. Much larger files."), EXR 16-bit ("Uncompressed frame sequence for compositing. Largest files.") | Topaz Hyperion 2.5 | ≤ 60 s, ≤ 100 MB, MP4/MOV; width and height must be multiples of 4 | 2.6 credits/s up to 1080p, 5.2 at 2K/4K (estimate) |
| FPS Boost (New) | "Increase frame rate with interpolation" | Frame rate 24, 30, **60**, 90, 120 FPS | Topaz (`fps_boost`) | ≤ 100 MB, MP4/MOV | see below |
| Depth Map (New) | "Make depth map from video" | Color map **Grayscale**, Turbo, Inferno, Magma, Viridis · Resolution **Auto**, 360p, 480p, 720p, 1080p · Max frames slider 1–**1800** · Side by side toggle ("Put the original video next to the depth map", off) | Video Depth Anything (`VDA-Large`) | 1,800 frames | 1.5 credits/s |

**Upscale models:**

| Model | Description | Fields (**default**) | Input limits | Credits/s |
|---|---|---|---|---|
| **FLUX.3 Upscale** | "Preserve the original or creatively enhance detail" | Output resolution 720p, 1080p, **2K**, 4K (only values valid for the source: "FLUX.3 Upscale doesn't support this video's resolution.") · Creativity **Precise** / Creative · Prompt "Describe details to preserve or enhance" | ≤ 20 s ("Select up to 20 seconds to upscale."), ≤ 50 MB, MP4 | by source → target. Precise: 480→720 0.5, 480→1080 1.75, 720→1080 1.75, 720→2K 3, 720→4K 8, 1080→2K 1.75, 1080→4K 6.5, 2K→4K 5. Creative is about 1.4× (now 50% off the list price) |
| **Topaz Starlight Precise** | "Recover natural detail in faces, textures, and text" | Resolution 1080p, **4K** · Frame rate **Original**, 24, 30, 60, 120 | ≤ 50 MB, MP4/MOV | `topaz_video` rate |
| **ByteDance Upscale** | "High-fidelity upscaling up to 8K with scene presets" | Model version **Standard** / Pro · Resolution **1080p**, 2K, 4K, 8K · Frame rate **30** / 60 · Preset **Common** ("Balanced enhancement for everyday footage"), AIGC ("Tuned for AI-generated video"), Short Series, UGC ("Best for user-generated and social clips"), Old Film ("Restores and enhances vintage footage") | ≤ 600 s, ≤ 50 MB, MP4/MOV | by target and fps (1080p 24–30 fps: 2; 4K: 7.5; 8K: 30) |
| **Topaz Video** | "Enhance and upscale low- to medium-quality footage" | Resolution Original, **1k** (FULL_HD), 2k, 4K · Preset Starlight Precise 2.5 (`slp-2.5`), **Proteus** (`prob-4`, "Default model for general upscaling"), Artemis (`ahq-12`, faces), Iris (`iris-3`, faces), Rhea (`rhea-1`, "For 4K+ video upscaling"), Gaia (`ghq-5`, cartoon and anime), Theia (`thd-3`, fine detail) · Frame rate Original / 24 / 30 / 60 / 120 | ≤ 50 MB, MP4/MOV | `topaz_video` rate (not in the public cost table) |

The Topaz parameter copy also lists: Recover Details, Sharpen, Reduce Noise, Revert Compression, Reduce Halo, Preblur, Grain (Strength, Size), Frame Interpolation, Slow motion, Render mode. Output is "capped at 13.75 megapixels per frame".

**FPS Boost pricing** (`fps_boost`, Topaz, credits per second by input → output fps):
- From 24 fps (to 30, 60, 90 or 120): 3.3 up to 1080p, 5.5 at 2K/4K.
- From 30 fps: 4.1 / 6.9.
- From 60 fps: 8.1 / 13.7.
- From 90 fps: 12.0 / 20.5.
- A ByteDance row also exists (by fps bucket, up to 8K: 2 to 120 credits/s).

**Other copy:**
- Older strings still present: "Balanced quality • 1 credits/sec", "Higher quality • 1.5 credits/sec".
- Download: "EXR archives are too large to bundle. Download them one at a time."

**Fuobe build:**
- Mirror the 8-tool menu and these field sets exactly.
- **Cloud:**
  - FPS Boost: `topaz/interpolate/video`. Fields: `target_fps` 16–120 (default 60), `slowdown_factor` 1–8, `model` Apollo / Chronos / Aion, `H264_output`. Fallbacks `fal-ai/rife/video`, `fal-ai/film/video`.
  - SDR→HDR: `topaz/sdr-to-hdr/video` with `output_format` mp4 (10-bit H.265 HDR10) or prores (10-bit ProRes 422 HQ). EXR is not offered there. Hosted EXR frames come only from `fal-ai/ltx-2.3-quality/hdr` (`exr_frames_url`) or Luma Ray 3.2 `exr_export`; fal has no transcode endpoint (see [`paid-model-apis-4.md`](paid-model-apis-4.md) §5), and the Fuobe server runs no ffmpeg today, so a cloud-only install cannot turn ProRes into EXR *(critic correction)*.
  - FLUX.3 Upscale: `blackforestlabs/flux-video-upscale`.
  - Topaz: `topaz/upscale/video/{precision,generative,creative}`.
- **Open:**
  - FPS: RIFE (already a Canvas-only model) or GIMM-VFI via ComfyUI-Frame-Interpolation.
  - SDR→HDR: `Lightricks/LTX-2.5-22b-IC-LoRA-SDR-To-HDR` (published 2026-09-28; LTX-2.x community licence, free under US$10M revenue), or the older LTX-2.3 HDR IC-LoRA.
  - Codecs: VHS Video Combine `video/ProRes` and H.265 10-bit (`yuv420p10le`): `video-export-pro` in comfyui-oss-4, ran on CPU.
  - EXR 16-bit: core `SaveImageAdvanced` with `format: exr` (`video-export-exr` in comfyui-oss-4, ran on CPU). No extra node pack is needed *(critic: replaces the earlier unverified ComfyUI-HQ-Image-Save suggestion)*.

### 4.4 G05 · Cinema Studio 3D scene and recomposition, plus 3D Angles

**What happens, from code:**

1. **"Create 3D scene"** is an overlay action on any image result, next to Inpaint, Skin enhancer, Angles, Relight, AI Stylist, Shots, Upscale, Next shots, Zooms, Face swap, Transition, Recast, Video face swap, Character swap and Extract hex. A confirm dialog reads "Generate 3D scene? This will render a 3D scene from your current image. Generation uses credits from your balance." with "Don't show this again". Job `cinematic_studio_image_3d` costs **3 credits** and needs one image ("At least one image").
2. The result type is `image_3d`, shown in a **Gaussian-splat viewer** (`ThreeDSceneModal`). The bundle ships a splat renderer (`gsplat` / `ksplat` code; settings named `apertureAngle`, `logFocalDistance` and `openCvCoords` match the Spark splat renderer *(inferred)*). Controls:
   - **W A S D Q E** to fly, **Shift** to speed up.
   - A lil-gui panel titled **"Scene Settings"** with focal length (default **24 mm**), a focal-lens mode, aperture (depth of field), aspect ratio (default **16:9**), OpenCV coordinates and transparent background.
   - Other UI labels: "3D Scene", "Lens", "Speed", "Tutorial".
3. **Capture → recomposition.** The viewer renders the current view to `capture.png`, uploads it, and submits `cinematic_studio_image_3d_recomposition` with `{source_job_id, width, height, medias:[{role:"image", data}], folder_id, aspect_ratio}`. Validation needs the source job, the image and the aspect ratio. It costs **2 credits** and supports Rerun. Toast: "Generation started".
4. **3D Angles** (ChatGPT plugin, Oct 19) extends this to photo, video or text input, with lenses 24–300 mm, f/1.4–f/16, 8 frame formats from 1:1 to 21:9, and output as a still or a video up to 30 s with **draft videos** first. The cost row `3d_jutsu_angles` is 1.25 credits at 1K/1.5K and 2.5 at 2K (list price 1.5 / 3).

**Fuobe build.** Add a "3D scene" action on images that opens a modal with:
- the splat viewer (three.js + a splat loader in the browser);
- a lens slider 24–300 mm, an aperture slider f/1.4–f/16, and the 8 aspect presets;
- WASD/QE/Shift fly controls and drag to orbit;
- a "Capture" button that saves the frame and queues the re-render.

Video mode: record two to ten camera keyframes, render each as a capture, re-render each, then generate with Kling 4.0 (keyframes) or Seedance 2.5 start/end frames. Offer a "draft" first at 480p.

**Routes:**
- **Cloud:** `tripo3d/triposplat`. Inputs: `image_url`, `output_format` ply / splat, `num_gaussians` 32,768–262,144 (default 262,144), `num_inference_steps` 1–50 (20), `guidance_scale` 0–10 (3). Alternative: `fal-ai/sam-3/3d-objects`, which returns `gaussian_splat`, `individual_splats` and `model_glb`. Re-render with Nano Banana Pro or Seedream 5.0 Pro: "Re-render this view photorealistically, keep composition and camera exactly, fix holes and stretched textures."
- **Open:** `VAST-AI/TripoSplat` (MIT, weights 2026-05-31) → same viewer → Qwen-Image-Edit 2511 re-render.
- **Avoid:** `apple/Sharp` is single-image-to-splat too, but under the Apple research licence (non-commercial).

**Critic corrections (2026-10-22).**
- **TripoSplat rebuilds the subject, not the scene.** fal's output schema describes `preprocessed_image` as "The background-removed RGB composite the model actually saw, rendered on a black background". The official ComfyUI template also runs BiRefNet background removal first. Use it for subjects (characters, products), not for "Create 3D scene" on a whole frame.
- **TripoSplat has native ComfyUI core nodes; no worker is needed.** ComfyUI v0.41 ships `TripoSplatPreprocessImage`, `TripoSplatConditioning`, `VAEDecodeTripoSplat` and `TripoSplatSamplingPreview`, plus splat tools (`RenderSplat`, `TransformSplat`, `SplatToFile3D` ply/ksplat/spz, `SaveGaussianSplat`, `CreateCameraInfo`) and the template `3d_triposplat_image_to_gaussian_splat` (2026-06-02). Weights: 3.78 GB in all (TripoSplat MIT; DINOv3 ViT-H under the DINOv3 License, which allows commercial use with a "Built with DINOv3" notice; FLUX.2 VAE Apache-2.0).
- **For the whole scene, use MoGe.** Core `MoGeInference` → `MoGePointMapToMesh` → `SaveGLB` (template `3d_moge_perspective_to_mesh`, 2026-05-15; MoGe 2 ViT-L 0.66 GB, MIT). It ran here on CPU: a 768×768 room photo became a textured GLB of the whole room in 42 s (556k vertices, 1.08M triangles, depth 0.35–6.58 m). See [`comfyui-oss-4.md`](comfyui-oss-4.md) §i.

### 4.5 G06 · AI Influencer Studio game-style builder

**Entry points** (changelog 2026-10-02 and the influencer strings):
- **Start from scratch**, **from a reference**, or **from your photo ("Add your face")**.
- **Character Builder** with **Shuffle** and **Reset all**.
- **Clothing references** (≤ 3: "You can add up to three clothing references"), **Add style reference**, and a **Direction** text (≤ 4,000 characters).
- Batch, versions, character history, Turn to motion / "Add motion with Genjutsu", Extract start/last frame, Generate 3D scene, upscaling.
- **5 free generations** per user. A banner says "Seedream 5 is Rolling out".

**Character type (tier).** Each tier hides options not in its `visibleIn` list:
- **Average** (`normal`), **Bold** (`freak`), **Extreme** (`total`).
- Creature types:
  - **Insect**: ant, mantis, grasshopper, honeybee, bumblebee, butterfly, moth, dragonfly, ladybird, fluffy_tarantula.
  - **Frog**: tree_frog, bullfrog, horned_frog, tomato_frog, rain_frog.
  - **Cat**: sphynx, maine_coon, british_shorthair, siamese, persian.
  - **Dog**: pug, borzoi, dachshund, poodle, corgi.
  - **Rodent** (capybaras): cylindrical, barrel, slender, pear, broad_shoulders.
  - **Bird**: goose, duck, platypus, puffin, pigeon.
- Creature types show only gender, build, height, proportions, facial hair, distinctive features, accessories, hairstyle, hair colour and style, plus `animalVariant` and `bodyColor`. Within those categories every option is offered except Centaur, whatever its tier marks (function `j` in the chunk).

**The 19 categories.** Display order puts gender, build, hairstyle, hair colour and style first. "max" is how many options can be picked. Options marked † appear only in Bold or Extreme; ‡ only in Extreme.

| # | id | Label | Kind | max | Options |
|---|---|---|---|---|---|
| 1 | tier | Character type | media | 1 | Average, Bold, Extreme, Insect, Frog, Cat, Dog, Rodent, Bird |
| 2 | gender | Gender | media | 1 | Female, Male, Trans man, Trans woman, Non-binary |
| 3 | ethnicity_origin_base | Ethnicity | media | 1 | African, Asian, European, Indian, Middle Eastern, Mixed |
| 4 | age | Age | text | 1 | Adult, Mature, Senior |
| 5 | skin_tone | Skin color | color | 1 | Porcelain #f1e2d5, Fair #e8c9b5, Light #dab49a, Olive #b6976e, Tan #bc8e67, Brown #805135, Deep brown #543621, Ebony #2d211b |
| 6 | height | Height | media | 1 | Short (creature types only), Average, Tall, Very tall |
| 7 | body_type | Build | media | 1 | Slim, Athletic, Muscular, Curvy, Heavy, Ultra Muscular, Centaur‡ |
| 8 | proportions | Proportions | media | 2 | Long limbs, Short legs, Broad shoulders, Tiny waist, Egg body† |
| 9 | freak_head | Head shape | media | 1 | Standard, Long, Tiny†, High forehead†, Caveman‡, Gigachad‡, Mega jaw‡, Round, Square, Heart |
| 10 | freak_neck | Neck | media | 1 | Standard, Column†, Long†, Short |
| 11 | eye_shape | Eye shape | media | 1 | Almond, Round, Monolid, Close-set†, Wide-set†, Uneven†, Large, Huge†, Hooded, Upturned, Downturned |
| 12 | eye_color | Eye color | color | 1 | Black #191615, Brown #67432c, Hazel #887546, Green #648254, Blue #5182a1, Ice blue #a5cbd6, Amber #bd8c45, Grey #939b9d |
| 13 | freak_face | Features | media | 4 (one per slot) | marks: Freckles, Blush†, Beauty mark · cheeks: Dimples, High cheekbones · eyes: Heavy eye bags · lips: Full lips, Pouty lips†, Tiny pursed mouth†, Wide mouth · brows: Thick brows, Unibrow†, Thin high brows†, Brush brows† · nose: Potato†, Button†, Pointy†, Tiny nose · ears: Jug ears†, Uneven ears† · teeth: Gap teeth†, Buck teeth† · chin: Pointy chin, Weak chin† · forehead: Big forehead† |
| 14 | facial_hair | Facial hair | media | 1 | Clean, Stubble, Full beard, Goatee, Moustache, Pencil, Push-broom†, Braided† |
| 15 | hair | Hairstyle | media | 1 | Bob†, Bald, Buzz cut, Bowl cut, Mullet, Braids, Pigtails, Afro, Mohawk, Volume waves†, Beehive†, Perm†, Long hair, Short hair, Hair horns†, Soft-serve swirl†, Curl sphere†, Mouse-ear puffs†, Hair wings†, Hedgehog spikes†, Side tufts†, Stair steps†, Shelf bob†, Corkscrews†, Side coil†, Mushroom† |
| 16 | hair_colour | Hair Color | color | 1 | Jet black #151515, Dark brown #39281f, Chestnut #794a33, Ginger #b56131, Red #b43636, Blonde #d9b774, Platinum #e4d9bc, Grey #8c8c8c, White #eee9dd, Pastel pink #dd9ab7, Lilac #b0a0ce, Blue #4080bb, Green #548060 |
| 17 | distinctive | Distinctive features | media | 2 | Odd eyes, Face tattoo, Piercing, Ear piercing, Brow slits, Bleached, No brows, Gold grill, Braces, Brow scar, Face gems, Elf ears, Big lashes, Nose tape |
| 18 | aesthetic | Style | media | 1 | Retro, Sporty, Y2K, Theatre, Goth, Suits, Streetstyle, Casual |
| 19 | accessory | Accessories | media | 3 | None (exclusive), Glasses, Headphones, Jewelry, Hat, Bag |

**Selection rules:**
- `max: 1` replaces the current pick.
- Features allow one option per slot.
- Picking "None" in Accessories clears the others.
- Conflict messages:
  - "Heavy build cannot be combined with Tall or Very tall."
  - "This build cannot be combined with Short legs or Long limbs in this mode." (Heavy, Muscular or Ultra Muscular, outside Average)

**Shuffle** (`ae` in `u4o7Rr346PKw3TXg.js`):
- It keeps fixed picks. With a reference photo, it keeps gender, ethnicity, skin and age (plus eye colour in Average).
- Gender is male 67% of the time, female 33%.
- Style is Suits 40%, Retro 20%, otherwise any other style.
- Hairstyle is Bob 20% when Bob is visible, otherwise uniform.
- Build never shuffles to Curvy. It skips Ultra Muscular in Average. It avoids Heavy with Tall heights or Tiny waist.
- Facial hair is "Clean" unless the gender is male or trans man.

Option previews are WebP tiles (``). Some options have colour or outfit "trait variants" (e.g. `suits_black_B`).

**Credits:** the server quotes `ai_influencer_sheet` (no fixed web price found). The API lists the AI Influencer sheet at $0.05 (round 3). Motion: `ai_influencer_motion_control` 3 / 7 / 20 credits/s, Lite 1 / 2 / 4.

**Fuobe build:**
- Replace the "From a description" path with this builder. It is a pure UI plus a prompt compiler: each option maps to a short English phrase, and the tier adds a style clause ("realistic", "bold caricature", "extreme caricature", "anthropomorphic {species}").
- Output: a white-background portrait plus full body, as now.
- **Cloud:** the studio Influencer with a key, otherwise Nano Banana Pro or Seedream 5.0.
- **Open:** the Soul Cast sheet workflow (Z-Image Turbo). "Add your face" runs Qwen-Image-Edit 2511 with the user's photo.
- Hand-offs: "Use in Genjutsu" and "Create 3D scene".

### 4.6 G07 · Content Factory ("Generate viral faceless short videos")

**Screen:**
- Tabs: Explore, My generations, Presets, My presets.
- Composer:
  - **Generate with:** "Generate in Claude" (default; "Need to connect the studio's MCP") or **Generate here**.
  - **Add reference:** "Add images or videos", or "Add TikTok or Instagram link"; "Change reference", "Select from presets".
  - Prompt "Make a video about…". Rotating examples: "What if cars could fly", "What if cats ruled the world", "What if the Moon had a city", "What if dinosaurs never went extinct", "What if gravity switched off for a day".
  - **Length** (default **30 sec**; strings for 1, 2, 3, 4 and 5 min).
  - **Episodes** (default 1; "# episodes").
- Below: **"Pick a trending style to start from"**, a grid of real Instagram/TikTok videos with view and like counts ("Use as reference", "Open original on Instagram / TikTok", "Turn sound on").

**Other copy:**
- Animation styles: "Fully animated", "Frame by Frame", "Scene by scene video", "Seamless motion video".
- Genres: Storytelling ("Carry one story to its end"), Education ("Explain how something works"), Kids ("Bright, simple, and safe"), and "Retell what actually happened" (history).
- Series: "Next episode topic", "What happens in the next episode?", "Previous episode", "Another batch is still being prepared for this series".
- Pricing: "Final cost depends on video complexity and is settled once your video is generated. It may be slightly higher or lower than shown."
- Failure: "Couldn't plan your episodes. You weren't charged, so it's safe to try again."
- Agent prompt chips: "Turn my product photos into a video ad", "Create a cinematic trailer for my brand", "Generate a short drama scene", "Make a talking head video from my script", "Create a cartoon animation from a storyboard".

**Mechanics:**
- "Generate in Claude" posts the inputs to `POST /what-if/compose`. Inputs are capped at 64 KB ("This request is too large…"). It then opens Claude with the composed message (`?q=`), or offers "Copy this prompt and paste it into a new Claude chat".
- "Generate here" runs the faceless job (`youtube_faceless_video`). It costs **41 credits per 10 s** fully animated and **16 credits per 10 s** scene-based (cost table) *(inferred link between the two)*.

**Fuobe build:**
- Add a "Series" mode to Faceless Studio: a topic, a reference (upload, a library item or a pasted link), length 30 s–5 min, and an episode count.
- The episode planner writes N topics, then each episode runs the existing two-stage render.
- Reference analysis: frames plus transcript → an LLM style brief (Claude, or Qwen3-VL on Ollama).
- A curated "trending styles" grid can ship as local presets.
- Pasting TikTok/Instagram links needs a downloader. Treat it as optional and user-supplied: platform terms apply, and remote fetches must stay on the SSRF-safe path.

### 4.7 G08 · Canvas extras

**Round 3 recorded** the toolbar (Select V, Pan H, Draw D, Eraser E, Sticky Note N, Shapes R, Text T, Reaction ⇧S, Comment C, Table ⇧T, Page, Search ⌘F, Add node) and the node menu.

**New from code:**
- **Table** is behind the feature flag `canvas_table_v1`, so the studio itself is still rolling it out.
- **Groups**: nodes dropped inside a group are re-parented to it, and groups are excluded from layout. There is also a **Folder** node that puts a library folder on the board.
- **Comments** have reactions, resolve and vote (`/comments/{id}/reactions|resolve|vote`).
- **Video Concatenator** (`video_assemble`) is a built-in editor:
  - up to **50** input videos;
  - output ARs 1:1, 4:3, 3:4, **16:9** (default), 9:16, 2:3, 3:2, 21:9;
  - each clip trimmable, with mute, at 30 fps, default canvas 1280×720;
  - clips over 512 MB are refused.
- **Voice nodes:**
  - "Clone Voice": MP3 or WAV up to 11 MB; audio "no longer than 3 minutes"; "Voice limit reached - delete a voice to add a new one"; a one-time activation cost.
  - **Change Voice** = `voice_change_merge` at 0.1 credits/s.
  - **Translate** = `dubbing_lipsync` at 3 / 3.6 / 6 credits/s for 25 / 30 / 60 fps.
- The board also renders a new connector engine (labelled arrows routed around nodes) *(inferred from chunk `Ayb4XeRW4ZAlcxFg.js`)*.

**Fuobe build order:**
1. Group and frame nodes, Comment pins and a freehand Draw layer (no model needed).
2. Change Voice and Translate nodes wired to the existing voice change and dub chains, plus a Clone Voice node (Chatterbox).
3. A Page node (nested canvas, stored as a child canvas id).
4. A Table node (rows as batch inputs feeding a model node).
5. A Concatenator node with per-clip trim and AR, reusing the join workflows.

### 4.8 G09 · Mixed Media per-frame cloud pipeline

The studio's numbers are unchanged: **floor(seconds × fps) × 2 credits** (× 4 at 4K), 4 / 8 / 10 / 12 / 24 fps (default 8), with a preview frame. The API is still `POST /chains/mixed-media` and `/chains/mixed-media-preview`.

**Fuobe cloud chain:**
1. Trim the clip.
2. Extract frames at the target fps (`fal-ai/workflow-utilities/extract-nth-frame` or `fal-ai/ffmpeg-api/extract-frame` per index).
3. Edit each frame with the preset prompt and a fixed seed, passing the previous styled frame as a second reference for stability (Nano Banana 2 or Seedream 5.0 Flash).
4. Assemble with `fal-ai/ffmpeg-api/images-to-video` (in `paid-model-apis-3`) at the same fps.
5. Mux the original audio.

This needs the per-index chain slot that STATUS §3 already names. Above 200 frames, split into batches.

### 4.9 G10, G11 · Assets library, sharing and Community

**Assets** (round 3 has the full list: nested folders, colours, pins, credit limits, review statuses In progress #029dfe / Needs review #fe7802 / Approved #d1fe17 / Rejected #ef4444, projects with members and Trash). New in this round:
- Project link access levels: "Anyone with a studio account can comment on assets in this project", "Anyone with a studio account can reuse and duplicate this project", and "Sign in or sign up to reuse".
- Public **share page** `/share/$id` titled "Shared Asset", with "Generated with {model}", Recreate, Modify and Share.

**Community** (help articles dated 2026-10-08, published 2026-10-15):
- **Content types:**
  - **Shots** are single images or videos.
  - **Open Projects** hold the result, the project brief, the folders and assets, the models used, and optionally the prompts.
  - **Blog posts** are write-ups.
- **Publish wizard** (4 steps):
  1. **Details**: title, description, public link `{studio-site}/@username/projects/project-name`, co-authors, tags.
  2. **Assets**: Feature (one video or image on top), Series (episodes in order, can grow), or Carousel.
  3. **Cover** (optional; the first asset otherwise).
  4. **Access**: **With prompts** or **Prompts hidden**. Recreate is unavailable when prompts are hidden.
  - Then Open preview → Publish. Unpublish removes the work from Community and the profile.
- **Feeds:**
  - Discovery: Selected projects, featured creators, a Grants banner, festival entries, Originals.
  - Projects: search; sort Default, Newest, Oldest, Most liked, Most viewed; filter All, Contest, Non-contest, My Favorites.
  - Shots: filter images, videos, favourites.
  - Creators.
- **Engagement:** Shots get hearts. Projects get thumbs up or down, comments and share. Follow creators. Views are automatic.
- **Profile** (`/@username`):
  - Photo, username, name (hidden until "Show publicly"), headline (specialty), bio, location.
  - Socials: Instagram, YouTube, TikTok, X, Discord.
  - Tabs All works, Projects, Shots, Blog, Ranking, Achievements.
  - Counters: followers, following, views, likes. A "Member since" date.
  - Optional "Show spent credits on profile" (off by default).
  - Up to 3 badges.
- **Rating:**
  - Verified project +30 (needs ≥ 30 likes and ≥ 30 generations; review is automatic).
  - Remix of a verified project by a paying creator: +1 each, ≤ 15 a month.
  - Approved blog post with 20+ likes: +20.
  - Featured: +50.
  - Profile completion, first Open Project and first remix also earn points (amounts not shown in the article: **unverified**).
- **Achievements:** First Spark, Open Source, Verified Project, Ripple Effect, Knowledge Keeper, Spotlight, Rising Star (100), Creator Momentum (500), Creative Force (1,000). Credit rewards: 5,000 / 75,000 / 200,000 at those milestones; featured up to 200,000; blog up to 5,000. Claim from a notification; rewards never expire.

**Fuobe build** (self-hosted, so scale it down):
- (1) **Share links**: a signed read-only URL for a generation or a Cinema/Canvas project, with "With prompts / Prompts hidden" and a Recreate button that opens the composer with the settings.
- (2) A **Publish** wizard with the four steps above, producing a static portfolio page.
- (3) An optional **instance feed** of published works for multi-user installs.

Ratings, grants and contests are out of scope.

### 4.10 G16 · 3D Jutsu web studio

**Strings** (delta `7dcfabc5a5`):
- "the studio's 3D Jutsu", "My scenes", "Shared with you", "Create blank scene", "Untitled 3D Jutsu".
- Prompt: "Prompt your 3D scene" / "Describe the scene you want to block out..."; "Scene brief for the AI agent"; "Add attachments".
- Steps:
  1. **Build the set**: "Describe it. Props, layout and light arrive as objects you can grab, not a picture".
  2. **Place characters**.
  3. **Frame cameras**: "Add people and cameras, then move everything by hand until the frame reads".
  4. **Light the set**.
  5. **Add motion**.
  6. **Export to Seedance**: "Press Export. Seedance 2.5 renders your 3D take into the finished shot".
- "3D Jutsu is desktop only" / "Building a 3D scene needs a bigger canvas than a phone can give".

**Fuobe build:**
- A three.js editor (primitives, GLB props from the 3D tools, mannequins, cameras, lights, keyframed transforms).
- An agent that emits a scene JSON (Claude or Ollama).
- Export renders a guide video (depth plus a flat-shaded pass) and a first frame → **cloud** Seedance 2.5 / Kling 4.0 reference-to-video, **open** Wan 2.2 Fun Control (depth) or VACE.

### 4.11 G19 · Evolution (gated)

**Copy:**
- "Upload a video and let Evolution take it further. A new setting, a new atmosphere, a whole new level of production — imagined for you."
- "Evolve an existing video with a new setting and atmosphere", "Reimagine your video in one click", "Absolute cinema in one click".

**Payload:** `{model:"hf_evolution", resolution, change_intensity, creative_direction, reference_element_ids, medias:[video, …images]}`. The source is 4–30 s ("Video duration must be between 4 and 30 seconds"). Intensity labels: Low / Mid / High ("Changes effort"). Price: **7 credits/s at 720p**.

**Fuobe:** a "Evolve" preset of Edit Video. Map the intensity to prompt strength (cloud) or VACE denoise 0.45 / 0.65 / 0.85 (open; values are a Fuobe proposal).

### 4.12 G13 · CLI, skills and plugins

**The studio's CLI** (`{studio}`, alias `{short-name}`, MIT, v1.1.26 on 2026-10-16):

- **Install:**
  - `curl -fsSL https://raw.githubusercontent.com/{studio}/cli/main/install.sh | sh`
  - `brew install {studio}/tap/{studio}`
  - `npm install -g {studio-npm}/cli`
- **Sign in:** `{studio} auth login`. A browser device flow ("Device authorized" → "Successfully authenticated"); no API key; a short-lived token in a local credentials file. Also `auth token` and `auth logout`. It needs a paid plan and uses plan credits (Unlimited and free generations do not apply).
- **Commands:**
  - `account status|transactions`; `workspace list|select|unset`
  - `model list|get <id>`
  - `generate create|cost|wait|get|list` and `generate workflow <name>` (`draw_to_video`, `reframe`, `voice-change`, `dubbing`); `generate cost workflow …`
  - `workflow list|get`; `preset list|resolve` (video-explainer styles, animation-action presets for 3D)
  - `voices list|get`; `upload`; `soul-id create|wait` (≤ 20 photos in the CLI, `--soul-2` / `--soul-cinematic`)
  - `marketing-studio …`; `product-photoshoot …`; `website create|repo-access|deploy|publish|contest|status|rename|db|secrets|list|categories`; `game deploy|publish`; `version`
- **Flags:** `--wait`, `--wait-timeout` (default 10m), `--wait-interval` (3s), `--json`, `--no-color`.
- **Media:** flags take an upload id, a job id or a local path (auto-uploaded).
- **Output:** `--json` returns `id`, `job_type`, `status`, `result_url`, `params` and `medias`.
- **Catalog:** `model list` returned 107 entries on 2026-10-16. Example prices: Nano Banana Pro image 2 credits; Seedance 2.5 5 s at 1080p 80 credits, 15 with `--draft true`.

**Skills repo** (`{studio}/skills` v0.13.0, MIT):
- **8 skills:** studio-generate, -soul-id, -product-photoshoot (10 modes), -brandkit, -marketplace-cards, -websites, -video-explainer, -youtube-thumbnail.
- **Installs:**
  - `npx skills add {studio}/skills`
  - `gh skill install {studio}/skills` (GitHub CLI 2.90+)
  - Claude Code `/plugin marketplace add {studio}/skills` then `/plugin install {studio}@{studio}`
  - `./setup`
- Manifests for `.claude-plugin`, `.cursor-plugin` and `.codex-plugin`.

**Fuobe build:**
- (1) A `fuobe` CLI (Node, `bin/fuobe`, shipped from this repo) with the same verbs against Fuobe's REST API.
  - Sign-in: a device-code flow that mints a Fuobe API token, or `FUOBE_TOKEN`.
  - Commands: `generate create|cost|wait|get|list`, `model list|get`, `upload`, `workflow`, `--json` / `--wait`.
- (2) Publish `skills/` in the same layout (`.claude-plugin/marketplace.json`, `.cursor-plugin`, `.codex-plugin`, `INSTALL_FOR_AGENTS.md`) so `npx skills add <owner>/fuobe` works. The skill bodies call `fuobe` or the MCP.
- (3) Plugins (Photoshop, Figma, Blender, After Effects, DaVinci) stay P3.

### 4.13 G12 · Notifications

The web app asks for **browser notification permission** and uses a service worker. Code returns `unsupported` without `Notification` or `serviceWorker`, and `ios-requires-standalone` on iOS unless the site is installed to the home screen. Copy:
- "Your task is ready" (Supercomputer)
- "Notifications blocked"
- "Fail to enable notifications. Please allow notifications in your browser settings, then refresh the page."
- Settings: "Update your profile, notification preferences, and account details all in one place."

**Email when a job is done was not found.** Email appears only for Originals ("We'll email {email} when the next episode drops").

**Fuobe build:** a Settings toggle "Notify me when a generation finishes". Fire `new Notification()` from the existing SSE stream when a job leaves running, and only when the page is hidden. Optional Web Push (VAPID) for closed tabs. Explain the iOS home-screen requirement in the toggle's hint.

### 4.14 G18 · Content checks

**Copy (a mix of image, video, element and voice checks):**
- "Checking eligibility", "Checking content eligibility...", "Check eligibility before using selected media"
- "This image contains faces or IP and cannot be used", "This video contains faces or IP and cannot be used"
- "A face or protected content was detected, so this asset cannot be used. Try another."
- "This element must pass IP check before it can be used"
- "You've reached the eligibility check limit. Please try again later."
- "Restricted content detected. Credits refunded." / "… Try Wan 2.5."
- "Remove NSFW images to continue", "NSFW rejected by provider"
- Rights dialog: "Confirm rights · {n}", "Certify rights", "I own rights to this content", "People in my images have given consent", "Request clearance".
- Report reasons: "Uses my copyright", "Uses my copyrighted content without permission".
- Biometric consent for character training: "By clicking Upload, I consent to this biometric data processing and confirm these photos are of me or of a person at least 18 years old who gave written permission."
- Tool tagline: "Detect copyright risks in images, videos, and audio before you publish."

**Fuobe build** (single user, own keys, so lighter):
- A consent checkbox on Soul ID / LoRA training and on face swap (P2 within this item).
- Surface provider NSFW and refusal results with "credits not charged" wording.
- Optional: a browser face detector warning on models whose providers refuse faces.

---

## 5. Pricing and plans (now verified)

From `{studio-service}/subscriptions/plans` (41 rows). Prices are monthly USD; credits per month; "promo" is the current first-period price.

| Plan | Monthly | Annual (per month) | Credits |
|---|---|---|---|
| Free | $0 | — | 10 (every row carries `daily_credits: 10`, so its meaning is **unverified**) |
| Starter | $15 | $15 | 200 |
| Pro | $29 | $23 promo (renews $29) | 600 |
| Plus | $49 | $39 promo | 1,000 |
| Plus (alternative row) | $59 | $47 promo | 1,200 |
| Ultra | $129 | $99 promo | 3,000 |
| Ultra (bigger tiers) | $250 ($220 promo) / $375 ($310 promo) | $193.5 / $270 promo | 6,000 / 9,000 |
| Creator (legacy *(inferred)*) | $250 / $375 / $500 | same | 6,000 / 9,000 / 12,000 |
| Ultimate (legacy *(inferred)*) | $49 / $98 / $147 | same | 1,200 / 2,400 / 3,600 |
| Team (per seat *(inferred)*) | $79 / $89 / $178 / $267 (promo $69 / $71.2 / $142.4 / $213.6) | from $65 | 1,000 / 1,500 / 3,000 / 4,500 |
| Scale | $215 ($169.01 promo) | $150.01 promo | 2,500 |
| Enterprise | custom | — | — |

Other changes:
- The pricing page adds a "Genjutsu Lite" free-generation row and the perk "Nano Banana Pro, Nano Banana 2 & Kling 3.0 Unlimited".
- Supercomputer adds credit-pack promos (bonus credits up to 15k "on top of credit packs").
- Example costs from the press release (Plus plan): a 15 s Motion ad at 720p is 89 credits; UGC 15 s is 108; UGC 30 s is 211.

Fuobe has no billing, so none of this is a build item. The cost table in the JSON keeps per-second rates for the estimate UI.

---

## 6. Conflicts and unverified points

| Topic | Source A | Source B | Note |
|---|---|---|---|
| Genjutsu Lite source length | Changelog 2026-10-19 and API price page: 4–15 s | Web code `GENJUTSU_FLASH_VIDEO_DURATION_MAX = 30`; landing "Up to 30s" | The web client allows 30 s today; the API is 15 s. Copy the code (4–30 s) for the web flow and 15 s for the studio's API route |
| Kling 4.0 resolution | Changelog: 720p or 1080p; web code and cost table 720p / 1080p; fal 720p / 1080p | Intro page: "720p, 1080p and 4K, with 10-bit HDR at 1080p and 4K" | 4K/HDR is not exposed anywhere callable (**unverified**) |
| Kling 4.0 Flash | Intro page: 720p, ≤ 20 s drafts | No job id in the bundle, no fal endpoint | Treat as not yet available |
| Kling 4.0 reference split | Web: ≤ 10 images, ≤ 5 videos, ≤ 7 elements, ≤ 15 total | Changelog: "up to 15, including images, up to 5 videos, a voice reference, and Elements" | fal: images ≤ 10, elements ≤ 7, videos 3–30 s each and 30 s combined |
| "OpenAI Hazel" | CLI lists `openai_hazel` as its own image model | Web maps GPT Image 2 / 2.5 / `imagegen_2_0` jobs to `openai_hazel_job` | Most likely an internal name for OpenAI image jobs, not a separate public model |
| Mobile app | — | Apple endpoints are blocked from this environment | App Store release notes are **unverified** this round |
| Supercomputer Scheduled Tasks | Press release 2026-10-19 | No strings in the web bundle | Feature announced; UI **unverified** |
| Community rating points | Help article lists +30 / +1 / +20 / +50 | Points for profile completion, first project and first remix are blank in the article | **unverified** |
| Genjutsu preset names | — | Endpoints need a login (401) | Not captured |
| Kling 4.0 API | This file (first draft): fal route ready | fal `llms.txt` and catalog description (2026-10-22): "API access is coming soon" | Resolved by the critic: **playground-only**. Secondary sources disagree on Kling's own API; none is primary (**unverified**) |
| Cinema 3D scene model | This file (first draft): TripoSplat for the scene | paid-model-apis-4 §8: TripoSplat removes the background | Resolved: TripoSplat = subject only; whole scene = MoGe mesh (open) or depth point cloud / World Labs Marble (cloud) |
| Kling 4.0 keyframes on fal | Web: up to 10 keyframes (`KLING_4_0_MAX_IMAGES` 10, "The first is the start frame") | fal `kling/v4/image-to-video`: only `start_image_url` and `end_image_url` | Even when fal opens the API, 3–10 keyframes need `reference-to-video` image refs or another model (FLUX 3 Max keyframes-to-video) |

---

## 7. Sources

All accessed 2026-10-22.

**The studio, primary:**
- Changelog and RSS: {studio-site}/creator-hub/changelog · {studio-site}/creator-hub/changelog/rss.xml
- Sitemaps: {studio-site}/sitemap.xml, `sitemap-marketing.xml`, `blog/sitemap.xml`, `creator-hub/sitemap.xml`, `apps/sitemap.xml`, `motion/sitemap.xml`, `mixed-media-presets/sitemap.xml`
- Pages:
  - Studios and tools: {studio-site}/content-factory · {studio-site}/3d-jutsu · {studio-site}/tube · {studio-site}/genjutsu · {studio-site}/upscale · {studio-site}/canvas · {studio-site}/ai-influencer-studio · {studio-site}/generate · {studio-site}/katana · {studio-site}/supercomputer
  - Models and landings: {studio-site}/kling-4-0-intro · {studio-site}/ai/video?model=kling4_0 · {studio-site}/ai/video?model=genjutsu-lite · {studio-site}/remove-object-from-video · {studio-site}/remove-text-from-video · {studio-site}/ai-video-upscaler
  - Community and agents: {studio-site}/community · {studio-site}/community/projects · {studio-site}/grants · {studio-site}/mcp · {studio-site}/{studio}-telegram-intro
  - Other: {studio-site}/pricing · {studio-site}/seedance-4k · {studio-site}/ai-host (404) · {studio-site}/video-editor (404)
- Blog: {studio-site}/blog/{studio}-cli (2026-10-19) · {studio-site}/blog/kling-4-0-on-studio · {studio-site}/blog/{studio}-community
- Help Center: {studio-site}/creator-hub/help-center/community/what-is-studio-community · …/how-do-projects-work · …/how-do-i-set-up-my-profile · …/how-do-achievements-work
- i18n catalogs: `{studio-site}/_i18n/routes/en/` + `root.b95621da89.json` (round 3: `root.bc60caf0b1.json`).
  - Route deltas: content factory `delta.1a03ac397b.json`; video `delta.5ff33475c7.json` (round 3 `8ad0aabf5d`); cinema `delta.848ff74f21.json` (round 3 `844d2f759c`); influencer `delta.7768a306c3.json` (round 3 `b0a00c06e4`); image `delta.cb85bd0b24.json` (round 3 `c616e10bb4`); supercomputer `delta.019333be97.json` / `delta.b649a46681.json` (round 3 `69dd988e26` / `af18bbbe09`).
  - More deltas: upscale `delta.68b8b60d8a.json`, `delta.a66a632268.json`; canvas `delta.deac944ca9.json`, `delta.9da790fc59.json`; asset `delta.d3149d6b9e.json`; share `delta.8ca1955d6f.json`; community `delta.068096c6a4.json`, `delta.c7f59d0eb6.json`, `delta.a2a1b4a69d.json`, `delta.420b75d259.json`; profile `delta.c9f6265210.json`; tube `delta.be14edcb07.json`; 3D Jutsu `delta.7dcfabc5a5.json`; AI Host `delta.f60d5e91ef.json`; video editor `delta.ce33b42258.json`; pricing `delta.bc98432178.json` (round 3 `555e66bb72`).
- JS bundle, build `1a2c0e3d`: `{studio-assets}/tanstack/assets/1a2c0e3d-<chunk>.js`. Key chunks:
  - `u4o7Rr346PKw3TXg` (influencer builder), `Bh59qW_F0DwHRugi` (3D scene modal), `s7Pc_VTly7scVxim` and `GGFDdVa-GgAotcya` (3D jobs), `EvLnfWQS4p8iriJV` (image overlay actions)
  - `9V5-hD4mNN4X33gE` (video tools and upscalers), `T-Hnf94InL7NwIEp` (Genjutsu jobs), `kyySz4K-SM_G0oa_` and `Np-SNe-7mCPEWBa9` (Evolution)
  - `NBuk9-F63Vyq6c55` (Kling 4.0 limits), `x-gpkaootj6Z-tim` and `IAi1M8IkobQfft7U` (Content Factory), `jIYobq3OomjhNFdy`, `ji1GMNpGvOMH68Oh`, `HrFy7mSg0hjd3iiN`, `c8v6u2Y_SCqdNS2h` (Canvas), `vUcYzaGvDsE7doZR` (notifications), `jXL767d7v2eIimh8` and `wgsUE24IS31KGQqK` (image job map)
- Public endpoints: {studio-service}/job-sets/costs (version `183a390e…`) · {studio-service}/subscriptions/plans · {studio-service}/api/templates · {studio-service}/pricing · {studio-docs}/docs/llms.txt · {studio-docs}/docs/openapi.json
- GitHub: {studio-github}/cli (commit `fd21e7cb550b5835cc00c6b4abfea0c02fe77ff2`, 2026-10-17; README.md, MODELS.md, LICENSE MIT) · {studio-github}/skills (commit `f83af0bc1d937c8119099a11f8ebbf5e6fb99819`, VERSION 0.13.0)
- Press: https://www.prnewswire.com/news-releases/{studio}-turns-any-product-page-into-a-finished-ad-campaign-302911758.html (2026-10-19)

**Routes for Fuobe:**
- fal model search: `https://fal.ai/api/models?keywords=…`
- fal OpenAPI: `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=` + `kling/v4/text-to-video`, `kling/v4/image-to-video`, `kling/v4/reference-to-video`, `kling/v4/video-to-video/edit`, `topaz/interpolate/video`, `topaz/sdr-to-hdr/video`, `tripo3d/triposplat`, `fal-ai/meshy/rigging`, `fal-ai/sam-3/3d-objects`, `tripo3d/h3.1/text-to-3d`, `bria/video/erase/prompt`, `fal-ai/ltx-2.3-quality/clean-plate`
- Replicate: https://replicate.com/kwaivgi (no Kling 4.0 on 2026-10-22)
- Hugging Face: https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-SDR-To-HDR · https://huggingface.co/VAST-AI/TripoSplat · https://huggingface.co/apple/Sharp · https://huggingface.co/VAST-AI/UniRig · https://huggingface.co/zibojia/minimax-remover · https://huggingface.co/lixiaowen/diffuEraser · https://huggingface.co/GSean/GIMM-VFI
- ComfyUI nodes (third-party listings, **unverified**): https://developers.tripo3d.com/en/docs/comfyui-nodes.md · https://www.runcomfy.com/comfyui-nodes/ComfyUI-UniRig

---

## 8. Critic check (round 4, 2026-10-22)

Facts in this file were re-checked against primary sources by the round-4 completeness critic. Corrections are made in place above and listed here.

| Claim | Check | Result |
|---|---|---|
| `kling/v4/*` is a ready fal route (G02) | `https://fal.ai/models/kling/v4/text-to-video/llms.txt`, `…/video-to-video/edit/llms.txt` and `https://api.fal.ai/v1/models?endpoint_id=kling/v4/text-to-video` | **Corrected.** Playground and fal Agent only: "API access is coming soon" (catalog `updated_at` 2026-10-21). Input schemas match this file: t2v `prompt` ≤ 26,000 chars or `multi_prompt`, `duration` 3–30 (default 5), `aspect_ratio` 16:9 / 9:16 / 1:1 / 21:9, `resolution` 720p / 1080p (default 1080p). i2v takes only `start_image_url` + `end_image_url`. Edit: `video_url` 3–30 s, ≤ 300 MB, **700–4553 px each side**, aspect 0.40–2.50; `image_urls` ≤ 10; `elements` ≤ 7; `duration` defaults to the source. Ref2v: `image_urls` ≤ 10, `elements` ≤ 7 (≤ 3 with `voice_id`, ≤ 3 video elements), `video_urls` ≤ 5 (3–30 s each, 30 s combined), `aspect_ratio` adds `auto` |
| Callable stand-in for Kling 4.0 keyframes | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=blackforestlabs/flux-3-max/keyframes-to-video` | `keyframes` 1–10 × `{image_url, frame_index}` (unique, frame index ≤ duration × 24), `duration` 5–20 s, 720p / 1080p, `aspect_ratio` auto / 21:9 / 2:1 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16, `generate_audio` (default true), `reasoning_level` low / high |
| `tripo3d/triposplat` inputs (G05) | fal OpenAPI | Correct as written (`num_inference_steps` 1–50 default 20, `guidance_scale` 0–10 default 3, `num_gaussians` 32,768–262,144, `output_format` ply / splat). **Scope corrected:** subject only (see §4.4) |
| `bria/video/erase/prompt` (G01) | fal OpenAPI | Correct: `video_url` "duration must be less than 5s", `auto_trim` default true, `preserve_audio` default true, 11 `output_container_and_codec` values, default `mp4_h264` |
| `topaz/interpolate/video`, `topaz/sdr-to-hdr/video` (G03) | fal OpenAPI | Correct. Both also take `enable_safety_checker` (default true). SDR→HDR `prores` is ProRes **422 HQ** |
| `fal-ai/sam-3/3d-objects` | fal OpenAPI | Outputs `gaussian_splat`, `model_glb`, `individual_splats`, `individual_glbs`, `metadata`, `artifacts_zip`. `prompt` defaults to `"car"`; `export_textured_glb` defaults to **false** on fal (the studio's CLI's `sam_3_3d` defaults it to true) |
| Genjutsu Light on the API | `{studio-dashboard}/models/{studio}/genjutsu-light/object-swap/v1.0/llms.txt` | `image_urls` 1–8 (the web flow allows 10), `duration` computed from the source and capped at 15 s, $0.05 / $0.10 / $0.20 per second; billable seconds include reference-video length |
| DiffuEraser is an Apache-2.0 open route (G01) | https://github.com/lixiaowen-xw/DiffuEraser README | **Corrected:** ProPainter (S-Lab, non-commercial) is its prior model and its weights are in the download list |
| "TripoSplat has no ComfyUI node" (G05) | live `/object_info` of ComfyUI v0.41 (`fc04da91`) and the installed templates package | **Corrected:** native core nodes and an official template exist; MoGe 2 / 3 core nodes build a whole-scene mesh (ran here) |
| Open EXR export needs a third-party node (G03) | comfyui-oss-4 `video-export-exr` | **Corrected:** core `SaveImageAdvanced` writes EXR |
| LTX-2.5 SDR-to-HDR IC-LoRA date and licence | `https://huggingface.co/api/models/Lightricks/LTX-2.5-22b-IC-LoRA-SDR-To-HDR` | Correct: created 2026-09-28, `ltx-2.x-community-license` |
