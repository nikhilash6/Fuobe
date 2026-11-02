"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Cloud, Cpu } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import type { SkillSummary } from "@/lib/assist";
import type { ScheduleSkill } from "@/lib/assist-schedule";
import type { Engine } from "@/lib/catalog/types";
import { formatCost } from "@/lib/format";
import { checkValues, isMediaType, type RecipeEstimate, type RecipeParam, type RecipeView } from "@/lib/recipe";
import { cn } from "@/lib/utils";
import { useRecipeActions } from "./hooks";
import { RecipeField } from "./run-skill-dialog";
import { SkillIcon } from "./skill-icon";

/**
 * The schedule dialog's "A skill" (Skills W4): a skill that runs by itself, one set of values from its Run form, and
 * for each file input a picked file or the newest upload of that kind, read when the run starts.
 */

/** Where a file input comes from: the newest upload when it runs, one picked file, or none (the skill's default, if it has one). */
type Source = "newest" | "file" | "none";

/** What the form holds: values as typed (a picked file's URL too), the file slots, and where each file input comes from. */
export interface SkillInputs {
  values: Record<string, string | number | undefined>;
  slots: Record<string, SlotValue | null>;
  sources: Record<string, Source>;
}

/** The form for a saved task's skill, or an empty one. */
export const inputsFrom = (skill?: ScheduleSkill | null): SkillInputs => ({
  values: { ...(skill?.values ?? {}) },
  slots: {},
  sources: Object.fromEntries(Object.keys(skill?.sources ?? {}).map((id) => [id, "newest" as const])),
});

type FileParam = RecipeParam & { type: "image" | "video" | "audio" };

/** An input the skill can't run without: required, with no default of its own. */
const needed = (p: RecipeParam) => p.required && p.default === undefined;

/**
 * Where a file input comes from. One that holds a file keeps it. Otherwise an input the skill needs takes the newest
 * upload (only the first needed input of each kind, so two don't read the same file), and one it can do without, or
 * that has a default of its own, takes none.
 */
function sourceOf(p: RecipeParam, inputs: SkillInputs, params: RecipeParam[]): Source {
  const set = inputs.sources[p.id];
  if (set) return set;
  if (typeof inputs.values[p.id] === "string" && inputs.values[p.id]) return "file";
  if (!needed(p)) return "none";
  return params.find((q) => q.type === p.type && needed(q))?.id === p.id ? "newest" : "file";
}

const slotOf = (p: FileParam, inputs: SkillInputs): SlotValue | null => {
  if (p.id in inputs.slots) return inputs.slots[p.id];
  const v = inputs.values[p.id];
  return typeof v === "string" && v ? { ref: v, preview: v, kind: p.type } : null;
};

/** Stands in for a newest upload while the form is checked and priced (the real file is read when it runs). */
const NEWEST = { image: "/api/files/uploads/estimate/newest.png", video: "/api/files/uploads/estimate/newest.mp4", audio: "/api/files/uploads/estimate/newest.wav" } as const;

