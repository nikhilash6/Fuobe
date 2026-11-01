import { z } from "zod";
import { CueSchema, getDubSession, previewVoiceDub, voiceDub } from "@/server/dub";
import { priceAs } from "@/server/visitor";

const Body = z.object({
  lang: z.string().min(2).max(12),
  /** The reviewed lines (saved with the run); omitted = the saved draft or the translation. */
  cues: z.array(CueSchema).max(3000).optional(),
  lipsync: z.boolean().optional(),
});

/** Speak one language's reviewed lines in the cloned voice: the voice pipeline; `?preview=1` only prices it. */
async function post(request: Request, ctx: RouteContext<"/api/dub/[id]/voice">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick the language to voice" }, { status: 400 });
  if (!getDubSession(id)) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const opts = { cues: parsed.data.cues, lipsync: parsed.data.lipsync };
    if (new URL(request.url).searchParams.get("preview") === "1") return Response.json(previewVoiceDub(id, parsed.data.lang, opts));
    return Response.json(voiceDub(id, parsed.data.lang, opts), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request, ctx: RouteContext<"/api/dub/[id]/voice">) {
  return priceAs(request, () => post(request, ctx));
}
