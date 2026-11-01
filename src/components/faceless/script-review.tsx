"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Check, Info, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { blockId, formatLength, secondsFor, splitScript, tooLong, totalSeconds, wordCount, type EpisodeView, type ScriptBlock } from "@/lib/catalog/faceless";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { EstimateLine } from "./controls";
import { useEpisodeAction, useEstimate, useUpdateEpisode } from "./hooks";

const field = "w-full resize-none rounded-lg border bg-background px-2.5 py-2 text-[14px] leading-relaxed outline-none transition-colors [field-sizing:content] focus:border-primary placeholder:text-subtle-foreground";

/** A save waits this long after the last keystroke. */
const SAVE_MS = 900;
/** Browsers send a request as the page goes away (keepalive) only when its body is under 64 KB. */
const KEEPALIVE_MAX = 60_000;

const payload = (bs: ScriptBlock[]) => ({ blocks: bs.map(({ id, narration, visual, motion }) => ({ id, narration, visual, motion })) });
/** What the server may change on save: lines too long for one scene become several. */
const shape = (bs: Pick<ScriptBlock, "id" | "narration">[]) => bs.map((b) => `${b.id}:${b.narration.trim().replace(/\s+/g, " ")}`).join("|");

function SceneCard({
  block,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  onAdd,
}: {
  block: ScriptBlock;
  index: number;
  count: number;
  onChange: (p: Partial<ScriptBlock>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onAdd: () => void;
}) {
  const long = tooLong(block.narration);
  const secs = secondsFor(block.narration);
  const pieces = long ? splitScript(block.narration).length : 1;
  return (
    <li className="group/scene rounded-2xl border bg-background p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted font-mono text-[12px] font-semibold">{index + 1}</span>
        <span className={cn("font-mono text-[12px] tabular-nums", long ? "text-warning" : "text-muted-foreground")}>
          ≈ {secs} s · {wordCount(block.narration)} words
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move scene ${index + 1} up`}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move scene ${index + 1} down`}>
            <ArrowDown />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onAdd} aria-label={`Add a scene after scene ${index + 1}`}>
            <Plus />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={count === 1} onClick={onRemove} aria-label={`Delete scene ${index + 1}`}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <label className="block min-w-0 space-y-1">
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Narration</span>
          <textarea value={block.narration} onChange={(e) => onChange({ narration: e.target.value })} rows={3} maxLength={2000} className={field} placeholder="What the narrator says over this scene" />
          {long && (
            <span className="flex items-center gap-1 text-[12px] text-warning">
              <AlertTriangle className="size-3" /> More than 10 seconds — it&apos;ll be split into {pieces} scenes.
            </span>
          )}
        </label>
        <div className="min-w-0 space-y-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Picture</span>
            <textarea value={block.visual} onChange={(e) => onChange({ visual: e.target.value })} rows={2} maxLength={1200} className={cn(field, "text-[13px]")} placeholder="What the picture shows" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Movement</span>
            <input value={block.motion} onChange={(e) => onChange({ motion: e.target.value })} maxLength={400} className={cn(field, "h-9 py-0 text-[13px]")} placeholder="e.g. slow push-in, leaves drift" />
          </label>
        </div>
      </div>
    </li>
  );
}

/**
 * Review the script before anything renders: every scene's narration, picture and movement, editable,
 * reorderable; saved as you type (and on the way out of the page). Render starts the whole episode.
 */
