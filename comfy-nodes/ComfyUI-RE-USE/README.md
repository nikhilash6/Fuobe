# ComfyUI-RE-USE

ComfyUI nodes for **NVIDIA NemotronLabs RE-USE**, a universal speech enhancement model (9.6M parameters, 39 MB). It
removes noise, echo, clipping, codec damage and the limits of a poor mic or a phone line, and keeps the main
speaker. Run above the source's rate, it fills the empty high band (bandwidth extension). Fuobe's "Clean up voice"
runs on it.

- No `mamba-ssm` and no `causal-conv1d`. The Mamba layer is plain PyTorch with the same parameter names, so the
  published weights load unchanged. The selective scan uses Triton on CUDA and numba on the CPU when they are
  importable (most ComfyUI installs have both), else a PyTorch loop. A Triton that imports but can't compile (no
  Python headers, or a build that doesn't fit torch or the GPU) falls back to the loop once, with a line in the log.
  The node does not install anything.
- Works on Windows and Linux, on an NVIDIA GPU or a CPU.
- Requirements: ComfyUI 0.42 or later, Python 3.10 or later, torch 2.x and torchaudio (all part of ComfyUI).

## Install

Copy this folder into `ComfyUI/custom_nodes/ComfyUI-RE-USE`, put the weights in `ComfyUI/models/reuse/`, and restart
ComfyUI. Fuobe's Workflows page and GPU board print the exact commands (a sparse checkout of this folder at a pinned
commit).

| File in `models/reuse/` | Download (pinned revision) | Bytes | SHA-256 |
|---|---|---|---|
| `NemotronLabs-RE-USE.safetensors` | https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE/resolve/31f82f2efad1095034492f236e8dac9239ba713b/model.safetensors | 38,592,940 | `06badaf4029b297f97f7fe48d62990b48d5482608210df577354e0d4e0ed70e1` |
| `NemotronLabs-RE-USE-laughter.safetensors` (optional: keeps laughs and breaths a little more) | https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE-laughter/resolve/1b1521dd659608e1e063ada83e0acfe1da473a8b/model.safetensors | 38,592,940 | `35c2a4e284515275d2e49a8e8cb5cd392ae67a1f1d345de1c12a0202c7b6b610` |

Use only these two NemotronLabs repositories (OpenMDW-1.1). The older `nvidia/RE-USE` repository is a research
release under NVIDIA's non-commercial licence.

## Nodes

**Load RE-USE** (`REUSELoader`): `model` (a file in `models/reuse`), `device` (auto, cuda, cpu). The loader refuses a
file that is not a RE-USE model.

**Clean up voice** (`REUSEEnhance`):

| Input | What it does |
|---|---|
| `rate` | The rate the model runs at: `source`, `source up to 24000` / `16000` (the source's rate, capped), or 8 to 48 kHz. Lower runs faster and gives a band-limited result. Higher than the source is bandwidth extension. |
| `pre_lowpass` | Resample down to this rate first (NVIDIA's demo does this before bandwidth extension). |
| `channels` | `mono` (the mean of the channels) or `each channel`. More than 2 channels always run in mono. |
| `chunk_seconds` | 0 = from the free memory (2 to 20 s on CUDA; 10 s on a CPU, 5 s at 32 kHz or more). |
| `overlap_seconds` | The crossfade at each join (1 s). Cancel works between chunks. |
| `room_tone_db` | Mixes the original in under the clean voice at this level (-60 = off), so the gaps between words are not dead silent. |
| `level` | `match input` (the model's output is about 3 dB quieter; this puts the speech level back), `-16 LUFS` (voice-over), or `off`. The peak is kept at or under -1 dBFS. |
| `bed`, `bed_db` | Optional music and effects to mix back under the clean voice (for a video's soundtrack, with a separator such as DBS). |

Outputs: `audio`, and `report` (JSON: model, device, scan, rates, chunk, seconds, time taken, times real time, the
level gain and the peak VRAM).

## Speed (RTX 5090 and i9-13900K, both shared with other work, so these are worst cases)

| Device | 8 kHz | 16 kHz | 24 kHz | 44.1 kHz | 48 kHz |
|---|---|---|---|---|---|
| CUDA with Triton (seconds of work per second of audio) | 0.13 | 0.26 | 0.4 | 1.3 | 1.4 |
| CPU with numba | 2 | 4 | 5 | 13 | 15 |

Without Triton, CUDA is about 6x slower. A CPU is good for voice samples and short clips; a long video soundtrack wants
a GPU or a lower rate. Memory is about 0.35 GB plus 0.13 GB per second of chunk at 16 kHz (more at higher rates): the
whole file, the result and the crossfade weights stay in system memory, and only one chunk is on the GPU at a time.

## Tests

In a venv of its own (never a live ComfyUI's Python): `python -I -m pytest -q tests`. The real-weight tests run when
`RE_USE_WEIGHTS` (and the other variables named in `tests/test_real_weights.py`) are set.

## Licence

The pack's code is MIT (`LICENSE`). The network code is adapted from NVIDIA's RE-USE repository (OpenMDW-1.1): see
`NOTICE` and `LICENSE.OpenMDW-1.1-NVIDIA`. The plain-PyTorch Mamba layer matches the reference maths numerically, but
it is not NVIDIA's code path. The weights are NVIDIA's, under OpenMDW-1.1 (the model card says "ready for commercial
use"; its safety section points to the NVIDIA Open Model License for use-case limits).
