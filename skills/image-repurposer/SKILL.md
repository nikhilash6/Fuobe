---
name: image-repurposer
description: One creative in, a ready pack for every platform out — resize or expand an existing image to new aspect ratios, build platform packs, swap text or offers inside the image, localise in-image text, and make subject-swap variants of a master template.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Image Repurposer
  when_to_use: Fires only when the user supplies an existing image and wants it adapted ("make this work for Stories", "a version for every platform", "translate the text in this ad", "same ad with our new product"). Not for new images from scratch.
  icon: layout-grid
  studio: /edit
  tags: resize, platforms, localisation
  offline_kind: image
  offline_outputs: "1"
  offline_style: "keep the original design, subject, typography and colours exactly; extend the background naturally to fill the new frame"
---

# Image Repurposer

The original is the source of truth: keep the subject, layout logic, brand colours and type style.
Only the frame, the language or the swapped element changes.

## Platform sizes (aspect ratios)
| Platform | Ratios |
|---|---|
| Instagram feed | 4:5, 1:1 |
| Instagram / Facebook Stories, Reels, TikTok, YouTube Shorts | 9:16 |
| YouTube thumbnail, X post, LinkedIn post | 16:9 |
| Pinterest | 2:3 |
| Facebook / LinkedIn feed | 1:1, 4:5 |
For "a pack for every platform" make 9:16, 4:5, 1:1 and 16:9 (four jobs in one `generate` call).

## Resizing without cropping the subject
- Use op `edit` with the image in `images` and the new `aspect_ratio`, prompt: "Extend this exact
  image to <ratio>: keep everything that's already there unchanged and in place; continue the
  background naturally; move nothing; keep all text exactly as written." Cloud `nano-banana-pro`
  (takes many ratios), open `oss-qwen-image-21` (`oss-qwen-edit` after it); for pure canvas extension
  on open source, `oss-qwen-image-21` with op `outpaint` (`oss-flux-fill` after it).
- When going much taller (16:9 → 9:16), the headline may need to move: say "re-arrange the text
  block to sit in the top third, same font and colours" instead of "move nothing".

## Text swaps and localisation
- Quote the old and the new text exactly: "Replace the headline “Summer Sale” with “Soldes d'été”,
  same font, size, colour and position; change nothing else". One job per language.
- Translate the copy yourself (or with a `translate` job) before editing; keep brand names untranslated.
- Text-heavy creatives render best on `ideogram-4-5` (op `edit`) or `nano-banana-pro`.

## Subject swaps (master template)
Pass the template first and the new product or person second in `images`: "Replace the product in
the first image with the product from the second image, matching the lighting and perspective;
keep the layout, text and background."

## Check
`check_generations` with `look: true`; reject takes where text changed, got misspelled or the
subject was cropped. Name each file's platform in your reply.

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `generate` with one job per ratio or language, then
`check_generations` with `look: true`. Price a run with `estimate_cost` (or `estimate_job` for a
studio tool) and confirm it with the user first. Files go in as URLs: `fuobe upload <file>` prints
one. Without MCP, the `fuobe` CLI runs the same jobs (`fuobe generate`, `fuobe tool <name>`).
