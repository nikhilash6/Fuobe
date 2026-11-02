#!/usr/bin/env bash
# Reproducible CPU-only ComfyUI install used to export + validate Fuobe's workflow library.
# (No GPU and no model weights are needed: validation uses zero-byte placeholder files.)
#
# Usage: scripts/comfy/install-comfyui.sh            # installs into /home/user/ComfyUI
#        COMFYUI_DIR=~/ComfyUI scripts/comfy/install-comfyui.sh
# Re-running is safe (existing clones are kept).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-/home/user/ComfyUI}"
# Versions the committed library was generated/validated with (2026-10-16; round-3 packs 2026-10-17).
COMFYUI_REF="${COMFYUI_REF:-fc04da91b2ab12f99e4716371a7e4f98ac982597}"   # v0.41.0-7
PYTHON_VERSION="${PYTHON_VERSION:-3.13}"

declare -A NODES=(
  [ComfyUI-WanVideoWrapper]="https://github.com/kijai/ComfyUI-WanVideoWrapper 088128b224242e110d3906c6750e9a3a348a659b"
  [ComfyUI-VideoHelperSuite]="https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite 4d907bee61e92c2e65af3bd6383a4e4d356126d1"
  [ComfyUI-KJNodes]="https://github.com/kijai/ComfyUI-KJNodes 17195fcfa8a05f601b766a0f09c9733284f47416"
  [ComfyUI-Frame-Interpolation]="https://github.com/Fannovel16/ComfyUI-Frame-Interpolation 26545cc2dd95bc3d27f056016300673bdeee78f5"
  [ComfyUI-RMBG]="https://github.com/1038lab/ComfyUI-RMBG 229529e0ea63fb7085848225d74f91f6dc164956"
  [ComfyUI-ReActor]="https://github.com/Gourieff/ComfyUI-ReActor 3be5f356fe5b120a7a274d2509c0ecef5d0a7498"
  [ComfyUI-MMAudio]="https://github.com/kijai/ComfyUI-MMAudio 8eaeb72edc3aaf2059b57f2d96a1f6f689f19ae2"
  # audio / video-depth packs added with the comfyui-oss-2 workflows (2026-10-16)
  [ComfyUI_Fill-ChatterBox]="https://github.com/filliptm/ComfyUI_Fill-ChatterBox f7d7a16187430abcaf91a3039b9c83aa9960816a"
  [ComfyUI-IndexTTS2]="https://github.com/snicolast/ComfyUI-IndexTTS2 5b33e02bc0112b8aaf1fc823d5e5a609ca07fc27"
  [ComfyUI-Video-Depth-Anything]="https://github.com/yuvraj108c/ComfyUI-Video-Depth-Anything a0db08e63d1ea571601c45cde4aaee0acdd0544d"
  # round-3 packs (2026-10-17, docs/research/comfyui-oss-3.md): voice separation, ASR/subtitles, foley
  [ComfyUI-MelBandRoFormer]="https://github.com/kijai/ComfyUI-MelBandRoFormer 92c86854e6654f4aacc97484471af95c98ea16d4"
  [ComfyUI-QwenASR]="https://github.com/1038lab/ComfyUI-QwenASR 3f9a652a617e578e4e3bd090e3dbc75274bf4775"
  [ComfyUI-HunyuanVideo-Foley]="https://github.com/phazei/ComfyUI-HunyuanVideo-Foley afd2960b8ad9036a9f55a15daf514112ff68e010"
  # round 4 (2026-10-22): VTracer image → SVG (the Vectorize app's open route)
  [ComfyUI-ToSVG]="https://github.com/Yanick112/ComfyUI-ToSVG 1022ba05318dccb4fe586ce5bbd09f1f0b3c7909"
  # DBS soundtrack separation (dialogue / music / effects; docs/research/dbs-separation-7.md §4). MIT code, vendored DBS
  # code Apache-2.0. The Comfy Registry flags its only version (0.1.0, dbs-soundtrack-separation) and gives no public
  # reason; the code was read at this commit (no network, exec or download paths in the nodes). It needs einops and
  # safetensors only, both already installed below. Weights: the DBS_WEIGHTS block at the end of this script.
  [ComfyUI-DBS]="https://github.com/hiroki-abe-58/ComfyUI-DBS f656e53434b5485c148a2866fbd6ddc6b6152ed6"
  # Lightricks' LTX nodes for Restore & colourise (package archive-restore): LTXICLoRALoaderModelOnly, LTXAddVideoICLoRAGuide
  # and LTXVTiledFusionSampler (per-step tiled latent fusion). LTX-2 Community License (the repository's LICENSE: free below
  # US$10M annual revenue). Read at this commit (2026-10-20); its requirements are installed below.
  [ComfyUI-LTXVideo]="https://github.com/Lightricks/ComfyUI-LTXVideo 220e1d45aa0469f518e982102fca4dca92a61862"
  # MiniMax H3 video (minimax-h3-t2v / i2v / flf2v): larryvrh's turbo LoRA loader and sampler (Apache-2.0, v1.2.3, no
  # dependencies) and PlagueKind's SLA attention and AdaLN LoRA fix (MIT, v1.5.6; the SLA kernel imports triton, installed below).
  [ComfyUI-MiniMax-H3-Turbo]="https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo 77bfa67575b14e3be6214f1747732e540c68b5dd"
  [plaguekind-nodes]="https://github.com/PlagueKind/ComfyUI-PlagueKind-Nodes d58d006a4ea32c25c06499f2ff104f0852a045a6"
)
# Licences are information (Settings → Models & licences has the switches): every pack is installed, the
# non-commercial ComfyUI-Whisper (CC-BY-NC-SA-4.0, used by the captions-whisper-burnin workflow) included.
# NC_PACKS=0 leaves the non-commercial packs out of this install.
if [ "${NC_PACKS:-1}" = "1" ]; then
  NODES[ComfyUI-Whisper]="https://github.com/yuvraj108c/ComfyUI-Whisper 006a709848259ed3d69e2f9fcfd7a75f6c860ddd"
