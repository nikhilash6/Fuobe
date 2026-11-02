/**
 * Library (Assets) logic shared by the browser and the server: feed filters, helper steps, nested
 * folders, pins, review statuses, the Trash, where a file is used, download names, date sections
 * and batch stacks. Pure: no React, no database.
 */
import { OPERATION_LABELS, type Generation, type GenerationStatus, type MediaKind, type OutputFile, type ReviewStatus } from "./catalog/types";

// ---------------------------------------------------------------------------
// Filters (GET /api/generations query ⇄ client-side matching for live cache updates)

export interface FeedFilter {
  kind?: MediaKind;
  kinds?: MediaKind[];
  features?: string[];
  favorites?: boolean;
  q?: string;
  limit?: number;
  models?: string[];
  statuses?: GenerationStatus[];
  /** createdAt range: since ≤ t < until. */
  since?: number;
  until?: number;
  folderId?: string;
  /** Any of these folders (a folder and its subfolders: "Show subfolders content"). */
  folderIds?: string[];
  /** The Trash instead of the library. */
  trashed?: boolean;
  /** Pinned ones only (most recently pinned first), or (false) the ones that aren't pinned. */
  pinned?: boolean;
  /** Review statuses; "none" is a result without one. */
  reviews?: ReviewFilter[];
  /**
   * Also helper steps (see isHelperFeature). A list that names no features (and no batch) leaves them
   * out unless this is set, so a list that must see every job (a count of running jobs) sets it.
   */
  steps?: boolean;
}

/** Which timestamp a list is ordered (and paged) by: deletedAt in the Trash, pinnedAt in a pinned list, else createdAt. */
function sortTime(g: Generation, f: Pick<FeedFilter, "trashed" | "pinned">): number | null | undefined {
  return f.trashed ? g.deletedAt : f.pinned ? g.pinnedAt : g.createdAt;
}

/**
 * The paging cursor for the page after `last`: its sort timestamp and id, so equal timestamps aren't
 * skipped. `f` is the list's filter (or, as before, whether it's the Trash).
 */
export function cursorAfter(last: Generation, f?: boolean | Pick<FeedFilter, "trashed" | "pinned">): string | undefined {
  const ts = sortTime(last, typeof f === "boolean" ? { trashed: f } : (f ?? {}));
  return ts ? `${ts}:${last.id}` : undefined;
}

export function filterToSearch(f: FeedFilter, before?: string | number): URLSearchParams {
  const qs = new URLSearchParams();
  if (f.kind) qs.set("kind", f.kind);
  if (f.kinds?.length) qs.set("kinds", f.kinds.join(","));
  if (f.features?.length) qs.set("features", f.features.join(","));
  if (f.favorites) qs.set("favorites", "1");
  if (f.q?.trim()) qs.set("q", f.q.trim());
  if (f.models?.length) qs.set("models", f.models.join(","));
  if (f.statuses?.length) qs.set("statuses", f.statuses.join(","));
  if (f.since) qs.set("since", String(f.since));
  if (f.until) qs.set("until", String(f.until));
  if (f.folderId) qs.set("folder", f.folderId);
  if (f.folderIds?.length) qs.set("folders", f.folderIds.join(","));
  if (f.trashed) qs.set("trash", "1");
  if (f.pinned !== undefined) qs.set("pinned", f.pinned ? "1" : "0");
  if (f.reviews?.length) qs.set("reviews", f.reviews.join(","));
  if (f.steps) qs.set("steps", "1");
  if (before) qs.set("before", String(before));
  qs.set("limit", String(f.limit ?? 80));
  return qs;
}

const featureMatches = (feature: string, pattern: string) => (pattern.endsWith("*") ? feature.startsWith(pattern.slice(0, -1)) : feature === pattern);

