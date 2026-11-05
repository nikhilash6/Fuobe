import type { InputSlot, LoraRef, Preset } from "./types";

/*
 * Camera motions (the parity studio "DoP"-style presets) and VFX effects.
 *
 * Cloud: the user's image is animated by a frontier model (Kling 2.5 Turbo by default, any
 * video model works) with a camera-language prompt tuned per preset.
 * Open source: Wan 2.2 14B I2V on ComfyUI with the same prompt, plus a motion/effect LoRA
 * where a good public one exists (injected after the model loaders at run time).
 * Transition presets (endFrame) run as start + end frame → video.
 */

type MotionSpec = {
  name: string;
  /** The name the id was made from, when the preset was renamed since: links and covers keep working. */
  was?: string;
  category: string;
  prompt: string;
  icon?: string;
  hue?: number;
  loras?: LoraRef[];
  description?: string;
  /** Needs a start and an end frame (the parity studio "Start & End" presets). */
  endFrame?: boolean;
  parity?: string;
};

const CLOUD_MODEL = "kling-2-5-turbo";
const OPEN_MODEL = "oss-wan22-14b";

const START: InputSlot = { key: "image", label: "Start frame", accept: "image", required: true, hint: "The shot to animate" };
const END: InputSlot = { key: "endImage", label: "End frame", accept: "image", required: true, hint: "Where the transition lands" };

/** The reference applies these to an uploaded video; Fuobe animates a still in the look (Details says it plainly). */
const RESTYLE = "Animates your still in this look.";

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** A card's caption from its prompt: the first sentence, without a "Comic book restyle:" or "Bleach bypass grade:" lead-in. */
function caption(prompt: string): string {
  const first = prompt.split(".")[0];
  const rest = /^[^:]{1,40}\b(?:restyle|grade|lighting)\b[^:]*:\s*(.+)$/i.exec(first)?.[1];
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : first;
}

function look(hue: number, icon: string) {
  return { icon, from: `oklch(0.72 0.16 ${hue})`, to: `oklch(0.55 0.2 ${(hue + 50) % 360})` };
}

function build(type: "motion" | "effect", specs: MotionSpec[], baseHue: number): Preset[] {
  return specs.map((m, i) => {
    const op = m.endFrame ? ("flf2v" as const) : ("i2v" as const);
    return {
      id: `${type}-${slug(m.was ?? m.name)}`,
      type,
      name: m.name,
      category: m.category,
      description: m.description ?? caption(m.prompt),
      look: look(m.hue ?? (baseHue + i * 23) % 360, m.icon ?? (type === "motion" ? "Video" : "Sparkles")),
      inputs: m.endFrame ? [START, END] : [START],
      promptTemplate: `{prompt}. ${m.prompt}`,
      userPrompt: "optional",
      promptPlaceholder: "Describe the subject and action (optional)",
      cloud: { modelId: CLOUD_MODEL, op, params: { duration: 5 } },
      open: {
        modelId: OPEN_MODEL,
        op,
        params: { duration: 5, resolution: "480p" },
        loras: m.loras,
      },
      // Fuobe DoP writes each motion's and effect's own line (dopPreset); this one is kept only where it adds to it.
      parity: m.parity ?? (m.loras?.length ? "On your GPU, it adds a style trained for this look." : "On your GPU, it's made from a written direction."),
    };
  });
}

