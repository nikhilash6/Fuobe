"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BotMessageSquare, Check, ChevronDown, ChevronLeft, ClipboardPaste, Copy, Ellipsis, Loader2, RefreshCw, Search, Send, Terminal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { isLocalAddress } from "@/components/gpu/comfy-finder";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";
import { useNow } from "@/components/studio/use-now";
import { useGpuBadges, useGpuCheck, useGpuPlan } from "@/hooks/use-gpu";
import { showCode, spokenCode } from "@/lib/ai-setup/code";
import { addressCauseOf, onCpuDevice, type AddressCause, type TabFacts } from "@/lib/ai-setup/facts";
import { FIRST_MODEL_NAME, firstModelOf, type FirstModel } from "@/lib/ai-setup/first-picture";
import { agentLine, AGENTS, AI_TARGETS, chatLink, fullInstructions, isAgent, prefillText, type Agent, type AiTarget } from "@/lib/ai-setup/handoff";
import { nextOf } from "@/lib/ai-setup/next-step";
import { personWords } from "@/lib/ai-setup/person-words";
import { quietFacts, quietWords, RESTART_SLOW_MS, RESTART_WAIT_MIN } from "@/lib/ai-setup/restart";
import { isConnected, isDone, isPairing, stepsOf } from "@/lib/ai-setup/steps";
import { aiSetupHref, BROWSER_LABEL, browserOf, OS_NAME, pickWay, WAY_LABEL, waysFor, type Os, type Way } from "@/lib/ai-setup/ways";
import { useStatus } from "@/lib/api";
import { copyText, copyWithToast } from "@/lib/clipboard";
import { platformOf } from "@/lib/comfy-install";
import { FUOBE_CONNECT, FUOBE_CONNECT_PUBLISHED, pairedOnline } from "@/lib/fuobe-connect";
import { deviceLabel } from "@/lib/gpu/readiness";
import { cn } from "@/lib/utils";
import { PairWithCode, usePaired } from "../fuobe-connect";
import { useComputerSupport } from "../open-connect";
import { AllowNote, blockedSteps, GuardFix, OtherPort } from "../this-computer";
import { FinishCard, useFirstPicture } from "./first-picture";
import { SetupChecklist } from "./setup-checklist";
import { checkHere, useAutoConnect } from "./use-auto-connect";
import { useSetupProbe } from "./use-setup-probe";
import { useSetupSession } from "./use-setup-session";

/**
 * "Set it up with my AI" (accounts): the person's own AI (ChatGPT, Claude, or a coding agent on their computer) does the
 * setup steps, and this panel checks each one as it happens. It picks the way for this browser, makes a short-lived
 * setup code, and hands the AI a short message with two links: the steps for this way and computer, and the status
 * address for the code. The checklist ticks off what this tab sees; the AI reads the same from the status. It ends with
 * a first picture made on the person's own GPU. In place of ConnectChoice's content (a dialog, /connect, Settings).
 */

export interface AiSetupPanelProps {
  onBack: () => void;
  /** Opened by a refused run: once connected, that run starts (it is the first picture). */
  fromRun?: boolean;
  kind?: string;
  onStart?: () => void;
  onNotNow?: () => void;
  /** The way to start on (/connect?setup=ai&way=address: a phone's setup ends here, at the box for the web address). */
  startWay?: Way;
}

type GpuView = { gpu: { mode: "computer" } | { mode?: "link"; url: string } | null };

const AGENT_KEY = "fuobe.ai-setup.agent";
const STUCK_MS = 240_000;
const GUARD_WAIT_MS = 60_000;

function readAgent(): Agent {
  try {
    const v = localStorage.getItem(AGENT_KEY);
    return isAgent(v) ? v : "claude";
  } catch {
    return "claude";
  }
}

const nav = () => navigator as Navigator & { userAgentData?: { platform?: string }; brave?: unknown };

