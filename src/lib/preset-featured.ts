/**
 * Featured order for Home and the galleries (most featured first). Each kind lists its presets in bands, each band in
 * order: a gallery's category shows them band by band, and its All view lets the categories take turns within each
 * band, starting with the category of the band's first preset. The studio pickers use the same order. A preset not
 * listed here (a new one) comes after the listed ones, in catalog order.
 */
import { interleaveByCategory } from "@/lib/preset-cards";

const ORDER: Record<"app" | "motion" | "effect", string[]> = {
  app: [
    `
      app-behind-the-scenes app-relight app-macroshot-product app-sketch-to-real app-age-shift app-makeup-studio
      app-angles app-shots app-match-lighting app-match-colors app-product-shot app-bullet-time-scene
      app-bullet-time-splash app-chameleon app-outfit-swap app-steal-the-look app-outfit-shot app-color-grading
      app-video-face-swap app-video-background-remover app-clean-up-voice app-breakdown
    `,
    `
      app-hairstyle-try-on app-fuobe-angles app-any-angle app-product-placement app-link-to-video-ad app-style-snap app-urban-cuts
      app-signboard app-j-poster app-giallo-horror app-face-swap app-character-swap app-headshot-generator
      app-skin-enhancer app-zooms app-what-s-next app-packshot app-billboard-ad app-macro-scene app-asmr-promo
      app-ai-stylist app-colorize app-bring-to-life app-dance app-clipcut app-sticker-match-cut app-latex app-sand-worm
      app-storm-creature app-renaissance app-3d-rotation app-ghoulgao app-object-remover
    `,
    `
      app-ai-influencer app-zoom-out app-product-360 app-poster app-magic-button app-virtual-try-on app-transitions
      app-nano-strike app-burning-sunset app-upscale app-expression-edit app-commercial-faces app-expand-image
      app-ad-creative app-bullet-time-white app-giant-product app-restore-photo app-talking-photo app-nano-theft
      app-gtai app-melting-doodle app-remove-background app-change-background app-text-edit app-asmr-add-on
      app-this-is-fine app-yes-kiss app-click-to-ad app-unboxing-video app-image-to-3d app-truck-ad app-fridge-ad
      app-asmr-classic app-asmr-host app-outfit-vending app-style-transfer app-figurine app-recast app-hug app-3d-render
      app-j-magazine app-mascot app-rap-god app-mugshot app-vectorize app-similarity-score
    `,
    `
      app-3d-figure app-idol app-60s-cafe app-hook-frame app-kick-ad app-graffiti-ad app-volcano-ad app-simlife
      app-pixel-game app-brick-cube app-micro-beasts app-paint-app app-social-media-icon app-victory-card app-comic-book
      app-glitter-sticker app-mukbang app-roller-coaster app-banana-eating app-sticker-pack app-plushies
      app-meme-generator app-cloud-surf app-game-dump app-japanese-show app-skibidi
    `,
  ],
  motion: [
    `
      motion-dolly-in motion-crane-up motion-catwalk motion-classic-static motion-glam motion-slow-motion motion-zoom-in
      motion-super-dolly-in motion-super-dolly-out motion-crash-zoom-in motion-arc-left motion-lazy-susan
      motion-crane-down motion-crane-over-the-head motion-tracking
      motion-double-dolly motion-snorricam motion-fpv-drone motion-aerial-pullback motion-helicopter-shot
      motion-car-grip motion-car-chasing motion-static motion-documentary-snap motion-dreamy-flow motion-epic-scale
      motion-intimate-observer motion-one-take motion-silent-machine
    `,
    `
      motion-rapid-zoom-out motion-eyes-in motion-mouth-in motion-arc-right motion-3d-rotation motion-pan
      motion-action-run motion-drone-reveal motion-robo-arm motion-kiss motion-raw-chaos motion-zoom-out
      motion-dolly-zoom-in motion-through-object-out motion-jib-up motion-overhead motion-buckle-up motion-truck-left
      motion-bts motion-robot-arm motion-timelapse-glam motion-low-shutter motion-focus-change motion-roll-transition
      motion-flying-cam-transition motion-boxing motion-ski-carving motion-snowboard-carving motion-crash-zoom-out
      motion-360-orbit motion-dolly-left
    `,
    `
      motion-zoom motion-dolly-out motion-rapid-zoom-in motion-through-object-in motion-earth-zoom-out motion-pan-left
      motion-pan-right motion-dolly-right motion-whip-pan motion-incline motion-handheld motion-hero-cam
      motion-timelapse-human motion-basketball-dunks motion-moonwalk-left motion-moonwalk-right motion-skateboard-ollie
      motion-ski-powder motion-impossible-camera motion-bullet-time motion-lazy-orbit motion-jib-down
      motion-pedestal-down motion-tilt-up motion-truck-right motion-dutch-angle motion-pov motion-head-tracking
      motion-object-pov motion-road-rush motion-flying motion-general motion-timelapse-landscape motion-skate-cruise
      motion-skateboard-glide motion-snowboard-powder motion-dolly-zoom-out motion-downhill-pov motion-hyperlapse
      motion-baseball-kick motion-eating-zoom motion-wiggle motion-timelapse motion-face-punch
    `,
    `
      motion-tilt-down motion-yoyo-zoom motion-rap-flex motion-fisheye
    `,
  ],
  effect: [
    `
      effect-sand-storm effect-outfit-switch effect-wind-to-face effect-levitation effect-nature-bloom effect-lens-flare
      effect-dirty-lens effect-train-rush effect-exploded-view effect-display-transition
      effect-pearl-earring effect-blue-depth effect-magazine effect-film-colors effect-black-gloss effect-crimson-vigil
      effect-bleached-warm effect-cold-steel
    `,
    `
      effect-invisible effect-shadow-smoke effect-car-drive effect-color-rain effect-seamless-transition
      effect-smash-and-grab effect-architecture-wave effect-broken-mirror effect-marble effect-modern effect-silhouette
      effect-contre-jour effect-disintegration effect-set-on-fire effect-water-splash effect-flood
      effect-turn-into-statue effect-diamond effect-black-tears effect-datamosh effect-paparazzi effect-northern-lights
      effect-pool-jump effect-raven-transition effect-ballet effect-hair-style effect-column-wipe effect-studio-slide
      effect-cutout effect-boarding-pass effect-floating-fall effect-stop-world effect-agamemnon effect-acid
      effect-bubbles effect-canvas effect-comic effect-fragments effect-multiverse effect-ocean effect-origami
      effect-particles effect-bleach-bypass effect-teal-orange-epic effect-splash-transition
    `,
    `
      effect-ice-rose effect-medusa-gorgona effect-bloom-mouth effect-floral-eyes effect-sakura-petals
      effect-tiny-planet effect-beach-ride effect-dream-date effect-flashback effect-red-carpet effect-trucksition
      effect-lacewalker effect-lidar-transition effect-pigeons effect-monet-muse effect-cold-vision effect-lsd
      effect-lava effect-layer-mixed-media effect-noir effect-overexposed effect-random-glow effect-vintage
      effect-nostalgic-blue effect-classic-bw effect-freezing effect-air-bending effect-agent-reveal effect-point-cloud
      effect-paint-splash effect-glow-trace effect-deflate effect-earth-zoom-out effect-helicopter-escape
      effect-live-concert effect-mystification effect-morning-routine effect-static-posing effect-yacht
      effect-hole-transition effect-frozen-in-motion effect-superstar effect-moonwalk effect-akrill effect-cannabis
      effect-paper effect-toxic effect-tracking effect-ultraviolet effect-practicals effect-window effect-overhead-fall
      effect-soft-palette effect-hyper-neon effect-sodium-decay effect-glowshift effect-objects-around
      effect-turning-metal effect-cyborg effect-glitch effect-crush effect-giant effect-beast-appearance
      effect-motor-ride effect-sunglasses effect-jump-transition effect-melt-transition effect-wild-ride
      effect-fairytale-castle effect-hand-paint effect-sketch effect-soft-cross effect-naturalistic-clean effect-polygon
      effect-garden-bloom effect-jelly-drift effect-skin-surge effect-super-fast-run effect-giant-people
      effect-boiling-point effect-firework effect-tattoo-animation effect-fix-and-pose effect-handheld-run
      effect-outfit-check effect-peak-moment effect-plate-check effect-sand-cut effect-selfie effect-selfie-outfit
      effect-hand-transition effect-smoke-transition effect-street-colossus effect-world-morphing effect-mighty-fighter
      effect-skatedog effect-dolphin-ride effect-palette effect-two-color effect-windows effect-candy-pink
      effect-lime-jam
    `,
    `
      effect-building-explosion effect-car-explosion effect-head-off effect-water-element effect-morphskin
      effect-melting effect-glowing-fish effect-x-ray effect-atomic effect-attack-of-clones effect-clothes-rain
      effect-selfception effect-act-natural effect-vanish effect-flash-comic effect-overtime effect-powder-explosion
      effect-earth-wave effect-water-bending effect-duplicate effect-innerlight effect-luminous-gaze effect-hero-flight
      effect-animalization effect-gas-transformation effect-floating-fish effect-pixelated-face effect-cakeify
      effect-push-to-glass effect-cotton-cloud effect-drunk-master effect-explosion effect-group-photo
      effect-plasma-explosion effect-saint-glow effect-balloon effect-high-flip effect-clones effect-infinite-clones
      effect-lens-crack effect-portal effect-wireframe effect-visor-x effect-squish effect-aquarium effect-crying
      effect-fairies-around effect-monstrosity effect-spirit-animal effect-eating effect-happy effect-scrapbook-collage
      effect-head-explosion effect-fire-breath effect-thunder-god effect-fire-element effect-firelava
      effect-earth-element effect-soul-jump effect-i-can-fly effect-horror-face effect-censorship
      effect-starship-troopers effect-wonderland effect-buddy effect-giant-grab effect-money-rain effect-oni-mask
      effect-happy-mode effect-angry-mode effect-selfie-posing effect-flame-transition effect-burning-man
      effect-fallen-angel effect-cyclope effect-flame-on effect-clone-explosion effect-angel-wings effect-super-saiyan
      effect-werewolf effect-gorilla-transfer effect-tentacles effect-spiders-from-mouth effect-inflate effect-muscle-up
      effect-look-boom effect-pizza-fall effect-shocked effect-turning-monkey effect-monster-dab
    `,
  ],
};

