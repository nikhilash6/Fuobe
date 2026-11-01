# Setup and self-hosting

[← README](../README.md) · [Features](FEATURES.md) · [Development](DEVELOPMENT.md) · [Status](STATUS.md)

How to install Fuobe, connect a GPU, cloud keys and local language models, and run it safely on a network.

- [Install and start](#install-and-start)
- [Engine mode and connections](#engine-mode-and-connections)
- [AI helper: local language models](#ai-helper-local-language-models)
- [Keys, data and files](#keys-data-and-files)
- [Security](#security)
- [Environment variables](#environment-variables)
- [The open-source engine (ComfyUI)](#the-open-source-engine-comfyui)

## Install and start

Fuobe runs on Windows, macOS or Linux. It needs Node 22 or later and pnpm, plus a running ComfyUI for the open engine (default address `http://127.0.0.1:8188`). Without a ComfyUI or a cloud key, a run asks you to connect one; for a tour, **Settings → Show placeholder results (for a tour)** makes every run a labelled placeholder.

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

For a production server, run `pnpm build && pnpm start` (add `-p <port>` to pick the port).

On Windows, double-click `start.bat` instead: it installs pnpm and dependencies when they're missing, rebuilds when the source changed, starts the production server and opens the browser (`start.bat dev` runs the dev server; set `PORT` for another port; if it's taken, the next free one is used).

## Engine mode and connections

Open **Settings** and pick an **Engine mode**:

| Engine mode | What the install offers | Needs |
|---|---|---|
| **Open source + paid APIs** (default) | A Cloud / Open source switch in every studio | A paid-API key and/or a ComfyUI server |
| **Open source only** | Only open-weight models on your ComfyUI; paid models are hidden and rejected by the server, and text steps never call a paid API on their own | A ComfyUI server |
| **Paid APIs only** | Only hosted frontier models; open-source models are hidden and rejected | A fal.ai or Replicate key |

The mode can also be set with `FUOBE_ENGINE_MODE=both|open|cloud`. Then connect what you have:

| You have | What to set | You get |
|---|---|---|
| A [fal.ai](https://fal.ai/dashboard/keys) key | `fal.ai API key` (or `FAL_KEY`) | Every cloud model and cloud app, and Soul ID training in the cloud |
| A Replicate token | `Replicate API token` (or `REPLICATE_API_TOKEN`) | Fallback route for models Replicate hosts; **Preferred provider** (or `FUOBE_CLOUD_PROVIDER`: `auto`, `fal` or `replicate`) picks which one goes first, unless only the other can carry the run's LoRAs or make the clip length asked |
| A GPU running ComfyUI | `ComfyUI server URL` (or `COMFYUI_URL`, default `http://127.0.0.1:8188`; `COMFYUI_TOKEN` if it sits behind a proxy) | Every open-source model, app, motion, effect and studio route |
| An Anthropic key | `Anthropic API key` (or `ANTHROPIC_API_KEY`) | The full **Assist** agent (Smart and Manual modes, scheduled tasks that plan with Claude, and your MCP connectors), text steps (translate, write, scripts, ad copy, brand research), prompt **Enhance**, storyboard splitting, Genjutsu's "Describe my character", Evolution's "Write it for me" in the cloud and the skill builder's name suggestions with Claude |
| [Ollama](https://ollama.com) | **AI helper** → Local model server → Ollama or Automatic (`OLLAMA_URL`, `OLLAMA_MODEL`, default `qwen3:8b`) | The same text steps and the Assist agent on a local model (tool calling) |
| [LM Studio](https://lmstudio.ai) 0.4 or later | **AI helper** → LM Studio or Automatic (`LMSTUDIO_URL`, default `http://127.0.0.1:1234`; `LMSTUDIO_MODEL`, empty for the loaded model; `LMSTUDIO_API_TOKEN` only when its Require Authentication is on). In LM Studio, start the server (Developer → Start server, or `lms server start`) and download a model (`lms get qwen/qwen3-8b`) | The same on LM Studio. A model that isn't loaded yet is loaded with 16k context (`FUOBE_LLM_CONTEXT`), which Assist's tools need |
| [Unsloth Studio](https://unsloth.ai/docs/new/studio/install) | **AI helper** → Unsloth Studio or Automatic (`UNSLOTH_URL`, default `http://127.0.0.1:8888`; `UNSLOTH_API_KEY`: an `sk-unsloth-…` key from avatar → Settings → API; `UNSLOTH_MODEL`, empty for the loaded model). Load a model on its Chat page | The same on the model loaded in Unsloth Studio. Its server-side tools (Python, terminal, web search) are always off for Fuobe's calls |
| Another OpenAI-compatible server (llama.cpp's llama-server, vLLM, Jan…) | **AI helper** → Other (`FUOBE_LLM_URL`, the base URL such as `http://127.0.0.1:8080/v1`; `FUOBE_LLM_MODEL`; `FUOBE_LLM_API_KEY`) | The same on that server |
| A LoRA folder (and a civitai account) | **Settings → LoRAs**: `LoRA folder`, ComfyUI's `models/loras` (or `COMFYUI_LORAS_DIR`), and `civitai API key` (or `CIVITAI_API_KEY`) | Fuobe downloads a LoRA ComfyUI doesn't have before the run and checks its fingerprint. 72 of the 118 library LoRAs are on civitai and need the key, which is never sent to fal or Replicate. 87 of Fuobe Soul's looks and 6 of Mixed Media's use one, and 36 of the motions' and effects' LoRA files are among them |
| AI-Toolkit (ostris) on your GPU | **Settings → Training · AI-Toolkit**: its address, an optional token and a photos folder (a full path), each with Save & test (or `AI_TOOLKIT_URL`, `AI_TOOLKIT_AUTH`, `AI_TOOLKIT_DATASET_DIR`), and `COMFYUI_LORAS_DIR` | Free Soul ID training of characters and styles from an element's photos or a moodboard, on Z-Image Turbo, Qwen-Image 2512, FLUX.1 [dev], FLUX.2 [dev] or FLUX.2 [klein] 4B (AI-Toolkit downloads the base weights itself; the FLUX [dev] repos need a Hugging Face token). Fuobe keeps the LoRA and copies it into ComfyUI (from an AI-Toolkit on another machine, copy it by hand). The training dialog can also download a training kit to run anywhere |

## AI helper: local language models

**AI helper** picks who writes: Automatic (Claude when a key is set, else a local model, else the offline rewriter), Claude, a local model only, or offline (`FUOBE_ENHANCE_PROVIDER=auto|anthropic|local|none`; the old value `ollama` means `local`). Its local model server is Automatic by default (`FUOBE_LLM_PROVIDER=auto`): the first one that answers with a model, in the order Ollama, LM Studio, Unsloth Studio, then the Other URL. `FUOBE_LLM_PROVIDER=ollama|lmstudio|unsloth|custom` pins one. Settings → AI helper shows what each server answers (its models, whether one is loaded, what's missing) and has a **Send a test message** button for each server, which proves its model answers. The local model shares the GPU with ComfyUI, so a 4–8B model leaves room for generations.

Each connection field in Settings has **Save & test**: what you typed is tested before it is saved, and a failure says why. Until something is connected (or you hide it), Home and Settings show a **Get started** card with the three ways in.

## Keys, data and files

Keys (and Assist connectors' URLs and tokens) are stored in a local SQLite database (`data/fuobe.db`) and never sent to the browser in full. Generated media is saved under `data/files/`, and LoRAs downloaded only to copy them to fal or Replicate, and your trained Soul ID LoRAs, under `data/loras/`. One person owns a Fuobe studio. With public sign-up on, other people can make free accounts that run on their own GPU; you see what they make in **Settings → Accounts** ([public-signup.md](public-signup.md)).

## Security

Before you open Fuobe to a network, set a password (**Settings → Security**, or `FUOBE_PASSWORD`): every page and API call then needs a sign-in or an API token (`Authorization: Bearer fuobe_…`), which you create on the same page for scripts and MCP clients:

```bash
claude mcp add --transport http fuobe http://localhost:3000/api/mcp --header "Authorization: Bearer fuobe_…"
```

Share links are the one exception: `/s/<token>` and its files open for anyone who has the link, after the host and cross-site checks. Without a password, anyone who can open a share link can open the whole studio too.

A sign-in lasts 30 days. If you think someone else has signed in as you, open **Settings → Security** and press **Sign everyone out**. It ends every sign-in on every device, yours included (an open live feed too), and can revoke every API token too. Your password stays the same. A new password also ends every owner sign-in: a Settings password change at once (it signs accounts out too), and a new `FUOBE_PASSWORD` when the server restarts (accounts stay signed in). API tokens are not tied to the password: revoke them in **Settings → Security**, or tick **Also revoke every API token** when you sign everyone out.

Public sign-up, guest browsing and connecting your own GPU to a shared install are described in [public-signup.md](public-signup.md).

## Environment variables

| Variable | What it does |
|---|---|
| `FUOBE_PASSWORD` | Turns sign-in on; a password set this way can't be changed from Settings |
| `FUOBE_ALLOWED_ORIGINS` | Extra hosts Fuobe is reached at, comma-separated. Without a password, Fuobe answers only on IP addresses, localhost, single-label and LAN names (`.local`, `.lan`, `.home.arpa`, `.internal`) and the machine's hostname; add any other domain (a reverse proxy, a tunnel, a Tailscale name), or `*` to turn the check off. Also counts as "same site" for the cross-site write check behind a proxy that forwards neither Host nor X-Forwarded-Host |
| `FUOBE_TRUST_PROXY=1` | Behind a reverse proxy: trust the last `X-Forwarded-For` hop, so wrong passwords, and too many wrong share links, lock out only that visitor (60 s). Without it, everyone shares one limit: passwords are slowed to one attempt every 4 s and never locked, and wrong share links past 100 a minute get 429 while real links still open |
| `FUOBE_ALLOW_PRIVATE_URLS=1` | Let inputs, product links and project sources be fetched from private / LAN addresses (they are refused by default), and let Assist connectors use plain http beyond localhost (without it a connector needs https unless it is on localhost; a private https address is accepted, with a warning that Claude can only reach it through a public tunnel) |
| `FUOBE_DATA_DIR` | Where the database, files and `auth.json` live (default `./data`). Back up `secrets.key` there with `auth.json`: it opens the fal.ai and Replicate keys accounts saved ([Your keys](public-signup.md#your-keys)), which must be added again without it |
| `FUOBE_DEMO_MODE` | `off` (default: a run with nothing connected asks you to connect one) or `on` (placeholder results, for a tour: every run makes a labelled placeholder). The old `auto` reads as `off`, and a saved `auto` is cleared on start |
| `FUOBE_SKILLS_DIR` | Where Assist's built-in skills are read from (default `./skills`) |
| `FUOBE_ENGINE_MODE`, `FUOBE_CLOUD_PROVIDER`, `FUOBE_ENHANCE_PROVIDER`, `FUOBE_LLM_PROVIDER` | The Settings choices above |
| `FUOBE_LLM_CONTEXT` | Tokens of context for the local model (default `16384`): Ollama's `num_ctx`, and the context LM Studio loads a model with. `0` leaves it to the server |
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | Read into Settings; no feature uses them yet |
| `FUOBE_HOSTED_RUNS=1` | With public sign-up: accounts with no GPU of their own may run on this install's ComfyUI ([Hosted runs](public-signup.md#hosted-runs)). Off by default |
| `FUOBE_POOL_WAIT_MIN` | How long a hosted run may wait in line, in minutes (default `30`) |
| `FUOBE_BILLING_URL`, `FUOBE_BILLING_TOKEN` | An optional external billing service for hosted runs ([billing-hook.md](billing-hook.md)). None: hosted runs are free |
| `FUOBE_MODERATION_URL`, `FUOBE_MODERATION_TOKEN`, `FUOBE_MODERATION_MAX_WAIT_H` | An optional external moderation service ([moderation-hook.md](moderation-hook.md)). None: nothing is checked |

Uploads up to 200 MB work with sign-in on; Split soundtrack's Export mix sends its WAV in 16 MB parts, up to 2 GiB. Inputs given as URLs are fetched only from public addresses unless `FUOBE_ALLOW_PRIVATE_URLS=1`.

## The open-source engine (ComfyUI)

1. Install ComfyUI on a machine with a GPU (24 GB VRAM covers almost every workflow; Z-Image Turbo, Wan 2.2 5B and SDXL run in 8–16 GB; VOID, Remove object's "Shadows and reflections too", may need up to 40 GB, Fuobe DoP · LTX's LTX-2.3 graphs 32 GB, the MiniMax H3 graphs of Character swap and the Character Swap Studio 24 GB with offloading and 64–128 GB of RAM, 48 GB+ advised, and Cinema's fly path (Wan 2.1 + Uni3C) about 48 GB, the library's highest; none of these was measured here). `scripts/comfy/install-comfyui.sh` installs ComfyUI and 17 custom node packs at pinned commits (the ones Fuobe was validated with; the H3 graphs aren't validated yet), the non-commercial ComfyUI-Whisper (`NC_PACKS=0` leaves it out), Akatz Labs' GPL-3.0 `h3_character_swap` (`H3_PACK=0` leaves it out) and ComfyUI-DBS (MIT, for Split soundtrack) included; `H3_RELAY=1` adds H3 Relay 2.0 (Genjutsu's Relay swap, H3 Person Removal and the Character Swap Studio). The script also fetches Split soundtrack's four DBS model files (23 MB) into `models/dbs/` and checks their SHA-256 (a mismatch only warns); `DBS_WEIGHTS=0` skips them, but then Split soundtrack can't run. Settings → Models & licences switches packs and models off per install.
2. Open **ComfyUI workflows** in Fuobe. Each workflow lists the model files it needs, which are already installed (✓) and a **Copy install commands** button that produces the exact `wget` / `git clone` lines (making a file's subfolder first, such as `models/dbs/DBS-TIGER-DnR/`).
3. Switch the engine toggle (top-right of every studio) to **Open source**.
4. For LoRAs (Fuobe Soul's and Mixed Media's looks, camera motions, effects, trained Soul IDs, Character swap's LoRAs, the adapters Fuobe Try-On, Angles, Speak and Popcorn load), set **Settings → LoRAs → LoRA folder** to ComfyUI's `models/loras`, and add a civitai key for civitai files. Fuobe then downloads a LoRA ComfyUI doesn't have before the run.

LatentSync 1.6 and ThinkSound are optional and run on a separate, isolated ComfyUI (`scripts/comfy/install-isolated-worker.sh`, port 8189); see [`scripts/comfy/README.md`](../scripts/comfy/README.md). Lipsync offers LatentSync 1.6 and Sound effects offers ThinkSound, marked in the model picker as running on the isolated worker. Set its address as **Isolated worker URL** in Settings (or `COMFYUI_ISOLATED_URL`); without it, those jobs fail with a message naming the setting. Their workflows are validated, but not run with real weights. Open dubbing, Faceless and UGC narration clone a voice with Chatterbox, so they need a voice sample (record or upload one). Open-source translation uses the local model (Settings → AI helper) when one is ready, and Qwen3.5 4B on your ComfyUI when none is.

**Split soundtrack** runs only on your ComfyUI (nobody hosts DBS). On Windows or ComfyUI Desktop, where the install script doesn't run, clone `hiroki-abe-58/ComfyUI-DBS` into `custom_nodes` and check out `f656e53`, then put `config.json` and `model.safetensors` from `JusperLee/DBS-BSRNN-DnR` and `JusperLee/DBS-TIGER-DnR` into `models/dbs/<that name>/` (the Workflows page's "Split a soundtrack" card lists them). DBS runs on a CPU too: Best is preselected on a CUDA GPU (NVIDIA, or AMD with ROCm), Fast anywhere else. The Comfy Registry flags the pack's only version without giving a reason; its code was read at the pinned commit. **MOSS-Image** and the **fly path** use only nodes built into the ComfyUI version Fuobe pins (0.41.0), so an older ComfyUI may not run them. MOSS-Image's int8 files run on kernels that need a PyTorch built for CUDA 13 (cu130); without it ComfyUI logs a warning and probably runs slower (untested). The turnaround video needs no new files: it uses Frames mode's Wan 2.2 14B graphs and the Angles app's Qwen-Image-Edit 2511 with the Multiple-Angles LoRA. **Connect your GPU** (`/connect`) shows what each of them still needs on your ComfyUI.

To check a ComfyUI connection end to end without downloading any models:

```bash
pnpm dev &
pnpm test:e2e:comfyui http://localhost:3000   # runs the weight-free workflows through the full pipeline (mux, trim, segment, captions, meta-batch), checked with ffprobe when installed
node tests/e2e/comfyui-faceless-plus.mjs http://localhost:3000   # Ken Burns, the packet-copy join, a crossfaded audio loop and join; needs ffmpeg and ffprobe and demo mode off; on Linux it also samples ComfyUI's memory (found with pgrep, or set COMFYUI_PID)
node tests/e2e/comfyui-canvas-concat.mjs http://localhost:3000   # the Canvas Video concatenator: three test clips are cut, framed to 9:16 at 30 fps and joined, then the film is probed; model-free, needs ffmpeg and ffprobe
```
