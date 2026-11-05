# The studio's studios: Cinema Studio 4.0, Shorts Studio, Mixed Media, Instadump

_In this file, "the studio" means the closed AI image and video studio that this research measures Fuobe against._

_As of 2026-10-17. Machine-readable twin: [`parity-studios.json`](parity-studios.json). This deepens §6.3 and §2.2 of [`parity-inventory.md`](parity-inventory.md)._

**How this was researched.** Logged-in screens were not observed. The findings come from:

1. The studio's production JS (build `3c4a1afe`, 8,020 chunks crawled from `/generate`). The job schemas, validators, defaults and enums are read straight from code.
2. The i18n catalogs. Message ids were mapped to the chunks that use them, which gives the UI copy for each screen.
3. Five preset and cost endpoints on `{studio-service}` that answer without a login: palettes, lighting, Shorts presets, Instadump packs, and credit costs per job type.
4. The public API docs.
5. The official blog, help center and changelog.

Statements reasoned from code or copy rather than seen in the app are marked *(inferred)*. Every source URL is listed at the end and in the JSON `sources` block.

**The most useful findings for the build:**
- The Cinema Studio 4.0 palette list is public: 50 palettes, each with 12 hex colours and a preview. So is the lighting list (7 presets with preview videos). The full lists are in this file.
- Credit costs are public. Cinema Studio 4.0 costs **3 / 7 / 16 credits per second** at 480p / 720p / 1080p, the same rates as Seedance 2.5. Mixed Media costs **2 credits per output frame**. Shorts Studio shows an estimate of **3 credits per second of input**.
- Cinema Studio 4.0 has **no shot list or timeline editor**. Multi-shot cutting happens *inside* one generation, driven by Tempo. Longer scenes are built with **Extend forward/backward**. Scenes are organized as **project subfolders**. The only timeline UI is the reference-video trimmer.
- The **Emotion Wheel** has 8 families with 3 intensities each, and every step carries a fixed prompt fragment. The **# camera moves** are prompt tokens `<<<movement:{id}>>>`. The **Soul Cast** builder has 17 fields, and all of their option lists are below.
- **Mixed Media** works at 4–24 fps and charges per frame. It is per-frame stylization, not a video model *(inferred)*. That maps cleanly onto an open-source ComfyUI route.

---

## 1. Cinema Studio 4.0

### 1.1 Where it lives and what runs it

| | |
|---|---|
| Route | `/generate` (+ `/generate/{mode}/{modelVersion}`, `/generate/all`, `/generate/elements`, `/generate/favorites`, `/generate/community`, `…/folders/{folderId}`, `…/trash`, `?projectId=…`, `?projectId=…&brief=1`, `?view=projects`). Landing `/cinematic-video-generator` |
| Default version | 4.0. A selector at the top switches 2.0 → 2.5 → 3.0 → 3.5 → 4.0 (old versions kept on user request) |
| Engine | Seedance 2.5 (help center). Other video models run inside the studio through a second "gen-panel" form ("Multi-Model Support … pick the engine per shot") |
| Internal ids | video `cinematic-v4` → job `cinematic_studio_video_4_0` (route `v2/cinematic_studio_video_4_0`). Image: `cinematic-v1` (camera image + grid), `soul-cinematic` (Soul Cinema), `cinematic-studio-soul-cast`, `cinematic-studio-soul-location`, `cinematic-3-0-edit`. Image modes: generate / `character-creation` / `location-creation` / `edit` |
| Public API equivalent | `POST /{studio}/cinema-studio/4.0`. It uses slugs instead of CMS ids and caps resolution at 720p (already in Fuobe as `cinema-studio-4`) |

### 1.2 Workspace (projects, folders, feed)

**Layout regions** *(inferred from component strings and class names)*:

| Region | Content |
|---|---|
| Left sidebar | Sections **Home · My Generations · My Elements · My Favorites · Community Feed**, then the project/folder tree (search "Find folder..", "Find project..", sort, collapse/expand, colour dots, pins, "Show hidden folders", Private folders / Shared folders) |
| Centre | Feed of the current project or folder: generations and uploads |
| Bottom composer | Image ⇄ Video toggle, prompt bar, reference tray, Director's Panel chips, generation settings, **Generate** button showing the credit cost |
| Right / split view | "Full View / Split View" (resizable) with **Chat** (AI Director), **Canvas**, or **Project brief** next to the feed. "Hide gen-panel", "Hide folder sidebar", Community feed overlay |

**Projects.** Created with "New project". Empty state: *"Projects keep your generations, elements, and chats together – create one to start"*.

- Settings:
  - Project name.
  - Slug: *"Used in the project's URL. Changing it breaks any links you've already shared."*
  - Description, max 140 characters.
  - Cover image, 16:9 works best.
  - Workspace: "Move to other workspace".
  - Created by / Created date.
  - Danger zone: Leave project, Transfer ownership, Delete.
- Per-project features: Elements · Canvas · Chat (AI Director) · Project brief.
- Actions: Pin, Open in new tab, Copy link, Hide/Unhide (with an Undo toast), and "Edit project limit" (a credit cap).
- Roles:
  - Owner.
  - Admin: *"Organizes the library: assets, elements, and members"*.
  - Collaborator: *"Generates and edits their own work"*.
  - Viewer: *"Can view, download, and comment"*.
- Permissions: a per-role matrix with per-member overrides (*"An override always wins over the role default"*).
- Access: Private ("Just you"), Shared with team, Anyone with the link.
- Invites: by email (up to 10 at a time) or by invite link. Access requests are approved or declined.
- Publishing to Community has four steps: **Details** (title, description, `{studio-site}/@user/projects/name`, co-authors, tags) → **Assets** (Feature / Series / Carousel) → **Cover** → **Access** (With prompts / Prompts hidden). A content check runs before publishing ("Project is in review").

**Folders = scenes.**
- Folders nest: *"Scenes, versions, deliverables. Keep a two-hundred-shot production navigable."*
- Each folder can have a colour swatch, a credit limit ("Folder credit usage"; *"Folders with a credit limit can't be moved"*), a pin, and a manual order (drag).
- Other folder actions: Duplicate, Move to / Copy to (incl. "Create new folder and transfer files"), and sharing (roles, request access, ban).
- Trash: *"Generations will be moved to Trash for 30 days. Uploads will be permanently deleted."* A deleted folder's contents move to the parent folder.

**Feed controls.**

| Control | Options |
|---|---|
| Layout | Square · Masonry · List. Plus Split by date, a Card size slider, Fill/Fit previews, Hide grid covers |
| Type filter | All types · Image · Video · Audio · PDF · TXT · MD · HTML · DOCX · PPTX |
| Date filter | All period · Today · Last 7 days · Last 30 days · Custom range |
| Status | Generated · Uploaded · Liked · Downloaded · Not viewed. Plus "Hide failed" and "Include generations from nested folders" |
| Selection | "{count} selected", "Unselect All (Esc)", Like/Unlike selected, Delete selected, Move to / Copy to, "Download all assets" (zip) |
| Upload | "Drop files here to add to project" |
| Empty states | *"Start by describing a scene and pressing “Generate”"*, *"Describe a scene below and hit Generate."*, *"Like your generations and they will appear here"* |

**Collaboration.** Live multi-user generation (a realtime SSE stream), shared Elements (*"Everyone in the workspace can use this element. Only you can edit it."*), comments, and live co-editing of the brief.

### 1.3 Prompt bar

- Placeholder: **"Describe your scene - use @ to add characters & locations"**.
- `@` opens Elements (Character / Location / Prop / Voice). Character chips are tinted with their Emotion Wheel colour.
- `#` opens the camera-move list. Each pick is stored in the prompt as `<<<movement:{cmsId}>>>`. *"Several per shot; order matters."* The same list opens from the Movement tab: "Direct a camera move", with search, sort Default / Name (A–Z), square video thumbnails, and "Use" on hover.
- Attached media are referred to as "Image 1 / Video 1 / Audio 1" (API tokens `<<<image_1>>>`).
- Enhance Prompt is on by default. Prompt Language is `en` or `zh`. The prompt can be up to 60,000 characters.

### 1.4 Director's Panel

Four chips open four panels: **Film setup · Camera · Color palette · Lighting**. In 4.0 every control defaults to **Auto**, which means the field is omitted from the request. The app sends CMS row ids (`genre_id`, `era_id`, `pacing_id`, `light_id`, `camera_model_id`…) from `GET /cinema-studio-4-0/creative-controls?type=…`, which needs a login. The public API takes the slugs below.

**Film setup.** Each control is a carousel with Previous/Next arrows and a picker. The pickers are titled "Select genre — *Story conventions the model should follow*", "Select era — *The period the film belongs to*" and "Select tempo — *Pacing of the montage*".