fi

if [ ! -d "$COMFYUI_DIR/.git" ]; then
  git clone https://github.com/comfyanonymous/ComfyUI "$COMFYUI_DIR"
fi
if [ "${PIN:-1}" = "1" ]; then git -C "$COMFYUI_DIR" checkout -q "$COMFYUI_REF" || echo "warn: could not pin ComfyUI to $COMFYUI_REF"; fi

cd "$COMFYUI_DIR"
[ -x .venv/bin/python ] || uv venv --python "$PYTHON_VERSION" .venv
PY="$COMFYUI_DIR/.venv/bin/python"
uv pip install --python "$PY" torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
uv pip install --python "$PY" -r requirements.txt   # pulls comfyui-frontend-package + comfyui-workflow-templates*

for name in "${!NODES[@]}"; do
  read -r url ref <<<"${NODES[$name]}"
  dest="$COMFYUI_DIR/custom_nodes/$name"
  if [ ! -d "$dest/.git" ]; then git clone -q "$url" "$dest"; fi
  if [ "${PIN:-1}" = "1" ]; then
    git -C "$dest" fetch -q --depth 1 origin "$ref" 2>/dev/null || true
    git -C "$dest" checkout -q "$ref" 2>/dev/null || echo "warn: could not pin $name to $ref (using $(git -C "$dest" rev-parse --short HEAD))"
  fi
done

