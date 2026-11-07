"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { MANGO_CHILLI } from "@/lib/chat/catalog";
import { ADULT_OK_KEY } from "@/lib/chat/share";
import type { ChatShareSnapshot } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { CharacterFace } from "./character-face";
import { CHILLI_BG } from "./dialogs";
import { Markdown, ReplyBody } from "./prose";

/**
 * A shared chat's public page (/c/<token>): the character (or the game or tool), the shared lines, and a way in for the
 * visitor: chat with the same character, or start their own. A Mango Chilli chat asks the visitor's age first.
 */
const readAdult = (): boolean => {
  try {
    return window.localStorage.getItem(ADULT_OK_KEY) === "1";
  } catch {
    return false;
  }
};
const onStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

export function ChatSharePage({ token, snap, portrait }: { token: string; snap: ChatShareSnapshot; portrait: boolean }) {
  // Null on the server (it can't know): the gate waits for the browser.
  const remembered = useSyncExternalStore<boolean | null>(onStorage, readAdult, () => null);
  const [said, setSaid] = useState(false);
  const adultOk = !snap.mature || said ? true : remembered;
  const setAdultOk = (v: boolean) => setSaid(v);

  const c = snap.character;
  const accent = c?.accent ?? (["#1d1640", "#6a5ee7"] as [string, string]);
  const cta = c ? `Chat with ${c.name}` : snap.kind === "play" ? "Play it yourself" : "Start your own chat";
  const ctaHref = c ? `/chat?from=${token}` : snap.kind === "play" || snap.kind === "write" ? "/chat?kind=" + snap.kind : "/chat";

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="mx-auto flex w-full max-w-[760px] items-center justify-between gap-3 px-4 pt-5 sm:px-6">
        <Link href="/" className="font-heading text-[22px] leading-none">
          Fuobe
        </Link>
        <Button asChild size="sm" className={cn("rounded-full", snap.mature && "text-white " + CHILLI_BG)}>
          <Link href={ctaHref}>{cta}</Link>
        </Button>
      </header>
      <main className="mx-auto w-full max-w-[760px] min-w-0 flex-1 px-4 pt-8 pb-20 sm:px-6 sm:pt-12">
        <div className="flex items-center gap-4">
          {c ? (
            <CharacterFace name={c.name} accent={accent} src={portrait ? `/c/${token}/portrait` : null} rounded="card" className="aspect-[3/4] w-24 shrink-0 shadow-strong sm:w-28" />
          ) : null}
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">{snap.mature ? `${MANGO_CHILLI.short} · 18+` : snap.label ? snap.label : "A chat on Fuobe"}</p>
            <h1 className="mt-1 font-heading text-[clamp(32px,6vw,48px)] leading-[1.04] text-balance">{c?.name ?? snap.title}</h1>
            {c?.tagline && <p className="mt-1.5 text-[15px] text-muted-foreground">{c.tagline}</p>}
          </div>
        </div>

        {adultOk === null ? null : !adultOk ? (
          <div className="mt-10 overflow-hidden rounded-3xl border">
            <div className={cn("h-24", CHILLI_BG)} />
            <div className="space-y-3 p-5">
              <p className="text-[17px] font-medium">This chat is for adults</p>
              <p className="text-[14px] text-muted-foreground">It comes from {MANGO_CHILLI.name}, which can include mature themes and language.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  className={cn("text-white hover:opacity-90", CHILLI_BG)}
                  onClick={() => {
                    try {
                      window.localStorage.setItem(ADULT_OK_KEY, "1");
                    } catch {
                      // Private mode: it asks again next time.
                    }
                    setAdultOk(true);
                  }}
                >
                  I&apos;m 18 or older
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/">Take me back</Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <ol className="mt-10 space-y-6">
            {snap.messages.map((m, i) => (
              <li key={i}>
                {m.role === "user" ? (
                  <div className="ml-auto w-fit max-w-[85%] rounded-3xl rounded-br-lg bg-muted px-4 py-2.5 text-[15.5px] leading-relaxed">
                    <Markdown text={m.content || "(a picture)"} className="space-y-2" />
                  </div>
                ) : (
                  <div>
                    {c && <p className="mb-1 font-heading text-[17px] leading-none text-muted-foreground">{c.name}</p>}
                    <ReplyBody text={m.content} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        <div className="mt-14 rounded-3xl border p-6 text-center">
          <p className="font-heading text-[28px] leading-tight">{c ? `Your turn with ${c.name}` : "Your turn"}</p>
          <p className="mx-auto mt-2 max-w-[46ch] text-[14.5px] text-muted-foreground">Free chat on Fuobe: ask anything, write, brainstorm ideas you can make in one tap, or step into a story.</p>
          <Button asChild className={cn("mt-5 rounded-full", snap.mature && "text-white " + CHILLI_BG)}>
            <Link href={ctaHref}>{cta}</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
