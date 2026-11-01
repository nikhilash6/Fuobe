---
name: amazon-listing-images
description: A compliant marketplace listing image set from the user's product photo — the main image on pure white, secondary images (lifestyle, features, dimensions, in-the-box) and A+ content modules.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Amazon Listing Designer
  when_to_use: The user sells on Amazon, Etsy, eBay, Shopify or another marketplace and wants listing images, a "main image", "secondary images", "A+ content" or "product cards that sell".
  icon: shopping-bag
  studio: /marketing?template=mk-clean-listing
  tags: amazon, marketplace, listing, ecommerce
  offline_kind: image
  offline_aspect: "1:1"
  offline_outputs: "2"
  offline_style: "e-commerce main image: the product alone on a pure white background (RGB 255,255,255), filling about 85% of the frame, soft natural shadow, accurate colours, sharp, no text, no props, no logos other than the product's own"
---

# Amazon Listing Designer

## Main image rules (suppressed listings come from breaking these)
- Pure white background (RGB 255, 255, 255), the product fills ~85% of a square frame.
- Only the product that's sold: no props, no added text, badges, watermarks or borders.
- The real product, photographed look, accurate colour; no illustration.
- At least 1600 px on the long side (upscale with op `upscale-image` if needed).

## The set (7 images, one `generate` call)
1. **Main** — rules above. Op `bg-remove` (`birefnet-cloud` / `oss-rmbg`) first if the photo has a
   background, then op `edit` onto pure white with a soft contact shadow (`after` the cut-out).
2. **Lifestyle** — the product in use by its target customer, 1:1.
3. **Key benefits** — the product with 3 short callouts and simple icons ("Leak-proof", "BPA-free",
   "Keeps cold 24 h"); quote each callout exactly.
4. **Dimensions** — the product with clean dimension lines and the real measurements (ask for them
   if unknown — never invent numbers).
5. **In the box** — everything included, laid out flat-lay style, labelled.
6. **Detail / material** — a macro of the texture or the mechanism.
7. **Comparison or social proof** — "Ours vs. ordinary" or a rating card (only claims the user gave).

## Models
`nano-banana-pro` for every step (product fidelity + text), `ideogram-4-5` for text-heavy
infographics. Open source: `oss-qwen-image-21` (`oss-qwen-edit` after it); `oss-qwen-image` for text layouts. Product photo
always in `images`.

## A+ modules (if asked)
Banner 970×600 (≈ 16:10) with brand story, a 4-up feature row (1:1 tiles), and a comparison chart
image. Same palette and type across modules.

## QC
`check_generations` with `look: true` on every image: white background really white, no invented
claims, text spelled right, product not altered. State any rule a result breaks and redo it.

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `generate` with the whole set in one call (the main image
`after` its cut-out), then `check_generations` with `look: true` for the QC pass. Price a run with
`estimate_cost` (or `estimate_job` for a studio tool) and confirm it with the user first. Files go
in as URLs: `fuobe upload <file>` prints one. Without MCP, the `fuobe` CLI runs the same jobs
(`fuobe generate`, `fuobe tool <name>`).
