# The studio's marketing studios, agents and the Assets library

_In this file, "the studio" means the closed AI image and video studio that this research measures Fuobe against._

_As of 2026-10-17. Machine-readable twin: [`parity-marketing-agents.json`](parity-marketing-agents.json) (all 1,074 Marketing Studio templates, hooks, settings, presets, skills, node types and payloads). This deepens §2.6 and §2.7 of [`parity-inventory.md`](parity-inventory.md). Cinema Studio, Shorts Studio and Mixed Media are in [`parity-studios.md`](parity-studios.md)._

Covered: **Marketing Studio**, **Ads Studio**, **Ad Multiplier**, **Click to Ad / Link to Video Ad**, **Faceless Studio**, **Explainer**, **Canvas**, **Katana**, **Virality Predictor**, the **Assets library**, and Supercomputer's **Skills**, **Projects** and **Memory**.

**How this was researched.** Logged-in screens were not observed. Instead:

1. **Public CMS endpoints** that answer without a login. They hold the full Marketing Studio catalog and template feed, the UGC hooks and settings, the Faceless, Explainer, Katana and legacy Click-to-Ad preset lists, the Canvas templates, the Supercomputer skills catalog, a Virality Predictor demo analysis and the credit formulas.
2. **Server-rendered state.** TanStack Query state is dehydrated into the SSR HTML of `/marketing-studio`, `/faceless-studio` and `/asset`. A small literal parser read it; no page code was run.
3. **Production JS.** Build `868a8dba`, the same 8,020 chunks as `parity-studios.md`. The chunks give the job payload builders, validators, limits, enums and menu definitions.
4. **i18n catalogs.** Route deltas, plus the full English catalog mapped to chunks by message id. They give the UI copy.
5. **Docs and pages.** Help Center, Changelog, blog posts, landing and skill pages. A web search for third-party coverage turned up little beyond the studio's own pages.

