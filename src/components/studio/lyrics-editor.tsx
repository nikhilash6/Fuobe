"use client";

import { Loader2, Music2, PenLine, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { helperSignIn, useTextHelper, writeLyrics } from "@/lib/api";
import type { ModelDef } from "@/lib/catalog/types";
import { INSTRUMENTAL, insertTag, isInstrumental, normalizeLyrics, promptWithLyrics, SECTION_TAGS, songLength, structureOf } from "@/lib/lyrics";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";

/** The section tags offered as chips, most used first (the rest are one tap away in the same row). */
const CHIPS = ["Verse", "Chorus", "Pre-Chorus", "Bridge", "Intro", "Outro", "Instrumental", "Solo"] as const satisfies readonly (typeof SECTION_TAGS)[number][];

/**
 * Audio → Music's lyrics, for a model that sings them (ModelOptions.lyrics): the words with their section tags, chips that
 * put a tag on a line of its own at the cursor, "Write the lyrics" (the AI helper, from the song's description),
 * and how many characters the model takes. The draft keeps the words while you switch models; only one that sings gets them.
 */
export function LyricsEditor({
  model,
  value,
  onChange,
  idea,
  seconds,
}: {
  model: ModelDef;
  value: string;
  onChange: (v: string) => void;
  /** The song's description (the prompt): what "Write the lyrics" writes for. */
  idea: string;
  /** The length picked, so written lyrics fit it. */
  seconds?: number;
}) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [writing, setWriting] = useState(false);
  // "Write the lyrics": the owner's AI helper, or for a visitor the studio's free helper.
  const helper = useTextHelper();
  const router = useRouter();
  const spec = model.options.lyrics ?? {};
  // Lyrics read after the description (Lyria 3.5) count with it.
  const length = spec.inPrompt && value.trim() ? promptWithLyrics(idea, value).length : normalizeLyrics(value).length;
  const over = !!spec.max && length > spec.max;
  const structure = structureOf(value);
  const instrumental = !!value.trim() && isInstrumental(value);

  const tag = (name: string) => {
    const el = area.current;
    const at = el ? el.selectionStart : value.length;
    const next = insertTag(value, at, name);
    onChange(next.text);
    requestAnimationFrame(() => {
      if (!area.current) return;
      area.current.focus();
      area.current.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const write = async () => {
    if (!idea.trim()) return toast("Describe the song first: its subject, mood and style. The lyrics are written from it");
    setWriting(true);
    try {
      onChange(await writeLyrics(idea, { seconds, max: spec.max }));
    } catch (e) {
      // A guest: "Create a free account". Nothing set up to write them: one click to Settings → AI helper.
      if (helperSignIn(e)) return;
      if ((e as { code?: string }).code === "no-llm") toast.error((e as Error).message, { action: { label: "Set up", onClick: () => router.push("/settings#text-ai") } });
      else toastError(e);
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="mx-2 mb-2 rounded-xl border bg-background" data-testid="lyrics-editor">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2">
        <label htmlFor={id} className="inline-flex items-center gap-1.5 text-[13px] font-medium">
          <PenLine className="size-3.5 text-muted-foreground" /> Lyrics
          {!spec.required && <span className="font-normal text-muted-foreground">optional</span>}
        </label>
        <span className="ml-auto flex items-center gap-1">
          {helper && (
            <button
              type="button"
              onClick={write}
              disabled={writing}
              className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-brand-text hover:bg-brand-faint disabled:opacity-60"
            >
              {writing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {writing ? "Writing…" : "Write the lyrics"}
            </button>
          )}
          {!spec.required && !spec.instrumentalModel && (
            <button
              type="button"
              onClick={() => onChange(instrumental ? "" : INSTRUMENTAL)}
              aria-pressed={instrumental}
              className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium hover:bg-accent", instrumental ? "bg-brand-faint text-brand-text" : "text-muted-foreground")}
            >
              <Music2 className="size-3.5" /> Instrumental
            </button>
          )}
          {value && (
            <button type="button" onClick={() => onChange("")} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent" aria-label="Clear the lyrics">
              <X className="size-3.5" />
            </button>
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 px-2.5 pt-1.5" role="group" aria-label="Add a section">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => tag(c)}
            className="h-6 rounded-full border bg-secondary px-2 font-mono text-[11px] text-secondary-foreground hover:bg-accent"
          >
            [{c}]
          </button>
        ))}
      </div>
      <textarea
        id={id}
        ref={area}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        spellCheck
        placeholder={"[Verse]\nThe words of the first verse…\n\n[Chorus]\nThe hook everyone sings…"}
        aria-describedby={`${id}-hint`}
        className="mt-1.5 block max-h-72 min-h-28 w-full resize-y bg-transparent px-3 py-1.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
      />
      <p id={`${id}-hint`} className={cn("flex flex-wrap items-center gap-x-2 border-t px-3 py-1.5 text-[11px] text-muted-foreground", over && "text-destructive")}>
        <span className="min-w-0 flex-1">
          {structure.length ? structure.join(" · ") : spec.inPrompt ? `${model.name} reads the lyrics with your description` : "Each tag on its own line, the words under it"}
          {seconds ? ` · up to ${songLength(seconds)}` : ""}
        </span>
        {spec.max ? (
          <span className="tabular-nums">
            {length.toLocaleString("en-US")} / {spec.max.toLocaleString("en-US")}
          </span>
        ) : null}
      </p>
    </div>
  );
}
