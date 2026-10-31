#!/usr/bin/env python3
"""
Generate src/lib/catalog/cloud-models.generated.ts from docs/research/paid-model-apis.json
(merged with parts 2, 3 and 4: paid-model-apis-2.json, paid-model-apis-3.json, paid-model-apis-4.json, and the
endpointRecords of research #7, new-models-7.json).

The research file holds verified fal/Replicate input schemas (field names, enums, defaults,
prices). This script turns a curated list of models (MODELS below) into ModelDef objects with
correct FieldMaps, so no field name is typed by hand.

Run:  python3 scripts/gen-cloud-models.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESEARCH = json.loads((ROOT / "docs/research/paid-model-apis.json").read_text())
EPS = {}
for e in RESEARCH["endpoints"]:
    EPS.setdefault((e["provider"], e["endpoint"]), e)
# Part 2 (multi-shot, draft, extend, reframe, audio, training) re-verified some endpoints with more key fields.
RESEARCH_2 = json.loads((ROOT / "docs/research/paid-model-apis-2.json").read_text())
for e in RESEARCH_2["endpoints"]:
    prev = EPS.get((e["provider"], e["endpoint"]))
    # Keep part 1's key fields (aspect ratio mappings etc.) and add part 2's.
    EPS[(e["provider"], e["endpoint"])] = {**e, "keyFields": {**((prev or {}).get("keyFields") or {}), **(e.get("keyFields") or {})}}
# Part 3 (layers, styles/palettes, restyle, video utilities, captions, transcription, SFX/music, 3D, try-on,
# product shots): same merge, so re-verified endpoints keep the key fields parts 1-2 recorded.
RESEARCH_3 = json.loads((ROOT / "docs/research/paid-model-apis-3.json").read_text())
for e in RESEARCH_3["endpoints"]:
    prev = EPS.get((e["provider"], e["endpoint"]))
    EPS[(e["provider"], e["endpoint"])] = {**e, "keyFields": {**((prev or {}).get("keyFields") or {}), **(e.get("keyFields") or {})}}
# Part 4 (video erase / swap, FPS / HDR / codecs, FFmpeg compose, OCR, 3D scenes, new models): same merge.
RESEARCH_4 = json.loads((ROOT / "docs/research/paid-model-apis-4.json").read_text())
for e in RESEARCH_4["endpoints"]:
    prev = EPS.get((e["provider"], e["endpoint"]))
    EPS[(e["provider"], e["endpoint"])] = {**e, "keyFields": {**((prev or {}).get("keyFields") or {}), **(e.get("keyFields") or {})}}

# Research #7 (docs/research/new-models-7.json, endpointRecords in the shape of part 4's endpoints): fal's MOSS-Image and
# its /lora twin (package N7-1). Same merge.
NEW_MODELS_7 = json.loads((ROOT / "docs/research/new-models-7.json").read_text(encoding="utf-8"))
for e in NEW_MODELS_7.get("endpointRecords") or []:
    prev = EPS.get((e["provider"], e["endpoint"]))
    EPS[(e["provider"], e["endpoint"])] = {**e, "keyFields": {**((prev or {}).get("keyFields") or {}), **(e.get("keyFields") or {})}}

# Originals (docs/research/fuobe-originals-recipes-5.json): the hosted open-weight endpoints that take LoRAs
# (hostedLoraEndpoints: the LoRA field's shape, maximum and whether it's required, plus the full inputs where
# scripts/fetch-hosted-schemas.py read them) and the plain endpoints of the same models (hostedBaseEndpoints).
ORIGINALS = json.loads((ROOT / "docs/research/fuobe-originals-recipes-5.json").read_text(encoding="utf-8"))
HOSTED_LORA = {(e["provider"], e["id"]): e for e in ORIGINALS["hostedLoraEndpoints"]}
for e in ORIGINALS["hostedLoraEndpoints"]:
    if e.get("inputs"):
        EPS[(e["provider"], e["id"])] = {"provider": e["provider"], "endpoint": e["id"], "operation": e["op"], "status": e["status"], "verified": True,
                                         "inputs": e["inputs"], "keyFields": e.get("keyFields") or {}, "output": e.get("output"), "price": e.get("price")}
for e in ORIGINALS.get("hostedBaseEndpoints") or []:
    EPS[(e["provider"], e["endpoint"])] = e
# Partner models' fal routes read for build plan O7 (scripts/fetch-hosted-schemas.py --partner): Happy Horse 1.1 had
# no fal route before.
for e in ORIGINALS.get("partnerEndpoints") or []:
    EPS[(e["provider"], e["endpoint"])] = e

IMG_AR = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "5:4", "4:5"]
IMAGE_SIZE_MAP = {
    "1:1": "square_hd", "4:3": "landscape_4_3", "3:4": "portrait_4_3", "16:9": "landscape_16_9",
    "9:16": "portrait_16_9", "3:2": "landscape_4_3", "2:3": "portrait_4_3", "21:9": "landscape_16_9",
    "5:4": "landscape_4_3", "4:5": "portrait_4_3",
}
RATIO = re.compile(r"^\d+(\.\d+)?:\d+(\.\d+)?$")
# Duration picks for APIs that take any whole number of seconds in a range.
NICE_DURATIONS = [3, 4, 5, 6, 8, 10, 12, 15, 20, 30]

# ---------------------------------------------------------------------------
# Curated catalog. routes: list of (op, endpoint) or (op, endpoint, provider).
# "+flf2v" on an i2v endpoint that accepts an end frame adds a start/end-frame route.

M = []


def model(id, name, vendor, family, kind, tagline, routes, badges=None, pricing=None, defaults=None, options=None, fixed=None, hidden=False,
          sliders=None, controls=None, api_defaults=None, formats=None, ranged_durations=False, fit_values=False, fps_targets=None, upscale_tiers=None,
          frame_step=None, original=False, sizes=None, keep_shape=False, licence=None, frame_fps=None, frame_multiple=None,
          exact_size=False):
    """sliders / controls: [(field, label)] read from each route's research inputs (dotted = nested field; a slider's
    third item is its step, when the generic one is too coarse):
    numeric fields with minimum/maximum become sliders, enums become composer controls; both travel as params.extra.
    fixed: fields always sent. api_defaults: fields sent unless the request sets them (FieldMap.defaults).
    formats: {canonical VideoFormat: the API's value} for its output-format field (params.format), checked against the enum.
    ranged_durations: a duration that takes any whole second in a range gets the usual picks inside it.
    fit_values: the model offers the union of its routes' aspect ratios and resolutions, so each route lists the
    ones it takes (EnumField.accepts) and gets the closest of them (Grok Imagine's text and reference routes).
    controls entries may carry a third item: labels for values that read badly ({0: "Precise", 1: "Creative"}).
    fps_targets: frame rates offered for the API's target_fps (params.targetFps; ModelOptions.fpsTargets).
    upscale_tiers: resolutions offered to an upscaler that takes a factor ("Original", "1080p", "4K"): FieldMap.upscaleFactor
    turns the tier into target ÷ the clip's shorter edge, within the factor field's limits.
    frame_step: video models whose length is a frame count (Wan 2.2: 4n+1, LTX: 8n+1): FieldMap.numFrames.step.
    frame_fps: the frame rate a frame-count route renders at when its schema has no frame-rate field (InfiniteTalk: 25).
    frame_multiple: a frame count that must be a multiple of n (Wan 2.2 S2V: 4n): FieldMap.numFrames.multiple.
    original: a Fuobe Original's cloud half (written to ORIGINAL_CLOUD; models.ts joins it to the ComfyUI routes).
    sizes: {tier: {aspect: [w, h]}}: exact sizes per resolution tier (Fuobe Soul's table): FieldMap.size.table, sent
    as width / height fields or as one {width, height} object field (fal's image_size); the tiers become the resolutions.
    keep_shape: an edit model that also offers "auto" (keep image 1's shape and size): a route whose size field may be
    left out for that (fal's nullable image_size) lists the shapes it takes (EnumField.accepts), so "auto" is left out
    and the API follows the input image; a route whose own default matches the input (Replicate's match_input_image)
    leaves it out the same way.
    licence: the open weights' licence (ModelLicence) when no hosted LoRA endpoint the model runs on records it.
    exact_size: the API takes its size as one {width, height} object and rounds it itself ("rounded to multiples of 16
    between 512 and 2048 pixels": fal's MOSS-Image): FieldMap.size from the aspect ratio with the grid and limits the field's
    description states, so a layout drawn on that canvas is the picture the API makes.
    A route's options dict may also set max_images (FieldMap.maxImages), note, loraEndpoint (the same model with LoRAs:
    FieldMap.loras comes from its research record) and pin (a Replicate model run by version: the research's version)."""
    M.append(dict(id=id, name=name, vendor=vendor, family=family, kind=kind, tagline=tagline, routes=routes,
                  badges=badges or [], pricing=pricing, defaults=defaults or {}, options=options or {}, fixed=fixed or {}, hidden=hidden,
                  sliders=sliders or [], controls=controls or [], api_defaults=api_defaults or {}, formats=formats or {},
                  ranged_durations=ranged_durations, fit_values=fit_values, fps_targets=fps_targets or [], upscale_tiers=upscale_tiers or [],
                  frame_step=frame_step, original=original, sizes=sizes, keep_shape=keep_shape, licence=licence, frame_fps=frame_fps,
                  frame_multiple=frame_multiple, exact_size=exact_size))


# ----- Image
model("nano-banana-pro", "Nano Banana Pro", "Google", "gemini-image", "image",
      "Gemini 3 Pro Image — best text rendering, reasoning and multi-reference edits up to 4K",
      [("t2i", "fal-ai/nano-banana-pro"), ("edit", "fal-ai/nano-banana-pro/edit"),
       ("t2i", "google/nano-banana-pro", "replicate"), ("edit", "google/nano-banana-pro", "replicate")],
      badges=["top", "4k"], pricing=("image", 0.15, "4K is 2x"), defaults={"aspectRatio": "1:1", "resolution": "1K"})
model("nano-banana-2", "Nano Banana 2", "Google", "gemini-image", "image",
      "Newest Gemini image model — sharper detail, 0.5K–4K, up to 14 references",
      [("t2i", "fal-ai/nano-banana-2"), ("edit", "fal-ai/nano-banana-2/edit")],
      badges=["new", "4k"], pricing=("image", 0.08, "2K 1.5x, 4K 2x, 0.5K 0.75x", {"byResolution": {"0.5K": 0.06, "1K": 0.08, "2K": 0.12, "4K": 0.16}}),
      defaults={"aspectRatio": "1:1", "resolution": "1K"})
model("nano-banana-2-1", "Nano Banana 2.1", "Google", "gemini-image", "image",
      "Gemini 2.1 image with thinking — strongest instruction following",
      [("t2i", "google/nano-banana-2.1"), ("edit", "google/nano-banana-2.1/edit")],
      badges=["new"], pricing=("image", 0.1, "token-based, approx."), defaults={"aspectRatio": "1:1", "resolution": "1K"})
model("nano-banana", "Nano Banana", "Google", "gemini-image", "image",
      "Gemini 2.5 Flash Image — fast, cheap, great at consistent edits",
      [("t2i", "fal-ai/nano-banana"), ("edit", "fal-ai/nano-banana/edit"),
       ("t2i", "google/nano-banana", "replicate"), ("edit", "google/nano-banana", "replicate")],
      badges=["fast"], pricing=("image", 0.039), defaults={"aspectRatio": "1:1"})
model("seedream-5-pro", "Seedream 5.0 Pro", "ByteDance", "seedream", "image",
      "ByteDance's flagship — photoreal 4K with multi-image editing",
      [("t2i", "bytedance/seedream/v5/pro/text-to-image"), ("edit", "bytedance/seedream/v5/pro/edit")],
      badges=["new", "4k"], defaults={"aspectRatio": "3:4"})
model("seedream-5-lite", "Seedream 5.0 Lite", "ByteDance", "seedream", "image",
      "Fast, affordable Seedream 5",
      [("t2i", "bytedance/seedream/v5/lite/text-to-image"), ("edit", "bytedance/seedream/v5/lite/edit")],
      badges=["fast"], defaults={"aspectRatio": "3:4"})
model("seedream-5-flash", "Seedream 5.0 Flash", "ByteDance", "seedream", "image",
      "The fastest, cheapest Seedream 5 — quick edits in bulk",
      [("t2i", "bytedance/seedream/v5/flash/text-to-image"), ("edit", "bytedance/seedream/v5/flash/edit")],
      badges=["fast"], defaults={"aspectRatio": "3:4"})
model("seedream-4-5", "Seedream 4.5", "ByteDance", "seedream", "image",
      "Photoreal 4K generation and multi-image editing",
      [("t2i", "fal-ai/bytedance/seedream/v4.5/text-to-image"), ("edit", "fal-ai/bytedance/seedream/v4.5/edit")],
      pricing=("image", 0.04), defaults={"aspectRatio": "3:4"})
model("gpt-image-2-5", "GPT Image 2.5 Flare", "OpenAI", "gpt-image", "image",
      "OpenAI's latest — precise layouts, text and instruction edits",
      [("t2i", "openai/gpt-image-2.5/flare/text-to-image"), ("edit", "openai/gpt-image-2.5/flare/edit")],
      badges=["new"], defaults={"aspectRatio": "1:1"})
model("gpt-image-2-5-sunburst", "GPT Image 2.5 Sunburst", "OpenAI", "gpt-image", "image",
      "Warmer, more stylized GPT Image 2.5 variant",
      [("t2i", "openai/gpt-image-2.5/sunburst/text-to-image"), ("edit", "openai/gpt-image-2.5/sunburst/edit")],
      defaults={"aspectRatio": "1:1"})
model("gpt-image-2", "GPT Image 2", "OpenAI", "gpt-image", "image",
      "Reliable prompt following, text and graphic design",
      [("t2i", "openai/gpt-image-2"), ("edit", "openai/gpt-image-2/edit")], defaults={"aspectRatio": "1:1"})
model("gpt-image-1-5", "GPT Image 1.5", "OpenAI", "gpt-image", "image",
      "Strong prompt following, text and layout",
      [("t2i", "fal-ai/gpt-image-1.5"), ("edit", "fal-ai/gpt-image-1.5/edit")],
      pricing=("image", 0.13, "high quality"), fixed={"quality": "high"}, defaults={"aspectRatio": "1:1"})
# FLUX.3, Ideogram 4.5 and Bria FIBO 2 read a Fuobe layout in their own form (src/lib/layout-prompt.ts; research #7 §4.3).
model("flux-3", "FLUX.3", "Black Forest Labs", "flux", "image",
      "BFL's newest image model with unified generation and editing",
      [("t2i", "blackforestlabs/flux-3/text-to-image"), ("edit", "blackforestlabs/flux-3/edit-image")],
      badges=["new"], defaults={"aspectRatio": "1:1"}, options={"layout": "flux3"})
model("flux-2-pro", "FLUX.2 [pro]", "Black Forest Labs", "flux", "image",
      "Production-grade photorealism with multi-reference editing",
      [("t2i", "fal-ai/flux-2-pro"), ("edit", "fal-ai/flux-2-pro/edit")],
      pricing=("megapixel", 0.03), defaults={"aspectRatio": "1:1"})
model("flux-kontext-max", "FLUX.1 Kontext [max]", "Black Forest Labs", "flux", "image",
      "Precise local edits that keep everything else intact",
      [("t2i", "fal-ai/flux-pro/kontext/max/text-to-image"), ("edit", "fal-ai/flux-pro/kontext/max")],
      pricing=("image", 0.08), defaults={"aspectRatio": "1:1"})
model("ideogram-4-5", "Ideogram 4.5", "Ideogram", "ideogram", "image",
      "Best-in-class typography, posters and graphic design",
      [("t2i", "ideogram/v4.5"), ("edit", "ideogram/v4.5/edit")], defaults={"aspectRatio": "1:1"}, options={"layout": "ideogram"})
model("flux-fill-pro", "FLUX.1 Fill [pro]", "Black Forest Labs", "flux", "image", "Precise inpainting and object replacement with a mask",
      [("inpaint", "fal-ai/flux-pro/v1/fill")], pricing=("megapixel", 0.05), hidden=False)
model("z-image-inpaint", "Z-Image Turbo Inpaint (hosted)", "Alibaba Tongyi", "z-image", "image", "Cheapest, fastest masked inpainting",
      [("inpaint", "fal-ai/z-image/turbo/inpaint")], badges=["fast"], pricing=("megapixel", 0.01))
model("recraft-4-1", "Recraft V4.1", "Recraft", "recraft", "image",
      "Brand-ready illustration, icons and design assets in your colour palette",
      [("t2i", "fal-ai/recraft/v4.1/text-to-image")], defaults={"aspectRatio": "1:1"})
model("qwen-image-3", "Qwen Image 3", "Alibaba Qwen", "qwen-image", "image",
      "Hosted Qwen with superb bilingual text rendering",
      [("t2i", "alibaba/qwen-image-3/text-to-image"), ("edit", "alibaba/qwen-image-3/edit")], defaults={"aspectRatio": "1:1"})
# MOSS-Image (research #7 §4.7): OpenMOSS's Apache-2.0 model hosted on fal, $0.05 per megapixel; a run with LoRAs goes to
# its /lora twin (up to 3, unpublished price). The size goes as image_size {width, height} on fal's 16-pixel grid within
# 512-2048, so a layout is compiled for the picture fal makes; prompt expansion is off for a layout. PNG, so the words stay sharp.
MOSS_FAL = next(e for e in NEW_MODELS_7["endpointRecords"] if e["endpoint"] == "fal-ai/moss-image")
model("moss-image", "MOSS-Image", "OpenMOSS", "moss", "image",
      "Clean Chinese and English text, and it follows layout boxes",
      [("t2i", "fal-ai/moss-image", "fal", {"loraEndpoint": "fal-ai/moss-image/lora"})],
      badges=["new"], defaults={"aspectRatio": "1:1"}, fixed={"output_format": "png"}, exact_size=True, options={"layout": "moss"},
      sliders=[("num_inference_steps", "Steps"), ("guidance_scale", "Guidance", 0.5)],
      licence={"licence": re.match(r"[\w.-]+", MOSS_FAL["license"]).group(0), "commercial": True,
               "note": f"{MOSS_FAL['license']}. fal's safety checker returns a black image when it flags an output",
               "checked": MOSS_FAL["fetched"]})
model("wan-2-7-image", "Wan 2.7 Image", "Alibaba Wan", "wan", "image",
      "Wan's image model — cinematic stills that animate well",
      [("t2i", "fal-ai/wan/v2.7/pro/text-to-image"), ("edit", "fal-ai/wan/v2.7/pro/edit")], defaults={"aspectRatio": "16:9"})
model("z-image-turbo-cloud", "Z-Image Turbo (hosted)", "Alibaba Tongyi", "z-image", "image",
      "Sub-second photoreal images",
      [("t2i", "fal-ai/z-image/turbo", "fal", {"loraEndpoint": "fal-ai/z-image/turbo/lora"}),
       # Replicate's LoRA build of the same weights (lora_weights[] + lora_scales[]); one image per run.
       ("t2i", "prunaai/z-image-turbo-lora", "replicate", {"pin": True})], badges=["fast"], defaults={"aspectRatio": "1:1"})
# Originals (O1): open-weight models hosted on fal / Replicate that take LoRA URLs (docs/research/fuobe-originals-recipes-5.md §3).
# Apache-2.0 weights, so the same recipe runs on the user's GPU; a run with LoRAs switches to the /lora endpoint.
model("qwen-image-2512-cloud", "Qwen-Image 2512 (hosted)", "Alibaba Qwen", "qwen-image", "image",
      "Open-weights Qwen-Image: clean lettering and long prompts",
      [("t2i", "fal-ai/qwen-image-2512", "fal", {"loraEndpoint": "fal-ai/qwen-image-2512/lora"})],
      pricing=("megapixel", 0.02, "rounded up to whole megapixels"), defaults={"aspectRatio": "1:1"})
model("qwen-image-edit-2511-cloud", "Qwen-Image-Edit 2511 (hosted)", "Alibaba Qwen", "qwen-image", "image",
      "Open-weights instruction edits with several references",
      [("edit", "fal-ai/qwen-image-edit-2511", "fal", {"loraEndpoint": "fal-ai/qwen-image-edit-2511/lora"}),
       ("edit", "qwen/qwen-image-edit-2511", "replicate", {"keys": {"images": "image"}, "drop": ["image"]})], defaults={"aspectRatio": "1:1"},
      # Replicate's aspect_ratio has no 21:9, 3:2, 2:3, 5:4 or 4:5: each route lists what it takes (fit_values).
      # "auto" keeps image 1's shape and size (the AI Influencer's sheet stays 16:9): fal's image_size and Replicate's
      # aspect_ratio (match_input_image by default) are left out.
      fit_values=True, keep_shape=True)
# Qwen-Image-Edit 2509 with its LoRAs (O4): Fuobe DoP's relight effects relight the start frame with the 2509 Relight
# LoRA before the clip is made. A helper step, not a picker model.
model("qwen-image-edit-2509-cloud", "Qwen-Image-Edit 2509 (hosted)", "Alibaba Qwen", "qwen-image", "image",
      "Open-weights Qwen-Image-Edit 2509 with its LoRAs (relight, next scene, angles)",
      [("edit", "fal-ai/qwen-image-edit-plus-lora", "fal")], hidden=True)
model("flux-2-klein-4b-cloud", "FLUX.2 [klein] 4B (hosted)", "Black Forest Labs", "flux", "image",
      "The Apache-2.0 FLUX.2: cheapest drafts and edits",
      [("t2i", "fal-ai/flux-2/klein/4b", "fal", {"loraEndpoint": "fal-ai/flux-2/klein/4b/lora"}),
       ("edit", "fal-ai/flux-2/klein/4b/edit", "fal", {"loraEndpoint": "fal-ai/flux-2/klein/4b/edit/lora"})],
      badges=["fast"], defaults={"aspectRatio": "1:1"})
model("wan-2-2-a14b-image-cloud", "Wan 2.2 A14B Image (hosted)", "Alibaba Wan", "wan", "image",
      "Open-weights Wan 2.2 stills that take Wan LoRAs",
      [("t2i", "fal-ai/wan/v2.2-a14b/text-to-image/lora", "fal")], defaults={"aspectRatio": "16:9"})
# Soul ID on every base fal trains (O3, o/soul-id): a character or style LoRA trained on FLUX.1 [dev], FLUX.2 [dev],
# Krea 2 or FLUX.2 [klein] 9B runs on these. The weights' licences are information shown with the model, never a gate
# (the owner's decision of 2026-10-27): FLUX [dev] and klein 9B weights are non-commercial (fal clears its own hosted
# outputs), Krea 2 has revenue tiers. The admin turns models on or off in Settings.
model("flux-1-dev-lora-cloud", "FLUX.1 [dev] with LoRAs (hosted)", "Black Forest Labs", "flux", "image",
      "FLUX.1 [dev] with your trained characters and styles · non-commercial weights, fal clears its outputs",
      [("t2i", "fal-ai/flux-lora", "fal")], defaults={"aspectRatio": "3:4"})
model("flux-1-krea-lora-cloud", "FLUX.1 Krea [dev] with LoRAs (hosted)", "Black Forest Labs × Krea", "flux", "image",
      "Natural photoreal FLUX.1 Krea with FLUX.1 LoRAs · non-commercial weights, fal clears its outputs",
      [("t2i", "fal-ai/flux-krea-lora", "fal")], defaults={"aspectRatio": "3:4"})
model("flux-2-dev-lora-cloud", "FLUX.2 [dev] with LoRAs (hosted)", "Black Forest Labs", "flux", "image",
      "FLUX.2 [dev] with your trained characters and styles · non-commercial weights, fal clears its outputs",
      [("t2i", "fal-ai/flux-2/lora", "fal")], defaults={"aspectRatio": "3:4"})
model("flux-2-klein-9b-lora-cloud", "FLUX.2 [klein] 9B with LoRAs (hosted)", "Black Forest Labs", "flux", "image",
      "The 9B FLUX.2 [klein] with your LoRAs · non-commercial weights, fal clears its outputs",
      [("t2i", "fal-ai/flux-2/klein/9b/lora", "fal")], badges=["fast"], defaults={"aspectRatio": "3:4"})
model("krea-2-turbo-lora-cloud", "Krea 2 Turbo with LoRAs (hosted)", "Krea", "krea", "image",
      "Krea 2's aesthetic with your trained characters and styles · Krea 2 Community licence (revenue tiers)",
      [("t2i", "fal-ai/krea-2/turbo/lora", "fal")], badges=["fast"], defaults={"aspectRatio": "3:4"})
# ----- Originals (O2): Fuobe Soul's cloud halves on hosted open weights (docs/research/fuobe-originals-recipes-5.md §4).
# models.ts joins each to its ComfyUI routes as one model that runs on both engines (ModelDef.engines). Sizes are
# Soul's table per tier (soul.settings.comfyui.sizes); steps, prompt expansion and format follow the recipe (§4.3).
SOUL_TIERS = {"720p": "720p tier", "1080p": "1080p tier"}
SOUL_SIZES = {tier: {a: [int(x) for x in wh.split("x")] for a, wh in next(v for k, v in ORIGINALS["soul"]["settings"]["comfyui"]["sizes"].items() if k.startswith(prefix)).items()}
              for tier, prefix in SOUL_TIERS.items()}
SOUL_FAL = {"num_inference_steps": ORIGINALS["soul"]["settings"]["fal"]["num_inference_steps"],
            "enable_prompt_expansion": ORIGINALS["soul"]["settings"]["fal"]["enable_prompt_expansion"],
            "output_format": ORIGINALS["soul"]["settings"]["fal"]["output_format"]}
# Replicate's Z-Image LoRA build: the same 8 steps, a PNG (its default is jpg); guidance stays at its Turbo default 0.
SOUL_REPLICATE = {"num_inference_steps": SOUL_FAL["num_inference_steps"], "output_format": "png"}
model("fuobe-soul", "Fuobe Soul", "Fuobe Original", "fuobe-soul", "image",
      "Soul's 139 looks on open weights: Z-Image Turbo with up to three LoRAs",
      [("t2i", "fal-ai/z-image/turbo", "fal", {"loraEndpoint": "fal-ai/z-image/turbo/lora", "fixed": SOUL_FAL}),
       ("t2i", "prunaai/z-image-turbo-lora", "replicate", {"pin": True, "fixed": SOUL_REPLICATE}),
       # Restyle a picture with the look; the result keeps the picture's shape. strength = how much changes.
       ("edit", "fal-ai/z-image/turbo/image-to-image", "fal",
        {"loraEndpoint": "fal-ai/z-image/turbo/image-to-image/lora", "keepSize": True, "fixed": {k: v for k, v in SOUL_FAL.items() if k != "num_inference_steps"}})],
      original=True, sizes=SOUL_SIZES, sliders=[("strength", "Change")], defaults={"aspectRatio": "3:4", "resolution": "720p"})
model("fuobe-soul-hd", "Fuobe Soul HD", "Fuobe Original", "fuobe-soul", "image",
      "Soul's looks on Qwen-Image 2512: clean lettering for posters and signs",
      [("t2i", "fal-ai/qwen-image-2512", "fal", {"loraEndpoint": "fal-ai/qwen-image-2512/lora", "fixed": {"output_format": "png"}})],
      original=True, sizes=SOUL_SIZES, pricing=("megapixel", 0.02, "rounded up to whole megapixels", {"roundUp": True}),
      defaults={"aspectRatio": "3:4", "resolution": "720p"})
model("fuobe-soul-cinema", "Fuobe Soul Cinema", "Fuobe Original", "fuobe-soul", "image",
      "One film look: wide cinematic stills with film grain",
      [("t2i", "fal-ai/z-image/turbo", "fal", {"loraEndpoint": "fal-ai/z-image/turbo/lora", "fixed": SOUL_FAL}),
       ("t2i", "prunaai/z-image-turbo-lora", "replicate", {"pin": True, "fixed": SOUL_REPLICATE})],
      original=True, sizes=SOUL_SIZES, defaults={"aspectRatio": "16:9", "resolution": "720p"})
# ----- Originals (O10): Marketing Studio Image and Fashion Factory's try-on on hosted open weights
# (docs/research/fuobe-originals-recipes-5.json studios[marketing]). models.ts joins each to its ComfyUI routes.
# Fuobe Marketing Image: Qwen-Image-Edit 2511 with the product (and person, setting) as references, Qwen-Image 2512
# without one; the format's template prompt is written by the Marketing plan, and the words of a headline are set
# over the picture in the browser. The price is the edit's; a picture made without a product photo costs $0.02 per MP.
model("fuobe-marketing-image", "Fuobe Marketing Image", "Fuobe Original", "fuobe-marketing", "image",
      "Product shots, ads, posters and listings from your product photo: Qwen-Image-Edit 2511 with Fuobe's templates",
      [("edit", "fal-ai/qwen-image-edit-2511", "fal", {"loraEndpoint": "fal-ai/qwen-image-edit-2511/lora"}),
       ("edit", "qwen/qwen-image-edit-2511", "replicate", {"keys": {"images": "image"}, "drop": ["image"]}),
       ("t2i", "fal-ai/qwen-image-2512", "fal", {"loraEndpoint": "fal-ai/qwen-image-2512/lora"})],
      original=True, fit_values=True, defaults={"aspectRatio": "3:4"},
      pricing=("megapixel", 0.03, "an edit; $0.02 per MP for a picture made without a product photo", {"withLoras": 0.035}))
# Fuobe Try-On: FLUX.2 [klein] 4B edit with xocialize's try-on LoRA (adapterLoras tryon-klein-4b, Apache-2.0, so fal may
# host it), the person image 1, the garment image 2, a bottom image 3. Every run carries the LoRA (ModelOptions.loras),
# so it goes to the /lora endpoint: $0.01 per MP in and out, each photo resized to about 1 MP.
model("fuobe-tryon", "Fuobe Try-On", "Fuobe Original", "fuobe-tryon", "image",
      "Dresses the person in image 1 in the garment in image 2 (a bottom in image 3): FLUX.2 [klein] 4B with a try-on LoRA",
      [("edit", "fal-ai/flux-2/klein/4b/edit", "fal", {"loraEndpoint": "fal-ai/flux-2/klein/4b/edit/lora"})],
      original=True, pricing=("image", 0.03, "about 3 MP at $0.01: the photos in (each about 1 MP) and the picture out"))
model("imagen-4", "Imagen 4", "Google", "imagen", "image", "Google's photoreal text-to-image",
      [("t2i", "google/imagen-4", "replicate")], defaults={"aspectRatio": "1:1"})

# ----- Image: palettes, styles and references (research part 3; Soul HEX, Moodboards)
model("recraft-4-1-pro", "Recraft V4.1 Pro", "Recraft", "recraft", "image",
      "Recraft's top tier — 2K design-grade images in your exact palette",
      [("t2i", "fal-ai/recraft/v4.1/pro/text-to-image")], badges=["pro"], defaults={"aspectRatio": "1:1"})
# The style comes from 1-10 reference images (or a saved style_id): with neither the call fails, so these run as
# edits only. A text-to-image route can come back once something in Fuobe saves style ids (a moodboard element).
model("recraft-4-style", "Recraft V4 Styles", "Recraft", "recraft", "image",
      "A new picture in the style of 1–10 reference images",
      [("edit", "recraft/v4/style/text-to-image")],
      pricing=("image", 0.035, "+$0.005 when a new style is made from references"), defaults={"aspectRatio": "1:1"},
      controls=[("style_match", "Style match")])
model("recraft-4-style-pro", "Recraft V4 Styles Pro", "Recraft", "recraft", "image",
      "Recraft styles from your references, at Pro quality",
      [("edit", "recraft/v4/style/pro/text-to-image")],
      badges=["pro"], pricing=("image", 0.1, "+$0.005 when a new style is made from references"), defaults={"aspectRatio": "1:1"},
      controls=[("style_match", "Style match")])
# A moodboard's saved Recraft style (meta.styleId from a Recraft V4 Styles run) on its own: style_id, no references.
# Hidden: only the Image studio's Moodboard chip routes here, and it always sends the style id.
model("recraft-4-style-saved", "Recraft V4 Styles · saved style", "Recraft", "recraft", "image",
      "A new picture in a style saved from your moodboard",
      [("t2i", "recraft/v4/style/text-to-image", "fal", {"drop": ["images", "styleImages"]})],
      pricing=("image", 0.035), defaults={"aspectRatio": "1:1"}, controls=[("style_match", "Style match")], hidden=True)
model("ideogram-3", "Ideogram 3.0", "Ideogram", "ideogram", "image",
      "Posters and type in your exact brand colours, with 60+ style presets and style references",
      [("t2i", "fal-ai/ideogram/v3"),
       # Remix and edit take image_urls as style references: the picture being edited is not one of them.
       ("edit", "fal-ai/ideogram/v3/remix", "fal", {"drop": ["images", "styleImages"]}),
       ("inpaint", "fal-ai/ideogram/v3/edit", "fal", {"drop": ["images"]})],
      pricing=("image", 0.06, "Balanced; Turbo $0.03, Quality $0.09"), defaults={"aspectRatio": "1:1"},
      sliders=[("strength", "Remix strength")], controls=[("rendering_speed", "Speed"), ("style", "Style"), ("style_preset", "Preset")])
model("krea-2-style", "Krea 2 Style Reference", "Krea", "krea", "image",
      "Match the look of 1–3 reference images in a new picture, zero-shot",
      [("edit", "fal-ai/krea-2/turbo/style")], badges=["new", "fast"], defaults={"aspectRatio": "1:1"},
      sliders=[("style_scale", "Style strength")])
model("flux-redux-ultra", "FLUX1.1 [pro] Ultra Redux", "Black Forest Labs", "flux", "image",
      "Variations and remixes of an image, steered by a prompt, up to 4MP",
      [("edit", "fal-ai/flux-pro/v1.1-ultra/redux")], defaults={"aspectRatio": "1:1"},
      sliders=[("image_prompt_strength", "Reference strength")])
model("flux-redux-pro", "FLUX1.1 [pro] Redux", "Black Forest Labs", "flux", "image",
      "Image-prompted FLUX: keeps the reference's look while you change the scene",
      [("edit", "fal-ai/flux-pro/v1.1/redux")], defaults={"aspectRatio": "1:1"})

# ----- Image: characters, angles, try-on and product shots (research part 3)
model("instant-character", "Instant Character", "Tencent Hunyuan", "instant-character", "image",
      "One photo of a character, any new scene — no training",
      [("edit", "fal-ai/instant-character")], defaults={"aspectRatio": "1:1"}, sliders=[("scale", "Character strength")])
model("qwen-multiple-angles", "Qwen Multiple Angles", "Alibaba Qwen", "qwen-image", "image",
      "See the same shot from another angle: rotate, tilt and zoom the camera",
      [("edit", "fal-ai/qwen-image-edit-2511-multiple-angles")], badges=["new"],
      sliders=[("horizontal_angle", "Rotate (°)"), ("vertical_angle", "Tilt (°)"), ("zoom", "Zoom")])
model("fashn-tryon", "FASHN Try-On 1.6", "FASHN", "fashn", "image",
      "Put a garment on a person: model photo first, then the garment",
      [("edit", "fal-ai/fashn/tryon/v1.6")], badges=["top"],
      controls=[("category", "Garment"), ("mode", "Quality"), ("garment_photo_type", "Garment photo")])
model("google-try-on", "Google Virtual Try-On", "Google", "imagen", "image",
      "Google's try-on: a person photo and a product photo",
      [("edit", "google/virtual-try-on")], pricing=("image", 0.075))
# garment_type is required and has no API default: tops unless the Garment control says otherwise.
model("leffa-tryon", "Leffa Virtual Try-On", "Leffa", "leffa", "image",
      "Open-weights try-on for tops, bottoms and dresses",
      [("edit", "fal-ai/leffa/virtual-tryon")], api_defaults={"garment_type": "upper_body"}, controls=[("garment_type", "Garment")])
model("bria-product-shot", "Bria Product Shot", "Bria", "bria", "image",
      "Your product photo in a new scene — describe it or add a reference scene",
      [("edit", "fal-ai/bria/product-shot")], controls=[("placement_type", "Placement")])
model("product-photography", "Product Photography", "fal", "image-apps", "image",
      "One tap: a clean studio shot of your product",
      [("edit", "fal-ai/image-apps-v2/product-photography", "fal", {"drop": ["aspectRatio"]})])
model("bria-background-replace", "Bria Background Replace", "Bria", "bria", "image",
      "Keep the subject, swap the background for a prompt or a reference image",
      [("edit", "fal-ai/bria/background/replace")])
model("bria-extract-object", "Bria Extract Object", "Bria", "bria", "image",
      "Cut out one thing by name, e.g. “the red mug”",
      [("edit", "bria/extract-object")])

# ----- Video
model("seedance-2-5", "Seedance 2.5", "ByteDance", "seedance", "video",
      "ByteDance's cinema model — multi-shot with native audio, up to 30s",
      [("t2v", "bytedance/seedance-2.5/text-to-video"), ("i2v", "bytedance/seedance-2.5/image-to-video", "fal", "+flf2v"),
       ("ref2v", "bytedance/seedance-2.5/reference-to-video"),
       ("extend", "bytedance/seedance-2.5/reference-to-video", "fal", {"fixed": {"task": "extension"}, "videoArray": True}),
       ("finalize", "bytedance/seedance-2.5/draft/complete")],
      badges=["top", "audio", "new"], pricing=("second", 0.473, "720p"), defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"},
      # fal's schema gives no count for 2.5's reference clips; Replicate's 2.5 schema says up to 10 (30 s in all), as the research found.
      options={"multiShot": {"mode": "prompt", "maxShots": 6}, "maxVideos": 10, "maxAudios": 10})
model("seedance-2-0", "Seedance 2.0", "ByteDance", "seedance", "video",
      "Smooth multi-shot motion with audio",
      [("t2v", "bytedance/seedance-2.0/text-to-video"), ("i2v", "bytedance/seedance-2.0/image-to-video", "fal", "+flf2v"),
       ("ref2v", "bytedance/seedance-2.0/reference-to-video")],
      badges=["audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"}, options={"multiShot": {"mode": "prompt", "maxShots": 6}})
model("seedance-2-0-fast", "Seedance 2.0 Fast", "ByteDance", "seedance", "video",
      "Seedance 2 at draft speed",
      [("t2v", "bytedance/seedance-2.0/fast/text-to-video"), ("i2v", "bytedance/seedance-2.0/fast/image-to-video", "fal", "+flf2v"),
       ("ref2v", "bytedance/seedance-2.0/fast/reference-to-video")],
      badges=["fast", "audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"})
model("seedance-1-pro", "Seedance 1.0 Pro", "ByteDance", "seedance", "video",
      "Stable, physics-aware motion with start & end frames",
      [("t2v", "fal-ai/bytedance/seedance/v1/pro/text-to-video"), ("i2v", "fal-ai/bytedance/seedance/v1/pro/image-to-video", "fal", "+flf2v")],
      pricing=("second", 0.124, "1080p"), defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("kling-3", "Kling 3.0", "Kuaishou", "kling", "video",
      "Kling's flagship — multi-shot, native audio, up to 15s",
      [("t2v", "fal-ai/kling-video/v3/pro/text-to-video"), ("i2v", "fal-ai/kling-video/v3/pro/image-to-video", "fal", "+flf2v")],
      badges=["top", "audio", "new"], pricing=("second", 0.168, "audio on; audio-off-half"), defaults={"aspectRatio": "16:9", "duration": 5})
model("kling-3-turbo", "Kling 3.0 Turbo", "Kuaishou", "kling", "video",
      "Kling 3 quality, faster and cheaper",
      [("t2v", "fal-ai/kling-video/v3/turbo/pro/text-to-video"), ("i2v", "fal-ai/kling-video/v3/turbo/pro/image-to-video", "fal", "+flf2v")],
      badges=["fast", "audio"], defaults={"aspectRatio": "16:9", "duration": 5})
model("kling-3-4k", "Kling 3.0 4K", "Kuaishou", "kling", "video", "Native 4K Kling 3",
      [("t2v", "fal-ai/kling-video/v3/4k/text-to-video"), ("i2v", "fal-ai/kling-video/v3/4k/image-to-video", "fal", "+flf2v")],
      badges=["4k", "audio"], defaults={"aspectRatio": "16:9", "duration": 5})
model("kling-o3", "Kling O3 Omni", "Kuaishou", "kling", "video",
      "One model for text, image, reference and video edits",
      [("t2v", "fal-ai/kling-video/o3/pro/text-to-video"), ("i2v", "fal-ai/kling-video/o3/pro/image-to-video", "fal", "+flf2v"),
       ("ref2v", "fal-ai/kling-video/o3/pro/reference-to-video"), ("v2v", "fal-ai/kling-video/o3/pro/video-to-video/edit"),
       # Higgsfield's Remove Object page runs exactly this edit with a removal prompt (research part 4 §3); swaps and
       # inserts name @Image1 in the prompt. Same endpoint, so the studios can list Kling O3 under those tools.
       ("remove-object", "fal-ai/kling-video/o3/pro/video-to-video/edit"), ("video-swap", "fal-ai/kling-video/o3/pro/video-to-video/edit"),
       ("video-insert", "fal-ai/kling-video/o3/pro/video-to-video/edit")],
      badges=["new"], defaults={"aspectRatio": "16:9", "duration": 5})
model("kling-o1", "Kling O1 Omni", "Kuaishou", "kling", "video",
      "Reference-driven video and natural-language video editing",
      [("i2v", "fal-ai/kling-video/o1/image-to-video", "fal", "+flf2v"), ("ref2v", "fal-ai/kling-video/o1/reference-to-video"),
       ("v2v", "fal-ai/kling-video/o1/video-to-video/edit")], defaults={"aspectRatio": "16:9", "duration": 5})
# character_orientation is required with no default: follow the driving video (the API's advice for complex motion).
model("kling-motion-control", "Kling 3.0 Motion Control", "Kuaishou", "kling", "video",
      "Copy the motion of a reference video onto your character",
      [("motion-transfer", "fal-ai/kling-video/v3/pro/motion-control")], defaults={},
      api_defaults={"character_orientation": "video"}, controls=[("character_orientation", "Facing")])
model("kling-2-6-pro", "Kling 2.6 Pro", "Kuaishou", "kling", "video",
      "Cinematic motion with native audio and dialogue",
      [("t2v", "fal-ai/kling-video/v2.6/pro/text-to-video"), ("i2v", "fal-ai/kling-video/v2.6/pro/image-to-video", "fal", "+flf2v")],
      badges=["audio"], pricing=("second", 0.14, "audio-off-half"), defaults={"aspectRatio": "16:9", "duration": 5})
model("kling-2-5-turbo", "Kling 2.5 Turbo Pro", "Kuaishou", "kling", "video",
      "Fast, physics-aware motion and the best camera control",
      [("t2v", "fal-ai/kling-video/v2.5-turbo/pro/text-to-video"), ("i2v", "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", "fal", "+flf2v"),
       ("t2v", "kwaivgi/kling-v2.5-turbo-pro", "replicate"), ("i2v", "kwaivgi/kling-v2.5-turbo-pro", "replicate")],
      badges=["fast"], pricing=("second", 0.07), defaults={"aspectRatio": "16:9", "duration": 5})
model("veo-3-1", "Veo 3.1", "Google", "veo", "video",
      "State-of-the-art realism with synchronized sound and dialogue",
      [("t2v", "fal-ai/veo3.1"), ("i2v", "fal-ai/veo3.1/image-to-video"), ("flf2v", "fal-ai/veo3.1/first-last-frame-to-video"),
       ("ref2v", "fal-ai/veo3.1/reference-to-video"), ("t2v", "google/veo-3.1", "replicate"), ("i2v", "google/veo-3.1", "replicate"),
       ("extend", "fal-ai/veo3.1/extend-video", "fal", {"note": "fal retires Veo 3.1 extend on 2026-11-17"})],
      badges=["top", "audio", "hd"], pricing=("second", 0.4, "audio-off-half"), defaults={"aspectRatio": "16:9", "duration": 8, "resolution": "1080p"})
model("veo-3-1-fast", "Veo 3.1 Fast", "Google", "veo", "video", "Veo quality at a fraction of the cost",
      [("t2v", "fal-ai/veo3.1/fast"), ("i2v", "fal-ai/veo3.1/fast/image-to-video"), ("flf2v", "fal-ai/veo3.1/fast/first-last-frame-to-video"),
       ("extend", "fal-ai/veo3.1/fast/extend-video", "fal", {"note": "fal retires Veo 3.1 extend on 2026-11-17"})],
      badges=["fast", "audio"], pricing=("second", 0.15), defaults={"aspectRatio": "16:9", "duration": 8, "resolution": "1080p"})
model("veo-3-1-lite", "Veo 3.1 Lite", "Google", "veo", "video", "Cheapest Veo for drafts and volume",
      [("t2v", "fal-ai/veo3.1/lite"), ("i2v", "fal-ai/veo3.1/lite/image-to-video")],
      badges=["fast", "audio"], pricing=("second", 0.05), defaults={"aspectRatio": "16:9", "duration": 8, "resolution": "720p"})
model("gemini-omni-flash", "Gemini Omni Flash 1.1", "Google", "gemini-omni", "video",
      "Google's any-to-video model with reference and edit modes",
      [("t2v", "google/gemini-omni-flash/v1.1/text-to-video"), ("i2v", "google/gemini-omni-flash/v1.1/image-to-video"),
       ("ref2v", "google/gemini-omni-flash/v1.1/reference-to-video"), ("v2v", "google/gemini-omni-flash/v1.1/edit")],
      badges=["new", "audio"], defaults={"aspectRatio": "16:9", "resolution": "720p"},
      # Billed per second of output by resolution (research: $0.03 at 360p, $0.10 at 720p, $0.15 at 1080p, $0.30 at 4K).
      pricing=("second", 0.1, "720p; 360p $0.03, 1080p $0.15, 4K $0.30", {"byResolution": {"360p": 0.03, "720p": 0.1, "1080p": 0.15, "4k": 0.3}}))
model("wan-3", "Wan 3.0", "Alibaba Wan", "wan", "video", "Alibaba's newest video model with audio",
      [("t2v", "alibaba/wan-3.0/text-to-video"), ("i2v", "alibaba/wan-3.0/image-to-video", "fal", "+flf2v"), ("ref2v", "alibaba/wan-3.0/reference-to-video")],
      badges=["new", "audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("wan-3-prime", "Wan 3.0 Prime", "Alibaba Wan", "wan", "video", "Highest-fidelity Wan",
      [("t2v", "alibaba/wan-3.0-prime/text-to-video"), ("i2v", "alibaba/wan-3.0-prime/image-to-video", "fal", "+flf2v"), ("ref2v", "alibaba/wan-3.0-prime/reference-to-video")],
      badges=["pro", "audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("wan-2-7", "Wan 2.7", "Alibaba Wan", "wan", "video", "Hosted Wan with references and video edit",
      [("t2v", "fal-ai/wan/v2.7/text-to-video"), ("i2v", "fal-ai/wan/v2.7/image-to-video", "fal", "+flf2v"),
       # Its video edit's duration defaults to 0 = the input's length: never sent, so a restyle stays as long as its
       # clip (the model's 5 s default would cut it short and drift off the original sound).
       ("ref2v", "fal-ai/wan/v2.7/reference-to-video"), ("v2v", "fal-ai/wan/v2.7/edit-video", "fal", {"drop": ["duration"]}),
       # Replicate's Wan 2.7 video edit keeps the source's length and framing: its own ratio/duration enums would widen the fal routes'.
       ("v2v", "wan-video/wan-2.7-videoedit", "replicate", {"drop": ["aspectRatio", "duration"]})],
      badges=["audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("wan-2-6", "Wan 2.6", "Alibaba Wan", "wan", "video", "Multi-shot Wan with audio",
      [("t2v", "wan/v2.6/text-to-video"), ("i2v", "wan/v2.6/image-to-video"), ("ref2v", "wan/v2.6/reference-to-video")],
      badges=["audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"}, options={"multiShot": {"mode": "prompt", "maxShots": 6}})
model("wan-2-5", "Wan 2.5", "Alibaba Wan", "wan", "video", "Audio-driven video up to 1080p",
      [("t2v", "fal-ai/wan-25-preview/text-to-video"), ("i2v", "fal-ai/wan-25-preview/image-to-video")],
      badges=["audio"], pricing=("second", 0.15, "1080p"), defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
# Hosted MiniMax H3 makes its own sound. fal takes a whole number of seconds from 5 to 15 and bills each second by the
# resolution (its pricing record, docs/research/new-models-7.json): 480P $0.05, 768P $0.06, 2K $0.13, 4K $0.16. Without
# a resolution fal renders 2K, so 768P is set as the default (H3's native size, the open model's too).
model("minimax-h3", "MiniMax H3", "MiniMax", "hailuo", "video", "Expressive characters and dynamic action",
      [("t2v", "minimax/h3/text-to-video"), ("i2v", "minimax/h3/image-to-video", "fal", "+flf2v"), ("ref2v", "minimax/h3/reference-to-video")],
      badges=["top", "new", "audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "768P"}, ranged_durations=True,
      pricing=("second", 0.06, "768P; 480P $0.05, 2K $0.13, 4K $0.16", {"byResolution": {"480P": 0.05, "768P": 0.06, "2K": 0.13, "4K": 0.16}}))
model("minimax-h3-max", "MiniMax H3 Max", "MiniMax", "hailuo", "video", "Top-tier MiniMax with extend",
      [("t2v", "minimax/h3-max/text-to-video"), ("i2v", "minimax/h3-max/image-to-video", "fal", "+flf2v"), ("ref2v", "minimax/h3-max/reference-to-video"),
       ("extend", "minimax/h3-max/extend-video")],
      badges=["pro"], defaults={"aspectRatio": "16:9"},
      # Build plan N7-6 (Turnaround video): fal bills every H3 Max route per second by resolution (the records' price
      # text); the flat rate read from the image-to-video record was its 480P launch price. Reference-to-video has no
      # launch price, so the list rates are used for all of them (image and text to video cost less until 2026-10-31).
      # Four square references are included; each further one adds about $0.02 (not counted here). 2K is extend's alone
      # ($0.32/s, its record). No Pricing.promo: it would apply to every route, and reference to video has no launch price.
      pricing=("second", 0.08, "768P; 480P $0.05, 1080P $0.16, 2K $0.32 (extend) — image and text to video at the launch price $0.052 (480P $0.0325, 1080P $0.104) until 2026-10-31; reference to video: 4 square references included, about $0.02 for each one after",
               {"byResolution": {"480P": 0.05, "768P": 0.08, "1080P": 0.16, "2K": 0.32}}))
# Build plan N7-5 (Fly path in Cinema's 3D scene): H3 Max following a keyframed camera path from one still. A hidden
# helper (Cinema's "Film this path" picks it), priced per second by resolution: fal's launch rates until 2026-10-31, then
# the list rates (Pricing.promo). Prompt expansion stays off so the user's motion words reach the model as written.
model("minimax-h3-max-camera", "MiniMax H3 Max camera controls", "MiniMax", "hailuo", "video",
      "A still filmed along a camera path you keyframe: orbits, arcs, dollies and slides that follow the path exactly",
      [("camera-path", "minimax/h3-max/camera-controls")], hidden=True, ranged_durations=True,
      defaults={"duration": 5, "resolution": "768P"}, fixed={"prompt_expansion_mode": "disabled"},
      pricing=("second", 0.08, "768P; 480P $0.05, 1080P $0.16 — launch price $0.052 (480P $0.0325, 1080P $0.104) until 2026-10-31",
               {"byResolution": {"480P": 0.05, "768P": 0.08, "1080P": 0.16},
                "promo": {"until": "2026-10-31", "usd": 0.052, "byResolution": {"480P": 0.0325, "768P": 0.052, "1080P": 0.104}}}))
model("hailuo-2-3", "MiniMax Hailuo 2.3", "MiniMax", "hailuo", "video", "Expressive characters and dynamic action",
      [("t2v", "fal-ai/minimax/hailuo-2.3/pro/text-to-video"), ("i2v", "fal-ai/minimax/hailuo-2.3/pro/image-to-video")],
      pricing=("video", 0.49), defaults={"duration": 6}, fixed={"prompt_optimizer": True})
model("hailuo-02", "MiniMax Hailuo 02", "MiniMax", "hailuo", "video", "Physics-heavy shots with start & end frames",
      [("t2v", "fal-ai/minimax/hailuo-02/standard/text-to-video"), ("i2v", "fal-ai/minimax/hailuo-02/standard/image-to-video", "fal", "+flf2v")],
      pricing=("second", 0.045), defaults={"duration": 6, "resolution": "768P"}, fixed={"prompt_optimizer": True})
model("flux-3-video", "FLUX.3 Video", "Black Forest Labs", "flux", "video", "BFL's video model with keyframes and edits",
      [("t2v", "blackforestlabs/flux-3/text-to-video"), ("i2v", "blackforestlabs/flux-3/image-to-video"),
       ("flf2v", "blackforestlabs/flux-3/first-last-frame-to-video"), ("v2v", "blackforestlabs/flux-3/edit-video"),
       ("extend", "blackforestlabs/flux-3/extend-video")],
      badges=["new"], defaults={"aspectRatio": "16:9"})
# Originals (O1): Wan 2.2 A14B and LTX-2.3 22B open weights on fal / Replicate, with camera and effect LoRAs.
# fal's Wan 2.2 interpolates to 32 fps by default (doubled frames): interpolator_model none keeps 16 fps (research §3.1).
WAN22_FAL = {"interpolator_model": "none"}
WAN22_REPLICATE = {"interpolate_output": False}
model("wan-2-2-a14b-cloud", "Wan 2.2 A14B (hosted)", "Alibaba Wan", "wan", "video", "Open-weights Wan 2.2 that takes camera and effect LoRAs",
      [("t2v", "fal-ai/wan/v2.2-a14b/text-to-video", "fal", {"loraEndpoint": "fal-ai/wan/v2.2-a14b/text-to-video/lora", "defaults": WAN22_FAL}),
       ("i2v", "fal-ai/wan/v2.2-a14b/image-to-video", "fal", {"loraEndpoint": "fal-ai/wan/v2.2-a14b/image-to-video/lora", "defaults": WAN22_FAL}),
       # One LoRA per expert (lora_weights_transformer = high noise, _2 = low noise): a Mix runs on fal.
       # Replicate's t2v interpolates to 30 fps by default (interpolate_output true): off, so both stay at 16 fps.
       ("t2v", "wan-video/wan-2.2-t2v-fast", "replicate", {"defaults": WAN22_REPLICATE}),
       ("i2v", "wan-video/wan-2.2-i2v-fast", "replicate", {"defaults": WAN22_REPLICATE})],
      pricing=("second", 0.08, "720p on fal; 580p $0.06/s, 480p $0.04/s; with LoRAs $0.10/s",
               {"byResolution": {"720p": 0.08, "580p": 0.06, "480p": 0.04}, "withLoras": 0.1}),
      # Replicate takes 480p / 720p only and t2v only 16:9 / 9:16: each route lists what it takes (fit_values).
      defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"}, frame_step=4, fit_values=True)
# LTX-2.3 22B (LTX-2 Community licence: free under US$10M annual revenue). Prompt expansion is on by default and would
# rewrite a compiled Director prompt, so it is off; sound follows the audio toggle.
model("ltx-2-3-22b-cloud", "LTX-2.3 22B (hosted)", "Lightricks", "ltx", "video", "Open-weights LTX-2.3 with sound, camera and motion LoRAs",
      [("t2v", "fal-ai/ltx-2.3-22b/text-to-video", "fal", {"loraEndpoint": "fal-ai/ltx-2.3-22b/text-to-video/lora"}),
       ("i2v", "fal-ai/ltx-2.3-22b/image-to-video", "fal", {"loraEndpoint": "fal-ai/ltx-2.3-22b/image-to-video/lora"}),
       ("extend", "fal-ai/ltx-2.3-22b/extend-video", "fal", {"loraEndpoint": "fal-ai/ltx-2.3-22b/extend-video/lora"}),
       ("v2v", "fal-ai/ltx-2.3-22b/video-to-video", "fal", {"loraEndpoint": "fal-ai/ltx-2.3-22b/video-to-video/lora"})],
      badges=["audio"], api_defaults={"enable_prompt_expansion": False},
      pricing=("second", 0.036, "$0.001605 per megapixel of video: about $0.18 for 5 s at 720p ($0.20 with LoRAs)", {"withLoras": 0.04}),
      defaults={"aspectRatio": "16:9", "duration": 5}, frame_step=8)
# ----- Originals (O4): Fuobe DoP's cloud halves, camera motions and effects on hosted open weights (research §3.1, §7.5).
# DoP clips are 49 or 81 frames at 16 fps (3 or 5 s): fal's Wan 2.2 interpolates to 32 fps by default, so
# interpolator_model none, at 20 steps. Each LoRA goes to its expert (transformer high / low / both per file); a Mix
# sends both presets' LoRAs. Replicate's fast Wan takes one LoRA per expert (a Mix runs on fal) and makes 81–121 frames.
DOP_FAL = {"interpolator_model": "none", "frames_per_second": 16, "num_inference_steps": 20}
model("fuobe-dop", "Fuobe DoP", "Fuobe Original", "fuobe-dop", "video",
      "Camera motions and effects with their LoRAs on Wan 2.2: 3 or 5 s at 16 fps",
      [("i2v", "fal-ai/wan/v2.2-a14b/image-to-video", "fal", {"loraEndpoint": "fal-ai/wan/v2.2-a14b/image-to-video/lora", "fixed": DOP_FAL, "flf2v": True}),
       ("i2v", "wan-video/wan-2.2-i2v-fast", "replicate", {"fixed": WAN22_REPLICATE})],
      original=True,
      pricing=("second", 0.08, "720p on fal; 580p $0.06/s, 480p $0.04/s; with LoRAs $0.10/s",
               {"byResolution": {"720p": 0.08, "580p": 0.06, "480p": 0.04}, "withLoras": 0.1}),
      options={"durations": [3, 5]}, defaults={"aspectRatio": "auto", "duration": 5, "resolution": "720p"}, frame_step=4, fit_values=True)
# The LTX-2.3 presets (FPV Drone, Wind to Face, the transitions with an end frame) and LTX-2.3's built-in camera LoRA
# (camera_lora: dolly, jib, static) for the moves it covers. Prompt expansion off; sound off unless asked.
model("fuobe-dop-ltx", "Fuobe DoP · LTX", "Fuobe Original", "fuobe-dop", "video",
      "Camera moves, FPV and transitions on LTX-2.3 with its camera LoRAs: 3 or 5 s at 24 fps",
      [("i2v", "fal-ai/ltx-2.3-22b/image-to-video", "fal", {"loraEndpoint": "fal-ai/ltx-2.3-22b/image-to-video/lora", "flf2v": True})],
      original=True, api_defaults={"enable_prompt_expansion": False},
      pricing=("second", 0.036, "$0.001605 per megapixel of video: about $0.18 for 5 s at 720p ($0.20 with LoRAs)", {"withLoras": 0.04}),
      options={"durations": [3, 5]}, defaults={"aspectRatio": "auto", "duration": 5, "generateAudio": False}, frame_step=8)
# ----- Originals (O6): Fuobe Cinema's cloud half, Cinema Studio's Director on LTX-2.3 22B (research §8 cinema-studio →
# studios[cinema-studio].original). Prompt expansion off so the compiled Director prompt is what runs; sound follows the
# toggle; up to 481 frames at 24 fps (20 s; Cinema adds the rest with one extend); exact sizes per tier in multiples of
# 32. A camera move LTX-2.3's camera LoRA makes goes as camera_lora (params.extra, set by src/lib/catalog/cinema.ts).
# An extend or an edit keeps its source clip's size. Priced on fal's per-megapixel-of-video price (Pricing.videoMegapixel:
# the tier and shape's size × the frames, rounded up); the per-second rates are the 16:9 ones, for display.
CINEMA = next(s for s in ORIGINALS["studios"] if s["id"] == "cinema-studio")["original"]["cloud"]
CINEMA_TIERS = {"480p": "480p tier", "720p": "720p tier", "1080p": "1080p tier"}
CINEMA_SIZES = {tier: {a: [int(x) for x in wh.split("x")] for a, wh in next(v for k, v in CINEMA["sizes"].items() if k.startswith(prefix)).items()}
                for tier, prefix in CINEMA_TIERS.items()}


def per_megapixel(endpoint):
    """fal's '$x per megapixel of generated video' for an endpoint of the research (base or /lora)."""
    rec = EPS.get(("fal", endpoint)) or {}
    m = re.search(r"\$([0-9.]+) per megapixel", rec.get("price") or "")
    if not m:
        sys.exit(f"fuobe-cinema: no per-megapixel price for {endpoint} in the research")
    return float(m.group(1))


CINEMA_MP = per_megapixel("fal-ai/ltx-2.3-22b/image-to-video")
CINEMA_MP_LORA = per_megapixel("fal-ai/ltx-2.3-22b/image-to-video/lora")
# A second of 16:9 video at each tier: width × height × 24 frames, in megapixels, at fal's price.
CINEMA_PER_SECOND = {t: round(s["16:9"][0] * s["16:9"][1] * CINEMA["fps"] / 1e6 * CINEMA_MP, 4) for t, s in CINEMA_SIZES.items()}
CINEMA_PER_SECOND_LORA = {t: round(s["16:9"][0] * s["16:9"][1] * CINEMA["fps"] / 1e6 * CINEMA_MP_LORA, 4) for t, s in CINEMA_SIZES.items()}
model("fuobe-cinema", "Fuobe Cinema", "Fuobe Original", "fuobe-cinema", "video",
      "Cinema Studio's Director on LTX-2.3 with its camera LoRAs and sound: up to 20 s at 24 fps",
      [("t2v", "fal-ai/ltx-2.3-22b/text-to-video", "fal", {"loraEndpoint": "fal-ai/ltx-2.3-22b/text-to-video/lora", "fixed": CINEMA["fixed"]}),
       ("i2v", "fal-ai/ltx-2.3-22b/image-to-video", "fal", {"loraEndpoint": "fal-ai/ltx-2.3-22b/image-to-video/lora", "fixed": CINEMA["fixed"], "flf2v": True}),
       ("extend", "fal-ai/ltx-2.3-22b/extend-video", "fal", {"loraEndpoint": "fal-ai/ltx-2.3-22b/extend-video/lora", "fixed": CINEMA["fixed"], "keepSize": True}),
       ("v2v", "fal-ai/ltx-2.3-22b/video-to-video", "fal", {"loraEndpoint": "fal-ai/ltx-2.3-22b/video-to-video/lora", "fixed": CINEMA["fixed"], "keepSize": True})],
      original=True, sizes=CINEMA_SIZES, badges=["audio"],
      pricing=("second", CINEMA_PER_SECOND["720p"],
               f"${CINEMA_MP} per megapixel of video (width × height × frames): about ${round(CINEMA_PER_SECOND['720p'] * 5, 2)} for 5 s at 720p; ${CINEMA_MP_LORA} with LoRAs",
               {"byResolution": CINEMA_PER_SECOND, "withLoras": CINEMA_PER_SECOND_LORA["720p"], "withLorasByResolution": CINEMA_PER_SECOND_LORA,
                "videoMegapixel": {"usd": CINEMA_MP, "withLoras": CINEMA_MP_LORA}}),
      defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"}, frame_step=8)
# ----- Originals (O5): Fuobe Genjutsu's cloud halves on hosted open weights (research §8 genjutsu, build plan O5;
# docs/research/openjutsu-6.md §8 for the Character swap). Motion transfer on Wan 2.2 Animate (fal bills frames ÷ 16 as
# "video seconds"), Object swap on Wan 2.1 VACE 14B inpainting with SAM 3.1's mask video, Restyle on Wan 2.2 Fun VACE
# depth from a restyled first frame, Character swap on MiniMax H3 with Akatz Labs' Character Swap LoRA. Lite is the
# cheaper, faster tier of the same Original: 480p (and fal's turbo pass on Animate).
_ANIMATE_PRICE = {"byResolution": {"720p": 0.08, "580p": 0.06, "480p": 0.04}}
_FRAMES16 = "fal bills frames ÷ 16 as video seconds: a 30 fps clip costs about 1.9× its length"
model("fuobe-genjutsu-motion", "Fuobe Genjutsu · Motion", "Fuobe Original", "fuobe-genjutsu", "video",
      "Your character performs the clip's moves with its camera and framing: Wan 2.2 Animate",
      [("motion-transfer", "fal-ai/wan/v2.2-14b/animate/move")],
      original=True, fit_values=True, pricing=("second", 0.08, f"720p; 580p $0.06, 480p $0.04 · {_FRAMES16}", _ANIMATE_PRICE),
      defaults={"resolution": "720p"})
model("fuobe-genjutsu-motion-lite", "Fuobe Genjutsu Lite · Motion", "Fuobe Original", "fuobe-genjutsu", "video",
      "The quick tier: Wan 2.2 Animate at 480p with fal's turbo pass",
      [("motion-transfer", "fal-ai/wan/v2.2-14b/animate/move", "fal", {"fixed": {"use_turbo": True, "resolution": "480p"}})],
      original=True, pricing=("second", 0.04, f"480p · {_FRAMES16}"), options={"resolutions": ["480p"]}, defaults={"resolution": "480p"})
_VACE14 = "fal-ai/wan-vace-14b/inpainting"
_VACE14_PRICE = {"byResolution": {"720p": 0.08, "580p": 0.06, "480p": 0.04}}
model("fuobe-genjutsu-swap", "Fuobe Genjutsu · Swap", "Fuobe Original", "fuobe-genjutsu", "video",
      "A thing, a person or an outfit becomes your reference: SAM 3.1 follows it, Wan VACE paints it in",
      [("video-swap", _VACE14, "fal", {"keys": {"mask": "mask_video_url"}})],
      original=True, fit_values=True, pricing=("second", 0.08, f"720p; 580p $0.06, 480p $0.04 · {_FRAMES16}; SAM 3.1's mask $0.01 per 16 frames", _VACE14_PRICE),
      api_defaults={"match_input_num_frames": True, "match_input_frames_per_second": True}, defaults={"resolution": "720p"})
model("fuobe-genjutsu-swap-lite", "Fuobe Genjutsu Lite · Swap", "Fuobe Original", "fuobe-genjutsu", "video",
      "The quick tier: Wan VACE at 480p with fal's accelerated sampling",
      [("video-swap", _VACE14, "fal", {"keys": {"mask": "mask_video_url"}, "fixed": {"resolution": "480p", "acceleration": "regular"}})],
      original=True, pricing=("second", 0.04, f"480p · {_FRAMES16}"), options={"resolutions": ["480p"]},
      api_defaults={"match_input_num_frames": True, "match_input_frames_per_second": True}, defaults={"resolution": "480p"})
# fal's Wan 2.2 Fun VACE depth endpoint reads video_url as the depth control unless preprocess is on (its example input is
# a precomputed depth-map video): Fuobe sends the RGB clip, so fal derives the depth itself (research
# studios[shorts].original.cloud.fixedNote; unverified until the first live run).
SHORTS_O = next(s for s in ORIGINALS["studios"] if s["id"] == "shorts")["original"]
model("fuobe-genjutsu-restyle", "Fuobe Genjutsu · Restyle", "Fuobe Original", "fuobe-genjutsu", "video",
      "Every frame takes the look of a restyled first frame, motion kept by depth: Wan 2.2 Fun VACE",
      [("v2v", "fal-ai/wan-22-vace-fun-a14b/depth", "fal", {"fixed": SHORTS_O["cloud"]["fixed"]})],
      original=True, fit_values=True, pricing=("second", 0.1, f"720p; 580p $0.075, 480p $0.05 · {_FRAMES16}; the first frame's restyle is priced on its own",
                                               {"byResolution": {"720p": 0.1, "580p": 0.075, "480p": 0.05}}),
      api_defaults={"match_input_num_frames": True, "match_input_frames_per_second": True}, defaults={"resolution": "720p"},
      licence={**SHORTS_O["licence"], "note": "Wan 2.2 Fun VACE A14B weights are Apache-2.0 (the first frame's model has its own licence)"})
# Character swap (Openjutsu / Akatz Labs' H3 Character Swap): the part of the clip (5–15 s) is Video 1, the character
# Image 1 and the anchor first frame Image 2. Prompt expansion off so H3's reference tags reach the model as written.
model("fuobe-character-swap", "Fuobe Character swap", "Fuobe Original", "fuobe-character-swap", "video",
      "The person in your clip becomes your character, same performance, scene and sound: MiniMax H3 with Akatz Labs' swap LoRA",
      [("video-swap", "minimax/h3/reference-to-video/lora", "fal", {"videoArray": True, "fixed": {"prompt_expansion_mode": "disabled", "aspect_ratio": "adaptive"}})],
      original=True, fit_values=True, badges=["audio"],
      pricing=("second", 0.075, "768p; 480p $0.0625/s; whole seconds, 5–15 per call", {"byResolution": {"768p": 0.075, "480p": 0.0625}}),
      options={"resolutions": ["480p", "768p"]}, defaults={"resolution": "768p"})
# ----- Originals (O9): Fuobe Mixed Media and Fuobe Shorts on hosted open weights (research §8 mixed-media →
# studios[mixed-media].original, studios[shorts].original). Mixed Media's cloud half draws one frame: Z-Image Turbo
# with its Fun ControlNet on the frame's own outlines (preprocess canny) and the look's LoRAs, at the render's one
# seed; src/lib/catalog/mixed-media.ts fans it out over every frame (and frame 0 of Smooth), sending the frame's
# size (image_size {width, height}: about 1 or 4 megapixels in the clip's shape) and the look's control scale.
# Shorts' cloud half is Wan 2.2 Fun VACE by depth from a restyled first frame; its aspect ratio isn't asked of the
# model (the cut is cropped to 9:16 or 16:9 first, as for any restyle model that keeps its input's shape).
MIXED_O = next(s for s in ORIGINALS["studios"] if s["id"] == "mixed-media")["original"]["cloud"]
model("fuobe-mixed-media", "Fuobe Mixed Media", "Fuobe Original", "fuobe-mixed-media", "video",
      "Every frame drawn again in the look under its own outlines, one seed: Z-Image Turbo + ControlNet with the look's LoRA",
      [("edit", MIXED_O["frame"], "fal", {"fixed": MIXED_O["fixed"], "defaults": MIXED_O["defaults"]})],
      original=True, pricing=("megapixel", per_megapixel(MIXED_O["frame"]), MIXED_O["price"]))
# The restyled first frame goes as first_frame_url only (the recipe sends no VACE subject references: `images` is dropped),
# and fal derives the depth from the cut (preprocess, fixed).
model("fuobe-shorts", "Fuobe Shorts", "Fuobe Original", "fuobe-shorts", "video",
      "Your footage in a new look, motion kept: a restyled first frame carried through every frame by depth (Wan 2.2 Fun VACE)",
      [("v2v", SHORTS_O["cloud"]["restyle"], "fal", {"drop": ["aspectRatio", "images"], "fixed": SHORTS_O["cloud"]["fixed"]})],
      original=True, fit_values=True, pricing=("second", 0.1, f"720p; 580p $0.075, 480p $0.05 · {_FRAMES16}; the first frame's Qwen edit is priced on its own",
                                               {"byResolution": {"720p": 0.1, "580p": 0.075, "480p": 0.05}}),
      api_defaults=SHORTS_O["cloud"]["defaults"], defaults={"resolution": "720p"}, licence=SHORTS_O["licence"])
# ----- Originals (O13): Fuobe Evolution's cloud half (research §8 evolution → studios[evolution].original): Higgsfield
# Evolution's change intensity as LTX-2.3 22B video-to-video's video_strength (1 − the denoise the open graph uses; set by
# src/lib/catalog/evolution.ts through params.extra), the LLM-written direction as the prompt, prompt expansion off. Silent
# (the clip's own sound goes back on), 24 fps, at most 481 frames a call (Evolution cuts longer clips into pieces); the
# tier's size for the clip's shape from Fuobe Cinema's table. Priced per megapixel of video like Fuobe Cinema.
EVOLUTION = next(s for s in ORIGINALS["studios"] if s["id"] == "evolution")["original"]["cloud"]
EVOLUTION_MP = per_megapixel(EVOLUTION["endpoint"])
EVOLUTION_MP_LORA = per_megapixel(EVOLUTION["loraEndpoint"])
EVOLUTION_PER_SECOND = {t: round(s["16:9"][0] * s["16:9"][1] * EVOLUTION["fps"] / 1e6 * EVOLUTION_MP, 4) for t, s in CINEMA_SIZES.items()}
EVOLUTION_PER_SECOND_LORA = {t: round(s["16:9"][0] * s["16:9"][1] * EVOLUTION["fps"] / 1e6 * EVOLUTION_MP_LORA, 4) for t, s in CINEMA_SIZES.items()}
model("fuobe-evolution", "Fuobe Evolution", "Fuobe Original", "fuobe-evolution", "video",
      "Takes your clip further in a direction an LLM writes from your references: LTX-2.3 video to video at a change intensity",
      [("v2v", EVOLUTION["endpoint"], "fal", {"loraEndpoint": EVOLUTION["loraEndpoint"], "fixed": EVOLUTION["fixed"]})],
      original=True, sizes=CINEMA_SIZES,
      pricing=("second", EVOLUTION_PER_SECOND["720p"],
               f"${EVOLUTION_MP} per megapixel of video (width × height × frames): about ${round(EVOLUTION_PER_SECOND['720p'] * 5, 2)} for 5 s at 720p; ${EVOLUTION_MP_LORA} with LoRAs",
               {"byResolution": EVOLUTION_PER_SECOND, "withLoras": EVOLUTION_PER_SECOND_LORA["720p"], "withLorasByResolution": EVOLUTION_PER_SECOND_LORA,
                "videoMegapixel": {"usd": EVOLUTION_MP, "withLoras": EVOLUTION_MP_LORA}}),
      defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"}, frame_step=8)
# ----- Originals (O11): the rebranded open tools and Speak on hosted open weights (research studios[angles].original,
# studios[speak].original). Fuobe Angles is fal's LoRA-gallery route of Qwen-Image-Edit 2509 with dx8152's Multiple-angles
# LoRA: Higgsfield Angles' controls are its fields (rotate −90…90°, positive = left; vertical −1…1, −1 = bird's-eye;
# move forward 0–10; a wide-angle lens), at the LoRA scale and steps the research gives; it takes no words.
ANGLES_O = next(s for s in ORIGINALS["studios"] if s["id"] == "angles")["original"]
model("fuobe-angles", "Fuobe Angles", "Fuobe Original", "fuobe-angles", "image",
      "The same shot from another camera: rotate, tilt, move closer, go wide · Qwen-Image-Edit 2509 + Multiple-angles LoRA",
      [("edit", ANGLES_O["cloud"]["endpoint"], "fal")], original=True, api_defaults=ANGLES_O["cloud"]["defaults"],
      sliders=[("rotate_right_left", "Rotate (°, + = left)"), ("vertical_angle", "Tilt (−1 above, 1 below)"), ("move_forward", "Move forward")],
      pricing=("megapixel", 0.035, "per megapixel of the picture made (the input's size)"))
# Fuobe Speak: InfiniteTalk. fal's endpoint has none of the recipe's knobs (the FusioniX LoRA, motion frames, shift,
# guidance): the like-for-like copy runs on the GPU. num_frames (41–721) at 25 fps follows the voice.
SPEAK_O = next(s for s in ORIGINALS["studios"] if s["id"] == "speak")["original"]
model("fuobe-speak", "Fuobe Speak", "Fuobe Original", "fuobe-speak", "video",
      "A portrait speaks your voice track, lips, face and head in sync, long takes: InfiniteTalk",
      [("avatar", SPEAK_O["cloud"]["endpoint"], "fal")], original=True, frame_fps=SPEAK_O["cloud"]["fps"],
      pricing=("second", 0.2, "480p or 720p, as long as the voice"), defaults={"resolution": "480p"})
# Fuobe Speak · Motion (a Speak v1-like route): Wan 2.2 Speech-to-Video, the body and the scene move with the speech.
# fal bills frames ÷ 16 as video seconds; num_frames 40–120, a multiple of 4 (2.5–7.5 s a call).
SPEAK_M = SPEAK_O["motion"]
model("fuobe-speak-motion", "Fuobe Speak · Motion", "Fuobe Original", "fuobe-speak", "video",
      "Speech with the body and the scene moving: Wan 2.2 S2V",
      [("avatar", SPEAK_M["cloud"]["endpoint"], "fal")], original=True, fit_values=True, frame_multiple=4,
      pricing=("second", 0.1, "480p; 580p $0.15, 720p $0.20 a video second (frames ÷ 16), up to 7.5 s a call",
               {"byResolution": {"480p": 0.1, "580p": 0.15, "720p": 0.2}}),
      defaults={"resolution": "480p"})
# The face mosaic's cloud step (Fuobe Soul's PixeletedFace look): SAM 3.1 finds every face and answers with their masks;
# Fuobe pixelates under them (the server, or the browser for a picture it can't decode). A helper step, not a picker model.
model("sam-3-1-face-mask", "SAM 3.1 face mask", "Meta", "sam", "image",
      "Finds the faces (or what you name) in a picture; Fuobe pixelates them",
      [("face-mosaic", "fal-ai/sam-3-1/image")], hidden=True, pricing=("request", 0.01),
      fixed={"apply_mask": False, "return_multiple_masks": True, "max_masks": 16, "output_format": "png"}, api_defaults={"prompt": "face"})
model("ltx-2-5", "LTX 2.5 Pro", "Lightricks", "ltx", "video", "Fast 4K-capable video with audio",
      [("t2v", "lightricks/ltx-2.5/text-to-video/pro"), ("i2v", "lightricks/ltx-2.5/image-to-video/pro")],
      badges=["audio"], defaults={"aspectRatio": "16:9"})
# Fuobe DoP's Focus Change in the cloud (O4, research §7.3): LTX-2.5's own focus_shift move (camera_motion) on the fast
# endpoint, open weights hosted with no LoRAs. 720p, the start frame's shape, silent like every DoP clip. A helper
# the preset runs on, not a picker model.
model("ltx-2-5-fast", "LTX 2.5 Fast", "Lightricks", "ltx", "video", "LTX-2.5's built-in camera moves (focus shift, dolly, jib) from a start frame",
      [("i2v", "lightricks/ltx-2.5/image-to-video/fast")],
      pricing=("second", 0.09, "720p; 1080p $0.13/s, 1440p $0.19/s, 4K $0.30/s; sound included",
               {"byResolution": {"720p": 0.09, "1080p": 0.13, "1440p": 0.19, "2160p": 0.3}}),
      defaults={"aspectRatio": "auto", "duration": 6, "resolution": "720p", "generateAudio": False}, hidden=True)
model("pixverse-v6", "PixVerse V6", "PixVerse", "pixverse", "video", "Stylized social video with transitions",
      [("t2v", "fal-ai/pixverse/v6/text-to-video"), ("i2v", "fal-ai/pixverse/v6/image-to-video"), ("flf2v", "fal-ai/pixverse/v6/transition"),
       ("extend", "fal-ai/pixverse/v6/extend")],
      defaults={"aspectRatio": "16:9"})
model("vidu-q3", "Vidu Q3", "Shengshu", "vidu", "video", "Anime-friendly video with references",
      [("t2v", "fal-ai/vidu/q3/text-to-video"), ("i2v", "fal-ai/vidu/q3/image-to-video"), ("ref2v", "fal-ai/vidu/q3/reference-to-video/mix")],
      defaults={"aspectRatio": "16:9"})
model("luma-ray-3-2", "Luma Ray 3.2", "Luma", "luma", "video", "HDR, physically convincing motion",
      [("t2v", "luma/agent/ray/v3.2/text-to-video"), ("i2v", "luma/agent/ray/v3.2/image-to-video"), ("v2v", "luma/agent/ray/v3.2/video-to-video"),
       ("reframe", "luma/agent/ray/v3.2/reframe")],
      defaults={"aspectRatio": "16:9"})
model("ltx-reframe", "LTX Reframe", "Lightricks", "ltx", "video", "Change a clip's aspect ratio — fast, no prompt needed",
      [("reframe", "fal-ai/ltx-2.3/reframe")], defaults={"aspectRatio": "9:16"})
model("wan-vace-reframe", "Wan VACE Reframe (hosted)", "Alibaba Wan", "wan", "video", "Open-weights reframe: outpaints the new edges with a prompt",
      [("reframe", "fal-ai/wan-vace-14b/reframe")], defaults={"aspectRatio": "9:16"})

# ----- Video restyle / edit (research part 3; Shorts Studio, Mixed Media, Ad Multiplier)
# fal: "$0.28/second ($0.14 per input second and 0.14 per output second)" at 720p, $0.56 at 1080p: the whole price
# per second of the clip, both halves already summed (fixes-5: it was charged twice over, input seconds again on top).
# The output matches the input, capped at 15 s.
model("happy-horse-video-edit", "Happy Horse Video Edit", "Alibaba", "happy-horse", "video",
      "Restyle or swap things in 3–15 s clips, with up to 5 reference images",
      [("v2v", "alibaba/happy-horse/video-edit")], badges=["new", "audio"], defaults={"resolution": "720p"},
      pricing=("second", 0.28, "720p, input and output seconds together; 1080p $0.56", {"byResolution": {"720p": 0.28, "1080p": 0.56}}),
      controls=[("audio_setting", "Audio")])
# Happy Horse 1.1 (build plan O7): fal hosts Alibaba's three endpoints (partnerEndpoints, read
# 2026-10-27): $0.14/s at 720p, $0.18/s at 1080p; 3-15 s; up to 9 reference images.
model("happy-horse-1-1", "Happy Horse 1.1", "Alibaba", "happy-horse", "video", "Alibaba's expressive character-animation video model",
      [("t2v", "alibaba/happy-horse/v1.1/text-to-video"), ("i2v", "alibaba/happy-horse/v1.1/image-to-video"),
       ("ref2v", "alibaba/happy-horse/v1.1/reference-to-video", "fal", {"max_images": 9})],
      defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"},
      pricing=("second", 0.14, "720p; 1080p $0.18/s", {"byResolution": {"720p": 0.14, "1080p": 0.18}}), options={"maxImages": 9})
model("lucy-edit-pro", "Lucy Edit Pro", "Decart", "lucy", "video",
      "Text-guided video edits that keep motion and identity — outfits, props, styles",
      [("v2v", "decart/lucy-edit/pro")], defaults={"resolution": "720p"}, fixed={"sync_mode": False}, pricing=("second", 0.15, "720p"))
model("runway-aleph-2", "Runway Aleph 2", "Runway", "runway", "video",
      "Runway's in-context video editor: restyle, relight, add or remove anything",
      [("v2v", "runwayml/aleph-2", "replicate")], badges=["pro"])
model("kling-o3-4k-edit", "Kling O3 4K Edit", "Kuaishou", "kling", "video",
      "Kling O3 video edits rendered in native 4K, keeps the original audio",
      [("v2v", "fal-ai/kling-video/o3/4k/video-to-video/edit"),
       # "Need more detail? Run Kling 3.0 Omni Edit in 4K mode" (Higgsfield's Remove Object page).
       ("remove-object", "fal-ai/kling-video/o3/4k/video-to-video/edit"), ("video-swap", "fal-ai/kling-video/o3/4k/video-to-video/edit"),
       ("video-insert", "fal-ai/kling-video/o3/4k/video-to-video/edit")], badges=["4k"], pricing=("second", 0.42))
model("grok-imagine-video-edit", "Grok Imagine Video Edit", "xAI", "grok", "video",
      "Edit clips up to 8 s with a sentence",
      [("v2v", "xai/grok-imagine-video/edit-video")], badges=["fast"],
      pricing=("second", 0.06, "480p incl. input seconds; 720p $0.08"))
model("ltx-2-3-restyle", "LTX 2.3 Reference Restyle", "Lightricks", "ltx", "video",
      "Restyle a clip from a styled first frame, following its depth, edges or pose",
      [("v2v", "fal-ai/ltx-2.3-22b/reference-video-to-video")], badges=["audio"],
      pricing=("video", 0.18, "≈5 s at 720p; billed per megapixel of video"),
      sliders=[("video_strength", "Strength")], controls=[("preprocessor", "Follow"), ("camera_lora", "Camera")])

# ----- Avatars & lipsync
model("kling-avatar-2", "Kling Avatar 2.0", "Kuaishou", "kling", "video", "Photo + voice → expressive talking video",
      [("avatar", "fal-ai/kling-video/ai-avatar/v2/pro")], badges=["top"])
model("kling-avatar", "Kling AI Avatar", "Kuaishou", "kling", "video", "Photo + voice → talking video",
      [("avatar", "fal-ai/kling-video/v1/pro/ai-avatar")], pricing=("second", 0.115))
model("omnihuman-2", "OmniHuman 2", "ByteDance", "omnihuman", "video", "Full-body talking avatars with gestures",
      [("avatar", "bytedance/omnihuman/v2")], badges=["new"])
model("omnihuman", "OmniHuman 1.5", "ByteDance", "omnihuman", "video", "Full-body talking avatars",
      [("avatar", "fal-ai/bytedance/omnihuman/v1.5")], pricing=("second", 0.16))
# num_frames (41–721) at InfiniteTalk's 25 fps follows the voice's length (O11; it was sent the duration in seconds).
model("infinitetalk-cloud", "InfiniteTalk (hosted)", "MeiGen", "infinitetalk", "video", "Long-form talking video from one photo",
      [("avatar", "fal-ai/infinitalk")], pricing=("second", 0.2), defaults={"resolution": "480p"}, frame_fps=25)
model("sync-lipsync-3", "Sync Lipsync 3", "Sync Labs", "sync", "video", "Re-sync any video's lips to new audio",
      [("lipsync", "fal-ai/sync-lipsync/v3"), ("avatar", "fal-ai/sync-lipsync/v3/image-to-video")], badges=["new"])
model("sync-lipsync-2-pro", "Sync Lipsync 2 Pro", "Sync Labs", "sync", "video", "Studio-grade lipsync for existing footage",
      [("lipsync", "fal-ai/sync-lipsync/v2/pro")], pricing=("minute", 5))

# ----- Utilities
model("topaz-image", "Topaz Upscale", "Topaz Labs", "topaz", "image", "Up to 4x photo upscale with face recovery",
      [("upscale-image", "fal-ai/topaz/upscale/image")], pricing=("image", 0.08), fixed={"upscale_factor": 2, "face_enhancement": True})
model("seedvr-image", "SeedVR2 Upscale", "ByteDance Seed", "seedvr", "image", "One-step diffusion upscaling",
      [("upscale-image", "fal-ai/seedvr/upscale/image")])
model("recraft-crisp", "Recraft Crisp Upscale", "Recraft", "recraft", "image", "Clean, crisp upscale for design work",
      [("upscale-image", "fal-ai/recraft/upscale/crisp")])
# Higgsfield's four video upscalers (higgsfield-delta-4.md §4.3), each with the options its API takes.
# Topaz Video: the precision models (Proteus by default, Artemis / Iris for faces, Rhea for 4K+, Gaia for animation,
# Theia for fine detail), Original / 1080p / 1440p / 4K (a factor of the clip's size), frame rate Original / 24 / 30 / 60
# (the API's 16-60; Higgsfield's 120 is FPS Boost's) and the enhancement sliders. H.264 so it plays in every browser.
model("topaz-video", "Topaz Video", "Topaz Labs", "topaz", "video", "Enhance and upscale low- to medium-quality footage, up to 4K and 60 fps",
      [("upscale-video", "topaz/upscale/video/precision")], badges=["4k"],
      pricing=("second", 0.02, "1080p at 30 fps; 720p $0.01/s, above 1080p $0.06/s; 60 fps doubles", {"byResolution": {"1080p": 0.02, "1440p": 0.06, "4K": 0.06}, "factors": [{"param": "targetFps", "values": {"60": 2}}]}),
      defaults={"resolution": "1080p"}, upscale_tiers=["Original", "1080p", "1440p", "4K"], fps_targets=[24, 30, 60],
      api_defaults={"H264_output": True}, controls=[("model", "Model")],
      sliders=[("recover_detail", "Recover details"), ("noise", "Reduce noise"), ("compression", "Revert compression"), ("halo", "Reduce halo"), ("grain", "Grain")])
# Topaz Starlight Precise: the generative models (Starlight Precise 2.6 by default; HQ, Mini, Sharp, Fast 2 at half the price).
model("topaz-starlight", "Topaz Starlight", "Topaz Labs", "topaz", "video", "Recover natural detail in faces, textures and text: generative upscale to 1080p or 4K",
      [("upscale-video", "topaz/upscale/video/generative")], badges=["new", "4k"],
      pricing=("second", 0.26, "4K at 30 fps; up to 1080p $0.12/s; 60 fps doubles; Starlight Fast 2 is half", {"byResolution": {"1080p": 0.12, "4K": 0.26}, "factors": [{"param": "targetFps", "values": {"60": 2}}, {"param": "model", "values": {"Starlight Fast 2": 0.5}}]}),
      defaults={"resolution": "4K"}, upscale_tiers=["1080p", "4K"], fps_targets=[24, 30, 60],
      api_defaults={"H264_output": True}, controls=[("model", "Model")], sliders=[("softness", "Softness")])
# ByteDance Upscale: up to 8K with scene presets ("Common" is the API's general preset).
model("bytedance-video-upscale", "ByteDance Upscale", "ByteDance", "bytedance-upscaler", "video", "High-fidelity upscaling up to 8K with scene presets",
      [("upscale-video", "fal-ai/bytedance-upscaler/upscale/video")], badges=["new"],
      pricing=("second", 0.0072, "1080p at 30 fps; 2K $0.0144/s, 4K $0.0288/s (6K / 8K estimated from 4K by pixel count); 60 fps doubles; Pro is 10x", {"byResolution": {"1080p": 0.0072, "2k": 0.0144, "4k": 0.0288, "6k": 0.0648, "8k": 0.1152}, "factors": [{"param": "targetFps", "values": {"60": 2}}, {"param": "enhancement_tier", "values": {"pro": 10}}]}),
      defaults={"resolution": "1080p", "targetFps": 30}, fps_targets=[30, 60],
      controls=[("enhancement_preset", "Preset", {"general": "Common", "ugc": "UGC (social clips)", "short_series": "Short series", "aigc": "AI-generated video", "old_film": "Old film"}),
                ("enhancement_tier", "Model version"), ("fidelity", "Fidelity"), ("bit_depth", "Bit depth")])
# FLUX.3 Upscale: Precise (source-faithful, Higgsfield's default) or Creative detail, guided by an optional prompt; 1.5-3x of the clip.
model("flux-video-upscale", "FLUX.3 Upscale", "Black Forest Labs", "flux", "video", "Preserve the original or creatively enhance detail (MP4, up to 20 s)",
      [("upscale-video", "blackforestlabs/flux-video-upscale")], badges=["new"],
      pricing=("second", 0.15, "2K, precise; 1080p $0.084/s, 4K $0.33/s; Creative about 1.4x", {"byResolution": {"1080p": 0.084, "1440p": 0.15, "4K": 0.33}, "factors": [{"param": "creativity", "values": {"1": 1.4}}]}),
      defaults={"resolution": "1440p"}, upscale_tiers=["1080p", "1440p", "4K"], options={"promptOptional": True},
      api_defaults={"creativity": 0}, controls=[("creativity", "Creativity", {0: "Precise", 1: "Creative"})])
# SeedVR2: target_resolution only applies in "target" mode (the API's default mode is a 2x factor).
model("seedvr-video", "SeedVR2 Video Upscale", "ByteDance Seed", "seedvr", "video", "Restore and upscale video",
      [("upscale-video", "fal-ai/seedvr/upscale/video")], fixed={"upscale_mode": "target"}, defaults={"resolution": "1080p"},
      sliders=[("noise_scale", "Noise")])
model("birefnet-cloud", "BiRefNet background removal", "ZhengPeng7", "birefnet", "image", "Clean cut-outs with hair detail",
      [("bg-remove", "fal-ai/birefnet/v2")], pricing=("image", 0.0), fixed={"operating_resolution": "2048x2048", "output_format": "png"})
model("elevenlabs-tts", "ElevenLabs v3", "ElevenLabs", "elevenlabs", "audio", "Most expressive speech — audio tags like [whispers] and [laughs]",
      [("tts", "fal-ai/elevenlabs/tts/eleven-v3")], badges=["top"], pricing=("request", 0.1, "per 1k chars"), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("elevenlabs-v4", "ElevenLabs v4", "ElevenLabs", "elevenlabs", "audio", "Newest ElevenLabs voice model — natural, stable long-form",
      [("tts", "elevenlabs/tts/eleven-v4")], badges=["new"], pricing=("request", 0.08, "per 1k chars"), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("elevenlabs-v4-turbo", "ElevenLabs v4 Turbo", "ElevenLabs", "elevenlabs", "audio", "Low-latency v4 at half the price",
      [("tts", "elevenlabs/tts/eleven-v4-turbo")], badges=["fast"], pricing=("request", 0.04, "per 1k chars"), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("elevenlabs-multilingual-v2", "ElevenLabs Multilingual v2", "ElevenLabs", "elevenlabs", "audio", "29 languages with speed and style control",
      [("tts", "fal-ai/elevenlabs/tts/multilingual-v2")], pricing=("request", 0.1, "per 1k chars"), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("elevenlabs-dialogue", "ElevenLabs Dialogue", "ElevenLabs", "elevenlabs", "audio", "Several speakers, one natural conversation",
      [("dialogue", "fal-ai/elevenlabs/text-to-dialogue/eleven-v3")], badges=["new"], pricing=("request", 0.1, "per 1k chars"), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("chatterbox-cloud", "Chatterbox (hosted)", "Resemble AI", "chatterbox", "audio", "Clone any voice from a 10-second sample",
      [("tts", "fal-ai/chatterbox/text-to-speech")], pricing=("request", 0.025, "per 1k chars"))
model("index-tts-2-cloud", "IndexTTS-2 (hosted)", "Bilibili", "index-tts", "audio", "Zero-shot cloning with emotion control",
      [("tts", "fal-ai/index-tts-2/text-to-speech")], pricing=("second", 0.002))
# Higgsfield's Audio model selector also lists Inworld and MiniMax Speech (research part 3 / part 2).
model("inworld-tts", "Inworld TTS 1.5 Max", "Inworld", "inworld", "audio", "The cheapest natural narration — 113 voices in 15 languages",
      [("tts", "fal-ai/inworld-tts")], badges=["fast"], pricing=("request", 0.01, "per 1k chars"), defaults={"voice": "Craig (en)"})
model("minimax-speech-2-8", "MiniMax Speech 2.8 HD", "MiniMax", "minimax-speech", "audio", "Expressive multilingual speech with emotion control",
      [("tts", "fal-ai/minimax/speech-2.8-hd", "fal", {"fixed": {"output_format": "url"}})], pricing=("request", 0.1, "per 1k chars"),
      defaults={"voice": "Wise_Woman"}, sliders=[("voice_setting.speed", "Speed")],
      controls=[("voice_setting.emotion", "Emotion"), ("language_boost", "Language")])
model("elevenlabs-voice-changer", "ElevenLabs Voice Changer", "ElevenLabs", "elevenlabs", "audio", "Re-voice a recording with any premade voice",
      [("voice-change", "fal-ai/elevenlabs/voice-changer")], pricing=("minute", 0.3), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("chatterbox-vc-cloud", "Chatterbox Voice Conversion (hosted)", "Resemble AI", "chatterbox", "audio", "Turn a recording into any voice from a sample",
      [("voice-change", "fal-ai/chatterbox/speech-to-speech")], pricing=("minute", 0.015))
model("heygen-translate", "HeyGen Translate", "HeyGen", "heygen", "video", "Lip-synced video translation into 170+ languages and accents",
      [("dub", "fal-ai/heygen/v2/translate/precision")], badges=["top"], pricing=("second", 0.1))
model("heygen-translate-fast", "HeyGen Translate Speed", "HeyGen", "heygen", "video", "Faster, cheaper lip-synced translation",
      [("dub", "fal-ai/heygen/v2/translate/speed")], badges=["fast"], pricing=("second", 0.05))
model("elevenlabs-dubbing", "ElevenLabs Dubbing", "ElevenLabs", "elevenlabs", "video", "Dub video or audio while keeping each speaker's voice",
      [("dub", "fal-ai/elevenlabs/dubbing")], pricing=("minute", 0.6))
# Sound effects and music (research part 3): Mirelo and Sonilo are the jobs Higgsfield's Audio runs.
model("mirelo-sfx-2", "Mirelo SFX 2.0", "Mirelo", "mirelo", "audio", "Layered, cinematic sound effects for a clip or a prompt, up to 10 minutes",
      [("sfx", "mirelo-ai/sfx2.0/text-to-audio")], badges=["top", "new"], defaults={"duration": 5}, options={"durations": [2, 5, 10, 30, 60]},
      pricing=("second", 0.01, "intro price until 2026-12-13, then $0.015"))
# Sonilo answers in AAC unless asked: MP3 plays and downloads everywhere.
model("sonilo-sfx", "Sonilo SFX 1.1", "Sonilo", "sonilo", "audio", "Fast, cheap sound effects up to 3 minutes",
      [("sfx", "sonilo/v1.1/text-to-sound-effects")], badges=["fast"], defaults={"duration": 5}, options={"durations": [2, 5, 8, 15, 30]},
      fixed={"audio_format": "mp3"})
model("stable-audio-3-sfx", "Stable Audio 3 SFX", "Stability AI", "stable-audio", "audio", "Stability's small SFX model — crisp one-shots and ambiences",
      [("sfx", "fal-ai/stable-audio-3/small/sfx/text-to-audio")], defaults={"duration": 10}, options={"durations": [5, 10, 30, 60]})
model("cassette-sfx", "CassetteAI Sound Effects", "CassetteAI", "cassette", "audio", "One-cent sound effects up to 30 s",
      [("sfx", "cassetteai/sound-effects-generator")], badges=["fast"], defaults={"duration": 5}, options={"durations": [2, 5, 10, 30]})
model("seed-audio", "Seed Audio 1.0", "ByteDance", "seed-audio", "audio", "Speech, ambience, music and Foley from one prompt",
      [("sfx", "bytedance/seed-audio-1.0"), ("tts", "bytedance/seed-audio-1.0")], badges=["new"])
model("sonilo-music", "Sonilo Music 1.1", "Sonilo", "sonilo", "audio", "Full music tracks up to 10 minutes",
      [("music", "sonilo/v1.1/text-to-music")], badges=["top", "new"], defaults={"duration": 30}, options={"durations": [15, 30, 60, 120, 240]})
model("lyria-3", "Lyria 3", "Google", "lyria", "audio", "Google DeepMind's music model, from a prompt or an image",
      [("music", "fal-ai/lyria3"), ("music", "google/lyria-3", "replicate")])
model("lyria-3-pro", "Lyria 3 Pro", "Google", "lyria", "audio", "Longer, richer Lyria 3 tracks",
      [("music", "fal-ai/lyria3/pro"), ("music", "google/lyria-3-pro", "replicate")], badges=["pro"])
# A prompt alone has no lyrics to sing: lyrics_optimizer writes them from the prompt.
model("minimax-music-2-5", "MiniMax Music 2.5", "MiniMax", "minimax-music", "audio", "Songs with vocals, lyrics written from your prompt",
      [("music", "fal-ai/minimax-music/v2.5")], fixed={"lyrics_optimizer": True})
model("stable-audio-3-music", "Stable Audio 3 Music", "Stability AI", "stable-audio", "audio", "Quick, cheap loops and beds up to 2 minutes",
      [("music", "fal-ai/stable-audio-3/small/music/text-to-audio")], badges=["fast"], defaults={"duration": 30}, options={"durations": [10, 30, 60, 120]})
model("mureka-song", "Mureka 9.5", "Mureka", "mureka", "audio", "Full songs with vocals in many genres",
      [("music", "mureka/api/generate/song")], pricing=("request", 0.75, "prompt-to-song on mureka-9.5; with lyrics $0.225"),
      # Its vocal gender only applies to lyrics-to-song, which Fuobe doesn't send yet.
      controls=[("model", "Version")])
model("stable-audio-2-5", "Stable Audio 2.5", "Stability AI", "stable-audio", "audio", "Sound design and music beds up to 3 minutes",
      [("sfx", "fal-ai/stable-audio-25/text-to-audio"), ("music", "fal-ai/stable-audio-25/text-to-audio"),
       ("sfx", "stability-ai/stable-audio-2.5", "replicate"), ("music", "stability-ai/stable-audio-2.5", "replicate")],
      defaults={"duration": 30}, options={"durations": [10, 30, 60, 120, 190]})
model("elevenlabs-sfx", "ElevenLabs Sound Effects", "ElevenLabs", "elevenlabs", "audio", "Describe a sound, get a sound",
      [("sfx", "fal-ai/elevenlabs/sound-effects/v2")], pricing=("second", 0.002), defaults={"duration": 5}, options={"durations": [2, 5, 10, 22]})
model("elevenlabs-music", "ElevenLabs Music", "ElevenLabs", "elevenlabs", "audio", "Studio-quality songs from a prompt",
      [("music", "fal-ai/elevenlabs/music")], pricing=("minute", 0.6), defaults={"duration": 30}, options={"durations": [15, 30, 60, 120]})
# Remove background (Video tools): the cut-out, or (BiRefNet: output_mask adds mask_video) its alpha mask.
model("birefnet-video", "BiRefNet video (hosted)", "ZhengPeng7", "birefnet", "video", "Transparent WebM cut-outs of the subject, or their alpha mask",
      [("bg-remove-video", "fal-ai/birefnet/v2/video", "fal", {"keys": {"maskOutput": "output_mask"}})], pricing=("second", 0.0),
      fixed={"video_output_type": "VP9 (.webm)", "model": "General Use (Heavy)"})
model("bria-video-bg", "Bria video background removal", "Bria", "bria", "video", "Production-grade video matting with audio kept",
      [("bg-remove-video", "bria/video/background-removal/v3")], pricing=("second", 0.05),
      fixed={"background_color": "Transparent", "output_container_and_codec": "webm_vp9"}, options={"matteOutputs": ["cutout"]})
model("depth-anything-video-cloud", "Video Depth Anything (hosted)", "ByteDance", "depth-anything", "video", "Stable depth maps for every frame",
      # The colour map follows params.colormap (Higgsfield's Depth Map picker); grayscale unless asked. Side by side
      # puts the original clip next to the map.
      [("depth-video", "fal-ai/depth-anything-video", "fal", {"keys": {"colormap": "colormap", "sideBySide": "side_by_side"}})], pricing=("second", 0.04),
      fixed={"model": "VDA-Base"}, api_defaults={"colormap": "grayscale"})
model("lightx-relight", "LightX Relight", "LightX", "lightx", "video", "Relight a video from a description and a light direction",
      [("relight-video", "fal-ai/lightx/relight")], pricing=("second", 0.1),
      fixed={"relit_cond_type": "ic", "relight_parameters.bg_source": "Left"},
      options={"controls": [{"param": "relight_parameters.bg_source", "label": "Light from", "values": ["Left", "Right", "Top", "Bottom"], "default": "Left"}]})
model("mmaudio-cloud", "MMAudio", "hkchengrex", "mmaudio", "video", "Add matching sound to a silent video",
      [("v2a", "fal-ai/mmaudio-v2")], pricing=("second", 0.001))
# Its duration defaults to 10 s and is clamped to the video: ask for the maximum so the whole clip gets sound.
model("mirelo-sfx-2-video", "Mirelo SFX 2.0 for video", "Mirelo", "mirelo", "video", "Sound effects in sync with your video, speech kept",
      [("v2a", "mirelo-ai/sfx2.0/video-to-video")], badges=["top", "new"], pricing=("second", 0.01, "intro price until 2026-12-13, then $0.015"),
      api_defaults={"duration": 600})

# ----- Image tools: layers, text layers, cut-outs, vectors (research part 3; Higgsfield Layers)
model("seedream-5-layers", "Seedream 5.0 Layers", "ByteDance", "seedream", "image",
      "Splits a picture into a background and up to 16 named, positioned layers",
      [("layers", "bytedance/seedream/v5/pro/layerize")], badges=["top", "new"], defaults={"resolution": "auto"},
      pricing=("request", 0.17, "$0.034 per layer, ≈5 layers; double above 1536²"))
model("seedream-5-flash-layers", "Seedream 5.0 Flash Layers", "ByteDance", "seedream", "image", "Faster, cheaper Seedream layer split",
      [("layers", "bytedance/seedream/v5/flash/layerize")], badges=["fast"], defaults={"resolution": "auto"},
      pricing=("request", 0.135, "$0.027 per layer, ≈5 layers"))
model("qwen-image-layered-cloud", "Qwen-Image Layered (hosted)", "Alibaba Qwen", "qwen-image", "image",
      "Open-weights layer split: 1–10 full-canvas RGBA layers",
      [("layers", "fal-ai/qwen-image-layered"), ("layers", "qwen/qwen-image-layered", "replicate")])
model("ideogram-3-text-layers", "Ideogram 3.0 Text Layers", "Ideogram", "ideogram", "image",
      "Lift the text off a poster: a clean background plus editable text blocks",
      [("text-layers", "fal-ai/ideogram/v3/layerize-text")], badges=["new"])
model("ideogram-remove-bg", "Ideogram Remove Background", "Ideogram", "ideogram", "image", "Clean transparent cut-outs for one cent",
      [("bg-remove", "fal-ai/ideogram/remove-background")], badges=["fast"], pricing=("image", 0.01))
model("recraft-vectorize", "Recraft Vectorize", "Recraft", "recraft", "image", "Turn any image into a clean, editable SVG",
      [("vectorize", "fal-ai/recraft/vectorize"), ("vectorize", "recraft-ai/recraft-vectorize", "replicate")], badges=["top"])
model("image2svg", "Image to SVG (VTracer)", "VTracer", "vtracer", "image", "Half-cent tracing for logos, icons and flat art",
      [("vectorize", "fal-ai/image2svg")], badges=["fast"], controls=[("colormode", "Colours"), ("mode", "Curves")])

# ----- Video & audio utilities (research part 3): steps for chains (trim, soundtrack) and studios (captions, transcripts, stems)
model("trim-video", "Trim video", "fal", "utility", "video", "Keep the part between two times",
      [("trim", "fal-ai/workflow-utilities/trim-video", "fal", {"drop": ["duration"]})],
      pricing=("request", 0.001, "billed per compute second"), hidden=True)
model("merge-audio-video", "Add soundtrack", "fal", "utility", "video", "Replace a video's sound with an audio track",
      [("mux", "fal-ai/ffmpeg-api/merge-audio-video")], pricing=("second", 0.0002), hidden=True)
# Auto Subtitle has no language detection (its language defaults to English): the spoken language is a picker.
model("auto-subtitle", "Auto Subtitle", "fal", "captions", "video", "TikTok-style karaoke captions; English unless you pick the spoken language",
      [("captions", "fal-ai/workflow-utilities/auto-subtitle")], badges=["top"],
      sliders=[("words_per_subtitle", "Words per caption"), ("font_size", "Size")],
      controls=[("font_weight", "Weight"), ("font_color", "Colour"), ("highlight_color", "Highlight"), ("position", "Position")])
model("veed-subtitles", "VEED Subtitles", "VEED", "veed", "video", "30 designed caption styles, with optional translation",
      [("captions", "veed/subtitles")], fixed={"preset": "simple"}, controls=[("preset", "Style")],
      pricing=("minute", 0.1, "basic styles; dynamic styles (glass, whisper, glide, fusion, terminal, handwritten, backdrop) and >1080p 2x; translation +$0.20/min"))
model("scribe-v2", "ElevenLabs Scribe v2", "ElevenLabs", "elevenlabs", "text", "Word-timed transcripts with speakers and sound events",
      [("transcribe", "fal-ai/elevenlabs/speech-to-text/scribe-v2"), ("transcribe", "elevenlabs/scribe-v2", "replicate")], badges=["top"],
      pricing=("minute", 0.008, "+30% with key terms"))
# Wizper's language defaults to English; null makes it detect the language (unless one is picked).
model("wizper", "Wizper (Whisper v3)", "fal", "whisper", "text", "Fast Whisper large-v3 transcripts in segments, any language",
      [("transcribe", "fal-ai/wizper")], badges=["fast"], api_defaults={"language": None})
# Word-level chunks: the transcript's cues are built from word timings (segment chunks are the API default).
model("whisper", "Whisper large-v3", "OpenAI", "whisper", "text", "Whisper large-v3 with word timings, any language",
      [("transcribe", "fal-ai/whisper")], fixed={"chunk_level": "word"})
model("demucs", "Demucs stem split", "Meta", "demucs", "audio", "Split a track into vocals, drums, bass and the rest",
      [("separate-audio", "fal-ai/demucs")], fixed={"model": "htdemucs"})
# Translate & dub (cloud, step by step): the clean voice straight from the video, to clone in the new language.
# The cloud dub's voice track (av-tools): the spoken lines placed at their cue times over a still for the video's
# length (compose renders a video), then its soundtrack read back as audio for voice conversion and lip re-sync.
model("compose-timeline", "Voice timeline", "fal", "utility", "video", "Place audio clips at their start times on a timeline",
      [("timeline", "fal-ai/ffmpeg-api/compose")], pricing=("second", 0.0002), hidden=True)
model("extract-soundtrack", "Extract soundtrack", "fal", "utility", "audio", "A video's soundtrack as an audio file",
      [("separate-audio", "fal-ai/workflow-utilities/extract-audio")], pricing=("second", 0.0002, "billed by compute time"), hidden=True)
model("elevenlabs-voice-isolation", "ElevenLabs Voice Isolation", "ElevenLabs", "elevenlabs", "audio", "Clean speech from a video or recording — music and noise removed",
      [("separate-audio", "fal-ai/elevenlabs/audio-isolation")], pricing=("minute", 0.1))

# ----- Image to 3D (research part 3; product spins, 3D blocking)
model("hunyuan-3d-3-1-pro", "Hunyuan3D 3.1 Pro", "Tencent Hunyuan", "hunyuan-3d", "model3d", "Textured, game-ready 3D models from a product photo",
      [("image-to-3d", "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d")], badges=["top", "new"], pricing=("request", 0.375, "+$0.15 with PBR"),
      controls=[("generate_type", "Mode")])
model("hunyuan-3d-3-1-rapid", "Hunyuan3D 3.1 Rapid", "Tencent Hunyuan", "hunyuan-3d", "model3d", "Faster, cheaper single-view Hunyuan3D",
      [("image-to-3d", "fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d")], badges=["fast"], pricing=("request", 0.225, "+$0.15 with PBR"))
model("trellis-2", "TRELLIS.2", "Microsoft", "trellis", "model3d", "Open-weights image to GLB with detailed geometry",
      [("image-to-3d", "fal-ai/trellis-2")], defaults={"resolution": "1024"}, pricing=("request", 0.3, "1024p; 512p $0.25, 1536p $0.35"))
model("tripo-h3-1", "Tripo H3.1", "Tripo", "tripo", "model3d", "Clean topology and PBR textures, ready for engines",
      [("image-to-3d", "tripo3d/h3.1/image-to-3d")], pricing=("request", 0.3, "standard textures; untextured $0.20, HD $0.40"),
      controls=[("texture_quality", "Texture"), ("geometry_quality", "Geometry")])
model("meshy-7-1", "Meshy 7.1", "Meshy", "meshy", "model3d", "Textured models with optional auto-rigging; describe the texture in the prompt",
      [("image-to-3d", "meshy/v7.1/image-to-3d")], pricing=("request", 1.2, "textured; untextured $0.80, rigging +$0.20"),
      controls=[("model_type", "Mesh"), ("topology", "Topology")])


# ---------------------------------------------------------------------------
# Round 4 (research part 4): video erase / swap / insert, FPS boost, SDR to HDR, FFmpeg-style tools, OCR, 3D
# and the models released between 2026-09-15 and 2026-10-22.
#
# TODO(kling-4): Kling 4.0 (kling/v4/text-to-video, image-to-video, reference-to-video, video-to-video/edit) has
# schemas in paid-model-apis-4.json but status "playground-only": fal's pages say "Kling 4.0 is available in the
# playground and fal Agent. API access is coming soon." (re-checked 2026-10-22). Add a "kling-4" model here
# (t2v / i2v + keyframes / ref2v / v2v + remove-object / video-swap / video-insert) once the API opens.

# What VOID and VACE regenerate in the masked area when Fuobe's prompt names the thing to remove.
SCENE_AFTER_REMOVAL = "The same shot with nothing there: the background continues naturally, matching the light, texture and motion around it"

# ----- Remove an object from a video (Bria under 5 s; VOID also removes shadows and reflections; LTX clean plate removes people)
model("bria-video-erase", "Bria Video Eraser", "Bria", "bria", "video",
      "Name what to remove from a clip under 5 s — sound kept",
      [("remove-object", "bria/video/erase/prompt")], badges=["new"], pricing=("second", 0.14, "clips under 5 s; longer ones are cut to their first 5 s"))
model("bria-video-erase-points", "Bria Video Eraser · points", "Bria", "bria", "video",
      "Remove what you click on the first frame (under 5 s)",
      [("remove-object", "bria/video/erase/keypoints")], pricing=("second", 0.14, "clips under 5 s"), hidden=True,
      options={"requires": {"points": True, "msg": "Click what to remove on the first frame"}})
# A mask *video* (white = erase), e.g. from SAM 3.1 video: Fuobe's painted first-frame mask is not one.
model("bria-video-erase-mask", "Bria Video Eraser · mask video", "Bria", "bria", "video",
      "Remove what a mask video marks (white), under 5 s",
      [("remove-object", "bria/video/erase/mask"), ("remove-object", "bria/video-erase-object", "replicate", {"fixed": {"auto_trim": True}})],
      pricing=("second", 0.14, "fal; $0.05/s on Replicate"), hidden=True,
      options={"requires": {"mask": True, "msg": "Add the mask video (white = what to remove)"}})
# Netflix's VOID (Apache-2.0 weights on a CogVideoX base, comfyui-oss-4.md), hosted by fal.
model("void-video-inpainting", "VOID Video Eraser", "Netflix", "void", "video",
      "Removes an object and what it causes — shadows, reflections, ripples — from clips up to ~8 s",
      [("remove-object", "fal-ai/void-video-inpainting", "fal",
        {"drop": ["mask"], "note": "Up to 197 frames (about 8 s at 24 fps): split longer clips"})], badges=["new"],
      pricing=("request", 0.1, "$0.05 per clip + $0.05 for the mask made from your words; Pass 2 refinement doubles the first part; up to 197 frames"),
      api_defaults={"prompt": SCENE_AFTER_REMOVAL})
model("ltx-2-3-clean-plate", "LTX 2.3 Clean Plate", "Lightricks", "ltx", "video",
      "Removes every person from a shot for a clean background plate",
      # "720p allows up to ~6s, 480p up to ~15s. A request above the budget is rejected" (num_frames from the clip's length).
      [("remove-object", "fal-ai/ltx-2.3-quality/clean-plate", "fal", {"drop": ["prompt"], "note": "720p up to about 6 s, 480p up to about 15 s"})],
      pricing=("video", 0.27, "121 frames at 720p; billed per megapixel of video"), defaults={"resolution": "720p"})
# Hosted Wan 2.2 VACE Fun: the painted first-frame mask is tracked through the clip (mask_image_url). Erase with a
# description of the background (SCENE_AFTER_REMOVAL unless params.extra.prompt says otherwise); swap and insert
# regenerate the masked area as the reference image(s), following the prompt.
_VACE = "fal-ai/wan-22-vace-fun-a14b/inpainting"
_VACE_KEYS = {"keys": {"mask": "mask_image_url"}, "drop": ["image", "endImage"]}
model("wan-22-vace-inpaint", "Wan 2.2 VACE Fun Inpaint (hosted)", "Alibaba Wan", "wan", "video",
      "Paint an area on the first frame: erase it, or swap or add something from a reference image",
      [("remove-object", _VACE, "fal", {**_VACE_KEYS, "drop": ["image", "endImage", "images", "prompt"], "defaults": {"prompt": SCENE_AFTER_REMOVAL}}),
       ("video-swap", _VACE, "fal", _VACE_KEYS), ("video-insert", _VACE, "fal", _VACE_KEYS)],
      # "Video seconds calculated at 16 frames per second": the clip keeps its own frame rate, so a 30 fps clip bills ~1.9x its length.
      pricing=("second", 0.1, "720p, billed as frames ÷ 16 (a 30 fps clip costs about 1.9× its length); 580p $0.075, 480p $0.05",
               {"byResolution": {"720p": 0.1, "580p": 0.075, "480p": 0.05}}),
      api_defaults={"match_input_num_frames": True, "match_input_frames_per_second": True},
      options={"requires": {"mask": True, "msg": "Paint the area to change on the first frame"}})
# The mask maker for the erase and swap chains, and Remove background's "keep what you name" on the cloud (Higgsfield
# runs SAM 3 video there): what you name or click becomes a black-and-white mask video (apply_mask off; whether the
# matte is clean black and white is unverified without a run). fal can't cut out by words, so it makes the mask only.
model("sam-3-1-video-mask", "SAM 3.1 video mask", "Meta", "sam", "video",
      "The alpha mask of what you name (“the dog”), tracked through the clip",
      [("bg-remove-video", "fal-ai/sam-3-1/video")], fixed={"apply_mask": False},
      pricing=("second", 0.015, "$0.01 per 16 input frames (24 fps)"), options={"keepsNamed": True, "matteOutputs": ["matte"]})

# ----- Swap who or what is on camera
model("p-video-replace", "P-Video Replace", "Pruna AI", "p-video", "video",
      "Put the people from 1–3 photos into a clip — same motion, timing, camera and sound",
      [("video-swap", "prunaai/p-video-replace", "replicate", {"drop": ["fps"]})], badges=["new"],
      pricing=("second", 0.03, "720p; 1080p $0.06", {"byResolution": {"720p": 0.03, "1080p": 0.06}}), defaults={"resolution": "720p"},
      # "Identity reference image(s) (1-3)".
      options={"maxImages": 3})
# Genjutsu's hosted open alternatives (O5): Wan 2.2 Animate Replace and SCAIL-2 for people, Wan Motion with pose
# retargeting; and MiniMax's own person swap, H3 Max Recast (a partner model: closed weights).
model("wan-22-animate-replace", "Wan 2.2 Animate Replace (hosted)", "Alibaba Wan", "wan", "video",
      "Swaps the person on camera for your character, lighting matched to the scene",
      [("video-swap", "fal-ai/wan/v2.2-14b/animate/replace")], fit_values=True,
      pricing=("second", 0.08, f"720p; 580p $0.06, 480p $0.04 · {_FRAMES16}", _ANIMATE_PRICE), defaults={"resolution": "720p"})
_SCAIL_PROMPT = "The reference character performs the motion of the video"
model("scail-2", "SCAIL-2 (hosted)", "SCAIL", "scail", "video",
      "Character animation without skeletons: humans, several people or animals; or replace the person",
      [("motion-transfer", "fal-ai/scail-2", "fal", {"fixed": {"mode": "animation"}}),
       ("video-swap", "fal-ai/scail-2", "fal", {"fixed": {"mode": "replacement"}})],
      controls=[("subject_type", "Subject"), ("driving_type", "Driven by")], api_defaults={"prompt": _SCAIL_PROMPT},
      # Words are optional: the API's own prompt (above) goes when none are given.
      options={"promptOptional": True},
      pricing=("second", 0.2, "512p or 704p; output at 16 fps, up to 10 s a call"), defaults={"resolution": "512p"})
model("wan-motion", "Wan Motion (hosted)", "Alibaba Wan", "wan", "video",
      "Wan-Animate with pose retargeting: the motion fitted to your character's proportions",
      [("motion-transfer", "fal-ai/wan-motion")],
      pricing=("second", 0.06, "720p; billed as frames ÷ 24 (a 30 fps clip costs 1.25× its length); +$0.08 with identity enhancement"))
model("h3-max-recast", "MiniMax H3 Max Recast", "MiniMax", "hailuo", "video",
      "MiniMax's own person swap: 1–4 people from photos, across shots, sound kept",
      [("video-swap", "minimax/h3-max/recast")], fit_values=True, badges=["new", "audio"], controls=[("enhance_realism", "Enhance realism")],
      pricing=("second", 0.3, "768p; 1080p $0.45/s; references free; 5–30 s, no shot over 15 s", {"byResolution": {"768p": 0.3, "1080p": 0.45}}),
      defaults={"resolution": "768p"})

# ----- FPS boost, slow motion and SDR to HDR (Higgsfield's Upscale tools)
model("topaz-fps-boost", "Topaz FPS Boost", "Topaz Labs", "topaz", "video",
      "Smooth frame interpolation to 16–120 fps, or up to 8× slow motion",
      [("interpolate", "topaz/interpolate/video")], badges=["new"],
      pricing=("second", 0.03, "1080p 30→60 fps with Apollo or Chronos; 4K $0.06; Aion $0.05 / $0.17; slow motion bills the whole output", {"factors": [{"param": "model", "values": {"Aion": 1.67}}]}),
      # H.265 unless asked: H.264 plays in every browser.
      api_defaults={"H264_output": True}, controls=[("model", "Model")],
      # Higgsfield's FPS Boost chips (60 by default) and slow motion (the API takes 1-8).
      fps_targets=[24, 30, 60, 90, 120], defaults={"targetFps": 60}, options={"slowdowns": [1, 2, 4, 8]})
# Doubles the frame rate (one new frame per pair) at the clip's own speed; its fps field only applies with
# use_calculated_fps off, so a target frame rate is not sent.
model("rife-video-cloud", "RIFE (hosted)", "Open source", "rife", "video",
      "Cheap frame interpolation: twice the frames, same speed",
      [("interpolate", "fal-ai/rife/video", "fal", {"drop": ["fps"]})], badges=["fast"], pricing=("request", 0.001, "billed per compute second ($0.0013/s)"))
model("topaz-sdr-to-hdr", "Topaz SDR to HDR", "Topaz Labs", "topaz", "video",
      "Hyperion 2.5: SDR footage to 10-bit HDR10 (H.265) or ProRes 422 HQ",
      [("sdr-to-hdr", "topaz/sdr-to-hdr/video")], badges=["new"], formats={"h265_10bit": "mp4", "prores_422_hq": "prores"},
      pricing=("second", 0.24, "up to 1080p at 30 fps; 4K $0.51"))
# EXR frames only (a ZIP, kept as a link on the SDR preview); prompt = how to see the shot, defaulted. Its /lora twin
# (O11, research hostedLoraEndpoints) takes the run when a LoRA rides along.
model("ltx-2-3-hdr", "LTX 2.3 HDR (EXR frames)", "Lightricks", "ltx", "video",
      "SDR to 16-bit EXR frames for compositing, with an SDR preview",
      [("sdr-to-hdr", "fal-ai/ltx-2.3-quality/hdr", "fal", {"drop": ["prompt", "resolution"], "loraEndpoint": "fal-ai/ltx-2.3-quality/hdr/lora"})], options={"formats": ["exr"]},
      api_defaults={"prompt": "The same shot in high dynamic range: deeper shadows and brighter highlights, every detail and movement unchanged"},
      pricing=("video", 0.3, "121 frames at 720p; billed per megapixel of HDR video"))

# ----- FFmpeg-style tools for chains (Ken Burns, end cards, per-frame Mixed Media, audio): hidden utilities
model("ken-burns", "Ken Burns", "fal", "utility", "video", "A slow zoom into (or out of) a still, toward a focal point",
      [("still-motion", "fal-ai/workflow-utilities/image-to-video")], pricing=("request", 0.001, "billed per compute second"), hidden=True)
model("overlay-image", "Overlay image", "fal", "utility", "image", "Places a logo or picture on another, at a position and size",
      [("overlay", "fal-ai/workflow-utilities/overlay-image")], pricing=("request", 0.001, "billed per compute second"), hidden=True)
model("extract-frames", "Extract frames", "fal", "utility", "image", "Every Nth frame of a video as images (up to 500 a call)",
      # max_frames defaults to 100 at the API: ask for its most (500), so a clip is not cut short silently.
      [("extract-frames", "fal-ai/workflow-utilities/extract-nth-frame")], pricing=("request", 0.001, "billed per compute second"), hidden=True,
      api_defaults={"max_frames": 500})
model("images-to-video", "Images to video", "fal", "utility", "video", "Images in order as the frames of a video",
      [("images-to-video", "fal-ai/ffmpeg-api/images-to-video")], pricing=("request", 0.001, "billed per compute second"), hidden=True)
# Concatenates 2–5 files (no crossfade on the cloud: hard joins); a loop repeats the clip, up to 5 plays a call.
model("join-audio", "Join audio", "fal", "utility", "audio", "Audio clips one after another, or one clip played several times",
      [("audio-join", "fal-ai/ffmpeg-api/merge-audios"), ("audio-loop", "fal-ai/ffmpeg-api/merge-audios")],
      pricing=("request", 0.001, "billed per compute second"), hidden=True)

# ----- Read text with its boxes (Layers)
model("florence-2-ocr", "Florence-2 OCR", "Microsoft", "florence", "text", "Every line of text in an image, with its box",
      [("ocr", "fal-ai/florence-2-large/ocr-with-region")], pricing=("request", 0.001, "billed per compute second"))

# ----- 3D: splats, objects in place, text to 3D, multi-view and rigging
model("triposplat", "TripoSplat", "Tripo", "tripo", "model3d", "A Gaussian splat of the subject in one photo (background removed)",
      [("splat", "tripo3d/triposplat")], badges=["new"], fixed={"output_format": "ply"}, sliders=[("num_gaussians", "Gaussians")])
# Its prompt defaults to "car" at the API, so Fuobe always asks for one.
model("sam-3d-objects", "SAM 3D Objects", "Meta", "sam", "model3d", "The objects you name, rebuilt in 3D where they stand in the photo",
      # export_textured_glb defaults to false (a grey mesh): the viewer shows the textured one.
      [("image-to-3d", "fal-ai/sam-3/3d-objects")], badges=["new"], pricing=("request", 0.02, "per unit; fal does not say what a unit is"),
      fixed={"export_textured_glb": True}, options={"requires": {"prompt": True, "msg": "Name the objects to rebuild, e.g. “chair, lamp”"}})
model("tripo-h3-1-text", "Tripo H3.1 Text to 3D", "Tripo", "tripo", "model3d", "A textured 3D model from a description",
      [("text-to-3d", "tripo3d/h3.1/text-to-3d")], pricing=("request", 0.2, "standard textures; untextured $0.10, HD $0.30"),
      controls=[("texture_quality", "Texture"), ("geometry_quality", "Geometry")])
model("meshy-7-1-multi", "Meshy 7.1 Multi-view", "Meshy", "meshy", "model3d", "One object from up to 4 photos of different sides",
      [("image-to-3d", "meshy/v7.1/multi-image-to-3d")], pricing=("request", 1.2, "textured; untextured $0.80, rigging +$0.20"),
      controls=[("topology", "Topology")], options={"minImages": 2})
model("meshy-rigging", "Meshy Rigging", "Meshy", "meshy", "model3d", "Rig a humanoid GLB with a skeleton, walk and run cycles, or an animation preset",
      [("rig-3d", "fal-ai/meshy/rigging")], badges=["new"], pricing=("request", 0.2, "+$0.12 with an animation preset", {"animationUsd": 0.12}))
# Cinema Studio's "Create 3D scene" on the cloud (part 4 §8): a depth map of the whole frame, which the browser
# turns into a point cloud with the photo's colours. So scene-3d answers with an image on this model.
model("marigold-depth", "Marigold V2 Depth", "Marigold", "marigold", "image", "A depth map of the whole frame, for the 3D scene your browser builds",
      [("scene-3d", "fal-ai/marigold-v2")], hidden=True, fixed={"prediction_type": "depth"})

# ----- New video models
model("flux-3-max", "FLUX 3 Max", "Black Forest Labs", "flux", "video",
      "BFL's top video model: 5–20 s with sound, start and end frames, or up to 10 keyframes",
      [("t2v", "blackforestlabs/flux-3-max/text-to-video"), ("i2v", "blackforestlabs/flux-3-max/image-to-video", "fal", "+flf2v"),
       ("keyframes", "blackforestlabs/flux-3-max/keyframes-to-video")],
      badges=["new", "audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"},
      # The research's explicit promo-then-list prices ("75% off ... from October 15 to November 7"): parse_price would
      # read only the promo rate. The catalog switches to the list price after the promo's last day (Pricing.promo).
      pricing=("second", 0.17, "720p; 1080p $0.29 — launch price $0.0425 (1080p $0.0725) until 2026-11-07",
               {"byResolution": {"720p": 0.17, "1080p": 0.29},
                "promo": {"until": "2026-11-07", "usd": 0.0425, "byResolution": {"720p": 0.0425, "1080p": 0.0725}}}),
      controls=[("reasoning_level", "Reasoning")])
model("heygen-video", "HeyGen Video", "HeyGen", "heygen", "video",
      "HeyGen's model on MiniMax H3 — cheap 768p clips, references with sound",
      [("t2v", "heygen/heygen-video/text-to-video"), ("i2v", "heygen/heygen-video/image-to-video"), ("ref2v", "heygen/heygen-video/reference-to-video")],
      badges=["new", "fast"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "768p"}, ranged_durations=True,
      pricing=("second", 0.02, "480p and 768p; 1080p and 2K $0.06", {"byResolution": {"480p": 0.02, "768p": 0.02, "1080p": 0.06, "2k": 0.06}}),
      controls=[("prompt_enhancement", "Prompt boost")])
# Its routes take different values (fal's reference-to-video stops at 720p), so each lists its own (fit_values).
model("grok-imagine-video-1-5", "Grok Imagine Video 1.5", "xAI", "grok", "video", "xAI's video model with references and audio",
      [("t2v", "xai/grok-imagine-video/v1.5/text-to-video"), ("i2v", "xai/grok-imagine-video/v1.5/image-to-video"),
       ("ref2v", "xai/grok-imagine-video/v1.5/reference-to-video")],
      defaults={"aspectRatio": "16:9", "duration": 6, "resolution": "720p"}, ranged_durations=True, fit_values=True,
      pricing=("second", 0.14, "720p; 480p $0.08, 1080p $0.25; +$0.01 per input image", {"byResolution": {"480p": 0.08, "720p": 0.14, "1080p": 0.25}}))
model("grok-imagine-video-1-5-lite", "Grok Imagine Video 1.5 Lite", "xAI", "grok", "video", "One of the cheapest 720p video models, 1–15 s",
      [("t2v", "xai/grok-imagine-video/v1.5/lite/text-to-video"), ("i2v", "xai/grok-imagine-video/v1.5/lite/image-to-video")],
      badges=["new", "fast"], defaults={"aspectRatio": "16:9", "duration": 6, "resolution": "720p"}, ranged_durations=True,
      pricing=("second", 0.03, "720p; 480p $0.02, 1080p $0.14; +$0.01 per input image", {"byResolution": {"480p": 0.02, "720p": 0.03, "1080p": 0.14}}))
model("pixverse-v6-max", "PixVerse V6 Max", "PixVerse", "pixverse", "video", "PixVerse's top model — up to 15 s 1080p with sound and dialogue",
      [("t2v", "pixverse/pixverse-v6-max", "replicate"), ("i2v", "pixverse/pixverse-v6-max", "replicate")],
      badges=["new", "audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"},
      # Sound is on by default in Fuobe (off at the API), so the estimate uses the with-sound rates.
      pricing=("second", 0.15, "720p with sound; without $0.11; 1080p $0.28 / $0.22",
               {"byResolution": {"360p": 0.09, "540p": 0.11, "720p": 0.15, "1080p": 0.28}}))
model("p-video-2-pro-reference", "P-Video 2 Pro Reference", "Pruna AI", "p-video", "video",
      "MiniMax H3 reference-to-video: images, clips and sound to follow, optional first and last frame",
      [("ref2v", "prunaai/p-video-2-pro-reference", "replicate")], badges=["new"],
      defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "768p"}, ranged_durations=True,
      pricing=("second", 0.035, "768p speed mode; cost mode $0.025; + reference clips and images", {"byResolution": {"480p": 0.02, "768p": 0.035}}),
      controls=[("mode", "Mode")])
model("creatify-boreal", "Creatify Boreal", "Creatify", "creatify", "video",
      "UGC, product and presenter clips with sound for a cent a second",
      [("t2v", "creatify/boreal"), ("i2v", "creatify/boreal")], badges=["new", "audio", "fast"],
      defaults={"aspectRatio": "16:9", "duration": 10, "resolution": "720p"}, ranged_durations=True,
      pricing=("second", 0.01, "720p; 1080p $0.03, 2K $0.12", {"byResolution": {"720p": 0.01, "1080p": 0.03, "2k": 0.12}}))
model("pixelcut-looping-video", "Pixelcut Looping Video", "Pixelcut", "pixelcut", "video",
      "A product photo as a seamless 5–15 s loop, camera locked",
      [("i2v", "pixelcut/looping-video")], badges=["new"], defaults={"duration": 5, "resolution": "768p", "generateAudio": False}, ranged_durations=True,
      pricing=("second", 0.16, "768p; 480p $0.08, 1080p $0.32", {"byResolution": {"480p": 0.08, "768p": 0.16, "1080p": 0.32}}),
      # "Optional creative direction for the motion. Camera stays locked regardless."
      controls=[("motion", "Motion")], options={"promptOptional": True})
model("minimax-h3-max-reframe", "MiniMax H3 Max Reframe", "MiniMax", "hailuo", "video",
      "Outpaints a clip to a new shape — 9:16, 1:1, 21:9 and more — sound and timing kept",
      [("reframe", "minimax/h3-max/reframe-video")], badges=["new"], defaults={"aspectRatio": "9:16", "resolution": "768p"},
      pricing=("second", 0.08, "768p; 480p $0.05; long clips run in overlapping windows, and the overlap is billed", {"byResolution": {"480p": 0.05, "768p": 0.08}}))
# A script-spoken avatar needs no audio file, but Fuobe's avatar flow brings the voice: the TTS fields stay out.
model("p-video-2-pro-avatar", "P-Video 2 Pro Avatar", "Pruna AI", "p-video", "video",
      "A portrait and a voice track → a talking video up to 3 minutes",
      [("avatar", "prunaai/p-video-2-pro-avatar", "replicate", {"drop": ["voice", "script", "language"]})], badges=["new"],
      defaults={"resolution": "768p"}, pricing=("second", 0.04, "768p; 480p $0.02", {"byResolution": {"480p": 0.02, "768p": 0.04}}))

# ----- New image models
model("krea-3", "Krea 3", "Krea", "krea", "image", "Krea's new image model — generate or edit with up to 8 references",
      [("t2i", "krea/v3/text-to-image"), ("edit", "krea/v3/edit"), ("t2i", "krea/krea-3", "replicate"), ("edit", "krea/krea-3", "replicate")],
      badges=["new"], defaults={"aspectRatio": "1:1"}, pricing=("megapixel", 0.025, "output + each reference; Replicate $0.03–0.08 per image"),
      # Both APIs take up to 8 images.
      options={"maxImages": 8})
# fal's text-to-image has no "auto": each route lists what it takes (fit_values).
model("grok-imagine-image-2", "Grok Imagine Image 2.0", "xAI", "grok", "image", "xAI's image model — bold, fast, few refusals",
      # fal's edit takes "a maximum of 5 images".
      [("t2i", "xai/grok-imagine-image/v2.0/text-to-image"), ("edit", "xai/grok-imagine-image/v2.0/edit", "fal", {"max_images": 5})],
      defaults={"aspectRatio": "1:1", "resolution": "1k"}, fit_values=True,
      pricing=("image", 0.06, "1K medium on fal; low $0.04; 2K $0.06–0.08; +$0.01 per input image",
               {"byResolution": {"1k": 0.06, "2k": 0.08}}),
      controls=[("quality", "Quality")], options={"maxImages": 5})
model("bria-fibo-2", "Bria FIBO 2", "Bria", "bria", "image", "Structured prompts; Bria says it is trained on licensed data only",
      [("t2i", "bria/fibo-2/generate"), ("edit", "bria/fibo-2/edit")], badges=["new"], defaults={"aspectRatio": "1:1"}, options={"layout": "vgl"})
model("ideogram-vector", "Ideogram Vector", "Ideogram", "ideogram", "image", "Editable SVGs from a prompt, or any image traced to SVG",
      [("t2i", "ideogram/vector/text-to-vector"), ("vectorize", "ideogram/vector/image-to-vector")], badges=["new"],
      defaults={"aspectRatio": "1:1"}, pricing=("image", 0.16, "per SVG at medium quality (low $0.13, high $0.20); image to SVG $0.10"),
      controls=[("quality", "Quality")])
# Its negative_prompt is refused, not ignored: never sent.
model("bria-expand", "Bria Expand", "Bria", "bria", "image", "Extend a picture to a new aspect ratio, edges filled to match",
      # Words for the new area are optional ("Omit it and the model is asked only to extend the image").
      # It needs a target shape (aspect_ratio or canvas_size): a run without one widens to 16:9.
      [("outpaint", "bria/fibo-edit-1.5/expand", "fal", {"drop": ["negativePrompt"]})], badges=["new"], options={"promptOptional": True},
      defaults={"aspectRatio": "16:9"})

# ----- New speech models
model("heygen-voice-turbo", "HeyGen Voice Turbo", "HeyGen", "heygen", "audio", "24 voices or an instant clone of yours, in 39 languages, for almost nothing",
      [("tts", "heygen/heygen-voice/turbo")], badges=["new", "fast"], pricing=("request", 0.004, "per 1k chars"))
model("gemini-3-8-flash-tts", "Gemini 3.8 Flash TTS", "Google", "gemini-tts", "audio", "30 Gemini voices with inline <laugh> and <sigh>",
      [("tts", "google/gemini-3.8-flash-tts")], badges=["new"], pricing=("request", 0.045, "per 1k chars"))


# ---------------------------------------------------------------------------

# Numeric voice settings exposed as sliders.
SLIDER_LABELS = {
    "stability": "Stability", "similarity_boost": "Similarity", "style": "Style exaggeration", "speed": "Speed",
    "exaggeration": "Emotion", "cfg": "Pace / guidance", "temperature": "Variety", "strength": "Voice strength",
}

# ElevenLabs premade voices (docs/research/paid-model-apis-2.json → elevenlabsVoices). Sent by voice_id.
_EL = RESEARCH_2.get("elevenlabsVoices") or {}
ELEVEN_VOICES = [
    {"id": v["voice_id"], "name": v["name"], "hint": " · ".join(x for x in [(v.get("label") or "").partition(" - ")[2], v.get("accent")] if x)}
    for v in (_EL.get("voices") or [])
]

# ElevenLabs dubbing takes ISO 639-1 codes.
ISO_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "pl", "hi", "ja", "ko", "zh", "ar", "ru", "tr", "nl", "sv", "id", "fil", "uk", "el", "cs",
                 "ro", "da", "fi", "bg", "hr", "sk", "ms", "ta", "vi", "hu", "no"]


def warn(msg):
    print(f"warning: {msg}", file=sys.stderr)


def union(a, b):
    out = list(a)
    for x in b:
        if x not in out:
            out.append(x)
    return out


def num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


def spec_at(inputs, path):
    """The research spec of a (possibly dotted) input field: voice_setting.voice_id → inputs.voice_setting.fields.voice_id."""
    head, _, rest = path.partition(".")
    spec = inputs.get(head)
    for part in rest.split(".") if rest else []:
        spec = ((spec or {}).get("fields") or {}).get(part)
    return spec if isinstance(spec, dict) else None


def palette_format(spec):
    """How an API wants its colour palette (FieldMap.palette.format), from the research schema."""
    if not spec:
        return None
    if spec.get("type") == "object" and "members" in (spec.get("fields") or {}):
        return "ideogram"  # Ideogram color_palette {members: [{rgb: {r, g, b}, color_weight}]}
    if spec.get("type") == "array":
        item = spec.get("itemSchema") or (spec.get("items") if isinstance(spec.get("items"), dict) else {}) or {}
        if {"r", "g", "b"} <= set(item):
            return "rgb-object"  # Recraft on fal: [{r, g, b}]
        if "rgb" in (item.get("fields") or item):
            return "rgb-array"  # [{rgb: [r, g, b]}]
        if spec.get("items") == "string":
            return "hex"
    return None


def voice_list(spec):
    """Premade voices from a voice field's enum (Inworld "Loretta (en)") or documented examples (MiniMax "Wise_Woman")."""
    vals = (spec or {}).get("values") or (spec or {}).get("examples") or []
    out = []
    for v in vals:
        if not isinstance(v, str):
            continue
        m_ = re.match(r"^(.*?)\s*\(([^)]+)\)$", v)
        if m_:  # "Loretta (en)"
            out.append({"id": v, "name": m_.group(1), "hint": m_.group(2)})
        elif re.fullmatch(r"[a-z]+(_[a-z]+)+", v):  # Seed's "vivi_mixed_en_zh_ja_es_id": a name, then its languages
            name, *langs = v.split("_")
            out.append({"id": v, "name": name.capitalize(), "hint": " · ".join(x for x in langs if x != "mixed")})
        else:  # MiniMax's "Wise_Woman"
            out.append({"id": v, "name": v.replace("_", " ")})
    return out


def time_field(key, spec):
    """FieldMap DurationField for a time in seconds (start/end of a trim, an audio offset)."""
    t = "number" if (spec or {}).get("type") in ("number", "integer") else "string"
    return {"key": key, "type": t, **({"multiplier": 1000} if key.endswith("_ms") else {})}


def add_slider(opts, param, label, spec, step=None):
    if not spec or "minimum" not in spec or "maximum" not in spec or any(s["param"] == param for s in opts.get("sliders", [])):
        return
    lo, hi = spec["minimum"], spec["maximum"]
    # Narrow ranges (Topaz grain 0-0.1) get a step that still gives them about twenty stops; a model line can name its own
    # (MOSS-Image's guidance in halves, so 2.5, the GPU's Standard CFG, is one of them).
    step = step or (1 if hi - lo > 4 else 0.05 if hi - lo > 0.2 else round((hi - lo) / 20, 4))
    opts.setdefault("sliders", []).append({"param": param, "label": label, "min": lo, "max": hi, "step": step,
                                           "default": spec.get("default", lo)})


def is_sentinel(v, default):
    """An enum value that means "let the API decide": the composer's own Auto option already sends nothing."""
    s = str(v).strip().lower()
    return s == "auto" or (s == "none" and str(default).strip().lower() == "none")


def add_control(opts, param, label, spec, fallback=None, labels=None):
    """fallback: what Fuobe sends when the control is left on Auto (a FieldMap default), shown as the control's default.
    labels: names for values that read badly, only for values the enum has."""
    default = fallback if fallback is not None else (spec or {}).get("default")
    vals = [v for v in ((spec or {}).get("values") or []) if v != "" and not is_sentinel(v, default)]
    if not vals or any(c["param"] == param for c in opts.get("controls", [])):
        return
    keep = default is not None and not is_sentinel(default, default)
    named = {str(k): v for k, v in (labels or {}).items() if k in vals}
    opts.setdefault("controls", []).append({"param": param, "label": label, "values": vals, **({"default": default} if keep else {}),
                                            **({"labels": named} if named else {})})


def map_fields(fmap):
    """Every top-level provider field a FieldMap can write (canonical keys, fixed and default fields)."""
    out = []
    for k, v in fmap.items():
        if k in ("fixed", "defaults"):
            out += list(v)
        elif k == "loras":
            out += lora_field_names(v)
        elif k == "size":
            out += [v["key"]] if v.get("key") else [v["width"], v["height"]]
        elif k in ("seedRange", "maskFormat", "ranges", "ignore", "maxImages", "omitEmptyPrompt"):
            continue
        elif isinstance(v, str):
            out.append(v)
        elif isinstance(v, dict):
            out += [v[f] for f in ("key", "background", "shotType", "flag", "factor", "x", "y") if isinstance(v.get(f), str)]
            # Ken Burns: the zoom direction and easing are fields of their own.
            out += [v[f]["key"] for f in ("direction", "easing") if isinstance(v.get(f), dict) and isinstance(v[f].get("key"), str)]
    return [f.split(".")[0] for f in out]


def lora_field_names(f):
    """The payload fields a FieldMap.loras writes."""
    if f["shape"] == "items":
        return [f["key"]]
    if f["shape"] == "arrays":
        return [f["weights"], f["scales"]]
    if f["shape"] == "single":
        return [f["weights"], f["scale"]]
    return [f[x][y] for x in ("high", "low") for y in ("weights", "scale")]


def scale_range(spec):
    lo, hi = num((spec or {}).get("minimum")), num((spec or {}).get("maximum"))
    return {"min": lo, "max": hi} if lo is not None and hi is not None else None


def lora_field(provider, ep):
    """FieldMap.loras for an endpoint that takes LoRAs, from its research inputs and its hostedLoraEndpoints record."""
    inputs = (EPS.get((provider, ep)) or {}).get("inputs") or {}
    summary = (HOSTED_LORA.get((provider, ep)) or {}).get("lora") or {}
    if provider == "replicate":
        expert = ("lora_weights_transformer", "lora_scale_transformer", "lora_weights_transformer_2", "lora_scale_transformer_2")
        if set(expert) <= set(inputs):
            f = {"shape": "experts", "high": {"weights": expert[0], "scale": expert[1]}, "low": {"weights": expert[2], "scale": expert[3]}}
            rng = scale_range(inputs[expert[1]])
        elif (inputs.get("lora_weights") or {}).get("type") == "array" and "lora_scales" in inputs:
            f = {"shape": "arrays", "weights": "lora_weights", "scales": "lora_scales"}
            rng = None
        elif "lora_weights" in inputs and "lora_scale" in inputs:
            f = {"shape": "single", "weights": "lora_weights", "scale": "lora_scale"}
            rng = scale_range(inputs["lora_scale"])
        else:
            return None
        if rng:
            f["range"] = rng
        return f
    key = summary.get("field") or "loras"
    spec = inputs.get(key)
    if not spec or spec.get("type") != "array":
        return None
    item = spec.get("itemSchema") or {}
    f = {"shape": "items", "key": key}
    mx = summary.get("maxCount") if isinstance(summary.get("maxCount"), int) else num((re.search(r"maximum (\d+)", spec.get("desc") or "") or [None, None])[1]) or num(spec.get("maxItems"))
    if mx:
        f["max"] = mx
    if spec.get("required") or summary.get("required"):
        f["required"] = True
    rng = scale_range(item.get("scale"))
    if rng:
        f["range"] = rng
    if item.get("transformer"):
        f["transformer"] = item["transformer"].get("default") or "both"
    if "weight_name" in item:
        f["weightName"] = True
    return f


def mask_format(ep):
    """Ideogram paints black = change; OpenAI's GPT Image uses transparent = change; others white."""
    return "black" if "ideogram" in ep else "alpha" if ("gpt-image" in ep or ep.startswith("openai/")) else None


def enum_of(inputs, key):
    return [v for v in ((inputs.get(key) or {}).get("values") or [])]


# Operations research part 4 added (their numeric fields get FieldMap.ranges).
ROUND4_OPS = ("remove-object", "video-swap", "video-insert", "keyframes", "sdr-to-hdr", "export-video", "ocr", "still-motion", "audio-loop",
              "audio-join", "scene-3d", "splat", "text-to-3d", "rig-3d", "extract-frames", "images-to-video", "overlay", "camera-path")


def part4_slots(op, kf, inputs, m, opts, fmap):
    """Research part 4 slots, each read only for the operations it belongs to (parts 2-3 use some of the same
    names: Qwen angles' "zoom", Luma's and Runway's "keyframes")."""
    if "points" in kf and op in ("remove-object", "video-swap", "video-insert", "bg-remove-video", "image-to-3d"):
        spec = inputs.get(kf["points"]) or {}
        item = spec.get("itemSchema") or {}
        fmt = "bria" if spec.get("items") == "string" else "sam" if "label" in item else None
        if fmt:
            fmap["points"] = {"key": kf["points"], "format": fmt}
        else:
            warn(f"{m['id']}: {kf['points']} has an unknown point shape")
    if "keyframes" in kf and op == "keyframes":
        spec = inputs.get(kf["keyframes"]) or {}
        item = spec.get("itemSchema") or {}
        image = next((k for k in item if k.endswith("url")), None)
        frame = next((k for k in item if "frame" in k), None)
        # "Frame position of this keyframe in the generated 24 fps video."
        fps = num((re.search(r"(\d+)\s*fps", (item.get(frame) or {}).get("desc") or "") or [None, None])[1]) if frame else None
        if image and frame and fps:
            fmap["keyframes"] = {"key": kf["keyframes"], "image": image, "frame": frame, "fps": fps}
            opts["maxImages"] = max(opts.get("maxImages", 1), num(spec.get("maxItems")) or 1)
        else:
            warn(f"{m['id']}: can't read the keyframe shape of {kf['keyframes']}")
    if m.get("formats") and op in ("sdr-to-hdr", "export-video"):
        key = kf.get("outputFormat") or kf.get("codec")
        enum = enum_of(inputs, key) if key else []
        bad = [v for v in m["formats"].values() if v not in enum]
        if key and not bad:
            fmap["format"] = {"key": key, "values": dict(m["formats"])}
            opts["formats"] = union(opts.get("formats", []), list(m["formats"]))
        else:
            warn(f"{m['id']}: format values {bad or list(m['formats'].values())} not in its output-format enum")
    if "crossfade" in kf and op in ("audio-loop", "audio-join"):
        fmap["crossfade"] = kf["crossfade"]
    if "trajectory" in kf and op == "camera-path":
        camera_path_slot(kf, inputs, m, fmap)
    if "zoom" in kf and op == "still-motion":
        z = {"factor": kf["zoom"]}
        # The furthest it zooms (fal: 2x); a steeper move is sent at that.
        if num((inputs.get(kf["zoom"]) or {}).get("maximum")):
            z["max"] = num(inputs[kf["zoom"]]["maximum"])
        d = kf.get("zoomDirection")
        vals = enum_of(inputs, d) if d else []
        zin, zout = (next((v for v in vals if str(v).lower() == w), None) for w in ("in", "out"))
        if zin and zout:
            z["direction"] = {"key": d, "in": zin, "out": zout}
        if "zoomX" in kf and "zoomY" in kf:
            z["x"], z["y"] = kf["zoomX"], kf["zoomY"]
            if num((inputs.get(kf["zoomX"]) or {}).get("maximum")) == 100:
                z["percent"] = True
        # Fuobe's easing names ("ease-in-out") against the API's ("ease_in_out").
        ease = {c: v for v in enum_of(inputs, kf.get("easing")) for c in ("linear", "ease-in-out") if str(v).replace("_", "-") == c}
        if ease:
            z["easing"] = {"key": kf["easing"], "values": ease}
        fmap["zoom"] = z
    if op == "overlay":
        if "x" in kf and "y" in kf:
            pct = num((inputs.get(kf["x"]) or {}).get("maximum")) == 100
            fmap["position"] = {"x": kf["x"], "y": kf["y"], **({"percent": True} if pct else {})}
        if "scale" in kf:
            # "Scale of overlay image as percentage (25-200)": Fuobe's scale 1 = 100%.
            pct = (num((inputs.get(kf["scale"]) or {}).get("maximum")) or 0) > 10
            fmap["scale"] = {"key": kf["scale"], **({"multiplier": 100} if pct else {})}
    if op == "interpolate":
        if "slowdown" in kf:
            fmap["slowdown"] = kf["slowdown"]
        if "targetFps" in kf:
            fmap["targetFps"] = kf["targetFps"]
    if "frameInterval" in kf and op == "extract-frames":
        fmap["frameInterval"] = kf["frameInterval"]
    if "colormap" in kf and op == "depth-video":
        fmap["colormap"] = kf["colormap"]
        # The picker offers the API's own maps (Higgsfield's Depth Map: Grayscale, Turbo, Inferno, Magma, Viridis).
        opts["colormaps"] = union(opts.get("colormaps", []), [str(v) for v in enum_of(inputs, kf["colormap"])])
    # Depth maps beside the original clip, and Remove background's alpha mask (Higgsfield's Video tools options).
    if "sideBySide" in kf and op == "depth-video" and (inputs.get(kf["sideBySide"]) or {}).get("type") == "boolean":
        fmap["sideBySide"] = kf["sideBySide"]
        opts["sideBySide"] = True
    if "maskOutput" in kf and op == "bg-remove-video" and (inputs.get(kf["maskOutput"]) or {}).get("type") == "boolean":
        fmap["matteOutput"] = {"key": kf["maskOutput"], "values": {"cutout": False, "matte": True}}
        opts["matteOutputs"] = ["cutout", "matte"]
    if "frames" in kf and op == "images-to-video":
        item = (inputs.get(kf["frames"]) or {}).get("itemSchema") or {}
        url, frames = next((k for k in item if "url" in k), None), next((k for k in item if "frame" in k), None)
        if url and frames:
            fmap["frames"] = {"key": kf["frames"], "url": url, "frames": frames}
            opts["maxImages"] = max(opts.get("maxImages", 1), num((inputs.get(kf["frames"]) or {}).get("maxItems")) or 1)
    if op == "rig-3d":
        if "model3d" in kf:
            fmap["model3d"] = kf["model3d"]
        if "animation" in kf:
            flag = next((k for k, v in inputs.items() if k.startswith("enable_") and "animation" in k and (v or {}).get("type") == "boolean"), None)
            fmap["animation"] = {"key": kf["animation"], **({"flag": flag} if flag else {})}
    # Routes that render only as many frames as asked (LTX 2.3 clean plate / HDR: "Output duration is num_frames /
    # frames_per_second"; VOID's window): the frame count follows the clip's length. VACE matches the input itself.
    if "numFrames" in kf and op in ("remove-object", "sdr-to-hdr", "video-swap", "video-insert") and "match_input_num_frames" not in inputs:
        spec = inputs.get(kf["numFrames"]) or {}
        fps_spec = inputs.get(kf.get("fps", "")) or {}
        # VOID has no frame-rate field: its frame budget is read at 24 fps ("about 8 s at 24 fps", research part 4).
        fps = num(fps_spec.get("default")) or 24
        fmap["numFrames"] = {"key": kf["numFrames"], "fps": fps,
                             **{k: num(spec[f]) for k, f in (("min", "minimum"), ("max", "maximum")) if num(spec.get(f)) is not None}}


def part4_ranges(op, inputs, fmap):
    """The API's limits on the numbers Fuobe fills for the round-4 tools (FieldMap.ranges): rounded and kept inside them."""
    fields = [fmap.get(k) for k in ("targetFps", "slowdown", "frameInterval", "crossfade")]
    fields += [(fmap.get(k) or {}).get(f) for k, f in (("scale", "key"), ("position", "x"), ("position", "y"), ("zoom", "x"), ("zoom", "y"), ("animation", "key"))]
    if op in ROUND4_OPS:
        fields += [fmap.get("fps"), (fmap.get("duration") or {}).get("key")]
    ranges = {}
    for f in fields:
        spec = inputs.get(f) if isinstance(f, str) else None
        if not spec or spec.get("type") not in ("integer", "number"):
            continue
        lo, hi = num(spec.get("minimum")), num(spec.get("maximum"))
        # Meshy states its preset range in words: "it must be in [0, 696]".
        stated = re.search(r"\[(\d+),\s*(\d+)\]", spec.get("desc") or "")
        if lo is None and hi is None and stated:
            lo, hi = num(stated[1]), num(stated[2])
        r = {**({"min": lo} if lo is not None else {}), **({"max": hi} if hi is not None else {}), **({"integer": True} if spec["type"] == "integer" else {})}
        if r:
            ranges[f] = r
    if ranges:
        fmap["ranges"] = ranges


def camera_path_slot(kf, inputs, m, fmap):
    """A camera path (build plan N7-5: H3 Max camera-controls): FieldMap.cameraPath from the trajectory field's schema,
    keyframes {time, azimuth, elevation, distance} (the item fields must carry those names), their count, the height's
    limits and the most turns its description allows; plus the endpoint's fixed moves (free_camera_preset) when it has them."""
    spec = inputs.get(kf["trajectory"]) or {}
    item = spec.get("itemSchema") or {}
    if spec.get("type") != "array" or not {"time", "azimuth", "elevation", "distance"} <= set(item):
        warn(f"{m['id']}: {kf['trajectory']} is not a list of {{time, azimuth, elevation, distance}} keyframes")
        return
    el = item["elevation"]
    turns = re.search(r"at most (\d+) turns", spec.get("desc") or "")
    f = {"key": kf["trajectory"], "min": int(spec.get("minItems") or 2), "max": int(spec.get("maxItems") or 12),
         "elevation": [num(el.get("minimum")) if num(el.get("minimum")) is not None else -90, num(el.get("maximum")) if num(el.get("maximum")) is not None else 90],
         "maxTurns": int(turns[1]) if turns else 32}
    free = kf.get("freeCamera")
    values = enum_of(inputs, free) if free else []
    if values:
        f["free"] = {"key": free, "values": [v for v in values if isinstance(v, str)]}
    fmap["cameraPath"] = f



def build_route(op, ep, provider, m, opts, ropts=None):
    ropts = ropts or {}
    # A Replicate model run by version ("owner/name:<version>") is researched under its name.
    if ropts.get("pin"):
        version = (HOSTED_LORA.get((provider, ep)) or {}).get("version")
        if not version:
            warn(f"{m['id']}: {ep} has no researched version to pin")
            return None
    e = EPS.get((provider, ep))
    if not e:
        warn(f"{m['id']}: endpoint {provider}:{ep} not in research")
        return None
    if not e.get("verified"):
        warn(f"{m['id']}: {ep} is not verified")
    inputs = e.get("inputs") or {}
    kf = dict(e.get("keyFields") or {})
    # A route can point a slot at another field of the same schema (VACE's first-frame mask is mask_image_url)…
    for k, f in (ropts.get("keys") or {}).items():
        if f.split(".")[0] not in inputs:
            warn(f"{m['id']}: {ep} has no field {f} for {k}")
            continue
        kf[k] = f
    # …or ignore key fields whose meaning doesn't fit Fuobe's slot (e.g. Ideogram edit's style refs).
    for k in ropts.get("drop") or []:
        kf.pop(k, None)
    # Part 3 slot names that are the same canonical input: the person in a try-on is the main image,
    # style references are the reference images, a garment / scene / style image is the second image.
    labels = [None, None]
    if "person" in kf and "image" not in kf:
        kf["image"] = kf.pop("person")
        labels[0] = "person photo"
    if "styleImages" in kf and "images" not in kf and (inputs.get(kf["styleImages"]) or {}).get("type") == "array":
        kf["images"] = kf["styleImages"]
    for k, label in (("garment", "garment"), ("sceneImage", "scene reference"), ("styleImage", "style image")):
        if k in kf and "image2" not in kf and (inputs.get(kf[k]) or {}).get("type") != "array":
            kf["image2"] = kf[k]
            labels[1] = label
    # An overlay goes on a picture (a logo on an end card).
    if op == "overlay":
        labels = ["picture", "logo or overlay"]
    # Two-image APIs whose second image is required (try-on garments) can't run on one picture.
    if "image2" in kf and (inputs.get(kf["image2"]) or {}).get("required") and (inputs.get(kf.get("image", "")) or {}).get("required"):
        opts["minImages"] = 2
        opts["imageLabels"] = [labels[0] or "image", labels[1] or "second image"]
    # Transcription and stem splitting work from the audio; ignore any prompt-like hint field.
    if op in ("transcribe", "separate-audio"):
        kf.pop("prompt", None)
    fmap = {}
    # Prompt
    if "prompt" in kf:
        if kf["prompt"] != "prompt":
            fmap["prompt"] = kf["prompt"]
    else:
        fmap["prompt"] = False
    # Relight endpoints take the lighting description as the prompt.
    if "lightingPrompt" in kf:
        fmap["prompt"] = kf["lightingPrompt"]
    # Erasers that build their own mask from words (VOID's mask_prompt) take Fuobe's prompt, which names
    # what to remove or replace; their own prompt (the scene afterwards) comes from api_defaults or params.extra.
    if "maskPrompt" in kf and op in ("remove-object", "video-swap", "video-insert"):
        fmap["prompt"] = kf["maskPrompt"]
    # Swaps whose references say what goes in may also take words (P-Video Replace's instruction): optional.
    elif op in ("video-swap", "video-insert") and "prompt" in kf and not (inputs.get(kf["prompt"]) or {}).get("required"):
        opts["promptOptional"] = True
    # A model that runs without words leaves an empty prompt out where the API's prompt is optional
    # (Bria Expand: "Omit it and the model is asked only to extend the image").
    pkey = fmap.get("prompt", "prompt" if "prompt" in kf else None)
    if pkey and (m["options"].get("promptOptional") or (op in ("video-swap", "video-insert") and opts.get("promptOptional"))) \
            and not (inputs.get(pkey.split(".")[0]) or {}).get("required"):
        fmap["omitEmptyPrompt"] = True
    # Zero-shot TTS takes its reference voice in the "audio" field; voice conversion names it separately.
    if op == "tts" and "audio" in kf:
        kf["referenceVoice"] = kf.pop("audio")
    if "referenceVoice" in kf and (inputs.get(kf["referenceVoice"]) or {}).get("type") != "array":
        fmap["voiceAudio"] = kf["referenceVoice"]
        opts["voiceClone"] = True
    if "voice" in kf and "[]" not in kf["voice"]:
        fmap["voice"] = kf["voice"]
    if "voice" in kf and "elevenlabs" in ep:
        opts["voices"] = ELEVEN_VOICES
    elif "voice" in kf and "voices" not in opts and voice_list(spec_at(inputs, kf["voice"])):
        opts["voices"] = voice_list(spec_at(inputs, kf["voice"]))
    if "dialogue" in kf:
        fmap["dialogue"] = {"key": kf["dialogue"], "text": "text", "voice": "voice"}
    if "targetLanguage" in kf:
        fmap["targetLanguage"] = kf["targetLanguage"]
        enum = (inputs.get(kf["targetLanguage"]) or {}).get("values")
        opts["languages"] = enum or ISO_LANGUAGES
    # The model's own slider/control labels win over the generic voice-setting labels below.
    for path, label, *step in m.get("sliders") or []:
        add_slider(opts, path, label, spec_at(inputs, path), step[0] if step else None)
    for path, label, *labels in m.get("controls") or []:
        add_control(opts, path, label, spec_at(inputs, path), (m.get("api_defaults") or {}).get(path), labels[0] if labels else None)
    for k, v in inputs.items():
        # Voice settings belong to speech models; a transcriber's "temperature" is not a voice's variety.
        if k in SLIDER_LABELS and isinstance(v, dict) and (op in ("tts", "voice-change", "dialogue") or k == "strength"):
            # "strength" is a voice setting on speech models only (Topaz's is the enhancement strength).
            add_slider(opts, k, "Strength" if k == "strength" and m["kind"] != "audio" else SLIDER_LABELS[k], v)
    # Some APIs call their boolean sound switch "audio" (Wan 3.0); that's generateAudio, not an audio file.
    if "audio" in kf and (inputs.get(kf["audio"]) or {}).get("type") == "boolean":
        kf.setdefault("generateAudio", kf.pop("audio"))
    # Part 3 names for clip lists (merge-videos' video_urls, Seed Audio's reference audio_urls).
    for k in ("videos", "audios"):
        if k in kf and (inputs.get(kf[k]) or {}).get("type") == "array":
            kf.setdefault(k[:-1], kf.pop(k))
    for k in ["negativePrompt", "image", "images", "endImage", "mask", "video", "audio", "numOutputs", "seed", "generateAudio"]:
        if k in kf:
            if k in ("video", "audio", "image", "endImage", "mask") and (inputs.get(kf[k]) or {}).get("type") == "array":
                if k == "video" and ropts.get("videoArray"):
                    fmap["videoArray"] = kf[k]
                elif k in ("video", "audio"):
                    # Lists of clips: reference videos / audio for reference-to-video (Seedance @Video1, @Audio1),
                    # fed from inputs.videos / inputs.audios.
                    fmap[k + "s"] = kf[k]
                    spec = inputs.get(kf[k]) or {}
                    cap = num(spec.get("maxItems")) or num((re.search(r"\bup to (\d+)", spec.get("desc") or "", re.I) or [None, None])[1]) or 3
                    key = "maxVideos" if k == "video" else "maxAudios"
                    opts[key] = max(opts.get(key, 0), cap)
                continue
            fmap[k] = kf[k]
    # A loop by repetition (fal merge-audios): the one clip, listed as many times as the length needs.
    if op == "audio-loop" and "audios" in fmap:
        fmap["loop"] = {"key": fmap.pop("audios"), "max": num((inputs.get(kf["audio"]) or {}).get("maxItems")) or 2}
    # Multi-shot, draft mode and draft completion (research part 2 key fields).
    if "multiShot" in kf and op in ("t2v", "i2v", "ref2v") and (inputs.get(kf["multiShot"]) or {}).get("type") in ("array", "string"):
        item = (inputs.get(kf["multiShot"]) or {}).get("itemSchema") or {}
        dtype = "string" if (item.get("duration") or {}).get("valueType") == "string" else "number"
        ms = {"key": kf["multiShot"], "durationType": dtype}
        if (inputs.get(kf["multiShot"]) or {}).get("type") == "string":
            ms["json"] = True
        if "shotType" in kf:
            ms["shotType"] = kf["shotType"]
        fmap["multiShot"] = ms
        opts["multiShot"] = {"mode": "native", "maxShots": 6}
    if "draft" in kf and op in ("t2v", "i2v", "ref2v"):
        fmap["draft"] = kf["draft"]
        opts["draft"] = True
    if "draftId" in kf:
        fmap["draftId"] = kf["draftId"]
    # Frame interpolation's "fps" is the frame rate to reach (params.targetFps), not a sampling rate.
    if op == "interpolate" and "fps" in kf:
        kf["targetFps"] = kf.pop("fps")
    # Research part 3 slots.
    if "image2" in kf:
        fmap["image2"] = kf["image2"]
    for k in ("startTime", "endTime"):
        if k in kf:
            fmap[k] = time_field(kf[k], inputs.get(kf[k]))
    if "fps" in kf:
        fmap["fps"] = kf["fps"]
    if "styleId" in kf:
        fmap["styleId"] = kf["styleId"]
    if "numLayers" in kf:
        fmap["numLayers"] = kf["numLayers"]
    # Video models whose length is a frame count (Wan 2.2 num_frames at 16 fps, LTX-2.3 at 24): the duration picked
    # becomes frames (FieldMap.numFrames, 4n+1 / 8n+1 by model), and the durations offered are the ones that fit.
    nf = kf.get("numFrames") or (kf.get("duration") if kf.get("duration") in ("num_frames", "frames") else None)
    # A talking avatar's frame count (fal's InfiniteTalk, Wan 2.2 S2V) follows the voice's length (params.sourceDuration).
    if nf and op in ("t2v", "i2v", "flf2v", "extend", "v2v", "avatar") and (inputs.get(nf) or {}).get("type") == "integer":
        kf.pop("duration", None)
        kf.pop("numFrames", None)
        spec = inputs.get(nf) or {}
        fps_key = kf.get("fps") or next((k for k in ("fps", "frames_per_second") if k in inputs), None)
        fps = m.get("frame_fps") or num((inputs.get(fps_key) or {}).get("default")) or 16
        lo, hi = num(spec.get("minimum")), num(spec.get("maximum"))
        # Extend's num_frames is the length to add (the picked duration), never the input clip's own length.
        fmap["numFrames"] = {"key": nf, "fps": fps, **({"min": lo} if lo is not None else {}), **({"max": hi} if hi is not None else {}),
                             **({"step": m["frame_step"]} if m.get("frame_step") else {}), **({"multiple": m["frame_multiple"]} if m.get("frame_multiple") else {}),
                             **({"fromDuration": True} if op == "extend" else {})}
        if op != "avatar":
            opts["durations"] = union(opts.get("durations", []), [d for d in NICE_DURATIONS if (lo is None or d * fps >= lo) and (hi is None or d * fps <= hi + (m.get("frame_step") or 0))])
    # Width and height fields (Replicate's Z-Image LoRA model): computed from the aspect ratio (FieldMap.size).
    if "width" in kf and "height" in kf and "aspectRatio" not in kf:
        w, h = inputs.get(kf["width"]) or {}, inputs.get(kf["height"]) or {}
        mx = [x for x in (num(w.get("maximum")), num(h.get("maximum"))) if x is not None]
        fmap["size"] = {"width": kf["width"], "height": kf["height"], "multiple": 16, **({"max": min(mx)} if mx else {}),
                        **({"base": num(w.get("default"))} if num(w.get("default")) else {})}
        opts["aspectRatios"] = union(opts.get("aspectRatios", []), IMG_AR)
    # Exact sizes per tier (Fuobe Soul's table): one {width, height} object field (fal's image_size, whose union takes
    # an object) or the width / height fields above; the tiers are the model's resolutions.
    if m.get("sizes") and not ropts.get("keepSize"):
        spec = inputs.get(kf.get("aspectRatio") or "image_size") or {}
        takes_object = spec.get("type") == "union" and any((v == "object{width,height}") or (isinstance(v, dict) and v.get("type") == "object") for v in spec.get("variants") or [])
        if "size" in fmap:
            fmap["size"]["table"] = m["sizes"]
        elif takes_object:
            fmap["size"] = {"key": kf.get("aspectRatio") or "image_size", "multiple": 16, "table": m["sizes"]}
            kf.pop("aspectRatio", None)
        else:
            warn(f"{m['id']}: {ep} takes neither width / height nor an image_size object for its size table")
        opts["aspectRatios"] = union(opts.get("aspectRatios", []), list(next(iter(m["sizes"].values())).keys()))
        opts["resolutions"] = union(opts.get("resolutions", []), list(m["sizes"].keys()))
    elif ropts.get("keepSize"):
        # The result keeps the input picture's shape (image_size "auto", the API's default).
        kf.pop("aspectRatio", None)
    elif m.get("exact_size"):
        # One {width, height} object the API rounds and clamps itself: the aspect ratio's size within the grid and limits
        # its description states (FieldMap.size.min / max), the same size a layout is compiled for.
        key = kf.get("aspectRatio") or "image_size"
        spec = inputs.get(key) or {}
        takes_object = spec.get("type") == "union" and any(isinstance(v, dict) and v.get("type") == "object" for v in spec.get("variants") or [])
        lim = re.search(r"multiples? of (\d+) between (\d+) and (\d+)", spec.get("desc") or "")
        if takes_object and lim:
            fmap["size"] = {"key": key, "multiple": int(lim.group(1)), "min": int(lim.group(2)), "max": int(lim.group(3))}
            kf.pop("aspectRatio", None)
            opts["aspectRatios"] = union(opts.get("aspectRatios", []), IMG_AR)
        else:
            warn(f"{m['id']}: {ep} states no size grid and limits for its {key} object")
    part4_slots(op, kf, inputs, m, opts, fmap)
    # Frame rates an upscaler (or FPS Boost) can reach: params.targetFps -> its target_fps field.
    if m.get("fps_targets") and op in ("interpolate", "upscale-video"):
        key = fmap.get("targetFps") or ("target_fps" if "target_fps" in inputs else None)
        spec = inputs.get(key) or {}
        lo, hi = num(spec.get("minimum")), num(spec.get("maximum"))
        bad = [v for v in m["fps_targets"] if (lo is not None and v < lo) or (hi is not None and v > hi)]
        if key and not bad:
            fmap["targetFps"] = key
            opts["fpsTargets"] = union(opts.get("fpsTargets", []), m["fps_targets"])
        else:
            warn(f"{m['id']}: frame rates {bad or m['fps_targets']} don't fit {ep}'s target_fps")
    # Upscalers that take a factor: the resolution tier becomes target / the clip's shorter edge.
    if m.get("upscale_tiers") and op == "upscale-video":
        spec = inputs.get("upscale_factor") or {}
        if spec.get("type") in ("number", "integer"):
            fmap["upscaleFactor"] = {"key": "upscale_factor", **{k: num(spec[f]) for k, f in (("min", "minimum"), ("max", "maximum")) if num(spec.get(f)) is not None}}
            opts["resolutions"] = union(opts.get("resolutions", []), m["upscale_tiers"])
        else:
            warn(f"{m['id']}: {ep} has no numeric upscale_factor for its tiers")
    # fal compose: the timeline's tracks are built from the clips and their start times (FieldMap.timeline).
    if "tracks" in kf and op == "timeline":
        fmap["timeline"] = kf["tracks"]
    if "palette" in kf:
        fmt = palette_format(inputs.get(kf["palette"]))
        if fmt:
            fmap["palette"] = {"key": kf["palette"], "format": fmt}
            bg = kf.get("backgroundColor")
            if bg and {"r", "g", "b"} <= set((inputs.get(bg) or {}).get("fields") or {}):
                fmap["palette"]["background"] = bg
        else:
            warn(f"{m['id']}: {ep} palette field {kf['palette']} has an unknown shape")
    # The language of the speech: transcription, captions and dubbing take it as their "language".
    src_lang = kf.get("sourceLanguage") or (kf.get("language") if op in ("transcribe", "captions", "dub") else None)
    if src_lang:
        enum = [v for v in ((inputs.get(src_lang) or {}).get("values") or []) if isinstance(v, str) and v]
        # An API with its own list (VEED's "es-ES", Wizper's "es") gets the matching entry; the picker offers ISO codes.
        fmap["sourceLanguage"] = {"key": src_lang, "values": enum} if enum else src_lang
        codes = union([], [v.split("-")[0].lower() for v in enum if re.fullmatch(r"[a-z]{2,3}", v.split("-")[0].lower())]) if enum else ISO_LANGUAGES
        opts["sourceLanguages"] = union(opts.get("sourceLanguages", []), codes)
    # Transcribers take a video file in their audio field too.
    if op == "transcribe" and "audio" in kf and "video" not in kf:
        fmap["video"] = kf["audio"]
    # LTX/others sometimes have image key named differently but keyFields covers it.
    if "negativePrompt" in fmap:
        opts["negativePrompt"] = True
    if "seed" in fmap:
        opts["seed"] = True
    if "endImage" in fmap:
        opts["endFrame"] = True
    if "generateAudio" in fmap:
        opts["audio"] = True
    # Aspect ratio
    if "aspectRatio" in kf:
        key = kf["aspectRatio"]
        spec = inputs.get(key, {})
        enum = spec.get("values") or spec.get("enumValues") or []
        if not enum and spec.get("type") == "union":
            # "enum or free string" unions (FLUX Ultra's aspect_ratio): offer the enum.
            enum = [v for var in spec.get("variants") or [] for v in (var.get("values") or [])]
        if key == "image_size" or any("landscape" in str(v) or "square" in str(v) for v in enum):
            # A model that asks for "auto" (Fuobe DoP · LTX: the start frame's shape) keeps it when the API takes it;
            # otherwise the default fallback below would make every clip square (1:1, the first size listed).
            auto = "auto" in enum and m["defaults"].get("aspectRatio") == "auto"
            # keep_shape: "auto" leaves a nullable size out, so the API keeps the input image's shape and size.
            keep = bool(m.get("keep_shape")) and not auto and bool(spec.get("nullable"))
            fmap["aspectRatio"] = {"key": key, "values": {**({"auto": "auto"} if auto else {}), **IMAGE_SIZE_MAP}, **({"accepts": IMG_AR} if keep else {})}
            opts["aspectRatios"] = union(opts.get("aspectRatios", []), (["auto"] if auto else []) + IMG_AR + (["auto"] if keep else []))
        else:
            fmap["aspectRatio"] = key
            ratios = [v for v in enum if RATIO.match(str(v)) or v == "auto"]
            if not ratios and spec.get("type") == "string":
                ratios = ["16:9", "9:16", "1:1"] if m["kind"] == "video" else IMG_AR
            elif m.get("fit_values") and ratios:
                fmap["aspectRatio"] = {"key": key, "accepts": ratios}
            opts["aspectRatios"] = union(opts.get("aspectRatios", []), ratios)
    # Resolution
    if "resolution" in kf:
        key = kf["resolution"]
        fmap["resolution"] = key
        enum = (inputs.get(key) or {}).get("values") or []
        if enum and (inputs.get(key) or {}).get("valueType") in ("integer", "number"):
            # Numeric tiers (TRELLIS 512/1024/1536) are picked as strings and sent as numbers.
            fmap["resolution"] = {"key": key, "values": {str(v): v for v in enum}}
        elif enum and m.get("fit_values"):
            fmap["resolution"] = {"key": key, "accepts": [str(v) for v in enum]}
        opts["resolutions"] = union(opts.get("resolutions", []), [str(v) for v in enum])
    # Duration
    if "duration" in kf:
        key = kf["duration"]
        spec = inputs.get(key) or {}
        enum = spec.get("values") or []
        if enum:
            sample = [str(v) for v in enum if str(v) != "auto"]
            suffix = "s" if sample and all(s.endswith("s") for s in sample) else None
            vals = [num(s[:-1] if suffix else s) for s in sample]
            vals = [v for v in vals if v is not None]
            dtype = "number" if spec.get("valueType") in ("integer", "number") else "string"
            fmap["duration"] = {"key": key, "type": dtype, **({"suffix": suffix} if suffix else {})}
            if len(vals) > 6:
                pick = [v for v in vals if v in (3, 4, 5, 6, 8, 10, 12, 15, 20, 30)] or vals[:6]
                # Keep the longest option: multi-shot budgets and the duration picker both need the real maximum.
                vals = pick[:6] + [pick[-1]] if len(pick) > 7 else pick
            opts["durations"] = union(opts.get("durations", []), vals)
        else:
            dtype = "number" if spec.get("type") in ("integer", "number") else "string"
            fmap["duration"] = {"key": key, "type": dtype}
            if str(spec.get("default", "")).endswith("s") and dtype == "string":
                fmap["duration"]["suffix"] = "s"
            lo, hi = num(spec.get("minimum")), num(spec.get("maximum"))
            if m.get("ranged_durations") and lo is not None and hi is not None:
                opts["durations"] = union(opts.get("durations", []), [v for v in NICE_DURATIONS if lo <= v <= hi] or [lo])
        if key.endswith("_ms"):
            fmap["duration"]["multiplier"] = 1000
    part4_ranges(op, inputs, fmap)
    # Text-to-speech etc. carry the prompt in "text".
    if ropts.get("fixed"):
        m = {**m, "fixed": {**m["fixed"], **ropts["fixed"]}}
    if m["fixed"]:
        fmap["fixed"] = {k: v for k, v in m["fixed"].items() if k.split(".")[0] in inputs}
        missing = [k for k in m["fixed"] if k.split(".")[0] not in inputs]
        if missing:
            warn(f"{m['id']}: fixed fields {missing} not in {ep} inputs")
        if not fmap["fixed"]:
            del fmap["fixed"]
    # A route's own fallbacks (VACE's background prompt applies to its erase route only).
    if ropts.get("defaults"):
        m = {**m, "api_defaults": {**m["api_defaults"], **ropts["defaults"]}}
    if m.get("api_defaults"):
        fmap["defaults"] = {k: v for k, v in m["api_defaults"].items() if k.split(".")[0] in inputs}
        missing = [k for k in m["api_defaults"] if k.split(".")[0] not in inputs]
        if missing:
            warn(f"{m['id']}: default fields {missing} not in {ep} inputs")
        if not fmap["defaults"]:
            del fmap["defaults"]
    # A model that reads layouts (ModelOptions.layout) turns the API's own prompt expansion off for a layout request
    # (FieldMap.promptExpansion), which would rewrite the boxes; a plain prompt keeps the API's default.
    if (m["options"] or {}).get("layout"):
        pe = kf.get("enhancePrompt") or ("enable_prompt_expansion" if "enable_prompt_expansion" in inputs else None)
        if pe and (inputs.get(pe) or {}).get("type") == "boolean":
            fmap["promptExpansion"] = pe
    # LoRAs (O1): the field the route's LoRA endpoint (or the endpoint itself) takes them in, from the research.
    # Read before the required-inputs check below: an endpoint whose LoRAs are required (MiniMax H3's /lora) fills them here.
    lora_ep = ropts.get("loraEndpoint")
    lf = lora_field(provider, lora_ep or ep)
    if lf:
        fmap["loras"] = lf
    elif lora_ep:
        warn(f"{m['id']}: LoRA endpoint {lora_ep} has no researched LoRA field")
    # Inputs the API requires that no canonical field fills: send the API's own documented default
    # (MiniMax H3 Max's prompt_expansion_mode), or warn when there is none to send.
    sent = set(map_fields(fmap)) | ({"prompt"} if "prompt" not in fmap else set())
    for k, spec in inputs.items():
        if not isinstance(spec, dict) or not spec.get("required") or k in sent:
            continue
        if spec.get("default") is not None:
            fmap.setdefault("defaults", {})[k] = spec["default"]
        else:
            warn(f"{m['id']}: {ep} requires {k}, which no field of this route fills")
    if "numOutputs" in fmap:
        mx = num((inputs.get(fmap["numOutputs"]) or {}).get("maximum")) or 4
        opts["maxOutputs"] = max(opts.get("maxOutputs", 1), min(4, mx))
    if "images" in fmap:
        mx = num((inputs.get(fmap["images"]) or {}).get("maxItems")) or None
        opts["maxImages"] = max(opts.get("maxImages", 1), mx or (10 if op == "edit" else 4))
        # A route that takes fewer than the model's other routes (stated in its docs, not its schema).
        if ropts.get("max_images"):
            fmap["maxImages"] = ropts["max_images"]
    elif "image" in fmap:
        opts["maxImages"] = max(opts.get("maxImages", 0), 2 if "image2" in fmap else 1)
    # Inpaint routes say what the mask's paint means (edit routes get theirs when the inpaint route is derived).
    if op == "inpaint" and "mask" in fmap and mask_format(ep):
        fmap["maskFormat"] = mask_format(ep)
    route = {"op": op, "provider": provider, "endpoint": f"{ep}:{version}" if ropts.get("pin") else ep, "map": fmap}
    if ropts.get("note"):
        route["note"] = ropts["note"]
    if lora_ep:
        le = EPS.get((provider, lora_ep))
        if not le:
            warn(f"{m['id']}: LoRA endpoint {lora_ep} not in research")
        else:
            # The same payload goes to both endpoints: every field the route sends must be one the LoRA endpoint takes.
            missing = [f for f in map_fields(fmap) if f not in (le.get("inputs") or {})]
            if missing:
                warn(f"{m['id']}: {lora_ep} has no {missing} (sent by {ep})")
        rec = HOSTED_LORA.get((provider, lora_ep)) or {}
        if rec.get("commercialWeights") is False:
            warn(f"{m['id']}: {lora_ep} runs non-commercial weights ({rec.get('baseLicence')}): never an Original's default")
        route["loraEndpoint"] = lora_ep
    return route, e


def parse_price(e):
    p = str(e.get("price") or "")
    m = re.search(r"\$(\d+(?:\.\d+)?)\s*(?:per|/)\s*(?:output\s+)?(image|images|second|seconds|video|videos|minute|minutes|megapixels|megapixel|"
                  r"generation|generations|request|requests|audios|audio file)\b", p)
    if not m:
        return None
    unit = {"images": "image", "seconds": "second", "minutes": "minute", "videos": "video", "megapixels": "megapixel", "generation": "request", "generations": "request",
            "requests": "request", "audios": "request", "audio file": "request"}.get(m.group(2), m.group(2))
    return {"unit": unit, "usd": float(m.group(1))}


out = []
originals = []
for m in M:
    opts = {}
    routes = []
    first_e = None
    for r in m["routes"]:
        op, ep = r[0], r[1]
        provider = r[2] if len(r) > 2 else "fal"
        ropts = r[3] if len(r) > 3 and isinstance(r[3], dict) else {}
        res = build_route(op, ep, provider, m, opts, ropts)
        if not res:
            continue
        route, e = res
        first_e = first_e or e
        routes.append(route)
        # Edit endpoints that take a mask also get a native inpaint route.
        if op == "edit":
            inputs = e.get("inputs") or {}
            # The mask belongs on the inpaint route only; plain edits never send one.
            mk = route["map"].pop("mask", None) or next((k for k in ("mask_url", "mask_image_url", "mask") if k in inputs and inputs[k].get("type") != "array"), None)
            if mk:
                fmt = mask_format(ep)
                routes.append({**route, "op": "inpaint", "map": {**route["map"], "mask": mk, **({"maskFormat": fmt} if fmt else {})}})
        # "+flf2v" (or the route option flf2v: True, beside others): the same endpoint as a start/end-frame route.
        if (len(r) > 3 and r[3] == "+flf2v" and not ropts) or ropts.get("flf2v"):
            if "endImage" in route["map"]:
                routes.append({**route, "op": "flf2v"})
            else:
                warn(f"{m['id']}: {ep} has no end frame field; skipping flf2v")
    if not routes:
        warn(f"{m['id']}: no routes, skipping model")
        continue
    # No route sends a prompt (try-on, 3D, transcription): planning and the composer don't ask for one.
    if all(r["map"].get("prompt") is False for r in routes):
        opts["promptless"] = True
    opts.update(m["options"])
    # A model-wide control or slider goes only to the routes whose schema has its field (Ideogram Vector's
    # quality is a text-to-vector setting; image-to-vector has none).
    offered = [c["param"] for c in opts.get("controls", [])] + [x["param"] for x in opts.get("sliders", [])]
    for route in routes:
        inputs = (EPS.get((route["provider"], route["endpoint"])) or {}).get("inputs") or {}
        missing = [x for x in offered if x.split(".")[0] not in inputs]
        if missing:
            route["map"] = {**route["map"], "ignore": missing}
    pricing = None
    if m["pricing"]:
        u, usd, *rest = m["pricing"]
        # Optional: a note, then extra Pricing fields (byResolution, factors, …).
        note = [x for x in rest if isinstance(x, str)]
        extra = next((x for x in rest if isinstance(x, dict)), {})
        pricing = {"unit": u, "usd": usd, **({"note": note[0]} if note else {}), **extra}
    elif first_e:
        pricing = parse_price(first_e)
    # What a run costs on the route's LoRA endpoint, when its price is in the same unit (fal's /lora variants cost more).
    lora_eps = [r["loraEndpoint"] for r in routes if r.get("loraEndpoint")]
    if pricing and lora_eps and "withLoras" not in pricing:
        le = EPS.get((routes[0]["provider"], lora_eps[0])) or {}
        lp = parse_price(le)
        if lp and lp["unit"] == pricing["unit"]:
            pricing["withLoras"] = lp["usd"]
        elif (le.get("pricing") or {}).get("unit") == "unknown":
            # No published price (fal's MOSS-Image /lora shows "$0 per compute second"): a run with LoRAs is priced as
            # unknown, never as free.
            pricing["lorasUnknown"] = True
    d = {
        "id": m["id"], "name": m["name"], "vendor": m["vendor"], "family": m["family"], "engine": "cloud",
        "kind": m["kind"], "tagline": m["tagline"], "routes": routes, "options": opts,
    }
    if m["badges"]:
        d["badges"] = m["badges"]
    # The open weights' licence, from the hosted LoRA endpoint the model runs on or with (hostedLoraEndpoints): data the
    # admin reads in Settings, never a gate (the owner's decision of 2026-10-27).
    lic = next((HOSTED_LORA[(r["provider"], ep)] for r in routes for ep in (r["endpoint"], r.get("loraEndpoint"))
                if ep and HOSTED_LORA.get((r["provider"], ep), {}).get("baseLicence")), None)
    if lic:
        d["licence"] = {"licence": lic["baseLicence"], "commercial": lic.get("commercialWeights"),
                        **({"note": lic["licenceNote"]} if lic.get("licenceNote") else {}),
                        **({"checked": lic["checked"]} if lic.get("checked") else {})}
    elif m["licence"]:
        d["licence"] = m["licence"]
    defaults = {k: v for k, v in m["defaults"].items()}
    # Drop defaults the model can't take.
    if "aspectRatio" in defaults and defaults["aspectRatio"] not in opts.get("aspectRatios", [defaults["aspectRatio"]]):
        defaults["aspectRatio"] = opts["aspectRatios"][0]
    if "resolution" in defaults and opts.get("resolutions") and defaults["resolution"] not in opts["resolutions"]:
        defaults["resolution"] = opts["resolutions"][0]
    if "duration" in defaults and opts.get("durations") and defaults["duration"] not in opts["durations"]:
        defaults["duration"] = opts["durations"][0]
    if opts.get("audio"):
        defaults.setdefault("generateAudio", True)
    if defaults:
        d["defaults"] = defaults
    if pricing:
        d["pricing"] = pricing
    if m["hidden"]:
        d["hidden"] = True
    (originals if m["original"] else out).append(d)

ts = (
    "// Generated by scripts/gen-cloud-models.py from docs/research/paid-model-apis(-2,-3,-4).json — do not edit by hand.\n"
    'import type { ModelDef } from "./types";\n\n'
    f"export const CLOUD_MODELS: ModelDef[] = {json.dumps(out, indent=2)};\n\n"
    "/** The Fuobe Originals' cloud halves (hosted open weights): models.ts joins each to its ComfyUI routes. */\n"
    f"export const ORIGINAL_CLOUD: ModelDef[] = {json.dumps(originals, indent=2)};\n"
)
(ROOT / "src/lib/catalog/cloud-models.generated.ts").write_text(ts)
print(f"wrote {len(out)} cloud models and {len(originals)} Originals' cloud halves")
