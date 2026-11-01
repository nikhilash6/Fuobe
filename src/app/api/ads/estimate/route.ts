import { BatchBody, estimateBatch } from "@/server/ads";
import { readBody } from "@/server/marketing";
import { priceAs } from "@/server/visitor";

/** The total before the run: ads × price per ad (+ the copy), and which model renders them. */
async function post(request: Request) {
  const body = await readBody(request, BatchBody, "Pick products and how many ads to make");
  if (body instanceof Response) return body;
  try {
    return Response.json(estimateBatch(body));
  } catch (e) {
    return Response.json({ costUsd: null, total: 0, perAd: null, demo: false, blocker: (e as Error).message });
  }
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
