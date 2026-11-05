#!/usr/bin/env python3
"""
Generate src/lib/catalog/soul-originals.generated.ts: Fuobe Soul (build plan O2), the Soul recipe on open
weights. It holds the 139 looks, the prompt tails, the size table, the sampler settings and Soul Cinema's
fixed recipe. src/lib/catalog/soul.ts turns them into a run (prompt, LoRAs, size, grade) on both engines.

Sources:
- docs/research/fuobe-originals-recipes-5.json → soul (template tails, sizes, sampler, Soul Cinema) and
  presets[] (each look: its template, LoRAs at their strengths, grade, tail, base, overlay, train flag);
- docs/research/parity-image-studios.json → soulPresets[] (the look's family and its picker categories,
  which are generic words).

A look's id is Fuobe's own: "v1-general", "v2-y2k-studio" (family + the name as a slug), the id the
evaluation harness measures (scripts/eval/lib/recipes.mjs). The legacy style id survives only as
`legacyStyleId`, so a request or a saved moodboard pick from before can still be read; it is never sent
anywhere. No description, prompt or preview from the parity research is copied: the look sentence is the research's own
wording (the template), the categories are generic words.

Licences are information (the owner's decision of 2026-10-27; Settings → Models & licences has the switches): a
look whose LoRA is non-commercial or licensed for the user's GPU only, or that the research marks not
commercial-safe, is printed as a licence note, never a failure.

Fails (exit 1) when the research breaks the Soul recipe:
- a look's LoRA isn't in the LoRA library;
- a look lists more than 3 LoRAs (fal's Z-Image endpoint takes 3), or a LoRA for another base;
- a template that isn't "{prompt}. <look>. <tail>", or triggers that aren't its LoRAs' triggers;
- a grade that isn't a src/lib/grade.ts preset, a size off the 16-pixel grid or above 2048;
- duplicate ids, or not exactly 139 looks.

Run:  python3 scripts/gen-soul-originals.py
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECIPES = json.loads((ROOT / "docs/research/fuobe-originals-recipes-5.json").read_text(encoding="utf-8"))
LOOKS = json.loads((ROOT / "docs/research/parity-image-studios.json").read_text(encoding="utf-8"))
GRADE_TS = (ROOT / "src/lib/grade.ts").read_text(encoding="utf-8")
OUT = ROOT / "src/lib/catalog/soul-originals.generated.ts"
# The pickers' slim list (no LoRA detail, safe for the browser bundle): cards, tabs and the old-id map.
CARDS_OUT = ROOT / "src/lib/catalog/soul-looks.generated.ts"

# Soul's picker tabs, in Soul's order (generic words).
V1_TABS = ["New", "TikTok Core", "Instagram Aesthetics", "Camera Presets", "Beauty", "Mood", "Surreal", "Graphic Art"]
V2_TABS = ["Mood", "Styles", "Camera"]
BASES = {"z-image-turbo": "z-image", "qwen-image-2512": "qwen-2512"}
# Which LoRA bases each Soul base loads.
BASE_LORAS = {"z-image": re.compile(r"^z-image"), "qwen-2512": re.compile(r"^qwen-image-2512")}
OVERLAYS = {"date-stamp", "cctv", "photo-booth"}
# Steps after the picture (O11): the face mosaic (SAM 3.1 + a mosaic; src/lib/catalog/open-tools.ts).
POSTS = {"face-mosaic"}
MAX_LORAS = 3
errors = []
notes = []


def slug(s):
    """The harness's slug (scripts/eval/lib/recipes.mjs): NFKD, lower case, runs of other characters → '-'."""
    s = unicodedata.normalize("NFKD", str(s).lower())
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


soul = RECIPES["soul"]
tails = soul["template"]["tails"]
library = {e["key"]: e for e in RECIPES["loraLibrary"]}
core = [l["key"] for l in soul["loras"]]
for k in core:
    if k not in library:
        errors.append(f"core LoRA {k} is not in loraLibrary")