/** Whether a generation belongs in a list with this filter (mirrors listGenerations). */
export function matchesFilter(g: Generation, f: FeedFilter): boolean {
  if (!!f.trashed !== !!g.deletedAt) return false;
  if (f.kind && g.kind !== f.kind) return false;
  if (f.kinds?.length && !f.kinds.includes(g.kind)) return false;
  if (f.features?.length && !f.features.some((p) => featureMatches(g.feature, p))) return false;
  if (f.favorites && !g.favorite) return false;
  if (f.models?.length && !f.models.includes(g.modelId)) return false;
  if (f.statuses?.length && !f.statuses.includes(g.status)) return false;
  if (f.since && g.createdAt < f.since) return false;
  if (f.until && g.createdAt >= f.until) return false;
  if (f.folderId && g.folderId !== f.folderId) return false;
  if (f.folderIds?.length && !f.folderIds.includes(g.folderId ?? "")) return false;
  if (f.pinned !== undefined && !!g.pinnedAt !== f.pinned) return false;
  if (f.reviews?.length && !f.reviews.includes(g.review ?? "none")) return false;
  if (!f.steps && !f.features?.length && isHelperFeature(g.feature)) return false;
  const q = f.q?.trim().toLowerCase();
  if (q && !`${g.prompt ?? ""}\n${g.request.prompt ?? ""}`.toLowerCase().includes(q)) return false;
  return true;
}

const byIdDesc = (a: Generation, b: Generation) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Newest first, as the server orders lists (ties: id descending). */
export function byNewest(a: Generation, b: Generation): number {
  return b.createdAt - a.createdAt || byIdDesc(a, b);
}

/** The Trash's order: most recently deleted first (ties: id descending, like the server). */
export function byDeleted(a: Generation, b: Generation): number {
  return (b.deletedAt ?? 0) - (a.deletedAt ?? 0) || byIdDesc(a, b);
}

/** A pinned list's order: most recently pinned first (ties: id descending, like the server). */
export function byPinned(a: Generation, b: Generation): number {
  return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || byIdDesc(a, b);
}

/** The order of a list with this filter, as the server sends it. */
export function listOrder(f: Pick<FeedFilter, "trashed" | "pinned">): (a: Generation, b: Generation) => number {
  return f.trashed ? byDeleted : f.pinned ? byPinned : byNewest;
}

// ---------------------------------------------------------------------------
// Helper steps

/**
 * Jobs nobody asked to see on their own: the steps a chain runs before its result (a Shorts cut, a
 * Click to Ad voiceover, an Ad Multiplier hook: every "<studio>-step" feature), and helper jobs a
 * studio starts by itself (a Mixed Media preview frame, a Faceless channel avatar or narrator sample,
 * a moodboard's cover), the evaluation harness's runs (scripts/eval: hundreds of test renders) and a skill
 * recipe's free dry runs (skill-check, moved to the Trash when the check ends). The
 * Library and the home feed leave them out unless "Show steps" is on; a list that names its features
 * (a studio reading its own steps) gets what it asks for.
 */
export const HELPER_SUFFIX = "-step";
export const HELPER_FEATURES = ["mixed-media-preview", "faceless-avatar", "faceless-voice", "moodboard", "eval", "skill-check"] as const;

export function isHelperFeature(feature: string): boolean {
  return feature.endsWith(HELPER_SUFFIX) || (HELPER_FEATURES as readonly string[]).includes(feature);
}

// ---------------------------------------------------------------------------
// Review status (Higgsfield's Assets: In progress, Needs review, Approved, Rejected)

export const REVIEW_STATUSES: { id: ReviewStatus; label: string; color: string }[] = [
  { id: "in-progress", label: "In progress", color: "#029dfe" },
  { id: "needs-review", label: "Needs review", color: "#fe7802" },
  { id: "approved", label: "Approved", color: "#d1fe17" },
  { id: "rejected", label: "Rejected", color: "#ef4444" },
];

export type ReviewFilter = ReviewStatus | "none";

export const isReviewStatus = (v: unknown): v is ReviewStatus => REVIEW_STATUSES.some((r) => r.id === v);

export function reviewInfo(status: ReviewStatus | null | undefined): (typeof REVIEW_STATUSES)[number] | null {
  return REVIEW_STATUSES.find((r) => r.id === status) ?? null;
}

// ---------------------------------------------------------------------------
// Folders

