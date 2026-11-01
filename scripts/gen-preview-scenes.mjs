#!/usr/bin/env node
/**
 * Writes the bundled sample stills used by the procedural preset previews (camera motions,
 * effects, apps) until real preview clips exist.
 *
 * Each scene is drawn in four depth layers (bg, mid, subject, fg) so a preview can move them at
 * different rates: a zoom scales them together, a dolly scales the near layers more, a truck
 * shifts them with parallax, a dolly zoom keeps the subject still while the background grows.
 *
 * Output (all in public/samples/previews/, which the sign-in proxy leaves public):
 *   <scene>.svg            the composite still (poster)
 *   <scene>-<layer>.svg    one file per layer, transparent outside its shapes
 *
 * Run: node scripts/gen-preview-scenes.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "samples", "previews");
const W = 400;
const H = 300;

const svg = (body, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>\n`;

// Golden-hour valley: a hiker on a ridge. Used by most camera moves.
const landscape = {
  defs: `<linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262a66"/><stop offset=".42" stop-color="#7c5aa8"/><stop offset=".72" stop-color="#ee9486"/><stop offset="1" stop-color="#ffd59f"/></linearGradient><radialGradient id="ls-sun"><stop offset="0" stop-color="#fff7da"/><stop offset=".3" stop-color="#ffe3a6" stop-opacity=".9"/><stop offset="1" stop-color="#ffc98a" stop-opacity="0"/></radialGradient><linearGradient id="ls-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a684bf"/><stop offset="1" stop-color="#c799b4"/></linearGradient><linearGradient id="ls-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d4c8c"/><stop offset="1" stop-color="#46396f"/></linearGradient><linearGradient id="ls-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3164"/><stop offset="1" stop-color="#262043"/></linearGradient>`,
  bg: `<rect width="${W}" height="${H}" fill="url(#ls-sky)"/><circle cx="252" cy="176" r="78" fill="url(#ls-sun)"/><circle cx="252" cy="176" r="19" fill="#fff5da"/><g fill="#fff" opacity=".16"><ellipse cx="86" cy="62" rx="54" ry="9"/><ellipse cx="120" cy="54" rx="30" ry="8"/><ellipse cx="318" cy="88" rx="46" ry="7"/><ellipse cx="292" cy="82" rx="24" ry="6"/></g><g fill="#fff" opacity=".7"><circle cx="40" cy="30" r=".9"/><circle cx="160" cy="18" r=".8"/><circle cx="350" cy="26" r="1"/><circle cx="212" cy="40" r=".7"/></g>`,
  mid: `<path d="M0 186 L38 164 L76 176 L126 136 L172 170 L214 148 L258 175 L302 142 L344 168 L400 148 V300 H0Z" fill="url(#ls-far)" opacity=".9"/><path d="M0 214 L52 188 L104 205 L158 180 L216 208 L276 186 L330 204 L400 182 V300 H0Z" fill="url(#ls-near)"/>`,
  subject: `<path d="M-20 300 C 54 244, 150 226, 232 234 C 302 241, 362 254, 420 270 V300Z" fill="url(#ls-hill)"/><g transform="translate(232 190)"><circle cx="0" cy="0" r="5.4" fill="#191530"/><path d="M-6.5 7.5 Q0 4.5 6.5 7.5 L8.5 30 L-8.5 30Z" fill="#d24a3e"/><path d="M-6.5 7.5 L-11 24 L-8.6 25 L-4.5 14Z" fill="#b83c33"/><path d="M-4 30 L-5 46 L-1.6 46 L0 34 L1.6 46 L5 46 L4 30Z" fill="#191530"/><path d="M3 9 L9 6 L10 22 L5 24Z" fill="#2d2752"/></g>`,
  fg: `<path d="M0 300 V258 Q18 246 34 258 Q52 252 70 264 Q92 270 112 286 L126 300Z" fill="#171329"/><path d="M400 300 V250 Q382 242 366 256 Q346 252 330 268 Q312 280 304 300Z" fill="#171329"/><g stroke="#171329" stroke-width="2.2" stroke-linecap="round" fill="none"><path d="M18 258 Q14 236 6 222"/><path d="M28 256 Q30 232 24 214"/><path d="M42 262 Q48 244 46 230"/><path d="M372 254 Q376 232 386 220"/><path d="M360 258 Q356 238 362 224"/><path d="M386 250 Q394 236 398 226"/></g>`,
};

// Studio portrait: one person, head and shoulders. Used by faces, UGC, identity and fashion.
const portrait = {
  defs: `<linearGradient id="pt-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34396a"/><stop offset=".55" stop-color="#7a5890"/><stop offset="1" stop-color="#e59f7e"/></linearGradient><radialGradient id="pt-bokeh"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="pt-skin" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f2c29d"/><stop offset=".7" stop-color="#e3a681"/><stop offset="1" stop-color="#c98a68"/></linearGradient><linearGradient id="pt-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f8f8a"/><stop offset="1" stop-color="#1f6763"/></linearGradient><linearGradient id="pt-hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2420"/><stop offset="1" stop-color="#22140f"/></linearGradient>`,
  bg: `<rect width="${W}" height="${H}" fill="url(#pt-bg)"/><g opacity=".9"><circle cx="64" cy="70" r="26" fill="url(#pt-bokeh)"/><circle cx="330" cy="58" r="20" fill="url(#pt-bokeh)"/><circle cx="352" cy="190" r="30" fill="url(#pt-bokeh)"/><circle cx="40" cy="200" r="18" fill="url(#pt-bokeh)"/><circle cx="292" cy="120" r="12" fill="url(#pt-bokeh)"/></g>`,
  mid: `<g opacity=".55"><circle cx="110" cy="36" r="40" fill="url(#pt-bokeh)"/><circle cx="380" cy="270" r="46" fill="url(#pt-bokeh)"/></g><path d="M300 300 Q318 210 352 180 Q340 230 346 300Z" fill="#2b2f58" opacity=".55"/><path d="M330 300 Q340 236 380 214 Q364 262 368 300Z" fill="#2b2f58" opacity=".45"/>`,
  subject: `<path d="M150 112 Q148 62 200 58 Q252 62 250 112 Q254 168 236 200 L164 200 Q146 168 150 112Z" fill="url(#pt-hair)"/><rect x="186" y="160" width="28" height="44" rx="10" fill="#d5966f"/><path d="M96 300 Q102 222 156 206 Q178 198 200 214 Q222 198 244 206 Q298 222 304 300Z" fill="url(#pt-top)"/><path d="M178 206 Q200 228 222 206" fill="none" stroke="#e3a681" stroke-width="8" stroke-linecap="round"/><ellipse cx="200" cy="124" rx="35" ry="44" fill="url(#pt-skin)"/><path d="M166 112 Q170 70 206 72 Q238 76 238 112 Q222 90 196 92 Q176 94 166 112Z" fill="url(#pt-hair)"/><g fill="#3b2621"><ellipse cx="186" cy="124" rx="3.2" ry="2.2"/><ellipse cx="214" cy="124" rx="3.2" ry="2.2"/></g><g stroke="#3b2621" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".8"><path d="M180 116 Q186 113 192 116"/><path d="M208 116 Q214 113 220 116"/></g><path d="M200 128 Q197 140 201 143" fill="none" stroke="#b97a5a" stroke-width="1.6" stroke-linecap="round"/><path d="M190 152 Q200 158 210 152" fill="none" stroke="#a5524a" stroke-width="2.6" stroke-linecap="round"/><g fill="#e98f7c" opacity=".35"><ellipse cx="180" cy="140" rx="7" ry="4"/><ellipse cx="220" cy="140" rx="7" ry="4"/></g>`,
  fg: `<g opacity=".5"><circle cx="20" cy="282" r="36" fill="#fff" fill-opacity=".14"/><circle cx="388" cy="24" r="30" fill="#fff" fill-opacity=".12"/></g>`,
};

// Neon city at night, a car on the street. Used by drones, vehicles, destruction and viral effects.
const city = {
  defs: `<linearGradient id="ct-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0f2e"/><stop offset=".55" stop-color="#2c2163"/><stop offset="1" stop-color="#7a3478"/></linearGradient><radialGradient id="ct-glow"><stop offset="0" stop-color="#ff5b6e" stop-opacity=".9"/><stop offset="1" stop-color="#ff5b6e" stop-opacity="0"/></radialGradient><radialGradient id="ct-lamp"><stop offset="0" stop-color="#ffe7a8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe7a8" stop-opacity="0"/></radialGradient><linearGradient id="ct-road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2150"/><stop offset="1" stop-color="#120e26"/></linearGradient>`,
  bg: `<rect width="${W}" height="${H}" fill="url(#ct-sky)"/><circle cx="318" cy="52" r="15" fill="#f4ecff" opacity=".9"/><g fill="#fff" opacity=".6"><circle cx="40" cy="24" r=".9"/><circle cx="120" cy="40" r=".7"/><circle cx="200" cy="18" r="1"/><circle cx="262" cy="34" r=".7"/><circle cx="372" cy="90" r=".8"/></g><path d="M0 196 V150 H22 V132 H40 V158 H58 V120 H76 V164 H96 V140 H118 V170 H140 V128 H156 V112 H172 V150 H190 V170 H214 V136 H232 V160 H252 V118 H270 V150 H290 V128 H312 V164 H332 V142 H352 V120 H370 V158 H400 V196Z" fill="#1d1846"/><g fill="#ffd27a" opacity=".55"><rect x="62" y="128" width="3" height="3"/><rect x="68" y="140" width="3" height="3"/><rect x="160" y="120" width="3" height="3"/><rect x="164" y="134" width="3" height="3"/><rect x="256" y="126" width="3" height="3"/><rect x="262" y="140" width="3" height="3"/><rect x="356" y="128" width="3" height="3"/><rect x="25" y="140" width="3" height="3"/><rect x="296" y="136" width="3" height="3"/></g>`,
  mid: `<path d="M0 300 V96 H44 V82 H70 V300Z" fill="#15112f"/><path d="M330 300 V90 H356 V74 H400 V300Z" fill="#15112f"/><g opacity=".9"><rect x="12" y="110" width="40" height="10" rx="2" fill="#ff4fa3"/><rect x="340" y="104" width="44" height="9" rx="2" fill="#3de0ff"/><rect x="18" y="150" width="6" height="40" rx="2" fill="#3de0ff"/><rect x="372" y="140" width="6" height="34" rx="2" fill="#ff4fa3"/></g><g fill="#ffd27a" opacity=".45"><rect x="10" y="200" width="6" height="6"/><rect x="30" y="220" width="6" height="6"/><rect x="50" y="200" width="6" height="6"/><rect x="346" y="196" width="6" height="6"/><rect x="368" y="220" width="6" height="6"/></g><path d="M70 300 L188 196 H212 L330 300Z" fill="url(#ct-road)"/><g fill="#f4ecff" opacity=".55"><path d="M198 204 h4 l1 10 h-6z"/><path d="M196 226 h8 l2 16 h-12z"/><path d="M193 258 h14 l3 26 h-20z"/></g>`,
  subject: `<g transform="translate(200 236)"><ellipse cx="0" cy="22" rx="46" ry="6" fill="#000" opacity=".35"/><path d="M-40 18 Q-42 -2 -30 -8 L-22 -26 Q-18 -32 -10 -32 H10 Q18 -32 22 -26 L30 -8 Q42 -2 40 18Z" fill="#d8344f"/><path d="M-19 -24 Q-16 -28 -10 -28 H10 Q16 -28 19 -24 L24 -10 H-24Z" fill="#2a2150"/><rect x="-36" y="-2" width="14" height="6" rx="2" fill="#ff3049"/><rect x="22" y="-2" width="14" height="6" rx="2" fill="#ff3049"/><rect x="-12" y="4" width="24" height="7" rx="1.5" fill="#f4ecff" opacity=".85"/><rect x="-38" y="14" width="12" height="10" rx="2" fill="#16122c"/><rect x="26" y="14" width="12" height="10" rx="2" fill="#16122c"/><circle cx="-29" cy="1" r="16" fill="url(#ct-glow)"/><circle cx="29" cy="1" r="16" fill="url(#ct-glow)"/></g>`,
  fg: `<path d="M18 300 V128 Q18 116 30 116 H50" fill="none" stroke="#0d0a20" stroke-width="5"/><circle cx="52" cy="120" r="22" fill="url(#ct-lamp)"/><path d="M382 300 V136 Q382 124 370 124 H352" fill="none" stroke="#0d0a20" stroke-width="5"/><circle cx="350" cy="128" r="20" fill="url(#ct-lamp)"/><g opacity=".5"><path d="M110 296 h40" stroke="#ff4fa3" stroke-width="2"/><path d="M252 292 h44" stroke="#3de0ff" stroke-width="2"/></g>`,
};

// Product on a podium. Used by product apps and commercial effects.
const product = {
  defs: `<linearGradient id="pd-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5ddc9"/><stop offset="1" stop-color="#e2ab97"/></linearGradient><linearGradient id="pd-pod" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e9d8c9"/><stop offset=".6" stop-color="#f7ece2"/><stop offset="1" stop-color="#d4bba8"/></linearGradient><linearGradient id="pd-glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f6b48d" stop-opacity=".95"/><stop offset=".5" stop-color="#ffd7b5" stop-opacity=".9"/><stop offset="1" stop-color="#e58f6b" stop-opacity=".95"/></linearGradient>`,
  bg: `<rect width="${W}" height="${H}" fill="url(#pd-bg)"/><circle cx="214" cy="128" r="92" fill="#fbeadb" opacity=".8"/><path d="M0 230 H400 V300 H0Z" fill="#dca08b" opacity=".45"/>`,
  mid: `<ellipse cx="200" cy="268" rx="104" ry="14" fill="#b98472" opacity=".45"/><path d="M118 214 V258 Q200 278 282 258 V214Z" fill="url(#pd-pod)"/><ellipse cx="200" cy="214" rx="82" ry="14" fill="#fbf3ec"/>`,
  subject: `<ellipse cx="200" cy="212" rx="34" ry="6" fill="#9c6b5c" opacity=".35"/><rect x="186" y="98" width="28" height="22" rx="4" fill="#2c2a33"/><rect x="190" y="92" width="20" height="10" rx="3" fill="#3a3843"/><rect x="166" y="116" width="68" height="96" rx="14" fill="url(#pd-glass)"/><rect x="172" y="150" width="56" height="56" rx="10" fill="#e07a52" opacity=".55"/><rect x="180" y="160" width="40" height="18" rx="3" fill="#fff6ee" opacity=".9"/><path d="M176 126 Q174 160 180 196" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/>`,
  fg: `<path d="M24 300 Q40 250 92 238 Q70 270 74 300Z" fill="#6f8f6a"/><path d="M44 300 Q58 268 92 238" fill="none" stroke="#56724f" stroke-width="2"/><path d="M380 300 Q366 262 318 252 Q338 278 334 300Z" fill="#7c9a74"/><ellipse cx="300" cy="292" rx="16" ry="7" fill="#c7a596"/><ellipse cx="120" cy="294" rx="10" ry="5" fill="#d4b4a5"/>`,
};

const SCENES = { landscape, portrait, city, product };
const LAYERS = ["bg", "mid", "subject", "fg"];

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, s] of Object.entries(SCENES)) {
  const write = (file, content) => {
    fs.writeFileSync(path.join(OUT, file), content);
    total += content.length;
  };
  write(`${name}.svg`, svg(LAYERS.map((l) => s[l]).join(""), s.defs));
  for (const l of LAYERS) write(`${name}-${l}.svg`, svg(s[l], s.defs));
}
console.log(`wrote ${Object.keys(SCENES).length * (LAYERS.length + 1)} files (${total} bytes) to ${path.relative(process.cwd(), OUT)}`);
