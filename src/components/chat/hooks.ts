"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { CharacterCard, ChatKind } from "@/lib/chat/catalog";
import type { ChatEvent, ChatMe, ChatMessage, ChatThreadSummary, ChatThreadView } from "@/lib/chat/types";
import { responseError } from "@/lib/refusals";

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw responseError(res, Object.assign(new Error(body.error ?? "That didn't go through. Tap it once more."), { status: res.status }, body.code && { code: body.code }));
  return body;
}

export const chatSend = async <T,>(url: string, method: string, body?: unknown) =>
  json<T>(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

export function useChatMe(enabled = true) {
  return useQuery({ queryKey: ["chat", "me"], queryFn: async () => json<ChatMe>(await fetch("/api/chat/me")), staleTime: 15_000, enabled });
}

/** The person's chats (`archived`: the ones they archived instead). */
export function useChatThreads(enabled = true, q = "", archived = false) {
  const sp = new URLSearchParams();
  if (q.trim()) sp.set("q", q.trim());
  if (archived) sp.set("archived", "1");
  return useQuery({
    queryKey: ["chat", "threads", q.trim(), archived],
    queryFn: async () => json<{ items: ChatThreadSummary[] }>(await fetch(`/api/chat/threads${sp.size ? `?${sp}` : ""}`)),
    staleTime: 5_000,
    enabled,
  });
}

export function useCharacters(enabled = true) {
  return useQuery({ queryKey: ["chat", "characters"], queryFn: async () => json<{ items: CharacterCard[] }>(await fetch("/api/chat/characters")), staleTime: 30_000, enabled });
}

/** One chat. `poll`: look for a reply that's coming later (a message kept until the free model is ready). */
export function useChatThread(id: string, enabled = true, poll = false) {
  return useQuery({
    queryKey: ["chat", "thread", id],
    queryFn: async () => json<ChatThreadView>(await fetch(`/api/chat/threads/${id}`)),
    staleTime: 0,
    enabled,
    retry: false,
    // A kept message waits for its reply; a plan's runs come in while they're made.
    refetchInterval: (q) => (making(q.state.data) ? 2_000 : poll ? 6_000 : false),
  });
}

/** Are any of a chat's plans still making their results? */
function making(t: ChatThreadView | undefined): boolean {
  if (!t) return false;
  const status = new Map(t.generations.map((g) => [g.id, g.status]));
  return t.messages.some((m) => m.plan?.status === "running" && m.plan.ids.some((id) => !status.has(id) || status.get(id) === "queued" || status.get(id) === "running"));
}

export interface StartChat {
  kind: ChatKind;
  characterId?: string | null;
  tool?: string | null;
  play?: string | null;
  text?: string | null;
  image?: string | null;
}

/** Start a chat; the thread page asks for the first reply. */
export function useStartChat() {
  const qc = useQueryClient();
  return useCallback(
    async (s: StartChat) => {
      const t = await chatSend<ChatThreadView>("/api/chat/threads", "POST", s);
      qc.setQueryData(["chat", "thread", t.id], t);
      void qc.invalidateQueries({ queryKey: ["chat", "threads"] });
      return t;
    },
    [qc],
  );
}

export type ReplyState =
  | { phase: "idle" }
  | { phase: "waiting"; position?: number; starting?: boolean }
  /** Kept: the reply comes here as soon as the free model is ready (the page looks for it meanwhile). */
  | { phase: "pending" }
  | { phase: "writing"; text: string }
  | { phase: "failed"; message: string; code: string; retryAfterS?: number; /** When a limit opens again (ms). */ retryAt?: number };

/**
 * Ask for a reply and follow its stream. The thread's cached view gets the person's message and the saved reply as
 * they arrive; `state` shows what's happening in between.
 */
export function useReply(threadId: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<ReplyState>({ phase: "idle" });
  /** Replies this page watched being written: they show as they are. Any other reply that arrives while the page is open shows as if written. */
  const [streamedIds, setStreamedIds] = useState<ReadonlySet<string>>(() => new Set());
  const ctl = useRef<AbortController | null>(null);

  const patch = useCallback(
    (fn: (t: ChatThreadView) => ChatThreadView) => qc.setQueryData<ChatThreadView>(["chat", "thread", threadId], (t) => (t ? fn(t) : t)),
    [qc, threadId],
  );

  const ask = useCallback(
    async (body: { text?: string; image?: string | null; retry?: boolean; edit?: string }) => {
      ctl.current?.abort();
      const ac = new AbortController();
      ctl.current = ac;
      setState({ phase: "waiting" });
      // Shown at once; the server's copy replaces it.
      const temp: ChatMessage | null = body.text || body.image ? { id: `tmp_${Date.now()}`, role: "user", content: body.text ?? "", image: body.image ?? null, createdAt: Date.now() } : null;
      patch((t) => {
        let messages = t.messages;
        if (body.edit) {
          const i = messages.findIndex((m) => m.id === body.edit);
          if (i >= 0) messages = messages.slice(0, i);
        } else if (body.retry && messages.at(-1)?.role === "assistant" && messages.length > 1) messages = messages.slice(0, -1);
        return { ...t, messages: temp ? [...messages, temp] : messages };
      });
      let res: Response;
      try {
        res = await fetch(`/api/chat/threads/${threadId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
      } catch {
        if (ac.signal.aborted) return setState({ phase: "idle" });
        return setState({ phase: "failed", code: "failed", message: "You look offline. Your message is ready to send when you're back — tap Write it again." });
      }
      if (!res.ok || !res.body) {
        const e = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        // Answered a moment ago (in another tab, or just before this page asked): the saved chat has the reply.
        if (res.status === 409 && e.code === "nothing") {
          await qc.invalidateQueries({ queryKey: ["chat", "thread", threadId] });
          return setState({ phase: "idle" });
        }
        // The guest card opens by itself (watchGuestRefusals); the message stays for Try again.
        responseError(res, new Error(e.error ?? ""));
        void qc.invalidateQueries({ queryKey: ["chat", "thread", threadId] });
        const wait = Number(res.headers.get("Retry-After")) || undefined;
        return setState({ phase: "failed", code: e.code ?? "failed", message: e.error ?? "The reply didn't start. Tap Write it again.", ...(wait && { retryAfterS: wait, retryAt: Date.now() + wait * 1000 }) });
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      let ended = false;
      let streamed = false;
      let texts = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let e: ChatEvent;
            try {
              e = JSON.parse(line) as ChatEvent;
            } catch {
              continue;
            }
            if (e.type === "user") patch((t) => ({ ...t, messages: [...t.messages.filter((m) => m.id !== temp?.id), e.message] }));
            else if (e.type === "queue") setState((s) => (s.phase === "waiting" ? { phase: "waiting", position: e.position } : s));
            else if (e.type === "status") setState((s) => (s.phase === "waiting" ? { phase: "waiting", starting: true } : s));
            else if (e.type === "pending") {
              ended = true;
              setState({ phase: "pending" });
              void qc.invalidateQueries({ queryKey: ["chat", "thread", threadId] });
            }
            else if (e.type === "text") {
              // Only a model that streams sends text on the way; a whole reply comes with done alone.
              texts++;
              streamed = texts > 0;
              setState({ phase: "writing", text: e.text });
            } else if (e.type === "done") {
              ended = true;
              if (streamed) setStreamedIds((s) => new Set(s).add(e.message.id));
              patch((t) => ({ ...t, title: e.title, messages: [...t.messages.filter((m) => m.id !== e.message.id), e.message] }));
              setState({ phase: "idle" });
              void qc.invalidateQueries({ queryKey: ["chat", "threads"] });
            } else if (e.type === "error") {
              ended = true;
              setState({ phase: "failed", code: e.code, message: e.message, retryAfterS: e.retryAfterS, ...(e.retryAfterS && { retryAt: Date.now() + e.retryAfterS * 1000 }) });
            }
          }
        }
      } catch {
        if (ac.signal.aborted) {
          ended = true;
          setState({ phase: "idle" });
        }
      }
      if (!ended) setState({ phase: "failed", code: "failed", message: "The reply stopped part way. Tap Write it again for a fresh one." });
    },
    [patch, qc, threadId],
  );

  // Stop ends the reply on the server too (leaving the page doesn't: the reply carries on and is saved).
  const stop = useCallback(() => {
    ctl.current?.abort();
    setState({ phase: "idle" });
    void fetch(`/api/chat/threads/${threadId}/reply`, { method: "DELETE" }).catch(() => {});
  }, [threadId]);

  /** The kept message has its reply now (the page saw it arrive): nothing is waiting any more. */
  const settle = useCallback(() => setState((s) => (s.phase === "pending" ? { phase: "idle" } : s)), []);

  return { state, ask, stop, settle, streamedIds };
}
