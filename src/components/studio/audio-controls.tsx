"use client";

import { AudioLines, Check, Globe, Minus, Plus, Upload, User, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useAskBeforeUpload, useElements } from "@/lib/api";
import type { GenParams, ModelDef } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { voiceOrigin } from "@/lib/voice-design";
import { fileToSlot, type SlotValue } from "./media-slot";
import { VoiceRecorder } from "./voice-recorder";
import { useMaybeClean } from "@/components/audio-tools/clean-voice-switch";

const chip = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors";
const idle = "bg-secondary text-secondary-foreground hover:bg-accent";
const on = "bg-brand-faint text-brand-text hover:bg-brand-faint-hover";

export type VoiceChoice = { kind: "preset"; id: string } | { kind: "sample"; value: SlotValue };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  );
}

function Row({ active, onClick, icon, name, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; name: string; hint?: string }) {
  return (
    <button onClick={onClick} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent", active && "bg-brand-faint")}>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13px] font-medium", active && "text-brand-text")}>{name}</span>
        {hint && <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      {active && <Check className="size-3.5 text-brand-text" />}
    </button>
  );
}

/**
 * Pick a premade voice (ElevenLabs), one of your saved voices, or a fresh sample to clone
 * (record or upload) — whatever the model accepts.
 */
