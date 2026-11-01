import "server-only";
import { errorDetail, httpError, keyMessage, rejectsJson, unreachableError } from "./errors";
import { healToolCalls } from "./messages";
import { takesConnection, within } from "../providers/reach";
import { assumeBusy, cached, forget, refresh, refreshSync, statusOf, tokens } from "./probe";
import { allLocalServers, authHeaders, cap, LOCAL_LABELS, llmContext, localServer, localServers, openaiBase, pinnedKind } from "./servers";
import type { ChatRequest, ChatResult, LocalKind, LocalServer, LocalStatus } from "./types";
import { ollamaBody, openaiBody, parseOllama, parseOpenai } from "./wire";

export { aiHelper, cap, llmContext, localServer, localServers, LOCAL_LABELS, pinnedKind } from "./servers";
export { emptyReply } from "./errors";
export { toChatMessages } from "./messages";
export type * from "./types";

/** A server that can take calls now, with what its probe found. */
export interface Ready {
  server: LocalServer;
  status: LocalStatus;
}

/**
 * The first server that can take calls. With more than one, a server that has the model comes first:
 * Ollama answers (so counts as ready) even with nothing pulled, and mustn't take every call from an
 * LM Studio that has a model.
 */
const pick = (servers: LocalServer[]): Ready | null => {
  const need = llmContext();
  const ready = servers.flatMap((server) => {
    const status = statusOf(server, need);
    return status && !status.problem ? [{ server, status }] : [];
  });
  return ready.find((r) => r.server.kind !== "ollama" || r.status.warning == null) ?? ready[0] ?? null;
};

/** Ask the local servers (answers kept 15 s; `force` asks now). True when one can take calls. */
export async function probeLocal(force = false): Promise<boolean> {
  const servers = localServers();
  await refresh(servers, force);
  return !!pick(servers);
}

/** The server a call goes to now: the first ready one in Settings' order (asks first when the answers are old). */
export async function activeLocal(force = false): Promise<Ready | null> {
  await probeLocal(force);
  return pick(localServers());
}

/** How long a person's question (Assist) waits for what no check of the local servers has said yet. */
const SOON_MS = 1500;

/**
 * The server a call would go to, for a person waiting on the answer (Assist's panel, a chat's mode): what the last
 * checks found, as routing reads them (localReady): a stale answer is refreshed in the background, not waited on. It
 * waits, at most `waitMs`, only for a server no check has answered for yet; one whose port took the connection by
 * then counts as busy, so reachable, for now (as routing's blocking first look does), and its check goes on to say for
 * sure. The awaited checks (a text step about to run, a chat's call) keep the full check (activeLocal).
 */
export async function localSoon(waitMs = SOON_MS): Promise<Ready | null> {
  const servers = localServers();
  const unknown = servers.filter((s) => !cached(s));
  const stale = servers.filter((s) => cached(s)?.stale);
  if (stale.length) void refresh(stale).catch(() => {});
  if (unknown.length) {
    const ports = unknown.map((s) => takesConnection(s.url, waitMs));
    const done = await within(refresh(unknown).then(() => true, () => true), waitMs);
    if (!done) (await Promise.all(ports)).forEach((took, i) => took && assumeBusy(unknown[i]));
  }
  return pick(servers);
}

/**
 * The same, synchronously, for routing. The first look at a server waits for a real answer (a step
 * posted right after boot must not fall back to demo text while the server is up); later looks use
 * the cached one and refresh it in the background.
 */
export function localReady(): Ready | null {
  const servers = localServers();
  const unknown = servers.filter((s) => !cached(s));
  if (unknown.length) refreshSync(unknown);
  if (servers.some((s) => cached(s)?.stale)) void refresh(servers).catch(() => {});
  return pick(servers);
}

/** What the local model is called in messages: the pinned server, the one in use, or "a local model". Never waits. */
export function localLabel(): string {
  const pinned = pinnedKind();
  return pinned ? LOCAL_LABELS[pinned] : (pick(localServers())?.server.label ?? "a local model");
}

/**
 * The model local text steps run on now, for its licence: the ready server's (cached answers only: never
 * asks), else the model the pinned server is set to, else Ollama's. `model` is "" when the server picks one.
 */
export function localModelInUse(): { label: string; model: string } {
  const ready = pick(localServers());
  if (ready?.status.model) return { label: ready.server.label, model: ready.status.model };
  const s = localServer(pinnedKind() ?? "ollama");
  return { label: s.label, model: s.model };
}

/** What to connect, in a sentence: the pinned server, or any of the three. */
export const localWhat = (): string => {
  const pinned = pinnedKind();
  return pinned ? LOCAL_LABELS[pinned] : "a local model (Ollama, LM Studio or Unsloth Studio)";
};

/**
 * Why no local model can run, when a server says (it needs a key, has no model loaded): the pinned
 * server's reason, or in Automatic the first server that answers but can't run. Null otherwise.
 */