export interface Folder {
  id: string;
  name: string;
  color: string;
  /** Results directly in it, as its page shows them by default (not in its subfolders or the Trash, not helper steps). */
  count: number;
  /** Subfolders directly in it. */
  folders: number;
  /** The newest output in the folder (not a helper step's), for its cover. */
  cover: OutputFile | null;
  /** The folder it's in (null: the library root). */
  parentId: string | null;
  /** Pinned to the top of its parent at (null: not pinned). */
  pinnedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** How deep folders nest (the breadcrumbs, the zip paths and the Move menu stay readable). */
export const MAX_FOLDER_DEPTH = 8;

type FolderLink = Pick<Folder, "id" | "parentId">;

/** A folder's subfolders (the root's with null): pinned first, in the order they were pinned, then oldest first. */
export function childFolders<F extends FolderLink & Pick<Folder, "pinnedAt" | "createdAt">>(all: F[], parentId: string | null): F[] {
  return all
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) => (a.pinnedAt ? 0 : 1) - (b.pinnedAt ? 0 : 1) || (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** The folders from the root down to `id`, for breadcrumbs ([] when it's gone; a loop in bad data stops the walk). */
export function folderPath<F extends FolderLink>(all: F[], id: string | null | undefined): F[] {
  const byId = new Map(all.map((f) => [f.id, f]));
  const out: F[] = [];
  const seen = new Set<string>();
  for (let f = id ? byId.get(id) : undefined; f && !seen.has(f.id); f = f.parentId ? byId.get(f.parentId) : undefined) {
    seen.add(f.id);
    out.unshift(f);
  }
  return out;
}

/** `id` and every folder inside it, at any depth. */
export function folderAndDescendants(all: FolderLink[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const f of all) if (f.parentId === out[i] && !out.includes(f.id)) out.push(f.id);
  return out;
}

/** How many levels a folder's subtree spans (1: no subfolders). */
function subtreeHeight(all: FolderLink[], id: string, seen = new Set<string>()): number {
  seen.add(id);
  const kids = all.filter((f) => f.parentId === id && !seen.has(f.id));
  return 1 + Math.max(0, ...kids.map((k) => subtreeHeight(all, k.id, seen)));
}

/** Why folder `id` can't go into `parentId` (null: the library root), in Higgsfield's words; null when it can. */
export function folderMoveError(all: FolderLink[], id: string, parentId: string | null): string | null {
  const f = all.find((x) => x.id === id);
  if (!f || (parentId && !all.some((x) => x.id === parentId))) return "That folder doesn't exist anymore";
  if (parentId === id) return "Cannot move into itself";
  if ((f.parentId ?? null) === parentId) return "Already in this folder";
  if (parentId && folderAndDescendants(all, id).includes(parentId)) return "Cannot move into a subfolder";
  if (folderPath(all, parentId).length + subtreeHeight(all, id) > MAX_FOLDER_DEPTH) return `Folders go ${MAX_FOLDER_DEPTH} levels deep at most`;
  return null;
}

/** Every folder in tree order with its depth (0 at the root), for Move menus. */
export function folderTree<F extends FolderLink & Pick<Folder, "pinnedAt" | "createdAt">>(all: F[]): { folder: F; depth: number }[] {
  const out: { folder: F; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childFolders(all, parentId)) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** A name no sibling has yet: "Drafts" → "Drafts 2" (case-insensitive, like the folder names). */
export function freeName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let k = 2; ; k++) {
    const next = `${name.slice(0, 56)} ${k}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/** A folder name as one path segment in a zip ("Spring / Summer" → "Spring - Summer"). */
export function zipSegment(name: string): string {
  const clean = [...name]
    .filter((c) => c.charCodeAt(0) >= 32 && !'<>:"|?*'.includes(c))
    .join("")
    .replace(/[\\/]+/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return clean.slice(0, 80) || "Folder";
}

/** Higgsfield's seven folder swatches, as oklch hues (lime is the default). */
export const FOLDER_COLORS = [
  { id: "lime", label: "Lime", hue: 125, chroma: 0.21 },
  { id: "cyan", label: "Cyan", hue: 205, chroma: 0.12 },
  { id: "slate", label: "Slate", hue: 255, chroma: 0.03 },
  { id: "violet", label: "Violet", hue: 290, chroma: 0.15 },
  { id: "purple", label: "Purple", hue: 310, chroma: 0.16 },
  { id: "pink", label: "Pink", hue: 350, chroma: 0.16 },
  { id: "yellow", label: "Yellow", hue: 95, chroma: 0.16 },
] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number]["id"];
export const DEFAULT_FOLDER_COLOR: FolderColor = "lime";

export function folderSwatch(color: string): string {
  const c = FOLDER_COLORS.find((x) => x.id === color) ?? FOLDER_COLORS[0];
  return `oklch(0.86 ${c.chroma} ${c.hue})`;
}

// ---------------------------------------------------------------------------
// Trash

export const TRASH_DAYS = 30;
const DAY = 86_400_000;

export function trashDaysLeft(deletedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * DAY - now) / DAY));
}

// ---------------------------------------------------------------------------
// Where a stored file is used (an upload can only be deleted when nothing refers to it)

/** One row that refers to a file: what it is ("result", "element"), which one (rows of two tables can be one thing) and its name. */
export interface AssetUse {
  what: string;
  key: string;
  name: string | null;
  /** A result in the Trash (it can still be restored, so it still counts). */
  trashed?: boolean;
}

const plural = (what: string) => (/series$/.test(what) ? what : /(s|x|ch|sh)$/.test(what) ? `${what}es` : `${what}s`);

/** "2 results (1 in the Trash), the element “Maya” and 3 canvases": where a file is used, in one line. */
export function describeUses(uses: AssetUse[]): string {
  const groups = new Map<string, Map<string, AssetUse>>();
  for (const u of uses) {
    const g = groups.get(u.what) ?? new Map<string, AssetUse>();
    groups.set(u.what, g);
    if (!g.has(u.key)) g.set(u.key, u);
  }
  const parts = [...groups].map(([what, rows]) => {
    const list = [...rows.values()];
    const trashed = list.filter((u) => u.trashed).length;
    const inTrash = trashed ? ` (${trashed === list.length && list.length === 1 ? "in the Trash" : `${trashed} in the Trash`})` : "";
    if (list.length === 1 && list[0].name?.trim()) return `the ${what} “${list[0].name.trim().slice(0, 60)}”${inTrash}`;
    return `${list.length} ${list.length === 1 ? what : plural(what)}${inTrash}`;
  });
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// ---------------------------------------------------------------------------
// Download names

const EXT_BY_KIND: Record<MediaKind, string> = { image: "png", video: "mp4", audio: "wav", text: "txt", model3d: "glb" };

export function extensionOf(o: Pick<OutputFile, "url" | "kind">): string {
  const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(o.url.split("/").pop() ?? "");
  return m ? m[1].toLowerCase() : EXT_BY_KIND[o.kind];
}

export function downloadName(
  g: Pick<Generation, "id" | "prompt" | "modelId" | "request" | "op" | "presetName" | "modelName">,
  o: Pick<OutputFile, "url" | "kind" | "meta">,
  i: number,
  ext = extensionOf(o),
): string {
  const base = userTitle(g).slice(0, 40).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "fuobe";
  // A stem (a song's vocals, drums…) is named for its track rather than its place in the list.
  const stem = typeof o.meta?.stem === "string" ? o.meta.stem.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) : "";
  return `${base}-${g.id.slice(0, 6)}${stem ? `-${stem}` : i ? `-${i + 1}` : ""}.${ext}`;
}

export const downloadHref = (url: string, name: string) => `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;

// ---------------------------------------------------------------------------
// Split by date

export function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ts: number, now = Date.now()): string {
  const day = dayStart(ts);
  const today = dayStart(now);
  if (day === today) return "Today";
  if (day === dayStart(today - DAY / 2)) return "Yesterday";
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export function splitByDate<T>(items: T[], ts: (t: T) => number, now = Date.now()): { key: number; label: string; items: T[] }[] {
  const out: { key: number; label: string; items: T[] }[] = [];
  for (const it of items) {
    const key = dayStart(ts(it));
    const last = out.at(-1);
    if (last?.key === key) last.items.push(it);
    else out.push({ key, label: dayLabel(key, now), items: [it] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Batch stacks (storyboard + its film, multi-shot films, extend chains, pipelines, N takes)

export type LibraryEntry = { type: "single"; key: string; g: Generation } | { type: "stack"; key: string; title: string; label: string; items: Generation[] };

/** Storyboard films live in `${batchId}-film`: stack them with their board. */
export function stackKey(g: Pick<Generation, "batchId">): string | null {
  return g.batchId ? g.batchId.replace(/-film$/, "") : null;
}

/** The offline shot list wraps the story ("wide shot: <story> — beat 1 of 4"): unwrap it. */
function unwrapScene(scene: string): string {
  return /^[^:]{2,40}:\s*(.+?)\s+—\s+beat \d+ of \d+$/.exec(scene.trim())?.[1] ?? scene.trim();
}

/**
 * What the user asked for, never the internal chain prompt. Results made without words (transcribe,
 * image to 3D, upscale, trim…) are named by what was done: "Transcribe · Whisper".
 */
export function userTitle(g: Pick<Generation, "request" | "presetName" | "prompt" | "op" | "modelName">): string {
  const own = g.request.title?.trim();
  if (own) return own;
  if (g.request.frame) return unwrapScene(g.request.frame.scene);
  const words = g.request.prompt?.trim() || g.presetName || g.prompt?.trim();
  if (words && words !== g.op && !isData(words)) return words;
  const what = OPERATION_LABELS[g.op];
  const into = g.op === "translate" && g.request.params?.targetLanguage ? ` into ${g.request.params.targetLanguage}` : "";
  return what ? `${what}${into}${g.modelName ? ` · ${g.modelName}` : ""}` : (g.modelName ?? "Untitled");
}

/** A chained step's prompt that is data, not words (a translation fed a transcript's cue list). */
function isData(s: string): boolean {
  if (!/^[[{]/.test(s)) return false;
  try {
    return typeof JSON.parse(s) === "object";
  } catch {
    return false;
  }
}

const order = (g: Generation) => g.request.step?.index ?? g.request.frame?.index ?? 0;

export function stackTitle(items: Generation[]): string {
  const titled = items.find((g) => g.request.title?.trim());
  if (titled) return userTitle(titled);
  // An Assist plan: its summary.
  const plan = items.find((g) => g.request.batchTitle?.trim())?.request.batchTitle?.trim();
  if (plan) return plan;
  const frames = items.filter((g) => g.request.frame).sort((a, b) => order(a) - order(b));
  if (frames.length) return unwrapScene(frames[0].request.frame!.scene);
  const film = items.find((g) => g.op === "concat" && g.prompt?.trim());
  if (film) return unwrapScene(film.prompt!);
  const first = [...items].sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt)[0];
  return userTitle(first);
}

export function stackLabel(items: Generation[]): string {
  const frames = items.filter((g) => g.request.frame).length;
  const films = items.filter((g) => g.op === "concat" && g.request.step?.label?.startsWith("Film")).length;
  const shots = items.filter((g) => /^Shot \d+/.test(g.request.step?.label ?? "")).length;
  if (frames) return `Storyboard · ${frames} frame${frames === 1 ? "" : "s"}${films ? " + film" : ""}`;
  if (films && shots) return `Film · ${shots} shots`;
  if (items.some((g) => g.request.step)) return `${items.length} steps`;
  if (items.every((g) => g.request.prompt === items[0].request.prompt && g.modelId === items[0].modelId)) return `${items.length} takes`;
  return `${items.length} results`;
}

/**
 * Group a newest-first list into cards: generations sharing a batch become one stack, placed where its
 * newest member is. `prefix` goes in front of stack keys, for a second list on the same page (the
 * Pinned section): a batch with members in both gets a stack in each, and their keys must differ.
 */
export function buildEntries(items: Generation[], opts: { stacks?: boolean; prefix?: string } = {}): LibraryEntry[] {
  if (opts.stacks === false) return items.map((g) => ({ type: "single", key: g.id, g }));
  const groups = new Map<string, Generation[]>();
  for (const g of items) {
    const k = stackKey(g);
    if (k) groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  const out: LibraryEntry[] = [];
  const placed = new Set<string>();
  for (const g of items) {
    const k = stackKey(g);
    const group = k ? groups.get(k)! : null;
    if (!k || !group || group.length < 2) {
      out.push({ type: "single", key: g.id, g });
      continue;
    }
    if (placed.has(k)) continue;
    placed.add(k);
    const sorted = [...group].sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt);
    out.push({ type: "stack", key: `${opts.prefix ?? ""}stack:${k}`, title: stackTitle(group), label: stackLabel(group), items: sorted });
  }
  return out;
}

/** The output a card shows: a film's video first, else the first finished output. */
export function coverOf(items: Generation[]): { g: Generation; o: OutputFile; index: number } | null {
  const done = items.filter((g) => g.status === "succeeded" && g.outputs.length);
  const film = done.find((g) => g.op === "concat");
  const g = film ?? done[0];
  return g ? { g, o: g.outputs[0], index: 0 } : null;
}

/**
 * Select a group of results (a date's, or everything loaded): every one of `ids` when any is
 * missing, else none of them. Returns a new set; other selected ids stay as they are.
 */
export function toggleAll(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(selected);
  const all = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}
