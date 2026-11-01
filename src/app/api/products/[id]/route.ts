import { connection } from "next/server";
import { deleteProduct, getProduct, ProductFields, updateProduct } from "@/server/brand";
import { failure, readBody } from "@/server/marketing";

export async function GET(_req: Request, ctx: RouteContext<"/api/products/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const p = getProduct(id);
  return p ? Response.json(p) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/products/[id]">) {
  const { id } = await ctx.params;
  const body = await readBody(request, ProductFields.partial(), "Check the product");
  if (body instanceof Response) return body;
  try {
    const p = updateProduct(id, body);
    return p ? Response.json(p) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/products/[id]">) {
  const { id } = await ctx.params;
  return deleteProduct(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
