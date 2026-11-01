"use client";

import { ArrowUp, AudioLines, Loader2, Paperclip, Slash, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { uploadFile } from "@/lib/api";
import { insertSlash, pickSlash, slashQuery, slashSkills, type SkillSummary } from "@/lib/assist";
import type { MediaKind } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useEdgeFade } from "@/components/studio/use-edge-fade";
import { SkillIcon } from "./skill-icon";

interface Attachment {
  id: string;
  preview: string;
  url?: string;
  kind: MediaKind;
}

/**
 * Assist's prompt box: attachments (pick, paste, drop), Enter to send, and `/` to load a skill —
 * typing `/` at the start opens the skill menu (↑↓ to move, Enter or Tab to pick, Esc to close).
 */
export function AssistComposer({
  onSend,
  disabled,
  placeholder,
  autoFocus,
  footer,
  skills,
  initialText = "",
}: {
  onSend: (text: string, attachments: string[]) => Promise<void>;
  disabled?: boolean;
  placeholder: string;
  autoFocus?: boolean;
  footer?: React.ReactNode;
  /** Skills this chat can load (for the `/` menu). */
  skills?: SkillSummary[];
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [caret, setCaret] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [chipRow, fade] = useEdgeFade<HTMLDivElement>();
  const listId = useId();
  const uploading = files.some((f) => !f.url);
  const ready = text.trim().length > 0 && !uploading && !sending && !disabled;

  // Local previews (object URLs) are released once the upload settles, when removed, and on unmount.
  const blobs = useRef(new Set<string>());
  const release = (url: string) => {
    if (blobs.current.delete(url)) URL.revokeObjectURL(url);
  };
  useEffect(() => {
    const live = blobs.current;
    return () => {
      live.forEach((u) => URL.revokeObjectURL(u));
      live.clear();
    };
  }, []);

  const known = useMemo(() => new Map((skills ?? []).map((s) => [s.name, s])), [skills]);
  const used = useMemo(() => slashSkills(text, (n) => known.has(n)).skills, [text, known]);
  const query = slashQuery(text, caret);
  const matches = useMemo(() => {
    if (!query || !skills?.length) return [];
    const q = query.query.toLowerCase();
    const ranked = skills
      .filter((s) => !used.includes(s.name))
      .map((s) => ({ s, rank: s.name.startsWith(q) ? 0 : s.title.toLowerCase().startsWith(q) ? 1 : `${s.name} ${s.title} ${s.description}`.toLowerCase().includes(q) ? 2 : 9 }))
      .filter((x) => x.rank < 9)
      .sort((a, b) => a.rank - b.rank);
    // Matches by name or title first; description hits only fill in when those are few.
    const strong = ranked.filter((x) => x.rank < 2);
    return (strong.length >= 3 ? strong : ranked).slice(0, 8).map((x) => x.s);
  }, [query, skills, used]);
  const menuOpen = !!query && !menuClosed && matches.length > 0;
  const active = Math.min(menuIndex, Math.max(0, matches.length - 1));

  const add = (list: FileList | null) => {
    for (const f of Array.from(list ?? []).slice(0, 8 - files.length)) {
      const id = nanoid(6);
      const kind: MediaKind = f.type.startsWith("video") ? "video" : f.type.startsWith("audio") ? "audio" : "image";
      const blob = URL.createObjectURL(f);
      blobs.current.add(blob);
      setFiles((xs) => [...xs, { id, kind, preview: blob }]);
      uploadFile(f)
        // Show the uploaded file, then let the blob go (after the element has switched over).
        .then((a) => {
          setFiles((xs) => xs.map((x) => (x.id === id ? { ...x, url: a.url, preview: a.url } : x)));
          setTimeout(() => release(blob), 1500);
        })
        .catch((e) => {
          toastError(e);
          setFiles((xs) => xs.filter((x) => x.id !== id));
          release(blob);
        });
    }
  };
  const remove = (f: Attachment) => {
    setFiles((xs) => xs.filter((x) => x.id !== f.id));
    if (f.preview.startsWith("blob:")) release(f.preview);
  };

  const place = (next: string, pos: number) => {
    setText(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };
  const pick = (s: SkillSummary) => {
    if (!query) return;
    const r = pickSlash(text, caret, query.start, s.name);
    setMenuIndex(0);
    place(r.text, r.caret);
  };

  const unuse = (name: string) => {
    setText((t) => t.replace(new RegExp(`(^|\\s)/${name}(?=\\s|$)\\s*`), "$1").trimStart());
    area.current?.focus();
  };

  const send = async () => {
    if (!ready) return;
    setSending(true);
    try {
      await onSend(text.trim(), files.map((f) => f.url!));
      setText("");
      setFiles([]);
    } catch (e) {
      toastError(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      ref={box}
      className="relative rounded-[20px] border bg-background p-2.5 shadow-soft transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint sm:rounded-composer"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        add(e.dataTransfer.files);
      }}
    >
      {/* The skill menu: a popover anchored to the composer, so it flips below when there's no room
          above and is never clipped by the scrolling page or hidden under the header. Focus stays in
          the message box, which drives the list (↑↓, Enter, Esc). */}
      <Popover open={menuOpen} onOpenChange={(o) => !o && setMenuClosed(true)}>
        <PopoverAnchor virtualRef={box} />
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => box.current?.contains(e.target as Node) && e.preventDefault()}
          className="max-h-[min(18rem,var(--radix-popover-content-available-height))] w-[min(var(--radix-popover-trigger-width),40rem)] gap-0 overflow-y-auto rounded-2xl border bg-popover p-1 shadow-strong ring-0"
        >
          <div role="listbox" id={listId} aria-label="Skills">
            <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">Skills</p>
            {matches.map((s, i) => (
              <button
                key={s.name}
                type="button"
                role="option"
                id={`${listId}-${s.name}`}
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setMenuIndex(i)}
                onClick={() => pick(s)}
                ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left", i === active && "bg-accent")}
              >
                <SkillIcon name={s.name} icon={s.icon} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {s.title} <span className="font-mono text-[11px] font-normal text-muted-foreground">/{s.name}</span>
                  </span>
                  <span className="block truncate text-[12px] text-muted-foreground">{s.description}</span>
                </span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">
          {files.map((f) => (
            <div key={f.id} className="relative size-14 overflow-hidden rounded-lg border bg-muted">
              {f.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.preview} alt="" className="size-full object-cover" />
              ) : f.kind === "video" ? (
                <video src={f.preview} muted className="size-full object-cover" />
              ) : (
                <AudioLines className="m-auto mt-4 size-5 text-muted-foreground" />
              )}
              {!f.url && <Loader2 className="absolute inset-0 m-auto size-4 animate-spin text-foreground" />}
              <button onClick={() => remove(f)} className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-foreground/80 text-background" aria-label="Remove attachment">
                <X className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {used.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1.5 pt-0.5 pb-1">
          {used.map((n) => {
            const s = known.get(n)!;
            return (
              <span key={n} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-brand-faint pr-1 pl-1 text-[12px] font-medium text-brand-text">
                <SkillIcon name={s.name} icon={s.icon} size="sm" className="size-5" />
                {s.title}
                <button type="button" onClick={() => unuse(n)} className="grid size-5 place-items-center rounded-full hover:bg-brand-faint-hover" aria-label={`Don't use ${s.title}`}>
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <textarea
        ref={area}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setMenuClosed(false);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onPaste={(e) => e.clipboardData.files.length && add(e.clipboardData.files)}
        onKeyDown={(e) => {
          if (menuOpen) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setMenuIndex((i) => (Math.min(i, matches.length - 1) + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
              e.preventDefault();
              pick(matches[active]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setMenuClosed(true);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        rows={1}
        placeholder={placeholder}
        aria-label="Message"
        // A textarea can't be a combobox (axe aria-allowed-role): it stays a text box that says it has a skills list ("/"), and names the open list and its active row.
        aria-haspopup={skills?.length ? "listbox" : undefined}
        aria-controls={menuOpen ? listId : undefined}
        aria-activedescendant={menuOpen ? `${listId}-${matches[active]?.name}` : undefined}
        aria-autocomplete={skills?.length ? "list" : undefined}
        className="field-sizing-content max-h-56 min-h-12 w-full resize-none bg-transparent px-2 py-1.5 text-base leading-relaxed outline-none placeholder:text-subtle-foreground"
      />
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <input ref={input} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => input.current?.click()} className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground max-sm:size-8" aria-label="Attach files">
              <Paperclip className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Attach photos, video or audio</TooltipContent>
        </Tooltip>
        {!!skills?.length && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  // A new "/" after the skills already chosen, so another one is added (not swapped).
                  const r = insertSlash(text, [...known.keys()]);
                  setMenuClosed(false);
                  place(r.text, r.caret);
                }}
                className="hidden size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground sm:grid"
                aria-label="Use a skill"
              >
                <Slash className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Use a skill <Kbd>/</Kbd>
            </TooltipContent>
          </Tooltip>
        )}
        {/* Phones: the chips are one row that scrolls (faded at the edge), so the composer keeps its height and Send stays put. */}
        <div ref={chipRow} style={fade} className="scrollbar-none -my-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 sm:flex-wrap sm:gap-1.5 sm:overflow-visible">
          {footer}
        </div>
        <Button size="icon" className="size-10 shrink-0 rounded-full" disabled={!ready} onClick={() => void send()} aria-label="Send">
          {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
    </div>
  );
}
