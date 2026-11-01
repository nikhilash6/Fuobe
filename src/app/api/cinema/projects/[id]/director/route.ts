import { after, connection } from "next/server";
import { clearChat, getChat } from "@/server/cinema";
import { askDirector } from "@/server/cinema-director";
import { DirectorAsk, body, handle } from "@/server/cinema-schemas";

export async function GET(_req: Request, ctx: RouteContext<"/api/cinema/projects/[id]/director">) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json({ messages: getChat(id) });
  });
}

/** Ask the AI Director; answers with the whole conversation (the reply proposes shots, never renders them). */
export async function POST(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/director">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await body(request, DirectorAsk, "Write a message first");
    const reply = askDirector(id, b.text);
    // An LLM call can outlive a closed tab; keep it running so the answer is saved.
    after(() => reply.catch(() => {}));
    return Response.json({ messages: await reply });
  }, request);
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/director">) {
  return handle(async () => {
    const { id } = await ctx.params;
    clearChat(id);
    return new Response(null, { status: 204 });
  }, request);
}
