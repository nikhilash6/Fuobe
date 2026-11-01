import { z } from "zod";
import { body, EngineSchema, handle, summarizeLink } from "@/server/faceless";

const Ask = z.object({ url: z.string().url("Paste a full link, starting with https://").max(2000), engine: EngineSchema });

/** A link source: the page is fetched (public addresses only) and summarised for the script writer. */
export async function POST(request: Request) {
  return handle(async () => {
    const { url, engine } = await body(request, Ask, "Paste a link – article, page");
    return Response.json(await summarizeLink(url, engine));
  }, request);
}
