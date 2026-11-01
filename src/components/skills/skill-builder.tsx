"use client";

import { AlertTriangle, ArrowRight, AudioLines, Box, Check, ChevronDown, Cloud, Cpu, FileText, Info, Loader2, ShieldCheck, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RunSkillDialog } from "@/components/assist/run-skill-dialog";
import { useDraftActions, useSkillDraft, type DraftCheckResult } from "@/components/assist/hooks";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { SKILL_LIMITS, SKILL_NAME_RE } from "@/lib/assist";
import { formatCost } from "@/lib/format";
import { isMediaType, recipeProblems, RECIPE_LIMITS, type ParamType } from "@/lib/recipe";
import { buildRecipe, paramIdFrom, skillBody, slugify, type DraftCandidate, type DraftRefusal, type DraftStep, type Naming, type SkillDraft, type Slot } from "@/lib/recipe-builder";
import { refusalShown } from "@/lib/refusals";
import { cn } from "@/lib/utils";

/**
 * Make a skill from results already made (package W2): the steps behind them, rebuilt by the server from their exact
 * requests; what changes next time (every input starts Fixed); a free check (the plan on each engine, then a dry run on
 * the demo provider); then Save, which opens the Run form with the inputs it was made from ("Try it with new inputs").
 * A tall dialog on a desktop, the whole screen on a phone.
 */
export function SkillBuilder({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <Dialog open={!saved} onOpenChange={(o) => !o && !saved && onClose()}>
        <DialogContent className="flex h-[min(94svh,960px)] flex-col gap-0 overflow-hidden p-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-full max-sm:rounded-none max-sm:ring-0 sm:max-w-[1120px]">
          <Loader ids={ids} onClose={onClose} onSaved={setSaved} />
        </DialogContent>
      </Dialog>
      {saved && <RunSkillDialog name={saved} examples intro="Try it with new inputs: the form starts with the ones it was made from." onClose={onClose} />}
    </>
  );
}

