---
name: moss-film-looks
description: Write MOSS-Image photo prompts and give the picture a film or camera look (night colour film, slide, black and white, tintype, instant film, a movie still, toy and odd cameras, grades, light leaks, double exposure). Use when the user wants a photo with a film look, a vintage or analogue feel, black and white, an instant print or a lo-fi camera, or asks how to prompt MOSS-Image.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the generate tool on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Film Looks
  when_to_use: The user wants a picture with a film, camera or analogue look ("shot on black and white film", "like an old instant photo", "a movie still at night", "light leaks", "a tintype portrait"), or asks how to write a prompt for MOSS-Image.
  icon: film
  studio: /image?model=oss-moss-image
  tags: film, photography, black and white, vintage, look
  offline_kind: image
  offline_aspect: "3:4"
  offline_outputs: "2"
  offline_style: night colour film photograph, cool blue-teal shadows, warm orange highlights, a soft red glow around bright lights, fine visible film grain, deep inky blacks
---

# Film Looks

MOSS-Image (`oss-moss-image` on your GPU, `moss-image` in the cloud) has Fuobe's tested film
looks. Pick one with `film_look` and write the scene only: Fuobe puts the look before and after
the scene and adds the look's own negative prompt when the picture is made. The user's prompt
stays as they wrote it.

## 1. Write the scene
- Plain prose: whole sentences, no JSON, no tag lists.
- The subject first: who, their hair, face and outfit (materials and cut), the place, the light.
- Pin the pose down: where they stand or sit, where the hands and the weight are, where they look.
  The same pose keeps the subject steady when the user tries several looks.
- Name only what should be in the picture. What should not be there goes in `negative_prompt`.
- With a look picked, name no film stock, camera, grade, grain or lens look of your own.
- With a black-and-white look (the Black & white group), name no colours: hair is fair or
  dark, eyes light or dark, jewellery metal. Fuobe also takes colour words out before the run.

## 2. Pick the look
Call `search_models` for image: MOSS-Image's `filmLooks` field lists every id. The groups:

| Group | Looks |
|---|---|
| Colour film | night halation, muted chrome |
| Slide | vivid slide, cross-processed |
| Black & white | grainy 400, fine grain 100, pushed 3200, sepia, tintype, daguerreotype, glass plate |
| Instant | vintage instant, expired instant, mini instant |
| Motion picture | cinema 500, Super 8 |
| Toy & odd cameras | plastic toy camera, lo-fi compact, pinhole, toy fisheye, half-frame diptych, pocket 110, disposable, 2000s digicam |
| Looks | teal and orange |
| Broken film | light leaks, fogged film, double exposure, end of roll, scratched print |

## 3. Writing a look by hand
When no listed look fits, describe the look in the prompt yourself, the same way Fuobe's looks do:
- Say what the film or camera does to the picture: "cool blue-teal shadows, warm orange
  highlights, a soft red glow around every light, fine grain". Brand and stock names do nothing.
- Say the look first, then the scene, then the look again.
- Put the opposite look in `negative_prompt` ("flat even daylight, HDR, clean digital look"), and
  colours the look could paint onto walls or clothes ("orange walls").
- An overlay needs what and where: "a faint city skyline across the left half of the frame",
  "a warm orange light leak from the right edge".
- A dark slide look needs "underexposed, low-key" to keep its depth.

## Using Fuobe from an agent
`generate` with the model `oss-moss-image` (or `moss-image`), op t2i, the scene as the prompt, and
the film_look field set to a look's id.
