"use client";

import { BookOpen, Brain, CalendarClock, Clapperboard, ImageIcon, Music4, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { askToSignUp, useAssistActions, useEngine } from "@/lib/api";
import { ASSIST_SUGGESTIONS } from "@/lib/assist";
import { makeItHref, type MakeStudio } from "@/lib/chat/prompt";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import { ChatComposer } from "./composer";

const STUDIOS: { id: MakeStudio; label: string; icon: typeof ImageIcon }[] = [
  { id: "image", label: "Image", icon: ImageIcon },
  { id: "video", label: "Video", icon: Clapperboard },
  { id: "music", label: "Music", icon: Music4 },
];

/**
 * Chat's Make tab: say what to make. The owner's request is planned and run step by step (an Assist chat, with each
 * plan to approve first); anyone else's opens the studio they pick with the words filled in.
 */
export function MakeBox({ owner, guest }: { owner: boolean; guest: boolean }) {
  const router = useRouter();
  const actions = useAssistActions();
  const [engine] = useEngine();
  const [studio, setStudio] = useState<MakeStudio>("image");
  const [busy, setBusy] = useState(false);

  const make = async (text: string) => {
    if (!text.trim()) return;
    if (!owner) {
      if (guest) return askToSignUp("run");
      router.push(makeItHref({ studio, prompt: text }));
      return;
    }
    setBusy(true);
    try {
      const t = await actions.start({ text, engine, autoApprove: false });
      if ((t as { note?: string }).note) toast((t as { note?: string }).note);
      router.push(`/assist?c=${t.id}`);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <ChatComposer
        large
        autoFocus={!guest}
        pictures={false}
        busy={busy}
        disabled={busy}
        placeholder="Describe what to make: a three-shot watch ad, a product photo, a theme song…"
        onSend={(text) => make(text)}
        footer={
          owner ? (
            <span className="px-1 text-[12.5px] text-muted-foreground">Shows you the plan, then runs it</span>
          ) : (
            <span className="flex items-center gap-1" role="radiogroup" aria-label="Studio">
              {STUDIOS.map((s) => {
                const Icon = s.icon;
                const on = s.id === studio;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setStudio(s.id)}
                    className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium", on ? "bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent")}
                  >
                    <Icon className="size-3.5" />
                    {s.label}
                  </button>
                );
              })}
            </span>
          )
        }
      />
      <div className="mt-6 grid gap-x-6 sm:grid-cols-2">
        {ASSIST_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void make(s)}
            className="group flex items-baseline gap-3 border-b py-3 text-left text-[15px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="text-subtle-foreground transition-colors group-hover:text-brand-text" aria-hidden>
              ✦
            </span>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The "+" menu: the tools that keep working across chats (skills, memory, scheduled tasks). */
export function MoreMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="More in Chat">
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem asChild>
          <Link href="/assist/skills">
            <BookOpen /> Skills
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/assist/memory">
            <Brain /> Memory
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/assist/scheduled">
            <CalendarClock /> Scheduled tasks
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
