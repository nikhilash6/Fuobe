import { z } from "zod";
import { retryPhoto } from "@/server/photodump";
import { refusedRun } from "@/server/connect-refusal";

const Body = z.object({ id: z.string().min(1).max(40) });

/**
 * Retry a failed or canceled photo of a Photodump / Fashion Factory / Character Sheet run: the same
 * request in the same batch, replacing the failed one (it goes to the Trash).
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick the photo to retry" }, { status: 400 });
  try {
    return Response.json({ items: retryPhoto(parsed.data.id) }, { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