export function localProblem(): string | null {
  const need = llmContext();
  const pinned = pinnedKind();
  for (const s of localServers()) {
    const st = statusOf(s, need);
    if (st?.problem && (st.up || pinned)) return st.problem;
  }
  return null;
}

/** Every server's status for Settings (all four, whatever is pinned). */
export async function localStatuses(force = false): Promise<LocalStatus[]> {
  const servers = allLocalServers();
  await refresh(servers, force);
  const need = llmContext();
  return servers.map((s) => statusOf(s, need)!);
}

// ---------------------------------------------------------------------------
// LM Studio: loading a model with the context Fuobe needs

declare global {
  var __fuobeLmLoads: Map<string, Promise<{ model: string; context: number | null; seconds: number | null }>> | undefined;
}
const loads = () => (globalThis.__fuobeLmLoads ??= new Map());

/** POST /api/v1/models/load; concurrent calls for one model share the load. */
function loadLmStudio(s: LocalServer, model: string, context: number) {
  const key = `${s.url}|${model}`;
  let p = loads().get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${s.url}/api/v1/models/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(s) },
        body: JSON.stringify({ model, context_length: context, echo_load_config: true }),
        signal: AbortSignal.timeout(300_000),
      }).catch((e: unknown) => {
        throw unreachableError(s, e);
      });
      if (res.status === 401 || res.status === 403) throw new Error(keyMessage(s));
      if (!res.ok) throw new Error(`LM Studio couldn't load ${model} with ${tokens(context)} tokens of context: ${errorDetail(await res.text())}. Free some GPU memory (ComfyUI shares it), pick a smaller model, or lower the context in Settings → AI helper.`);
      const j = (await res.json().catch(() => ({}))) as { load_time_seconds?: number; load_config?: { context_length?: number } };
      // The next status shows it loaded, so it isn't loaded twice.
      await refresh([s], true);
      return { model, context: j.load_config?.context_length ?? context, seconds: j.load_time_seconds ?? null };
    })().finally(() => loads().delete(key));
    loads().set(key, p);
  }
  return p;
}

/**
 * LM Studio's chat endpoint can't set the context, and loading a model on demand (JIT) uses the
 * app's default (often 4k–8k: too small for Assist's tools). So a model that isn't loaded yet is
 * loaded first with the context from Settings. A model the user loaded is left as it is.
 */
async function prepareLmStudio(s: LocalServer, status: LocalStatus, model: string): Promise<void> {
  const need = llmContext();
  // The latest answers, not the caller's snapshot: a job that started before its first call loaded
  // the model must not load it again for every later call.
  const now = statusOf(s, need) ?? status;
  if (!now.native || !need) return;
  const m = now.models.find((x) => x.id === model) ?? now.models.find((x) => model.startsWith(`${x.id}@`));
  if (!m || m.loaded) return;
  await loadLmStudio(s, model, Math.min(need, m.maxContext || need));
}

