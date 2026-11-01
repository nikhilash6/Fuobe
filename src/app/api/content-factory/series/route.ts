import { connection } from "next/server";
import { z } from "zod";
import { createSeries, handle, listSeries, ReferenceSchema } from "@/server/content-factory";
import { body } from "@/server/faceless";

const Create = z.object({
  reference: ReferenceSchema.nullable(),
  engine: z.enum(["cloud", "open"]),
  prompt: z.string().max(2000).optional(),
});

/** Series that have been made, newest first. */
export async function GET() {
  await connection();
  return handle(() => Response.json({ items: listSeries() }));
}

/**
 * A new series around a reference: an upload, a link (fetched only through the SSRF-safe fetch; 422 with
 * `needsUpload` when it gives no clip) or a preset. Reading a clip into a style brief starts straight away.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, Create, "Add a reference clip, a link or a preset");
    return Response.json(await createSeries(input), { status: 201 });
  }, request);
}
