import { connection } from "next/server";
import { z } from "zod";
import { failure, listRuns, MarketingBody, readBody, runMarketing } from "@/server/marketing";

const Feature = z.enum(["marketing", "click-to-ad", "ad-multiplier"]);

/** Runs of one flow (`?feature=marketing|click-to-ad|ad-multiplier`), newest first, with every step's generation. */
export async function GET(request: Request) {
  await connection();
  const q = new URL(request.url).searchParams;
  const feature = Feature.safeParse(q.get("feature") ?? "marketing");
  if (!feature.success) return Response.json({ error: "Unknown feature" }, { status: 400 });
  return Response.json({ items: listRuns(feature.data, Number(q.get("limit")) || 30) });
}

/** Marketing Studio: make a template (or a free prompt) with a product, avatar, hook and brand kit. */
export async function POST(request: Request) {
  const body = await readBody(request, MarketingBody);
  if (body instanceof Response) return body;
  try {
    return Response.json(await runMarketing(body), { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
