"use client";

import { Drama, Gamepad2, Lightbulb, MessageCircle, PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChatKind } from "@/lib/chat/catalog";
import type { ChatMe } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

const KIND_ICON = { chat: MessageCircle, ideas: Lightbulb, write: PenLine, character: Drama, play: Gamepad2 } as const;

export function KindIcon({ kind, className }: { kind: ChatKind; className?: string }) {
  const Icon = KIND_ICON[kind] ?? MessageCircle;
  return <Icon className={cn("size-[18px]", className)} />;
}

/** Who answers, in a few words: Fuobe's free model (ready or busy) or the person's own key. */
export function EngineLine({ me, className }: { me: ChatMe | undefined; className?: string }) {
  if (!me) return null;
  const key = me.engine === "key" && me.key;
  const short = key ? me.key!.model.split("/").pop()!.replace(/:free$/, "") : null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 px-1 text-[12.5px] text-muted-foreground", className)}>
      {(key || me.site) && <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />}
      <span className="truncate">{key ? `Your key · ${short}` : "Free model"}</span>
    </span>
  );
}

export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Three soft dots while a reply is on its way (the words are for screen readers). */
export function TypingDots({ label }: { label: string }) {
  return (
    <span className="flex h-4 items-center gap-1.5 text-muted-foreground" role="status">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-2 animate-bounce rounded-full bg-current opacity-70 motion-reduce:animate-none" style={{ animationDelay: `${i * 150}ms`, animationDuration: "1.1s" }} aria-hidden />
      ))}
      <span className="sr-only">{label}…</span>
    </span>
  );
}

/**
 * A reply that arrived all at once, shown as if written: quick, by word, never longer than about a second and a half.
 * With reduced motion it shows at once.
 */
export function useReveal(text: string, on: boolean): string {
  // Decided when the message first shows: a reply that arrived whole starts empty, every other shows in full.
  const [n, setN] = useState(() => (on && typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : Number.POSITIVE_INFINITY));
  const revealing = n < text.length;
  useEffect(() => {
    if (!revealing) return;
    const step = Math.max(3, Math.ceil(text.length / 90));
    const id = window.setInterval(() => {
      setN((x) => {
        if (x >= text.length) return Number.POSITIVE_INFINITY;
        // Stop at the end of a word so letters don't flicker.
        let next = Math.min(text.length, x + step);
        while (next < text.length && !/\s/.test(text[next])) next++;
        return next;
      });
    }, 16);
    return () => window.clearInterval(id);
  }, [revealing, text]);
  return revealing ? text.slice(0, n) : text;
}
