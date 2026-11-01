/**
 * The ComfyUI on the person's own computer, as the Fuobe tab reaches it: the only module that builds its URLs. Only
 * 127.0.0.1 (localhost and [::1] when the person typed them), never a network address (that would need another
 * permission and could reach a router), and only the paths a run needs. Pure, so the tab's script and the tests share
 * it. The tab sends no headers of its own (ComfyUI's cross-site setting lets only Content-Type and Authorization
 * through) and never sends cookies.
 */
import { INPUT_NAME, UUID, type HistoryEntryLike, type WantedFile } from "./relay";

/** Where to look, in order: Desktop's port after the usual one, then the ports people move to. */
export const COMFY_PORTS = [8188, 8000, 8189, 8190, 8288, 8001, 7821] as const;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class LocalComfyError extends Error {}

/** http://127.0.0.1:<port>, or the host the person typed when it is this computer. */
export function localBase(port: number, host = "127.0.0.1"): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new LocalComfyError("That isn't a port");
  if (!LOCAL_HOSTS.has(host)) throw new LocalComfyError("Only a ComfyUI on this computer");
  return `http://${host}:${port}`;
}

/** A port typed by the person ("8188", "localhost:8188", "http://127.0.0.1:8188/"): the port, or null. */
export function typedPort(input: string): { port: number; host: string } | null {
  const s = input.trim().replace(/\/+$/, "");
  if (/^\d{2,5}$/.test(s)) return Number(s) <= 65535 ? { port: Number(s), host: "127.0.0.1" } : null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `http://${s}`);
    const host = u.hostname === "::1" ? "[::1]" : u.hostname;
    if (u.protocol !== "http:" || !LOCAL_HOSTS.has(host) || u.pathname.replace(/\/+$/, "") !== "") return null;
    return { port: Number(u.port || 80), host };
  } catch {
    return null;
  }
}

const MODEL_FOLDER = /^[A-Za-z0-9_.-]{1,64}$/;
const NODE_CLASS = /^[A-Za-z0-9_ .+()|-]{1,128}$/;

/**
 * A path the tab may GET on the local ComfyUI, with its query: the facts (/system_stats), what it has (/object_info,
 * /models, /embeddings), the queue, one prompt's history (by its UUID) or the last passes, one job, a result file
 * (/view of output or temp) and the socket. Anything else throws.
 */
export function readPath(path: string): string {
  const [p, query = ""] = path.split("?");
  const q = new URLSearchParams(query);
  const noQuery = () => {
    if (query) throw new LocalComfyError(`No query on ${p}`);
    return path;
  };
  if (["/system_stats", "/api/system_stats", "/object_info", "/models", "/embeddings", "/queue", "/api/jobs", "/fuobe/guard", "/fuobe/live", "/fuobe/connect"].includes(p)) return noQuery();
  if (p.startsWith("/object_info/") && NODE_CLASS.test(decodeURIComponent(p.slice(13)))) return noQuery();
  if (p.startsWith("/models/") && MODEL_FOLDER.test(p.slice(8))) return noQuery();
  if (p.startsWith("/history/") && UUID.test(p.slice(9))) return noQuery();
  if (p === "/history" && [...q.keys()].join() === "max_items" && /^\d{1,3}$/.test(q.get("max_items")!)) return path;
  if (p.startsWith("/api/jobs/") && UUID.test(p.slice(10))) return noQuery();
  if (p === "/view") {
    const keys = [...q.keys()].sort().join();
    const type = q.get("type");
    const name = q.get("filename") ?? "";
    const sub = q.get("subfolder") ?? "";
    if (keys !== "filename,subfolder,type" || (type !== "output" && type !== "temp")) throw new LocalComfyError("Only results");
    if (!name || /[\\/]|^\.\.?$/.test(name) || sub.split(/[\\/]/).some((s) => s === "..")) throw new LocalComfyError("Only results");
    return path;
  }
  if (p === "/ws" && [...q.keys()].join() === "clientId" && /^[A-Za-z0-9_-]{8,64}$/.test(q.get("clientId")!)) return path;
  throw new LocalComfyError(`Fuobe doesn't read ${p} on your ComfyUI`);
}

/** The /view path of a wanted file. */
export const viewPath = (f: Pick<WantedFile, "filename" | "subfolder" | "type">) => `/view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type })}`;

/**
 * A POST the tab may send: an input under a name the server chose (or, for live edit, the tab named by its content),
 * the prompt, taking its own prompts off, and taking its own finished prompts out of the history.
 */
