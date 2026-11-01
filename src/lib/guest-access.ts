/**
 * What guests (signed-out visitors) and accounts (people who signed up) may do while public sign-up
 * is on (src/server/auth.ts publicSignup). Path rules only: src/proxy.ts applies them.
 *
 * - A guest opens every page and the catalog and status reads the pages need. The owner's library
 *   comes back empty (or 401 "Sign up to see your library"), and every change is a 401 that the
 *   client turns into "Create a free account" (src/components/guest-prompt.tsx).
 * - An account sees what a guest sees of the owner's studio: the owner's library and projects stay
 *   hidden (empty lists, 403) and can't be changed (403, LIBRARY_CHANGES). It never runs on the
 *   owner's cloud keys or GPU ("Connect your GPU"), and never changes install-wide settings, keys or
 *   tokens (owner only).
 */

/** Set by the proxy on a guest's request to a route that answers guests itself (GUEST_FILTERED), and on its 401s. */
export const GUEST_HEADER = "x-fuobe-guest";

/** A guest's request, as the proxy marks it for GUEST_FILTERED routes (a client that sends the header itself only gets less). */
export const isGuest = (request: Request) => request.headers.get(GUEST_HEADER) === "1";

export const GUEST_LIBRARY_MESSAGE = "Sign up to see your library.";
export const GUEST_RUN_MESSAGE = "Create a free account to run this.";

/** Catalog and status reads that hold nothing of the owner's library: a guest gets the real answer. */
const GUEST_READS = new Set(["/api/status", "/api/models", "/api/search-index", "/api/comfyui", "/api/settings/models", "/api/gpu/requirements", "/api/live/nodes"]);

/** Catalogs mixed with the owner's own items: the route leaves the owner's part out for a guest (GUEST_HEADER). */
const GUEST_FILTERED = new Set(["/api/moodboards", "/api/palettes", "/api/assist", "/api/assist/skills"]);

/** One skill, its recipe and its download: the route answers a guest for a built-in skill only (404 for the owner's own). */
const GUEST_SKILL = /^\/api\/assist\/skills\/[^/]+(\/recipe|\/download)?$/;

/** The owner's lists ({ items }): a guest gets them empty. */
const EMPTY_LISTS = [
  "/api/generations",
  "/api/generations/trash",
  "/api/assets",
  "/api/folders",
  "/api/elements",
  "/api/canvases",
  "/api/cinema/projects",
  "/api/layers",
  "/api/content-factory/series",
  "/api/dub",
  "/api/explainer",
  "/api/faceless/channels",
  "/api/faceless/episodes",
  "/api/katana",
  "/api/marketing/runs",
  "/api/products",
  "/api/brands",
  "/api/shorts/sessions",
  "/api/shorts/presets",
  "/api/swap-studio/projects",
  "/api/ads/creatives",
  "/api/assist/projects",
  "/api/assist/schedules",
  "/api/assist/memory",
];

/** The Library's counts with nothing in it (a guest's). */
export const NO_FACETS = { models: [], kinds: {}, total: 0, favorites: 0, failed: 0, trash: 0, pinned: 0, steps: 0, reviews: {} };

const EMPTY: Record<string, unknown> = {
  ...Object.fromEntries(EMPTY_LISTS.map((p) => [p, { items: [] }])),
  "/api/shares": { items: [], signIn: true },
  "/api/photodump": { packs: [] },
  "/api/photodump/packs": { packs: [] },
  "/api/generations/facets": NO_FACETS,
  // GPU pre-flight: a guest has no GPU (Connect your GPU), so no board and no chips.
  "/api/gpu/readiness": { connected: false, reason: "guest" },
  "/api/gpu/badges": { connected: false, models: {}, presets: {} },
};

export type GuestRead =
  /** A page, or a catalog read: let it through. */
  | { kind: "pass" }
  /** Let it through with GUEST_HEADER: the route answers without the owner's items. */
  | { kind: "filtered" }
  /** Answer this body (the owner's list, empty). */
  | { kind: "empty"; body: unknown }
  /** No such endpoint for a guest (204, no content: the live-updates stream, so the client looks again much later). */
  | { kind: "none" }
  /** The owner's data: 401. */
  | { kind: "closed" };

/** What a guest's GET or HEAD gets. Anything not named here under /api stays closed. */
export function guestRead(pathname: string): GuestRead {
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return { kind: "pass" };
  if (GUEST_READS.has(pathname)) return { kind: "pass" };
  if (GUEST_FILTERED.has(pathname) || GUEST_SKILL.test(pathname)) return { kind: "filtered" };
  if (Object.hasOwn(EMPTY, pathname)) return { kind: "empty", body: EMPTY[pathname] };
  if (pathname === "/api/generations/stream") return { kind: "none" };
  return { kind: "closed" };
}

