#!/usr/bin/env node
/**
 * The Film look picker's thumbnails (src/lib/film-looks.ts filmLookThumb): each look's chosen test render (a 3:4 MOSS-Image
 * picture) as public/previews/film-looks/<id>.320 and .640, in AVIF and WebP.
 *
 * Run:  node scripts/gen-film-look-thumbs.mjs <picks.json>   (picks.json: { "<look id>": "<path to its render>" })
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const picks = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = path.resolve("public/previews/film-looks");
fs.mkdirSync(out, { recursive: true });
for (const [id, src] of Object.entries(picks)) {
  for (const w of [320, 640]) {
    const img = sharp(src).resize({ width: w, height: Math.round((w * 4) / 3), fit: "cover", position: "attention" });
    await img.clone().avif({ quality: w === 320 ? 52 : 48, effort: 6 }).toFile(path.join(out, `${id}.${w}.avif`));
    await img.clone().webp({ quality: w === 320 ? 76 : 72, effort: 6 }).toFile(path.join(out, `${id}.${w}.webp`));
  }
  console.log(id);
}