# Genjutsu's Character swap (docs/research/openjutsu-6.md §4): Akatz Labs' h3_character_swap pack (GPL-3.0) lives in a
# subfolder of their H3 Character Swap tool, pinned at the commit Openjutsu uses (the last one with the pack). It is
# used unpatched (the workflows send the resolution as "480" / "768") and needs FFmpeg and FFprobe on PATH; its own
# requirements (numpy, scipy, Pillow, opencv-python-headless) are in the union below. H3_PACK=0 leaves it out.
H3_TOOL_REF="${H3_TOOL_REF:-0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b}"
if [ "${H3_PACK:-1}" = "1" ] && [ ! -d "$COMFYUI_DIR/custom_nodes/h3_character_swap" ]; then
  h3tmp="$(mktemp -d)"
  # Each step is guarded (set -e): a failed fetch warns and the rest of the install goes on.
  if git clone -q --filter=blob:none --no-checkout https://github.com/akatz-labs/h3-character-swap-tool "$h3tmp/tool" \
    && git -C "$h3tmp/tool" sparse-checkout set --no-cone /worker_nodes/h3_character_swap/ \
    && git -C "$h3tmp/tool" checkout -q "$H3_TOOL_REF" \
    && cp -r "$h3tmp/tool/worker_nodes/h3_character_swap" "$COMFYUI_DIR/custom_nodes/h3_character_swap"; then
    :
  else
    echo "warn: could not fetch h3_character_swap at $H3_TOOL_REF"
  fi
  rm -rf "$h3tmp"
fi
if [ "${H3_PACK:-1}" = "1" ] && { ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; }; then
  echo "warn: the h3_character_swap pack needs ffmpeg and ffprobe on PATH (Genjutsu's Character swap)"
fi
# H3 Relay 2.0 (Akatz Labs' newer nodes for the same swap, GPL-3.0; the video-character-swap-h3-relay workflow) registers
# HTTP routes and an in-memory H3 layout compatibility layer when it loads, so it is opt-in: H3_RELAY=1 (or install it on
# the isolated worker, scripts/comfy/install-isolated-worker.sh, the same way).
H3_RELAY_REF="${H3_RELAY_REF:-e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220}"   # 2.0.1, 2026-10-21
if [ "${H3_RELAY:-0}" = "1" ]; then
  dest="$COMFYUI_DIR/custom_nodes/h3-relay"
  if [ -d "$dest/.git" ] || git clone -q https://github.com/akatz-ai/h3-relay "$dest"; then
    git -C "$dest" fetch -q --depth 1 origin "$H3_RELAY_REF" 2>/dev/null || true
    git -C "$dest" checkout -q "$H3_RELAY_REF" 2>/dev/null || echo "warn: could not pin h3-relay to $H3_RELAY_REF"
  else
    echo "warn: could not fetch h3-relay"
  fi
fi
# Open-H3 Regenerate 2K (Upscale → Video's "Regenerate · creative", docs/research/new-models-7.md §2.6): rdh9616's pack
# (Apache-2.0) runs NVIDIA's refine recipe, and its upscale node calls LBH-123-AI's H3 latent upscaler (MIT), so both go
# in. Opt-in, since the graph needs about 40 GB of new files and a 48 GB+ GPU: OPEN_H3_REGEN=1. The rdh pack needs av and
# safetensors, which ComfyUI's own requirements.txt already installs; the LBH pack has no requirements. (ComfyUI core
# master merged its own H3 latent upscaler on 2026-10-28, but the rdh pack looks up LBH's class by name.)
OPEN_H3_REGEN_REF="${OPEN_H3_REGEN_REF:-9b686c5ffd380e9d1351f9b8beef6d20d703ca3e}"   # v1.0.0, 2026-10-28
H3_LATENT_UPSCALER_REF="${H3_LATENT_UPSCALER_REF:-40316cf008b2fd8663263270669eb4da23f89d2c}"   # 2026-09-17
if [ "${OPEN_H3_REGEN:-0}" = "1" ]; then
  for pack in "ComfyUI-Open-H3-Regenerate https://github.com/rdh9616/ComfyUI-Open-H3-Regenerate $OPEN_H3_REGEN_REF" \
              "Comfyui_Minimax_h3_latent_Upscaler https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler $H3_LATENT_UPSCALER_REF"; do
    read -r name url ref <<<"$pack"
    dest="$COMFYUI_DIR/custom_nodes/$name"
    if [ -d "$dest/.git" ] || git clone -q "$url" "$dest"; then
      git -C "$dest" fetch -q --depth 1 origin "$ref" 2>/dev/null || true
      git -C "$dest" checkout -q "$ref" 2>/dev/null || echo "warn: could not pin $name to $ref"
    else
      echo "warn: could not fetch $name"
    fi
  done
