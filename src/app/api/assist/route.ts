import { after, connection } from "next/server";
import { z } from "zod";
import { isGuest } from "@/lib/guest-access";
import { addMessage, availability, createThread, listThreads, resolveAgent, resolveMode, run } from "@/server/assist/agent";
import { AssistMessage, ModeChoice } from "@/server/assist/schemas";

const Create = AssistMessage.extend({
  engine: z.enum(["cloud", "open"]),
  autoApprove: z.boolean().optional(),
  projectId: z.string().max(40).nullish(),
  mode: ModeChoice.optional(),
});

/**
 * Chats (all, `?project=<id>`, or `?project=none` for chats outside projects; `?q=` searches), with what can run.
 * A guest's or an account's answer (GUEST_HEADER) is an empty list and nothing else: the chats, and the install's AI
 * setup (which providers have keys, the local server and its models, a free plan's use), are the owner's.
 */
export async function GET(request: Request) {
  await connection();
  if (isGuest(request)) return Response.json({ threads: [] });
  const sp = new URL(request.url).searchParams;
  const project = sp.get("project");
  const threads = listThreads({ project: project === "none" ? null : (project ?? undefined), q: sp.get("q") ?? undefined });
  const [agent, can] = await Promise.all([resolveAgent(), availability()]);
  return Response.json({ threads, agent, availability: can });
}

/** Start a chat with its first message; the agent replies in the background (poll the thread). */
export async function POST(request: Request) {
  const parsed = Create.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Write a message" }, { status: 400 });
  const { text, attachments, engine, autoApprove, projectId, mode } = parsed.data;
  const r = await resolveMode(mode);
  let thread;
  try {
    thread = createThread({ engine, autoApprove, agent: r.agent, projectId: projectId ?? null, mode: r.mode, provider: r.provider, model: r.model, effort: r.effort });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
  const updated = addMessage(thread.id, text, attachments);
  // Claimed now (not in after()) so a poll that lands first doesn't see a stale "running" thread.
  const reply = run(thread.id);
  after(() => reply);
  return Response.json({ ...updated, ...(r.note && { note: r.note }) }, { status: 201 });
}