export function writePath(path: string, body: unknown, own: { promptIds: string[]; names?: string[] }): string {
  const ownId = (id: unknown) => typeof id === "string" && UUID.test(id) && own.promptIds.includes(id);
  if (path === "/upload/image") {
    const b = body as { name?: unknown; type?: unknown; overwrite?: unknown };
    if (typeof b?.name !== "string" || !INPUT_NAME.test(b.name) || !(own.names ?? []).includes(b.name) || b.type !== "input" || b.overwrite !== "true") {
      throw new LocalComfyError("Only the run's own inputs");
    }
    return path;
  }
  if (path === "/prompt") {
    const b = body as { prompt_id?: unknown; prompt?: unknown };
    if (!ownId(b?.prompt_id) || !b.prompt || typeof b.prompt !== "object") throw new LocalComfyError("Only the run's own prompt");
    return path;
  }
  if (path === "/queue") {
    const del = (body as { delete?: unknown })?.delete;
    if (!Array.isArray(del) || !del.length || !del.every(ownId) || Object.keys(body as object).length !== 1) throw new LocalComfyError("Only the run's own prompts");
    return path;
  }
  // Live edit takes its own finished prompts out of the history (hundreds of live renders would pile up there).
  if (path === "/history") {
    const del = (body as { delete?: unknown })?.delete;
    if (!Array.isArray(del) || !del.length || !del.every(ownId) || Object.keys(body as object).length !== 1) throw new LocalComfyError("Only the run's own prompts");
    return path;
  }
  if (path === "/interrupt") {
    if (!ownId((body as { prompt_id?: unknown })?.prompt_id)) throw new LocalComfyError("Only the run's own prompt");
    return path;
  }
  const cancel = /^\/api\/jobs\/([^/]+)\/cancel$/.exec(path);
  if (cancel && ownId(cancel[1])) return path;
  throw new LocalComfyError(`Fuobe doesn't send ${path} to your ComfyUI`);
}

/** Loader classes and the input that names a file in ComfyUI's input folder. */
const FILE_LOADERS: Record<string, string[]> = {
  LoadImage: ["image"],
  LoadImageMask: ["image"],
  LoadImageOutput: ["image"],
  // Live edit's loader (fuobe_live.py): one Fuobe-named picture in the input folder.
  LoadImageFuobeLive: ["image"],
  LoadVideo: ["file"],
  LoadAudio: ["audio"],
  VHS_LoadVideo: ["video"],
  VHS_LoadVideoPath: ["video"],
  VHS_LoadAudio: ["audio_file"],
  VHS_LoadAudioUpload: ["audio"],
  VHS_LoadImages: ["directory"],
  VHS_LoadImagesPath: ["directory"],
};

/**
 * The tab's own check of a graph before it goes to ComfyUI (in case the server were ever wrong or taken over): every
 * loader names one of the files this task uploads, or a value from another node. A graph that would read anything else
 * from the person's folders is refused. Returns the problem, or null.
 */
export function graphProblem(graph: Record<string, { class_type?: unknown; inputs?: Record<string, unknown> }>, staged: string[]): string | null {
  if (!graph || typeof graph !== "object") return "No graph";
  for (const [id, node] of Object.entries(graph)) {
    const cls = typeof node?.class_type === "string" ? node.class_type : "";
    const keys = FILE_LOADERS[cls] ?? (/^(Load|VHS_Load)/.test(cls) ? Object.keys(node?.inputs ?? {}).filter((k) => /image|video|audio|file|path|directory/i.test(k)) : []);
    for (const k of keys) {
      const v = node?.inputs?.[k];
      if (v === undefined || Array.isArray(v)) continue;
      if (typeof v !== "string" || !staged.includes(v.replace(/ \[input\]$/, ""))) return `Node ${id} (${cls}) reads ${typeof v === "string" ? `“${v.slice(0, 80)}”` : "a value"}, which this run didn't send`;
    }
  }
  return null;
}

type FileRef = { filename: string; subfolder?: string; type: string };
const isFileRef = (f: unknown): f is FileRef => !!f && typeof f === "object" && typeof (f as FileRef).filename === "string" && typeof (f as FileRef).type === "string";

