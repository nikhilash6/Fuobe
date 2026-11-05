"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listensWide, startedOnCpu } from "@/lib/ai-setup/facts";
import { installFromStats, guessInstall, platformOf, type ComfyInstall } from "@/lib/comfy-install";
import { isGuard } from "@/lib/comfy-guard";
import { isConnectAnswer } from "@/lib/fuobe-connect";
import { loopbackFetch } from "@/lib/gpu/browser-check";
import { localBase, statsFacts, type SystemStats } from "@/lib/local-comfy";
import { stored } from "../computer-runtime";
import { lookOn, useLocalComfy } from "../use-local-comfy";

/**
 * "Set it up with my AI", this browser's way: the ComfyUI on this computer as the panel watches it while the person's AI
 * works. The finder (useLocalComfy) finds it and follows it through a restart; once Fuobe can read it, this keeps reading
 * it every few seconds while `watch` is on, because the AI changes it under the panel: its cross-site setting, --listen,
 * and Fuobe's guard. Only http://127.0.0.1 (or the host the person typed), and only what the finder reads.
 */

export type Guarded = "guard" | "connect" | "none";

/** Fuobe Connect (at /fuobe/connect) or Fuobe's guard (at /fuobe/guard), as this-computer.tsx's guardAt reads them. */
export async function guardOn(port: number, host: string): Promise<Guarded> {
  const read = (path: string, ok: (a: unknown) => boolean) =>
    loopbackFetch(`${localBase(port, host)}${path}`, { credentials: "omit", cache: "no-store" }).then(
      (r) => (r.ok ? r.json().then(ok, () => false) : false),
      () => false,
    );
  if (await read("/fuobe/connect", isConnectAnswer)) return "connect";
  return (await read("/fuobe/guard", isGuard)) ? "guard" : "none";
}

const WATCH_MS = 3000;
const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
const nav = () => navigator as Navigator & { userAgentData?: { platform?: string } };

export function useSetupProbe(active: boolean, watch: boolean) {
  const finder = useLocalComfy(active, { auto: true });
  const { state, look } = finder;
  const [read, setRead] = useState<{ key: string; stats: SystemStats; guard?: Guarded } | null>(null);
  const found = state.s === "found" ? state : null;
  const key = found ? `${found.host}:${found.port}` : null;
  const mine = read && read.key === key ? read : null;
  const stats = mine?.stats ?? found?.stats;
  const place = useRef<{ key: string; port: number; host: string } | null>(null);
  useEffect(() => {
    place.current = found && key ? { key, port: found.port, host: found.host } : null;
  });

  /** ComfyUI read again now, with its guard (a restart goes back to the finder). */
  const readNow = useCallback(async (): Promise<boolean> => {
    const at = place.current;
    if (!at) return false;
    const [l, guard] = await Promise.all([lookOn(at.port, at.host), guardOn(at.port, at.host)]);
    if (place.current?.key !== at.key) return false;
    if (l.state === "found") setRead({ key: at.key, stats: l.stats, guard });
    else void look({ quiet: true });
    return true;
  }, [look]);

  // Found: its guard, and while the panel watches, ComfyUI again every few seconds.
  useEffect(() => {
    if (!key) return;
    void readNow();
    if (!watch) return;
    const id = setInterval(() => visible() && void readNow(), WATCH_MS);
    return () => clearInterval(id);
  }, [key, watch, readNow]);

  const port = found?.port ?? (state.s === "needs-setting" || state.s === "waiting" ? state.port : undefined);
  const facts = stats ? statsFacts(stats, typeof window === "undefined" ? "" : window.location.origin) : null;
  const install: ComfyInstall | undefined = port ? (stats ? installFromStats(stats, port, platformOf(nav())) : ((stored("install") as ComfyInstall | null) ?? guessInstall(port, platformOf(nav())))) : undefined;
  /**
   * A quiet look now (the AI asked for a fresh one): at every port while nothing answers. Never before the person's
   * own first look (the browser may still ask), nor while the browser blocks it.
   */
  const s = state.s;
  const poke = useCallback(() => {
    if (s === "start" || s === "looking" || s === "blocked" || s === "unsupported") return;
    if (s === "found") void readNow();
    else void look({ quiet: true, wide: true });
  }, [look, readNow, s]);
  return {
    ...finder,
    port,
    host: found?.host,
    stats,
    cors: facts?.cors,
    listen: listensWide(stats?.system?.argv),
    guard: mine?.guard,
    install,
    cpu: !!stats?.devices?.length && stats.devices.every((d) => d.type === "cpu"),
    cpuFlag: startedOnCpu(stats?.system?.argv),
    vramGb: stats?.devices?.[0]?.vram_total ? Math.round(stats.devices[0].vram_total / 2 ** 30) : undefined,
    restarted: state.s === "needs-setting" && state.back,
    poke,
    /** ComfyUI read again now (after its AI changed it): false when none is found here. */
    refresh: readNow,
  };
}

export type SetupProbe = ReturnType<typeof useSetupProbe>;
