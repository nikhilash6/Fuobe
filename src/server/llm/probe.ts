import "server-only";
import { createHash } from "node:crypto";
import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";
import { hostPort, REACH, takesConnection } from "../providers/reach";
import { keyMessage, START_HINT } from "./errors";
import { authHeaders, cap, openaiBase } from "./servers";
import type { LocalModel, LocalServer, LocalStatus } from "./types";

/*
 * Is a local server usable, and with which model? Each server is asked with a few GETs sent at once;
 * the answers are kept for 15 s per server and read into a LocalStatus with the current Settings.
 * Routing is synchronous, so the first look at a server (after boot, or after its URL or key changes
 * in Settings) asks from a worker thread and waits for it; later looks refresh in the background.
 *
 * A late answer isn't "down": the busy-vs-down rules ComfyUI and Ollama follow (../providers/reach)
 * hold for every local server. A refused port or an HTTP answer is read at once. No answer in time is
 * busy when the server answered lately (it keeps what it last said: a model loading, a long answer
 * under way); else it gets one longer look when its port takes a connection (none again for a while
 * once one goes unanswered). The blocking first look counts a taken connection as busy for now, and
 * the unhurried check behind it says for sure.
 */

/** One GET's answer: the status and the JSON body, or why there was none. */
export interface Raw {
  status?: number;
  body?: unknown;
  error?: string;
}
export type Probe = Record<string, Raw>;

interface ProbeRequest {
  key: string;
  url: string;
  headers: Record<string, string>;
}

export const PROBE_MS = 15_000;
/** How long the blocking first look waits for each GET. */
const SYNC_TIMEOUT_MS = 1500;
const EMBEDDING = /embed|rerank/i;

/**
 * Ollama: its model list. LM Studio: its own model list (loaded copies, context, tool training),
 * and the OpenAI one for versions before 0.4. Unsloth Studio: its liveness check (which names the
 * service: Jupyter also likes port 8888) and its model list. Any other server: the OpenAI model list.
 */
export function probeRequests(s: LocalServer): ProbeRequest[] {
  if (!s.url) return [];
  const auth = authHeaders(s);
  if (s.kind === "ollama") return [{ key: "tags", url: `${s.url}/api/tags`, headers: {} }];
  if (s.kind === "lmstudio") {
    return [
      { key: "native", url: `${s.url}/api/v1/models`, headers: auth },
      { key: "openai", url: `${s.url}/v1/models`, headers: auth },
    ];
  }
  if (s.kind === "unsloth") {
    return [
      { key: "live", url: `${s.url}/api/liveness`, headers: {} },
      { key: "openai", url: `${s.url}/v1/models`, headers: auth },
    ];
  }
  return [{ key: "openai", url: `${openaiBase(s)}/models`, headers: auth }];
}

const ok = (r?: Raw): r is Raw & { status: number } => !!r?.status && r.status >= 200 && r.status < 300;
const denied = (r?: Raw) => r?.status === 401 || r?.status === 403;
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const field = (v: unknown, k: string): unknown => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
export const tokens = (n: number) => n.toLocaleString("en-US");

function notRunning(s: LocalServer, r?: Raw): string {
  if (r?.error === "TimeoutError") return `${cap(s.label)} didn't answer at ${s.url} in time. ${START_HINT[s.kind]}`;
  if (r?.status) return `${cap(s.label)} answered ${r.status} at ${s.url}. Check its URL in Settings → AI helper.`;
  return `${cap(s.label)} isn't running at ${s.url}. ${START_HINT[s.kind]}`;
}

/** A loaded model with less context than Fuobe asks for (or than the model's most, when that's less: a reload can't give more). */
function smallContext(s: LocalServer, model: string, have: number | null, need: number, max?: number | null): string | null {
  const want = Math.min(need, max ?? need);
  if (!want || !have || have >= want) return null;
  const fix = s.kind === "lmstudio" ? `Reload it with ${Math.round(want / 1024)}k context (Settings → AI helper)` : "Load it in Unsloth Studio with a larger context";
  return `${model} is loaded with ${tokens(have)} tokens of context; Assist and long texts need about ${tokens(need)}. ${fix}.`;
}

