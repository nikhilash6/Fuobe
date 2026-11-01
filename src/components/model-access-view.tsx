"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, CircleHelp, CreditCard, ExternalLink, FlaskConical, Globe, Info, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useProgressive } from "@/components/use-progressive";
import { useHydrated, useViewer } from "@/lib/api";
import { kindLabel, LICENCE_CLASSES, CLASS_LABEL, type LicenceClass, type LicenceInfo } from "@/lib/licences";
import { allOn, applyChange, type AccessChange, type AccessList, type LoraInfo, type ModelAccess, type ModelEntry, type PackInfo } from "@/lib/model-access";
import { cn } from "@/lib/utils";
import { responseError } from "@/lib/refusals";

/** Settings → Models & licences: every model, LoRA and node pack with its licence, and the switches. */

const CLASS_STYLE: Record<LicenceClass, { icon: typeof Ban; tone: string; fill: string }> = {
  commercial: { icon: CheckCircle2, tone: "text-success", fill: "bg-success/12" },
  conditions: { icon: Info, tone: "text-muted-foreground", fill: "bg-secondary" },
  regions: { icon: Globe, tone: "text-warning", fill: "bg-warning/15" },
  "non-commercial": { icon: Ban, tone: "text-destructive", fill: "bg-destructive/10 dark:bg-destructive/20" },
  research: { icon: FlaskConical, tone: "text-destructive", fill: "bg-destructive/10 dark:bg-destructive/20" },
  "paid-api": { icon: CreditCard, tone: "text-brand-text", fill: "bg-brand-faint" },
  unknown: { icon: CircleHelp, tone: "text-muted-foreground", fill: "bg-secondary" },
};

const badge = "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap text-foreground [&>svg]:size-3";

function ClassBadge({ licence }: { licence: LicenceInfo }) {
  const { icon: Icon, tone, fill } = CLASS_STYLE[licence.class];
  return (
    <span className={cn(badge, fill)}>
      <Icon className={tone} aria-hidden />
      {licence.class === "regions" && licence.excludes ? `Not in ${licence.excludes}` : CLASS_LABEL[licence.class]}
    </span>
  );
}

const NOTE = "text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]";

/**
 * A licence note cut at two lines. When it is cut, "More" shows the rest: a tap or the keyboard reaches it, not only a
 * mouse over the title.
 */
function ClampedNote({ text, about }: { text: string; about: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    // The observer answers once as it starts, then on every resize (a phone turned, the window narrowed).
    const watch = new ResizeObserver(() => setCut(el.scrollHeight > el.clientHeight + 1));
    watch.observe(el);
    return () => watch.disconnect();
  }, [open, text]);
  return (
    <div>
      <p ref={ref} className={cn(NOTE, !open && "line-clamp-2")} title={open ? undefined : text}>
        {text}
      </p>
      {(cut || open) && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-6 items-center rounded-sm text-[12px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {open ? "Less" : "More"}
          <span className="sr-only"> about {about}</span>
        </button>
      )}
    </div>
  );
}

/** `full`: the note is shown whole (a hosted model's weights line: short facts of its own), not cut at two lines. */
function LicenceLine({ licence, prefix, full }: { licence: LicenceInfo; prefix?: string; full?: boolean }) {
  return (
    <div className="mt-1 space-y-0.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        {licence.url ? (
          <a href={licence.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-medium [overflow-wrap:anywhere] hover:underline">
            {licence.name}
            <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <span className="font-medium [overflow-wrap:anywhere]">{licence.name}</span>
        )}
        <ClassBadge licence={licence} />
        {licence.notices?.map((n) => (
          <span key={n} className={cn(badge, "border")}>
            Shows “{n}”
          </span>
        ))}
      </p>
      {licence.note && (full ? <p className={NOTE}>{licence.note}</p> : <ClampedNote text={licence.note} about={prefix ? `${prefix} ${licence.name}` : licence.name} />)}
    </div>
  );
}

/** One switch with its label and what it covers; the whole row is the label. */
function SwitchRow({ id, label, hint, count, checked, onChange, disabled }: { id: string; label: string; hint?: React.ReactNode; count?: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[14px] font-medium [overflow-wrap:anywhere]">
          {label}
          {count && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{count}</span>}
        </label>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      <Switch id={id} className="mt-1" checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </li>
  );
}

type Tab = "models" | "loras" | "packs";
type Show = "all" | "on" | "off";

const chip = (active: boolean) =>
  cn("h-8 shrink-0 rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent", active && "bg-secondary text-foreground");

const ENGINE_WORDS: Record<string, string> = { open: "Open source", cloud: "Cloud" };

