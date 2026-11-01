"use client";

import { Bot, ChevronDown, Cloud, Cpu, Gauge, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ASSIST_EFFORTS,
  ASSIST_MODES,
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_EFFORT,
  normalizeAgent,
  type AssistAgent,
  type AssistAvailability,
  type AssistEffort,
  type AssistModeChoice,
  type AssistModelOption,
} from "@/lib/assist";
import { cn } from "@/lib/utils";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";

const KEY = "fuobe:assist-mode";

const listeners = new Set<() => void>();
/** Used when the browser won't store anything (private windows, blocked storage). */
let fallback: string | null = null;
const readSaved = () => {
  try {
    return localStorage.getItem(KEY) ?? fallback;
  } catch {
    return fallback;
  }
};

/** The mode new chats start in (remembered in this browser; the server's default until one is picked). */
export function useModeChoice(defaultMode?: AssistModeChoice["mode"]): [AssistModeChoice | null, (c: AssistModeChoice) => void] {
  const raw = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    readSaved,
    () => null,
  );
  const choice = useMemo(() => {
    try {
      const saved = JSON.parse(raw ?? "null") as AssistModeChoice | null;
      // A choice saved when the local agent was called "ollama" reads as "local".
      if (saved?.mode) return saved.agent ? { ...saved, agent: normalizeAgent(saved.agent) } : saved;
    } catch {}
    return defaultMode ? { mode: defaultMode } : null;
  }, [raw, defaultMode]);
  return [
    choice,
    (c) => {
      fallback = JSON.stringify(c);
      try {
        localStorage.setItem(KEY, fallback);
      } catch {}
      listeners.forEach((l) => l());
    },
  ];
}

export function modeChipLabel(c: AssistModeChoice | null, can?: AssistAvailability): string {
  if (!c) return "Mode";
  if (can?.aiOff) return "Offline";
  if (c.mode !== "manual") return c.mode === "smart" ? "Smart" : "Free";
  if (c.agent === "offline") return "Offline planner";
  if (c.agent === "local") return c.model ?? can?.local.model ?? "Local";
  const effort = ASSIST_EFFORTS.find((e) => e.id === (c.effort ?? DEFAULT_EFFORT))?.label;
  if (c.agent === "hosted") {
    const m = can?.manual.groups.flatMap((g) => g.models).find((x) => x.provider === c.provider && x.model === c.model);
    const name = m?.name ?? c.model ?? "Model";
    return m && !m.efforts.length ? name : `${name} · ${effort}`;
  }
  const m = CLAUDE_MODELS.find((x) => x.id === (c.model ?? DEFAULT_CLAUDE_MODEL))?.label.replace("Claude ", "") ?? "Claude";
  return `${m} · ${effort}`;
}

const MODE_ICON = { smart: Sparkles, free: Cpu, manual: Gauge } as const;

const sameChoice = (a: AssistModeChoice | null, b: AssistModeChoice | null) =>
  (a?.mode ?? null) === (b?.mode ?? null) &&
  (a?.agent ?? null) === (b?.agent ?? null) &&
  (a?.provider ?? null) === (b?.provider ?? null) &&
  (a?.model ?? null) === (b?.model ?? null) &&
  (a?.effort ?? null) === (b?.effort ?? null);

interface ModelOption {
  key: string;
  on: boolean;
  disabled?: string;
  pick: Partial<AssistModeChoice>;
  icon: typeof Bot;
  title: React.ReactNode;
  hint: string;
  /** Searched by the filter box. */
  text: string;
  /** The effort levels it offers (none: no effort row). */
  efforts: AssistEffort[];
}

/** The local model server's models, as today: "Local, through LM Studio · free". */
function localOptions(can: AssistAvailability | undefined, on: (name: string) => boolean): ModelOption[] {
  const names = can?.local.models.length ? can.local.models : can?.local.ok && can.local.model ? [can.local.model] : [];
  return names.map((name) => ({
    key: `local:${name}`,
    on: on(name),
    pick: { agent: "local" as const, provider: null, model: name, effort: null },
    icon: Cpu,
    title: <span className="block truncate font-mono text-[12px]">{name}</span>,
    hint: /-cloud$|:cloud$/.test(name) ? `Ollama Cloud · paid, through ${can?.local.label ?? "Ollama"}` : `Local, through ${can?.local.label ?? "your local server"} · free`,
    text: name,
    efforts: [],
  }));
}

/** One model of a connected provider: its name, then a line with the price, what it is and where its weights are open. */
function hostedOption(m: AssistModelOption, shown: AssistModeChoice | null): ModelOption {
  const claude = m.agent === "claude";
  const picked = claude ? shown?.agent === "claude" && (shown?.model ?? DEFAULT_CLAUDE_MODEL) === m.model : shown?.agent === "hosted" && shown?.provider === m.provider && shown?.model === m.model;
  const hint = [claude ? CLAUDE_MODELS.find((c) => c.id === m.model)?.hint : (m.manualOnly ?? m.note), m.price, m.open].filter(Boolean).join(" · ");
  return {
    key: `${m.provider}:${m.model}`,
    on: picked,
    ...(m.disabled && { disabled: m.disabled }),
    pick: claude ? { agent: "claude" as const, provider: null, model: m.model } : { agent: "hosted" as const, provider: m.provider, model: m.model },
    icon: claude ? Bot : Cloud,
    title: <span className="block text-[13px] font-medium">{m.name}</span>,
    hint,
    text: `${m.name} ${m.providerLabel} ${m.model}`,
    efforts: m.efforts,
  };
}

