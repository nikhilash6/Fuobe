"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loopbackFetch } from "@/lib/gpu/browser-check";
import { firstPorts, localBase, portsToLook, sameFinder, settled, type Finder, type PortLook, type SettleOptions, type SystemStats } from "@/lib/local-comfy";
import { rememberedComfy } from "./computer-runtime";
import { useComputerSupport } from "./open-connect";

/**
 * Finding the ComfyUI on this computer from the page ("Use the ComfyUI on this computer"). A look is short and in
 * order: where ComfyUI was found before and its usual port (8188) first, and a ComfyUI read there ends it; only then the
 * other ports ComfyUI uses. It tells a ComfyUI it can read from one that answers without letting this page in. While
 * the card is open and the tab is in view, it looks again quietly: every 2 s at the port shown while it waits for
 * ComfyUI to let Fuobe in (a ping that leaves no line in the console, and a full look every 10 s or when the port comes
 * back), every 3 s at that port and 8188 while ComfyUI restarts (every port every 30 s), and every 5 s at 8188, the
 * remembered port and any port where ComfyUI answered in the last few minutes while nothing answers (every port every
 * 30 s: a ComfyUI that restarted on a port Fuobe doesn't wait for, or one just installed, is found again). Each look
 * pings first, so a port where nothing answers costs one line in the console. It never looks on its own while the browser would still ask (Chrome's advice): the person's click does the
 * first look. `auto: false`: not even when the browser lets Fuobe in already (a card that only shows the choice must
 * never connect by itself).
 */

export type { Finder };

/** How long a look waits for ComfyUI's answer (a busy ComfyUI can be slow), and for a ping. */
const READ_MS = 3000;
const PING_MS = 1500;
/** While a port answers without letting this page in, a full look there at most this often (pings in between). */
const REREAD_MS = 10_000;
/** While ComfyUI restarts, a look at every port at most this often (it may come back elsewhere). */
const RESCAN_MS = 30_000;
/** A note about a port the person picked ("Nothing answers on port 8189 right now") stays this long. */
const NOTE_MS = 30_000;
/** A port where ComfyUI answered this recently is looked at again with the usual ones while nothing answers. */
const RECENT_MS = 5 * 60_000;