/** The task as it's saved, what's wrong with it per input, and the values it's priced with. */
export function skillTask(view: RecipeView, inputs: SkillInputs): { task: ScheduleSkill; errors: Record<string, string>; ok: boolean; uploading: boolean; priced: Record<string, string> } {
  const values: Record<string, string> = {};
  const sources: Record<string, "newest"> = {};
  const priced: Record<string, string> = {};
  let uploading = false;
  for (const p of view.recipe.params) {
    if (isMediaType(p.type)) {
      const source = sourceOf(p, inputs, view.recipe.params);
      if (source === "newest") {
        sources[p.id] = "newest";
        priced[p.id] = NEWEST[p.type];
        continue;
      }
      if (source === "none") continue;
      const slot = slotOf(p as FileParam, inputs);
      if (slot?.uploading) uploading = true;
      else if (slot?.ref) values[p.id] = priced[p.id] = slot.ref;
      continue;
    }
    const v = inputs.values[p.id];
    if (v !== undefined && String(v).trim() !== "") values[p.id] = priced[p.id] = String(v);
  }
  const checked = checkValues(view.recipe, priced);
  return { task: { name: view.name, values, ...(Object.keys(sources).length && { sources }) }, errors: checked.errors, ok: !!checked.values && !uploading, uploading, priced };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "About $0.62 a run on Cloud", "Free on your GPU", "Free: a demo run". */
function priceText(e: RecipeEstimate): string {
  if (e.demo) return "Free: a demo run, since nothing is connected for these steps yet";
  if (e.total === null) return "Some prices vary";
  const where = e.engine === "open" ? "on your GPU" : "on Cloud";
  return e.total === 0 ? `Free ${where}` : `About ${formatCost(e.total)} a run ${where}`;
}

export function SkillTaskFields({
  skills,
  name,
  onName,
  view,
  failed,
  inputs,
  onInputs,
  engine,
  onEngine,
  tried,
}: {
  /** The skills that run by themselves (null: still loading). */
  skills: SkillSummary[] | null;
  name: string | null;
  onName: (name: string) => void;
  /** The picked skill's recipe, once it's loaded. */
  view: RecipeView | undefined;
  /** Why the skill's recipe didn't load. */
  failed?: string;
  inputs: SkillInputs;
  onInputs: (next: SkillInputs) => void;
  /** The engine it runs on (one its steps run on). */
  engine: Engine;
  onEngine: (e: Engine) => void;
  tried: boolean;
}) {
  const pickId = useId();
  const actions = useRecipeActions();
  const t = view ? skillTask(view, inputs) : null;
  const body = t ? JSON.stringify({ values: t.priced, engine }) : "";
  const key = useDebounced(body, 400);
  const price = useQuery({
    queryKey: ["assist-recipe-estimate", name, "schedule", key],
    enabled: !!view && !!t?.ok && key === body && view.engines.includes(engine),
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => actions.estimate(view!.name, JSON.parse(key)),
  });
  const est = t?.ok ? price.data : undefined;
  const estError = t?.ok ? (price.error ? (price.error as Error).message : (est?.errors[0] ?? est?.runs.flatMap((r) => r.errors)[0])) : undefined;
  const listed = !!name && !!skills?.some((s) => s.name === name);
  const set = (patch: Partial<SkillInputs>) => onInputs({ ...inputs, ...patch });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor={pickId} className="text-sm font-medium">
          Skill
        </label>
        {skills === null ? (
          <Skeleton className="h-9 w-full" />
        ) : skills.length === 0 ? (
          <p className="rounded-xl bg-muted/60 px-3.5 py-2.5 text-[13px] text-muted-foreground">
            No skills that run by themselves yet. Make one from a result you like (its ⋯ menu → Make a skill), or save a chat as a skill, then schedule it here.{" "}
            <Link href="/assist/skills" className="font-medium text-brand-text underline-offset-2 hover:underline">
              Open Skills
            </Link>
          </p>
        ) : (
          <Select value={listed ? name! : undefined} onValueChange={onName}>
            <SelectTrigger id={pickId} className="w-full">
              <SelectValue placeholder="Pick a skill" />
            </SelectTrigger>
            <SelectContent>
              {skills.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  <SkillIcon name={s.name} icon={s.icon} size="sm" /> {s.title} <span className="text-muted-foreground">/{s.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {name && skills && !listed && (
          <p role="alert" className="flex items-start gap-1.5 text-[12px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> /{name} is switched off or doesn&apos;t run by itself any more — pick another skill.
          </p>
        )}
      </div>

      {listed && !view && (failed ? <p className="text-[13px] text-destructive">{failed}</p> : <Skeleton className="h-32 w-full" />)}

      {listed && view && (
        <>
          <p className="text-[12px] text-muted-foreground">No AI model plans these runs: each one starts {view.title}&apos;s saved steps with the inputs below.</p>
          {view.recipe.params.length === 0 && <p className="text-[13px] text-muted-foreground">It takes no inputs: each run makes the same steps.</p>}
          {view.recipe.params.map((p) =>
            isMediaType(p.type) ? (
              <FileInput
                key={p.id}
                p={p as FileParam}
                source={sourceOf(p, inputs, view.recipe.params)}
                onSource={(s) => set({ sources: { ...inputs.sources, [p.id]: s } })}
                slot={slotOf(p as FileParam, inputs)}
                onSlot={(v) => set({ slots: { ...inputs.slots, [p.id]: v } })}
                error={tried ? t?.errors[p.id] : undefined}
              />
            ) : (
              <RecipeField
                key={p.id}
                p={p}
                value={inputs.values[p.id] ?? p.default}
                onChange={(v) => set({ values: { ...inputs.values, [p.id]: v } })}
                slot={null}
                onSlot={() => {}}
                error={tried ? t?.errors[p.id] : undefined}
              />
            ),
          )}
          <div className="flex flex-wrap items-center gap-2">
            {view.engines.length > 1 ? (
              <EngineSwitch value={engine} onChange={onEngine} size="sm" compact={false} />
            ) : (
              view.engines.length === 1 && (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-[12px] font-medium text-muted-foreground">
                  {view.engines[0] === "open" ? <Cpu className="size-3.5" /> : <Cloud className="size-3.5" />}
                  {view.engines[0] === "open" ? "Runs on your GPU · open source" : "Runs in the cloud"}
                </span>
              )
            )}
            <p className={cn("min-w-0 text-[13px] break-words", estError ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
              {!view.engines.length
                ? (view.why ?? "This skill can't run here as it is.")
                : !t?.ok
                  ? t?.uploading
                    ? "Uploading…"
                    : "Fill in the inputs to see the price"
                  : (estError ?? (est && !price.isFetching && key === body ? priceText(est) : "Pricing…"))}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** A file input: the newest upload of its kind when the run starts, or one file picked now. */
function FileInput({
  p,
  source,
  onSource,
  slot,
  onSlot,
  error,
}: {
  p: FileParam;
  source: Source;
  onSource: (s: Source) => void;
  slot: SlotValue | null;
  onSlot: (v: SlotValue | null) => void;
  error?: string;
}) {
  const labelId = useId();
  const options: { id: Source; label: string }[] = [
    { id: "newest", label: "Newest upload (when it runs)" },
    { id: "file", label: "This file" },
    // An input the skill can do without: leave it out, or use the file the skill comes with.
    ...(needed(p) ? [] : [{ id: "none" as const, label: p.default !== undefined ? "The skill's own" : "None" }]),
  ];
  const kind = p.type === "image" ? "image" : p.type === "video" ? "video" : "audio file";
  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium">
        {p.label}
        {p.required && p.default === undefined ? "" : <span className="font-normal text-muted-foreground"> · optional</span>}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} onKeyDown={radioKeys} className="flex w-fit max-w-full flex-wrap gap-1 rounded-2xl bg-muted p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={source === o.id}
            tabIndex={radioTab(source === o.id)}
            onClick={() => onSource(o.id)}
            className={cn("h-8 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors", source === o.id && "bg-background text-foreground shadow-soft")}
          >
            {o.label}
          </button>
        ))}
      </div>
      {source === "newest" ? (
        <p className="text-[12px] text-muted-foreground">
          Each run takes the newest {kind} in{" "}
          <Link href="/library?tab=uploads" className="font-medium text-brand-text underline-offset-2 hover:underline">
            Library → Uploads
          </Link>{" "}
          at that moment, whatever put it there: upload a new one before it runs, and that&apos;s the one it takes.
          {needed(p) ? "" : p.default !== undefined ? ` With no ${kind} there yet, it uses the skill's own.` : ` With no ${kind} there yet, the run goes ahead without one.`}
        </p>
      ) : source === "none" ? (
        <p className="text-[12px] text-muted-foreground">{p.default !== undefined ? `Every run uses the skill's own ${kind}.` : "Every run goes without one."}</p>
      ) : (
        <div className="flex items-center gap-3">
          <MediaSlot label={p.label} kind={p.type} value={slot} onChange={onSlot} required={p.required} />
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">Every run uses this {p.type === "image" ? "picture" : p.type === "video" ? "clip" : "sound file"}. Upload one, or pick it from your Library.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[12px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
