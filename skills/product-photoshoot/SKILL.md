---
name: product-photoshoot
description: Studio product photos without a studio — packshots on clean backgrounds, lifestyle scenes, banners, model try-ons, CGI and restyles, from the user's own product photo.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Product Photographer
  when_to_use: The user wants product photos, a packshot, e-commerce or catalog images, lifestyle shots of a product, or "make my product look premium". Not for ads with headlines (use marketing-studio-cards) or marketplace listing sets (use amazon-listing-images).
  icon: package
  studio: /marketing
  tags: product, ecommerce, photo
  offline_kind: image
  offline_aspect: "1:1"
  offline_outputs: "4"
  offline_style: "professional studio product photograph, the product as the hero, seamless backdrop, soft key light with a gentle rim light, crisp reflections, accurate colours and label, sharp focus, 100mm macro lens"
---

# Product Photographer

Turn one product photo into a set of studio-quality images. The product must stay exactly the
same — shape, colours, label text, logo — only the scene changes.

## 1. Get the product
- Use the product photo the user attached. If there's none, check `list_elements` for a saved
  product (write its `@handle` in prompts) or `list_recent` for an earlier upload. If there is
  still nothing, ask for one clear photo (front-facing, even light, no hands).
- If the photo has a busy background and the user wants pure packshots, start with a cut-out:
  a `generate` job with op `bg-remove` (cloud `birefnet-cloud`, open `oss-rmbg`), then chain the
  scene edits on it with `after`.

## 2. Plan the set
Unless the user says otherwise, make 4 shots in one `generate` call (one job per shot, so each
gets its own prompt):
1. **Hero packshot** — seamless white or light-grey sweep, soft shadow under the product, 1:1.
2. **Brand-colour backdrop** — a solid or gradient backdrop in a colour that suits the product,
   hard light and a defined shadow, 4:5.
3. **Lifestyle** — the product in use in a believable setting (kitchen counter, bathroom shelf,
   desk, outdoors), shallow depth of field, 4:5.
4. **Detail / macro** — a close-up of the texture, cap, nozzle or label, 1:1.
Ask one short question only if the use is unclear (web shop vs. social vs. print).

## 3. Models
- Cloud: `nano-banana-pro` (best at keeping labels intact), `seedream-5-pro` for photoreal
  lifestyle scenes, `bria-product-shot` when the user wants a scene from a reference image.
- Open source: `oss-qwen-image-21` (Qwen-Image 2.1, up to 4 images), then `oss-qwen-edit` (Qwen-Image-Edit 2511).
- Always pass the product photo in `images` (op `edit`). Run `search_models` once if the user
  names another model or asks for the cheapest option.

## 4. Prompting
Write each prompt as: what stays ("Keep the product exactly as in the photo: same shape,
colours, label and logo, undistorted") → the set (surface, backdrop, props, colour palette) →
the light (key, fill, rim, softness, direction) → the camera (lens, angle, depth of field) →
the finish ("commercial product photography, high detail, no extra text").
Never invent text on the product. Don't add hands or people unless asked.

## 5. Check and offer next steps
After the jobs finish, `check_generations` with `look: true`. If a label is garbled or the
shape drifted, redo that shot with a stronger "keep the label exactly" instruction. Offer:
upscale the favourite (op `upscale-image`), more angles, a 5-second turntable video
(`generate` with op `i2v`, a slow orbit around the product), or ad versions with
marketing-studio-cards.

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `generate` with the four shots in one call, then
`check_generations` with `look: true`. Price a run with `estimate_cost` (or `estimate_job` for a
studio tool) and confirm it with the user first. Files go in as URLs: `fuobe upload <file>` prints
one. Without MCP, the `fuobe` CLI runs the same jobs (`fuobe generate`, `fuobe tool <name>`).
