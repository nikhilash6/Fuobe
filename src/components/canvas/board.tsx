"use client";

import { NodeResizer, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { Check, MoreHorizontal, Pencil, Play, RotateCcw, Trash2, Ungroup } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getModel } from "@/lib/catalog";
import { ancestors, newId, type CanvasGraph } from "@/lib/catalog/canvas";
import { BOARD_COLOR_LABEL, BOARD_COLORS, BOARD_LIMITS, COMMENT_AUTHOR, groupMembers, strokePath, type BoardColor, type CanvasComment, type CanvasGroup, type CanvasShape } from "@/lib/catalog/canvas-board";
import { formatCost, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useEditorActions, useEditorGlobals, useEditorSelector, type EditorSnapshot } from "./canvas-context";
import type { FlowNode } from "./nodes";

/**
 * What's drawn on a page besides the node graph: groups (frames), comment pins and annotation shapes. On the
 * board they are React Flow nodes like the others (so they select, drag, resize and delete the same way);
 * in the stored page they are the graph's groups, comments and shapes (src/lib/catalog/canvas-board.ts).
 */
export type BoardType = "group" | "comment" | "shape";
export const BOARD_TYPES: ReadonlySet<string> = new Set<BoardType>(["group", "comment", "shape"]);
export const isBoardNode = (n: { type?: string }) => BOARD_TYPES.has(n.type ?? "");

/** Stacking: groups behind everything (edges included), drawings under the nodes, comments above all. */
const Z = { group: -2000, shape: -1, comment: 3000 } as const;

export const BOARD_COLOR_VAR: Record<BoardColor, string> = {
  ink: "var(--foreground)",
  "chart-1": "var(--chart-1)",
  "chart-2": "var(--chart-2)",
  "chart-3": "var(--chart-3)",
  "chart-4": "var(--chart-4)",
  "chart-5": "var(--chart-5)",
};

const NO_DRAG = "nodrag nopan nowheel";

/** Ids of annotations just made with a tool: they open for typing when they mount (a text box, a comment). */
export const focusOnMount = new Set<string>();

/**
 * Focus a just-made annotation's field. React Flow keeps a new node hidden until it has measured it, and a
 * hidden field can't take the focus: try each frame until it does (half a second at most).
 */
function useFocusOnMount(id: string, field: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!focusOnMount.has(id)) return;
    let frame = 0;
    let tries = 0;
    const tick = () => {
      field.current?.focus();
      if (document.activeElement === field.current) return void focusOnMount.delete(id);
      if (++tries < 30) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [id, field]);
}

// ---------------------------------------------------------------------------
// Page graph ⇄ React Flow nodes

export function boardToFlow(g: CanvasGraph): FlowNode[] {
  return [
    ...(g.groups ?? []).map((x): FlowNode => ({ id: x.id, type: "group", position: { x: x.x, y: x.y }, width: x.width, height: x.height, zIndex: Z.group, dragHandle: ".canvas-group-bar", data: { label: x.title, color: x.color } })),
    ...(g.shapes ?? []).map(
      (x): FlowNode => ({ id: x.id, type: "shape", position: { x: x.x, y: x.y }, width: x.width, height: x.height, zIndex: Z.shape, data: { kind: x.kind, color: x.color, text: x.text, points: x.points } }),
    ),
    ...(g.comments ?? []).map((x): FlowNode => ({ id: x.id, type: "comment", position: { x: x.x, y: x.y }, zIndex: Z.comment, data: { text: x.text, author: x.author, at: x.at, resolved: x.resolved, replies: x.replies } })),
  ];
}

const r = Math.round;
const color = (v: unknown): BoardColor => ((BOARD_COLORS as readonly unknown[]).includes(v) ? (v as BoardColor) : "ink");