/** A command or a code to copy: one line that scrolls sideways, and a copy button that says it copied. */
function CopyLine({ text, label, mono = true }: { text: string; label: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2">
      <code aria-label={label} className={cn("min-w-0 flex-1 overflow-x-auto text-[12px] whitespace-nowrap", mono && "font-mono")}>
        {text}
      </code>
      <button
        type="button"
        onClick={async () => {
          if (await copyWithToast(text)) {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }
        }}
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

/** A quiet text button. */
const Quiet = ({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) => (
  <button type="button" onClick={onClick} className={cn("text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline", className)}>
    {children}
  </button>
);

export function AiSetupPanel({ onBack, fromRun, onStart, onNotNow, startWay }: AiSetupPanelProps) {
  const qc = useQueryClient();
  const support = useComputerSupport();
  const { ways, off, phone } = waysFor(support, FUOBE_CONNECT_PUBLISHED);
  // The way picked by hand (or by the link), while this browser can use it; else the one that fits (the browser's own
  // answer can come a moment after the first paint, on a phone's narrow screen).
  const [chosen, setWay] = useState<Way | null>(startWay ?? null);
  const way: Way = chosen && ways.includes(chosen) && !off.includes(chosen) ? chosen : pickWay(support, FUOBE_CONNECT_PUBLISHED);
  const detected = useMemo<Os>(() => (typeof window === "undefined" ? "other" : platformOf(nav())), []);
  const [osPicked, setOsPicked] = useState<Os | null>(null);
  // A phone's own system is never the computer's: the person picks Windows, Mac or Linux.
  const os: Os | null = osPicked ?? (phone ? null : detected);
  const browser = useMemo(() => (typeof window === "undefined" ? ("other" as const) : browserOf(nav())), []);
  const [changing, setChanging] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // Opened for the web address (from a phone): the box for it takes the focus once it shows, so a paste goes there.
  const [focusAddress] = useState(startWay === "address");
  useEffect(() => {
    if (!focusAddress) heading.current?.focus();
  }, [focusAddress]);

  // The account's GPU (what is saved) and whether it answers (the status strip's check).
  const gpuQ = useQuery({ queryKey: ["account-gpu"], queryFn: async () => (await (await fetch("/api/account/gpu")).json()) as GpuView });
  const saved = gpuQ.data?.gpu ? (gpuQ.data.gpu.mode === "computer" ? "computer" : "link") : "none";
  const status = useStatus();
  const viewerGpu = status.data?.viewer?.gpu;
  const online = viewerGpu?.connected ? !!viewerGpu.online : false;

  // This browser's way: the ComfyUI on this computer, watched while the AI works.
  const [connectedHere, setConnectedHere] = useState(false);
  // Fuobe Connect reads ComfyUI from this tab too (in a browser that can reach this computer); a phone, Safari and a page
  // on plain http pair it with a code instead.
  const tabWay = way !== "address";
  const probe = useSetupProbe(tabWay && support === "ok", !connectedHere);
  const [skipGuard, setSkipGuard] = useState(false);
  const [switchOk, setSwitchOk] = useState(false);
  const found = probe.state.s === "found";
  const allowed = found && (probe.cors === "exact" || probe.guard === "connect") && !probe.listen;
  const guarded = probe.guard === "guard" || probe.guard === "connect";
  const auto = useAutoConnect({
    ready: tabWay && allowed && (guarded || skipGuard) && (saved !== "link" || switchOk),
    port: probe.port,
    host: probe.host,
    stats: probe.stats,
    onConnected: () => setConnectedHere(true),
  });

  // The web address: what the form last did.
  const [address, setAddress] = useState<{ state: "none" | "testing" | "ok" | "failed"; cause?: AddressCause; words?: string }>({ state: "none" });
  const check = useGpuCheck();
  // ComfyUI runs on the processor: this tab's own read of it, or, for a web address, the device its last check named.
  const cpu = way === "address" ? saved === "link" && onCpuDevice(viewerGpu?.device) : probe.cpu;

  // A picture model, and the first picture.
  const badges = useGpuBadges().data;
  const model = firstModelOf(badges ? { ...badges, vramGb: badges.vramGb ?? probe.vramGb } : undefined);
  const picture = useFirstPicture();

  const now = useNow(5000);
  const browserState: TabFacts["browser"] =
    way === "address" ? "unknown" : support !== "ok" ? "unsupported" : probe.state.s === "blocked" ? "blocked" : probe.perm === "granted" ? "granted" : probe.state.s === "start" ? "ask" : "unknown";
  // Where ComfyUI last answered, and when it stopped: a ComfyUI that went quiet up to 5 minutes ago is starting again
  // (Fuobe's start file, the AI; a portable one loads every add-on first), so the setup says so, with the time so far,
  // and doesn't ask to install it. Past that, it says that ComfyUI didn't come back.
  const s0 = probe.state;
  const answering = s0.s === "found" || s0.s === "needs-setting" || s0.s === "waiting" ? s0.port : s0.s === "looking" ? undefined : null;
  const [lastComfy, setLastComfy] = useState<{ port: number | null; gone: { port: number; at: number } | null }>({ port: null, gone: null });
  if (answering !== undefined && answering !== lastComfy.port)
    setLastComfy({ port: answering, gone: answering === null ? (lastComfy.port !== null ? { port: lastComfy.port, at: now } : lastComfy.gone) : null });
  // The finder's own wait (ComfyUI went quiet while it waited for the setting), or a ComfyUI it read that stopped.
  const quietSince = s0.s === "waiting" ? { port: s0.port, at: s0.since } : s0.s === "none" ? lastComfy.gone : null;
  const quietMs = quietSince ? Math.max(0, now - quietSince.at) : 0;
  const restart = quietSince ? quietFacts(quietMs) : null;
  const quietPort = restart ? quietSince!.port : undefined;
  const comfy = restart ? restart.comfy : s0.s === "found" ? "found" : s0.s === "needs-setting" ? "unreadable" : s0.s === "none" ? "none" : undefined;
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const facts: Omit<TabFacts, "tabId"> = {
    way,
    visible,
    browser: browserState,
    browserName: browser,
    ...(way !== "address" && {
      ...(comfy && { comfy }),
      ...((quietPort ?? probe.port) && { port: quietPort ?? probe.port }),
      ...(restart && { quietMin: restart.quietMin }),
      ...(probe.install && { install: probe.install }),
      ...(probe.cors && { cors: probe.cors }),
      ...(found && { listen: probe.listen }),
      ...(probe.restarted && { restarted: true }),
      ...(found && { guard: probe.guard ?? "none" }),
      ...(skipGuard && { guardSkipped: true }),
      ...((connectedHere || (saved === "computer" && online && found)) && { connected: true }),
      ...(probe.cpu && probe.cpuFlag && { cpuFlag: true }),
    }),
    ...(cpu && { cpu: true }),
    ...(way === "address" && { address: address.state === "none" && saved === "link" ? "ok" : address.state, ...(address.cause && { addressCause: address.cause }) }),
    model: model.state === "checking" ? "checking" : model.state,
    ...(model.state === "none" && { modelWhy: model.why }),
    ...(model.state !== "checking" && model.state !== "none" && { modelId: model.model }),
    ...(model.state === "download" && { modelGbTenths: model.gbTenths }),
    picture: picture.state,
    ...(picture.secs !== undefined && { pictureSecs: Math.min(3600, picture.secs) }),
    ...(picture.cause && { pictureCause: picture.cause }),
    ...(fromRun && { fromRun: true }),
  };
  // Fuobe Connect: a ComfyUI paired with this account that was heard from in the last minute.
  const pairedQ = usePaired(way === "connect");
  const pairedNow = (pairedQ.data?.paired ?? []).some((p) => pairedOnline(p, now));
  const server = { gpu: saved, online: saved === "none" ? false : status.data ? online || pairedNow : null, paired: pairedNow } as const;
  const viewNow = { site: typeof window === "undefined" ? "" : window.location.origin, way, os: os ?? "other", phone, tab: { ...facts, tabId: "this-tab-0" }, tabAt: now, server };
  const steps = stepsOf(viewNow);
  const connected = isConnected(viewNow);
  const done = isDone(viewNow);
  const pairing = isPairing(viewNow);

  // The AI read the status: a fresh look, and while a model is missing, a fresh check of what ComfyUI has.
  const afterPoke = useRef<() => void>(() => {});
  const session = useSetupSession({
    way,
    os: os ?? "other",
    phone,
    facts,
    onPoke: () => {
      probe.poke();
      afterPoke.current();
    },
  });
  const site = session.site ?? (typeof window === "undefined" ? "" : window.location.origin);

  // Connected: what this ComfyUI has (once), and again every 45 s while it needs a model download or none fits (its AI
  // may download one, update ComfyUI, or move it onto the graphics card).
  const checkedFor = useRef<string | null>(null);
  // Only stable values here: a new recheck on every render would start the 45 s timer over each time.
  const startCheck = check.start;
  const refreshProbe = probe.refresh;
  const recheck = useCallback(async () => {
    if (way === "address") await startCheck();
    else if (probe.port && probe.host) {
      await refreshProbe().catch(() => false);
      await checkHere(qc, probe.port, probe.host).catch(() => {});
    }
  }, [way, startCheck, refreshProbe, probe.port, probe.host, qc]);
  useEffect(() => {
    if (!connected) return;
    const key = `${way}:${saved}`;
    if (model.state === "checking" && checkedFor.current !== key && !check.running) {
      checkedFor.current = key;
      const t = setTimeout(() => void recheck(), 2500);
      return () => clearTimeout(t);
    }
    if (model.state !== "download" && model.state !== "none") return;
    const id = setInterval(() => document.visibilityState === "visible" && void recheck(), 45_000);
    return () => clearInterval(id);
  }, [connected, model.state, way, saved, recheck, check.running]);
  const pokeCheckAt = useRef(0);
  useEffect(() => {
    afterPoke.current = () => {
      if (!connected || (model.state !== "download" && model.state !== "none") || check.running || Date.now() - pokeCheckAt.current < 15_000) return;
      pokeCheckAt.current = Date.now();
      void recheck();
    };
  });

  // Opened by a refused run: once connected, that run starts (it is the first picture).
  useEffect(() => {
    if (!fromRun || !connected) return;
    const t = setTimeout(() => onStart?.(), 1200);
    return () => clearTimeout(t);
  }, [fromRun, connected, onStart]);

  // The tab's title says how far it is, so the person sees it from their AI's tab.
  const doneCount = steps.filter((s) => s.state === "done").length;
  useEffect(() => {
    const was = document.title;
    return () => {
      document.title = was;
    };
  }, []);
  useEffect(() => {
    document.title = done ? "Your GPU is ready - Fuobe" : `(${doneCount}/${steps.length}) Setting up your GPU - Fuobe`;
  }, [done, doneCount, steps.length]);

  // Stuck: nothing changed for four minutes.
  const stepsKey = steps.map((s) => s.state).join();
  const [changed, setChanged] = useState({ key: stepsKey, at: now });
  if (changed.key !== stepsKey) setChanged({ key: stepsKey, at: now });
  const stuck = !done && now - changed.at > STUCK_MS;
  // The guard: "Connect anyway" a minute after Fuobe was let in without it.
  const waitsForGuard = allowed && !guarded;
  const [guardWait, setGuardWait] = useState({ on: waitsForGuard, at: now });
  if (guardWait.on !== waitsForGuard) setGuardWait({ on: waitsForGuard, at: now });
  const allowedAt = guardWait.on ? guardWait.at : null;

  const finished = picture.state === "ok";
  const gpuName = probe.stats?.devices?.[0]?.name ? deviceLabel(probe.stats.devices[0].name) : viewerGpu?.device ? deviceLabel(viewerGpu.device) : undefined;

  // ---- The rows' own controls.
  const extras: Partial<Record<(typeof steps)[number]["id"], React.ReactNode>> = {};
  if (tabWay && !pairing) {
    const s = probe.state.s;
    if (s === "start")
      extras.comfyui = (
        <>
          <p className="text-[12px] text-muted-foreground">Is ComfyUI running? Let Fuobe look for it. If you don&apos;t have ComfyUI yet, your AI installs it first.</p>
          <Button className="h-11 sm:h-9" onClick={() => void probe.look()}>
            <Search /> Let Fuobe look
          </Button>
          {probe.perm !== "granted" && <AllowNote />}
        </>
      );
    else if (restart?.comfy === "waiting") extras.comfyui = <RestartWait port={quietPort!} ms={quietMs} />;
    else if (restart)
      extras.comfyui = (
        <>
          <p className="text-[12px] text-muted-foreground">
            ComfyUI hasn&apos;t answered on port {quietPort} for {quietWords(quietMs)}. Look at its window: if it shows an error, ask your AI about it. If the window closed, start
            ComfyUI again. Fuobe finds it by itself once it answers.
          </p>
          {s === "none" && <NoComfy onLook={(port, host) => void probe.look({ ports: [{ port, host }] })} missed={probe.state.missed} notComfy={probe.state.notComfy} installed />}
        </>
      );
    else if (s === "looking") extras.comfyui = <p className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Looking for ComfyUI on this computer…</p>;
    else if (s === "blocked")
      extras.comfyui = (
        <>
          <p className="text-[12px] text-muted-foreground">{blockedSteps()}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
              <RefreshCw /> Reload
            </Button>
            <Quiet onClick={() => setWay("address")}>Use a web address instead</Quiet>
          </div>
        </>
      );
    else if (s === "none") extras.comfyui = <NoComfy onLook={(port, host) => void probe.look({ ports: [{ port, host }] })} missed={probe.state.missed} notComfy={probe.state.notComfy} />;
    const switchRow = found && saved === "link" && !switchOk && allowed && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2 text-[12px]">
        <span>Use this computer instead of your web address?</span>
        <Button size="sm" variant="secondary" className="h-8" onClick={() => setSwitchOk(true)}>
          Switch
        </Button>
      </div>
    );
    if (way === "connect")
      extras.connect = auto.error ? <p className="text-[12px] text-destructive">{auto.error}</p> : switchRow || (probe.guard !== "connect" && <ConnectNote />);
    else if (switchRow) extras.allowed = switchRow;
    else if (probe.state.s === "needs-setting" && probe.install === "portable" && probe.port)
      extras.allowed = (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground">Your AI adds Fuobe&apos;s setting next. Or do it yourself in one click:</p>
          <GuardFix port={probe.port} install="portable" />
        </div>
      );
    if (way === "direct" && allowed && !guarded && !skipGuard)
      extras.guard = (
        <p className="text-[12px] text-muted-foreground">
          Your AI adds it next. It keeps other websites out of your ComfyUI.{" "}
          {allowedAt && now - allowedAt > GUARD_WAIT_MS && <Quiet onClick={() => setSkipGuard(true)}>Connect anyway</Quiet>}
        </p>
      );
    if (way === "direct" && auto.error) extras.guard = <p className="text-[12px] text-destructive">{auto.error}</p>;
  }
  // Pairing (a phone, Safari, a page on plain http, a browser that blocks this computer): the code ComfyUI shows.
  if (pairing && !connected) {
    extras.connect = <ConnectNote pairing />;
    extras.paired = (
      <div className="space-y-2">
        <p className="text-[12px] text-muted-foreground">
          In ComfyUI on your computer, open <span className="text-foreground">Extensions → Connect to Fuobe</span> and press Connect. Type the code it shows here.
        </p>
        <PairWithCode />
      </div>
    );
  }
  if (way === "address" && !(saved === "link" && online && address.state !== "failed"))
    extras.address = (
      <AddressForm saved={saved === "link"} state={address} onState={setAddress} onConnected={() => void check.start()} phone={phone} site={site} focus={focusAddress && !phone} />
    );
  if (connected && !fromRun) {
    if (model.state === "download") extras.model = <ModelDownload model={model.model} gbTenths={model.gbTenths} os={os ?? "other"} onCheck={() => void recheck()} checking={check.running} />;
    else if (model.state === "none")
      extras.model = (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground">
            {cpu
              ? "ComfyUI runs on your computer's processor, not on a graphics card. Fuobe's picture models need a graphics card with 8 GB or more, so none fits here, and on the processor one picture would take many minutes. If the computer has a graphics card, your AI can make ComfyUI use it."
              : model.why === "setup"
                ? "These picture models need more than a download on your ComfyUI, most often an update. Your AI can update it."
                : "Your GPU has too little memory for the small picture models (the smallest needs 8 GB)."}
            {model.why === "small" && (
              <>
                {" "}
                Or use your own fal.ai or Replicate key.{" "}
                <Link href="/settings#your-keys" className="text-brand-text underline-offset-4 hover:underline">
                  Your keys
                </Link>
              </>
            )}
          </p>
          <Button size="sm" variant="ghost" onClick={() => void recheck()} disabled={check.running}>
            {check.running ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check again
          </Button>
        </div>
      );
    if (model.state === "ready" && picture.state !== "running" && picture.state !== "ok")
      extras.picture = (
        <div className="space-y-1.5">
          {picture.state === "failed" && <p className="text-[12px] text-destructive">{picture.cause === "out-of-memory" ? "Your GPU ran out of memory. Close other apps that use it, then try again." : picture.error}</p>}
          <Button className="h-11 sm:h-9" onClick={() => void picture.start(model.model)}>
            {picture.state === "failed" ? "Try again" : "Make your first picture"}
          </Button>
        </div>
      );
    else if (picture.state === "running")
      extras.picture = (
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {FIRST_MODEL_NAME[picture.model!]} is making it on your GPU…
        </p>
      );
    else if (picture.state === "no-model") extras.picture = <p className="text-[12px] text-muted-foreground">ComfyUI needs one more thing for this model. Fuobe shows what.</p>;
  }
  if (fromRun && connected) extras.picture = <p className="text-[12px] text-muted-foreground">Your run starts in a moment.</p>;

  const handoff = os && session.code ? { way, os, site, code: session.code, browser, phone } : null;
  const lead = phone
    ? "ComfyUI is the free app that runs AI models on your computer's graphics card. It runs on your computer, so the steps run there."
    : "ComfyUI is the free app that runs AI models on your own graphics card. Your AI sets it up with you and asks before each step. Fuobe checks each step here.";

  return (
    <div className="w-full min-w-0 space-y-4 sm:max-w-[36rem]">
      <div className="space-y-1">
        <button type="button" onClick={onBack} className="-ml-1 flex h-9 items-center gap-1 rounded-md px-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Back
        </button>
        <h2 ref={heading} tabIndex={-1} className="text-[17px] font-semibold outline-none">
          Set it up with your AI
        </h2>
        <p className="text-[13px] text-muted-foreground">{lead}</p>
        <p className="text-[12px] text-muted-foreground">
          You need an NVIDIA graphics card with 8 GB or more, or a Mac with Apple silicon and 16 GB. No such computer? Use your own fal.ai or Replicate key in{" "}
          <Link href="/settings#your-keys" className="text-brand-text underline-offset-4 hover:underline">
            Your keys
          </Link>
          .
        </p>
      </div>

      {/* What Fuobe picked for this browser, and the way to change it. */}
      {(!phone || ways.length > 1) && (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            <span>
              {way === "direct"
                ? `For ${OS_NAME[os ?? "other"] || "your computer"} and ${BROWSER_LABEL[browser]}, with ComfyUI on this computer.`
                : `For ComfyUI on your ${OS_NAME[os ?? "other"] ? `${OS_NAME[os ?? "other"]} ` : ""}computer, ${way === "connect" ? "with Fuobe Connect" : "through a web address"}.`}
            </span>
            <Quiet onClick={() => setChanging((v) => !v)}>{changing ? "Done" : "Change"}</Quiet>
          </p>
          {changing && (
            <div className="flex flex-wrap items-center gap-2">
              <TabRow role="tablist" aria-label="Way to connect" fade={false} className="w-fit">
                {ways.map((w) => (
                  <button
                    key={w}
                    type="button"
                    role="tab"
                    aria-selected={w === way}
                    aria-disabled={off.includes(w)}
                    onClick={() => !off.includes(w) && setWay(w)}
                    className={cn(TAB_PILL, off.includes(w) && "opacity-50")}
                    {...onAttr(w === way)}
                  >
                    {WAY_LABEL[w]}
                  </button>
                ))}
              </TabRow>
              {!phone && (
                <Select value={os ?? undefined} onValueChange={(v) => setOsPicked(v as Os)}>
                  <SelectTrigger className="h-9 w-36" aria-label="Computer">
                    <SelectValue placeholder="Computer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="windows">Windows</SelectItem>
                    <SelectItem value="mac">Mac</SelectItem>
                    <SelectItem value="linux">Linux</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          {(changing || off.length > 0) && <p className="text-[12px] text-muted-foreground">{wayLine(way, support)}</p>}
        </div>
      )}

      {phone && <PhoneSend site={site} os={os} way={way} onOs={setOsPicked} />}

      {!session.mine && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5 text-[13px]">
          <span className="min-w-0 flex-1">This setup is open in another tab or on another device. Your AI sees the checks from there. To use this tab, press Continue here.</span>
          <Button size="sm" variant="secondary" onClick={session.takeOver}>
            Continue here
          </Button>
        </div>
      )}

      {!finished && (
        <HandOffs
          input={handoff}
          waiting={!session.code && !session.failed && !session.ended}
          needOs={!os}
          phone={phone}
          failed={session.failed}
          onRetry={session.retry}
          guideUrl={way && os ? `/api/setup/guide/${way}/${os}` : null}
          code={session.code}
          ended={session.ended}
          renewed={session.renewed}
          onEnd={() => void session.end()}
          onFresh={() => void session.fresh()}
        />
      )}

      {/* The checklist, or the finish in its place (the box keeps its height). */}
      <section aria-label="Fuobe checks as your AI works" className="min-h-[18rem] rounded-2xl bg-brand-faint/50 p-4">
        {finished ? (
          <FinishCard picture={picture} gpu={gpuName} cpu={cpu} onClose={onBack} />
        ) : (
          <>
            <p className="mb-3 text-[13px] font-medium">Fuobe checks as your AI works</p>
            <SetupChecklist
              steps={steps}
              extras={extras}
              footer={
                <Presence
                  aiReadAt={session.aiReadAt}
                  offline={session.offline}
                  now={now}
                  stuck={stuck}
                  next={nextOf(viewNow, now)}
                  onSelf={onBack}
                  onAddress={way !== "address" ? () => setWay("address") : undefined}
                  code={session.code}
                />
              }
            />
          </>
        )}
      </section>
      {fromRun && !connected && onNotNow && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onNotNow}>
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}

/** One line about the way picked. */
function wayLine(way: Way, support: string): string {
  if (way === "connect")
    return support === "safari"
      ? "Safari can't reach ComfyUI from a website. With Fuobe Connect, you pair ComfyUI with your account by a code instead, and runs go on with this tab closed."
      : support === "http"
        ? "Your browser marks this page as not secure, so it can't reach ComfyUI from here. With Fuobe Connect, you pair ComfyUI with your account by a code instead."
        : support === "phone"
          ? "Install Fuobe Connect in ComfyUI on your computer, then approve the code it shows on this phone. Runs go on with no Fuobe tab open."
          : "Install Fuobe Connect in ComfyUI once. Fuobe then uses ComfyUI from this tab, or from any browser and phone with a code.";
  if (support === "safari") return "Safari can't reach ComfyUI from a website. In Chrome, Edge or Firefox, Fuobe uses ComfyUI right from the tab, with nothing public.";
  if (support === "http") return "Your browser marks this page as not secure, so it can't reach ComfyUI from here. A web address works.";
  if (way === "address") return "ComfyUI gets a web address. It works from Safari and phones, and runs go on with this tab closed.";
  return "Fuobe uses ComfyUI right from this tab. Runs go while Fuobe is open here.";
}

/**
 * Fuobe Connect isn't in ComfyUI yet: the AI installs it, with a link to its page. On this computer's tab, a ComfyUI on
 * another computer can pair with a code instead (`pairing`: the setup pairs already).
 */
function ConnectNote({ pairing }: { pairing?: boolean }) {
  const [code, setCode] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">
        {pairing ? "Your AI installs it in ComfyUI on your computer, then restarts ComfyUI." : "Your AI installs it next, then restarts ComfyUI. Fuobe connects by itself once it's there."}{" "}
        <a href={FUOBE_CONNECT.gitUrl} target="_blank" rel="noopener noreferrer" className="text-brand-text underline-offset-4 hover:underline">
          Fuobe Connect on GitHub
          <span className="sr-only"> (opens a new tab)</span>
        </a>
      </p>
      {!pairing && (code ? <PairWithCode /> : <Quiet onClick={() => setCode(true)}>ComfyUI on another computer? Pair it with a code</Quiet>)}
    </div>
  );
}

/** Nothing answers: install it with the AI, or a port of its own (`installed`: ComfyUI ran here a while ago, so no install). */
function NoComfy({ onLook, missed, notComfy, installed }: { onLook: (port: number, host: string) => void; missed?: number; notComfy?: number; installed?: boolean }) {
  const [port, setPort] = useState(false);
  return (
    <div className="space-y-2">
      {!installed && (
        <p className="text-[12px] text-muted-foreground">
          No ComfyUI yet? Your AI can install it.{" "}
          <a href="https://www.comfy.org/download" target="_blank" rel="noopener noreferrer" className="text-brand-text underline-offset-4 hover:underline">
            Get ComfyUI Desktop
            <span className="sr-only"> (opens a new tab)</span>
          </a>
        </p>
      )}
      {port ? <OtherPort onLook={onLook} missed={missed} notComfy={notComfy} /> : <Quiet onClick={() => setPort(true)}>ComfyUI on another port?</Quiet>}
    </div>
  );
}

/**
 * ComfyUI stopped answering a moment ago: it is starting again. The time so far, and after a minute, why it can take
 * this long (a portable or Easy-Install ComfyUI loads every add-on before it answers).
 */
function RestartWait({ port, ms }: { port: number; ms: number }) {
  const slow = ms >= RESTART_SLOW_MS;
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        <span>
          {slow ? `Still waiting for ComfyUI on port ${port}: ${quietWords(ms)} so far.` : `ComfyUI stopped answering on port ${port}. Waiting for it to start again… (${quietWords(ms)})`}
        </span>
      </p>
      {slow && (
        <p className="text-[12px] text-muted-foreground">
          ComfyUI loads all its add-ons before it answers. A portable or Easy-Install ComfyUI can take up to {RESTART_WAIT_MIN} minutes. Fuobe goes on by itself as soon as it
          answers.
        </p>
      )}
    </div>
  );
}

/**
 * The hand-offs: Open in ChatGPT, Open in Claude (each also copies the message, in case the chat opens empty), Copy the
 * steps for any other AI, and one command for a coding agent on this computer. Ready as soon as the code is: the AI's
 * first status says what to do whether or not Fuobe has looked for ComfyUI yet. After a hand-off the box folds to one
 * line (with the steps to copy, for a chat that can't open links), and the checklist is the main view.
 */
function HandOffs({
  input,
  waiting,
  needOs,
  phone,
  failed,
  onRetry,
  guideUrl,
  code,
  ended,
  renewed,
  onEnd,
  onFresh,
}: {
  input: Parameters<typeof prefillText>[0] | null;
  waiting: boolean;
  needOs: boolean;
  phone: boolean;
  failed: string | null;
  onRetry: () => void;
  guideUrl: string | null;
  code: string | null;
  ended: boolean;
  renewed: boolean;
  onEnd: () => void;
  onFresh: () => void;
}) {
  const [sent, setSent] = useState<string | null>(null);
  const [apps, setApps] = useState(false);
  const [agent, setAgentState] = useState<Agent>(readAgent);
  const setAgent = (a: Agent) => {
    setAgentState(a);
    try {
      localStorage.setItem(AGENT_KEY, a);
    } catch {}
  };
  const guide = useQuery({
    queryKey: ["ai-setup-guide", guideUrl],
    queryFn: async () => {
      const r = await fetch(guideUrl!);
      if (!r.ok) throw new Error("No guide");
      return r.text();
    },
    enabled: !!guideUrl,
    staleTime: 5 * 60_000,
  });
  const text = input ? prefillText(input) : "";
  let line = "";
  try {
    line = input ? agentLine(agent, input) : "";
  } catch {}
  const full = input && guide.data ? fullInstructions(input, guide.data) : null;
  const ready = !!input && !ended;

  const openChat = (t: AiTarget) => {
    // The message goes on the clipboard too: a chat that opens empty (a sign-in first, an app) takes it with a paste.
    void copyText(text).then((ok) => ok && toast("Message copied too", { description: "If the chat opens empty, paste it.", duration: 4000 }));
    setSent(AI_TARGETS[t].label);
  };
  /** Copy the steps (`keep`: from the folded box, which stays as it is). */
  const copyFull = async (keep = false) => {
    if (full && (await copyWithToast(full, "Steps copied")) && !keep) setSent("your AI");
  };

  if (failed && !code)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-4 text-[13px]">
        <span>{failed}</span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      </div>
    );

  return (
    <div className="space-y-3 rounded-2xl border bg-background p-4">
      {sent && ready ? (
        <div className="space-y-1.5 text-[13px]">
          <p className="flex items-center gap-1.5 font-medium">
            <Check className="size-4 text-brand-text" /> Sent to {sent}.
          </p>
          {sent !== "your AI" && <p className="text-[12px] text-muted-foreground">If {sent} says it can&apos;t open links, copy the steps and paste them into the chat.</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {sent !== "your AI" && (
              <Quiet onClick={() => void copyFull(true)} className={cn(!full && "pointer-events-none opacity-50")}>
                Copy the steps
              </Quiet>
            )}
            <Quiet onClick={() => setSent(null)}>Use another AI</Quiet>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[13px] font-medium">Give your AI the steps</p>
          {needOs && <p className="text-[12px] text-muted-foreground">Pick the computer that runs ComfyUI first.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(AI_TARGETS) as AiTarget[])
              .filter((t) => AI_TARGETS[t].on)
              .map((t) =>
                ready ? (
                  <Button key={t} asChild className="h-11">
                    <a href={chatLink(t, text)} target="_blank" rel="noopener noreferrer" onClick={() => openChat(t)}>
                      <BotMessageSquare /> Open in {AI_TARGETS[t].label}
                      <span className="sr-only"> (opens a new tab)</span>
                    </a>
                  </Button>
                ) : (
                  <Button key={t} className="h-11" disabled>
                    {waiting ? <Loader2 className="animate-spin" /> : <BotMessageSquare />} Open in {AI_TARGETS[t].label}
                  </Button>
                ),
              )}
          </div>
          <p className="text-[12px] text-muted-foreground">ChatGPT and Claude tell you each command to run. An AI app on your computer runs them for you, after you say yes.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Quiet onClick={() => void copyFull()} className={cn((!ready || !full) && "pointer-events-none opacity-50")}>
              Copy the steps for another AI
            </Quiet>
            {!phone && (
              <button type="button" onClick={() => setApps((v) => !v)} aria-expanded={apps} className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
                <Terminal className="size-3.5" /> AI app on this computer? <ChevronDown className={cn("size-3.5 transition-transform", apps && "rotate-180")} />
              </button>
            )}
          </div>
          {apps && !phone && (
            <div className="space-y-2">
              <p className="text-[12px] text-muted-foreground">Paste this in a terminal on this computer. The app asks before each command.</p>
              <TabRow role="tablist" aria-label="Coding agent" fade={false} className="w-fit">
                {(Object.keys(AGENTS) as Agent[]).map((a) => (
                  <button key={a} type="button" role="tab" aria-selected={a === agent} onClick={() => setAgent(a)} className={TAB_PILL} {...onAttr(a === agent)}>
                    {AGENTS[a].label}
                  </button>
                ))}
              </TabRow>
              {ready && line ? <CopyLine text={line} label="the command" /> : <div className="h-11 rounded-lg bg-muted" />}
              <p className="text-[12px] text-muted-foreground">Don&apos;t have this app, or use Cursor? Copy the steps works with any AI.</p>
            </div>
          )}
        </>
      )}
      <CodeLine code={code} waiting={waiting} ended={ended} renewed={renewed} onEnd={onEnd} onFresh={onFresh} />
    </div>
  );
}

/**
 * The setup code, with End this code in a small menu; after it ends, a new one. While the code is on its way
 * (`waiting`), the same lines with a blank where the code goes, so nothing below moves when it arrives.
 */
function CodeLine({ code, waiting, ended, renewed, onEnd, onFresh }: { code: string | null; waiting: boolean; ended: boolean; renewed: boolean; onEnd: () => void; onFresh: () => void }) {
  if (ended)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-[12px] text-muted-foreground">
        <span>Your AI can&apos;t see Fuobe&apos;s checks now.</span>
        <Quiet onClick={onFresh}>Share again</Quiet>
      </div>
    );
  if (!code && !waiting) return null;
  const shown = code ? showCode(code) : "";
  return (
    <div className="space-y-1.5 border-t pt-3" data-code-line={code ? "ready" : "waiting"}>
      {renewed && code && <p className="text-[12px]">Fuobe made a new code. Tell your AI: My new setup code is {shown}.</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
          Setup code
          {code ? (
            <>
              <span aria-label={`Setup code ${spokenCode(code)}`} className="font-mono text-[13px] tracking-widest text-foreground">
                {shown}
              </span>
              <button type="button" onClick={() => void copyWithToast(renewed ? `My new setup code is ${shown}` : shown, "Code copied")} className="grid size-8 place-items-center rounded-md hover:bg-muted hover:text-foreground" aria-label="Copy the setup code">
                <Copy className="size-3.5" />
              </button>
            </>
          ) : (
            <>
              <span className="h-4 w-32 shrink-0 rounded bg-muted motion-safe:animate-pulse" />
              <span className="sr-only">Fuobe is making your code.</span>
              <span aria-hidden className="size-8" />
            </>
          )}
        </p>
        {code ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="More about this code">
                <Ellipsis className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEnd}>End this code</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span aria-hidden className="size-8 shrink-0" />
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">Your AI reads Fuobe&apos;s checks with this code. It can only read them, and the code ends by itself.</p>
    </div>
  );
}

/** Whether the AI has checked in, and, when nothing moved for a while, what Fuobe sees and the ways out. */
function Presence({
  aiReadAt,
  offline,
  now,
  stuck,
  next,
  onSelf,
  onAddress,
  code,
}: {
  aiReadAt: number | null;
  offline: boolean;
  now: number;
  stuck: boolean;
  next: ReturnType<typeof nextOf>;
  onSelf: () => void;
  onAddress?: () => void;
  code: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ago = aiReadAt ? Math.max(1, Math.round((now - aiReadAt) / 1000)) : null;
  const forAi = [`Fuobe setup status${code ? ` for code ${showCode(code)}` : ""}:`, next.say, ...next.how.map((h) => `- ${h}`), `Guide: ${next.guide}`].join("\n");
  return (
    <div className="space-y-2 text-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 text-muted-foreground">
          <span className={cn("inline-flex size-2 shrink-0 rounded-full", ago !== null && !offline ? "bg-brand-text motion-safe:animate-live-dot" : "bg-muted-foreground/40")} />
          {offline ? "Fuobe can't reach its server right now. Retrying." : ago !== null ? `Your AI checked in ${ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago.` : "Your AI hasn't checked Fuobe yet. Fuobe still ticks each step."}
        </p>
        {stuck ? (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1 font-medium text-brand-text">
            Stuck? <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        ) : (
          <p className="text-muted-foreground">Keep this tab open. You can switch to your AI.</p>
        )}
      </div>
      {stuck && open && (
        <div className="space-y-2 rounded-xl bg-background p-3">
          <p>Tell your AI: Check Fuobe&apos;s status again.</p>
          <p className="text-muted-foreground">
            What Fuobe sees now: <span className="text-foreground">{personWords(next)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Button size="sm" variant="secondary" onClick={() => void copyWithToast(forAi, "Copied for your AI")}>
              <Copy /> Copy for my AI
            </Button>
            <Quiet onClick={onSelf}>Do it myself instead</Quiet>
            {onAddress && <Quiet onClick={onAddress}>Try a web address instead</Quiet>}
          </div>
        </div>
      )}
    </div>
  );
}

/** The address form's own words for each kind of problem (the check's words, for the rest). */
const ADDRESS_WORDS: Partial<Record<AddressCause, string>> = {
  local: "That address works only on your own network. Paste the one that ends in trycloudflare.com.",
  "not-found": "Fuobe can't find this address. Make sure that you pasted all of it, and that the cloudflared window is still open. If it closed, your AI starts it again, and you get a new address.",
  "no-answer": "Nothing answers at this address. Make sure that ComfyUI and the cloudflared window are both open. A new address can take a minute to work.",
  "not-comfy": "This address doesn't lead to ComfyUI. Ask your AI to check the port in the cloudflared command.",
  password: "This address asks for a password or a token. Type it under Access token, then press Connect.",
};

/** The web address form: paste the address cloudflared made (and its token, if it has one), and Fuobe tests it (the same check as Your GPU). */
function AddressForm({
  saved,
  state,
  onState,
  onConnected,
  phone,
  site,
  focus,
}: {
  saved: boolean;
  state: { state: string; cause?: AddressCause; words?: string };
  onState: (s: { state: "none" | "testing" | "ok" | "failed"; cause?: AddressCause; words?: string }) => void;
  onConnected: () => void;
  phone: boolean;
  site: string;
  /** Take the focus when it shows (opened for the web address, from a phone). */
  focus?: boolean;
}) {
  const qc = useQueryClient();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focus) return;
    input.current?.focus({ preventScroll: true });
    input.current?.scrollIntoView({ block: "center" });
  }, [focus]);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [withToken, setWithToken] = useState(false);
  const canPaste = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;
  const value = url.trim();
  const local = !!value && isLocalAddress(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`);
  const showToken = withToken || state.cause === "password" || !!token;
  const connect = async () => {
    if (!value || local) return;
    onState({ state: "testing" });
    const res = await fetch("/api/account/gpu", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: value, ...(token.trim() && { token: token.trim() }) }),
    }).catch(() => null);
    const j = res ? ((await res.json().catch(() => ({}))) as { error?: string; trouble?: { cause?: string; words?: string } }) : {};
    if (res?.ok) {
      onState({ state: "ok" });
      setUrl("");
      setToken("");
      for (const k of [["account-gpu"], ["status"], ["viewer"]]) void qc.invalidateQueries({ queryKey: k });
      onConnected();
      return;
    }
    // Plain words under the box; the AI gets only the kind of problem.
    const cause = res ? addressCauseOf(j.trouble?.cause) : "unknown";
    onState({ state: "failed", cause, words: ADDRESS_WORDS[cause] ?? j.trouble?.words ?? j.error ?? "Fuobe can't reach its server right now. Try again." });
  };
  let host = site;
  try {
    host = new URL(site).host;
  } catch {}
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-url`} className="text-[12px]">
        Your ComfyUI&apos;s web address
      </Label>
      {saved && <p className="text-[12px] text-muted-foreground">Fuobe can&apos;t reach the address it has. Each time cloudflared starts, it makes a new one: paste the new one here.</p>}
      <div className="flex gap-2">
        <Input
          ref={input}
          id={`${id}-url`}
          placeholder="https://your-address.trycloudflare.com"
          value={url}
          autoComplete="off"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void connect()}
          aria-invalid={local || state.state === "failed"}
          className="h-11 min-w-0 flex-1 sm:h-9"
        />
        {canPaste && (
          <Button
            variant="secondary"
            className="h-11 sm:h-9"
            aria-label="Paste"
            onClick={async () => {
              try {
                setUrl((await navigator.clipboard.readText()).trim());
              } catch {}
            }}
          >
            <ClipboardPaste />
          </Button>
        )}
        <Button className="h-11 sm:h-9" onClick={() => void connect()} disabled={!value || local || state.state === "testing"}>
          {state.state === "testing" && <Loader2 className="animate-spin" />} Connect
        </Button>
      </div>
      {showToken ? (
        <div className="space-y-1">
          <Label htmlFor={`${id}-token`} className="text-[12px]">
            Access token <span className="text-muted-foreground">(only if the address asks for one)</span>
          </Label>
          <Input
            id={`${id}-token`}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void connect()}
            className="h-11 sm:h-9"
          />
        </div>
      ) : null}
      {local && <p className="text-[12px] text-destructive">{ADDRESS_WORDS.local}</p>}
      {!local && state.state === "failed" && state.words && (
        <p role="status" className="text-[12px] text-destructive">
          {state.words}
        </p>
      )}
      <p className="text-[12px] text-muted-foreground">
        Keep the address to yourself. Paste it here, not in your AI&apos;s chat.{" "}
        {!showToken && <Quiet onClick={() => setWithToken(true)}>Has a password or token?</Quiet>}
      </p>
      {phone && <OnComputer host={host} />}
    </div>
  );
}

