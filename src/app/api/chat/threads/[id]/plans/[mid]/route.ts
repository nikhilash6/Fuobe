import { z } from "zod";
import { body, chatViewer, gone, signUp, tooOften } from "@/server/chat/http";
import { runPlan } from "@/server/chat/make";
import { getMessage, getThread, setMessagePlan } from "@/server/chat/store";
import { enter } from "@/server/rate";

const Post = z.object({ ok: z.boolean() });

/**
 * Answer a plan in a chat: run it (each step through the studios' own route, as the person, with every check a studio
 * run gets) or not. A plan runs once.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/chat/threads/[id]/plans/[mid]">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const limited = tooOften(v.who, "plans", 20);
  if (limited) return limited;
  const { id, mid } = await ctx.params;
  const p = Post.safeParse(await body(request));
  if (!p.success) return Response.json({ error: "Say whether to make it." }, { status: 400 });
  const m = getMessage(v.who, id, mid);
  if (!m?.plan) return gone();
  if (m.plan.status !== "ready") return Response.json({ error: "This plan has already been answered.", code: "answered" }, { status: 409 });
  // One answer at a time for a plan: a double tap starts it once.
  const leave = enter(`chat-plan:${v.who}:${mid}`, 1);
  if (!leave) return Response.json({ error: "It's starting already.", code: "answered" }, { status: 409 });
  try {
    const plan = p.data.ok ? await runPlan(request, m.plan) : { ...m.plan, status: "declined" as const };
    setMessagePlan(v.who, id, mid, plan);
    return Response.json(getThread(v.who, id));
  } finally {
    leave();
  }
}
