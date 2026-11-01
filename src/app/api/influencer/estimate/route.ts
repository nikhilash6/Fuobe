import { POST as influencer } from "../route";
import { priceAs } from "@/server/visitor";

/**
 * The price of an AI Influencer run without starting it: the same body as POST /api/influencer?preview=1, at the
 * `<route>/estimate` path the evaluation harness prices studio routes at.
 */
async function post(request: Request) {
  const url = new URL(request.url.replace(/\/estimate(?=\/?(\?|$))/, ""));
  url.searchParams.set("preview", "1");
  return influencer(new Request(url, { method: "POST", headers: request.headers, body: await request.text() }));
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
