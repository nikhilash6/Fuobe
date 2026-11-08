"use client";

import { useId } from "react";
import { OwnSetupChip } from "@/components/own-setup";
import { Switch } from "@/components/ui/switch";
import { FIX_FACES } from "@/lib/catalog/fix-faces";
import { cn } from "@/lib/utils";

/**
 * "Fix faces" beside Run for a MiniMax H3 video from a start picture: off until the person turns it on. On, the take is
 * followed by Fix faces with the start picture as the face, and both videos are kept.
 */
export function FixFacesAfterSwitch({ on, onChange, className }: { on: boolean; onChange: (on: boolean) => void; className?: string }) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 items-start gap-2", className)}>
      <Switch id={id} checked={on} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium">
          Fix faces
        </label>
        <OwnSetupChip setup={FIX_FACES.model} className="ml-1.5 align-[1px]" />
        <p className="text-[12px] text-pretty text-muted-foreground">Redraws every face sharp and true to your picture. Your video is ready a few minutes later.</p>
      </div>
    </div>
  );
}