# Grade presets the browser can apply (src/lib/grade.ts PRESETS ids).
grades = set(re.findall(r'\{ id: "([a-z0-9-]+)", name:', GRADE_TS))
if not grades:
    errors.append("found no grade presets in src/lib/grade.ts")


def lora_list(raw, where, base):
    out = []
    for l in raw:
        key = l.get("key")
        e = library.get(key)
        if not e:
            errors.append(f"{where}: LoRA {key!r} is not in loraLibrary")
            continue
        if not e.get("commercial"):
            notes.append(f"{where}: {key} is non-commercial")
        if not e.get("hostedOk"):
            notes.append(f"{where}: {key} is licensed for the user's GPU only")
        if not BASE_LORAS[base].match(e.get("base") or ""):
            errors.append(f"{where}: {key} is a {e.get('base')} LoRA, not one for {base}")
        s = l.get("strength", e.get("strength"))
        if not isinstance(s, (int, float)) or not 0 < s <= 1.5:
            errors.append(f"{where}: {key} strength {s!r} is out of range")
        out.append({"key": key, "strength": round(float(s), 3)})
    if len(out) > MAX_LORAS:
        errors.append(f"{where}: {len(out)} LoRAs, fal's Z-Image endpoint takes {MAX_LORAS}")
    if len({x["key"] for x in out}) != len(out):
        errors.append(f"{where}: a LoRA is listed twice")
    return out


def triggers_of(loras):
    seen = []
    for l in loras:
        t = (library[l["key"]].get("trigger") or "").strip()
        if t and t not in seen:
            seen.append(t)
    return ", ".join(seen)


# Sizes: tier → aspect → [width, height] (research §4.3: the 720p tier is about 1 MP, 1080p about 2 MP).
TIER_NAMES = {"720p": "720p tier", "1080p": "1080p tier"}
sizes = {}
for tier, prefix in TIER_NAMES.items():
    table = next((v for k, v in soul["settings"]["comfyui"]["sizes"].items() if k.startswith(prefix)), None)
    if not table:
        errors.append(f"no {tier} size table in soul.settings.comfyui.sizes")
        continue
    sizes[tier] = {}
    for aspect, wh in table.items():
        m = re.fullmatch(r"(\d+)x(\d+)", wh)
        if not m:
            errors.append(f"size {tier} {aspect}: {wh!r} is not WxH")
            continue
        w, h = int(m.group(1)), int(m.group(2))
        if w % 16 or h % 16 or max(w, h) > 2048:
            errors.append(f"size {tier} {aspect}: {w}x{h} is off the 16-pixel grid or above 2048")
        sizes[tier][aspect] = [w, h]
aspects = list(sizes.get("720p", {}).keys())
if sizes and any(list(t.keys()) != aspects for t in sizes.values()):
    errors.append("the size tiers don't list the same aspect ratios")

c = soul["settings"]["comfyui"]
sampler = {"steps": c["steps"], "cfg": c["cfg"], "sampler": c["sampler"], "scheduler": c["scheduler"], "shift": c["shift"]}
seed = re.search(r"(\d[\d,]*)\s*-\s*(\d[\d,]*)", soul["settings"].get("seeds") or "")
seed_range = [int(seed.group(1).replace(",", "")), int(seed.group(2).replace(",", ""))] if seed else [1, 1000000]

# Soul Cinema: one fixed look (no picker), the 'cine' tail and the film-still LoRAs.
sc = soul["soulCinema"]
cinema = {
    "loras": lora_list(sc.get("loras") or [], "Soul Cinema", "z-image"),
    "tail": sc.get("tail") or "cine",
    "grades": sc.get("grades") or [],
    "defaultAspect": sc.get("defaultAspect") or "16:9",
}
for g in cinema["grades"]:
    if g not in grades:
        errors.append(f"Soul Cinema: grade {g!r} is not a src/lib/grade.ts preset")
if cinema["tail"] not in tails:
    errors.append(f"Soul Cinema: unknown tail {cinema['tail']!r}")