/**
 * The run routes whose `?preview=1` only plans and prices (any other route would ignore the flag and run). AI
 * Influencer, Fashion Factory and Character Sheet price on load, with synchronous price functions.
 */
const PREVIEWS = [/^\/api\/(generations|audio-tools|dub|katana|turnaround|influencer|photodump|photodump\/fashion|photodump\/character)$/, /^\/api\/dub\/[^/]+\/voice$/];

/** The estimate routes (named: a dynamic segment called "estimate" on another route must not pass for one). */
const ESTIMATES =
  /^\/api\/(ads|ads\/multiplier|assist\/skills\/[^/]+|content-factory|evolution|faceless|genjutsu|influencer|marketing|marketing\/click-to-ad|mixed-media|remove-object|shorts|storyboards|turnaround)\/estimate$/;

/** A POST that only plans and prices a run (an estimate route, or ?preview=1 where PREVIEWS honours it): free, and open to guests. */
export function isPriceCheck(method: string, pathname: string, search: string): boolean {
  if (method !== "POST") return false;
  if (ESTIMATES.test(pathname)) return true;
  return new URLSearchParams(search).get("preview") === "1" && PREVIEWS.some((r) => r.test(pathname));
}

/**
 * Changes to the studio's library and projects (create, rename, move, share, delete, upload). The
 * library is the owner's, and accounts don't have one of their own yet, so an account is refused
 * them with LIBRARY_MESSAGE. Everything else an account sends (a run, an AI helper, a connector,
 * the MCP endpoint…) is refused with "Connect your GPU": it never spends the owner's keys or GPU.
 */
const LIBRARY_CHANGES: [methods: string, path: RegExp][] = [
  // Split soundtrack's Export mix: a WAV saved, in parts, as an asset of the owner's Library (no account's upload).
  ["POST", /^\/api\/audio-tools\/export$/],
  ["POST", /^\/api\/folders$/],
  ["PATCH DELETE", /^\/api\/folders\/[^/]+$/],
  ["PATCH DELETE", /^\/api\/generations\/[^/]+$/],
  // (POST /api/generations/bulk goes to the route, which takes an account's likes, pins and reviews of its own runs only.)
  ["POST", /^\/api\/generations\/local$/],
  ["POST", /^\/api\/generations\/[^/]+\/(cancel|finish)$/],
  ["DELETE", /^\/api\/generations\/trash$/],
  ["DELETE", /^\/api\/assets\/[^/]+$/],
  ["POST", /^\/api\/shares$/],
  ["PATCH DELETE", /^\/api\/shares\/[^/]+$/],
  ["POST", /^\/api\/(canvases|cinema\/projects|layers|elements|palettes|products|brands|swap-studio\/projects|shorts\/presets|photodump\/packs|assist\/projects|assist\/memory)$/],
  [
    "PATCH DELETE",
    /^\/api\/(canvases|cinema\/projects|layers|elements|palettes|products|brands|moodboards|swap-studio\/projects|content-factory\/series|faceless\/channels|faceless\/episodes|dub|shorts\/presets|shorts\/sessions|assist|assist\/projects|assist\/memory|assist\/schedules|assist\/skills|ads\/creatives)\/[^/]+$/,
  ],
  ["DELETE", /^\/api\/(katana|marketing\/runs|photodump\/packs)\/[^/]+$/],
  ["POST", /^\/api\/canvases\/[^/]+\/duplicate$/],
  ["POST", /^\/api\/assist\/skills\/[^/]+\/duplicate$/],
  ["POST", /^\/api\/ads\/creatives\/[^/]+\/save$/],
  ["POST", /^\/api\/cinema\/projects\/[^/]+\/folders$/],
  ["PATCH DELETE", /^\/api\/cinema\/projects\/[^/]+\/(items|folders\/[^/]+)$/],
  ["PUT", /^\/api\/cinema\/projects\/[^/]+\/items\/[^/]+\/tiles$/],
  ["POST", /^\/api\/layers\/[^/]+\/versions$/],
  ["PATCH DELETE", /^\/api\/layers\/[^/]+\/jobs\/[^/]+$/],
  ["DELETE", /^\/api\/assist\/projects\/[^/]+\/sources\/[^/]+$/],
];

/** A generation's own path (/api/generations/<id>), not one of the collection's routes. */
const GENERATION = /^\/api\/generations\/(?!(?:facets|trash|stream|zip|bulk|local)$)([^/]+)$/;