/**
 * On a phone: the address is on the computer's clipboard, so it goes into Fuobe there: the page that opens this box on
 * the computer, under the same code once the person logs in with the same account. The button that sends that page is
 * the one at the top of the panel (PhoneSend), never a second one here.
 */
function OnComputer({ host }: { host: string }) {
  const path = aiSetupHref("address");
  return (
    <p className="rounded-lg bg-muted/60 px-2.5 py-2 text-[12px]">
      The address goes on your computer&apos;s clipboard, not your phone&apos;s. On that computer, open <span className="break-all font-medium">{host}{path}</span> and log in with
      this account, or press {sendLabel(canShare())} at the top. This box is there, with the same setup code. Paste the address in it. If your phone shares the
      computer&apos;s clipboard, you can paste it here instead.
    </p>
  );
}

/** A model to download: its name and size, the commands to copy, and a fresh check once it is there. */
function ModelDownload({ model, gbTenths, os, onCheck, checking }: { model: FirstModel; gbTenths: number; os: Os; onCheck: () => void; checking: boolean }) {
  const plan = useGpuPlan(`model:${model}#t2i`).data;
  const commands = plan ? (os === "windows" ? plan.commands.powershell : plan.commands.bash) : null;
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">
        ComfyUI has no picture model Fuobe can use yet. {FIRST_MODEL_NAME[model]} fits: one download of {(gbTenths / 10).toFixed(gbTenths >= 100 ? 0 : 1)} GB. Your AI can download it, or you can.
      </p>
      <div className="flex flex-wrap gap-2">
        {commands && (
          <Button size="sm" variant="secondary" onClick={() => void copyWithToast(commands, "Download commands copied")}>
            <Copy /> Copy download commands
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCheck} disabled={checking}>
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check again
        </Button>
      </div>
    </div>
  );
}