/** The groups, comments and shapes among the board's nodes, as stored. */
export function flowToBoard(nodes: FlowNode[]): Pick<CanvasGraph, "groups" | "comments" | "shapes"> {
  const groups: CanvasGroup[] = [];
  const comments: CanvasComment[] = [];
  const shapes: CanvasShape[] = [];
  for (const n of nodes) {
    const d = n.data;
    const w = r(n.width ?? n.measured?.width ?? 0);
    const h = r(n.height ?? n.measured?.height ?? 0);
    if (n.type === "group") groups.push({ id: n.id, title: (d.label ?? "Group").slice(0, BOARD_LIMITS.groupTitle), color: color(d.color), x: r(n.position.x), y: r(n.position.y), width: Math.max(1, w), height: Math.max(1, h) });
    else if (n.type === "shape") {
      shapes.push({
        id: n.id,
        kind: d.kind as CanvasShape["kind"],
        x: r(n.position.x),
        y: r(n.position.y),
        width: Math.max(1, w),
        height: Math.max(1, h),
        color: color(d.color),
        ...(typeof d.text === "string" && { text: d.text }),
        ...(Array.isArray(d.points) && { points: d.points as [number, number][] }),
      });
    } else if (n.type === "comment") {
      comments.push({
        id: n.id,
        x: r(n.position.x),
        y: r(n.position.y),
        author: String(d.author ?? COMMENT_AUTHOR),
        text: String(d.text ?? ""),
        at: Number(d.at ?? Date.now()),
        ...(d.resolved === true && { resolved: true }),
        ...(Array.isArray(d.replies) && d.replies.length && { replies: d.replies as CanvasComment["replies"] }),
      });
    }
  }
  return { ...(groups.length && { groups }), ...(comments.length && { comments }), ...(shapes.length && { shapes }) };
}

export function shapeNode(s: CanvasShape): FlowNode {
  return boardToFlow({ nodes: [], edges: [], shapes: [s] })[0];
}

export function groupNode(g: CanvasGroup): FlowNode {
  return boardToFlow({ nodes: [], edges: [], groups: [g] })[0];
}

export function commentNode(at: { x: number; y: number }): FlowNode {
  return { id: newId("comment"), type: "comment", position: at, zIndex: Z.comment, data: { text: "", author: COMMENT_AUTHOR, at: Date.now() } };
}

// ---------------------------------------------------------------------------
// Colour swatches (shapes, groups, the toolbar)

