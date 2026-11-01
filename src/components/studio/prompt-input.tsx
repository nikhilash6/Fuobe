"use client";

import { AtSign, AudioLines, MapPin, Package, Palette, Plus, ScanFace } from "lucide-react";
import Link from "next/link";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { elementKindInfo, mentionAtCaret, type ElementKind, type StudioElement } from "@/lib/catalog/elements";
import { hasMention } from "@/lib/composer";
import { cn } from "@/lib/utils";

export const ELEMENT_ICONS: Record<ElementKind, typeof ScanFace> = {
  character: ScanFace,
  location: MapPin,
  prop: Package,
  style: Palette,
  voice: AudioLines,
};

export interface PromptInputHandle {
  focus: () => void;
  /** Insert "@" at the caret and open the element menu. */
  startMention: () => void;
}

const MENTION = /@([\p{L}\p{N}_-]+)/gu;

/** Mirror of the textarea text with known @handles highlighted (drawn behind the transparent text). */
function Highlights({ text, handles }: { text: string; handles: Set<string> }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    if (!handles.has(m[1].toLowerCase())) continue;
    parts.push(text.slice(last, m.index));
    parts.push(
      <mark key={m.index} className="rounded-[5px] bg-brand-faint text-brand-text shadow-[0_0_0_2px_var(--brand-faint)]">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  // A trailing zero-width space keeps the mirror's height in step with a trailing newline.
  return (
    <>
      {parts}
      {"​"}
    </>
  );
}

export const PromptInput = forwardRef<
  PromptInputHandle,
  {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    placeholder?: string;
    elements: StudioElement[];
    className?: string;
    /** Docked and not focused: keep the prompt to one line. */
    collapsed?: boolean;
  }
>(function PromptInput({ value, onChange, onSubmit, placeholder, elements, className, collapsed }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);

  const visual = useMemo(() => elements.filter((e) => e.kind !== "voice"), [elements]);
  const handles = useMemo(() => new Set(visual.map((e) => e.handle.toLowerCase())), [visual]);
  const mention = caret != null ? mentionAtCaret(value, caret) : null;
  const open = !!mention && dismissed !== mention.start;
  const matches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return visual
      .filter((e) => !q || e.handle.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.handle.toLowerCase().startsWith(q)) - Number(a.handle.toLowerCase().startsWith(q)))
      .slice(0, 8);
  }, [mention, visual]);

  const syncCaret = () => setCaret(ta.current?.selectionStart ?? null);

  // Collapsed to one line (docked, not focused): show the start of the prompt, not wherever the caret was.
  useEffect(() => {
    if (!collapsed) return;
    if (ta.current) ta.current.scrollTop = 0;
    if (mirror.current) mirror.current.scrollTop = 0;
  }, [collapsed]);

  // Typed into before the page hydrated: keep those words (React would reset the field to the draft's value on its next update).
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });
  useLayoutEffect(() => {
    const el = ta.current;
    if (el && el.value !== value) onChangeRef.current(el.value);
    // Mount only: afterwards the field and the draft move together.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The "@" (and the space before it) that the @ button put in, while nothing was picked or typed after it.
  const started = useRef<{ at: number; len: number } | null>(null);
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  /** The @ button's "@" left alone (Escape, or a click elsewhere): taken out again, so the prompt isn't left with a stray "@". */
  const dropBareMention = () => {
    const s = started.current;
    started.current = null;
    const v = latest.current;
    if (!s || v.slice(s.at + s.len - 1, s.at + s.len) !== "@" || /\S/.test(v[s.at + s.len] ?? " ")) return;
    onChange(v.slice(0, s.at) + v.slice(s.at + s.len));
    setCaret(s.at);
  };

  const insert = (el: StudioElement) => {
    started.current = null;
    if (!mention) return;
    const end = caret ?? value.length;
    const next = `${value.slice(0, mention.start)}@${el.handle} ${value.slice(end)}`;
    const pos = mention.start + el.handle.length + 2;
    onChange(next);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    startMention: () => {
      const el = ta.current;
      const at = el?.selectionStart ?? value.length;
      const needsSpace = at > 0 && !/\s/.test(value[at - 1] ?? "");
      const next = `${value.slice(0, at)}${needsSpace ? " " : ""}@${value.slice(at)}`;
      const pos = at + (needsSpace ? 2 : 1);
      started.current = { at, len: needsSpace ? 2 : 1 };
      onChange(next);
      setDismissed(null);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
        setCaret(pos);
      });
    },
  }));

  const shared = "w-full px-2.5 py-1.5 text-left text-base leading-relaxed whitespace-pre-wrap break-words";

  return (
    <div className={cn("relative", className)}>
      <div ref={mirror} aria-hidden className={cn(shared, "pointer-events-none absolute inset-0 overflow-hidden text-foreground")}>
        <Highlights text={value} handles={handles} />
      </div>
      <textarea
        ref={ta}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onSelect={syncCaret}
        onClick={syncCaret}
        onBlur={() =>
          setTimeout(() => {
            setCaret(null);
            if (document.activeElement !== ta.current) dropBareMention();
          }, 120)
        }
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={(e) => {
          if (open && matches.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              insert(matches[Math.min(active, matches.length - 1)]);
              return;
            }
          }
          if (open && e.key === "Escape") {
            e.preventDefault();
            setDismissed(mention!.start);
            dropBareMention();
            return;
          }
          // Anything typed after the @ button's "@" is the visitor's own: it stays.
          if (e.key.length === 1 || e.key === "Backspace") started.current = null;
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={1}
        placeholder={placeholder}
        aria-label="Prompt"
        // Spellcheck would underline every @handle in red.
        spellCheck={!hasMention(value)}
        className={cn(
          shared,
          "scrollbar-none relative field-sizing-content resize-none bg-transparent text-transparent caret-foreground outline-none placeholder:text-subtle-foreground selection:bg-brand-faint selection:text-transparent",
          collapsed ? "max-h-[38px] min-h-[38px] overflow-hidden" : "max-h-52 min-h-12",
        )}
      />
      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(92vw,320px)] overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-heavy animate-in fade-in-0 zoom-in-95"
          onMouseDown={(e) => e.preventDefault()}
        >
          <p className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <AtSign className="size-3" /> Elements
          </p>
          {matches.map((el, i) => {
            const Icon = ELEMENT_ICONS[el.kind];
            return (
              <button
                key={el.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => insert(el)}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left", i === active && "bg-accent")}
              >
                <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                  {el.references[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={el.references[0]} alt="" className="size-full object-cover" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">@{el.handle}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {elementKindInfo(el.kind).label}
                    {el.references.length ? ` · ${el.references.length} photo${el.references.length > 1 ? "s" : ""}` : ""}
                    {el.loras.length ? " · trained" : ""}
                  </span>
                </span>
              </button>
            );
          })}
          {!matches.length && (
            <p className="px-2 py-3 text-[13px] text-muted-foreground">
              {visual.length ? "No element with that name." : "No elements yet. Save a character, location or prop once, then @mention it anywhere."}
            </p>
          )}
          <Link href="/elements?new=1" className="mt-1 flex items-center gap-2 rounded-lg border-t px-2 py-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground">
            <Plus className="size-3.5" /> New element
          </Link>
        </div>
      )}
    </div>
  );
});