export function ScriptReview({ view }: { view: EpisodeView }) {
  const ep = view.episode;
  const [blocks, setBlocks] = useState<ScriptBlock[]>(ep.script.blocks);
  const [dirty, setDirty] = useState(false);
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  const update = useUpdateEpisode(ep.id);
  const action = useEpisodeAction(ep.id);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(blocks);
  /** An edit not sent yet, and a counter of edits (a save only applies the server's split when none came after it). */
  const pending = useRef(false);
  const edits = useRef(0);
  /** The server split a scene while one was being typed in: shown once the list loses focus. */
  const deferred = useRef<{ blocks: ScriptBlock[]; at: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const estimate = useEstimate({ kind: ep.kind, settings: ep.settings, blocks });

  // A rewrite brings a new script.
  const scriptKey = ep.script.blocks.map((b) => b.id).join("|");
  const seen = useRef(scriptKey);
  useEffect(() => {
    if (seen.current === scriptKey || dirty) return;
    seen.current = scriptKey;
    setBlocks(ep.script.blocks);
    latest.current = ep.script.blocks;
  }, [scriptKey, dirty, ep.script.blocks]);

  const show = (bs: ScriptBlock[]) => {
    setBlocks(bs);
    latest.current = bs;
  };

  const save = async (bs = latest.current) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = false;
    const at = edits.current;
    const v = await update.mutateAsync(payload(bs));
    const saved = v.episode.script.blocks;
    seen.current = saved.map((b) => b.id).join("|");
    if (edits.current === at) {
      setDirty(false);
      // Show what the server made of it (a long line split into scenes), unless a scene is being typed in.
      if (shape(saved) !== shape(bs)) {
        if (list.current?.contains(document.activeElement)) deferred.current = { blocks: saved, at };
        else show(saved);
      }
    }
    return v;
  };

  const edit = (next: ScriptBlock[]) => {
    show(next);
    setDirty(true);
    pending.current = true;
    edits.current++;
    deferred.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save().catch((e) => toastError(e)), SAVE_MS);
  };

  // Leaving with an edit not saved yet (Back, another page, closing the tab): send it now, in a request that outlives the page.
  const flush = useCallback(() => {
    if (!pending.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = false;
    const body = JSON.stringify(payload(latest.current));
    void fetch(`/api/faceless/episodes/${ep.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < KEEPALIVE_MAX }).catch(() => {});
  }, [ep.id]);
  useEffect(() => {
    const hidden = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
      flush();
    };
  }, [flush]);

  const change = (i: number, p: Partial<ScriptBlock>) => edit(blocks.map((b, j) => (j === i ? { ...b, ...p, ...(p.narration !== undefined && { seconds: secondsFor(p.narration) }) } : b)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...blocks];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    edit(next);
  };

  const render = async () => {
    try {
      if (dirty) show((await save()).episode.script.blocks);
      await action.mutateAsync("render");
    } catch (e) {
      toastError(e);
    }
  };

  const rewrite = () => {
    // Nothing waiting to save would come back over the new script.
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = false;
    setDirty(false);
    action.mutate("rewrite", { onError: (e) => toastError(e) });
  };

  const seconds = totalSeconds(blocks.map((b) => ({ seconds: secondsFor(b.narration) })));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-[26px] leading-tight">Review the script</h2>
          <p className="text-[13px] text-muted-foreground">Edit any scene before it renders. Each scene is about 10 seconds of narration with its own picture.</p>
        </div>
        <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => setConfirmRewrite(true)}>
          <Wand2 /> Write it again
        </Button>
      </div>
      {ep.script.offline && (
        <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" /> {ep.script.note}
        </p>
      )}
      {ep.error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> {ep.error}
        </p>
      )}
      <ol
        ref={list}
        className="space-y-3"
        aria-label="Scenes"
        onBlur={(e) => {
          // Typing is over: show the split the last save made.
          const d = deferred.current;
          if (!d || list.current?.contains(e.relatedTarget as Node | null)) return;
          deferred.current = null;
          if (d.at === edits.current) show(d.blocks);
        }}
      >
        {blocks.map((b, i) => (
          <SceneCard
            key={b.id}
            block={b}
            index={i}
            count={blocks.length}
            onChange={(p) => change(i, p)}
            onMove={(d) => move(i, d)}
            onRemove={() => edit(blocks.filter((_, j) => j !== i))}
            onAdd={() => edit([...blocks.slice(0, i + 1), { id: blockId(), narration: "", visual: "", motion: "", seconds: 4 }, ...blocks.slice(i + 1)])}
          />
        ))}
      </ol>
      <div className="sticky bottom-0 z-10 -mx-3 border-t bg-background/90 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" aria-live="polite">
            {update.isPending ? <Loader2 className="size-3 animate-spin" /> : dirty ? null : <Check className="size-3" />}
            {update.isPending ? "Saving…" : dirty ? "Unsaved" : "Saved"}
          </span>
          <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{formatLength(seconds)}</span>
          <EstimateLine data={estimate.data} loading={estimate.isFetching} engine={ep.settings.engine} className="min-w-0 flex-1" />
          <Button onClick={() => void render()} disabled={action.isPending || update.isPending} className="rounded-full">
            {action.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} Render episode
          </Button>
        </div>
      </div>
      <AlertDialog open={confirmRewrite} onOpenChange={setConfirmRewrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Write the script again?</AlertDialogTitle>
            <AlertDialogDescription>A new script replaces this one, with your edits to it. This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep this script</AlertDialogCancel>
            <AlertDialogAction onClick={rewrite}>Write it again</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