export function VoicePicker({
  model,
  voice,
  sample,
  onChange,
  label = "Voice",
}: {
  model: ModelDef;
  voice?: string;
  sample?: SlotValue | null;
  onChange: (c: VoiceChoice | null) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const saved = (useElements().data ?? []).filter((e) => e.kind === "voice" && e.references[0]);
  const presets = model.options.voices ?? [];
  const clone = !!model.options.voiceClone;
  const preset = presets.find((v) => v.id === voice || v.name === voice);
  const current = sample?.ref ? (saved.find((e) => e.references[0] === sample.ref)?.name ?? sample.name ?? "Your sample") : preset?.name;
  const list = presets.filter((v) => !q || `${v.name} ${v.hint ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const pick = (c: VoiceChoice) => {
    onChange(c);
    setOpen(false);
  };
  // Someone whose upload would be refused (a guest, an account with no GPU or key) gets its card, not the file chooser.
  // (A voice sample is uploaded as it is picked: a guest signs up first, even where a studio keeps its pictures.)
  const askFirst = useAskBeforeUpload({ hold: false });
  const clean = useMaybeClean();
  const upload = () => {
    if (!askFirst()) return file.current?.click();
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(chip, current ? on : idle)}>
          <User className="size-3.5" />
          {current ?? (clone ? `${label}: add a sample` : label)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,340px)] p-1.5" align="start" side="top" collisionPadding={12}>
        {clone && (
          <Section title="Clone a voice">
            <div className="flex flex-wrap gap-1.5 px-2 pb-1">
              <VoiceRecorder clean onRecorded={(v) => pick({ kind: "sample", value: v })} />
              <button type="button" onClick={upload} className={cn(chip, idle)}>
                <Upload className="size-3.5" /> Upload
              </button>
              <input
                ref={file}
                type="file"
                accept="audio/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void fileToSlot(f, (v) => v && !v.uploading && void clean.run(v, (c) => pick({ kind: "sample", value: c })), "audio");
                  e.target.value = "";
                }}
              />
            </div>
            <p className="px-2 pb-1 text-[11px] text-muted-foreground">{clean.busy ? "Cleaning the voice…" : "10–60 s of clean speech works best. Clean samples make cleaner clones: a clone copies room noise."}</p>
          </Section>
        )}
        {clone && (
          <Section title="My voices">
            {saved.length ? (
              saved.map((e) => (
                <Row
                  key={e.id}
                  active={sample?.ref === e.references[0]}
                  onClick={() => pick({ kind: "sample", value: { ref: e.references[0], preview: e.references[0], kind: "audio", name: e.name } })}
                  icon={<AudioLines className="size-3.5" />}
                  name={e.name}
                  hint={voiceOrigin(e.voice) ?? e.description ?? "Saved voice"}
                />
              ))
            ) : (
              <p className="px-2 pb-1 text-[12px] text-muted-foreground">
                Save voices you reuse in{" "}
                <Link href="/elements?new=1" className="text-brand-text underline underline-offset-2">
                  Elements
                </Link>
                .
              </p>
            )}
          </Section>
        )}
        {presets.length > 0 && (
          <Section title="Voices">
            {presets.length > 8 && (
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search voices"
                className="mx-2 mb-1 h-8 w-[calc(100%-1rem)] rounded-md border bg-background px-2 text-sm outline-none focus:border-primary"
              />
            )}
            <div className="max-h-64 overflow-y-auto">
              {list.map((v) => (
                <Row
                  key={v.id}
                  active={preset?.id === v.id && !sample?.ref}
                  onClick={() => pick({ kind: "preset", id: v.id })}
                  icon={<User className="size-3.5" />}
                  name={v.name}
                  hint={v.hint}
                />
              ))}
            </div>
          </Section>
        )}
        {!clone && !presets.length && <p className="p-3 text-[13px] text-muted-foreground">{model.name} uses its own voice.</p>}
      </PopoverContent>
    </Popover>
  );
}

/** Numeric model settings (stability, similarity, speed, strength…), sent as-is. Shown in the settings panel. */
export function SliderControls({ model, values, onChange }: { model: ModelDef; values: Record<string, unknown>; onChange: (param: string, v?: number) => void }) {
  const sliders = model.options.sliders ?? [];
  return (
    <div className="space-y-3.5">
      {sliders.map((s) => {
        const v = typeof values[s.param] === "number" ? (values[s.param] as number) : s.default;
        const changed = v !== s.default;
        return (
          <div key={s.param} className="space-y-2">
            <div className="flex items-center justify-between text-[13px]">
              <span>{s.label}</span>
              <span className="flex items-center gap-1.5">
                {changed && (
                  <button className="rounded text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50" onClick={() => onChange(s.param, undefined)} aria-label={`Reset ${s.label}`}>
                    Reset
                  </button>
                )}
                <span className="text-[12px] text-muted-foreground tabular-nums">{Number(v.toFixed(2))}</span>
              </span>
            </div>
            <Slider value={[v]} min={s.min} max={s.max} step={s.step} onValueChange={([x]) => onChange(s.param, x)} aria-label={s.label} />
          </div>
        );
      })}
    </div>
  );
}

const display = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    return null;
  }
})();
const langLabel = (l: string) => (/^[a-z]{2,3}$/.test(l) ? (display?.of(l) ?? l) : l);

/** Target language for dubbing / translation. */
export function LanguageChip({ languages, value, onChange, label = "Translate to…" }: { languages: string[]; value?: string; onChange: (v: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => languages.filter((l) => !q || langLabel(l).toLowerCase().includes(q.toLowerCase())), [languages, q]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(chip, value ? on : idle)}>
          <Globe className="size-3.5" /> {value ? langLabel(value) : label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1.5" align="start" side="top" collisionPadding={12}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search languages"
          className="mb-1 h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:border-primary"
        />
        <div className="max-h-72 overflow-y-auto">
          {list.map((l) => (
            <button
              key={l}
              onClick={() => {
                onChange(l);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent",
                value === l && "bg-brand-faint text-brand-text",
              )}
            >
              {langLabel(l)}
              {value === l && <Check className="size-3.5" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type Line = NonNullable<GenParams["dialogue"]>[number];

/** Script with one voice per line (ElevenLabs Dialogue). */
export function DialogueEditor({ model, lines, onChange }: { model: ModelDef; lines: Line[]; onChange: (l: Line[]) => void }) {
  const voices = model.options.voices ?? [];
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const chars = lines.reduce((n, l) => n + l.text.length, 0);
  return (
    <div className="space-y-1.5 px-1.5 pt-1 pb-2">
      {lines.map((l, i) => (
        <div key={i} className="flex items-start gap-2 rounded-xl border bg-muted/40 p-1.5">
          <select
            value={l.voice ?? ""}
            onChange={(e) => set(i, { voice: e.target.value })}
            className="h-8 w-32 shrink-0 rounded-lg border bg-background px-2 text-[13px] font-medium outline-none focus:border-primary"
            aria-label={`Voice for line ${i + 1}`}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <textarea
            value={l.text}
            onChange={(e) => set(i, { text: e.target.value })}
            rows={1}
            placeholder={i % 2 ? "…and the reply." : "What does the first speaker say?"}
            className="field-sizing-content max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1 text-[14px] leading-snug outline-none placeholder:text-subtle-foreground"
          />
          <button
            onClick={() => onChange(lines.filter((_, j) => j !== i))}
            disabled={lines.length <= 1}
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
            aria-label={`Remove line ${i + 1}`}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center px-1">
        <button
          // New lines alternate between the last two speakers.
          onClick={() => onChange([...lines, { text: "", voice: lines.at(-2)?.voice ?? voices[0]?.id }])}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-text hover:underline"
        >
          <Plus className="size-3" /> Add line
        </button>
        {lines.length > 1 && (
          <button
            onClick={() => onChange(lines.slice(0, -1))}
            className="ml-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <Minus className="size-3" /> Last line
          </button>
        )}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{chars} chars</span>
      </div>
    </div>
  );
}