/** The generation an account's request is about (its own runs: the proxy checks it made it), or undefined. */
export function accountGeneration(method: string, pathname: string): string | undefined {
  // Cancel, and Fuobe Soul's finished picture for its own result.
  const step = /^\/api\/generations\/([^/]+)\/(cancel|finish)$/.exec(pathname);
  if (method === "POST" && step) return step[1];
  const one = GENERATION.exec(pathname);
  // PATCH: a like, a pin or a review status (all the route changes).
  return one && (method === "GET" || method === "HEAD" || method === "PATCH" || method === "DELETE") ? one[1] : undefined;
}

/**
 * A read of an account's own things, which the route (or the proxy, by accountGeneration) scopes to it:
 * the list of its runs, a stored file (the proxy checks whose it is), its GPU, its keys (never a key: their last 4).
 */
export function accountOwnRead(pathname: string): boolean {
  if (ACCOUNT_LISTS.has(pathname)) return true;
  return pathname === "/api/generations" || pathname === "/api/account/gpu" || pathname === "/api/account/keys" || GPU_READS.has(pathname) || COMPUTER_READ.test(pathname) || PAIRING_READS.has(pathname);
}

/** The Library's counts and its Uploads (its stored files): each route answers an account with its own only. */
const ACCOUNT_LISTS = new Set(["/api/generations/facets", "/api/assets"]);

/**
 * "Use the ComfyUI on this computer": the routes the person's own Fuobe tab runs their jobs through. Each takes whose
 * jobs from the session, and only that person's (src/server/computer/http.ts principalOf).
 */
const COMPUTER_READ = /^\/api\/gpu\/computer\/tasks\/[^/]+\/(inputs|outputs)\/[^/]+$/;
/** Pairing a ComfyUI with Fuobe Connect: the code's computer, and the person's paired ComfyUIs (src/app/api/gpu/pair). */
const PAIRING_READS = new Set(["/api/gpu/pair", "/api/gpu/paired"]);
const COMPUTER_CHANGES: [method: string, path: RegExp][] = [
  ["POST", /^\/api\/gpu\/computer\/(beat|claim)$/],
  ["POST", /^\/api\/gpu\/computer\/tasks\/[^/]+\/(report|release)$/],
  ["PUT", /^\/api\/gpu\/computer\/tasks\/[^/]+\/outputs\/[^/]+$/],
];

/** GPU pre-flight reads: each answers for the account's own GPU only (src/server/gpu/target.ts). */
const GPU_READS = new Set(["/api/gpu/readiness", "/api/gpu/badges", "/api/gpu/plan"]);

/**
 * A change an account may send: signing out, its own GPU and its check, its own fal.ai and Replicate keys, price checks
 * (reads go by guestRead, as a guest's), an upload (the route checks it: src/app/api/uploads, which the proxy's matcher
 * leaves out) and a look at its own clip's header (the route reads only its own files).
 */
export function accountMayChange(method: string, pathname: string, search: string): boolean {
  if (method === "POST" && pathname === "/api/auth/logout") return true;
  if ((method === "PUT" || method === "DELETE") && pathname === "/api/account/gpu") return true;
  if ((method === "PUT" || method === "DELETE") && /^\/api\/account\/keys\/(fal|replicate)$/.test(pathname)) return true;
  // GPU pre-flight: checking its own ComfyUI (reads only; the routes check the target and the request themselves).
  if ((method === "POST" && pathname === "/api/gpu/check") || (method === "PUT" && pathname === "/api/gpu/inventory")) return true;
  // Running its own jobs on its own computer, and pairing (or unpairing) its own ComfyUI.
  if (COMPUTER_CHANGES.some(([m, p]) => m === method && p.test(pathname))) return true;
  if ((method === "POST" && pathname === "/api/gpu/pair") || (method === "DELETE" && /^\/api\/gpu\/paired\/[^/]+$/.test(pathname))) return true;
  if (method === "POST" && (pathname === "/api/uploads" || pathname === "/api/media/probe")) return true;
  // "Report this result", and a click on an offer the billing service sent (each route checks the rest).
  if (method === "POST" && (pathname === "/api/reports" || pathname === "/api/billing/interest")) return true;
  // Like, pin or review many of its own runs at once (the route checks each is its own, and refuses the rest).
  if (method === "POST" && pathname === "/api/generations/bulk") return true;
  return isPriceCheck(method, pathname, search);
}

/**
 * Live edit (src/app/api/live): the route a path names, or null. "nodes" is the node file's download (open to anyone);
 * every other route runs or stores live edits.
 */
export type LiveRoute = "session" | "inputs" | "render" | "cancel" | "events" | "masters" | "save" | "nodes";
const LIVE_ROUTE = /^\/api\/live\/(session|inputs|render|cancel|events|masters|save|nodes)$/;
export const liveRoute = (pathname: string): LiveRoute | null => (LIVE_ROUTE.exec(pathname)?.[1] as LiveRoute | undefined) ?? null;

