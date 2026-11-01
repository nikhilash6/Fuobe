import { connection } from "next/server";
import { z } from "zod";
import { deleteBrand, getBrand, listProducts, updateBrand } from "@/server/brand";
import { failure, readBody } from "@/server/marketing";

const list = (max: number, len: number) => z.array(z.string().max(len)).max(max);

const Patch = z.object({
  name: z.string().max(80).optional(),
  website: z.string().max(300).optional(),
  logo: z.string().max(400).optional(),
  tagline: z.string().max(200).optional(),
  overview: z.string().max(2000).optional(),
  colors: list(12, 32).optional(),
  fonts: z.object({ heading: z.string().max(80).optional(), body: z.string().max(80).optional() }).optional(),
  values: list(12, 120).optional(),
  aesthetics: list(12, 120).optional(),
  tone: list(12, 60).optional(),
  audience: z.string().max(400).optional(),
  sellingPoints: list(10, 200).optional(),
  competitors: list(12, 80).optional(),
  socials: z.array(z.object({ network: z.string().max(30), url: z.string().max(400) })).max(16).optional(),
  language: z.string().max(40).optional(),
  images: list(16, 400).optional(),
  details: list(16, 400).optional(),
});

/** One brand kit with its products. */
export async function GET(_req: Request, ctx: RouteContext<"/api/brands/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const brand = getBrand(id);
  return brand ? Response.json({ brand, products: listProducts(id) }) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Edits from the review form. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/brands/[id]">) {
  const { id } = await ctx.params;
  const body = await readBody(request, Patch);
  if (body instanceof Response) return body;
  try {
    const brand = updateBrand(id, body);
    return brand ? Response.json(brand) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return failure(e);
  }
}

/** The kit and its products leave the shelf; ads already made stay in the Library. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/brands/[id]">) {
  const { id } = await ctx.params;
  return deleteBrand(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