fi

# Hi3D 1.0 mesh refinement (Image to 3D's "Refine detail", the mesh-refine-hi3d workflow; docs/research/hi3d-refine.json):
# T8star's Comfyui-Hi3d-T8 (MIT code; the Hi3D code it vendors and the weights are under the Hi3D Open License 1.0, which
# asks for "Powered by Hi3D 1.0" wherever its results show). Opt-in: HI3D=1. It needs an NVIDIA GPU of compute capability
# 8.0+ (RTX 30 series / A-series or newer) and CUDA 12: its requirements.txt pins spconv-cu126 2.3.8 and triton, and keeps
# ComfyUI's own torch. There is no CPU path. The weights (10.66 GB: Hi3D 7.73 GB, DINOv2-L 1.22 GB, CLIP ViT-L/14 1.71 GB)
# go into models/Hi3D/{hi3d,dino,clip}/ at pinned revisions, each checked with sha256sum -c; HI3D_WEIGHTS=0 skips them.
HI3D_REF="${HI3D_REF:-73848490976e6a9b0c735ce02984c03866a495e7}"   # v0.5.1, 2026-10-26
if [ "${HI3D:-0}" = "1" ]; then
  dest="$COMFYUI_DIR/custom_nodes/Comfyui-Hi3d-T8"
  if [ -d "$dest/.git" ] || git clone -q https://github.com/T8mars/Comfyui-Hi3d-T8 "$dest"; then
    git -C "$dest" fetch -q --depth 1 origin "$HI3D_REF" 2>/dev/null || true
    git -C "$dest" checkout -q "$HI3D_REF" 2>/dev/null || echo "warn: could not pin Comfyui-Hi3d-T8 to $HI3D_REF"
    uv pip install --python "$PY" -r "$dest/requirements.txt" || echo "warn: Comfyui-Hi3d-T8's requirements did not install (it needs an NVIDIA GPU with CUDA 12)"
  else
    echo "warn: could not fetch Comfyui-Hi3d-T8"
  fi
  if [ "${HI3D_WEIGHTS:-1}" = "1" ]; then
    HI3D_DIR="$COMFYUI_DIR/models/Hi3D"
    for spec in "hi3d hi3d-official/Hi3Dv1.0 d502e938cbedc6e87aba8884614c5ca6d177a4b6 model_index.json scheduler/scheduler_config.json vae/config.json vae/model.safetensors transformer_512/config.json transformer_512/model.safetensors transformer_1024/config.json transformer_1024/model.safetensors" \
                "dino facebook/dinov2-large 47b73eefe95e8d44ec3623f8890bd894b6ea2d6c config.json model.safetensors" \
                "clip openai/clip-vit-large-patch14 32bd64288804d66eefd0ccbe215aa642df71cc41 config.json model.safetensors"; do
      read -r sub repo rev files <<<"$spec"
      for f in $files; do
        [ -s "$HI3D_DIR/$sub/$f" ] && continue
        mkdir -p "$(dirname "$HI3D_DIR/$sub/$f")"
        if curl -fsSL --retry 3 -o "$HI3D_DIR/$sub/$f.part" "https://huggingface.co/$repo/resolve/$rev/$f"; then
          mv "$HI3D_DIR/$sub/$f.part" "$HI3D_DIR/$sub/$f"
        else
          rm -f "$HI3D_DIR/$sub/$f.part"
          echo "warn: could not download $repo/$f at $rev"
        fi
      done
    done
    (cd "$HI3D_DIR" && sha256sum -c --quiet <<'SHA'
8ba88311dccf23463c6e10dd0d3bd5e0c5c35d1608c6f466413b6428b5ad8e56  hi3d/transformer_512/model.safetensors
a2ca5e44dde51cacecd59b42fceeb5f14e75d55e6dd047337752c4e6f281008c  hi3d/transformer_1024/model.safetensors
605d207c77f8db0b33c567a5861252f0090cf3c3604dfda1cfee09e8f0b53f3e  hi3d/vae/model.safetensors
399fba97a95f22c36834418bc69373364a99af3a1153da1c0fb31db567c92e23  dino/model.safetensors
a2bf730a0c7debf160f7a6b50b3aaf3703e7e88ac73de7a314903141db026dcb  clip/model.safetensors
SHA
    ) || echo "warn: a Hi3D weight file is missing or failed its SHA-256 check (delete it from models/Hi3D and re-run)"
  fi