export function Swatches({ value, onChange, className }: { value?: BoardColor; onChange: (c: BoardColor) => void; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)} role="radiogroup" aria-label="Colour">
      {BOARD_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={BOARD_COLOR_LABEL[c]}
          title={BOARD_COLOR_LABEL[c]}
          onClick={() => onChange(c)}
          className={cn("grid size-6 place-items-center rounded-full transition-transform hover:scale-110", value === c && "ring-2 ring-primary ring-offset-2 ring-offset-popover")}
        >
          <span className="size-4 rounded-full" style={{ background: BOARD_COLOR_VAR[c] }} />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group

const selectGroupCount = (s: EditorSnapshot, id: string) => {
  const g = s.graph.groups?.find((x) => x.id === id);
  return g ? groupMembers(s.graph, g).length : 0;
};

/** What Run group would start: the group's nodes that need to run, and what they need upstream. */
interface GroupPlan {
  steps: number;
  usd: number;
  unknown: boolean;
  /** The models the steps run (a demo run is free whatever they cost). */
  models: string;
}
const sameGroupPlan = (a: GroupPlan, b: GroupPlan) => a.steps === b.steps && a.usd === b.usd && a.unknown === b.unknown && a.models === b.models;
const selectGroupPlan = (s: EditorSnapshot, id: string): GroupPlan => {
  const g = s.graph.groups?.find((x) => x.id === id);
  if (!g) return { steps: 0, usd: 0, unknown: false, models: "" };
  const members = groupMembers(s.graph, g).map((n) => n.id);
  const scope = new Set([...members, ...ancestors(s.graph, members)]);
  const steps = s.plan.steps.filter((st) => scope.has(st.nodeId));
  return {
    steps: steps.length,
    usd: Math.round(steps.reduce((n, st) => n + (st.costUsd ?? 0), 0) * 1000) / 1000,
    unknown: steps.some((st) => st.costUsd === null),
    models: [...new Set(steps.map((st) => st.request.modelId))].join(" "),
  };
};

/** Mounted only while the Run group tooltip is open: the price is worked out then, not on every keystroke. */
function GroupPrice({ id }: { id: string }) {
  const p = useEditorSelector(selectGroupPlan, id, sameGroupPlan);
  const { isDemo } = useEditorGlobals();
  if (!p.steps) return <>Everything in this group is up to date</>;
  const demo = p.models.split(" ").every((mid) => {
    const m = getModel(mid);
    return !!m && isDemo(m);
  });
  const price = demo ? "placeholder, free" : p.unknown ? "price unknown" : p.usd === 0 ? "free" : `≈ ${formatCost(p.usd)}`;
  return (
    <>
      Runs {p.steps === 1 ? "1 node" : `${p.steps} nodes`} (with what they need) · {price}
    </>
  );
}

const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<FlowNode>) {
  const actions = useEditorActions();
  const { readOnly, running } = useEditorGlobals();
  const count = useEditorSelector(selectGroupCount, id);
  const [editing, setEditing] = useState(false);
  const c = BOARD_COLOR_VAR[color(data.color)];
  const title = data.label || "Group";
  return (
    <div
      className="canvas-group size-full rounded-2xl border-2"
      style={{ borderColor: `color-mix(in oklab, ${c} ${selected ? 80 : 45}%, transparent)`, background: `color-mix(in oklab, ${c} 6%, transparent)` }}
      data-testid={`canvas-group-${id}`}
    >
      {!readOnly && <NodeResizer isVisible={!!selected} minWidth={200} minHeight={120} color={c} handleClassName="canvas-resize-handle" lineClassName="canvas-resize-line" />}
      <div className={cn("canvas-group-bar flex h-11 items-center gap-2 rounded-t-2xl px-3", !readOnly && "cursor-grab active:cursor-grabbing")}>
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: c }} />
        {editing ? (
          <input
            autoFocus
            defaultValue={title}
            maxLength={BOARD_LIMITS.groupTitle}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              setEditing(false);
              actions.update(id, { label: e.currentTarget.value.trim() || "Group" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
              e.stopPropagation();
            }}
            aria-label="Group name"
            className={cn("h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-[14px] font-semibold outline-none focus:border-primary", NO_DRAG)}
          />
        ) : (
          <span className="min-w-0 truncate text-[14px] font-semibold" onDoubleClick={() => !readOnly && setEditing(true)} title={readOnly ? undefined : "Double-click to rename"}>
            {title}
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{count === 1 ? "1 node" : `${count} nodes`}</span>
        {!readOnly && (
          <div className={cn("ml-auto flex shrink-0 items-center gap-1", NO_DRAG)}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => actions.runGroup(id)}
                  disabled={running || !count}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <Play className="size-3" /> Run group
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <GroupPrice id={id} />
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Actions for ${title}`}>
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => actions.runGroup(id)} disabled={!count}>
                  <Play className="size-4" /> Run group
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(() => setEditing(true), 0)}>
                  <Pencil className="size-4" /> Rename
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <span className="size-4 rounded-full" style={{ background: c }} /> Colour
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="p-2">
                    <Swatches value={color(data.color)} onChange={(v) => actions.update(id, { color: v })} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => actions.remove(id)}>
                  <Ungroup className="size-4" /> Ungroup <span className="ml-auto text-[11px] text-muted-foreground">keeps the nodes</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Shapes and drawings

const ShapeNode = memo(function ShapeNode({ id, data, selected, width, height }: NodeProps<FlowNode>) {
  const actions = useEditorActions();
  const { readOnly } = useEditorGlobals();
  const kind = data.kind as CanvasShape["kind"];
  const c = BOARD_COLOR_VAR[color(data.color)];
  const w = Math.max(1, width ?? 1);
  const h = Math.max(1, height ?? 1);
  const points = (data.points as [number, number][] | undefined) ?? [];
  const text = useRef<HTMLTextAreaElement>(null);
  useFocusOnMount(id, text);
  const marker = `arrow-${id}`;
  return (
    <div className="size-full" style={{ color: c }} data-testid={`canvas-shape-${id}`} aria-label={kind === "text" ? "Text" : kind === "pen" ? "Drawing" : kind}>
      {!readOnly && kind !== "pen" && <NodeResizer isVisible={!!selected} minWidth={16} minHeight={kind === "text" ? 32 : 16} color="var(--primary)" handleClassName="canvas-resize-handle" lineClassName="canvas-resize-line" />}
      {selected && !readOnly && (
        <NodeToolbar position={Position.Top} offset={10} className="flex items-center gap-1 rounded-full border bg-popover p-1 shadow-normal">
          <Swatches value={color(data.color)} onChange={(v) => actions.update(id, { color: v })} />
          <button onClick={() => actions.remove(id)} className="ml-1 grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Delete">
            <Trash2 className="size-3.5" />
          </button>
        </NodeToolbar>
      )}
      {kind === "text" ? (
        <textarea
          ref={text}
          value={String(data.text ?? "")}
          onChange={(e) => actions.update(id, { text: e.target.value })}
          onBlur={(e) => !e.currentTarget.value.trim() && actions.remove(id)}
          onKeyDown={(e) => {
            // Escape leaves the text (the board's letter shortcuts work again).
            if (e.key === "Escape") e.currentTarget.blur();
            e.stopPropagation();
          }}
          readOnly={readOnly}
          maxLength={BOARD_LIMITS.shapeText}
          rows={1}
          placeholder="Type something"
          aria-label="Text on the board"
          className={cn("field-sizing-content size-full min-h-8 resize-none bg-transparent font-heading text-[20px] leading-snug outline-none placeholder:text-muted-foreground", selected && NO_DRAG)}
          style={{ color: c }}
        />
      ) : (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible" className="block">
          {kind === "rect" && <rect x={1} y={1} width={Math.max(0, w - 2)} height={Math.max(0, h - 2)} rx={10} fill="currentColor" fillOpacity={0.07} stroke="currentColor" strokeWidth={2} />}
          {kind === "ellipse" && <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - 1)} ry={Math.max(0, h / 2 - 1)} fill="currentColor" fillOpacity={0.07} stroke="currentColor" strokeWidth={2} />}
          {kind === "arrow" && points.length === 2 && (
            <>
              <defs>
                <marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
                </marker>
              </defs>
              <line x1={points[0][0] * w} y1={points[0][1] * h} x2={points[1][0] * w} y2={points[1][1] * h} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" markerEnd={`url(#${marker})`} />
            </>
          )}
          {kind === "pen" && <path d={strokePath(points, w, h)} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        </svg>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Comments

type Reply = NonNullable<CanvasComment["replies"]>[number];

const CommentNode = memo(function CommentNode({ id, data, selected }: NodeProps<FlowNode>) {
  const actions = useEditorActions();
  const { readOnly } = useEditorGlobals();
  const text = String(data.text ?? "");
  const replies = (data.replies as Reply[] | undefined) ?? [];
  const resolved = data.resolved === true;
  const [open, setOpen] = useState(() => focusOnMount.has(id));
  const [draft, setDraft] = useState("");
  const first = useRef<HTMLTextAreaElement>(null);
  useFocusOnMount(id, first);
  // Closing a comment nobody wrote anything in removes it.
  const close = () => {
    setOpen(false);
    if (!text.trim() && !replies.length) actions.remove(id);
  };
  const reply = () => {
    const t = draft.trim();
    if (!t) return;
    actions.update(id, { replies: [...replies, { id: newId("reply"), author: COMMENT_AUTHOR, text: t.slice(0, BOARD_LIMITS.commentText), at: Date.now() }].slice(-BOARD_LIMITS.replies) });
    setDraft("");
  };
  const count = (text.trim() ? 1 : 0) + replies.length;
  return (
    <div
      className="relative"
      data-testid={`canvas-comment-${id}`}
      onKeyDown={(e) => open && e.key === "Escape" && (e.stopPropagation(), close())}
      // Focus leaving the comment (a click on the board, another comment) closes it, and an empty one goes away. A
      // click on the card's own padding focuses React Flow's node wrapper: still inside. Switching apps isn't leaving.
      onBlur={(e) => {
        const inside = e.currentTarget.closest(".react-flow__node") ?? e.currentTarget;
        if (open && !inside.contains(e.relatedTarget as Node | null) && document.hasFocus()) close();
      }}
    >
      <button
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          "grid size-8 place-items-center rounded-full rounded-bl-none border-2 border-background text-[12px] font-semibold shadow-normal transition-transform hover:scale-105",
          resolved ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
        aria-label={resolved ? "Resolved comment" : `Comment${count > 1 ? `, ${count} messages` : ""}`}
        aria-expanded={open}
      >
        {resolved ? <Check className="size-3.5" /> : COMMENT_AUTHOR[0]}
      </button>
      {open && (
        <div className={cn("absolute top-0 left-10 w-72 animate-pop-in cursor-default rounded-xl border bg-popover p-3 text-popover-foreground shadow-strong", NO_DRAG)}>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="grid size-5 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{COMMENT_AUTHOR[0]}</span>
            <span className="font-medium">{String(data.author ?? COMMENT_AUTHOR)}</span>
            <span className="text-muted-foreground">{typeof data.at === "number" ? timeAgo(data.at) : "just now"}</span>
            {resolved && <span className="rounded-full bg-success/15 px-1.5 text-[10px] font-semibold text-success">Resolved</span>}
          </div>
          <textarea
            ref={first}
            value={text}
            onChange={(e) => actions.update(id, { text: e.target.value })}
            readOnly={readOnly}
            rows={2}
            maxLength={BOARD_LIMITS.commentText}
            placeholder="Add a comment"
            aria-label="Comment"
            className="mt-2 field-sizing-content max-h-40 min-h-12 w-full resize-none rounded-lg bg-muted px-2.5 py-2 text-[13px] leading-snug outline-none placeholder:text-subtle-foreground focus:ring-2 focus:ring-brand-faint"
          />
          {replies.length > 0 && (
            <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
              {replies.map((x) => (
                <li key={x.id} className="text-[13px] leading-snug">
                  <span className="font-medium">{x.author}</span> <span className="text-[11px] text-muted-foreground">{timeAgo(x.at)}</span>
                  <p className="break-words whitespace-pre-line">{x.text}</p>
                </li>
              ))}
            </ul>
          )}
          {!readOnly && text.trim() && (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") reply();
                e.stopPropagation();
              }}
              placeholder="Reply"
              aria-label="Reply"
              className="mt-2 h-8 w-full rounded-lg border bg-background px-2.5 text-[13px] outline-none focus:border-primary"
            />
          )}
          {!readOnly && (
            <div className="mt-2 flex items-center gap-1">
              <button
                onClick={() => actions.update(id, { resolved: !resolved })}
                disabled={!text.trim()}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent disabled:opacity-50"
              >
                {resolved ? <RotateCcw className="size-3" /> : <Check className="size-3" />} {resolved ? "Reopen" : "Resolve"}
              </button>
              <button onClick={() => actions.remove(id)} className="ml-auto grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Delete comment">
                <Trash2 className="size-3.5" />
              </button>
              <button onClick={close} className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-medium hover:bg-accent">
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const BOARD_NODE_TYPES = { group: GroupNode, shape: ShapeNode, comment: CommentNode } satisfies Record<BoardType, React.ComponentType<NodeProps<FlowNode>>>;