const MOTION_SPECS: MotionSpec[] = [
  // Push / pull
  { name: "Zoom In", category: "Push & Pull", icon: "ZoomIn", prompt: "The camera slowly and steadily zooms in on the subject, gradually building focus and tension" },
  { name: "Zoom Out", category: "Push & Pull", icon: "ZoomOut", prompt: "The camera slowly zooms out from the subject, gradually revealing more of the scene and a growing sense of distance" },
  { name: "Zoom", category: "Push & Pull", icon: "Search", prompt: "A smooth optical zoom toward the subject with the camera position fixed, perspective compressing as the framing tightens" },
  { name: "Dolly In", category: "Push & Pull", icon: "MoveDiagonal", prompt: "The camera performs a smooth, steady dolly in toward the subject, gradually tightening the framing" },
  { name: "Dolly Out", category: "Push & Pull", icon: "MoveDiagonal2", prompt: "The camera smoothly dollies backward away from the subject, revealing more of the surroundings" },
  { name: "Super Dolly In", category: "Push & Pull", icon: "ChevronsUp", prompt: "A fast, dramatic dolly push from a wide shot all the way into an extreme close-up of the subject" },
  { name: "Super Dolly Out", category: "Push & Pull", icon: "ChevronsDown", prompt: "A fast, continuous dolly pull from a close-up back to a very wide establishing shot" },
  { name: "Crash Zoom In", category: "Push & Pull", icon: "ZoomIn", prompt: "A sudden, violent crash zoom snaps into the subject's face in a fraction of a second, with slight motion blur" },
  { name: "Crash Zoom Out", category: "Push & Pull", icon: "ZoomOut", prompt: "A sudden crash zoom snaps out from the subject to a wide shot with motion blur" },
  { name: "Rapid Zoom In", category: "Push & Pull", icon: "ZoomIn", prompt: "A rapid optical zoom in toward the subject, fast but controlled" },
  { name: "Rapid Zoom Out", category: "Push & Pull", icon: "ZoomOut", prompt: "A rapid optical zoom out away from the subject, fast but controlled" },
  { name: "Dolly Zoom In", category: "Push & Pull", icon: "Focus", prompt: "Vertigo dolly zoom: the camera dollies forward while zooming out, the background stretches away while the subject stays the same size" },
  { name: "Dolly Zoom Out", category: "Push & Pull", icon: "Focus", prompt: "Reverse vertigo dolly zoom: the camera pulls back while zooming in, the background compresses toward the subject" },
  { name: "YoYo Zoom", category: "Push & Pull", icon: "Repeat", prompt: "The camera zooms quickly in on the subject and then immediately back out, a playful yo-yo zoom" },
  { name: "Eyes In", category: "Push & Pull", icon: "Eye", prompt: "The camera pushes in rapidly toward the subject's eyes, ending on an extreme close-up of one eye" },
  { name: "Mouth In", category: "Push & Pull", icon: "Smile", prompt: "The camera pushes in rapidly toward the subject's mouth, ending on an extreme close-up" },
  { name: "Eating Zoom", category: "Push & Pull", icon: "Utensils", prompt: "The subject takes a big bite of food as the camera punches in fast to a tight close-up of their mouth and the food, then eases back out as they chew happily" },
  { name: "Through Object In", category: "Push & Pull", icon: "ScanLine", prompt: "The camera flies forward through a foreground object or opening and continues toward the subject" },
  { name: "Through Object Out", category: "Push & Pull", icon: "ScanLine", prompt: "The camera pulls backward through a foreground object or opening, revealing the scene" },
  { name: "Earth Zoom Out", category: "Push & Pull", icon: "Earth", prompt: "The camera pulls back rapidly and continuously from the subject, rising above the street, then the city, the continent and finally the whole Earth seen from space" },
  // Orbit
  { name: "360 Orbit", category: "Orbit", icon: "RefreshCw", prompt: "The camera orbits a full 360 degrees around the subject at a constant height, keeping them centered", hue: 200 },
  { name: "Arc Left", category: "Orbit", icon: "Undo2", prompt: "The camera arcs smoothly to the left around the subject, keeping them centered in frame" },
  { name: "Arc Right", category: "Orbit", icon: "Redo2", prompt: "The camera arcs smoothly to the right around the subject, keeping them centered in frame" },
  { name: "Lazy Susan", category: "Orbit", icon: "Disc3", prompt: "The subject slowly rotates in place as if on a turntable while the camera stays still" },
  { name: "3D Rotation", category: "Orbit", icon: "Rotate3d", prompt: "The subject spins smoothly 360 degrees in place, centered on a clean background, revealing every side like a product on a turntable" },
  { name: "Bullet Time", category: "Orbit", icon: "Timer", prompt: "Bullet time: the action freezes in mid-air while the camera sweeps around the subject in a fast arc" },
  { name: "Lazy Orbit", category: "Orbit", icon: "Orbit", prompt: "A slow, graceful partial orbit around the subject with gentle parallax" },
  { name: "Glam", category: "Orbit", icon: "Sparkles", prompt: "High-speed camera glides in a smooth arc around the subject in glamorous slow motion, hair and fabric flowing, light glinting, fashion-commercial polish" },
  // Vertical
  { name: "Crane Up", category: "Vertical", icon: "ArrowUpFromLine", prompt: "The camera cranes up smoothly, rising above the subject to reveal the scene from above" },
  { name: "Crane Down", category: "Vertical", icon: "ArrowDownToLine", prompt: "The camera cranes down smoothly from a high angle to the subject's eye level" },
  { name: "Crane Over The Head", category: "Vertical", icon: "ArrowUpRight", prompt: "The camera rises and travels over the subject's head, ending looking down from behind" },
  { name: "Jib Up", category: "Vertical", icon: "ArrowUp", prompt: "A short jib move upward that reveals the background behind the subject" },
  { name: "Jib Down", category: "Vertical", icon: "ArrowDown", prompt: "A short jib move downward settling on the subject" },
  { name: "Pedestal Down", category: "Vertical", icon: "ArrowDownToDot", prompt: "The camera lowers straight down on a pedestal, its angle held perfectly level, sliding from above the subject's head to their eye level" },
  { name: "Tilt Up", category: "Vertical", icon: "ChevronUp", prompt: "The camera tilts up slowly from the subject's feet to their face" },
  { name: "Tilt Down", category: "Vertical", icon: "ChevronDown", prompt: "The camera tilts down slowly from the sky to the subject" },
  { name: "Overhead", category: "Vertical", icon: "LayoutGrid", prompt: "A top-down overhead shot that slowly rotates and descends toward the subject" },
  { name: "Buckle Up", category: "Vertical", icon: "ArrowUpWideNarrow", prompt: "Extreme low angle from directly beneath the subject, as if filmed through a transparent glass floor, looking up at the soles of their shoes and their towering figure as they move" },
  // Lateral
  { name: "Pan", category: "Lateral", icon: "MoveHorizontal", prompt: "The camera pans slowly and smoothly across the scene from a fixed position, settling on the subject" },
  { name: "Pan Left", category: "Lateral", icon: "ArrowLeft", prompt: "The camera pans smoothly to the left across the scene" },
  { name: "Pan Right", category: "Lateral", icon: "ArrowRight", prompt: "The camera pans smoothly to the right across the scene" },
  { name: "Dolly Left", category: "Lateral", icon: "ArrowLeftToLine", prompt: "The camera dollies smoothly to the left on a track, parallel to the subject, revealing the scene with gentle parallax" },
  { name: "Dolly Right", category: "Lateral", icon: "ArrowRightToLine", prompt: "The camera dollies smoothly to the right on a track, parallel to the subject, revealing the scene with gentle parallax" },
  { name: "Truck Left", category: "Lateral", icon: "ChevronsLeft", prompt: "The camera trucks sideways to the left, parallel to the subject, with strong parallax" },
  { name: "Truck Right", category: "Lateral", icon: "ChevronsRight", prompt: "The camera trucks sideways to the right, parallel to the subject, with strong parallax" },
  { name: "Tracking", category: "Lateral", icon: "Footprints", prompt: "A smooth tracking shot travels alongside the moving subject at their pace, keeping them framed while the background slides past" },
  { name: "Double Dolly", category: "Lateral", icon: "Rows2", prompt: "The subject and the camera glide forward together, the subject stays perfectly still in frame as if floating while the background drifts past, dreamlike music-video look" },
  { name: "Whip Pan", category: "Lateral", icon: "Wind", prompt: "A fast whip pan with heavy motion blur that snaps to the subject" },
  { name: "Dutch Angle", category: "Lateral", icon: "RotateCw", prompt: "The camera rolls into a tilted Dutch angle, creating tension" },
  { name: "Incline", category: "Lateral", icon: "TrendingUp", prompt: "The whole frame is steeply tilted as if the world itself is on a slope; the subject stands and moves at an impossible angle, gravity-defying and surreal" },
  // Handheld & POV
  { name: "Handheld", category: "Handheld & POV", icon: "Hand", prompt: "Handheld documentary camera with natural shake and small reframing movements" },
  { name: "BTS", category: "Handheld & POV", icon: "Clapperboard", prompt: "Casual behind-the-scenes handheld footage: the camera wanders around the subject between takes, catching candid moments, quick reframes and slight shake" },
  { name: "POV", category: "Handheld & POV", icon: "Eye", prompt: "First-person point-of-view shot through the eyes of a character, hands occasionally entering the frame, natural head movement" },
  { name: "Snorricam", category: "Handheld & POV", icon: "Camera", prompt: "Snorricam: the camera is rigged to the subject's body, their face stays locked in frame while the world moves around them" },
  { name: "Head Tracking", category: "Handheld & POV", icon: "ScanFace", prompt: "The camera tracks the subject's head closely from the front as they move" },
  { name: "Object POV", category: "Handheld & POV", icon: "Box", prompt: "First-person point of view from an object moving through the scene" },
  { name: "Hero Cam", category: "Handheld & POV", icon: "Shield", prompt: "Low-angle hero shot that slowly rises and pushes in, the subject looks powerful" },
  { name: "Action Run", category: "Handheld & POV", icon: "Zap", prompt: "The subject sprints at full speed toward the camera as a shaky handheld camera runs backward in front of them, dynamic angles and motion blur" },
  { name: "Catwalk", category: "Handheld & POV", icon: "Footprints", prompt: "The subject struts down a runway with a confident model walk while the camera tracks backward in front of them, smooth and fashion-forward" },
  { name: "Rap Flex", category: "Handheld & POV", icon: "Mic", prompt: "Rap music video camera: low angle with a fisheye-like wide lens, smooth slides and slow push-ins as the subject flexes confidently toward the lens" },
  { name: "Downhill POV", category: "Handheld & POV", icon: "MountainSnow", prompt: "Fast first-person ride down a steep slope, the camera bouncing over bumps and swerving through tight turns, adrenaline rush" },
  { name: "Wiggle", category: "Handheld & POV", icon: "Activity", prompt: "Playful wiggle camera with quick small shakes" },
  { name: "Fisheye", category: "Handheld & POV", icon: "Circle", prompt: "Ultra-wide fisheye lens close to the subject with exaggerated distortion and fast movement" },
  // Vehicles & drones
  { name: "FPV Drone", category: "Drone & Vehicle", icon: "Plane", prompt: "Fast FPV drone flight diving and banking through the scene, then racing past the subject", hue: 160 },
  { name: "Drone Reveal", category: "Drone & Vehicle", icon: "Mountain", prompt: "An aerial drone rises and pulls back to reveal a vast landscape around the subject" },
  { name: "Aerial Pullback", category: "Drone & Vehicle", icon: "Send", prompt: "The camera starts close on the subject and pulls back and up in one continuous aerial move, ending on a high wide shot of the whole location" },
  { name: "Helicopter Shot", category: "Drone & Vehicle", icon: "Plane", prompt: "Sweeping helicopter shot high above the landscape, slowly circling and descending toward the subject, epic scale" },
  { name: "Road Rush", category: "Drone & Vehicle", icon: "Gauge", prompt: "Low camera skimming just above the road at high speed, lane markings streaking past, rushing toward the subject" },
  { name: "Car Grip", category: "Drone & Vehicle", icon: "Car", prompt: "Camera mounted on the side of a moving car, the background streaks past" },
  { name: "Car Chasing", category: "Drone & Vehicle", icon: "Gauge", prompt: "A pursuit camera chasing the subject at speed from behind and slightly above" },
  { name: "Robo Arm", category: "Drone & Vehicle", icon: "Bot", prompt: "Precise motion-control robotic arm move: a fast swooping arc that stops perfectly on the subject" },
  { name: "Robot Arm", category: "Drone & Vehicle", icon: "Bot", prompt: "High-speed robotic camera arm whips from a wide angle into a tight close-up and freezes precisely, then swings smoothly around the subject" },
  { name: "Flying", category: "Drone & Vehicle", icon: "Bird", prompt: "The camera flies smoothly through the air alongside the subject" },
  // Time & focus
  { name: "General", category: "Time & Focus", icon: "Video", prompt: "Natural, balanced cinematic camera work with gentle movement and clean framing" },
  { name: "Static", category: "Time & Focus", icon: "Square", prompt: "Locked-off static tripod shot; only the subject moves" },
  { name: "Hyperlapse", category: "Time & Focus", icon: "FastForward", prompt: "Hyperlapse: the camera moves forward while time is sped up, people and clouds streak by" },
  { name: "Timelapse", category: "Time & Focus", icon: "Hourglass", prompt: "Static timelapse: clouds race, light changes quickly, the subject stays still" },
  { name: "Timelapse Human", category: "Time & Focus", icon: "PersonStanding", prompt: "Timelapse of the subject: their movements are sped up into quick bursts of activity while the surrounding environment and light change naturally" },
  { name: "Timelapse Landscape", category: "Time & Focus", icon: "Sunrise", prompt: "Landscape timelapse: clouds stream across the sky, shadows sweep over the land and light shifts from day toward dusk while the camera stays fixed" },
  { name: "Timelapse Glam", category: "Time & Focus", icon: "Sparkles", prompt: "Glamorous timelapse: the subject holds a pose as hair, makeup, outfit and lighting shift rapidly around them, the camera slowly pushing in" },
  { name: "Slow Motion", category: "Time & Focus", icon: "Snail", prompt: "Dramatic high-frame-rate slow motion of every detail" },
  { name: "Low Shutter", category: "Time & Focus", icon: "Aperture", prompt: "Low shutter speed look with dreamy motion trails and light streaks" },
  { name: "Focus Change", category: "Time & Focus", icon: "ScanEye", prompt: "Rack focus from the foreground to the subject in the background" },
  // Transitions
  { name: "Roll Transition", category: "Transitions", icon: "RotateCcw", endFrame: true, prompt: "The camera rolls forward like a spinning wheel, rotating through the frame to transition seamlessly from the start frame into the end frame" },
  { name: "Flying Cam Transition", category: "Transitions", icon: "Plane", prompt: "The camera lifts off and flies rapidly out of the scene, soaring through the air and swooping down into a new location to land on the subject" },
  // Action & sports (the parity studio "Catch the Pulse")
  { name: "Baseball Kick", category: "Action & Sports", icon: "Footprints", prompt: "The subject winds up and delivers a powerful high kick, leg snapping through the frame with dramatic impact and a slight camera shake" },
  { name: "Basketball Dunks", category: "Action & Sports", icon: "Volleyball", prompt: "The subject sprints, leaps high and slams a basketball through the hoop, hanging on the rim as the camera follows from a low angle" },
  { name: "Boxing", category: "Action & Sports", icon: "Swords", prompt: "The subject throws quick jabs and hooks with fast head movement while the camera stays up close, rhythmic and intense" },
  { name: "Face Punch", category: "Action & Sports", icon: "Hand", prompt: "A fist flies into frame and lands on the subject's face, their head snapping sideways in slow motion with sweat droplets and raw impact" },
  { name: "Kiss", category: "Action & Sports", icon: "Heart", prompt: "The two people lean in slowly and share a tender kiss in soft focus, the camera gently circling them" },
  { name: "Moonwalk Left", category: "Action & Sports", icon: "ArrowLeft", prompt: "The subject performs a smooth moonwalk, gliding backward to the left while facing forward, retro dance style" },
  { name: "Moonwalk Right", category: "Action & Sports", icon: "ArrowRight", prompt: "The subject performs a smooth moonwalk, gliding backward to the right while facing forward, retro dance style" },
  { name: "Skate Cruise", category: "Action & Sports", icon: "Wind", prompt: "The subject cruises relaxed on a skateboard down a sunny street, simply pushing and gliding with all four wheels on the ground, the camera tracking alongside" },
  { name: "Skateboard Glide", category: "Action & Sports", icon: "Wind", prompt: "The subject glides smoothly on a skateboard, board rolling effortlessly, flowing and stylish" },
  { name: "Skateboard Ollie", category: "Action & Sports", icon: "ArrowUp", prompt: "The subject pops a clean ollie, rider and board lifting off the ground together and landing smoothly" },
  { name: "Ski Carving", category: "Action & Sports", icon: "MountainSnow", prompt: "A skier carves fast, clean turns down the slope, edges biting into the snow, the camera following" },
  { name: "Ski Powder", category: "Action & Sports", icon: "Snowflake", prompt: "A skier floats through deep fresh powder, soft explosive sprays of snow bursting with every turn" },
  { name: "Snowboard Carving", category: "Action & Sports", icon: "MountainSnow", prompt: "A snowboarder lays deep controlled carves into the slope, a curtain of snow spraying from the board's edge" },
  { name: "Snowboard Powder", category: "Action & Sports", icon: "Snowflake", prompt: "A snowboarder surfs through fresh powder with wide flowing turns and big sprays of snow" },
  // Camera MoveSet styles (Cinema Studio)
  { name: "Classic Static", category: "Camera Styles", icon: "Square", prompt: "Classic locked-off cinema framing with perfectly composed static shots and minimal, deliberate movement" },
  { name: "Documentary Snap", category: "Camera Styles", icon: "Camera", prompt: "Documentary style: handheld camera reacting to the action with quick snap zooms and reframes, observational and raw" },
  { name: "Dreamy Flow", category: "Camera Styles", icon: "Cloud", prompt: "Dreamy floating camera that drifts slowly and weightlessly around the subject with soft focus and gentle slow motion" },
  { name: "Epic Scale", category: "Camera Styles", icon: "Mountain", prompt: "Epic large-scale camera work: sweeping crane and aerial moves that emphasize the vastness of the world around the subject" },
  { name: "Impossible Camera", category: "Camera Styles", icon: "Infinity", prompt: "Impossible camera move that flies through tiny gaps, passes through glass and objects and swoops around the subject in one continuous path" },
  { name: "Intimate Observer", category: "Camera Styles", icon: "Eye", prompt: "Intimate close camera that quietly observes the subject from near their shoulder, subtle breathing movement and shallow depth of field" },
  { name: "One Take", category: "Camera Styles", icon: "Film", prompt: "Single continuous oner: a fluid Steadicam move follows the subject through the space in one unbroken take" },
  { name: "Raw Chaos", category: "Camera Styles", icon: "Shuffle", prompt: "Chaotic, aggressive handheld camera with violent shakes, whip pans and crash zooms, raw and frantic" },
  { name: "Silent Machine", category: "Camera Styles", icon: "Cog", prompt: "Precise, mechanical camera motion: perfectly linear slow slides and pushes with symmetrical framing, cold and controlled" },
];

