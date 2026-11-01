import { z } from "zod";
import { failure, readBody, saveRunComposite } from "@/server/marketing";

const Body = z.object({
  url: z.string().startsWith("/api/files/").max(500),
  ratio: z.string().regex(/^\d+:\d+$/),
  text: z.string().max(1000).default(""),
  /** The words as set (kept on the run, so "Edit text" opens with them). */
  overlay: z.object({ headline: z.string().max(140).optional(), body: z.string().max(400).optional(), cta: z.string().max(40).optional() }).optional(),
  /** Made by the browser on its own once the picture was ready (kept only if the run has none yet). */
  auto: z.boolean().optional(),
});

/** Save a result with its words set in the browser (an uploaded PNG: open models, Fuobe Marketing Image) to the Library. */
export async function POST(request: Request, ctx: RouteContext<"/api/marketing/runs/[id]/compose">) {
  const { id } = await ctx.params;
  const body = await readBody(request, Body, "Upload the image first");
  if (body instanceof Response) return body;
  try {
    return Response.json(saveRunComposite(id, body), { status: 201 });
  } catch (e) {
    return (e as Error).message === "Not found" ? Response.json({ error: "Not found" }, { status: 404 }) : failure(e);
  }
}