/**
 * What an account gets on a live edit route, by its own GPU: it renders only there (a linked GPU through the server, or
 * its own computer from its tab), keeps its masters in its own files, and has no Library to save to. A guest gets
 * GUEST_RUN_MESSAGE on all of them but the node download.
 */
export function accountLive(route: LiveRoute, gpu: "link" | "computer" | null): "pass" | "connect-gpu" | "library" {
  if (route === "nodes") return "pass";
  if (route === "save") return "library";
  return gpu ? "pass" : "connect-gpu";
}

/** Assist (chats, skills, memory, projects, schedules): any change to it, which only the owner may make on a public studio. */
export function isAssistChange(method: string, pathname: string): boolean {
  return method !== "GET" && method !== "HEAD" && (pathname === "/api/assist" || pathname.startsWith("/api/assist/"));
}

/**
 * Assist plans with the install's own AI helpers and keeps the owner's chats, memory and projects, so an account gets
 * this one answer to any change there (code "assist-owner"; price checks still go through), with or without its own
 * GPU. A guest gets it too, not the 401 that offers to sign up: an account couldn't use Assist either. The Assist
 * pages say the same to both (src/components/assist/visitor-note.tsx).
 */
export const ASSIST_OWNER_MESSAGE = "Assist runs on the studio owner's AI, so only the owner can use it here. Fuobe is open source: run it yourself for your own chats, skills, memory and schedules.";

/** A change to the studio's library or projects (refused for an account with LIBRARY_MESSAGE, not "Connect your GPU"). */
export function isLibraryChange(method: string, pathname: string): boolean {
  return LIBRARY_CHANGES.some(([methods, path]) => methods.split(" ").includes(method) && path.test(pathname));
}

export const ACCOUNT_LIBRARY_MESSAGE = "This studio's library is its owner's. Free accounts can't open or change it.";
export const LIBRARY_MESSAGE = "Free accounts can't save to this studio's library yet.";

/**
 * Runs an account may start once it has connected its own ComfyUI ("Your GPU") or added its own fal.ai or Replicate key
 * ("Your keys"): the studios' generations, camera motions, effects and apps, which the route sends to that ComfyUI or
 * that key only, with only its own uploaded files (src/app/api/generations/route.ts, generations.ts accountRun). Other
 * tools plan with the install's AI helpers or its own ComfyUI, so they stay refused.
 */
/** A report anyone may send, signed in or not ("Report this result" on a shared link). */
export const anyoneMayReport = (method: string, pathname: string): boolean => method === "POST" && pathname === "/api/reports";

export function ownGpuRun(method: string, pathname: string): boolean {
  return method === "POST" && pathname === "/api/generations";
}

export const OWN_GPU_TOOL_MESSAGE = "This tool doesn't run on your own GPU yet. Camera motions, effects, apps and the Image, Video and Audio studios do.";

/** Set on an account's refused run: the client shows "Connect your GPU to run this". */
export const CONNECT_GPU_HEADER = "x-fuobe-connect-gpu";
/** Beside it on the owner's refused run (Demo mode off, nothing connected): what would run it, "gpu", "key" or "any". */
export const CONNECT_NEEDS_HEADER = "x-fuobe-connect-needs";
export const CONNECT_GPU_MESSAGE = "Connect your GPU to run this. Free accounts run on their own ComfyUI.";
/** An account's upload with neither a GPU nor a key of its own: its files are kept for runs on its own ComfyUI or key. */
export const CONNECT_GPU_UPLOAD_MESSAGE = "Connect your GPU, or add your own fal.ai or Replicate key, to add your own files.";
/** An account with neither its own GPU nor its own key (the proxy's answer to a run). */
export const CONNECT_GPU_OR_KEY_MESSAGE = "Connect your GPU, or add your own fal.ai or Replicate key, to run this.";

/** Install-wide settings, keys and tokens: changes are the owner's (403 for an account). */
const OWNER_WRITES = new Set(["/api/settings", "/api/settings/models", "/api/loras", "/api/llm", "/api/providers/test", "/api/auth/public"]);
/**
 * Owner only, reads included: the password, the API tokens, signing everyone out, the assistant's connectors, the MCP
 * endpoint and the accounts admin.
 */
const OWNER_ALL = [/^\/api\/auth\/(password|tokens|sessions)$/, /^\/api\/assist\/connectors(\/|$)/, /^\/api\/mcp$/, /^\/api\/admin(\/|$)/];

export function ownerOnly(method: string, pathname: string): boolean {
  if (OWNER_ALL.some((r) => r.test(pathname))) return true;
  return method !== "GET" && method !== "HEAD" && OWNER_WRITES.has(pathname);
}
