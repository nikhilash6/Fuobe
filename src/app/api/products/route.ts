import { connection } from "next/server";
import { z } from "zod";
import { createProduct, listProducts, ProductFields } from "@/server/brand";
import { failure, readBody } from "@/server/marketing";

/** Products: all, a brand's (`?brand=<id>`) or the unassigned ones (`?brand=none`). */
export async function GET(request: Request) {
  await connection();
  const brand = new URL(request.url).searchParams.get("brand");
  return Response.json({ items: listProducts(brand === null ? undefined : brand === "none" ? null : brand) });
}

/** Add a product by hand. A name the brand already has answers 409 unless `force` is set ("Create anyway"). */
export async function POST(request: Request) {
  const body = await readBody(request, ProductFields.extend({ force: z.boolean().optional() }), "Check the product");
  if (body instanceof Response) return body;
  const { force, ...input } = body;
  try {
    return Response.json(createProduct({ ...input, price: input.price ?? null }, { force }), { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