/** Can this browser hand a link to another app (the share sheet)? Else the link is copied. */
const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";
/** The name of the phone's one button that sends the setup to the computer. */
const sendLabel = (share: boolean) => (share ? "Send to my computer" : "Copy link for my computer");

/**
 * On a phone: the steps run on the computer. One button sends this setup there on the way picked here (a web address
 * opens at the box for it, Fuobe Connect at its checks), under the same code once the person logs in with this account.
 * Or an AI app here, with the computer's system picked.
 */
function PhoneSend({ site, os, way, onOs }: { site: string; os: Os | null; way: Way; onOs: (os: Os) => void }) {
  const link = `${site}${aiSetupHref(way)}`;
  const share = canShare();
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Button
          className="h-11 w-full"
          onClick={async () => {
            if (share) {
              try {
                await navigator.share({ title: "Set up Fuobe on my computer", url: link });
                return;
              } catch {}
            }
            await copyWithToast(link, "Link copied");
          }}
        >
          <Send /> {sendLabel(share)}
        </Button>
        <p className="text-[12px] text-muted-foreground">It opens this setup on your computer. Log in there with this account.</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-[12px] text-muted-foreground">
          Or start with an AI app on this phone. The commands run on your computer.{" "}
          {way === "connect"
            ? "At the end, ComfyUI shows a code, and you type it here."
            : "At the end, you paste an address into Fuobe on that computer, signed in to this account."}{" "}
          Which computer runs ComfyUI?
        </p>
        <TabRow role="tablist" aria-label="Computer" fade={false} className="w-fit">
          {(["windows", "mac", "linux"] as Os[]).map((o) => (
            <button key={o} type="button" role="tab" aria-selected={o === os} onClick={() => onOs(o)} className={TAB_PILL} {...onAttr(o === os)}>
              {o === "mac" ? "Mac" : OS_NAME[o]}
            </button>
          ))}
        </TabRow>
      </div>
    </div>
  );
}
