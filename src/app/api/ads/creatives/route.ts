import { connection } from "next/server";
import { listCreatives } from "@/server/ads";

/** A brand's ads (`?brand=<id>`, optionally `&batch=` or `&product=`), newest run first. */
export async function GET(request: Request) {
  await connection();
  const q = new URL(request.url).searchParams;
  const brandId = q.get("brand");
  if (!brandId) return Response.json({ error: "Pick a brand" }, { status: 400 });
  return Response.json({ items: listCreatives({ brandId, batchId: q.get("batch") ?? undefined, productId: q.get("product") ?? undefined }) });
}