fi

# Fuobe's live edit nodes (fuobe_live.py, one file Fuobe ships, MIT): Live edit's loader, cached reference encode,
# crop, paste-back and socket save. Written from the copy in this checkout (src/lib/comfy-live-nodes.ts).
if command -v node >/dev/null 2>&1; then
  node "$SCRIPT_DIR/write-live-nodes.mjs" "$COMFYUI_DIR/custom_nodes" || echo "warn: could not write Fuobe's live nodes"
else
  echo "warn: node not found: download fuobe_live.py from Fuobe (Live edit's setup card) into $COMFYUI_DIR/custom_nodes"
fi

# Union of the packs' requirements, minus GPU-only / unbuildable extras
# (onnxruntime-gpu, cupy, groundingdino-py). triton + decord + pycocotools are needed only so
# ComfyUI-RMBG's SAM3 module imports (otherwise the whole RMBG pack fails to load).
uv pip install --python "$PY" \
  opencv-python opencv-python-headless imageio-ffmpeg color-matcher matplotlib mss ftfy \
  "accelerate>=1.2.1" "diffusers>=0.33.1" "peft>=0.17.0" "sentencepiece>=0.2.0" protobuf pyloudnorm "gguf>=0.17.1" scipy \
  "librosa>=0.10.1" "torchdiffeq>=0.2.3" "timm>=1.0.8" "omegaconf>=2.3.0" "open_clip_torch>=2.29.0" \
  "rotary_embedding_torch>=0.5.3" huggingface-hub transparent-background segment-anything onnxruntime hydra-core iopath \
  albumentations onnx ultralytics colour-science kornia insightface triton decord pycocotools \
  resampy s3tokenizer conformer soundfile einops easydict Imath OpenEXR
# ^ last line: ComfyUI_Fill-ChatterBox (Chatterbox TTS/VC) + ComfyUI-Video-Depth-Anything.
# ComfyUI-IndexTTS2 registers its nodes with numpy only (everything else is imported lazily), which is
# all validation needs. Its *runtime* stack (pynini, WeTextProcessing, modelscope, descript-audiotools, ...)
# is heavy and pins old versions; on a GPU server install it in an isolated worker:
#   INDEXTTS_RUNTIME=1 scripts/comfy/install-comfyui.sh   (pynini 2.1.7 has a cp313 wheel; 2.1.6 must be built)
if [ "${INDEXTTS_RUNTIME:-0}" = "1" ]; then
  uv pip install --python "$PY" "pynini>=2.1.6" WeTextProcessing cn2an ffmpeg-python g2p-en jieba json5 munch textstat modelscope \
    "git+https://github.com/descriptinc/audiotools" || echo "warn: IndexTTS2 runtime deps failed to install"
fi
# Chatterbox's Perth watermarker (recommended in production for cloned voices; optional for validation):
#   uv pip install --python "$PY" resemble-perth