| Genre | slug | Effect (official copy) |
|---|---|---|
| General | — | No genre-specific logic; the prompt drives the look |
| Action | `action` | Camera tied to the moving subject, tighter framing around motion |
| Epic | `epic` | Wide compositions, environment as part of the subject |
| Drama | `drama` | Camera closer and longer, held moments, light on faces |
| Comedy | `comedy` | Open framing, comic timing at shot level |
| Horror | `horror` | Off-angle framing, withheld light |
| Noir | `noir` | Hard shadow, high contrast |

| Era | slug | Effect |
|---|---|---|
| Auto | — | Model chooses |
| 60s | `1960s` | 1960s film-stock grain, colour and lens character |
| 80s | `1980s` | 1980s saturation and lens character |
| 90s | `1990s` | Flatter colour, video-adjacent texture |
| 2000s | `2000s` | Early-2000s digital colour |
| 2020s | `2020s` | Contemporary unmodified digital |

| Tempo | slug | Effect |
|---|---|---|
| Auto | — | Model chooses from scene and genre |
| Chaotic | `chaotic` | Faster-than-expected cuts from unresolved angles |
| Dynamic | `dynamic` | Forward momentum (commercials, music videos) |
| Calm | `calm` | Long takes, cut once a moment has played out |
| Single Shot | `single-shot` | One continuous take, no cuts |

**Camera.** Tabs: CAMERA · LENS · APERTURE · Movement.

| Camera | slug | | Lens | slug | | Aperture | slug |
|---|---|---|---|---|---|---|---|
| Auto | — | | Auto | — | | Auto | — |
| Modern | `modern` | | Clean Sharp | `clean-sharp` | | f/1.4 Wide Open | `f14-wide-open` |
| 35mm Film | `35mm-film` | | Anamorphic | `anamorphic` | | f/4 Moderate | `f4-moderate` |
| 8mm Film | `8mm-film` | | Vintage Anamorphic | `vintage-anamorphic` | | f/11 Deep Focus | `f11-deep-focus` |
| DV Camcorder | `dv-camcorder` | | Warm Vintage | `warm-vintage` | | | |
| | | | Halation Vintage | `halation-vintage` | | | |

Camera effects: Modern gives a clean high-resolution digital look, 35mm adds grain and analog warmth, 8mm gives a soft home-movie texture, and DV gives flat colour with tape compression. Lens effects: Clean Sharp has maximum resolution and minimum aberration, Anamorphic gives oval bokeh and horizontal flares, Vintage Anamorphic has lower contrast and more chromatic aberration, Warm Vintage adds diffusion and blooming highlights, and Halation Vintage adds a red halo around highlights.

**Camera moves: all 33 values the API accepts** (shown in the app as "30+"). The in-app list `GET /camera-movements` (21 per page, display name + video) needs a login. Display names marked "from slug" are title-cased slugs *(inferred)*.

| # | # tag (display name) | API slug | What it does *(inferred)* | Name source |
|---|---|---|---|---|
| 1 | #Snorricam | `snorricam` | Body-mounted rig: the subject stays locked in frame while the world moves around them | from slug |
| 2 | #Robot Arm | `robot-arm` | Fast, precise motion-control arm move (product reveals, whip-arounds) | confirmed |
| 3 | #Tilt Up | `tilt-up` | Camera pivots upward on a fixed point | from slug |
| 4 | #Rack Focus | `rack-focus` | Focus pulls from one subject/plane to another | from slug |
| 5 | #Tilt Down | `tilt-down` | Camera pivots downward on a fixed point | from slug |
| 6 | #POV | `pov` | First-person point of view of a character | confirmed |
| 7 | #Pan Left | `pan-left` | Horizontal pivot to the left | confirmed |
| 8 | #Crane Up | `crane-up` | Camera rises on a crane/jib | from slug |
| 9 | #Pan Right | `pan-right` | Horizontal pivot to the right | from slug |
| 10 | #Crane Down | `crane-down` | Camera lowers on a crane/jib | from slug |
| 11 | #Side Tracking | `side-tracking` | Camera travels sideways alongside a moving subject | from slug |
| 12 | #Pedestal Up | `pedestal-up` | Whole camera rises vertically without tilting | from slug |
| 13 | #Pedestal Down | `pedestal-down` | Whole camera lowers vertically without tilting | confirmed |
| 14 | #Handheld | `handheld` | Organic handheld shake and drift | confirmed |
| 15 | #Tracking | `tracking` | Camera follows the subject through space | confirmed |
| 16 | #Drone Orbit | `drone-orbit` | Aerial orbit around the subject | from slug |
| 17 | #Dolly Zoom | `dolly-zoom` | Vertigo effect: dolly and zoom in opposite directions | from slug |
| 18 | #Aerial Pullback | `aerial-pullback` | Aerial shot pulling back to reveal the scene | from slug |
| 19 | #Static | `static-shot` | Locked-off camera, no movement | confirmed |
| 20 | #Bullet Time | `bullet-time` | Frozen/slowed action while the camera sweeps around | confirmed |
| 21 | #Whip Pan | `whip-pan` | Very fast pan with motion blur, often a transition | from slug |
| 22 | #Slow Zoom In | `slow-zoom-in` | Slow optical push in | from slug |
| 23 | #Arc Left | `arc-left` | Camera arcs around the subject to the left | from slug |
| 24 | #Slow Zoom Out | `slow-zoom-out` | Slow optical pull out | from slug |
| 25 | #Arc Right | `arc-right` | Camera arcs around the subject to the right | from slug |
| 26 | #Truck Right | `truck-right` | Camera moves laterally right | from slug |
| 27 | #Dolly In | `dolly-in` | Camera physically moves toward the subject | confirmed |
| 28 | #Truck Left | `truck-left` | Camera moves laterally left | from slug |
| 29 | #Dolly Out | `dolly-out` | Camera physically moves away from the subject | confirmed |
| 30 | #Slider Right | `slider-right` | Short, smooth slider move to the right | from slug |
| 31 | #Crush Zoom | `crush-zoom` | Snap/crash zoom into the subject (API spells it 'crush') | from slug |
| 32 | #Slider Left | `slider-left` | Short, smooth slider move to the left | from slug |
| 33 | #Helicopter Shot | `helicopter-shot` | Wide aerial helicopter pass | confirmed |

Older presets, for reference. 3.5 had 9 "Camera MoveSet Styles": Classic Static, Silent Machine, One Take, Epic Scale, Intimate Observer, Impossible Camera, Documentary Snap, Raw Chaos, Dreamy Flow. 2.x/3.0 had speed ramps: Linear, Auto, Flash In, Flash Out, Slow-mo, Bullet Time, Impact, Ramp Up, Hero Moment.

**Color palette** ("Set up color palette — *Palette the color grade should follow*").
- The list shows 16:9 cards (preview image plus a gradient strip of the palette), pin/unpin, sort Name (A–Z), search ("No palettes found"). Auto means no palette.
- The editor ("New palette / Edit palette") has two tabs:
  - **From image**: upload an image, drag sample points to pick colours, choose a Main colour. *"Extracting colors from your images. You can use this palette once it's ready."*
  - **Color wheel**: harmonies Custom, Analogous (±28° steps), Complementary (0/180°), Triad (0/120/240°), Square (0/90/180/270°), Split complementary (0/150/210°), Monochromatic. Plus Random ("Generate random palettes"), add/remove/reorder colours, hex input and an eyedropper.
- Saving: "Enter palette name → Save palette". The server auto-suggests names (`/color-presets/name`). Logged-out users keep palettes locally.
- Request field: `color_palette {type: preset|user, id}`.

**The 50 Cinema Studio 4.0 palettes**, from `GET {studio-service}/color-presets/with-presets` (public). Each has 12 colours plus a background colour, which equals the 12th colour. The preview image URLs are in the JSON.