/** Every file the entries list (a run's own history, and a meta-batch's passes). */
export function filesIn(entries: HistoryEntryLike[]): FileRef[] {
  const out: FileRef[] = [];
  for (const e of entries) for (const ui of Object.values(e?.outputs ?? {})) for (const v of Object.values(ui ?? {})) if (Array.isArray(v)) for (const f of v) if (isFileRef(f)) out.push(f);
  return out;
}

/** The tab downloads a file only when its own prompt's entries list it (so a server answer can't reach any other file). */
export function mayDownload(f: Pick<WantedFile, "filename" | "subfolder" | "type">, entries: HistoryEntryLike[]): boolean {
  return filesIn(entries).some((x) => x.filename === f.filename && (x.subfolder ?? "") === f.subfolder && x.type === f.type);
}

/** What a look on one port found. */
export type PortLook =
  | { port: number; host?: string; state: "found"; stats: SystemStats; guard?: boolean }
  | { port: number; host?: string; state: "unreadable" }
  | { port: number; host?: string; state: "none" };

export interface SystemStats {
  system?: { os?: string; comfyui_version?: string; ram_total?: number; embedded_python?: boolean; argv?: string[]; python_version?: string };
  devices?: { name?: string; type?: string; vram_total?: number }[];
}

/** A port's place among ComfyUI's usual ones (8188 first); one the person typed comes after them, lowest first. */
const portRank = (port: number) => {
  const at = (COMFY_PORTS as readonly number[]).indexOf(port);
  return at >= 0 ? at : COMFY_PORTS.length + port;
};

/**
 * The ComfyUI to use from several looks: one Fuobe can read before one it can't, the remembered port first, then the
 * usual order (8188 before Desktop's 8000: another app on 8000 doesn't win). "none" when nothing answered.
 */
export function pickLook(looks: PortLook[], remembered?: number): PortLook | { state: "none" } {
  const rank = (l: PortLook) => (l.state === "found" ? 0 : l.state === "unreadable" ? 1 : 2);
  const sorted = looks.filter((l) => l.state !== "none").sort((a, b) => rank(a) - rank(b) || Number(b.port === remembered) - Number(a.port === remembered) || portRank(a.port) - portRank(b.port));
  return sorted[0] ?? { state: "none" };
}

/** The ports to look at, the remembered one first. */
export const portsToLook = (remembered?: number): number[] => [...new Set([...(remembered ? [remembered] : []), ...COMFY_PORTS])];

/** What the "Use the ComfyUI on this computer" card shows (components/gpu/use-local-comfy.ts finds it). */
export type Finder =
  /** The browser will ask to let Fuobe reach apps on this computer: a click starts the first look. */
  | { s: "start" }
  | { s: "looking" }
  /** Found and readable: the caller connects. */
  | { s: "found"; port: number; host: string; stats: SystemStats }
  /**
   * ComfyUI answers but can't be read: it needs the setting (`back`: it restarted, still without it). `others`: other
   * ports where something answers too (the person picks where their ComfyUI is).
   */
  | { s: "needs-setting"; port: number; back: boolean; others?: number[] }
  /** The port went quiet after it needed the setting: ComfyUI is restarting. */
  | { s: "waiting"; port: number; since: number }
  | { s: "none"; missed?: number }
  /** The browser keeps Fuobe from reaching apps on this computer. */
  | { s: "blocked" }
  /** This browser or page can't: Safari, a phone, or a studio on plain http at a network address. */
  | { s: "unsupported"; why: "safari" | "phone" | "http" };

/**
 * The card's next screen after a look (`typed`: the one port the person asked about). A readable ComfyUI on any port
 * connects. While it waits for one ComfyUI to come back with the setting, that port decides: quiet there is ComfyUI
 * restarting, and another app answering on another port changes nothing.
 */
export function settled(was: Finder, looks: PortLook[], remembered: number | undefined, typed: number | undefined, now: number): Finder {
  const best = pickLook(looks, remembered);
  if (best.state === "found") return { s: "found", port: best.port, host: best.host ?? "127.0.0.1", stats: best.stats };
  const answering = looks.filter((l) => l.state === "unreadable").map((l) => l.port);
  const others = (port: number) => {
    const rest = answering.filter((p) => p !== port);
    return rest.length ? { others: rest } : {};
  };
  if ((was.s === "needs-setting" || was.s === "waiting") && looks.some((l) => l.port === was.port)) {
    if (answering.includes(was.port)) return { s: "needs-setting", port: was.port, back: was.s === "waiting" || (was.s === "needs-setting" && was.back), ...others(was.port) };
    return { s: "waiting", port: was.port, since: was.s === "waiting" ? was.since : now };
  }
  if (best.state === "unreadable") return { s: "needs-setting", port: best.port, back: false, ...others(best.port) };
  return { s: "none", ...(typed && { missed: typed }) };
}

