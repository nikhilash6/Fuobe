import { z } from "zod";
import { readProductLink } from "@/server/brand";
import { failure, readBody } from "@/server/marketing";

const Body = z.object({
  url: z.string().trim().min(1).max(600),
  brandId: z.string().max(40).nullish(),
  /** How many products to add from a collection page. */
  limit: z.number().int().min(1).max(10).optional(),
  /** Also read the page's logo, colours and fonts (Click to Ad's product kit). */
  withBrand: z.boolean().optional(),
});

/** Add product(s) from a link: names, descriptions, prices and pictures read from the page. */
export async function POST(request: Request) {
  const body = await readBody(request, Body, "Use a valid product link.");
  if (body instanceof Response) return body;
  try {
    const r = await readProductLink(body);
    return Response.json(r, { status: r.products.length ? 201 : 200 });
  } catch (e) {
    return failure(e);
  }
}