| # | Palette | API slug | 12 hex colours (dark → light, last = accent) | Background |
|---|---|---|---|---|
| 1 | Static Noon | `static-noon` | #0c0c0c #28292a #4e4f51 #626263 #a25955 #7b7b7b #939548 #a7a7a6 #c1c2c2 #b6c6b7 #ededed #69483b | `#69483b` |
| 2 | Twilight Fable | `twilight-fable` | #040605 #1e4f59 #5d4623 #7b5d35 #36797f #948052 #b2a24a #56afae #88b2c9 #dac593 #f3f4ea #764019 | `#764019` |
| 3 | Back Row Kissing Seats | `back-row-kissing-seats` | #070405 #4e1311 #1a4388 #875046 #b26a38 #6079c3 #2da744 #b89892 #846e69 #9ccd8a #c4c7d2 #881913 | `#881913` |
| 4 | On the Other Side of the Porthole | `on-the-other-side-of-the-porthole` | #090709 #720b11 #474548 #3d537d #933542 #776343 #71726e #969c9e #9dbbd8 #c6bfb5 #a3cba9 #b82d1c | `#b82d1c` |
| 5 | The Emerald Ambush | `the-emerald-ambush` | #101210 #4b4d2d #3c4c7b #64574b #3d703b #6986a7 #959b87 #ca9e80 #bebec1 #98d0d5 #f0f7f0 #1d481b | `#1d481b` |
| 6 | Highway Standoff | `highway-standoff` | #0d110c #36463f #69351a #635a39 #215ca7 #607765 #867660 #9b9c85 #beb389 #adc7ae #eee6c2 #0f1c79 | `#0f1c79` |
| 7 | The Faded Fresco | `the-faded-fresco` | #14120e #4b4536 #6d443e #5b544d #646864 #7a6b62 #8c877d #a2957f #b4b8a1 #cbd196 #c9e1c7 #b8b592 | `#b8b592` |
| 8 | Oil & Ochre | `oil-ochre` | #0d0d0a #342619 #524628 #654e38 #6d6932 #636962 #93896f #aea483 #d0a681 #e0d0a7 #e1dcc8 #8d7941 | `#8d7941` |
| 9 | The Mountain Convent | `the-mountain-convent` | #0a0a07 #342f1f #464d47 #695037 #405e2d #646257 #7e8079 #7ea1c7 #b29e73 #b1b7b9 #c6d7de #942417 | `#942417` |
| 10 | Ghost in the Code | `ghost-in-the-code` | #040605 #1b331d #664836 #3c6052 #696747 #818380 #928363 #6a9387 #b8ad9a #bfe1c8 #e6ebe9 #638a63 | `#638a63` |
| 11 | Pink Velvet | `pink-velvet` | #0d0c0f #682f1d #205279 #7c5144 #3078a3 #996d73 #7f818d #d29d9f #dda780 #d7c5c8 #efdcd5 #9f140b | `#9f140b` |
| 12 | Two Days to the Horizon | `two-days-to-the-horizon` | #060805 #254850 #55482c #774c18 #696c53 #558085 #828767 #c0a875 #a7baa6 #ccc9a4 #e2e5cb #988357 | `#988357` |
| 13 | Industrial Fog | `industrial-fog` | #121012 #300d0b #4d4840 #6e4f42 #5d5857 #6e6e70 #7f8180 #989a99 #adb2b1 #c4b09a #ccced0 #561b11 | `#561b11` |
| 14 | Stairs Go Up | `stairs-go-up` | #050b0e #3d301f #375133 #50574d #705b44 #557c76 #9f8865 #87a290 #4cb9a3 #bebe9b #b2d0b5 #814f21 | `#814f21` |
| 15 | Field Post | `field-post` | #040505 #514e28 #295860 #3e5b46 #716538 #5f8681 #65a1d2 #a9a668 #d9b388 #e3e39f #f8faf4 #0a5a0e | `#0a5a0e` |
| 16 | Home Is the Next Gas Station | `home-is-the-next-gas-station` | #0d0907 #14182f #434145 #57514e #766360 #596d8a #8c868a #7d92bd #a57852 #878ba1 #b2aeb2 #20345c | `#20345c` |
| 17 | Glossy Flesh | `glossy-flesh` | #0c0b11 #223750 #5b4747 #785753 #797074 #b37092 #92919d #d28c60 #89c2df #b1bcce #d2c5ce #8b2926 | `#8b2926` |
| 18 | The Crimson Ballet | `the-crimson-ballet` | #0b0509 #291c7d #621418 #805442 #475be0 #d3184e #807d8b #b59c93 #c5bfd9 #70ddf8 #f2e322 #d20c25 | `#d20c25` |
| 19 | Neon Rain at Midnight | `neon-rain-at-midnight` | #0c0c0e #334d4e #7b3612 #655254 #676650 #497197 #708986 #b3978e #95b0c2 #bebc9d #f3e04e #446bc7 | `#446bc7` |
| 20 | The Morning After Rain | `the-morning-after-rain` | #0b0b0b #3c3228 #404845 #5e6459 #3e6f81 #7c7670 #458f83 #8ba1af #a8bccc #6ec9ce #c1d4e0 #255e54 | `#255e54` |
| 21 | The Iron Borough | `the-iron-borough` | #0a0604 #2b0f07 #613926 #893d10 #555461 #756664 #87858b #ad887c #d3aa6b #acb6c2 #f5f8f9 #b02610 | `#b02610` |
| 22 | The Ground | `the-ground` | #0a0708 #4b3e35 #3f4b72 #675b52 #757f5f #907a66 #ad9e92 #82a9de #d2b48b #c7bfbb #e2e7f5 #688ad2 | `#688ad2` |
| 23 | The Investigation | `the-investigation` | #0b0c0f #1a303d #515346 #3a5b58 #845931 #6a7d78 #e06b84 #6c9ca0 #8cb8b1 #b3d1bc #d5e6c2 #2a7c8e | `#2a7c8e` |
| 24 | Turquoise Mirage | `turquoise-mirage` | #161614 #054503 #4c4a43 #66635a #9a6941 #6a8474 #4aa290 #9c9e72 #87bc90 #59cec2 #cad7a2 #0d8b06 | `#0d8b06` |
| 25 | A Dream in Color | `a-dream-in-color` | #0c0b0a #5a3723 #354d30 #6d4d37 #4d5e45 #5d5c67 #a78672 #8d8db1 #b7a9a1 #b0b4cc #eac94a #cb9336 | `#cb9336` |
| 26 | Breakfast on Schedule | `breakfast-on-schedule` | #111217 #732419 #494637 #6e5133 #416c87 #68734a #7b796b #91a5b0 #a6b1aa #aac2c8 #cadcd6 #533115 | `#533115` |
| 27 | Favela Gold | `favela-gold` | #0a0807 #563322 #464969 #57594d #765636 #586f93 #867b7e #aca389 #85b1f7 #acb4b5 #f3f7f3 #d3ac74 | `#d3ac74` |
| 28 | A Hotel for One | `a-hotel-for-one` | #07070c #1f1414 #362e25 #094b27 #494b4b #2c5354 #584e3c #686664 #423b30 #314041 #4f3a2f #101821 | `#101821` |
| 29 | After Dark | `after-dark` | #0a090c #651113 #1d2d6c #794f3d #575a67 #118d65 #5b8aa0 #a99a93 #ba9569 #919faf #cfcbc6 #1d1885 | `#1d1885` |
| 30 | Crimson Vigi | `crimson-vigi` | #0b080a #483125 #98261c #654f46 #4870ca #926b51 #e95531 #bf9982 #f0854a #fec17b #dbd6d4 #c72f1f | `#c72f1f` |
| 31 | The Neighbors Saw Everything | `the-neighbors-saw-everything` | #0f1116 #2e1c11 #644727 #76554a #3b6084 #646058 #948676 #9d9fa4 #778082 #6293b2 #b7bcc9 #5b3b29 | `#5b3b29` |
| 32 | The Grey Channel | `the-grey-channel` | #081214 #164942 #494d3e #6b533b #30706c #787b61 #5b8f82 #9aa491 #b1b898 #a4c8b0 #e7ddb3 #cecfa5 | `#cecfa5` |
| 33 | Mirage at Noon | `mirage-at-noon` | #0c0b0c #403733 #5d463b #7f503e #695d5a #707e9b #a47e70 #b2a3a1 #a5b9b3 #d5ced3 #f4ddaf #954924 | `#954924` |
| 34 | Bubblegum Boulevard | `bubblegum-boulevard` | #181415 #2f3973 #62382f #6b524e #957a70 #878894 #b48f60 #65b0cb #c3b0a9 #81d7f9 #e5e0df #aa637e | `#aa637e` |
| 35 | Yellow Room | `yellow-room` | #0e0606 #222e2a #513d1a #884f1e #6a6a67 #388516 #a3a59c #67b5ae #d0b32b #5ac99c #e3eccb #ebd41a | `#ebd41a` |
| 36 | The Earth Keeps Things, Reluctantly | `the-earth-keeps-things-reluctantly` | #110f11 #34221f #474547 #55565a #6a755f #807a7a #9b949c #9eaf9f #beb0b8 #aeb7d4 #eae1f5 #282a48 | `#282a48` |
| 37 | Tropic Fever Dream | `tropic-fever-dream` | #090c0c #6b111a #584d54 #305a6e #96414b #7c7c88 #65949b #ca8a5e #df877a #f3b32b #c8bda3 #8d4f28 | `#8d4f28` |
| 38 | Bioluminescent Night | `bioluminescent-night` | #0d0f12 #1f2574 #2f473f #8d421f #3d667c #54988a #83a6bd #c099a0 #b8a3ed #d7b06d #c0d5db #564abb | `#564abb` |
| 39 | Don't Turn It Off, I'm Watching | `dont-turn-it-off-im-watching` | #0c0b0c #132669 #16433e #245986 #973911 #31706c #82797f #a49051 #6097b2 #46b291 #aba8a3 #0c1640 | `#0c1640` |
| 40 | The Silk Curtain Falls | `the-silk-curtain-falls` | #1f0303 #2b313d #5f4f36 #6a512a #3a596c #ce5838 #a89062 #77b2ba #c6b395 #89ece9 #f7e9d4 #672a0e | `#672a0e` |
| 41 | The Butterfly | `the-butterfly` | #0d0c08 #52463b #415747 #6c604b #5c686a #708a87 #918461 #8694a6 #bcc5d2 #efe990 #eceef2 #771c1e | `#771c1e` |
| 42 | Playtime | `playtime` | #12160f #4e3921 #3e4b50 #4f5451 #626f6f #876b57 #868f86 #a8ac9d #afbdb3 #cbd0be #c0e1cf #725738 | `#725738` |
| 43 | Wallpaper Romance | `wallpaper-romance` | #121010 #741313 #4a4b58 #435e6d #69605e #8b5952 #787e7b #a6997f #9fa796 #bbb192 #dfd0a4 #883063 | `#883063` |
| 44 | Overtime | `overtime` | #080502 #1f2a08 #66450d #ac3510 #746931 #97611c #8f8e6c #cb983b #a7bc89 #dfc178 #edeedf #866b22 | `#866b22` |
| 45 | The Way Home Is Longer | `the-way-home-is-longer` | #0c0a0a #2b3352 #484042 #525776 #69544b #587ad4 #c4836c #91a6ef #b0c0f5 #dfbcb0 #e3e1f1 #6c93f4 | `#6c93f4` |
| 46 | Everyone Speaks in Whispers | `everyone-speaks-in-whispers` | #0f0c0b #65370d #4d4b47 #724c31 #5a6661 #916d4c #9a896a #7e9689 #acbb9e #c6be94 #f2f1c4 #865517 | `#865517` |
| 47 | Runaway Summer | `runaway-summer` | #0f0f0d #5d1610 #4e523a #595452 #277540 #7c745f #8a939a #b8a590 #adb1b0 #d6cc6a #c6dfe3 #be1205 | `#be1205` |
| 48 | Amber Wasteland | `amber-wasteland` | #0b0b0b #294446 #7b3a07 #a04003 #5b6866 #a8792d #798b82 #9baa95 #72833f #c0b981 #dad5bc #bf6909 | `#bf6909` |
| 49 | The Circus | `the-circus` | #090a0b #900304 #1d5768 #58554a #8e5917 #627163 #979d7e #7daca6 #7f907d #add3c0 #ccebd8 #b70204 | `#b70204` |
| 50 | Gasoline Sunset | `gasoline-sunset` | #0e0d0c #4e2a15 #0d4486 #65565d #894f29 #3478a9 #a09296 #d38846 #dab4a2 #ccb8bd #ecd6dd #b36521 | `#b36521` |