/** Settings → "Reload with 16k context": unloads LM Studio's copies of the model, then loads it with the context from Settings. */
export async function reloadLmStudio(model?: string | null): Promise<{ model: string; context: number | null; seconds: number | null }> {
  const s = localServer("lmstudio");
  await refresh([s], true);
  const status = statusOf(s, llmContext());
  if (!status?.up) throw new Error(status?.problem ?? "LM Studio isn't running");
  if (!status.native) throw new Error("Loading a model from Fuobe needs LM Studio 0.4 or later. Load it in LM Studio with a larger context instead.");
  const want = model || status.model;
  const m = status.models.find((x) => x.id === want);
  if (!want || !m) throw new Error(`LM Studio has no model called ${want ?? "that"}`);
  for (const id of m.instances ?? []) {
    await fetch(`${s.url}/api/v1/models/unload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(s) },
      body: JSON.stringify({ instance_id: id }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
  }
  const need = llmContext() || 16384;
  return loadLmStudio(s, want, Math.min(need, m.maxContext || need));
}

// ---------------------------------------------------------------------------
// One call

/**
 * The model a call names: the request's, Settings', or the one the probe picked. Unsloth: none, so
 * its loaded model answers. LM Studio: the probe's, which is the model's key when Settings names it
 * by its display name.
 */
function modelFor(r: Ready, req: ChatRequest): string | null {
  if (req.model) return req.model;
  if (r.server.kind === "unsloth") return r.server.model || null;
  if (r.server.kind === "lmstudio") return r.status.model || r.server.model || null;
  return r.server.model || r.status.model;
}

/**
 * One chat call to a local server (not streamed). With `json`, a server that rejects structured
 * output is asked again without it (the prompts ask for JSON too). With `tools`, calls the model
 * wrote as text are read back. Throws messages that say how to fix the server; a reply with no
 * text is returned as it is (see emptyReply).
 */
export async function chatLocal(r: Ready, req: ChatRequest): Promise<ChatResult> {
  const s = r.server;
  const model = modelFor(r, req);
  if (s.kind === "lmstudio" && model) await prepareLmStudio(s, r.status, model);
  const signal = req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]) : AbortSignal.timeout(req.timeoutMs);
  const url = s.kind === "ollama" ? `${s.url}/api/chat` : `${openaiBase(s)}/chat/completions`;
  const send = (withJson: boolean) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(s) },
      body: JSON.stringify(s.kind === "ollama" ? ollamaBody(req, model ?? s.model, llmContext(), withJson) : openaiBody(s.kind, req, model, withJson)),
      signal,
    }).catch((e: unknown) => {
      if (req.signal?.aborted) throw e;
      // It was up a moment ago: look again before routing sends it more.
      if ((e as Error)?.name !== "TimeoutError") forget(s);
      throw unreachableError(s, e);
    });
  let res = await send(true);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (req.json && rejectsJson(s.kind, res.status, body)) res = await send(false);
    else throw httpError(s, res.status, body, model);
    if (!res.ok) throw httpError(s, res.status, await res.text().catch(() => ""), model);
  }
  let j: unknown;
  try {
    j = await res.json();
  } catch (e) {
    if (req.signal?.aborted) throw e;
    if ((e as Error)?.name === "TimeoutError") throw unreachableError(s, e);
    throw new Error(`${cap(s.label)} sent an answer Fuobe couldn't read`);
  }
  const answer = model ?? r.status.model ?? s.label;
  const out = s.kind === "ollama" ? parseOllama(j as Parameters<typeof parseOllama>[0], answer) : parseOpenai(j as Parameters<typeof parseOpenai>[0], answer);
  if (req.tools?.length && !out.toolCalls.length && out.text) {
    const healed = healToolCalls(out.text, new Set(req.tools.map((t) => t.name)));
    if (healed.calls.length) return { ...out, text: healed.text, toolCalls: healed.calls, stop: "tool_use" };
  }
  return out;
}

/** Settings → Test: a tiny call to the server text steps would use (or the one named), timed. */
export async function testLocal(kind?: LocalKind | null): Promise<{ ok: boolean; detail: string; ms?: number; model?: string }> {
  const servers = kind ? [localServer(kind)] : localServers();
  await refresh(servers, true);
  const ready = pick(servers);
  if (!ready) {
    const need = llmContext();
    const said = servers.map((s) => statusOf(s, need)).find((st) => st?.problem && (st.up || servers.length === 1));
    return { ok: false, detail: said?.problem ?? "No local model server is answering. Start Ollama, LM Studio or Unsloth Studio, or set your server's URL." };
  }
  const t0 = Date.now();
  try {
    const r = await chatLocal(ready, { messages: [{ role: "user", content: "Reply with the word OK." }], think: false, maxTokens: 16, timeoutMs: 300_000 });
    const ms = Date.now() - t0;
    const note = r.text ? "" : " (it was still thinking: models that think first answer more slowly)";
    return { ok: true, ms, model: r.model, detail: `${cap(ready.server.label)} answered in ${(ms / 1000).toFixed(1)} s with ${r.model}${note}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/**
 * Settings → Save & test for a local server's URL, model or key: does it answer, and has it the model
 * Settings names? Reads its model list only (no call, nothing loaded), so it is quick. Without
 * `kind`: the server text steps would use.
 */
export async function checkLocal(kind?: LocalKind | null): Promise<{ ok: boolean; detail: string }> {
  const servers = kind ? [localServer(kind)] : localServers();
  await refresh(servers, true);
  const need = llmContext();
  const ready = pick(servers);
  if (!ready) {
    const said = servers.map((s) => statusOf(s, need)).find((st) => st?.problem && (st.up || servers.length === 1));
    return { ok: false, detail: said?.problem ?? `Nothing answers at ${servers.map((s) => s.url).join(", ")}. Start Ollama, LM Studio or Unsloth Studio, or set your server's URL.` };
  }
  const { server, status } = ready;
  // Ollama answers without the model too (a call would name it): here that is a failed check.
  if (server.kind === "ollama" && status.warning) {
    return { ok: false, detail: status.models.length ? `Ollama answers, but ${server.model} isn't pulled — run: ollama pull ${server.model}` : status.warning };
  }
  const detail = `${cap(server.label)} · ${status.model ?? "its loaded model"} ready`;
  return { ok: true, detail: status.warning ? `${detail} · ${status.warning}` : detail };
}

/** What /api/status says about the local model (no keys). */
export async function localSummary() {
  const servers = localServers();
  await refresh(servers);
  const need = llmContext();
  const ready = pick(servers);
  return {
    provider: pinnedKind() ?? "auto",
    context: need,
    local: ready
      ? { kind: ready.server.kind, label: ready.server.label, url: ready.server.url, model: ready.status.model, loaded: ready.status.loaded, context: ready.status.context, warning: ready.status.warning }
      : null,
    problem: ready ? null : localProblem(),
    detected: servers.map((s) => {
      const st = statusOf(s, need)!;
      return { kind: s.kind, label: s.label, url: s.url, up: st.up, auth: st.auth, models: st.models.length, model: st.model, problem: st.problem };
    }),
  };
}
