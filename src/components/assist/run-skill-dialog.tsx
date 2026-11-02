"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Cloud, Cpu, FileUp, Info, Loader2, Minus, Play, Plus, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { useElements } from "@/lib/api";
import type { Engine } from "@/lib/catalog/types";
import { formatCost } from "@/lib/format";
import { checkValues, isMediaType, parseRows, RECIPE_LIMITS, type RecipeEstimate, type RecipeParam, type RecipeView } from "@/lib/recipe";
import { DEMO_NOTE } from "@/lib/recipe-builder";
import { cn } from "@/lib/utils";
import { refusalShown, toastError } from "@/lib/refusals";
import { useRecipe, useRecipeActions, useSkillActions, type RecipeFailure } from "./hooks";
import { PlanJobs } from "./plan-jobs";
import { SkillIcon } from "./skill-icon";

/**
 * Run a skill with new inputs (package W1): a form made from its recipe's inputs, priced live before it runs, one
 * run or many from a pasted CSV, on an engine where the recipe was checked. No LLM: the server compiles the recipe.
 */
export function RunSkillDialog({ name, onClose, examples, intro }: { name: string | null; onClose: () => void; examples?: boolean; intro?: string }) {
  return (
    <Dialog open={!!name} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[min(94svh,900px)] flex-col gap-0 overflow-hidden p-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-full max-sm:rounded-none max-sm:ring-0 sm:max-w-[680px]">
        {name && <RunForm key={name} name={name} onClose={onClose} examples={examples} intro={intro} />}
      </DialogContent>
    </Dialog>
  );
}

