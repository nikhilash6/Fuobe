/**
 * Canvas boards beyond the node graph (Canvas parity): pages, groups (frames), comment pins and
 * annotation shapes. Everything here is pure, shared by the editor and the server.
 *
 * A canvas row stores a document of pages; each page is its own board (nodes, edges, viewport, and the
 * groups, comments and shapes drawn on it). Rows saved before pages existed hold one board: they read as
 * a single page. Results stay keyed by node id across pages (node ids are unique within a canvas).
 *
 * Groups don't own their nodes: a node belongs to the group its top-left corner sits in, so the planner
 * and the server agree on membership without parent links (positions stay absolute).
 */
import type { CanvasGraph, CanvasNode, CanvasNodeData } from "./canvas";

// ---------------------------------------------------------------------------
// Annotations

/** Annotation and group colours: the app's chart tokens (both themes), and "ink" (the text colour). */
export const BOARD_COLORS = ["ink", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];

/** Named by the tokens' hues (src/app/globals.css): 282, 195, 80, 8 and 240. */
export const BOARD_COLOR_LABEL: Record<BoardColor, string> = {
  ink: "Ink",
  "chart-1": "Violet",
  "chart-2": "Teal",
  "chart-3": "Amber",
  "chart-4": "Rose",
  "chart-5": "Blue",
};

/** A frame around nodes: moves them with it, and runs them together. */
export interface CanvasGroup {
  id: string;
  title: string;
  color: BoardColor;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CommentReply {
  id: string;
  author: string;
  text: string;
  at: number;
}

/** A comment pinned to the board. */
export interface CanvasComment {
  id: string;
  x: number;
  y: number;
  author: string;
  text: string;
  at: number;
  resolved?: boolean;
  replies?: CommentReply[];
}

export type ShapeKind = "rect" | "ellipse" | "arrow" | "text" | "pen";

export const SHAPE_LABEL: Record<ShapeKind, string> = { rect: "Rectangle", ellipse: "Ellipse", arrow: "Arrow", text: "Text", pen: "Drawing" };

/** A drawing on the board (not run). Arrow and pen points are fractions (0–1) of the shape's box, so resizing scales them. */
export interface CanvasShape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color: BoardColor;
  text?: string;
  points?: [number, number][];
}

/** Who wrote a comment: Fuobe is single-user, so it's always you. */
export const COMMENT_AUTHOR = "You";

export const BOARD_LIMITS = { pages: 20, groups: 100, comments: 200, shapes: 500, penPoints: 400, commentText: 2000, replies: 50, groupTitle: 80, shapeText: 2000 } as const;

/** Freehand points closer than this (board px) to the last kept one are dropped. */
const PEN_STEP = 2;

/**
 * A freehand stroke as a shape: its bounding box and its points as fractions of it. Points closer than
 * PEN_STEP are dropped and long strokes are thinned to BOARD_LIMITS.penPoints. Null for a dot.
 */
export function penShape(id: string, raw: { x: number; y: number }[], color: BoardColor): CanvasShape | null {
  const pts: { x: number; y: number }[] = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= PEN_STEP) pts.push(p);
  }
  if (pts.length < 2) return null;
  // Every n-th point plus the last one: n leaves room for that last point within the limit.
  const max = BOARD_LIMITS.penPoints;
  const every = pts.length > max ? Math.ceil(pts.length / (max - 1)) : 1;
  const kept = every > 1 ? pts.filter((_, i) => i % every === 0 || i === pts.length - 1) : pts;
  const box = boundsOf(kept);
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  return {
    id,
    kind: "pen",
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(w),
    height: Math.round(h),
    color,
    points: kept.map((p) => [round3((p.x - box.x) / w), round3((p.y - box.y) / h)]),
  };
}

/** A rectangle, ellipse or arrow dragged from `a` to `b` (an arrow keeps its direction in its points). */
export function dragShape(id: string, kind: Exclude<ShapeKind, "pen" | "text">, a: { x: number; y: number }, b: { x: number; y: number }, color: BoardColor): CanvasShape {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.max(8, Math.abs(b.x - a.x));
  const height = Math.max(8, Math.abs(b.y - a.y));
  const shape: CanvasShape = { id, kind, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), color };
  if (kind === "arrow") shape.points = [[a.x <= b.x ? 0 : 1, a.y <= b.y ? 0 : 1], [a.x <= b.x ? 1 : 0, a.y <= b.y ? 1 : 0]];
  return shape;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function boundsOf(pts: { x: number; y: number }[]): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Distance from p to the segment ab. */
function toSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Whether a point on the board touches a shape (the eraser): its outline for strokes and arrows, its box otherwise. */
export function shapeHit(s: CanvasShape, p: { x: number; y: number }, tolerance = 6): boolean {
  if (p.x < s.x - tolerance || p.y < s.y - tolerance || p.x > s.x + s.width + tolerance || p.y > s.y + s.height + tolerance) return false;
  if ((s.kind === "pen" || s.kind === "arrow") && s.points && s.points.length > 1) {
    const at = (q: [number, number]) => ({ x: s.x + q[0] * s.width, y: s.y + q[1] * s.height });
    for (let i = 1; i < s.points.length; i++) if (toSegment(p, at(s.points[i - 1]), at(s.points[i])) <= tolerance) return true;
    return false;
  }
  if (s.kind === "ellipse") {
    const rx = s.width / 2 + tolerance;
    const ry = s.height / 2 + tolerance;
    const dx = p.x - (s.x + s.width / 2);
    const dy = p.y - (s.y + s.height / 2);
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  }
  return true;
}

/** An SVG path through a stroke's points, in a box of w × h. */
export function strokePath(points: [number, number][], w: number, h: number): string {
  if (!points.length) return "";
  const xy = points.map(([x, y]) => [round3(x * w), round3(y * h)] as const);
  if (xy.length < 3) return `M${xy.map((p) => p.join(" ")).join(" L")}`;
  // Midpoint quadratic smoothing: a hand-drawn line without the corners of a polyline.
  let d = `M${xy[0][0]} ${xy[0][1]}`;
  for (let i = 1; i < xy.length - 1; i++) {
    const mx = round3((xy[i][0] + xy[i + 1][0]) / 2);
    const my = round3((xy[i][1] + xy[i + 1][1]) / 2);
    d += ` Q${xy[i][0]} ${xy[i][1]} ${mx} ${my}`;
  }
  const last = xy[xy.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}

// ---------------------------------------------------------------------------
// Groups

/** Room around the nodes when a group is made from a selection, and the title bar above them. */
export const GROUP_PAD = 32;
export const GROUP_BAR = 44;

/** A group framing these boxes (the selected nodes' measured bounds). */
export function groupAround(id: string, boxes: { x: number; y: number; width: number; height: number }[], title = "Group", color: BoardColor = "chart-2"): CanvasGroup | null {
  if (!boxes.length) return null;
  const corners = boxes.flatMap((b) => [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
  ]);
  const b = boundsOf(corners);
  return {
    id,
    title,
    color,
    x: Math.round(b.x - GROUP_PAD),
    y: Math.round(b.y - GROUP_PAD - GROUP_BAR),
    width: Math.round(b.width + GROUP_PAD * 2),
    height: Math.round(b.height + GROUP_PAD * 2 + GROUP_BAR),
  };
}

const inside = (g: Pick<CanvasGroup, "x" | "y" | "width" | "height">, p: { x: number; y: number }) => p.x >= g.x && p.y >= g.y && p.x <= g.x + g.width && p.y <= g.y + g.height;

/**
 * The nodes in a group: those whose top-left corner sits inside it. A node inside two nested groups
 * belongs to both (running the outer one runs the inner one's nodes too).
 */
export function groupMembers(graph: Pick<CanvasGraph, "nodes">, group: Pick<CanvasGroup, "x" | "y" | "width" | "height">): CanvasNode[] {
  return graph.nodes.filter((n) => inside(group, n.position));
}

/** The groups inside this one (moved with it). */
export function innerGroups(groups: readonly CanvasGroup[], group: CanvasGroup): CanvasGroup[] {
  return groups.filter((g) => g.id !== group.id && inside(group, g) && inside(group, { x: g.x + g.width, y: g.y + g.height }));
}

/** Node ids to run for "Run group": its members (the planner adds what they need upstream). */
export function groupTargets(graph: CanvasGraph, groupId: string): string[] {
  const g = graph.groups?.find((x) => x.id === groupId);
  return g ? groupMembers(graph, g).map((n) => n.id) : [];
}

// ---------------------------------------------------------------------------
// Pages

export interface CanvasPage {
  id: string;
  name: string;
  graph: CanvasGraph;
}

/** What a canvas row's graph_json holds. */
export interface CanvasDoc {
  pages: CanvasPage[];
}

export const FIRST_PAGE_ID = "page-1";

export const pageName = (i: number) => `Page ${i + 1}`;

/**
 * The pages stored in a canvas row: the document as saved, or an older row's single board as page 1
 * (nothing is rewritten until the board is saved again).
 */
export function readPages(json: unknown): CanvasPage[] {
  const doc = json as Partial<CanvasDoc> & Partial<CanvasGraph>;
  if (doc && Array.isArray(doc.pages) && doc.pages.length) return doc.pages;
  const graph: CanvasGraph = { nodes: Array.isArray(doc?.nodes) ? doc.nodes : [], edges: Array.isArray(doc?.edges) ? doc.edges : [] };
  if (doc?.viewport) graph.viewport = doc.viewport;
  for (const k of ["groups", "comments", "shapes"] as const) if (Array.isArray(doc?.[k])) (graph as unknown as Record<string, unknown>)[k] = doc[k];
  return [{ id: FIRST_PAGE_ID, name: pageName(0), graph }];
}

/** A page by id, else the first one. */
export function pageOf(pages: readonly CanvasPage[], id?: string | null): CanvasPage {
  return (id && pages.find((p) => p.id === id)) || pages[0];
}

/** The pages with one page's board replaced (the first page when the id isn't there). */
export function withPageGraph(pages: readonly CanvasPage[], id: string | null | undefined, graph: CanvasGraph): CanvasPage[] {
  const target = pageOf(pages, id).id;
  return pages.map((p) => (p.id === target ? { ...p, graph } : p));
}

/** Every node on every page. */
export function allNodes(pages: readonly CanvasPage[]): CanvasNode[] {
  return pages.flatMap((p) => p.graph.nodes);
}

/** A name for a new page that no page has yet: "Page 3". */
export function nextPageName(pages: readonly CanvasPage[]): string {
  const names = new Set(pages.map((p) => p.name.toLowerCase()));
  for (let i = pages.length; ; i++) if (!names.has(pageName(i).toLowerCase())) return pageName(i);
}

/**
 * A node's data with the node ids it refers to renamed by `map` (a Video concatenator keys each clip's cut and
 * sound, and the clips' order, by the clip's node id). Ids not in the map stay as they are.
 */
export function remapNodeData(data: CanvasNodeData, map: ReadonlyMap<string, string>): CanvasNodeData {
  if (!data.clips && !data.order) return data;
  const to = (id: string) => map.get(id) ?? id;
  return {
    ...data,
    ...(data.clips && { clips: Object.fromEntries(Object.entries(data.clips).map(([k, v]) => [to(k), v])) }),
    ...(data.order && { order: data.order.map(to) }),
  };
}

/**
 * A copy of a page with new ids for its nodes, edges, groups, comments and shapes (node ids are unique
 * across a canvas, since results are kept by node id). `newId` makes the ids.
 */
export function copyPage(page: CanvasPage, id: string, name: string, newId: (prefix: string) => string): CanvasPage {
  const map = new Map(page.graph.nodes.map((n) => [n.id, newId(n.type)]));
  const g = page.graph;
  return {
    id,
    name,
    graph: {
      ...g,
      nodes: g.nodes.map((n) => ({ ...n, id: map.get(n.id)!, data: { ...remapNodeData(n.data, map), pinned: undefined } })),
      edges: g.edges.flatMap((e) => (map.has(e.source) && map.has(e.target) ? [{ ...e, id: newId("e"), source: map.get(e.source)!, target: map.get(e.target)! }] : [])),
      ...(g.groups && { groups: g.groups.map((x) => ({ ...x, id: newId("group") })) }),
      ...(g.comments && { comments: g.comments.map((x) => ({ ...x, id: newId("comment") })) }),
      ...(g.shapes && { shapes: g.shapes.map((x) => ({ ...x, id: newId("shape") })) }),
    },
  };
}

/** What counts as an edit of a page (its viewport doesn't): compared to set "edited". */
export function pageContent(pages: readonly CanvasPage[]): string {
  return JSON.stringify(pages.map((p) => ({ id: p.id, name: p.name, nodes: p.graph.nodes, edges: p.graph.edges, groups: p.graph.groups, comments: p.graph.comments, shapes: p.graph.shapes })));
}
