"use client";

import { PhoneNavButton } from "@/components/nav/phone-nav-button";
import { useSwapFade } from "@/components/ui/tab-row";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { HubHeaderExtras, useInHub } from "@/components/studio/hub-chrome";
import { useEngine } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The frame of a stand-alone audio/video tool (Translate & dub, Captions, Trim, Katana, Image to 3D,
 * Virality): the sticky header with the title, extra controls and the engine switch, an optional row
 * of tabs under it, then the page. Inside a hub (Audio, Video tools) the hub's layout draws the title bar, the tabs and the
 * engine switch; the tool adds only its own header controls to it.
 */
export function ToolShell({
  title,
  tabs,
  header,
  engineSwitch = true,
  selfHostedOnly,
  children,
  wide,
  fadeKey,
}: {
  title: string;
  tabs?: React.ReactNode;
  header?: React.ReactNode;
  /** Tools that run in the browser only (Virality) have no engine to pick. */
  engineSwitch?: boolean;
  /** A tool that runs on a self-hosted Fuobe only: the engine badge says so to anyone but the owner (EngineSwitch). */
  selfHostedOnly?: boolean;
  children: React.ReactNode;
  wide?: boolean;
  /** What the body shows (a mode tab): when it changes, the body fades in. */
  fadeKey?: unknown;
}) {
  const [engine, setEngine] = useEngine();
  const inHub = useInHub();
  const fade = useSwapFade<HTMLDivElement>(fadeKey);
  const body = <div ref={fade} className={cn("mx-auto w-full min-w-0 flex-1 px-4 pb-16 sm:px-6", wide ? "max-w-[1240px]" : "max-w-[1040px]")}>{children}</div>;
  if (inHub)
    return (
      <>
        {header && <HubHeaderExtras>{header}</HubHeaderExtras>}
        {body}
      </>
    );
  return (
    <div className="flex min-h-content min-w-0 flex-col">
      <div className="max-md:sticky top-chrome z-20 bg-background/85 backdrop-blur">
        <header className="flex h-14 items-center gap-2 px-4 sm:px-6">
          <h1 className="min-w-0 truncate font-heading text-[22px] leading-[1.15]">{title}</h1>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {header}
            {engineSwitch && <EngineSwitch value={engine} onChange={setEngine} selfHostedOnly={selfHostedOnly} />}
          </div>
          <PhoneNavButton />
        </header>
        {tabs}
      </div>
      {body}
    </div>
  );
}

/** The serif hero over an empty tool. */
export function ToolHero({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center pt-[8vh] text-center sm:pt-[10vh]">
      <h2 className="font-heading text-display text-balance">{title}</h2>
      {subtitle && <p className="mt-2 max-w-xl text-[13px] text-pretty text-muted-foreground">{subtitle}</p>}
      {children}
    </div>
  );
}

/** A titled card section (setup steps, review, results). */
export function Panel({ title, aside, children, className }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-background p-3 shadow-soft sm:p-4", className)}>
      {(title || aside) && (
        <div className="mb-3 flex min-w-0 items-center gap-2">
          {title && <h3 className="min-w-0 truncate text-[13px] font-semibold">{title}</h3>}
          {aside && <div className="ml-auto flex shrink-0 items-center gap-2">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
