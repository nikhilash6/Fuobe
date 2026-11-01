import { connection } from "next/server";
import { z } from "zod";
import { chat, clearChat, getChat } from "@/server/ads";
import { getBrand } from "@/server/brand";
import { failure, readBody } from "@/server/marketing";

const Body = z.object({ text: z.string().trim().min(1).max(2000) });

/** The brand chat ("what ads should we make for {brand}?"). */
export async function GET(_req: Request, ctx: RouteContext<"/api/brands/[id]/chat">) {
  await connection();
  const { id } = await ctx.params;
  return getBrand(id) ? Response.json({ messages: getChat(id) }) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Send a message; the reply may carry a proposal (products × count + direction) to confirm. */
export async function POST(request: Request, ctx: RouteContext<"/api/brands/[id]/chat">) {
  const { id } = await ctx.params;
  const body = await readBody(request, Body, "Write a message");
  if (body instanceof Response) return body;
  try {
    return Response.json({ messages: await chat(id, body.text) });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/brands/[id]/chat">) {
  const { id } = await ctx.params;
  clearChat(id);
  return new Response(null, { status: 204 });
}
