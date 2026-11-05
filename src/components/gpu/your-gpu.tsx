"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Loader2, Unplug } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { gib, isLocalAddress, TunnelSteps } from "@/components/gpu/comfy-finder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { responseError, toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";

interface GpuState {
  /** A link, or the ComfyUI on this computer (connect-choice.tsx shows that one). */
  gpu: { mode?: "link"; url: string; hasToken: boolean } | { mode: "computer" } | null;
}
interface GpuInfo {
  device?: string;
  vramBytes?: number;
  version?: string;
}

async function call<T>(method: string, body?: unknown, test = false): Promise<T> {
  const res = await fetch(`/api/account/gpu${test ? "?test=1" : ""}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw responseError(res, j.error ?? "Something went wrong. Please try again.");
  return j;
}

/**
 * "Your GPU" (public sign-up): an account's own ComfyUI, where its runs go (never this studio's keys
 * or GPU). The server calls it, so it needs a web address anyone can reach: cloudflared (or another tunnel) in front
 * of a local ComfyUI. Nothing here looks for a ComfyUI on this device: it shows how to make that address (TunnelSteps),
 * in words a visitor needs no dictionary for. 36rem wide at most
 * from sm up, unless a wider page lifts that (className, as ConnectChoice's).
 */
export function YourGpu({ className, onLinked }: { className?: string; onLinked?: () => void } = {}) {
  const qc = useQueryClient();
  const id = useId();
  const q = useQuery({ queryKey: ["account-gpu"], queryFn: () => call<GpuState>("GET") });
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | "remove" | null>(null);
  const [info, setInfo] = useState<GpuInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const local = !!url.trim() && isLocalAddress(/^[a-z]+:\/\//i.test(url.trim()) ? url.trim() : `http://${url.trim()}`);
  const send = async (test: boolean) => {
    setBusy(test ? "test" : "save");
    setError(null);
    try {
      const r = await call<GpuState & { info: GpuInfo }>("PUT", { url: url.trim(), token: token.trim() || undefined }, test);
      setInfo(r.info);
      if (!test) {
        qc.setQueryData(["account-gpu"], { gpu: r.gpu });
        // Runs go to the link now, not to a Fuobe tab on this computer, and its own files are taken (the status says so).
        void qc.invalidateQueries({ queryKey: ["viewer"] });
        void qc.invalidateQueries({ queryKey: ["status"] });
        toast.success("Your GPU is connected. Runs go to your ComfyUI now.");
        setUrl("");
        setToken("");
        onLinked?.();
      }
    } catch (e) {
      setInfo(null);
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("remove");
    try {
      qc.setQueryData(["account-gpu"], await call<GpuState>("DELETE"));
      void qc.invalidateQueries({ queryKey: ["status"] });
      setInfo(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  if (q.isError) return <p className="text-[13px] text-muted-foreground">{q.error.message}</p>;
  if (!q.data) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  const gpu = q.data.gpu?.mode === "computer" ? null : q.data.gpu;

  return (
    <div className={cn("w-full min-w-0 space-y-4 sm:max-w-[36rem]", className)}>
      <p className="text-[13px] text-muted-foreground">
        {gpu ? "Your runs go to your ComfyUI through this web address." : "Your runs reach your ComfyUI through a web address. Here's how to give it one:"}
      </p>
      {gpu ? (
        <div className="flex items-start gap-2.5 rounded-xl bg-brand-faint px-3 py-2.5 text-[13px]">
          <Cpu className="mt-0.5 size-4 shrink-0 text-brand-text" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Connected</p>
            <p className="truncate font-mono text-[12px] text-muted-foreground">
              {gpu.url}
              {gpu.hasToken ? " · with a token" : ""}
            </p>
          </div>
          <Button size="sm" variant="ghost" className="-my-1 h-7" onClick={() => void remove()} disabled={busy !== null}>
            {busy === "remove" ? <Loader2 className="animate-spin" /> : <Unplug />} Disconnect
          </Button>
        </div>
      ) : (
        <TunnelSteps />
      )}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-url`} className="text-[13px]">
            {gpu ? "Connect another address" : "Your ComfyUI's web address"}
          </Label>
          <Input id={`${id}-url`} placeholder="https://your-address.trycloudflare.com" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!error || local} />
          {local && (
            <p className="text-[12px] text-destructive">That address only works on your own computer or network. Paste the one cloudflared shows, ending in trycloudflare.com.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-token`} className="text-[13px]">
            Access token <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input id={`${id}-token`} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} aria-describedby={`${id}-token-hint`} />
          <p id={`${id}-token-hint`} className="text-[12px] text-muted-foreground">
            Only if your ComfyUI or its web address asks for a password or token.
          </p>
        </div>
        {error && <p className="text-[12px] text-destructive">{error}</p>}
        {info && (
          <p className="text-[12px] text-muted-foreground">
            ComfyUI answered{info.device ? `: ${info.device}` : ""}
            {gib(info.vramBytes) ? ` · ${gib(info.vramBytes)} VRAM` : ""}
            {info.version ? ` · ComfyUI ${info.version}` : ""}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void send(false)} disabled={!url.trim() || local || busy !== null}>
            {busy === "save" && <Loader2 className="animate-spin" />} Connect
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void send(true)} disabled={!url.trim() || local || busy !== null}>
            {busy === "test" && <Loader2 className="animate-spin" />} Test
          </Button>
        </div>
      </div>
    </div>
  );
}
