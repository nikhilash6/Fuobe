#!/usr/bin/env python3
"""
Generate src/lib/catalog/trainers.generated.ts: every LoRA trainer fal hosts (build plan O3), with each one's request
fields, the response field its LoRA comes back in, its price per step and the licence of the weights it trains on.
Source: docs/research/fuobe-originals-recipes-5.json → trainers[] (read from fal's OpenAPI and llms.txt;
loraOutput by scripts/fetch-hosted-schemas.py --trainers).

Licences are information, not gates (the owner's decision of 2026-10-27: "Forget licences restrictions etc. Just put
them as info in settings instead so admin decides what to activate"): every trainer is generated with its licence
and whether its weights allow selling outputs (true, false, or null when a revenue tier decides), and Soul ID offers
non-commercial bases (FLUX.1 / FLUX.2 [dev], FLUX.2 [klein] 9B) and Krea 2 next to the Apache-2.0 ones; the admin
turns models on or off in Settings. Replicate's trainers are billed by GPU time and have no fields here.
src/lib/catalog/training.ts turns a training target into a request with these fields, so nothing about a trainer's
API is typed by hand.

Fails (exit 1) when a trainer Fuobe's targets use (USED below):
- isn't active or served (status);
- lacks a field its request sends (steps, the caption or trigger, learning_rate, training_type for a style);
- has no LoRA in its response, or a price this script can't read (the spend shown before a run, and the eval
  harness's cap, need it).

Run:  python3 scripts/gen-trainers.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "docs/research/fuobe-originals-recipes-5.json").read_text(encoding="utf-8"))
OUT = ROOT / "src/lib/catalog/trainers.generated.ts"

# The trainers src/lib/catalog/training.ts uses, and the fields each request sends.
USED = {
    "fal-ai/z-image-turbo-trainer-v2": ["steps", "default_caption", "learning_rate"],
    "fal-ai/z-image-trainer": ["steps", "default_caption", "learning_rate", "training_type"],
    "fal-ai/qwen-image-2512-trainer": ["steps", "default_caption", "learning_rate"],
    "fal-ai/flux-2-klein-4b-base-trainer": ["steps", "default_caption", "learning_rate"],
    "fal-ai/flux-2-klein-9b-base-trainer": ["steps", "default_caption", "learning_rate"],
    "fal-ai/flux-2-trainer-v2": ["steps", "default_caption", "learning_rate"],
    "fal-ai/flux-lora-portrait-trainer": ["steps", "trigger_phrase", "learning_rate"],
    "fal-ai/krea-2-trainer": ["steps", "trigger_phrase", "learning_rate"],
    # FLUX 3 Image Klein's own trainer (nm10-flux3-klein): it trains on Klein Base; read by fetch-hosted-schemas.py --new10.
    "blackforestlabs/flux-3/klein/base/trainer": ["steps", "trigger_phrase", "learning_rate"],
}
# Where each trainer's dataset zip goes (the first of these its schema requires).
DATA_FIELDS = ("image_data_url", "images_data_url", "training_data_url")
# Trainers that learn motion from clips (Wan, LTX) rather than a subject or a look from photos.
VIDEO = re.compile(r"wan-22-trainer|wan-trainer|ltx")
errors = []


def slug(s):
    """'Z-Image Turbo' → 'z-image-turbo', 'Z-Image (base)' → 'z-image', 'Qwen-Image 2512' → 'qwen-image-2512'."""
    s = re.sub(r"\(base\)", "", s, flags=re.I)
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def num(s):
    v = float(s.replace(",", ""))
    return int(v) if v.is_integer() else v


def field(spec):
    """'integer default=2000 minimum=10 maximum=40000' → {type, default, min, max}; enums kept."""
    parts = spec.split(" ", 1)
    out = {"type": parts[0]}
    rest = parts[1] if len(parts) > 1 else ""
    m = re.search(r"enum=(\[.*?\])", rest)
    if m:
        out["enum"] = json.loads(m.group(1))
        rest = rest.replace(m.group(0), "")
    m = re.search(r'default=("[^"]*"|\S+)', rest)
    if m:
        try:
            v = json.loads(m.group(1))
        except json.JSONDecodeError:
            v = m.group(1)
        # Lists, objects and null (a video trainer's validation prompts) aren't a field Soul ID sets.
        if isinstance(v, (str, bool, int, float)):
            out["default"] = v if isinstance(v, (str, bool)) else num(str(v))
    for key, name in (("minimum", "min"), ("maximum", "max")):
        m = re.search(rf"{key}=(\S+)", rest)
        if m:
            out[name] = num(m.group(1))
    return out


def pricing(text):
    """The price per step and the fewest steps billed, from fal's own sentence (None when it names neither).
    Numbers stop before a sentence's full stop ("a minimum charge of $2.40.")."""
    t = text or ""
    per = None
    for pat, div in (
        (r"\$(\d[\d,]*(?:\.\d+)?) per 1000-step", 1000),
        (r"\$(\d[\d,]*(?:\.\d+)?) for 1,000 requested steps", 1000),
        (r"\$(\d[\d,]*(?:\.\d+)?) per steps?\b", 1),
        (r"\$(\d[\d,]*(?:\.\d+)?) per training steps?\b", 1),
        (r"(\d+(?:\.\d+)?) \* steps", 1),
    ):
        m = re.search(pat, t)
        if m:
            per = float(m.group(1).replace(",", "")) / div
            break
    # A price that grows with something else as well (the Klein edit trainer's references per pair) has no one rate per step.
    if per is None or re.search(r"multiplied by", t):
        return None
    floor = 1
    for pat in (r"(\d[\d,]*) step floor", r"minimum of (\d[\d,]*) steps", r"(\d[\d,]*) steps is the minimum", r"minimum (\d[\d,]*) steps"):
        m = re.search(pat, t)
        if m:
            floor = int(m.group(1).replace(",", ""))
            break
    m = re.search(r"minimum charge of \$(\d[\d,]*(?:\.\d+)?)", t)
    if m and floor == 1:
        floor = round(float(m.group(1).replace(",", "")) / per)
    return {"usdPerStep": round(per, 8), "minBilledSteps": floor}