const EFFECT_SPECS: MotionSpec[] = [
  // Destruction
  { name: "Disintegration", category: "Destruction", icon: "Wind", prompt: "The subject disintegrates into thousands of particles of dust that blow away in the wind" },
  { name: "Building Explosion", category: "Destruction", icon: "Bomb", prompt: "The building behind the subject explodes in a massive fireball with debris flying, the subject stays calm" },
  { name: "Head Explosion", category: "Destruction", icon: "Flame", prompt: "The subject's head bursts into a colorful cloud of confetti and smoke, surreal and playful" },
  { name: "Car Explosion", category: "Destruction", icon: "Car", prompt: "A car near the subject bursts into a huge fireball, flames and debris flying outward as the shockwave ripples through the scene" },
  { name: "Powder Explosion", category: "Destruction", icon: "Cloudy", prompt: "A burst of vivid colored powder erupts around the subject and fills the frame in billowing slow-motion clouds" },
  { name: "Lens Crack", category: "Destruction", icon: "Unplug", prompt: "Something strikes the camera and the lens cracks, spidering fractures spreading across the frame and distorting the light" },
  { name: "Head Off", category: "Destruction", icon: "UserX", prompt: "The subject's head gently detaches and floats upward while the body keeps standing calmly, surreal and eerie" },
  // Elements
  { name: "Set On Fire", category: "Elements", icon: "Flame", prompt: "Flames ignite and engulf the subject, realistic fire and embers" },
  { name: "Fire Breath", category: "Elements", icon: "Flame", prompt: "The subject breathes out a powerful stream of fire" },
  { name: "Freezing", category: "Elements", icon: "Snowflake", prompt: "Frost spreads across the subject until they are frozen solid in ice" },
  { name: "Thunder God", category: "Elements", icon: "Zap", prompt: "Lightning crackles around the subject, their eyes glow, electric energy surges" },
  { name: "Water Splash", category: "Elements", icon: "Droplets", prompt: "A huge wave of water crashes over the subject in slow motion" },
  { name: "Flood", category: "Elements", icon: "Waves", prompt: "Water pours in and rises rapidly around the subject, flooding the whole space as objects float and the light ripples" },
  { name: "Sand Storm", category: "Elements", icon: "Tornado", prompt: "A powerful wall of sand sweeps through the scene, swirling dust engulfing the subject as visibility drops" },
  { name: "Wind to Face", category: "Elements", icon: "Wind", prompt: "A violent gust of wind blasts the subject head-on, hair whipping back, clothes thrashing and the body leaning into the force" },
  { name: "Fire Element", category: "Elements", icon: "Flame", prompt: "The subject summons fire: flames swirl up from their hands and spiral around their body like a fire elemental" },
  { name: "Flame On", category: "Elements", icon: "Flame", prompt: "The subject's body ignites from head to toe into a living being of flame, like a superhero powering up" },
  { name: "Firelava", category: "Elements", icon: "Flame", prompt: "Cracks of glowing molten lava spread across the subject's skin until they become a being of fire and magma" },
  { name: "Earth Element", category: "Elements", icon: "Mountain", prompt: "Rocks and soil rise from the ground and orbit the subject before forming stone armor around their body" },
  { name: "Earth Wave", category: "Elements", icon: "Activity", prompt: "The subject stomps and a shockwave ripples through the ground, lifting the earth in a rolling wave of rock and dust" },
  { name: "Water Element", category: "Elements", icon: "Droplet", prompt: "The subject's body turns into flowing, transparent water that ripples and splashes while keeping their shape" },
  { name: "Water Bending", category: "Elements", icon: "Waves", prompt: "The subject raises their hands and bends a ribbon of water through the air, twisting it around them in graceful arcs" },
  { name: "Air Bending", category: "Elements", icon: "Wind", prompt: "The subject sweeps their arms and a visible whirlwind spirals around them, lifting leaves and dust in a swirling vortex" },
  { name: "Ice Rose", category: "Elements", icon: "Snowflake", prompt: "Delicate ice crystals grow from the subject's hands and bloom into a glittering frozen rose" },
  // Magic
  { name: "Levitation", category: "Magic", icon: "Feather", prompt: "The subject slowly levitates off the ground, floating weightlessly" },
  { name: "Clone Explosion", category: "Magic", icon: "Copy", prompt: "Clones of the subject burst outward in all directions" },
  { name: "Duplicate", category: "Magic", icon: "Copy", prompt: "The subject splits into several identical copies that step out side by side in sequence" },
  { name: "Portal", category: "Magic", icon: "CircleDot", prompt: "A glowing portal opens behind the subject and pulls them in" },
  { name: "Angel Wings", category: "Magic", icon: "Feather", prompt: "Huge feathered angel wings unfold from the subject's back" },
  { name: "Super Saiyan", category: "Magic", icon: "Zap", prompt: "The subject powers up with a golden glowing aura and spiky glowing hair" },
  { name: "Glowshift", category: "Magic", icon: "Sparkle", prompt: "A soft magical light wraps around the subject and their form gently shifts into a different person as the glow fades" },
  { name: "Innerlight", category: "Magic", icon: "Sun", prompt: "A radiant glow builds inside the subject, shining through their skin and eyes until they are luminous" },
  { name: "Invisible", category: "Magic", icon: "EyeOff", prompt: "The subject fades away completely, body and clothes vanishing, leaving only displaced air and their footsteps behind" },
  { name: "Soul Jump", category: "Magic", icon: "Ghost", prompt: "A translucent glowing copy of the subject, their soul, leaps out of their body and floats upward while the body stands still" },
  { name: "Luminous Gaze", category: "Magic", icon: "Eye", prompt: "The subject looks into the lens as their eyes ignite with a brilliant glowing light that beams outward" },
  { name: "Hero Flight", category: "Magic", icon: "Rocket", prompt: "The subject crouches and launches into the sky like a superhero, flying upward with a burst of wind and dust" },
  { name: "I Can Fly", category: "Magic", icon: "Bird", prompt: "The subject spreads their arms, lifts off the ground and soars joyfully over the landscape, the camera flying with them" },
  { name: "Objects Around", category: "Magic", icon: "Orbit", prompt: "Everyday objects around the subject lift off and slowly orbit them in mid-air as if gravity has switched off" },
  { name: "Shadow Smoke", category: "Magic", icon: "CloudFog", prompt: "Dark wisps of shadow smoke swirl up around the subject and they dissolve into black smoke, then reform" },
  // Transform
  { name: "Turning Metal", category: "Transform", icon: "Shield", prompt: "The subject's skin turns into polished liquid chrome metal" },
  { name: "Morphskin", category: "Transform", icon: "Layers", prompt: "The subject's skin morphs and shifts texture surreally" },
  { name: "Turn Into Statue", category: "Transform", icon: "Landmark", prompt: "The subject turns into a white marble statue" },
  { name: "Melting", category: "Transform", icon: "Droplet", prompt: "The subject melts like wax into a puddle" },
  { name: "Medusa Gorgona", category: "Transform", icon: "Mountain", prompt: "The subject's skin slowly hardens and cracks into cold gray stone, freezing in place like a living statue" },
  { name: "Diamond", category: "Transform", icon: "Diamond", prompt: "The subject's body crystallizes into sparkling faceted diamond, refracting rainbow light" },
  { name: "Agent Reveal", category: "Transform", icon: "Glasses", prompt: "The subject jerks their head as their face and body glitch and morph into a sharp-suited secret agent in dark sunglasses" },
  { name: "Werewolf", category: "Transform", icon: "Moon", prompt: "Under the moonlight the subject hunches as fur sprouts, their face stretches into a snout and they transform into a werewolf" },
  { name: "Animalization", category: "Transform", icon: "PawPrint", prompt: "The subject smoothly morphs into an animal that matches their personality, keeping their pose and outfit colors" },
  { name: "Gorilla Transfer", category: "Transform", icon: "PawPrint", prompt: "The subject transforms into a huge gorilla in the same outfit and pose, beating its chest" },
  { name: "Cyborg", category: "Transform", icon: "Cpu", prompt: "Panels of the subject's skin slide open to reveal glowing circuits and chrome mechanics as they become a cyborg" },
  { name: "Polygon", category: "Transform", icon: "Hexagon", prompt: "The subject breaks down into a low-poly 3D model of flat colored triangles that shift and reassemble" },
  { name: "Wireframe", category: "Transform", icon: "Grid3x3", prompt: "The subject and scene turn into a glowing green 3D wireframe mesh that rotates and pulses" },
  { name: "Point Cloud", category: "Transform", icon: "Grip", prompt: "The subject dissolves into a shimmering 3D point cloud of glowing dots, like a lidar scan" },
  { name: "Gas Transformation", category: "Transform", icon: "Cloudy", prompt: "The subject's body dissolves into a cloud of colored gas that swirls and drifts while keeping their silhouette" },
  // Nature
  { name: "Bloom Mouth", category: "Nature", icon: "Flower", prompt: "The subject opens their mouth and petals and blooming flowers spill out in place of their tongue" },
  { name: "Floral Eyes", category: "Nature", icon: "Flower2", prompt: "Vibrant flowers blossom out of the subject's eyes and spread across their face" },
  { name: "Garden Bloom", category: "Nature", icon: "Sprout", prompt: "Flowers and greenery sprout and bloom all over the subject's body until they are covered in a living garden" },
  { name: "Nature Bloom", category: "Nature", icon: "Leaf", prompt: "Plants, vines and flowers burst into bloom across the whole scene around the subject in a fast growth timelapse" },
  { name: "Sakura Petals", category: "Nature", icon: "Flower", prompt: "A gust of wind fills the air with pink cherry blossom petals swirling around the subject" },
  { name: "Floating Fish", category: "Nature", icon: "Fish", prompt: "Light blue fish swim in from outside the frame and drift gracefully around the subject as if through invisible water" },
  { name: "Glowing Fish", category: "Nature", icon: "Fish", prompt: "Bioluminescent fish glide around the subject, casting soft radiant light" },
  { name: "Jelly Drift", category: "Nature", icon: "Shell", prompt: "Translucent glowing jellyfish float into the frame and drift around the subject, who reaches out to touch them gently" },
  // Horror
  { name: "Black Tears", category: "Horror", icon: "Droplet", prompt: "Thick black liquid streams slowly from the subject's eyes down their cheeks" },
  { name: "Tentacles", category: "Horror", icon: "Waypoints", prompt: "Slimy tentacles emerge from the subject's eyes, twisting and writhing as if alive" },
  { name: "Skin Surge", category: "Horror", icon: "Hand", prompt: "Hands and strange organic shapes push out from under the subject's skin as if breaking through a living surface" },
  { name: "Spiders from Mouth", category: "Horror", icon: "Bug", prompt: "The subject opens their mouth and a swarm of spiders crawls out and over their face" },
  { name: "Horror Face", category: "Horror", icon: "Skull", prompt: "The subject's face suddenly contorts into a terrifying demonic grimace with hollow eyes as the lights flicker" },
  // Stylize
  { name: "Paint Splash", category: "Stylize", icon: "Paintbrush", prompt: "Bright paint splashes onto the subject from all sides in slow motion" },
  { name: "Datamosh", category: "Stylize", icon: "Binary", prompt: "Glitchy datamosh effect: pixels smear and bleed between frames" },
  { name: "Lens Flare", category: "Stylize", icon: "Sun", prompt: "A cinematic anamorphic lens flare sweeps across the frame" },
  { name: "Glitch", category: "Stylize", icon: "Tv", prompt: "Digital glitch distortion with RGB split and scanlines" },
  { name: "Dirty Lens", category: "Stylize", icon: "CircleDashed", prompt: "Smudges, dust and water drops on the lens catch the light as the camera drifts, raw and gritty" },
  { name: "Paparazzi", category: "Stylize", icon: "Camera", prompt: "A barrage of camera flashes fires around the subject as unseen paparazzi crowd in, red-carpet chaos" },
  { name: "X-Ray", category: "Stylize", icon: "ScanLine", prompt: "An X-ray scan sweeps across the subject, revealing their glowing skeleton beneath translucent skin" },
  { name: "Pixelated Face", category: "Stylize", icon: "Grid2x2", prompt: "The subject's face becomes a blocky pixel mosaic that shifts and reshuffles as they move" },
  { name: "Censorship", category: "Stylize", icon: "EyeOff", prompt: "Black censor bars and blur boxes pop onto the subject comically as they move, tabloid TV style" },
  { name: "Glow Trace", category: "Stylize", icon: "PenLine", prompt: "Neon light trails trace the subject's outline and follow every movement in glowing streaks" },
  { name: "Visor X", category: "Stylize", icon: "Glasses", prompt: "A futuristic holographic visor materializes over the subject's eyes, projecting a sci-fi HUD around them" },
  // Playful
  { name: "Squish", category: "Playful", icon: "Hand", prompt: "Hands squish the subject like a soft, squishy toy" },
  { name: "Inflate", category: "Playful", icon: "Circle", prompt: "The subject inflates like a balloon and floats up" },
  { name: "Deflate", category: "Playful", icon: "CircleDashed", prompt: "The subject deflates like a balloon and shrinks" },
  { name: "Cakeify", category: "Playful", icon: "Cake", prompt: "A knife cuts into the subject revealing it is a cake inside" },
  { name: "Crush", category: "Playful", icon: "Hammer", prompt: "A hydraulic press crushes the subject flat" },
  { name: "Muscle Up", category: "Playful", icon: "Dumbbell", prompt: "The subject flexes as their muscles grow huge" },
  { name: "Push To Glass", category: "Playful", icon: "PanelTop", prompt: "The subject is pushed forward against an invisible glass pane, their face and hands squashing comically flat against it" },
  { name: "Super Fast Run", category: "Playful", icon: "Zap", prompt: "The subject takes off running at superhuman speed, leaving a blur of afterimages and a gust of wind behind" },
  { name: "Starship Troopers", category: "Playful", icon: "Rocket", prompt: "The subject suits up in sci-fi trooper armor and charges forward with a squad as dropships streak across the sky" },
  { name: "Wonderland", category: "Playful", icon: "Sparkles", prompt: "The world around the subject warps into a whimsical wonderland of giant mushrooms, floating teacups and swirling colors" },
  // Scale
  { name: "Earth Zoom Out", category: "Scale", icon: "Globe", prompt: "The camera zooms out from the subject all the way to space, revealing the planet" },
  { name: "Tiny Planet", category: "Scale", icon: "Globe2", prompt: "The scene curls into a tiny planet around the subject" },
  { name: "Giant", category: "Scale", icon: "Maximize", prompt: "The subject grows into a giant towering over the city" },
  { name: "Giant People", category: "Scale", icon: "Users", prompt: "Colossal people as tall as skyscrapers walk through the city behind the subject, who looks up in awe" },
  // Viral (the parity studio /viral)
  { name: "Aquarium", category: "Viral", icon: "Fish", prompt: "The room fills with water like a giant aquarium, colorful fish and bubbles swirling around the subject" },
  { name: "Atomic", category: "Viral", icon: "Atom", prompt: "A blinding flash on the horizon behind the subject blooms into a mushroom cloud as the shockwave blows their hair back" },
  { name: "Attack of Clones", category: "Viral", icon: "Users", prompt: "Dozens of identical clones of the subject march in from every side and surround them" },
  { name: "Beach Ride", category: "Viral", icon: "Palmtree", prompt: "The subject rides along a sunny beach at the water's edge, wind in their hair, waves sparkling, the camera tracking beside them" },
  { name: "Beast Appearance", category: "Viral", icon: "PawPrint", prompt: "A huge fantastical beast emerges from the shadows behind the subject and towers over them" },
  { name: "Boiling Point", category: "Viral", icon: "Thermometer", prompt: "The subject gets angrier and angrier, turning red as steam blasts from their ears like a boiling kettle" },
  { name: "Buddy", category: "Viral", icon: "Dog", prompt: "A friendly cute companion creature pops into the frame and snuggles up next to the subject, who laughs and hugs it" },
  { name: "Car Drive", category: "Viral", icon: "Car", prompt: "The subject drives a convertible along a scenic coastal road, hand on the wheel, hair blowing, filmed from the passenger side" },
  { name: "Clothes Rain", category: "Viral", icon: "Shirt", prompt: "Clothes rain down from the sky around the subject, shirts and jackets fluttering and piling up at their feet" },
  { name: "Color Rain", category: "Viral", icon: "CloudRain", prompt: "Rain of vivid paint colors pours over the subject, streaking their clothes and the scene in rainbow hues" },
  { name: "Cotton Cloud", category: "Viral", icon: "Cloud", prompt: "Soft fluffy cotton-candy clouds drift in and the subject sinks into them, floating in a pastel dreamscape" },
  { name: "Crying", category: "Viral", icon: "Frown", prompt: "The subject's lip trembles and they burst into dramatic tears, sobbing as tears stream down their cheeks" },
  { name: "Dream Date", category: "Viral", icon: "Heart", prompt: "A romantic date unfolds: candles, string lights and a sunset table appear around the subject as a date leans in smiling" },
  { name: "Drunk Master", category: "Viral", icon: "Wine", prompt: "The subject sways and staggers in a comically drunken kung-fu style, then snaps into a flawless martial-arts pose" },
  { name: "Explosion", category: "Viral", icon: "Bomb", prompt: "A huge explosion erupts behind the subject as they walk calmly away from it, eyes fixed straight ahead, action-movie style" },
  { name: "Fairies Around", category: "Viral", icon: "Sparkles", prompt: "Tiny glowing fairies flutter around the subject, leaving trails of sparkling dust" },
  { name: "Firework", category: "Viral", icon: "PartyPopper", prompt: "Colorful fireworks burst in the night sky behind the subject, lighting their face in flashes of color" },
  { name: "Flashback", category: "Viral", icon: "History", prompt: "The frame shifts into a hazy sepia flashback as younger memories of the subject flicker past, then returns to the present" },
  { name: "Giant Grab", category: "Viral", icon: "Hand", prompt: "A gigantic hand reaches down from the sky, grabs the subject and lifts them out of the frame" },
  { name: "Group Photo", category: "Viral", icon: "Users", prompt: "Friends rush into the frame around the subject and squeeze together for a cheerful group photo as a flash goes off" },
  { name: "Helicopter Escape", category: "Viral", icon: "Plane", prompt: "A helicopter swoops in overhead, a rope ladder drops and the subject grabs it and is lifted away in an action-movie escape" },
  { name: "Live Concert", category: "Viral", icon: "Music", prompt: "The subject performs on a huge concert stage with blazing lights, smoke and a massive crowd cheering" },
  { name: "Look, Boom!", category: "Viral", icon: "Bomb", prompt: "The subject points at something off-screen, everyone looks, and a comic boom explosion goes off right where they pointed" },
  { name: "Money Rain", category: "Viral", icon: "Banknote", prompt: "Banknotes rain down from above and swirl around the subject, who catches them and throws them in the air" },
  { name: "Monstrosity", category: "Viral", icon: "Skull", prompt: "The subject slowly mutates into a grotesque monster, limbs stretching and skin twisting" },
  { name: "Mystification", category: "Viral", icon: "Sparkles", prompt: "Mystical runes and glowing symbols appear in the air around the subject, swirling as an arcane fog rises" },
  { name: "Northern Lights", category: "Viral", icon: "Sparkles", prompt: "Shimmering green and purple aurora ripples across the night sky above the subject as the camera tilts up" },
  { name: "Oni Mask", category: "Viral", icon: "Drama", prompt: "A red Japanese oni demon mask materializes over the subject's face in a swirl of smoke as their eyes glow" },
  { name: "Outfit Switch", category: "Viral", icon: "Shirt", prompt: "The subject spins and their outfit instantly switches to a completely different look with a flash of light" },
  { name: "Pizza Fall", category: "Viral", icon: "Pizza", prompt: "Pizza slices rain down from the sky onto the subject, who tries to catch them in their mouth" },
  { name: "Plasma Explosion", category: "Viral", icon: "Zap", prompt: "A sphere of glowing blue plasma charges in the subject's hands and explodes outward in a crackling shockwave" },
  { name: "Pool Jump", category: "Viral", icon: "Waves", prompt: "The subject leaps backward into a sparkling swimming pool in slow motion, a big splash erupting" },
  { name: "Raven Transition", category: "Viral", icon: "Bird", prompt: "A flock of black ravens bursts from the subject's body and swirls around the frame, then reforms them" },
  { name: "Red Carpet", category: "Viral", icon: "Star", prompt: "The subject walks the red carpet at a premiere, posing for the cameras as flashes pop and fans cheer" },
  { name: "Seamless Transition", category: "Viral", icon: "ArrowRightLeft", prompt: "The camera pushes through a detail of the scene and seamlessly emerges into a new location with the subject in the same pose" },
  { name: "Shocked", category: "Viral", icon: "Frown", prompt: "The subject's jaw drops and their eyes go wide in exaggerated shock as the camera snap-zooms in" },
  { name: "Spirit Animal", category: "Viral", icon: "PawPrint", prompt: "A glowing translucent spirit animal materializes beside the subject and walks around them protectively" },
  { name: "Tattoo Animation", category: "Viral", icon: "PenTool", prompt: "Ink tattoos appear on the subject's skin and come alive, the drawings crawling and moving across their arms" },
  { name: "Train Rush", category: "Viral", icon: "TrainFront", prompt: "A high-speed train rushes past right behind the subject, wind whipping their hair and clothes, motion blur streaking" },
  { name: "Turning Monkey", category: "Viral", icon: "PawPrint", prompt: "The subject turns their head and, mid-turn, morphs into a monkey with the same outfit and expression" },
  // UGC (the parity studio /ugc)
  { name: "Ballet", category: "UGC", icon: "Music", prompt: "The subject performs graceful ballet turns and an arabesque in a bright studio, filmed on a phone" },
  { name: "Eating", category: "UGC", icon: "Utensils", prompt: "The subject takes a bite of their food and reacts with delight to the phone camera, casual creator vlog style" },
  { name: "Fix and Pose", category: "UGC", icon: "Camera", prompt: "The subject fixes their hair and outfit in front of the phone camera, then snaps into a confident pose" },
  { name: "Hair Style", category: "UGC", icon: "Scissors", prompt: "The subject flips and runs their fingers through their hair, showing off a fresh hairstyle to the phone camera" },
  { name: "Handheld Run", category: "UGC", icon: "Footprints", prompt: "Shaky phone footage running alongside the subject as they jog and laugh, authentic and energetic" },
  { name: "Happy", category: "UGC", icon: "Smile", prompt: "The subject breaks into a big genuine smile and laughs toward the phone camera" },
  { name: "Happy Mode", category: "UGC", icon: "Laugh", prompt: "The subject bounces with joy, dancing a little and cheering at the phone camera" },
  { name: "Angry Mode", category: "UGC", icon: "Angry", prompt: "The subject frowns, crosses their arms and rants angrily at the phone camera with exaggerated gestures" },
  { name: "Morning Routine", category: "UGC", icon: "Sunrise", prompt: "Morning routine vlog: the subject stretches by a sunny window, sips coffee and smiles at the phone camera" },
  { name: "Motor Ride", category: "UGC", icon: "Bike", prompt: "The subject rides a motorbike down an open road, filmed on a phone from the back seat, wind rushing" },
  { name: "Outfit Check", category: "UGC", icon: "Shirt", prompt: "The subject shows off their outfit to a mirror phone camera, turning from side to side and posing" },
  { name: "Peak Moment", category: "UGC", icon: "Mountain", prompt: "The subject reaches a mountain summit and throws their arms up in triumph as the phone camera pans to the view" },
  { name: "Plate Check", category: "UGC", icon: "UtensilsCrossed", prompt: "The phone camera tilts down to show off a beautiful plate of food, then back up to the subject's excited face" },
  { name: "Saint Glow", category: "UGC", icon: "Sun", prompt: "A soft heavenly halo of golden light glows behind the subject's head as warm light rays fill the frame" },
  { name: "Sand Cut", category: "UGC", icon: "Hourglass", prompt: "A sweep of sand blows across the lens and wipes to the subject in a new pose on a sunny beach" },
  { name: "Selfie", category: "UGC", icon: "Smartphone", prompt: "Front-facing selfie video: the subject holds the phone at arm's length, chatting and smiling naturally" },
  { name: "Selfie Outfit", category: "UGC", icon: "Smartphone", prompt: "Selfie video where the subject tilts the phone down to show off their outfit, then back up to their face" },
  { name: "Selfie Posing", category: "UGC", icon: "Smartphone", prompt: "The subject strikes a series of quick playful poses in a selfie video, changing angles each beat" },
  { name: "Static Posing", category: "UGC", icon: "PersonStanding", prompt: "The phone stays on a tripod as the subject cycles through several stylish poses, natural and confident" },
  { name: "Sunglasses", category: "UGC", icon: "Glasses", prompt: "The subject slides on a pair of sunglasses with a cool smirk at the phone camera" },
  { name: "Yacht", category: "UGC", icon: "Sailboat", prompt: "The subject relaxes on the deck of a luxury yacht cruising turquoise water, phone camera panning across the view" },
  // Commercial
  { name: "Balloon", category: "Commercial", icon: "Circle", prompt: "Colorful balloons lift the product or subject gently into the air against a clean studio backdrop" },
  { name: "Exploded View", category: "Commercial", icon: "Boxes", prompt: "The product separates into its individual components which float apart in a clean exploded view, then reassemble" },
  // Transitions (start & end frame)
  { name: "Column Wipe", category: "Transitions", icon: "Columns3", endFrame: true, prompt: "Vertical columns flip one after another across the frame, wiping from the start frame to the end frame" },
  { name: "Display Transition", category: "Transitions", icon: "Monitor", endFrame: true, prompt: "The camera pushes into a screen in the start frame, and the display content becomes the end frame as it fills the view" },
  { name: "Flame Transition", category: "Transitions", icon: "Flame", endFrame: true, prompt: "Flames sweep across the frame and burn away the start frame, revealing the end frame beneath" },
  { name: "Hand Transition", category: "Transitions", icon: "Hand", endFrame: true, prompt: "A hand swipes across the lens, covering the start frame, and pulls away to reveal the end frame" },
  { name: "Hole Transition", category: "Transitions", icon: "CircleDot", endFrame: true, prompt: "A hole opens in the middle of the start frame and the camera dives through it into the end frame" },
  { name: "Jump Transition", category: "Transitions", icon: "ArrowUp", endFrame: true, prompt: "The subject jumps toward the camera and lands in the end frame's location, matched on the action" },
  { name: "Melt Transition", category: "Transitions", icon: "Droplet", endFrame: true, prompt: "The start frame melts and drips away like liquid, revealing the end frame underneath" },
  { name: "Smoke Transition", category: "Transitions", icon: "CloudFog", endFrame: true, prompt: "Thick smoke billows across the frame, swallowing the start frame, and clears on the end frame" },
  { name: "Splash Transition", category: "Transitions", icon: "Droplets", endFrame: true, prompt: "A splash of water bursts across the lens, washing the start frame away and settling on the end frame" },
  { name: "Trucksition", category: "Transitions", icon: "Truck", endFrame: true, prompt: "A truck drives across the foreground, blocking the view, and when it passes the scene has become the end frame" },
  // Blockbuster (Visual Effects / Effects 2.0)
  { name: "Studio Slide", category: "Blockbuster", icon: "MoveHorizontal", prompt: "The subject slides sideways across a seamless studio floor in one smooth motion as the camera glides with them, then strikes a pose" },
  { name: "Wild Ride", category: "Blockbuster", icon: "Gauge", prompt: "The subject clings on as whatever they are standing on launches into a wild high-speed ride, the world blurring past" },
  { name: "Smash and Grab", category: "Blockbuster", icon: "Hammer", prompt: "Glass shatters in slow motion as the subject smashes through a window, grabs a glowing prize and runs" },
  { name: "High Flip", category: "Blockbuster", icon: "RotateCcw", prompt: "The subject launches into a huge backflip high into the air, slow motion at the peak, then lands perfectly" },
  { name: "Street Colossus", category: "Blockbuster", icon: "Building2", prompt: "The subject rises to colossal size in the middle of the street, stepping over cars as people scatter below" },
  { name: "Cutout", category: "Blockbuster", icon: "Scissors", prompt: "The subject peels out of the scene as a flat paper cutout and flutters through the frame before landing back in place" },
  { name: "Selfception", category: "Blockbuster", icon: "Copy", prompt: "The camera pushes into the subject's phone screen to find the same scene inside, again and again, an infinite recursive loop" },
  { name: "Act Natural", category: "Blockbuster", icon: "Smile", prompt: "Chaos erupts around the subject — things fly and explode — while they stand perfectly still and act completely natural" },
  { name: "World Morphing", category: "Blockbuster", icon: "Globe", prompt: "The environment around the subject morphs fluidly through several different worlds while they stay in place" },
  { name: "Lacewalker", category: "Blockbuster", icon: "Spline", prompt: "Delicate white lace patterns grow across the subject's body and clothing as they walk forward gracefully" },
  { name: "Burning Man", category: "Blockbuster", icon: "Flame", prompt: "The subject walks calmly toward the camera while fully engulfed in flames, a stunt-performer fire burn" },
  { name: "Boarding Pass", category: "Blockbuster", icon: "Ticket", prompt: "A giant boarding pass flies into frame, the subject steps through it and lands in a sunny travel destination" },
  { name: "Monster Dab", category: "Blockbuster", icon: "PawPrint", prompt: "A huge friendly monster appears behind the subject and they both hit a dab at the same time" },
  { name: "Floating Fall", category: "Blockbuster", icon: "Feather", prompt: "The subject tips backward and falls slowly, floating weightlessly through the air as if gravity has softened" },
  { name: "Lidar Transition", category: "Blockbuster", icon: "Radar", prompt: "A lidar scanning wave sweeps across the scene, turning it into a glowing point-cloud scan that rebuilds as a new reality" },
  { name: "Architecture Wave", category: "Blockbuster", icon: "Building", prompt: "The buildings behind the subject ripple and fold like a wave, the city bending in a mind-bending Inception-style move" },
  { name: "Clones", category: "Blockbuster", icon: "Copy", prompt: "Several clones of the subject step out from their body, each doing a different action in the same scene" },
  { name: "Infinite Clones", category: "Blockbuster", icon: "Infinity", prompt: "The camera pulls back to reveal endless rows of identical clones of the subject stretching to the horizon" },
  { name: "Scrapbook Collage", category: "Blockbuster", icon: "Images", prompt: "The scene breaks into a handmade scrapbook collage of cutout photos, tape and doodles that animates around the subject" },
  { name: "Stop World", category: "Blockbuster", icon: "Pause", prompt: "The subject snaps their fingers and the whole world freezes — people, birds and water hang in mid-air — while they walk through it" },
  { name: "Agamemnon", category: "Blockbuster", icon: "Swords", prompt: "The subject becomes an ancient Greek warrior king in bronze armor and red cape, raising a sword before a vast army on an epic battlefield" },
  { name: "Fallen Angel", category: "Blockbuster", icon: "Feather", prompt: "Dark ragged wings burst from the subject's back as they fall from the sky and land in a crouch amid scattering black feathers" },
  { name: "Cyclope", category: "Blockbuster", icon: "Eye", prompt: "The subject's two eyes merge into a single large cyclops eye in the middle of their face, which blinks at the camera" },
  { name: "Frozen in Motion", category: "Blockbuster", icon: "Pause", prompt: "Mid-action the subject freezes, droplets and debris suspended around them, as the camera drifts slowly through the frozen moment" },
  { name: "Vanish", category: "Blockbuster", icon: "EyeOff", prompt: "With a flick of the wrist, the subject vanishes in a puff of glittering smoke, leaving the scene empty" },
  { name: "Mighty Fighter", category: "Blockbuster", icon: "Swords", prompt: "The subject unleashes a flurry of martial-arts strikes with anime-style impact bursts and speed lines" },
  { name: "Pigeons", category: "Blockbuster", icon: "Bird", prompt: "A huge flock of pigeons bursts up around the subject and swirls through the frame in slow motion" },
  { name: "Fairytale Castle", category: "Blockbuster", icon: "Castle", prompt: "A magical fairytale castle rises in the distance behind the subject as sparkles swirl and fireworks burst above it" },
  { name: "Superstar", category: "Blockbuster", icon: "Star", prompt: "Stage lights snap on and the subject is revealed as a superstar on a glittering stage, confetti falling and crowd roaring" },
  { name: "Pearl Earring", category: "Blockbuster", icon: "Gem", prompt: "The subject becomes a living Dutch Golden Age painting in a blue and gold head wrap with a pearl earring, glancing over their shoulder" },
  { name: "Skatedog", category: "Blockbuster", icon: "Dog", prompt: "A dog on a skateboard rolls into the frame beside the subject and they cruise down the street together" },
  { name: "Blue Depth", category: "Blockbuster", icon: "Waves", prompt: "The scene sinks into the deep blue ocean, light rays shimmering down as the subject floats weightlessly underwater" },
  { name: "Moonwalk", category: "Blockbuster", icon: "Moon", prompt: "The subject performs a flawless moonwalk, gliding backward smoothly under a single spotlight" },
  { name: "Dolphin Ride", category: "Blockbuster", icon: "Fish", prompt: "The subject rides on the back of a leaping dolphin across sparkling ocean waves" },
  { name: "Monet Muse", category: "Blockbuster", icon: "Palette", prompt: "The scene dissolves into a living impressionist Monet painting with soft dabs of light and water lilies, the subject gently moving within it" },
  // Mixed Media (video restyles)
  { name: "Neon Melt", was: "Acid", category: "Mixed Media", icon: "FlaskConical", parity: RESTYLE, description: "Neon colours bleed and warp around the subject", prompt: "Acid-trip restyle: neon colors bleed and warp, outlines vibrate and the image pulses with psychedelic distortion" },
  { name: "Acrylic", was: "Akrill", category: "Mixed Media", icon: "Brush", parity: RESTYLE, description: "Thick acrylic brushwork ripples across the scene", prompt: "Thick acrylic paint restyle: bold impasto brushstrokes ripple across the moving scene" },
  { name: "Broken Mirror", category: "Mixed Media", icon: "Shapes", parity: RESTYLE, prompt: "The image fractures into shards of a broken mirror, each piece reflecting the subject from a slightly different angle as they move" },
  { name: "Bubbles", category: "Mixed Media", icon: "Circle", parity: RESTYLE, prompt: "Iridescent soap bubbles float through the frame, each one reflecting and refracting the subject" },
  { name: "Smoke Haze", was: "Cannabis", category: "Mixed Media", icon: "Leaf", parity: RESTYLE, description: "A soft green haze and drifting smoke around the subject", prompt: "Hazy green-tinted restyle with drifting leaf silhouettes and soft smoky glow around the subject" },
  { name: "Canvas", category: "Mixed Media", icon: "Frame", parity: RESTYLE, prompt: "The moving scene is painted onto textured canvas, brushstrokes and canvas weave visible as the subject moves" },
  { name: "Cold Vision", category: "Mixed Media", icon: "Thermometer", parity: RESTYLE, prompt: "Thermal camera restyle: the subject glows in false-color heat signature against a cold blue background" },
  { name: "Comic", category: "Mixed Media", icon: "Zap", parity: RESTYLE, prompt: "Comic book restyle: bold ink outlines, halftone dots and flat colors, with action lines as the subject moves" },
  { name: "Flash Comic", category: "Mixed Media", icon: "Zap", parity: RESTYLE, prompt: "Rapid comic panels flash in sync with the motion, the subject popping between inked halftone frames" },
  { name: "Fragments", category: "Mixed Media", icon: "Shapes", parity: RESTYLE, prompt: "The image breaks into floating geometric fragments that drift and reassemble around the moving subject" },
  { name: "Hand Paint", category: "Mixed Media", icon: "Paintbrush", parity: RESTYLE, prompt: "Hand-painted animation restyle: every frame looks freshly painted with loose, wobbling brushstrokes" },
  { name: "Kaleido", was: "LSD", category: "Mixed Media", icon: "Rainbow", parity: RESTYLE, description: "Colours cycle through the rainbow and trail every move", prompt: "Kaleidoscopic psychedelic restyle: colors cycle through rainbow hues, patterns breathe and trails follow every movement" },
  { name: "Lava", category: "Mixed Media", icon: "Flame", parity: RESTYLE, prompt: "Molten lava restyle: the scene glows orange and black, the subject's outline flowing like magma" },
  { name: "Layer Mixed Media", category: "Mixed Media", icon: "Layers", parity: RESTYLE, prompt: "Layered mixed-media collage: paper textures, paint strokes, sketch lines and photo cutouts stack and shift over the moving subject" },
  { name: "Magazine", category: "Mixed Media", icon: "BookOpen", parity: RESTYLE, prompt: "Glossy magazine restyle: the frame becomes a printed editorial spread with halftone print texture and typography blocks around the subject" },
  { name: "Marble", category: "Mixed Media", icon: "Landmark", parity: RESTYLE, prompt: "Marble restyle: the subject and scene appear carved from veined white marble that moves like a living sculpture" },
  { name: "Modern", category: "Mixed Media", icon: "Shapes", parity: RESTYLE, prompt: "Modern-art restyle: flat bold color fields and clean geometric shapes reinterpret the scene as it moves" },
  { name: "Multiverse", category: "Mixed Media", icon: "Layers", parity: RESTYLE, prompt: "The frame splits into versions of the subject from parallel universes in different art styles, all moving in sync" },
  { name: "Noir", category: "Mixed Media", icon: "Moon", parity: RESTYLE, prompt: "Film noir restyle: high-contrast black and white, venetian-blind shadows and smoky atmosphere" },
  { name: "Ocean", category: "Mixed Media", icon: "Waves", parity: RESTYLE, prompt: "Ocean restyle: caustic underwater light ripples over the scene in deep blue tones as bubbles rise" },
  { name: "Origami", category: "Mixed Media", icon: "Shapes", parity: RESTYLE, prompt: "Origami restyle: the subject and scene are made of folded paper, creases flexing as they move" },
  { name: "Overexposed", category: "Mixed Media", icon: "SunDim", parity: RESTYLE, prompt: "Overexposed dreamy restyle: blown-out highlights, bloom and washed pastel tones around the moving subject" },
  { name: "Palette", category: "Mixed Media", icon: "Palette", parity: RESTYLE, prompt: "The scene is repainted live in a restricted bold color palette, flat posterized color blocks shifting with the motion" },
  { name: "Paper", category: "Mixed Media", icon: "FileText", parity: RESTYLE, prompt: "Paper cut-out stop-motion restyle: layered construction-paper shapes with visible texture and shadows" },
  { name: "Particles", category: "Mixed Media", icon: "Sparkles", parity: RESTYLE, prompt: "The subject is rendered as streams of glowing particles that scatter and reform with every movement" },
  { name: "Random Glow", category: "Mixed Media", icon: "Lightbulb", parity: RESTYLE, prompt: "Random patches of colored glow flicker and bloom across the scene and the subject in rhythm" },
  { name: "Sketch", category: "Mixed Media", icon: "Pencil", parity: RESTYLE, prompt: "Pencil sketch restyle: the moving scene is drawn in graphite lines on white paper, lines redrawn every frame" },
  { name: "Neon Slime", was: "Toxic", category: "Mixed Media", icon: "Biohazard", parity: RESTYLE, description: "Neon-green glow, glossy slime and drifting fumes", prompt: "Toxic restyle: sickly neon-green glow, dripping slime textures and hazy fumes around the subject" },
  { name: "Tracking", category: "Mixed Media", icon: "Crosshair", parity: RESTYLE, prompt: "Motion-tracking HUD restyle: tracking boxes, crosshairs and data labels lock onto the subject and follow every move" },
  { name: "Two Color", category: "Mixed Media", icon: "Contrast", parity: RESTYLE, prompt: "Duotone restyle: the scene is reduced to two bold ink colors like a screen print" },
  { name: "Ultraviolet", category: "Mixed Media", icon: "Lightbulb", parity: RESTYLE, prompt: "Ultraviolet blacklight restyle: deep purple darkness with fluorescent highlights glowing on the subject" },
  { name: "Vintage", category: "Mixed Media", icon: "Film", parity: RESTYLE, prompt: "Vintage film restyle: faded warm colors, gate weave, dust, scratches and light flicker of old 8mm footage" },
  { name: "Windows", category: "Mixed Media", icon: "AppWindow", parity: RESTYLE, prompt: "Retro desktop restyle: the moving scene plays inside stacked old computer windows that pop open and drag around the screen" },
  // Relight (lighting presets)
  { name: "Silhouette", category: "Relight", icon: "User", parity: RESTYLE, prompt: "Strong backlight behind the subject turns them into a dark silhouette with a glowing rim, while they move slowly" },
  { name: "Practicals", category: "Relight", icon: "Lamp", parity: RESTYLE, prompt: "The scene is lit only by practical lamps in the frame, warm pools of light and moody falloff on the subject" },
  { name: "Window", category: "Relight", icon: "AppWindow", parity: RESTYLE, prompt: "Soft natural light streams through a window onto the subject, gentle shadows of the window frame across the scene" },
  { name: "Overhead Fall", category: "Relight", icon: "ArrowDownToLine", parity: RESTYLE, prompt: "A single hard overhead light falls on the subject from above, deep shadows under the eyes, dramatic and theatrical" },
  { name: "Contre-jour", category: "Relight", icon: "Sunset", parity: RESTYLE, prompt: "Contre-jour lighting: the sun sits directly behind the subject, flaring into the lens with glowing hair light" },
  { name: "Soft Cross", category: "Relight", icon: "Lightbulb", parity: RESTYLE, prompt: "Two soft cross lights from opposite sides model the subject's face evenly with gentle, flattering shadows" },
  // Color grades
  { name: "Film Colors", category: "Color Grade", icon: "Film", parity: RESTYLE, prompt: "Graded like 35mm motion-picture film: soft contrast, warm highlights, rich color and fine grain" },
  { name: "Black Gloss", category: "Color Grade", icon: "Moon", parity: RESTYLE, prompt: "Glossy black grade: deep inky blacks, crisp specular highlights and a sleek luxury look" },
  { name: "Candy Pink", category: "Color Grade", icon: "Candy", parity: RESTYLE, prompt: "Candy-pink grade: soft pastel pinks wash through the highlights and shadows, playful and sweet" },
  { name: "Lime Jam", category: "Color Grade", icon: "Citrus", parity: RESTYLE, prompt: "Lime grade: zesty acid-green tint through the mids with punchy contrast" },
  { name: "Nostalgic Blue", category: "Color Grade", icon: "Droplets", parity: RESTYLE, prompt: "Nostalgic blue grade: faded cyan-blue tones, lifted blacks and soft film haze" },
  { name: "Soft Palette", category: "Color Grade", icon: "Palette", parity: RESTYLE, prompt: "Soft palette grade: muted, gentle low-contrast pastels with creamy skin tones" },
  { name: "Overtime", category: "Color Grade", icon: "Clock", parity: RESTYLE, description: "Late-night office light: a fluorescent green cast and muted tones", prompt: "Late-night office grade: greenish fluorescent cast, desaturated tones and tired contrast" },
  { name: "Crimson Vigil", category: "Color Grade", icon: "Moon", parity: RESTYLE, prompt: "Crimson grade: deep reds bleed into the shadows, ominous and intense" },
  { name: "Bleach Bypass", category: "Color Grade", icon: "Contrast", parity: RESTYLE, prompt: "Bleach bypass grade: desaturated colors, harsh contrast and silvery highlights" },
  { name: "Bleached Warm", category: "Color Grade", icon: "Sun", parity: RESTYLE, prompt: "Bleached warm grade: sun-washed, slightly desaturated golden tones like a hot afternoon" },
  { name: "Classic BW", category: "Color Grade", icon: "Contrast", parity: RESTYLE, prompt: "Classic black and white grade with rich midtones, deep blacks and fine grain" },
  { name: "Cold Steel", category: "Color Grade", icon: "Snowflake", parity: RESTYLE, prompt: "Cold steel grade: steel-blue shadows, icy highlights and clinical contrast" },
  { name: "Hyper Neon", category: "Color Grade", icon: "Zap", parity: RESTYLE, prompt: "Hyper neon grade: saturated magenta and cyan glow with deep night shadows" },
  { name: "Naturalistic Clean", category: "Color Grade", icon: "Leaf", parity: RESTYLE, prompt: "Naturalistic clean grade: true-to-life colors, balanced contrast and accurate skin tones" },
  { name: "Sodium Decay", category: "Color Grade", icon: "Lamp", parity: RESTYLE, prompt: "Sodium-vapor grade: orange streetlight cast, murky greens and gritty urban decay" },
  { name: "Teal Orange Epic", category: "Color Grade", icon: "Clapperboard", parity: RESTYLE, prompt: "Teal and orange blockbuster grade: warm skin tones against cool teal shadows, epic and cinematic" },
];

export const MOTIONS: Preset[] = build("motion", MOTION_SPECS, 250);
export const EFFECTS: Preset[] = build("effect", EFFECT_SPECS, 20);