/** What a probe's answers say about a server: up or not, its chat models, the model a call would use, and what's wrong. */
export function interpret(s: LocalServer, probe: Probe, need: number, at: number): LocalStatus {
  const base: LocalStatus = { kind: s.kind, label: s.label, url: s.url, up: false, auth: s.key ? "ok" : "none", models: [], model: null, loaded: null, context: null, problem: null, warning: null, at };
  if (!s.url) return { ...base, problem: "Set the server's URL in Settings → AI helper (for example http://127.0.0.1:8080/v1)." };
  const keyProblem = (): LocalStatus => ({ ...base, up: true, auth: s.key ? "rejected" : "missing", problem: keyMessage(s) });

  if (s.kind === "ollama") {
    const tags = probe.tags;
    if (!ok(tags)) return { ...base, problem: notRunning(s, tags) };
    const models = rows(field(tags.body, "models"))
      .map((m) => ({ id: str(m.name) ?? str(m.model) ?? "" }))
      .filter((m) => m.id && !EMBEDDING.test(m.id));
    const have = models.some((m) => m.id === s.model || m.id === `${s.model}:latest`);
    // Ollama is ready whenever it answers (as before): a missing model is named when a call needs it.
    const warning = !models.length ? `Ollama has no models yet. Run \`ollama pull ${s.model}\`.` : have ? null : `${s.model} isn't downloaded. Run \`ollama pull ${s.model}\`, or pick one Ollama has.`;
    return { ...base, up: true, auth: "none", models, model: s.model, context: need || null, warning };
  }

  if (s.kind === "lmstudio") {
    const native = probe.native;
    const openai = probe.openai;
    if (denied(native) || denied(openai)) return keyProblem();
    let models: LocalModel[];
    const isNative = ok(native) && Array.isArray(field(native.body, "models"));
    if (isNative) {
      models = rows(field(native.body, "models"))
        .filter((m) => m.type === "llm" && str(m.key))
        .map((m) => {
          const loaded = rows(m.loaded_instances);
          const reasoning = field(field(m.capabilities, "reasoning"), "default");
          return {
            id: m.key as string,
            name: str(m.display_name) ?? undefined,
            loaded: loaded.length > 0,
            tools: field(m.capabilities, "trained_for_tool_use") === true,
            reasoning: typeof reasoning === "string" && reasoning !== "off",
            context: num(field(loaded[0]?.config, "context_length")),
            maxContext: num(m.max_context_length),
            instances: loaded.flatMap((i) => (str(i.id) ? [i.id as string] : [])),
          };
        });
    } else if (ok(openai) && Array.isArray(field(openai.body, "data"))) {
      // LM Studio before 0.4: ids only (all downloaded models with JIT loading on, else the loaded ones).
      models = rows(field(openai.body, "data"))
        .flatMap((m) => (str(m.id) ? [{ id: m.id as string }] : []))
        .filter((m) => !EMBEDDING.test(m.id));
    } else return { ...base, problem: notRunning(s, native?.status ? native : openai) };
    const up = { ...base, up: true, models, native: isNative };
    if (!models.length) return { ...up, problem: "LM Studio has no chat models downloaded yet. Download one in LM Studio (Discover), or run `lms get qwen/qwen3-8b`." };
    let pick: LocalModel | undefined;
    if (s.model) {
      pick = models.find((m) => m.id === s.model || m.name === s.model || s.model.startsWith(`${m.id}@`) || m.instances?.includes(s.model));
      if (!pick && isNative) return { ...up, problem: `LM Studio has no model called ${s.model}. Download it in LM Studio (or run \`lms get ${s.model}\`), or pick another in Settings → AI helper.` };
    } else {
      // A loaded model, else one trained for tool calling (Assist needs it), else any.
      pick = models.find((m) => m.loaded) ?? models.find((m) => m.tools) ?? models[0];
    }
    // A display name ("Qwen3 8B") finds the model, but calls and loads need its key.
    const model = pick && pick.name === s.model && pick.id !== s.model ? pick.id : s.model || pick!.id;
    const context = pick?.loaded ? (pick.context ?? null) : null;
    const warning =
      smallContext(s, model, context, need, pick?.maxContext) ??
      (pick?.maxContext && need && pick.maxContext < need ? `${model} handles only ${tokens(pick.maxContext)} tokens of context; Assist and long texts need about ${tokens(need)}.` : null) ??
      (pick?.reasoning ? `${model} thinks before it answers, which is slower. A model without thinking (an instruct model) suits Fuobe better.` : null);
    return { ...up, model, loaded: isNative ? !!pick?.loaded : null, context, warning };
  }

  if (s.kind === "unsloth") {
    const live = probe.live;
    if (!ok(live) || field(live.body, "service") !== "Unsloth UI Backend") {
      return { ...base, problem: ok(live) ? `Something else answers at ${s.url}, not Unsloth Studio. Check the URL (Unsloth Studio uses port 8888 unless you changed it).` : notRunning(s, live) };
    }
    const openai = probe.openai;
    if (denied(openai)) return keyProblem();
    if (!ok(openai)) return { ...base, up: true, problem: `Unsloth Studio didn't list its models (${openai?.status ?? openai?.error ?? "no answer"}). Try again in a moment.` };
    // Rows with a task are speech, music or image models.
    const models: LocalModel[] = rows(field(openai.body, "data"))
      .filter((m) => str(m.id) && !m.task)
      .map((m) => ({ id: m.id as string, name: str(m.display_name) ?? undefined, loaded: m.loaded === true, context: num(m.context_length), maxContext: num(m.max_context_length) }));
    const up = { ...base, up: true, models };
    if (s.model) {
      const want = s.model.toLowerCase();
      const pick = models.find((m) => m.id.toLowerCase() === want) ?? models.find((m) => want.startsWith(`${m.id.toLowerCase()}:`));
      if (!pick) return { ...up, problem: `Unsloth Studio has no model called ${s.model}. Pick one it lists in Settings → AI helper, or leave the model empty to use the one loaded in Unsloth.` };
      const warning = pick.loaded
        ? smallContext(s, s.model, pick.context ?? null, need, pick.maxContext)
        : `${s.model} isn't loaded in Unsloth Studio. It loads by itself only with Model auto-switch on (in Unsloth: avatar → Settings → API); otherwise load it on Unsloth's Chat page.`;
      return { ...up, model: s.model, loaded: !!pick.loaded, context: pick.context ?? null, warning };
    }
    const loaded = models.find((m) => m.loaded);
    if (!loaded) return { ...up, problem: `Unsloth Studio has no model loaded. Load one on its Chat page (Select model)${models.length ? "" : " after downloading one there"}.` };
    return { ...up, model: loaded.id, loaded: true, context: loaded.context ?? null, warning: smallContext(s, loaded.id, loaded.context ?? null, need, loaded.maxContext) };
  }

  // Any other OpenAI-compatible server.
  const openai = probe.openai;
  if (denied(openai)) return keyProblem();
  if (!ok(openai)) return { ...base, problem: notRunning(s, openai) };
  const models: LocalModel[] = rows(field(openai.body, "data"))
    .flatMap((m) => (str(m.id) ? [{ id: m.id as string }] : []))
    .filter((m) => !EMBEDDING.test(m.id));
  const up = { ...base, up: true, models };
  const model = s.model || models[0]?.id;
  if (!model) return { ...up, problem: `${cap(s.label)} lists no models. Load one in it, or name the model in Settings → AI helper.` };
  const warning = s.model && models.length && !models.some((m) => m.id === s.model) ? `${s.model} isn't in the server's model list (${models.map((m) => m.id).slice(0, 4).join(", ")}).` : null;
  return { ...up, model, warning };
}