**Lighting** ("Set up lighting — *Pick a scheme or place your own lights*"). The 7 presets, from `GET /lighting-presets/with-presets` (public):

| Preset | API slug | Effect | Preview |
|---|---|---|---|
| Silhouette | `silhouette` | Backlights the subject into a dark outline against a bright background | mp4 |
| Practicals | `practicals` | Lights the scene only from visible in-frame sources (lamps, candles, signage) | mp4 |
| Window | `window` | Single directional daylight source through a window; architecture decides light and shadow | mp4 |
| Overhead fall | `overhead-fall` | Soft source from above and behind: light on crown and shoulders, eyes in shadow | mp4 |
| Contre jour | `contre-jour` | Shooting into the light, like Silhouette but with more spill and flare | mp4 |
| Soft cross | `soft-cross` | Two soft sources crossing at an angle; half the face in light, smooth transition | mp4 |
| Auto | — (omit field) | Lets the model choose the lighting from scene context | mp4 |

**Custom rig.**
- At most 2 lights ("Light 1", "Light 2").
- Each light has:
  - **Direction**: a sphere picker with quick buttons Top / Front / Right / Left / Bottom. The API accepts 26 directions: front, back, left, right, top, bottom and every 2- and 3-axis combination such as `front-top-left`.
  - **Colour**: hex value plus an eyedropper.
  - **Brightness**: 0–100.
  - **Diffuse**: 0–100.
- Actions: Quick select, Apply, Save as preset (named and pinnable).
- Validation messages: *"A custom rig supports at most 2 light sources"*, *"A lighting preset and a custom rig are mutually exclusive"*, *"color must be a #RRGGBB hex value"*.

**Emotion Wheel.** Pick a character (`@mention`), then a family and an intensity. "Neutral" clears it. The step's prompt fragment is added for that character *(exact placement inferred)*. Official usage: *"Tag a character with @character_name Joy"*.

| Family | Colours (10 / 50 / 100) | Intensity 10 | Intensity 50 | Intensity 100 |
|---|---|---|---|---|
| Anger | #C86058 #A83028 #801818 | Annoyance — “(with frustrated emotion)” | Anger — “(with mad and angry emotions)” | Rage — “(with extremely enraged emotions loudly)” |
| Joy | #D0C060 #C0A820 #B09018 | Serenity — “(relaxed emotion)” | Joy — “(happy and joyful emotion)” | Ecstasy — “(happy and smiling emotion)” |
| Trust | #80C070 #4C9840 #2E7828 | Acceptance — “(welcoming emotion)” | Trust — “(faithful and trust emotion)” | Admiration — “(with admiration)” |
| Fear | #58A880 #2E7C58 #186040 | Apprehension — “(nervously)” | Fear — “(with strong fear and shock)” | Terror — “(with extreme terror emotion and panic)” |
| Surprise | #4098B0 #1878A0 #085870 | Distraction — “(with confused emotion)” | Surprise — “(with surprised face)” | Amazement — “(with stunned and amazed emotion)” |
| Sadness | #5878B0 #284888 #182868 | Pensiveness — “(with thoughtful emotion)” | Sadness — “(with sad emotion)” | Grief — “(with grief emotion)” |
| Disgust | #8868A0 #5C3880 #401860 | Boredom — “(with bored emotion)” | Disgust — “(with disgusted emotion)” | Loathing — “(with hateful and loathing emotion)” |
| Hope | #F0B060 #E88C28 #D07010 | Interest — “(with intrigued and curious emotions)” | Hope — “(with hopeful and expectant emotions)” | Vigilance — “(with watchful and on-guard emotions)” |

### 1.5 Generation settings and references (video)

| Setting | Values / limits | Default |
|---|---|---|
| Mode | **References** (new clip) · **Extend** (Forward = "Sequel" / Backward = "Prequel") · **Edit Video** (regional edit: object, face) | References |
| Duration | 4–30 s (not shown for Edit) | 5 s |
| Aspect ratio | 21:9 · 16:9 · 4:3 · 1:1 · 3:4 · 9:16 (Edit/Extend follow the source) | 16:9 |
| Resolution | 480p · 720p · 1080p. Pixel sizes, e.g. at 1080p: 2016×864, 1920×1080, 1440×1080, 1080×1080, 1080×1440, 1080×1920 | 1080p |
| Bitrate | High ("Less compression · larger size") · Standard ("More compression · smaller size") | High |
| Audio | on / off (*"This generation will include generated audio."*) | on |
| Batch | 1–4 | 1 |
| References | images (incl. start/end frame and @elements) ≤ 30 · videos ≤ 10 · audio ≤ 10 · **total ≤ 50 incl. Elements**. Each video or audio clip 2–30 s. Total video ≤ 30 s, total audio ≤ 30 s | — |
| Extend | exactly one source video ≤ 30 s, plus `extension_mode` forward/backward | — |
| Edit | exactly one source video | — |

- The reference picker opens from "+": uploads, Elements, past generations, liked assets. Every item is face/IP-checked ("Check eligibility").
- If a video is longer than the remaining budget, a trim timeline opens: *"Select a {n}-second segment for use in generation"*, with Trim start/end, Playhead and zoom. Budget messages: *"{remaining} s left of {total} s · # videos attached ({used} s)"*, *"Duration reduced to {lowered}s to fit the reference videos"*.

**Validation messages** (verbatim): *"Cinema Studio 4.0 video edit requires exactly one video reference"*, *"Cinema Studio 4.0 video extension requires a video reference"*, *"'extension_mode' is required for video extension"*, *"You can add a maximum of 30 images"*, *"… 10 videos"*, *"… 10 audios"*, *"You can add a maximum of 50 input media items, including Elements"*, *"Each reference video must be at least 2 seconds and no more than 30 seconds"*, *"The total video duration limit is 30 seconds"*, *"Element "{0}" is still processing…"*, *"May contain protected content"*.

