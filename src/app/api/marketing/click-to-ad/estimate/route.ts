import { ClickToAdBody, estimateClickToAd, readBody } from "@/server/marketing";
import { priceAs } from "@/server/visitor";

async function post(request: Request) {
  const body = await readBody(request, ClickToAdBody, "Select a product or enter a product URL");
  if (body instanceof Response) return body;
  try {
    return Response.json(estimateClickToAd(body));
  } catch (e) {
    return Response.json({ costUsd: null, demo: false, steps: [], notes: [], runs: 0, blocker: (e as Error).message });
  }
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
