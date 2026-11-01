import { z } from "zod";
import { saveComposite } from "@/server/ads";
import { failure, readBody } from "@/server/marketing";

const Body = z.object({ url: z.string().startsWith("/api/files/").max(500), ratio: z.enum(["1:1", "4:5", "9:16"]) });

/** Record a creative composited in the browser (an uploaded PNG) in the Library. */
export async function POST(request: Request, ctx: RouteContext<"/api/ads/creatives/[id]/save">) {
  const { id } = await ctx.params;
  const body = await readBody(request, Body, "Upload the image first");
  if (body instanceof Response) return body;
  try {
    return Response.json(saveComposite(id, body), { status: 201 });
  } catch (e) {
    return (e as Error).message === "Not found" ? Response.json({ error: "Not found" }, { status: 404 }) : failure(e);
  }
}