**Multi-shot, rendering and stitching.**
- **4.0** has no manual shot editor. Tempo makes the model cut inside one generation. The landing calls it *"the scene arrives already assembled: cuts, rhythm and flow built in. No timeline, no post."*
- To build a longer scene, extend a clip forward or backward, reuse the same Elements and Director settings, and keep shots in subfolders. Final assembly happens outside the studio, in Edit, Canvas or an export *(inferred: there are no editor/timeline strings in the CS bundles)*.
- **3.0**: 4–15 s, Single shot / Multi-shot Auto / Multi-shot Manual ("Smart", "Custom Multishot"), up to 9 references, 3 videos, 3 audios.
- **2.x**: up to 6 shots. Each shot is a prompt of at most 512 characters with a duration, speed ramp and preset, for 3–15 s in total.

### 1.6 Image mode

| Tool | Job | Inputs / limits | Credits |
|---|---|---|---|
| Cinematic image | `cinematic_studio_image` | **Camera body, lens and focal length required** (*"Camera settings are required"*), aperture optional. 1K/2K/4K (1K default). AR 16:9 (default), 21:9, 3:2, 4:3, 1:1, 3:4, 2:3, 9:16. Batch 1–4. Prompt ≤ 2,500. Image refs | 2 per image (1K/2K), 4 (4K) |
| **Grid generation** | `cinematic_studio_image_grid` | *"Skip generating one image at a time. Get a full grid from a single prompt — same cost, no extra wait, and every image shares the same context."* Size **2×2 (default) · 3×3 · 4×4**. Type **freeform (default) · zooms · shots · next_shots · prev_shots** | same as one image |
| **3D Scene / recomposition** | `cinematic_studio_image_3d`, `…_3d_recomposition` | "Create 3D scene" → *"This will render a 3D scene from your current image."* Move the image across three axes and change the perspective, pick the keyframe, then recomposition re-renders it (needs `source_job_id`, the image and an aspect ratio). Desktop only | recomposition 2 |
| Soul Cinema | `soul_cinematic` / `soul_cinema_studio` | style, 720p/1080p, AR, Soul ID + strength, camera/lens, Soul HEX palette, 1 input image | Soul rates |
| What's next | `next_shots` | *"Upload one image, get 8 story continuations. Select your favorites and upscale to 4K."* (Nano Banana 2) | 4 |
| Follow-ups on a still | — | Shots (9 angles), Upscale, Relight, Angles, Skin Enhancer, Inpaint, Animate (start/end frame), Save as Element | — |

### 1.7 Soul Cast (AI actor builder)

- Title: "Create Your Soul Cast / Build Your Cast". Subtitle: *"Build your film's cast from scratch - genre, budget, appearance, and every detail in between."*
- Job `cinematic_studio_soul_cast`. Output is 2048×1152 images, batch 1–10, and the client formula prices them at 0.125 credits per image.
- Request payload: `character_params{…}` + `preset_id` + an optional prompt ("Describe your character"). In character-creation mode the choices are also written into the prompt as `<<<cast_{field}_{value}>>>`.
- Actions: Randomize (genre, era, race, gender, age, archetype), Reset, "Select an image variant for your cast", Save as Element, and Upgrade Character (Soul 2.0 / Soul Cinema).

| Tab | Control | Options (exact) | Default |
|---|---|---|---|
| Genre | picture list — "Select the genre of your movie" | Action, Adventure, Comedy, Drama, Thriller, Horror, Detective, Romance, Sci-Fi, Fantasy, War, Western, Historical, Sitcom | random if unset |
| Budget | ruler slider — "What's your production budget?" ("Budget in millions", `$vM`) | 10–100 in steps of 10, then 150–500 in steps of 50 | 250 |
| Era | ruler slider — "What period is your film set in?" | 1900s, 1910s … 2020s (13 decades) | 2020 |
| Archetype | picture list — "Select the archetype of your character" | Innocent, Everyman, Hero, Caregiver, Explorer, Rebel, Lover, Creator, Jester, Sage, Magician, Ruler | — |
| Identity → Gender | list | Male, Female | — |
| Identity → Race | list (thumbnails per gender) | White, Black, Asian, Latino, Indigenous, Mixed | — |
| Identity → Age | ruler slider (`{v}yo`) | 20–70 in steps of 5 | — |
| Physical → Build | list | Slim, Average, Athletic, Muscular, Stocky, Plus-size | — |
| Physical → Height | slider | Very short, Short, Average, Tall, Very tall | — |
| Physical → Eye Color | list + manual (≤ 300 chars) | Brown, Blue, Green, Hazel, Gray, Amber | — |
| Physical → Hair Style | list | Short, Medium, Long, Very long, Ponytail, Bun, Braids, Dreadlocks, Afro, Fringe/Bangs, Undercut, Slick back, Messy, Shaved sides, Bald | — |
| Physical → Hair Texture | list (per gender) | Straight, Wavy, Curly, Coily | — |
| Physical → Hair Color | list + manual | Black, Brown, Blonde, Red, Gray, White, Auburn | — |
| Physical → Facial Hair | list (hidden for female) | Clean-shaven, Stubble, Beard, Short beard, Mustache, Long beard | — |
| Physical → Facial Hair Color | list + manual (only with beard/mustache) | Black, Brown, Blonde, Red, Gray, White, Light brown, Auburn | — |
| Details | list + manual — "Add details to your character" | Facial scar, Freckles, Tattoos, Eye patch | — |
| Outfit | list + manual — "Select or describe your character's outfit" | Casual, Formal, High Fashion, Military, Sporty, Workwear, Vintage, Punk | — |

### 1.8 Soul Location

- Entry points: "Create Location / New Location". Pitch: *"Keep every scene in the same world"*. Prompt: "Describe your location".
- Job `cinematic_studio_soul_location`: prompt, batch 1–10, 16:9 at 1696×960, palette, camera body, lens and seed. The client formula prices it at 0.125 credits per image.
- Flow: generate variants → pick one → Save as a Location element → `@mention` it in shots.
- The 2.x image generator refused to run without one: *"Location required — Add character and location for more consistent results"*.

### 1.9 AI Director ("{assistant-name}") and Project Brief

**AI Director.**
- The landing calls it the **Personal Assistant**: *"Ask {assistant-name} to pick the camera, light the scene, write the prompt, or break a script into shots."* Introduced in 3.5 as "Claude Chat AI Director", it later became Supercomputer and kept the same agent stack.
- It lives in the Chat tab of the split view, with a "Project chats" list.
- Input: *"Ask AI Director anything. Type / for skills, @ for elements"*. Attachments: "Add references", "Attach file", and "Get from prompt box".
- Empty-state chips: *"Write a script"*, *"Generate an 8-shot storyboard for a sci-fi chase scene"*, *"Create a 15-second cinematic perfume commercial"*. Footer: *"LLMs can make mistakes and calls cost credits"*. Usage is shown as Text / Image / Video / Audio credits.
- What it does:
  - Adjusts Genre, Style and Camera settings.
  - Breaks a script into shots with camera parameters pre-filled.
  - Reads and edits the project brief ("Reading project brief", "Edited project brief").
  - Reads memory.
- **It never generates on its own.** Prompts land in the prompt box for review. Any generation needs an approval card: *"Your agent wants to submit the draft below. Approval is for this request only."* → **Approve and generate**. *"If the draft or price changes, a new approval is required."*

**Project Brief.**
- Purpose: *"Set the rules of the production: tone, references, do's and don'ts. Every teammate - and the agent - works from the same page."*
- The brief is a live collaborative document with a title and a body ("This brief is empty."). States: Saving… / Saved, Connecting… / Offline, Read-only.
- Published projects show it in four sections: context, narrative, visuals and production notes.

### 1.10 Credit costs (public `GET /job-sets/costs`)

| | 480p | 720p | 1080p | 4K |
|---|---|---|---|---|
| Cinema Studio 4.0, credits per second (References / Extend / Edit) | 3 | 7 | 16 | 26 (not offered in the form) |
| Seedance 2.5 (same engine), for comparison | 3 | 7 | 16 (edit 20) | 26 |
| Cinema Studio 3.0 / 3.5 | 3.5 | 5 | 13 | 24 |

Examples: 5 s at 1080p = 80 credits, and 30 s at 1080p = 480 credits. Through the public API it is token-metered at about $0.2057/s (480p) or $0.4623/s (720p). Image prices are in §1.6.

### 1.11 Conflicts between sources

- The landing FAQ says *"up to one minute"* and *"native 4K"*. The app, help center and API all cap at **30 s / 1080p**.
- The blog lists "Film Colors, Black Gloss, Candy Pink, Lime Jam, Nostalgic Blue, Soft Palette" as palette examples. Those are Soul HEX / standalone Color Palette presets and are **not** in the Cinema Studio 4.0 list of 50.