/** The same screen (a quiet look that found nothing new changes nothing). */
export const sameFinder = (a: Finder, b: Finder): boolean => a.s === b.s && JSON.stringify({ ...a, stats: undefined }) === JSON.stringify({ ...b, stats: undefined });

/**
 * Facts for the server from /system_stats: never the command line, only whether its cross-site setting names this site;
 * and whether Fuobe's guard answered (`guard`, when it was asked).
 */
export function statsFacts(s: SystemStats, origin: string, guard?: boolean) {
  const argv = s.system?.argv ?? [];
  const at = argv.indexOf("--enable-cors-header");
  const value = at >= 0 ? argv[at + 1] : undefined;
  const cors = at < 0 ? undefined : !value || value.startsWith("--") || value === "*" ? ("any" as const) : value.replace(/\/+$/, "") === origin ? ("exact" as const) : ("other" as const);
  const dev = s.devices?.[0];
  return {
    ...(dev?.name && { device: dev.name.slice(0, 120) }),
    ...(typeof dev?.vram_total === "number" && { vramBytes: dev.vram_total }),
    ...(typeof s.system?.ram_total === "number" && { ramBytes: s.system.ram_total }),
    ...(s.system?.comfyui_version && { version: String(s.system.comfyui_version).slice(0, 40) }),
    ...(s.system?.os && { os: String(s.system.os).slice(0, 40) }),
    ...(typeof s.system?.embedded_python === "boolean" && { portable: s.system.embedded_python }),
    ...(cors && { cors }),
    ...(guard !== undefined && { guard }),
  };
}

/**
 * The GPU check from the browser (lib/gpu/gather.ts): ComfyUI's facts and lists, and the Manager's read-only answers
 * (its version, whether it is busy, the packs it has, why a pack didn't load). Never a prompt, an upload, a file, an
 * install or a log. Throws for anything else. ComfyUI also answers under /api.
 */
export function preflightPath(method: "GET" | "POST", path: string): string {
  const [p0, query = ""] = path.split("?");
  const p = p0.startsWith("/api/") ? p0.slice(4) : p0;
  if (method === "POST") {
    if (!query && /^\/(v2\/)?customnode\/import_fail_info(_bulk)?$/.test(p)) return path;
    throw new LocalComfyError(`Fuobe doesn't send ${p0} to your ComfyUI`);
  }
  if (!query && /^\/(experiment\/models(\/[A-Za-z0-9_.-]{1,64})?|features|(v2\/)?manager\/(version|queue\/status)|(v2\/)?customnode\/installed)$/.test(p)) return path;
  if (p.startsWith("/api/") || p === "/view" || p === "/ws" || p === "/upload/image") throw new LocalComfyError(`Fuobe doesn't read ${p0} on your ComfyUI`);
  readPath(query ? `${p}?${query}` : p);
  return path;
}

/**
 * Can this browser reach a ComfyUI on its own computer? Chrome, Edge, Brave and Firefox on a computer can. Safari
 * can't (an https page may not call http://127.0.0.1), nor can any browser on an iPhone or iPad (all are Safari
 * underneath), nor a phone (no ComfyUI there): those get the link instead.
 */
export function browserSupport(
  nav: { userAgent?: string; userAgentData?: { mobile?: boolean; platform?: string } },
  screen: { narrow: boolean; coarse?: boolean },
): "ok" | "safari" | "phone" {
  const ua = nav.userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(ua) || nav.userAgentData?.mobile || /Android.+Mobile|Mobile Safari/.test(ua)) return "phone";
  if (screen.narrow && screen.coarse !== false) return "phone";
  if (!nav.userAgentData && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|Firefox|OPR/.test(ua)) return "safari";
  return "ok";
}

/**
 * Can a page at this address ask for the permission at all? Chrome turns it down for a page on plain http at a network
 * address (a self-hosted studio on the LAN); https and localhost are fine, and so is any page the browser itself calls
 * secure (`secure`: window.isSecureContext).
 */
export function pageCanReach(origin: string, secure?: boolean): boolean {
  if (secure === true) return true;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" || LOCAL_HOSTS.has(u.hostname === "::1" ? "[::1]" : u.hostname) || u.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}
