"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { useIsAccount, useIsGuest, useSoundLive } from "@/lib/api";
import { VOICE_FIRST_BED, VOICE_FIRST_FEATURE, VOICE_FIRST_HINT, VOICE_FIRST_LABEL, voiceFirstCost } from "@/lib/av/voice-first";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

/**
 * "Clean the voice first" beside a transcript or a lip sync (src/lib/av/voice-first.ts): the switch, what it does on
 * this engine and what it adds (time on your GPU, a price in the cloud). Until it has passed a real run it shows for the
 * studio's owner only and starts off (the server refuses it to visitors); once it has, it shows for everyone.
 */
export function useVoiceFirstLive(): boolean {
  return useSoundLive(VOICE_FIRST_FEATURE);
}

export function useVoiceFirstShown(): boolean {
  const guest = useIsGuest();
  const account = useIsAccount();
  const live = useVoiceFirstLive();
  return live || (!guest && !account);
}

export function VoiceFirstSwitch({ engine, on, onChange, seconds, lip, className }: { engine: Engine; on: boolean; onChange: (on: boolean) => void; seconds?: number; lip?: boolean; className?: string }) {
  const id = useId();
  const cost = voiceFirstCost(engine, seconds);
  return (
    <div className={cn("flex min-w-0 items-start gap-2", className)}>
      <Switch id={id} checked={on} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium">
          {VOICE_FIRST_LABEL}
          {on && cost ? <span className="font-normal text-muted-foreground"> · {cost}</span> : null}
        </label>
        <p className="text-[12px] text-pretty text-muted-foreground">
          {VOICE_FIRST_HINT[engine]}
          {lip ? ` ${VOICE_FIRST_BED[engine]}` : ""}
        </p>
      </div>
    </div>
  );
}