---

## 2. Shorts Studio (internal name: `reels_studio`)

- Launched 2026-06-30, powered by **Gemini Omni Flash**. Path: Video → Shorts Studio (mobile `/flow/shorts-studio`).
- Pitch: *"Shorts Studio restyles your own footage into a completely new look… Motion stays yours."*
- Hero: **"GIVE YOUR FOOTAGE THE SPOTLIGHT"**. How it works: **Choose Preset** → **Upload your video** → **Download your video** (*"Export as one video, or download parts separately."*). Tabs: Presets · History (all / liked shorts) · Community · Library.

| Input | Rule |
|---|---|
| Source video | MP4 or MOV, **4 s – 2 min**, ≤ 200 MB, ≤ 4000 px, aspect between 1:3 and 3:1. Copy: *"Upload a video to edit — Max duration: 2 min · Max size: 200 MB"* |
| Preset | required (*"Please select a preset"*). 44 ready-made, or your own |
| Output ratio | **9:16 (Vertical, default)** · 16:9 (Horizontal) |
| Language | **auto-detect** (default) or one of 33: English, Spanish, French, Kazakh, Arabic, Bulgarian, Chinese, Croatian, Czech, Danish, Dutch, Filipino, Finnish, German, Greek, Hungarian, Hindi, Indonesian, Italian, Japanese, Korean, Malay, Norwegian, Polish, Portuguese, Romanian, Russian, Slovak, Swedish, Tamil, Turkish, Ukrainian, Vietnamese. UI: "Detected language: X · Change". It drives on-screen captions in the type-based presets *(inferred)* |
| Resolution | 720p only (1080p and 4K exist in code but are disabled) |
| Output | **≤ 10 s per clip**, 9:16 or 16:9 (changelog). A longer source becomes a **session of segments**: each segment can be regenerated, an alternative made "primary", and the session **stitched** into one full video ("Preparing full video", "Download full video") or downloaded in parts *(inferred from the sessions/segments/stitch API)* |
| Cost | Estimate = ceil(source seconds) × **3 credits**. *"You're only charged for the actual length"* |

**Custom preset** ("Create a preset from references"):
- Up to 10 images or videos *"of similar shorts for best results"*; reference videos ≤ 30 s.
- The name is auto-generated ("Generating name…", placeholder "Warm slow look"). Copy: *"Add reference images or videos that show the look you want. The preset learns the style from them."*
- Actions: Create / Update / Delete; created presets are labelled "Created by you".

API: `POST /reels/generate {params:{resolution, aspect_ratio, lang?, preset_id, preset_source: cms|user, medias:[{role:'video', data:{id, type:'video_input'}}]}}`, plus `/reels/sessions/{id}` (`/stitch`, `/segments/{i}/primary`) and `POST /jobs/v2/reels_studio_clip`. The same engine is exposed as the Supercomputer "Shorts Maker" employee.

**The 44 presets**, in the order `GET {studio-service}/reels/presets` returns them (public, names and preview videos only). The studio publishes descriptions for 5 of them; the rest are visual-only.

| # | Preset | Description | Preview |
|---|---|---|---|
| 1 | Bold Urban | — | mp4 |
| 2 | Green Contrast | — | mp4 |
| 3 | Urban Serenity | — | mp4 |
| 4 | Warm Glow | — | mp4 |
| 5 | Yellow Frame | — | mp4 |
| 6 | Monochrome Vibes | — | mp4 |
| 7 | Claymation | Stop-motion clay animation with a handmade, tactile feel | mp4 |
| 8 | Marker Scribble | Hand-drawn marker doodles and loose scribbled overlays | mp4 |
| 9 | Sticker Type | — | mp4 |
| 10 | Blue Comic | — | mp4 |
| 11 | Red Graffiti | — | mp4 |
| 12 | Watercolor | — | mp4 |
| 13 | Pencil Sketch | — | mp4 |
| 14 | Desktop | — | mp4 |
| 15 | Acid Green | — | mp4 |
| 16 | Balloon Type | — | mp4 |
| 17 | Blueprint | — | mp4 |
| 18 | Bold Caption | — | mp4 |
| 19 | Bounding Box | — | mp4 |
| 20 | Circuit | — | mp4 |
| 21 | Comic Burst | — | mp4 |
| 22 | Comic Pop | — | mp4 |
| 23 | Pink Wash | — | mp4 |
| 24 | Gold Stars | — | mp4 |
| 25 | Graffiti | — | mp4 |
| 26 | Green Doodle | — | mp4 |
| 27 | Green Pop | — | mp4 |
| 28 | Heart Pop | — | mp4 |
| 29 | Kinetic Type | — | mp4 |
| 30 | Liquid Chrome | — | mp4 |
| 31 | Mascot | — | mp4 |
| 32 | Neon Pop | — | mp4 |
| 33 | Neon Type | — | mp4 |
| 34 | Patterned | — | mp4 |
| 35 | Pink Pop | — | mp4 |
| 36 | Pink Scribble | — | mp4 |
| 37 | Polka Pop | Playful polka dots and pop-art color blocking | mp4 |
| 38 | Retro Collage | Vintage cut-paper textures and grainy print colors | mp4 |
| 39 | Stacked Type | — | mp4 |
| 40 | Star Comic | — | mp4 |
| 41 | Street Art | — | mp4 |
| 42 | Vintage Paper | — | mp4 |
| 43 | Yellow Burst | Bold graphic bursts on a punchy yellow backdrop | mp4 |
| 44 | Yellow Doodle | — | mp4 |

---

## 3. Mixed Media

- Route `/mixed-media`. Tabs: **All Presets · History · Community · How it works**. Each preset has a public page at `/mixed-media-presets/preset/{id}`.
- Pitch: *"Turn Any Video Into Mixed-Media Art"*, *"No Prompts, Just Vibe"*, *"Automated Rotoscoping"*.
- How it works:
  1. **Choose a Preset**.
  2. **Upload your video** (*"up to 10 seconds"*).
  3. **Customize settings** (*"Adjust the unique controls for each preset to fine-tune colors, textures, and visual intensity"*).
  4. **Generate & preview**.

| Control | Options / rule | Default |
|---|---|---|
| Source video | MP4 or MOV, **1–10 s**, ≤ 50 MB, ≤ 4000 px, aspect between 1:3 and 3:1, **≥ 4 fps** (*"Video must be at least 4 FPS"*). Trim video. *"Duration required: {min}-{max} seconds"* | — |
| Frame rate | **4 · 8 · 10 · 12 · 24 FPS · Manual** ("Choose frames manually", 4–24). Values above the source fps are disabled, and the selection drops to the highest allowed (*"Uploaded video has {videoFps} FPS"*) | **8 FPS** |
| Resolution | **1K · 2K · 4K** | 1K |
| Advanced settings | Each preset has its own `param_configs`: **colour pickers** (hex, or toggle "Write settings as prompt" → "Describe the color") and **dropdowns** (with a custom option → "Describe what you want"). Settings can be saved per preset ("Settings saved"), deleted or reset | preset defaults |
| Preview | **"Generate preview frame"**: *"Generate one frame with your current settings before creating the full video."* Shows "Preview costs: N credits" | — |
| Cost | **floor(seconds × fps) × 2 credits** (× 4 at 4K), i.e. 2 credits per output frame. 10 s at 8 fps = 160 credits | — |

API: `POST /chains/mixed-media` (and `/chains/mixed-media-preview`) `{params:{preset_id, config, input_video:{id,type:'video_input'}, start_seconds, end_seconds, target_fps, resolution, width, height}}`.

**Insight.** Pricing per frame and a default of 8 fps mean Mixed Media stylizes sampled frames into a stop-motion/collage look, rather than running a video model *(inferred)*.

**The 33 presets** (sitemap plus each page's SSR description; the app's i18n name map lists the same 33). Marketing says "40+".

