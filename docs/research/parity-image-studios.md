# The studio's image studios: Layers, Photodump, Fashion Factory, Moodboards, Soul HEX, Soul presets, Character Sheet, Soul Location

_In this file, "the studio" means the closed AI image and video studio that this research measures Fuobe against._

_As of 2026-10-17. Machine-readable twin: [`parity-image-studios.json`](parity-image-studios.json). Builds on [`parity-inventory.md`](parity-inventory.md) §2.1, §2.3, §6.1 and replaces the rows there marked "unknown"/"low"._

> **Method.** Same approach as the inventory, pushed further. (1) Crawled the **whole production bundle graph** of the TanStack SPA (8,020 chunks from `{studio-assets}/tanstack/assets/`), so the lazily loaded editor screens (Layers, HEX panel, Photodump and Fashion Factory flows, Character Sheet) are covered, not just the SSR'd ones. (2) Pulled the **complete English UI catalog** `/_i18n/en.dd219392ea.json` (36,878 strings; the per-route catalogs miss strings that live in lazy chunks) plus all 266 route catalogs listed in `/_i18n/routes/index.en.json`, and resolved every message id a screen uses. (3) Called the **public, unauthenticated JSON endpoints the app itself uses** (`{studio-api}/fnf/*`, `{studio-cms}/*`), which return the real preset, pack, template and palette lists with ids and exact hex values. (4) SSR of the 100 `/soul/<id>` preset pages, the Help Center, blog posts, and third-party searches. (5) For Fuobe's routes: Hugging Face, the official ComfyUI `workflow_templates` repo and fal OpenAPI.
>
> **Confidence.** Copy, option lists, limits, defaults, step order, request fields and credit formulas below are **exact** (read from code or API responses). Spatial layout (left/right/top) is **(inferred)** from component structure. One-line descriptions that studio does not publish are written by us and flagged `inferred` in the JSON (`descriptionSource`). Logged-in screens were not observed directly.

**What changed vs. the inventory (headline findings)**

* **Layers is Seedream 5.0 Pro layer separation** (landing badge "Powered by Seedream 5.0"; `/seedream-layer-separation` 301 → `/layers`). Settings are **Resolution 1K / 1.5K / 2K, Mode Standard / Fast, Layers 3–16 (default 8)**; cost **1.5 credits per layer (1K, 1.5K) or 3 per layer (2K)**. The editor is a full **tool shell with 11 image tools** (Layer Decomposition, Upscale, Color Grading, Enhancer, Relight, Inpaint, Regional Editing, Remove background, Angles, Edit text, Expand & Crop). The two zips are exactly specified (§1.7).
* **Open-source route exists and is official in ComfyUI:** **Qwen-Image-Layered** (Apache-2.0, Dec 2025, variable and recursive decomposition), with templates `image_qwen_image_layered` and the prompt-guided `image_qwen_image_layered_control`. ComfyUI also ships an API node for the paid route (`ByteDanceSeedreamLayerSeparationNodeV2`).
* **Photodump is three products:** legacy Photodump Studio (Soul v1, 26 shots, Sep 2025), **Soul 2.0 Photodump** (9 packs, 10–17 shots each, needs a Soul ID), and **Instadump** (one selfie, no training, 10 credits, packs incl. community packs). The old inventory's "12 or 26": 26 is the legacy set; 12 matches the Candid Glow, Surreal Self and Alter ego packs _(inferred; the inventory did not record its source for 12)_.
* **Fashion Factory has 6 templates** (Ultra bold, Blue-Green Gradient, Street style Paparazzi, View from the top, Light blue studio, Red room) and a 5-step flow: template → character → pick base (Soul, 4 shots at 3:4) → outfit (Nano Banana) → photoset (Nano Banana batch).
* **Moodboards: min 5, max 80 images, ≥256 px, name ≤100 chars**; a moodboard is a trained custom reference (`soul-v2-preset`). 21 curated moodboards in 3 groups (Mood / Styles / Camera) + 12 newer uncategorised presets.
* **Soul HEX palettes = the 50 Cinema Studio 4.0 palettes, with exact hex** (12 colours each; the 12th is also the background colour). They map 1:1 onto the `color_palette` enum Fuobe already has for Cinema Studio 4.0. The older names (Film colors, Lime Jam…) are gone from the API. Manual editor: max **12 colours** (10 on Recraft), defaults `#FFFFFF #D1FE17 #1C1E20` on `#53C546`, EyeDropper, 4 random palettes; from images: up to **20 photos**.
* **Soul presets:** Soul v1 has **106** presets (100 with public pages) in **8 categories: New, TikTok Core, Instagram Aesthetics, Camera Presets, Beauty, Mood, Surreal, Graphic Art** (+ All, + a feature-flagged "Dump"). The style ids are the same ids the public API takes as `style_id`, so Fuobe can ship them as a static fallback.
* **Costs:** Soul 2.0, Soul Cast, Soul Location and Soul Cinema Studio images are **0.125 credits each**; Edit text detection 0.5; Instadump 10.

---

## 1. Layers (`/layers`, `/layers/$projectId[/$versionId]`)

### 1.1 What it is
"Turn flat images into editable layers. Separate, edit, and rebuild any image. Every element, now yours to edit." A project = one source image + a layer document (nodes with `type: image`, `layerIndex`, `name`, `geometry {x, y, width, height, rotation}`, a `source`, optional mask) + versions. Landing (`/{studio}-layers`): "Turn any flat image into editable layers - move, retype, relight, upscale", feature cards Layer Separation, Edit text, Regional edit; toolkit Draw to Edit, Remove Background, Upscale, Relight, Skin enhancer; FAQ "Layer Separation and AI region edits are available on paid plans and use credits", JPG/PNG/WebP up to 4K.

### 1.2 Projects screen (`/layers`)
| region | content |
|---|---|
| Hero | "Turn flat images / into editable layers." + capability carousel **Relight · Inpaint · Layer Decomposition · Edit text · Effects** (Previous / Next capability) |
| Upload | **Upload Media** — "Upload an image, or pick one you already generated. Images only — JPG, PNG, WebP or HEIC." Assets picker tabs: All Generations, Image Generations, Uploads, Liked, My Elements, Project Generations. Error: "Only images can be edited here. Pick an image or upload one." |
| Grid "My projects" | cards: thumbnail, name (default "Untitled project"), relative time; states "Processing…", "Couldn't be processed"; menu Open / Delete project |
| Empty | "Your edit projects will appear here" — "Upload an image to separate it into editable layers — every project you start is saved here." |
| Errors | "We couldn't load your projects" · "Try loading projects again" |
| Delete | "Delete this project?" — "This project and all of its layers will be permanently deleted. This cannot be undone. The image it was opened on stays in your gallery." |
| Mobile | "Image editing is desktop only" — "Layer editing needs a bigger canvas than a phone can give it — open this page on desktop." |

Deep link used everywhere else (Assets "Edit", Marketing Studio posters): `/layers?model=nano_banana_pro_inpaint&media=image-job--<jobId>` or `media=image--<uploadId>`. While it opens: "Preparing your project".

### 1.3 Editor layout _(spatial positions inferred)_
* **Tool sidebar (left).** Registered tools; picking one **replaces** the sidebar with that tool's form (back arrow returns). Badges "New" on Layer Decomposition, Edit text, Expand & Crop.
* **Canvas (centre).** Composited layers; select to move, **Resize layer**, **Rotate layer**; drawing tools for masks: Brush, Brush size, Brush colour, Eraser, Eraser size, Free draw, Custom color. Tools act on the selected layer — "Deselect the layer to use this tool on the whole image"; "Unavailable while editing a mask".
* **Layers panel (right).** Header "Layers"; rows in z-order with thumbnail + name; drag to reorder ("Could not reorder the layers."); row actions below.
* **Top bar.** Project name, **Edit history** (versions; "Couldn't delete/download this version"), **Compare** (before/after), **Download** menu, **Copy JSON**, comments with on-canvas marks ("Leave a comment...", Reply, Mark as resolved), Save as Element.

Image tools and the backend each calls:

| tool id | label | backend job |
|---|---|---|
| `layer-separation` | Layer Decomposition (New) | Seedream 5.0 Pro layer separation |
| `upscale` | Upscale | `topaz-image` / `bytedance-image-upscale` |
| `color-grading` | Color Grading | `color-grading-lut` |
| `skin-enhancer` | Enhancer | `skin-enhancer` |
| `relight` | Relight | `relight` |
| `inpaint` | Inpaint | draw-to-edit; the deep link defaults to `nano_banana_pro_inpaint` _(inferred)_ |
| `regional-editing` | Regional Editing | Seedream 5.0 Pro |
| `remove-background` | Remove background | `image-background-remover` |
| `angles` | Angles | `angles` |
| `edit-text` | Edit text (New) | `image-text-detection` → `seedream-v5-pro-text-edit` |
| `expand-crop` | Expand & Crop (New) | `expand-crop` |

The same shell hosts the video tools (Edit video, Reframe, Upscale, Remove Background, Change scene, Relight, Edit Color Palette).

### 1.4 Layer Decomposition
**Settings panel** ("Settings"):

| control | type | options | default |
|---|---|---|---|
| Resolution | segmented | 1K · 1.5K · 2K | not exposed |
| Mode | segmented | Standard · Fast (`optimizePromptMode`) | not exposed |
| Layers | slider | 3–16, step 1 | **8** |
| Button | | **Separate layers** (shows cost) | |

**Cost:** `credits = perLayer[resolution] × layers`, `perLayer = {1K: 1.5, 1.5K: 1.5, 2K: 3}` → 8 layers at 1K = 12 credits, at 2K = 24.

**States** (title — body): resolving "Opening layer decomposition — Preparing this image for layers." · stalled "This is taking longer than expected — We could not prepare this image for layers. Try again, and if it keeps happening, reload the page." · failed "Could not open layer decomposition" · unavailable "This image cannot be decomposed — Layer decomposition needs a generated or uploaded image. This asset does not have one." · no-version "Select a finished image — The version open right now is still generating or did not finish, so there is nothing to decompose. Pick a completed image in the history." · setting-up "Setting up layer decomposition — One moment." · submitting "Starting layer decomposition — Preparing your image for processing." · processing "Separating image layers — Your editable layers are being prepared." · failed run "Layer decomposition failed — Try again, or return to the settings." (Back to settings) · ready "Layers are ready — Opening the layer editor." · done "Decomposed — This image is split into # layers. Edit them on the canvas or in the Layers panel."

