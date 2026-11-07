"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, Segmented } from "@/components/shorts/ui";
import { reshootFeature, type FeatureCheck } from "@/lib/catalog/genjutsu";
import { RESHOOT, RESHOOT_CHOICES, type ReshootChoice, type ReshootOptions } from "@/lib/catalog/reshoot";
import type { FeatureMark } from "./openjutsu-panels";

/**
 * Fuobe Reshoot's fields in Genjutsu: who's in it or what's in it, the words for it, and whether the picture is already
 * the painted first frame. Phone first (44 px taps, wraps). Self-contained, so the mode can move to a page of its own.
 */
export function ReshootFields({
  value,
  onChange,
  open,
  mark,
  seed,
  onSeed,
}: {
  value: ReshootOptions;
  onChange: (o: ReshootOptions) => void;
  open: FeatureCheck;
  mark: FeatureMark;
  seed: string;
  onSeed: (s: string) => void;
}) {
  const choices = RESHOOT_CHOICES.filter((c) => open(reshootFeature(c.id)));
  const info = RESHOOT_CHOICES.find((c) => c.id === value.choice) ?? RESHOOT_CHOICES[0];
  const set = (o: Partial<ReshootOptions>) => onChange({ ...value, ...o });
  const swap = value.choice === "swap";
  return (
    <div className="space-y-3">
      {choices.length > 1 && (
        <Field label="What changes" hint={mark(reshootFeature(value.choice))}>
          <Segmented label="What changes" value={value.choice} onChange={(c: ReshootChoice) => set({ choice: c })} options={choices.map((c) => ({ value: c.id, label: c.label }))} />
        </Field>
      )}
      <p className="text-[12px] text-muted-foreground">{info.hint}</p>
      {swap && (
        <Field label="Who they replace (optional)" htmlFor="rs-who">
          <Input
            id="rs-who"
            value={value.who ?? ""}
            onChange={(e) => set({ who: e.target.value.slice(0, RESHOOT.whoChars) })}
            maxLength={RESHOOT.whoChars}
            placeholder="e.g. “the woman in the white coat”"
            className="h-11 text-[13px]"
          />
        </Field>
      )}
      <Field label={swap ? "The new person (optional)" : "What changes"} htmlFor="rs-words">
        <Textarea
          id="rs-words"
          value={value.words ?? ""}
          onChange={(e) => set({ words: e.target.value.slice(0, RESHOOT.wordsChars) })}
          maxLength={RESHOOT.wordsChars}
          rows={3}
          placeholder={
            swap
              ? "e.g. “a tall model with a sleek black bob, in an ivory silk trench coat and gold hoops”"
              : "e.g. “she wears a crimson velvet gown with long gloves”, or “fresh snow covers the street and keeps falling”"
          }
          className="resize-none text-[13px]"
        />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-[12px] text-muted-foreground">
        <Switch checked={!!value.painted} onCheckedChange={(on) => set({ painted: on || undefined })} aria-label="My picture is the first frame, already changed" />
        My picture is the part&apos;s first frame, already changed
      </label>
      <Field label="Seed" htmlFor="rs-seed" hint="Blank: a new one each time">
        <Input id="rs-seed" inputMode="numeric" value={seed} onChange={(e) => onSeed(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} className="h-11 text-[13px]" />
      </Field>
    </div>
  );
}