trainers = []
for raw in DATA["trainers"]:
    data_field = next((f for f in DATA_FIELDS if f in (raw.get("required") or [])), None)
    if raw.get("provider") != "fal" or not data_field:
        continue
    tid = raw["id"]
    price = pricing(raw.get("price"))
    fields = {k: field(v) for k, v in sorted((raw.get("fields") or {}).items())}
    status = raw.get("status") or ""
    commercial = raw.get("commercialWeights")
    entry = {
        "id": tid,
        "provider": "fal",
        "family": raw.get("family") or "",
        "base": slug(raw.get("family") or ""),
        "media": "video" if VIDEO.search(tid) else "image",
        "role": raw.get("role") or "",
        "dataField": data_field,
        "loraOutput": raw.get("loraOutput") or [],
        "fields": fields,
        "licence": raw.get("baseLicence") or "",
        # True: the weights allow selling outputs; false: non-commercial weights; null: a revenue tier decides.
        "commercial": commercial if isinstance(commercial, bool) else None,
        "status": "active" if status == "active" else "unlisted" if status.startswith("unlisted") else status or "unknown",
        "checked": raw.get("checked") or "",
        "schemaUrl": raw.get("schemaUrl") or "",
        "priceText": raw.get("price") or "",
    }
    if price:
        entry.update(price)
    if tid in USED:
        if entry["status"] not in ("active", "unlisted"):
            errors.append(f"{tid}: status {status!r}")
        for f in USED[tid]:
            if f not in fields:
                errors.append(f"{tid}: has no {f} field")
        if not entry["loraOutput"]:
            errors.append(f"{tid}: no LoRA field in its response (run scripts/fetch-hosted-schemas.py --trainers)")
        if not price:
            errors.append(f"{tid}: can't read its price from {raw.get('price')!r}")
    trainers.append(entry)

missing = sorted(set(USED) - {t["id"] for t in trainers})
for tid in missing:
    errors.append(f"{tid}: not in the research's trainers[]")

if errors:
    print("gen-trainers: a trainer Soul ID uses can't be called as the research stands:", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)

ts = (
    "// Generated by scripts/gen-trainers.py from docs/research/fuobe-originals-recipes-5.json — do not edit by hand.\n"
    'import type { HostedTrainer } from "./training";\n\n'
    "/** When the trainers' schemas and prices were read. */\n"
    f"export const TRAINERS_AS_OF = {json.dumps(DATA['asOf'])};\n\n"
    "/** fal's LoRA trainers (a zip of 001.jpg + 001.txt pairs, or clips for video), with their fields, prices and licences. */\n"
    f"export const HOSTED_TRAINERS: HostedTrainer[] = {json.dumps(trainers, indent=2, ensure_ascii=False)};\n"
)
OUT.write_text(ts, encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)}: {len(trainers)} trainers ({len(USED)} used by Soul ID)")
