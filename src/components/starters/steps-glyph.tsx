import { cn } from "@/lib/utils";

const BOX = { w: 280, h: 150, gap: 120 };
const TONES = ["var(--chart-2)", "var(--chart-5)", "var(--chart-4)", "var(--chart-3)", "var(--chart-1)", "var(--primary)"];

/**
 * A starter's steps in miniature, for a card that has no cover yet (the owner's only): one rounded box per step, joined
 * by the same curves as a Canvas board's schematic, drawn from the step count.
 */
export function StepsGlyph({ steps, className }: { steps: number; className?: string }) {
  const n = Math.max(2, Math.min(6, steps));
  const w = n * BOX.w + (n - 1) * BOX.gap;
  const pad = 80;
  // Every other box a little lower, so the line reads as a flow.
  const y = (i: number) => (i % 2 ? 90 : 0);
  return (
    <svg viewBox={`${-pad} ${-pad} ${w + pad * 2} ${BOX.h + 90 + pad * 2}`} preserveAspectRatio="xMidYMid meet" className={cn("size-full", className)} aria-hidden>
      {Array.from({ length: n - 1 }, (_, i) => {
        const x1 = i * (BOX.w + BOX.gap) + BOX.w;
        const x2 = x1 + BOX.gap;
        const y1 = y(i) + BOX.h / 2;
        const y2 = y(i + 1) + BOX.h / 2;
        const mx = (x1 + x2) / 2;
        return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="var(--border-strong)" strokeWidth={8} />;
      })}
      {Array.from({ length: n }, (_, i) => {
        const x = i * (BOX.w + BOX.gap);
        return (
          <g key={i}>
            <rect x={x} y={y(i)} width={BOX.w} height={BOX.h} rx={22} fill="var(--card)" stroke="var(--border-strong)" strokeWidth={4} />
            <rect x={x + 24} y={y(i) + 28} width={44} height={44} rx={10} fill={TONES[i % TONES.length]} opacity={0.85} />
            <rect x={x + 84} y={y(i) + 36} width={150} height={14} rx={7} fill="var(--muted-foreground)" opacity={0.35} />
            <rect x={x + 24} y={y(i) + 94} width={220} height={12} rx={6} fill="var(--muted-foreground)" opacity={0.18} />
          </g>
        );
      })}
    </svg>
  );
}
