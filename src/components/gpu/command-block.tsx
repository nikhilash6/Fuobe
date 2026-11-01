"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copyWithToast } from "@/lib/clipboard";

/** Commands to copy: they scroll sideways inside their own box, never the page. */
export function CommandBlock({ text, label }: { text: string; label: string }) {
  return (
    <div className="relative rounded-lg border bg-muted/50">
      <pre className="max-h-64 overflow-auto p-3 pr-12 font-mono text-[12px] leading-relaxed whitespace-pre">{text}</pre>
      <Button size="icon-sm" variant="ghost" className="absolute top-1.5 right-1.5" aria-label={`Copy the ${label} commands`} onClick={() => void copyWithToast(text, "Commands copied")}>
        <Copy />
      </Button>
    </div>
  );
}

/** Windows (PowerShell) and Mac / Linux (bash) tabs, Windows first on a Windows machine. */
export function CommandTabs({ bash, powershell, windowsFirst }: { bash: string; powershell: string; windowsFirst?: boolean }) {
  return (
    <Tabs defaultValue={windowsFirst === false ? "bash" : "ps"} className="gap-2">
      <TabsList>
        <TabsTrigger value="ps">Windows</TabsTrigger>
        <TabsTrigger value="bash">Mac / Linux</TabsTrigger>
      </TabsList>
      <TabsContent value="ps">
        <CommandBlock text={powershell} label="PowerShell" />
      </TabsContent>
      <TabsContent value="bash">
        <CommandBlock text={bash} label="Mac and Linux" />
      </TabsContent>
    </Tabs>
  );
}
