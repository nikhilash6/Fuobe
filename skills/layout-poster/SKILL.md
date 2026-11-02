---
name: layout-poster
description: Plan a poster, ad or cover as a layout of boxes (a headline, a product, a price, a button) with the exact words, and render it with an image model that places boxes. Use for text placement, posters, sale ads, menus and covers where the words and the subject must land in given places.
license: Apache-2.0 (adapted from OpenMOSS MOSS-Image's prompt-enhancer skill; see the notice at the end)
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the generate tool on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Layout Poster
  when_to_use: The user wants a poster, a sale ad, a flyer, a menu or a cover with exact words in given places ("a sale poster for my candle shop, 30% off"), or asks for a layout.
  icon: layout-grid
  studio: /image
  tags: layout, poster, text, ads, design
  offline_kind: image
  offline_aspect: "3:4"
  offline_outputs: "2"
  offline_style: designed poster with a bold headline at the top, the product in the middle and a call-to-action button at the bottom, clean graphic design
---

# Layout Poster

Turn the user's idea into a layout: one box per thing to place, each with what it looks like,
and the exact words for the text boxes. A model that places boxes then draws each in its place.
Read [references/layout.md](references/layout.md) before writing the draft.

## 1. Decide the deliverable
- Use a layout when exact text placement, a poster, several panels or controlled positions help.
  An ordinary scene or photo needs only a good prompt: skip the layout then.
- Keep the user's subject, counts, style and the words they want shown, verbatim (spelling,
  capitals, punctuation, language). Write real copy, never "headline here". Don't invent facts
  (dates, prices, addresses) the user didn't give; ask only when a missing decision changes the
  picture a lot.

## 2. Pick the canvas
- Use the size the user gives; with only an aspect ratio, pick pixels of that shape; otherwise
  1024 × 1024, or 768 × 1024 (3:4) for a poster. Both sides are multiples of 16.

## 3. Write the draft
- Pixel boxes from the top-left corner: `[x_min, y_min, x_max, y_max]`, x within 0..width and
  y within 0..height, `bbox_coord_space: "abs"`, `bbox_format: "xyxy"`. Never 0-1 fractions,
  never centred boxes: Fuobe converts them for the model.
- `summary.caption` describes the whole picture: subject, setting, medium, light, palette, mood.
- Usually 3 to 6 boxes: a headline (large), supporting words (smaller), the product or person,
  a price tag or a button. A box is a placement, not a border or a panel to draw.
- A text item's `caption` describes its lettering (size, weight, colour, typeface style); its
  `text` holds the exact words, with `\n` for a line break you want. Check every string fits its
  box at that size: a long line needs a wide box.

## 4. Render it
Call `generate` with the draft as the job's `layout` and the whole picture as its `prompt`:
- Your GPU: `oss-moss-image` (MOSS-Image, free).
- Cloud: `moss-image` (MOSS-Image on fal), `ideogram-4-5` or `flux-3`: each draws the exact text
  in place. Fuobe turns prompt rewriting off for a layout.
- Other models read the layout as sentences, not exact positions: say so if the user picks one.
Show the user the boxes in words (what goes where) with the price before running. Layout
prompts are experimental: the boxes guide the picture, they don't pin it.

In the Image studio the same draft opens in Layout mode, where **Plan layout** writes a first
draft from a sentence and the user drags the boxes; Canvas has a Layout node, and Marketing and
Ads Studio offer "Words drawn by the model".

## Using Fuobe from an agent
The `generate` tool on Fuobe's MCP endpoint takes the same `layout` field.

---
Adapted from OpenMOSS MOSS-Image, `skills/moss-image-prompt-enhancer/SKILL.md` and
`references/layout.md` at commit 2b46b1e0e13b5aaec253879e0d006a42564b8b27
(https://github.com/OpenMOSS/MOSS-Image). Copyright OpenMOSS. Licensed under the Apache
License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Changed for Fuobe: the
compile step runs inside Fuobe, the models and tools are Fuobe's, and the text was shortened.