function ModelRow({ m, on, onChange, disabled }: { m: ModelEntry; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  const id = `model-${m.id}`;
  const runs = on && !m.offBy.length;
  return (
    <li className="flex items-start gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[14px] font-medium [overflow-wrap:anywhere]">
          {m.name}
        </label>
        <p className="text-[12px] text-muted-foreground">
          {m.vendor} · {kindLabel(m.kind)} · {m.engines.map((e) => ENGINE_WORDS[e] ?? e).join(" + ")}
          {m.hidden ? " · a helper step studios run" : ""}
        </p>
        <LicenceLine licence={m.licence} />
        {m.weights && <LicenceLine licence={m.weights} prefix="Weights:" full />}
        {m.cloud && <LicenceLine licence={m.cloud} prefix="In the cloud:" />}
        {on && m.offBy.length > 0 && <p className="mt-1 text-[12px] font-medium text-warning">Not offered: {m.offBy.join(" and ")}</p>}
        {on && m.partly.length > 0 && <p className="mt-1 text-[12px] text-muted-foreground">Partly: {m.partly.join(" and ")}, so it runs on what is still on</p>}
      </div>
      <Switch id={id} className="mt-1" checked={on} onCheckedChange={onChange} disabled={disabled} aria-describedby={runs ? undefined : `${id}-state`} />
      {!runs && (
        <span id={`${id}-state`} className="sr-only">
          {on ? "on, but not offered" : "off"}
        </span>
      )}
    </li>
  );
}

function LoraRow({ l, on, onChange, disabled }: { l: LoraInfo; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  const id = `lora-${l.file}`;
  return (
    <li className="flex items-start gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[14px] font-medium [overflow-wrap:anywhere]">
          {l.name}
        </label>
        <p className="text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
          {l.group === "look" ? "Look" : l.group === "motion" ? "Camera motion" : l.group === "adapter" ? "Model adapter" : "Effect"} · {l.base}
        </p>
        <LicenceLine licence={l.licence} />
      </div>
      <Switch id={id} className="mt-1" checked={on} onCheckedChange={onChange} disabled={disabled} />
    </li>
  );
}

function PackRow({ p, on, onChange, disabled }: { p: PackInfo; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  const id = `pack-${p.name}`;
  return (
    <li className="flex items-start gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[14px] font-medium [overflow-wrap:anywhere]">
          {p.name}
        </label>
        <p className="text-[12px] text-muted-foreground">
          {p.models ? `${p.models} ${p.models === 1 ? "model loads" : "models load"} it` : "No model loads it"}
          {p.worker ? " · on the isolated worker" : ""}
        </p>
        <LicenceLine licence={p.licence} />
      </div>
      <Switch id={id} className="mt-1" checked={on} onCheckedChange={onChange} disabled={disabled} />
    </li>
  );
}

const matches = (q: string, ...texts: (string | undefined)[]) => !q || texts.some((t) => t?.toLowerCase().includes(q));

/** The page's line under its title. The owner decides what this install offers; anyone else reads what it does. */
export function ModelAccessIntro() {
  const hydrated = useHydrated();
  const v = useViewer().data;
  const known = hydrated && v;
  return (
    <>
      Every model, LoRA and node pack Fuobe can run, with its licence: paid and open, commercial or not.{" "}
      {known &&
        (v.owner
          ? "Licences are information here; you decide what this install offers. Everything is on until you switch it off, and what is off leaves every picker and is refused on the server. "
          : "What is switched off leaves every picker. ")}
      <Link href="/settings/about" className="text-brand-text underline-offset-2 hover:underline">
        About &amp; licences
      </Link>{" "}
      has the notices and a link to each open model&apos;s licence.
    </>
  );
}

export function ModelAccessView() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["model-access"],
    queryFn: async () => {
      const res = await fetch("/api/settings/models");
      const body = (await res.json().catch(() => ({}))) as Partial<AccessList> & { error?: string };
      if (!res.ok || !body.access) throw new Error(body.error ?? `The server answered ${res.status}`);
      return body as AccessList;
    },
  });
  const change = useMutation({
    mutationFn: async (changes: AccessChange[]) => {
      const res = await fetch("/api/settings/models", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }) });
      const body = (await res.json().catch(() => ({}))) as Partial<AccessList> & { error?: string };
      if (!res.ok || !body.access) throw responseError(res, body.error ?? `The switch didn't save (${res.status})`);
      return body as AccessList;
    },
    // The switch moves at once; the server's answer brings what else changed (models now off, counts).
    onMutate: async (changes) => {
      await qc.cancelQueries({ queryKey: ["model-access"] });
      const before = qc.getQueryData<AccessList>(["model-access"]);
      if (before) qc.setQueryData<AccessList>(["model-access"], { ...before, access: changes.reduce(applyChange, before.access) });
      return { before };
    },
    onError: (e: Error, _c, ctx) => {
      if (ctx?.before) qc.setQueryData(["model-access"], ctx.before);
      toast.error(e.message);
    },
    onSuccess: (data) => qc.setQueryData(["model-access"], data),
    // Pickers, ⌘K and the Models page read what is off from the status.
    onSettled: () => void qc.invalidateQueries({ queryKey: ["status"] }),
  });
  // The switches are the owner's: anyone else reads them (the server would refuse a change anyway).
  const owner = useViewer().data?.owner === true;
  const flip = (c: AccessChange) => {
    if (owner) change.mutate([c]);
  };

  const [tab, setTab] = useState<Tab>("models");
  const [show, setShow] = useState<Show>("all");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());

  const data = list.data;
  const access: ModelAccess | undefined = data?.access;
  const modelOn = (m: ModelEntry) => !access?.models.includes(m.id);
  const keep = (on: boolean) => show === "all" || (show === "on" ? on : !on);

  const models = useMemo(() => {
    if (!data) return [];
    const order = (c: LicenceClass) => LICENCE_CLASSES.indexOf(c);
    return data.models
      .filter((m) => keep(!access!.models.includes(m.id) && !m.offBy.length) && matches(q, m.name, m.vendor, m.id, m.licence.name, m.licence.note, m.cloud?.name, m.weights?.name, m.weights?.note, CLASS_LABEL[m.licence.class]))
      .sort((a, b) => order(a.licence.class) - order(b.licence.class));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, access, q, show]);
  const loras = useMemo(
    () => (data ? data.loras.filter((l) => keep(!access!.loras.includes(l.file)) && matches(q, l.name, l.file, l.base, l.licence.name, l.licence.note)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, access, q, show],
  );
  const packs = useMemo(
    () => (data ? data.packs.filter((p) => keep(!access!.packs.includes(p.name)) && matches(q, p.name, p.licence.name, p.licence.note)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, access, q, show],
  );
  const rows = tab === "models" ? models.length : tab === "loras" ? loras.length : packs.length;
  const { shown, hasMore, moreFrom, sentinel } = useProgressive(rows, `${tab}|${show}|${q}`, 40, 60);

  if (list.isError) return <p className="py-8 text-[13px] text-destructive">{(list.error as Error).message}</p>;
  if (!data || !access) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const offModels = data.models.filter((m) => !modelOn(m) || m.offBy.length).length;
  const offLoras = data.loras.filter((l) => access.loras.includes(l.file) || access.classes.includes(l.licence.class)).length;
  // What the switches do, each said once: models that no longer run, LoRAs left out, and the GPU-only LoRA rule.
  const summary = allOn(access)
    ? owner
      ? "Everything is on. Switch off what this install shouldn't offer: it leaves the pickers and the server refuses it."
      : "Everything is on."
    : [
        offModels ? `${offModels} ${offModels === 1 ? "model is" : "models are"} turned off by the switches below` : "Every model still runs",
        offLoras > 0 && `${offLoras} ${offLoras === 1 ? "LoRA is" : "LoRAs are"} left out of runs`,
        access.keepGpuOnlyLoras && "LoRAs licensed for your GPU only stay off the cloud",
      ]
        .filter(Boolean)
        .join(". ") + ".";
  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "models", label: "Models", count: data.models.length },
    { value: "loras", label: "LoRAs", count: data.loras.length },
    { value: "packs", label: "Node packs", count: data.packs.length },
  ];
  // Rows grouped by licence class, in class order, a page at a time.
  const groups: { cls: LicenceClass; items: ModelEntry[] }[] = [];
  for (const m of models.slice(0, shown)) {
    const last = groups.at(-1);
    if (last?.cls === m.licence.class) last.items.push(m);
    else groups.push({ cls: m.licence.class, items: [m] });
  }
  const total = (cls: LicenceClass) => models.filter((m) => m.licence.class === cls).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 rounded-2xl border p-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold tabular-nums">
            {data.models.length - offModels} of {data.models.length} models offered
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{summary}</p>
          {!owner && <p className="mt-0.5 text-[13px] text-muted-foreground">The studio&apos;s owner chooses what this install offers.</p>}
        </div>
        {owner && !allOn(access) && (
          <Button variant="secondary" size="sm" className="h-9 shrink-0 self-start sm:self-center" onClick={() => flip({ kind: "reset" })} disabled={change.isPending}>
            <RotateCcw /> Back to the defaults
          </Button>
        )}
      </div>

      <section aria-labelledby="by-class">
        <h2 id="by-class" className="text-[15px] font-semibold">
          By licence
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {owner && "Switch off a whole kind of licence at once: the models and LoRAs under it. A model whose cloud and GPU halves differ keeps the half that is on. Node packs have their own switches below. "}
          The counts are the {data.models.length} models in Fuobe&apos;s catalog, open and paid: one that runs both on a GPU and in the cloud counts under each of its licences.
        </p>
        <ul className="mt-1 divide-y">
          {data.classes.map((c) => (
            <SwitchRow
              key={c.id}
              id={`class-${c.id}`}
              label={c.label}
              count={`· ${c.models} ${c.models === 1 ? "model" : "models"}${c.loras ? ` · ${c.loras} ${c.loras === 1 ? "LoRA" : "LoRAs"}` : ""}`}
              hint={c.hint}
              checked={!access.classes.includes(c.id)}
              onChange={(on) => flip({ kind: "class", id: c.id, on })}
              disabled={!owner}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="by-provider">
        <h2 id="by-provider" className="text-[15px] font-semibold">
          By provider
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">A model on several providers runs on one that is still on.</p>
        <ul className="mt-1 divide-y">
          {data.providers.map((p) => (
            <SwitchRow
              key={p.id}
              id={`provider-${p.id}`}
              label={p.label}
              count={`· ${p.models} ${p.models === 1 ? "model" : "models"}`}
              checked={!access.providers.includes(p.id)}
              onChange={(on) => flip({ kind: "provider", id: p.id, on })}
              disabled={!owner}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="lora-rule">
        <h2 id="lora-rule" className="text-[15px] font-semibold">
          LoRAs licensed for your GPU only
        </h2>
        <ul className="mt-1 divide-y">
          <SwitchRow
            id="rule-gpu-only"
            label="Keep them on your GPU"
            hint="Some civitai LoRAs allow commercial use but not running them on another hosted service (no “Rent” permission). Off: they go to fal.ai or Replicate like any other LoRA, and the run says so. On: cloud runs leave them out."
            checked={access.keepGpuOnlyLoras}
            onChange={(on) => flip({ kind: "keepGpuOnlyLoras", on })}
            disabled={!owner}
          />
        </ul>
      </section>

      <section aria-labelledby="everything" className="space-y-4">
        <h2 id="everything" className="text-[15px] font-semibold">
          Everything, with its licence
        </h2>
        <div role="group" aria-label="What to list" className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t.value} type="button" aria-pressed={tab === t.value} className={chip(tab === t.value)} onClick={() => setTab(t.value)}>
              {t.label} <span className="ml-0.5 tabular-nums opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search names or licences"
              aria-label="Search names or licences"
              className="h-9 w-full rounded-full border bg-background pr-3 pl-9 text-[14px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-brand-faint"
            />
          </div>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
            {(["all", "on", "off"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={show === s} className={chip(show === s)} onClick={() => setShow(s)}>
                {s === "all" ? "All" : s === "on" ? "On" : "Off"}
              </button>
            ))}
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          {rows} shown
        </p>
        {!rows && <p className="py-8 text-center text-[13px] text-muted-foreground">Nothing matches. Try another word or filter.</p>}

        {tab === "models" &&
          groups.map((g) => (
            <Fragment key={g.cls}>
              <h3 className="pt-2 text-[13px] font-semibold">
                {CLASS_LABEL[g.cls]} <span className="font-normal text-muted-foreground tabular-nums">· {total(g.cls)}</span>
              </h3>
              <ul className="divide-y">
                {g.items.map((m) => (
                  <ModelRow key={m.id} m={m} on={modelOn(m)} onChange={(on) => flip({ kind: "model", id: m.id, on })} disabled={!owner} />
                ))}
              </ul>
            </Fragment>
          ))}
        {tab === "loras" && (
          <ul className="divide-y">
            {loras.slice(0, shown).map((l) => (
              <LoraRow key={l.file} l={l} on={!access.loras.includes(l.file)} onChange={(on) => flip({ kind: "lora", id: l.file, on })} disabled={!owner} />
            ))}
          </ul>
        )}
        {tab === "packs" && (
          <ul className="divide-y">
            {packs.slice(0, shown).map((p) => (
              <PackRow key={p.name} p={p} on={!access.packs.includes(p.name)} onChange={(on) => flip({ kind: "pack", id: p.name, on })} disabled={!owner} />
            ))}
          </ul>
        )}
        {hasMore && (
          <button ref={sentinel} type="button" onClick={(e) => moreFrom(e, (e.currentTarget.previousElementSibling as HTMLElement) ?? null)} className="mx-auto block h-9 rounded-full px-4 text-[13px] font-medium text-muted-foreground hover:bg-accent">
            Show more
          </button>
        )}
        <p className="border-t pt-4 text-[12px] leading-relaxed text-muted-foreground">
          Licences are recorded from each model&apos;s card, the workflow library and the providers&apos; pages; read the licence itself before you sell what you make. This list is a guide, not legal advice.
        </p>
      </section>
    </div>
  );
}