**Rules.** "An image can only be decomposed once." Submit error "Could not start the split". **Separate layer** splits any one layer again (`nested_separation`) with an optional prompt (what to pull out), same resolution/mode/count controls; toasts "{layerName} split into {added} layers" / "Could not split {layerName}"; while running "Separating {name}, in queue / in progress", "This layer is being split", and delete is blocked ("Can't delete while this layer is being split").

### 1.5 Layers panel and per-layer AI
* **Add layer** → Choose asset (library) · upload ("Uploaded layer") · **Generate layer**. "Failed to add layer".
* Row actions: Show layer / Hide layer · Rename layer · Duplicate · Download · Delete · Add mask / Edit mask / Delete mask · Separate layer · Change layer.
* Per-layer generation: field **"Layer edit prompt"**, **Add reference**, **Generate layer** / **Regenerate layer**; status In queue / In progress / "View generation status" / "Layer generation failed" / "A generation is already running on this layer"; revisions "Show previous versions", "Show next versions", "Restore layer revision", "Reset layer". Tour copy: "Select a layer in the Layers panel, then move it, resize it, or describe your change in its prompt".

### 1.6 Edit text (find & replace)
1. Intro card **How it works** (looping video) — "Edit text finds the text on your image and lists it here. Change any line, then generate a new image with your wording in the original design."
2. **Detect text** (0.5 credits, `image-text-detection`) → blocks `{id, text, bbox {x, y, w, h} in 0–1, confidence}`.
3. Panel **Layers**: one numbered row per block (text input, aria "Text region {n}", placeholder "Remove this text"); hovering a row highlights its box on the canvas. Empty a row to delete that text.
4. Footer: icon **Detect text again** (tooltip "Detect again 0.5 credits") + **Generate** with cost (Seedream 5.0 Pro, one 2K image; ≈2.5 credits _(inferred from the bundle's Seedream 5 Pro table 1K 1.25 / 1.5K 1.25 / 2K 2.5)_).
5. Generate → `seedream-v5-pro-text-edit`, prompt **"Preserve the original design and change only the requested text."**, `textReplacements [{old_text, new_text}]` (max 500), resolution 2k, aspect ratio of the image. Job title: `“old” → “new”` (24-char truncation) / "{n} text changes" / `Remove “old”`.

Empty/stale/errors: "No text was found on this image." · "Restored from your last detection — the image may have changed since. Re-detect if the regions look off." · "Could not read the text on this image." · "Failed to apply the text changes".

### 1.7 Remove background, Regional Editing, Expand & Crop
* **Remove background:** How it works — "Remove background finds the main subject of your image and cuts everything else away, giving you the subject on a transparent background." One button; result becomes a layer edit.
* **Regional Editing:** "Select an area to edit — Draw a rectangle over the image, then describe your changes in the prompt below it." Model picker (Seedream 5.0 Pro) → "Editing region…" → result as two layers **Original** and **New** (show/hide/select each), mask enable/disable + **Mask feather** → **Merge layers** ("Merging…", "Layers merged") · "Edit another region" · Save.
* **Expand & Crop:** "Drag the edges or corners. Crop keeps pixels on layers. Expand adds empty canvas, or turn on Fill with AI to generate it." Toggle **Fill with AI**, Apply / Generate; "The frame no longer overlaps the image. Move it back over the picture."

### 1.8 Downloads (exact)
Menu: **Cropped layers .zip** · **Positioned Layers .zip** · ─ · **Image .png**, plus **Copy JSON** (disabled tooltip "Add a layer to copy as JSON.").

| file | contents |
|---|---|
| `cropped-layers.zip` | each image layer rendered alone, cropped to its own rotation-aware bounding box, + `composite.png` |
| `positioned-layers.zip` | each image layer rendered alone on a transparent canvas the size of the whole document (so they restack in place), + `composite.png` |
| names | `layer-z{layerIndex}-{slug}.png`, slug = lower-case name, runs of non-`[a-z0-9]` → `-`, trimmed, ≤48 chars (fallback `layer-{index}`); sorted by z |

Errors: "No layers to download", "Wait for all layers to finish, then try again."

### 1.9 Marketing Studio posters
Poster/layout results open here through the deep link. Copy: "Posters and layouts open like design files. Each headline, date, and image is its own layer — rewrite it, rename it, swap it — then hit Recreate and the style follows." Ads tour: "Break down your image into editable elements — Text, logo, and background become separate layers, so you can edit each one on its own without redoing the whole design." → "You can edit any layer with AI".

### 1.10 Routes for Fuobe
| step | cloud (paid) | open (ComfyUI) |
|---|---|---|
| decomposition | **Replicate `bytedance/seedream-5-pro`** `layer_decomposition: true`, `size` 1K/1.5K/2K/auto, optional prompt, ≤16 layers, each returned with stacking order, bounding box, name and description ($0.0225 small / $0.045 large per output; already in `paid-model-apis.json`); **fal `fal-ai/qwen-image-layered`** `num_layers` 1–10 (default 4), $0.05/image | **Qwen-Image-Layered** (Apache-2.0) via core nodes `EmptyQwenImageLayeredLatentImage` + `ReferenceLatent` + `LatentCutToBatch` (template `image_qwen_image_layered`, 640 px bucket recommended, `qwen_image_layered_fp8mixed.safetensors` 20.5 GB + `qwen_image_layered_vae` 0.25 GB + `qwen_2.5_vl_7b_fp8_scaled`); prompt-guided variant `image_qwen_image_layered_control` (DiffSynth Layered-Control). Recursive decomposition = "Separate layer" |
| edit text | OCR: `fal-ai/florence-2-large/ocr-with-region` or Claude vision; edit: Seedream 5 Pro edit / Nano Banana Pro / GPT Image | OCR: Florence-2 / PaddleOCR (CPU); edit: **Qwen-Image-Edit-2511** (strong bilingual text editing) with the same "change only the requested text" prompt |
| remove bg | BiRefNet (fal), Bria | BiRefNet core node (`bg-remove-birefnet`, exists) |
| per-layer edit / regional | Seedream 5 Pro edit, Nano Banana Pro | Qwen-Image-Edit-2511 on the cropped layer, paste back |
| zips / compose / JSON | browser-side (canvas) — no model | same |

---

## 2. Photodump

### 2.1 Three generations of the product
| | Photodump Studio (legacy) | Soul 2.0 Photodump | Instadump |
|---|---|---|---|
| launched | 2025-09-18 | 2026-02-26 | 2025-10-27 |
| input | trained Soul v1 character (blog: 25+ photos; flow: "Upload 20+ photos", max 70) | Soul ID v2 character (create or select; v1 characters must "Upgrade Character") | **one** selfie (PNG/JPG/paste, ≤20 MB) |
| templates | one fixed 26-shot set | packs (§2.3), "Select preset" | packs incl. community packs + **Create pack** from up to 15 reference photos |
| output | 26 photos, 9:16, 1080p | one photo per style in the pack (10–17) | pack-sized set, 1600p, chosen aspect (default 3:4) |
| model | Soul v1 (`text2image_soul`) | Soul 2.0 via `/custom-references/photo-dump` (new) or `/retrain-with-photo-dump` (existing) | Popcorn keyframes v3 `photo-dump-pack` |
| cost | button shows 13 _(credits, inferred)_ or "Free" | per Soul 2.0 pricing (not shown) | **10 credits**, or "Try Free" |

### 2.2 Soul 2.0 Photodump modal (`?modal-photo-dump`)
Steps: (hidden first-run **Preview**, remembered) → **Select preset** (pack grid, "Use this preset") → **Select character** if the user has characters, else **Create character** → **Check image** (both "back to Select preset"). Generate: "Generate Your Photodump". Character creation copy: "Upload 20+ photos for best results", "More Photos, Better Results", "Avoid These Types of Photos" — "No duplicates, group shots, pets, nudes, filters, face-covering accessories, or masks"; consent "By clicking Upload, I consent to this biometric data processing and confirm these photos are of me or of a person at least 18 years old who gave written permission." Error: "Cannot start photodump generation, please try again".

### 2.3 Instadump flow (mobile `/photodump/mobile`, keyframes)
1. **Choose a Pack** — grid with Search, History; **Create pack** → "Create new pack — Create a pack from reference photos to generate new images in that style." (Pack name, "Upload your reference set up to 15 photos").
2. **Add your photo** — "Upload one selfie or photo - it’ll be the base for your photodump styles"; aspect picker (Auto, 9:16, 3:4, 2:3, 1:1, 4:3, 16:9, 3:2); Back / **Generate 10** (or "Try Free").
3. **Get your Instadump** — "Your new photos are ready - download, post, share and enjoy!"; Download All ("Download ({available} /{total})"), Restart, Go to Library; per photo Animate / Edit / Delete.

### 2.4 Pack and template list
| pack | photos | product | description |
|---|---|---|---|
| Sleepy Head | 17 | v2 (Soul 2.0 Photodump) | Cosy in-bed / slow-morning set: pyjamas, rumpled sheets, soft window light _(inferred)_ |
| Zen | 10 | v2 (Soul 2.0 Photodump) | Calm wellness set: yoga, tea, quiet natural spaces _(inferred)_ |
| Candid Glow | 12 | v2 (Soul 2.0 Photodump) | Sun-lit candid lifestyle snaps with golden glow _(inferred)_ |
| Office dresscode | 11 | v2 (Soul 2.0 Photodump) | Workwear set: office looks, desks, city commute _(inferred)_ |
| Surreal Self | 12 | v2 (Soul 2.0 Photodump) | Surreal edits of you: scale play, doubles, impossible scenes _(inferred)_ |
| Surreal Self II | 10 | v2 (Soul 2.0 Photodump) | Second surreal set with new impossible scenes _(inferred)_ |
| Alter ego | 12 | v2 (Soul 2.0 Photodump) | Dramatic alter-ego personas and costume looks _(inferred)_ |
| Cool Girl Dump | 15 | v2 (Soul 2.0 Photodump) | Tailored compositions, settings, and styling for female characters |
| Male Archive | 15 | v2 (Soul 2.0 Photodump) | Tailored compositions, settings, and styling for male characters |
| Winter special | 9 | Instadump pack | Seasonal winter set (snow, knitwear, holiday lights) _(inferred)_ |
| Aura farming | 14 | Instadump pack (by neonfluke) | Effortless-cool "aura farming" poses and moody vibes _(inferred)_ |
| Looksmaxing | 15 | Instadump pack (by wispomatic) | Sharp, flattering glow-up portraits _(inferred)_ |
| 2000s nostalgia | 15 | Instadump pack (by trunxel) | Y2K flash snaps and 2000s styling _(inferred)_ |
| Editorial shots | 15 | Instadump pack (by lostsignal) | Magazine-style editorial portraits _(inferred)_ |
| Photodump Studio (legacy, Soul v1) | 26 | legacy | One fixed 26-shot set of trend styles for a trained Soul v1 character (Sep 2025) |

### 2.5 Routes for Fuobe
* **Cloud:** Soul 2.0 (`soul/v2/standard`, `custom_reference_id` = the element's Soul ID) running one job per pack style; or Nano Banana Pro / Seedream 5 with the character reference (no training, Instadump-style).
* **Open:** the element's AI-Toolkit **Z-Image Turbo LoRA** (exists) or zero-shot identity with **Qwen-Image-Edit-2511** multi-reference (`qwen-image-edit-2511-multi`, exists); a pack = N style prompts run as a batch (chained jobs already exist). Pack prompts are ours to write (the studio's styles are opaque ids).

---

## 3. Fashion Factory

"Easily create branded photoshoots by combining your product with a consistent character, delivering unique and professional visuals every time." Tagline "Next generation ultra-realistic fashion visuals". Desktop: Image page modal `modal-fashion-factory`; mobile: `/flow/fashion/{template|character|generation|clothing|photoset}`. First visit: video banner "Fashion factory" + **Select template**.

| # | step | UI and behaviour | model |
|---|---|---|---|
| 1 | **Select presets** — "Choose a template or aesthetic for the photo set" | grid (2 cols mobile, 3 desktop) of 6:7 cards with a preview carousel (hover arrows), uppercase name, lime ring when selected, infinite scroll; **Continue** disabled until selected | — |
| 2 | Character | select or create a Soul ID character; **Next** generates 4 base shots: quality 1080p, aspect 3:4, `enhance_prompt` on, empty prompt, `fashion_factory_id` = template, `custom_reference_id` = character | Soul (v1 job, access key `fashionsFactorySoul`) |
| 3 | Generation | "See instant variations of the selected character" — pick 1 of 4 ("Select an image at the generation step") | — |
| 4 | Clothing | **Upload outfit** (product image) → button becomes **Generate outfit** → base + outfit edited together (aspect auto) → pick a result. "Select a result to generate your photoset from. Edit your outfit or continue". Errors "No product to generate", "Please wait for the image to finish processing before generating" | Nano Banana (`fashionFactoryNanoBanana`) |
| 5 | Photoset | **Get your photoset** — product-placement batch from the dressed image (`is_product_placement`, `_isBatch`) → several images (one per template shot, _inferred_); Download All | Nano Banana |

Buttons Back / Next / "Generating...". Credits are not exposed in the bundle.

| template | preview shots | look _(inferred from name and previews)_ |
|---|---|---|
| Ultra bold | 11 | Bold, saturated colour-blocked studio fashion |
| Blue-Green Gradient | 10 | Studio set on a blue-to-green gradient backdrop |
| Street style Paparazzi | 9 | Street-style shots with paparazzi flash energy |
| View from the top | 6 | High-angle / top-down fashion framing |
| Light blue studio | 10 | Clean pale-blue studio seamless |
| Red room | 9 | Monochrome all-red set |

**Routes for Fuobe.** Cloud: Soul 2.0 + Soul ID (or Nano Banana Pro with character refs) for step 2, **Nano Banana Pro edit** (person + garment) for step 4 (or fal FASHN / Kling Kolors try-on), Nano Banana Pro batch with template shot prompts for step 5. Open: Z-Image Turbo + character LoRA (step 2), **Qwen-Image-Edit-2511 multi-image** (person + garment) for the outfit, Qwen-Image-Edit-2511 per shot for the set. The 6 templates become 6 prompt packs (backdrop + framing + lighting per shot).

---

## 4. Moodboards (Soul 2.0)

"Presets evolved": Curated (built in) and Personal (your own). Soul 2.0 only. Entry: Soul 2.0 generation bar → Moodboard icon → panel with tabs **Curated** / **My Moodboards**, "Search presets...", **Create moodboard**; also `/moodboard` ("AI Moodboard Creator — Define Your Style"). The empty Soul 2.0 composer shows two cards under "Make Soul 2.0 Preset": "Make your own character" and "Create your moodboard".

**Build flow**
1. "CREATE YOUR MOODBOARD — Turn your references into a focused moodboard that defines style, tone, consistent details, and creative direction."
2. Upload: Upload from device / Upload from assets ("Use images you've already created"), "PNG, JPG or Paste from clipboard", Add image, Upload more. Guidance: **Recommended** "20+ photos, one cohesive style, no faces." · **Avoid** "Faces, mixed styles, blurry or low-quality images." (the catalog also has Bad / Good / Perfect labels, likely a reference-quality meter _(inferred)_).
3. Name: "Moodboard name" (server suggests one from the images).
4. **Create moodboard** → trained custom reference (`POST /custom-references/soul-v2-preset {name, input_images}`) → statuses In Queue → In progress → Preparing cover → Complete (or Failed). Using it early: "This moodboard is still training. Try again once it is ready."

| limit | value |
|---|---|
| images | **min 5, max 80** ("Upload at least 5 photos to continue." / "Maximum images per moodboard is 80") |
| image size | ≥256×256 px |
| name | required, ≤100 chars |
| duplicates / NSFW | "This image is already added" · "Remove NSFW images to continue" |
| blog guidance | ~10 high-res images is enough, 20–30 better, up to 80 |

Manage: share link ("Shared by {author}", recipients get "Moodboard added"; "This moodboard link is no longer available"), delete ("Delete moodboard {name}? This cannot be undone." — Yes, delete forever / No, keep them), Reuse. Use: works like a preset (`style_id`) and combines with Soul ID and Soul HEX.

**Curated moodboards** (the Soul 2.0 preset list; 21 in categories + 12 newer uncategorised; descriptions are ours, flagged inferred):

| group | moodboard | look _(inferred)_ |
|---|---|---|
| default | General | Soul 2.0's neutral default look |
| Mood | Asian nostalgia | Nostalgic East Asian film tones and settings |
| Mood | Double exposure | Two images blended in-camera |
| Mood | Mystique city | Mysterious night city, haze and neon |
| Mood | Siren | Dark alluring siren make-up and moody glamour |
| Mood | Surreal solarization | Solarised, partly inverted tones for a surreal glow |
| Mood | Swag era | 2010s swag streetwear: snapbacks, bling, flash |
| Styles | 2000s band | Early-2000s band promo photo |
| Styles | Candy pop | Bright candy-coloured pop styling |
| Styles | Drain | Washed-out, melancholic emo-rap aesthetic |
| Styles | Editorial street style | Fashion-week street-style snaps |
| Styles | Flash editorial | Direct on-camera flash fashion editorial |
| Styles | Frutiger aero | Glossy aqua, bubbles and sky-blue 2000s tech optimism |
| Styles | Subtle flash | Gentle fill flash for natural editorial snaps |
| Styles | Theatrical light | Stage-style spotlighting and deep shadows |
| Styles | Warm ambient | Soft warm interior ambience with golden practical light |
| Styles | Y2K street | Early-2000s street fashion snapped outdoors |
| Camera | Digital camera | 2000s compact digicam look with harsh flash |
| Camera | Old smartphone | Low-res early phone camera: noise, soft focus, blown highlights |
| Camera | Retro BW | Grainy black-and-white film portrait |
| Camera | Street photography | Candid documentary street photography |
| Camera | Y2K studio | Glossy early-2000s studio shoot on coloured seamless |
| uncategorised (newer) | 80s horror | 1980s horror lighting: red and blue gels, fog |
| uncategorised (newer) | BW film | Classic black-and-white film stock |
| uncategorised (newer) | Disposable camera | Disposable film camera flash snapshots |
| uncategorised (newer) | Extraterrestrial | Otherworldly sci-fi light and alien landscapes |
| uncategorised (newer) | Muted cool film | Desaturated cool-toned film |
| uncategorised (newer) | Nature light | Natural outdoor daylight, soft and true to life |
| uncategorised (newer) | Neutral pastel film | Film stock with neutral pastel tones |
| uncategorised (newer) | New Indie | Modern indie look: film grain, candid framing, soft colour |
| uncategorised (newer) | Underwater | Submerged portrait with caustic light |
| uncategorised (newer) | Warm contrast film | Warm, high-contrast film |
| uncategorised (newer) | Warm vivid film | Saturated warm film stock |

**Routes for Fuobe.** Cloud: Soul 2.0 `style_id` (curated ids above work as-is; personal moodboards need the studio's training endpoint, which is not in the public API, so: fall back to multi-reference style prompting on Nano Banana Pro / Seedream 5, or **fal LoRA training** on Z-Image / FLUX). Open: **AI-Toolkit style LoRA** on Z-Image Turbo from the 5–80 images (training pipeline exists for characters; reuse it with a "style" preset and no face crop), or zero-shot style reference (USO / FLUX Redux are non-commercial FLUX.1-dev derivatives; Qwen-Image-Edit-2511 with the board images as refs is Apache). Moodboard = a Fuobe **style element** with images + optional trained LoRA.

---

## 5. Soul HEX / Color Transfer

"Soul Hex extracts colors from any image and turns them into your signature style." Available on Soul 2.0 and Soul Cinema. A saved palette is a **color signature**; the library (`/color-presets`) is shared with Cinema Studio 4.0's colour palettes.

**Entry.** Generation-bar chip (tooltip "Color signature"; shows the selected signature's 16 px thumbnail + name, × to clear) opens the **Hex** panel (popover on desktop, drawer on mobile).

**Panel.** Banner "Control Your Colors with Soul Hex — Upload a reference image and let Soul HEX bring its colors in your own style" + **Upload & Create** (collapses on scroll to "Upload a reference image to create your color signature."). Empty state "Ready to Create Your Hex? — Saved hex cards will appear here. No hex yet — upload an image to begin." Grid of 16:9 cards: thumbnail with a 5 px colour strip along the bottom (pure stripes if no thumbnail), name, selected = brand ring + check, extracting = spinner with "Extracting colors from your images. You can use this palette once it's ready."; "…" Palette options → Delete (user palettes).

**Create options** ("Upload photo or create manually to continue"): **Upload from device** (JPEG/PNG/WebP, multiple, **≤20 images**, 1 is enough) or **Pick colors manually**.
* From images: review uploads (leaving: "Are you sure? Your uploaded photos will be lost." Yes, discard / No, keep them) → name ("Looking for name...", "Enter hex name") → Save → extraction runs server-side.
* Manual editor ("Create manually to continue"): **Current palette** (Clear all; **+ Add color** appends `#FFFFFF`; 40 px circles, hover × "Remove color"); click a swatch → picker popover: saturation/hue field, **Hex color code** input (upper-cased), **Pick a color from the screen** (EyeDropper API, disabled where unsupported), toggle **Use as background** (that swatch shows "BG"). **Random palettes** panel: 4 rows of random colours (each 2–12 random `#RRGGBB`, shown trimmed to 6), refresh "Generate random palettes", click a row to load it. **Save palette** → `POST /color-presets/manual {hex_colors, background_color}`.
* Defaults: colours `#FFFFFF`, `#D1FE17`, `#1C1E20`, background `#53C546`. Limits: 1–12 colours (10 on Recraft V4.1), each `/^#[0-9a-f]{6}$/i`.

**Color Transfer** (separate tool, "New Color Transfer", "Clear color transfer"): apply a finished grade to existing outputs so a series matches.

**Built-in palettes (50, exact hex).** Each has 12 colours; in every palette the 12th colour is also its `background_color` (the HEX card strip shows the background first, then the other 11, de-duplicated); `slug` is the Cinema Studio 4.0 API `color_palette` value (all 50 match Fuobe's generated enum, including the API's own spelling `crimson-vigi`).

| # | palette | slug | background | 12 colours |
|---|---|---|---|---|
| 1 | Static Noon | `static-noon` | `#69483B` | `#0C0C0C` `#28292A` `#4E4F51` `#626263` `#A25955` `#7B7B7B` `#939548` `#A7A7A6` `#C1C2C2` `#B6C6B7` `#EDEDED` `#69483B` |
| 2 | Twilight Fable | `twilight-fable` | `#764019` | `#040605` `#1E4F59` `#5D4623` `#7B5D35` `#36797F` `#948052` `#B2A24A` `#56AFAE` `#88B2C9` `#DAC593` `#F3F4EA` `#764019` |
| 3 | Back Row Kissing Seats | `back-row-kissing-seats` | `#881913` | `#070405` `#4E1311` `#1A4388` `#875046` `#B26A38` `#6079C3` `#2DA744` `#B89892` `#846E69` `#9CCD8A` `#C4C7D2` `#881913` |
| 4 | On the Other Side of the Porthole | `on-the-other-side-of-the-porthole` | `#B82D1C` | `#090709` `#720B11` `#474548` `#3D537D` `#933542` `#776343` `#71726E` `#969C9E` `#9DBBD8` `#C6BFB5` `#A3CBA9` `#B82D1C` |
| 5 | The Emerald Ambush | `the-emerald-ambush` | `#1D481B` | `#101210` `#4B4D2D` `#3C4C7B` `#64574B` `#3D703B` `#6986A7` `#959B87` `#CA9E80` `#BEBEC1` `#98D0D5` `#F0F7F0` `#1D481B` |
| 6 | Highway Standoff | `highway-standoff` | `#0F1C79` | `#0D110C` `#36463F` `#69351A` `#635A39` `#215CA7` `#607765` `#867660` `#9B9C85` `#BEB389` `#ADC7AE` `#EEE6C2` `#0F1C79` |
| 7 | The Faded Fresco | `the-faded-fresco` | `#B8B592` | `#14120E` `#4B4536` `#6D443E` `#5B544D` `#646864` `#7A6B62` `#8C877D` `#A2957F` `#B4B8A1` `#CBD196` `#C9E1C7` `#B8B592` |
| 8 | Oil & Ochre | `oil-ochre` | `#8D7941` | `#0D0D0A` `#342619` `#524628` `#654E38` `#6D6932` `#636962` `#93896F` `#AEA483` `#D0A681` `#E0D0A7` `#E1DCC8` `#8D7941` |
| 9 | The Mountain Convent | `the-mountain-convent` | `#942417` | `#0A0A07` `#342F1F` `#464D47` `#695037` `#405E2D` `#646257` `#7E8079` `#7EA1C7` `#B29E73` `#B1B7B9` `#C6D7DE` `#942417` |
| 10 | Ghost in the Code | `ghost-in-the-code` | `#638A63` | `#040605` `#1B331D` `#664836` `#3C6052` `#696747` `#818380` `#928363` `#6A9387` `#B8AD9A` `#BFE1C8` `#E6EBE9` `#638A63` |
| 11 | Pink Velvet | `pink-velvet` | `#9F140B` | `#0D0C0F` `#682F1D` `#205279` `#7C5144` `#3078A3` `#996D73` `#7F818D` `#D29D9F` `#DDA780` `#D7C5C8` `#EFDCD5` `#9F140B` |
| 12 | Two Days to the Horizon | `two-days-to-the-horizon` | `#988357` | `#060805` `#254850` `#55482C` `#774C18` `#696C53` `#558085` `#828767` `#C0A875` `#A7BAA6` `#CCC9A4` `#E2E5CB` `#988357` |
| 13 | Industrial Fog | `industrial-fog` | `#561B11` | `#121012` `#300D0B` `#4D4840` `#6E4F42` `#5D5857` `#6E6E70` `#7F8180` `#989A99` `#ADB2B1` `#C4B09A` `#CCCED0` `#561B11` |
| 14 | Stairs Go Up | `stairs-go-up` | `#814F21` | `#050B0E` `#3D301F` `#375133` `#50574D` `#705B44` `#557C76` `#9F8865` `#87A290` `#4CB9A3` `#BEBE9B` `#B2D0B5` `#814F21` |
| 15 | Field Post | `field-post` | `#0A5A0E` | `#040505` `#514E28` `#295860` `#3E5B46` `#716538` `#5F8681` `#65A1D2` `#A9A668` `#D9B388` `#E3E39F` `#F8FAF4` `#0A5A0E` |
| 16 | Home Is the Next Gas Station | `home-is-the-next-gas-station` | `#20345C` | `#0D0907` `#14182F` `#434145` `#57514E` `#766360` `#596D8A` `#8C868A` `#7D92BD` `#A57852` `#878BA1` `#B2AEB2` `#20345C` |
| 17 | Glossy Flesh | `glossy-flesh` | `#8B2926` | `#0C0B11` `#223750` `#5B4747` `#785753` `#797074` `#B37092` `#92919D` `#D28C60` `#89C2DF` `#B1BCCE` `#D2C5CE` `#8B2926` |
| 18 | The Crimson Ballet | `the-crimson-ballet` | `#D20C25` | `#0B0509` `#291C7D` `#621418` `#805442` `#475BE0` `#D3184E` `#807D8B` `#B59C93` `#C5BFD9` `#70DDF8` `#F2E322` `#D20C25` |
| 19 | Neon Rain at Midnight | `neon-rain-at-midnight` | `#446BC7` | `#0C0C0E` `#334D4E` `#7B3612` `#655254` `#676650` `#497197` `#708986` `#B3978E` `#95B0C2` `#BEBC9D` `#F3E04E` `#446BC7` |
| 20 | The Morning After Rain | `the-morning-after-rain` | `#255E54` | `#0B0B0B` `#3C3228` `#404845` `#5E6459` `#3E6F81` `#7C7670` `#458F83` `#8BA1AF` `#A8BCCC` `#6EC9CE` `#C1D4E0` `#255E54` |
| 21 | The Iron Borough | `the-iron-borough` | `#B02610` | `#0A0604` `#2B0F07` `#613926` `#893D10` `#555461` `#756664` `#87858B` `#AD887C` `#D3AA6B` `#ACB6C2` `#F5F8F9` `#B02610` |
| 22 | The Ground | `the-ground` | `#688AD2` | `#0A0708` `#4B3E35` `#3F4B72` `#675B52` `#757F5F` `#907A66` `#AD9E92` `#82A9DE` `#D2B48B` `#C7BFBB` `#E2E7F5` `#688AD2` |
| 23 | The Investigation | `the-investigation` | `#2A7C8E` | `#0B0C0F` `#1A303D` `#515346` `#3A5B58` `#845931` `#6A7D78` `#E06B84` `#6C9CA0` `#8CB8B1` `#B3D1BC` `#D5E6C2` `#2A7C8E` |
| 24 | Turquoise Mirage | `turquoise-mirage` | `#0D8B06` | `#161614` `#054503` `#4C4A43` `#66635A` `#9A6941` `#6A8474` `#4AA290` `#9C9E72` `#87BC90` `#59CEC2` `#CAD7A2` `#0D8B06` |
| 25 | A Dream in Color | `a-dream-in-color` | `#CB9336` | `#0C0B0A` `#5A3723` `#354D30` `#6D4D37` `#4D5E45` `#5D5C67` `#A78672` `#8D8DB1` `#B7A9A1` `#B0B4CC` `#EAC94A` `#CB9336` |
| 26 | Breakfast on Schedule | `breakfast-on-schedule` | `#533115` | `#111217` `#732419` `#494637` `#6E5133` `#416C87` `#68734A` `#7B796B` `#91A5B0` `#A6B1AA` `#AAC2C8` `#CADCD6` `#533115` |
| 27 | Favela Gold | `favela-gold` | `#D3AC74` | `#0A0807` `#563322` `#464969` `#57594D` `#765636` `#586F93` `#867B7E` `#ACA389` `#85B1F7` `#ACB4B5` `#F3F7F3` `#D3AC74` |
| 28 | A Hotel for One | `a-hotel-for-one` | `#101821` | `#07070C` `#1F1414` `#362E25` `#094B27` `#494B4B` `#2C5354` `#584E3C` `#686664` `#423B30` `#314041` `#4F3A2F` `#101821` |
| 29 | After Dark | `after-dark` | `#1D1885` | `#0A090C` `#651113` `#1D2D6C` `#794F3D` `#575A67` `#118D65` `#5B8AA0` `#A99A93` `#BA9569` `#919FAF` `#CFCBC6` `#1D1885` |
| 30 | Crimson Vigi | `crimson-vigi` | `#C72F1F` | `#0B080A` `#483125` `#98261C` `#654F46` `#4870CA` `#926B51` `#E95531` `#BF9982` `#F0854A` `#FEC17B` `#DBD6D4` `#C72F1F` |
| 31 | The Neighbors Saw Everything | `the-neighbors-saw-everything` | `#5B3B29` | `#0F1116` `#2E1C11` `#644727` `#76554A` `#3B6084` `#646058` `#948676` `#9D9FA4` `#778082` `#6293B2` `#B7BCC9` `#5B3B29` |
| 32 | The Grey Channel | `the-grey-channel` | `#CECFA5` | `#081214` `#164942` `#494D3E` `#6B533B` `#30706C` `#787B61` `#5B8F82` `#9AA491` `#B1B898` `#A4C8B0` `#E7DDB3` `#CECFA5` |
| 33 | Mirage at Noon | `mirage-at-noon` | `#954924` | `#0C0B0C` `#403733` `#5D463B` `#7F503E` `#695D5A` `#707E9B` `#A47E70` `#B2A3A1` `#A5B9B3` `#D5CED3` `#F4DDAF` `#954924` |
| 34 | Bubblegum Boulevard | `bubblegum-boulevard` | `#AA637E` | `#181415` `#2F3973` `#62382F` `#6B524E` `#957A70` `#878894` `#B48F60` `#65B0CB` `#C3B0A9` `#81D7F9` `#E5E0DF` `#AA637E` |
| 35 | Yellow Room | `yellow-room` | `#EBD41A` | `#0E0606` `#222E2A` `#513D1A` `#884F1E` `#6A6A67` `#388516` `#A3A59C` `#67B5AE` `#D0B32B` `#5AC99C` `#E3ECCB` `#EBD41A` |
| 36 | The Earth Keeps Things, Reluctantly | `the-earth-keeps-things-reluctantly` | `#282A48` | `#110F11` `#34221F` `#474547` `#55565A` `#6A755F` `#807A7A` `#9B949C` `#9EAF9F` `#BEB0B8` `#AEB7D4` `#EAE1F5` `#282A48` |
| 37 | Tropic Fever Dream | `tropic-fever-dream` | `#8D4F28` | `#090C0C` `#6B111A` `#584D54` `#305A6E` `#96414B` `#7C7C88` `#65949B` `#CA8A5E` `#DF877A` `#F3B32B` `#C8BDA3` `#8D4F28` |
| 38 | Bioluminescent Night | `bioluminescent-night` | `#564ABB` | `#0D0F12` `#1F2574` `#2F473F` `#8D421F` `#3D667C` `#54988A` `#83A6BD` `#C099A0` `#B8A3ED` `#D7B06D` `#C0D5DB` `#564ABB` |
| 39 | Don't Turn It Off, I'm Watching | `dont-turn-it-off-im-watching` | `#0C1640` | `#0C0B0C` `#132669` `#16433E` `#245986` `#973911` `#31706C` `#82797F` `#A49051` `#6097B2` `#46B291` `#ABA8A3` `#0C1640` |
| 40 | The Silk Curtain Falls | `the-silk-curtain-falls` | `#672A0E` | `#1F0303` `#2B313D` `#5F4F36` `#6A512A` `#3A596C` `#CE5838` `#A89062` `#77B2BA` `#C6B395` `#89ECE9` `#F7E9D4` `#672A0E` |
| 41 | The Butterfly | `the-butterfly` | `#771C1E` | `#0D0C08` `#52463B` `#415747` `#6C604B` `#5C686A` `#708A87` `#918461` `#8694A6` `#BCC5D2` `#EFE990` `#ECEEF2` `#771C1E` |
| 42 | Playtime | `playtime` | `#725738` | `#12160F` `#4E3921` `#3E4B50` `#4F5451` `#626F6F` `#876B57` `#868F86` `#A8AC9D` `#AFBDB3` `#CBD0BE` `#C0E1CF` `#725738` |
| 43 | Wallpaper Romance | `wallpaper-romance` | `#883063` | `#121010` `#741313` `#4A4B58` `#435E6D` `#69605E` `#8B5952` `#787E7B` `#A6997F` `#9FA796` `#BBB192` `#DFD0A4` `#883063` |
| 44 | Overtime | `overtime` | `#866B22` | `#080502` `#1F2A08` `#66450D` `#AC3510` `#746931` `#97611C` `#8F8E6C` `#CB983B` `#A7BC89` `#DFC178` `#EDEEDF` `#866B22` |
| 45 | The Way Home Is Longer | `the-way-home-is-longer` | `#6C93F4` | `#0C0A0A` `#2B3352` `#484042` `#525776` `#69544B` `#587AD4` `#C4836C` `#91A6EF` `#B0C0F5` `#DFBCB0` `#E3E1F1` `#6C93F4` |
| 46 | Everyone Speaks in Whispers | `everyone-speaks-in-whispers` | `#865517` | `#0F0C0B` `#65370D` `#4D4B47` `#724C31` `#5A6661` `#916D4C` `#9A896A` `#7E9689` `#ACBB9E` `#C6BE94` `#F2F1C4` `#865517` |
| 47 | Runaway Summer | `runaway-summer` | `#BE1205` | `#0F0F0D` `#5D1610` `#4E523A` `#595452` `#277540` `#7C745F` `#8A939A` `#B8A590` `#ADB1B0` `#D6CC6A` `#C6DFE3` `#BE1205` |
| 48 | Amber Wasteland | `amber-wasteland` | `#BF6909` | `#0B0B0B` `#294446` `#7B3A07` `#A04003` `#5B6866` `#A8792D` `#798B82` `#9BAA95` `#72833F` `#C0B981` `#DAD5BC` `#BF6909` |
| 49 | The Circus | `the-circus` | `#B70204` | `#090A0B` `#900304` `#1D5768` `#58554A` `#8E5917` `#627163` `#979D7E` `#7DACA6` `#7F907D` `#ADD3C0` `#CCEBD8` `#B70204` |
| 50 | Gasoline Sunset | `gasoline-sunset` | `#B36521` | `#0E0D0C` `#4E2A15` `#0D4486` `#65565D` `#894F29` `#3478A9` `#A09296` `#D38846` `#DAB4A2` `#CCB8BD` `#ECD6DD` `#B36521` |

The palettes named in the Help Center and blog (Film colors, Lime Jam, Candy pink, Nostalgic blue, Soft palette, Black gloss) are no longer returned by the API or present in the UI catalog; their hex values could not be obtained. Fuobe already ships them as prompt-only grades in `src/lib/catalog/motions.ts`.

**Routes for Fuobe.** Extraction: k-means in the browser (no model). Apply: cloud Soul 2.0/Soul Cinema have no public palette field, so inject the hex list into the prompt (FLUX.2, Nano Banana, Seedream and GPT Image follow hex codes) and optionally run **palette transfer** after; open: FLUX.2 hex prompting + the existing `palette-transfer-image` / `palette-transfer-video` ComfyUI graphs (✅ on CPU). Cinema Studio 4.0 cloud: pass the palette's `slug` as `color_palette`.

---

## 6. Soul photo presets

**Soul (v1)** — 106 presets, 100 with a public page (`/soul/<id>`). Categories from `/soul/preset-categories` (a preset can be in several; 41 are categorised, the rest only appear under "All presets"): **New, TikTok Core, Instagram Aesthetics, Camera Presets, Beauty, Mood, Surreal, Graphic Art**. The picker also shows **All** and, behind a feature flag (`access-image-style-category-dump`), **Dump**. The Help Center's older list ("General, TikTok Core, Instagram Aesthetics, Beauty, Mood, Camera Photo, Graphic Art") is out of date. Default preset `General` = `464ea177-8d40-4940-8d9d-b438bab269c7` (the same id the public API uses as `style_id`). Descriptions are the studio's except the 35 marked _inferred_ (the studio publishes none for them; most are the Sep 2025 "dump" batch).

Category membership (from `/soul/preset-categories`):

| category | presets |
|---|---|
| New (10) | Flight mode, Sunset beach, Mt. Fuji, Street view, Library, Escalator, Gallery, Crossing the street, Sunbathing, Subway |
| TikTok Core (8) | DigitalCam, Flight mode, Sunset beach, Street view, Bimbocore, CCTV, Y2K, Y2K Posters |
| Instagram Aesthetics (5) | iPhone, Realistic, Flight mode, Sunset beach, CCTV |
| Camera Presets (7) | iPhone, DigitalCam, Sunset beach, CCTV, 2000s Cam, Fisheye, 360 cam |
| Beauty (8) | iPhone, DigitalCam, Sunset beach, CCTV, 90s Grain, 2000s Cam, Fisheye, 360 cam |
| Mood (9) | Mt. Fuji, Street view, Spotlight, Sand, Rainy Day, Foggy Morning, Avant-garde, Fairycore, Overexposed |
| Surreal (5) | Mt. Fuji, Nail Check, Giant Accessory, Creatures, Shoe Check |
| Graphic Art (9) | Invertethereal, Mixed Media, Paper Face, 2000s Fashion, Long legs, Glitch, Artwork, Graffiti, Duplicate |

All 106 presets in picker order (categories in brackets):

| # | preset | categories | description |
|---|---|---|---|
| 1 | General | — | Clean, balanced, and natural—your go-to look with true-to-life colors and soft lighting. Effortlessly versatile for any style |
| 2 | iPhone | Instagram Aesthetics, Camera Presets, Beauty | Natural light, casual framing, soft HDR glow. Looks real, but a little better |
| 3 | Realistic | Instagram Aesthetics | No filters, just flawless clarity. Light, pores, fabric—everything exactly as it is, but better |
| 4 | DigitalCam | TikTok Core, Camera Presets, Beauty | Harsh flash, timestamp corner, and raw textures. Feels like 2007 captured forever |
| 5 | Flight mode | New, TikTok Core, Instagram Aesthetics | Airports, terminals — everything designed to feel like you're traveling. Modern architecture, clean lines, and a subtle “main character leaves town” aura. |
| 6 | Sunset beach | New, TikTok Core, Instagram Aesthetics, Camera Presets, Beauty | Golden-hour dreams. The sky melts from purple to peach while you pose like you don’t know the sun’s watching. Glowy skin, backlit outlines, and luxury vacation stillness. |
| 7 | Mt. Fuji | New, Mood, Surreal | Postcard surrealism. Crystal-blue skies, iconic mountain symmetry, and convenience store drama. |
| 8 | Street view | New, TikTok Core, Mood | Candid street-level shot, as if caught by a passing camera on a city sidewalk _(inferred)_ |
| 9 | Tokyo Streetstyle | — | Layered looks, sharp silhouettes, and fearless color. A street-level runway of innovation and self-expression |
| 10 | Bimbocore | TikTok Core | Hyperfeminine overload: glossed lips, tiny skirts, and confidence cranked to 100. Plastic fantastic, but make it powerful |
| 11 | CCTV | TikTok Core, Instagram Aesthetics, Camera Presets, Beauty | Grainy surveillance vibe. Raw, unfiltered and highly realistic |
| 12 | Elevator Mirror | — | Full-body mirror selfie in a metallic elevator, phone in hand _(inferred)_ |
| 13 | Y2K | TikTok Core | Gloss, glitter, and baby tees. A shiny reboot of early 2000s maximalism—flip phones and all |
| 14 | RingSelfie | — | Manicured hands, glossy lips, and a flash that catches the sparkle. Casual flex, maximal impact |
| 15 | Spotlight | Mood | Direct light creating high-contrast drama, paparazzi flash, and instant icon energy |
| 16 | Y2K Posters | TikTok Core | Chrome text, airbrushed skin, and floating objects. Early internet meets teen bedroom wall |
| 17 | Nail Check | Surreal | Close-up hands showing off nail art, rings, and textures. Precision beauty with attitude |
| 18 | Gorpcore | — | Function becomes fashion. Technical fabrics, bulky sneakers, and colorblocked gear that looks runway-ready - on a hike or in the city |
| 19 | 90s Grain | Beauty | Warm tones, film texture, and a soft blur—retro mood in every pixel |
| 20 | 0.5 Selfie | — | Front cam, half-body, mirror or not. Unfiltered fits and real-life lighting - effortlessly authentic |
| 21 | 0.5 Outfit | — | Shot from the waist down with wide-angle distortion. Casual, candid, and effortlessly cool—your fit, half-framed, full vibe |
| 22 | Medieval | — | Chainmail chic, velvet drapes, and candlelit intrigue. Courtly vibes with cinematic weight |
| 23 | Japandi | — | Minimalism with warmth. Clean lines, natural light, and a serene sense of balance between form and feeling |
| 24 | Coquette core | — | Soft focus and lace daydreams. Bows, blush, and a wink - sweetness laced with irony |
| 25 | Sand | Mood | Sculptural silhouettes in windswept dunes. Neutral tones, survivalist edge-high fashion lost in a dust storm |
| 26 | 2000s Cam | Camera Presets, Beauty | Low-rise everything, rhinestones, and visible thongs. Nostalgia wrapped in early paparazzi glam |
| 27 | Quiet luxury | — | Understated old-money styling: neutral cashmere, tailored lines, no logos _(inferred)_ |
| 28 | Giant Accessory | Surreal | One item exaggerated to surreal scale—bags, bows, or earrings blown up for visual drama |
| 29 | HairClips | — | Chunky, colorful, or pearl-lined-accessories that turn heads and frame the face with playful precision |
| 30 | 505room | — | Moody hotel-room scene in low warm lamp light _(inferred)_ |
| 31 | Eating Food | — | Candid close-up mid-bite, casual food-diary energy _(inferred)_ |
| 32 | Rainy Day | Mood | Moody skies, reflections in wet pavement, soft sweaters. A slow, cinematic quiet |
| 33 | Foggy Morning | Mood | Muted colors, blurred horizons, and quiet light. Dreamlike stillness in early hours |
| 34 | Avant-garde | Mood | Sculptural beauty, unexpected forms. A look that speaks in bold shapes and silent statements |
| 35 | Tumblr | — | Grainy gifs, soft blur, and blue-toned melancholy—effortlessly curated and emotionally charged |
| 36 | Through The Glass | — | Shot behind fogged-up windows or café panes. A quiet moment seen, not staged |
| 37 | Vintage PhotoBooth | — | Flash-lit nostalgia in strip form. Grain, glare, and a kiss of chaos |
| 38 | Fisheye | Camera Presets, Beauty | Exaggerated depth and playful proportions. Face or object up close, background stretched to infinity |
| 39 | Geominimal | — | Clean lines, geometric overlays. Sharp, modern, minimalist settings |
| 40 | 7\ | — | Distorted realism of Aphex Twin with eerie edits, glitch vibes, cult-classic weirdness |
| 41 | Selfcare | — | Candles, skincare, robes. Glowing peace in muted tones and soft light |
| 42 | Babydoll MakeUp | — | Fluttery lashes, pouty lips, and porcelain skin-sweet meets surreal in a hyper-feminine glow-up |
| 43 | Fairycore | Mood | Glittery woodland fantasy. Soft pastels, magical sparkles, enchanted innocence |
| 44 | Office beach | — | Corporate meets coastal. Suits and sand, spreadsheets with sunglasses - chaotic and sun-bleached |
| 45 | Swords Hill | — | High fantasy on a mountain slope. Capes, steel, wind-blown drama—part legend, part editorial |
| 46 | Amalfi Summer | — | Lemon light, sunkissed skin, linen dresses fluttering on cobblestone-luxury by the sea |
| 47 | Creatures | Surreal | Animalistic details fused with human edge, strange, eerie and beautiful |
| 48 | Grunge | — | Distressed denim, oversized flannel, and don’t-care hair. Moody, messy, iconic |
| 49 | Glazed doll skin makeup | — | Glass-like skin with high-shine finish. Dewy, doll-like, and flawlessly unreal |
| 50 | Invertethereal | Graphic Art | Negative tones and ghostly hues. Dreamlike, eerie, and light turned inside out |
| 51 | Indie sleaze | — | Flash-lit chaos, smudged eyeliner, and blurry rebellion. Tumblr-era nightlife energy in its rawest, hottest form |
| 52 | Mixed Media | Graphic Art | Layers of photo, paint, text, and texture. A visual collage with chaotic elegance |
| 53 | Paper Face | Graphic Art | A face collaged from torn paper, textures, and cutouts-raw edges meet artistic expression. Mixed media magic with a surreal twist |
| 54 | 2000s Fashion | Graphic Art | Flashy fits, shiny textures, and Y2K icons—low-rise, high-attitude, totally throwback |
| 55 | Movie | — | Widescreen film-still look with cinematic lighting and grade _(inferred)_ |
| 56 | Overexposed | Mood | Washed-out whites, crushed detail, and intense brightness. A raw visual effect that feels accidental, emotional, and unfiltered |
| 57 | Long legs | Graphic Art | Elongated limbs and stretched proportions. Stylized drama with a runway edge |
| 58 | Night Beach | — | Moonlit waves, dark silhouettes, and salt in the air. Intimate and a little unreal |
| 59 | 90’s Editorial | — | Retro fashion magazine style image with film grain, soft blur, moody colors, and pure nostalgia |
| 60 | Sitting on the Street | — | Laid-back pose meets city grit. Candid, cool, and consciously unbothered |
| 61 | Glitch | Graphic Art | Pixel drag, color distortion, and digital noise. Beautiful errors in motion |
| 62 | FashionShow | — | Backstage flashes, bold looks, and runway energy—where chaos meets couture |
| 63 | Artwork | Graphic Art | Framed moments with painterly depth. A still life of emotion, texture, and light |
| 64 | Graffiti | Graphic Art | Spray textures, bold lines, and rebellious color. Raw energy in every frame |
| 65 | Angel Wings | — | Soft look with delicate wings giving dreamy and weightless |
| 66 | PixeletedFace | — | Retro-glitch vibe with a pixelated face—playful, edgy, straight out of an early-internet dream |
| 67 | Grillz Selfie | — | Flash-heavy close-up of shiny teeth, with grills, bold attitude, underground luxury |
| 68 | Shoe Check | Surreal | A visual trend where the focus is on footwear, often captured from a top-down or ground-level angle |
| 69 | Bleached Brows | — | Barely-there brows, futuristic face. A blank canvas for bold energy and alien glam |
| 70 | Object Makeup | — | Collage-style layers. An object below, makeup above, colors duplicated for surreal, editorial face art |
| 71 | 360 cam | Camera Presets, Beauty | Wrap-around perspective with immersive distortion. Captures everything-warped, wide, and wonderfully weird |
| 72 | Giant People | — | Surreal scale play: the subject towers over a miniature world _(inferred)_ |
| 73 | Help It's Too Big | — | Comedic oversized prop or garment dwarfing the subject _(inferred)_ |
| 74 | Duplicate | Graphic Art | Echoed figures, mirrored forms, or repeated poses-surreal symmetry that bends perception |
| 75 | Library | New | Soft indoor lighting meets cozy academia. Perfect for quiet power, timeless knits, and capturing the stillness of thought between the shelves. |
| 76 | Escalator | New | Gliding style in motion. This preset captures that effortless  mall paparazzi look — structured outfits, steel gradients, and motion frozen in frame. |
| 77 | Gallery | New | Neutral walls, high taste. This preset frames your subject like a work of art — minimal, polished, and modern. |
| 78 | Crossing the street | New | Boss walk energy. Overhead angles, harsh midday shadows, and that perfect step mid-cross. Looks stolen from a fashion mag. |
| 79 | Sunbathing | New | Clear turquoise water, woven bags, towel texture, and heat-soaked skin. |
| 80 | Subway | New | Fluorescent-lit subway car or platform, candid commuter vibe _(inferred)_ |
| 81 | birthday mess | — | Flash-lit party aftermath with cake, balloons and confetti _(inferred)_ |
| 82 | static glow | — | Soft TV-static haze and analog light bloom _(inferred)_ |
| 83 | Clouded Dream | — | Dreamy pastel sky, soft clouds and airy haze _(inferred)_ |
| 84 | Double take | — | The same subject appears twice in one frame _(inferred)_ |
| 85 | Red balloon | — | Minimal scene with a single red balloon as the accent _(inferred)_ |
| 86 | tokyo drift | — | Neon Tokyo night streets and car culture, motion-blurred lights _(inferred)_ |
| 87 | Rhyme & blues | — | Moody 90s R&B album-cover look, deep blues and a soft spotlight _(inferred)_ |
| 88 | Bike mafia | — | Crew posing with motorbikes, gritty street attitude _(inferred)_ |
| 89 | dmv | — | Flat, harsh ID-photo lighting like a driver's-licence portrait _(inferred)_ |
| 90 | Sea breeze | — | Windswept seaside portrait, linen and salt air _(inferred)_ |
| 91 | It’s french | — | Parisian chic: stripes, berets, cafe terraces _(inferred)_ |
| 92 | Fish-eye twin | — | Fisheye close-up with a mirrored twin _(inferred)_ |
| 93 | hallway noir | — | Dark hallway, hard single-source light, noir shadows _(inferred)_ |
| 94 | burgundy suit | — | Tailored burgundy suit editorial on a muted backdrop _(inferred)_ |
| 95 | Nicotine glow | — | Warm smoky low light, amber haze, late-night mood _(inferred)_ |
| 96 | green editorial | — | Fashion editorial built around saturated greens _(inferred)_ |
| 97 | afterparty cam | — | Direct-flash point-and-shoot snaps from the after-party _(inferred)_ |
| 98 | 2049 | — | Dystopian sci-fi haze in orange and teal _(inferred)_ |
| 99 | Fireproof | — | Posing amid flames and sparks, heat-haze drama _(inferred)_ |
| 100 | Night rider | — | Night ride under streetlights with motion streaks _(inferred)_ |
| 101 | chrome exit | — | Chrome and metallic surfaces, futuristic styling _(inferred)_ |
| 102 | brick shade | — | Streetwear portrait against a brick wall in hard shade _(inferred)_ |
| 103 | blackout fit | — | All-black monochrome outfit _(inferred)_ |
| 104 | cocktail | — | Glamorous cocktail-bar scene in warm bar light _(inferred)_ |
| 105 | mount view | — | Mountain-top portrait with a panoramic vista _(inferred)_ |
| 106 | Sunburnt | — | Sun-baked warm tones, flushed skin, harsh midday light _(inferred)_ |

**Soul 2.0** — the curated moodboards in §4 (default `General` = `3db34ab5-3439-4317-9e03-08dc30852e69`). Soul Cinema has no presets (two hidden styles "General" / "Soul 1.5 General").

**Composer settings (Soul 2.0).** Aspect 9:16, 3:4, 2:3, 1:1, 4:3, 16:9, 3:2 · Quality **1.5k** ("1.5k quality, fastest and cheapest", API value 720p) / **2K** ("2k quality, best visual fidelity", 1080p) · batch 1–4 · Enhance prompt · preset or moodboard · Soul ID · Soul HEX · reference image (disables the prompt). **0.125 credits per image** at either quality.

**What Fuobe has / should add.** Fuobe fetches the Soul style lists live from the studio (`src/server/providers/{studio}.ts`, `soul-v1` / `soul-v2` sources), so the pickers are empty without a key, and it has no categories. Add the JSON list as a static fallback with categories, previews and descriptions; on the open engine use each preset's description as a prompt template on Z-Image Turbo / FLUX.1 Krea (prompt-only parity).

---

## 7. Character Sheet ("Build Your AI Avatar", `/character-sheet`)

"Create a consistent AI character for your videos — from reference or define your character's look from scratch."

* **From Reference:** drop zone "Drop images here", 1–5 images ("Upload at least 1 image", "Maximum 5 images") → **Create AI Avatar** → `POST /jobs/v2/character_sheet {params: {medias: [{role: "image", data: {id, type}}]}}` → "Submitting...", "Processing {completed}/{total}", "Creating..." → a character sheet saved as a reusable reference element. Errors "Failed to create character sheet", "Protected or Inappropriate content is not allowed".
* **or build from scratch:** the **Soul Cast** form (Randomize, Reset) → `cinematic_studio_soul_cast` with `create_reference_element: true`, 16:9, 1080p, batch 1.

**Soul Cast fields** (all option cards have images; 0.125 credits per image; defaults era 2020, budget 250, batch 10, random genre if unset):

| field | options |
|---|---|
| `genre` | Action, Adventure, Comedy, Drama, Thriller, Horror, Detective, Romance, Sci-Fi, Fantasy, War, Western, Historical, Sitcom |
| `era` | 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020 |
| `gender` | male, female |
| `build` | Slim, Average, Athletic, Muscular, Stocky, Plus-size |
| `height` | Very short, Short, Average, Tall, Very tall |
| `race` | White, Black, Asian, Latino, Indigenous, Mixed |
| `eye_color` | Brown, Blue, Green, Hazel, Gray, Amber |
| `hair_style` | Short, Medium, Long, Very long, Ponytail, Bun, Braids, Dreadlocks, Afro, Fringe/Bangs, Undercut, Slick back, Messy, Shaved sides, Bald |
| `hair_texture` | Straight, Wavy, Curly, Coily |
| `hair_color` | Black, Brown, Blonde, Red, Gray, White, Auburn |
| `facial_hair` | Clean-shaven, Stubble, Beard, Short beard, Mustache, Long beard |
| `facial_hair_color` | Black, Brown, Blonde, Red, Gray, White, Light brown, Auburn |
| `age` | 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70 |
| `outfit` | Casual, Formal, High Fashion, Military, Sporty, Workwear, Vintage, Punk |
| `imperfections` | Facial scar, Freckles, Tattoos, Eye patch |
| `archetype` | Innocent, Everyman, Hero, Caregiver, Explorer, Rebel, Lover, Creator, Jester, Sage, Magician, Ruler |
| `budget_millions` | 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 350, 400, 450, 500 |

Public API equivalent already in Fuobe: `{studio}/ai-influencer` character sheet ($0.05) as the AI Influencer app.

**Routes for Fuobe.** Cloud: the studio `ai-influencer` (exists) or Nano Banana Pro with a "character sheet: front, 3/4, profile, full body on white" prompt from the references. Open: Qwen-Image-Edit-2511 multi-reference with the same sheet prompt, or Z-Image Turbo from a Soul Cast-style structured prompt; result saved as an @element (the "Save as character" path exists).

---

## 8. Soul Location (Cinema Studio)

Cinema Studio's set builder ("Cinema Studio Soul Location"; model card **Cinematic Locations — Rich environments with cinematic lighting**). The Elements panel has **Characters** ("Reuse characters across scenes", Create Character) and **Locations** ("Keep every scene in the same world", Create Location).

Flow: **Create Location / New Location** → "Describe your location" (≤2,500 chars) **or** "Or upload your own location" → Generate location (job `soul_location`, 0.125 credits per image) → "Building location: {name}" → "Built location: {name}" / "Location build failed: {name}" → "Show the same location from another view." → **Save location** / Save As Location ("Saved as Location") → Use location / Change location / Delete location ("This removes {name} from your locations."). Limits: "Max {n} locations", "Max {n} location or prop" per generation; composer placeholder "Describe your scene - use @ to add characters & locations".

**Routes for Fuobe.** Cloud: Soul Cinema / Nano Banana Pro for the establishing shot, Nano Banana Pro or Qwen multi-angle (fal) for other views. Open: Z-Image Turbo / Qwen-Image 2512 for the empty set, **Qwen-Image-Edit-2511 + Multiple-Angles LoRA** (in the research already) for "another view". Save as a `location` element (the element type exists).

---

## 9. Build recommendation for Fuobe

Order chosen by value per effort. Everything below is a recommendation only (no code was changed in this round of research). File names follow Fuobe's existing conventions.

**0. Shared data (S).** Add a generator `scripts/gen-studio-presets.py` that reads `parity-image-studios.json` and writes `src/lib/catalog/{studio}-presets.generated.ts`: Soul v1/v2 presets (id, name, category list, description, preview), the 50 palettes (name, slug, 12 colours, background), Fashion Factory templates and Photodump packs. Use it as the **fallback** in `parityPresets()` when there is no studio key, and give the style picker category tabs (All · New · TikTok Core · Instagram Aesthetics · Camera Presets · Beauty · Mood · Surreal · Graphic Art for Soul; All · Mood · Styles · Camera for Soul 2.0). The ids are the studio's real `style_id`s, so the same list drives the cloud call and the open-engine prompt template (the description).

**1. Layers studio `/layers` (L–XL, highest value).**
* Data: `layer_projects` (id, source asset, name, created) + `layer_versions` (doc JSON). Doc = `{width, height, nodes: [{id, name, layerIndex, geometry {x, y, width, height, rotation}, assetId, maskAssetId?, hidden}]}`; the composite and every layer stay ordinary assets in the library.
* New operation `layer-decompose` with routes: Replicate `bytedance/seedream-5-pro` (`layer_decomposition: true`, `size`, optional `prompt`), fal `fal-ai/qwen-image-layered` (`num_layers`), and a new ComfyUI workflow `qwen-image-layered` exported from the official template `image_qwen_image_layered` (+ `qwen-image-layered-control` for prompt-guided splits) through `scripts/comfy` and validated like the other 73. Seedream returns each layer with its stacking order, bounding box, name and description (Replicate schema); Qwen-Image-Layered returns full-canvas RGBA layers, so compute each bbox from alpha in the browser. Nested "Separate layer" = run the same op on one layer.
* UI (shadcn): `ResizablePanelGroup` with a left tool rail (`ScrollArea` + buttons; a chosen tool replaces the rail with its form and a back arrow), a centre canvas (HTML canvas with selection handles for move / resize / rotate), and a right Layers panel (sortable list with dnd-kit, eye `Toggle`, `DropdownMenu` row actions: Rename, Duplicate, Download, Delete, Add mask, Separate layer, Generate layer). Top bar: name, history `Sheet`, compare (the existing `compare-slider`), Download `DropdownMenu` (Cropped layers .zip / Positioned Layers .zip / Image .png, built client-side with JSZip and canvas using the exact naming in §1.8), Copy JSON.
* Tools, first pass: Layer Decomposition (Resolution `ToggleGroup` 1K/1.5K/2K, Mode Standard/Fast, `Slider` 3–16 default 8, live cost), Remove background (existing BiRefNet routes), Edit text (OCR → numbered editable rows highlighted on the canvas → edit model with "Preserve the original design and change only the requested text."), Generate layer (existing edit models on the cropped layer, pasted back), Regional edit (rectangle → edit → Original/New layers → merge), Expand & Crop (existing outpaint). Upscale, Relight, Angles, Color grade and Enhancer reuse the existing apps with the layer as input.
* Entry points: "Open in Layers" on viewer/library tiles and `/layers?asset=<id>`; later Marketing/Ads posters open here.

**2. Soul HEX color signatures (S–M).** A `palettes` table (name, 1–12 colours, optional background, source images, built-in flag) seeded with the 50 palettes. Panel as a shadcn `Popover` (desktop) / `Drawer` (mobile) with the exact states in §5: cards with colour strip, Upload & Create (≤20 images, k-means extraction in a Web Worker, no model), manual editor with `react-colorful` (MIT) picker + hex input + EyeDropper + "Use as background", Random palettes (4 rows, 2–12 colours shown as 6), Save. Apply to any image model by appending `Color palette: #… #… (background #…)` to the prompt, plus an optional "lock colours" post step using the existing `palette-transfer-image` graph (open) or Match Colors app (cloud); pass `slug` as `color_palette` on Cinema Studio 4.0. Replace the 16 prompt-only "Color Grade" entries' guesses with real palettes where names match.

**3. Moodboards (M).** A new element type `style` (5–80 images, ≥256 px, name ≤100) with the build flow in §4 (Recommended / Avoid guidance, statuses, share link later). Cloud: curated ids → Soul 2.0 `style_id`; personal → images as style references on Nano Banana Pro / Seedream 5, or fal LoRA training. Open: reuse the AI-Toolkit training path with a style preset (no face crop) to make a Z-Image Turbo LoRA, falling back to Qwen-Image-Edit-2511 multi-reference.

**4. Photodump (M).** `/photodump`: Choose a Pack → pick a character element **or** upload one selfie (Instadump mode) → aspect ratio → Generate (a job per style, run as one batch; the chained-jobs runner exists) → results grid with Download All (zip), Animate, Edit. Packs are Fuobe prompt packs named and sized like the studio's (§2.4), plus Create pack from ≤15 reference photos. Cloud: Soul 2.0 + Soul ID or Nano Banana Pro with the selfie; open: character LoRA on Z-Image Turbo or Qwen-Image-Edit-2511 with the selfie.

**5. Fashion Factory (M).** A five-step wizard (template → character → choose 1 of 4 base shots at 3:4 → upload outfit, Generate outfit, pick → photoset) with the six templates as prompt packs. Cloud: Soul 2.0 / Nano Banana Pro, then Nano Banana Pro edit (person + garment) or fal FASHN try-on, then a Nano Banana Pro batch. Open: Z-Image Turbo + character LoRA, Qwen-Image-Edit-2511 multi-image for the outfit and each shot.

**6. Character Sheet + Soul Cast (S).** Extend the AI Influencer app with the two paths in §7: From Reference (1–5 images) and Build from scratch using the Soul Cast option lists (image-card `ToggleGroup`s, Randomize, Reset) turned into a structured prompt; save the sheet as a character element.

**7. Soul Location (S, with the Cinema Studio workspace).** Location element builder: describe (≤2,500 chars) or upload → generate the empty set → "another view" with Qwen-Image-Edit-2511 + Multiple-Angles LoRA (open) / Nano Banana Pro (cloud) → save as a location element.

**Open questions for a GPU run:** Qwen-Image-Layered quality and VRAM at 1024 px with the fp8 weights (20.5 GB diffusion model + 7B text encoder); how Seedream's per-layer metadata (Replicate: "Each returned layer includes its stacking order, bounding box, name, and description") is shaped in the actual output, which Fuobe should map straight onto `layerIndex`, `geometry` and `name`; OCR quality on stylised poster text.

## Sources
- {studio-site}/_i18n/en.dd219392ea.json — full English UI catalog (36,878 strings)
- {studio-site}/_i18n/routes/index.en.json — route -> catalog index (308 routes)
- {studio-site}/_i18n/routes/en/delta.3dcce34304.json — Layers editor route catalog (/_private/layers/$projectId)
- {studio-site}/_i18n/routes/en/delta.87ff01a9a5.json — Layers projects list (/layers)
- {studio-site}/_i18n/routes/en/delta.097ba0205f.json — Image route (/ai/image): Soul, HEX, Moodboard, Photodump, Fashion Factory modals
- {studio-site}/_i18n/routes/en/delta.64b150fe20.json — Moodboard route (/moodboard)
- {studio-site}/_i18n/routes/en/delta.8593b18fb1.json — Character sheet route (/character-sheet)
- {studio-assets}/tanstack/assets/868a8dba-ERgtR3BC6GQvWcKM.js — Layer Decomposition screen (settings, states, cost table)
- {studio-assets}/tanstack/assets/868a8dba-1KQA7feBk63lHN1Y.js — Edit text tool (detect -> replace -> generate)
- {studio-assets}/tanstack/assets/868a8dba-ILbXyNfOaxQwkfc7.js — Remove background tool
- {studio-assets}/tanstack/assets/868a8dba-sqR16Ho_oz6tgoem.js — downloadLayerProjectZip (cropped/positioned zip)
- {studio-assets}/tanstack/assets/868a8dba-Oq-fTRNofPVKXPEJ.js — layer export bounds + file naming
- {studio-assets}/tanstack/assets/868a8dba-ZXR16OLz11e1PB_2.js — Layers download menu (Cropped / Positioned / PNG, Copy JSON)
- {studio-assets}/tanstack/assets/868a8dba-eLK-oT8F2VNN_bGV.js — editor tool registry (image + video tools)
- {studio-assets}/tanstack/assets/868a8dba-rEkEuZWqVaPh1lXr.js — Layers panel (layer actions)
- {studio-assets}/tanstack/assets/868a8dba-0UrhtHZxNaHqx4P6.js — per-layer generate / revisions
- {studio-assets}/tanstack/assets/868a8dba-SJty_4AtM6RZTyiT.js — Regional Editing (rectangle + merge)
- {studio-assets}/tanstack/assets/868a8dba-5dDDu8syfVfvelzc.js — Expand & Crop
- {studio-assets}/tanstack/assets/868a8dba-XW6u_AGSsuJMbXNX.js — Layers landing + projects grid
- {studio-assets}/tanstack/assets/868a8dba-RKOpfURlZ9ONJsxV.js — Soul HEX / color signature panel
- {studio-assets}/tanstack/assets/868a8dba-8ozerfD9HHP8wqg_.js — palette helpers (random palettes, validation)
- {studio-assets}/tanstack/assets/868a8dba-zr_t1hwukVT3H0Zz.js — color-presets API client
- {studio-assets}/tanstack/assets/868a8dba-LtqpfG6k0jv3xJ_C.js — Moodboard builder (MIN 5 / MAX 80)
- {studio-assets}/tanstack/assets/868a8dba-xvkSw2TO5vFeQXSp.js — Moodboard modal / sharing
- {studio-assets}/tanstack/assets/868a8dba-4h419T1mmCQ022es.js — Image page modals: Photodump v2 steps, Fashion Factory
- {studio-assets}/tanstack/assets/868a8dba-8IkO6Gt6P12Hjb4y.js — Fashion Factory flow (template -> character -> generation -> clothing -> photoset)
- {studio-assets}/tanstack/assets/868a8dba-8HyjZqw80lR39N6c.js — Fashion Factory outfit step
- {studio-assets}/tanstack/assets/868a8dba-Br8cTodmLMFsJREW.js — Fashion Factory template grid
- {studio-assets}/tanstack/assets/868a8dba-OFQUBjDTeudk4pba.js — Instadump (single-photo photodump) flow
- {studio-assets}/tanstack/assets/868a8dba-eXmPENdTeOHFROId.js — legacy Photodump Studio (Soul v1, 26 shots)
- {studio-assets}/tanstack/assets/868a8dba-cv-yEBKsDZ_tKbHw.js — Soul style picker + category tabs
- {studio-assets}/tanstack/assets/868a8dba-fOdtGn0S5DhEKNKf.js — Soul 2.0 job + credit table
- {studio-assets}/tanstack/assets/868a8dba-eyOFyQbqr0JSXe5k.js — Character Sheet ('Build Your AI Avatar')
- {studio-assets}/tanstack/assets/868a8dba-MfeEHS6ki1EhfWtd.js — Soul Cast option lists
- {studio-api}/fnf/soul/presets — Soul v1 presets (106)
- {studio-api}/fnf/soul/preset-categories — Soul v1 categories (8)
- {studio-api}/fnf/soul-v2/presets — Soul 2.0 presets / curated moodboards (33)
- {studio-api}/fnf/soul-v2/preset-categories — Soul 2.0 categories Mood / Styles / Camera
- {studio-cms}/soul-styles?lang=en&size=200 — Soul v1 presets with descriptions + publish dates
- {studio-api}/fnf/color-presets/with-presets?size=50 — 50 built-in palettes with exact hex (shared by Soul HEX and Cinema Studio 4.0)
- {studio-api}/fnf/photo-dump/packs?version=v2&size=20 — Soul 2.0 Photodump packs (9)
- {studio-api}/fnf/photo-dump/packs?size=20 — Instadump community packs (5)
- {studio-cms}/fashion-factories?lang=en&size=50 — Fashion Factory templates (6)
- {studio-site}/{studio}-layers — Layers landing ('Powered by Seedream 5.0')
- {studio-site}/soul — Soul preset pages index (100 /soul/<id> pages)
- {studio-site}/character-sheet — Build Your AI Avatar
- {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-soul-to-generate-images — Soul family, Moodboards, HEX, settings
- {studio-site}/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character — Soul ID rules (20-80 photos)
- {studio-site}/creator-hub/help-center/ai-models/how-do-i-use-soul-cinema — Soul Cinema (HEX + Soul ID, no presets)
- {studio-site}/blog/how-to-create-ai-photodump-studio-soul — Soul 2.0 Photodump (Male Archive / Cool Girl Dump, 15 photos)
- {studio-site}/blog/{studio}-Photodump-Studio-Your-Viral-Photoshoot — legacy Photodump Studio (26 shots, 25+ photos)
- {studio-site}/blog/Create-Ai-Photoshoots-With-Instadump — Instadump (one photo, 20+ presets or own references)
- {studio-site}/blog/create-custom-ai-moodboard-soul-2 — Moodboards (up to 80 refs, 20-30 recommended)
- {studio-site}/blog/hex-codes-ai-image-generation-color-control-soul — Soul HEX (up to 20 photos)
- {studio-site}/blog/ai-fashion-photo-generator — 21 curated Soul 2.0 presets, four brand anchors
- {studio-site}/blog/consistent-characters-locations — characters + locations workflow
- https://huggingface.co/Qwen/Qwen-Image-Layered — open layer decomposition model (Apache-2.0)
- https://huggingface.co/Comfy-Org/Qwen-Image-Layered_ComfyUI — ComfyUI repack (bf16 40.9 GB / fp8mixed 20.5 GB + VAE)
- https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_layered.json — official ComfyUI template
- https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_layered_control.json — prompt-guided decomposition template (DiffSynth Layered-Control)
- https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/api_bytedance_seedream_5_0_layer_separation.json — ComfyUI API node for Seedream 5.0 layer separation
- https://fal.ai/models/fal-ai/qwen-image-layered/api — fal Qwen-Image-Layered (1-10 layers, $0.05/image)
- https://replicate.com/bytedance/seedream-5-pro — Seedream 5.0 Pro layer_decomposition (up to 16 layers), already in paid-model-apis.json