async function timed(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await loopbackFetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Does something answer on this port? A look that can't read the answer (and so leaves no line in the console). */
export async function pingOn(port: number, host = "127.0.0.1", ms = PING_MS): Promise<boolean> {
  try {
    await timed(`${localBase(port, host)}/system_stats`, { mode: "no-cors", credentials: "omit", cache: "no-store" }, ms);
    return true;
  } catch {
    return false;
  }
}

/**
 * One port: ComfyUI that this page can read ("found"), something that answers but won't let this page read it
 * ("unreadable": ComfyUI without Fuobe Connect or the setting, or another app), another app's readable answer
 * ("other"), or nothing.
 */
export async function lookOn(port: number, host = "127.0.0.1"): Promise<PortLook> {
  // A ping first (as patient as the read: a busy ComfyUI can be slow): a port where nothing answers costs one line in
  // the console, not two.
  if (!(await pingOn(port, host, READ_MS))) return { port, host, state: "none" };
  let res: Response;
  try {
    res = await timed(`${localBase(port, host)}/system_stats`, { credentials: "omit", cache: "no-store" }, READ_MS);
  } catch {
    // Something answers, but this page may not read it.
    return { port, host, state: "unreadable" };
  }
  const stats = res.ok ? ((await res.json().catch(() => null)) as SystemStats | null) : null;
  return stats?.system ? { port, host, state: "found", stats } : { port, host, state: "other" };
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

/**
 * The finder, while `active` (the card is open). `perm`: whether the browser would still ask, once known. `checking`:
 * the port the person picked ("Use port 8189") while it is looked at.
 */
export function useLocalComfy(active: boolean, o: { auto?: boolean } = {}) {
  const auto = o.auto !== false;
  const support = useComputerSupport();
  const [state, setState] = useState<Finder>({ s: "start" });
  const [perm, setPerm] = useState<Permission | null>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const cur = useRef(state);
  useEffect(() => {
    cur.current = state;
  }, [state]);
  /** Looks under way: a quiet look waits for none. */
  const running = useRef(0);
  /** Bumped by every look the person asks for: a look that ends after a newer one started never overrides it. */
  const gen = useRef(0);
  /** Each port's last answer, and when it was last read in full (quiet looks ping in between). */
  const seen = useRef(new Map<number, { state: PortLook["state"]; read: number; answered?: number }>());
  /** When every port was last looked at (or the wait for a restarting ComfyUI began). */
  const lastFull = useRef(0);

  const show = useCallback((next: Finder) => {
    const was = cur.current;
    cur.current = next;
    if (next.s === "waiting" && was.s !== "waiting") lastFull.current = Date.now();
    if (!sameFinder(was, next)) setState(next);
  }, []);

  /** A quiet look at one port: while it answers without letting this page in, a ping says it is still there. */
  const quietOn = useCallback(async (port: number, host: string): Promise<PortLook> => {
    const last = seen.current.get(port);
    if (last?.state === "unreadable" && Date.now() - last.read < REREAD_MS) return (await pingOn(port, host)) ? { port, host, state: "unreadable" } : { port, host, state: "none" };
    return lookOn(port, host);
  }, []);

  /**
   * Look, then say what was found: every port in order (stopping early at a readable ComfyUI), or the ones given.
   * `quiet`: keep the screen as it is meanwhile, and look only where it matters now. `chosen`: the person picked that
   * port from the others. `wide`: a quiet look at every port while nothing answers or ComfyUI restarts (something
   * changed on this computer: the person's AI asked).
   */
  const look = useCallback(
    async (o: { ports?: { port: number; host?: string }[]; quiet?: boolean; chosen?: number; wide?: boolean } = {}) => {
      if (support !== "ok" || (o.quiet && running.current)) return;
      const g = o.quiet ? gen.current : ++gen.current;
      running.current++;
      // A look the person asks for ends any "Checking port…" before it (that look no longer decides).
      if (!o.quiet) setChecking(o.chosen ?? null);
      if (!o.quiet && o.chosen === undefined) show({ s: "looking" });
      try {
        const remembered = rememberedComfy();
        const hostOf = (port: number) => (port === remembered?.port ? remembered.host : "127.0.0.1");
        const was = cur.current;
        // Quietly: the port shown (and ComfyUI's usual one while only a weak port is shown); 8188, the remembered port
        // and the ports where ComfyUI answered lately while nothing answers; the port waited for and those while ComfyUI
        // restarts. Every port now and then, or when asked (it may come back elsewhere, or be new).
        const recent = [...seen.current].filter(([, v]) => v.answered && Date.now() - v.answered < RECENT_MS).map(([port]) => port);
        const rescan = !!o.wide || Date.now() - lastFull.current >= RESCAN_MS;
        const quietPorts =
          was.s === "needs-setting"
            ? [...new Set([was.port, ...(was.weak && !was.chosen ? firstPorts(remembered?.port) : [])])]
            : was.s === "none" && !rescan
              ? [...new Set([...firstPorts(remembered?.port), ...recent])]
              : was.s === "waiting" && !rescan
                ? [...new Set([was.port, ...firstPorts(remembered?.port), ...recent])]
                : null;
        if (!o.ports && !(o.quiet && quietPorts)) lastFull.current = Date.now();
        const ports = o.ports ?? (o.quiet && quietPorts ? quietPorts.map((port) => ({ port, host: hostOf(port) })) : null);
        let looks: PortLook[];
        if (ports) {
          looks = await Promise.all(ports.map((p) => (o.quiet ? quietOn(p.port, p.host ?? "127.0.0.1") : lookOn(p.port, p.host))));
        } else {
          const first = await Promise.all(firstPorts(remembered?.port).map((port) => lookOn(port, hostOf(port))));
          const rest = first.some((l) => l.state === "found") ? [] : portsToLook(remembered?.port).filter((p) => !first.some((l) => l.port === p));
          looks = [...first, ...(await Promise.all(rest.map((port) => lookOn(port, hostOf(port)))))];
        }
        const now = Date.now();
        for (const l of looks) {
          const last = seen.current.get(l.port);
          const pinged = !!o.quiet && last?.state === "unreadable" && l.state === "unreadable" && now - last.read < REREAD_MS;
          const answered = l.state === "found" || l.state === "unreadable" ? now : last?.answered;
          seen.current.set(l.port, { state: l.state, read: pinged ? last.read : now, ...(answered && { answered }) });
        }
        // The person asked for a newer look meanwhile: that one decides.
        if (g !== gen.current) return;
        // Every port failed at once: the browser may have said no.
        if (looks.every((l) => l.state === "none") && (await loopbackPermission()).state === "denied") return show({ s: "blocked" });
        const typed = !!o.ports && o.ports.length === 1 && !o.quiet && o.chosen === undefined ? o.ports[0].port : undefined;
        const so: SettleOptions = { ...(typed !== undefined && { typed }), ...(o.chosen !== undefined && { chosen: o.chosen }), partial: !!ports && (!!o.quiet || o.chosen !== undefined) };
        show(settled(cur.current, looks, remembered?.port, Date.now(), so));
      } finally {
        running.current--;
        if (o.chosen !== undefined) setChecking((c) => (c === o.chosen ? null : c));
      }
    },
    [show, quietOn, support],
  );

  /** "Use port 8189": that port is looked at now, then its own screen shows (connected, the one step, or nothing there). */
  const choose = useCallback((port: number) => void look({ ports: [{ port, host: "127.0.0.1" }], chosen: port }), [look]);

  // Open: when the browser already lets Fuobe in, look at once; when it would ask, wait for the click.
  useEffect(() => {
    if (!active || support !== "ok") return;
    let alive = true;
    let status: PermissionStatus | undefined;
    const onChange = () => {
      if (status) setPerm(status.state as Permission);
      if (status?.state === "denied") show({ s: "blocked" });
      else if (status?.state === "granted" && cur.current.s === "blocked") void look();
    };
    void loopbackPermission().then((p) => {
      if (!alive) return;
      status = p.status;
      setPerm(p.state);
      status?.addEventListener("change", onChange);
      if (p.state === "granted" && cur.current.s === "start" && auto) void look();
      else if (p.state === "denied") show({ s: "blocked" });
    });
    return () => {
      alive = false;
      status?.removeEventListener("change", onChange);
    };
  }, [active, support, look, auto, show]);

  // Quiet looks while it waits for ComfyUI to let Fuobe in, to come back, or to start.
  const every = state.s === "needs-setting" ? 2000 : state.s === "waiting" ? 3000 : state.s === "none" ? 5000 : 0;
  useEffect(() => {
    if (!active || !every) return;
    const id = setInterval(() => visible() && void look({ quiet: true }), every);
    return () => clearInterval(id);
  }, [active, every, look]);

  // A note about a port the person picked or typed goes after a while (quiet looks would otherwise keep it up).
  useEffect(() => {
    if (state.s !== "needs-setting" || (state.missed === undefined && state.notComfy === undefined)) return;
    const t = setTimeout(() => {
      const now = cur.current;
      if (now.s === "needs-setting" && sameFinder(now, state)) show({ ...now, missed: undefined, notComfy: undefined });
    }, NOTE_MS);
    return () => clearTimeout(t);
  }, [state, show]);

  return { state: support !== "ok" ? ({ s: "unsupported", why: support } as Finder) : state, look, choose, checking, support, perm };
}
