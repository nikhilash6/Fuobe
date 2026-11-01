---
name: thumbnail-generation
description: Cinematic, click-worthy YouTube and Instagram thumbnails and video covers, from concept to a final high-resolution frame with short bold text.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Thumbnail Generator
  when_to_use: The user asks for a thumbnail, a video cover, a "video preview" image, a YouTube cover or a Reels cover.
  icon: youtube
  studio: /image
  tags: youtube, thumbnail, cover
  offline_kind: image
  offline_aspect: "16:9"
  offline_outputs: "3"
  offline_style: "high-contrast cinematic YouTube thumbnail, one clear focal subject, expressive face, dramatic rim light, bold readable headline text, uncluttered background, vivid colour grading"
---

# Thumbnail Generator

A thumbnail has one job: make someone stop scrolling. One subject, one emotion, one idea, at
most 4 words of text.

## 1. Concept (decide before generating)
- Ask for the video's title or topic if it isn't in the message. If the user has a photo of
  themselves (attachment or `@character`), the face goes in the thumbnail.
- Write 3 distinct concepts, one line each: the subject, the emotion, the visual hook (contrast,
  before/after, a huge object, a question), and the 2–4 word text. Pick all three to render unless
  the user wants one.

## 2. Composition rules
- 16:9 for YouTube (1280×720 minimum; ask the model for 2K when listed), 9:16 for Reels/Shorts
  covers, 4:5 for Instagram feed.
- Subject on the left or right third, face large (40–60% of the height), eyes toward the text or
  the hook. Text on the opposite side, big, 1–2 lines, high contrast with a stroke or shadow.
- Strong separation: rim light, a darker or blurred background, saturated accent colour.
- Nothing important in the bottom-right corner (YouTube puts the duration there).

## 3. Models
- Text in the image: cloud `ideogram-4-5` or `nano-banana-pro` (both render short headlines
  well), `gpt-image-2-5` for complex scenes. Open: `oss-qwen-image` (best open text rendering).
- With the user's face: op `edit` with their photo in `images` ("use the person from the photo,
  same face") on `nano-banana-pro` / `oss-qwen-image-21` (`oss-qwen-edit` after it).
- Put the exact headline in quotes in the prompt and say "the only text in the image".

## 4. Finish
`check_generations` with `look: true`: reject any take with misspelled text or a cut-off face and
redo it. Offer an upscale (op `upscale-image`) of the winner and an A/B pair with a different
headline.

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `generate` with the three concepts in one call, then
`check_generations` with `look: true`. Price a run with `estimate_cost` (or `estimate_job` for a
studio tool) and confirm it with the user first. Files go in as URLs: `fuobe upload <file>` prints
one. Without MCP, the `fuobe` CLI runs the same jobs (`fuobe generate`, `fuobe tool <name>`).