| # | Preset | Description (the studio's copy) | Page |
|---|---|---|---|
| 1 | Layer mixed media | Stacked mixed-media composition | [link]({studio-site}/mixed-media-presets/preset/6ff15c8c-de78-459e-af32-e7a1266dc075) |
| 2 | Sketch | Hand-drawn textured linework | [link]({studio-site}/mixed-media-presets/preset/6377b231-5cea-4259-8a6b-0314728c1982) |
| 3 | Canvas | Hand-drawn canvas-style artwork | [link]({studio-site}/mixed-media-presets/preset/1a722581-6ba0-48b2-b990-a177a3f26cc8) |
| 4 | Flash comic | High-energy comic visuals | [link]({studio-site}/mixed-media-presets/preset/3fbd5057-50e1-4d1d-9a6f-8655836711b8) |
| 5 | Overexposed | Extreme light exposure effect | [link]({studio-site}/mixed-media-presets/preset/1c79bffd-0839-42c3-90ab-2cd7e6ff4619) |
| 6 | Paper | Handcrafted paper texture | [link]({studio-site}/mixed-media-presets/preset/f63bf420-f98a-44e6-ba54-3f7eaa599d40) |
| 7 | Noir | Cinematic noir lighting | [link]({studio-site}/mixed-media-presets/preset/c92d1f34-8bc3-410a-99c4-4b8f387140ec) |
| 8 | Particles | Luminous particles in motion | [link]({studio-site}/mixed-media-presets/preset/386ebb9d-643f-4108-a12f-3f867f18fb36) |
| 9 | Hand paint | Freeform hand-painted brushwork | [link]({studio-site}/mixed-media-presets/preset/ad8401a0-39a2-4c95-b65e-1634d41378ab) |
| 10 | Toxic | Radioactive neon color blast | [link]({studio-site}/mixed-media-presets/preset/fd3ca94d-6c3d-443f-970b-a4e8dd7338da) |
| 11 | Tracking | Dynamic object tracking lines | [link]({studio-site}/mixed-media-presets/preset/9fa35d36-e5f4-4488-9068-8813bd232a22) |
| 12 | Ultraviolet | Neon ultraviolet glow effect | [link]({studio-site}/mixed-media-presets/preset/c9682e42-9891-4118-86bb-f8cf79c84055) |
| 13 | Windows | Overlapping digital interface windows | [link]({studio-site}/mixed-media-presets/preset/4f7a1589-c604-44e5-b0ec-bc87d3929906) |
| 14 | Acid | Psychedelic neon color distortion | [link]({studio-site}/mixed-media-presets/preset/b501a54d-7c2a-42f8-a47d-484cbdace0a6) |
| 15 | Palette | Hand-painted color composition | [link]({studio-site}/mixed-media-presets/preset/15b97a49-9912-4a58-8424-b4ef1c302a05) |
| 16 | Comic | Graphic illustrated comic look | [link]({studio-site}/mixed-media-presets/preset/94cd1315-c820-4314-806d-f1b0936e8a46) |
| 17 | Akrill | Layered acrylic color blocks | [link]({studio-site}/mixed-media-presets/preset/73f9e01d-eb92-41d6-9119-53cc2686ecfa) |
| 18 | Two color | High-contrast two-tone style | [link]({studio-site}/mixed-media-presets/preset/ac3612ce-b1c9-4034-a04b-b46732c2d7a3) |
| 19 | Multiverse | Layered reality collision effect | [link]({studio-site}/mixed-media-presets/preset/c38c2630-3986-4e28-858f-596fd254e5e9) |
| 20 | Fragments | Layered abstract visual fragments | [link]({studio-site}/mixed-media-presets/preset/525fc0d7-abf1-49e5-a3e6-2f97eb50973c) |
| 21 | Origami | Crisp origami-style geometr | [link]({studio-site}/mixed-media-presets/preset/8c88dac7-0314-40b4-b611-5dcd3fda004d) |
| 22 | Random Glow | random glow | [link]({studio-site}/mixed-media-presets/preset/f1706661-007e-424b-8734-b755d602d580) |
| 23 | Vintage | Hand-inked illustrated style | [link]({studio-site}/mixed-media-presets/preset/ee12f76c-ed17-4471-bf2e-52bda1bcae64) |
| 24 | Cannabis | Smoky psychedelic poster look | [link]({studio-site}/mixed-media-presets/preset/c90cd302-d409-48fd-8643-36c34d7798e4) |
| 25 | Bubbles | Dreamy soap bubble texture | [link]({studio-site}/mixed-media-presets/preset/dacdca94-27b2-417a-bc8c-6d4168e6109a) |
| 26 | Magazine | Printed magazine visual look | [link]({studio-site}/mixed-media-presets/preset/963c3300-8967-4880-b078-c956de4c1e12) |
| 27 | Cold vision | Cold neon shadow lighting | [link]({studio-site}/mixed-media-presets/preset/d6ebc1b1-55b0-4379-8276-b46d47d8b056) |
| 28 | Modern | Clean geometric minimalism | [link]({studio-site}/mixed-media-presets/preset/9196d356-1406-43ef-bc68-cb26e7eaf507) |
| 29 | LSD | Hallucinogenic color waves | [link]({studio-site}/mixed-media-presets/preset/c2b241c5-5239-4465-869f-fef60a06822e) |
| 30 | Broken mirror | Broken glass reflection effect | [link]({studio-site}/mixed-media-presets/preset/5d89951e-ac83-4c7f-ac47-4d8db50c835e) |
| 31 | Lava | Liquid lava color motion | [link]({studio-site}/mixed-media-presets/preset/bb33da96-918c-4754-ba55-6d0dcbaf5173) |
| 32 | Marble | Sculpted marble visual style | [link]({studio-site}/mixed-media-presets/preset/ff617894-b1bc-4931-85b3-1e5b159d2106) |
| 33 | Ocean | Liquid sea color overlay | [link]({studio-site}/mixed-media-presets/preset/19115d24-276e-4222-a23f-39cc23d9a326) |

---

## 4. Popcorn Instadump

- Where: Image → **Popcorn → Instadump** (`/popcorn?modal-instadump=true`).
- Pitch: *"Generate Your Instadump — Upload your favorite photos and build a pack to generate new images that look like you."*

| Step | UI |
|---|---|
| 1. **Choose a Pack** | Grid of pack cards (two columns, search: "Oops! Nothing found"). Or **Create new pack**: *"Upload your reference set up to 15 photos"* (PNG/JPG or paste), then "Pack name". Copy: *"Create a pack from reference photos to generate new images in that style."* |
| 2. **Add Photo** | *"Upload one selfie or photo - it’ll be the base for your photodump styles"* (PNG/JPG/paste, < 20 MB: *""{fileName}" omitted (max 20MB)"*), or pick a saved character. Copy: *"Use a clear, well-lit photo for best results."* |
| 3. **Get Instadump** | *"Your new photos are ready - download, post, share and enjoy!"* Download All / "Download ({n} /{total})". Per image: Animate, Edit, Delete. Then Restart / Go to Library |

- API: `POST /keyframes/v3/photo-dump-pack {params:{preset_id:'bc8c784e-…', aspect_ratio:'portrait', quality:'1600p', sample_solver:'unipc', checkpoint:'260000', character_input_image, pack_id, photodump_transform:false, seed}}`. It is the Popcorn model.
- Output is portrait at 1600p, one image per pack reference *(inferred)*.
- Tips from the studio: match the subject type (woman → woman), use a clear high-resolution face, and avoid stylized inputs.

**Public packs** (`GET {studio-service}/photo-dump/packs`):

| Pack | Author | Reference photos |
|---|---|---|
| Winter special | The studio | 9 |
| Aura farming | neonfluke | 14 |
| Looksmaxing | wispomatic | 15 |
| 2000s nostalgia | trunxel | 15 |
| Editorial shots | lostsignal | 15 |

**Popcorn itself:**
- Modes: Manual (a prompt per scene: "Add scene", "Write what happens in Scene {n}") and Auto (one prompt, up to 8 frames).
- Up to 4 image references, cited by number (*"Note that reference images reduce the max output count."*).
- Aspect ratios: Auto, 3:4, 2:3, 3:2, 4:3, 16:9, 1:1, 9:16.
- Free daily credits: "{n} Daily Popcorn Credits Left".

---

## 5. Build plan for Fuobe

