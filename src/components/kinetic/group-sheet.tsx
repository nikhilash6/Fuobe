"use client";

import { X } from "lucide-react";
import { useMemo } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { clampRate, groupsOf, IDENTITY_KEYS, rateLimits, shapeKeys, shotWindows, SHAPES, type WarpKeys } from "@/lib/motion/edit";
import { groupDefsFor } from "@/lib/motion/kinetic-groups";
import { setPro, type KineticDoc } from "@/lib/motion/kinetic-doc";
import type { GroupTiming, Recipe } from "@/lib/motion/recipe";
import type { ScenePlan } from "@/lib/motion/scene";
import { cn } from "@/lib/utils";
import { iconButton, sheetClass, SliderField } from "./controls";
import { CurveGraph } from "./curve-graph";
import type { KineticEditor } from "./use-editor";

/**
 * One motion group's timing: its curve (a retiming of its own clock, not a second easing) and its rate. The rate's
 * range is held so the group stays inside its shot and a second before the last frame. Opening or closing the sheet
 * changes nothing; every edit is one undo step. The preview stays in view while it is open: from 1024 px it sits in the
 * right-hand panel (`inline`), and on phones it is a half-height sheet with no overlay under a smaller preview.
 */

/** The recipe without any group timing: the scene's own clock, which the rate limits are measured on. */
export const untimed = (r: Recipe): Recipe => {
  const out = { ...r };
  delete out.groups;
  return out;
};

/** The zoom of a plan's camera at 60 times (the Camera group's sampled line). */
function sampledZoom(plan: ScenePlan, a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 60; i++) {
    const list = plan.evaluate(a + ((b - a) * i) / 59);
    const cam = list.nodes.find((n) => n.type === "group" && n.id === "camera");
    const m = cam && cam.type === "group" ? cam.transform : undefined;
    out.push(m ? Math.hypot(m[0], m[1]) : 1);
  }
  return out;
}

export function GroupSheet({
  open,
  onClose,
  groupId,
  doc,
  editor,
  side,
  planWith,
  inline,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string | null;
  doc: KineticDoc;
  editor: Pick<KineticEditor, "apply" | "end">;
  side: "bottom" | "right";
  planWith: (r: Recipe) => ScenePlan | null;
  inline?: boolean;
}) {
  const r = doc.recipe;
  const untimedKey = JSON.stringify(untimed(r));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => (open ? planWith(untimed(r)) : null), [open, untimedKey, planWith]);
  const info = useMemo(() => {
    if (!base || !groupId) return null;
    const windows = shotWindows(base);
    const g = groupsOf(groupDefsFor(r.scene), base.timeline.events, windows).find((x) => x.id === groupId);
    if (!g) return null;
    const limits = rateLimits(g, windows, base.rest);
    const [a, b] = windows[g.window] ?? [0, base.rest];
    return {
      g,
      limits,
      under: g.camera ? sampledZoom(base, a, b) : undefined,
      shots: windows.length,
    };
  }, [base, groupId, r.scene]);
  const timing: GroupTiming = (groupId && r.groups?.[groupId]) || {
    keys: IDENTITY_KEYS,
    rate: 1,
  };
  const setTiming = (next: Partial<GroupTiming>, gesture = false) => {
    if (!groupId) return;
    editor.apply(
      (d) =>
        setPro(d, (rec) => ({
          ...rec,
          groups: {
            ...(rec.groups ?? {}),
            [groupId]: {
              ...timing,
              ...next,
              keys: (next.keys ?? timing.keys).map((k) => [k[0], k[1]] as [number, number]),
            },
          },
        })),
      { gesture },
    );
  };
  const atLimit = info && info.limits.min > 0.5 && timing.rate <= info.limits.min + 1e-9;
  const name = info?.g.label ?? "Timing";

  const closeButton = (
    <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
      <X className="size-4" />
    </button>
  );
  const controls = info && (
    <div className="min-w-0 space-y-4 px-4 pb-4">
      <CurveGraph
        keys={timing.keys as WarpKeys}
        onChange={(keys) => setTiming({ keys })}
        label={`${name} timing curve`}
        under={info.under}
        underLabel={info.g.camera ? "Sampled from the scene's camera (dashed)" : undefined}
      />
      <div className="flex min-w-0 flex-wrap gap-1.5" role="group" aria-label="Suggested shapes">
        {SHAPES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setTiming({ keys: shapeKeys(s.id) })}
            className="h-11 rounded-full bg-secondary px-3.5 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            {s.label}
          </button>
        ))}
      </div>
      <SliderField
        label="Speed"
        display={(v) => `${v.toFixed(2)}x`}
        value={timing.rate}
        min={info.limits.min}
        max={info.limits.max}
        step={0.01}
        disabled={info.limits.min >= info.limits.max}
        onChange={(v) => setTiming({ rate: clampRate(v, info.limits) }, true)}
        onEnd={editor.end}
        note={atLimit ? "As slow as it can go here" : info.g.camera ? "The camera can run quicker, never slower." : undefined}
      />
      <button
        type="button"
        onClick={() => setTiming({ keys: IDENTITY_KEYS, rate: 1 })}
        className="h-11 w-full rounded-full border text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        Reset timing
      </button>
    </div>
  );

  if (inline) {
    if (!open) return null;
    return (
      <section aria-labelledby="kinetic-group-title" className="min-w-0" data-kinetic-sheet="group">
        <div className="flex items-start gap-2 px-4 pt-3 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id="kinetic-group-title" className="text-[16px] font-semibold">
              {name}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {info?.g.camera ? "Sampled from the scene's camera. The camera still comes to rest on the last frame." : "Retimes this part's own clock. Cuts, words and length stay as they are."}
            </p>
          </div>
          {closeButton}
        </div>
        {controls}
      </section>
    );
  }

  return (
    // No overlay and no focus trap: the preview above stays live while the timing changes (Escape or Close shut it).
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} modal={false}>
      <SheetContent
        side={side}
        showCloseButton={false}
        className={cn(sheetClass, "max-h-[50svh] shadow-[0_-8px_30px_rgb(0_0_0/0.18)]")}
        data-kinetic-sheet="group"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="flex-row items-start gap-2 pb-3">
          <div className="min-w-0 flex-1">
            <SheetTitle>{name}</SheetTitle>
            <SheetDescription className="text-[13px]">
              {info?.g.camera ? "Sampled from the scene's camera. The camera still comes to rest on the last frame." : "Retimes this part's own clock. Cuts, words and length stay as they are."}
            </SheetDescription>
          </div>
          {closeButton}
        </SheetHeader>
        {controls}
      </SheetContent>
    </Sheet>
  );
}
