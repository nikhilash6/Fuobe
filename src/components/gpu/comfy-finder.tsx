"use client";

import { Copy } from "lucide-react";
import { copyWithToast } from "@/lib/clipboard";
import { rememberedComfy } from "./computer-runtime";

/**
 * A ComfyUI's address for "Run from anywhere with a link" (Your GPU): the server calls it, so it needs a public one (a
 * tunnel in front of the ComfyUI on the person's computer), never one on their computer or network. Finding the
 * ComfyUI on this computer is the other option's job (this-computer.tsx); nothing here looks for one.
 */

/** On this computer or its network: the browser can reach it, the server can't. */
export function isLocalAddress(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || !host.includes(".")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const v4 = host.split(".").map(Number);
  if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = v4;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

export const gib = (bytes?: number) => (bytes ? `${(bytes / 2 ** 30).toFixed(bytes >= 10 * 2 ** 30 ? 0 : 1)} GB` : undefined);

/** The command that puts a public https address in front of a local ComfyUI. */
export const tunnelCommand = (port: number) => `cloudflared tunnel --url http://localhost:${port}`;

function CopyLine({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2">
      <code aria-label={label} className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap">
        {text}
      </code>
      <button
        type="button"
        onClick={() => void copyWithToast(text)}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

/** How to give a ComfyUI a public address: a tunnel on the computer it runs on (its usual port, or the one last found). */
export function TunnelSteps() {
  const port = rememberedComfy()?.port ?? 8188;
  return (
    <div className="space-y-2 rounded-xl border p-3 text-[13px]">
      <p className="font-medium">Give your ComfyUI a public address</p>
      <p className="text-[12px] text-muted-foreground">On the computer that runs ComfyUI, start a tunnel, then paste the https address it prints below:</p>
      <CopyLine text={tunnelCommand(port)} label="tunnel command" />
      <p className="text-[11px] text-muted-foreground">
        Or ngrok: ngrok http {port}. ComfyUI on another port? Use that port instead of {port}.
      </p>
    </div>
  );
}
