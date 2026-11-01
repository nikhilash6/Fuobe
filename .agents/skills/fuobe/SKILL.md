---
name: fuobe
description: Make images, videos, audio, 3D models and text with a Fuobe studio — paid cloud models (Nano Banana Pro, Seedance, Kling, Veo, ElevenLabs…) or open-source models on ComfyUI — from a coding agent, through Fuobe's MCP tools or the fuobe CLI. Use when the user asks to generate, edit, animate, voice, dub or upscale media with Fuobe.
compatibility: Needs a running Fuobe server, reached through its MCP endpoint (/api/mcp) or the fuobe CLI (Node 20+). With a password set on the server, an API token from Settings → Security.
metadata:
  title: Fuobe
  when_to_use: The user names Fuobe, or asks for an image, video, voice-over, music, sound effect, 3D model, dub or caption job and Fuobe is connected (its MCP tools are listed, or `fuobe status` answers).
  tags: fuobe, generate, image, video, audio
---

# Fuobe

Fuobe is a self-hosted AI studio: every job runs on a paid cloud model (with the user's own keys) or
an open-source model on their GPU (ComfyUI). Results land in the Fuobe Library as files on that server.

## 1. Connect (once)
- **MCP (preferred).** If tools named `search_models`, `estimate_cost`, `generate` and
  `check_generations` are listed, use them. If not, ask the user to run `fuobe mcp` and paste the
  command it prints (Claude Code: `claude mcp add --transport http fuobe http://localhost:3000/api/mcp`),
  then restart the session.
- **CLI.** `fuobe status` prints the server, its engine mode and providers. "Can't reach Fuobe"
  means the server isn't running (`pnpm dev` in the Fuobe folder, or set `FUOBE_URL`); a request
  for a token means the user runs `fuobe login` with a token from Settings → Security.

## 2. Pick a model
`search_models` (kind `image`, `video`, `audio`, `text` or `model3d`, plus words) or
`fuobe models --kind video --search kling --json`. When the user doesn't care, the studios' own picks:
images `nano-banana-pro` (cloud) / `oss-ideogram-4` (open; `oss-qwen-image-21` when no local model
writes its caption); edits `nano-banana-pro` / `oss-qwen-image-21`;
video `seedance-2-5` / `oss-wan22-14b-fast`; speech `elevenlabs-v4` / `oss-chatterbox` (it speaks in
a cloned voice, so it needs a voice sample: `voice_audio`, or `--voice-audio` on the CLI). In the
user's own voice on the cloud: `chatterbox-cloud` (the CLI picks it for `--kind audio --voice-audio`).
Open models cost nothing but GPU time; cloud models are billed by the user's provider.

## 3. Price, confirm, run
- MCP: `estimate_cost` with the arguments you'd give `generate`; tell the user the price and wait
  for a yes; then `generate`. Poll `check_generations` with `wait_seconds` (up to 120) for the URLs.
- CLI: `fuobe estimate "<prompt>" --model <id> …`, then
  `fuobe generate "<prompt>" --model <id> --image ./photo.png --aspect 16:9 --duration 5 --out ./renders --json`
  (`--out` waits and saves the files; `--wait` waits and prints the URLs).
- A result marked demo means Settings → Placeholder results is on (for a tour): say it's
  placeholder media.

## 4. Files
- Inputs: the CLI's `--image`, `--video` and `--audio` take local paths (uploaded for you) or links.
  MCP tools take URLs: `fuobe upload ./photo.png` prints a `/api/files/…` URL to pass.
- Outputs are URLs on the Fuobe server. `fuobe download <id> --out .` saves them; text results
  (transcripts, translations, scripts) come back inline.

## 5. Whole studio jobs and playbooks
- Studio tools — `katana`, `dub_video`, `faceless_episode`, `split_layers`, `restyle_footage`,
  `create_ads`, `add_captions` — are priced with `estimate_job`. Without MCP:
  `fuobe tool <name> '<json arguments>'` (`fuobe tool <name> --schema` lists the arguments).
- Fuobe's playbooks for whole jobs (UGC videos, product photos, thumbnails, short films, dubs…)
  are skills: `list_skills` / `load_skill` over MCP, or install them next to this one with
  `npx skills add workingprototype/Fuobe`.
