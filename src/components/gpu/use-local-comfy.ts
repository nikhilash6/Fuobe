"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loopbackFetch } from "@/lib/gpu/browser-check";
import { localBase, portsToLook, sameFinder, settled, type Finder, type PortLook, type SystemStats } from "@/lib/local-comfy";
import { rememberedComfy } from "./computer-runtime";
import { useComputerSupport } from "./open-connect";

/**
 * Finding the ComfyUI on this computer from the page ("Use the ComfyUI on this computer"). It looks at the ports
 * ComfyUI uses (the one that answered last first), tells a ComfyUI it can read from one that answers without Fuobe's
 * setting, and, while the card is open and the tab is in view, looks again quietly at every port: every 2 s while it
 * waits for ComfyUI to come back with the setting, every 5 s while nothing answers. It never looks on its own while the
 * browser would still ask (Chrome's advice): the person's click does the first look. `auto: false`: not even when the
 * browser lets Fuobe in already (a card that only shows the choice must never connect by itself).
 */

export type { Finder };

const LOOK_MS = 1500;

async function timed(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOOK_MS);
  try {
    return await loopbackFetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** One port: ComfyUI that this page can read, something that answers but can't be read, or nothing. */
export async function lookOn(port: number, host = "127.0.0.1"): Promise<PortLook> {
  const base = localBase(port, host);
  try {
    const res = await timed(`${base}/system_stats`, {});
    const stats = res.ok ? ((await res.json().catch(() => null)) as SystemStats | null) : null;
    return stats?.system ? { port, host, state: "found", stats } : { port, host, state: "none" };
  } catch {
    // Not readable: a look that can't read the answer still sees that something is there.
    try {
      await timed(`${base}/system_stats`, { mode: "no-cors" });
      return { port, host, state: "unreadable" };
    } catch {
      return { port, host, state: "none" };
    }
  }
}

type Permission = "granted" | "prompt" | "denied" | "unknown";

/**
 * Chrome's "Apps on device" permission for this site (its newer name, then the one before it), or "unknown" where the
 * browser doesn't say (Firefox).
 */
export async function loopbackPermission(): Promise<{ state: Permission; status?: PermissionStatus }> {
  for (const name of ["loopback-network", "local-network-access"]) {
    try {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      return { state: status.state as Permission, status };
    } catch {}
  }
  return { state: "unknown" };
}

export { useComputerSupport } from "./open-connect";
export { usePagePlace } from "./use-page-place";

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** The finder, while `active` (the card is open). `perm`: whether the browser would still ask, once known. */
export function useLocalComfy(active: boolean, o: { auto?: boolean } = {}) {
  const auto = o.auto !== false;
  const support = useComputerSupport();
  const [state, setState] = useState<Finder>({ s: "start" });
  const [perm, setPerm] = useState<Permission | null>(null);
  const cur = useRef(state);
  useEffect(() => {
    cur.current = state;
  }, [state]);
  const busy = useRef(false);

  /** The screen for what the looks found; the same state (no new render) when nothing changed. */
  const settle = useCallback((looks: PortLook[], port?: number) => {
    const was = cur.current;
    const next = settled(was, looks, rememberedComfy()?.port, port, Date.now());
    if (!sameFinder(was, next)) setState(next);
  }, []);

  /** "My ComfyUI is on that port": the fix and the quiet looks follow it. */
  const choose = useCallback((port: number) => {
    const was = cur.current;
    if (was.s === "needs-setting") setState({ s: "needs-setting", port, back: false, others: [...new Set([was.port, ...(was.others ?? [])])].filter((p) => p !== port) });
  }, []);

  /** Look on every port (or the ones given), then say what was found. `quiet`: keep the screen as it is meanwhile. */
  const look = useCallback(
    async (o: { ports?: { port: number; host?: string }[]; quiet?: boolean } = {}) => {
      if (busy.current || support !== "ok") return;
      busy.current = true;
      if (!o.quiet) setState({ s: "looking" });
      try {
        const remembered = rememberedComfy();
        const ports = o.ports ?? portsToLook(remembered?.port).map((port) => ({ port, host: port === remembered?.port ? remembered.host : "127.0.0.1" }));
        const looks = await Promise.all(ports.map((p) => lookOn(p.port, p.host)));
        // Every port failed at once: the browser may have said no.
        if (looks.every((l) => l.state === "none") && (await loopbackPermission()).state === "denied") return setState({ s: "blocked" });
        settle(looks, o.ports?.length === 1 ? o.ports[0].port : undefined);
      } finally {
        busy.current = false;
      }
    },
    [settle, support],
  );

  // Open: when the browser already lets Fuobe in, look at once; when it would ask, wait for the click.
  useEffect(() => {
    if (!active || support !== "ok") return;
    let alive = true;
    let status: PermissionStatus | undefined;
    const onChange = () => {
      if (status) setPerm(status.state as Permission);
      if (status?.state === "denied") setState({ s: "blocked" });
      else if (status?.state === "granted" && cur.current.s === "blocked") void look();
    };
    void loopbackPermission().then((p) => {
      if (!alive) return;
      status = p.status;
      setPerm(p.state);
      status?.addEventListener("change", onChange);
      if (p.state === "granted" && cur.current.s === "start" && auto) void look();
      else if (p.state === "denied") setState({ s: "blocked" });
    });
    return () => {
      alive = false;
      status?.removeEventListener("change", onChange);
    };
  }, [active, support, look, auto]);

  // Quiet looks at every port while it waits for ComfyUI (with the setting: a readable ComfyUI on any port connects) or
  // for any ComfyUI to start.
  const every = state.s === "needs-setting" || state.s === "waiting" ? 2000 : state.s === "none" ? 5000 : 0;
  useEffect(() => {
    if (!active || !every) return;
    const id = setInterval(() => visible() && void look({ quiet: true }), every);
    return () => clearInterval(id);
  }, [active, every, look]);

  return { state: support !== "ok" ? ({ s: "unsupported", why: support } as Finder) : state, look, choose, support, perm };
}
