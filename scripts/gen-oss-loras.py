#!/usr/bin/env python3
"""
Generate src/lib/catalog/oss-loras.generated.ts: the preset → LoRA map v2 of Fuobe DoP (camera motions and
effects, build plan O4), from two research files:

- docs/research/comfyui-oss.json "loras" (round 1): Wan 2.1 / 2.2 I2V LoRAs matched to presets by their
  parityEquivalent column and their own short name ("Remade-AI Squish" → "squish"). Keyed by the bare
  slug, as before.
- docs/research/fuobe-originals-recipes-5.json "motionsEffects" (§7.2–7.4): the rows whose status makes a LoRA
  a default (add-lora, replace, relight-route, weak-candidate, and local-only, which runs on the user's GPU
  only), keyed by preset id ("motion-overhead", "effect-thunder-god"), so they win over a round-1 match.
  Aliases (aliasOf) reuse another key's LoRAs; every row's camera maps (funCamera: Wan 2.2 Fun Camera pose,
  cameraLora: LTX-2.3's built-in camera LoRA, cameraMotion: LTX-2.5's camera_motion) and its status go to
  DOP_RECIPES.

Each LoRA carries its base (wan2.2-i2v-a14b high / low, wan2.1 on both experts, ltx-2.3-22b, ltx-2-19b,
ltx-2.5-22b, qwen-image-edit-2509) and its licence flags (commercial: outputs may be sold; hostedOk: it may
run on fal / Replicate). src/lib/catalog/dop.ts turns this into each preset's open and cloud routes.

Licences are information (the owner's decision of 2026-10-27; Settings → Models & licences has the switches): every
LoRA goes into the map with its licence as recorded. A round-1 LoRA whose licence isn't a known commercial-use
licence (e.g. "unspecified (check card)") is kept with commercial: false and its licence named; a map v2 row that
makes a non-commercial LoRA a default, sends a hostedOk: false LoRA to the cloud, or is on licence hold is listed
as a note, never a failure.

The rows' free-text `notes` stay in the research file: the generated map is bundled into the site's browser code,
and no page shows them.

Run:  python3 scripts/gen-oss-loras.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROUND1 = json.loads((ROOT / "docs/research/comfyui-oss.json").read_text(encoding="utf-8"))
RECIPES = json.loads((ROOT / "docs/research/fuobe-originals-recipes-5.json").read_text(encoding="utf-8"))

# Licences that allow selling outputs and running the weights anywhere (the user's GPU, fal, Replicate).
COMMERCIAL = {"Apache-2.0", "MIT", "CC0-1.0", "CreativeML OpenRAIL-M", "BigScience OpenRAIL-M"}
# Map v2 statuses whose LoRAs a preset uses by default (as in gen-lora-library.py). A licence on hold is information.
DEFAULT_STATUSES = {"add-lora", "replace", "relight-route", "weak-candidate", "local-only", "licence-hold"}
# Wan 2.2 Fun Camera's poses (wan22-fun-camera-14b cameraMotion), LTX-2.3's camera_lora and LTX-2.5's camera_motion.
FUN_POSES = {"Static", "Pan Up", "Pan Down", "Pan Left", "Pan Right", "Zoom In", "Zoom Out", "Anti Clockwise (ACW)", "ClockWise (CW)"}
LTX_CAMERA = {"dolly_in", "dolly_out", "dolly_left", "dolly_right", "jib_up", "jib_down", "static"}
LTX25_MOTION = LTX_CAMERA | {"focus_shift"}
errors = []
notes = []


def slug(s):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


# ---------------------------------------------------------------------------
# Round 1: Wan I2V LoRAs from comfyui-oss.json (bare slugs)

round1 = {}
# Commercial-use LoRAs first: one whose licence isn't recorded fills a preset nothing else covers, and never
# displaces one that is (the presets kept their LoRA when the gate became information; see the notes).
ROUND1_LORAS = sorted(ROUND1["loras"], key=lambda l: (l.get("license") or "").strip() not in COMMERCIAL)
for l in ROUND1_LORAS:
    base = l.get("baseModel", "")
    if l["type"] not in ("camera", "vfx") or not (base.startswith("wan2.1-i2v") or base.startswith("wan2.2-i2v")):
        continue
    licence = (l.get("license") or "").strip()
    commercial = licence in COMMERCIAL
    eq = l.get("parityEquivalent") or ""
    names = [re.sub(r"\(.*?\)", "", n).strip() for n in re.split(r"/|,", eq)]
    names = [n for n in names if n and n != "-"]
    # Also index by the LoRA's own short name ("Remade-AI Squish" → "squish").
    own = re.sub(r"^(Remade-AI|ostris|wolfer45|joyfox|lovis93|artificialguybr)\s+", "", l["name"])
    own = re.sub(r"\(.*?\)|Wan2\.[12]\s*I2V|Wan2\.[12]|LoRA", "", own).strip()
    names.append(own)
    noise = "high" if "high noise" in l["name"].lower() else "low" if "low noise" in l["name"].lower() else "both"
    trigger = (l.get("trigger") or "").split("(")[0].strip().strip('"')
    if trigger.lower().startswith(("none", "see card")):
        trigger = ""
    ref = {
        "file": l.get("file") or l["url"].rsplit("/", 1)[-1],
        "url": l["url"],
        "strength": 1.0,
        "target": noise,
        **({"trigger": trigger} if trigger else {}),
        "base": base,
        "licence": {"commercial": commercial, "hostedOk": not l.get("gated"), "snapshotDate": ROUND1["asOf"], "name": licence or "not recorded"},
    }
    for n in names:
        key = slug(n)
        if not key:
            continue
        cur = round1.setdefault(key, [])
        if not commercial:
            if cur and not any(c["file"] == ref["file"] for c in cur):
                notes.append(f"{l['name']} (licence {licence or 'not recorded'}): {key} keeps {cur[0]['file']}; a candidate to compare")
                continue
            if not cur:
                notes.append(f"{l['name']}: licence {licence or 'not recorded'}, used for {key} as commercial: false")
        # Prefer native Wan 2.2 LoRAs over 2.1 ones for the same preset.
        if base.startswith("wan2.2") and cur and all(c["base"].startswith("wan2.1") for c in cur):
            cur.clear()
        if cur and base.startswith("wan2.1") and any(c["base"].startswith("wan2.2") for c in cur):
            continue
        if any(c["file"] == ref["file"] for c in cur):
            continue
        if base.startswith("wan2.1") and cur:
            continue  # one 2.1 LoRA per preset is enough
        cur.append(ref)

# ---------------------------------------------------------------------------
# Map v2: motionsEffects rows (preset ids)


def v2_lora(raw, where, status):
    perms = re.match(r"^civitai permissions:\s*(.*)$", raw.get("licence") or "")
    licence = {"commercial": bool(raw.get("commercial")), "hostedOk": bool(raw.get("hostedOk")), "snapshotDate": raw.get("checked") or RECIPES["asOf"], "name": raw.get("licence") or ""}
    if perms:
        licence["permissions"] = [p for p in (re.sub(r"\(.*?\)", "", x).strip() for x in perms.group(1).split(",")) if p]
    if not licence["commercial"]:
        notes.append(f"{where}: {raw['name']} is non-commercial")
    elif not licence["hostedOk"]:
        notes.append(f"{where}: {raw['name']} is licensed for the user's GPU only")
    base = raw.get("base") or ""
    target = raw.get("target") or ("both" if not base.startswith("wan2.2") else "high")
    out = {"file": raw["file"], "url": raw["url"], "strength": raw.get("strength", 1.0), "target": target}
    trig = (raw.get("trigger") or "").strip()
    if trig:
        out["trigger"] = trig
    out["base"] = base
    version = re.search(r"civitai\.com/api/download/models/(\d+)", raw["url"])
    if version:
        out["version"] = version.group(1)
    out["licence"] = licence
    return out


v2 = {}
recipes = {}
for m in RECIPES["motionsEffects"]:
    kind, status = m["kind"], m["status"]
    where = f"{kind} {', '.join(m['presets'][:3])} ({status})"
    loras = [v2_lora(raw, where, status) for raw in (m.get("loras") or [])] if status in DEFAULT_STATUSES or status == "alias" else []
    alias = m.get("aliasOf") or {}
    for name in m["presets"]:
        pid = f"{kind}-{slug(name)}"
        if pid in recipes:
            errors.append(f"{pid} is in two motionsEffects rows")
        recipe = {"kind": kind, "status": status}
        for field, allowed, label in (("funCamera", FUN_POSES, "Fun Camera pose"), ("cameraLora", LTX_CAMERA, "LTX-2.3 camera_lora"), ("cameraMotion", LTX25_MOTION, "LTX-2.5 camera_motion")):
            v = (m.get(field) or {}).get(name)
            if v is None:
                continue
            if v not in allowed:
                errors.append(f"{pid}: {v!r} is not a {label}")
            recipe[field] = v
        mine = loras
        if name in alias:
            src = alias[name]
            if src not in round1:
                errors.append(f"{pid}: aliasOf {src!r} isn't a key of the round-1 map")
            else:
                recipe["aliasOf"] = src
                if not mine:
                    mine = [dict(l) for l in round1[src]]
        if mine:
            v2[pid] = mine
        recipes[pid] = recipe

overlap = sorted(k for k in v2 if k in round1)
if overlap:
    errors.append(f"map v2 keys must be preset ids, not bare slugs: {overlap}")

if errors:
    print("gen-oss-loras: the research breaks the map rules:\n  " + "\n  ".join(errors), file=sys.stderr)
    sys.exit(1)

out = {**v2, **round1}
ts = (
    "// Generated by scripts/gen-oss-loras.py from docs/research/comfyui-oss.json (round-1 Wan LoRAs) and\n"
    "// docs/research/fuobe-originals-recipes-5.json (motionsEffects, the preset → LoRA map v2) — do not edit by hand.\n"
    'import type { LoraLicence, LoraRef } from "./types";\n\n'
    "/**\n"
    " * A LoRA a camera motion or effect uses: its base (wan2.2-i2v-a14b high / low expert, wan2.1 on both experts,\n"
    " * ltx-2.3-22b, ltx-2-19b, ltx-2.5-22b, qwen-image-edit-2509) and its licence flags.\n"
    " */\n"
    'export type OssLora = LoraRef & { target: "high" | "low" | "both"; base: string; licence: LoraLicence };\n\n'
    "/** How Fuobe DoP runs a preset the map v2 names (research §7.2–7.4). */\n"
    "export interface DopRecipe {\n"
    '  kind: "motion" | "effect";\n'
    "  /** add-lora, replace, relight-route, weak-candidate, local-only, alias, fun-camera, hosted-native, post-grade, mixed-media-route, prompt-only, train-own, motion-library, licence-hold. */\n"
    "  status: string;\n"
    "  /** Wan 2.2 Fun Camera's pose on the open engine. */\n"
    "  funCamera?: string;\n"
    "  /** LTX-2.3's built-in camera LoRA in the cloud (fal camera_lora). */\n"
    "  cameraLora?: string;\n"
    "  /** LTX-2.5's camera_motion (hosted, no LoRAs). */\n"
    "  cameraMotion?: string;\n"
    "  /** The round-1 key whose LoRAs it reuses. */\n"
    "  aliasOf?: string;\n"
    "}\n\n"
    "/** Preset id (\"motion-overhead\") for the map v2, else the bare slug of a round-1 match (\"crash-zoom-in\"). */\n"
    f"export const OSS_LORAS: Record<string, OssLora[]> = {json.dumps(out, indent=2, ensure_ascii=False)};\n\n"
    "/** Every preset the map v2 names, by preset id. */\n"
    f"export const DOP_RECIPES: Record<string, DopRecipe> = {json.dumps(recipes, indent=2, ensure_ascii=False)};\n"
)
(ROOT / "src/lib/catalog/oss-loras.generated.ts").write_text(ts, encoding="utf-8")
print(f"wrote {len(v2)} map v2 presets + {len(round1)} round-1 keys and {len(recipes)} DoP recipes")
if notes:
    print("licence notes (information, shown in Settings → Models & licences):\n  " + "\n  ".join(dict.fromkeys(notes)))