function Loader({ ids, onClose, onSaved }: { ids: string[]; onClose: () => void; onSaved: (name: string) => void }) {
  const q = useSkillDraft(ids);
  const header = (
    <DialogHeader className="border-b px-5 pt-5 pb-4 text-left">
      <DialogTitle className="font-heading text-[24px] leading-tight font-normal">Make a skill</DialogTitle>
      <DialogDescription>
        From {ids.length === 1 ? "this result" : `${ids.length} results`}: Fuobe rebuilds the steps from what you made, so nothing has to be recorded.
      </DialogDescription>
    </DialogHeader>
  );
  if (q.data?.draft) return <Review draft={q.data.draft} refusals={q.data.refusals} ids={ids} onClose={onClose} onSaved={onSaved} header={header} />;
  return (
    <>
      {header}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {q.isError ? (
          <p role="alert" className="text-[14px] text-destructive">
            {(q.error as Error).message}
          </p>
        ) : q.data ? (
          <>
            <p className="text-[14px]">{q.data.refusals.length === 1 ? "This result can't become a skill yet:" : "None of these results can become a skill yet:"}</p>
            <Refusals list={q.data.refusals} open />
          </>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        )}
      </div>
      <DialogFooter className="mx-0 mb-0 border-t px-5 py-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// The review screen

interface CheckState {
  /** The recipe it checked (a change after it means it must be checked again). */
  key: string;
  plan?: DraftCheckResult;
  demo?: DraftCheckResult | "running";
  error?: string;
}

const ENGINE_WORD = { cloud: "Cloud", open: "your GPU" } as const;

function Review({ draft, refusals, ids, onClose, onSaved, header }: { draft: SkillDraft; refusals: DraftRefusal[]; ids: string[]; onClose: () => void; onSaved: (name: string) => void; header: React.ReactNode }) {
  const actions = useDraftActions();
  const [varies, setVaries] = useState<Record<string, boolean>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [pids, setPids] = useState<Record<string, string>>({});
  const [required, setRequired] = useState<Record<string, boolean>>({});
  const [slots, setSlots] = useState<Slot[]>([]);
  const [name, setName] = useState(draft.name);
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [whenToUse, setWhenToUse] = useState(draft.whenToUse);
  const [customBody, setCustomBody] = useState<string | null>(null);
  const [naming, setNaming] = useState<Naming | null | "asking" | "none">(null);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const recipe = useMemo(() => buildRecipe(draft, { varies, labels, ids: pids, required, slots }), [draft, varies, labels, pids, required, slots]);
  const key = useMemo(() => JSON.stringify(recipe), [recipe]);
  const own = useMemo(() => {
    const out = recipeProblems(recipe);
    if (recipe.params.length > RECIPE_LIMITS.params) out.unshift(`A skill takes at most ${RECIPE_LIMITS.params} inputs: switch some back to Fixed`);
    if (!SKILL_NAME_RE.test(name)) out.unshift("The name is lowercase letters, digits and single hyphens (e.g. lamp-turntable)");
    if (!title.trim()) out.unshift("Give the skill a title");
    if (!description.trim()) out.unshift("Give the skill a description");
    return out;
  }, [recipe, name, title, description]);
  const body = customBody ?? skillBody(recipe, draft, { title: title.trim() || draft.title, description: description.trim() || draft.description, name });
  const current = check?.key === key ? check : null;
  const planOk = !!current?.plan?.ok || (current?.plan?.ready.length ?? 0) > 0;

  const runCheck = async () => {
    if (own.length) return;
    setBusy("check");
    setProblems([]);
    const k = key;
    try {
      const plan = await actions.check(recipe, "plan", title);
      const passed = plan.ready.length > 0;
      setCheck({ key: k, plan, ...(passed && { demo: "running" as const }) });
      if (!passed) {
        setProblems(plan.why ? [plan.why] : plan.engines.flatMap((e) => e.plan.errors));
        return;
      }
      // The free dry run finishes in the background and updates the badge (Save doesn't wait for it).
      void actions
        .check(recipe, "demo", title)
        .then((demo) => setCheck((c) => (c?.key === k ? { ...c, demo } : c)))
        .catch((e) => setCheck((c) => (c?.key === k ? { ...c, demo: undefined, error: (e as Error).message } : c)));
    } catch (e) {
      const f = e as Error & { problems?: string[] };
      setProblems(f.problems ?? [f.message]);
      setCheck(null);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!planOk || own.length) return;
    setBusy("save");
    try {
      const view = await actions.save({ name, title: title.trim(), description: description.trim(), whenToUse: whenToUse.trim() || undefined, body, recipe });
      toast.success(`Saved /${view.name}`, { description: "It's in Skills → My skills. Try it with new inputs now." });
      onSaved(view.name);
    } catch (e) {
      const f = e as Error & { problems?: string[] };
      if (refusalShown(f)) return;
      setProblems(f.problems ?? [f.message]);
      toast.error(f.message);
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    setNaming("asking");
    try {
      const n = await actions.name(ids);
      setNaming(n ?? "none");
    } catch {
      setNaming("none");
    }
  };

  // What the Run form will ask for (an element whose words vary as a whole, or words no prompt has, asks for nothing).
  const varying = recipe.params.length;
  const status = statusLine(current, busy, own);

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid gap-6 px-5 py-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* The steps */}
          <section aria-labelledby="sb-steps" className="min-w-0 space-y-3 lg:sticky lg:top-0 lg:self-start">
            <h3 id="sb-steps" className="text-sm font-medium">
              The steps <span className="font-normal text-muted-foreground">· {draft.steps.length}</span>
            </h3>
            {draft.notes.map((n, i) => (
              <Notice key={i} tone={i === 0 && draft.demo ? "warn" : "info"}>
                {n}.
              </Notice>
            ))}
            <ol className="space-y-2">
              {draft.steps.map((s, i) => (
                <StepCard key={s.key} step={s} index={i} />
              ))}
            </ol>
            {refusals.length > 0 && <Refusals list={refusals} />}
          </section>

          {/* What changes next time, and the skill itself */}
          <div className="min-w-0 space-y-6">
            <section aria-labelledby="sb-inputs" className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 id="sb-inputs" className="text-sm font-medium">
                    What changes next time
                  </h3>
                  <p className="text-[12px] text-muted-foreground">Everything stays as it was unless you switch it to Varies. Fewer inputs keep more of what made the result good.</p>
                </div>
                {draft.llm && naming !== "asking" && !(naming && typeof naming === "object") && (
                  <Button size="sm" variant="outline" onClick={() => void suggest()}>
                    <Sparkles /> Suggest names · {draft.llm === "ollama" ? "Ollama" : "Claude"}
                  </Button>
                )}
                {naming === "asking" && (
                  <span className="inline-flex h-8 items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Asking {draft.llm === "claude" ? "Claude" : "Ollama"}…
                  </span>
                )}
              </div>
              {naming === "none" && <p className="text-[12px] text-muted-foreground">No suggestions this time: the names below are Fuobe&apos;s own.</p>}
              {naming && typeof naming === "object" && (
                <Suggestions
                  naming={naming}
                  draft={draft}
                  state={{ title, description, whenToUse, name, body: customBody, labels, pids, slots }}
                  apply={{
                    title: (v) => setTitle(v ?? draft.title),
                    description: (v) => setDescription(v ?? draft.description),
                    whenToUse: (v) => setWhenToUse(v ?? draft.whenToUse),
                    name: (v) => setName(v ?? draft.name),
                    body: setCustomBody,
                    input: (cand, v) => {
                      setLabels((x) => ({ ...x, [cand]: v?.label ?? "" }));
                      setPids((x) => ({ ...x, [cand]: v?.id ?? "" }));
                    },
                    slot: (s, on) => setSlots((x) => (on ? [...x.filter((y) => y.id !== s.id), s] : x.filter((y) => !(y.id === s.id && y.text === s.text)))),
                  }}
                />
              )}
              {draft.candidates.length === 0 ? (
                <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-[13px] text-muted-foreground">Nothing in these steps can change: the skill makes the same thing again, as a new take.</p>
              ) : (
                <ul className="space-y-2">
                  {draft.candidates.map((c) => (
                    <CandidateRow
                      key={c.id}
                      c={c}
                      draft={draft}
                      varies={!!varies[c.id]}
                      setVaries={(v) => setVaries((x) => ({ ...x, [c.id]: v }))}
                      label={labels[c.id] || c.label}
                      setLabel={(v) => setLabels((x) => ({ ...x, [c.id]: v }))}
                      required={required[c.id] ?? true}
                      setRequired={(v) => setRequired((x) => ({ ...x, [c.id]: v }))}
                      slots={slots}
                      setSlots={setSlots}
                      takenIds={[...draft.candidates.map((x) => pids[x.id] || x.id), ...slots.map((s) => s.id)]}
                      wholePromptVaries={(step) => draft.candidates.some((x) => x.kind === "text" && varies[x.id] && x.at.some((a) => a.step === step))}
                    />
                  ))}
                </ul>
              )}
              <p className="text-[12px] text-muted-foreground" aria-live="polite">
                {varying ? `${varying} input${varying === 1 ? "" : "s"} for the Run form` : "No inputs yet: it runs the same steps, unchanged."}
              </p>
            </section>

            <section aria-labelledby="sb-about" className="space-y-3">
              <h3 id="sb-about" className="text-sm font-medium">
                About this skill
              </h3>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Field label="Title" id="sb-title">
                  <Input id="sb-title" value={title} maxLength={SKILL_LIMITS.title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                <Field label="Name" id="sb-name" hint="Run it as /name in Assist">
                  <div className="flex items-center rounded-md border bg-background pl-2.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                    <span className="text-[14px] text-muted-foreground">/</span>
                    <input
                      id="sb-name"
                      value={name}
                      maxLength={SKILL_LIMITS.name}
                      onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                      onBlur={() => setName((n) => slugify(n) || draft.name)}
                      className="h-9 min-w-0 flex-1 bg-transparent px-1 text-[14px] outline-none"
                      aria-invalid={!SKILL_NAME_RE.test(name)}
                    />
                  </div>
                </Field>
              </div>
              <Field label="Description" id="sb-desc">
                <Textarea id="sb-desc" rows={2} value={description} maxLength={SKILL_LIMITS.description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Field label="When to use it" id="sb-when">
                <Textarea id="sb-when" rows={2} value={whenToUse} maxLength={SKILL_LIMITS.whenToUse} onChange={(e) => setWhenToUse(e.target.value)} />
              </Field>
              <Collapsible className="overflow-hidden rounded-xl border">
                <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium hover:bg-accent">
                  <FileText className="size-4 text-muted-foreground" /> SKILL.md
                  <span className="min-w-0 truncate font-normal text-muted-foreground">· {customBody !== null ? "the suggested text" : "written from the steps, no AI"}</span>
                  <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t">
                  <pre className="max-h-72 overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap">{body}</pre>
                </CollapsibleContent>
              </Collapsible>
            </section>
          </div>
        </div>
      </div>
      <div className="border-t px-5 py-3">
        {(problems.length > 0 || own.length > 0) && (
          <div role="alert" className="mb-2 space-y-1 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {[...own, ...problems].slice(0, 4).map((p, i) => (
              <p key={i} className="flex items-start gap-2 break-words">
                <X className="mt-0.5 size-3.5 shrink-0" /> {p}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1" aria-live="polite">
            <p className="text-[13px] break-words text-muted-foreground">{status}</p>
            {current?.plan && <CheckBadges check={current} />}
          </div>
          <div className="flex shrink-0 gap-1.5 max-sm:w-full">
            <Button variant="ghost" size="sm" onClick={onClose} className="max-sm:flex-1">
              Cancel
            </Button>
            <Button variant={planOk ? "outline" : "default"} size="sm" onClick={() => void runCheck()} disabled={busy !== null || own.length > 0} className="max-sm:flex-1">
              {busy === "check" ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {current?.plan ? "Check again" : "Check it"}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={busy !== null || !planOk || own.length > 0} className="max-sm:flex-[1.4]">
              {busy === "save" ? <Loader2 className="animate-spin" /> : <Check />} Save skill
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** The line above the footer's buttons: what to do next, or what the check found. */
function statusLine(c: CheckState | null, busy: "check" | "save" | null, own: string[]): string {
  if (own.length) return "Fix what's marked to check it";
  if (busy === "check") return "Checking: pricing every step on each engine…";
  if (busy === "save") return "Saving…";
  if (!c?.plan) return "Check it first — it's free: Fuobe prices every step and runs it once on the demo provider.";
  if (!c.plan.ready.length) return "It doesn't run as it is: see what's marked";
  const where = c.plan.ready.map((e) => ENGINE_WORD[e]).join(" and ");
  return `It runs on ${where}. Save it now; the free dry run finishes on its own.`;
}

function priceOf(e: DraftCheckResult["engines"][number]): string {
  if (!e.plan.ok) return "doesn't run";
  if (e.plan.demo) return "placeholder, free";
  if (e.plan.total === null) return "price varies";
  if (e.plan.total === 0) return "Free";
  return formatCost(e.plan.total);
}

function CheckBadges({ check }: { check: CheckState }) {
  const demo = check.demo;
  // Every engine's dry run skipped (a studio tool step): say so, rather than "passed".
  const ran = demo && demo !== "running" ? demo.engines.filter((e) => e.dryRun) : [];
  const skipped = demo && demo !== "running" && demo.ok && ran.length > 0 && ran.every((e) => e.dryRun?.skipped) ? ran[0].dryRun!.skipped : undefined;
  return (
    <div className="flex flex-wrap gap-1.5">
      {check.plan!.engines.map((e) => (
        <span key={e.engine} className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium", e.plan.ok ? "bg-brand-faint text-brand-text" : "bg-destructive/10 text-destructive")}>
          {e.engine === "open" ? <Cpu className="size-3" /> : <Cloud className="size-3" />}
          {e.engine === "open" ? "Your GPU" : "Cloud"} · {priceOf(e)}
        </span>
      ))}
      {demo === "running" && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Dry run…
        </span>
      )}
      {demo && demo !== "running" && skipped && (
        // A studio step's dry run would make a record you'd see (a demo dub): its plan is its check, and nothing ran.
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-[12px] text-muted-foreground" title={skipped}>
          <Info className="size-3" /> No dry run: a studio step is checked by its plan
        </span>
      )}
      {demo && demo !== "running" && !skipped && (
        <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium", demo.ok ? "bg-brand-faint text-brand-text" : "bg-destructive/10 text-destructive")} title={demo.ok ? undefined : demo.engines.flatMap((e) => e.dryRun?.problems ?? []).join("; ")}>
          {demo.ok ? <Check className="size-3" /> : <X className="size-3" />} Dry run {demo.ok ? "passed" : "failed"}
        </span>
      )}
      {check.error && <span className="inline-flex h-6 items-center rounded-full bg-destructive/10 px-2 text-[12px] text-destructive">Dry run: {check.error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps

function Thumb({ thumb, className }: { thumb?: DraftStep["thumb"]; className?: string }) {
  const box = cn("grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground", className);
  if (!thumb) return <div className={box} />;
  if (thumb.kind === "image")
    return (
      <div className={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb.url} alt="" className="size-full object-cover" loading="lazy" />
      </div>
    );
  if (thumb.kind === "video")
    return (
      <div className={box}>
        {thumb.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb.poster} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <video src={thumb.url} muted playsInline preload="metadata" className="size-full object-cover" />
        )}
      </div>
    );
  const Icon = thumb.kind === "audio" ? AudioLines : thumb.kind === "model3d" ? Box : FileText;
  return (
    <div className={box}>
      <Icon className="size-5" />
    </div>
  );
}

function StepCard({ step, index }: { step: DraftStep; index: number }) {
  return (
    <li className="flex gap-3 rounded-xl border bg-card p-2.5">
      <Thumb thumb={step.thumb} className="size-16" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[13px] font-medium">
          <span className="text-muted-foreground tabular-nums">{index + 1}.</span> {step.label}
        </p>
        <p className="truncate text-[12px] text-muted-foreground" title={step.modelName}>
          {step.kind === "tool" ? "Studio tool" : step.modelName}
          {step.engine && ` · ${step.engine === "open" ? "your GPU" : "Cloud"}`}
        </p>
        <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
          {step.waits.length ? (
            <>
              <ArrowRight className="size-3 shrink-0" /> <span className="min-w-0 truncate">waits for {step.waits.join(" and ")}</span>
            </>
          ) : (
            "starts from your inputs"
          )}
          {step.leaf && <span className="ml-1 shrink-0 rounded-full bg-muted px-1.5 text-[11px]">kept</span>}
        </p>
        {step.notes.map((n, i) => (
          <p key={i} className="text-[11px] break-words text-muted-foreground">
            {n}
          </p>
        ))}
      </div>
    </li>
  );
}

function Refusals({ list, open }: { list: DraftRefusal[]; open?: boolean }) {
  return (
    <Collapsible defaultOpen={open} className="overflow-hidden rounded-xl border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium hover:bg-accent">
        <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" /> Left out · {list.length}
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <ul className="divide-y">
          {list.map((r) => (
            <li key={r.id} className="space-y-0.5 px-3 py-2">
              <p className="truncate text-[13px]" title={r.title}>
                {r.title}
              </p>
              <p className="text-[12px] break-words text-muted-foreground">{r.reason}</p>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Inputs

const TYPE_LABEL: Record<ParamType, string> = { image: "Image", video: "Video", audio: "Audio", text: "Words", number: "Number", choice: "Choice", element: "Element" };

function CandidateRow({
  c,
  draft,
  varies,
  setVaries,
  label,
  setLabel,
  required,
  setRequired,
  slots,
  setSlots,
  takenIds,
  wholePromptVaries,
}: {
  c: DraftCandidate;
  draft: SkillDraft;
  varies: boolean;
  setVaries: (v: boolean) => void;
  label: string;
  setLabel: (v: string) => void;
  required: boolean;
  setRequired: (v: boolean) => void;
  slots: Slot[];
  setSlots: React.Dispatch<React.SetStateAction<Slot[]>>;
  takenIds: string[];
  wholePromptVaries: (step: string) => boolean;
}) {
  const stepLabels = c.at.map((a) => draft.steps.find((s) => s.key === a.step)?.label).filter(Boolean);
  // An element named only in words that vary as a whole has nowhere to go.
  const nowhere = c.kind === "element" && c.at.every((a) => wholePromptVaries(a.step));
  const locked = c.locked ?? (nowhere ? "Its words vary as a whole" : undefined);
  const where = c.kind === "setting" ? `in ${stepLabels.join(", ")}` : c.at.length > 1 ? `used by ${c.at.length} steps` : stepLabels[0] ? `in ${stepLabels[0]}` : "";
  return (
    <li className={cn("rounded-xl border p-3 transition-colors", varies && !locked && "border-brand/60 bg-brand-faint/40")}>
      <div className="flex items-start gap-3">
        {isMediaType(c.type) && <Thumb thumb={{ url: String(c.example), kind: c.type }} className="size-12" />}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {varies && !locked ? (
              <Input aria-label={`Label of ${c.label}`} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className="h-8 w-48 max-w-full text-[13px] font-medium" />
            ) : (
              <p className="text-[13px] font-medium">{label}</p>
            )}
            <span className="rounded-full bg-muted px-2 text-[11px] leading-5 text-muted-foreground">{TYPE_LABEL[c.type]}</span>
            {where && <span className="text-[12px] text-muted-foreground">{where}</span>}
          </div>
          {!isMediaType(c.type) && c.kind !== "text" && (
            <p className="text-[12px] text-muted-foreground">
              Was <span className="font-medium text-foreground">{String(c.example)}</span>
              {c.kind === "setting" && varies ? " · optional, the default" : ""}
            </p>
          )}
          {locked && <p className="text-[12px] text-muted-foreground">{locked}</p>}
          {varies && !locked && !c.optional && (
            <label className="flex w-fit items-center gap-2 text-[12px] text-muted-foreground">
              <Checkbox checked={required} onCheckedChange={(v) => setRequired(v === true)} /> Required in the Run form
            </label>
          )}
        </div>
        <FixedVaries value={varies && !locked} onChange={setVaries} disabled={!!locked} label={c.label} />
      </div>
      {c.kind === "text" && <Words c={c} varies={varies} slots={slots} setSlots={setSlots} takenIds={takenIds} />}
    </li>
  );
}

function FixedVaries({ value, onChange, disabled, label }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={`${label}: fixed or varies`} onKeyDown={radioKeys} className="flex shrink-0 gap-0.5 rounded-full bg-muted p-0.5">
      {(["Fixed", "Varies"] as const).map((o) => {
        const on = (o === "Varies") === value;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            tabIndex={radioTab(on)}
            onClick={() => onChange(o === "Varies")}
            className={cn("h-7 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground transition-colors disabled:opacity-50", on && "bg-background text-foreground shadow-soft")}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A prompt: whole (Varies), or kept with some of its words as inputs of their own (slots), each highlighted. Select
 * words in the text, then make them an input.
 */
function Words({ c, varies, slots, setSlots, takenIds }: { c: DraftCandidate; varies: boolean; slots: Slot[]; setSlots: React.Dispatch<React.SetStateAction<Slot[]>>; takenIds: string[] }) {
  const text = String(c.example);
  const step = c.at[0]?.step;
  // The words to make an input: selected in the text (a mouse, a finger dragging the handles) or typed (a keyboard).
  const [picked, setPicked] = useState("");
  const [typing, setTyping] = useState(false);
  const [slotLabel, setSlotLabel] = useState("");
  const box = useRef<HTMLParagraphElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const mine = slots.filter((s) => text.includes(s.text));
  const words = picked.replace(/\s+/g, " ").trim();
  const fits = words.length >= 2 && words.length <= 200 && text.includes(words);
  useEffect(() => {
    if (varies) return;
    // Every change of the selection, so dragging a phone's handles counts (no touchend reaches the text then).
    const read = () => {
      const sel = window.getSelection();
      if (!sel || !box.current || !sel.anchorNode || !box.current.contains(sel.anchorNode)) return;
      const chosen = sel.toString().replace(/\s+/g, " ").trim();
      if (chosen.length >= 2 && chosen.length <= 200 && text.includes(chosen)) {
        setPicked(chosen);
        setSlotLabel((l) => l || (chosen.split(" ").length <= 3 ? chosen.replace(/^./, (x) => x.toUpperCase()) : ""));
      }
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, [text, varies]);
  const add = () => {
    if (!fits) return;
    const label = slotLabel.trim() || "Words";
    const id = paramIdFrom(label, takenIds);
    setSlots((x) => [...x, { step: step ?? "", text: words, id, label: label.slice(0, 60) }]);
    setPicked("");
    setSlotLabel("");
    setTyping(false);
    window.getSelection()?.removeAllRanges();
  };
  const cancel = () => {
    setPicked("");
    setSlotLabel("");
    setTyping(false);
  };
  if (varies) {
    return <p className="mt-2 line-clamp-3 rounded-lg bg-muted/60 px-3 py-2 text-[12px] break-words text-muted-foreground">The whole prompt is an input. Was: “{text}”</p>;
  }
  return (
    <div className="mt-2 space-y-2">
      <p ref={box} className="rounded-lg bg-muted/60 px-3 py-2 text-[13px] leading-relaxed break-words select-text">
        <Highlighted text={text} slots={mine} />
      </p>
      {mine.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {mine.map((s) => (
            <span key={`${s.id}:${s.text}`} className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-brand-faint pr-1 pl-2.5 text-[12px] text-brand-text">
              <span className="truncate">
                {s.label} <span className="opacity-70">← “{s.text}”</span>
              </span>
              <button type="button" aria-label={`Keep “${s.text}” fixed`} onClick={() => setSlots((x) => x.filter((y) => y !== s))} className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-background/70">
                <Undo2 className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {picked || typing ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <Input
            ref={field}
            aria-label="Words from the prompt to make an input"
            placeholder="Words from the prompt"
            value={picked}
            maxLength={200}
            onChange={(e) => setPicked(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            aria-invalid={!!words && !fits}
            className="h-8 w-56 max-w-full text-[13px]"
          />
          <Input aria-label="Its label" placeholder="Label, e.g. Product" value={slotLabel} maxLength={60} onChange={(e) => setSlotLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} className="h-8 w-40 max-w-full text-[13px]" />
          <Button size="sm" variant="outline" onClick={add} disabled={!fits}>
            Make it an input
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          {words && !fits && <p className="w-full text-muted-foreground">Type the words as they are in the prompt.</p>}
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          To change only some words next time (a product, a name), select them above, or{" "}
          <button
            type="button"
            onClick={() => {
              setTyping(true);
              // The field appears on the next render: focus it then, for the keyboard.
              setTimeout(() => field.current?.focus(), 0);
            }}
            className="font-medium text-foreground underline underline-offset-2"
          >
            type them
          </button>
          .
        </p>
      )}
    </div>
  );
}

/** The words with each slot's text marked. */
function Highlighted({ text, slots }: { text: string; slots: Slot[] }) {
  if (!slots.length) return <>{text}</>;
  const re = new RegExp(`(${slots.map((s) => s.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return (
    <>
      {text.split(re).map((part, i) =>
        slots.some((s) => s.text === part) ? (
          <mark key={i} className="rounded bg-brand-faint px-0.5 text-brand-text">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The naming pass's suggestions: each a change shown before and after, each off until ticked

interface Applied {
  title: string;
  description: string;
  whenToUse: string;
  name: string;
  body: string | null;
  labels: Record<string, string>;
  pids: Record<string, string>;
  slots: Slot[];
}

function Suggestions({
  naming,
  draft,
  state,
  apply,
}: {
  naming: Naming;
  draft: SkillDraft;
  state: Applied;
  apply: {
    title: (v: string | null) => void;
    description: (v: string | null) => void;
    whenToUse: (v: string | null) => void;
    name: (v: string | null) => void;
    body: (v: string | null) => void;
    input: (candidate: string, v: { id: string; label: string } | null) => void;
    slot: (s: Slot, on: boolean) => void;
  };
}) {
  const rows: { key: string; what: string; before: string; after: string; on: boolean; set: (on: boolean) => void }[] = [];
  const text = (key: "title" | "description" | "whenToUse" | "name", what: string) => {
    const v = naming[key];
    if (!v || v === draft[key]) return;
    rows.push({ key, what, before: draft[key], after: v, on: state[key] === v, set: (on) => apply[key](on ? v : null) });
  };
  text("title", "Title");
  text("name", "Name");
  text("description", "Description");
  text("whenToUse", "When to use it");
  for (const i of naming.inputs) {
    const c = draft.candidates.find((x) => x.id === i.candidate);
    if (!c) continue;
    rows.push({ key: `in:${i.candidate}`, what: "Input", before: `${c.label} (${c.id})`, after: `${i.label} (${i.id})`, on: state.pids[i.candidate] === i.id && state.labels[i.candidate] === i.label, set: (on) => apply.input(i.candidate, on ? i : null) });
  }
  for (const s of naming.slots) {
    rows.push({ key: `slot:${s.step}:${s.text}`, what: "Words as an input", before: `“${s.text}”`, after: `${s.label} ({{${s.id}}})`, on: state.slots.some((x) => x.id === s.id && x.text === s.text), set: (on) => apply.slot(s, on) });
  }
  if (naming.body) rows.push({ key: "body", what: "SKILL.md", before: "written from the steps", after: "the suggested text", on: state.body === naming.body, set: (on) => apply.body(on ? naming.body! : null) });
  if (!rows.length) return <p className="text-[12px] text-muted-foreground">No changes suggested: the names below already fit.</p>;
  return (
    <div className="space-y-1.5 rounded-xl border p-3">
      <p className="flex items-center gap-1.5 text-[12px] font-medium">
        <Sparkles className="size-3.5 text-brand-text" /> Suggested — tick what you want
      </p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key}>
            <label className="flex items-start gap-2 rounded-lg px-1 py-1 text-[12px] hover:bg-accent/60">
              <Checkbox checked={r.on} onCheckedChange={(v) => r.set(v === true)} className="mt-0.5" />
              <span className="min-w-0 flex-1 break-words">
                <span className="text-muted-foreground">{r.what}: </span>
                <del className="text-muted-foreground decoration-muted-foreground/60">{cutText(r.before, 120)}</del> <ArrowRight className="inline size-3 text-muted-foreground" />{" "}
                <ins className="font-medium no-underline">{cutText(r.after, 160)}</ins>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

const cutText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------------------------------------------------------------------

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
        {hint && <span className="font-normal text-muted-foreground"> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] break-words", tone === "warn" ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
      {tone === "warn" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}