# The looks, in the research's order (Soul v1 first, then Soul 2.0).
by_id = {p["id"]: p for p in LOOKS["soulPresets"]}
looks = []
for p in RECIPES["presets"]:
    meta = by_id.get(p["id"])
    where = f"look {p.get('name')!r}"
    if not meta:
        errors.append(f"{where}: {p['id']} is not in parity-image-studios.json soulPresets")
        continue
    family = "v2" if p["model"] == "soul-v2" else "v1"
    cats = list(meta.get("categories") or [])
    if family == "v2" and meta.get("category") and meta["category"] != "All presets":
        cats = [meta["category"]]
    tabs = V1_TABS if family == "v1" else V2_TABS
    for cat in cats:
        if cat not in tabs:
            errors.append(f"{where}: category {cat!r} is not a Soul {family} tab")
    base = BASES.get(p.get("base"))
    if not base:
        errors.append(f"{where}: unknown base {p.get('base')!r}")
        continue
    tail = p.get("tail")
    if tail not in tails:
        errors.append(f"{where}: unknown tail {tail!r}")
        continue
    t = p.get("template") or ""
    tail_text = tails[tail]
    if not t.startswith("{prompt}. ") or (tail_text and not t.endswith(" " + tail_text)):
        errors.append(f"{where}: template isn't '{{prompt}}. <look>. <tail>': {t!r}")
        continue
    look = t[len("{prompt}. "):]
    if tail_text:
        look = look[: -len(tail_text)]
    look = clean(look)
    if not look or "{" in look:
        errors.append(f"{where}: empty or templated look sentence {look!r}")
    loras = lora_list(p.get("loras") or [], where, base)
    if triggers_of(loras) != (p.get("triggers") or ""):
        errors.append(f"{where}: triggers {p.get('triggers')!r} aren't its LoRAs' ({triggers_of(loras)!r})")
    grade = p.get("grade")
    if grade and grade not in grades:
        errors.append(f"{where}: grade {grade!r} is not a src/lib/grade.ts preset (add it there first)")
    overlay = p.get("overlay")
    if overlay and overlay not in OVERLAYS:
        errors.append(f"{where}: unknown overlay {overlay!r}")
    post = p.get("post")
    if post and post not in POSTS:
        errors.append(f"{where}: unknown post step {post!r}")
    if p.get("commercialOk") is False or p.get("hostedOk") is False:
        notes.append(f"{where}: the research marks it not commercial-safe on both engines")
    entry = {
        "id": f"{family}-{slug(meta['name'])}",
        "name": clean(meta["name"]),
        "family": family,
        "categories": cats,
        "look": look,
        "tail": tail,
        "loras": loras,
        "base": base,
        "coverage": p.get("coverage") or ("lora" if loras else "prompt-only"),
    }
    if grade:
        entry["grade"] = grade
    if overlay:
        entry["overlay"] = overlay
    if post:
        entry["post"] = post
    if p.get("trainOwn"):
        entry["train"] = True
    if clean(p.get("notes")):
        entry["note"] = clean(p["notes"])
    entry["legacyStyleId"] = p["id"]
    looks.append(entry)

ids = [l["id"] for l in looks]
dupes = sorted({i for i in ids if ids.count(i) > 1})
if dupes:
    errors.append(f"duplicate look ids: {dupes}")
if len(looks) != 139:
    errors.append(f"expected 139 looks, found {len(looks)}")
categories = {"v1": [c for c in V1_TABS if any(c in l["categories"] for l in looks if l["family"] == "v1")],
              "v2": [c for c in V2_TABS if any(c in l["categories"] for l in looks if l["family"] == "v2")]}

if errors:
    for e in errors:
        print(f"error: {e}", file=sys.stderr)
    sys.exit(1)
for n in dict.fromkeys(notes):
    print(f"licence note (information, shown in Settings → Models & licences): {n}")


def ts(v):
    return json.dumps(v, indent=2, ensure_ascii=False)


