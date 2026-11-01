import { ClickToAdBody, failure, readBody, runClickToAd } from "@/server/marketing";

/** Click to Ad: a 9:16 voiced ad with captions from a product kit and a style. */
export async function POST(request: Request) {
  const body = await readBody(request, ClickToAdBody, "Select a product or enter a product URL");
  if (body instanceof Response) return body;
  try {
    return Response.json(await runClickToAd(body), { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
