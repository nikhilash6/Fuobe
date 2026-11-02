"use client";

import { ArrowRight, ChevronRight, Cloud, Cpu, Loader2, Plus, Workflow } from "lucide-react";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { StarterCard } from "@/components/starters/starter-card";
// Types only: the catalog (models, templates) stays on the server; the pages pass slim template cards.
import type { CanvasNodeType, Outline } from "@/lib/catalog/canvas";
import type { Engine } from "@/lib/catalog/types";
import type { TemplateCardData } from "@/lib/canvas-sections";
import { offered, type AccessSummary } from "@/lib/model-access";
import { templateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";
import { NodeIcon } from "./node-icon";

const BOX = { w: 280, h: 150 };

const BOX_COLOR: Partial<Record<CanvasNodeType, string>> = {
  prompt: "var(--chart-2)",
  table: "var(--chart-2)",
  "image-input": "var(--chart-5)",
  "video-input": "var(--chart-4)",
  "audio-input": "var(--chart-3)",
  element: "var(--chart-1)",
  output: "var(--muted-foreground)",
};

/** The board in miniature, for cards without a result to show; `labeled`: each box names its step. */
export function Schematic({ outline: o, className, labeled = false }: { outline: Outline; className?: string; labeled?: boolean }) {
  if (!o.boxes.length) {
    return (
      <div className={cn("grid size-full place-items-center text-subtle-foreground", className)}>
        <Workflow className="size-8" />
      </div>
    );
  }
  const xs = o.boxes.map((b) => b.x);
  const ys = o.boxes.map((b) => b.y);
  const pad = 80;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) + BOX.w + pad - minX;
  const h = Math.max(...ys) + BOX.h + pad - minY;
  return (
    <svg viewBox={`${minX} ${minY} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className={cn("size-full", className)} aria-hidden>
      {o.links.map(([a, b], i) => {
        const s = o.boxes[a];
        const t = o.boxes[b];
        const x1 = s.x + BOX.w;
        const y1 = s.y + BOX.h / 2;
        const x2 = t.x;
        const y2 = t.y + BOX.h / 2;
        const mx = (x1 + x2) / 2;
        return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="var(--border-strong)" strokeWidth={8} />;
      })}
      {o.boxes.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.y} width={BOX.w} height={BOX.h} rx={22} fill="var(--card)" stroke="var(--border-strong)" strokeWidth={4} />
          <rect x={b.x + 24} y={b.y + 28} width={44} height={44} rx={10} fill={BOX_COLOR[b.type] ?? "var(--primary)"} opacity={0.85} />
          {labeled && b.label ? (
            <text x={b.x + 24} y={b.y + 122} fontSize={34} fontWeight={500} fill="var(--foreground)">
              {b.label.length > 14 ? `${b.label.slice(0, 13)}…` : b.label}
            </text>
          ) : (
            <>
              <rect x={b.x + 84} y={b.y + 36} width={150} height={14} rx={7} fill="var(--muted-foreground)" opacity={0.35} />
              <rect x={b.x + 24} y={b.y + 94} width={220} height={12} rx={6} fill="var(--muted-foreground)" opacity={0.18} />
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

/** A starter's steps as a few words on dark glass ("Photo › Scene › Film"), over its cover's corner. */
export function StepFlow({ steps, className }: { steps: string[]; className?: string }) {
  return (
    <span className={cn("pointer-events-none inline-flex items-center gap-0.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] leading-5 font-medium text-white backdrop-blur-sm", className)} aria-hidden>
      {steps.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <ChevronRight className="size-3 opacity-70" />}
          {s}
        </Fragment>
      ))}
    </span>
  );
}

/** The model names a card shows as this install offers them: a model that is off shows the one its node falls back to. */
export function offeredNames({ models, ifOff }: TemplateCardData["byEngine"][Engine], access: AccessSummary | undefined, engine: Engine): string[] {
  if (!ifOff || !access) return models;
  return [...new Set(models.map((m) => ifOff.find((x) => x.name === m && !offered(access, x.id, engine))?.instead ?? m))];
}

/** The owner's line under a card or a template's steps: the models it runs on, and free on the owner's GPU. */
export function ModelLine({ t, engine, access, className }: { t: TemplateCardData; engine: Engine; access?: AccessSummary; className?: string }) {
  const models = offeredNames(t.byEngine[engine], access, engine);
  return (
    <p className={cn("flex items-start gap-1.5 text-[12px] text-muted-foreground", className)}>
      {engine === "open" ? <Cpu className="mt-px size-3.5 shrink-0" /> : <Cloud className="mt-px size-3.5 shrink-0" />}
      <span className="line-clamp-2">
        {models.join(" · ")}
        {engine === "open" && " · free on your GPU"}
      </span>
    </p>
  );
}

/**
 * A Canvas template as a starter card. Everyone opens its page from the card; the owner makes the board from it in
 * one tap (onUse) and sees what it runs on, and "No cover yet" on a card that visitors don't get to see.
 */
export function TemplateCard({ t, engine, onUse, busy, access, owner = false }: { t: TemplateCardData; engine: Engine; onUse?: () => void; busy: boolean; access?: AccessSummary; owner?: boolean }) {
  const cover = templateCover("canvas", t.id);
  const { outline } = t.byEngine[engine];
  return (
    <StarterCard
      coverKey={`canvas/${t.id}`}
      cover={cover}
      hue={t.hue}
      flow={<StepFlow steps={t.flow} />}
      overlay={<Schematic outline={outline} className="p-4" />}
      icon={<NodeIcon name={t.icon} className="size-4" />}
      title={t.name}
      description={t.description}
      href={`/canvas/start/${t.id}`}
      meta={owner ? <ModelLine t={t} engine={engine} access={access} /> : undefined}
      badge={owner && !cover ? "No cover yet" : undefined}
      action={
        onUse ? (
          <Button size="sm" className="w-fit rounded-full" onClick={onUse} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} Use template
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground">
            See how it works <ArrowRight className="size-3.5 transition-transform group-hover/starter:translate-x-0.5" />
          </span>
        )
      }
    />
  );
}