// ---------------------------------------------------------------------------
// Asking, and the cache

/**
 * What a server's last check found: its answers (`probe`), when it last answered (`seen`), when a longer look last
 * went unanswered (`silent`). `busy`: its port took the connection but no answer came yet, so it counts as up for
 * now (no models known) until a check says for sure; any answer replaces it.
 */
export interface Entry {
  at: number;
  probe: Probe;
  seen?: number;
  silent?: number;
  busy?: boolean;
}

declare global {
  var __fuobeLocalProbes: Map<string, Entry> | undefined;
  var __fuobeLocalProbing: Map<string, Promise<void>> | undefined;
}
const probes = () => (globalThis.__fuobeLocalProbes ??= new Map());
const probing = () => (globalThis.__fuobeLocalProbing ??= new Map());

/** A server's cache key: its kind, URL and (a hash of) its key, so a new key is checked at once. */
const sigOf = (s: LocalServer) => `${s.kind}|${s.url}|${s.key ? createHash("sha256").update(s.key).digest("hex").slice(0, 16) : ""}`;

const parse = (text: string | undefined): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

async function get(r: ProbeRequest, timeoutMs: number): Promise<Raw> {
  try {
    const res = await fetch(r.url, { headers: r.headers, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: parse(await res.text()) };
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    return { error: err.name === "TimeoutError" ? "TimeoutError" : (err.cause?.code ?? err.name ?? "error") };
  }
}

/** The server answered one of its GETs (any HTTP status: interpret reads what it said). */
const answered = (raws: Raw[]) => raws.some((r) => r.status !== undefined);
/** None of its GETs got an answer in time (a refused port or a bad name is a no, not late). */
const late = (raws: Raw[]) => raws.length > 0 && raws.every((r) => r.error === "TimeoutError");
const lately = (t?: number) => !!t && Date.now() - t < REACH.answeredLatelyMs;

/**
 * One unhurried check of a server by the busy-vs-down rules (see the top of this file): its GETs within
 * REACH.answerMs; late with a recent answer keeps the last answers (busy); late otherwise gets the longer look when
 * the port takes a connection and no longer look went unanswered lately.
 */
async function check(s: LocalServer, prev: Entry | undefined): Promise<Omit<Entry, "at">> {
  const reqs = probeRequests(s);
  let raws = await Promise.all(reqs.map((r) => get(r, REACH.answerMs)));
  if (prev && !prev.busy && late(raws) && lately(prev.seen)) return { probe: prev.probe, seen: prev.seen };
  let silent = prev?.silent;
  if (late(raws) && !lately(silent) && (await takesConnection(s.url, REACH.connectMs))) {
    raws = await Promise.all(reqs.map((r) => get(r, REACH.lookMs)));
    if (!answered(raws)) silent = Date.now();
  }
  const probe: Probe = Object.fromEntries(reqs.map((r, i) => [r.key, raws[i]]));
  return answered(raws) ? { probe, seen: Date.now() } : { probe, ...(silent ? { silent } : {}) };
}

/** Ask the servers whose answers are older than 15 s (all of them with `force`), in parallel. */
export async function refresh(servers: LocalServer[], force = false): Promise<void> {
  await Promise.all(
    servers.map(async (s) => {
      const sig = sigOf(s);
      const cur = probes().get(sig);
      if (!force && cur && Date.now() - cur.at < PROBE_MS) return;
      // `force` asks anew: an answer already on its way may predate what changed (a model just loaded).
      const pending = force ? undefined : probing().get(sig);
      if (pending) return pending;
      const started = Date.now();
      const p: Promise<void> = (async () => {
        const found = await check(s, cur);
        // An older question that answers late doesn't overwrite a newer answer (a "busy for now" guess it always does).
        const now = probes().get(sig);
        if (!now || now.at <= started || now.busy) probes().set(sig, { at: started, ...found });
      })().finally(() => {
        if (probing().get(sig) === p) probing().delete(sig);
      });
      probing().set(sig, p);
      await p;
    }),
  );
}

const WORKER = `const { workerData } = require("node:worker_threads");
const { port, sab, requests, timeout, hosts } = workerData;
const flag = new Int32Array(sab);
// Whether each server's port takes a connection: one that does but doesn't answer in time is busy for now.
const connected = hosts.map(() => false);
hosts.forEach((at, i) => {
  if (!at) return;
  const socket = require("node:net").connect(at);
  socket.once("connect", () => ((connected[i] = true), socket.destroy())).once("error", () => {});
});
const one = (r) =>
  fetch(r.url, { headers: r.headers, signal: AbortSignal.timeout(timeout) })
    .then(async (res) => ({ status: res.status, text: (await res.text()).slice(0, 4000000) }))
    .catch((e) => ({ error: e && e.name === "TimeoutError" ? "TimeoutError" : (e && e.cause && e.cause.code) || "error" }));
Promise.all(requests.map(one))
  .then((out) => port.postMessage({ out, connected }))
  .catch(() => port.postMessage({ out: [], connected }))
  .finally(() => {
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  });`;

/**
 * The blocking first look: every server's GETs in one worker thread, waited for (a few ms when
 * nothing listens, at most 1.5 s + 1 s for a host that doesn't answer). A server whose port took the
 * connection but that didn't answer in time is busy for now; for any server that didn't answer in
 * time, the unhurried check goes on behind it to say for sure.
 */
export function refreshSync(servers: LocalServer[]): void {
  const reqs = servers.flatMap((s, i) => probeRequests(s).map((r) => ({ ...r, server: i })));
  const raws: Raw[] = reqs.map(() => ({ error: "TimeoutError" }));
  let connected: boolean[] = [];
  if (reqs.length) {
    try {
      const sab = new SharedArrayBuffer(4);
      const flag = new Int32Array(sab);
      const { port1, port2 } = new MessageChannel();
      const worker = new Worker(WORKER, {
        eval: true,
        workerData: {
          port: port2,
          sab,
          requests: reqs.map(({ url, headers }) => ({ url, headers })),
          timeout: SYNC_TIMEOUT_MS,
          hosts: servers.map((s) => hostPort(s.url) ?? null),
        },
        transferList: [port2],
      });
      Atomics.wait(flag, 0, 0, SYNC_TIMEOUT_MS + 1000);
      const got = receiveMessageOnPort(port1)?.message as { out: { status?: number; text?: string; error?: string }[]; connected: boolean[] } | undefined;
      got?.out.forEach((g, i) => (raws[i] = g.status !== undefined ? { status: g.status, body: parse(g.text) } : { error: g.error }));
      connected = got?.connected ?? [];
      port1.close();
      void worker.terminate();
    } catch {}
  }
  const at = Date.now();
  servers.forEach((s, i) => {
    const mine = reqs.flatMap((r, k) => (r.server === i ? [[r.key, raws[k]] as const] : []));
    const got = mine.map(([, raw]) => raw);
    if (late(got) && connected[i]) probes().set(sigOf(s), { at, probe: {}, busy: true });
    else probes().set(sigOf(s), { at, probe: Object.fromEntries(mine), ...(answered(got) ? { seen: at } : {}) });
    if (late(got)) void refresh([s], true).catch(() => {});
  });
}

/** A server no check has answered for yet, whose port took the connection: busy, so up, for now (a check says for sure). */
export function assumeBusy(s: LocalServer): void {
  if (!probes().has(sigOf(s))) probes().set(sigOf(s), { at: Date.now(), probe: {}, busy: true });
}

/** What a server whose port took the connection but that hasn't answered yet counts as: up, with no models known. */
function busyStatus(s: LocalServer, at: number): LocalStatus {
  return {
    kind: s.kind,
    label: s.label,
    url: s.url,
    up: true,
    auth: s.key ? "ok" : "none",
    models: [],
    model: s.model || null,
    loaded: null,
    context: null,
    problem: null,
    warning: `${cap(s.label)} took the connection at ${s.url} but hasn't answered yet (busy loading a model?). Fuobe is still checking.`,
    at,
  };
}

/** The cached answers for a server (null: never asked), and whether they're older than 15 s. */
export function cached(s: LocalServer): (Entry & { stale: boolean }) | null {
  const c = probes().get(sigOf(s));
  return c ? { ...c, stale: Date.now() - c.at > PROBE_MS } : null;
}

/** The server's status from its cached answers and the current Settings (null: never asked). */
export function statusOf(s: LocalServer, need: number): LocalStatus | null {
  const c = probes().get(sigOf(s));
  return c ? (c.busy ? busyStatus(s, c.at) : interpret(s, c.probe, need, c.at)) : null;
}

/** Forget a server's answers (its next look asks again). */
export const forget = (s: LocalServer) => void probes().delete(sigOf(s));