/**
 * Supercomputer's Free / Smart / Manual, on Fuobe's agents: Claude, the hosted providers the owner connected
 * (OpenAI, Gemini, DeepSeek, OpenRouter…), a local model (Ollama, LM Studio, Unsloth Studio or another
 * OpenAI-compatible server) and the offline planner. Smart and Free say which model they use; Manual lists the
 * connected providers' models in groups, and the others as one "Add a key" line.
 * With `applyOnClose` (an existing chat) choices are kept in the menu and sent once when it
 * closes, so trying the tabs doesn't switch the chat at every click. Smart needs a model: with
 * nothing connected it can't be picked (and a saved Smart shows as the Free it runs as).
 */
export function ModePicker({
  value,
  onChange,
  availability: can,
  disabled,
  applyOnClose,
}: {
  value: AssistModeChoice | null;
  onChange: (c: AssistModeChoice) => void;
  availability?: AssistAvailability;
  disabled?: boolean;
  applyOnClose?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AssistModeChoice | null>(null);
  const [find, setFind] = useState("");
  const shown = (applyOnClose && open ? draft : null) ?? value;
  const smartOff = !!can && !can.smart?.plan;
  const picked = shown?.mode ?? can?.defaultMode ?? "smart";
  const mode = picked === "smart" && smartOff ? "free" : picked;
  // The label, its aria-label and the icon all come from this one resolved value.
  const resolved: AssistModeChoice = { ...(shown ?? {}), mode };
  const label = modeChipLabel(resolved, can);
  const Icon = MODE_ICON[mode];
  const agent: AssistAgent = shown?.agent ?? "claude";
  const set = (patch: Partial<AssistModeChoice>) => {
    const next = { ...resolved, ...patch } as AssistModeChoice;
    if (applyOnClose) setDraft(next);
    else onChange(next);
  };
  const onOpenChange = (o: boolean) => {
    if (o) setDraft(value);
    else if (applyOnClose && draft && !sameChoice(draft, value)) onChange(draft);
    setOpen(o);
  };
  const pending = applyOnClose && open && draft && !sameChoice(draft, value);

  // Manual: each connected provider's models (Claude's first when Anthropic is connected), the local server's, then the offline planner.
  const groups: { id: string; label: string; status?: string; models: ModelOption[] }[] = [
    ...(can?.manual?.groups ?? []).filter((g) => g.models.some((m) => m.agent !== "local")).map((g) => ({ id: g.id, label: g.label, status: g.status, models: g.models.map((m) => hostedOption(m, shown)) })),
    ...(can?.local.models.length || can?.local.ok ? [{ id: "local", label: can.local.label, status: "On this machine", models: localOptions(can, (name) => agent === "local" && (shown?.model ?? can?.local.model) === name) }] : []),
    {
      id: "offline",
      label: "No LLM",
      models: [{ key: "offline", on: agent === "offline", pick: { agent: "offline", provider: null, model: null, effort: null }, icon: Gauge, title: <span className="block text-[13px] font-medium">Offline planner</span>, hint: "Rules, no LLM — simple requests only", text: "offline planner", efforts: [] }],
    },
  ];
  const all = groups.flatMap((g) => g.models);
  const q = find.trim().toLowerCase();
  const listed = q ? groups.map((g) => ({ ...g, models: g.models.filter((m) => m.text.toLowerCase().includes(q)) })).filter((g) => g.models.length) : groups;
  // One Tab stop per group: the picked option, or the first one that can be picked.
  const modelStop = all.find((m) => m.on && !m.disabled)?.key ?? all.find((m) => !m.disabled)?.key;
  const current = all.find((m) => m.on);
  const efforts = agent === "claude" ? ASSIST_EFFORTS.map((e) => e.id) : (current?.efforts ?? []);
  const effort = shown?.effort ?? DEFAULT_EFFORT;
  const missing = can?.manual?.missing ?? [];
  // Manual starts on Smart's model (or the local one, or the offline planner) until one is picked.
  const manualStart = (): Partial<AssistModeChoice> => {
    const plan = can?.smart?.plan;
    if (plan && plan.agent !== "local") return plan.agent === "claude" ? { agent: "claude", provider: null, model: plan.model } : { agent: "hosted", provider: plan.provider, model: plan.model };
    return { agent: can?.local.ok ? "local" : "offline" };
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          // One width for "Smart", "Free" and "Mode": the label can change once availability loads, and the chips after it must not move.
          // Phones drop the chevron, so the composer's chips fit one row at 390 px.
          className="inline-flex h-8 max-w-[11rem] min-w-[6.5rem] shrink-0 items-center justify-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-50 max-sm:min-w-[5rem] max-sm:px-2.5"
          aria-label={`Mode: ${label}`}
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60 max-sm:hidden" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="max-h-[var(--radix-popover-content-available-height)] w-[min(92vw,360px)] overflow-y-auto overscroll-contain p-3">
        {can?.aiOff && (
          <p className="mb-3 rounded-lg bg-highlight/25 px-3 py-2 text-[12px]">
            The AI helper is off in{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Settings
            </Link>
            , so every chat uses the offline planner.
          </p>
        )}
        <div role="radiogroup" aria-label="Mode" onKeyDown={radioKeys} className="grid grid-cols-3 gap-1 rounded-full bg-muted p-0.5">
          {ASSIST_MODES.map((m) => {
            const off = m.id === "smart" && smartOff;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                tabIndex={radioTab(mode === m.id)}
                disabled={off}
                title={off ? can?.smart?.text : undefined}
                onClick={() => set({ mode: m.id, ...(m.id === "manual" && !shown?.agent && manualStart()) })}
                className={cn("h-8 rounded-full text-[13px] font-medium transition-colors disabled:opacity-45", mode === m.id ? "bg-background text-foreground shadow-soft" : "text-muted-foreground enabled:hover:text-foreground")}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-[12px] text-muted-foreground">{ASSIST_MODES.find((m) => m.id === mode)?.hint}</p>
        {mode === "smart" && can?.smart?.plan && <p className="mt-2 px-1 text-[12px]">{can.smart.text}</p>}
        {/* Why Smart can't run: nothing connected, or what blocks the models that are (a rejected key, Open source only…). */}
        {smartOff && (
          <p className="mt-2 px-1 text-[12px] text-warning">
            {can?.smart?.text}{" "}
            <Link href="/settings#llm-providers" className="underline underline-offset-2">
              Open Settings
            </Link>
          </p>
        )}
        {mode === "free" && can?.free && (
          <div className="mt-2 space-y-1 px-1 text-[12px] text-muted-foreground">
            <p>{can.free.pick || !can.local.problem ? can.free.text : `${can.local.problem} Until then, the offline planner takes simple requests.`}</p>
            {can.free.caveat && <p className="text-[11px]">{can.free.caveat}</p>}
          </div>
        )}
        {can?.openOnly && mode !== "free" && (
          <p className="mt-2 px-1 text-[11px] text-muted-foreground">
            Open source only: open-weight models that cost nothing, on this machine or a provider&apos;s free ones
            {can.claude ? ", and Claude (AI helper is set to Claude)." : ". Nothing goes to a paid API."}
          </p>
        )}
        {mode === "manual" && (
          <div className="mt-3 space-y-3">
            {all.length > 12 && (
              <input
                type="search"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder="Find a model"
                aria-label="Find a model"
                className="h-8 w-full rounded-lg border bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
            <div role="radiogroup" aria-label="Model" onKeyDown={radioKeys} className="max-h-[40vh] space-y-2 overflow-y-auto overscroll-contain">
              {listed.map((g) => (
                <div key={g.id} className="space-y-0.5">
                  <p className="px-2.5 pt-1 text-[11px] font-medium text-muted-foreground">
                    {g.label}
                    {g.status && g.status !== "Key set" ? ` · ${g.status}` : ""}
                  </p>
                  {g.models.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      role="radio"
                      aria-checked={m.on}
                      tabIndex={m.key === modelStop ? 0 : -1}
                      disabled={!!m.disabled}
                      title={m.disabled}
                      onClick={() => set(m.pick)}
                      className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent", m.on && "bg-brand-faint hover:bg-brand-faint-hover")}
                    >
                      <m.icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        {m.title}
                        <span className="block text-[11px] text-muted-foreground">{m.disabled ?? m.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {missing.length > 0 && (
              <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
                Add a key:{" "}
                <Link href="/settings#llm-providers" className="underline underline-offset-2">
                  {missing.map((p) => p.label).join(" · ")}
                </Link>
              </p>
            )}
            {efforts.length > 0 && (
              <div>
                <p className="mb-1.5 px-1 text-[12px] font-medium">Effort</p>
                <div role="radiogroup" aria-label="Effort" onKeyDown={radioKeys} className="grid grid-cols-5 gap-0.5 rounded-full bg-muted p-0.5">
                  {ASSIST_EFFORTS.map((e) => {
                    const offered = efforts.includes(e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        role="radio"
                        aria-checked={effort === e.id}
                        tabIndex={radioTab(effort === e.id)}
                        disabled={!offered}
                        title={offered ? undefined : "This model doesn't offer this level"}
                        onClick={() => set({ effort: e.id })}
                        className={cn("h-7 rounded-full text-[12px] font-medium transition-colors disabled:opacity-40", effort === e.id ? "bg-background text-foreground shadow-soft" : "text-muted-foreground enabled:hover:text-foreground")}
                      >
                        {e.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">Higher effort thinks longer and costs more per reply.</p>
              </div>
            )}
          </div>
        )}
        {pending && <p className="mt-3 border-t px-1 pt-2 text-[11px] text-muted-foreground">Applies to this chat when you close this menu.</p>}
      </PopoverContent>
    </Popover>
  );
}