# ComfyUI-HunyuanVideo-Foley needs loguru; ComfyUI-Whisper (unless NC_PACKS=0) needs openai-whisper (built from sdist).
# ComfyUI-MelBandRoFormer needs rotary_embedding_torch + einops (installed above).
# ComfyUI-QwenASR: do NOT install its requirements.txt (nagisa/DyNet38 have no cp313 wheels and are unused on the
# Hugging Face path); transformers>=5.13 from ComfyUI's requirements is all it needs.
uv pip install --python "$PY" loguru
# ComfyUI-ToSVG imports vtracer (MIT), potracer and PyMuPDF (AGPL-3.0, used only by its SVG-to-image node) at load time.
uv pip install --python "$PY" "vtracer==0.6.15" "potracer==0.0.4" "PyMuPDF==1.26.5"
# ComfyUI-LTXVideo (Restore & colourise): its requirements.txt at the pinned commit. colour-science, diffusers, einops,
# huggingface_hub, kornia and transformers are already in the union above; OpenImageIO is for its HDR EXR nodes.
uv pip install --python "$PY" "ninja~=1.11.1.4" openimageio || echo "warn: ComfyUI-LTXVideo's extra requirements failed to install"
if [ "${NC_PACKS:-1}" = "1" ]; then uv pip install --python "$PY" "openai-whisper==20250625"; fi

# Optional isolated worker (never in this install or its venv): LatentSync 1.6 lipsync and ThinkSound SFX change
# process-wide state or pin old packages, so they run on a second ComfyUI with its own code copy, base directory,
# HOME and virtualenv: scripts/comfy/install-isolated-worker.sh (see README.md, "Isolated worker").
# The workflows lipsync-latentsync16 and sfx-thinksound carry "worker": "isolated" in manifest.json.

# ComfyUI-ReActor downloads ~1 GB of face-restore models into models/facerestore_models whenever that
# folder is empty -- even on a plain GET /object_info. On this validation-only (no weights) install keep a
# zero-byte placeholder there. Set REAL_MODELS=1 on a production server to skip this.
if [ "${REAL_MODELS:-0}" != "1" ]; then
  mkdir -p "$COMFYUI_DIR/models/facerestore_models"
  [ -n "$(ls -A "$COMFYUI_DIR/models/facerestore_models")" ] || touch "$COMFYUI_DIR/models/facerestore_models/placeholder_do_not_use.pth"
fi

# --- DBS weights (separate-soundtrack-dbs): 4 files, 23 MB, at the revisions docs/research/dbs-separation-7.md §3.1 read,
# into models/dbs/<model>/ (the ComfyUI-DBS loader reads config.json + model.safetensors from there), each checked with
# sha256sum -c. Small enough to fetch here; DBS_WEIGHTS=0 skips it.
if [ "${DBS_WEIGHTS:-1}" = "1" ]; then
  DBS_DIR="$COMFYUI_DIR/models/dbs"
  mkdir -p "$DBS_DIR/DBS-BSRNN-DnR" "$DBS_DIR/DBS-TIGER-DnR"
  for spec in "DBS-BSRNN-DnR 5af343f57f106fbb95efe8a60f1a3999eeb0aef8" "DBS-TIGER-DnR 22da7d4cd3ea63f9365181008bff1c0d2ab6fb2b"; do
    read -r name rev <<<"$spec"
    for f in config.json model.safetensors; do
      [ -s "$DBS_DIR/$name/$f" ] && continue
      if curl -fsSL --retry 3 -o "$DBS_DIR/$name/$f.part" "https://huggingface.co/JusperLee/$name/resolve/$rev/$f"; then
        mv "$DBS_DIR/$name/$f.part" "$DBS_DIR/$name/$f"
      else
        rm -f "$DBS_DIR/$name/$f.part"
        echo "warn: could not download JusperLee/$name/$f at $rev"
      fi
    done
  done
  (cd "$DBS_DIR" && sha256sum -c --quiet <<'SHA'
26290f93e7b501113325e922e7b0c18edca944634e6b9be39856a55204628405  DBS-BSRNN-DnR/model.safetensors
57055e2b71913d98a4e1ed426b71617f0dfc372901cc5a8a3bc4a5c69415043e  DBS-BSRNN-DnR/config.json
3d8205743f2a6f5a6704f5d4104d7cf5bf7bf02dab2fd728da31f4c69225cadb  DBS-TIGER-DnR/model.safetensors
c7f7893323e78f9b99747a13090558a13c4f4b77383a38acb9979709fd04d1d8  DBS-TIGER-DnR/config.json
SHA
  ) || echo "warn: a DBS weight file is missing or failed its SHA-256 check (delete models/dbs/<model> and re-run)"
