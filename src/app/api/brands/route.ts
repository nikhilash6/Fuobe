import { after, connection } from "next/server";
import { z } from "zod";
import { createBrandFromWebsite, createManualBrand, listBrands } from "@/server/brand";
import { failure, readBody } from "@/server/marketing";

const Body = z.union([
  z.object({ website: z.string().trim().min(1).max(300) }),
  z.object({
    description: z.string().trim().max(2000),
    name: z.string().trim().max(80).optional(),
    images: z.array(z.string().startsWith("/api/files/")).max(8).optional(),
    colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(8).optional(),
  }),
]);

/** Brand kits, newest activity first (with product and ad counts). */
export async function GET() {
  await connection();
  return Response.json({ items: listBrands() });
}

/**
 * New brand kit: `{website}` starts the research (poll GET /api/brands/:id while status is
 * "researching"); `{description, images?}` builds one by hand ("Describe your business").
 */
export async function POST(request: Request) {
  const body = await readBody(request, Body, "Add a website, or describe your business");
  if (body instanceof Response) return body;
  try {
    if ("website" in body) {
      const { brand, run } = createBrandFromWebsite(body.website);
      after(() => run);
      return Response.json(brand, { status: 201 });
    }
    return Response.json(await createManualBrand(body), { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
