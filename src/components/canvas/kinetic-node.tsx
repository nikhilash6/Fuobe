"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, Loader2, Play } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { renderKineticClip } from "@/components/kinetic/jobs";
import { MotionPlayer, useMotionInputs, usePlan, useScene } from "@/components/motion/player";
import { saveMotionResult } from "@/components/motion/save";
import { askToSignUp, useIsGuest } from "@/lib/api";
import { ancestors, descendants, tableRows, type Canvas, type CanvasGraph, type CanvasNode, type CanvasNodeData } from "@/lib/catalog/canvas";
import type { Generation } from "@/lib/catalog/types";
import { KINETIC_SCENES, entryBySlug, entryForRecipe, kineticHref, startRecipe, templateOf } from "@/lib/motion/kinetic-catalog";
import { DEFAULT_CLIP, docFiles, docWords } from "@/lib/motion/kinetic-doc";
import { recipeKey, type Recipe } from "@/lib/motion/recipe";
import { SIZE_LABELS } from "@/lib/motion/sizes";
import { templateSizes } from "@/lib/motion/template";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import { useEditorActions, useEditorGlobals, useEditorSnapshot } from "./canvas-context";

/**
 * The Canvas "Kinetic" node: a Kinetic Motion scene filled from what feeds it (a Text prompt fills the first field; a
 * Table fills field 1 from column 1, field 2 from column 2… and renders once per row), with a picture (the product, else
 * the logo) and a clip under the words where the scene takes one. It renders in this tab, one row at a time, saves each
 * row as a result, and records the run on the canvas for the Output nodes it feeds. A row whose recipe and result are
 * unchanged is kept.
 */

/** Its run starts on Run all too: the editor sends this event after it starts the server's part of the run. */
export const KINETIC_RUN_EVENT = "fuobe:kinetic-run";
export const KINETIC_ROWS_MAX = 50;

const KINETIC_FEATURE = "kinetic-canvas";

/** Kinetic nodes in a tab render one after another (each holds an encoder and a video while it renders). */
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const next = turn.then(fn, fn);
  turn = next.catch(() => undefined);
  return next;
}

/** The node's recipe (a fresh one opens Big Number's showcase). */
export const nodeRecipe = (d: CanvasNodeData): Recipe => d.kinetic ?? startRecipe(entryBySlug("big-number")!);

interface Feeds {
  /** Rows of words (one row for a Text prompt). */
  rows: string[][];
  /** The table's columns, when a table feeds it. */
  columns: string[] | null;
  image: string | null;
  video: string | null;
  /** Upstream nodes still making something. */
  waiting: boolean;
}

/** What feeds the node now: its words, its picture and its clip (from input nodes, or from what other nodes made). */
export function feedsOf(graph: CanvasGraph, id: string, resultOf: (nodeId: string) => { url: string; kind: string; text?: string; busy: boolean } | null): Feeds {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const into = graph.edges.filter((e) => e.target === id);
  const src = (port: string) =>
    into
      .filter((e) => e.targetHandle === port)
      .map((e) => nodes.get(e.source))
      .filter((n): n is CanvasNode => !!n);
  let rows: string[][] = [];
  let columns: string[] | null = null;
  let waiting = false;
  const texts: string[] = [];
  for (const n of src("prompt")) {
    if (n.type === "table") {
      rows = tableRows(n);
      columns = n.data.columns ?? null;
    } else if (n.type === "prompt") texts.push(n.data.text ?? "");
    else {
      const r = resultOf(n.id);
      if (r?.busy) waiting = true;
      if (r?.text) texts.push(r.text);
    }
  }
  if (!rows.length && texts.some((t) => t.trim())) rows = [[texts.join(" ").trim()]];
  const media = (port: string, kind: string): string | null => {
    const n = src(port)[0];
    if (!n) return null;
    if (n.data.url && n.type === `${kind}-input`) return n.data.url;
    const r = resultOf(n.id);
    if (r?.busy) waiting = true;
    return r && r.kind === kind ? r.url : null;
  };
  return {
    rows,
    columns,
    image: media("images", "image"),
    video: media("video", "video"),
    waiting,
  };
}