fi
# --- end DBS weights

# --- ComfyUI-RE-USE (Clean up voice: NVIDIA RE-USE speech enhancement). Fuobe's own pack, kept in this repository at
# comfy-nodes/ComfyUI-RE-USE (MIT; the network code adapted from NVIDIA's repository keeps its OpenMDW-1.1 notices). It is
# copied from the checkout this script runs in, so it always matches this install. It needs no Python package beyond
# ComfyUI's own (no mamba-ssm). REUSE_PACK=0 leaves it out.
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ "${REUSE_PACK:-1}" = "1" ] && [ -d "$REPO_ROOT/comfy-nodes/ComfyUI-RE-USE" ]; then
  rm -rf "$COMFYUI_DIR/custom_nodes/ComfyUI-RE-USE"
  cp -r "$REPO_ROOT/comfy-nodes/ComfyUI-RE-USE" "$COMFYUI_DIR/custom_nodes/"
  rm -rf "$COMFYUI_DIR/custom_nodes/ComfyUI-RE-USE/tests"
fi
# RE-USE weights (voice-clean-reuse, voice-clean-bed-reuse): 2 files, 39 MB each, from the NemotronLabs repositories
# (OpenMDW-1.1) at pinned revisions, into models/reuse/, each checked with sha256sum -c. Never nvidia/RE-USE: that older
# release is non-commercial. The laughter model is the optional "Keep laughter". REUSE_WEIGHTS=0 skips them.
if [ "${REUSE_WEIGHTS:-1}" = "1" ]; then
  REUSE_DIR="$COMFYUI_DIR/models/reuse"
  mkdir -p "$REUSE_DIR"
  for spec in "NemotronLabs-RE-USE 31f82f2efad1095034492f236e8dac9239ba713b" "NemotronLabs-RE-USE-laughter 1b1521dd659608e1e063ada83e0acfe1da473a8b"; do
    read -r name rev <<<"$spec"
    [ -s "$REUSE_DIR/$name.safetensors" ] && continue
    if curl -fsSL --retry 3 -o "$REUSE_DIR/$name.safetensors.part" "https://huggingface.co/nvidia/NVIDIA-$name/resolve/$rev/model.safetensors"; then
      mv "$REUSE_DIR/$name.safetensors.part" "$REUSE_DIR/$name.safetensors"
    else
      rm -f "$REUSE_DIR/$name.safetensors.part"
      echo "warn: could not download nvidia/NVIDIA-$name at $rev"
    fi
  done
  (cd "$REUSE_DIR" && sha256sum -c --quiet <<'SHA'
06badaf4029b297f97f7fe48d62990b48d5482608210df577354e0d4e0ed70e1  NemotronLabs-RE-USE.safetensors
35c2a4e284515275d2e49a8e8cb5cd392ae67a1f1d345de1c12a0202c7b6b610  NemotronLabs-RE-USE-laughter.safetensors
SHA
  ) || echo "warn: a RE-USE weight file is missing or failed its SHA-256 check (delete it from models/reuse and re-run)"
fi
# --- end ComfyUI-RE-USE

echo "ComfyUI installed in $COMFYUI_DIR. Start it with: $SCRIPT_DIR/start-comfyui.sh"
