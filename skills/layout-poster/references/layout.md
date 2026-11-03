# Pixel layout draft

Adapted from OpenMOSS MOSS-Image, `skills/moss-image-prompt-enhancer/references/layout.md` at
commit 2b46b1e0e13b5aaec253879e0d006a42564b8b27. Copyright OpenMOSS. Licensed under the Apache
License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Changed for Fuobe: Fuobe
compiles the draft for each model itself, and the example is Fuobe's own.

The draft is `summary` plus a flat `items` array, in readable JSON. Fuobe turns it into each
model's own form (MOSS-Image's centred boxes, FLUX.3's layout table, Ideogram's JSON prompt).

## Fields

- `width`, `height`: positive whole multiples of 16, the size of the picture to make.
- `bbox_coord_space`: exactly `"abs"`. `bbox_format`: exactly `"xyxy"`.
- `summary`: `caption` (the whole picture, not empty), optionally `meta` (medium or genre tags)
  and `canvas` (`single`, `multi_panel` or `collage`).
- `items`: each has a `label` (`object`, `character` or `text`), a `caption` and a four-number
  `bbox`. A text item also has `text`: the exact visible characters, `\n` for a line break.
  Use separate text items when they must sit apart.
- `tags` and `palette`: optional string arrays on items (and `palette` on the summary).

Positions are on the whole canvas, text on an object included. Items may overlap.

## Example

A 768 × 1024 sale poster for a candle shop:

```json
{
  "width": 768,
  "height": 1024,
  "bbox_coord_space": "abs",
  "bbox_format": "xyxy",
  "summary": {
    "caption": "A warm autumn sale poster for a small candle shop: three lit soy candles on a wooden table, soft amber light, cream and rust palette, calm and cosy.",
    "meta": ["poster", "graphic design"],
    "canvas": "single"
  },
  "items": [
    { "label": "text", "caption": "Large bold cream serif headline with generous spacing", "text": "Autumn Glow", "bbox": [64, 48, 704, 200] },
    { "label": "text", "caption": "Rust-red rounded tag with bold white letters", "text": "30% OFF", "bbox": [256, 216, 512, 296] },
    { "label": "object", "caption": "Three lit soy candles in amber glass jars on a worn oak table, soft glow", "bbox": [112, 320, 656, 848] },
    { "label": "text", "caption": "Small cream sans-serif line, easy to read", "text": "Hand-poured in Leeds", "bbox": [192, 880, 576, 944] }
  ]
}
```

## Checks before rendering

Read every string against the wording asked for. Check the line breaks, the length and the
letter size fit each box at this resolution: a short title needs less room than a paragraph.
Make the layout bigger or simpler rather than dropping words or squeezing letters. When you
change a draft, keep what wasn't asked to change and keep one coordinate convention.