out = f"""// Generated by scripts/gen-soul-originals.py from docs/research/fuobe-originals-recipes-5.json (soul, presets) and
// docs/research/parity-image-studios.json (families, categories) — do not edit by hand.
import type {{ SoulCinemaRecipe, SoulLook, SoulTail, SoulTier }} from "./soul";

/** When the Soul research (looks, LoRAs, settings) was read. */
export const SOUL_ORIGINALS_AS_OF = {ts(RECIPES["asOf"])};

/** The sentence each kind of look ends with (research §4.2). */
export const SOUL_TAILS: Record<SoulTail, string> = {ts(tails)};

/** The core LoRAs (research §4.1): the slot a character LoRA takes first when a cloud API runs out of slots. */
export const SOUL_CORE_LORAS: string[] = {ts(core)};

/** Width × height per resolution tier and aspect ratio (research §4.3; multiples of 16, ≤ 2048). */
export const SOUL_SIZES: Record<SoulTier, Record<string, [number, number]>> = {ts(sizes)};

/** Z-Image Turbo's sampler for every look (research §4.3): 8 steps, cfg 1, res_multistep, shift 3. */
export const SOUL_SAMPLER = {ts(sampler)} as const;

/** Soul's seed range (kept so Reuse works across engines). */
export const SOUL_SEED_RANGE: [number, number] = {ts(seed_range)};

/** Soul Cinema: one fixed film look, no picker (research §4.5). */
export const SOUL_CINEMA: SoulCinemaRecipe = {ts(cinema)};

/** The picker's category tabs per family, in Soul's order. */
export const SOUL_CATEGORIES: Record<"v1" | "v2", string[]> = {ts(categories)};

/** The 139 looks (106 Soul v1, 33 Soul 2.0), each a Fuobe Soul run: words, LoRAs, a grade, an overlay. */
export const SOUL_ORIGINALS: SoulLook[] = {ts(looks)};
"""
OUT.write_text(out, encoding="utf-8")


def hue(look_id):
    """The look's cover hue (src/lib/catalog/soul.ts lookHue): no preview media is copied from anywhere."""
    h = 0
    for ch in look_id:
        h = (h * 31 + ord(ch)) % 360
    return h


cards = []
for l in looks:
    card = {"id": l["id"], "name": l["name"], "family": l["family"], "categories": l["categories"], "description": l["look"], "hue": hue(l["id"])}
    if l.get("grade"):
        card["grade"] = l["grade"]
    if l.get("overlay"):
        card["overlay"] = l["overlay"]
    if l.get("post"):
        card["post"] = l["post"]
    card["civitai"] = any(library[x["key"]].get("download") == "civitai-token" for x in l["loras"])
    card["hd"] = l["base"] == "qwen-2512"
    cards.append(card)
legacy = {l["legacyStyleId"]: l["id"] for l in looks}
cards_out = f"""// Generated by scripts/gen-soul-originals.py from docs/research/fuobe-originals-recipes-5.json — do not edit by hand.
// The Soul looks as picker cards: safe for the browser bundle (no LoRA or recipe detail; that is soul-originals.generated.ts).
import type {{ SoulLookCard }} from "./soul-cards";

/** The 139 looks as cards: Fuobe's id, name, family, tabs, the look in words, a drawn cover's hue, its grade. */
export const SOUL_LOOK_CARDS: SoulLookCard[] = {ts(cards)};

/** The picker's category tabs per family, in Soul's order. */
export const SOUL_LOOK_CATEGORIES: Record<"v1" | "v2", string[]> = {ts(categories)};

/**
 * Legacy style ids → Fuobe look ids, one way: a request, a moodboard pick or a Reuse saved before the
 * Originals still finds its look. Nothing sends these ids anywhere.
 */
export const SOUL_LEGACY_IDS: Record<string, string> = {ts(legacy)};
"""
CARDS_OUT.write_text(cards_out, encoding="utf-8")
print(f"wrote {len(looks)} Soul looks ({sum(1 for l in looks if l['family'] == 'v1')} v1, {sum(1 for l in looks if l['family'] == 'v2')} v2) to {OUT.relative_to(ROOT)}")