Statements reasoned from code or copy, rather than seen, are marked *(inferred)*. Every URL is in [Sources](#sources) and in the JSON `sources` block.

**The most useful findings for the build:**
- **Marketing Studio's whole catalog is public.**
  - It has 7 categories and 17 formats, and each format lists its generation job type, fixed params and *capabilities* (avatar/product required, durations, aspect ratios, batch, brand kit).
  - The feed has **1,074 templates**: 1,051 visible and 23 hidden. That is fewer than the "1,500+" in the blog.
  - Every template has a name, type, format, aspect ratio or duration, and cover. Only the legacy video modes carry a written description.
- **UGC hooks and settings are prompts.** There are 9 hooks ("Product Hit", "Camera Bump"…) and 14 settings ("Bedroom", "Volcano Rim"…), each a one-paragraph scene prompt. The text is listed below, so Fuobe can reproduce the mechanic exactly.
- **The job builders are readable.** Every format's request shape, limits and validation message is known, including the `<<<product:id>>>` and `<<<avatar:id>>>` prompt tokens. Prompts are capped at **5,000** characters. Durations are **4–30 s** for the tools, **15–30 s** for UGC and **5–15 s** for motion. Images are capped at **32 MB**.
- **Ads Studio has 7 steps.** Website → brand research (14 progress labels) → review the brand kit (14 fields) → products → **up to 20 ads per product** (4 credits each) → grid → chat with *Mention a product*. Each ad is a single image with a headline, copy and CTA in 1:1, 4:5 and 9:16.
- **Ad Multiplier's form is small.** It takes a reference video (4–30 s), up to 20 @-mentioned images, and three mutually-exclusive parts: Prompt, or Hook and/or CTA. Resolution is 480p, 720p or 1080p (default 1080p). It runs on **Seedance 2.5 edit** and costs 3 / 7 / 16 credits per second.
- **Faceless Studio** has 12 styles (not 8), 4 genres and 1–5 min episodes. *Fully animated* costs **41 credits per 10 s**; *Frame by Frame* costs **16 credits per 10 s**. It runs on **Gemini Omni Flash** video plus narration and subtitles. **Explainer** has 22 styles, runs Auto or 15–600 s, takes ≤3 sources and ≤14 media, and outputs 16:9 or 9:16.
- **Canvas** has a fixed node menu: Prompt, Image / Video / Voice Generator, LLM Assistant, Page, Video Concatenator, Change Voice, Translate, Upload, Assets, Text, Sticky Note and Table. It offers Run node, Run all and Run pipeline, and there are 5 public templates. Fuobe's chained jobs already provide the execution model.
- **Virality Predictor** returns a full output JSON: score, hook score, hold rate, a per-second curve, a peak second and five cortical networks defined on the **fsaverage** mesh. That matches Meta's open **TRIBE v2** brain-encoding model (CC BY-NC 4.0), which gives Fuobe a real open-source route instead of today's "not reproducible" app.

---

## 1. Marketing Studio

### 1.1 Where it lives, what runs it

| | |
|---|---|
| Routes | `/marketing-studio` (`?tool=url-to-ad`, `?tool=ad-reference`, `?tool=app-video`, `?category=…`), `/marketing-studio/preset/{slug}-{id}`, `/marketing-studio/p/{id}`, `/marketing-studio/generations`, `/favorites`, `/projects`; public `/marketing-studio-community`; landing `/marketing-studio-intro`. `/apps/link-to-video-ad` and `/app/link-to-video-ad` redirect to `?tool=url-to-ad` |
| Data | `GET {studio-cms}/marketing-studio-v2/catalog?lang=en&show_hidden=…`; `GET …/categories/{slug}/presets?size=&cursor=&show_hidden=` (the slug is ignored server-side; the client filters); `GET …/motion-presets?size=100`; hooks/settings `GET fnf…/marketing-studio/setup/{hooks,settings}`; brand kits, products, avatars, ad references and cost quote are authenticated `fnf` endpoints (§1.7–1.10) |
| Job set types | `marketing_studio_2_image` (types `product_shots`, `product_shots_people`, `ads`, `poster`, `marketplace`) and `marketing_studio_v2_video` (types `ugc`, `video_mode`, `2d_motion`, `hypermotion`, `mixed_media`, `saas_motion`, `product_link`, `ad_reference`, `app_video`) |
| Models | Images: "MS Image" (public API `/marketing-studio/image` 2.0 Alpha, `/image/flare` = GPT Image 2.5 Flare, `/image/sunburst`; already in Fuobe as `marketing-studio-image`). Product motion: "Motion" (blog). UGC: Seedance 2 *(inferred from the UGC skill page)* |
| History | Before Aug 18, 2026 it was prompt-first with 9 formats (the legacy `video_mode` styles below). Since then it is template-first |

### 1.2 Layout

The regions are read from SSR markup (`data-ms2-*` attributes) and the route strings; their placement is *(inferred)*.

| Region | Content |
|---|---|
| Left sidebar | **Marketing Studio** title · Home · My generations · My favorites · **Tools**: Ad Reference, Product Link (App video when enabled) · **Projects** + *New project* (Find project.., Sort projects). Project side views: assets, avatars, products, elements |
| Hero | Category cards floating around the headline **"Turn any product / into ready to post content"**: UGC, Product shot, Motion, Ads, Posters, Marketplace, TikTok. Button **Browse templates** |
| Template grid | **Explore templates**: category tabs *All · Product shot · Motion · UGC · TikTok · Ads · Posters · Marketplace* and a media filter *All · Images · Videos*. Row-packed masonry: compact under 1,360 px container width, wide above. Each card shows a type chip and the name. Chips: *Product shot*, *Product motion* (2D, hypermotion, mixed media, SaaS, legacy motion), *UGC video*, *TikTok*, *Ads*, *Poster*, *Marketplace*. Video covers play on hover. Pages hold 12 cards the first time, then more |
| Composer | Docked at the bottom (`data-ms2-composer`, §1.5). Opening a template fills it ("Recreate template") |
| Empty / errors | "Loading Marketing Studio", "Could not load Marketing Studio.", "No presets are available yet.", "Motion presets could not be loaded.", "This preset is no longer available." |

### 1.3 Catalog: categories → formats → styles

Capabilities come from each format's `default_style.metadata.capabilities`. The UI shows only the controls these allow.

| Category | Format (availability) | Job type · fixed params | Avatar / product | Durations | Aspect ratios | Batch | Brand kit | Styles |
|---|---|---|---|---|---|---|---|---|
| UGC | Talking head | v2_video · `ugc`, `delivery_specs.mode=talking` | optional / optional | 15–30 s, def 20 | auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | ≤4 | – | Shopping, At home, Delivery, Review, Try-on, Unboxing, Tutorial, Before/after (+ hidden General, Product Review, TV Spot, Wild Card) |
| UGC | Faceless (coming soon) | `ugc`, mode `faceless` | | | | | | – |
| UGC | Silent (coming soon; available when hidden items are shown) | `ugc`, mode `silent` | optional / optional | 15–30 s | as above | ≤4 | – | Narrated Haul, Narrated Home Vlog, Narrated Doorstep Drop, Narrated Review, Narrated Fit Check, Narrated Unboxing, Narrated Tutorial, Narrated Glow-Up |
| UGC | UGC (legacy modes) | `video_mode` | optional / optional | 4–15 s, def 12 | as above | ≤4 | – | 12 modes (§1.4) · resolutions 480p / 720p / 1080p |
| Product shot | With model | 2_image · `product_shots_people` | one of product or avatar | – | 1:1, 3:2, 2:3, 4:3, 3:4, 9:16, 16:9 | – | – | Closeup, Faceless, Full body, Editorial, UGC |
| Product shot | Standalone | `product_shots` | none / **required** | – | 1:1, 3:2, 2:3, 4:3, 3:4, 4:5, 5:4, 9:16, 16:9, 21:9 | fans out | ✓ | Studio white, Color pop, Natural, Usage |
| Motion | 2D product motion | v2_video · `2d_motion` | none / required | 5–15, def 5 | video set | ≤4 | – | General |
| Motion | Hypermotion | `hypermotion` | none / required | 5–15, def 15 | video set | ≤4 | – | General, Typography, Dark Minimalism, Color pop |
| Motion | Mixed media | `mixed_media` | none / required | 5–15, def 15 | video set | ≤4 | – | General |
| Motion | SaaS | `saas_motion` | none / optional; needs one of prompt, product, **brand_url** | 5–15, def 5 | video set (aspect **required**) | ≤4 | – | General |
| Motion | Motion (legacy) | `video_mode` | optional | 4–15, def 12 | video set | ≤4 | – | Product Showcase ("Highlight your product") |
| Ads | General | 2_image · `ads` | optional / **required** | – | 1:1, 3:2, 2:3, 4:3, 3:4, 9:16, 16:9 | – | ✓ | Social proof, Comparison, Problem → Solution |
| Posters | General | 2_image · `poster` | none / optional; needs prompt or product | – | template-defined | – | ✓ | 174 styles (same ids as the 174 poster templates) |
| Marketplace | General | 2_image · `marketplace` | optional / **required** | – | 1:1 … 16:9 | – | ✓ | Dark, 3D surreal, Pastel, Clean Studio (+ hidden Color pop) |
| TikTok | TikTok (legacy) | `video_mode` | optional / optional | 4–15, def 12 | video set | ≤4 | – | 8 modes (§1.4) |

The help article and the task brief also name **Ref → Video**. In the app that is the **Ad Reference** tool (§1.6), not a template category.

### 1.4 Template library (1,074 records)

| Category → format | Visible | Hidden | Kind | Notes |
|---|---|---|---|---|
| Product shot → Standalone | 364 | 3 | image | every one has `quality: 2k` and an aspect ratio (all 3:4) |
| Product shot → With model | 54 | 0 | image | aspect 3:4 (28), 2:3 (18), 1:1 (4), 9:16 (3), 3:2 (1) |
| Motion → Hypermotion | 82 | 2 | video | 5–15 s (most 6 s); mode `r+t2v` (needs a product image) |
| Motion → Mixed media | 65 | 0 | video | `r+t2v` |
| Motion → 2D product motion | 42 | 4 | video | |
| Motion → SaaS | 42 | 6 | video | mode `r2v` (no product needed); all 42 visible take `brand_url`, 19 also a `logo_asset` |
| Motion → legacy | 4 | 0 | video | |
| UGC → Talking head | 25 | 7 | video | 9 carry a built-in hook (`hook_id`); hidden ones are also tagged faceless and silent |
| UGC → legacy modes | 36 | 0 | video | `legacy_mode`, `style_id`, 8–15 s, mostly 3:4 |
| TikTok | 25 | 0 | video | legacy modes |
| Ads → General | 72 | 0 | image | `group_name`: Hero Spotlight 32, Proof & Specs 19, Dark Premium 16, Pastel Beauty 13, Juicy Splash 13, Problem Solved 10, Clean Studio 10, Color Pop 9, Compare & Switch 6, Social Proof 5, 3D Surreal 5 (ads and marketplace together) |
| Posters → General | 174 | 1 | image | editable afterwards in Layers |
| Marketplace → General | 66 | 0 | image | aspect 3:4 (59), 2:3 (7) |

**Legacy video modes**, with their CMS descriptions:

| Mode | Description |
|---|---|
| Giant Figure | Oversized, scroll-stopping product moments |
| Unboxing Virtual Try-On | Unbox and try on in one take |
| Unboxing ASMR | Satisfying ASMR unboxing experiences |
| Virtual Try-On Sneakers | Virtual sneaker try-on videos |
| Crush Test | Satisfying crush and durability tests |
| Mystery Box | Suspenseful mystery box reveals |
| Reboxing | Repackaging and reboxing reveals |
| TV Spot | Authentic stories, amplified |
| UGC Addiction | Can't-put-it-down product obsession |
| UGC Virtual Try On | Try before you buy |
| Pro Virtual Try On | Advanced virtual try-on |
| Wild Card | Unique and creative video mode for custom ideas |
| This Gadget Saved Me | Turn product features into a creator-led recommendation |
| Couple Sharing At Home | A couple sharing the product at home |
| Selfie Testimonial | Authentic selfie-style testimonials |
| Direct-to-Camera | Creator speaking straight to camera |
| Secret Hack Reveal | Reveal a clever product hack |
| Camera POV | Immersive point-of-view product moments |
| Classic Meets Modern | Blend timeless and contemporary styles |
| Mess to Fresh | From messy to fresh transformations |
| Product Showcase | Highlight your product |

The first 12 sit in UGC, the next 8 in TikTok, and Product Showcase in Motion. The landing page describes the older names in more detail. *TV Spot*: "Broadcast-ready product ads with cinematic camera work, real-world locations, and story arcs". *UGC*: "Face-to-camera product reviews … shot in iPhone style". *Tutorial*: "Step-by-step how-to videos where the person talks and demonstrates at the same time". *Product Review*: "Close-up hands-on footage with natural voiceover". *Unboxing*: "Package arrives, tape rips, product revealed, genuine reaction". *Hyper Motion*: "Pure CGI product commercial … no people, no voiceover". *Pro Virtual Try On*: "Your product in motion on city streets". *Wild Card*: "Describe a scenario and let AI direct the whole thing".

All template names follow, by category. Ids, aspect ratios, durations, motion modes and covers are in the JSON. Most templates have no written description, so the JSON `description` is derived from metadata and labelled as such.

<details><summary><b>Product shot → Standalone</b> (364 visible, 3 hidden)</summary>

Acrylic Shelf Grab, Air Gap Stack, Airborne Trio, Amber Bokeh, Amber Curtain Call, Amber on Cream, Amber Sky Float, Amber Spill, Aqua Gel, Aqua Shelf, Arm Ladder, Artisan Orbit, Back Pocket Duo, Backpack Spill, Backseat Leather, Backyard Cooler, Bagged Twins, Baker's Ladder, Balanced Blocks, Basil and Tomato, Basket Tilt, Bathroom Ledge, Bathtime Boat, Beach Towel Flat Lay, Beige Levitation, Beige Spoonful, Bentwood Perch, Berry Basket, Berry Ice Pyramid, Birch Checkerboard, Blackberry Ring, Blood Orange Wall, Bloom Cradle, Blue on Blue, Blue Paper Duo, Blue Tile Brunch, Blueprint Scatter, Blush Beam, Blush Hands, Botanical Apothecary, Botanical Shadows, Bowl Pour, Bread Plinth, Bubble Foam, Burgundy Book Steps, Buried in Chips, Buried in Ice, Caramel Cubes, Carton and Bottle, Carton Companion, Cassette Corner, Cellophane Candy Scatter, Center Console, Cereal Milk Float, Charcoal Fruit Cluster, Checkerboard Mosaic, Cherry on Top, Chip Cascade, Citrus Carve-Out, Citrus Market, Citrus Net Swing, Citrus Squeeze, Clothesline Sky, Cobalt Lemons, Cobalt on Black, Concrete Basket, Cookie Levitation, Coral Coast, Coral Cream, Counter Pinch, Coupe and Citrus, Coupe Plunge, Court Lines, Courtside Stash, Cradled in Hand, Crayon Doodle, Cream and Mustard, Cream Ribbon, Cream Tiles, Crescent Shadow, Crimson Flat Lay, Crossed Hands, Crossed Pair, Crowded Pantry Hold, Crumb Halo, Crushed Ice, Cubby Wall, Cube Pedestal, Cup Lid Perch, Curled Paper Stage, Cut Fruit Mirror, Dark Fruit Teardrop, Deck Chair Stripes, Deep Green Flat Lay, Denim Carry, Denim Cradle, Dessert Bowl, Dewy Float Cascade, Diagonal Grid March, Diagonal Spine, Diagonal Sweep, Die-Cut Reveal, Drawn by Light, Driftwood Pedestal, Dripping Glass Shelf, Dumbbell Court, Eager Pup, Eucalyptus Stone, Everyday Carry, Fallen Scoop, Farmers Market Crate, Faux Fur Cuff, Fig and Plum, Fig Field Noir, Fingertip Balance, Fingertip Drop, Foam Bloom, Focus Pull Trio, Fork Parade, Fresh Stock Pile, Fridge Door Grab, Fridge Regiment, Fridge Shelf Tilt, Frosted Pane, Frozen Monolith, Fruit Aquarium, Fruit Cobblestone, Fruit Ice Bed, Fruit Ice Stack, Fruit Slice Mandala, Fruit Totem, Garden Duffel, Glass Dunk, Glossy Fruit Flood, Glossy White Drift, Golden Hour Pantry, Good Boy Biscuits, Gradient Trio, Guava Pile, Hand to Hand, Handbag POV, Handheld on White, Hazelnut Crush, Hoisted Hero, Honey Drip Stack, Honeybee Swarm, Ice Bed Macro, Ice Cube Hover, Ice Plunge, Ingredient Monument, Ingredient Plume, Into the Tote, Kitchen Levitation, Kitchen Shelf Grid, Knit Sleeve Hoist, Knit Spill, Kraft Bag Hero, Kraft Paper Hands, Lawn Basket, Lawn Crate Tumble, Lemon on Pink, Levitating Totem, Lilac Balloon Bed, Linen Lid Lift, Magenta Gummy Scatter, Magenta Ribbon, Maker's Bench, Marble Breakfast, Marble Counter Lift, Marble Slab, Marble Spill, Market Net, Market Punnet, Meadow Chair, Meadow Mirror, Midnight Crown, Midnight Pinwheel, Milk Crate Spill, Mineral Shelf, Mini Cart, Mint Hood, Mint Plate, Mint Tile Bath, Mirror Handstand, Mirror Split, Mirror Touch, Module Orbit, Moss and Fern, Mustard Breakfast, Mustard Crisp Halo, Mustard Milk Crate, Net Bag Sky, Noir Duo, Noir Shadow Sweep, Noir Suspension, Noodle Bowl Tabletop, Ochre Recline, Off Kilter, Oil Ribbon, Olive Scatter, Onyx Luxe, Onyx Tumble, Open Tote, Orange Can Parade, Orange Seamless, Orbiting Jars, Orchard Abundance, Orchard Scatter, Overlap Duet, Packed Shelves, Paint Puddle, Painted Ledge Tower, Palm Offering, Pancake Tower, Pantry Pick, Parchment Tray, Pastel Market Haul, Pastel Podiums, Peach Sand Quartet, Peach Sphere, Pedestal Balancing Act, Periwinkle Checkers, Picnic Triangle, Pineapple Core, Pink Cart Haul, Pink Chair Scatter, Pink Cup Carrier, Pink Granule Spill, Pink Scoop Flat Lay, Pink Tile Refill, Pistachio Pouch Spill, Pistachio Void, Planted, Plaster Alcove, Pocket Tuck, Poolside Deck, Poolside Float, Pop Top Burst, Pouch and Pour, Pouch Lattice, Pouch Nest, Powder Blue Scatter, Powder Pour, Propped Lean, Puddle Portrait, Pulp Carrier, Purple Balloon Squeeze, Quiet Gray, Quince Corner, Quincunx Grid, Raking Light, Reaching Shadow, Rearview Coffee, Red Cooler, Red Mesh Bundle, Reflective Duo, Ribbed Dunes, Ripple Stone, Roasting Pan Treat, Rocky Shore, Rooftop Splash, Sachet Crisscross, Sage Shadow Pool, Sand Dusted Hand, Scholar's Breakfast, School Locker, Scoop and Serve, Sculptural Stack, Serpentine Lineup, Shade Parade, Sheepdog Sidekick, Sheer Mesh Veil, Shirt and Coffee, Shoreline Split, Shoreline Trio, Simmer Station, Sinkside Drape, Sky Grip, Sky Hammock, Sky Lift, Sky Plinth, Sky Toast, Slanted Shelf Duo, Slatted Light Breakfast, Smear Touchdown, Snack Eruption, Snack Sea, Snack Table Reach, Snap and Pour, Soap Bubble Crown, Soft Blue Hover, Spatula Smear, Speckled Stone Spill, Sphere Halo, Splash Crown, Steamed Script, Still Water Dive, Stone Cradle, Stucco Pedestal Lineup, Studio Trio, Sun Hat Crown, Sunbeam Pedestal, Sunbeam Slash, Sundae Coupe, Sunken Harvest, Sunlit Bathroom, Sunlit Curtain Blooms, Sunlit Flavor Trio, Sunlit Kitchen, Sunlit Nook, Sunlit Tins, Sunny Cooler, Sunset Comb, Suspended Droplets, Takeout Hand-Off, Tangerine Diagonal, Teal Citrus Heap, Teal Step Tower, Teal Totem, Tennis Ball Bed, Tennis Picnic, Terry Pouch Reveal, Through Wet Glass, Tiled Countertop, Tipped Bottle Duo, Toast Stack, Toolkit Scatter, Torn Pouch Cascade, Torso Hold, Totem Stack, Travel Tray, Tray in Crate, Treat Tease, Tricolor Staircase, Triple Arm Pinwheel, Tropical Still Life, Truffle Pinch, Tube Bouquet, Tufted Velvet Sunbeam, Turquoise Pour, Turquoise Sands, Twill Pocket Portrait, Twin Lift, Two-Hand Reveal, Uncapped Macro, Utility Cord Coil, Victory Fist, Vintage Car Deck, Vintage Microwave, Volleyball Sky, Waffle Cone Dip, Walnut Bed, Warm Light Shaft, Water Column, Weightless Squadron, White Tile Morning, Wire Basket, Woodland Nest, Y2K Tray, Yellow Cab Carry, Yellow Lean Stack, Yellow Meets Pink, Zen Cairn, Zigzag Float

_Hidden (only with `show_hidden=true`):_ Sun-Warmed Sand, Inside the Pour, Magenta Wordmark

</details>

<details><summary><b>Product shot → With model</b> (54 visible)</summary>

Blue Sky Cap, Brass Tray, Brushed Tin, Cactus Socks, Chilled Can, Chunky Knit, Clay Court Chic, Comforter Cocoon, Cozy Pour, Daily Capsules, Denim Pocket, Emerald Pajamas, Emerald Velvet, Field Athletics, Forest Knit, Golden Dew, Gummy Grin, Lavender on Pink, Lemon Set, Marble Table, Maroon Blazer, Mauve Tulle, Mid-Bite Smile, Mustard Sofa, Packet Bite, Palm Lawn, Picnic Cooler, Picnic Trio, Pink Eyeshadow, Playful Wink, Raglan Smile, Resting Gaze, Retro Hotline, Retro Sofa, Rug Lounge, Serene Curls, Shearling Cyclist, Silver Rings, Sky High Chili, Smoothie Scoop, Snack Haul, Snack Spread, Spa Morning, Straw Sip, Street Skate, Studio Freckles, Sunkissed Sheen, Sunlit Greenery, Sunlit Notes, Sunset Dew, White Shirt Clutch, Windswept Glam, Windswept Sky, Workout Mat

</details>

<details><summary><b>Motion → 2D product motion</b> (42 visible, 4 hidden)</summary>

Acid Diagonal Editorial, Botanical Archive, Botanical Line Art, Cartoon Hands Crunch, Cat And Mint Pulse, Chili Mascot Pole Vault, Constellation Bottle Outline, Constructivist Type Wedges, Continuous Line Botanical, Countdown Zero, Crunch Waveform Visualizer, Editorial Mosaic Grid, Elastic Swiss Grid, Expanding Type Rings, Falling Type Mosaic, Fashion Editorial Reveal, Gel Line Drawing, Ghost Box Trampoline, Gradient Product Float, Groovy Mascot Walk, Japanese Minimal Punctuation, Liquid Wave Wipes, Marker Capsule Grid, Music Zine Collage, Op Art Stripe Type, Paper Cut Shadow Theatre, Pastel Shape Choreography, Pixel Grid Soda Pop, Pop Art Comic Panels, Powder Particle Type, Retro Starburst Orbit, Risograph Misregistration, Scale Doubling Editorial, Soft Background Swap, Split Flap Scoreboard, Starburst Kaleidoscope, Sticker Bomb To Minimal, Storybook Page Turns, Sunburst Louvres, Tile Mosaic Spiral, Type Wall, Zoomies Racetrack

_Hidden (only with `show_hidden=true`):_ Split Screen Kinetic Editorial, Countdown List, Chat Bubble Story, Before After Split

</details>

<details><summary><b>Motion → Hypermotion</b> (82 visible, 2 hidden)</summary>

Amber Pour Ritual, Anime Cel Storyboard, Backlit Silhouette Reveal, Blood Orange Sweep, Blue Splash Reveal, Brushed Titanium Montage, Candle Row Rush, Candy Color Swap, Cardboard City Nights, Charcoal Macro Orbit, Chili Burst, Chili Flake Drift, Claymation Storm, CMYK Pop-Art, Colorway Carousel, Copper HUD, Coral Burst Splash, Crimson Studio Feast, Cropped Type Intro, Crunch Heat Umami, Cyberpunk Vault, Droplet Lens, Duotone Beat Cuts, Elastic Snap Assembly, Exploded View Loop, Flavor Cards, Float and Land, Fresh Leaf Ritual, Golden Droplet Hero, Golden Oil Soak, Green Tea Macro, Ingredient Skyfall, Knock Knock Kinetic, Lavender Cargo Drop, Lavender Field Spin, Liquid Gold, Liquid Leaf Macro, Liquid Lettering, Logo Beat Loop, Marble Balance Scale, Mid-Air Bounce, Midnight Orbit, Monochrome Duet, Monospace Callouts, Noir Unboxing, Olive Silhouette, Olive Water Soak, Orchard Float, Pastel Beat Pop, Pastel Droplet Morph, Pastel Quartet, Peach Float Drop, Pear Splash Burst, Pear Tonic Rush, Petal Fall Noir, Pill Mask Reveal, Pill Stack Logo, Plum Studio Hero, Price Roll Carousel, Printed Zine Panels, Pull Tab Macro, Radial Red Spin, Ribbon Unfurl, Rooftop Pan-Up, Signal Red HUD, Slow ambient, Slow Splash Macro, Spotlit Pantry, Stop-Motion Color Cycle, Sunlit Submersion, Sunset Sour Pop, Terracotta Still Life, Titanium Claim Cards, Tomato Red Wash, Tomato Spin Morph, Triple Remix, Ukiyo-e Paper Waves, Weightless Steel, Wheatpaste Wall, Whip-Pan Quartet, X-Ray Halo, Y2K Hologram Fill

_Hidden (only with `show_hidden=true`):_ Spring Sneeze, Sencha Ripple

</details>

<details><summary><b>Motion → Mixed media</b> (65 visible)</summary>

2000s Digital Scrapbook, 2000s Flyer Maximalism, 3D Fur, 90s Bedroom CRT, 90s Supermarket Pop, 90s/Y2K, Amber Resin Monotone, Bold-Line Magazine Cover, Bookish Flat Editorial, Bubble Bead Dopamine, Chrome Core, Chrome Toy Render, Comic Meme Poster, Cork Bulletin Board, Crayon Kawaii Doodle, Cut-Paste Collage, Denim Flatlay, Dense Photo Wallpaper, DVD Collage, Fisheye Jelly Balloon, Flat Riso Storyboard, Folk Linocut Stickers, Fuzzy Hair, Geometric Grid Poster, Glossy 3D Poster, Gouache Type Poster, Grunge Grid Poster, Halftone Street Collage, Illustration, Japanese Glistening Water, Jelly Beach Picnic, Maximalist Ink Poster, Needle-Felt Stop-Motion, Neo-Brutalist Layout, Pastel Float, Pastel Riso Halftone, Pastel Tidy Display, Photo Scrapbook Mockup, Photo Sticker Overlay, Pink Balloons, Pink Trash Collage, Pixel Block Yard, Plasticine Lettering Poster, Retro Anime Poster, Retro Japanese Desk, Retro Riso Tiers, Retro Shopfront Vector, Riso Food Poster, Riso Overprint Grid, Scanned Fabric Scrapbook, Scarlet Manifesto Poster, Scrapbook Dream Board, Screen-Print Poster, Sunlit Vintage, Taped Zine Collage, Torn Poster Reveal, Toy 3D Render, Xerox Meme Window, Y2K Desktop Cover, Y2K Doll Storyboard, Y2K Flip Phone, Y2K Fruit Tabloid, Y2K Rave Poster, Y2K Techno Flyer, Zine Halftone

</details>

<details><summary><b>Motion → Motion (legacy mode)</b> (4 visible)</summary>

Product Showcase

</details>

<details><summary><b>Motion → SaaS</b> (42 visible, 6 hidden)</summary>

Acid Graphic, Adapts, Atomic, Aurora SaaS, Blocks, Break Typography, Cards & Text, Chalk Blueprint, Color Wipes, Corners Lines, Corners Pop, Dynamic, Echo Wave, Flat Beat, Flip Board, Folder Pop, Frames, Ink & Ribbon, Isometric Card Flight, Liquid Blob, Liquid Carousel, Magnet, Manifesto Pop, Masks, Nova, One Bit, Paper Carousel, PC Flat, Premium, Push In, Quantum, Relight, Rhytmic, Shutter Bands, Simple, Slot Roll, Smooth Wipes, Sticker Bounce, Transluscent, Velocity, Vibrant Carousel, Word Roll

_Hidden (only with `show_hidden=true`):_ Magazine, Coral Corridor Dolly, Bento Brand Promo, Launch, Brand Typing, 2d app

</details>

<details><summary><b>UGC → Talking head</b> (25 visible, 7 hidden)</summary>

Before and After, Blizzard, Camera Bump, Classic Unboxing, Couple Sharing At Home, Direct-to-Camera, Epic Fail, Giant Figure, How-To, Interview, Mystery Box, Product Crash, Product Dodge, Product Hit, Random Object Mic, Secret Hack Reveal, Selfie Testimonial, Spicy, This Gadget Saved Me, UGC, UGC Addiction, UGC Virtual Try On, Unboxing ASMR, Unboxing Virtual Try-On, Virtual Try-On Sneakers

_Hidden (only with `show_hidden=true`):_ Handbag Unboxing, Skincare Routine, Black Outfit Transition, Green Dress Try-On, Pink Vest Outfit Transition, Blazer Styling Transition, Skincare Testimonial

</details>

<details><summary><b>UGC → UGC (legacy modes)</b> (36 visible)</summary>

Crush Test, Giant Figure, Mystery Box, Pro Virtual Try On, Reboxing, TV Spot, UGC Addiction, UGC Virtual Try On, Unboxing ASMR, Unboxing Virtual Try-On, Virtual Try-On Sneakers, Wild Card

</details>

<details><summary><b>TikTok → TikTok</b> (25 visible)</summary>

Camera POV, Classic Meets Modern, Couple Sharing At Home, Direct-to-Camera, Mess to Fresh, Secret Hack Reveal, Selfie Testimonial, This Gadget Saved Me

</details>

<details><summary><b>Ads → General</b> (72 visible)</summary>

Accept or Decline, Annotated Tilt, Balloon Headline Trio, Beauty Markup, Benefit Ladder, Blue Scatter, Blue Wedge, Bracketed Review, Brush Notes, Callout Fan, Capsule Ring, Carton Cascade, Circle Punch, Clay Cloud Trade-Up, Clay Dreamscape, Concentric Rings, Crimson Curve, Cyan Chat Halo, Doodle Rocket, Dueling Timers, Emerald Cascade, Exploded Slices, Five-Star Handoff, Frosted Toggles, Fruit Orbit, Fuel Gauge, Gel Drift, Ghost Word, Giant Pack Stage, Green Grid Menu, Green Sash, Headline Wedge, In-Hand Detail, Ingredient Compass, Ingredient Halo, Lilac Question, Lime Percent, Mascot Lean, Masthead Float, Mid-Air Pour, Old Way New Way, Open Palm Ring, Orange Lasso, Orange Tape Diptych, Pickup Screen, Pictogram Spill, Pill Callouts, Pink Flat Lay, Plush Paw, Post Breakout, Prism Streaks, Proof Portrait, Purple Pedestal, Push-Up Pedestal, Quiet Numbers, Reminder Toggles, Sand Dune Plinth, Scribble Sunburst, Search Bar Answer, Skybound, Slide to Answer, Stacked Shout, Sunlit Pill Orbit, Ticket Stack, Toggle On, Tonal Spill, Torn Kraft Window, Trust Stack, Weightless Spec Grid, White Archway, Word Wallpaper, Zigzag Split

</details>

<details><summary><b>Posters → General</b> (174 visible, 1 hidden)</summary>

Airbrush Packshot, Amoeba Duotone, Archive Monogram, Badge Pileup, Binocular Flyer, Bitmap Blue, Blackletter Gazette, Blooming Letters, Blue Plate Mascot, Board Game Calendar, Botanical Gallery, Botanical Shrine, Breakout Plate, Brush Duet, Brush Wordmark, Brushstroke Sticker, Candy Clay Diorama, Cartoon Picnic, Chartreuse Starburst, Chromatic Ramp, Chrome Swarm, Chunky Doodle, Cinema Silhouette, Circle Crash, Circle Crop, Cobalt Crumple, Cobalt Rip, Comic Sandwich, Comic Starburst, Confetti Field, Constructivist Tilt, Coral Marker, Cornflower Protest, Cosmic Bloom, Crayon Mascot, Cream Cookbook, Crimson Fog, Cross-Stitch Script, Crowded Table, Cyan Bouquet, Deco Starburst, Desktop Diorama, Diagonal Slice, Die-Cut Window, Disc Drift, Dither Select, Dither Specimen, Doodle Halo, Doodle Takeover, Doodle Wordmark, Double Focus, Duotone Slash, Exploded Stack, Faded Label, Fanzine Lyrics, Fashion Tearsheet, Framed Interior, Gallery Plate, Garden Decal, Gaussian Haze, Giant Numerals, Giant Stride, Gingham Feast, Glass Colossus, Glitch Mosaic, Glitch Stack, Gouache Arch, Gradient Amoeba, Grain Orbit, Green Spec Sheet, Grotesk Staircase, Halftone Checkerboard, Halftone Collage, Halftone Eruption, Heatmap Silhouette, Heraldic Crest, Herbarium Plate, Hero Sandwich, Icon Tile Frame, Ingredient Cascade, Ink Inversion, Isometric Monolith, Kawaii Chrome, Knockout Star, Label Punchout, Label Quartet, Lavender Melt, Letter Scatter, Letter Weave, Letter Windows, Liquid Chrome, Magenta Crash, Manga Sunburst, Marker Callouts, Market Lithograph, Marquee Specimen, Mascot Blob, Mascot Grid, Midcentury Recipe, Monoline Doodles, Neon Bokeh, Neon Monoline, Newsstand Comic, Noise Circle, Numeral Overprint, Op-Art Patchwork, Orange Halo, Outline Echo Stack, Overflowing Hamper, Overprint Knockout, Pencil Conjure, Perforated Red, Pink Chevron, Pixel Feast, Plasticine Letters, Plasticine Parade, Pop Canvas, Portrait Ring, Pulp Paperback, Puppet Strings, Recipe Platter, Retro Specimen, Right Click, Ring of Five, Riso Desk, Riso Ink Stack, Riso Junk Drawer, Scissor Punk, Scribble Field, Scribbled Stars, Script Bloom, Serif Crossover, Serif Interrupted, Sideways Headline, Sideways Slab, Silhouette Pileup, Silkscreen Colossus, Silkscreen Trophy, Sparkle Trio, Specimen Callouts, Speech Burst Ring, Speed Smear, Sphere Columns, Staggered Colossus, Stapled Fragments, Starburst Halo, Sticker Sheet Grid, Storefront Vignette, Stripe Slice, Striped Arches, Sunset Halo, Surreal Reach, Swiss Punk, Thumbprint Monument, Tilted Overprint, Tinted Panel, Torn Paper Night, Tumbling Capitals, Type Eclipse, Type Sandwich, Vanity Tableau, Vinyl Die-Cut, Violet Scatter, Violet Zine, Widget Swarm, Wobbly Sunburst, Woodblock Punch, Xerox Ransom, Xerox Scatter, Y2K Desktop, Y2K Newsstand, Zigzag Condensed, Zine Punchout, Zine Riot

_Hidden (only with `show_hidden=true`):_ General

</details>

<details><summary><b>Marketplace → General</b> (66 visible)</summary>

Amber Ladder, Amber Orbs, Badge Orbit, Blob Cradle, Blush Browser, Blush Gloss Smear, Blush Sphere Tilt, Blush Tendrils, Capsule Slash, Charcoal and Gold, Chevron Specs, Chrome Cloudscape, Chrome Ribbon Spiral, Cobalt Tumble, Color Seam, Coral Spec Slab, Corner Numerals, Cream on Noir, Cream Splash, Daylight Tabletop, Dewdrop Spec Column, Didone Smoke, Ember Watermark, Emerald Blob Pour, Exploded Cascade, Figure Eight Ribbon, Flavor Tile, Frosted Botanicals, Frosted Spec Panel, Fruit and Ice Bed, Gel Tilt, Glass Plinth, Glass Ribbon, Golden Hour Glass, Gradient Spine, Hairline Radial, Ingredient Spill, Lacquer Blob Stage, Lid Ajar, Linen Landing, Liquid Ribbon, Lowercase Eclipse, Martini Ribbon, Navy Veil, Noir Landing, Petal Pool, Pink Tower, Poured Watermark, Red Sidebar, Red Tag Chain, Red Wedge Glitch, Ribbon Storefront, Satin Ribbon, Scarlet Fruit Cascade, Sideways Wordmark, Slash Label Ring, Spoon Stream, Spotlight Podium, Stone Pedestal, Streaked Gloss, Threaded Wordmark, Tilt & Tiles, Tilted Pill Stack, Tonal Echo, Torn Magenta Arcs, Violet Pour

</details>

### 1.5 Composer

| Control | Behaviour |
|---|---|
| Generation mode | **Image mode ⇄ Video mode** |
| Product slot | "Add your product". Actions: **Paste a link · Upload a photo · Choose from assets**. States: Add / Change / Remove Product. The badge says *Required* or *Optional with an edit*. Copy: "Choose a product image or add a link." |
| Avatar slot | Choose avatar → Selected avatar · Replace · Remove · "Preparing avatar…". Error: "We couldn't attach this avatar. Try again." |
| Reference | A photo reference. For `ugc` it is sent as `location_photo`; in Ad Reference it is a video |
| Website or social link | Placeholder `www.example.com`. Errors: "Add a website or social link.", "Enter a valid website URL" |
| Hook / Setting | Only when the format has `hook_and_setting`. Controls: *Replace hook · No hook · See all hooks* and *Replace setting · No setting · See all settings*. Lists in the next table. Users can create their own (`POST /marketing-studio/setup`; "Hook is required for preview generation"). Templates with a built-in hook show "This template can't swap its hook or take a setting yet. Keep its own hook and no setting." |
| Prompt | Placeholders: "Describe your edit" / "What should look different?" / "What do you want to change?" / "Describe the poster you want to create." / "Describe the scene you imagine...". Max 5,000 characters. The selected product and avatar are prepended as `<<<product:{id}>>> <<<avatar:{id}>>>` |
| Settings | Resolution, Duration, Aspect ratio and Batch, taken from capabilities (§1.3). "Aspect ratio: {x}" chip |
| Brand kit | A chip when `brand_kit: true` (product shot standalone, ads, posters, marketplace). Adds `brand_kit_id` |
| Generate | **Recreate template** / **Recreate** / "Recreating…". The cost comes live from `POST /marketing-studio/v2/costs/quote` (the quote uses the first 350 prompt characters). Up to 6 image references go in `medias[]` |

**UGC hooks** (`GET /marketing-studio/setup/hooks`):

| Hook | Type | Prompt |
|---|---|---|
| Product Hit | stunt | Object flies into frame, hits subject. Brief reaction → pivot to product. |
| Spicy | subtle | The shot starts with an extreme close-up of a collarbone, slowly tilts up to reveal a flawless makeup look, then pulls back into selfie framing before a silent pause leads into the product pitch. |
| Interview | subtle | Interviewer asks a second stranger a question based entirely on the first stranger's random answer; confusion builds until the second person naturally notices the product (Erewhon-style aspirational item) and pivots into a casual review. |
| Random Object Mic | stunt | During a casual vlog, a random absurd object falls into the person's hand from above, and they immediately use it as a microphone to continue a completely serious product review. |
| Product Crash | subtle | The product itself falls from above and destroyed, creating chaos; harsh sharpness leads to a perfectly clean and restored scene where a person calmly begins reviewing the product. |
| Blizzard | stunt | A cozy indoor scene is suddenly hit by a violent, impossible blizzard; chaos fills the room but the product remains intact and functioning, and once the storm stops, the product is still working. |
| Camera Bump | subtle | The camera operator accidentally bumps into a person, hitting their forehead; they react briefly, recover, and naturally reveal the dress (or product on it) while transitioning into a casual explanation. |
| Product Dodge | stunt | Suddenly, a product flies into a person's face; he quickly bends down to avoid a collision, and in the next frame he stands up straight and already holds the product in his hands and begins to review as if nothing had happened. |
| Epic Fail | subtle | A person performs an unsuccessful backflip, lands unsuccessfully, falls, and immediately, without pause, takes out the product and begins an unflappable review. |

**UGC settings** (`GET /marketing-studio/setup/settings`):

| Setting | Type | Prompt |
|---|---|---|
| Bedroom | realistic | On bed or propped against pillows, soft window light. Unmade bed, cozy textures. Relaxed morning or evening wind-down vibe — honest, low-effort feel. |
| Nature | realistic | Outdoors — trail, park, beach, or garden depending on product. Natural light, greenery or open sky. Active or peaceful mood — setting adapts to product. |
| Gym | realistic | Gym floor, locker room, or post-workout bench. Bright overhead lighting, equipment in background. Sweaty or freshly finished energy — product tied to performance or recovery. |
| Bathroom | realistic | Mirror selfie or front camera in bathroom. Ring light or vanity lighting, tiles visible. Intimate getting-ready energy — product shown mid-routine, close-up friendly. |
| Kitchen | realistic | Standing at counter or leaning on island, natural daylight. Clean surface, mug or fruit in background. Casual mid-day energy — product fits daily routine. |
| In Car | realistic | Selfie from passenger or driver seat, parked or cruising. Window light on face. Casual tone — talking to camera between errands. |
| Street | realistic | Walking on sidewalk or standing on urban street, handheld selfie. City backdrop — storefronts, traffic, pedestrians. Energetic pace, talking while moving. Spontaneous discovery feel. |
| Office | realistic | Desk setup, laptop open, coffee nearby. Clean modern space, soft overhead or monitor glow. Hushed mid-workday tone — quick product mention squeezed between tasks. |
| Airplane Wing | unrealistic | Person sits on airplane wing mid-flight at altitude. Casual product review — powerful wind, clouds, engine roar. |
| Roofing | unrealistic | Person on the edge of a skyscraper rooftop, city skyline stretched out behind … casual product review with the entire city below, character completely unbothered by the height — selfie camera, golden hour or dusk. |
| Volcano Rim | unrealistic | Person sits on active volcano rim, lava below. Casual product review — lava bubbles, smoke drifts through, zero reaction. |
| Tiny Reviewer | unrealistic | Person shrunk to 15cm next to a product their full height. Normal selfie review at impossible scale — leans on it. |
| Car Roof | unrealistic | Person on roof of moving car, desert highway, golden hour. Product review while swaying with the road. Semi truck passes — no flinch. |
| Train Surf | unrealistic | Person hangs outside a moving train, filming selfie. Reviews product — wind pressing on them is the live demo. |

**Request shapes.** From `868a8dba-HrPpX2Z25lsGHHPE.js`; the full set is under `marketingStudio.payloads` in the JSON.
- **Product shot, standalone:** `{style_id|preset_id, input_images, aspect_ratio?, prompt?, brand_kit_id?}`. A batch of N is sent as N separate requests.
- **Product shot, with model:** `{product_image?, character_photo?}`. One of the two is required.
- **Ads and marketplace:** `{type, product_image (required), want_person:false, notes ≤5000, aspect_ratio?}`.
- **Poster:** `{prompt and/or input_images}`, with `action: recreate` when started from a template.
- **UGC:** `{delivery_specs, product_photo?, character_photo?, location_photo?, user_context, marketing_studio_hook {id,name,prompt}?, marketing_studio_setting?, duration 15–30}`.
- **Legacy modes:** `{preset_id|style_id, prompt with tokens, hook_id?, setting_id?, avatars, product_ids, resolution, duration 4–30, generate_audio:true, medias ≤6}`.
- **SaaS:** `{brand_url | image, aspect_ratio (required), duration 5–15 (required)}`.

**Validation and error copy:**
- "Attach a product to generate"
- "Attach reference or product"
- "This style is no longer available. Choose another style."
- "An image is over 32 MB. Use a smaller one."
- "An image didn't load. Upload it again."
- "This hook or setting is no longer available. Pick another one."
- "Marketing Studio generation is temporarily unavailable."
- "We couldn't start the generation. Try again."
- "This product is no longer available. Choose another one."
- "Add screenshots of your app to generate"

### 1.6 Tools: Product Link, Ad Reference, App video

| Tool | Flow and copy | Request |
|---|---|---|
| **Product Link** (Click to Ad) | **"Make a video ad in one click"**: "Drop a product link, get an ad ready for TikTok, Reels, and Shorts. No filming, no editing, no brief." → product link, or "Or select your product" → **"Choose a style and start"**: "Pick what looks right for your product." → **Generate Video**. Badge: "TikTok Symphony and the studio". Errors: "Select a product or enter a product URL", "Enter a valid website link to generate", "{0} has no images" | `type: product_link`, `{style_id?, product_id or product_url, duration 4–30, resolution, aspect_ratio, batch_size}` |
| **Ad Reference** | **"Get inspiration from viral ads"**: "Paste a viral ad and turn it into your own — same hook, same energy, now selling your product." → Reference Ad Video (Upload your video / Choose from uploads or generations) → **Trim**: "Select up to 15 seconds for cloning" → "Analysing…" → **Review and Edit Script**, a scene list with time, title and description → Product, Avatar → Duration, Quality, Aspect ratio, Batch Size → Generate Video. Errors: "Analyse a video first", "The ad is still being analysed…", "This ad can be used as a concept only, not as a video" | `POST /marketing-studio/ad-references` (analysis returns `original_concept` / `adapted_concept`); `type: ad_reference`, `{ad_reference_id, product_id?, avatar_id?, include_reference_video:false, …}` |
| **App video** | "App video isn't available yet" (behind a flag). Input: a web product (app URL plus screenshots, `/marketing-studio/webproducts`), device Mobile or Desktop, prompt, avatar | `type: app_video`, `{web_product_id, device, prompt (required), avatars?}` |

A separate image-brief picker set is also in the bundle *(inferred: the Marketing Studio Image composer)*:

| Picker | Options |
|---|---|
| Use Case | Sell, General, Inform, Educate, Prove, Compare, Entertain |
| Style | Premium, Modern, Photoreal, Minimal, Bold, Aesthetic, Editorial, Retro |
| Format: Social | Instagram Post/Story, YouTube Thumbnail/Banner, Reel/TikTok/Shorts cover, Facebook Post, Pinterest Pin, LinkedIn Post, X/Threads Post, Spotify Canvas, Text Message |
| Format: Site | Web hero, Landing page, Blog featured image, Infographic, PDP image, Marketplace, Banner ad, Email header, OG card |
| Format: Promo | Poster, Flyer, Brochure, Billboard, Banner, Book cover, Menu, Newspaper ad, Magazine cover |
| Format: Cards | Business card, Postcard, Invitation, Loyalty card |
| Focus | Product-only (centered, isolated), Product-led (hero composition), Lifestyle (integrated into scene), Brand-led (pure brand mood, no product) |

### 1.7 Brand Kit

- **Entry.** The composer *Brand kit* chip opens **"ADD YOUR BRAND KIT — One link is all we need to keep every campaign perfectly on-brand."** with three choices: paste website → *Submit website*, *or* **Create manually**.
- **Progress.** "Analyzing your business..." → "Generating your brand kit..." → "We're researching and analyzing your business. It usually takes 1-2 minutes". A *Cancel generation* button is shown throughout.
- **Done.** **"Your Brand Kit is ready — Review your brand details - we'll use them to keep your content consistent across all generations. Feel free to edit this at any time."**
- **Empty state.** "No brand kit added yet — Paste a link or create one manually to get started".
- **Manual create.** Prompt: "Describe your business — what you sell, who it's for, what makes it yours". There are five example chips: Food & Beverage "Acme Coffee — we roast specialty beans…", Home & Lifestyle "Loom & Linen…", Fashion "Maison Vale…", Beauty & Skincare "Nora & Co.…" and Digital Services "Hatchwork…". An optional *Your Product* upload says "We'll generate a complete identity around it — palette, typography, mood, everything". Validation: "Add a description or upload images".

| Field (`data.*`) | UI |
|---|---|
| `brand_name` | Name / Company name, "Enter brand name" |
| `website_url` | Website |
| `logo` (or the first `images[]` item of type `logo` / `logo_primary`) | Upload logo / Replace logo |
| `tagline` | Tagline, "Enter your brand tagline" |
| `business_overview` (falls back to `short_description`) | Business details |
| `colors[] {hex}` | Colors, Hex color input |
| `fonts[] {name, type: headline/body}` | Fonts: HEADING FONT / Body, Google-fonts search, **Upload custom font** (.ttf/.otf/.woff/.woff2 after "Confirm font rights — Custom fonts require licenses…") |
| `brand_values[]`, `brand_aesthetics[]`, `tone_of_voice[]` | tag lists ("New item", "Add {title}") |
| `languages[0]` or `detected_language` | Language picker: 29 languages (Arabic … Vietnamese, incl. Kazakh) |
| `images[] {url, type, alt}`, `preview_image`, `screenshot_url`, `scrap_url` | Images (Add image), brand preview, site screenshot |

Record: `{id, status, latest_progress {step, step_label, step_index, total_steps, progress 0–1, status, error, at}, job_set_id, created_at, updated_at}`. API: `GET/POST /marketing-studio/brand-kits` (limit, offset) and `GET/PUT/DELETE /marketing-studio/brand-kits/{id}`. Actions: Use · Edit · Delete ("The brand kit will be deleted forever." — *No, keep it* / *Yes, delete*).

### 1.8 Products

Fields: **Product name** (required, "Acme Product"), Description ("What the product is and who it is for"), Price ("Price cannot be negative."), Audience ("People 30+ with dry, sensitive skin who avoid retinol"), **Selling points** ("Add up to five selling points."), Link ("Use a valid product link."), Pictures and Brand ("Brand of {product}" / "No brand" / "Assign to a brand").

Link reader copy:
- "Reading {0}"
- "{name} couldn't be read — Try again / Add by hand"
- "That link is already being read."
- "{0} is taking longer than usual…"
- "Found # products on that page and added the first {1}. Paste a product's own link to add another."
- "Paste the product's link — a description alone is not enough."

Duplicates: "«{0}» is already among this brand's products." → *Create anyway*. Products are stored in a library that is reused across templates, Ads Studio and the agents.

### 1.9 Avatars

- **Library.** Presets plus your own, with tabs, a gender filter, search and pins. The landing says "Pick from 40+ avatars" in one place and "100+" in the FAQ. The blog says With Model draws on "20 avatar templates".
- **Create.**
  - **Generate** from a text prompt ("Describe who you want to generate - age, style, vibe"; Soul 2.0).
  - **Upload** ("Turn any photo into an avatar", `POST /marketing-studio/avatars/extract`).
  - **Use AI influencer as avatar.**
- **Manage.** Name your avatar, Rename, Pin / Unpin, Delete, and save in a batch (`/avatars/batch`).
- **Errors.** "This image contains copyrighted content and cannot be used."; "Your avatars are still being generated. Leaving now will discard all progress."
- **Same face across variations.** The help article recommends training a Soul ID from 20+ photos.

### 1.10 Credits and limits

- **Video.** `marketing_studio_video` costs **3.5 / 5 / 13 credits per second** at 480p / 720p / 1080p (list price 4 / 6 / 13). The blog's examples: 8 s at 720p = 47.62 credits ($2.38); 15 s at 720p = 89.2 credits.
- **Images.** Product shot at 2K = **1.5 credits**; Poster at 2K = **7.5 credits** ($0.05 per credit).
- **Clip length.** Help and blog say 15 s per generation. The builder accepts up to 30 s for UGC and the tools.
- **Editing.** Only Posters can be edited afterwards (in Layers); every other category is regenerated.
- **Agents.** Help says template Marketing Studio is "not available through Supercomputer, MCP … yet". The **Marketing Studio Cards** skill does expose "321 layouts" of posters, Meta ads and listing cards to agents.

---

## 2. Ads Studio

Launched Sep 30, 2026. Routes: `/ads-studio` (home), `/ads-studio/all` (brand shelf), `/ads-studio/b/{brandId}`, `/ads-studio/brand-research[/{brandId}]`, `/ads-studio/ad-multiplier`; landing `/ads-studio-intro`. Job set types: `ads_studio_creative` (params `brand_id`, `product_id`, `run_id`) and `ads_studio_edit` (`version_id`). Backend service: `fnf-ai-cmo` *(inferred from the API gateway list)*. The public API equivalent, `POST /{studio}/ads-studio/v1.0`, is already in Fuobe as `ads-studio`.

**Home copy:** "Create performing static ads" · "Fresh ads for any product, anytime" · "On-brand ads for every product at scale" · "Every ad is shaped by market insights" · "Variations for each product in 1:1, 4:5, and 9:16, with headlines and CTAs" · "Start with tools" (Try ad multiplier · "Recreate ad with your products, characters").

| # | Step | Screen detail |
|---|---|---|
| 1 | **Enter your website** | "Enter your website. Your logo, colors, brand voice, and selling points load automatically. Edit anything". Inputs: website (`www.yourbrand.com`), *or* an "Instagram, TikTok or other profile link", *or* **Create brand kit manually**. Disambiguation: "Is this {brand}'s site?" / "We couldn't find it. Type its address to start" / "Pick it, or type another address". Cost line: "Your next brand research costs {n} credits"; the plan includes free researches per month ("This month's free brand researches are used up") |
| 2 | **Brand research** ("Usually takes about a minute") | Rotating labels: Reading your website · Determining the name of your brand · Distilling your primary colours · Tuning in to your tone of voice · Decoding your aesthetics · **Stalking your competitors** · Sharpening your selling points · Profiling your audience · Scrolling through your socials · Unearthing your values · Gathering brand details · Preparing your brand images · Building your brand kit · Finding your products. Fallbacks: "{host} showed no brand text. Fill in the brand kit manually.", "{host} returned an empty page…", "We couldn't read the site, so this kit comes from what is known publicly. Check it, or retry the research.", "Research incomplete … Retry research" |
| 3 | **Review your brand kit** | "Everything here shapes your ads, so edit anything that's off." Fields: Brand name · Website · Logo (upload/replace/remove) · Tagline · Colors (**Main** plus more; "Pick a color from the screen") · Description ("What the brand sells, who it's for and what makes it different") · **Selling points** ("Main reason to buy, e.g., Free shipping over $50") · **Aesthetics** ("Look and feel, e.g., Minimal, muted colors, natural light") · **Tone of voice** (words) · **Audience** ("Who the ads are for") · **Fonts** ("Display and body fonts, e.g., Playfair Display and Inter") · **Competitors** · **Socials** (Instagram, TikTok, YouTube, Facebook, LinkedIn, Pinterest, X, Threads, Snapchat, Telegram, Discord) · Additional details (free "Detail" entries) |
| 4 | **Select products to create ads** | "Your products are imported automatically — We pick them up from your site with names, images and prices. Missing one? Upload it and it joins the list". Controls: "{n} products found", Select all / Deselect all, **Add product from link**, **Upload product**, "Product details may contain mistakes. Please check your selected products before you continue." Up to **10 products** per run (landing). The free plan is limited per run ("Your free plan creates ads for # products at a time…", "Your free plan includes # free ads…") |
| 5 | **How many ads to create?** | A per-product stepper (− n +) up to **20 ads per product**. Summary: "Create # ads for {product pills} and the brand". **4 credits per ad** (blog: 10 ads = 40 credits ≈ $2, 20 = 80 ≈ $4); the total is shown before the run |
| 6 | **Grid** | "Generating # ads — they land in the grid as they render." Toolbar: Filter (All products / one product) · View **Split by products** · Layout / Card size / Fill-Fit · **Download all**. Card states: In queue · Generating · Processing · "Creative is on its way" · "Canceled before it was made" · "Not made — the run ended early" · "Creative generation failed" (Retry uses credits). Example carousel "Example ads" for empty brands |
| 7 | **Chat** (brand agent) | Greeting "{firstName}, what ads should we make for {brandName}?". Chips: "A lifestyle ad with the product in everyday use", "A clean studio shot with a bold headline", "A playful, colorful ad for social media". Composer: **Mention a product** (@ tag), Reference image. Placeholders rotate: "Generate {count} ads for my product…", "Change the background to a holiday setting for our winter sale…", "Make 4 ad variations for my product to A/B test…", "Localize the attached image for Japan, Brazil and Germany with local models…", "Write 5 versions with different headlines, descriptions and CTAs…". Usage panel: Text / Image / Video / Audio credits, Generations, Edits, Variations, Products, Creatives, Research |

- **What an ad is.** One image built on a selling angle (benefit, pain point or real-life use; price/offer-led, ingredient/material story, how-it-is-used, lifestyle/moment), with headline, copy and CTA. The output is static only; for video the blog points to Marketing Studio.
- **Brand shelf.** "Every brand gets its own research, products and ads". Delete copy: "“{name}” leaves the shelf with its kit and its products. Ads already made with it stay."

---

## 3. Ad Multiplier

Launched as a Claude skill on Aug 25, 2026; the web UI followed on Oct 6, 2026.

| | |
|---|---|
| Route | `/ads-studio/ad-multiplier` (recreate: `?{param}={jobSetId}`) |
| Job | `ad_multiplier_v2` (plus `ad_multiplier`, `ad_multiplier_replace`); model **Seedance 2.5 edit** (skill page: "Editing variations with Seedance 2.5") |
| Layout | Form on the left, *My generations* on the right. Empty state **"One ad, many versions"** with four cards: Start with an ad you like · Find a better hook or CTA · Say it your way · Get a batch at once. Footer: "Swap the characters, outfits, locations, and products. Motion, timing, and audio stay untouched." *(inferred placement)* |
| Reference video | One video, **4–30 s** ("Add a reference video to recreate · Video duration: 4-30 seconds"), trimmable |
| Images | Up to **20** ("Add up to 20 images"). Mention them as `@image_1`… in the text; they are sent as `<<<image_1>>>`. Errors: "This image is already added", "This image was made for that run and can't be added" |
| Parts | **Prompt** (default on): "Recreates the reference video with your characters, products, and any changes you describe." Placeholder "Describe your new version — e.g. 'the same ad for the German market with a woman in her 30s' or 'keep the original voice'. Mention attached images using @...". Default text "Recreate this ad." · **Change hook**: "Keeps the rest of the video as is and adds or replaces the opening hook. Disables the prompt." ("Write your hook — e.g. 'What if your AI videos paid your rent?'") · **Change CTA**: "Keeps the rest … call to action at the end. Disables the prompt." ("Write your call to action — e.g. 'Start creating for free today'") |
| Rules | Prompt and Hook/CTA are mutually exclusive; Hook and CTA can be on together. In sections mode the text is sent as `HOOK: …\n\nCTA: …`. Max **4,000** characters ("Keep the words under 4000 characters") |
| Quality | **480p / 720p / 1080p**, default 1080p. The cost table also lists 4K, which the UI does not offer |
| Quote | `{job_set_type: ad_multiplier_v2, params:{duration, resolution, mode: full or sections, section: hook, cta or both}}`. Failure copy: "Failed to calculate the price. Please try again." |
| Cost | **3 / 7 / 16 credits per second** at 480p / 720p / 1080p, with or without video (4K 26–27) |
| What changes | Product, cast, location, script, hook or CTA. Original audio is kept on every non-translated variant. Captions can be removed or regenerated in another language with a synthetic voiceover (skill). Hooks and CTAs can be retried without re-uploading |

---

## 4. Click to Ad / Link to Video Ad

**Now.** Click to Ad is the Marketing Studio **Product Link** tool (§1.6). `/apps/link-to-video-ad` and `/apps/click-to-ad` lead there.

**Before**, the legacy app *(still in the bundle)* worked like this:
1. Landing: "TURN ANY PRODUCT INTO A video AD — Paste a product URL and we'll create a scroll-stopping video ad with AI avatars and voiceover in minutes."
2. **Product page URL**, or *Build from scratch*.
3. **BUILDING YOUR PRODUCT KIT** (1–2 min): Connecting to website → Extracting product images → Finding brand colors → Locating logo → Processing details → Finalizing product kit. A mini-game runs while you wait: "Press Space to start".
4. **YOUR PRODUCT KIT** ("Review the details we extracted. You can edit anything before generating your video."):
   - Product images: "These 3 images will be used in your video"; extra *Additional images found* can be dragged up to swap; at most 5.
   - Logo & Brand colors.
   - Product name (required) and Description (required).
5. **CHOOSE YOUR AD STYLE**: presets, **Script mode** (*Auto-generate* / *Custom script*: "Add specific instructions for your ad script (e.g., highlight eco-friendly materials, include limited-time offer, emphasize free shipping)"), **Video quality** (Standard / High / Premium, with the credit cost per option).
6. **CREATING YOUR VIDEO** (2–5 min, up to 10 for high quality) → **YOUR VIDEO IS READY**. Actions: Create another, Edit Product Kit, Go to Library.

The FAQ said 9:16 output, up to 12 s, "over 25 presets" with hard-coded captions or a "no caption" style. The live preset list (`cms…/link-to-ad-presets`) has 10 visible plus 2 hidden: Simple UGC, Clean Minimal, Unboxing, Customer Reviews, Viral Chaos, Luxury, Product Story, Cozy Morning, Red Carpet, Elegant Minimal (hidden: Sport Division, General). API: `POST /brand-kits/scrap`, `POST /chains/link-to-ad` (`dry_run=True` returns the credits).

---

## 5. Faceless Studio

Standalone since Aug 20, 2026; before that it was a Supercomputer skill. The agent version also exists as **Faceless channel** in Supercomputer: "up to 15 minutes, 12 visual styles", with AI script, voiceover, 2D animation, music and subtitles.

| | |
|---|---|
| Routes | `/faceless-studio` (home), `/faceless-studio/new`, `/faceless-studio/channels` ("My channels"), `/faceless-studio/channel/{id}` |
| Job | `youtube_faceless_video` (`POST /jobs/v2/youtube_faceless_video`, idempotency key per channel). Pipeline models per the skill pages: **Gemini Omni Flash** video → narration → "Montage and adding subtitles" |
| Home | **"Create your Faceless channel"**. Genre tabs *Education · History · Kids · Storytelling*. Prompt "Channel idea" with examples (Channel about survival in the wild / the rise and fall of empires / ancient civilizations / daily history facts / famous heists and scams / songs for kids). **Reference** (YouTube link) · **Upload script** · **Next** · "Or create with the studio's MCP". Showcase "Made by the studio" (9 episodes, e.g. *The Raven Who Stole the Light*, *POV: 17th Century Factory Worker*) |
| Genres | Education "Explain how something works" · History "Retell what actually happened" · Kids "Bright, simple, and safe" · Storytelling "Carry one story to its end" |
| Step 1 | Channel idea and category ("Pick category"). The channel name and avatar are generated ("Generating channel name"; Rename channel / Change channel avatar) |
| Step 2 | **"Choose topic of the first episode"**: "Writing topic suggestions…"; tick one or press *Generate new topic suggestions*; or type "What is the first episode about?" (≤5,000 characters). Landing: "Hot right now, built in — the studio tracks which niches are climbing" |
| Step 3 | **Video settings**, then Generate → "Generating your episode": "This can take a while for longer videos. You can close this page — it will keep running." / "Go to channel while it renders" |
| Length | **1, 2, 3, 4 or 5 min** (60–300 s; "Choose one of the offered video lengths") |
| Animation | **Fully animated** ("Seamless motion video", "Continuous animation across every scene") or **Frame by Frame** ("Scene by scene video", "Creates your video from a sequence of generated scenes", "paced stills, faster and lighter on credits") |
| Aspect | 16:9 or 9:16 · Subtitles on/off |
| Style | 12 presets (next table), or **Use your own style** with up to 3 style reference images, which replace the preset ("Choose either a style preset or your own style references"). If styles fail to load: "Styles could not be loaded. You can continue — the default style for this category will be used." |
| Narrator | "Select narrator voice": a library with previews (presets plus your voice elements, `GET /reference-elements/voices`); the choice is saved to the channel |
| Script | AI-written by default; or paste or upload a `.txt` (≤12,000 characters; "Use either a pasted script or an uploaded file") |
| Reference | A YouTube channel, video or playlist link ("That does not look like a YouTube channel, video or playlist link."). Landing: "A link is enough - palette, technique and pacing matched, nothing copied" |
| Elements | Characters, locations and props as image sets; "Real faces are not allowed"; IP check required |
| Payload | `{channel_subject or topic, script or script_file_id, duration_seconds, aspect, subtitles, genre, animation_mode, preset_id or style_reference_urls[≤3], reference_url?, voice_id + voice_type, identity_id?, channel_id?, medias?}` |
| Channel page | Episodes · Create new episode · **Upscale to 1080p** · an **editor**: pick a segment on the timeline (Shift for a run, Cmd for non-adjacent; a capped number per request) and describe the audio or video change; queue several and see the price; then apply or discard each ("Applying publishes this one change. Discarding keeps the current version and does not refund the generation cost.") |
| Cost | Charged in 10-second blocks: **fully animated 41 credits per block, frame-by-frame 16 per block** (rounded up). One minute is 246 or 96 credits |

**Styles** (`cms…/youtube-faceless-presets`, in priority order):

| Style | Description |
|---|---|
| Editorial Motion Graphics | layered cutouts, animated labels, diagrams, documentary pacing (skill examples) |
| Stickman Cartoon | "Turn a story or concept into an animated explainer with simple stickman characters." |
| Fairy Tale & Myth | "Explain a subject through imaginative scenes inspired by fairy tales and mythology." |
| Paper Diorama | "Tell a story through layered paper-like scenes and cutout characters." |
| Hand Drawn | "Explain an idea through hand-drawn illustrations and animated scenes" (sketched, storybook-like) |
| Mannequin | "Tell a story with stylized mannequin figures instead of an on-camera presenter." |
| Poster Vector | flat poster-style vector *(inferred)* |
| Colorful 3D | bright toy-like 3D *(inferred)* |
| Watercolor Chronicle | painterly watercolor documentary *(inferred)* |
| Paper collage | torn-paper collage *(inferred)* |
| Studio 3D | studio-lit 3D *(inferred)* |
| Pastel Flat 2D | "Create a faceless explainer with soft pastel colors and simple flat illustrations." |

The changelog said "8 presets, from Stickman Cartoon to Studio 3D"; the live list has 12.

---

## 6. Explainer

The standalone app launched Jul 2, 2026; the skill came a day earlier.

| | |
|---|---|
| Route | `/explainer` (landings `/explainer-intro`, `/ai-explainer-video-maker`) |
| Job | `video_explainer` (`POST /jobs/v2/video_explainer`). Concept: one voiceover over several stylized **10-second blocks** in one visual style; animated only, no photorealism |
| Layout | A form card titled **STUDIO EXPLAINER**: preset card + *Change*, prompt, sources, then a row of Aspect / Duration / Voice / Subtitles and **Generate**. A History grid (Show all / Liked, search). A presets drawer. "How it works": **Choose Preset** → **Attach a file or just prompt** → **Download your result** |
| Prompt | "What should the video explain?", "Type a topic, or attach files below", e.g. "Explain how dinosaurs went extinct, for kids". ≤5,000 characters |
| Sources | Up to **3** per video: files (images or documents) or a link ("Paste a link – article, page"). At most **14** reference images and files |
| Aspect | Horizontal 16:9 / Vertical 9:16 |
| Duration | **Auto**, 20 seconds, 30 seconds, 1 minute, 3 minutes, 5 minutes, 10 minutes, or **Manual** (a whole number of seconds from 15 to 600) |
| Voice | Narrator picker (preset or your element voice). **Subtitles** toggle (appends "with subtitles" to the prompt) |
| Price | "How calculations work? — You're only charged for the actual length. The exact cost isn't known upfront - the price shown is an approximate estimate, and the final charge matches the actual video length." |
| Payload | `{prompt, medias:[{role:image or file}], aspect_ratio, duration ('auto' or seconds), preset_id, voice_id, voice_type}` |
| Errors | "Add a prompt, or attach a file or link"; "Duration must be Auto or a whole number of seconds between 15 and 600"; "Maximum 14 reference images and files allowed"; "{file}: only images and documents are supported"; "Up to 3 sources per video — remove one to add another" |

**Styles** (22 visible, in order): Editorial Motion Graphics, Stickman Cartoon, Watercolor Chronicle, Fairy Tale & Myth, Paper Diorama, Pastel Flat 2D, Colorful 3D, Hand Drawn, Poster Vector, Mannequin, Whiteboard Doodle, 3D Papercraft, Mixed Media, Low Poly, 2D Illustrator, Pixel Art, Claymotion, Isometric Flat Vector, 3D Mix, Studio 3D, Fluffy Toy, Paper collage. Hidden: Dynamic Motion Design, Vintage Documentary and a test entry.

---

## 7. Canvas

| | |
|---|---|
| Routes | `/canvas` (list), `/canvas/{id}`, `/canvas/templates/{templateId}`, `/canvas/{id}/embed`. The board syncs in real time through `{studio-service}` |
| List page | "Generate stunning media with AI Canvas" / "Make images, videos, and ideas in one place". Tabs **All Canvases · Templates · Quick Start**. Search canvases. Card: preview, "Last edited {n}m/h/d ago" or "Never edited", "• Shared". Menu: Rename, Duplicate ("Copy of {name}"), Delete project |
| Empty board | **"BUILD FREELY. AUTOMATE VISUALLY."** — "Double or right click anywhere to create a node and start generating." — *Create your first node* |
| Toolbar | Select (V) · Pan (H) · Draw (D) · Eraser (E) · Sticky Note (N) · Shapes (R) · Text (T) · Reaction (Shift+S) · Comment (C) · Table (Shift+T) · Page · Search (⌘F) · **Add node** |
| Run | **Run node · Run all · Run pipeline** ("Selection is running", "Running…"). Build for free; credits are spent only when a node generates; Unlimited plans don't apply |
| Node context menu | Open preview / Full preview · Download (⇧⌘E) / Download selection · Copy as PNG · Copy attributes · Create element · Add media to chat · Show on feed · Edit · Delete · Lock / Unlock node · Bring to front / Send to back |
| Collaboration | Real-time multiplayer, Share, roles Viewer / Collaborator, request access. Autosave; a hard refresh restores the last autosave |

**Node menu** (`Add node`, double-click or right-click; from `868a8dba-XnFFagQC9hawzxYn.js` and `868a8dba-aPCdbQG2cOi_5z1l.js`):

| Group | Node | Tool / generation type | Notes |
|---|---|---|---|
| Basics | **Prompt** ("Prompt Box") | `prompt` | text that feeds generators |
| Basics, Image | **Image Generator** | `generate-image` | any image model; image results offer Edit, Remove background, Upscale, Expand |
| Basics, Video | **Video Generator** | `generate-video` | any video model. **Seedance** takes connected references, but each role must be described at the start of the prompt. **Kling** treats a connected image as the *start frame*; use `@element` for characters. Multi-shot total 3–15 s; scene prompt ≤512 characters; ≤9 reference images and elements |
| Basics, Audio | **Voice Generator** / Voiceover | `generate-audio` · `text2speech_v2` | preset voices or a clone (record 10 s–2 min; MP3/WAV ≤11 MB) |
| Basics | **LLM Assistant** | `llm` (OpenRouter) | text generation |
| Basics | **Page** (New) | `space` | a nested canvas |
| Video | **Video Concatenator** | `generate-video` · `video_assemble` | stitch clips (behind a flag) |
| Audio | **Change Voice** | `voice_change_merge` | |
| Audio | **Translate** | `dubbing_lipsync` | translate and lip-sync |
| References | **Upload** | `media` | image, video, audio, PDF/DOC/DOCX |
| References | **Assets** | — | an existing generation from the library |
| Utilities | **Text**, **Sticky Note**, **Table** | — | board annotations |

- **Connections.** Drag one node's output into the next node's input: prompt → generator → next generator. Reference and audio nodes attach to generators.
- **Compare.** Run several generator nodes from one prompt and compare them side by side.
- **Templates** (`canvas-worker…/api/templates`): Long Video Example · Simple Seedance 2.0 · Extend Video · Image Edit · StoryBoard With Elements.
- **Figma.** FigJam gets "Canvas Nodes" with chain workflows.

---

## 8. Katana

Launched Oct 8, 2026; blog Oct 12.

Katana is a **Claude skill** that rebuilds a reference edit with your characters, products or clothing through the studio's MCP. `{studio-site}/katana` prepares the brief and hands it to Claude.

| | |
|---|---|
| Page | Hero "Recreate the edit. Make it yours" / "Powered by Claude Motion". Tabs: Katana presets / Community presets / Explore. How it works: Recreate an edit → Add your content → Make more versions → Create directly in Claude |
| Form | **Add a reference video** ("Upload the edit you want to recreate"; trimmer) · **Add your characters** ("Also you can add other details (optional)"; up to 5 photos per the blog; preset schemas allow 1–10 images) · **Instructions (optional)** toggle ("Describe anything the model should pay attention to when recreating this video"; ≤2,000 characters) → **Send & Generate in Claude**. When the prompt is too long for a link: "Copy this prompt and paste it into a new Claude chat" |
| In Claude | `/katana` opens the catalog, `/katana/<preset>` runs one, or a plain request. Files attached in Claude are not passed through, so Katana opens a studio upload window; direct media links work, profile links don't |
| Presets | Categories **Personalized edits · Style transfer · Motion transfer**, sources the studio and Community. Live API: 101 community presets (79 personalized edits, 18 style transfer, 4 motion transfer), each with `input_schema {media.images: uuid[1..10], slot_values.prompt ≤2000}`. Launch copy said **Aura Farming, Motion, Clipping**; the hero still reads "Aura-farming machine by the studio & Claude Opus 5.5" |
| Publish preset | A 3–30 s video for the motion, up to 40 images, and a prompt that mentions them with @. It goes live after an automatic check and can be reported (8 reasons) |
| Output | MP4 with the reference's duration, aspect ratio and frame rate. The reference soundtrack is kept unless asked otherwise. The result shows in the chat and in Assets. Job type `katana` (retry and rerun supported) |
| Cost | Plan credits. Claude shows the exact cost before each generation; corrections may add more |

---

## 9. Virality Predictor

| | |
|---|---|
| Route | `/apps/virality-predictor` ("Viral Potential Predictor"; beta) |
| Job | `brain_activity` (`POST /jobs/v2/brain_activity`); demo `GET /api/hook-predictor/demo-analysis` |
| Input | MP4, MOV or WEBM, ≤200 MB, **≤15 s analysed** ("Select clip — Choose up to 15 seconds to analyze."). Upload from device or pick from your generations |
| How it works | **Drop the clip** (any format, up to 15 s) → **We analyze** ("A modeled audience watches while we map the brain response across vision, sound, memory, attention, language") → **See results** ("a virality score, a peak hook timestamp, a hold rate, and a heatmap…") |
| Result screen | Overall Score · Viral Potential · Hook Score · Hold Rate · Duration · a per-second engagement curve with the video synced ("{t} of {duration}") · **Brain Activity** 3D model (three.js; "Turn on hardware acceleration…") · Global activity · Previous analyses carousel · *Analyze another*. Tagline: "We simulate the cortical response of 720 modeled brains, second by second" |

**Output fields** (from the demo analysis):
- `score`, `viral_potential_score`, `hook_score`, `brain_engagement_score`, each 0–100.
- `verdict` ("Needs work.") and `verdict_tag` ("Below baseline").
- `engagement[]` at 1 Hz, `peak_t`, `peak_val`, `peak_idx`, `mean`, `sustain`.
- `per_frame{region:[…]}`, `regions[]`, `tips[]`.
- `score_details` = {disclaimer "Predictive proxy metrics, not guaranteed performance or clinical measures.", normalization 0..100, `hook_window_seconds` [0,3]}.
- `brainRender {mode: vertex-map, brain GLB, vertex map binary, regionAnchors}`.

**Regions** (all defined on the fsaverage cortical mesh):

| id | Name (short) | Label | Vertex basis |
|---|---|---|---|
| visual_occipital | Visual Cortex (Visual) | Activation | y ≤ −55 |
| frontoparietal_attention | Attention Control (Attention) | Activation | \|x\| ≥ 30, z ≥ 19, y ≥ −55 |
| auditory_temporal | Auditory Cortex (Auditory) | Activation | \|x\| ≥ 38, −55 ≤ y ≤ 10, −30 ≤ z ≤ 25 |
| language_frontotemporal | Language Network (Language) | Activation | lateral temporal (\|x\| ≥ 39, −55 ≤ y ≤ 10, z ≤ 5) or inferior frontal (\|x\| ≥ 15, y ≥ 35, z ≤ 0) |
| default_mode | Focus Drift | **Lower better** (inverted) | medial: \|x\| ≤ 18 and (y ≤ −45 or y ≥ 25) |

**Open model.** Meta's **TRIBE v2** (`facebook/tribev2`, CC BY-NC 4.0, March 2026) predicts fMRI responses to video, audio and text on the **fsaverage5** mesh. It is built from V-JEPA2, Wav2Vec-BERT and Llama-3.2-3B. The fsaverage bases and the "modeled brains" wording strongly suggest the studio runs TRIBE v2 or a derivative *(inferred)*.

---

## 10. Assets library

| | |
|---|---|
| Routes | `/asset/all` (default), `/asset/projects`, `/asset/elements`, `/asset/sub-workspaces`. The same library components power the Cinema Studio, Marketing Studio and Ads Studio feeds |
| Sections | All · Image · Video · Audio · Shorts Studio · Explainer · Marketing Studio · Characters · Lipsync · Uploads · Liked (My favorites) · Elements |
| Projects | New project · Find project.. · Sort · Pin · Hide/Unhide (Undo toast) · Edit project limit (credit cap) · Members · Transfer ownership · Leave · Delete |
| Folders | Nested ("Scenes, versions, deliverables"). Each has a colour, a pin, a manual drag order and a credit limit ("Folders with a credit limit can't be moved"). Actions: Duplicate · Move to / Copy to (incl. "Create new folder and transfer files") · Share with roles · Delete (contents move to the parent; restricted folders' contents go to Trash) |
| Folder colours | Cyan #5DDCEB · Slate #CBD5E1 · **Lime #D1FE17 (default)** · Violet #A78BFA · Purple #C084FC · Pink #F472B6 · Yellow #FDE047 (body gradient end colours) |
| Review status | In progress #029dfe · Needs review #fe7802 · Approved #d1fe17 · Rejected #ef4444 |
| Drag and drop | "Drop files here to add to project" / "Drop to upload". Drag cards onto folders; errors "Already in this folder", "Cannot move into itself", "Cannot move into a subfolder" |
| Selection bar | "**{n} selected**" · *Unselect All (Esc)* · Download ("Download # items") · **Add to** · Like selected / Unlike selected · Delete selected · More actions: Publish / Unpublish, Remove selected (from a folder or project), "Confirm rights · {n}", **Send to Canvas**, Share to Chat |
| Trash | "Items can be restored to this project for **30 days**." Tabs All · Generations · Elements · Uploads · Folders. Actions Restore · Delete permanently · **Empty trash** ("…including any hidden by filters, can no longer be restored. Copies in owners' libraries and in other projects are not affected."). Generations go to Trash; uploads are deleted at once; "Keep # running generations out of Trash". Restore falls back to the project root when the original folder is gone, in Trash, moved or too deeply nested. Empty state "Trash is empty — Folders, generations, uploads and elements removed from this project appear here." |
| Filters | **Type**: All types, Image, Video, Audio, PDF, TXT, MD, HTML, DOCX, PPTX · **Activity**: Generated, Uploaded, Liked, Downloaded, Not viewed · **Scope**: *Show subfolders content* ("Include generations from nested folders") · **Status**: Hide failed, review statuses · **Author**: Anyone, You, Owner, member search · **Date**: Today, Last 7 days, Last 30 days, Custom range · media Images only / Videos only. A filter-mismatch tooltip says "Your new {type} won't appear under the {filter} filter" |
| Layout | **Square · Masonry · List** · **Split by date** · **Card size** slider · **Fill previews / Fit previews** · Hide grid covers · Split View / Full View (resizable) |
| Storage | 20 GB default (raised from 5 GB on Jul 6); expandable from +10 GB up to 1 TB in total |
| Empty states | "Your creations will appear here." / "Let's make magic" · "No generations match your filters" · "Nothing liked yet — Mark the ones you like to save them here" · "Favorites from all projects and folders show up here" |

---

## 11. Supercomputer: Skills, Projects, Memory

**Sidebar:** New chat · Search · Projects · Skills · Connectors · Apps · Games · Memory · Faceless channel · Chats.

### Skills

- **Tabs.** Built-in / Skills by the studio · Made by community · My skills · Learned (built by Supercomputer from your chats) · Trending.
- **Create.** "Create skill" ("Save a reusable prompt or workflow"), or upload a `.zip` or `.skill` file. The upload is validated against SKILL.md ("Check SKILL.md and try again").
- **Use.** Call with `/name` or let the agent pick it automatically. Skills also run through MCP in Claude and the ChatGPT plugin.
- **API.** `fnf-skills-marketplace /api/v1/skills/{builtin,community,personal}`, with `/install` and `/publish`.
- **Catalog size.** 20 built-in (preinstalled) skills plus 48 more official ones, for **68** official in all. **362** community skills, mostly in content creation and creative marketing; the top ones by installs are Social Content, GPT Image 2 Director, Ad Creative and Seedance Prompting Skills For Cinematic Films.

| Built-in skill | Subtitle / what it does |
|---|---|
| Website Builder | websites, web apps or browser games (`create_website` / `deploy_website`) |
| Katana | "Remix a reference edit for your subject, or edit your own footage, into a finished video" |
| UGC Studio | "Six creator formats, one production workflow" (creator review, product-only voiceover, unboxing, try-on, tutorial, website tour) |
| Brand Asset Creation | "Logo and brandkit from scratch or your existing assets" |
| Visual Studio | "Classic, high motion, typography, infographics and product reels with MiniMax H3" |
| Product Photographer | "Studio product photos, no studio" |
| Cinematic Director | photoreal multi-clip short film or scripted scene |
| Narration | text plus voice → finished narration takes with guaranteed length |
| Thumbnail Generator | "Cinematic top-tier thumbnails and video covers" (4K frame with text) |
| Image Repurposer | "One creative in — a ready pack for every platform out" |
| Faceless Studio | "Illustrated explainers, stories, documentaries and kids videos" |
| Video Repurposer | "One video in — platform-ready cuts out, reframed, captioned, QC-checked" |
| Amazon Listing Designer | "Product cards that sell" (main image, secondary images, A+ modules) |
| Marketing Studio Cards | "Posters, Meta ads and listing cards from one product photo" (321 layouts) |
| Video Motion Graphics Editor | add animated graphics to footage; reusable style guides |
| Video Editing | "Native video editing with editable layouts and motion choreography" ({studio-edit}) |
| Video Montage | concat, music, subtitles, post-processing |
| YouTube Script | six genres, hooks, timestamps, production cues |
| Character Sheet | "Cast a character, lock the wardrobe, and get a verified front/back/portrait reference sheet" |
| Social Media Research | Instagram / TikTok / YouTube / ad-library research |

Other official skills, by usage: Audio Generation, Seedance Cinematic Prompter, Generative Video Editor, Script Writer, Content Analysis, Create Skill, **Ad-Multiplier**, Organic Marketing, Adobe Connector, Cartoon Animator, Pdf Creation, Product Data Extraction, Powerpoint, **Canvas Workflow** ("Lay out, wire, and run generation graphs directly on your canvas"), Product Animator, Motion Designer, Youtube Research, Scene Builder, Seedance VFX Prompter, Soul Identity, Ad Copy, Cinematic Location, Brand Asset Extraction, UGC Creator, Video Restyler, Persona Image Generation, Property Photo Editor, Video Reangler, Motion Craft, Premium Motion Designer, TikTok Trend Analyzer, FaceLab, Product UGC Reviewer, YouTube Retention Writer/Analyzer, Try-On UGC Stylist, Headshot Studio, Tutorial UGC Creator, Unboxing UGC Creator, Staging Diagram, Video Element and several Cinema production helpers. The help article also names Shorts Maker, YouTube Covers and Personal Clipper, plus use cases TV Commercials, Animated Infographics and Localization.

### Projects

Projects arrived in Supercomputer on Aug 23, 2026.

- **Concept.** A shared workspace that keeps context. Instructions are shared, but each person's chats and memory stay private.
- **Sections.** Chats · Assets · Memory. The empty composer reads "What are we creating in {project}?".
- **Settings.**
  - Details: name, colour, Private or Shared ("You and members can view chats").
  - **Instructions**: "Guide Supercomputer on how it works. Explain what it should do and how it should respond."
  - **Skills**: "Agent can use only added skills"; project skills take priority.
  - **Sources**: files, links (web search inside the dialog), images, videos and elements; "This project can have up to 20 sources."
  - **Connectors**: the personal connectors members can use in this project.
- **Elements.** Uploaded images and videos become named Elements (Characters, Locations, Props).

### Memory

- Tagline: "Supercomputer's memory — Learning from every chat".
- Categories: Preference, Communication, Convention, Coding Style, Environment, Tooling, Troubleshooting, Notes.
- Actions: **Add a memory** ("Remember that:"), **Import** (from Claude, Claude Code, Codex, ChatGPT), Delete memory ("This cannot be undone").
- Scopes: personal, **project** (kept separate) and per-AI-Employee (AI Employees 2.0, Jun 19).

**The agent's tools**, from its status labels: web search and page reading; YouTube, Instagram, TikTok and ad research; brand, product and catalogue CRUD; generate ads, edit creative, variations, restore version; save to library; canvas inspect, edit and run workflow; Cinema Studio settings; project brief, folders and assets; element CRUD; create, deploy and publish websites and games; app branding; analyse image, video, audio and documents; detect scene cuts; use and update memory; load and manage skills; a browser; 3D scene editing and GLB/.blend export.

---

## 12. Fuobe today vs this research

| Studio | Fuobe now | Gap |
|---|---|---|
| Marketing Studio | The studio `marketing-studio-image` model with a live template picker (image only); prompt apps Ad Creative, Packshot, Poster, Product Placement… | No categories or formats, no product, avatar, hook or setting slots, no brand kit, no video formats, no tools |
| Ads Studio | `ads-studio` model (batch ≤4) | No brand research, products, per-product batches, 3 aspect variants, grid or chat |
| Ad Multiplier | — | Not built |
| Click to Ad / Link to Video Ad | Two apps with parity notes (photo → one creative or one clip) | No URL import, product kit, styles, script or voice |
| Faceless / Explainer | — (the storyboard → film chain is the closest) | Not built |
| Canvas | `/workflows` lists ComfyUI graphs | No in-app node board |
| Katana | — | Not built |
| Virality Predictor | App that only improves the hook frame (parity: "not reproducible") | Now reproducible with TRIBE v2 |
| Assets | `/library`: search, kind filter, favorites | No projects or folders, trash, bulk selection, layouts or filters |
| Supercomputer | `/assist` agent + MCP | No skills catalog, projects or memory |

## 13. Build plan for Fuobe

The order follows reuse: the brand kit and products feed four studios, and the faceless pipeline also feeds Explainer and Katana. Exact model ids per step are in the JSON `fuobe.buildPlan`.

1. **Brand kit + products (M).**
   - Storage: SQLite `brands` (kit JSON) and `products` (name, description, price, audience, ≤5 selling points, url, images).
   - A brand-research job:
     - fetch the HTML and look for Shopify `/products.json`, JSON-LD `Product` and OpenGraph tags;
     - logo from inline SVG, `og:image` or `apple-touch-icon`;
     - colours from CSS custom properties plus k-means over a screenshot;
     - fonts from Google Fonts links, `@font-face` and `font-family`;
     - an LLM fills description, tagline, selling points, aesthetics, tone words, audience, competitors and language: Claude, Ollama, or a rule-based fallback, as in Assist.
   - Reuse the studio's 14 progress labels as rotating step text. No image model is needed, so this works the same in open and paid modes.
2. **Assets library extras (M).**
   - Projects and nested folders with the 7 colour swatches, pins and drag order.
   - Drag-and-drop into folders.
   - A bulk selection bar (Esc clears; zip download, add to folder, like, delete, send to Assist/Canvas).
   - Trash with 30-day restore and Empty trash.
   - Filters: type, activity, date ranges, status, studio.
   - Square, Masonry and List layouts; Split by date; card-size slider; Fill/Fit.
   - All local, both engines.
3. **Marketing Studio (L).**
   - `/marketing`: sidebar (Home, My generations, Favorites, Tools: Product Link and Ad Reference, Projects), hero, the 7 category tabs with All/Images/Videos, and the template masonry.
   - A template opens the composer: Image/Video mode, Product, Avatar, Reference, Website link, hook & setting, settings from capabilities, brand kit, Recreate.
   - Ship **Fuobe's own template set**: names, prompts and preview media written per format; the 9 hooks and 14 settings can be reused as prompt mechanics.
   - On the studio's provider, pass the real `preset_id` / `style_id`.
   - Cloud route:
     - images: `marketing-studio/image`;
     - UGC video: Seedance 2.5 reference-to-video, `fal-ai/creatify/aurora`, `veed/fabric-1.0` or `bytedance/omnihuman/v2`;
     - text-heavy creatives: `ideogram/v4.5` or `recraft-ai/recraft-v4`.
   - Open route:
     - product shots: `qwen-image-edit-2511-multi` (product + avatar), `bg-remove-birefnet`, `relight-qwen-edit-2509`;
     - posters, ads and marketplace: `qwen-image-2512-t2i` for text, plus Qwen-Edit with the template image as a layout reference;
     - motion: `wan22-i2v-14b-lightx2v` or `ltx25-i2v`;
     - UGC: an Ollama script → `tts-chatterbox-multilingual` → avatar-with-product still → `infinitetalk-native` / `wan22-s2v-14b` → `video-concat-*`.
4. **Faceless Studio + Explainer (L).** One chained pipeline:
   1. LLM script;
   2. scenes in 10 s blocks;
   3. a still per block (style preset prompt + LoRA);
   4. a clip per block for *Fully animated*, or a CPU Ken Burns step for *Frame by Frame*;
   5. narration per block (ElevenLabs, or Chatterbox / IndexTTS-2);
   6. a music bed (ElevenLabs Music or ACE-Step);
   7. word-timed subtitles (faster-whisper on CPU, new);
   8. join.
   - Channels store the style, voice, aspect and subtitles.
   - The timeline editor regenerates single blocks.
   - Cloud video per block: `google/gemini-omni-flash/image-to-video`, which is what the studio's skill uses.
5. **Ads Studio (M)** on top of steps 1 and 3.
   - Per-product stepper (1–20); one chained job per ad, with the LLM picking an angle per selling point.
   - One base render, then 1:1, 4:5 and 9:16 by outpainting (`flux1-fill-outpaint`).
   - Headline, CTA and logo composited in code with the brand fonts, so the text is always exact.
   - A creative grid with Split by products.
   - A brand chat that reuses Assist with an `@product` mention.
   - Cloud alternative: `{studio}/ads-studio/v1.0`.
6. **Ad Multiplier + Click to Ad (M + S).**
   - Ad Multiplier: cloud `bytedance/seedance-2.5/video-edit`, `fal-ai/kling-video/o3/pro/video-to-video/edit` or `google/gemini-omni-flash/v1.1/edit`. Open `wan-animate2` (replace) or `wan21-vace-14b-ref2v` with the reference as control.
   - Hook/CTA only: a new 2–4 s clip from the first or last frame, joined with `fal-ai/ffmpeg-api/merge-videos` or `video-concat-*`, keeping the original audio.
   - Click to Ad becomes the Product Link tool (URL → product kit → style → 9:16 video) and retires the two parity apps.
7. **Supercomputer skills, projects, memory (M).**
   - SKILL.md files loaded into the Assist system prompt on demand (`/skill` or automatic); ship built-ins mirroring §11 and import `.zip` / `.skill`.
   - Projects: Assist threads grouped with instructions, ≤20 sources and project skills.
   - Memory: typed notes the agent can add through a tool, with an Add/Import/Delete page.
8. **Virality Predictor (M).**
   - A Python worker (or custom ComfyUI node) running `facebook/tribev2`: ≤15 s clip → per-second curve, peak second, a hook score over 0–3 s, the 5 region masks from the table in §9, and a verdict. Show a three.js brain.
   - The license is **CC BY-NC**, so the app must say it is for non-commercial use. It needs the gated Llama-3.2-3B.
9. **Katana (L).**
   - Detect cuts → for each shot, swap the subject on a keyframe (`qwen-image-edit-2511-multi`) → regenerate the shot with the reference as motion control (`wan-animate2` / `wan22-fun-control-14b`; cloud: Kling O3 video edit or Genjutsu motion transfer) → join at the original cut times over the original audio.
   - Expose it as an Assist/MCP tool too.
10. **Canvas (XL).**
    - An `@xyflow/react` board with the studio's node set; typed edges (text, image, video, audio); Run node and Run all map to `depends_on` chained jobs, which Fuobe already resolves.
    - Compare = several generator nodes on one prompt; graph JSON autosaved in SQLite; the 5 template graphs.
    - On the open engine, offer "Open in ComfyUI".

---

## 14. Conflicts between sources

| Topic | Source A | Source B | Used here |
|---|---|---|---|
| Template count | Blog: "1,500+" | Live CMS: 1,051 visible + 23 hidden | Live CMS |
| Clip length (Marketing Studio) | Help/blog: max 15 s per generation | Job builder: UGC 15–30 s, tools 4–30 s | Both noted; the UI follows capabilities |
| Avatars | Landing: "40+ avatars" | FAQ "100+"; blog "20 avatar templates" (With Model) | All three listed |
| Faceless styles | Changelog Aug 20: 8 presets | CMS + landing: 12 | 12 |
| Faceless length | Studio: 1–5 min | Supercomputer *Faceless channel*: up to 15 min | Both (different surfaces) |
| Katana presets | Launch (Oct 8): Aura Farming / Motion / Clipping | API (Oct 12+): Personalized edits / Style transfer / Motion transfer | API |
| Katana photos | Blog: up to 5 | Preset input schema: 1–10 images | Both |
| Click to Ad length | Legacy FAQ: up to 12 s, 9:16 | Product Link tool: 4–30 s, any aspect | Current tool |
| Template Marketing Studio via agents | Help: "not available through Supercomputer, MCP … yet" | `marketing-studio-cards` skill (321 layouts) | Skill = layouts only |

---

## Sources

- [cms-ms-catalog]({studio-cms}/marketing-studio-v2/catalog?lang=en&show_hidden=true): Marketing Studio catalog (public)
- [cms-ms-presets]({studio-cms}/marketing-studio-v2/categories/all/presets?lang=en&size=100&show_hidden=true): template feed (1,051 + 23)
- [cms-ms-motion]({studio-cms}/marketing-studio-v2/motion-presets?size=100&lang=en): 189 motion presets
- [ms-hooks]({studio-service}/marketing-studio/setup/hooks?size=100) · [ms-settings]({studio-service}/marketing-studio/setup/settings?size=100): UGC hooks and settings
- [jobset-costs]({studio-service}/job-sets/costs): credit formulas
- [ssr-ms]({studio-site}/marketing-studio) · [ssr-preset]({studio-site}/marketing-studio/preset/chilled-can-5c8a57f4-8339-5570-bb75-c68c722890a8): SSR state
- JS chunks (all under {studio-assets}/tanstack/assets/): `868a8dba-HrPpX2Z25lsGHHPE.js` (MS job builder), `-_sAjwlOAfgDNjIk7.js` (composer + brand kit), `-jnemIIPjFSHsJOOY.js` (pickers), `-WG1l7l12hCNTnbVQ.js` (brand kit API), `-ZR77k_MDIiqa3935.js` (avatars), `-0DHgVhpScXBwFI58.js` (products), `-fM5DdOBsiAlzhaUz.js` (Ad Reference), `-SxM5P82T9QHkMm5M.js` (card labels), `-7h1Df-OAEetZ_z0r.js` (image brief), `-pbQ9WmNgiQZBhvRT.js` (legacy Click to Ad), `-D9EH9H3Dl0E1Grdw.js` (Product Link), `-S3vdxlu9GiLgM5d3.js` / `-PcgZXp5ba7u_SgQi.js` / `-dsa6a_c1vKBX3GTN.js` / `-muraYnPthgOgiVRM.js` / `-IdJcfzprNc-Hzlk6.js` (Ads Studio), `-beLzbU6k3MvPbAcQ.js` / `-gK7Cc8qH_p8J_Smy.js` / `-ThxlCyZ2-Aa6KUV_.js` (Ad Multiplier), `-1wCNe24UZu77Z-mQ.js` (Faceless), `-o-qoGFciKLzFangv.js` (Explainer), `-XnFFagQC9hawzxYn.js` / `-aPCdbQG2cOi_5z1l.js` / `-N82Z9TAX1HZ62EL_.js` / `-skyMRlqA-8DGa0mK.js` (Canvas), `-idD1W7tdBOxBghQd.js` (Katana), `-QiG6GqtY7TxT2d92.js` (Virality), `-DdAahq08eWjyRY60.js` / `-pSSLZEsJkWUi-jqB.js` / `-jYgMWIBtaRXy3o0B.js` / `-kcZvfX_gVt3p1JRv.js` / `-7SGN54ci2SJXtGtQ.js` / `-5LdaRF4WMWWP609Q.js` / `-3A3TVgs4eEAoMI8x.js` (Assets), `-xXTm4FdSirfTxaEH.js` / `-GIA1maB7Xfur-ziW.js` (Supercomputer)
- i18n route catalogs: [Ads Studio]({studio-site}/_i18n/routes/en/delta.dd2a6b343b.json) (+ 031379e71d, ce8bca0c31, cdaa83a29a, 1e835229ee), [Ad Multiplier]({studio-site}/_i18n/routes/en/delta.d8e3335000.json), [Marketing Studio]({studio-site}/_i18n/routes/en/delta.4f354ef2d2.json) (+ bc38d67bd9), [Faceless new]({studio-site}/_i18n/routes/en/delta.777abdc67e.json) (+ 8d342fd469, 9f73f3a192, d7e0ccc2e3), [Explainer]({studio-site}/_i18n/routes/en/delta.679beafcf4.json), [Canvas]({studio-site}/_i18n/routes/en/delta.35573f8047.json) (+ deac944ca9, 11b4ef0918), [Katana]({studio-site}/_i18n/routes/en/delta.c75c4d6203.json) (+ 2bd60c6c7b, 0e21d9f5aa), [Asset]({studio-site}/_i18n/routes/en/delta.d3149d6b9e.json), [Supercomputer memory]({studio-site}/_i18n/routes/en/delta.6de6ab9195.json), [skills]({studio-site}/_i18n/routes/en/delta.dd78dbe5ba.json), [projects]({studio-site}/_i18n/routes/en/delta.48ed4ca8d8.json), [link-to-video-ad]({studio-site}/_i18n/routes/en/delta.5445bcbb74.json)
- [cms-faceless]({studio-cms}/youtube-faceless-presets?size=100&lang=en) · [ssr-faceless]({studio-site}/faceless-studio) · [cms-explainer]({studio-cms}/video-explainer-presets?lang=en&size=100&show_hidden=true) · [cms-link-presets]({studio-cms}/link-to-ad-presets?lang=en&size=100&show_hidden=true)
- [canvas-templates]({studio-service}/api/templates?limit=100&offset=0) · [katana-api]({studio-api}/fnf-cms-api/katana-presets?lang=en&limit=100) · [katana-categories]({studio-api}/fnf-cms-api/katana-categories?lang=en&limit=50)
- [hook-demo]({studio-site}/api/hook-predictor/demo-analysis) · [TRIBE v2](https://huggingface.co/facebook/tribev2)
- [skills-builtin]({studio-api}/fnf-skills-marketplace/api/v1/skills/builtin) · [skills-community]({studio-api}/fnf-skills-marketplace/api/v1/skills/community?limit=100)
- Help: [Marketing Studio]({studio-site}/creator-hub/help-center/tools/how-do-i-use-marketing-studio-to-create-video-ads), [Supercomputer]({studio-site}/creator-hub/help-center/tools/how-do-i-use-supercomputer), [Canvas]({studio-site}/creator-hub/help-center/tools/how-do-i-use-canvas), [Community projects]({studio-site}/creator-hub/help-center/community/how-do-projects-work)
- Blog: [New Marketing Studio]({studio-site}/blog/new-marketing-studio-studio), [Ads Studio]({studio-site}/blog/{studio}-ads-studio), [Katana]({studio-site}/blog/{studio}-katana), [UGC videos]({studio-site}/blog/how-to-make-ai-ugc-videos)
- Landings: [marketing-studio-intro]({studio-site}/marketing-studio-intro), [ads-studio-intro]({studio-site}/ads-studio-intro), [faceless-studio-intro]({studio-site}/faceless-studio-intro), [explainer-intro]({studio-site}/explainer-intro), [virality-predictor]({studio-site}/apps/virality-predictor), [ad-multiplier]({studio-site}/ad-multiplier)
- Skill pages: [/skills/faceless]({studio-site}/skills/faceless), [/skills/ugc]({studio-site}/skills/ugc), [/skills/ad-multiplier]({studio-site}/skills/ad-multiplier), [/skills/editorial-motion-graphics]({studio-site}/skills/editorial-motion-graphics), [/mcp/katana]({studio-site}/mcp/katana), [/mcp/faceless-paper-diorama]({studio-site}/mcp/faceless-paper-diorama), [/mcp/faceless-hand-drawn]({studio-site}/mcp/faceless-hand-drawn), [/mcp/faceless-pastel-flat-2d]({studio-site}/mcp/faceless-pastel-flat-2d), [/mcp/faceless-mannequin]({studio-site}/mcp/faceless-mannequin), [/mcp/faceless-fairy-tale-myth]({studio-site}/mcp/faceless-fairy-tale-myth), [/mcp/stickman-explainer]({studio-site}/mcp/stickman-explainer)
- [Changelog]({studio-site}/creator-hub/changelog)
- Third party: [ecom-tools.de review](https://ecom-tools.de/en/{studio}-review/), [developersdigest walkthrough](https://www.developersdigest.tech/tutorials/kp1nnNqhM7g). Little independent coverage exists; most claims come from the studio
