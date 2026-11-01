import { after } from "next/server";
import { cancelResearch, retryResearch } from "@/server/brand";
import { failure } from "@/server/marketing";

/** Run the website research again (Retry research). */
export async function POST(_req: Request, ctx: RouteContext<"/api/brands/[id]/research">) {
  const { id } = await ctx.params;
  try {
    const { brand, run } = retryResearch(id);
    after(() => run);
    return Response.json(brand, { status: 202 });
  } catch (e) {
    return (e as Error).message === "Not found" ? Response.json({ error: "Not found" }, { status: 404 }) : failure(e);
  }
}

/** Cancel generation: stops the research; the kit keeps what it had. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/brands/[id]/research">) {
  const { id } = await ctx.params;
  const brand = cancelResearch(id);
  return brand ? Response.json(brand) : Response.json({ error: "Not found" }, { status: 404 });
}