/** Each kind's bands, first to last, as lists of ids. */
export const FEATURED = Object.fromEntries(
  Object.entries(ORDER).map(([kind, bands]) => [kind, bands.map((b) => b.split(/\s+/).filter(Boolean))]),
) as Record<keyof typeof ORDER, string[][]>;

/** How many bands there are; an id not listed takes the one after them. */
export const FEATURED_BANDS = Math.max(...Object.values(FEATURED).map((b) => b.length));

const RANK = new Map(Object.values(FEATURED).flatMap((bands) => bands.flatMap((ids, band) => ids.map((id, at) => [id, { band, at }] as const))));

/** The id's band (0 is the first), or FEATURED_BANDS when it isn't listed. */
export const featuredBand = (id: string) => RANK.get(id)?.band ?? FEATURED_BANDS;

/** Featured first: by band, then place in it; ids not listed keep their order after the listed ones. */
function featuredFirst<T extends { id: string }>(items: readonly T[]): T[] {
  const key = (id: string) => RANK.get(id) ?? { band: FEATURED_BANDS, at: 0 };
  return items
    .map((it, i) => ({ it, i, k: key(it.id) }))
    .sort((a, b) => a.k.band - b.k.band || a.k.at - b.k.at || a.i - b.i)
    .map((x) => x.it);
}

/**
 * A gallery's All view: band by band, the categories take turns (interleaveByCategory), each in featured order. In
 * each band the categories go in the order of their first preset there, so the gallery opens on the band's first
 * preset. Filtered to one category, it is that category's featured order.
 */
export function featuredAll<T extends { id: string; category: string }>(items: readonly T[]): T[] {
  const ranked = featuredFirst(items);
  return Array.from({ length: FEATURED_BANDS + 1 }, (_, band) => interleaveByCategory(ranked.filter((it) => featuredBand(it.id) === band))).flat();
}

/** A gallery's cards in featured order (featuredAll), with its category tabs in catalog order. */
export function featuredGallery<T extends { id: string; category: string }>(items: readonly T[]) {
  return { presets: featuredAll(items), categories: [...new Set(items.map((it) => it.category))] };
}