/** `examples`: the form starts filled with the values the skill was made from (a skill just made: "Try it with new inputs"). */
function RunForm({ name, onClose, examples, intro }: { name: string; onClose: () => void; examples?: boolean; intro?: string }) {
  const view = useRecipe(name);
  if (view.data) return <Loaded view={view.data} onClose={onClose} examples={examples} intro={intro} />;
  return (
    <div className="space-y-3 p-6">
      <DialogTitle className="sr-only">Run a skill</DialogTitle>
      {view.isError ? (
        <>
          <p className="text-[14px] text-muted-foreground">{(view.error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      ) : (
        <Skeleton className="h-56" />
      )}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "$0.62 on Cloud", "Free on your GPU", "$12.40 for 20 runs", "Placeholder · free". */
function priceLine(e: RecipeEstimate | undefined, runs: number): string {
  if (!e) return "";
  if (e.demo) return `Placeholder · free${runs > 1 ? ` · ${runs} runs` : ""}`;
  if (e.total === null) return "Some prices vary";
  const where = e.engine === "open" ? "on your GPU" : "on Cloud";
  if (e.total === 0) return runs > 1 ? `Free · ${runs} runs ${where}` : `Free ${where}`;
  return runs > 1 ? `${formatCost(e.total)} for ${runs} runs ${where}` : `${formatCost(e.total)} ${where}`;
}

function Loaded({ view, onClose, examples, intro }: { view: RecipeView; onClose: () => void; examples?: boolean; intro?: string }) {
  const { recipe, name } = view;
  const actions = useRecipeActions();
  const skillActions = useSkillActions();
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<"one" | "many">("one");
  const [values, setValues] = useState<Record<string, string | number | undefined>>(() =>
    Object.fromEntries(recipe.params.map((p) => [p.id, examples && !isMediaType(p.type) && p.example !== undefined && p.example !== null ? p.example : p.default])),
  );
  const [slots, setSlots] = useState<Record<string, SlotValue | null>>(() =>
    examples ? Object.fromEntries(recipe.params.flatMap((p) => (isMediaType(p.type) && typeof p.example === "string" && p.example ? [[p.id, { ref: p.example, preview: p.example, kind: p.type }]] : []))) : {},
  );
  const [csv, setCsv] = useState("");
  const [engine, setEngine] = useState<Engine>(view.ready[0] ?? view.engines[0] ?? "cloud");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<"run" | "check" | "on" | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const ready = view.ready.includes(engine);
  const uploading = Object.values(slots).some((s) => s?.uploading);
  const form = useMemo(() => ({ ...values, ...Object.fromEntries(Object.entries(slots).map(([k, s]) => [k, s && !s.uploading ? s.ref : undefined])) }), [values, slots]);
  const checked = useMemo(() => checkValues(recipe, form), [recipe, form]);
  const rows = useMemo(() => (tab === "many" && csv.trim() ? parseRows(csv, recipe) : null), [tab, csv, recipe]);
  const rowsOk = !!rows && !rows.errors.length && rows.rows.length > 0 && rows.rows.every((r) => !r.errors.length);
  const runs = tab === "many" ? (rows?.rows.length ?? 0) : 1;
  const body = tab === "one" ? { values: checked.values ?? form, engine } : { csv, engine };
  const sent = JSON.stringify(body);
  const key = useDebounced(sent, 400);
  // The price on screen is for `key`: Run starts exactly that, and only once it is what the form says now.
  const fresh = key === sent;
  const canPrice = view.enabled && ready && !uploading && (tab === "one" ? !!checked.values : rowsOk);
  const estimate = useQuery({
    queryKey: ["assist-recipe-estimate", name, key],
    enabled: canPrice,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => actions.estimate(name, JSON.parse(key)),
  });
  const est = canPrice ? estimate.data : undefined;
  const estError = canPrice && estimate.error ? (estimate.error as Error).message : (est?.errors[0] ?? est?.runs.flatMap((r) => r.errors)[0]);
  const runnable = canPrice && fresh && !!est?.runnable && !estimate.isFetching;
  const recheck = view.recheck[engine];

  const check = async () => {
    setBusy("check");
    setProblems([]);
    try {
      const r = await actions.verify(name);
      const passed = r.engines.filter((e) => e.plan.ok && (e.dryRun?.ok ?? true)).map((e) => (e.engine === "cloud" ? "Cloud" : "your GPU"));
      if (r.ok) toast.success(`Checked — it runs on ${passed.join(" and ")}`, { description: "Priced, and run once on the demo provider for free." });
      else {
        const why = r.engines.flatMap((e) => [...e.plan.errors, ...(e.dryRun?.problems ?? [])]);
        setProblems(why);
        toast.error(passed.length ? `It runs on ${passed.join(" and ")} only` : "The check didn't pass", { description: why[0] });
      }
      const next = r.view.ready;
      if (next.length && !next.includes(engine)) setEngine(next[0]);
    } catch (e) {
      const f = e as RecipeFailure;
      if (refusalShown(f)) return;
      setProblems(f.problems ?? [f.message]);
      toast.error(f.message);
    } finally {
      setBusy(null);
    }
  };

  const switchOn = async () => {
    setBusy("on");
    try {
      await skillActions.toggle(name, true);
      await qc.invalidateQueries({ queryKey: ["assist-recipe", name] });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setTried(true);
    if (!runnable) return;
    setBusy("run");
    try {
      // What was priced (the debounced key), which `fresh` says is what the form holds.
      const r = await actions.run(name, JSON.parse(key) as typeof body);
      const started = r.runs.filter((x) => !x.error);
      const failed = r.runs.filter((x) => x.error);
      const href = started[0]?.href ?? "/library";
      const studio = href.startsWith("/library") ? "Library" : href.startsWith("/video-tools/captions") ? "Captions" : "the studio";
      const title = failed.length ? `Started ${started.length} of ${r.runs.length} runs` : started.length > 1 ? `Started ${started.length} runs` : "Started the run";
      (failed.length ? toast.warning : toast.success)(title, {
        description: failed.length ? failed[0].error : r.demo ? "A demo run — no provider connected" : `${view.title}: same steps, new take`,
        action: { label: `Open in ${studio}`, onClick: () => router.push(href) },
      });
      onClose();
    } catch (e) {
      const f = e as RecipeFailure;
      if (refusalShown(f)) return;
      setProblems(f.problems ?? [f.message]);
      toast.error(f.message);
    } finally {
      setBusy(null);
    }
  };

  const price = !ready ? "" : estError ? "" : !fresh || estimate.isFetching ? "Pricing…" : priceLine(est, runs);
  return (
    <>
      <DialogHeader className="flex-row items-start gap-3 border-b px-5 pt-5 pb-4 text-left">
        <SkillIcon name={name} icon={view.icon} size="lg" />
        <div className="min-w-0 flex-1 pr-6">
          <DialogTitle className="font-heading text-[24px] leading-tight font-normal">Run {view.title}</DialogTitle>
          <DialogDescription className="mt-1">{intro ?? "Same steps, new inputs. Priced before anything starts; no chat needed."}</DialogDescription>
        </div>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {!view.enabled ? (
          <Notice
            tone="warn"
            action={
              <Button size="sm" variant="outline" onClick={() => void switchOn()} disabled={busy !== null}>
                {busy === "on" ? <Loader2 className="animate-spin" /> : null} Switch it on
              </Button>
            }
          >
            This skill is switched off: switch it on to run it.
          </Notice>
        ) : view.why ? (
          <Notice tone="warn">{view.why}</Notice>
        ) : !view.ready.length ? (
          <div className="flex flex-col gap-3 rounded-xl bg-muted/60 px-4 py-3 sm:flex-row sm:items-center">
            <ShieldCheck className="size-5 shrink-0 text-brand-text" />
            <p className="min-w-0 flex-1 text-[13px]">
              <span className="font-medium">Check it once first — it&apos;s free.</span> <span className="text-muted-foreground">Fuobe prices every step and runs it on the demo provider, so you know it works before you spend anything.</span>
            </p>
            <Button size="sm" onClick={() => void check()} disabled={busy !== null}>
              {busy === "check" ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Check it (free)
            </Button>
          </div>
        ) : recheck?.length ? (
          <Notice tone="warn" action={<Button size="sm" variant="outline" onClick={() => void check()} disabled={busy !== null}>{busy === "check" ? <Loader2 className="animate-spin" /> : null} Re-check</Button>}>
            Needs a re-check: {recheck[0]}
          </Notice>
        ) : null}
        {recipe.source?.demo && !Object.values(recipe.verified ?? {}).some((v) => v?.real) && <Notice tone="info">{DEMO_NOTE}.</Notice>}
        {problems.length > 0 && (
          <div role="alert" className="space-y-1 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {problems.slice(0, 6).map((p, i) => (
              <p key={i} className="flex items-start gap-2 break-words">
                <X className="mt-0.5 size-3.5 shrink-0" /> {p}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="one" className="px-3">
                One
              </TabsTrigger>
              <TabsTrigger value="many" className="px-3">
                Many
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {view.ready.length > 1 ? (
            <EngineSwitch value={engine} onChange={setEngine} size="sm" compact={false} />
          ) : (
            view.engines.length > 0 && (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-[12px] font-medium text-muted-foreground">
                {(view.ready[0] ?? view.engines[0]) === "open" ? <Cpu className="size-3.5" /> : <Cloud className="size-3.5" />}
                {(view.ready[0] ?? view.engines[0]) === "open" ? "Runs on your GPU · open source" : "Runs in the cloud"}
              </span>
            )
          )}
        </div>
        {tab === "one" ? (
          <div className="space-y-4">
            {recipe.params.length === 0 && <p className="text-[13px] text-muted-foreground">This skill takes no inputs: it runs the same steps each time.</p>}
            {recipe.params.map((p) => (
              <Field
                key={p.id}
                p={p}
                value={values[p.id]}
                onChange={(v) => setValues((x) => ({ ...x, [p.id]: v }))}
                slot={slots[p.id] ?? null}
                onSlot={(v) => setSlots((x) => ({ ...x, [p.id]: v }))}
                error={tried ? checked.errors[p.id] : undefined}
              />
            ))}
          </div>
        ) : (
          <Many recipeParams={recipe.params} csv={csv} setCsv={setCsv} parsed={rows} name={name} />
        )}
        {ready && (est?.jobs.length ?? 0) > 0 && (
          <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-xl border">
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium hover:bg-accent">
              What runs
              <span className="font-normal text-muted-foreground">
                · {est!.jobs.length} step{est!.jobs.length === 1 ? "" : "s"}
                {runs > 1 ? ` × ${runs} runs` : ""}
              </span>
              <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t">
              <PlanJobs jobs={est!.jobs} />
              {(est?.place?.studio || est?.place?.fallback || view.models.some((m) => m.engine === engine)) && (
                <div className="space-y-1 border-t px-4 py-2.5 text-[12px] text-muted-foreground">
                  {est?.place?.studio && <p>Opens in {est.place.studio}, where you can keep working on it.</p>}
                  {est?.place?.fallback && <p>{est.place.fallback}.</p>}
                  {view.models.filter((m) => m.engine === engine).length > 0 && (
                    <p>
                      Turn models on or off in{" "}
                      <Link href="/settings/models" className="underline underline-offset-2">
                        Models &amp; licences
                      </Link>
                      .
                    </p>
                  )}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      <DialogFooter className="mx-0 mb-0 flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={cn("min-w-0 text-[13px] break-words", estError ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
          {!view.enabled ? "Switched off" : !ready ? "Check it first to see the price" : estError ?? (canPrice ? price : tab === "one" ? (tried ? Object.values(checked.errors)[0] : "Fill in the inputs to see the price") : rows ? (rows.errors[0] ?? "Fix the rows marked below") : "Paste rows to see the total")}
        </p>
        <div className="flex shrink-0 gap-1.5 max-sm:w-full">
          <Button variant="ghost" size="sm" onClick={onClose} className="max-sm:flex-1">
            Cancel
          </Button>
          <Button size="sm" onClick={() => void run()} disabled={busy !== null || !view.enabled || !ready || (canPrice && (!fresh || estimate.isFetching)) || (tried && !runnable)} className="max-sm:flex-[2]">
            {busy === "run" ? <Loader2 className="animate-spin" /> : <Play />}
            {runs > 1 ? `Run ${runs}` : "Run"}
            {runnable && est && !est.demo && est.total ? ` · ${formatCost(est.total)}` : ""}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function Notice({ tone, children, action }: { tone: "warn" | "info"; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl px-3 py-2.5 text-[13px] sm:flex-row sm:items-center",
        tone === "warn" ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground",
      )}
    >
      <p className="flex min-w-0 flex-1 items-start gap-2 break-words">
        {tone === "warn" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
        <span>{children}</span>
      </p>
      {action}
    </div>
  );
}

/** One input of the form, by its type. */
function Field({
  p,
  value,
  onChange,
  slot,
  onSlot,
  error,
}: {
  p: RecipeParam;
  value: string | number | undefined;
  onChange: (v: string | number | undefined) => void;
  slot: SlotValue | null;
  onSlot: (v: SlotValue | null) => void;
  error?: string;
}) {
  const id = useId();
  const label = (
    <label htmlFor={id} className="text-sm font-medium">
      {p.label}
      {p.required && p.default === undefined ? "" : <span className="font-normal text-muted-foreground"> · optional</span>}
    </label>
  );
  const hint = p.hint && <p className="text-[12px] text-muted-foreground">{p.hint}</p>;
  const err = error && (
    <p role="alert" className="text-[12px] text-destructive">
      {error}
    </p>
  );
  if (isMediaType(p.type)) {
    return (
      <div className="flex items-center gap-3" id={id}>
        <MediaSlot label={p.label} kind={p.type} value={slot} onChange={onSlot} required={p.required} size="lg" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium">{p.label}</p>
          <p className="text-[12px] text-muted-foreground">{p.hint ?? `Upload ${p.type === "image" ? "a picture" : p.type === "video" ? "a clip" : "a sound file"}, or pick one from your Library.`}</p>
          {err}
        </div>
      </div>
    );
  }
  const example = typeof p.example === "string" || typeof p.example === "number" ? String(p.example) : undefined;
  if (p.type === "text") {
    // A name or a line fits one row; a description (no limit, or a long one) gets a box.
    const long = (p.max ?? RECIPE_LIMITS.text) > 300;
    return (
      <div className="space-y-1.5">
        {label}
        {long ? (
          <Textarea id={id} rows={3} value={value === undefined ? "" : String(value)} maxLength={p.max ?? RECIPE_LIMITS.text} placeholder={example} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />
        ) : (
          <Input id={id} value={value === undefined ? "" : String(value)} maxLength={p.max} placeholder={example} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />
        )}
        {hint}
        {err}
      </div>
    );
  }
  if (p.type === "number") {
    // What was typed stays as typed ("0." on the way to "0.5"); checkValues reads it as a number.
    const typed = typeof value === "number" ? value : Number(value ?? NaN);
    const n = Number.isFinite(typed) ? typed : (p.min ?? 0);
    const step = p.step ?? 1;
    const places = (String(step).split(".")[1] ?? "").length;
    const clamp = (x: number) => Number(Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, x)).toFixed(places));
    return (
      <div className="space-y-1.5">
        {label}
        <div className="flex w-fit items-center gap-1 rounded-full bg-muted p-0.5">
          <Button type="button" variant="ghost" size="icon" className="size-8 rounded-full" aria-label={`Fewer: ${p.label}`} disabled={p.min !== undefined && n <= p.min} onClick={() => onChange(clamp(n - step))}>
            <Minus />
          </Button>
          <Input
            id={id}
            inputMode="decimal"
            value={value === undefined ? "" : String(value)}
            placeholder={example}
            onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
            className="h-8 w-16 border-0 bg-transparent text-center tabular-nums shadow-none"
            aria-invalid={!!error}
          />
          <Button type="button" variant="ghost" size="icon" className="size-8 rounded-full" aria-label={`More: ${p.label}`} disabled={p.max !== undefined && n >= p.max} onClick={() => onChange(clamp(n + step))}>
            <Plus />
          </Button>
        </div>
        {hint}
        {err}
      </div>
    );
  }
  if (p.type === "choice") {
    const options = p.options ?? [];
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium" id={id}>
          {p.label}
        </p>
        <div role="radiogroup" aria-labelledby={id} onKeyDown={radioKeys} className="flex w-fit max-w-full flex-wrap gap-1 rounded-2xl bg-muted p-0.5">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={value === o}
              tabIndex={radioTab(value === o || (value === undefined && o === options[0]))}
              onClick={() => onChange(o)}
              className={cn("h-8 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors", value === o && "bg-background text-foreground shadow-soft")}
            >
              {o}
            </button>
          ))}
        </div>
        {hint}
        {err}
      </div>
    );
  }
  return <ElementField id={id} label={label} p={p} value={value} onChange={onChange} hint={hint} err={err} />;
}

/** An @element input: the saved elements, as the composer's @ mentions list them. */
function ElementField({ id, label, p, value, onChange, hint, err }: { id: string; label: React.ReactNode; p: RecipeParam; value: string | number | undefined; onChange: (v: string | undefined) => void; hint: React.ReactNode; err: React.ReactNode }) {
  const elements = useElements();
  const list = (elements.data ?? []).filter((e) => e.kind !== "voice");
  const current = typeof value === "string" ? value.replace(/^@/, "") : undefined;
  return (
    <div className="space-y-1.5">
      {label}
      {list.length ? (
        <Select value={current} onValueChange={(v) => onChange(`@${v}`)}>
          <SelectTrigger id={id} className="w-full max-w-xs">
            <SelectValue placeholder={p.example ? String(p.example) : "Pick an element"} />
          </SelectTrigger>
          <SelectContent>
            {list.map((e) => (
              <SelectItem key={e.id} value={e.handle}>
                @{e.handle} <span className="text-muted-foreground">· {e.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {elements.isLoading ? "Loading your elements…" : "No elements yet. "}
          {!elements.isLoading && (
            <Link href="/elements?new=1" className="text-brand-text underline underline-offset-2">
              Save a character, place or product
            </Link>
          )}
        </p>
      )}
      {hint}
      {err}
    </div>
  );
}

/** Many runs: a pasted or uploaded CSV (or a spreadsheet's paste), checked row by row. */
function Many({ recipeParams, csv, setCsv, parsed, name }: { recipeParams: RecipeParam[]; csv: string; setCsv: (v: string) => void; parsed: ReturnType<typeof parseRows> | null; name: string }) {
  const file = useRef<HTMLInputElement>(null);
  const id = useId();
  const quote = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const template = [recipeParams.map((p) => quote(p.label)).join(","), recipeParams.map((p) => quote(p.example !== undefined && p.example !== null ? String(p.example) : p.default !== undefined ? String(p.default) : "")).join(",")].join("\n");
  const labelOf = (col: string | null) => recipeParams.find((p) => p.id === col)?.label;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          Rows to run
        </label>
        <p className="text-[12px] text-muted-foreground">
          One run per row, up to {RECIPE_LIMITS.rows}. The first row names the inputs ({recipeParams.map((p) => p.label).join(", ")}); paste from a spreadsheet or a CSV file. Files are links: /api/files/… from your Library, or https://….
        </p>
        <Textarea id={id} rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={template} className="font-mono text-[12px] leading-relaxed" spellCheck={false} />
        <div className="flex flex-wrap gap-1.5">
          <input
            ref={file}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setCsv(await f.text());
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()}>
            <FileUp /> Upload CSV
          </Button>
          <Button type="button" variant="ghost" size="sm" asChild>
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(`${template}\n`)}`} download={`${name}-rows.csv`}>
              Template
            </a>
          </Button>
        </div>
      </div>
      {parsed && (
        <div className="space-y-2">
          {parsed.errors.map((e, i) => (
            <p key={i} role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              <X className="mt-0.5 size-3.5 shrink-0" /> {e}
            </p>
          ))}
          {parsed.notes.map((n, i) => (
            <p key={i} className="text-[12px] text-muted-foreground">
              {n}
            </p>
          ))}
          {parsed.rows.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-xl border">
              <table className="w-full min-w-max text-left text-[12px]">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium text-muted-foreground">#</th>
                    {parsed.header.map((h, i) => (
                      <th key={i} className={cn("px-2 py-1.5 font-medium", !parsed.columns[i] && "text-muted-foreground line-through")}>
                        {labelOf(parsed.columns[i]) ?? h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parsed.rows.map((r) => (
                    <RowLine key={r.line} line={r.line} cells={r.cells} errors={r.errors} width={parsed.header.length} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {parsed.rows.length > 0 && (
            <p className="text-[12px] text-muted-foreground">
              {parsed.rows.length} run{parsed.rows.length === 1 ? "" : "s"}
              {parsed.rows.some((r) => r.errors.length) ? ` · ${parsed.rows.filter((r) => r.errors.length).length} to fix` : " · all fine"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RowLine({ line, cells, errors, width }: { line: number; cells: string[]; errors: string[]; width: number }) {
  return (
    <>
      <tr className={cn(errors.length && "bg-destructive/5")}>
        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{line}</td>
        {Array.from({ length: width }, (_, i) => (
          <td key={i} className="max-w-[14rem] truncate px-2 py-1.5" title={cells[i]}>
            {cells[i] ?? ""}
          </td>
        ))}
      </tr>
      {errors.length > 0 && (
        <tr className="bg-destructive/5">
          <td />
          <td colSpan={width} className="px-2 pb-1.5 text-destructive">
            {errors.join(" · ")}
          </td>
        </tr>
      )}
    </>
  );
}