| The studio | Cloud route (paid, existing Fuobe models) | Open route (ComfyUI) | Effort |
|---|---|---|---|
| CS 4.0 workspace: projects, nested folders as scenes, roles, trash, feed controls | n/a (app feature) | n/a | L |
| Director's Panel → one generation | `cinema-studio-4` (the studio; slugs from the tables above). Seedance 2.5 / Kling 3.0 / Veo 3.1 with the panel compiled into the prompt (genre/era/tempo/camera/lens/aperture/lighting/palette text) | Wan 2.2 14B (+ Lightning), camera via Wan Fun Camera or camera LoRAs; palette by `palette-transfer-video` after generation; lighting by Bernini-R relight or prompt; MMAudio for audio | M |
| # camera moves (33) | `camera_movement` on cinema-studio-4, otherwise text | 11 via Wan Fun Camera, the rest prompt-only or camera LoRAs | S |
| Emotion Wheel | Insert the step's fragment after the @character (the studio's exact text) | same | S |
| Colour palettes (50, hex) | `color_palette` slug on cinema-studio-4; hex list as prompt + grade | `palette-transfer-image/video` with the 12 hex colours as target | S |
| Lighting presets + 2-light rig | `light` slug; custom rig → prompt ("key light from front-top-left, warm #FFB070, soft") | Bernini-R / Qwen relight with the same text | S |
| Extend forward/backward | Seedance 2.5 extension (`extension_mode`), Veo 3.1 / MiniMax H3 Max | `video-extend-wan22-fun-vace` (forward); backward = reverse the clip → extend → reverse | M |
| Edit Video (regional) | Kling O3 edit, Gemini Omni Flash 1.1, Wan 2.7 edit, Luma Ray 3.2 | Wan 2.2 Fun VACE with a SAM 3 mask (inpaint mode) | M |
| References (≤ 50) | Seedance 2.5 / cinema-studio-4 ref2v (≤ 30 img, 10 vid, 10 aud) | `wan21-vace-14b-ref2v` (few refs) | S |
| Grid 2×2/3×3/4×4 + types | Nano Banana Pro / Nano Banana 2: one "N×N contact sheet" image, then crop into tiles | Qwen-Image 2512 / Z-Image grid prompt + crop; next/prev shots via `storyboard-qwen-edit-2509-next-scene` | M |
| 3D scene + recomposition | Qwen camera control ("Angles") / Nano Banana re-render from the chosen view | Depth Anything 3 → three.js point cloud for the view → Qwen-Image-Edit-2511 + fal Multiple-Angles LoRA (96 camera poses, `QwenMultiangleCameraNode`) to re-render | L |
| Soul Cast builder | Soul 2.0 / Soul Cinema (the studio) or Nano Banana Pro; compile the 17 fields into a casting prompt, batch up to 10 | Z-Image Turbo with the same casting prompt, then Save as Element (LoRA training optional) | M |
| Soul Location | Soul Cinema / Seedream 5 at 16:9 | Z-Image Turbo / Qwen-Image 16:9 | S |
| AI Director chat + Project Brief | Existing Assist agent (Claude) with tools: read/write brief, set panel fields, write prompts, split a script into shots, propose → approve → generate | Assist on Ollama | M |
| Shorts Studio | `gemini-omni-flash` (video edit, ≤ 10 s segments) + style refs; Kling O3 edit as an alternative; stitch with fal FFmpeg | Segment into ≤ 5 s clips → restyle the first frame with Qwen-Image-Edit-2511 (preset text + style refs) → Wan 2.2 Fun Control (depth/pose) or VACE v2v → `video-concat` | L |
| Mixed Media | Frames sampled at 4–24 fps → Nano Banana 2 / FLUX Kontext edit per frame (preset prompt + param_config values) → reassemble (fal FFmpeg) | Load video at target fps → Qwen-Image-Edit-2511 or FLUX Kontext dev per frame (batched, fixed seed) → save video at the same fps; preview = 1 frame | M |
| Instadump | Nano Banana Pro / Seedream 5 multi-reference (selfie + each pack photo → one output per pack photo) | `qwen-image-edit-2511-multi` (identity + style reference) per pack photo; PuLID-FLUX as an alternative | M |

## Sources

- [i18n-cinema]({studio-site}/_i18n/routes/en/delta.844d2f759c.json) — Logged-in UI copy for the /generate (Cinema Studio) route, 3,035 strings
- [i18n-all]({studio-site}/_i18n/en.dd219392ea.json) — Full English catalog, 36,878 strings (mapped to JS chunks by message id)
- [i18n-root]({studio-site}/_i18n/routes/en/root.bc60caf0b1.json) — Shared shell strings
- [bundles]({studio-assets}/tanstack/assets/) — Production JS (build 3c4a1afe, 8,020 chunks crawled from /generate): job schemas, validators, defaults, enums, API paths
- [bundle-cs4-video]({studio-assets}/tanstack/assets/868a8dba-1pB6N7_Z46K3CZVe.js) — cinematic_studio_video_4_0 and seedance_2_5 job schemas (limits, defaults, validation messages)
- [bundle-cs-image]({studio-assets}/tanstack/assets/868a8dba-sJ73_ufwWlhS3dP4.js) — cinematic_studio_image, _image_grid, soul_cast, soul_location, soul_cinema_studio schemas and credit formulas
- [bundle-cs4-form]({studio-assets}/tanstack/assets/868a8dba-5sNAcX_DA99zsqQM.js) — Cinema Studio form + Director's Panel UI (palette editor, lighting rig, film setup)
- [bundle-cs4-store]({studio-assets}/tanstack/assets/868a8dba-sL8TiMfKKCdPPjmu.js) — CS 4.0 form store hf:video-cinematic-studio-4-0-store:v1
- [bundle-emotion]({studio-assets}/tanstack/assets/868a8dba-zdCIKyDu_IHnJPfy.js) — Emotion Wheel data: 8 families x 3 intensities with prompt fragments and colours
- [bundle-moves]({studio-assets}/tanstack/assets/868a8dba-N0VQtH1jhD7jdAst.js) — # camera-move token format <<<movement:{id}>>>
- [bundle-cast]({studio-assets}/tanstack/assets/868a8dba-MfeEHS6ki1EhfWtd.js) — Soul Cast builder option lists and defaults
- [bundle-shorts]({studio-assets}/tanstack/assets/868a8dba-pqMVxHi15Zj2ouyx.js) — Shorts Studio (reels_studio) upload validator, /reels/generate payload, cost estimate
- [bundle-shorts-store]({studio-assets}/tanstack/assets/868a8dba-59aolFqmKz3cUs8F.js) — Shorts Studio form store, languages, sessions/stitch API
- [bundle-mixed]({studio-assets}/tanstack/assets/868a8dba-D1SuLrWXFHF4GStX.js) — Mixed Media form: fps presets, resolution, credits per frame, preset param_configs, /chains/mixed-media payload
- [bundle-popcorn]({studio-assets}/tanstack/assets/868a8dba-OFQUBjDTeudk4pba.js) — Popcorn + Instadump flow and /keyframes/v3/photo-dump-pack payload
- [api-palettes]({studio-service}/color-presets/with-presets?size=100) — 50 CS 4.0 colour palettes with 12 hex colours each (public, no login)
- [api-lighting]({studio-service}/lighting-presets/with-presets?size=100) — 7 lighting presets with preview videos (public)
- [api-reels]({studio-service}/reels/presets?size=50) — 44 Shorts Studio presets (public)
- [api-packs]({studio-service}/photo-dump/packs) — Instadump packs (public)
- [api-costs]({studio-service}/job-sets/costs) — Per-second credit costs per job type (public)
- [mm-sitemap]({studio-site}/mixed-media-presets/sitemap.xml) — 33 Mixed Media preset pages (SSR name + description)
- [docs-cs4]({studio-dashboard}/models/{studio}/cinema-studio/4.0/llms.txt) — Public API schema of Cinema Studio 4.0 (enums incl. 33 camera moves, 50 palettes) and token pricing
- [blog-cs4]({studio-site}/blog/cinema-studio-4-0) — Official CS 4.0 guide: every Genre/Era/Tempo/Camera/Lens/Aperture/Lighting option explained, Emotion Wheel, team features
- [blog-built]({studio-site}/blog/how-we-built-cinema-studio) — History 1.0 to 3.5; AI Director became Supercomputer
- [blog-cs35]({studio-site}/blog/cinema-studio-3.5-full-tutorial) — CS 3.5 settings reference (palettes, MoveSet styles, cameras, lenses, focal lengths)
- [blog-cs20]({studio-site}/blog/cinema-studio-guide) — CS 2.0 image mode: 3D Scene, 2x2/3x3/4x4 grid, multi-shot up to 6 shots
- [blog-soulcast]({studio-site}/blog/soul-cast-ai-filmmaking) — Soul Cast fields
- [blog-instadump]({studio-site}/blog/Create-Ai-Photoshoots-With-Instadump) — Instadump flow (2025 version)
- [landing-cs]({studio-site}/cinematic-video-generator) — CS 4.0 landing: {assistant-name} personal assistant, # tags, 50 references, era scrub, FAQ
- [landing-mm]({studio-site}/mixed-media-intro) — Mixed Media landing (4-step flow, 40+ looks claim, 10-second scenes)
- [help-cs]({studio-site}/creator-hub/help-center/tools/how-do-i-use-cinema-studio) — Help: all CS versions, Director's Panel, video modes, upload limits
- [help-popcorn]({studio-site}/creator-hub/help-center/ai-models/how-do-i-use-popcorn) — Help: Popcorn modes, Instadump 3-step flow, aspect ratios
- [help-projects]({studio-site}/creator-hub/help-center/community/how-do-projects-work) — Help: Open Projects, project brief, publishing steps
- [changelog]({studio-site}/creator-hub/changelog) — Release notes: CS workspace (Jun 7), Shorts Studio (Jun 30), CS 4.0 (Aug 12), Relight/Color Palette standalone (Aug 21)
