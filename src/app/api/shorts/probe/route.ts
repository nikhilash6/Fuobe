import { z } from "zod";
import { probeSource } from "@/server/shorts";
import { body, handle } from "@/server/shorts-schemas";

/** An uploaded clip's length, size, frame rate and whether it has sound (from its MP4 / MOV header). */
export async function POST(request: Request) {
  return handle(async () => {
    const { url } = await body(request, z.object({ url: z.string().startsWith("/api/files/").max(500) }), "Upload the clip first");
    return Response.json(await probeSource(url));
  }, request);
}
