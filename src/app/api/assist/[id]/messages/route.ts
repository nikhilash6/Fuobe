import { after } from "next/server";
import { addMessage, AssistBusyError, run } from "@/server/assist/agent";
import { AssistMessage } from "@/server/assist/schemas";

export async function POST(request: Request, ctx: RouteContext<"/api/assist/[id]/messages">) {
  const { id } = await ctx.params;
  const parsed = AssistMessage.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Write a message" }, { status: 400 });
  try {
    const thread = addMessage(id, parsed.data.text, parsed.data.attachments);
    const reply = run(id);
    after(() => reply);
    return Response.json(thread);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof AssistBusyError ? 409 : 404 });
  }
}
