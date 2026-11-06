"use client";

import { Cloud, Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VendorMark } from "@/components/studio/vendor-mark";
import { askToSignUp, useStatus } from "@/lib/api";
import { addProviderKeyLabel, CLOUD_PANEL_EVENT, CLOUD_PANEL_STAY_EVENT, CLOUD_SHOWCASE, cloudPanelWords, panelProviders, visitorEngine, type CloudPanelAsk } from "@/lib/engine-ux";
import { openAddKey } from "./your-keys";

/**
 * "Cloud models": what a visitor without a key reads when it chooses Cloud (the engine switch, a Cloud model in a
 * picker, the one-time hint). It names a few Cloud models and why, says they run on the visitor's own fal.ai or
 * Replicate key and are billed there, and opens the add-key flow (a guest is asked to sign up first). The switch stays
 * on Open source until a key is saved. Mounted once, in the app's providers.
 */
export function CloudPanel() {
  const [ask, setAsk] = useState<CloudPanelAsk | null>(null);
  const engine = visitorEngine(useStatus().data);
  useEffect(() => {
    const open = (e: Event) => setAsk((e as CustomEvent<CloudPanelAsk>).detail ?? {});
    window.addEventListener(CLOUD_PANEL_EVENT, open);
    return () => window.removeEventListener(CLOUD_PANEL_EVENT, open);
  }, []);
  const stay = () => {
    setAsk(null);
    window.dispatchEvent(new Event(CLOUD_PANEL_STAY_EVENT));
  };
  if (!engine) return null;
  const words = cloudPanelWords(engine.place, ask?.modelName);
  const add = (p: Parameters<typeof openAddKey>[0]) => {
    const modelId = ask?.modelId;
    setAsk(null);
    if (engine.guest) return askToSignUp("run");
    openAddKey(p, modelId);
  };
  const providers = panelProviders(ask?.served);
  return (
    <Dialog open={!!ask} onOpenChange={(o) => !o && stay()}>
      <DialogContent data-cloud-panel="" className="gap-0 overflow-hidden p-0 sm:max-w-[420px]">
        <DialogHeader className="gap-1.5 px-5 pt-5 pb-4 text-left">
          <span aria-hidden className="mb-1.5 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Cloud className="size-5" />
          </span>
          <DialogTitle className="font-heading text-[20px] leading-tight font-normal">{words.title}</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">{words.lead}</DialogDescription>
        </DialogHeader>
        <ul className="mx-5 divide-y rounded-xl border" aria-label="Some Cloud models">
          {CLOUD_SHOWCASE.map((m) => (
            <li key={m.id} className="flex items-start gap-3 px-3 py-2.5">
              <VendorMark vendor={m.vendor} engine="cloud" />
              <span className="min-w-0">
                <span className="block text-[13px] leading-snug font-medium">{m.name}</span>
                <span className="block text-[12px] leading-snug text-muted-foreground">{m.why}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mx-5 mt-2 text-[12px] text-muted-foreground">{words.more}</p>
        <div className="mt-4 flex flex-col gap-2 border-t bg-muted/40 px-5 pt-4 pb-5">
          <div className={providers.length > 1 ? "grid gap-2 sm:grid-cols-2" : "grid"}>
            {providers.map((p, i) => (
              <Button key={p} variant={i === 0 ? "default" : "secondary"} className="h-10 rounded-full" onClick={() => add(p)}>
                {addProviderKeyLabel(p)}
              </Button>
            ))}
          </div>
          <Button variant="ghost" className="h-10 gap-1.5 rounded-full" onClick={stay}>
            <Cpu className="size-4" aria-hidden />
            {words.stay}
          </Button>
          <p className="text-center text-[12px] text-muted-foreground">{words.stayNote}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