/** The recipe of one row: its words in the fields by column, its picture and its clip. */
export function rowRecipe(base: Recipe, cells: string[] | null, image: string | null, video: string | null): Recipe {
  const entry = entryForRecipe(base);
  const t = entry ? templateOf(entry) : undefined;
  const fields = { ...base.fields };
  if (cells && t?.fields)
    t.fields.forEach((f, i) => {
      const v = (cells[i] ?? "").slice(0, f.max);
      if (v.trim()) fields[f.key] = v;
      else if (i < cells.length) delete fields[f.key];
    });
  const r: Recipe = { ...base, fields };
  if (image?.startsWith("/api/files/")) {
    if (t?.picture === "product") r.media = { ...(r.media ?? {}), product: image };
    else r.brand = { ...r.brand, logo: image };
  }
  if (video?.startsWith("/api/files/") && entry?.clip)
    r.layers = {
      ...(r.layers ?? {}),
      video: { ...(r.layers?.video ?? DEFAULT_CLIP), src: video },
    };
  return r;
}

const box = "h-11 w-full min-w-0 rounded-lg border bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring nodrag";

export function KineticNodeBody({ id, data }: { id: string; data: CanvasNodeData }) {
  const actions = useEditorActions();
  const { canvasId, readOnly } = useEditorGlobals();
  const snap = useEditorSnapshot();
  const guest = useIsGuest();
  const qc = useQueryClient();
  const recipe = nodeRecipe(data);
  const entry = entryForRecipe(recipe) ?? KINETIC_SCENES[1];
  const t = templateOf(entry);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState<{ row: number; of: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const inputs = useMotionInputs(recipe);
  const scene = useScene(recipe.scene);
  const plan = usePlan(scene, recipe, inputs);

  const resultOf = useCallback(
    (nodeId: string) => {
      const r = snap.views.get(nodeId)?.results;
      if (!r) return null;
      const o = r.outputs[0]?.o;
      return {
        url: o?.url ?? "",
        kind: o?.kind ?? "",
        text: o?.text,
        busy: r.state === "running" || r.state === "queued",
      };
    },
    [snap],
  );
  const feeds = useMemo(() => feedsOf(snap.graph, id, resultOf), [snap.graph, id, resultOf]);
  const set = (r: Recipe) => actions.update(id, { kinetic: r });
  // A node made before it had a recipe keeps the one it shows.
  useEffect(() => {
    if (!data.kinetic && !readOnly) actions.update(id, { kinetic: recipe });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latest = useRef({ feeds, recipe, snap });
  useEffect(() => {
    latest.current = { feeds, recipe, snap };
  });

  /**
   * Waits for what feeds the node: every upstream node this run started (`ran`) must show a finished result in the
   * board's snapshot, which updates a render after the run's response. An upstream node that fails, or a wait past
   * ten minutes, stops the run with a message instead of rendering with an old result.
   */
  const waitForFeeds = useCallback(
    async (ran: string[], errors: { nodeId: string }[], signal: AbortSignal) => {
      const up = ancestors(latest.current.snap.graph, [id]);
      if (errors.some((x) => up.has(x.nodeId))) throw new Error("A node that feeds Kinetic couldn't run, so Kinetic didn't render");
      const started = ran.filter((x) => up.has(x));
      // The snapshot catches up with the run's response on the next render.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const until = Date.now() + 10 * 60_000;
      for (;;) {
        if (signal.aborted) throw new DOMException("Stopped", "AbortError");
        const views = latest.current.snap.views;
        const states = started.map((x) => views.get(x)?.results.state ?? "idle");
        if (states.some((s) => s === "failed" || s === "canceled")) throw new Error("A node that feeds Kinetic didn't finish, so Kinetic didn't render");
        if (states.every((s) => s === "succeeded") && !latest.current.feeds.waiting) return;
        if (Date.now() > until) throw new Error("What feeds Kinetic is still running. Run it again when it's done.");
        await new Promise((r) => setTimeout(r, 500));
      }
    },
    [id],
  );

  const runRows = useCallback(
    async (o: { ran?: string[]; errors?: { nodeId: string }[] } = {}) => {
      if (guest) return askToSignUp("run");
      if (abort.current) return;
      const ctl = new AbortController();
      abort.current = ctl;
      const ids: string[] = [];
      const sigs: string[] = [];
      const failed: number[] = [];
      const made: { base: Recipe | null } = { base: null };
      try {
        setBusy({ row: 0, of: 0 });
        await waitForFeeds(o.ran ?? [], o.errors ?? [], ctl.signal);
        // One Kinetic node renders at a time in a tab (each holds an encoder and a video while it renders).
        await inTurn(async () => {
          const { feeds: f } = latest.current;
          const base = (made.base = latest.current.recipe);
          const rows = f.rows.length ? f.rows.slice(0, KINETIC_ROWS_MAX) : [null];
          if (f.rows.length > KINETIC_ROWS_MAX) toast(`Kinetic renders the first ${KINETIC_ROWS_MAX} rows`);
          const view = qc.getQueryData<{
            canvas: Canvas;
            generations: Generation[];
          }>(["canvases", canvasId]);
          const prev = view?.canvas.runs[id];
          const live = new Set((view?.generations ?? []).filter((g) => g.status === "succeeded").map((g) => g.id));
          const name = view?.canvas.name ?? "Canvas";
          toast("Keep this tab open while Kinetic renders");
          for (const [i, cells] of rows.entries()) {
            if (ctl.signal.aborted) throw new DOMException("Stopped", "AbortError");
            const r = rowRecipe(base, cells, f.image, f.video);
            const sig = recipeKey(r);
            // A row kept from the last run by what it was made from (so a row added above doesn't render them all again).
            const at = prev?.rowSigs?.indexOf(sig) ?? -1;
            const kept = at >= 0 ? prev?.rows?.[at] : undefined;
            if (kept && live.has(kept) && !ids.includes(kept)) {
              ids.push(kept);
              sigs.push(sig);
              continue;
            }
            setBusy({ row: i + 1, of: rows.length });
            try {
              const clip = await renderKineticClip(r, { signal: ctl.signal });
              const e = entryForRecipe(r) ?? KINETIC_SCENES[1];
              const words = docWords({ recipe: r, logo: r.brand.logo ?? null }, e);
              const g = await saveMotionResult(
                { blob: clip.blob, type: clip.type, poster: clip.poster },
                {
                  recipe: r,
                  feature: KINETIC_FEATURE,
                  title: `${name} · Kinetic · row ${i + 1}`,
                  prompt: words.prompt,
                  images: docFiles(r),
                },
              );
              ids.push(g.id);
              sigs.push(sig);
            } catch (e) {
              if ((e as Error).name === "AbortError") throw e;
              // A bad row (words too long, a clip that won't open) is skipped; the rest go on.
              failed.push(i + 1);
              toastError(e, `Row ${i + 1} didn't render`);
            }
          }
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") toastError(e, "Couldn't render this. Try again.");
      } finally {
        abort.current = null;
        setBusy(null);
        // What was made is kept on the canvas even when a row failed or the run was stopped.
        const base = made.base;
        if (ids.length && base) {
          try {
            const res = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/runs/${encodeURIComponent(id)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sig: recipeKey(base),
                ids,
                rows: ids,
                rowSigs: sigs,
              }),
            });
            if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't keep the run on this canvas");
            void qc.invalidateQueries({ queryKey: ["canvases", canvasId] });
            void qc.invalidateQueries({ queryKey: ["generations"] });
            if (!failed.length && !ctl.signal.aborted) toast.success(ids.length === 1 ? "Kinetic made 1 clip" : `Kinetic made ${ids.length} clips`);
            else if (failed.length) toast(`Kinetic made ${ids.length} of ${ids.length + failed.length} clips`);
          } catch (e) {
            toastError(e, "Couldn't keep the run on this canvas");
          }
        }
      }
    },
    [guest, qc, canvasId, id, waitForFeeds],
  );

  useEffect(() => {
    const on = (e: Event) => {
      const d = (
        e as CustomEvent<{
          canvasId: string;
          targets?: string[];
          ran?: string[];
          errors?: { nodeId: string }[];
        }>
      ).detail;
      if (d?.canvasId !== canvasId) return;
      const below = descendants(latest.current.snap.graph, [id]);
      if (!d.targets || d.targets.some((x) => x === id || below.has(x))) void runRows({ ran: d.ran, errors: d.errors });
    };
    window.addEventListener(KINETIC_RUN_EVENT, on);
    return () => window.removeEventListener(KINETIC_RUN_EVENT, on);
  }, [canvasId, id, runRows]);

  const fields = t.fields ?? [];
  const tableNote = feeds.columns
    ? fields
        .map((f, i) => `${feeds.columns?.[i] ?? `Column ${i + 1}`} → ${f.label}`)
        .slice(0, Math.max(1, Math.min(fields.length, feeds.columns.length)))
        .join(" · ")
    : null;
  return (
    <div className="space-y-2.5 p-3" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <div className="mx-auto w-full max-w-[200px]">
        <MotionPlayer plan={plan} sources={inputs.sources} size={recipe.size} duration={recipe.duration} fps={recipe.fps} label={`${entry.name} preview`} controls={false} active={hover} />
      </div>
      <label className="block text-[11px] font-medium text-muted-foreground">
        Scene
        <select
          value={entry.slug}
          disabled={readOnly}
          onChange={(e) => {
            const to = entryBySlug(e.target.value);
            if (to)
              set({
                ...startRecipe(to),
                brand: recipe.brand,
                size: templateSizes(templateOf(to)).includes(recipe.size as never) ? recipe.size : templateSizes(templateOf(to))[0],
              });
          }}
          className={cn(box, "mt-1")}
        >
          {KINETIC_SCENES.map((e) => (
            <option key={e.slug} value={e.slug}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => (busy ? abort.current?.abort() : void runRows())}
        className="nodrag flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        data-kinetic-node-run={id}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        {busy ? (busy.of ? `Rendering row ${busy.row} of ${busy.of}` : "Waiting for what feeds it…") : feeds.rows.length > 1 ? `Run ${Math.min(KINETIC_ROWS_MAX, feeds.rows.length)} rows` : "Run"}
      </button>
      {tableNote && <p className="text-[11px] text-muted-foreground">{tableNote}</p>}
      {feeds.video && !entry.clip && <p className="text-[11px] text-muted-foreground">This scene doesn&apos;t take a clip</p>}
      <details className="group/set rounded-lg border">
        <summary className="nodrag flex h-11 cursor-pointer list-none items-center justify-between rounded-lg px-2.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          Settings
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open/set:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="space-y-2.5 px-2.5 pb-2.5">
          {fields.map((f, i) => (
            <label key={f.key} className="block text-[11px] font-medium text-muted-foreground">
              {f.label}
              {feeds.rows.length > 0 && i < (feeds.columns?.length ?? 1) ? <span className="font-normal"> · from {feeds.columns ? (feeds.columns[i] ?? `column ${i + 1}`) : "the text"}</span> : null}
              <input
                value={recipe.fields[f.key] ?? ""}
                maxLength={f.max}
                disabled={readOnly}
                onChange={(e) =>
                  set({
                    ...recipe,
                    fields: { ...recipe.fields, [f.key]: e.target.value },
                  })
                }
                className={cn(box, "mt-1")}
              />
            </label>
          ))}
          {(t.easy ?? []).map((g) => (
            <label key={g.id} className="block text-[11px] font-medium text-muted-foreground">
              {g.label}
              <select
                value={g.scene ? (recipe.scene.split("/")[1] ?? g.choices[0].id) : String(recipe.controls?.[g.id] ?? g.choices[0].id)}
                disabled={readOnly}
                onChange={(e) =>
                  set(
                    g.scene
                      ? {
                          ...recipe,
                          scene: `${g.scene}/${e.target.value}`,
                          controls: {
                            ...recipe.controls,
                            [g.id]: e.target.value,
                          },
                        }
                      : {
                          ...recipe,
                          controls: {
                            ...recipe.controls,
                            [g.id]: e.target.value,
                          },
                        },
                  )
                }
                className={cn(box, "mt-1")}
              >
                {g.choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="block text-[11px] font-medium text-muted-foreground">
            Size
            <select
              value={typeof recipe.size === "string" ? recipe.size : templateSizes(t)[0]}
              disabled={readOnly}
              onChange={(e) => set({ ...recipe, size: e.target.value as Recipe["size"] })}
              className={cn(box, "mt-1")}
            >
              {templateSizes(t).map((s) => (
                <option key={s} value={s}>
                  {SIZE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <Link
            href={kineticHref(entry, entry.slug === "end-card" ? (recipe.scene.split("/")[1] ?? null) : null)}
            className="nodrag inline-flex h-11 items-center gap-1.5 rounded-lg text-[13px] font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open in Kinetic
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </details>
    </div>
  );
}
