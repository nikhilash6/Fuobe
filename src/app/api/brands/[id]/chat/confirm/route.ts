import { after } from "next/server";
import { z } from "zod";
import { confirmProposal } from "@/server/ads";
import { failure, readBody } from "@/server/marketing";

const Body = z.object({ messageId: z.string().min(1).max(20), engine: z.enum(["cloud", "open"]) });

/** The user said yes to a chat proposal: the ads start rendering. */
export async function POST(request: Request, ctx: RouteContext<"/api/brands/[id]/chat/confirm">) {
  const { id } = await ctx.params;
  const body = await readBody(request, Body);
  if (body instanceof Response) return body;
  try {
    const r = confirmProposal(id, body.messageId, body.engine);
    after(() => r.run);
    return Response.json({ batchId: r.batchId, messages: r.chat }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
